/**
 * 皮肤（P1 设计系统的运行时开关）。
 *
 * 皮肤 = **同一份组件样式 + 不同令牌值**：只改 `<html data-skin>`，
 * 结构、类名、组件代码一律不动（见 docs/mobile-design-spec.md 第六节）。
 *
 * 与 `mobile-theme.ts` 的关系：`data-theme` 决定浅色/深色两套底色（跟随系统），
 * `data-skin` 决定强调色与表面材质。两者互不干扰，可以叠加。
 *
 * @module dsh-palm/mobile/platform/skin
 */

/** 三套皮肤。 */
export type MobileSkin = 'graphite' | 'paper' | 'nocturne'

/** 皮肤的中文名（界面上只说人话）。 */
export const SKIN_LABEL: Record<MobileSkin, string> = {
  graphite: '石墨',
  paper: '纸',
  nocturne: '夜航',
}

/** 皮肤的适用底色说明（避免用户在浅色下选到为深色设计的皮肤）。 */
export const SKIN_HINT: Record<MobileSkin, string> = {
  graphite: '深色底，默认',
  paper: '浅色底，偏暖',
  nocturne: '深色底，偏蓝',
}

const STORAGE_KEY = 'dsh.palm.skin'
const DEFAULT_SKIN: MobileSkin = 'graphite'

const listeners = new Set<() => void>()

/** 读存下来的皮肤；非法值一律回默认，不让脏数据把界面搞花。 */
export function getSkin(): MobileSkin {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'paper' || value === 'nocturne' || value === 'graphite' ? value : DEFAULT_SKIN
  } catch {
    return DEFAULT_SKIN
  }
}

/** 把皮肤写到 <html data-skin> 上（样式只认这个属性）。 */
export function applySkin(skin: MobileSkin = getSkin()): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.skin = skin
}

/** 切皮肤：落盘 + 应用 + 广播（打开的页面立刻跟着变）。 */
export function setSkin(skin: MobileSkin): void {
  try {
    localStorage.setItem(STORAGE_KEY, skin)
  } catch {
    // 隐私模式下写不进去：本次仍然生效，只是下次打开回到默认。
  }
  applySkin(skin)
  for (const listener of [...listeners]) listener()
}

/** 订阅皮肤变更；返回退订函数。 */
export function subscribeSkin(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
