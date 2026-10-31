/**
 * 场景压测 runner。
 *
 * 用法：
 *   node tools/mobile-scenarios/run.mjs                       # 全部场景跑 1 遍
 *   node tools/mobile-scenarios/run.mjs --only=cross-page-round-trip
 *   node tools/mobile-scenarios/run.mjs --repeat=3            # 抓偶发
 *   node tools/mobile-scenarios/run.mjs --headed              # 看着跑
 *   node tools/mobile-scenarios/run.mjs --list                # 看有哪些场景
 *
 * 退出码：0 = 全部判据通过；1 = 有违规或场景报错。
 */
import { launch, rpc, WORKSPACE } from './lib/env.mjs'

const args = process.argv.slice(2)
const has = name => args.includes(`--${name}`)
const valueOf = (name, fallback) => {
  const hit = args.find(arg => arg.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}

const SCENARIOS = [
  (await import('./scenarios/cross-page-round-trip.mjs')).scenario,
  (await import('./scenarios/queue-while-running.mjs')).scenario,
  (await import('./scenarios/send-slow-response.mjs')).scenario,
]

if (has('list')) {
  for (const scenario of SCENARIOS) console.log(`${scenario.id}\t${scenario.title}`)
  process.exit(0)
}

const only = valueOf('only', '')
const repeat = Number(valueOf('repeat', '1'))
const picked = only === '' ? SCENARIOS : SCENARIOS.filter(scenario => scenario.id === only)
if (picked.length === 0) {
  console.error(`没有这个场景: ${only}`)
  process.exit(1)
}

/** 默认挑一条已有内容的会话（跨页场景需要真实聊天页）。 */
async function pickSession() {
  const explicit = process.env.PALM_SESSION
  if (explicit !== undefined && explicit !== '') return explicit
  const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
  const row = list.find(item => (item.sessionId ?? item.id) !== undefined)
  return row?.sessionId ?? row?.id
}

const sessionId = await pickSession()
console.log(`宿主 ${WORKSPACE}｜会话 ${String(sessionId).slice(0, 20)}｜场景 ${picked.length} 个 × ${repeat} 遍\n`)

let totalChecks = 0
const violations = []
const scenarioErrors = []

for (const scenario of picked) {
  for (let round = 1; round <= repeat; round += 1) {
    const label = repeat === 1 ? scenario.id : `${scenario.id}#${round}`
    const { browser, context } = await launch({ headed: has('headed') })
    const check = (kind, ok, detail) => {
      totalChecks += 1
      if (!ok) violations.push({ scenario: label, kind, detail })
    }
    const startedAt = Date.now()
    try {
      await scenario.run({ browser, context, check, sessionId, rpc })
    } catch (error) {
      scenarioErrors.push({ scenario: label, error: String(error?.message ?? error).slice(0, 200) })
    } finally {
      await browser.close()
    }
    const cost = ((Date.now() - startedAt) / 1000).toFixed(1)
    const failed = violations.filter(item => item.scenario === label).length
    console.log(`${failed === 0 ? 'PASS' : 'FAIL'}  ${label.padEnd(28)} ${cost}s  判据 ${failed} 条未通过`)
  }
}

console.log(`\n共 ${totalChecks} 条判据｜违规 ${violations.length} 条｜场景异常 ${scenarioErrors.length} 个`)
for (const item of violations.slice(0, 10)) {
  console.log('  ✗', item.scenario, item.kind, JSON.stringify(item.detail).slice(0, 140))
}
for (const item of scenarioErrors.slice(0, 5)) {
  console.log('  ! ', item.scenario, item.error)
}
const ok = violations.length === 0 && scenarioErrors.length === 0
console.log(ok ? '结论：全部场景通过 ✓' : '结论：有场景未通过 ✗')
process.exit(ok ? 0 : 1)
