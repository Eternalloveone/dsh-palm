// 渲染契约闸门：node tools/render-contract/check.mjs [--write]
//
// 度量的是 docs/RENDER-ARCHITECTURE.md §4 的五条契约，不是"代码风格"：
//   K1 单写者   → chatViewLines / chatViewEffects（视图不再自己拼状态）
//   K2 位置身份 → 由 architecture.test.ts 守，这里不重复
//   K3 几何契约 → 行级 data-geo，由行组件测试守，这里不重复
//   K4 锚点单写 → scrollTopWrites（只许降）
//   K5 样式分层 → cssLayers（只许升）/ pxLiterals（只许降）
//
// 判定口径：**先剥注释再计数**。注释里写「scrollTop = 0」不是写点，
// 上一版人工数出的「9 处」有 4 处正是注释（见 docs 修订记录）。
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO = join(import.meta.dirname, '..', '..')
const MOBILE = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile')
const STYLES = join(MOBILE, 'styles')
const FILE = join(import.meta.dirname, 'budget.json')
const WRITE = process.argv.includes('--write')

/** 剥掉 `//` 与 `/* *\/` 注释，保留字符串内容。逐字符扫，不做正则替换。 */
export function stripComments(source) {
  let out = ''
  let i = 0
  let quote = ''
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (quote !== '') {
      out += ch
      if (ch === '\\') { out += next ?? ''; i += 2; continue }
      if (ch === quote) quote = ''
      i += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; i += 1; continue }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        // 换行必须留下：行号要能和原文一一对应，否则报出来的位置是假的。
        if (source[i] === '\n') out += '\n'
        i += 1
      }
      i += 2
      continue
    }
    out += ch
    i += 1
  }
  return out
}

const isSource = name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') && name !== 'mobile-styles.ts'

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, acc)
    else if (isSource(name)) acc.push(abs)
  }
  return acc
}

/** @returns {Array<{file: string, line: number, text: string}>} */
function matches(pattern, files) {
  const hits = []
  for (const abs of files) {
    const raw = readFileSync(abs, 'utf8')
    const clean = stripComments(raw)
    // 行号要按**原文**算：剥注释时保留了换行，行号仍一一对应。
    const rawLines = raw.split('\n')
    const cleanLines = clean.split('\n')
    cleanLines.forEach((text, index) => {
      const re = new RegExp(pattern, 'g')
      if (re.test(text)) hits.push({ file: relative(MOBILE, abs).replaceAll('\\', '/'), line: index + 1, text: rawLines[index].trim() })
    })
  }
  return hits
}

const sources = walk(MOBILE)
const cssFiles = existsSync(STYLES) ? readdirSync(STYLES).filter(name => name.endsWith('.css')).map(name => join(STYLES, name)) : []
/** CSS 只剥 `/* *\/`：CSS 没有 `//` 注释，而 `url(http://…)` 里的 `//` 不能被当成注释。 */
const cssText = cssFiles
  .map(file => readFileSync(file, 'utf8'))
  .join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

const scrollTopHits = matches('\\bscrollTop\\s*=(?!=)', sources)
const allLayoutHits = matches('getBoundingClientRect\\(|\\.scrollHeight\\b|\\.clientHeight\\b|\\.offsetHeight\\b', sources)
/**
 * 允许读几何的模块（K4 的几何所有者），只许这两个：
 *   · `use-stick-to-bottom` —— 滚动位置与锚点（写 `scrollTop` 的唯一地方）；
 *   · `use-row-window`     —— 行高账本（量行高、算占位）。
 * 它们读得越多，说明别处读得越少 —— 所以这些读点**不计入**散读预算，单独报数。
 * 往里加第三个文件之前先问：它是这两个职责之一吗？不是就别进白名单。
 */
const GEOMETRY_OWNERS = new Set([
  'ui/hooks/use-stick-to-bottom.ts',
  'views/chat/hooks/use-row-window.ts',
])
const ownerLayoutHits = allLayoutHits.filter(hit => GEOMETRY_OWNERS.has(hit.file))
const layoutHits = allLayoutHits.filter(hit => !GEOMETRY_OWNERS.has(hit.file))
const chatView = join(MOBILE, 'views', 'ChatView.tsx')
const chatViewRaw = readFileSync(chatView, 'utf8')
const chatViewClean = stripComments(chatViewRaw)

export const metrics = {
  // 只许降
  scrollTopWrites: scrollTopHits.length,
  layoutReads: layoutHits.length,
  pxLiterals: (cssText.match(/\b\d+px\b/g) ?? []).length,
  chatViewLines: chatViewRaw.split('\n').length,
  chatViewEffects: (chatViewClean.match(/\buseEffect\(/g) ?? []).length,
  // 只许升
  cssLayers: (cssText.match(/@layer\b/g) ?? []).length,
  // 上下文（不进预算，只打印）
  cssFiles: cssFiles.length,
  cssBytes: cssText.length,
  ownerLayoutReads: ownerLayoutHits.length,
}

const rules = { scrollTopWrites: 'max', layoutReads: 'max', pxLiterals: 'max', chatViewLines: 'max', chatViewEffects: 'max', cssLayers: 'min' }
const budget = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}

const rows = []
let failed = 0
for (const [key, direction] of Object.entries(rules)) {
  const actual = metrics[key]
  const cap = budget[key]
  let status = '基线未建'
  if (cap !== undefined) {
    const ok = direction === 'max' ? actual <= cap : actual >= cap
    status = ok ? 'OK' : `越界（${direction === 'max' ? '上限' : '下限'} ${cap}）`
    if (!ok) failed += 1
  }
  rows.push({ 契约: key, 当前: actual, 预算: cap ?? '—', 方向: direction === 'max' ? '只降' : '只升', 状态: status })
}
if (WRITE) {
  const next = {}
  for (const key of Object.keys(rules)) next[key] = metrics[key]
  writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`)
}

const pad = (value, width) => String(value).padEnd(width)
console.log(`${pad('契约', 18)}${pad('当前', 8)}${pad('预算', 8)}${pad('方向', 6)}状态`)
for (const row of rows) console.log(`${pad(row.契约, 18)}${pad(row.当前, 8)}${pad(row.预算, 8)}${pad(row.方向, 6)}${row.状态}`)
console.log(`\n上下文：${metrics.cssFiles} 个 CSS / ${metrics.cssBytes} B；几何所有者读点 ${metrics.ownerLayoutReads} 次（不计入预算）`)

if (scrollTopHits.length > 0) {
  console.log('\nscrollTop 写点（K4，目标 1 处 = render/row-list.tsx）：')
  for (const hit of scrollTopHits) console.log(`  ${hit.file}:${hit.line}  ${hit.text.slice(0, 70)}`)
}
if (process.argv.includes('--verbose')) {
  const perFile = new Map()
  for (const hit of layoutHits) perFile.set(hit.file, (perFile.get(hit.file) ?? 0) + 1)
  console.log(`\n布局读点 Top（K4，共 ${layoutHits.length} 次 / ${perFile.size} 个文件）：`)
  for (const [file, count] of [...perFile].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${String(count).padStart(4)}  ${file}`)
}
if (WRITE) console.log(`\n已写入 ${relative(REPO, FILE)}`)
process.exit(failed === 0 ? 0 : 1)
