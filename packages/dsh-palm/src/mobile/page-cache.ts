/**
 * 页面级 cache-first（stale-while-revalidate）：先回上次快照，后台刷新，有变化才通知。
 *
 * 为什么在页面层而不是每个 data 函数里：同一份数据可能被几个视图读，缓存键由
 * 「页面 + 关键参数（会话 / 轮次 / 路径）」决定；视图只订阅快照，不关心是 RPC
 * 还是投影。约定：无快照 → 视图自己画骨架；有快照 → 立刻渲染，刷新失败保留旧快照。
 *
 * 失效：会话切换（invalidateSession）、显式刷新（refreshPage）、写入后由调用方
 * 重新 refreshPage。缓存只在内存里：切页不丢，刷新页面重新拉。
 *
 * @module dsh-palm/mobile/page-cache
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { createCache } from './kernels/cache.ts'

interface PageEntry {
  value?: unknown
  error?: string
}

const entries = createCache<PageEntry>({ maxEntries: 32 })
const listeners = new Map<string, Set<() => void>>()
const inflight = new Map<string, Promise<void>>()

/** 组装缓存键：页面名 + 关键参数；undefined 参数跳过。 */
export function pageKey(page: string, ...params: ReadonlyArray<string | number | undefined>): string {
  return [page, ...params.filter(param => param !== undefined)].join('|')
}

/** 订阅一个键（useSyncExternalStore 的 subscribe）；最后一个订阅者走了就放掉挂起请求。 */
export function subscribePage(key: string, listener: () => void): () => void {
  let set = listeners.get(key)
  if (set === undefined) { set = new Set(); listeners.set(key, set) }
  set.add(listener)
  return () => {
    set.delete(listener)
    // 没有快照的挂起请求不该挡住下一次进入的刷新（组件已经卸载，没人等它了）。
    if (set.size === 0 && entries.get(key)?.value === undefined) inflight.delete(key)
  }
}

function emit(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener()
}

/** 直接种一份快照（预取 / 测试）；内容没变就不惊动订阅者。 */
export function seedPage<T>(key: string, value: T): void {
  const current = entries.get(key)
  if (current?.value !== undefined && JSON.stringify(current.value) === JSON.stringify(value)) return
  entries.set(key, { value })
  emit(key)
}

/**
 * 后台刷新：同键并发只发一次；结果与快照相同就不更新（DOM 不闪）。
 * 失败时保留快照（弱网下页面不该被清空），本来就没数据才记录错误。
 */
export function refreshPage<T>(key: string, load: () => Promise<T>): Promise<void> {
  const pending = inflight.get(key)
  if (pending !== undefined) return pending
  const next = load().then(
    (value) => {
      const current = entries.get(key)
      if (current?.value !== undefined && JSON.stringify(current.value) === JSON.stringify(value)) return
      entries.set(key, { value })
      emit(key)
    },
    (reason: unknown) => {
      if (entries.get(key)?.value !== undefined) return
      entries.set(key, { error: reason instanceof Error ? reason.message : String(reason) })
      emit(key)
    },
  )
  const settled = next.finally(() => { if (inflight.get(key) === settled) inflight.delete(key) })
  inflight.set(key, settled)
  return settled
}

/** 会话切换：所有键里带这个会话 id 的快照全部失效。 */
export function invalidateSession(sessionId: string): void {
  if (sessionId === '') return
  for (const key of [...entries.keys()]) {
    if (!key.split('|').includes(sessionId)) continue
    entries.delete(key)
    emit(key)
  }
}

/** 读快照 + 进页面后台刷新；key 变了（换会话 / 换文件）自动换快照。 */
export function usePage<T>(key: string, load: () => Promise<T>): { value: T | undefined; error: string | undefined } {
  const entry = useSyncExternalStore(
    useCallback((notify: () => void) => subscribePage(key, notify), [key]),
    () => entries.get(key),
  )
  // load 每次渲染都是新闭包：只认 key，避免每帧重复刷新。
  useEffect(() => { void refreshPage(key, load) }, [key])
  return { value: entry?.value as T | undefined, error: entry?.error }
}

/** 测试用：模块级缓存会跨用例存活，进入一个用例前清空。 */
export function resetPageCache(): void {
  entries.clear()
  listeners.clear()
  inflight.clear()
}
