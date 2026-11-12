// @vitest-environment node
/**
 * `applyQueueAck`：写操作应答里的权威队列直接落仓（方案 A，2026-11-10）。
 *
 * 这条判据取代了"乐观项 + TTL + 正文比对"的猜测链：
 * 应答带了 `{queue, queueVersion}` 就以它为准；老宿主不带就返回 false，退回旧路径。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { applyQueueAck, applyQueueItems, applyQueueMutation, applySnapshot, resetSessionStoreForTest, queueView } from './session-store.ts'
import type { QueueItemView } from '../api.ts'

const SESSION = 's-1'

function item(id: string, text: string): QueueItemView {
  return { id, placement: 'queued', text, editable: true }
}

beforeEach(() => {
  resetSessionStoreForTest()
})

describe('applyQueueAck', () => {
  it('应答带 queue + 版本 → 当作权威队列落地', () => {
    const applied = applyQueueAck(SESSION, { queue: [item('q1', '第一条')], queueVersion: 3 })
    expect(applied).toBe(true)
    expect(queueView(SESSION).map(entry => entry.id)).toEqual(['q1'])
  })

  it('老宿主不带字段 → 不应用（返回 false，走旧路径）', () => {
    expect(applyQueueAck(SESSION, undefined)).toBe(false)
    expect(applyQueueAck(SESSION, {})).toBe(false)
    expect(applyQueueAck(SESSION, { queue: [item('q1', 'x')] })).toBe(false)
    expect(queueView(SESSION)).toHaveLength(0)
  })

  it('版本更旧的应答不许把队列改回去（栅栏仍然生效）', () => {
    applyQueueAck(SESSION, { queue: [item('q2', '新的')], queueVersion: 5 })
    applyQueueAck(SESSION, { queue: [item('q1', '旧的')], queueVersion: 4 })
    expect(queueView(SESSION).map(entry => entry.id)).toEqual(['q2'])
  })

  /**
   * 2026-11-11 真机：「点完发送，排队条得退出重进才出现」。
   *
   * 宿主的队列版本只在**内容变化**时推进（`queueVersionForRead`），所以刚发完的那次
   * 应答常常和客户端手里的版本**相同**、但内容更新（客户端那个号来自事件帧）。
   * 同版本要收，否则界面就停在空队列上，只能靠重订阅清掉版本基准才看得到。
   */
  it('同版本但内容更全的应答要收（发送后立刻出现排队条）', () => {
    applyQueueItems(SESSION, [], 7)
    const applied = applyQueueAck(SESSION, { queue: [item('q1', '刚排上的')], queueVersion: 7 })
    expect(applied).toBe(true)
    expect(queueView(SESSION).map(entry => entry.id)).toEqual(['q1'])
  })

  it('投影/轮询快照仍然只认严格更新的版本（同版本不许回写）', () => {
    applyQueueAck(SESSION, { queue: [item('q1', '在队列里')], queueVersion: 7 })
    const applied = applyQueueItems(SESSION, [], 7)
    expect(applied).toBe(false)
    expect(queueView(SESSION).map(entry => entry.id)).toEqual(['q1'])
  })
  it('会话已有快照时，权威应答也要能覆盖它（否则界面读的是旧 snapshot.queue）', () => {
    applySnapshot({
      sessionId: SESSION,
      rows: [],
      maxSeq: 3,
      queue: [item('old', '快照里的旧队列')],
      queueRevision: 1,
      queueVersion: 2,
      turn: { running: true },
      asOf: Date.now(),
    })
    expect(queueView(SESSION).map(entry => entry.id)).toEqual(['old'])
    applyQueueAck(SESSION, { queue: [item('new', '权威队列')], queueVersion: 9 })
    expect(queueView(SESSION).map(entry => entry.id)).toEqual(['new'])
  })
  it('空队列也是权威事实：删除最后一条后立刻为空', () => {
    applyQueueAck(SESSION, { queue: [item('q1', '最后一条')], queueVersion: 1 })
    applyQueueAck(SESSION, { queue: [], queueVersion: 2 })
    expect(queueView(SESSION)).toHaveLength(0)
  })

  it('更旧的应答被栅栏拒绝时，也不许覆盖快照（否则已删项会被写回）', () => {
    applySnapshot({
      sessionId: SESSION,
      rows: [],
      maxSeq: 3,
      queue: [item('q2', '删剩这条')],
      queueRevision: 2,
      queueVersion: 7,
      turn: { running: true },
      asOf: Date.now(),
    })
    // v6 的应答比快照 v7 旧：栅栏拒绝，快照必须保持 v7 的队列。
    expect(applyQueueAck(SESSION, { queue: [item('q1', '旧编辑'), item('q2', '删剩这条')], queueVersion: 6 })).toBe(false)
    expect(queueView(SESSION).map(entry => entry.id)).toEqual(['q2'])
  })

  it('见过权威版本后，无版本投影不许再改队列（轮询补发的陈旧 inbox）', () => {
    applyQueueAck(SESSION, { queue: [item('q2', '留着')], queueVersion: 7 })
    // 轮询补发的 inbox 没有 queueVersion：不能把已删除的 q1 写回来。
    applyQueueItems(SESSION, [item('q1', '幽灵'), item('q2', '留着')])
    expect(queueView(SESSION).map(entry => entry.id)).toEqual(['q2'])
  })
})

describe('applyQueueMutation（老宿主：RPC 成功即事实）', () => {
  it('删除：这一条立刻离开队列，且陈旧投影画不回来', () => {
    applySnapshot({
      sessionId: SESSION,
      rows: [],
      maxSeq: 5,
      queue: [item('q1', '删我'), item('q2', '留着')],
      queueRevision: 2,
      turn: { running: true },
      asOf: 1,
    })
    expect(applyQueueMutation(SESSION, 'q1', 'remove')).toBe(true)
    expect(queueView(SESSION).map(entry => entry.id)).toEqual(['q2'])
    // 同一份（还含 q1 的）快照再来一次：认领墓碑挡住它。
    applySnapshot({
      sessionId: SESSION,
      rows: [],
      maxSeq: 5,
      queue: [item('q1', '删我'), item('q2', '留着')],
      queueRevision: 2,
      turn: { running: true },
      asOf: 1,
    })
    expect(queueView(SESSION).map(entry => entry.id)).toEqual(['q2'])
  })

  it('编辑：只换正文，条目还在', () => {
    applySnapshot({
      sessionId: SESSION,
      rows: [],
      maxSeq: 5,
      queue: [item('q1', '旧正文')],
      queueRevision: 2,
      turn: { running: true },
      asOf: 1,
    })
    expect(applyQueueMutation(SESSION, 'q1', 'edit', '新正文')).toBe(true)
    expect(queueView(SESSION).map(entry => entry.text)).toEqual(['新正文'])
  })

  it('没有这个会话 → 什么都不做', () => {
    expect(applyQueueMutation('unknown', 'q1', 'remove')).toBe(false)
  })
})
