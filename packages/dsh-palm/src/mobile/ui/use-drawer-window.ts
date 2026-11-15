/**
 * 会话抽屉的「可见窗口」：首屏只画前 N 行，滚近底部再补一页。
 *
 * 为什么需要（2026-11-14 实测）：抽屉一次插几十行，那一帧要连带样式计算、布局、焦点扫描
 * 一起做完，4× 降频下「点开抽屉 → 画面真的变」= 729ms，其中一次长任务冻住主线程 523ms。
 * 保守做法（**不做真虚拟化**）：画出来的行不回收，只是「晚一点画」。
 *
 * @module dsh-palm/mobile/ui/use-drawer-window
 */

import { useEffect, useRef, useState } from 'react'

/**
 * 首屏画多少行。不能少于"一屏装得下的行数"：哨兵一旦落在视口里会立刻再补一页
 * （画 12 行反而变成 32 行，实测 559ms vs 455ms）。20 行约 1100px，多过一屏 844px。
 */
export const DRAWER_FIRST_PAGE = 20
/** 之后每次追加多少行。 */
export const DRAWER_NEXT_PAGE = 20
/**
 * 滚动停下多久才补下一页。实测补一页那帧 77ms（4× 降频，插 20 行要走样式+布局），
 * 每次滑一屏就赶上一次 = 「一卡一卡」。挪到松手之后再补，插入成本还在但不挡手。
 */
export const DRAWER_GROW_SETTLE_MS = 90

export interface DrawerWindow {
  /** 这一次要画多少行（已经保证包含当前会话那一行）。 */
  limit: number
  /** 列表滚动容器；交给 IntersectionObserver 当 root。 */
  listRef: React.RefObject<HTMLDivElement>
  /** 挂在列表末尾的哨兵：滚到它附近就补一页。 */
  sentinelRef: (node: HTMLDivElement | null) => void
}

/**
 * 抽屉首屏窗口。
 *
 * @param keepIndex - 当前会话在拍平列表里的下标（-1 = 不在列表里）。窗口会**至少**画到它，
 *   否则用户打开抽屉看不到自己在哪，会当成"当前会话丢了"。
 * @returns 窗口上界、滚动容器 ref、哨兵 ref
 */
export function useDrawerWindow(keepIndex: number): DrawerWindow {
  const listRef = useRef<HTMLDivElement>(null)
  const [limit, setLimit] = useState(DRAWER_FIRST_PAGE)
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null)

  // 依赖 `limit` 是有意的：变大后哨兵被推到更下面，要重新观察才会在"下一次滚到底"再触发。
  useEffect(() => {
    if (sentinel === null) return
    // jsdom / 老内核没有 IntersectionObserver：退化成"只画首屏 + 当前会话"，不报错。
    if (typeof IntersectionObserver === 'undefined') return
    const root = listRef.current
    let pending = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const grow = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      pending = false
      setLimit((current) => current + DRAWER_NEXT_PAGE)
    }
    /** 从此刻起算静默；期间每来一个 scroll 就推后。 */
    const arm = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => { if (pending) grow() }, DRAWER_GROW_SETTLE_MS)
    }
    const hit = (entries: IntersectionObserverEntry[]): boolean => entries.some((entry) => entry.isIntersecting)
    // 提前 200px 预警：知道要补了，但**不马上插行**，等手停下来。
    const scout = new IntersectionObserver((entries) => { if (hit(entries)) { pending = true; arm() } }, { root, rootMargin: '200px' })
    // 兜底：哨兵真的进视口了（下面要空出来），立刻补，不等静默。
    const urgent = new IntersectionObserver((entries) => { if (hit(entries)) grow() }, { root, rootMargin: '0px' })
    scout.observe(sentinel)
    urgent.observe(sentinel)
    const onScroll = (): void => { if (pending) arm() }
    root?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scout.disconnect()
      urgent.disconnect()
      root?.removeEventListener('scroll', onScroll)
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [sentinel, limit])

  return {
    limit: keepIndex >= limit ? keepIndex + 1 : limit,
    listRef,
    sentinelRef: setSentinel,
  }
}
