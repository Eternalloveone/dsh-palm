/**
 * 抽屉会话行的纯函数契约（2026-11-10「只剩当前会话」的回归网）。
 *
 * 核心断言只有一条：**归属靠 `cwd` 路径这个事实，不靠带 TTL 的 `sessionIds` 索引**。
 * 索引落后时（只剩当前会话那条），按索引过滤会把整张列表滤没 —— 这就是实机看到的样子。
 *
 * 行右侧「什么时候」的文案已搬到 `ui/drawer-when.test.ts`（函数也住 ui 层了）。
 */
import { describe, expect, it } from 'vitest'
import { countRunningElsewhere, mergeDrawerRows, orderDrawerRows, paintDrawerRows, pathKey, scopedToWorkspace } from './drawer-rows.ts'
import { drawerBucketOf } from '../ui/session-drawer.tsx'
import type { SessionView } from '../shared/session-view.ts'

const view = (sessionId: string, updatedAt: number, cwd?: string, title = sessionId): SessionView => ({
  sessionId,
  title,
  updatedAt,
  running: false,
  blank: false,
  ...(cwd === undefined ? {} : { cwd }),
})

describe('pathKey', () => {
  it('反斜杠/大小写/尾斜杠都归一', () => {
    expect(pathKey('D:\\work\\dsh-palm\\')).toBe('d:/work/dsh-palm')
    expect(pathKey('d:/WORK/Dsh-Palm')).toBe('d:/work/dsh-palm')
    expect(pathKey(undefined)).toBe('')
  })
})

