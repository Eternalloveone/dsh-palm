/**
 * 包内 README 必须与仓库根 README 同步（只差"相对链接转绝对"）。
 *
 * 两份都是门面：GitHub 看根目录那份，npm 看包目录那份。以前它们各写各的，
 * 结果 npm 上长期挂着一份 1.x 的旧文档，而仓库里已经是 2.0 的重写版。
 *
 * 这条测试把"同步"变成可执行约束：改了根 README 就得跑一次生成，
 * 忘了同步立刻红，而不是等到发版后才发现 npm 页面是旧文案。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repoRoot = new URL('../../../', import.meta.url)
const BLOB = 'https://github.com/Eternalloveone/dsh-palm/blob/main/'

/** 与生成脚本同一条规则：锚点与绝对地址不动，其余相对路径挂到 GitHub 上。 */
function toAbsoluteLinks(markdown: string): string {
  return markdown.replace(/\]\((?!#|https?:)([^)\s]+)\)/g, (_match, target: string) => {
    return `](${BLOB}${target.replace(/^\.\//, '')})`
  })
}

describe('包内 README', () => {
  it('与仓库根 README 同步（相对链接已转绝对地址）', () => {
    const root = readFileSync(new URL('README.md', repoRoot), 'utf8')
    const pkg = readFileSync(new URL('packages/dsh-palm/README.md', repoRoot), 'utf8')
    expect(pkg).toBe(toAbsoluteLinks(root))
  })

  it('包内 README 不含相对链接（npm 页面上会 404）', () => {
    const pkg = readFileSync(new URL('packages/dsh-palm/README.md', repoRoot), 'utf8')
    const relative = [...pkg.matchAll(/\]\((?!#|https?:)([^)\s]+)\)/g)].map(match => match[1])
    expect(relative).toEqual([])
  })
})
