/**
 * Centered confirm dialog (16px radius, primary action right): destructive
 * confirms (workspace delete) and small text prompts (workspace rename)
 * that are too heavy for a toast but don't need a full sheet.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'

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
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    // Lock the page scroll while the dialog is open.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onCancel])
  const toneClass = tone === 'danger' ? 'dialog-btn-danger' : 'dialog-btn-primary'
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => { event.stopPropagation() }}
      >
        <h2 className="dialog-title">{title}</h2>
        <div className="dialog-body">{body}</div>
        <div className="dialog-actions">
          <button type="button" className="dialog-btn" disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className={`dialog-btn ${toneClass}`} disabled={busy} onClick={onConfirm}>
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
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
  useEffect(() => {
    inputRef.current?.select()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    // Lock the page scroll while the dialog is open.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onCancel])
  const submit = (): void => {
    const trimmed = value.trim()
    if (trimmed !== '') onConfirm(trimmed)
  }
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => { event.stopPropagation() }}
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
      </div>
    </div>
  )
}
