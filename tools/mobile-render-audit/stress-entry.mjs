/**
 * 进会话「同轮多卡 / 重复 key」高压验证（真宿主 + 真浏览器）。
 *
 * 这类问题的现场只有一瞬间（入场那几百毫秒，或流式追加期间），粗采样抓不到。
 * 这里 50ms 一帧连续采样，判据每一次都成立：
 *   ① 同一个 turn 不允许同时挂 2 张过程卡；
 *   ② 不允许出现重复的 data-message-id（React key 唯一性）。
 *
 * 两种现场都要跑：
 *   · 静置会话：缓存快照 + 尾页 两个生产者重叠；
 *   · 在跑会话：缓存 + 尾页 + 实时帧 三个生产者同时有数据（当初 turn 147 两张卡就是这种）。
 *
 * 用法：
 *   node tools/mobile-render-audit/stress-entry.mjs            # 两种现场都跑
 *   node tools/mobile-render-audit/stress-entry.mjs --idle     # 只跑静置会话
 *   node tools/mobile-render-audit/stress-entry.mjs --running  # 只跑在跑会话（自己起一个长回合）
 */
import pw from 'file:///C:/Users/Administrator/.dsh/skills/feishu-report/node_modules/playwright/index.js'

const BASE = process.env.PALM_BASE ?? 'http://127.0.0.1:3080'
const PAIR = process.env.PALM_PAIR ?? 'edb0f18289ef966fa2c1bad84cfed355'
const WS = process.env.PALM_WORKSPACE ?? '469ac44d-a832-4cae-8511-75796e59852d'
const RUNNING_SESSION = process.env.PALM_SESSION ?? 'session-3dac00f8-00b1-472f-9820-c1ac96c60c9c'
const FRAMES = Number(process.env.PALM_STRESS_FRAMES ?? 40)
const SESSIONS = Number(process.env.PALM_STRESS_SESSIONS ?? 6)

const onlyIdle = process.argv.includes('--idle')
const onlyRunning = process.argv.includes('--running')

async function rpc(method, payload = {}) {
  const res = await fetch(`${BASE}/m/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `dsh_pair=${PAIR}` },
    body: JSON.stringify({ type: 'client-request', rpcId: 'st' + Math.random().toString(36).slice(2), method, payload }),
  })
  return (await res.json())?.result
}

/** 一帧：同轮多卡 / 重复 key。 */
const sampleOnce = page => page.evaluate(() => {
  const cards = [...document.querySelectorAll('.chat-proc')]
  const byTurn = new Map()
  let noTurnCards = 0
  for (const card of cards) {
    const row = card.closest('[data-message-id]')
    const id = row?.getAttribute('data-message-id') ?? ''
    const model = (window.__palmRows ?? []).find(entry => entry.id === id)
    const turn = model?.turn
    if (turn === undefined) { noTurnCards += 1; continue }
    byTurn.set(turn, (byTurn.get(turn) ?? 0) + 1)
  }
  const ids = [...document.querySelectorAll('[data-message-id]')].map(el => el.getAttribute('data-message-id'))
  return {
    cards: cards.length,
    noTurnCards,
    sameTurnDuplicates: [...byTurn.entries()].filter(([, n]) => n > 1).map(([turn, n]) => `turn${turn}x${n}`),
    dupIds: ids.length - new Set(ids).size,
  }
})

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])

let total = 0
let violations = 0
const offenders = []

async function enterAndWatch(sessionId, rounds, label) {
  for (let round = 1; round <= rounds; round += 1) {
    const page = await ctx.newPage()
    await page.goto(`${BASE}/m/?debug=1&workspace=${WS}&session=${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' })
    for (let i = 0; i < FRAMES; i += 1) {
      await page.waitForTimeout(50)
      const snap = await sampleOnce(page)
      total += 1
      if (snap.sameTurnDuplicates.length > 0 || snap.dupIds > 0) {
        violations += 1
        if (offenders.length < 6) {
          offenders.push({ label, session: String(sessionId).slice(0, 14), round, at: `${(i + 1) * 50}ms`, ...snap })
        }
      }
    }
    await page.close()
  }
}

if (!onlyRunning) {
  const page = (await rpc('session.list', { workspaceId: WS }))?.value
  const ids = (page?.items ?? []).slice(0, SESSIONS).map(row => row.sessionId ?? row.id)
  for (const id of ids) await enterAndWatch(id, 2, '静置')
}

if (!onlyIdle) {
  // 自己起一个长回合：让实时帧在整段观测期内持续存在。
  await rpc('session.prompt', {
    sessionId: RUNNING_SESSION,
    mode: 'queue',
    content: [{ type: 'text', text: '请连续执行三条 bash 命令：python -c "import time; time.sleep(12)"，每次执行完说一下第几步，一共三轮。' }],
  })
  await new Promise(resolve => setTimeout(resolve, 4000))
  await enterAndWatch(RUNNING_SESSION, 3, '在跑')
}

await browser.close()

console.log(`采样 ${total} 次（${FRAMES} 帧 @50ms）`)
if (violations === 0) {
  console.log('违规 0 次：整个入场过程没有同轮多卡、没有重复 key ✓')
} else {
  console.log(`违规 ${violations} 次：`)
  for (const bad of offenders) console.log('  ', JSON.stringify(bad))
}
process.exit(violations === 0 ? 0 : 1)
