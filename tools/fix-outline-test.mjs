import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'OutlineView.test.tsx')
let text = readFileSync(P, 'utf8')

text = text.replace(
  `    // 最近一轮在列表里，最早的不在
    expect(screen.getByText('第 260 轮')).toBeDefined()
    expect(screen.queryByText('第 1 轮')).toBeNull()`,
  `    // 最近一轮在列表里，最早的不在（"第 N 轮"这串在轮次标签与提问里都会出现，用 getAll 判存在）
    expect(screen.getAllByText('第 260 轮').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('第 1 轮')).toHaveLength(0)`,
)

writeFileSync(P, text)
console.log('断言已改为多元素判定')
