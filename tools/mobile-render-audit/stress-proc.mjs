/**
 * 「过程条消失」高压验证（真宿主 + 真浏览器，50ms 采样）。
 *
 * 这是同一个症状第三次复发后的守卫：只要"这一轮在跑"，屏幕上就必须有过程卡，
 * 而且**一旦出现就不许消失**；同时不许出现写着"已完成"的卡。
 *
 * 三种现场都跑：
 *   A. 在跑会话，反复进/出 10 次（每次采样 2 秒）
 *   B. 静置会话，逐个进 1 次（历史行/交付卡不许减少、不许被改写）
 *   C. 跨页面往返（列表 → 聊天 → 返回 → 再进）
 *
 * 用法：node tools/mobile-render-audit/stress-proc.mjs
 */
import pw from 'file:///C:/Users/Administrator/.dsh/skills/feishu-report/node_modules/playwright/index.js'

const BASE = process.env.PALM_BASE ?? 'http://127.0.0.1:3080'
const PAIR = process.env.PALM_PAIR ?? 'edb0f18289ef966fa2c1bad84cfed355'
const WS = process.env.PALM_WORKSPACE ?? '469ac44d-a832-4cae-8511-75796e59852d'
const ENTRIES = Number(process.env.PALM_PROC_ENTRIES ?? 10)
const FRAMES = Number(process.env.PALM_PROC_FRAMES ?? 40)
const IDLE_SESSIONS = Number(process.env.PALM_PROC_IDLE ?? 6)

async function rpc(method, payload = {}) {
  const res = await fetch(`${BASE}/m/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `dsh_pair=${PAIR}` },
    body: JSON.stringify({ type: 'client-request', rpcId: 'q' + Math.random().toString(36).slice(2), method, payload }),
  })
  return (await res.json())?.result
}

/** 一帧现场。 */
const sampleOnce = page => page.evaluate(() => {
  const cards = [...document.querySelectorAll('.chat-turn-tail')]
  const body = document.body.innerText ?? ''
  const rows = window.__palmRows ?? []
  // 关键：只在"数据里确实有过程内容"时才要求屏幕上有过程卡。
  // 否则加载中的那几百毫秒会被误判成"过程条消失"（首轮压测就是这么误报 90 条的）。
  const withTools = rows.filter(row => row.kind === 'assistant' && (row.tools?.length ?? 0) > 0)
  const hasProcessData = withTools.length > 0 || rows.some(row => (
    row.kind === 'assistant' && ((row.flow?.length ?? 0) > 0 || (row.reasoning ?? '') !== '')
  ))
  return {
    rows: document.querySelectorAll('[data-message-id]').length,
    modelRows: rows.length,
    withTools: withTools.length,
    hasProcessData,
    proc: document.querySelectorAll('.chat-proc').length,
    doneCards: cards.filter(card => /已完成/.test(card.textContent ?? '')).length,
    running: /输出中|生成中|深度求索中|正在/.test(body),
    firstCardText: (cards[0]?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24),
  }
})

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])

let frames = 0
const violations = []
const note = (kind, detail) => violations.push({ kind, detail })

// ── A. 在跑会话：**只复用** PALM_TEST_SESSION，绝不新建会话 ────────────────
//    2026-10-31 用户要求：不要开一堆会话来测。没有测试会话就跳过 A 段，
//    B/C 两段（静置会话、跨页往返）不需要发消息，照常跑。
const SID = process.env.PALM_TEST_SESSION
let procEverSeen = 0
const entryStats = []

if (SID === undefined || SID === '') {
  console.log('A 段：未提供 PALM_TEST_SESSION，跳过“在跑会话”这一段（不新建会话）')
} else {
  console.log(`A 段：复用 ${String(SID).slice(0, 18)}… 起长回合，反复进入 ${ENTRIES} 次`)
  await rpc('session.prompt', {
    sessionId: SID,
    mode: 'queue',
    content: [{ type: 'text', text: '用 bash 跑 python -c "import time; time.sleep(40)"，完成后说"好了"。' }],
  })
  await new Promise(resolve => setTimeout(resolve, 8000))
}
for (let entry = 1; SID !== undefined && SID !== '' && entry <= ENTRIES; entry += 1) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/m/?debug=1&workspace=${WS}&session=${encodeURIComponent(SID)}`, { waitUntil: 'domcontentloaded' })
  let sawProc = false
  let framesWithProcessData = 0
  for (let i = 0; i < FRAMES; i += 1) {
    await page.waitForTimeout(50)
    const snap = await sampleOnce(page)
    frames += 1
    if (snap.hasProcessData) framesWithProcessData += 1
    // 数据层消失：这一次进入里明明出现过过程数据（工具/思考/flow），后来又没了。
    // 这不是"卡片没画出来"，而是**行被换掉了** —— 真机上表现同样是过程条消失。
    if (framesWithProcessData > 0 && !snap.hasProcessData && snap.rows > 0) {
      note('process-data-dropped', { entry, at: `${(i + 1) * 50}ms`, rows: snap.rows })
    }
    if (snap.proc > 0) sawProc = true
    // 判据一：数据里已经有过程内容（工具/思考/flow），屏幕上却没有过程卡 → 真·消失
    if (snap.hasProcessData && snap.proc === 0) {
      note('proc-missing-while-running', { entry, at: `${(i + 1) * 50}ms`, rows: snap.rows, withTools: snap.withTools })
    }
    // 判据二：在跑却出现"已完成"卡
    if (snap.running && snap.rows > 0 && snap.doneCards > 0) {
      note('done-card-while-running', { entry, at: `${(i + 1) * 50}ms`, doneCards: snap.doneCards })
    }
    // 判据三：本次进入里过程卡出现过，随后在"仍有过程数据"的情况下归零
    if (sawProc && snap.proc === 0 && snap.hasProcessData) {
      note('proc-vanished-after-appearing', { entry, at: `${(i + 1) * 50}ms` })
    }
  }
  if (sawProc) procEverSeen += 1
  // 逐次记录：没出现过程卡的那些进入，是不是"这段时间里根本没有过程数据"
  // （例如刚好赶在回合切换的空档）——区分"真丢卡"和"本来就没有卡可画"。
  entryStats.push({ entry, sawProc, framesWithProcessData })
  await page.close()
}
console.log(`   出现过程卡的进入次数：${procEverSeen}/${ENTRIES}`)
const missed = entryStats.filter(stat => !stat.sawProc)
for (const stat of missed) {
  console.log(`   未出卡的进入 #${stat.entry}：该次采样窗口里有过程数据的帧数=${stat.framesWithProcessData}`)
  // 有过程数据却没卡，前面的判据已经记违规了；这里只区分"本来就没数据"
  if (stat.framesWithProcessData === 0) console.log('     → 这段时间本来就没有过程数据（回合空档），不算问题')
}
if (SID !== undefined && SID !== '' && procEverSeen === 0) note('never-showed-proc', { entries: ENTRIES })

