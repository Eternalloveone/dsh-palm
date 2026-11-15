// @vitest-environment node
/**
 * 皮肤图标贴图层的守卫（2026-11-14，B 方案）。
 *
 * 贴图由 `scripts/gen-skin-icons.mjs` 从点阵生成。生成物最容易出的三种错，都不会
 * 让构建失败，只会让界面悄悄变差：
 *   1. 有人手改了某个 SVG，下次跑生成器又被覆盖 → 「为什么改了没用」；
 *   2. 点阵里的字形名和 `icons.tsx` 的 `data-icon` 对不上 → CSS 里那条规则永远不命中；
 *   3. 皮肤 id 拼错 → 贴图出现在错误的皮肤上，或者永远不出现。
 * 素材清单本身的完整性由 skin-assets.test.ts 管，这里只管「生成器与仓库一致」。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PKG = fileURLToPath(new URL('../../', import.meta.url))
const SCRIPT = join(PKG, 'scripts', 'gen-skin-icons.mjs')
const ICONS = readFileSync(join(PKG, 'src/mobile/components/icons.tsx'), 'utf8')
const ART_CSS = readFileSync(join(PKG, 'src/mobile/styles/597-skin-icon-art.css'), 'utf8')

/** 生成器源码里的字形名（`'name': [` 形式）。 */
const glyphNames = [...readFileSync(SCRIPT, 'utf8').matchAll(/^ {2}'([a-z-]+)': \[/gm)].map(m => m[1]!)

/** 生成器源码里登记的皮肤与风格。 */
const skinStyles = [...readFileSync(SCRIPT, 'utf8').matchAll(/^ {2}'([a-z-]+)': '(block|chunky|outline)',/gm)]
  .map(m => m[1]!)

describe('皮肤图标贴图层', () => {
  it('磁盘上的 SVG 与生成器一致（手改会被覆盖，先改点阵）', () => {
    expect(() => execFileSync(process.execPath, [SCRIPT, '--check'], { cwd: PKG, stdio: 'pipe' })).not.toThrow()
  })

  it('点阵里的每个字形都真的存在（否则 CSS 那条规则永远不命中）', () => {
    const missing = glyphNames.filter(name => !ICONS.includes(`data-icon="${name}"`))
    expect(missing).toEqual([])
    // 15 个起步；掉到个位数说明点阵被删了。
    expect(glyphNames.length).toBeGreaterThanOrEqual(15)
  })

  it('每套皮肤都在 CSS 里给每个字形配了贴图，且 URL 指向自己那套', () => {
    const problems: string[] = []
    for (const skin of skinStyles) {
      for (const icon of glyphNames) {
        const expected = `html[data-skin='${skin}'] .skin-icon[data-icon='${icon}'] { --palm-icon-art: url('/m/skin-assets/${skin}/${icon}.svg') }`
        if (!ART_CSS.includes(expected)) problems.push(`${skin}/${icon}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('外壳尺寸与「藏掉内联 SVG」三条规则把三套皮肤都算进去了', () => {
    for (const skin of skinStyles) {
      const blocks = ART_CSS.split('\n').filter(line => line.startsWith(`html[data-skin='${skin}'] :is(`))
      expect(blocks.length, `${skin} 缺少尺寸/::before/藏 SVG 三条规则之一`).toBeGreaterThanOrEqual(3)
    }
  })
})
