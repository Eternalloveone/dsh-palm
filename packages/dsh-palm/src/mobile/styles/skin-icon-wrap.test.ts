/**
 * 图标外壳的守卫（2026-11-14）。
 *
 * 背景：`icons.tsx` 的每个图标现在渲染成 `<span class="skin-icon"><svg/></span>`
 * （皮肤可以按 `data-icon` 换掉任意一个，见 058-skin-icon.css）。多包这一层，让
 * **直接子代**选择器整片失效，而失效不会让构建失败、只会让界面悄悄坏掉：
 *
 *   - `.palm-spec-row-ico > svg { width:18px }` 不再命中 → 设置页每行图标塌成 0×0，
 *     只剩后台那个 18px 的圆角色块（实机：一屏空白方块）；
 *   - `.palm-drawer-tool > span { flex:1 1 auto }` 把图标外壳当成文案拉宽 →
 *     图标浮在行中间，和文案对不齐（实机：抽屉底部三行）。
 *
 * 两条不变量，都只靠静态扫描就能守住：
 *   1. 任何写成 `A > svg` 的规则，同一规则里必须同时写 `A > .skin-icon > svg`
 *      （外壳穿过去，两个都命中）；
 *   2. 抽屉底部那种「图标 + 文案」的行，`> span` 必须排除外壳 `:not(.skin-icon)`。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const STYLES_DIR = fileURLToPath(new URL('.', import.meta.url))

/** 去掉注释：注释里写着示范写法（比如 058 的文件头），不能当规则算。 */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const cssFiles = readdirSync(STYLES_DIR)
  .filter(name => name.endsWith('.css'))
  .sort()

/** `选择器 { 声明 }` 列表；@media 会顺带匹配到里面的规则，正是我们想扫的。 */
function rulesOf(css: string): { file: string; selector: string; body: string }[] {
  const out: { file: string; selector: string; body: string }[] = []
  for (const file of cssFiles) {
    const text = stripComments(readFileSync(join(STYLES_DIR, file), 'utf8'))
    for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      out.push({ file, selector: match[1].trim(), body: match[2].trim() })
    }
  }
  return out
}

const rules = rulesOf('')

const normalize = (selector: string) => selector.replace(/\s+/g, ' ').trim()

/** 把 `A > svg[:pseudo]` 改写成穿外壳的写法：`A > .skin-icon[:pseudo] > svg`。 */
function wrappedOf(selector: string): string | undefined {
  const match = /^(.*) > svg(:[a-z-]+(?:\([^()]*\))?)?$/.exec(selector)
  if (!match) return undefined
  const [, head, pseudo = ''] = match
  // 外壳自己就是选择器的最后一个复合选择器时（`.skin-icon…` / `[data-icon=…]`），
  // 里面的 svg 本来就是直接子代 —— 这条不用配对。
  const last = head.slice(head.lastIndexOf(' ') + 1)
  if (last.includes('.skin-icon') || last.includes('[data-icon=')) return undefined
  return `${head} > .skin-icon${pseudo} > svg`
}

describe('图标外壳（.skin-icon）', () => {
  it('每条 `A > svg` 规则都配一条 `A > .skin-icon > svg`', () => {
    const offenders: string[] = []
    for (const rule of rules) {
      const selectors = rule.selector.split(',').map(normalize)
      for (const selector of selectors) {
        const wrapped = wrappedOf(selector)
        if (wrapped === undefined) continue
        if (selectors.includes(wrapped)) continue
        offenders.push(`${rule.file} → ${selector}（缺 ${wrapped}）`)
      }
    }
    expect(offenders, `图标被 span.skin-icon 包着，裸的直接子代选择器命不中：\n${offenders.join('\n')}`)
      .toEqual([])
  })

  it('抽屉底部入口行的 `> span` 把图标外壳排除在外', () => {
    // 这些容器里的直接子 span 有两种：图标外壳 + 文案。文案要吃掉剩余宽度、
    // 要省略号，外壳不要 —— 所以文案那几条必须 `:not(.skin-icon)`。
    const iconRows = ['palm-drawer-tool', 'palm-drawer-search']
    const offenders: string[] = []
    for (const rule of rules) {
      for (const raw of rule.selector.split(',')) {
        const selector = normalize(raw)
        if (!iconRows.some(row => selector.includes(`.${row} > span`))) continue
        if (selector.includes(':not(.skin-icon)')) continue
        offenders.push(`${rule.file} → ${selector}`)
      }
    }
    expect(offenders, `这些选择器会把图标外壳当成文案：\n${offenders.join('\n')}`).toEqual([])
  })

  it('图标风格的四个旋钮只在皮肤作用域里给值', () => {
    // 059 是「一套皮肤一种线条性格」的唯一出处。写错前缀（漏掉 html[data-skin]）
    // 会把某套皮肤的性格污染到所有皮肤上，而且不会有任何报错。
    const KNOBS = new Set([
      '--palm-icon-stroke',
      '--palm-icon-join',
      '--palm-icon-cap',
      '--palm-icon-render',
      '--palm-spec-ico-r',
    ])
    const css = stripComments(readFileSync(join(STYLES_DIR, '059-skin-icon-style.css'), 'utf8'))
    const offenders: string[] = []
    const declared = new Set<string>()
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = normalize(match[1])
      const scoped = selector === ':root' || /^html\[data-skin='[a-z0-9-]+'\]$/.test(selector)
      if (!scoped) offenders.push(`作用域不对：${selector}`)
      for (const decl of match[2].matchAll(/(--[a-z0-9-]+)\s*:/g)) {
        declared.add(decl[1]!)
        if (!KNOBS.has(decl[1]!)) offenders.push(`${selector} 里定义了未知旋钮 ${decl[1]}`)
      }
    }
    expect(offenders, `059 只许在 :root 与 html[data-skin=…] 下写图标旋钮：\n${offenders.join('\n')}`)
      .toEqual([])
    // 058 必须真的消费这四个旋钮，否则写了 varnish 也没人用（静默失效）。
    expect(declared.has('--palm-icon-stroke')).toBe(true)
    const consumer = stripComments(readFileSync(join(STYLES_DIR, '058-skin-icon.css'), 'utf8'))
    for (const knob of KNOBS) {
      if (knob === '--palm-spec-ico-r') continue // 方块圆角由 515 的 .palm-spec-row-ico 消费
      expect(consumer, `058 没有消费 ${knob}`).toContain(knob)
    }
  })
})
