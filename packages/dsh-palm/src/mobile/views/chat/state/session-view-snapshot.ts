/**
 * **会话视图快照**：换会话时先显示"上一场的样子"，不让内容空一帧。
 *
 * ## 为什么需要
 *
 * 2026-11-13 用户：「切换会话的时候，一些内容经常消失然后加载出来 —— 历史会话内容、
 * 排队消息条、目标条等等」。根因不是网络慢，而是**语义**：`useSessionState` 换会话
 * 即回到初值，于是目标条（`goal === undefined` 不渲染）、待办条、状态条、权限胶囊
 * 在切过去的那一帧全是"还没有"，等 RPC / 投影帧回来才填 —— 屏幕上就是"消失 → 出现"。
 *
 * 历史会话内容已经有一份快照（`session/chat-snapshot.ts`，只服务消息行）；这里补的是
 * **其余会话作用域的视图状态**，两者合起来才是"整屏都能先显示旧样子"。
 *
 * ## 规则
 *
 * 1. 只存"看得见的内容"（目标、待办、状态条、权限、大纲、子代理），不存瞬时 UI
 *    （灯箱、右键菜单、编辑草稿、滚动锚点）—— 切回来还开着灯箱是 bug，不是稳定。
 * 2. `undefined` 不写：它表示"还没拿到"，拿它覆盖一份好快照等于把缓存删掉。
 *    `null` 照写：它是有意义的"确认没有"（没有目标、没有权限约束）。
 * 3. 只留最近 8 场（与 `chat-snapshot.ts`、`stream/session-store.ts` 同一个口径）；
 *    每场最多 24 个键。切超过 8 场就丢最早的 —— 过时快照只该短暂显示，不该常驻。
 * 4. 快照不参与任何判定：它只影响"第一帧画什么"，所有权威值仍然来自 RPC / 投影帧。
 *
 * @module dsh-palm/mobile/views/chat/state/session-view-snapshot
 */

/** 最多留几场会话：与 `session/chat-snapshot.ts` 的 8 对齐。 */
const MAX_SESSIONS = 8
/** 每场最多留几个键（目标/待办/状态条/权限/大纲/子代理各一个，留足余量）。 */
const MAX_ENTRIES_PER_SESSION = 24

/** sessionId → (key → 值)。Map 的插入顺序就是最近使用顺序。 */
const bags = new Map<string, Map<string, unknown>>()

/** 把一场会话挪到"最近使用"的位置（超上限时淘汰最久没用的那场）。 */
function touch(sessionId: string, bag: Map<string, unknown>): void {
  bags.delete(sessionId)
  bags.set(sessionId, bag)
}

/**
 * 读一份视图快照。
 *
 * @param sessionId - 会话 id
 * @param key - 视图键（`goal` / `todo` / `bars` …）
 * @returns 上次记下的值；没有就是 undefined（调用方退回自己的初值）
 */
export function readViewSnapshot<T>(sessionId: string, key: string): T | undefined {
  if (sessionId === '') return undefined
  const bag = bags.get(sessionId)
  if (bag === undefined || !bag.has(key)) return undefined
  touch(sessionId, bag)
  return bag.get(key) as T
}

/**
 * 记一份视图快照。
 *
 * @param sessionId - 会话 id
 * @param key - 视图键
 * @param value - 当前画出来的值；`undefined` 会被忽略（见模块注释第 2 条）
 */
export function writeViewSnapshot<T>(sessionId: string, key: string, value: T): void {
  if (sessionId === '' || value === undefined) return
  let bag = bags.get(sessionId)
  if (bag === undefined) {
    bag = new Map<string, unknown>()
    bags.set(sessionId, bag)
  } else {
    touch(sessionId, bag)
  }
  bag.set(key, value)
  while (bag.size > MAX_ENTRIES_PER_SESSION) {
    const oldest = bag.keys().next()
    if (oldest.done === true) break
    bag.delete(oldest.value)
  }
  while (bags.size > MAX_SESSIONS) {
    const oldest = bags.keys().next()
    if (oldest.done === true) break
    bags.delete(oldest.value)
  }
}

/**
 * 丢掉一场会话的全部快照（会话被删除、或宿主说它不存在了）。
 *
 * @param sessionId - 会话 id
 */
export function forgetViewSnapshots(sessionId: string): void {
  bags.delete(sessionId)
}

/** 测试用：模块级缓存会跨用例存活，进入一个用例前清空。 */
export function clearViewSnapshots(): void {
  bags.clear()
}

/** 测试用：当前留了几场（验证 LRU 上限）。 */
export function viewSnapshotSessionCount(): number {
  return bags.size
}
