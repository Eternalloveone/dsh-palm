// 机械化迁移：把 mobile-api.ts 的某个模块级 let 搬进 api/process-state.ts 的容器。
// 用法：node tools/migrate-api-state.mjs finishedRunsFile
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const name = process.argv[2]
if (!name) {
  console.error('用法：node tools/migrate-api-state.mjs <变量名>')
  process.exit(1)
}

const FILE = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const lines = readFileSync(FILE, 'utf8').split('\n')
const declPattern = new RegExp(`^(?:export\\s+)?(?:let|var)\\s+${name}\\b`)

const declIndex = lines.findIndex(line => declPattern.test(line))
if (declIndex < 0) {
  console.error(`没找到模块级声明：${name}`)
  process.exit(1)
}

// 多行声明：从声明行开始，一直吃到类型闭合（下一行不再缩进，或遇到新的语句关键字）
const consumeDeclaration = (start) => {
  let end = start
  if (/=\s*$|=\s*[^;]+$/.test(lines[start]) && !/\{$/.test(lines[start])) return end
  for (let i = start + 1; i < lines.length; i += 1) {
    const text = lines[i]
    if (text.trim() === '') break
    if (/^\s{2,}\S/.test(text) && !/^\s*(const|let|var|function|export|import|if|for|while|return|async)\b/.test(text)) {
      end = i
      if (/\}\s*(\|\s*undefined)?\s*$/.test(text)) break
      continue
    }
    break
  }
  return end
}

const isComment = line => /^\s*(\/\/|\*|\/\*)/.test(line)
const word = new RegExp(`\\b${name}\\b`, 'g')

let rewritten = 0
const next = lines.map((line, index) => {
  if (index === declIndex) return null // 删掉声明
  if (isComment(line)) return line // 注释保持可读
  if (!word.test(line)) return line
  rewritten += 1
  return line.replace(word, `processState.${name}`)
}).filter(line => line !== null)

// 在删除声明的位置插入 import，避免动文件头
const importLine = `import { processState } from './mobile/api/process-state.ts'`
next.splice(declIndex, 0, importLine)

writeFileSync(FILE, next.join('\n'))
console.log(`已搬移 ${name}：删除声明 1 行，改写 ${rewritten} 行引用，插入 import 1 行`)
console.log(`新行数 ${next.length}（原 ${lines.length}）`)
