/**
 * 皮肤契约（2026-11-10）：一套样式只能有**一个调色板**在画。
 *
 * 背景：手机端曾同时存在两套颜色系统 —— `--palm-*`（三套皮肤）与 design/tokens.ts 注入的
 * 旧名（`--accent` / `--danger` / `--fill` …，按明暗主题切换）。旧名没接回皮肤时，
 * 同一屏上「皮肤的颜色」和「主题的颜色」各画一半：纸色皮肤上蹦出靛蓝按钮、夜航皮肤上
 * 出现石墨绿的红绿、切一次系统深色又整套翻一遍。
 *
 * 这两条断言把根堵死：
 * 1. 三套皮肤必须定义**同一组**颜色令牌（不许靠基础 :root 的深色值兜底）；
 * 2. design/tokens.ts 里的每个旧名必须在 000-tokens.css 里被桥接（或进显式豁免表）。
 *
 * @module dsh-palm/mobile/design/skin-contract
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MOBILE = join(process.cwd(), 'src', 'mobile')
const STYLES = join(MOBILE, 'styles')
// 统一换行：仓库里是 CRLF，而选择器断言按 LF 匹配（否则断言会静默返回空集）。
const TOKENS_CSS = readFileSync(join(MOBILE, 'styles', '000-tokens.css'), 'utf8').replace(/\r\n/g, '\n')
const DESIGN_TS = readFileSync(join(MOBILE, 'design', 'tokens.ts'), 'utf8')

/** 颜色值：十六进制 / rgb / hsl / 渐变 / 阴影 / 具名 transparent。 */
const COLOR_RX = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\blinear-gradient\(/

/** 取一个选择器块里的自定义属性定义。 */
function defsOf(selectorNeedle: string): Map<string, string> {
  const out = new Map<string, string>()
  const index = TOKENS_CSS.indexOf(selectorNeedle)
  if (index < 0) return out
  const open = TOKENS_CSS.indexOf('{', index)
  const close = TOKENS_CSS.indexOf('}', open)
  for (const line of TOKENS_CSS.slice(open + 1, close).split('\n')) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?);/)
    if (m !== null) out.set(m[1], m[2])
  }
  return out
}

/**
 * 皮肤无关的「色板说明」令牌：它们只是把三套皮肤的色块画给设置页看，
 * 自身就是某个皮肤的常量，不参与"换肤"。
 */
const SKIN_SWATCH = /^--palm-skin-/

describe('皮肤契约：每套皮肤必须各自定义完整颜色令牌', () => {
  const dark = defsOf(":root,\nhtml[data-skin='graphite']")
  const paper = defsOf("html[data-skin='paper']")
  const nocturne = defsOf("html[data-skin='nocturne']")
  const newsprint = defsOf("html[data-skin='newsprint']")
  const endfield = defsOf("html[data-skin='endfield']")
  const claude = defsOf("html[data-skin='claude']")
  const matrix = defsOf("html[data-skin='matrix']")
  const xp = defsOf("html[data-skin='xp']")
  const deepCurrent = defsOf("html[data-skin='deep-current']")
  const mint = defsOf("html[data-skin='mint']")
  const pinkSakura = defsOf("html[data-skin='pink-sakura']")
  const summerGlass = defsOf("html[data-skin='summer-liquid-glass']")
  const furina = defsOf("html[data-skin='furina']")
  const minecraft = defsOf("html[data-skin='minecraft']")
  const trading = defsOf("html[data-skin='trading']")
  const cyberNight = defsOf("html[data-skin='cyber-night']")
  const wallpaperExclusive = defsOf("html[data-skin='wallpaper-exclusive']")
  const dragonHeir = defsOf("html[data-skin='dragon-heir']")
  const whaleSong = defsOf("html[data-skin='whale-song']")
  const harbor = defsOf("html[data-skin='harbor']")
  const warThunder = defsOf("html[data-skin='war-thunder']")
  const maidAtelier = defsOf("html[data-skin='maid-atelier']")
  const whaleMom = defsOf("html[data-skin='whale-mom']")
  const blueFantasy = defsOf("html[data-skin='blue-fantasy']")
  const colorKeys = [...dark.entries()].filter(([, v]) => COLOR_RX.test(v)).map(([k]) => k)

  it('基础色板确实解析到了（防止选择器改名后断言静默失效）', () => {
    expect(colorKeys.length).toBeGreaterThan(20)
  })

  it.each([
    ['paper', paper],
    ['nocturne', nocturne],
    ['newsprint', newsprint],
    ['endfield', endfield],
    ['claude', claude],
    ['matrix', matrix],
    ['xp', xp],
    ['deep-current', deepCurrent],
    ['mint', mint],
    ['pink-sakura', pinkSakura],
    ['summer-liquid-glass', summerGlass],
    ['furina', furina],
    ['minecraft', minecraft],
    ['trading', trading],
    ['cyber-night', cyberNight],
    ['wallpaper-exclusive', wallpaperExclusive],
    ['dragon-heir', dragonHeir],
    ['whale-song', whaleSong],
    ['harbor', harbor],
    ['war-thunder', warThunder],
    ['maid-atelier', maidAtelier],
    ['whale-mom', whaleMom],
    ['blue-fantasy', blueFantasy],
  ])('%s 覆盖了基础色板的每一个颜色令牌', (name, skin) => {
    const missing = colorKeys.filter((key) => !SKIN_SWATCH.test(key) && !skin.has(key))
    expect({ skin: name, missing }).toEqual({ skin: name, missing: [] })
  })
})

