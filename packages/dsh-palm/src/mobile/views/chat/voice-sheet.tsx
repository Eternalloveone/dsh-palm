/**
 * 语音输入面板（录音波形 + 状态行 + 取消/完成）。
 *
 * S6b 从 `ChatView` 搬出：面板本身是纯展示，录音机、字幕机、转写都在
 * `use-chat-voice` 里，这里只把那一刻的状态画出来、把两个动作打回去。
 * DOM 结构、类名、aria 与 Esc 行为逐字保留（真机靠它们定位与退出）。
 */
import type { MutableRefObject } from 'react'
import { voiceStatusClassName, type VoiceStatus } from '../../voice-status.ts'
import { Overlay } from '../../ui/overlay.tsx'
import { Button } from '../../ui/primitives.tsx'

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
    // 遮罩/焦点/Esc 由 ui/overlay 统一：以前 Esc 挂在面板 onKeyDown 上，只有焦点
    // 恰好在面板内才生效；现在即使焦点还停在背后的输入栏也能退出。
    <Overlay
      title="语音输入"
      onClose={onClose}
      scrimClassName="voice-backdrop"
      panelClassName="voice-sheet"
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
          <Button
            className="voice-cancel"
            onClick={onClose}
          >取消</Button>
          <Button
            ref={doneRef}
            className="voice-done"
            disabled={phase === 'transcribing'}
            onClick={onFinish}
          >
            {phase === 'transcribing' ? '请稍候' : '完成'}
          </Button>
        </div>
    </Overlay>
  )
}
