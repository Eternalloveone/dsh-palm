// @vitest-environment node
/**
 * session-store：一个会话一份权威状态。
 *
 * 这组用例钉的就是真机上那三条不稳定：队列滞后（乐观项）、插队后回跳（版本单调）、
 * 进出会话刷新（缓存秒开 + 低水位快照不许覆盖高水位）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addOptimisticQueueItem, applyQueueItems, applySnapshot, cachedRows, cachedSnapshot, dropOptimisticQueueItem, hideQueueItem, normalizeQueueText, queueView, resetSessionStoreForTest, settleOptimisticQueueItem, subscribeSessionStore, unhideQueueItem, type SessionSnapshot, QUEUE_EMPTY_HOLD_MS,
  claimQueueHead,
} from './session-store.ts'
import type { QueueItemView } from './api.ts'

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

describe('乐观项（点发送立刻看得见）', () => {
  it('刚点发送、宿主还没回：队列里立刻有这一条', () => {
    applySnapshot(snapshot({ queueRevision: 7, queue: [] }))
    addOptimisticQueueItem(SESSION, { text: '帮我看下这个报错', placement: 'queued' })
    expect(queueView(SESSION).map(row => row.text)).toEqual(['帮我看下这个报错'])
  })

  it('宿主快照把这条排进来之后，乐观项退场（不会重复两条）', () => {
    applySnapshot(snapshot({ queueRevision: 7, queue: [] }))
    addOptimisticQueueItem(SESSION, { text: '同一条', placement: 'queued' })
    // 宿主把它排进队列：版本 +1，条目里带着同一条文本。
    applySnapshot(snapshot({ queueRevision: 8, queue: [item('q9', '同一条')] }))
    expect(queueView(SESSION)).toEqual([item('q9', '同一条')])
  })

  it('版本翻过但条目还没到：乐观项必须留着（真机 bug：曾经这里就被清空了）', () => {
    applySnapshot(snapshot({ queueRevision: 7, queue: [] }))
    addOptimisticQueueItem(SESSION, { text: '还没回显', placement: 'queued' })
    // 宿主把写收下了（版本 +1），但它读的是几分钟前的投影快照：队列里还没有这一条。
    applySnapshot(snapshot({ queueRevision: 8, queue: [] }))
    expect(queueView(SESSION).map(row => row.text)).toEqual(['还没回显'])
  })

  it('超过 45 秒还没被认下来：乐观项退场，不留幽灵卡', async () => {
    vi.useFakeTimers()
    try {
      applySnapshot(snapshot({ queueRevision: 7, queue: [] }))
      addOptimisticQueueItem(SESSION, { text: '早就投递了', placement: 'queued' })
      vi.advanceTimersByTime(46_000)
      expect(queueView(SESSION)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('写失败要能撤掉乐观项（不留假条目）', () => {
    applySnapshot(snapshot({ queueRevision: 1, queue: [] }))
    const pendingId = addOptimisticQueueItem(SESSION, { text: '发不出去的', placement: 'queued' })
    expect(queueView(SESSION)).toHaveLength(1)
    dropOptimisticQueueItem(SESSION, pendingId)
    expect(queueView(SESSION)).toEqual([])
  })

  it('成功后立刻退场，不必等下一次快照', () => {
    const pendingId = addOptimisticQueueItem(SESSION, { text: '插队', placement: 'steering' })
    expect(queueView(SESSION)).toHaveLength(1)
    settleOptimisticQueueItem(SESSION, pendingId)
    expect(queueView(SESSION)).toEqual([])
  })
})

describe('本地隐藏（删除/插队立刻生效）', () => {
  it('删除立刻看不到，宿主版本跟上之后隐藏自动失效', () => {
    applySnapshot(snapshot({ queueRevision: 5, queue: [item('q1', '删掉我')] }))
    hideQueueItem(SESSION, 'q1')
    expect(queueView(SESSION)).toEqual([])
    // 宿主把这次删除处理完（版本 +1）：隐藏退场，之后的权威队列说了算。
    applySnapshot(snapshot({ queueRevision: 6, queue: [item('q2', '另一条')] }))
    expect(queueView(SESSION).map(row => row.text)).toEqual(['另一条'])
  })

  it('被拒时把隐藏撤掉（条目回到队列）', () => {
    applySnapshot(snapshot({ queueRevision: 5, queue: [item('q1', '插不进去')] }))
    hideQueueItem(SESSION, 'q1')
    unhideQueueItem(SESSION, 'q1')
    expect(queueView(SESSION).map(row => row.text)).toEqual(['插不进去'])
  })
})

describe('老宿主的回退路径', () => {
  it('只有 inbox 投影时，队列同样进仓（隐藏/乐观项不会把队列清空）', () => {
    applyQueueItems(SESSION, [item('q1', '来自投影')])
    expect(queueView(SESSION).map(row => row.text)).toEqual(['来自投影'])
    hideQueueItem(SESSION, 'q1')
    expect(queueView(SESSION)).toEqual([])
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

describe('深入排查后修掉的三条（2026-10-28 第二轮）', () => {
  it('删除过的条目：宿主版本涨了但快照里还挂着它，不许画回来', () => {
    applySnapshot(snapshot({ queueRevision: 5, queue: [item('q1', '删我')] }))
    hideQueueItem(SESSION, 'q1')
    expect(queueView(SESSION)).toEqual([])
    // 宿主处理了别的写（版本 5→6），但它读的投影快照里 q1 还在。
    applySnapshot(snapshot({ queueRevision: 6, queue: [item('q1', '删我'), item('q2', '新的一条')] }))
    expect(queueView(SESSION).map(row => row.id)).toEqual(['q2'])
  })

  it('删除过的条目：权威队列真的没有它了，隐藏自动解除', () => {
    applySnapshot(snapshot({ queueRevision: 5, queue: [item('q1', '删我')] }))
    hideQueueItem(SESSION, 'q1')
    applySnapshot(snapshot({ queueRevision: 6, queue: [] }))
    expect(queueView(SESSION)).toEqual([])
    // 隐藏解除之后，同 id 万一又出现（宿主重发）就照常显示。
    applySnapshot(snapshot({ queueRevision: 7, queue: [item('q1', '删我')] }))
    expect(queueView(SESSION).map(row => row.id)).toEqual(['q1'])
  })

  it('乐观项在消息进了对话之后就退场（不用等 45 秒）', () => {
    applySnapshot(snapshot({ queueRevision: 3, queue: [] }))
    addOptimisticQueueItem(SESSION, { text: '已经被认领的一条', placement: 'queued' })
    expect(queueView(SESSION)).toHaveLength(1)
    // 宿主把它认领成这一轮的用户消息：对话里出现了同样的文本。
    applySnapshot(snapshot({
      queueRevision: 3,
      maxSeq: 40,
      rows: [{ id: 'r1', kind: 'user', text: '已经被认领的一条' }] as never,
    }))
    expect(queueView(SESSION)).toEqual([])
  })

  it('隐藏表 90 秒兜底：宿主永不收敛也不永久屏蔽', async () => {
    vi.useFakeTimers()
    try {
      applySnapshot(snapshot({ queueRevision: 5, queue: [item('q1', '宿主卡住')] }))
      hideQueueItem(SESSION, 'q1')
      expect(queueView(SESSION)).toEqual([])
      vi.advanceTimersByTime(91_000)
      // 同一份（仍含 q1 的）快照再落地：TTL 已到，隐藏解除，这一条重新显示。
      applySnapshot(snapshot({ queueRevision: 6, queue: [item('q1', '宿主卡住')] }))
      expect(queueView(SESSION).map(row => row.id)).toEqual(['q1'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('空队列观察窗（切后台回来排队条不许凭空消失）', () => {
  const snap = (queue: unknown[], revision: number, now: number): SessionSnapshot => ({
    sessionId: 's-hold',
    rows: [],
    maxSeq: 1,
    queue: queue as SessionSnapshot['queue'],
    queueRevision: revision,
    turn: { running: false },
    asOf: now,
  })
  const item = (id: string, text: string) => ({ id, placement: 'queued' as const, text, editable: true })

  it('读到空队列先不自清：观察窗内仍显示上一条', () => {
    resetSessionStoreForTest()
    applySnapshot(snap([item('a', '排队中')], 1, Date.now()))
    expect(queueView('s-hold')).toHaveLength(1)
    // 宿主投影瞬时回了空队列（版本涨了，内容却是空）
    applySnapshot(snap([], 2, Date.now()))
    expect(queueView('s-hold')).toHaveLength(1)
  })

  it('观察窗过了才真的清空', () => {
    resetSessionStoreForTest()
    const start = Date.now()
    applySnapshot(snap([item('a', '排队中')], 1, start))
    applySnapshot(snap([], 2, start))
    const realNow = Date.now
    try {
      Date.now = () => start + QUEUE_EMPTY_HOLD_MS + 1
      expect(queueView('s-hold')).toHaveLength(0)
    } finally {
      Date.now = realNow
    }
  })

  it('期间又有非空队列回来 → 立刻以新的为准，观察窗作废', () => {
    resetSessionStoreForTest()
    applySnapshot(snap([item('a', '排队中')], 1, Date.now()))
    applySnapshot(snap([], 2, Date.now()))
    applySnapshot(snap([item('b', '后来的')], 3, Date.now()))
    const view = queueView('s-hold')
    expect(view.map(entry => entry.text)).toEqual(['后来的'])
  })
})

describe('排队条的显示来源只有一条（回显只负责“丢件检测”）', () => {
  it('本地回显（queued-echo）不会往队列视图里多塞一条', () => {
    // 这条边界是刻意留的：回显负责“消息其实已经发出去了”的检测（lostQueuedEchoes），
    // 但它**不是**显示来源。显示只认 visibleQueue（宿主队列 + 乐观项 + 隐藏/空窗）。
    resetSessionStoreForTest()
    const view = queueView('session-echo')
    expect(view).toEqual([])
  })

  it('乐观项进了宿主队列后同一条正文只出现一次', () => {
    resetSessionStoreForTest()
    applyQueueItems('session-dup', [
      { id: 'q1', placement: 'queued', text: '刚发的', editable: true },
    ])
    const view = queueView('session-dup')
    expect(view.filter(item => item.text === '刚发的')).toHaveLength(1)
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

  it('插队（立即发送）之后同样的陈旧快照也不会让它回来', () => {
    resetSessionStoreForTest()
    const items = [{ id: 'q9', placement: 'queued' as const, text: '插队这条', editable: true }]
    applyQueueItems('s-2', items)
    hideQueueItem('s-2', 'q9')
    expect(queueView('s-2')).toHaveLength(0)
    applyQueueItems('s-2', items)
    expect(queueView('s-2')).toHaveLength(0)
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
