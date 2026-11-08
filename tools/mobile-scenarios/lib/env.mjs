/**
 * 场景压测的公共环境：宿主地址、配对 cookie、RPC、浏览器启动。
 */

export const BASE = process.env.PALM_BASE ?? 'http://127.0.0.1:3080'
export const PAIR = process.env.PALM_PAIR ?? 'edb0f18289ef966fa2c1bad84cfed355'
export const WORKSPACE = process.env.PALM_WORKSPACE ?? '469ac44d-a832-4cae-8511-75796e59852d'
const PLAYWRIGHT = process.env.PALM_PLAYWRIGHT
  ?? 'file:///C:/Users/Administrator/.dsh/skills/feishu-report/node_modules/playwright/index.js'

export const pw = (await import(PLAYWRIGHT)).default

/** 调宿主 RPC（与手机端同一条通道）。 */
export async function rpc(method, payload = {}) {
  const res = await fetch(`${BASE}/m/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `dsh_pair=${PAIR}` },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'sc' + Math.random().toString(36).slice(2),
      method,
      payload,
    }),
  })
  return (await res.json())?.result
}

/** 手机视口 + 配对 cookie 的浏览器上下文。 */
export async function launch({ headed = false } = {}) {
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: !headed })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await context.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])
  return { browser, context }
}

/** 聊天页 URL（debug=1 让 window.__palmRows 可用）。 */
export function chatUrl(sessionId, { debug = true } = {}) {
  const query = new URLSearchParams({ workspace: WORKSPACE })
  if (debug) query.set('debug', '1')
  query.set('session', sessionId)
  return `${BASE}/m/?${query.toString()}`
}

/** 列表/首页 URL。 */
export function listUrl() {
  return `${BASE}/m/?workspace=${WORKSPACE}`
}

export function homeUrl() {
  return `${BASE}/m/`
}

/**
 * ⚠️ 本套场景**不新建会话**。
 *
 * 2026-10-31 用户明确要求：不要开一堆会话来测。所有场景都复用同一条会话
 * （`PALM_SESSION`，没给就由 runner 挑一条内容最多的），干净、可重复，
 * 也不会把用户列表堆满测试垃圾。原来的 `createScratchSession()` 已删除。
 */

/** 起一个"会跑一段时间"的回合（让被测场景处于在跑状态）。 */
export const TEST_PROMPT_PREFIX = '[palm-e2e] '

/**
 * 在输入框里写一句话并点发送。
 *
 * **必须等一拍再点**：`fill()` 之后 React 的 state 还没落地，立刻点发送时
 * `send()` 读到的是空的输入，于是直接 return —— 界面毫无反应、也没有请求。
 * 这就是手工场景 `prompt-was-delayed {delayed:0}` / 排队条不出现的根因
 * （2026-11-01 实测：同一动作改成"填写 → 回车"就正常）。
 *
 * 判据不是固定 sleep，而是**等发送按钮变成可点**（禁用态消失）。
 */
export async function composeAndSend(page, text, { timeoutMs = 8_000 } = {}) {
  const input = page.locator('textarea, [contenteditable=true]').first()
  await input.click()
  await input.fill(text)
  const send = page.locator('button[aria-label="发送"], button[aria-label*="发送"], button:has-text("发送")').first()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ready = await send.isEnabled().catch(() => false)
    const typed = await input.inputValue().catch(() => '')
    if (ready && typed.trim() !== '') break
    await page.waitForTimeout(100)
  }
  await send.click({ force: true })
  return { input, send }
}

export async function startLongTurn(sessionId, text) {
  // 所有"会发回合"的场景统一带 `[palm-e2e]` 前缀：
  // 会话标题由第一条消息决定，带上前缀就能在列表里一眼认出这是测试会话。
  const prompt = text.startsWith(TEST_PROMPT_PREFIX) ? text : `${TEST_PROMPT_PREFIX}${text}`
  return await rpc('session.prompt', {
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: prompt }],
  })
}

/** 等会话从 running 变为 false（或超时）。 */
export async function waitUntilIdle(sessionId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // 先问"这一轮还在不在跑"：mobile.sessionState 直接给 running，比列表快且准
    // （列表要枚举会话表，冷启动实测能到几十秒）。
    const state = (await rpc('mobile.sessionState', { sessionId }))?.value
    if (state !== undefined && typeof state.running === 'boolean') {
      if (!state.running) return true
      await new Promise(resolve => setTimeout(resolve, 1500))
      continue
    }
    const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
    const row = list.find(item => (item.sessionId ?? item.id) === sessionId)
    if (row === undefined || row.running !== true) return true
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  return false
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
