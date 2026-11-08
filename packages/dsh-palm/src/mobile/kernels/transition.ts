/**
 * 转场判定（P7 内核，纯函数）。
 *
 * 界面只该问一句："这次换页是往前、往后，还是原地换？"三个问题决定三件事：
 * 方向（从哪边滑进来）、时长（快慢）、要不要动画。
 *
 * 为什么单独成模块而不是散在 `App.tsx` 里：
 * 1. **可测**：方向算错在真机上只是"感觉怪"，很难写成断言；抽出来就能穷举；
 * 2. **一处判定**：`data-transition` 由这里给，CSS 只按属性选动画；
 * 3. **降级明确**：`prefers-reduced-motion` 与未知深度都收敛到 `none`，
 *    不给"偶尔闪一下"留空间。
 *
 * @module dsh-palm/mobile/kernels/transition
 */

/** 一次换页的类型。 */
export type TransitionKind = 'forward' | 'back' | 'replace' | 'none'

/** 各类转场的时长（ms）。`none` 为 0，避免动画队列里留空帧。 */
export const TRANSITION_MS: Record<TransitionKind, number> = {
  forward: 260,
  back: 260,
  replace: 160,
  none: 0,
}

/**
 * 判定换页类型。
 *
 * 规则只有三条：
 * - 新页面更深 → `forward`（从右滑入）；
 * - 新页面更浅 → `back`（从左侧回弹）；
 * - 深度相同 → `replace`（淡入淡出，不做方向）。
 *
 * 首次渲染（没有上一次深度）与未知值一律 `none`：**进场不做动画**，
 * 否则冷启动会看到一次莫名其妙的滑动。
 *
 * @param previousDepth - 上一次的页面深度；首次渲染传 `undefined`
 * @param nextDepth - 目标页面深度
 * @returns 转场类型
 */
export function transitionOf(previousDepth: number | undefined, nextDepth: number): TransitionKind {
  if (previousDepth === undefined) return 'none'
  if (!Number.isFinite(previousDepth) || !Number.isFinite(nextDepth)) return 'none'
  if (nextDepth > previousDepth) return 'forward'
  if (nextDepth < previousDepth) return 'back'
  return 'replace'
}

/**
 * 这类转场该不该真的动。
 *
 * @param kind - 转场类型
 * @param reducedMotion - 系统是否要求减少动态效果
 * @returns 动画时长（ms）；`0` 表示不动
 */
export function transitionMs(kind: TransitionKind, reducedMotion: boolean): number {
  if (reducedMotion) return 0
  return TRANSITION_MS[kind]
}

/**
 * 给 CSS 用的属性值（`none` 时返回 `undefined`，这样连属性都不写）。
 *
 * @param kind - 转场类型
 * @param reducedMotion - 系统是否要求减少动态效果
 * @returns `data-transition` 的取值
 */
export function transitionAttr(kind: TransitionKind, reducedMotion: boolean): string | undefined {
  if (reducedMotion || kind === 'none') return undefined
  return kind
}
