/**
 * Centered confirm dialog (16px radius, primary action right): destructive
 * confirms (workspace delete) and small text prompts (workspace rename)
 * that are too heavy for a toast but don't need a full sheet.
 *
 * W1-4 起遮罩/焦点/Esc/aria 由 `ui/overlay.tsx` 统一提供；这里只留内容与按钮。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Overlay } from './ui/overlay.tsx'

/** Confirm/cancel dialog with a danger or primary confirm button. */
export function ConfirmDialog({ title, body, confirmLabel, tone = 'primary', busy = false, onConfirm, onCancel }: {
  title: string
  body: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger'
  busy?: boolean
  onConfirm(): void
  onCancel(): void
}) {
  const toneClass = tone === 'danger' ? 'dialog-btn-danger' : 'dialog-btn-primary'
  return (
    <Overlay
      title={title}
      onClose={onCancel}
      role="alertdialog"
      scrimClassName="dialog-backdrop"
      panelClassName="dialog"
    >
      <h2 className="dialog-title">{title}</h2>
      <div className="dialog-body">{body}</div>
      <div className="dialog-actions">
        <button type="button" className="dialog-btn" disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" className={`dialog-btn ${toneClass}`} disabled={busy} onClick={onConfirm}>
          {busy ? '处理中…' : confirmLabel}
        </button>
      </div>
    </Overlay>
  )
}

/** One-line text prompt dialog (workspace rename). */
export function PromptDialog({ title, initial, confirmLabel, busy = false, onConfirm, onCancel }: {
  title: string
  initial: string
  confirmLabel: string
  busy?: boolean
  onConfirm(value: string): void
  onCancel(): void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // 输入框是面板里第一个可聚焦元素：Overlay 的焦点陷阱会聚焦它，这里再全选一次。
  // 关闭归还焦点也由焦点陷阱负责（同样 preventScroll）。
  useEffect(() => {
    inputRef.current?.select()
  }, [])
  const submit = (): void => {
    const trimmed = value.trim()
    if (trimmed !== '') onConfirm(trimmed)
  }
  return (
    <Overlay
      title={title}
      onClose={onCancel}
      scrimClassName="dialog-backdrop"
      panelClassName="dialog"
    >
      <h2 className="dialog-title">{title}</h2>
      <input
        ref={inputRef}
        className="dialog-input"
        value={value}
        aria-label={title}
        disabled={busy}
        onChange={(event) => { setValue(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
      />
      <div className="dialog-actions">
        <button type="button" className="dialog-btn" disabled={busy} onClick={onCancel}>取消</button>
        <button
          type="button"
          className="dialog-btn dialog-btn-primary"
          disabled={busy || value.trim() === ''}
          onClick={submit}
        >
          {busy ? '保存中…' : confirmLabel}
        </button>
      </div>
    </Overlay>
  )
}
