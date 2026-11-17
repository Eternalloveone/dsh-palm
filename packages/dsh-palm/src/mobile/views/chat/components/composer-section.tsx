/**
 * 输入区（composer）：引用条、待发图片/附件 chip、输入框、三档发送与「怎么发送」面板。
 *
 * S6a 从 `ChatView` 搬出（纯展示 + 回调，内部只留长按计时与 sheet 开关这类局部状态）。
 * 为什么不把这些状态也一起搬走：草稿、附件、发送本身都是会话层的东西，
 * 组件只做「把用户的选择画出来、把动作打回去」，这样以后改样式不会牵动会话逻辑。
 */
import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type ReactNode, type SetStateAction } from 'react'
import type { CommandDescriptor } from '../../../api.ts'
import { imageFromClipboard } from '../../../platform/image.ts'
import type { AttachedImage } from '../../../platform/image.ts'
import { CloseIcon, MicIcon, PlusIcon, SendIcon } from '../../../components/icons.tsx'
import { Sheet } from '../../../ui/sheet.tsx'
import { longestIdlePlaceholder, pickIdlePlaceholder } from './composer-placeholder.ts'
import type { StagedFile } from '../hooks/use-chat-attachments.ts'
import { useDraftValue } from '../hooks/use-chat-draft.ts'
import { useChatSelector, type ChatSessionStore } from '../../../runtime/chat/use-chat-store.ts'
import { formatFileSize } from '../../../render/ui-text.ts'
import { truncate } from '../../../shared/text.ts'
import { Button } from '../../../ui/primitives.tsx'
import { useOverflowFade } from '../../../ui/overflow-fade.ts'

/** 输入框长高的上限（与 CSS 的 max-height: 168px 对齐，6 行整行高）。`r`n * 2026-11-12：4 行 → 6 行（用户：「写长一点就得翻」）。 */
const COMPOSER_MAX_H = 168

/** 单行高度：12 + 12 内边距 + 22 行高。 */
const COMPOSER_MIN_H = 46

/** 发送意图：排队（默认）／插进当前回合／先中断再排队。 */
export type SendIntent = 'queue' | 'steer' | 'interrupt'

/** 输入框所在的会话与其引用文本（正文从草稿 store 里自己订阅）。 */
export interface ComposerDraft {
  sessionId: string
  quoted: string | undefined
  setQuoted: Dispatch<SetStateAction<string | undefined>>
}

/** 已暂存、尚未发送的图片与文件。 */
export interface ComposerAttachments {
  attachImages: AttachedImage[]
  setAttachImages: Dispatch<SetStateAction<AttachedImage[]>>
  attachFiles: StagedFile[]
  setAttachFiles: Dispatch<SetStateAction<StagedFile[]>>
  retryStaged: (localId: string) => void
  addImage: (file: File) => void
}

/** 命令 chip 的认领与「+」面板的开合（斜杠/语音入口都收进了 + 面板）。 */
export interface ComposerCommands {
  commands: CommandDescriptor[] | undefined
  claimedCommand: string | undefined
  claimCommand: (name: string, argument?: string) => void
  releaseCommand: () => void
  setPlusOpen: Dispatch<SetStateAction<boolean>>
}

/** 当前回合的发送/停止状态与动作。 */
export interface ComposerTurn {
  running: boolean
  stopArmed: boolean
  setStopArmed: Dispatch<SetStateAction<boolean>>
  /** 发送/停止在途由本组件**自己订阅**：ChatView 不因它们重渲染整条列表。 */
  store: ChatSessionStore['store']
  stopTurn: () => void
  send: (intent?: SendIntent) => void
}

/** 输入框元素本身与回车行为。 */
export interface ComposerInputBox {
  composerRef: MutableRefObject<HTMLTextAreaElement | null>
  mobileEnterToSend: boolean
}

/**
 * 排队/插入槽位：输入行上方的 dock 固定区域。
 *
 * - `detail` 是常驻槽位的内容：排队卡（排队项 + 已插入本轮，头行自带计数）；
 * - `detail` 是常驻槽位的内容：插入条（已插入本轮，默认折叠摘要）+ 排队明细。
 *   两者都**不参与输入区的显隐判断**，插入条即使为空也保持挂载。
 */
