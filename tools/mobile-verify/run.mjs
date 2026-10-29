/**
 * 手机端全量验收运行器。
 *
 * 用法：
 *   node tools/mobile-verify/run.mjs                    # 跑全部
 *   node tools/mobile-verify/run.mjs --groups=entry,scroll
 *   node tools/mobile-verify/run.mjs --only=entry.lands-at-bottom
 *   node tools/mobile-verify/run.mjs --headed           # 开窗口看
 *
 * 产物：
 *   tools/mobile-verify/reports/<时间戳>.json   完整结果（含每条 detail）
 *   tools/mobile-verify/reports/latest.md      给人看的一页报告
 *   tools/mobile-verify/reports/shots/*.png    失败用例截图
 *
 * 退出码：全部通过 0；有失败/错误 1（可直接接入 CI 或发布脚本）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CASES } from './cases/index.mjs'
import {
  DEFAULT_BASE,
  DEFAULT_PAIR,
  parseGroups,
  parseHeaded,
  parseKeepShots,
  parseOnly,
} from './lib/config.mjs'
import { createHarness, Failed, Skipped } from './lib/harness.mjs'
import { createRpc, discoverFixtures, readTail } from './lib/rpc.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const reportsDir = join(here, 'reports')
const shotDir = join(reportsDir, 'shots')
mkdirSync(reportsDir, { recursive: true })

const argv = process.argv.slice(2)
const groups = parseGroups(argv)
const only = parseOnly(argv)
const headed = parseHeaded(argv)
const keepShots = parseKeepShots(argv)

const base = DEFAULT_BASE
const pair = DEFAULT_PAIR

/** 兜底 fixture：宿主发现不到时用它（保证脚本在任何机器上都能跑完）。 */
const fallback = {
  workspaceId: process.env.PALM_WORKSPACE ?? '469ac44d-a832-4cae-8511-75796e59852d',
  sessionId: process.env.PALM_SESSION ?? 'session-a2369541-987e-4b4e-bf58-dee2e42e3e88',
}

const rpc = createRpc({ base, pair })
let fixtures
try {
  fixtures = await discoverFixtures({ rpc, fallback })
} catch (error) {
  console.log(`！fixture 发现失败，用兜底值：${String(error).slice(0, 120)}`)
  fixtures = { ...fallback, running: [], sessions: [] }
}

const selected = CASES.filter(item => {
  if (groups !== undefined && !groups.has(item.group)) return false
  if (only !== undefined && !only.has(item.id)) return false
  return true
})

if (selected.length === 0) {
  console.log('没有匹配的用例（检查 --groups / --only）')
  process.exit(1)
}

console.log(`手机端验收：${selected.length} 条用例，分组 ${[...new Set(selected.map(i => i.group))].join('/')}`)
console.log(`宿主 ${base} · 工作区 ${fixtures.workspaceId} · 会话 ${String(fixtures.sessionId).slice(0, 22)}… · 在跑 ${fixtures.running.length}\n`)

const harness = await createHarness({ base, pair, fixtures, headed, shotDir })
const results = []
const startedAt = Date.now()

for (const item of selected) {
  harness.setCase(item.id)
  const startedCase = Date.now()
  const surfaces = item.surface === undefined ? ['chat'] : [item.surface]
  let outcome
  for (const surface of surfaces) {
    const { page, errors, badResponses } = await harness.openPage(surface)
    try {
      const detail = await item.run({ ...harness, rpc, tail: id => readTail(rpc, id) }, { page, rpc })
      // 通用检查：任何页面级异常都算失败（error 级 console 只报 404 资源时忽略）。
      const realErrors = errors.filter(text => !/Failed to load resource/.test(text))
      if (realErrors.length > 0) throw new Failed(`控制台错误：${realErrors[0]}`)
      outcome = { status: 'pass', detail: detail ?? '' }
    } catch (error) {
      if (error instanceof Skipped) {
        outcome = { status: 'skip', detail: error.message }
      } else {
        const file = keepShots ? await harness.shot(page) : undefined
        outcome = {
          status: 'fail',
          detail: error instanceof Failed ? error.message : `异常：${String(error).slice(0, 200)}`,
          shot: file,
          errors: errors.slice(0, 3),
          badResponses: badResponses.slice(0, 3),
        }
      }
    } finally {
      await page.close().catch(() => {})
    }
    if (outcome.status !== 'pass') break
  }
  const durationMs = Date.now() - startedCase
  results.push({ ...item, surface: item.surface, ...outcome, durationMs })
  const icon = outcome.status === 'pass' ? 'PASS' : outcome.status === 'skip' ? 'SKIP' : 'FAIL'
  console.log(`${icon.padEnd(4)} ${item.id.padEnd(34)} ${outcome.detail ?? ''}`)
}

