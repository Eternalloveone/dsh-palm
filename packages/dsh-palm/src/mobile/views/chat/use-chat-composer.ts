/**
 * 发送 / 队列 / 插话状态机（S8a 从 `ChatView` 搬出）：三种发送模式（普通 queue /
 * 排队 / 插话 steer）、离线入队与补发、命令 chip、`draftEmpty`/`primaryStops` 判据。
 *
 * **纯搬运**：判定顺序、真机结论注释逐字保留。输入框/附件/命令的当前值与 setter 由
 * 调用方传入（它们同时被作曲区 UI 消费），本 hook 只持有真正属于自己的状态。
 */
import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { MuxClient } from '../../mux.ts'
import type { CommandDescriptor } from '../../api.ts'
import { cancelSession, inboxOf, logTail, newRequestId, prompt } from '../../api.ts'
import { addOptimisticQueueItem, dropOptimisticQueueItem } from '../../session-store.ts'
import { enqueuePrompt, flushOutbox, removeFromOutbox } from '../../offline.ts'
import { buildPromptParts, type AttachedImage, type PromptPart } from '../../image.ts'
import type { StagedFile } from './use-chat-attachments.ts'
import { errorText, staleHostHint } from '../../shared/error-text.ts'
import { rememberQueuedEcho } from '../../queued-echo.ts'
import { toast } from '../../toast.tsx'
import type { StatusEvent } from '../../session-status.ts'

/** 发送意图：排队（默认）/ 插进当前回合 / 先停再排队。 */
export type SendIntent = 'queue' | 'steer' | 'interrupt'

/**
 * 发送互斥的判定窗口（带时间戳的旗标）。
 *
 * 2026-11-01 真机：一条会话里点发送**完全没反应** —— 输入框里的字不动、也不发请求。
 * 根因是这个互斥旗标是布尔值：只要有一次 `session.prompt` 挂住不返回（隧道抖动、
 * 请求被拦），`finally` 就永远跑不到，旗标永远是 true，之后所有发送都被静默吞掉。
 */
export const SEND_IN_FLIGHT_TIMEOUT_MS = 30_000

/** Wrap a plain-text prompt (quote preamble / offline entry / regenerate) into parts. */
export function textParts(text: string): PromptPart[] {
  return [{ type: 'text', text }]
}

/**
 * 送达核实（send 的失败分支用）：查两条独立证据 —— ① 宿主队列里有这个 requestId；
 * ② 日志尾部已出现这条用户消息。任一成立就算送到，都查不到才叫真失败。
 */
export async function verifyDelivered(sessionId: string, text: string, requestId: string): Promise<boolean> {
  const needle = text.trim()
  if (needle === '') return false
  const same = (candidate: string): boolean => {
    const other = candidate.trim()
    if (other === '') return false
    if (other === needle) return true
    const head = needle.slice(0, 40)
    return other.includes(head) || needle.includes(other.slice(0, 40))
  }
  try {
    const value = await inboxOf(sessionId, { fresh: true })
    const queue = (value as unknown as { inbox?: { nextTurn?: readonly { text?: string; requestId?: string }[]; nextStep?: readonly { text?: string; requestId?: string }[] } }).inbox
    const items = [...(queue?.nextTurn ?? []), ...(queue?.nextStep ?? [])]
    // 队列这一层**只认 requestId**：按文本匹配会把"本地乐观项"算成证据（它就是同一条文本），
    // 于是真失败也会被误判成送达。requestId 是提交身份，宿主侧只有真收下才会有。
    for (const item of items) {
      if (item.requestId !== undefined && item.requestId === requestId) return true
    }
  } catch {
    // 队列读不到就退到正文证据。
  }
  try {
    const page = await logTail(sessionId, 60)
    return page.rows.some(row => row.kind === 'user' && same(String(row.text ?? '')))
  } catch {
    return false
  }
}

