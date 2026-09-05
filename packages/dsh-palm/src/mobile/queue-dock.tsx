/**
 * Pending-message queue dock (desktop QueueDock equivalent): the messages
 * queued while the current turn is running, shown above the composer. A
 * single item renders as a strip; several collapse behind a count header
 * that expands on tap. Each row offers edit / remove / steer (steer only
 * while the agent is running). An empty queue renders nothing.
 *
 * Placement follows the desktop dock: only `queued` rows render here.
 * `steering` rows have already been handed into the running turn (they enter
 * the durable message log as they surface) and `context` rows are host
 * injections (approval notices, task completions) — neither is a pending
 * user message the phone may edit or delete.
 */
import { useRef, useState } from 'react'
import type { QueueItemView } from './api.ts'

export interface QueueDockProps {
  items: QueueItemView[]
  /** Whether the agent is currently running (steer is only then available). */
  running: boolean
  /** Each mutation resolves when the host answers (rejected included) so the
   *  dock can hold one in-flight operation at a time. */
  onEdit(itemId: string, text: string): Promise<void>
  onRemove(itemId: string): Promise<void>
  onSteer(itemId: string): Promise<void>
}

export function QueueDock({ items, running, onEdit, onRemove, onSteer }: QueueDockProps) {
  const [expanded, setExpanded] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** One in-flight mutation at a time: the host answers queue mutations
   *  last-writer-wins, so a second tap while the first RPC is unresolved
   *  could act on a row that no longer exists. The ref is the synchronous
   *  re-entry guard (state alone cannot stop two taps in one tick); the
   *  state renders the disabled affordance. */
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)

  const queue = items.filter(item => item.placement === 'queued')
  if (queue.length === 0) return null
  const listVisible = queue.length === 1 || expanded

  const startEdit = (item: QueueItemView): void => {
    setEditingId(item.id)
    setDraft(item.text)
  }
  const commitEdit = async (): Promise<void> => {
    if (editingId === null || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await onEdit(editingId, draft)
    } finally {
      busyRef.current = false
      setBusy(false)
      setEditingId(null)
    }
  }
  const run = async (action: (itemId: string) => Promise<void>, itemId: string): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await action(itemId)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="queue-dock" data-queue-dock="">
      {queue.length > 1 && (
        <button
          type="button"
          className="queue-dockHead"
          aria-expanded={expanded}
          onClick={() => { setExpanded(value => !value) }}
        >
          <span className="queue-dockCount">{queue.length} 条排队</span>
          <span className="queue-dockChevron" aria-hidden>{expanded ? '收起' : '展开'}</span>
        </button>
      )}
      {listVisible && (
        <ul className="queue-dockList">
          {queue.map(item => (
            <li key={item.id} className="queue-dockRow">
              {editingId === item.id ? (
                <div className="queue-dockEdit">
                  <input
                    className="queue-dockInput"
                    value={draft}
                    autoFocus
                    onChange={(event) => { setDraft(event.target.value) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commitEdit()
                      if (event.key === 'Escape') setEditingId(null)
                    }}
                  />
                  <button type="button" className="queue-dockBtn queue-dockBtn-primary" onClick={() => { void commitEdit() }}>保存</button>
                  <button type="button" className="queue-dockBtn" onClick={() => { setEditingId(null) }}>取消</button>
                </div>
              ) : (
                <>
                  <span className="queue-dockText" title={item.text}>{item.text}</span>
                  <span className="queue-dockActions">
                    <button
                      type="button"
                      className="queue-dockBtn"
                      aria-label="编辑排队消息"
                      // Only plain-text pending messages are editable (the
                      // host queue edits accept text content only).
                      title={item.editable ? undefined : '仅纯文本消息可编辑'}
                      disabled={!item.editable || busy}
                      onClick={() => { startEdit(item) }}
                    >编辑</button>
                    <button type="button" className="queue-dockBtn" aria-label="删除排队消息" disabled={busy} onClick={() => { void run(onRemove, item.id) }}>删除</button>
                    <button
                      type="button"
                      className="queue-dockBtn queue-dockBtn-primary"
                      aria-label="插话发送"
                      disabled={!running || busy}
                      title={running ? undefined : '仅运行中可插话发送'}
                      onClick={() => { void run(onSteer, item.id) }}
                    >插话</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
