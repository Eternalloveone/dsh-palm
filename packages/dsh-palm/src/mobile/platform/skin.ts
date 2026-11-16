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

/** 八套皮肤：三套自带 + 五套移植（默认 Claude）。 */
export type MobileSkin = 'graphite' | 'paper' | 'nocturne' | 'newsprint' | 'endfield' | 'claude' | 'matrix' | 'xp' | 'deep-current' | 'mint' | 'pink-sakura' | 'summer-liquid-glass' | 'furina' | 'minecraft' | 'trading' | 'cyber-night' | 'wallpaper-exclusive' | 'dragon-heir' | 'whale-song' | 'harbor' | 'war-thunder' | 'maid-atelier' | 'whale-mom' | 'blue-fantasy'

/** 皮肤的中文名（界面上只说人话）。 */
export const SKIN_LABEL: Record<MobileSkin, string> = {
  'blue-fantasy': '蓝色幻想',
  'whale-mom': '鲸鱼妈妈',
  'maid-atelier': '女仆工坊',
  'war-thunder': '战争雷霆',
  harbor: '夕港',
  'whale-song': '鲸吟',
  'dragon-heir': '龙的传人',
  'wallpaper-exclusive': '壁纸专属',
  'cyber-night': '赛博夜城',
  trading: '交易终端',
  minecraft: 'Minecraft 方块世界',
  furina: '芙宁娜',
  'summer-liquid-glass': '夏沫琉璃',
  'pink-sakura': '粉樱',
  mint: '薄荷',
  'deep-current': '深流',
  xp: 'Windows XP',
  matrix: 'Matrix 骇客帝国',
  claude: 'Claude',
  endfield: '终末地',
  graphite: '石墨',
  paper: '纸',
  nocturne: '夜航',
  newsprint: '报纸',
}

/** 皮肤的适用底色说明（避免用户在浅色下选到为深色设计的皮肤）。 */
export const SKIN_HINT: Record<MobileSkin, string> = {
  'blue-fantasy': '深蓝梦境，冰光高光',
  'whale-mom': '冰蓝浅海，温柔奶白',
  'maid-atelier': '奶油粉白，蕾丝边',
  'war-thunder': '军绿铁灰，弹药黄',
  harbor: '黄昏港湾，暖橘灯火',
  'whale-song': '深海鲸语，冰蓝金线',
  'dragon-heir': '朱砂红 + 长城砖，龙印点缀',
  'wallpaper-exclusive': '纯玻璃面板，专配背景图',
  'cyber-night': '霓虹青品双色，深墨面板',
  trading: '红涨绿跌的行情终端',
  minecraft: '方块栅格 + 直角，像素感',
  furina: '芙宁娜插画背景 + 淡蓝主题',
  'summer-liquid-glass': '日系夏祭 + 液态玻璃面板',
  'pink-sakura': '奶油粉 + 玫瑰强调，克制不腻',
  mint: '官方配色换色版，零脚本最轻',
  'deep-current': '深海墨绿 + 珍珠白，亮暗都克制',
  xp: 'Luna 蓝窗口条 + 绿色开始按钮，全直角',
  matrix: '墨绿数字雨，深夜护眼暗色',
  claude: '米白纸面 + 陶土橙，像 Claude 桌面（默认）',
  endfield: '浅色暖白，全直角工业',
  graphite: '深色底，冷灰',
  paper: '浅色底，偏暖',
  nocturne: '深色底，偏蓝',
  newsprint: '浅色暖白，衬线正文',
}

/** 每套皮肤对应的浏览器 chrome 色（iOS 状态栏 / Android 地址栏取这个值）。 */
export const SKIN_CHROME: Record<MobileSkin, string> = {
  'blue-fantasy': '#0d1b3d',
  'whale-mom': '#eef6fb',
  'maid-atelier': '#fdf3f5',
  'war-thunder': '#14170f',
  harbor: '#333c63',
  'whale-song': '#061024',
  'dragon-heir': '#f7f0ec',
  'wallpaper-exclusive': '#eef4f9',
  'cyber-night': '#03050b',
  trading: '#ffffff',
  minecraft: '#18221b',
  furina: '#ffffe1',
  'summer-liquid-glass': '#eaf6fa',
  'pink-sakura': '#fff1f6',
  mint: '#f4faf7',
  'deep-current': '#f4f8f7',
  xp: '#ffffff',
  matrix: '#040805',
  claude: '#ffffff',
  endfield: '#e8e8e2',
  graphite: '#101015',
  paper: '#faf8f4',
  nocturne: '#080c14',
  newsprint: '#f5f3ed',
}

const STORAGE_KEY = 'dsh.palm.skin'
const DEFAULT_SKIN: MobileSkin = 'maid-atelier'

const listeners = new Set<() => void>()

/** 读存下来的皮肤；非法值一律回默认，不让脏数据把界面搞花。 */
export function getSkin(): MobileSkin {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'paper' || value === 'nocturne' || value === 'graphite' || value === 'newsprint' || value === 'endfield' || value === 'claude' || value === 'matrix' || value === 'xp' || value === 'deep-current' || value === 'mint' || value === 'pink-sakura' || value === 'summer-liquid-glass' || value === 'furina' || value === 'minecraft' || value === 'trading' || value === 'cyber-night' || value === 'wallpaper-exclusive' || value === 'dragon-heir' || value === 'whale-song' || value === 'harbor' || value === 'war-thunder' || value === 'maid-atelier' || value === 'whale-mom' || value === 'blue-fantasy' ? value : DEFAULT_SKIN
  } catch {
    return DEFAULT_SKIN
  }
}

/** 把皮肤写到 <html data-skin> 上（样式只认这个属性）。 */
/** 皮肤极性：浅色底的在下面这个白名单里，其余（石墨/夜航/Matrix）一律深色。 */
export function skinPolarity(skin: MobileSkin = getSkin()): 'light' | 'dark' {
  return skin === 'paper' || skin === 'newsprint' || skin === 'endfield' || skin === 'claude' || skin === 'xp' || skin === 'deep-current' || skin === 'mint' || skin === 'pink-sakura' || skin === 'summer-liquid-glass' || skin === 'furina' || skin === 'trading' || skin === 'wallpaper-exclusive' || skin === 'dragon-heir' || skin === 'maid-atelier' || skin === 'whale-mom' ? 'light' : 'dark'
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
