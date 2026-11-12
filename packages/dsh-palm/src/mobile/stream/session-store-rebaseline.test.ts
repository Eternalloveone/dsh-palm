// @vitest-environment node
/**
 * 队列视图的「重订阅基线」（W3-6 第一步的配套语义）。
 *
 * `session/subscribed` 到达时，桌面前端会把队列镜像清空：那是**新一条连接**的
 * 起点，之前那份队列可能已经过期。手机上原来清的是组件里的镜像数组；队列改成
 * 仓的只读投影之后，这个"清空"必须由仓来表达（否则视图没有第二份可以清）。
 *
 * 语义定得很小：
 * - `rebaselineQueueView` 记下"当前看到的队列版本"；在此之后，直到宿主给出**更新的**
 *   队列（`session/queue` 帧或更高 revision 的快照），视图都是空的。
 * - 同 revision 的旧快照重放**不**算新数据 —— 否则一收到重放就又画回来，等于没清。
 * - 新队列一到（任何来源）基线自动失效，不需要调用方再清一次。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyQueueItems,
  applySnapshot,
  queueView,
  rebaselineQueueView,
  resetSessionStoreForTest,
  type SessionSnapshot,
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

describe('rebaselineQueueView', () => {
  it('重订阅后旧队列立刻不画，下一帧新队列再回来', () => {
    applyQueueItems(SESSION, [item('q1', '排队中')])
    expect(queueView(SESSION).map(row => row.id)).toEqual(['q1'])

    rebaselineQueueView(SESSION)
    expect(queueView(SESSION)).toEqual([])

    applyQueueItems(SESSION, [item('q2', '新的一条')])
    expect(queueView(SESSION).map(row => row.id)).toEqual(['q2'])
  })

  it('同 revision 的快照重放不算新数据（不能把清掉的队列画回来）', () => {
    applySnapshot(snapshot({ queueRevision: 3, queue: [item('q1', '排队中')] }))
    rebaselineQueueView(SESSION)
    expect(queueView(SESSION)).toEqual([])

    applySnapshot(snapshot({ queueRevision: 3, queue: [item('q1', '排队中')] }))
    expect(queueView(SESSION)).toEqual([])
  })

  it('更高 revision 的快照算新数据', () => {
    applySnapshot(snapshot({ queueRevision: 3, queue: [item('q1', '排队中')] }))
    rebaselineQueueView(SESSION)
    applySnapshot(snapshot({ queueRevision: 4, queue: [item('q1', '排队中')] }))
    expect(queueView(SESSION).map(row => row.id)).toEqual(['q1'])
  })

  it('没有快照时按回退队列的基线判断，空队列也照样是空', () => {
    applyQueueItems(SESSION, [item('q1', '排队中')])
    rebaselineQueueView(SESSION)
    expect(queueView(SESSION)).toEqual([])
    // 空帧到达：仍然是空，但基线已被这一帧消费掉
    applyQueueItems(SESSION, [])
    expect(queueView(SESSION)).toEqual([])
  })
})
