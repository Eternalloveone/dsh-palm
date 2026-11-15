/**
 * 发送 / 队列 / 插话状态机（S8a 从 `ChatView` 搬出）：三种发送模式（普通 queue /
 * 排队 / 插话 steer）、离线入队与补发、命令 chip。
 *
 * **纯搬运**：判定顺序、真机结论注释逐字保留。输入框/附件/命令的当前值与 setter 由
 * 调用方传入（它们同时被作曲区 UI 消费），本 hook 只持有真正属于自己的状态。
 */
import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { MuxClient } from '../../../stream/mux.ts'
import type { CommandDescriptor } from '../../../api.ts'
import { logTail } from '../../../data/diag.ts'
import { cancelSession, deliveryAccepted, inboxOf, newRequestId, prompt } from '../../../data/session.ts'
import { addOptimisticInsert, applyQueueAck, dropOptimisticInsert } from '../../../stream/session-store.ts'
import { createSubmitLedger, SUBMIT_INFLIGHT_MS, type SubmitLedger, type SubmitVerdict } from '../../../kernels/intent.ts'
import { enqueuePrompt, flushOutbox } from '../../../platform/offline.ts'
import { buildPromptParts, type AttachedImage, type PromptPart } from '../../../platform/image.ts'
import type { StagedFile } from './use-chat-attachments.ts'
import { errorText, isConclusiveRejection, staleHostHint } from '../../../shared/error-text.ts'
import { rememberQueuedEcho } from '../../../session/queued-echo.ts'
import { toast } from '../../../components/toast.tsx'
import type { StatusEvent } from '../../../stream/session-status.ts'

/** 发送意图：排队（默认）/ 插进当前回合 / 先停再排队。 */
export type SendIntent = 'queue' | 'steer' | 'interrupt'

/**
 * 发送互斥的判定窗口（带时间戳的旗标）。
 *
 * 2026-11-01 真机：一条会话里点发送**完全没反应** —— 输入框里的字不动、也不发请求。
 * 根因是这个互斥旗标是布尔值：只要有一次 `session.prompt` 挂住不返回（隧道抖动、
 * 请求被拦），`finally` 就永远跑不到，旗标永远是 true，之后所有发送都被静默吞掉。
 */
export const SEND_IN_FLIGHT_TIMEOUT_MS = SUBMIT_INFLIGHT_MS

/** Wrap a plain-text prompt (quote preamble / offline entry / regenerate) into parts. */
export function textParts(text: string): PromptPart[] {
  return [{ type: 'text', text }]
}

/** 送达核实的三种结论：确认送到 / 确认没到 / 查不到（网络也在抖，不敢下结论）。 */
export type DeliveryCheck = 'delivered' | 'absent' | 'unknown'

/** 核实重试的间隔（毫秒）：总共 ~8 秒，足够跨过一次隧道抖动或宿主排队写入延迟。 */
export const VERIFY_DELIVERY_BACKOFF_MS: readonly number[] = [0, 600, 1_200, 2_400, 4_000]

/**
 * 提交闸门拒掉时给用户的一句话（真机：静默 return 等于"点了没反应"）。
 *
 * 两种拒绝都**不是失败**，只是"别再发一次"：in-flight = 上一条还在等回执，
 * duplicate = 同一段正文 1.5 秒内又点了一下。所以只提示，不报错、不撤草稿。
 *
 * @param verdict - 闸门结论（不会传 `accept`）
 * @returns 一句提示文案
 */
export function sendGateHint(verdict: SubmitVerdict): string {
  return verdict === 'duplicate' ? '刚刚已经发出去了，稍等' : '上一条还在发送中…'
}

