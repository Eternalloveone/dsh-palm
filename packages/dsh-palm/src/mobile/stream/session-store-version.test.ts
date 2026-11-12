// @vitest-environment node
/**
 * 会话仓的**变更版本**（W3-6 第一步：队列视图改成只读投影）。
 *
 * 为什么要有它：`queueView()` 每次调用都新建一个数组、而且判据里带 `Date.now()`
 * （乐观项 TTL、空队列观察窗），所以它不能直接塞进 `useSyncExternalStore` 的
 * getSnapshot —— React 要求快照在两次渲染之间引用稳定，否则会无限重渲染。
 *
 * 折中方案：视图只订阅"版本号"这个稳定的数字，版本变了才重算 `queueView()`。
 * 于是**事实仍然只在仓里**：视图不再持有队列数组，也就没有第二份可以漂移的副本。
 *
 * 这里钉住版本号的三条契约：只在本会话真的发布变化时上涨、别的会话不影响它、
 * reset 归零（测试隔离）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyQueueItems,
  resetSessionStoreForTest,
  sessionStoreVersion,
  subscribeSessionStore,
} from './session-store.ts'
import type { QueueItemView } from '../api.ts'

const SESSION = 's-1'

function item(id: string, text: string): QueueItemView {
  return { id, placement: 'queued', text, editable: true }
}

beforeEach(() => {
  resetSessionStoreForTest()
})

describe('sessionStoreVersion', () => {
  it('没有任何写入时版本保持不动（快照必须稳定）', () => {
    expect(sessionStoreVersion(SESSION)).toBe(0)
    expect(sessionStoreVersion(SESSION)).toBe(0)
  })

  it('写队列才涨；每个会话各自计数', () => {
    const before = sessionStoreVersion(SESSION)
    applyQueueItems(SESSION, [item('q1', '排队中')])
    expect(sessionStoreVersion(SESSION)).toBeGreaterThan(before)
    expect(sessionStoreVersion('s-2')).toBe(0)
  })


  it('版本上涨和订阅通知是同一件事（不会出现"通知了但版本没变"）', () => {
    let seen = 0
    const unsubscribe = subscribeSessionStore(changed => {
      if (changed === SESSION) seen = sessionStoreVersion(SESSION)
    })
    applyQueueItems(SESSION, [item('q1', '排队中')])
    unsubscribe()
    expect(seen).toBe(sessionStoreVersion(SESSION))
  })

  it('reset 之后版本归零（测试隔离）', () => {
    applyQueueItems(SESSION, [item('q1', '排队中')])
    expect(sessionStoreVersion(SESSION)).toBeGreaterThan(0)
    resetSessionStoreForTest()
    expect(sessionStoreVersion(SESSION)).toBe(0)
  })
})
