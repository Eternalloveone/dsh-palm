import { join } from 'node:path'
import { PAIR_DEVICE_ID } from './lib/pair-cookie.mjs'

const PLAYWRIGHT = process.env['PALM_PLAYWRIGHT'] ?? 'file:///C:/Users/Administrator/.dsh/skills/feishu-report/node_modules/playwright/index.js'
const BASE = 'http://127.0.0.1:3080'
const PAIR = PAIR_DEVICE_ID
const OUT = join(import.meta.dirname, '..', '.tmp-visual')

const { chromium } = (await import(PLAYWRIGHT)).default
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await context.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])
const page = await context.newPage()

await page.goto(`${BASE}/m/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.locator('[class*="workspace"]').first().click().catch(() => {})
await page.waitForTimeout(2000)
await page.locator('.mobile-row').first().click().catch(() => {})
await page.waitForTimeout(3000)

const labels = await page.evaluate(() => [...document.querySelectorAll('[aria-label]')]
  .map(node => ({ label: node.getAttribute('aria-label'), cls: node.className }))
  .filter(entry => entry.label !== null)
  .slice(0, 40))

console.log(JSON.stringify(labels, null, 2))
await page.screenshot({ path: join(OUT, 'chat-probe.png') })
await browser.close()
