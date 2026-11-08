/**
 * 死样式清理：把"生产源码与测试都没引用"的类规则整块删掉。
 *
 * 与 dead-css.mjs 共用判定（生产引用 / 动态拼接 / 测试引用三者都查），
 * 这里只负责**安全地删**：按规则块（选择器行到收尾 `}`）删除，并统计行数。
 *
 * 用法：node tools/prune-dead-css2.mjs [--dry]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const MOBILE = join(ROOT, 'packages', 'dsh-palm', 'src', 'mobile')
const STYLES = join(MOBILE, 'styles')
const DRY = process.argv.includes('--dry')

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else out.push(abs)
  }
  return out
}

const ALL = walk(MOBILE)
const PROD_TEXT = ALL.filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('mobile-styles.ts'))
  .map(f => readFileSync(f, 'utf8')).join('\n')
const TEST_TEXT = ALL.filter(f => /\.test\.tsx?$/.test(f)).map(f => readFileSync(f, 'utf8')).join('\n')

const dynamic = cls => {
  const parts = cls.split('-')
  for (let cut = parts.length - 1; cut >= 1; cut -= 1) {
    const prefix = parts.slice(0, cut).join('-')
    if (PROD_TEXT.includes(prefix + '-${') || PROD_TEXT.includes(prefix + ' ${')) return true
  }
  return false
}

const isDead = cls => cls.length >= 3 && !PROD_TEXT.includes(cls) && !dynamic(cls) && !TEST_TEXT.includes(cls)

let removedBlocks = 0
let removedLines = 0
const removedNames = []

for (const name of readdirSync(STYLES).filter(n => n.endsWith('.css')).sort()) {
  const path = join(STYLES, name)
  const lines = readFileSync(path, 'utf8').split('\n')
  const out = []
  let skipping = false

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (!skipping) {
      const match = /^\.([a-zA-Z][a-zA-Z0-9_-]*)/.exec(line)
      if (match !== null && isDead(match[1])) {
        // 紧邻上方的注释一并删掉
        while (out.length > 0) {
          const last = out[out.length - 1].replace(/\r$/, '').trim()
          if (last.startsWith('/*') || (last.startsWith('*') && !last.endsWith('*/'))) {
            out.pop()
            removedLines += 1
          } else break
        }
        skipping = true
        removedBlocks += 1
        removedNames.push('.' + match[1])
        removedLines += 1
        continue
      }
      out.push(raw)
      continue
    }
    removedLines += 1
    if (line.trim() === '}' || line.trim().endsWith('}')) skipping = false
  }

  if (!DRY) writeFileSync(path, out.join('\n'))
}

console.log(`${DRY ? '将删除' : '已删除'} ${removedBlocks} 个规则块 / ${removedLines} 行`)
console.log(removedNames.join(' '))
