import { join } from 'node:path'
import { PAIR_DEVICE_ID } from './lib/pair-cookie.mjs'
import { listUrl, pw } from './mobile-scenarios/lib/env.mjs'

const BASE = 'http://127.0.0.1:3080'
const PAIR = PAIR_DEVICE_ID
const OUT = join(import.meta.dirname, '..', '.tmp-visual')

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await context.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])
const page = await context.newPage()

await page.goto(listUrl(), { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

await page.locator('[aria-label="设置"]').first().click({ timeout: 6000 })
await page.waitForTimeout(2500)

const state = await page.evaluate(() => ({
  title: document.querySelector('.mobile-title')?.textContent ?? null,
  hasAppearanceRow: [...document.querySelectorAll('*')]
    .some(node => node.children.length === 0 && node.textContent?.trim() === '外观与皮肤'),
  textStart: document.body.innerText.slice(0, 90).replace(/\s+/g, ' '),
}))

if (state.hasAppearanceRow) {
  await page.getByText('外观与皮肤').first().click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(2000)
  state.afterClick = await page.evaluate(() => ({
    title: document.querySelector('.mobile-title')?.textContent ?? null,
    hasSkinRows: document.body.innerText.includes('夜航'),
    pageClass: document.querySelector('.appearance-page') !== null,
  }))
  await page.screenshot({ path: join(OUT, 'appearance.png') })
}

await browser.close()
console.log(JSON.stringify(state, null, 2))
