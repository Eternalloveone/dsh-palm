/**
 * 抽屉打开时，把「列表最上面几条会话」的首屏悄悄取回来。
 *
 * 为什么要它（2026-11-14 实测）：切一次会话，手机端要等的不是渲染，而是宿主**读日志**
 * 那一下 —— `mobile.sessionState` 在长会话上 500~900ms（大会话冷读更久）。这段时间屏幕
 * 上只有骨架，用户的原话就是「点下去好久才有反应」。
 *
 * 而这段时间其实是**可以提前付**的：用户拉开抽屉、眼睛在列表上找的那一两秒，我们已经在
 * 后台把前几条的首屏取回来了。点下去直接命中 `chat-page` 的本地缓存（`saveCachedHistory`
 * + `chat-sync-ledger`），首帧立刻就有内容。
 *
 * 三条克制：
 * - 只取前 3 条、且不含当前会话：抽屉是列表，用户多半点最上面几条；
 * - **串行**取，不并发抢带宽（手机弱网下并发只会让抽屉本身变卡）；
 * - 抽屉一关就取消；取失败静默忽略 —— 真点进去时本来就会再取一次。
 *
 * @module dsh-palm/mobile/views/chat/hooks/use-session-prefetch
 */

import { useEffect, useRef } from 'react'
import { loadChatPage } from '../../../data/chat-page.ts'
import type { SessionView } from '../../../shared/session-view.ts'

/** 一次预取几条会话。 */
const PREFETCH_SESSIONS = 6
/** 两条之间留多久：宿主单线程，连着要就是在跟当前会话抢它。 */
const PREFETCH_GAP_MS = 220

/**
 * 抽屉打开期间预取会话首屏。
 *
 * @param rows - 抽屉里的会话行（按列表顺序）
 * @param currentSessionId - 当前会话，跳过它（本来就在内存里）
 * @param enabled - 抽屉是否开着
 */
export function useSessionPrefetch(
  rows: readonly SessionView[] | undefined,
  currentSessionId: string | undefined,
  enabled: boolean,
): void {
  /** 本次页面生命周期里已经预取过的会话：抽屉反复开关不再重复取。 */
  const doneRef = useRef<Set<string>>(new Set())
  // 抽屉那边的 currentSessionId 是 `''` 表示"没有当前会话"（见 App 的传参），不能当真实 id 比。
  const skipId = currentSessionId === undefined || currentSessionId === '' ? undefined : currentSessionId

  /*
   * 依赖用字符串而不是数组：`rows` 每次拉列表都是新引用，数组依赖会让 effect 反复重跑，
   * 而真正决定「要不要取、取哪几条」的只是这几个 id。
   */
  const ids = enabled
    ? (rows ?? [])
        .map(row => row.sessionId)
        .filter(id => id !== skipId && !doneRef.current.has(id))
        .slice(0, PREFETCH_SESSIONS)
        .join('|')
    : ''

  useEffect(() => {
    if (ids === '') return
    const targets = ids.split('|')
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async (): Promise<void> => {
      for (const id of targets) {
        if (cancelled) return
        doneRef.current.add(id)
        try {
          await loadChatPage(id)
        } catch {
          // 预取是加餐，失败就算了：真点进去时还会再取。
        }
        if (cancelled) return
        // 每条之间让一让：宿主是单线程的，连着读六个会话会和当前会话的轮询撞车。
        await new Promise((resolve) => setTimeout(resolve, PREFETCH_GAP_MS))
      }
    }
    /*
     * 不要在抽屉滑上来的那一两个帧里就发请求。
     *
     * 宿主是单线程的（它一边读日志一边处理其它 RPC），抽屉自己还要拉一次 `session.list`；
     * 预取要是跟它同帧发出，三四个请求在手机上排队，抽屉反而更晚出来 —— 预取本来是
     * 为了省下一次点击的等待，不该拿抽屉的帧去换。空出 260ms 再开始，那时抽屉早已画完。
     */
    timer = setTimeout(() => { void run() }, 260)
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [ids])
}
