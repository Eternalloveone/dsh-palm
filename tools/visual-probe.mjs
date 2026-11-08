/**
 * 探针：带着配对 cookie 打开 /m/，看能不能进到列表页。
 *
 * 目的：确认 `tools/mobile-visual` 那条像素基线链路到底缺什么前置条件。
 * 不修改任何状态，只截图 + 打印关键 DOM 标记。
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const PLAYWRIGHT = process.env['PALM_PLAYWRIGHT'] ?? 'file:///C:/Users/Administrator/.dsh/skills/feishu-report/node_modules/playwright/index.js'
const BASE = process.env['PALM_BASE'] ?? 'http://127.0.0.1:3080'
const PAIR = process.env['PALM_PAIR'] ?? 'edb0f18289ef966fa2c1bad84cfed355'
const OUT = join(import.meta.dirname, '..', '..', '.tmp-visual')

const { chromium } = (await import(PLAYWRIGHT)).default

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await context.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])

const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(String(error)))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })

await page.goto(`${BASE}/m/`, { waitUntil: 'networkidle', timeout: 30_000 })
await page.waitForTimeout(2500)

const probe = await page.evaluate(() => ({
  title: document.title,
  hasPairingForm: document.querySelector('input[placeholder*="配对"]') !== null
    || document.body.innerText.includes('设备配对'),
  hasRoster: document.querySelector('.mobile-roster, .session-list, [data-testid="roster"]') !== null,
  bodyStart: document.body.innerText.slice(0, 160).replace(/\s+/g, ' '),
}))

const file = join(OUT, 'probe.png')
await page.screenshot({ path: file, fullPage: false })
await browser.close()

console.log(JSON.stringify({ probe, errors: errors.slice(0, 3), screenshot: file }, null, 2))