export interface ComposerQueue {
  detail: ReactNode
}

/**
 * 输入区只接 6 个「一组一组」的 props（W2-4）。
 *
 * 原来 29 个扁平 props 全从 ChatView 一路传进来：加一个附件动作就要动 3 处，
 * 也让「输入区到底依赖哪些东西」看不出来。按语义分组后，每组都是一个可以单独
 * 造出来喂给测试的小对象；后续把组换成 context 时，调用点不用再改一遍。
 */
/**
 * 语音输入的状态与动作。
 *
 * 2026-11-12 从「+ 面板第四层 + 整屏模态」搬到输入行：麦克风常驻在输入框里，
 * 点一下就地变录音条（红点 + 波形 + 计时 + 停止），转写文字实时显示在输入行上方，
 * 说完直接进输入框可编辑。录音机/字幕机/转写仍在 `use-chat-voice` 里，这里只负责画。
 */
export interface ComposerVoice {
  /** 是否正在语音输入（录音或转写中）。 */
  open: boolean
  phase: 'recording' | 'transcribing'
  /** 实时字幕（还没出字时为空串）。 */
  partial: string
  /** 已录秒数。 */
  elapsed: number
  /** 状态文案：正常是「正在听…」，最后 10 秒会提醒快到时长上限。 */
  statusText: string
  /** 波形元素：响度直接写进它的 CSS 变量（每 85ms 一次，不触发整页重渲染）。 */
  waveRef: MutableRefObject<HTMLDivElement | null>
  start(): void
  finish(): void
  cancel(): void
}

export interface ComposerSectionProps {
  draft: ComposerDraft
  attachments: ComposerAttachments
  commands: ComposerCommands
  turn: ComposerTurn
  inputBox: ComposerInputBox
  queue: ComposerQueue
  voice: ComposerVoice
}

