/**
 * **滚动事件的语义判定**（W3：从 \`ChatView.tsx\` 组件体内抽出的第八个 hook）。
 *
 * 这段代码处理一件事：**这次 scroll 事件到底是谁造成的**。三种来源：
 *
 * | 来源 | 判定 | 界面该怎么反应 |
 * |---|---|---|
 * | 用户手势 | 手指按着，或刚松手 800ms 内（惯性滑行） | 顺延静默窗口、释放定位锁、记阅读书签 |
 * | 程序化写入的回声 | 值对得上 + 250ms 内 | **什么都不能当手势**（否则跟随锁被关掉） |
 * | 浏览器滚动锚定 | 以上都不是 | 一律当回声处理 |
 *
 * 几条血的教训写在注释里：
 * - **先取旧位置再覆盖**：以前先写 `scrollTopRef` 再比较，`up` 永远是 false，
 *   「读者往上滑」这个最重要的意图一直没被识别（跟手冲突、翻页被拽到底都源于此）。
 * - **位置永远按量到的写**：漏掉这步会让「读者在历史里」被当成「贴底」，新消息一到就拽走画面。
 * - 程序化判定**只认标记不够，值也要对得上**：一次没有回声的写入会把读者接下来真实手势吃掉。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-scroll-follow
 */
import { useCallback, type MutableRefObject } from 'react'
import type { ScrollEvent } from '../../scroll-machine.ts'

/** 离底多少算"贴底"（自动跟随与「回到最新」按钮共用同一个阈值）。 */
export const BOTTOM_FOLLOW_THRESHOLD_PX = 80

/** 离顶多少就开始自动接上一页。 */
export const NEAR_TOP_LOAD_PX = 240

/** 手指离开后仍算作手势的惯性窗口。 */
const TOUCH_GRACE_MS = 800
/** 程序化写入的认领窗口与容差（值必须真的对得上）。 */
const PROGRAMMATIC_WINDOW_MS = 250
const PROGRAMMATIC_TOLERANCE_PX = 2
/** 判定"往上滑"的最小位移：小于它视为抖动。 */
const MOVE_UP_THRESHOLD_PX = 1

/** 依赖（都是组件里的 ref 与回调）。 */
export interface ScrollFollowDeps {
  scrollRef: MutableRefObject<{ scrollTop: number; scrollHeight: number; clientHeight: number } | null | undefined>
  scrollTopRef: MutableRefObject<number>
  programmaticScrollRef: MutableRefObject<boolean>
  programmaticValueRef: MutableRefObject<number>
  programmaticAtRef: MutableRefObject<number>
  lastTouchAtRef: MutableRefObject<number>
  scrollStateRef: MutableRefObject<{ touching: boolean }>
  pendingRef: MutableRefObject<boolean>
  loadOlderRef: MutableRefObject<(auto: boolean) => void>
  scrollEvent: (event: ScrollEvent) => void
  setShowJumpToLatest: (show: boolean) => void
  setCurrentTurn: (turn: number) => void
  deriveCurrentTurn: (scrollTop: number) => number | undefined
  markSeen: () => void
  hasOlder: boolean
}

/** @returns 滚动事件处理器（绑到 .chat-scroll 的 onScroll）。 */
export function useScrollFollow(deps: ScrollFollowDeps): { handleScroll: () => void } {
  const {
    scrollRef, scrollTopRef, programmaticScrollRef, programmaticValueRef, programmaticAtRef,
    lastTouchAtRef, scrollStateRef, pendingRef, loadOlderRef, scrollEvent,
    setShowJumpToLatest, setCurrentTurn, deriveCurrentTurn, markSeen, hasOlder,
  } = deps

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (el === null || el === undefined) return
    // 先取旧位置再覆盖：以前反着写，`up` 永远是 false。
    const previousTop = scrollTopRef.current
    const movingUp = el.scrollTop < previousTop - MOVE_UP_THRESHOLD_PX
    scrollTopRef.current = el.scrollTop
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    // 程序化写入的判认：标记 + 值对得上 + 在窗口内，三条都要。
    const claimed = programmaticScrollRef.current
      && Math.abs(el.scrollTop - programmaticValueRef.current) <= PROGRAMMATIC_TOLERANCE_PX
      && Date.now() - programmaticAtRef.current < PROGRAMMATIC_WINDOW_MS
    programmaticScrollRef.current = false
    const programmatic = claimed
    // 位置永远按量到的写（回声里 scrollTop 已经变了，那就是读者的真实位置）。
    scrollEvent({ type: 'measure', gap })
    const touchedRecently = Date.now() - lastTouchAtRef.current < TOUCH_GRACE_MS
    if (!programmatic && (touchedRecently || scrollStateRef.current.touching)) {
      scrollEvent({ type: 'gesture', at: Date.now(), gap, up: movingUp })
      scrollEvent({ type: 'locate-end' })
    }
    setShowJumpToLatest(gap > BOTTOM_FOLLOW_THRESHOLD_PX)
    if (!programmatic) {
      const readPosition = deriveCurrentTurn(el.scrollTop) ?? 0
      setCurrentTurn(readPosition)
    }
    // 滚回底部算"已读"：清未读徽标、推进已见基线。
    if (gap <= BOTTOM_FOLLOW_THRESHOLD_PX) markSeen()
    // 无限上翻：接近顶部就自动接上一页（要求内容确实比视口高，且没有在飞的请求）。
    if (hasOlder && !pendingRef.current
        && el.scrollHeight > el.clientHeight
        && el.scrollTop <= NEAR_TOP_LOAD_PX) {
      loadOlderRef.current(true)
    }
  }, [hasOlder, markSeen, scrollRef, scrollTopRef, programmaticScrollRef, programmaticValueRef,
    programmaticAtRef, lastTouchAtRef, scrollStateRef, pendingRef, loadOlderRef, scrollEvent,
    setShowJumpToLatest, setCurrentTurn, deriveCurrentTurn])

  return { handleScroll }
}
