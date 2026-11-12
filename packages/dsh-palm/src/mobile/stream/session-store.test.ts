// @vitest-environment node
/**
 * session-store：一个会话一份权威状态。
 *
 * 这组用例钉的就是真机上那三条不稳定：队列滞后（乐观项）、插队后回跳（版本单调）、
 * 进出会话刷新（缓存秒开 + 低水位快照不许覆盖高水位）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyQueueItems, applySnapshot, cachedRows, cachedSnapshot, normalizeQueueText, queueView, resetSessionStoreForTest, subscribeSessionStore, type SessionSnapshot,
  claimQueueHead,
} from './session-store.ts'
import type { QueueItemView } from '../api.ts'

const SESSION = 's-1'

function item(id: string, text: string): QueueItemView {
  return { id, placement: 'queued', text, editable: true }
}

function snapshot(over: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: SESSION,
    rows: [],
    maxSeq: 10,
    queue: [],
    queueRevision: 1,
    turn: { running: false },
    asOf: 1_700_000_000_000,
    ...over,
  }
}

beforeEach(() => {
  resetSessionStoreForTest()
})

describe('快照的单调合并', () => {
  it('低水位的行不许覆盖高水位（重连回来的旧包直接丢）', () => {
    applySnapshot(snapshot({ maxSeq: 20, rows: [{ id: 'r2', kind: 'assistant', text: '新' }] as never }))
    applySnapshot(snapshot({ maxSeq: 12, rows: [{ id: 'r1', kind: 'assistant', text: '旧' }] as never }))
    expect(cachedRows(SESSION).map(row => row.text)).toEqual(['新'])
    expect(cachedSnapshot(SESSION)?.maxSeq).toBe(20)
  })

  it('队列按 revision 单调：旧快照里还挂着已删的那条，不许画回来', () => {
    applySnapshot(snapshot({ queueRevision: 3, queue: [] }))
    applySnapshot(snapshot({ queueRevision: 2, queue: [item('q1', '已经删掉了')] }))
    expect(queueView(SESSION)).toEqual([])
  })

  it('行更新但队列更旧：两部分各取各的水位', () => {
    applySnapshot(snapshot({ maxSeq: 30, queueRevision: 5, queue: [item('q1', '排队中')] }))
    applySnapshot(snapshot({ maxSeq: 31, queueRevision: 4, queue: [] }))
    expect(cachedSnapshot(SESSION)?.maxSeq).toBe(31)
    expect(queueView(SESSION).map(row => row.text)).toEqual(['排队中'])
  })
})



describe('老宿主的回退路径', () => {
  it('只有 inbox 投影时，队列同样进仓（后到的投影覆盖前一份）', () => {
    applyQueueItems(SESSION, [item('q1', '来自投影')])
    expect(queueView(SESSION).map(row => row.text)).toEqual(['来自投影'])
    applyQueueItems(SESSION, [item('q2', '又一条')])
    expect(queueView(SESSION).map(row => row.text)).toEqual(['又一条'])
  })
})

describe('订阅与缓存', () => {
  it('变化会通知订阅者，退订之后不再通知', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSessionStore(listener)
    applySnapshot(snapshot())
    expect(listener).toHaveBeenCalledWith(SESSION)
    unsubscribe()
    const before = listener.mock.calls.length
    applySnapshot(snapshot({ maxSeq: 99 }))
    expect(listener.mock.calls.length).toBe(before)
  })

  it('重复应用同一份快照不通知（幂等，省一次渲染）', () => {
    const first = snapshot()
    applySnapshot(first)
    const listener = vi.fn()
    subscribeSessionStore(listener)
    expect(applySnapshot(first)).toBe(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('文本归一：多一个空格也算同一条', () => {
    expect(normalizeQueueText('  a  b ')).toBe('a b')
  })
})

describe('排队条不残留（2026-10-29 真机：发送完 / 插队后消息条还在）', () => {
  it('队首被认领后，一份「还没算上认领」的陈旧快照不能把它画回来', () => {
    resetSessionStoreForTest()
    const items = [
      { id: 'q1', placement: 'queued' as const, text: '第一条', editable: true },
      { id: 'q2', placement: 'queued' as const, text: '第二条', editable: true },
    ]
    applyQueueItems('s-1', items)
    // 回合开始：队首被认领
    claimQueueHead('s-1')
    expect(queueView('s-1').map(row => row.id)).toEqual(['q2'])
    // 弱网：又来了一份认领之前的快照（两条都在）
    applyQueueItems('s-1', items)
    expect(queueView('s-1').map(row => row.id)).toEqual(['q2'])
  })

})

describe('队列内容指纹（2026-10-30 桌面端入队看不到）', () => {
  it('queueRevision 不变、但内容指纹变了 → 必须换成宿主的权威队列', () => {
    // 真机：桌面端点了一条排队消息，宿主那边 queue=1，手机 25 秒都没出现排队条。
    // 原因是受理判据只看 queueRevision，而它只由**手机端自己的写操作**递增。
    applySnapshot(snapshot({ queue: [], queueRevision: 3, queueToken: '' }))
    expect(queueView(SESSION)).toHaveLength(0)

    const incoming = [item('q1', '桌面端排的消息')]
    applySnapshot(snapshot({ queue: incoming, queueRevision: 3, queueToken: 'q1:8' }))
    expect(queueView(SESSION).map(entry => entry.text)).toEqual(['桌面端排的消息'])
  })

  it('内容指纹相同（只是重复轮询）→ 判为无变化', () => {
    const incoming = [item('q1', '同一条')]
    applySnapshot(snapshot({ queue: incoming, queueRevision: 1, queueToken: 'q1:3' }))
    // 同一个克隆再应用一次：状态没变就不许报告 changed（避免多余重渲染）。
    const changed = applySnapshot(snapshot({ queue: [...incoming], queueRevision: 1, queueToken: 'q1:3' }))
    expect(changed).toBe(false)
    expect(queueView(SESSION).map(entry => entry.text)).toEqual(['同一条'])
  })

  it('老宿主没有 queueToken 时退回 queueRevision 判据（不破坏兼容）', () => {
    applySnapshot(snapshot({ queue: [], queueRevision: 1 }))
    applySnapshot(snapshot({ queue: [item('q2', '旧宿主')], queueRevision: 2 }))
    expect(queueView(SESSION)).toHaveLength(1)
  })
})