await harness.close()

const passed = results.filter(item => item.status === 'pass').length
const skipped = results.filter(item => item.status === 'skip').length
const failed = results.filter(item => item.status === 'fail')
const total = results.length
const durationMs = Date.now() - startedAt

// ── 报告 ────────────────────────────────────────────────────
/** 本地时间戳：`2026-10-29T13-24-05`（UTC 会差 8 小时，容易误读成旧报告）。 */
const localStamp = () => {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}
const stamp = localStamp()
const jsonPath = join(reportsDir, `${stamp}.json`)
writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      at: stamp,
      base,
      fixtures: {
        workspaceId: fixtures.workspaceId,
        sessionId: fixtures.sessionId,
        running: fixtures.running,
      },
      summary: { total, passed, skipped, failed: failed.length, durationMs },
      results: results.map(item => ({
        id: item.id,
        group: item.group,
        title: item.title,
        status: item.status,
        detail: item.detail,
        durationMs: item.durationMs,
        ...(item.shot === undefined ? {} : { shot: item.shot }),
      })),
    },
    null,
    2,
  ),
  'utf8',
)

const byGroup = new Map()
for (const item of results) {
  const bucket = byGroup.get(item.group) ?? { pass: 0, fail: 0, skip: 0 }
  bucket[item.status === 'pass' ? 'pass' : item.status === 'skip' ? 'skip' : 'fail'] += 1
  byGroup.set(item.group, bucket)
}

const lines = []
lines.push(`# 手机端验收报告（${stamp.replace('T', ' ').replace(/-/g, (m, offset) => (offset > 9 ? ':' : '-'))}）`)
lines.push('')
lines.push(`**结论：${failed.length === 0 ? '全部通过' : `${failed.length} 条失败`}** · ${passed} 通过 / ${skipped} 跳过 / ${total} 条 · 用时 ${(durationMs / 1000).toFixed(1)}s`)
lines.push('')
lines.push(`宿主 ${base} · 工作区 \`${fixtures.workspaceId}\` · 会话 \`${fixtures.sessionId}\` · 在跑 ${fixtures.running.length} 个`)
lines.push('')
lines.push('| 分组 | 通过 | 跳过 | 失败 |')
lines.push('|---|---|---|---|')
for (const [group, bucket] of byGroup) {
  lines.push(`| ${group} | ${bucket.pass} | ${bucket.skip} | ${bucket.fail} |`)
}
if (failed.length > 0) {
  lines.push('')
  lines.push('## 失败明细')
  lines.push('')
  lines.push('| 用例 | 现象 | 截图 |')
  lines.push('|---|---|---|')
  for (const item of failed) {
    lines.push(`| \`${item.id}\` ${item.title} | ${item.detail} | ${item.shot === undefined ? '—' : item.shot.replace(/\\/g, '/')} |`)
  }
}
const skippedItems = results.filter(item => item.status === 'skip')
if (skippedItems.length > 0) {
  lines.push('')
  lines.push('## 跳过')
  lines.push('')
  for (const item of skippedItems) lines.push(`- \`${item.id}\` ${item.title}：${item.detail}`)
}
lines.push('')
lines.push(`原始结果：\`${jsonPath.replace(/\\/g, '/')}\``)
writeFileSync(join(reportsDir, 'latest.md'), lines.join('\n'), 'utf8')

console.log(`\n${'─'.repeat(60)}`)
console.log(`${failed.length === 0 ? '全部通过' : `${failed.length} 条失败`}：${passed} 通过 / ${skipped} 跳过 / ${total} 条，用时 ${(durationMs / 1000).toFixed(1)}s`)
console.log(`报告：${join(reportsDir, 'latest.md')}`)
if (failed.length > 0) {
  console.log('\n失败用例：')
  for (const item of failed) console.log(` · ${item.id} — ${item.detail}`)
}
process.exit(failed.length === 0 ? 0 : 1)