describe('scopedToWorkspace', () => {
  const rows = [
    view('s1', 300, 'D:\\work\\dsh-palm'),
    view('s2', 200, 'D:\\work\\dsh-palm\\packages\\palm'),
    view('s3', 100, 'D:\\work\\ICNT9388'),
    view('s4', 50),
  ]

  it('按 cwd 过滤：工作区目录本身与它下面的子目录都算', () => {
    const scoped = scopedToWorkspace(rows, { path: 'D:\\work\\dsh-palm', sessionIds: [] })
    expect(scoped.map(row => row.sessionId)).toEqual(['s1', 's2'])
  })

  it('索引落后（sessionIds 只有当前这一条）时仍按路径给全量，不会只剩当前会话', () => {
    const scoped = scopedToWorkspace(rows, { path: 'D:\\work\\dsh-palm', sessionIds: ['s1'] })
    expect(scoped.map(row => row.sessionId)).toEqual(['s1', 's2'])
  })

  it('没有 cwd 的老宿主：退回 sessionIds', () => {
    const legacy = [view('a', 10), view('b', 20)]
    const scoped = scopedToWorkspace(legacy, { path: 'D:\\work\\x', sessionIds: ['b'] })
    expect(scoped.map(row => row.sessionId)).toEqual(['b'])
  })

  it('路径与索引都没命中：整页信任宿主（宿主已经过滤过）', () => {
    const scoped = scopedToWorkspace(rows, { path: 'D:\\work\\elsewhere', sessionIds: ['zzz'] })
    expect(scoped.map(row => row.sessionId)).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('路径大小写/斜杠不同也算同一个工作区', () => {
    const scoped = scopedToWorkspace([view('s1', 1, 'd:/WORK/dsh-palm/')], { path: 'D:\\work\\dsh-palm' })
    expect(scoped.map(row => row.sessionId)).toEqual(['s1'])
  })
})

describe('orderDrawerRows（抽屉的排序只此一处）', () => {
  const row = (id: string, updatedAt: number) => ({ sessionId: id, title: id, preview: undefined, turns: undefined, cwd: undefined, running: false, blank: false, updatedAt })

  it('当前会话钉在第一行，其余按更新时间从新到旧', () => {
    const rows = [row('a', 300), row('b', 100), row('cur', 500)]
    // cur 本来就是最新：顺序不变
    expect(orderDrawerRows(rows, 'cur').map(r => r.sessionId)).toEqual(['cur', 'a', 'b'])
    // cur 是最老的那条：仍然钉第一行（不是掉到最后）
    const old = [row('a', 300), row('cur', 50), row('b', 100)]
    expect(orderDrawerRows(old, 'cur').map(r => r.sessionId)).toEqual(['cur', 'a', 'b'])
  })

  it('同一份数据永远给出同一个顺序（同刻按 sessionId 兜底）', () => {
    const rows = [row('b', 100), row('a', 100), row('c', 100)]
    expect(orderDrawerRows(rows).map(r => r.sessionId)).toEqual(['a', 'b', 'c'])
    // 入参顺序换了，结果不变
    expect(orderDrawerRows([...rows].reverse()).map(r => r.sessionId)).toEqual(['a', 'b', 'c'])
  })

  it('第一帧与刷新后同一顺序：钉住当前会话 + 时间倒序', () => {
    // 打开时：当前会话（老）+ 缓存行
    const paint = orderDrawerRows([row('cur', 50), row('a', 300), row('b', 100)], 'cur')
    // 一秒后宿主回一页（含更新后的 cur）再合并
    const refreshed = mergeDrawerRows(
      [row('a', 300), row('b', 100), row('cur', 60)],
      paint,
      'cur',
    )
    expect(paint.map(r => r.sessionId)).toEqual(refreshed.map(r => r.sessionId))
  })

  it('钉住的会话不在列表里时退回纯时间排序', () => {
    expect(orderDrawerRows([row('a', 10), row('b', 20)], 'ghost').map(r => r.sessionId)).toEqual(['b', 'a'])
  })
})

/**
 * 2026-11-11 用户：「一打开侧边栏，会话就从『更早』跳到『今天』」。
 *
 * 从 HUD / 搜索 / URL 直接进会话时，路由里的 `updatedAt` 是 0。首帧拿 0 分桶会归「更早」，
 * 后台宿主页一到换成真实时间就跳回今天。所以首帧必须把时间补上。
 */
describe('paintDrawerRows：首帧的时间戳不许是 0', () => {
  it('当前会话 updatedAt=0：用缓存里同一个会话的真实时间', () => {
    const now = new Date(2026, 10, 11, 21, 30).getTime()
    const cached = [view('cur', new Date(2026, 10, 11, 9, 0).getTime()), view('old', new Date(2026, 9, 1).getTime())]
    const rows = paintDrawerRows(view('cur', 0), cached, now)
    expect(rows[0]!.updatedAt).toBe(new Date(2026, 10, 11, 9, 0).getTime())
    expect(drawerBucketOf(rows[0]!.updatedAt, now)).toBe('今天')
  })

  it('缓存里也没有：先用「此刻」，归「今天」而不是「更早」', () => {
    const now = new Date(2026, 10, 11, 21, 30).getTime()
    const rows = paintDrawerRows(view('cur', 0), [], now)
    expect(rows[0]!.updatedAt).toBe(now)
    expect(drawerBucketOf(rows[0]!.updatedAt, now)).toBe('今天')
  })

  it('已经有真实时间的不动它（老会话照样在「更早」）', () => {
    const now = new Date(2026, 10, 11, 21, 30).getTime()
    const old = new Date(2026, 9, 1, 10, 0).getTime()
    const rows = paintDrawerRows(view('cur', old), [view('cur', now)], now)
    expect(rows[0]!.updatedAt).toBe(old)
    expect(drawerBucketOf(rows[0]!.updatedAt, now)).toBe('更早')
  })
})

describe('mergeDrawerRows', () => {
  it('并集去重、按更新时间倒序，宿主回空页也不清空已在显示的行', () => {
    const shown = [view('cur', 100, 'D:\\work\\dsh-palm', '当前会话')]
    expect(mergeDrawerRows([], shown).map(row => row.sessionId)).toEqual(['cur'])
    const merged = mergeDrawerRows([view('new', 300), view('cur', 100)], shown)
    expect(merged.map(row => row.sessionId)).toEqual(['new', 'cur'])
  })

  it('同一会话以宿主这一页为准（标题等字段更新），不会出现两行', () => {
    const merged = mergeDrawerRows([view('s', 5, undefined, '新标题')], [view('s', 5, undefined, '旧标题')])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.title).toBe('新标题')
  })

  /**
   * 真机 2026-11-11：「每次打开侧边栏，会话次序就重新变动」。
   *
   * 运行中的会话 updatedAt 每几秒刷新一次；合并时若按 updatedAt 重排，它每次
   * 打开都会往上浮一位。合并必须**保住正在显示的顺序**，只换字段。
   */
  it('宿主页让某行 updatedAt 变大时不重排（打开过程中顺序冻结）', () => {
    const shown = [view('a', 100), view('b', 200)]
    const merged = mergeDrawerRows([view('a', 900), view('b', 200)], shown)
    expect(merged.map(row => row.sessionId)).toEqual(['a', 'b'])
    // 字段仍然更新成了宿主那一版（时间变大 = 它确实有新活动）
    expect(merged[0]!.updatedAt).toBe(900)
  })

  it('宿主页里的新会话按时间插到应该在的位置，不一律追加到末尾', () => {
    const shown = [view('a', 100), view('b', 50)]
    const merged = mergeDrawerRows([view('a', 100), view('b', 50), view('new', 300), view('mid', 75)], shown)
    expect(merged.map(row => row.sessionId)).toEqual(['new', 'a', 'mid', 'b'])
  })
})

/**
 * 「别的工作区还有几个任务在跑」（2026-11-12 真机）。
 *
 * 抽屉只列当前工作区的会话，权威运行集合却是全局的 —— 两者一减就是用户"看不见"
 * 的那部分。这里钉住三件事：算的是差集、重复 id 只算一次、全是眼前的行时给 0。
 */
describe('countRunningElsewhere', () => {
  const row = (sessionId: string): SessionView => ({ sessionId, title: sessionId, updatedAt: 1, running: false, blank: false })

  it('只数抽屉里没画出来的那些会话', () => {
    expect(countRunningElsewhere([row('a'), row('b')], ['a', 'x', 'y'])).toBe(2)
  })

  it('都在抽屉里时是 0（没有别处在跑）', () => {
    expect(countRunningElsewhere([row('a'), row('b')], ['b', 'a'])).toBe(0)
  })

  it('集合里重复出现的同一个 id 只算一次', () => {
    expect(countRunningElsewhere([], ['x', 'x', 'x'])).toBe(1)
  })

  it('抽屉为空时等于整个运行集合的大小（首帧就是这个形态）', () => {
    expect(countRunningElsewhere([], ['a', 'b'])).toBe(2)
  })
})
