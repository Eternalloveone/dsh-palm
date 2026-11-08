/**
 * 审核探针：⑫ 大纲 / ⑦ 上下文 / ⑥ 批准方式 三个页面在真实宿主上**能不能点开**。
 * 只读，不改任何状态（不点任何会写的东西）。
 */
import { chatUrl, listUrl, pw, rpc } from './mobile-scenarios/lib/env.mjs'

const PAIR = process.env['PALM_PAIR'] ?? 'edb0f18289ef966fa2c1bad84cfed355'
const WORKSPACE = process.env['PALM_WORKSPACE'] ?? '469ac44d-a832-4cae-8511-75796e59852d'

const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
const ranked = list
  .map(item => ({ id: item.sessionId ?? item.id, turns: item.projections?.values?.sessionStats?.turns ?? 0 }))
  .filter(entry => typeof entry.id === 'string')
  .sort((a, b) => b.turns - a.turns)
const sessionId = process.env['PALM_SESSION'] ?? ranked[0]?.id

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await context.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])
const page = await context.newPage()

const results = {}
async function pageMarker() {
  return await page.evaluate(() => ({
    title: document.querySelector('.mobile-title')?.textContent ?? null,
    classes: [...document.querySelectorAll('[class$="-page"]')].map(node => node.className.split(' ')[0]).slice(0, 3),
    backButtons: document.querySelectorAll('.mobile-back').length,
  }))
}

await page.goto(chatUrl(sessionId), { waitUntil: 'networkidle' })
await page.waitForTimeout(3000)

/* ⑦ 上下文：点输入区上方的上下文条 */
const contextEntry = await page.locator('.chat-context').count()
if (contextEntry > 0) {
  await page.locator('.chat-context').first().click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1500)
  results.context = await pageMarker()
  await page.goBack().catch(() => {})
  await page.waitForTimeout(1200)
} else results.context = { missing: true }

/* ⑥ 批准方式：点权限胶囊 */
const permissionEntry = await page.locator('[aria-label^="切换权限"]').count()
if (permissionEntry > 0) {
  await page.locator('[aria-label^="切换权限"]').first().click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1800)
  results.approvalMode = await pageMarker()
  await page.goBack().catch(() => {})
  await page.waitForTimeout(1200)
} else results.approvalMode = { missing: true }

/* ⑫ 大纲：先上滑，让轮次滑杆出现，再轻点 */
await page.evaluate(() => {
  const scroller = document.querySelector('.chat-scroll')
  if (scroller !== null) scroller.scrollTop = 2000
})
await page.waitForTimeout(2000)
const scrubber = page.locator('[aria-label^="轮次导航"]')
if (await scrubber.count() > 0) {
  await page.locator('.chat-scroll').first().hover({ timeout: 3000 }).catch(() => {})
  await scrubber.first().dispatchEvent('pointerdown', { pointerId: 1, clientY: 400, bubbles: true }).catch(() => {})
  await page.waitForTimeout(400)
  await page.locator('.chat-scroll').first().hover({ timeout: 2000 }).catch(() => {})
  await page.waitForTimeout(1200)
  results.outline = await pageMarker()
} else results.outline = { missing: true }

await browser.close()
console.log(JSON.stringify({ sessionId, results }, null, 2))