describe('皮肤契约：旧名必须桥接回皮肤令牌', () => {
  /** 旧名里唯一允许保留主题色相的：语法高亮需要自己的色相（由 data-theme=皮肤极性兜住）。 */
  const EXEMPT = /^--tok-/

  const designNames = [...DESIGN_TS.matchAll(/'(--[a-z0-9-]+)':/g)].map((m) => m[1])
  const bridgeStart = TOKENS_CSS.indexOf('旧名桥接')
  const bridge = bridgeStart < 0 ? '' : TOKENS_CSS.slice(bridgeStart)
  const bridged = new Set([...bridge.matchAll(/^\s*(--[a-z0-9-]+):\s*var\(/gm)].map((m) => m[1]))

  it('design/tokens.ts 的键解析到了', () => {
    expect(designNames.length).toBeGreaterThan(40)
  })

  it('除语法高亮外，每个旧名都有 var(--palm-*) 桥接', () => {
    const unbridged = designNames.filter((name) => !EXEMPT.test(name) && !bridged.has(name))
    expect(unbridged).toEqual([])
  })
})

/**
 * 单一出处（2026-11-10「主题与皮肤冲突」的收口断言）。
 *
 * 前面两条解决"两套色板并存"：皮肤定义全、旧名全桥接。这一条解决"第三个出处"——
 * 组件样式里引用了一个谁也没定义的属性（写错名字、或从别处抄来），它不会报错，
 * 只会让那条声明静默失效，换肤时表现为"这块颜色不跟着变"。
 *
 * 允许的例外只有一类：**由 JS 内联写进去的变量**（组件按运行数据 setProperty）。
 */
describe('单一出处：样式引用的每个自定义属性都有人定义', () => {
  /** 由 JS 内联设置的属性（CSS 里只读不写）。 */
  const RUNTIME_SET = new Set([
    // 过程条进度：process-line.tsx 按步数算好后内联写入。
    '--palm-proc-ratio',
    // 语音响度与柱高系数：预留的动画输入，两者都带兜底（var(--x, 0.5)）。
    '--voice-level',
    '--m',
  ])

  const defined = new Set<string>([...DESIGN_TS.matchAll(/'(--[a-z0-9-]+)':/g)].map((m) => m[1]))
  for (const m of DESIGN_TS.matchAll(/^\s*(--[a-z0-9-]+):/gm)) defined.add(m[1])

  const styleFiles = readdirSync(STYLES).filter((f) => f.endsWith('.css'))
  const usedIn = new Map<string, string>()
  for (const file of styleFiles) {
    const css = readFileSync(join(STYLES, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) defined.add(m[1])
    for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (!usedIn.has(m[1])) usedIn.set(m[1], file)
    }
  }

  it('没有谁也没定义的属性', () => {
    const orphans = [...usedIn.entries()]
      .filter(([name]) => !defined.has(name) && !RUNTIME_SET.has(name))
      .map(([name, file]) => `${name}（首次出现于 ${file}）`)
    expect(orphans).toEqual([])
  })
})
