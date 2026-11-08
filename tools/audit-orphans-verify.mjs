import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const SRC = join(PKG, 'src')

const files = []
;(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path)
    else if (/\.(ts|tsx)$/.test(name)) files.push(path)
  }
})(SRC)

const production = files.filter(file => !/\.test\.tsx?$/.test(file))
const texts = new Map(production.map(file => [file, readFileSync(file, 'utf8')]))
// 测试文件也算"有人用"：只被测试引用的模块是测试专用模块，不是死代码
const testTexts = files.filter(file => /\.test\.tsx?$/.test(file)).map(file => readFileSync(file, 'utf8')).join('\n')
const corpus = [...texts.values()].join('\n') + '\n' + testTexts

const suspects = [
  'design/desktop-parity.ts',
  'dev/ui-gallery.tsx',
  'kernels/cache-exceptions.ts',
  'platform/module-graph.ts',
  'platform/quality-budget.ts',
  'wire/frames.ts',
  'wire/handshake.ts',
  'remote-methods.ts',
  'css-modules.d.ts',
]

for (const rel of suspects) {
  const name = basename(rel).replace(/\.tsx?$/, '')
  // 任何形式的引用：from / import() / require() / 字符串路径
  const pattern = new RegExp(`(from|import\\(|require\\()\\s*['"][^'"]*${name}(\\.tsx?)?['"]|['"][^'"]*${name}\\.tsx?['"]`, 'g')
  const hits = [...corpus.matchAll(pattern)].map(match => match[0]).slice(0, 3)
  console.log(`${rel}: ${hits.length === 0 ? '★ 无任何引用' : hits.join(' / ')}`)
}

console.log('\n--- 生产代码里有没有 import（排除测试）---')
const prodCorpus = [...texts.values()].join('\n')
for (const rel of suspects) {
  const name = basename(rel).replace(/\.tsx?$/, '')
  const inProd = new RegExp(`(from|import\\(|require\\()\\s*['"][^'"]*${name}(\\.tsx?)?['"]`).test(prodCorpus)
  console.log(`${rel}: ${inProd ? '生产引用 ✓' : '仅测试引用 / 无引用'}`)
}
