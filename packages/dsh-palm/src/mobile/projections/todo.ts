/**
 * 计划（todo）折线：事件流 → 当前计划快照（W3-3 从 `messages.ts` 搬出来）。
 *
 * 只依赖类型与 JSON 守卫，不碰任何渲染状态，所以能独立测试。
 *
 * @module dsh-palm/mobile/projections/todo
 */
import { isRecord, pickString } from './json.ts'
import type { TodoItem, WireEvent } from './types.ts'

/** 宿主认可的计划状态白名单：多一个字就当坏快照丢掉（宁可不更新，不要显示错的）。 */
const TODO_STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

/**
 * Parse a `todo/write` payload (`{ todos: TodoItem[] }`) into a validated
 * list. Malformed snapshots (wrong root, non-array, null items, bad status)
 * yield `undefined` — the caller keeps showing the previous list rather than
 * blanking the plan strip on one bad write.
 */
export function parseTodoList(data: unknown): TodoItem[] | undefined {
  if (!isRecord(data)) return undefined
  const todos = data['todos']
  if (!Array.isArray(todos)) return undefined
  const items: TodoItem[] = []
  for (const raw of todos) {
    if (!isRecord(raw)) return undefined
    const content = pickString(raw['content'])
    const status = pickString(raw['status'])
    if (content === undefined || status === undefined) return undefined
    if (!TODO_STATUSES.includes(status)) return undefined
    items.push({ content, status: status as TodoItem['status'] })
  }
  return items
}

/** Todo snapshot type with its event seq (adoption is last-write-wins). */
export interface TodoSnapshot {
  readonly seq: number
  readonly items: TodoItem[]
}

/**
 * The newest valid `todo/write` snapshot across events, or undefined when
 * none exists. Scans from the tail (later writes win); a malformed newest
 * snapshot falls through to an older valid one.
 */
export function latestTodoSnapshot(events: readonly WireEvent[]): TodoSnapshot | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type !== 'todo/write') continue
    const items = parseTodoList(event.data)
    if (items === undefined) continue
    return { seq: event.seq, items }
  }
  return undefined
}

/** Fold one event into the projection-equivalent todo state (the mobile
 *  mirror of the host `tool-todo` projection apply):
 *  - `todo/write` replaces the list (malformed writes keep the previous one);
 *  - `turn/end` normalizes a task still `in_progress` to `completed` (agents
 *    routinely skip the final all-done write, so the turn boundary must not
 *    leave the strip stuck on an intermediate snapshot) — `pending` items were
 *    never started and stay untouched;
 *  - `turn/start` clears the whole list (the host clears its projection there);
 *  - every other event returns the same state.
 *  Seeding the plan strip from this fold (rather than a raw newest-write scan)
 *  keeps a reopened session consistent with the host projection: an old turn
 *  that ended mid-task shows its finished checklist, and a new turn that never
 *  wrote a todo shows nothing at all.
 */
export function foldTodoEvent(
  state: TodoSnapshot | undefined,
  event: WireEvent,
): TodoSnapshot | undefined {
  if (event.type === 'todo/write') {
    const items = parseTodoList(event.data)
    return items === undefined ? state : { seq: event.seq, items }
  }
  if (event.type === 'turn/end' && state !== undefined) {
    return {
      seq: state.seq,
      items: state.items.map(item => item.status === 'in_progress'
        ? { ...item, status: 'completed' }
        : item),
    }
  }
  if (event.type === 'turn/start') return undefined
  return state
}

/** Fold a whole event sequence into its projection-equivalent todo snapshot
 *  (undefined = cleared / never written). Events must be in seq order. */
export function foldTodoSnapshot(events: readonly WireEvent[]): TodoSnapshot | undefined {
  let state: TodoSnapshot | undefined
  for (const event of events) state = foldTodoEvent(state, event)
  return state
}
