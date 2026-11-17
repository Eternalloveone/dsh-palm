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
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { ScrollEvent } from '../../../stream/scroll-machine.ts'

/** 离底多少算"贴底"（自动跟随用）。 */
export const BOTTOM_FOLLOW_THRESHOLD_PX = 80

/**
 * 两个浮动按钮（`6/7` + `⌄`）的迟滞阈值：出现要离底 >160px、收起要回到 <60px。
 * 2026-11-16 实测：只有一条 80px 硬阈值时，按钮自己又在流里占 ~84px
 * （scrollHeight 2500↔2584），手指在底部蹭就会反复跨阈值 → 反复挂载 →
 * 每次重播 `chat-jump-in` 160ms 淡入 = 一闪一闪。两条阈值不重叠就不抖。
 * 只影响按钮显隐，不改自动跟随的 {@link BOTTOM_FOLLOW_THRESHOLD_PX}。
 */
export const JUMP_SHOW_PX = 160
export const JUMP_HIDE_PX = 60

/** 离顶多少就开始自动接上一页。 */
export const NEAR_TOP_LOAD_PX = 240

/** 手指离开后仍算作手势的惯性窗口。 */
const TOUCH_GRACE_MS = 800
/** 程序化写入的认领窗口与容差（值必须真的对得上）。 */
const PROGRAMMATIC_WINDOW_MS = 250
const PROGRAMMATIC_TOLERANCE_PX = 2
/** 判定"往上滑"的最小位移：小于它视为抖动。 */
const MOVE_UP_THRESHOLD_PX = 1

/**
 * 「正在读第几轮」滚动静默多久之后才算一次。
 *
 * 2026-11-15 实测（4× 降频、真触摸手势）：一次滚动 193 个事件，
 * `deriveCurrentTurn` 每次都跑 —— `querySelectorAll('[data-mid]')` 193 次、
 * `getBoundingClientRect` 1635 次（每行一次，都是强制布局）。这是滚动帧
 * 从 16.7ms 掉到 30~63ms 的原因。
 *
 * 这个值只用来显示「读到第几轮」，滚动静止 100ms 再算完全看不出来，
 * 却把热路径上的几何读取全部清零。
 */
const TURN_SETTLE_MS = 100

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
  /** 与 `SliceSetters` 同形：支持函数式更新，迟滞判据要读上一帧的显示状态。 */
  setShowJumpToLatest: (value: boolean | ((previous: boolean) => boolean)) => void
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

  /** 「读到第几轮」的延迟计算定时器（见 TURN_SETTLE_MS）。 */
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    if (turnTimerRef.current !== undefined) clearTimeout(turnTimerRef.current)
  }, [])

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
    // 迟滞：已经显示的，回到 <60px 才收；没显示的，离底 >160px 才出。
    // 用函数式更新把「当前是否显示」一并读进来，这样 jumpToLatest() 里的显式
    // setShowJumpToLatest(false) 也会自然接上（否则 ref 会和外部写入脱节）。
    setShowJumpToLatest(previous => gap > (previous ? JUMP_HIDE_PX : JUMP_SHOW_PX))
    if (!programmatic) {
      // 不在这一帧里算：它要逐行读几何，是滚动卡顿的主因。等滚动静止再算一次。
      if (turnTimerRef.current !== undefined) clearTimeout(turnTimerRef.current)
      turnTimerRef.current = setTimeout(() => {
        turnTimerRef.current = undefined
        setCurrentTurn(deriveCurrentTurn(scrollTopRef.current) ?? 0)
      }, TURN_SETTLE_MS)
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
