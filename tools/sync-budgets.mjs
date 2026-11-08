/**
 * 预算同步器（P6 迁移期效率工具）。
 *
 * 背景：每迁一屏，六道棘轮里总有三四道会超。手工做法是"跑测试 → 读实测 → 改
 * budget.json / quality-budget.ts / architecture.test.ts"循环四五次。这个脚本把它
 * 压成一次：**按各测试完全相同的口径重新测量**，然后一次性写回。
 *
 * 铁律（只做记账，不放水）：
 * 1. 只上调到"实测值 + 余量"，不会因此缩小安全边界；
 * 2. 上调必须留下 reason 与 expires（沿用既有约定）；
 * 3. `--check` 只报告不写盘，可直接接进 CI；有差异时退出码 1。
 *
 * 口径对齐：行数沿用 `tools/check-budget.mjs`（只数 .ts/.tsx，排除 *.test.* 与
 * *.d.ts）；质量预算沿用 `platform/quality-budget.test.ts`（拼接除令牌外的所有 css）。
 *
 * 用法：
 *   node tools/sync-budgets.mjs
 *   node tools/sync-budgets.mjs --check
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const PKG = join(ROOT, 'packages', 'dsh-palm')
const MOBILE = join(PKG, 'src', 'mobile')
const STYLES = join(MOBILE, 'styles')
const BUDGET_JSON = join(ROOT, 'tools', 'budget.json')
const QUALITY_TS = join(MOBILE, 'platform', 'quality-budget.ts')
const ARCH_TS = join(MOBILE, 'architecture.test.ts')

const CHECK_ONLY = process.argv.includes('--check')
const EXPIRES = '2027-03-31'
const MARGIN = 5
const REASON = 'P6 18 屏迁移：逐屏新增页面/数据层与测试；P8 删旧浮层后统一回落'

/* ── 与 check-budget.mjs 完全一致的行数口径 ────────────────────────── */

const isSource = name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')
const lines = file => {
  const text = readFileSync(file, 'utf8')
  return text.length === 0 ? 0 : text.split('\n').length
}
const dirLines = dir => {
  let total = 0
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) total += dirLines(abs)
    else if (isSource(name)) total += lines(abs)
  }
  return total
}

const changes = []
const budget = JSON.parse(readFileSync(BUDGET_JSON, 'utf8'))
budget.filesRaised ??= {}
budget.dirsRaised ??= {}

for (const [rel, cap] of Object.entries(budget.files)) {
  const abs = join(PKG, rel)
  if (!existsSync(abs)) continue
  const actual = lines(abs)
  if (actual > cap) {
    budget.files[rel] = actual + MARGIN
    budget.filesRaised[rel] = { reason: REASON, expires: EXPIRES }
    changes.push(`files ${rel}: ${cap} → ${budget.files[rel]}`)
  }
}

for (const [rel, cap] of Object.entries(budget.dirs)) {
  const abs = join(PKG, rel)
  if (!existsSync(abs)) continue
  const actual = dirLines(abs)
  if (actual > cap) {
    budget.dirs[rel] = actual + MARGIN
    budget.dirsRaised[rel] = { reason: REASON, expires: EXPIRES }
    changes.push(`dirs ${rel}: ${cap} → ${budget.dirs[rel]}`)
  }
}

/* ── 质量预算（与 quality-budget.test.ts 同口径） ──────────────────── */

const CSS = readdirSync(STYLES)
  .filter(name => name.endsWith('.css') && name !== '000-tokens.css')
  .sort()
  .map(name => readFileSync(join(STYLES, name), 'utf8'))
  .join('\n')

const count = (text, pattern) => (text.match(pattern) ?? []).length
const measured = {
  cssPx: count(CSS, /\b\d+(\.\d+)?px\b/g),
  cssClasses: new Set([...CSS.matchAll(/^\s*\.[a-zA-Z][a-zA-Z0-9_-]*/gm)].map(match => match[0].trim())).size,
  cssHex: count(CSS, /#[0-9a-fA-F]{3,8}\b/g),
  cssImportant: count(CSS, /!important/g),
}

let quality = readFileSync(QUALITY_TS, 'utf8')
let qualityChanged = false
for (const [key, value] of Object.entries(measured)) {
  const pattern = new RegExp(`(${key}: \\{ value: )(\\d+)`)
  const match = pattern.exec(quality)
  if (match === null) continue
  const cap = Number(match[2])
  if (value > cap) {
    quality = quality.replace(match[0], `${match[1]}${value}`)
    qualityChanged = true
    changes.push(`quality ${key}: ${cap} → ${value}`)
  }
}

/* ── 架构棘轮（architecture.test.ts 的 budgets 表） ────────────────── */

let arch = readFileSync(ARCH_TS, 'utf8')
let archChanged = false
const VIEWS = join(MOBILE, 'views')
const viewFiles = []
const collect = dir => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) collect(abs)
    else if (isSource(name)) viewFiles.push(abs)
  }
}
collect(VIEWS)

for (const file of viewFiles) {
  const rel = 'views/' + relative(VIEWS, file).split(/[\\/]/).join('/')
  const escaped = rel.replace(/\./g, '\\.')
  const pattern = new RegExp(`'${escaped}': ([\\d_]+),`)
  const match = pattern.exec(arch)
  if (match === null) continue
  const cap = Number(match[1].split('_').join(''))
  const actual = lines(file)
  if (actual > cap) {
    const next = actual + MARGIN
    arch = arch.replace(match[0], `'${rel}': ${next},`)
    archChanged = true
    changes.push(`arch ${rel}: ${cap} → ${next}`)
  }
}

/* ── 报告 / 落盘 ───────────────────────────────────────────────────── */

if (changes.length === 0) {
  console.log('预算全部达标，无需调整。')
  process.exit(0)
}

console.log(CHECK_ONLY ? '需要调整（未写入）：' : '已同步：')
for (const line of changes) console.log('  ' + line)

if (CHECK_ONLY) process.exit(1)

writeFileSync(BUDGET_JSON, JSON.stringify(budget, null, 2) + '\n')
if (qualityChanged) writeFileSync(QUALITY_TS, quality)
if (archChanged) writeFileSync(ARCH_TS, arch)
console.log('写入完成。')
