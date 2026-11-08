/**
 * 视觉基线（令牌层）—— golden 门禁。
 *
 * 为什么要它：`tools/mobile-visual` 那套像素基线要一台**已配对**的宿主才能跑
 * （它会真的开浏览器、登录、截图）。CI 与日常改动没有那个环境，于是"配色被改了
 * 没人发现"这类问题只能靠人眼。
 *
 * 这里换一个便宜但有效的口径：把**令牌表本身**当基线。三套皮肤 + 浅深两色下，
 * 每个 `--palm-*` 令牌解析成什么值，全部落进 `tests/golden/tokens.json`。
 * 任何一次"顺手改个颜色/间距"都会红，必须显式更新基线并说明理由。
 *
 * 更新基线：`PALM_UPDATE_TOKENS=1 pnpm test tokens-golden`
 *
 * @module dsh-palm/mobile/design/tokens-golden.test
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MOBILE = join(import.meta.dirname, '..')
const TOKENS_FILE = join(MOBILE, 'styles', '000-tokens.css')
const GOLDEN = join(MOBILE, '..', '..', 'tests', 'golden', 'tokens.json')

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = stripComments(readFileSync(TOKENS_FILE, 'utf8'))
const UPDATE = process.env['PALM_UPDATE_TOKENS'] === '1'

/**
 * 取出某个选择器**所有出现处**的令牌声明（后出现的覆盖先出现的）。
 *
 * 令牌文件里同一个选择器会出现多次：基础层写一个 `:root`，皮肤层再写
 * `:root, html[data-skin='graphite']`。只取第一处会漏掉一半令牌（曾经真的漏了
 * `--palm-hi` 与 `--palm-r-s`）。
 */
function declarationsIn(selectorText: string): Record<string, string> {
  const out: Record<string, string> = {}
  let from = 0
  for (;;) {
    const start = CSS.indexOf(selectorText, from)
    if (start === -1) break
    from = start + selectorText.length
    const open = CSS.indexOf('{', start)
    const close = CSS.indexOf('}', open)
    if (open === -1 || close === -1) continue
    for (const line of CSS.slice(open + 1, close).split(';')) {
      const match = /^\s*(--palm-[a-z0-9-]+)\s*:\s*([^;]+)$/i.exec(line.trim())
      if (match !== null) out[match[1]] = match[2].trim()
    }
  }
  return out
}

/** 一份皮肤快照：基础令牌 + 该皮肤覆盖后的结果。 */
function snapshot(skinSelector: string | undefined): Record<string, string> {
  const base = declarationsIn(':root')
  const overrides = skinSelector === undefined ? {} : declarationsIn(skinSelector)
  return Object.fromEntries(
    Object.keys({ ...base, ...overrides }).sort().map(key => [key, overrides[key] ?? base[key]]),
  )
}

const current = {
  'graphite': snapshot("html[data-skin='graphite']"),
  'paper': snapshot("html[data-skin='paper']"),
  'nocturne': snapshot("html[data-skin='nocturne']"),
}

describe('视觉基线：令牌表（golden）', () => {
  it('三套皮肤都解析得出令牌（不是空表）', () => {
    for (const [skin, tokens] of Object.entries(current)) {
      expect(Object.keys(tokens).length, `${skin} 没有解析到令牌`).toBeGreaterThan(10)
    }
  })

  it('三套皮肤的令牌集合一致（皮肤只换值，不换键）', () => {
    const keys = Object.keys(current.graphite).sort()
    expect(Object.keys(current.paper).sort()).toEqual(keys)
    expect(Object.keys(current.nocturne).sort()).toEqual(keys)
  })

  it('与基线一致（改色/改间距必须显式更新基线）', () => {
    if (UPDATE) {
      mkdirSync(dirname(GOLDEN), { recursive: true })
      writeFileSync(GOLDEN, `${JSON.stringify(current, null, 2)}\n`)
    }
    expect(existsSync(GOLDEN), '缺少 tests/golden/tokens.json（首次用 PALM_UPDATE_TOKENS=1 生成）').toBe(true)
    const baseline = JSON.parse(readFileSync(GOLDEN, 'utf8')) as typeof current
    expect(current).toEqual(baseline)
  })
})
