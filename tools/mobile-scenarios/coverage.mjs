#!/usr/bin/env node
/**
 * 测试覆盖矩阵：**算**出哪些「旅程 × 不变式」格子还空着。
 *
 * 用法：
 *   node tools/mobile-scenarios/coverage.mjs           # 打印矩阵 + 缺口
 *   node tools/mobile-scenarios/coverage.mjs --strict  # 有空缺就退出码 1（给门禁用）
 *
 * 它做三件事：
 *   ① 校验 SCENARIO_CELLS 与真实场景文件一一对应（漏登记 / 写了不存在的场景都报错）；
 *   ② 打印 9×11 矩阵，标出每格被几个场景守着；
 *   ③ 列出空格子，按"优先补"排序（旅程顺序 + 不变式顺序）。
 */
import { readdir } from 'node:fs/promises'
import { JOURNEYS, INVARIANTS, REQUIRED, SCENARIO_CELLS, ACCEPTED_GAPS } from './model.mjs'

const strict = process.argv.includes('--strict')
const scenarioDir = new URL('./scenarios/', import.meta.url)

// ① 真实场景清单（读文件里的 id:）
const files = (await readdir(scenarioDir)).filter(name => name.endsWith('.mjs'))
const realIds = new Set()
for (const file of files) {
  const source = await import(new URL(file, scenarioDir))
  const id = source.scenario?.id
  if (typeof id === 'string') realIds.add(id)
}

const registered = new Set(Object.keys(SCENARIO_CELLS))
const missing = [...realIds].filter(id => !registered.has(id))
const phantom = [...registered].filter(id => !realIds.has(id))

console.log(`场景文件 ${realIds.size} 个｜登记 ${registered.size} 个｜旅程 ${Object.keys(JOURNEYS).length} 条｜不变式 ${Object.keys(INVARIANTS).length} 条\n`)

if (missing.length > 0) {
  console.log('✗ 新场景没登记到 model.mjs（补 SCENARIO_CELLS）：')
  for (const id of missing) console.log('   -', id)
}
if (phantom.length > 0) {
  console.log('✗ model.mjs 里登记了不存在的场景：')
  for (const id of phantom) console.log('   -', id)
}

// ② 矩阵
const journeys = Object.keys(JOURNEYS)
const invariants = Object.keys(INVARIANTS)
const cell = new Map() // `${journey}×${invariant}` → scenario ids
for (const [id, spec] of Object.entries(SCENARIO_CELLS)) {
  for (const journey of spec.journeys) {
    for (const invariant of spec.invariants) {
      const key = `${journey}×${invariant}`
      cell.set(key, [...(cell.get(key) ?? []), id])
    }
  }
}

console.log('覆盖矩阵（数字＝守着这一格的场景数，·＝空）')
const head = ['      ', ...invariants.map(name => name.padEnd(3))].join(' ')
console.log(head)
for (const journey of journeys) {
  const row = [journey.padEnd(6)]
  for (const invariant of invariants) {
    const count = cell.get(`${journey}×${invariant}`)?.length ?? 0
    row.push((count === 0 ? '·' : String(count)).padEnd(3))
  }
  console.log(row.join(' '))
}

// ③ 缺口：只算**必守格**（REQUIRED），全矩阵只用来展示信息量
const gaps = []
let requiredTotal = 0
let requiredCovered = 0
for (const journey of journeys) {
  for (const invariant of REQUIRED[journey] ?? []) {
    const key = `${journey}×${invariant}`
    const count = cell.get(key)?.length ?? 0
    requiredTotal += 1
    if (count > 0) { requiredCovered += 1; continue }
    if (ACCEPTED_GAPS[key] !== undefined) continue
    gaps.push({ key, journey, invariant })
  }
}
const accepted = Object.keys(ACCEPTED_GAPS).filter(key => (cell.get(key)?.length ?? 0) === 0)

const requiredMissed = gaps.length + accepted.length
console.log(`\n必守格覆盖 ${requiredCovered}/${requiredTotal}（${Math.round(requiredCovered / requiredTotal * 100)}%）｜缺口 ${requiredMissed} 格（其中已接受 ${accepted.length}）`)
console.log(`全矩阵信息量：${[...cell.keys()].length}/${journeys.length * invariants.length} 格有场景守着`)

if (gaps.length > 0) {
  console.log('\n空缺（按旅程顺序，建议从前往后补）：')
  for (const gap of gaps) {
    console.log(`  ${gap.key.padEnd(7)} ${JOURNEYS[gap.journey]} × ${INVARIANTS[gap.invariant]}`)
  }
}
if (accepted.length > 0) {
  console.log('\n已接受的缺口（model.mjs 的 ACCEPTED_GAPS，需人认账）：')
  for (const key of accepted) console.log(`  ${key.padEnd(7)} ${ACCEPTED_GAPS[key]}`)
}

const broken = missing.length > 0 || phantom.length > 0
if (broken) {
  console.log('\n结论：登记表与场景文件不一致 ✗')
  process.exit(1)
}
if (strict && gaps.length > 0) {
  console.log('\n结论：--strict 下有未覆盖的格子 ✗')
  process.exit(1)
}
console.log('\n结论：登记表一致 ✓')