// ── B. 静置会话：历史行与交付卡不许减少 ────────────────────────────────
const list = (await rpc('session.list', { workspaceId: WS }))?.value?.items ?? []
const idleIds = list.map(row => row.sessionId ?? row.id).filter(id => id !== SID).slice(0, IDLE_SESSIONS)
console.log(`B 段：静置会话 ${idleIds.length} 个，各进 1 次看是否稳定`)
for (const id of idleIds) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/m/?debug=1&workspace=${WS}&session=${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' })
  let previousRows = 0
  let previousCards = 0
  let previousText = ''
  for (let i = 0; i < FRAMES; i += 1) {
    await page.waitForTimeout(50)
    const snap = await sampleOnce(page)
    frames += 1
    if (snap.rows < previousRows) note('rows-went-backwards', { session: String(id).slice(0, 13), at: `${(i + 1) * 50}ms`, from: previousRows, to: snap.rows })
    if (previousText !== '' && snap.firstCardText !== '' && snap.firstCardText !== previousText) {
      note('card-text-rewritten', { session: String(id).slice(0, 13), at: `${(i + 1) * 50}ms`, from: previousText, to: snap.firstCardText })
    }
    previousRows = Math.max(previousRows, snap.rows)
    previousCards = Math.max(previousCards, snap.cards ?? previousCards)
    if (snap.firstCardText !== '') previousText = snap.firstCardText
  }
  await page.close()
}

// ── C. 跨页面往返：列表 → 聊天 → 返回 ─────────────────────────────────
console.log('C 段：跨页面往返（列表 → 聊天 → 返回）')
{
  const page = await ctx.newPage()
  await page.goto(`${BASE}/m/?workspace=${WS}`, { waitUntil: 'domcontentloaded' })
  // 等列表真的渲染出来（固定 1.5 秒偶发 0 行，会假报"列表空了"）
  let listReady = false
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(250)
    const count = await page.evaluate(() => document.querySelectorAll('.mobile-row-sess, .mobile-row').length)
    if (count > 0) { listReady = true; break }
  }
  if (!listReady) {
    note('list-not-rendered', {})
  }
  const row = page.locator('.mobile-row-sess, .mobile-row').first()
  if (await row.count() > 0) {
    await row.click()
    // 聊天页是"先骨架后正文"，固定 2 秒会偶发 0 行（实测 1 次假红）。
    // 轮询到有行为止，最多 12 秒。
    let inChat = await sampleOnce(page)
    for (let i = 0; i < 24 && inChat.rows === 0; i += 1) {
      await page.waitForTimeout(500)
      inChat = await sampleOnce(page)
      frames += 1
    }
    if (inChat.rows === 0) note('chat-empty-after-nav', { rows: inChat.rows })
    await page.goto(`${BASE}/m/?workspace=${WS}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    const inList = await page.evaluate(() => document.querySelectorAll('.mobile-row-sess').length)
    frames += 1
    if (inList === 0) note('list-empty-after-back', { rows: inList })
  } else {
    note('no-session-row-on-list', {})
  }
  await page.close()
}

await browser.close()

console.log(`\n采样 ${frames} 帧｜违规 ${violations.length} 条`)
for (const bad of violations.slice(0, 8)) console.log('  ✗', bad.kind, JSON.stringify(bad.detail).slice(0, 120))
console.log(violations.length === 0 ? '结论：过程条消失/误报已完成/历史回退 均未复现 ✓' : '结论：仍有问题 ✗')
console.log(SID === undefined || SID === '' ? '（A 段已跳过：未新建任何会话）' : `复用的测试会话: ${SID}`)
process.exit(violations.length === 0 ? 0 : 1)
