// @vitest-environment jsdom
/**
 * 单文件 diff 的只读行视图（P6 ⑩ 屏）：增删类名、上下文无底色、行号递增、
 * 超长行截断口径。
 *
 * 样式断言也在这里读 `styles/450-diff-page.css`——"上下文行无底色"这类要求
 * 在 jsdom 里没有计算样式可查，只能把口径钉在 DOM 类名 + 样式规则两处，
 * 否则改坏 CSS 时单测看不出来。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DiffRows, looksLikeDiff } from './diff-rows.tsx'

afterEach(() => { cleanup() })

/** 一份典型的单文件 diff：1 删 2 增，前后带上下文行。 */
const SAMPLE = [
  '--- a/src/mobile/api.ts',
  '+++ b/src/mobile/api.ts',
  '@@ -10,4 +10,5 @@',
  ' import { readFile } from "./fs.ts"',
  '-const limit = 10',
  '+const limit = 20',
  '+const extra = true',
  ' export const answer = 42',
  '',
].join('\n')

const CSS = readFileSync(join(import.meta.dirname, '..', 'styles', '450-diff-page.css'), 'utf8')

/** 取某条规则自己的声明（只匹配选择器后直接跟 `{` 的规则体）。 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(CSS)
  return match?.[1] ?? ''
}

describe('DiffRows（单文件 diff 行视图）', () => {
  it('新增行 / 删除行各自带类名与符号', () => {
    const { container } = render(<DiffRows text={SAMPLE} />)

    const adds = [...container.querySelectorAll('.diff-page-row-add')]
    expect(adds).toHaveLength(2)
    expect(adds.map(row => row.querySelector('.diff-page-text')?.textContent)).toEqual([
      'const limit = 20',
      'const extra = true',
    ])
    expect(adds.map(row => row.querySelector('.diff-page-sign')?.textContent)).toEqual(['+', '+'])

    const dels = [...container.querySelectorAll('.diff-page-row-del')]
    expect(dels).toHaveLength(1)
    expect(dels[0]?.querySelector('.diff-page-text')?.textContent).toBe('const limit = 10')
    expect(dels[0]?.querySelector('.diff-page-sign')?.textContent).toBe('−')
  })

  it('上下文行不带增删类名，也没有增删底色', () => {
    const { container } = render(<DiffRows text={SAMPLE} />)

    const ctx = [...container.querySelectorAll('.diff-page-row-ctx')]
    expect(ctx).toHaveLength(2)
    for (const row of ctx) {
      expect(row.className).toBe('diff-page-row diff-page-row-ctx')
      expect(row.getAttribute('data-line-kind')).toBe('ctx')
    }

    // 样式口径：上下文行只允许 transparent；增删行才引用 tint 令牌。
    const ctxRule = ruleBody('.diff-page-row-ctx')
    expect(ctxRule).toMatch(/background:\s*transparent/)
    expect(ctxRule).not.toMatch(/--palm-tint-(ok|danger)/)
    expect(ruleBody('.diff-page-row-add')).toMatch(/--palm-tint-ok/)
    expect(ruleBody('.diff-page-row-del')).toMatch(/--palm-tint-danger/)
  })

  it('行号只有一列且不倒退：统一按新文件位置计数', () => {
    const { container } = render(<DiffRows text={SAMPLE} />)
    const numbers = [...container.querySelectorAll('.diff-page-no')].map(no => Number(no.textContent))
    // 上下文 10 → 删除行停在新文件 11 的位置 → 增新 11 → 增新 12 → 上下文 13
    expect(numbers).toEqual([10, 11, 11, 12, 13])
    for (let index = 1; index < numbers.length; index += 1) {
      expect(numbers[index]).toBeGreaterThanOrEqual(numbers[index - 1] as number)
    }
  })

  it('hunk 旧/新起点不同时行号也不跳回（单列只向前走）', () => {
    const text = [
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -40,2 +10,2 @@',
      '-old line 40',
      '+new line 10',
      ' shared line',
      '',
    ].join('\n')
    const { container } = render(<DiffRows text={text} />)
    // 删除行显示"它在新文件里的位置"（10），不是旧文件行号 40；否则会 40 → 10 跳回。
    expect([...container.querySelectorAll('.diff-page-no')].map(no => no.textContent)).toEqual(['10', '10', '11'])
  })

  it('普通文件按上下文行显示，行号从 1 开始严格递增', () => {
    const { container } = render(<DiffRows text={'alpha\nbeta\ngamma\n'} />)
    expect(container.querySelectorAll('.diff-page-row-add')).toHaveLength(0)
    expect(container.querySelectorAll('.diff-page-row-del')).toHaveLength(0)
    const ctx = [...container.querySelectorAll('.diff-page-row-ctx')]
    expect(ctx.map(row => row.querySelector('.diff-page-text')?.textContent)).toEqual(['alpha', 'beta', 'gamma'])
    expect([...container.querySelectorAll('.diff-page-no')].map(no => no.textContent)).toEqual(['1', '2', '3'])
  })

  it('超长行：完整文本留在 DOM，视觉上截断（不横向溢出）', () => {
    const long = `export const payload = '${'a'.repeat(400)}'`
    const { container } = render(<DiffRows text={`${long}\n`} />)

    const text = container.querySelector('.diff-page-text')
    expect(text?.textContent).toBe(long)
    expect(container.querySelector('.diff-page-block')?.getAttribute('data-overflow')).toBe('truncate')

    const textRule = ruleBody('.diff-page-text')
    expect(textRule).toMatch(/text-overflow:\s*ellipsis/)
    expect(textRule).toMatch(/overflow:\s*hidden/)
    expect(textRule).toMatch(/white-space:\s*pre/)
    // 正文容器只纵向滚：横向滚动会把行号滑出视野。
    expect(ruleBody('.diff-page-body')).not.toMatch(/overflow-x/)
  })

  it('行号用等宽字体（样式令牌），diff 判据只认 hunk 头', () => {
    expect(ruleBody('.diff-page-no')).toMatch(/font-family:\s*var\(--palm-font-mono\)/)
    expect(looksLikeDiff(SAMPLE)).toBe(true)
    expect(looksLikeDiff('const a = 1\n-remove me\n+add me\n')).toBe(false)
  })
})
