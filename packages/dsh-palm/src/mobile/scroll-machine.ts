/**
 * 会话滚动的状态机。
 *
 * 以前「要不要跟到底部」这件事散在五六个 ref 里互相判断：`bottomGapAtUserScroll`（读者的位置）、
 * `gestureUntil`（手指还在动）、`locateLock`（搜索定位锁）、`suppressFollow`（发送后安静期）、
 * `userScrolled`（进会话补钉的开关）。每加一个交互就要在两三处各补一条判断，漏一处就是真机上的
 * 「抢手势」「不落底」「卡片闪」。这里把它收成一个**纯函数状态机**：所有输入是事件，所有输出是
 * 一个明确的 `mode` 和下一个人工可见的判据 `mayAutoPin`。
 *
 * 设计约定：
 * 1. 状态本身**不含 DOM**，只含时间戳与数字，方便单测。
 * 2. `mode` 只有四个值：`following`（贴在底部）、`reading`（读者停在上面看历史）、
 *    `locating`（搜索定位进行中）、`suppressed`（刚发完消息等短暂安静期）。
 * 3. 任何一次真实手势都会立刻把 `mode` 推到 `reading`（除非离底部很近），并顺延静默窗口；
 *    程序化写入（我们自己的 pin）不算手势。
 */

/** 离底部多少像素以内算「贴着底部」（「回到最新消息」按钮与提示阈值）。 */
export const FOLLOW_THRESHOLD_PX = 80
/**
 * 跟随的**锁存距离**：只有真正触底才开跟随，往上滑超过这个距离立刻解除。
 *
 * 取 24px 而不是 80px 是手感问题：80px 的带宽意味着「我明明往上抬了一点想看上一句」，
 * 新内容一到还是被拽回底部 —— 真机上就是「怎么老是抢我手势」。
 */
export const FOLLOW_LATCH_PX = 24
/**
 * 手指停下多久算「静止」。
 *
 * 以前用固定 350ms 静默窗；但 iOS 的惯性滑行常常超过 350ms，窗口一过正好撞上惯性，
 * 于是又被拽走。改成「最后一次滚动事件之后 120ms」更贴近真实静止。
 */
export const SCROLL_IDLE_MS = 120

export type ScrollMode = 'following' | 'reading' | 'locating' | 'suppressed'

export interface ScrollState {
  mode: ScrollMode
  /** 最近一次量到的「离底部还有多少像素」。 */
  gap: number
  /** 手势静默窗口截止时间。 */
  gestureUntil: number
  /** 显式抑制窗口截止时间（发送后、翻页挂载期间）。 */
  suppressUntil: number
  /** 搜索定位锁的截止时间（到点自解，避免永久挡住跟随）。 */
  locateUntil: number
  /** 读者本人是否动过屏幕（进会话补钉用）。 */
  userMoved: boolean
  /** 这次打开会话是否已经贴过一次底部（决定「跟随」是否生效）。 */
  followed: boolean
  /** 最近一次真实滚动的方向。 */
  direction: 'up' | 'down'
  /**
   * 跟随锁存：触底为 true，往上滑超过 {@link FOLLOW_LATCH_PX} 立刻为 false。
   *
   * 这是「不抢手势」的核心：是否跟随不再由「现在离底部多远」推断，而由读者
   * **最近一次明确意图**决定（他自己滑回底部 = 想跟；往上滑 = 不想跟）。
   */
  stick: boolean
  /** 最近一次滚动事件的时间（判断「静止」用）。 */
  lastScrollAt: number
  /** 手指是不是还按在屏幕上。 */
  touching: boolean
}

export type ScrollEvent =
  /** 真实手势（非程序化写入）造成的滚动。 */
  | { type: 'gesture'; at: number; gap: number; up: boolean }
  /** 任何来源的量测（含我们自己的 pin 回声）。 */
  | { type: 'measure'; gap: number }
  /** 我们刚把视口钉到底部。 */
  | { type: 'pin' }
  /** 搜索定位开始。 */
  | { type: 'locate-start'; at: number; holdMs: number }
  /** 定位结束（落地或放弃）。 */
  | { type: 'locate-end' }
  /** 显式安静期（比如刚发出一条消息，别在挂载动画里抢滚动）。 */
  | { type: 'suppress'; until: number }
  /** 重新打开一个会话：全部归零。 */
  | { type: 'open'; at: number }
  /** 手指按下（期间绝不抢滚动）。 */
  | { type: 'touch-start'; at: number }
  /** 手指抬起。 */
  | { type: 'touch-end'; at: number }
  /** 读者明确要求跟随（点「回到最新消息」、自己发出消息）。 */
  | { type: 'stick-on'; at: number }

