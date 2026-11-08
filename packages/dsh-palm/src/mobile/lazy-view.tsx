/**
 * 懒视图装载器（从 `views/App.tsx` 搬出）：模块级缓存已解析组件，`warm()` 能在不渲染的
 * 情况下预取 chunk。替代 React.lazy 是为了消掉切页空白帧：`navigate` 先 await `warm()`
 * 再切，切换动画开始时目标组件已经同步可渲染，舞台永远不会掉进 Suspense fallback。
 *
 * @module dsh-palm/mobile/lazy-view
 */
import { createElement, useEffect, useReducer, type ComponentType, type ReactElement } from 'react'
import { claimChunkAutoReload, isChunkLoadFailure } from './platform/chunk-recovery.ts'
import { Button } from './ui/primitives.tsx'

/** 懒视图的两个出口：组件本身，以及不渲染也能预取 chunk 的 `warm`。 */
export interface LazyView<P extends object> {
  View: ComponentType<P>
  warm: () => Promise<void>
}

/**
 * 造一块懒视图。
 *
 * @param loader - 动态 import 的包装（返回 `{ default: 组件 }`）
 * @returns 组件与预取函数
 */
export function createLazyView<P extends object>(loader: () => Promise<{ default: ComponentType<P> }>): LazyView<P> {
  const cache: { component?: ComponentType<P>; failed?: boolean } = {}
  let inflight: Promise<void> | undefined
  const warm = (): Promise<void> => {
    if (cache.component !== undefined) return Promise.resolve()
    inflight ??= loader().then(
      (loaded) => { cache.component = loaded.default; cache.failed = false },
      (error: unknown) => {
        cache.failed = true
        inflight = undefined
        // 分块 404（宿主刚升级、旧页面还在要老哈希）只能靠换壳解决：入口 JS 没变，
        // 「点一下重试」必然再失败一次 —— 先交给自更新通道 reload（只刷一次），仍然
        // 失败（真的坏了）才回到「点一下重试」。
        const message = error instanceof Error ? error.message : String(error)
        if (isChunkLoadFailure(message) && claimChunkAutoReload()) window.location.reload()
        throw error
      },
    )
    return inflight
  }
  const View = (props: P): ReactElement => {
    const [, bump] = useReducer((tick: number) => tick + 1, 0)
    useEffect(() => {
      if (cache.component !== undefined) return
      // 冷启动直接落在这一页（深链）时没有 navigate 预取，自己补一次。
      void warm().then(() => { bump() }, () => { bump() })
    }, [])
    const Loaded = cache.component
    if (Loaded === undefined) return <PageSkeleton failed={cache.failed === true} onRetry={() => { void warm().then(() => { bump() }, () => { bump() }) }} />
    return createElement(Loaded, props)
  }
  return { View, warm }
}

/** 冷启动落进懒视图时的骨架：和真实页面同高、带页头，不是空背景。 */
export function PageSkeleton({ failed, onRetry }: { failed?: boolean; onRetry?: () => void }): ReactElement {
  return (
    <div className="page-loading" aria-busy={failed === true ? undefined : true}>
      <div className="page-loading-head" />
      {failed === true
        ? <Button type="button" className="page-loading-retry" onClick={onRetry}>加载失败，点一下重试</Button>
        : <div className="page-loading-rows" aria-hidden="true"><span /><span /><span /><span /></div>}
    </div>
  )
}

/**
 * 首屏之后预取：idle 时把还没到的 chunk 拉到本地，用户点入口时组件已经能同步渲染。
 * 失败只是留着下次再拉（`warm` 内会把 inflight 清掉），绝不影响功能。
 *
 * @param loaders - `warm` 函数数组
 * @returns 取消预取（组件卸载时清定时器）
 */
export function prefetchOnIdle(loaders: ReadonlyArray<() => Promise<void>>): () => void {
  const run = (): void => {
    for (const load of loaders) void load().catch(() => { /* 预取失败不影响功能 */ })
  }
  if (typeof window === 'undefined') return () => {}
  // requestIdleCallback 不是所有 WebView 都有（老 Safari / 部分安卓壳），回退定时器。
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: 1_500 })
    return () => { window.cancelIdleCallback(handle) }
  }
  const timer = window.setTimeout(run, 120)
  return () => { window.clearTimeout(timer) }
}
