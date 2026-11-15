/**
 * 抽屉行只认「镜像口径」的运行集合（列表行的 running 会撒谎）。
 *
 * 2026-11-15 真机：「点开侧边栏，运行中突然消失 / 从完成变成运行中」。四个写者各有
 * 质量差：帧最准但只有本设备订阅的会话才有、宿主集合会为漏掉的 turn/end 继续挂五分钟、
 * `session.list` 每行自带的 running 会撒谎、落盘缓存行把旧值持久化。
 * 这里钉住"列表页永远不许写 running"与"首帧只升不降"。
 */
import { describe, expect, it } from 'vitest'
import { applyRunningState, mergeDrawerRows, promoteRunning } from './drawer-rows.ts'
import type { SessionView } from '../shared/session-view.ts'

const row = (sessionId: string, running: boolean): SessionView => ({
  sessionId,
  title: sessionId,
  updatedAt: 0,
  running,
  blank: false,
} as SessionView)

describe('applyRunningState', () => {
  it('把列表里说"没在跑"的行改成正在跑（会话刚开跑，列表还没更新）', () => {
    const rows = [row('a', false), row('b', false)]
    const next = applyRunningState(rows, ['b'])
    expect(next.map(item => item.running)).toEqual([false, true])
  })

  it('把列表里说"在跑"但实际已经收工的行改回来（完成 → 运行中 的跳变来源）', () => {
    const rows = [row('a', true), row('b', true)]
    const next = applyRunningState(rows, ['a'])
    expect(next.map(item => item.running)).toEqual([true, false])
  })

  it('集合里没有的会话一律不在跑', () => {
    const rows = [row('a', true), row('b', false)]
    expect(applyRunningState(rows, []).every(item => item.running === false)).toBe(true)
  })

  it('状态没变时返回原数组（不触发无意义的整层重渲染）', () => {
    const rows = [row('a', true), row('b', false)]
    expect(applyRunningState(rows, ['a'])).toBe(rows)
  })

  it('集合里是数字/字符串混着也能对上（宿主侧 id 类型不保证）', () => {
    const rows = [row('123', false)]
    expect(applyRunningState(rows, [123 as unknown as string])[0]!.running).toBe(true)
  })
})

describe('mergeDrawerRows：列表页不许改写运行状态', () => {
  it('fresh 行说"没在跑"也抹不掉行上已知的「运行中」', () => {
    // 「运行中 突然消失」的直达路径：列表页的 running 落后于权威集合，而合并在它之后跑，
    // 最后写入者获胜 —— 一次覆盖就把绿点抹掉，4 秒后轮询又补回来，徽标自己闪。
    const merged = mergeDrawerRows([row('a', false)], [row('a', true)])
    expect(merged[0]!.running).toBe(true)
  })

  it('标题/时间/预览仍然以 fresh 为准', () => {
    const shown = [{ ...row('a', true), title: '旧标题', updatedAt: 1 }]
    const fresh = [{ ...row('a', false), title: '新标题', updatedAt: 2 }]
    const merged = mergeDrawerRows(fresh, shown)[0]!
    expect(merged.title).toBe('新标题')
    expect(merged.updatedAt).toBe(2)
    expect(merged.running).toBe(true)
  })

  it('只在新行上采用 fresh 的 running（随后由镜像纠正）', () => {
    const merged = mergeDrawerRows([row('b', true)], [row('a', false)])
    expect(merged.find(item => item.sessionId === 'b')!.running).toBe(true)
  })
})

describe('promoteRunning：首帧只升不降', () => {
  it('把镜像里在跑的行点亮', () => {
    const next = promoteRunning([row('a', false), row('b', false)], ['b'])
    expect(next.map(item => item.running)).toEqual([false, true])
  })

  it('镜像还冷（空集）时一行都不动 —— 不许把所有行一次性判成收工', () => {
    const rows = [row('a', true), row('b', false)]
    expect(promoteRunning(rows, [])).toBe(rows)
  })

  it('没有行被点亮时返回原数组', () => {
    const rows = [row('a', true)]
    expect(promoteRunning(rows, ['a'])).toBe(rows)
  })
})
