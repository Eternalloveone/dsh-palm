import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 1) 基线减去刚搬走的三个
const TEST = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'platform', 'api-state.test.ts')
let test = readFileSync(TEST, 'utf8')
for (const name of ['usageCache', 'sessionProjectionSnapshots', 'locateSessionCache']) {
  test = test.replace(new RegExp(`\\s*'${name}',\\n`), '\n')
}
writeFileSync(TEST, test)

// 2) 迁移脚本补上「多行声明」处理，避免再留下孤儿类型行
const MIGRATE = join(import.meta.dirname, 'migrate-api-state.mjs')
let migrate = readFileSync(MIGRATE, 'utf8')
if (!migrate.includes('consumeDeclaration')) {
  migrate = migrate.replace(
    'const isComment = line => /^\\s*(\\/\\/|\\*|\\/\\*)/.test(line)',
    `// 多行声明：从声明行开始，一直吃到类型闭合（下一行不再缩进，或遇到新的语句关键字）
const consumeDeclaration = (start) => {
  let end = start
  if (/=\\s*$|=\\s*[^;]+$/.test(lines[start]) && !/\\{$/.test(lines[start])) return end
  for (let i = start + 1; i < lines.length; i += 1) {
    const text = lines[i]
    if (text.trim() === '') break
    if (/^\\s{2,}\\S/.test(text) && !/^\\s*(const|let|var|function|export|import|if|for|while|return|async)\\b/.test(text)) {
      end = i
      if (/\\}\\s*(\\|\\s*undefined)?\\s*$/.test(text)) break
      continue
    }
    break
  }
  return end
}

const isComment = line => /^\\s*(\\/\\/|\\*|\\/\\*)/.test(line)`,
  )
  migrate = migrate.replace(
    130,
    'const isComment = line => /^\\s*(\\/\\/|\\*|\\/\\*)/.test(line)',
  )
  writeFileSync(MIGRATE, migrate)
  console.log('migrate script patched')
} else {
  console.log('migrate script already patched')
}
console.log('baseline updated')
