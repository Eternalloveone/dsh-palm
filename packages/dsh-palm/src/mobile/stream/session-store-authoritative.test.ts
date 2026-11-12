// @vitest-environment node
/**
 * 「队列读数可不可信」（2026-11-10 真机：「消息都排队了，却突然回撤到输入框」）。
 *
 * 排队消息对账靠 `queueView()` 判断"还在不在队列里"，但它在两种情况下会返回空，
 * 而那个空**不是证据**：
 *   ① 重订阅基线生效中（断线重连，宿主还没给出更新的队列）；
 *   ② 这个会话还没有任何快照。
 * 少了这层判断，一次重连就会把还躺在宿主队列里的消息判成丢失、塞回输入框，
 * 等队列快照回来又出现一张排队卡片 —— 同一条消息同时出现在两个地方。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyQueueItems,
  applySnapshot,
  claimQueueHead,
  queueAuthoritative,
  queueView,
  rebaselineQueueView,
  resetSessionStoreForTest,
  type SessionSnapshot,
} from './session-store.ts'

const SESSION = 's-authoritative'

const snapshot = (queueRevision: number): SessionSnapshot => ({
  sessionId: SESSION,
  rows: [],
  maxSeq: 1,
  queue: [],
  queueRevision,
  turn: { running: false },
  asOf: 1_700_000_000_000,
})

beforeEach(() => { resetSessionStoreForTest() })

describe('queueAuthoritative', () => {
  it('还没有这个会话：算可信（没有旧读数可陈旧，冷启动要允许回填）', () => {
    expect(queueAuthoritative(SESSION)).toBe(true)
  })

  it('正常快照下：可信', () => {
    applySnapshot(snapshot(3))
    expect(queueAuthoritative(SESSION)).toBe(true)
  })

  it('重连基线生效、宿主还没给更新的队列：不可信（这正是回撤的元凶）', () => {
    applySnapshot(snapshot(3))
    rebaselineQueueView(SESSION)
    expect(queueAuthoritative(SESSION)).toBe(false)
    // 而 queueView() 此刻确实返回空 —— 空不等于丢失。
    expect(queueView(SESSION)).toEqual([])
  })

  it('重连后收到了更新的一版队列：恢复可信', () => {
    applySnapshot(snapshot(3))
    rebaselineQueueView(SESSION)
    applySnapshot(snapshot(4))
    expect(queueAuthoritative(SESSION)).toBe(true)
  })

  it('重连后又收到同样旧的一版：仍然不可信（不能拿旧数据当证据）', () => {
    applySnapshot(snapshot(3))
    rebaselineQueueView(SESSION)
    applySnapshot(snapshot(3))
    expect(queueAuthoritative(SESSION)).toBe(false)
  })
})

/**
 * 2026-11-10 真机：「以前的排队消息条又会出现」——已发送的那条在排队卡里复活，
 * 点删除回「这条已经不在队列里了」。根因：认领只留了 90 秒的隐藏标记，
 * 而宿主队列投影能慢好几分钟 —— TTL 一过，陈旧快照就把那条画回来。
 * 现在认领是不过期的事实：正文已经在对话里就不再画。
 */
describe('认领过的队列项不会在 TTL 之后复活', () => {
  const SESSION2 = 's-ghost'
  const stale = (revision: number): SessionSnapshot => ({
    sessionId: SESSION2,
    // 已经进了对话的那条（spokenTexts 的来源）
    rows: [{ id: 'm1', kind: 'user', text: '改个词', seq: 1 } as never],
    queue: [{ id: 'q1', placement: 'queued', text: '改个词', editable: true } as never],
    maxSeq: 1,
    queueRevision: revision,
    // 新宿主（带内容指纹）：关掉「老宿主投影残留」那条兜底判据，单独验认领。
    queueToken: 'tok-' + revision,
    turn: { running: true },
    asOf: 1_700_000_000_000,
  })

  it('宿主投影一直不收敛：过了隐藏 TTL 也不再显示', () => {
    const base = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(base)
    try {
      applySnapshot(stale(1))
      expect(queueView(SESSION2).map(item => item.id)).toEqual(['q1'])
      claimQueueHead(SESSION2)
      expect(queueView(SESSION2)).toHaveLength(0)
      // 90 秒之后再收到同一份陈旧投影（宿主投影慢了几分钟的真实形状）
      clock.mockReturnValue(base + 10 * 60_000)
      applySnapshot(stale(2))
      expect(queueView(SESSION2)).toHaveLength(0)
    } finally {
      clock.mockRestore()
    }
  })
})

