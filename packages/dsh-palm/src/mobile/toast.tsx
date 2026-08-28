/**
 * Toast: bottom-popup notifications with auto-dismiss. A tiny module store
 * (toast/ToastHost) keeps the API one call — `toast('已固定')` — while the
 * host component renders inside the app root; no prop threading.
 */

import { useEffect, useState } from 'react'

/** One queued toast entry. */
interface ToastEntry {
  id: number
  text: string
  leaving: boolean
}

type ToastListener = (entries: ToastEntry[]) => void

const VISIBLE_MS = 2200
const LEAVE_MS = 200

const entries: ToastEntry[] = []
const listeners = new Set<ToastListener>()
let nextId = 1

function emit(): void {
  for (const listener of [...listeners]) listener([...entries])
}

/** Show a bottom toast; auto-dismisses after ~2.2s (plus a 200ms exit fade). */
export function toast(text: string): void {
  const id = nextId++
  entries.push({ id, text, leaving: false })
  emit()
  setTimeout(() => {
    const entry = entries.find(candidate => candidate.id === id)
    if (entry === undefined) return
    entry.leaving = true
    emit()
    setTimeout(() => {
      const index = entries.findIndex(candidate => candidate.id === id)
      if (index !== -1) {
        entries.splice(index, 1)
        emit()
      }
    }, LEAVE_MS)
  }, VISIBLE_MS)
}

/** Render the toast stack; mount once inside the app root. */
export function ToastHost() {
  const [items, setItems] = useState<ToastEntry[]>(entries)
  useEffect(() => {
    listeners.add(setItems)
    return () => { listeners.delete(setItems) }
  }, [])
  if (items.length === 0) return null
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map(entry => (
        <div key={entry.id} className={'toast' + (entry.leaving ? ' toast-out' : '')}>{entry.text}</div>
      ))}
    </div>
  )
}
