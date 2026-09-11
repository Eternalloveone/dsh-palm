/**
 * 观察登记表：手机端"正在看哪个会话"的宿主侧状态。
 *
 * 它是实时助手流的开关（见 api-proxy-stream.ts），所以这组测试锁住三条语义：
 * 按设备登记与覆盖、断开释放、以及变化通知（含订阅时的立即回调，让桥一启动就
 * 对齐当前集合）。
 */
import { describe, expect, it } from 'vitest'
import { SessionObserverRegistry } from './api-proxy-observe.ts'

describe('SessionObserverRegistry', () => {
  it('tracks one session per device and de-duplicates the observed set', () => {
    const registry = new SessionObserverRegistry()
    registry.observe('dev-a', 's-1')
    registry.observe('dev-b', 's-1')
    registry.observe('dev-c', 's-2')
    expect(registry.sessions().sort()).toEqual(['s-1', 's-2'])

    // 切换会话 = 覆盖登记，不产生第二个条目。
    registry.observe('dev-a', 's-3')
    expect(registry.sessions().sort()).toEqual(['s-1', 's-2', 's-3'])

    // 离开会话（undefined）与断开（release）都只影响该设备。
    registry.observe('dev-c', undefined)
    expect(registry.sessions().sort()).toEqual(['s-1', 's-3'])
    registry.release('dev-a')
    expect(registry.sessions()).toEqual(['s-1'])
  })

  it('notifies on real changes only, and immediately on subscribe', () => {
    const registry = new SessionObserverRegistry()
    const seen: string[][] = []
    const dispose = registry.onChange(ids => { seen.push([...ids]) })
    // 订阅时的立即回调：桥启动即对齐当前集合。
    expect(seen).toEqual([[]])

    registry.observe('dev-a', 's-1')
    // 重复登记同一会话不重复通知。
    registry.observe('dev-a', 's-1')
    expect(seen).toHaveLength(2)

    registry.observe('dev-a', 's-2')
    registry.release('dev-a')
    // 已经空闲的设备再释放一次不通知。
    registry.release('dev-a')
    expect(seen).toEqual([[], ['s-1'], ['s-2'], []])

    dispose()
    registry.observe('dev-b', 's-9')
    expect(seen).toHaveLength(4)
  })

  it('ignores an empty device id', () => {
    const registry = new SessionObserverRegistry()
    registry.observe('', 's-1')
    expect(registry.sessions()).toEqual([])
  })
})
