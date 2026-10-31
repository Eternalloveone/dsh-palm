/**
 * 手机端**性能基线**（首屏 / 滚动帧率 / 输入延迟）。
 *
 * 为什么要有它：现在所有判据都是"有没有、对不对"，没有一个管"顺不顺"。
 * 长会话里滚动卡、输入顿一下，测试全绿但用户能立刻感觉到。
 *
 * 用法：
 *   node tools/mobile-perf/run.mjs                 # 打印指标 + 与预算比较
 *   node tools/mobile-perf/run.mjs --json          # 只输出 JSON（给门禁/看板用）
 *   node tools/mobile-perf/run.mjs --update-budget # 把这次的实测写成新预算
 *
 * 指标（都在聊天页，用最长的会话）：
 *   firstContentMs  首次出现消息行的时间
 *   scrollFps       连续滚动 1.5 秒的平均帧率（rAF 间隔推算）
 *   inputLatencyMs  往输入框敲一个字到值出现的时间（中位数，取 5 次）
 *
 * 预算是**上限**，超了算不合格；预算写在 tools/mobile-perf/budget.json。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { BASE, WORKSPACE, chatUrl, pw, rpc } from '../mobile-scenarios/lib/env.mjs'

const BUDGET_FILE = new URL('./budget.json', import.meta.url)
const jsonOnly = process.argv.includes('--json')
const updateBudget = process.argv.includes('--update-budget')
const headed = process.argv.includes('--headed')

const DEFAULT_BUDGET = { firstContentMs: 6000, scrollFps: 40, inputLatencyMs: 120 }

async function loadBudget() {
  try {
    return { ...DEFAULT_BUDGET, ...JSON.parse(await readFile(BUDGET_FILE, 'utf8')) }
  } catch {
    return { ...DEFAULT_BUDGET }
  }
}

/** 挑一条历史最长的会话（长会话才压得出问题）。 */
async function pickLongSession() {
  const explicit = process.env.PALM_SESSION
  if (explicit !== undefined && explicit !== '') return explicit
  const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
  const ranked = list
    .map(item => ({
      id: item.sessionId ?? item.id,
      turns: item.projections?.values?.sessionStats?.turns ?? 0,
    }))
    .filter(entry => typeof entry.id === 'string' && entry.id !== '')
    .sort((a, b) => b.turns - a.turns)
  return ranked[0]?.id
}

const budget = await loadBudget()
const sessionId = await pickLongSession()
if (sessionId === undefined) {
  console.error('没有可用的会话')
  process.exit(1)
}

const browser = await pw.chromium.launch({ channel: 'chrome', headless: !headed })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const cookies = process.env.PALM_PAIR === undefined ? [] : []
void cookies
await context.addCookies([{
  name: 'dsh_pair',
  value: process.env.PALM_PAIR ?? 'edb0f18289ef966fa2c1bad84cfed355',
  domain: '127.0.0.1',
  path: '/',
}])
const page = await context.newPage()

// ── ① 首屏：从导航到"第一条消息行可见" ────────────────────────────────
const navStartedAt = Date.now()
await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
let firstContentMs
for (let i = 0; i < 200; i += 1) {
  await page.waitForTimeout(50)
  const rows = await page.evaluate(() => document.querySelectorAll('[data-message-id]').length)
  if (rows > 0) { firstContentMs = Date.now() - navStartedAt; break }
}
await page.waitForTimeout(1500)

// ── ② 滚动帧率：滚 1.5 秒，统计 rAF 间隔 ───────────────────────────────
const scrollFps = await page.evaluate(async () => {
  const scroller = document.querySelector('.chat-scroll') ?? document.scrollingElement
  if (scroller === null) return 0
  const frames = []
  let last = performance.now()
  const started = performance.now()
  let stop = false
  const tick = () => {
    const now = performance.now()
    frames.push(now - last)
    last = now
    if (now - started >= 1500) { stop = true; return }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  // 同时滚动：每帧往下推 24px，滚到底再回顶部继续
  const step = () => {
    if (stop) return
    scroller.scrollTop += 24
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) scroller.scrollTop = 0
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
  await new Promise(resolve => setTimeout(resolve, 1700))
  const usable = frames.filter(delta => delta > 0)
  if (usable.length === 0) return 0
  const average = usable.reduce((sum, delta) => sum + delta, 0) / usable.length
  return Math.round(1000 / average)
})

// ── ③ 输入延迟：敲一个字 → 值出现 ─────────────────────────────────────
const inputLatencyMs = await page.evaluate(async () => {
  const input = document.querySelector('textarea')
  if (input === null) return -1
  input.focus()
  const samples = []
  for (let i = 0; i < 5; i += 1) {
    const started = performance.now()
    const before = input.value
    input.value = `${before}x`
    input.dispatchEvent(new Event('input', { bubbles: true }))
    // 等 React 把这次输入画到 DOM 上
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)))
    samples.push(performance.now() - started)
    input.value = before
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  samples.sort((a, b) => a - b)
  return Math.round(samples[Math.floor(samples.length / 2)])
})

// 清理：别把测试字符留在输入框里
await page.locator('textarea').first().fill('').catch(() => undefined)
await browser.close()

const measured = {
  sessionId,
  firstContentMs: firstContentMs ?? -1,
  scrollFps,
  inputLatencyMs,
}
const checks = [
  { key: 'firstContentMs', ok: firstContentMs !== undefined && firstContentMs <= budget.firstContentMs, budget: budget.firstContentMs },
  { key: 'scrollFps', ok: scrollFps >= budget.scrollFps, budget: budget.scrollFps, direction: 'min' },
  { key: 'inputLatencyMs', ok: inputLatencyMs >= 0 && inputLatencyMs <= budget.inputLatencyMs, budget: budget.inputLatencyMs },
]
const failed = checks.filter(check => !check.ok)

if (jsonOnly) {
  console.log(JSON.stringify({ measured, budget, failed: failed.map(check => check.key) }, null, 2))
} else {
  console.log(`会话 ${String(sessionId).slice(0, 20)}｜宿主 ${BASE}\n`)
  console.log('指标            实测      预算      结论')
  const rows = [
    ['首屏(ms)', measured.firstContentMs, budget.firstContentMs, '≤'],
    ['滚动帧率', measured.scrollFps, budget.scrollFps, '≥'],
    ['输入延迟(ms)', measured.inputLatencyMs, budget.inputLatencyMs, '≤'],
  ]
  for (const [name, value, limit, symbol] of rows) {
    const pass = symbol === '≤' ? value <= limit : value >= limit
    console.log(`${String(name).padEnd(14)}${String(value).padEnd(10)}${symbol}${String(limit).padEnd(8)}${pass ? 'PASS' : 'FAIL'}`)
  }
  console.log(failed.length === 0 ? '\n结论：性能预算内 ✓' : `\n结论：${failed.length} 项超预算 ✗`)
}

if (updateBudget) {
  const next = { firstContentMs: measured.firstContentMs, scrollFps: measured.scrollFps, inputLatencyMs: Math.max(measured.inputLatencyMs, 0) }
  await writeFile(BUDGET_FILE, JSON.stringify(next, null, 2), 'utf8')
  if (!jsonOnly) console.log('已把这次实测写成新预算（budget.json）')
}

process.exit(failed.length === 0 ? 0 : 1)
