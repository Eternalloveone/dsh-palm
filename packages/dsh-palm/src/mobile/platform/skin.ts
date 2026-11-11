/**
 * 皮肤（P1 设计系统的运行时开关）。
 *
 * 皮肤 = **同一份组件样式 + 不同令牌值**：只改 `<html data-skin>`，
 * 结构、类名、组件代码一律不动（见 docs/mobile-design-spec.md 第六节）。
 *
 * 皮肤是**唯一**的外观开关：它同时决定表面材质、强调色、以及明暗极性
 * （`data-theme` 由本模块写入）。2026-11-10 之前另有一套「跟随系统的明暗」设置，
 * 两套轴会互相打架，已移除。
 *
 * @module dsh-palm/mobile/platform/skin
 */

/** 三套皮肤。 */
export type MobileSkin = 'graphite' | 'paper' | 'nocturne' | 'newsprint' | 'endfield' | 'claude'

/** 皮肤的中文名（界面上只说人话）。 */
export const SKIN_LABEL: Record<MobileSkin, string> = {
  claude: 'Claude',
  endfield: '终末地',
  graphite: '石墨',
  paper: '纸',
  nocturne: '夜航',
  newsprint: '报纸',
}

/** 皮肤的适用底色说明（避免用户在浅色下选到为深色设计的皮肤）。 */
export const SKIN_HINT: Record<MobileSkin, string> = {
  claude: '米白纸面 + 陶土橙，像 Claude 桌面',
  endfield: '浅色暖白，全直角工业',
  graphite: '深色底，默认',
  paper: '浅色底，偏暖',
  nocturne: '深色底，偏蓝',
  newsprint: '浅色暖白，衬线正文',
}

/** 每套皮肤对应的浏览器 chrome 色（iOS 状态栏 / Android 地址栏取这个值）。 */
const SKIN_CHROME: Record<MobileSkin, string> = {
  claude: '#ffffff',
  endfield: '#e8e8e2',
  graphite: '#101015',
  paper: '#faf8f4',
  nocturne: '#080c14',
  newsprint: '#f5f3ed',
}

const STORAGE_KEY = 'dsh.palm.skin'
const DEFAULT_SKIN: MobileSkin = 'graphite'

const listeners = new Set<() => void>()

/** 读存下来的皮肤；非法值一律回默认，不让脏数据把界面搞花。 */
export function getSkin(): MobileSkin {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'paper' || value === 'nocturne' || value === 'graphite' || value === 'newsprint' || value === 'endfield' || value === 'claude' ? value : DEFAULT_SKIN
  } catch {
    return DEFAULT_SKIN
  }
}

/** 把皮肤写到 <html data-skin> 上（样式只认这个属性）。 */
/** 皮肤极性：纸是浅色底，石墨/夜航是深色底。 */
export function skinPolarity(skin: MobileSkin = getSkin()): 'light' | 'dark' {
  return skin === 'paper' || skin === 'newsprint' || skin === 'endfield' || skin === 'claude' ? 'light' : 'dark'
}

/**
 * 把皮肤写到 <html data-skin> 上（样式只认这个属性），同时把 `data-theme` 钉成
 * 这套皮肤的极性。
 *
 * 2026-11-10「主题色与皮肤冲突」的另一半：`data-theme` 以前只跟随系统深浅，
 * 于是「纸色皮肤 + 系统深色」会拿到深色的语法高亮色板（深底配色写在浅色纸上），
 * 「石墨皮肤 + 系统浅色」反之。皮肤本身就定了明暗，主题必须跟着皮肤走。
 */
export function applySkin(skin: MobileSkin = getSkin()): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.skin = skin
  document.documentElement.dataset.theme = skinPolarity(skin)
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta !== null) meta.content = SKIN_CHROME[skin]
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

/**
 * 试穿：只应用、不落盘（皮肤商店里点一下当场换，取消就还原）。
 *
 * 2026-11-11：皮肤有十来套、还带装饰之后，光看缩略图选不准——必须"穿上身"看整屏。
 * 所以试穿必须能改全局外观，但**不能**污染用户当前选择：离开商店时由调用方
 * 用 {@link setSkin} 写回原皮肤（或新皮肤）。
 */
export function previewSkin(skin: MobileSkin): void {
  applySkin(skin)
  for (const listener of [...listeners]) listener()
}

/** 订阅皮肤变更；返回退订函数。 */
export function subscribeSkin(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
