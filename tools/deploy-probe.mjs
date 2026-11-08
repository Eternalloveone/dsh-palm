import { join } from 'node:path'

const PLAYWRIGHT = process.env['PALM_PLAYWRIGHT'] ?? 'file:///C:/Users/Administrator/.dsh/skills/feishu-report/node_modules/playwright/index.js'
const BASE = process.env['PALM_BASE'] ?? 'http://127.0.0.1:3080'
const PAIR = process.env['PALM_PAIR'] ?? 'edb0f18289ef966fa2c1bad84cfed355'
const OUT = join(import.meta.dirname, '..', '.tmp-visual')

const { chromium } = (await import(PLAYWRIGHT)).default
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await context.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])
const page = await context.newPage()

await page.goto(`${BASE}/m/`, { waitUntil: 'networkidle', timeout: 30_000 })
await page.waitForTimeout(1500)

// 工作区列表 → 第一个工作区
const workspace = page.locator('[class*="workspace"], [class*="ws-"]').first()
await workspace.click({ timeout: 8_000 }).catch(() => {})
await page.waitForTimeout(2500)

// 会话列表 → 第一个会话
const rowCandidates = ['.mobile-row', '[class*="session-row"]', '[class*="list-row"]', '[class*="row"]']
for (const selector of rowCandidates) {
  const count = await page.locator(selector).count()
  if (count > 0) {
    await page.locator(selector).first().click({ timeout: 8_000 }).catch(() => {})
    await page.waitForTimeout(3000)
    if (await page.locator('.chat-scroll').count() > 0) break
  }
}

const probe = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('[aria-label]')].map(node => node.getAttribute('aria-label'))
  return {
    url: location.pathname + location.search.slice(0, 80),
    inChat: document.querySelector('.chat-scroll, .chat-composer') !== null,
    hasArtifactsEntry: labels.includes('产物'),
    hasModelEntry: labels.includes('模型与思考'),
    headerLabels: labels.slice(0, 14),
  }
})

await page.screenshot({ path: join(OUT, 'deploy-probe.png') })
await browser.close()
console.log(JSON.stringify(probe, null, 2))
