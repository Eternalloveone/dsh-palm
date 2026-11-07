/**
 * 输入区（composer）：引用条、待发图片/附件 chip、输入框、三档发送与「怎么发送」面板。
 *
 * S6a 从 `ChatView` 搬出（纯展示 + 回调，内部只留长按计时与 sheet 开关这类局部状态）。
 * 为什么不把这些状态也一起搬走：草稿、附件、语音、发送本身都是会话层的东西，
 * 组件只做「把用户的选择画出来、把动作打回去」，这样以后改样式不会牵动会话逻辑。
 */
import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { CommandDescriptor } from '../../api.ts'
import { imageFromClipboard } from '../../image.ts'
import type { AttachedImage } from '../../image.ts'
import { CloseIcon, MicIcon, PlusIcon, SendIcon } from '../../icons.tsx'
import { Sheet } from '../../sheet.tsx'
import type { StagedFile } from './use-chat-attachments.ts'
import { formatFileSize } from '../../ui-text.ts'
import { truncate } from '../../shared/text.ts'
import { Button } from '../../ui/primitives.tsx'

/** 发送意图：排队（默认）／插进当前回合／先中断再排队。 */
export type SendIntent = 'queue' | 'steer' | 'interrupt'

export interface ComposerSectionProps {
  input: string
  setInput: Dispatch<SetStateAction<string>>
  composerRef: MutableRefObject<HTMLTextAreaElement | null>
  mobileEnterToSend: boolean
  commands: CommandDescriptor[] | undefined
  claimedCommand: string | undefined
  claimCommand: (name: string, argument?: string) => void
  releaseCommand: () => void
  quoted: string | undefined
  setQuoted: Dispatch<SetStateAction<string | undefined>>
  attachImages: AttachedImage[]
  setAttachImages: Dispatch<SetStateAction<AttachedImage[]>>
  attachFiles: StagedFile[]
  setAttachFiles: Dispatch<SetStateAction<StagedFile[]>>
  retryStaged: (localId: string) => void
  addImage: (file: File) => void
  setPlusOpen: Dispatch<SetStateAction<boolean>>
  setCommandOpen: Dispatch<SetStateAction<boolean>>
  voiceSupported: boolean
  openVoice: () => void
  running: boolean
  primaryStops: boolean
  stopArmed: boolean
  setStopArmed: Dispatch<SetStateAction<boolean>>
  stopping: boolean
  stopTurn: () => void
  sending: boolean
  draftEmpty: boolean
  send: (intent?: SendIntent) => void
}

export function ComposerSection(props: ComposerSectionProps) {
  const {
    input, setInput, composerRef, mobileEnterToSend, commands, claimedCommand, claimCommand, releaseCommand,
    quoted, setQuoted, attachImages, setAttachImages, attachFiles, setAttachFiles, retryStaged, addImage,
    setPlusOpen, setCommandOpen, voiceSupported, openVoice, running, primaryStops, stopArmed, setStopArmed,
    stopping, stopTurn, sending, draftEmpty, send,
  } = props
  /** 「怎么发送」面板是否打开（长按发送键）。 */
  const [sendIntentOpen, setSendIntentOpen] = useState(false)
  const sendHoldTimerRef = useRef<number | undefined>(undefined)
  const sendHoldFiredRef = useRef(false)
  /** 输入框是否有焦点：目前只用于跟随键盘的快捷命令条（保留原行为）。 */
  const [, setComposerFocused] = useState(false)

  return (
    <>
      <div className="chat-composer">
        {quoted !== undefined && (
          <div className="chat-quote-bar" role="note" aria-label="引用消息">
            <span className="chat-quote-text">{truncate(quoted, 20)}</span>
            <Button type="button" className="chat-quote-close" aria-label="取消引用" onClick={() => { setQuoted(undefined) }}>
              <CloseIcon width={14} height={14} />
            </Button>
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
          <div className="chat-file-bar" role="list" aria-label="待发送附件">
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
        <div className="chat-inputbar">
          <Button
            type="button"
            className="chat-attach-btn"
            aria-label="添加内容"
            aria-haspopup="dialog"
            onClick={() => { setPlusOpen(true) }}
          >
            <PlusIcon width={20} height={20} />
          </Button>
          <Button
            type="button"
            className="chat-attach-btn"
            aria-label="斜杠命令"
            aria-haspopup="dialog"
            onClick={() => { setCommandOpen(true) }}
          >
            <span className="chat-slash-glyph" aria-hidden="true">/</span>
          </Button>
          {voiceSupported && (
            <Button
              type="button"
              className="chat-attach-btn"
              aria-label="语音输入"
              onClick={openVoice}
            >
              <MicIcon width={20} height={20} />
            </Button>
          )}
          {/* 命令 chip 摆在输入框**里面**（边框和背景挪到 .chat-field 上）：与输入框
              同一条中心线垂直居中，输入框被挤窄/长高都跟着走，不会像并排摆时那样把
              框压扁，也不会像单独一行那样把输入区顶起来。 */}
          <div className="chat-field">
          {claimedCommand !== undefined && (
            <span className="chat-command-chip" role="note" aria-label="待发送命令">
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
          )}
          <textarea
            ref={composerRef}
            className="chat-input"
            rows={1}
            value={input}
            placeholder={claimedCommand === undefined ? '说点什么...' : '输入命令参数，回车执行'}
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
              <SendIcon />
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
