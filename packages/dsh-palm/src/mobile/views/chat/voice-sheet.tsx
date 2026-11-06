/**
 * 语音输入面板（录音波形 + 状态行 + 取消/完成）。
 *
 * S6b 从 `ChatView` 搬出：面板本身是纯展示，录音机、字幕机、转写都在
 * `use-chat-voice` 里，这里只把那一刻的状态画出来、把两个动作打回去。
 * DOM 结构、类名、aria 与 Esc 行为逐字保留（真机靠它们定位与退出）。
 */
import type { MutableRefObject } from 'react'
import { voiceStatusClassName, type VoiceStatus } from '../../voice-status.ts'

export interface VoiceSheetProps {
  open: boolean
  phase: 'recording' | 'transcribing'
  status: VoiceStatus
  /** 波形元素：响度直接写进它的 CSS 变量，免得每 85ms 触发一次整页重渲染。 */
  waveRef: MutableRefObject<HTMLDivElement | null>
  /** 「完成」按钮：面板打开把焦点送进来，关掉还回原处。 */
  doneRef: MutableRefObject<HTMLButtonElement | null>
  onClose: () => void
  onFinish: () => void
}

export function VoiceSheet({ open, phase, status, waveRef, doneRef, onClose, onFinish }: VoiceSheetProps) {
  if (!open) return null
  return (
    <div className="voice-backdrop" onClick={() => { onClose() }}>
      <div
        className="voice-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="语音输入"
        onClick={(event) => { event.stopPropagation() }}
        onKeyDown={(event) => {
          // 键盘（iPad 外接键盘/桌面浏览器）与读屏用户：Esc 必须能退出，
          // 否则这个面板只能靠点背景关掉，而背景正好在手指最容易误触的位置。
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <div
          ref={waveRef}
          className={'voice-wave' + (phase === 'transcribing' ? ' voice-wave-idle' : '')}
          data-live={phase === 'recording' ? '1' : undefined}
          aria-hidden
        >
          <span /><span /><span /><span /><span />
        </div>
        {/* 文案与警示色都来自 voiceStatusText：最后 10 秒提醒，转写中/有部分转写时不提醒。 */}
        <div
          className={voiceStatusClassName(status)}
          role="status"
        >
          {status.text}
        </div>
        <div className="voice-actions">
          <button
            type="button"
            className="voice-cancel"
            onClick={onClose}
          >取消</button>
          <button
            ref={doneRef}
            type="button"
            className="voice-done"
            disabled={phase === 'transcribing'}
            onClick={onFinish}
          >
            {phase === 'transcribing' ? '请稍候' : '完成'}
          </button>
        </div>
      </div>
    </div>
  )
}
