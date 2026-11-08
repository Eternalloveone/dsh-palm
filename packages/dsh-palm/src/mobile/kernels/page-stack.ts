/**
 * 页面栈（P6 地基）：手机端只认**系统返回**，所以要有一份"我来过哪几页"的账。
 *
 * 设计取舍（见 docs/mobile-design-spec.md 第一节"零手势"）：
 * - 不做抽屉、不做底部弹层，页面**只进不退地压栈**；
 * - 返回 = 弹栈，弹到根就交给历史栈（浏览器/系统返回直接退出）；
 * - 同一页重复进入不合并（用户看到的就是两次进入），但**根页唯一**。
 *
 * 这里是纯函数 + 泛型：条目只要求一个稳定 `key`（用于 URL 与调试），
 * 页面数据本身可以是任意对象，内核不碰它。
 *
 * @module dsh-palm/mobile/kernels/page-stack
 */

/** 栈里的一页。 */
export interface StackEntry<T> {
  /** 稳定标识：同 key 视为"同一页"（用于 URL 与埋点）。 */
  key: string
  /** 页面数据（路由参数、会话对象等）。 */
  value: T
}

/** 页面栈（不可变）。 */
export interface PageStack<T> {
  readonly entries: readonly StackEntry<T>[]
}

/** 建一个只有一个根页的栈。 */
export function createPageStack<T>(rootKey: string, rootValue: T): PageStack<T> {
  return { entries: [{ key: rootKey, value: rootValue }] }
}

/** 当前栈深（根页为 1）。 */
export function depthOf<T>(stack: PageStack<T>): number {
  return stack.entries.length
}

/** 当前页。 */
export function currentOf<T>(stack: PageStack<T>): StackEntry<T> | undefined {
  return stack.entries[stack.entries.length - 1]
}

/** 还能不能返回（根页返回 false，表示该交给系统返回退出）。 */
export function canGoBack<T>(stack: PageStack<T>): boolean {
  return stack.entries.length > 1
}

/** 压入一页。 */
export function pushPage<T>(stack: PageStack<T>, key: string, value: T): PageStack<T> {
  return { entries: [...stack.entries, { key, value }] }
}

/**
 * 弹出一页。
 *
 * 已经在根页时返回**同一个栈**（引用相等）：调用方可以据此判断"没发生返回"，
 * 从而决定是否让系统返回退出应用。
 */
export function popPage<T>(stack: PageStack<T>): PageStack<T> {
  if (stack.entries.length <= 1) return stack
  return { entries: stack.entries.slice(0, -1) }
}

/** 替换当前页（不改变栈深；用于"换会话但不留返回痕迹"）。 */
export function replacePage<T>(stack: PageStack<T>, key: string, value: T): PageStack<T> {
  if (stack.entries.length === 0) return { entries: [{ key, value }] }
  return { entries: [...stack.entries.slice(0, -1), { key, value }] }
}

/** 回到根页（用于"回到列表"这类动作）。 */
export function resetToRoot<T>(stack: PageStack<T>): PageStack<T> {
  const root = stack.entries[0]
  return root === undefined ? stack : { entries: [root] }
}

/**
 * 把栈映射成历史记录项。
 *
 * @param stack - 页面栈
 * @param pathOf - key → URL 路径（由调用方决定路由表，内核不关心具体 URL）
 * @returns 每条历史项；第 n 项代表"往回退 n 步能到这里"
 */
export function historyOf<T>(
  stack: PageStack<T>,
  pathOf: (key: string) => string,
): Array<{ path: string; depth: number; key: string }> {
  return stack.entries.map((entry, index) => ({
    path: pathOf(entry.key),
    depth: index + 1,
    key: entry.key,
  }))
}
