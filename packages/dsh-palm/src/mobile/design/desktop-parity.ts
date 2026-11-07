/**
 * **桌面设计令牌与移动端的一致性账本**（W5-4，ADR 0006 的第一步落地）。
 *
 * 同一个产品有两个界面，配色各写一套：移动端在 `design/tokens.ts`，桌面端在
 * `client/remote.module.css` 的 `--palm-*` 变量里。**改一次要改两处，而且此前没有任何
 * 断言能发现不一致**——这就是 ADR 0006 记录的问题。
 *
 * 本轮不做"一次统一所有色值"（那要逐屏过视觉门禁，风险大）。先做**能发现漂移**这件事：
 *
 * 1. {@link DESKTOP_TOKEN_PAIRS} 声明"哪个移动端 token 对应哪个桌面变量"；
 * 2. {@link KNOWN_DIVERGENCES} 把**今天已经不一致的**那几对写死，每条带原因；
 * 3. `desktop-parity.test.ts` 断言：不一致的集合**必须恰好等于**这份账本。
 *
 * 这条断言有三个方向的作用，缺一不可：
 * - 新漂移 → 失败（这才是本来该有的保护）；
 * - 修好了某一对却没更新账本 → 也失败（账本必须跟着变小，否则它会腐烂成谎言）；
 * - 某一端把变量改名/删掉 → 失败（映射表失效要立刻知道）。
 *
 * @module dsh-palm/mobile/design/desktop-parity
 */

import type { Palette } from './tokens.ts'

/** 桌面端 `--palm-*` 变量的来源文件（相对包根）。 */
export const DESKTOP_CSS_PATH = 'src/client/remote.module.css'

/**
 * 移动端 token ↔ 桌面变量。
 *
 * **只映射两端都真的在用的**：桌面那 23 个变量里，`--palm-shadow` / `--palm-font` /
 * `--palm-transition` 这类移动端有自己的等价物但语义不同，硬统一会造出没人用的令牌
 * （ADR 0006 的"代价"一节已经点过）。
 */
export const DESKTOP_TOKEN_PAIRS: ReadonlyArray<readonly [mobile: `--${string}`, desktop: string]> = [
  ['--bg-page', '--palm-bg'],
  ['--bg-surface', '--palm-card'],
  ['--text-primary', '--palm-text'],
  ['--text-secondary', '--palm-text-secondary'],
  ['--text-muted', '--palm-text-muted'],
  ['--border-default', '--palm-border'],
  ['--accent', '--palm-accent'],
  ['--accent-soft', '--palm-accent-soft'],
  ['--positive', '--palm-success'],
  ['--warning', '--palm-warning'],
  ['--danger', '--palm-danger'],
]

/**
 * 今天**已知不一致**的令牌对，值为原因。
 *
 * 这份账本只允许变小：修好一对就删一行，测试会强制你删。
 * 加一行必须写清"为什么不一致"，否则它只是把问题藏起来。
 */
export const KNOWN_DIVERGENCES: Readonly<Record<string, string>> = {
  '--bg-surface': '移动端卡片更深一档（#13131a vs #181820），深色下与页面底色的对比更强；待逐屏视觉确认后再统一',
  '--text-primary': '移动端偏蓝（#1a1a2e vs #1a1a1e），是 W1-1 调色板有意为之；统一前要看一遍长文阅读效果',
  '--text-secondary': '移动端更深（#4a4a5a vs #6b6b74），手机阳光下的可读性优先',
  '--text-muted': '两端深浅相反（移动端偏深、桌面偏浅），语义一致但不是同一个值',
  '--border-default': '移动端略冷（#e2e4e8 vs #e5e5e8），肉眼不可分辨但值不同',
  '--accent': '**不能直接统一**：桌面 #6366f1 上放白字实测 4.47:1，低于 WCAG AA 的 4.5；移动端 #5b5cf0 达标。要统一应让桌面改用移动端值（或更深一档），而不是反过来',
  '--accent-soft': '跟随主色，主色统一后自动一致',
  '--positive': '桌面只有一个值（无深色变体），移动端深浅分开',
  '--warning': '移动端更亮（琥珀 #f59e0b vs 深琥珀 #d97706）',
  '--danger': '移动端更亮（#ef4444 vs #dc2626）',
}

/** 从桌面 CSS 里读出 `--palm-*` 的定义（同名多次出现时保持出现顺序）。 */
export function readDesktopPalms(css: string): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const re = /(--palm-[a-z0-9-]+)\s*:\s*([^;]+);/g
  let match: RegExpExecArray | null
  while ((match = re.exec(css)) !== null) {
    const name = match[1]
    const value = match[2].trim()
    const list = found.get(name)
    if (list === undefined) found.set(name, [value])
    else if (!list.includes(value)) list.push(value)
  }
  return found
}

/** 一对令牌的比较结果。 */
export interface PairComparison {
  mobile: string
  desktop: string
  /** 移动端的值（浅色、深色）。 */
  mobileValues: string[]
  /** 桌面端的值（浅色、深色）。 */
  desktopValues: string[]
  /** 两端完全一致。 */
  same: boolean
  /** 某一端缺这个令牌（映射表失效）。 */
  missing: boolean
}

/** 逐对比一遍。 */
export function comparePalettes(
  light: Palette,
  dark: Palette,
  desktop: Map<string, string[]>,
): PairComparison[] {
  return DESKTOP_TOKEN_PAIRS.map(([mobile, desktopName]) => {
    const mobileValues = [light[mobile], dark[mobile]].filter((value): value is string => value !== undefined)
    const desktopValues = desktop.get(desktopName) ?? []
    const missing = mobileValues.length === 0 || desktopValues.length === 0
    const same = !missing
      && mobileValues.length === desktopValues.length
      && mobileValues.every((value, index) => value === desktopValues[index])
    return { mobile, desktop: desktopName, mobileValues, desktopValues, same, missing }
  })
}

/** 只返回不一致（或缺失）的那些对，键是移动端 token 名。 */
export function divergencesOf(comparisons: readonly PairComparison[]): string[] {
  return comparisons.filter(entry => !entry.same).map(entry => entry.mobile).sort()
}
