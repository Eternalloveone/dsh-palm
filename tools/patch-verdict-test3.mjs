import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const a = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'ui', 'verdict-card.test.tsx')
let ta = readFileSync(a, 'utf8')
// 秒数已挪到独立元素，文案从「3 秒」变成「3s」
ta = ta.replace("expect(screen.getByText('3 秒')).toBeDefined()", "expect(screen.getByText('3s')).toBeDefined()")
writeFileSync(a, ta)
console.log('patched:', ta.includes("'3s'"), '| 残留 3 秒:', ta.includes("'3 秒'"))
