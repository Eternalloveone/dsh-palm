import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'platform', 'quality-budget.ts')
let text = readFileSync(P, 'utf8')

text = text.replace(
  "cssPx: { value: 1715, why: '间距/字号/圆角阶梯已存在；逐屏重写时替换' },",
  "cssPx: { value: 1721, why: 'P4 结论卡新增 6 处边框宽度（1px 卡边 + 3px 四态边 + 2px 交付物条）；P8 删旧样式后回落' },",
)
text = text.replace(
  "cssClasses: { value: 842, why: '同一视觉意图只该有一个类名；重写屏时合并' },",
  "cssClasses: { value: 849, why: 'P4 结论卡新增 7 个类（骨架 6 + 交付物项 1）；P8 合并旧类后回落' },",
)

writeFileSync(P, text)
console.log('quality budget: cssPx 1721 / cssClasses 849')
