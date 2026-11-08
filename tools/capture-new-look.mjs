import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chatUrl, listUrl, pw, rpc, WORKSPACE } from './mobile-scenarios/lib/env.mjs'

const PAIR = process.env['PALM_PAIR'] ?? 'edb0f18289ef966fa2c1bad84cfed355'
const OUT = join(import.meta.dirname, '..', 'docs', 'screenshots', 'new-look')
await mkdir(OUT, { recursive: true })

const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
const sessionId = process.env['PALM_SESSION']
  ?? list
    .map(item => ({ id: item.sessionId ?? item.id, turns: item.projections?.values?.sessionStats?.turns ?? 0 }))
    .filter(entry => typeof entry.id === 'string')
    .sort((a, b) => b.turns - a.turns)[0]?.id

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await context.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])
const page = await context.newPage()

// 对话页（真会话 id）
await page.goto(chatUrl(sessionId), { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
await page.screenshot({ path: join(OUT, '3-chat.png') })
const ok = await page.evaluate(() => document.querySelectorAll('.chat-scroll').length > 0)

// 设置页
await page.goto(listUrl(), { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.locator('[aria-label="设置"]').first().click({ timeout: 6000 })
await page.waitForTimeout(2000)
await page.screenshot({ path: join(OUT, '2-settings.png') })

await browser.close()
console.log(JSON.stringify({ sessionId, chatLoaded: ok }))
