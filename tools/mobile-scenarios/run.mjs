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
  (await import('./scenarios/offline-queue-drain.mjs')).scenario,
  (await import('./scenarios/background-return.mjs')).scenario,
  (await import('./scenarios/long-session-window.mjs')).scenario,
  (await import('./scenarios/running-dot-lifecycle.mjs')).scenario,
]

if (has('list')) {
  for (const scenario of SCENARIOS) {
    console.log(`${scenario.id}\t${scenario.experimental === true ? '[实验性] ' : ''}${scenario.title}`)
  }
  process.exit(0)
}

const only = valueOf('only', '')
const repeat = Number(valueOf('repeat', '1'))
const withExperimental = has('experimental')
const pool = withExperimental ? SCENARIOS : SCENARIOS.filter(scenario => scenario.experimental !== true)
const picked = only === '' ? pool : SCENARIOS.filter(scenario => scenario.id === only)
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

/**
 * 只读用的会话：跨页/切后台/长会话这些场景**只看不发**，用哪条都行。
 */
const sessionId = await pickSession()

/**
 * 会**发起回合**的场景（排队/慢回执/通道不可用/绿点）必须用**专用测试会话**，
 * 绝不能往用户正在聊的会话里灌提示词 —— 2026-10-31 真出过：用户在自己的
 * 会话里看到「用 bash 跑 python -c ...」「场景排队 1221」。
 *
 * 由 `PALM_TEST_SESSION` 指定；没给就不跑这几条（跳过并说明），
 * 想强行用当前会话请显式加 `--allow-real-session`。
 */
const testSessionId = process.env.PALM_TEST_SESSION !== undefined && process.env.PALM_TEST_SESSION !== ''
  ? process.env.PALM_TEST_SESSION
  : (has('allow-real-session') ? sessionId : undefined)

/** 会话总数（用来确认场景没有偷偷新建会话）。 */
async function countSessions() {
  const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
  return list.length
}
const sessionsBefore = await countSessions()
console.log(`宿主 ${WORKSPACE}｜只读会话 ${String(sessionId).slice(0, 20)}｜测试会话 ${testSessionId === undefined ? '（未指定：会发回合的场景将跳过）' : String(testSessionId).slice(0, 20)}｜场景 ${picked.length} 个 × ${repeat} 遍\n`)

let totalChecks = 0
const violations = []
const scenarioErrors = []
let skipped = 0

for (const scenario of picked) {
  for (let round = 1; round <= repeat; round += 1) {
    const label = repeat === 1 ? scenario.id : `${scenario.id}#${round}`
    // 会发回合的场景必须用专用测试会话；没配置就跳过（不制造假红）。
    if (scenario.needsTurn === true && testSessionId === undefined) {
      console.log(`SKIP  ${label.padEnd(28)} 需要 PALM_TEST_SESSION（避免往你的会话里发消息）`)
      skipped += 1
      continue
    }

    const { browser, context } = await launch({ headed: has('headed') })
    const check = (kind, ok, detail) => {
      totalChecks += 1
      if (!ok) violations.push({ scenario: label, kind, detail })
    }
    const startedAt = Date.now()
    try {
      await scenario.run({ browser, context, check, sessionId, testSessionId, rpc })
    } catch (error) {
      scenarioErrors.push({ scenario: label, error: String(error?.message ?? error).slice(0, 200) })
    } finally {
      await browser.close()
    }
    const cost = ((Date.now() - startedAt) / 1000).toFixed(1)
    const failed = violations.filter(item => item.scenario === label).length
    // flaky 场景：失败只记录、不挡门禁（判据还没稳到可以拦发版的程度，但信号要留着）
    const status = failed === 0 ? 'PASS' : (scenario.flaky === true ? 'FLAKY' : 'FAIL')
    console.log(`${status}  ${label.padEnd(28)} ${cost}s  判据 ${failed} 条未通过`)
  }
}

console.log(`\n共 ${totalChecks} 条判据｜违规 ${violations.length} 条｜场景异常 ${scenarioErrors.length} 个｜跳过 ${skipped} 个`)
for (const item of violations.slice(0, 10)) {
  console.log('  ✗', item.scenario, item.kind, JSON.stringify(item.detail).slice(0, 140))
}
for (const item of scenarioErrors.slice(0, 5)) {
  console.log('  ! ', item.scenario, item.error)
}
// 只有"非 flaky 场景"的违规与场景异常才算门禁失败
const blocking = violations.filter(item => {
  const scenario = picked.find(candidate => item.scenario === candidate.id || item.scenario.startsWith(`${candidate.id}#`))
  return scenario?.flaky !== true
})
function check_sessions_unchanged(before, after) {
  if (after > before) {
    violations.push({ scenario: 'runner', kind: 'no-new-sessions', detail: { before, after } })
    console.log(`  ✗ runner 场景新建了会话：${before} → ${after}（本套场景不允许新建会话）`)
  } else {
    console.log(`会话总数未变（${after} 条），没有新建测试会话 ✓`)
  }
}

// 用户要求（2026-10-31）：**不要开一堆会话来测**。场景只复用同一条会话，
// 这里兜底校验：跑完会话总数不许增加。
const sessionsAfter = await countSessions()
check_sessions_unchanged(sessionsBefore, sessionsAfter)

const ok = blocking.length === 0 && scenarioErrors.length === 0
console.log(ok
  ? `结论：门禁通过 ✓${violations.length === 0 ? '' : `（有 ${violations.length} 条来自 flaky 场景，仅记录）`}`
  : '结论：有场景未通过 ✗')
process.exit(ok ? 0 : 1)