export function createScrollState(): ScrollState {
  return {
    mode: 'following',
    gap: 0,
    gestureUntil: 0,
    suppressUntil: 0,
    locateUntil: 0,
    userMoved: false,
    followed: false,
    direction: 'down',
    // 打开会话默认跟随：进门就该落在最新消息。读者一动就会按下面的规则改写。
    stick: true,
    lastScrollAt: 0,
    touching: false,
  }
}

/** 状态迁移。纯函数：同一个 state + 同一个事件永远得到同样的结果。 */
export function scrollReducer(state: ScrollState, event: ScrollEvent): ScrollState {
  switch (event.type) {
    case 'open':
      return createScrollState()
    case 'gesture': {
      // 锁存由**读者的意图**改写：
      //  · 滑到底部（≤ 锁存距离）→ 想跟；
      //  · 往上滑超过锁存距离 → 不跟（立刻，不留 80px 的模糊带）。
      const stick = event.up
        ? (state.stick && event.gap <= FOLLOW_LATCH_PX)
        : event.gap <= FOLLOW_LATCH_PX
      return {
        ...state,
        gap: event.gap,
        lastScrollAt: event.at,
        userMoved: true,
        direction: event.up ? 'up' : 'down',
        stick,
        mode: state.locateUntil > event.at
          ? 'locating'
          : stick ? 'following' : 'reading',
      }
    }
    case 'touch-start':
      return { ...state, touching: true, lastScrollAt: event.at }
    case 'touch-end':
      return { ...state, touching: false, lastScrollAt: event.at }
    case 'stick-on':
      return { ...state, stick: true, followed: true, mode: 'following' }
    case 'measure': {
      // 量测**只更新位置，绝不改锁存**。
      //
      // 真机（2026-10-29）：进会话时内容还没铺满，量到的 gap 很大，一旦让 measure
      // 顺手把 stick 关掉，后面内容长高就再也不会跟随 —— 停在离底 245px 的地方。
      // 「想不想跟随」只由读者的手势（gesture）和明确动作（stick-on/pin）决定。
      const mode = state.mode === 'locating'
        ? 'locating'
        : state.stick ? 'following' : 'reading'
      return { ...state, gap: event.gap, mode }
    }
    case 'pin':
      // 我们自己钉到底 = 现在在底部，锁存打开（读者接下来往上滑会自己关掉）。
      return { ...state, gap: 0, followed: true, stick: true, mode: state.locateUntil > 0 && state.mode === 'locating' ? 'locating' : 'following' }
    case 'locate-start':
      return { ...state, mode: 'locating', locateUntil: event.at + event.holdMs, gap: Number.MAX_SAFE_INTEGER }
    case 'locate-end':
      return state.mode === 'locating'
        ? { ...state, mode: state.gap <= FOLLOW_THRESHOLD_PX ? 'following' : 'reading', locateUntil: 0 }
        : state
    case 'suppress':
      return { ...state, suppressUntil: event.until, mode: 'suppressed' }
    default:
      return state
  }
}

/**
 * 现在能不能把视口钉到底部？
 *
 * @param state - 当前状态。
 * @param now - 现在（毫秒）。测试注入。
 * @param requireFollowed - 是否要求「已经贴过一次底部」（新消息跟随需要，进会话补钉不需要）。
 */
export function mayAutoPin(state: ScrollState, now: number, requireFollowed = false): boolean {
  // 定位锁到点自解：没人再滚也不能永久挡住跟随（真机「有时候新消息不跳到底部」）。
  if (state.locateUntil > now) return false
  if (now < state.suppressUntil) return false
  // 手指按着、或还在惯性滑行（最后一次滚动之后不到 SCROLL_IDLE_MS）—— 一律让路。
  if (state.touching) return false
  if (state.lastScrollAt > 0 && now - state.lastScrollAt < SCROLL_IDLE_MS) return false
  if (requireFollowed && !state.followed) return false
  // 跟随只看锁存：读者自己滑回底部才算「想跟」，距离本身不再是判据。
  return state.stick
}

/**
 * 进会话补钉要不要继续（读者一动就停手）。
 *
 * 与 `mayAutoPin` 的区别：补钉是「布局还在长高」时的重复校准，**不看当前 gap** ——
 * 恰恰是因为高度还是估值、画面没到底才要补。读者的手势、定位锁、发送后的安静期
 * 依然一票否决。
 */
export function maySettlePin(state: ScrollState, now: number): boolean {
  if (state.userMoved) return false
  if (state.touching) return false
  if (state.locateUntil > now) return false
  if (now < state.gestureUntil) return false
  if (now < state.suppressUntil) return false
  return true
}