export interface UseChatComposerOptions {
  sessionId: string
  mux?: MuxClient | undefined
  offline: boolean
  running: boolean
  runningRef: { current: boolean }
  input: string
  setInput: Dispatch<SetStateAction<string>>
  attachImages: AttachedImage[]
  setAttachImages: Dispatch<SetStateAction<AttachedImage[]>>
  attachFiles: StagedFile[]
  setAttachFiles: Dispatch<SetStateAction<StagedFile[]>>
  uploadingFiles: number
  quoted: string | undefined
  setQuoted: Dispatch<SetStateAction<string | undefined>>
  claimedCommand: string | undefined
  setClaimedCommand: Dispatch<SetStateAction<string | undefined>>
  sending: boolean
  setSending: Dispatch<SetStateAction<boolean>>
  commands: CommandDescriptor[] | undefined
  shadowEvent: (event: StatusEvent) => void
  refreshInbox: (options?: { fresh?: boolean }) => void
  refreshGoal: () => void
  runCommand: (line: string) => Promise<void>
  removeDraft: (sessionId: string) => void
  setError: Dispatch<SetStateAction<string | undefined>>
  mountedRef: { current: boolean }
  refreshOutbox: () => void
  focusComposer: () => void
  clearEditMessage: () => void
}

/** 作曲区的对外句柄（ChatView 只消费这一个对象）。 */
export interface ChatComposer {
  send: (intent?: SendIntent) => void
  sendEditedMessage: (messageId: string, newText: string) => void
  claimCommand: (name: string, argument?: string) => void
  releaseCommand: () => void
  /** 连接恢复后补发离线队列；丢弃一条离线条目（横幅上的 ×）。 */
  flushQueue: () => void
  removeQueuedEntry: (id: string) => void
  draftEmpty: boolean
  primaryStops: boolean
}

