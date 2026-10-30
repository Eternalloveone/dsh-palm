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
  /** 默认展开：排了三条只显示一行「3 条排队」时，用户不知道排了什么、顺序对不对。 */
  const [expanded, setExpanded] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** One in-flight mutation at a time: the host answers queue mutations
   *  last-writer-wins, so a second tap while the first RPC is unresolved
   *  could act on a row that no longer exists. The ref is the synchronous
   *  re-entry guard (state alone cannot stop two taps in one tick); the
   *  state renders the disabled affordance. */
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  /**
   * 哪一行、哪个动作正在等宿主回话。只把按钮置灰不够：一次往返要几百毫秒到几秒，
   * 期间界面毫无变化，用户以为点空了就再点一遍 —— 这正是「点击插队没及时显示」
   * 的观感来源。这里让被点的那一行当场变成「发送中…／删除中…」。
   */
  const [pending, setPending] = useState<{ id: string; verb: 'remove' | 'steer' } | null>(null)

  const queue = items.filter(item => item.placement === 'queued')
  // 「已经插进本轮」的条目（宿主 next-step 队列）：对话里还没有它，排队条又不显示的话，
  // 消息在手机上就是**两边都没有**（实测：steer 回执 ok，10 秒内无气泡、无排队条）。
  const steering = items.filter(item => item.placement === 'steering')
  if (queue.length === 0 && steering.length === 0) return null
  const listVisible = queue.length === 1 || expanded

  const startEdit = (item: QueueItemView): void => {
    setEditingId(item.id)
    setDraft(item.text)
  }
  const commitEdit = async (): Promise<void> => {
    // The host refuses an edit whose text has no non-whitespace content
    // (gateway/bad-request), and the failure surfaced as "already sending":
    // an empty draft is blocked here instead, where the reason is visible.
    if (editingId === null || busyRef.current || draft.trim() === '') return
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
  const run = async (
    action: (itemId: string) => Promise<void>,
    itemId: string,
    verb: 'remove' | 'steer',
  ): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setPending({ id: itemId, verb })
    try {
      await action(itemId)
    } finally {
      busyRef.current = false
      setBusy(false)
      setPending(null)
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
                  <button
                    type="button"
                    className="queue-dockBtn queue-dockBtn-primary"
                    disabled={busy || draft.trim() === ''}
                    title={draft.trim() === '' ? '排队消息不能为空，要撤销请直接删除' : undefined}
                    onClick={() => { void commitEdit() }}
                  >保存</button>
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
                    <button type="button" className="queue-dockBtn" aria-label="删除排队消息" disabled={busy} onClick={() => { void run(onRemove, item.id, 'remove') }}>{pending?.id === item.id && pending.verb === 'remove' ? '删除中…' : '删除'}</button>
                    {/* 主操作要说人话：这条不排在队尾等下一轮，而是立刻塞进正在跑的这轮。
                        「插话」两个字普通用户看不懂，按钮还长得和编辑/删除一模一样。

                        `placement === 'steering'` 的条目**已经插进这一轮**了（宿主 next-step
                        队列），再给「立即发送」是按不动的空操作 —— 换成一句状态词。 */}
                    <button
                      type="button"
                      className="queue-dockBtn queue-dockBtn-primary"
                      aria-label="立即插入当前回合"
                      disabled={!running || busy}
                      title={running ? '不用等这一轮结束，现在就发' : '当前没有运行中的回合'}
                      onClick={() => { void run(onSteer, item.id, 'steer') }}
                    >
                      <svg className="queue-dockBtnIcon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                        <path d="M3 2.5v4.5a3 3 0 0 0 3 3h6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <path d="M10 7 13 10l-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {pending?.id === item.id && pending.verb === 'steer' ? '发送中…' : '立即发送'}
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {steering.length > 0 && (
        <ul className="queue-dockList queue-dockSteering">
          {steering.map(item => (
            <li key={item.id} className="queue-dockRow" data-placement="steering">
              <span className="queue-dockText" title={item.text}>
                <span className="queue-dockTag">已插入本轮</span>
                {item.text}
              </span>
              <span className="queue-dockActions">
                <button
                  type="button"
                  className="queue-dockBtn"
                  aria-label="撤回插队消息"
                  disabled={busy}
                  onClick={() => { void run(onRemove, item.id, 'remove') }}
                >{pending?.id === item.id && pending.verb === 'remove' ? '撤回中…' : '撤回'}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
