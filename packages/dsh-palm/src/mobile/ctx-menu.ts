/**
 * 长按菜单的落点计算。
 *
 * 从消息里拆出来单独放，原因很实际：位置逻辑是最容易做错、又最难在组件测试里
 * 断言的一块（jsdom 的 getBoundingClientRect 全是 0，测不出"翻到上方"这种分支）。
 * 纯函数就能把四种情况都钉住。
 *
 * 规则：优先放在长按目标的**下方**（菜单不遮住你要操作的那一行），下方放不下
 * 就翻到**上方**；两侧都放不下时退回视口内的夹取，至少保证不出屏。水平方向以
 * 目标左边缘为起点，夹在左右边距之间。
 */

export interface CtxAnchor {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export interface CtxSize {
  readonly width: number
  readonly height: number
}

export interface CtxPlacement {
  readonly left: number
  readonly top: number
  /** 菜单落在目标的哪一侧：给调用方做箭头/动画方向用，也方便测试断言。 */
  readonly side: 'below' | 'above' | 'clamped'
}

/** 菜单与目标之间的间隙（px）。 */
export const CTX_MENU_GAP = 8
/** 菜单宽度（px）：168 放得下最长项（编辑并重新发送）而不换行。 */
export const CTX_MENU_WIDTH = 168

/** 菜单与视口边缘的最小距离（px）。 */
export const CTX_MENU_MARGIN = 8

export function placeCtxMenu(
  anchor: CtxAnchor,
  size: CtxSize,
  viewport: CtxSize,
  gap = CTX_MENU_GAP,
  margin = CTX_MENU_MARGIN,
): CtxPlacement {
  const maxLeft = Math.max(margin, viewport.width - size.width - margin)
  const left = Math.min(Math.max(anchor.left, margin), maxLeft)
  const maxTop = Math.max(margin, viewport.height - size.height - margin)
  /** 任何分支算出来的位置都再夹一次：锚点可能已经滚出屏幕（程序化开菜单就会这样），
   *  只靠"下方放不下就翻上方"会算出屏幕外的位置，菜单底部几项点不到。 */
  const fit = (top: number, side: CtxPlacement['side']): CtxPlacement => ({
    left,
    top: Math.min(Math.max(top, margin), maxTop),
    side,
  })

  const below = anchor.bottom + gap
  if (below + size.height + margin <= viewport.height) return fit(below, 'below')

  const above = anchor.top - gap - size.height
  if (above >= margin) return fit(above, 'above')

  // 两侧都放不下（目标本身比视口还高，常见于长命令卡）：夹到视口内，至少可用。
  return fit(anchor.top, 'clamped')
}
