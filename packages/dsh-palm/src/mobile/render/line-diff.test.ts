// @vitest-environment node
/**
 * 行级 diff（真 hunk）：手机端自己算，因为宿主只给 `{ oldText, newText }`。
 * 这里钉住四件事：改动附近才留上下文、中间插省略号、超大文本走兜底、结果有上限。
 */
import { describe, expect, it } from 'vitest'
import { lineDiffRows } from './line-diff.ts'

const text = (rows: string[]): string => rows.join('\n') + '\n'

describe('lineDiffRows', () => {
  it('只改一行：上下文包住改动，前后远处的行被省略', () => {
    const before = text(Array.from({ length: 30 }, (_, index) => `line ${index}`))
    const changed = Array.from({ length: 30 }, (_, index) => `line ${index}`)
    changed[15] = 'line 15 changed'
    const rows = lineDiffRows(before, text(changed), { context: 2 })

    const del = rows.filter(row => row.kind === 'del')
    const add = rows.filter(row => row.kind === 'add')
    expect(del.map(row => row.text)).toEqual(['line 15'])
    expect(add.map(row => row.text)).toEqual(['line 15 changed'])
    // 改动块前后各 2 行上下文：13/14 与 16/17 在，12/18 不在。
    const ctx = rows.filter(row => row.kind === 'ctx').map(row => row.text)
    expect(ctx).toEqual(['line 13', 'line 14', 'line 16', 'line 17'])
    // 开头远处被省略：首行是省略号而不是 line 0。
    expect(rows[0]).toEqual({ kind: 'skip', text: '…' })
  })

  it('新建文件：全部是新增行，没有删除行', () => {
    const rows = lineDiffRows('', text(['a', 'b']))
    expect(rows.every(row => row.kind === 'add')).toBe(true)
    expect(rows.map(row => row.text)).toEqual(['a', 'b'])
  })

  it('删除文件：全部是删除行', () => {
    const rows = lineDiffRows(text(['a', 'b']), '')
    expect(rows.every(row => row.kind === 'del')).toBe(true)
  })

  it('两份一模一样：一个改动都没有（只剩省略号）', () => {
    const same = text(Array.from({ length: 10 }, (_, index) => `line ${index}`))
    const rows = lineDiffRows(same, same)
    expect(rows.filter(row => row.kind !== 'ctx')).toHaveLength(0)
  })

  it('超出 maxRows 截断成省略号（不一次渲染上万行）', () => {
    const before = text(Array.from({ length: 900 }, (_, index) => `old ${index}`))
    const after = text(Array.from({ length: 900 }, (_, index) => `new ${index}`))
    const rows = lineDiffRows(before, after, { maxRows: 50, context: 1 })
    expect(rows).toHaveLength(50)
    expect(rows[rows.length - 1]).toEqual({ kind: 'skip', text: '…' })
  })

  it('超大文本直接走粗粒度兜底（不在手机上算 LCS）', () => {
    const before = text(Array.from({ length: 2000 }, (_, index) => `old ${index}`))
    const after = text(Array.from({ length: 2000 }, (_, index) => `new ${index}`))
    const rows = lineDiffRows(before, after, { maxLines: 100, maxRows: 400 })
    expect(rows.every(row => row.kind === 'del' || row.kind === 'add')).toBe(true)
    expect(rows).toHaveLength(400)
  })
})