export function ComposerSection(props: ComposerSectionProps) {
  const { draft, attachments, turn, inputBox, queue, voice } = props
  const commandApi = props.commands
  const { sessionId: draftSessionId, quoted, setQuoted } = draft
  /**
   * 正文自己订阅：`ChatView` 已经不因打字重渲染（10× 降频实测 180 ms/字符），
   * 所以输入框不能再从上面接一个字符串 prop —— 那个值打完字之后就再没变过。
   */
  const { input, setInput } = useDraftValue(draftSessionId)
  const { attachImages, setAttachImages, attachFiles, setAttachFiles, retryStaged, addImage } = attachments
  const { commands, claimedCommand, claimCommand, releaseCommand, setPlusOpen } = commandApi
  const { composerRef, mobileEnterToSend } = inputBox
  const { running, stopArmed, setStopArmed, stopTurn, send } = turn
  const sending = useChatSelector(turn.store, (state) => state.sending)
  const stopping = useChatSelector(turn.store, (state) => state.stopping)
  /**
   * 主键判据在这里现算：它的输入（正文）来自草稿 store，`ChatView` 看不到变化，
   * 传下来的 `draftEmpty` 会永远停在"空"，打完字发送键一直是灰的。
   */
  const draftEmpty = input.trim() === '' && attachImages.length === 0 && attachFiles.length === 0 && claimedCommand === undefined
  const primaryStops = running && draftEmpty
  /** 「怎么发送」面板是否打开（长按发送键）。 */
  const [sendIntentOpen, setSendIntentOpen] = useState(false)
  const sendHoldTimerRef = useRef<number | undefined>(undefined)
  const sendHoldFiredRef = useRef(false)
  /** 输入框是否有焦点：目前只用于跟随键盘的快捷命令条（保留原行为）。 */
  const [, setComposerFocused] = useState(false)
  /** 附件横排的溢出提示（2026-11-10，390px 三件附件实拍：第二件被切掉一半且看不出能滑）。 */
  const fileFade = useOverflowFade<HTMLDivElement>()

  /**
   * 空闲态占位符：**进入会话时随机一次**，不随输入变化。
   *
   * 2026-11-12 用户：「都改成说点什么会不会单调，要不要上词池」。词池在
   * `composer-placeholder.ts`，规则沿用状态条那套（同族内换、基准句最保守），
   * 但收紧了两条：一是每条都必须短到一行（占位符参与量高，换行会让框跳），
   * 二是不在打字过程中换（正打着字文案变一遍，像自己输错了）。
   * 运行中不参与轮换，固定一条中性文案。
   */
  const idlePlaceholderRef = useRef<string | undefined>(undefined)
  if (idlePlaceholderRef.current === undefined) idlePlaceholderRef.current = pickIdlePlaceholder()
  /**
   * 已认领命令自己的参数提示（`CommandDescriptor.input.hint`）。
   *
   * 2026-11-12：占位符原来写死「输入命令参数，回车执行」，9 个字，配上 chip 挤窄的输入框
   * 会被压成竖排。改用命令自带的提示 —— 但**只在它短的时候用**：宿主的 hint 是给桌面端
   * 看的完整语法（`/goal` 那条是 `[<objective>|clear|edit <objective>|pause|resume]`，
   * 44 个字符），直接塞进手机占位符会顶满四行、把输入框撑到最高。
   */
  const rawHint = claimedCommand === undefined
    ? undefined
    : commands?.find(command => command.name === claimedCommand)?.input?.hint
  const claimedCommandHint = rawHint !== undefined && rawHint !== '' && rawHint.length <= 12
    ? rawHint
    : undefined
  const placeholder = claimedCommand !== undefined
    ? (claimedCommandHint ?? '输入参数')
    : running ? '说点什么...' : (idlePlaceholderRef.current ?? '说点什么...')
  /**
   * 量高度用的文本：空框时**一律按池里最长那条**来量。
   *
   * 这样不管这一轮随机到哪条短句，框高都一样 —— 换词不会让输入框抖。
   * 将来谁往池子里加更长的候选，也只是框高按最长那条定，不会出现"某句话一出现框就变高"。
   */
  const measurePlaceholder = claimedCommand !== undefined || running
    ? placeholder
    : longestIdlePlaceholder()

  /** 录音计时 mm:ss（voice.elapsed 是秒）。 */
  /** 录音中按 Esc 取消：内联录音没有遮罩可点，键盘用户得留一个出口。 */
  useEffect(() => {
    if (!voice.open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      voice.cancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [voice.open, voice.cancel])
  const voiceClock = `${String(Math.floor(voice.elapsed / 60)).padStart(2, '0')}:${String(voice.elapsed % 60).padStart(2, '0')}`

  // 输入框高度跟着内容长（最多 6 行，再多框内滚动）。
  //
  // 2026-11-10 三轮真机，这一块终于落到根上：
  // ① `field-sizing` 会按内容宽度排版再被框裁掉（每行掉半个字）—— 已弃用；
  // ② `scrollHeight` **不算 placeholder**：空框 + 长占位符时它只报一行，于是
  //    「说点什么…（会打断当前任务）」第二行被切掉（用户截图就是这个）；
  // ③ 输入框宽度会变（排队↔停止按钮宽度不同），宽度一变就要重新量。
  //
  // 所以：用**镜像元素**量高度（同宽、同字体、同内边距，文本 = 正文或占位符），
  // 再把结果夹在 [1 行, 6 行] 之间写给 textarea；宽度变化由 ResizeObserver 触发。
  const fitComposer = useCallback((scrollToCaret = false) => {
    const el = composerRef.current
    if (el === null) return
    const style = getComputedStyle(el)
    const text = el.value === '' ? measurePlaceholder : el.value
    // 末尾补一个空格：不然最后一行没有行盒，量出来的高度会少一行。
    const mirror = document.createElement('div')
    const ms = mirror.style
    ms.position = 'fixed'
    ms.insetBlockStart = '0'
    ms.insetInlineStart = '-9999px'
    ms.visibility = 'hidden'
    ms.pointerEvents = 'none'
    ms.boxSizing = 'border-box'
    ms.inlineSize = `${el.clientWidth}px`
    ms.font = style.font
    ms.lineHeight = style.lineHeight
    ms.paddingBlock = style.paddingBlock
    ms.paddingInline = style.paddingInline
    ms.whiteSpace = 'pre-wrap'
    ms.overflowWrap = 'anywhere'
    mirror.textContent = `${text} `
    document.body.append(mirror)
    const measured = mirror.getBoundingClientRect().height
    mirror.remove()
    if (!Number.isFinite(measured) || measured <= 0) return
    const height = Math.min(Math.max(Math.round(measured), COMPOSER_MIN_H), COMPOSER_MAX_H)
    el.style.height = `${height}px`
    // 保底：镜像量出来的高度如果比真实内容还矮一点点（亚像素、字体晚到、系统字体缩放），
    // 框里就会冒出一条滚动条、最后一行被啃掉一半 —— 2026-11-12 用户点语音按钮后看到的就是这个。
    // 这一句用 textarea 自己的 scrollHeight（含 padding）兜一次，没超出就不动。
    if (el.scrollHeight > el.clientHeight && el.scrollHeight <= COMPOSER_MAX_H) {
      el.style.height = `${el.scrollHeight}px`
    }
    // 超过 6 行要在框内滚动。
    //
    // 2026-11-12 用户：「输入框输入文字的时候，没有始终根据最新的文字换行显示」。
    // 实测（4 行以后）：框高钉在 112px，`scrollTop` **一直是 0** —— 新打的那几行全在
    // 框外，用户只看到最早的四行。原来这里只把 scrollTop 对齐到整行边界，而它在 0 时
    // 对齐之后还是 0，等于什么都没做。
    // 现在：正文变了就滚到最新一行（底），光标不在末尾（用户在翻旧行）时保持不动；
    // 只有宽度变化（ResizeObserver）时不抢用户的位置。
    if (el.scrollHeight > el.clientHeight) {
      const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length
      if (scrollToCaret && atEnd) {
        el.scrollTop = el.scrollHeight
      } else {
        const lineHeight = Number.parseFloat(style.lineHeight)
        const padTop = Number.parseFloat(style.paddingTop)
        if (Number.isFinite(lineHeight) && lineHeight > 0 && Number.isFinite(padTop)) {
          const snapped = Math.floor((el.scrollTop - padTop) / lineHeight) * lineHeight + padTop
          if (snapped !== el.scrollTop) el.scrollTop = Math.max(0, snapped)
        }
      }
    }
  }, [composerRef, measurePlaceholder])

  // 正文变了就重量；宽度变了（排队按钮变宽/变窄、旋转屏幕）也要重量。
  // 首帧还要额外补两次：挂载时元素可能还没布局（clientWidth=0），字体也可能晚到，
  // 这时量出来的是一行，长占位符的第二行就被切掉（真机 2026-11-10 的现象）。
  useEffect(() => {
    // 正文变了：量高并且滚到光标所在的最后一行（`true`），否则超过 4 行后新打的字在框外。
    fitComposer(true)
    const frame = requestAnimationFrame(() => { fitComposer(true) })
    void document.fonts?.ready.then(() => { fitComposer(true) })
    return () => { cancelAnimationFrame(frame) }
  }, [input, placeholder, fitComposer])

  useEffect(() => {
    const el = composerRef.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    /**
     * 宽度是**唯一输入**，高度不是：这只 textarea 的高度就是下面 `fitComposer` 自己
     * 写的，把它也当触发源，回调就会改自己观察的盒子，浏览器得在同一帧再投递一轮
     * （2026-11-16 实测 4 次自激；手机上投不完就报 "ResizeObserver loop …"）。
     * 认宽度后即稳定点：自己写出的高度再触发回调时宽度没变 → 直接返回，一轮收敛。
     * rAF 合帧另把写入移出投递窗口，并吃掉同一布局的连发。
     */
    let frame = 0
    let lastWidth = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const width = el.clientWidth
        if (width === lastWidth) return
        lastWidth = width
        fitComposer()
      })
    })
    observer.observe(el)
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [composerRef, fitComposer])


  return (
    <>
      <div className="chat-composer">
        {queue.detail}
        {quoted !== undefined && (
          <div className="chat-quote-bar" role="note" aria-label="引用消息">
            <span className="chat-quote-text">{truncate(quoted, 20)}</span>
            <Button type="button" className="chat-quote-close" aria-label="取消引用" onClick={() => { setQuoted(undefined) }}>
              <CloseIcon width={14} height={14} />
            </Button>
          </div>
        )}
        {/*
          已认领的命令：**单独一行，和引用条/附件条同一族**。
          2026-11-12 用户：「输入框加入斜杠命令之后，排版很奇怪」。
          原因是 chip 原来和 textarea 在同一个 flex 行里并排，chip 一占宽度，输入框就只剩
          几十像素宽 —— 占位符被挤成竖排（「输入命/令参/数，回/车执行」），框跟着一起长高。
          挪到上面一行之后，输入框永远是整行宽度，占位符也换成了这条命令自己的参数提示。
        */}
        {claimedCommand !== undefined && (
          <div className="chat-command-bar" role="note" aria-label="待发送命令">
            <span className="chat-command-chip">
              <span className="chat-command-chipText">/{claimedCommand}</span>
              <Button
                type="button"
                className="chat-command-chipClose"
                aria-label="取消命令"
                onClick={releaseCommand}
              >
                <CloseIcon width={12} height={12} />
              </Button>
            </span>
            {claimedCommandHint !== undefined && (
              <span className="chat-command-hint">{claimedCommandHint}</span>
            )}
          </div>
        )}
        {attachImages.length > 0 && (
          <div className="chat-attach-bar" role="list" aria-label="待发送图片">
            {attachImages.map((image, index) => (
              <div key={index} className="chat-attach-item" role="listitem">
                <img className="chat-attach-img" src={image.dataUrl} alt="待发送图片" />
                <Button
                  type="button"
                  className="chat-attach-remove"
                  aria-label="移除图片"
                  onClick={() => { setAttachImages(previous => previous.filter((_, i) => i !== index)) }}
                >×</Button>
              </div>
            ))}
          </div>
        )}
        {attachFiles.length > 0 && (
          <div className="chat-file-bar" role="list" aria-label="待发送附件" ref={fileFade.ref} data-fade={fileFade.fade}>
            {attachFiles.map((file, index) => (
              <div key={file.localId} className={`chat-file-item is-${file.status}`} role="listitem">
                <svg className="chat-file-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                  <path d="M9 1.5 H4.5 A1.5 1.5 0 0 0 3 3 V13 A1.5 1.5 0 0 0 4.5 14.5 H11.5 A1.5 1.5 0 0 0 13 13 V5.5 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M9 1.5 V5.5 H13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
                <span className="chat-file-name">{file.name}</span>
                {file.status === 'ready' && file.bytes !== undefined && (
                  <span className="chat-file-size">{formatFileSize(file.bytes)}</span>
                )}
                {file.status === 'uploading' && (
                  <>
                    <span className="chat-file-status">上传中…</span>
                    <Button
                      type="button"
                      className="chat-file-cancel"
                      aria-label={`取消上传 ${file.name}`}
                      onClick={() => {
                        file.abort?.abort()
                        setAttachFiles(previous => previous.filter(item => item.localId !== file.localId))
                      }}
                    >取消</Button>
                  </>
                )}
                {file.status === 'failed' && (
                  <Button
                    type="button"
                    className="chat-file-retry"
                    aria-label={`重新上传 ${file.name}`}
                    onClick={() => { retryStaged(file.localId) }}
                  >上传失败，点按重试</Button>
                )}
                <Button
                  type="button"
                  className="chat-file-remove"
                  aria-label={`移除附件 ${file.name}`}
                  onClick={() => { setAttachFiles(previous => previous.filter((_, i) => i !== index)) }}
                >×</Button>
              </div>
            ))}
          </div>
        )}
        {/* 实时转写：说话时就往上滚字，用户能立刻看出"它听清了没有"。
            放在输入行上方而不是塞进录音条里 —— 条内只剩波形和计时，字才有地方换行。 */}
        {voice.open && (
          <div className="chat-voice-live">
            <p className="chat-voice-live-text" role="status" aria-live="polite">
              {voice.partial === '' ? voice.statusText : voice.partial}
            </p>

          </div>
        )}        <div className="chat-inputbar">
          <Button
            type="button"
            className="chat-attach-btn"
            aria-label="添加内容"
            aria-haspopup="dialog"
            onClick={() => { setPlusOpen(true) }}
          >
            <PlusIcon width={16} height={16} />
          </Button>
          {/* 命令 chip 摆在输入框**里面**（边框和背景挪到 .chat-field 上）：与输入框
              同一条中心线垂直居中，输入框被挤窄/长高都跟着走，不会像并排摆时那样把
              框压扁，也不会像单独一行那样把输入区顶起来。 */}
          <div
            className="chat-field"
            data-voice={voice.open ? voice.phase : undefined}
            data-empty={input === '' && claimedCommand === undefined ? 'true' : undefined}
          >
          {/* 2026-11-12：语音入口从「+ 面板第四层」搬到输入框里。点一下**就地**变录音条
              （红点 + 波形 + 计时 + 停止），不弹整屏模态，对话和输入内容都还看得见。 */}
          {voice.open ? (
            <>
              <span className="chat-voice-dot" data-phase={voice.phase} aria-hidden="true" />
              <div
                className="chat-voice-wave"
                ref={voice.waveRef}
                data-live={voice.phase === 'recording' ? '1' : undefined}
                aria-hidden="true"
              >
                <span /><span /><span /><span /><span /><span /><span />
              </div>
              <span className="chat-voice-clock">{voiceClock}</span>

              <Button
                type="button"
                className="chat-voice-cancel"
                aria-label="取消语音输入"
                onClick={voice.cancel}
              >
                <CloseIcon width={13} height={13} />
              </Button>
              <Button
                type="button"
                className="chat-voice-stop"
                aria-label={voice.phase === 'transcribing' ? '正在转写' : '停止并转写'}
                disabled={voice.phase === 'transcribing'}
                onClick={voice.finish}
              >
                <span className="chat-voice-stop-square" aria-hidden="true" />
              </Button>
            </>
          ) : (
          <>
          <textarea
            ref={composerRef}
            className="chat-input"
            rows={1}
            value={input}
            placeholder={placeholder}
            enterKeyHint={mobileEnterToSend ? 'send' : 'enter'}
            onChange={(event) => {
              const value = event.target.value
              // 手动敲 `/命令名 ` 也算认领：桌面端同样把命令词收成 chip，参数留在后面。
              const typed = claimedCommand === undefined
                ? /^\/([A-Za-z][\w-]*)[ \u00a0]+([\s\S]*)$/.exec(value)
                : null
              if (typed !== null && commands?.some(command => command.name === typed[1]) === true) {
                claimCommand(typed[1] ?? '', typed[2] ?? '')
                return
              }
              setInput(value)
            }}
            onFocus={() => { setComposerFocused(true) }}
            onBlur={() => { setComposerFocused(false) }}
            onPaste={(event) => {
              const files = imageFromClipboard(event.clipboardData)
              if (files.length > 0) {
                event.preventDefault()
                for (const file of files) addImage(file)
              }
            }}
            onKeyDown={(event) => {
              // isComposing: skip Enter while a Chinese IME is composing, so
              // confirming a candidate never fires a send mid-composition.
              if (mobileEnterToSend && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send()
              }
            }}
          />
          {/* 麦克风常驻：空框时带底色（一眼看得见），有字时退成次要灰，不抢发送键。 */}
          <Button
            type="button"
            className="chat-mic"
            aria-label="语音输入"
            onClick={voice.start}
          >
            <MicIcon width={16} height={16} />
          </Button>
          </>
          )}
          </div>
          {running && !primaryStops && (
            <Button
              type="button"
              className={stopArmed ? 'chat-stop-mini chat-stop-mini-armed' : 'chat-stop-mini'}
              aria-label={stopping ? '停止中' : stopArmed ? '确认停止' : '停止'}
              disabled={stopping}
              onClick={() => {
                if (!stopArmed) {
                  // 第一拍只是「举枪」：2.5 秒没人再点就收回，什么都不会发生。
                  setStopArmed(true)
                  window.setTimeout(() => { setStopArmed(false) }, 2_500)
                  return
                }
                setStopArmed(false)
                void stopTurn()
              }}
            >
              {stopArmed ? (
                <span className="chat-stop-mini-text">确认</span>
              ) : (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                  <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                </svg>
              )}
            </Button>
          )}
          <Button
            type="button"
            className={primaryStops
              ? 'chat-send chat-send-stop'
              : running ? 'chat-send chat-send-queued' : 'chat-send'}
            {...(primaryStops
              ? { 'aria-label': stopping ? '停止中' : '停止' }
              : { 'aria-label': running ? '排队发送' : '发送' })}
            disabled={primaryStops ? stopping : sending || draftEmpty}
            onPointerDown={() => {
              // F3: long-press opens the delivery-intent sheet. A plain tap keeps
              // today's behavior (queue), so nothing changes for users who never
              // discover the long-press.
              if (primaryStops) return
              sendHoldFiredRef.current = false
              if (sendHoldTimerRef.current !== undefined) window.clearTimeout(sendHoldTimerRef.current)
              sendHoldTimerRef.current = window.setTimeout(() => {
                sendHoldTimerRef.current = undefined
                sendHoldFiredRef.current = true
                setSendIntentOpen(true)
              }, 500)
            }}
            onPointerUp={() => {
              if (sendHoldTimerRef.current !== undefined) {
                window.clearTimeout(sendHoldTimerRef.current)
                sendHoldTimerRef.current = undefined
              }
            }}
            onPointerCancel={() => {
              if (sendHoldTimerRef.current !== undefined) {
                window.clearTimeout(sendHoldTimerRef.current)
                sendHoldTimerRef.current = undefined
              }
            }}
            onPointerLeave={() => {
              if (sendHoldTimerRef.current !== undefined) {
                window.clearTimeout(sendHoldTimerRef.current)
                sendHoldTimerRef.current = undefined
              }
            }}
            onClick={() => {
              if (primaryStops) { void stopTurn(); return }
              // The long-press already opened the sheet; its click must not also
              // send a plain queue message.
              if (sendHoldFiredRef.current) { sendHoldFiredRef.current = false; return }
              void send()
            }}
          >
            {/* 三种形态必须一眼可辨：发送（纸飞机）／排队（胶囊上写「排队」）／停止（方块）。
                排队态原来是「纸飞机 + 角上一只小钟」，既挤又看不出什么意思；直接写字最省解释。 */}
            {primaryStops ? (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
              </svg>
            ) : running ? (
              <span className="chat-send-queuedText" aria-hidden="true">排队</span>
            ) : (
              <SendIcon width={16} height={16} />
            )}
          </Button>
        </div>
      </div>
      {sendIntentOpen && (
        <Sheet title="怎么发送" onClose={() => { setSendIntentOpen(false) }}>
          {/* 三档语义按宿主能力如实写：排队/插话是宿主模式，"中断并发送"是两次调用
              的组合（先 cancel 再 queue），所以它单独一行说明代价。 */}
          <div role="menu" aria-label="发送方式">
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setSendIntentOpen(false); void send('queue') }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">排队</span>
                <span className="sheet-option-desc">本轮结束后自动发送（默认）</span>
              </span>
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setSendIntentOpen(false); void send('steer') }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">插话</span>
                <span className="sheet-option-desc">不打断，插进正在跑的这轮</span>
              </span>
            </Button>
            <Button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setSendIntentOpen(false); void send('interrupt') }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">中断并发送</span>
                <span className="sheet-option-desc">先停掉当前这轮，再发这条</span>
              </span>
            </Button>
          </div>
        </Sheet>
      )}
    </>
  )
}