export function useChatComposer(options: UseChatComposerOptions): ChatComposer {
  const {
    sessionId,
    mux,
    offline,
    running,
    runningRef,
    input,
    setInput,
    attachImages,
    setAttachImages,
    attachFiles,
    setAttachFiles,
    uploadingFiles,
    quoted,
    setQuoted,
    claimedCommand,
    setClaimedCommand,
    sending,
    setSending,
    commands,
    shadowEvent,
    refreshInbox,
    refreshGoal,
    runCommand,
    removeDraft,
    setError,
    mountedRef,
    refreshOutbox,
    focusComposer,
    clearEditMessage,
  } = options

  const sendInFlightRef = useRef(0)
  const lastSubmitRef = useRef<{ text: string; at: number }>({ text: '', at: 0 })

  /**
   * 认领一条命令：把命令词变成蓝色 chip，输入框只留参数。
   * @param name 命令名（菜单里那一项，不带斜杠）。
   * @param argument 已经在输入框里的参数文本（手动输入 `/goal x` 时把 x 留下）。
   */
  const claimCommand = useCallback((name: string, argument = ''): void => {
    if (name.trim() === '') return
    setClaimedCommand(name.trim())
    setInput(argument)
    // 手机上光标必须落在参数区，否则用户会以为还要再点一下输入框。
    requestAnimationFrame(() => { focusComposer() })
  }, [setClaimedCommand, setInput])

  /**
   * 撤掉 chip = 取消这条命令：chip 和参数一起清掉，回到普通输入状态。
   *
   * 这里曾经把命令词拼回输入框（想"不丢用户敲的字"），结果点了 × 框里反而冒出一行
   * `/goal`，看着像没生效——参数本来就只对这条命令有意义，取消命令就该一起撤销。
   */
  const releaseCommand = useCallback((): void => {
    if (claimedCommand === undefined) return
    setClaimedCommand(undefined)
    setInput('')
    removeDraft(sessionId)
    requestAnimationFrame(() => { focusComposer() })
  }, [claimedCommand, setClaimedCommand, setInput, sessionId, removeDraft])

  /**
   * 目录晚到的补认领：用户先敲了 `/goal 目标`，命令目录那一刻还没拉回来，于是那一
   * 次 onChange 认领不了。目录一到位就把命令词收成 chip，参数留在输入框。
   */
  useEffect(() => {
    if (claimedCommand !== undefined || commands === undefined) return
    const typed = /^\/([A-Za-z][\w-]*)[ \u00a0]+([\s\S]*)$/.exec(input)
    if (typed === null) return
    if (commands.some(command => command.name === typed[1])) claimCommand(typed[1] ?? '', typed[2] ?? '')
  }, [commands, input, claimedCommand, claimCommand])

  /** Send the drafted prompt (the echoed user/message arrives over mux).
   * Offline: queue in IndexedDB instead — the reconnect effect drains it.
   * @param intent - queue (default) / steer into the running turn / interrupt-then-queue. */
  const send = useCallback((intent: SendIntent = 'queue') => {
    const text = input.trim()
    if ((text === '' && attachImages.length === 0 && attachFiles.length === 0) || sending) return
    // 同步互斥：`sending` 是 state，同一帧里连点两下时它还没更新，两次都会走到发请求
    // —— 宿主照单全收，排队条上就是两条一模一样的消息（真机截图）。ref 在同一 tick 内
    // 立刻生效。
    const inFlightAt = sendInFlightRef.current
    if (inFlightAt !== 0 && Date.now() - inFlightAt < SEND_IN_FLIGHT_TIMEOUT_MS) return
    // 同一条正文在 1.5 秒内重复提交：用户在等界面反馈，又点了一次。视为同一次意图。
    const stamp = `${sessionId}\u0000${text}`
    if (text !== '' && lastSubmitRef.current.text === stamp && Date.now() - lastSubmitRef.current.at < 1_500) return
    lastSubmitRef.current = { text: stamp, at: Date.now() }
    // 附件还在上传：这一刻发出去会少一个文件，用户却以为发全了。
    if (uploadingFiles > 0) {
      toast('附件还在上传，稍等一下')
      return
    }
    // 失败的那条挡发送：带着它发出去等于用户以为发全了、实际少一个文件。
    if (attachFiles.some(item => item.status === 'failed')) {
      toast('有附件上传失败，点一下那条重试或移除')
      return
    }
    // 点下发送这一刻回合是否在跑：**必须在发请求前定格**。宿主接单后立刻开出新回合，
    // turn/start 帧往往比这 promise 的 resolve 先到，回调里再读 running 就永远是 true
    // —— 明明没人跑，也会弹"已排队"。
    // steer 不进队列（插进正在跑的回合），所以它不参与"排队"语义。
    const queuedByRunning = intent !== 'steer' && runningRef.current
    // Offline: images can't queue (too big for the outbox), text can.
    if (offline) {
      if (text === '') {
        toast('离线状态暂不支持发送图片')
        return
      }
      if (text.startsWith('/')) {
        toast('离线状态暂不支持执行命令')
        return
      }
      if (attachImages.length > 0) {
        toast('图片需联网发送，本次仅保存文本')
      }
      const body = quoted !== undefined ? `引用消息：\n> ${quoted.replace(/\n+/g, ' ')}\n\n${text}` : text
      // 包一层 Promise.resolve：写 IndexedDB 在某些老 WebView 上会同步抛/返回非
      // promise，直接 `.then` 会把整个发送按钮打断。
      void Promise.resolve()
        .then(() => enqueuePrompt({ id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, sessionId, text: body, queuedAt: Date.now() }))
        .then(() => {
          setInput('')
          removeDraft(sessionId)
          setQuoted(undefined)
          setAttachImages([])
          toast('已离线保存，恢复网络后自动发送')
          refreshOutbox()
        })
      return
    }
    // A bare slash-line is a command, not a prompt: run it through the host
    // registry (session.prompt would deliver it to the model verbatim).
    // Quotes and image attachments compose a prompt, so they keep prompt
    // semantics even when the text starts with '/'.
    // 认领的命令（蓝色 chip）在发送这一刻拼回完整命令行：chip 只是展示，线上仍是
    // `/goal 目标内容` 这一行。
    const commandLine = claimedCommand === undefined
      ? (text.startsWith('/') ? text : undefined)
      : `/${claimedCommand}${text === '' ? '' : ` ${text}`}`
    if (commandLine !== undefined && quoted === undefined && attachImages.length === 0 && attachFiles.length === 0) {
      setSending(true)
      void runCommand(commandLine).then(
        () => {
          setSending(false)
          setInput('')
          setClaimedCommand(undefined)
          removeDraft(sessionId)
          // 命令不产生回合、也不进队列：`/goal …` 建完目标后必须立刻问一次，否则手机上的
          // 目标条要等到下一次轮询才出现（真机：宿主回 Goal created，条子没出来）。
          refreshGoal()
        },
        () => { setSending(false) },
      )
      return
    }
    setSending(true)
    // A quoted draft composes the citation banner INTO the text part and
    // still carries the attached images (buildPromptParts appends them).
    // 只有 ready 的附件有收据；失败的那条留在 chip 上等用户处理。
    const readyFiles = attachFiles.flatMap(item => item.status === 'ready' && item.receiptId !== undefined
      ? [{ receiptId: item.receiptId }]
      : [])
    const body: PromptPart[] = quoted !== undefined && text !== ''
      ? buildPromptParts(`引用消息：\n> ${quoted.replace(/\n+/g, ' ')}\n\n${text}`, attachImages, readyFiles)
      : buildPromptParts(input, attachImages, readyFiles)
    // 回合进行中发的消息会成为"排队"：先本地画一条（状态仓的乐观项），不等宿主快照。
    // 以前这里只有一次 `refreshInbox({fresh:true})`，宿主要现开一帧 follow 再回包，
    // 弱网下就是"点了发送，排队条半天不出来"。
    const queueText = body.find(part => part.type === 'text')?.text ?? ''
    // 这次投递的幂等键：宿主按它去重（同 id 只入队一次），插件侧身份桥把它标回
    // 队列行 —— 于是乐观项可以「按身份」退场，不再靠正文猜。
    const sendRequestId = newRequestId()
    const optimisticId = queuedByRunning && queueText !== ''
      ? addOptimisticQueueItem(sessionId, { text: queueText, placement: 'queued', requestId: sendRequestId })
      : undefined
    sendInFlightRef.current = Date.now()
    // `interrupt` 是客户端组合：先取消当前轮（尽力而为），再按 queue 投递。
    // 取消失败也不拦发送 —— 消息仍会排队到下一轮，那是安全的方向。
    const beforeSend = intent === 'interrupt'
      ? cancelSession(sessionId).catch(() => undefined)
      : Promise.resolve()
    void beforeSend
      .then(() => prompt(sessionId, body, sendRequestId, intent === 'steer' ? 'steer' : 'queue'))
      .then(
      () => {
        sendInFlightRef.current = 0
        setSending(false)
        setInput('')
        removeDraft(sessionId)
        setAttachImages([])
        setAttachFiles([])
        setQuoted(undefined)
        // 回合进行中发出去的消息是**排队**（session.prompt 的 mode=queue），本轮结束后
        // 宿主自己接着发：不告诉用户，他会以为消息丢了。判据用发请求前的那一刻。
        // steer 是插进当前回合，不排队也不留底稿；interrupt 走 queue，因此仍需留底稿。
        if (intent === 'steer') {
          toast('已插入当前回合')
        } else if (queuedByRunning) {
      toast(intent === 'interrupt' ? '已停止本轮，消息排队中' : '已排队，本轮结束后自动发送')
      // 队列只活在宿主内存里：宿主一重启，这条就无声消失。本地留一份原文，
      // 等排队卡片对不上号时再交还给用户（见下面的对账 effect）。
      // 底稿必须和宿主 inbox 里那行逐字一致（引用消息是拼进去的），
      // 否则对账时会被误判成丢失。
      const queuedEchoText = body.find(part => part.type === 'text')?.text ?? ''
      if (queuedEchoText !== '') {
        rememberQueuedEcho({ sessionId, text: queuedEchoText, at: Date.now() })
      }
    }
        // 排队卡片立刻跟上，不用等轮询。
        //
        // 这里**不能**把乐观项撤掉：宿主回执只说明「收下了」，而它读的队列投影
        // 可能是几分钟前的快照 —— 撤早了界面上就是一片空白（真机：点了发送，
        // 排队条不出现）。乐观项交给 session-store 按「文本对上真条目 / 45 秒超时」退场。
        // 刚发出去当然算「有输出」：把活动时间推到现在。
        // 否则状态条会拿上一轮的旧行时间戳当证据，闪一下「已 N 秒没有新输出」。
        shadowEvent({
          type: 'turn',
          at: Date.now(),
          source: 'local',
          running: true,
          lastActivityAt: Date.now(),
        })
        refreshInbox({ fresh: true })
        // `/goal …` 这类命令不产生回合，running 不会变，光等轮询的话新建的目标要等
        // 十几秒才冒出条子（真机：目标建好了、条子没出现）。发完就问一次。
        refreshGoal()
        // Fresh activity just started: drop the poll backoff so the mux
        // fallback picks the reply up immediately, not after the stall window.
        mux?.poke()
      },
      (reason: unknown) => {
        // The draft is deliberately NOT cleared on failure (only the success
        // path wipes it), so the user's text/images survive to be retried —
        // retry is just pressing send again. Surface the real reason (and the
        // stale-host hint when the host may still run an old allowlist) so a
        // failed send never looks silent.
        setSending(false)
        // 互斥也要放开，否则一次失败会把发送按钮永久挡住。
        sendInFlightRef.current = 0
        // 没送出去：本地那条乐观排队项必须撤掉，否则会留一张永远不会发出去的卡。
        if (optimisticId !== undefined) dropOptimisticQueueItem(sessionId, optimisticId)
        const message = errorText(reason)
        const hint = staleHostHint(message)
        const failText = hint !== undefined ? `${message} ${hint}` : message
        // 先核实再报错：超时/断流并不等于"没送到"。
        //
        // 真机（2026-10-31）：消息明明已经排队并在跑，界面却弹"发送失败"并把原文退回
        // 输入框 —— 因为 `session.prompt` 的等待超时了（长回合里宿主很慢），而宿主其实
        // 早就收下了。这里在报错前查一次证据：队列里有我们这个 requestId，或正文尾部
        // 已经出现这条用户消息 —— 任一成立就按成功收尾，绝不谎报失败。
        void verifyDelivered(sessionId, queueText, sendRequestId).then((delivered) => {
          if (!mountedRef.current) return
          if (!delivered) {
            setError(failText)
            toast(hint !== undefined ? '发送失败，请重启 dsh web 后再试' : `发送失败：${message}`)
            return
          }
          // 已经送到：按成功收尾（输入框/附件清空），不弹失败提示。
          if (optimisticId !== undefined) dropOptimisticQueueItem(sessionId, optimisticId)
          setInput('')
          removeDraft(sessionId)
          setAttachImages([])
          setAttachFiles([])
          setQuoted(undefined)
          if (intent === 'steer') toast('已插入当前回合')
          else if (queuedByRunning) toast(intent === 'interrupt' ? '已停止本轮，消息排队中' : '已排队，本轮结束后自动发送')
          refreshInbox({ fresh: true })
          mux?.poke()
        }).catch(() => {
          if (!mountedRef.current) return
          setError(failText)
          toast(hint !== undefined ? '发送失败，请重启 dsh web 后再试' : `发送失败：${message}`)
        })
      },
    )
  }, [input, attachImages, attachFiles, uploadingFiles, sending, sessionId, mux, quoted, runCommand, refreshInbox, refreshGoal, claimedCommand])

  /** Resend an edited user message as a fresh prompt. The agent session is
   *  append-only, so the edited text goes out as a new user message (with a
   *  small note that the user revised the earlier question, so the model
   *  re-answers against the corrected intent instead of repeating the old). */
  const sendEditedMessage = useCallback((messageId: string, newText: string): void => {
    clearEditMessage()
    void prompt(sessionId, textParts(`用户修改了之前的提问，请忽略旧提问的回复，按修改后的内容重新回答：\n\n${newText}`)).then(
      () => { mux?.poke() },
      () => { toast('重新发送失败，请重试') },
    )
  }, [sessionId, mux, clearEditMessage])

  /** Drop one queued prompt (the banner's per-entry remove button). */
  const removeQueuedEntry = useCallback((id: string): void => {
    void removeFromOutbox(id).then(() => { refreshOutbox() })
  }, [refreshOutbox])

  /** Deliver the queued prompts once the connection is back. */
  const flushQueue = useCallback((): void => {
    void flushOutbox(entry => prompt(entry.sessionId, textParts(entry.text))).then(
      ({ sent, failed }) => {
        if (sent > 0) toast(failed > 0 ? `已同步 ${sent} 条，${failed} 条待重试` : `已同步 ${sent} 条消息`)
        refreshOutbox()
        if (sent > 0) mux?.poke()
      },
    )
  }, [mux, refreshOutbox])

  const draftEmpty = input.trim() === '' && attachImages.length === 0 && attachFiles.length === 0 && claimedCommand === undefined
  const primaryStops = running && draftEmpty

  return { send, sendEditedMessage, claimCommand, releaseCommand, flushQueue, removeQueuedEntry, draftEmpty, primaryStops }
}