/**
 * 2026-11-10 架构修法：宿主给队列一个**单调版本**（只在事件时 +1，读投影不推进）。
 * 客户端据此做「版本栅栏」：版本不更新的快照，哪怕内容不一样（陈旧投影），也不许改队列。
 */
describe('队列版本栅栏', () => {
  const S = 's-fence'
  const queueItem = (id: string, text: string): never => ({ id, placement: 'queued', text, editable: true } as never)
  const snap = (version: number, ids: string[]): SessionSnapshot => ({
    sessionId: S,
    rows: [],
    maxSeq: 1,
    queue: ids.map(id => queueItem(id, id)),
    queueRevision: version,
    queueVersion: version,
    turn: { running: false },
    asOf: 1_700_000_000_000,
  })

  it('同版本的陈旧投影不许把已经取走的条画回来', () => {
    applySnapshot(snap(2, ['q1']))
    expect(queueView(S).map(item => item.id)).toEqual(['q1'])
    // 队首被取走：版本 +1、队列空
    applySnapshot(snap(3, []))
    expect(queueView(S)).toHaveLength(0)
    // 宿主的陈旧投影又带着那条（同一版本 = 队列没变过）→ 不许复活
    applySnapshot(snap(3, ['q1']))
    expect(queueView(S)).toHaveLength(0)
  })

  it('更高版本照常应用（桌面新排的那条能看见）', () => {
    applySnapshot(snap(3, []))
    applySnapshot(snap(4, ['q9']))
    expect(queueView(S).map(item => item.id)).toEqual(['q9'])
  })
})

/** 帧路径也走同一道栅栏：比已应用版本旧（或同版本）的帧不许改队列。 */
describe('队列帧的版本栅栏', () => {
  const S = 's-frame-fence'
  const view = (id: string, text: string): never => ({ id, placement: 'queued', text, editable: true } as never)

  it('先到的帧定基线，同样版本的陈旧帧不再改队列', () => {
    applyQueueItems(S, [view('q1', '一')], 5)
    expect(queueView(S).map(item => item.id)).toEqual(['q1'])
    // 同一版本：内容没变过（宿主只在事件时 +1），这条是陈旧投影 → 忽略
    applyQueueItems(S, [], 5)
    expect(queueView(S).map(item => item.id)).toEqual(['q1'])
    // 版本推进 = 真的有事件 → 照常应用
    applyQueueItems(S, [], 6)
    expect(queueView(S)).toHaveLength(0)
  })
})

/** 宿主进程重启 → 计数器归零：重订阅基线必须把版本基准一起作废，否则队列冻结。 */
describe('重订阅后版本基准作废', () => {
  const S = 's-rebaseline-version'
  const snap = (version: number, ids: string[]): SessionSnapshot => ({
    sessionId: S,
    rows: [],
    maxSeq: 1,
    queue: ids.map(id => ({ id, placement: 'queued', text: id, editable: true } as never)),
    queueRevision: 1,
    queueVersion: version,
    turn: { running: false },
    asOf: 1_700_000_000_000,
  })

  it('新连接之后，更小的版本照常接受（重启场景）', () => {
    applySnapshot(snap(9, ['q1']))
    expect(queueView(S).map(item => item.id)).toEqual(['q1'])
    rebaselineQueueView(S)
    applySnapshot(snap(1, ['q2']))
    expect(queueView(S).map(item => item.id)).toEqual(['q2'])
  })
})