/** 核实的依赖注入（测试用；生产走真实的 mobile.inbox / 读页）。 */
export interface DeliveryProbe {
  inbox?: typeof inboxOf
  tail?: typeof logTail
  sleep?: (ms: number) => Promise<void>
  /** 问宿主"这笔受理过没有"（测试注入）。 */
  accepted?: (sessionId: string, requestId: string) => Promise<boolean>
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * 单次查队列里有没有这个 requestId。
 *
 * 队列这一层**只认 requestId**：按文本匹配会把"本地乐观项"算成证据（它就是同一条文本），
 * 于是真失败也会被误判成送达。requestId 是提交身份，宿主侧只有真收下才会有。
 *
 * @param sessionId - 会话
 * @param requestId - 提交身份
 * @param inbox - 队列读取（测试注入）
 * @returns `yes` 在队列里 / `no` 读到了但没有 / `error` 这次没读到
 */
export async function probeQueueForRequest(
  sessionId: string,
  requestId: string,
  inbox: typeof inboxOf = inboxOf,
  /**
   * 这次投递的正文：身份对不上时的**唯一**旁证。
   *
   * 2026-11-11 真机：「经常发送失败，内容又回到输入框」。宿主队列行不回显我们的
   * `requestId`，只能靠插件侧的投递前后差集去补；那条桥一旦没接上（写队列比读队列慢
   * 一拍就补不上），核实就永远是"没有"，8 秒后判成失败 —— 而消息其实已经在队列里。
   * 这里补一层正文比对：读的是**宿主的队列**（不含本地乐观项），同文同行就是送到了。
   */
  text?: string,
): Promise<'yes' | 'no' | 'error'> {
  try {
    const value = await inbox(sessionId, { fresh: true })
    const queue = (value as unknown as {
      inbox?: {
        nextTurn?: readonly { requestId?: string; text?: string }[]
        nextStep?: readonly { requestId?: string; text?: string }[]
      }
    }).inbox
    const items = [...(queue?.nextTurn ?? []), ...(queue?.nextStep ?? [])]
    if (items.some(item => item.requestId !== undefined && item.requestId === requestId)) return 'yes'
    const needle = (text ?? '').replace(/\s+/g, ' ').trim()
    if (needle === '') return 'no'
    return items.some(item => (item.text ?? '').replace(/\s+/g, ' ').trim() === needle) ? 'yes' : 'no'
  } catch {
    return 'error'
  }
}

/**
 * 送达核实（send 的失败分支用）：队列里有这个 requestId，或正文尾部已出现这条消息。
 *
 * 2026-11-11 用户：「提示排队发送失败、内容退回输入框，但其实已经排队成功了」。上一版只查
 * **一次**：宿主写队列比客户端超时慢一拍、或核实请求自己也在抖，就误报失败。现在按
 * `VERIFY_DELIVERY_BACKOFF_MS` 重试到 ~8 秒，并且**查不到 ≠ 没送到** → 返回 `unknown`。
 *
 * @param sessionId - 会话
 * @param text - 正文（尾部证据比对用）
 * @param requestId - 这次投递的客户端身份
 * @param probe - 可注入的探针（测试用）
 * @returns delivered / absent / unknown
 */
export async function verifyDelivered(
  sessionId: string,
  text: string,
  requestId: string,
  probe: DeliveryProbe = {},
): Promise<DeliveryCheck> {
  const readInbox = probe.inbox ?? inboxOf
  const readTail = probe.tail ?? logTail
  const sleep = probe.sleep ?? defaultSleep
  const needle = text.trim()
  /**
   * 正文比对前先归一化空白：宿主回显的正文可能被折过行/合并过空格，
   * 逐字比较会因为一个 `\n` 变成 ` ` 就判"不一样"。
   */
  const flatten = (candidate: string): string => candidate.replace(/\s+/g, ' ').trim()
  const same = (candidate: string): boolean => {
    const other = flatten(candidate)
    const target = flatten(needle)
    if (other === '' || target === '') return false
    if (other === target) return true
    const head = target.slice(0, 40)
    return other.includes(head) || target.includes(other.slice(0, 40))
  }
  let readOk = 0
  /*
   * **先问账本**（2026-11-12）：宿主在 `session.prompt` 成功返回时记了一笔，
   * 这里问到就直接 delivered —— 这是全流程唯一一条不是推断的证据，
   * 不用再去读队列、也不用赌 60 行的窗口。
   * 没有记录（宿主重启 / 真没送到）就照旧往下走，最终仍然只会返回 unknown。
   */
  const readAccepted = probe.accepted ?? deliveryAccepted
  try {
    if (await readAccepted(sessionId, requestId)) return 'delivered'
  } catch {
    // 账本都读不到：继续用旧判据，别因此下结论。
  }
  for (const delay of VERIFY_DELIVERY_BACKOFF_MS) {
    if (delay > 0) await sleep(delay)
    const verdict = await probeQueueForRequest(sessionId, requestId, readInbox, needle)
    if (verdict === 'yes') return 'delivered'
    if (verdict === 'no') readOk += 1
  }
  try {
    const page = await readTail(sessionId, 60)
    readOk += 1
    if (page.rows.some(row => row.kind === 'user' && same(String(row.text ?? '')))) return 'delivered'
    /*
     * **关键判据**（2026-11-12 用户：「已经发送完了，排队消息还会撤回到发送框」）。
     *
     * 上面那页是"最近 60 行"，不是"全部历史"。`hasMore` 为真就说明更早的行没读 ——
     * 那时"没找到这条消息"只意味着**它不在最近 60 行里**，完全可能已经发出去、
     * 又被本轮后续的工具调用/子代理输出顶出了窗口。
     * 原来这里把"没找到"直接当成"没送到"（`absent`），于是繁忙回合里必误判：
     * 消息早就送达，25 秒后的核实却判失败，正文被放回输入框 —— 用户看到的"回撤"。
     *
     * 现在只有**读完整个历史**仍然没有，才算确定的"没送到"；有没读到的部分，
     * 手里就是没有反证，返回 `unknown`（调用方不会回撤）。
     */
    if (page.hasMore === true) return 'unknown'
  } catch {
    // 正文也读不到：仍然可能送到了。
  }
  // 一次都没读成功 = 手里没有证据，不是"没送到"。
  return readOk === 0 ? 'unknown' : 'absent'
}

export interface UseChatComposerOptions {
  sessionId: string
  mux?: MuxClient | undefined
  offline: boolean
  runningRef: { current: boolean }
  /**
   * 草稿**取值器**而不是字符串：`ChatView` 已经不再订阅草稿（打字时不重渲染），
   * 传字符串的话 `send` 永远只能看到挂载那一刻的内容。
   */
  getInput: () => string
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
  /** 发送是否在途：**读实时的 store**（闭包里的旧值会漏掉"同一帧连点两下"）。 */
  getSending: () => boolean
  /** 发送在途开关（W3-2 起由 Chat Store 持有，故只收普通函数形态）。 */
  setSending: (sending: boolean) => void
  commands: CommandDescriptor[] | undefined
  shadowEvent: (event: StatusEvent) => void
  refreshInbox: (options?: { fresh?: boolean }) => void
  refreshGoal: () => void
  runCommand: (line: string) => Promise<void>
  removeDraft: (sessionId: string) => void
  /**
   * 显示一条瞬时错误（undefined 表示清除）。
   *
   * 收窄成普通函数而不是 `Dispatch<SetStateAction>`：这里从来只用字符串形态，
   * 留着 updater 形态会让"错误文案存在 Chat Store（W3-2）"这件事无法直接对接。
   */
  setError: (message: string | undefined) => void
  mountedRef: { current: boolean }
  focusComposer: () => void
  clearEditMessage: () => void
  /**
   * 「点下去就看得见」的幽灵用户行（2026-11-14）。
   *
   * 传 `undefined` = 撤掉。约定：
   * - 点发送、意图闸门通过之后立刻报一次（正文非空才报，纯附件沿用旧行为）；
   * - **送出成功不解**：宿主 `user/message` 帧落地后由 ChatView 认领（同文比对）或 8 秒
   *   兜底撤掉 —— 否则弱网下"点了一下、屏幕什么都没有"（真机反复反馈）。
   * - 明确失败（拒收 / 核实 absent）要立刻报 `undefined`，别留一条假的用户消息。
   */
  onOutgoing?: (flight: { id: string; text: string; at: number; acceptedAt?: number } | undefined) => void
}

/** 作曲区的对外句柄（ChatView 只消费这一个对象）。 */
export interface ChatComposer {
  send: (intent?: SendIntent) => void
  sendEditedMessage: (messageId: string, newText: string) => void
  claimCommand: (name: string, argument?: string) => void
  releaseCommand: () => void
  /** 连接恢复后补发离线队列。 */
  flushQueue: () => void
}

export function useChatComposer(options: UseChatComposerOptions): ChatComposer {
  const {
    sessionId,
    mux,
    offline,
    runningRef,
    getInput,
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
    getSending,
    setSending,
    commands,
    shadowEvent,
    refreshInbox,
    refreshGoal,
    runCommand,
    removeDraft,
    setError,
    mountedRef,
    focusComposer,
    clearEditMessage,
    onOutgoing,
  } = options

  // 提交闸门（W3-6）：在途窗口 + 同正文去重由 Intent 内核记账，这里只持有实例。
  const gate = useRef<SubmitLedger | undefined>(undefined)
  const ledger = (): SubmitLedger => {
    if (gate.current === undefined) gate.current = createSubmitLedger()
    return gate.current
  }

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
    const typed = /^\/([A-Za-z][\w-]*)[ \u00a0]+([\s\S]*)$/.exec(getInput())
    if (typed === null) return
    if (commands.some(command => command.name === typed[1])) claimCommand(typed[1] ?? '', typed[2] ?? '')
  }, [commands, claimedCommand, claimCommand, getInput])

  /** Send the drafted prompt (the echoed user/message arrives over mux).
   * Offline: queue in IndexedDB instead — the reconnect effect drains it.
   * @param intent - queue (default) / steer into the running turn / interrupt-then-queue. */
  const send = useCallback((intent: SendIntent = 'queue') => {
    const text = getInput().trim()
    if ((text === '' && attachImages.length === 0 && attachFiles.length === 0) || getSending()) return
    // 同步互斥（Intent 内核，W3-6）放在**真正要发**那一刻，而不是函数开头：
    // 前面几道闸（附件还在上传 / 有附件失败 / 离线只能存文本）都会 return，
    // 若在那里就记账，一次被拦下的提交会把发送锁死 30 秒。
    // 记账点之前全是同步代码，所以"同一帧连点两下"照样只放行一条。
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
      : buildPromptParts(getInput(), attachImages, readyFiles)
    // 回合进行中发的消息会成为"排队"：**不再本地画乐观项**（C1b，2026-11-10）。
    // 发送 RPC 的应答已经带着宿主的权威队列（方案 A：读己之写），拿到就是定论；
    // 乐观项只会多出一条要跟权威结果对齐的假行。
    const queueText = body.find(part => part.type === 'text')?.text ?? ''
    // 到了要发的那一刻才记账（Intent 内核，W3-6）：在途窗口 + 同会话同正文去重
    // 两道判据都在内核里；被拒的尝试也**不会**刷新窗口。
    const verdict = ledger().attempt(sessionId, queueText || text)
    if (verdict !== 'accept') {
      // 静默 return 是这一层最差的反馈：用户只看到"点了、没反应"（真机）。
      toast(sendGateHint(verdict))
      return
    }
    const sendRequestId = newRequestId()
    // 幽灵用户行：点下去立刻在列表末尾画一条（不进 rows，也就不进账本/搜索）。
    const outgoingFlight = queueText === '' ? undefined : { id: sendRequestId, text: queueText, at: Date.now() }
    if (outgoingFlight !== undefined) onOutgoing?.(outgoingFlight)
    // 插话（steer）不排队，但它同样要「点下去就可见」：写进插入队列的乐观项，
    // 等宿主 user/message 回执或 steering 快照按 id/正文认领。以前这里只弹 toast，
    // 宿主投影慢时输入框上方会空好几秒（真机「已插入本轮」条时而有时而没有）。
    const optimisticInsertId = intent === 'steer' && queueText !== ''
      ? addOptimisticInsert(sessionId, queueText)
      : undefined
    // 闸门在 send() 开头就已经记账（attempt 通过才算到这里），这里不再重复记账。
    // `interrupt` 是客户端组合：先取消当前轮（尽力而为），再按 queue 投递。
    // 取消失败也不拦发送 —— 消息仍会排队到下一轮，那是安全的方向。
    const beforeSend = intent === 'interrupt'
      ? cancelSession(sessionId).catch(() => undefined)
      : Promise.resolve()
    void beforeSend
      .then(() => prompt(sessionId, body, sendRequestId, intent === 'steer' ? 'steer' : 'queue'))
      .then(
      (ack) => {
        // 方案 A：写操作的应答带权威队列（读己之写）—— 直接当定论，不再等投影。
        applyQueueAck(sessionId, ack)
        // 回执 = 宿主**已接单**的权威事实（与模型何时开始无关）。带上这个时刻，
        // 客户端才能在"已送达、还没有任何输出"的长窗口里给出确定的等待态。
        if (outgoingFlight !== undefined) {
          onOutgoing?.({ ...outgoingFlight, acceptedAt: Date.now() })
        }
        ledger().settle()
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
        ledger().settle()
        // 没送出去：本地那条乐观排队项必须撤掉，否则会留一张永远不会发出去的卡。
        const message = errorText(reason)
        const hint = staleHostHint(message)
        const failText = hint !== undefined ? `${message} ${hint}` : message
        // 先核实再报错：超时/断流并不等于"没送到"。
        // 先核实再报错：超时/断流并不等于"没送到"。
        //
        // 真机（2026-10-31）：消息明明已经排队并在跑，界面却弹"发送失败"并把原文退回输入框
        // —— 因为 `session.prompt` 的等待超时了（长回合里宿主很慢），而宿主其实早就收下了。
        //
        // 2026-11-11 用户又复现了一次，原因是核实只查**一次**：宿主写队列比客户端超时慢一拍，
        // 或核实请求自己也在抖，就误报失败。现在核实会重试到 ~8 秒，并区分三态：
        //   delivered → 按成功收尾；absent → 才报失败（撤乐观项、留草稿）；
        //   unknown   → 只说"正在确认"，不谎报失败，并在后台继续确认三次。
        // 宿主明确回 4xx = 拒收，没有"其实已经排上"的可能：直接报错，省掉 8 秒核实。
        if (isConclusiveRejection(message)) {
          if (optimisticInsertId !== undefined) dropOptimisticInsert(sessionId, optimisticInsertId)
          // 明确拒收：撤回幽灵行，别在列表末尾留一条永远不会被认领的假用户消息。
          onOutgoing?.(undefined)
          if (mountedRef.current) {
            setError(failText)
            toast(hint !== undefined ? '发送失败，请重启 dsh web 后再试' : `发送失败：${message}`)
          }
          return
        }
        void verifyDelivered(sessionId, queueText, sendRequestId).then((check) => {
          if (check === 'delivered') {
            if (!mountedRef.current) return
            // 已经送到：按成功收尾（输入框/附件清空），不弹失败提示。
            setInput('')
            removeDraft(sessionId)
            setAttachImages([])
            setAttachFiles([])
            setQuoted(undefined)
            if (intent === 'steer') toast('已插入当前回合')
            else if (queuedByRunning) toast(intent === 'interrupt' ? '已停止本轮，消息排队中' : '已排队，本轮结束后自动发送')
            refreshInbox({ fresh: true })
            mux?.poke()
            return
          }
          if (check === 'unknown') {
            // 核实请求本身也读不通（同一条隧道在抖）：**不下"没送到"的结论**。
            //
            // 2026-11-12 用户：「明明排队消息已经发送成功了，但还会回撤到发送框」。
            // 代码事实：这个分支以前**不清输入框**，只 toast「正在确认」，把清空交给后台
            // `confirmLater`；而 `confirmLater` 的判据是 `probeQueueForRequest === 'yes'`
            // ——只查**队列**。消息一旦真的发出去（本轮结束、队列被消费掉），队列里就再也
            // 没有它，三次探测全是 `no`，函数直接结束，输入框从头到尾没被清过 ——
            // 用户看到的就是「已经发出去了，发送框里还留着一份同样的文字」。
            //
            // 现在反过来：这一刻就先清空（正文已经进了 queuedEcho 底稿，不会丢），
            // 后台再确认；只有**明确 absent** 才把文字放回输入框 —— 那才是唯一该"回撤"的时刻。
            if (!mountedRef.current) return
            const echoText = body.find(part => part.type === 'text')?.text ?? ''
            if (echoText !== '') rememberQueuedEcho({ sessionId, text: echoText, at: Date.now() })
            setInput('')
            removeDraft(sessionId)
            setAttachImages([])
            setAttachFiles([])
            setQuoted(undefined)
            toast('消息已送出，正在确认…')
            refreshInbox({ fresh: true })
            mux?.poke()
            const confirmLater = async (): Promise<void> => {
              for (const delay of [5_000, 12_000, 25_000]) {
                await new Promise<void>((resolve) => { setTimeout(resolve, delay) })
                if (!mountedRef.current) return
                // 用完整核实（队列 requestId / 同文行 / 会话尾部 user 消息），
                // 而不是只看队列 —— 发出去的消息已经从队列里消失了。
                const again = await verifyDelivered(sessionId, queueText, sendRequestId)
                if (again === 'unknown') continue
                if (again === 'delivered') {
                  toast(queuedByRunning ? '已排队，本轮结束后自动发送' : '已送出')
                  refreshInbox({ fresh: true })
                  mux?.poke()
                  return
                }
                // 明确没送到：这时才把原文放回输入框（框里已有新内容就不覆盖）。
                if (getInput().trim() === '') setInput(queueText)
                toast('未送达，已放回输入框')
                return
              }
            }
            void confirmLater()
            return
          }
          if (optimisticInsertId !== undefined) dropOptimisticInsert(sessionId, optimisticInsertId)
          // 核实结论是"没送到"：幽灵行同样要撤（原文已经放回输入框了）。
          onOutgoing?.(undefined)
          if (!mountedRef.current) return
          setError(failText)
          toast(hint !== undefined ? '发送失败，请重启 dsh web 后再试' : `发送失败：${message}`)
        }).catch(() => {
          // 核实函数本身兜了所有异常，走到这里是意料之外：仍然按"不确定"处理，绝不谎报失败。
          if (!mountedRef.current) return
          toast('消息可能已送出，正在确认…')
          refreshInbox({ fresh: true })
          mux?.poke()
        })
      },
    )
    // `offline` 必须在依赖里：B3 之前它靠 `input` 每次按键变化顺带刷新闭包，
    // 拿掉 `input` 之后漏掉它，断网写的字会走联网分支（真机表现：点了发送没反应）。
  }, [getInput, offline, attachImages, attachFiles, uploadingFiles, getSending, sessionId, mux, quoted, runCommand, refreshInbox, refreshGoal, claimedCommand, onOutgoing])

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

  /** Deliver the queued prompts once the connection is back. */
  const flushQueue = useCallback((): void => {
    void flushOutbox(entry => prompt(entry.sessionId, textParts(entry.text))).then(
      ({ sent, failed }) => {
        if (sent > 0) toast(failed > 0 ? `已同步 ${sent} 条，${failed} 条待重试` : `已同步 ${sent} 条消息`)
        if (sent > 0) mux?.poke()
      },
    )
  }, [mux])

  return { send, sendEditedMessage, claimCommand, releaseCommand, flushQueue }
}
