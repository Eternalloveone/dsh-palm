import { describe, expect, it } from 'vitest'
import { CTX_MENU_GAP, CTX_MENU_MARGIN, placeCtxMenu } from './ctx-menu.ts'

const viewport = { width: 390, height: 844 }
const size = { width: 168, height: 240 }

describe('placeCtxMenu', () => {
  it('sits below the pressed row when the lower half has room', () => {
    const out = placeCtxMenu({ top: 200, bottom: 244, left: 24, right: 360 }, size, viewport)
    expect(out.side).toBe('below')
    expect(out.top).toBe(244 + CTX_MENU_GAP)
    expect(out.left).toBe(24)
  })

  it('flips above the row instead of covering it when the row is near the bottom', () => {
    const anchor = { top: 700, bottom: 744, left: 24, right: 360 }
    const out = placeCtxMenu(anchor, size, viewport)
    expect(out.side).toBe('above')
    expect(out.top).toBe(700 - CTX_MENU_GAP - 240)
    // 关键：菜单的整体不与那一行重叠。
    expect(out.top + size.height).toBeLessThanOrEqual(anchor.top)
  })

  it('clamps into the viewport when neither side fits', () => {
    const out = placeCtxMenu({ top: 0, bottom: 844, left: 0, right: 390 }, size, viewport)
    expect(out.side).toBe('clamped')
    expect(out.top).toBe(CTX_MENU_MARGIN)
    expect(out.top + size.height).toBeLessThanOrEqual(viewport.height - CTX_MENU_MARGIN)
  })

  it('keeps the menu inside the side margins when the row touches an edge', () => {
    const right = placeCtxMenu({ top: 100, bottom: 140, left: 380, right: 390 }, size, viewport)
    expect(right.left).toBe(viewport.width - size.width - CTX_MENU_MARGIN)
    const left = placeCtxMenu({ top: 100, bottom: 140, left: -20, right: 30 }, size, viewport)
    expect(left.left).toBe(CTX_MENU_MARGIN)
  })

  it('stays on screen when the pressed block has already scrolled below the fold', () => {
    // 实测：程序化打开菜单（或长按后列表被顶走）时锚点能落在屏幕外，翻上去那条分支
    // 会算出 900 多的 top，菜单底部几项点不到。
    const out = placeCtxMenu({ top: 900, bottom: 960, left: 24, right: 360 }, size, viewport)
    expect(out.top).toBeGreaterThanOrEqual(CTX_MENU_MARGIN)
    expect(out.top + size.height).toBeLessThanOrEqual(viewport.height - CTX_MENU_MARGIN)
  })
})
