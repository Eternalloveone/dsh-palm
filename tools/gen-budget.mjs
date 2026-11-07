// 生成/更新行数预算：首次运行以当前实测值为上限（只降不升的起点）。
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const MOBILE = join(PKG, 'src', 'mobile')
const BUDGET = join(import.meta.dirname, 'budget.json')

const isSource = name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')

function lines(file) {
  const text = readFileSync(file, 'utf8')
  return text.length === 0 ? 0 : text.split('\n').length
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else if (isSource(name)) out.push(abs)
  }
  return out
}

// 单文件：只盯重点文件 + 顶层散文件
const TRACKED_FILES = [
  'src/mobile-api.ts',
  'src/mobile/views/ChatView.tsx',
  'src/mobile/App.tsx',
  'src/mobile/index.tsx',
  'src/mobile/api.ts',
]

const measured = new Map()
for (const rel of TRACKED_FILES) {
  const abs = join(PKG, rel)
  if (existsSync(abs)) measured.set(rel.replace(/\\/g, '/'), lines(abs))
}

// 目录总量：整个 mobile/ + 每个一级子目录
const dirTotals = new Map()
const allMobile = walk(MOBILE)
dirTotals.set('src/mobile', allMobile.reduce((n, f) => n + lines(f), 0))
for (const name of readdirSync(MOBILE)) {
  const abs = join(MOBILE, name)
  if (!statSync(abs).isDirectory()) continue
  const files = walk(abs)
  dirTotals.set(`src/mobile/${name}`, files.reduce((n, f) => n + lines(f), 0))
}

const prev = existsSync(BUDGET) ? JSON.parse(readFileSync(BUDGET, 'utf8')) : { files: {}, dirs: {} }
const lower = (prevValue, now) => (typeof prevValue === 'number' ? Math.min(prevValue, now) : now)

const next = {
  $comment: '只降不升：cap 只能由 tools/check-budget.mjs --write 下调；要上调必须写 raisedReason 且带 expires（ISO 日期）。',
  files: {},
  dirs: {},
}
for (const [path, now] of [...measured].sort()) next.files[path] = lower(prev.files?.[path], now)
for (const [path, now] of [...dirTotals].sort()) next.dirs[path] = lower(prev.dirs?.[path], now)

writeFileSync(BUDGET, `${JSON.stringify(next, null, 2)}\n`)
console.log('written', BUDGET)
console.log('files:', Object.keys(next.files).length, 'dirs:', Object.keys(next.dirs).length)
console.log('mobile total:', next.dirs['src/mobile'])
