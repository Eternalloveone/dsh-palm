/**
 * 硬编码颜色门禁（2026-11-10）：除了令牌文件，样式里不许再出现任何颜色字面量。
 *
 * 为什么要有这条：换肤之所以会「打架」，除了两套调色板并存，另一半是组件里直接写死的
 * 颜色（rgba(0,0,0,.18) 的阴影、#fff 的字、var(--accent, #4f7cff) 的兜底字面值）。
 * 这些值不经过令牌，任何皮肤都改不动它们，于是同一屏上一半跟着皮肤变、一半不变。
 *
 * 规则：
 * 1. 只有 styles/000-tokens.css 可以写颜色；
 * 2. 其他样式文件里的颜色一律走 var(--palm-*) / 已桥接的旧名；
 * 3. 两个例外，都写在 ALLOW 里并写明原因（蒙版色不是颜色，是 alpha 通道）。
 *
 * @module dsh-palm/mobile/design/no-raw-colors
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const STYLES = join(process.cwd(), 'src', 'mobile', 'styles')
const COLOR_RX = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/

/** 逐行剥掉注释（块注释跨行时保留其中的换行，行号才对得上）。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
}

/**
 * 唯一允许的颜色字面量：蒙版渐变里的 #000 / transparent。
 *
 * 蒙版用的是 **alpha 通道**，不是可见颜色：`linear-gradient(90deg, #000 86%, transparent)`
 * 读作「左边不透明、右边渐隐」。换成令牌反而会被皮肤改坏（纸色皮肤下发灰）。
 */
const MASK_ALLOW = /mask-image:\s*linear-gradient\([^;]*#000/

describe('样式里不许出现硬编码颜色', () => {
  const files = readdirSync(STYLES).filter((f) => f.endsWith('.css') && f !== '000-tokens.css').sort()

  it('至少扫到了样式文件（防止目录改名后断言静默通过）', () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it.each(files)('%s 没有颜色字面量', (file) => {
    const css = stripComments(readFileSync(join(STYLES, file), 'utf8')).replace(/\r\n/g, '\n')
    const offenders = css
      .split('\n')
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter((row) => COLOR_RX.test(row.text) && !MASK_ALLOW.test(row.text))
      .map((row) => row.line + ': ' + row.text)
    expect(offenders).toEqual([])
  })
})
