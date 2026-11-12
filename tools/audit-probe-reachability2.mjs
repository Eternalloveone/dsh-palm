import { chatUrl, pw } from './mobile-scenarios/lib/env.mjs'
import { PAIR_DEVICE_ID } from './lib/pair-cookie.mjs'

const PAIR = PAIR_DEVICE_ID
const sessionId = process.env['PALM_SESSION'] ?? 'session-ca097944-c111-4416-b001-ecec33ec558d'

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await context.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])
const page = await context.newPage()

await page.goto(chatUrl(sessionId), { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

const before = await page.evaluate(() => ({
  contextPill: document.querySelectorAll('.chat-context').length,
  pills: [...document.querySelectorAll('.chat-pill')].map(node => node.getAttribute('aria-label') ?? node.textContent?.trim()),
  pages: [...document.querySelectorAll('[class$="-page"]')].map(node => node.className.split(' ')[0]),
  scrubber: document.querySelectorAll('[aria-label^="轮次导航"]').length,
}))

// ⑦ 上下文：点上下文条，看出现哪个 page 根节点
const results = { before }
if (before.contextPill > 0) {
  await page.locator('.chat-context').first().click()
  await page.waitForTimeout(1500)
  results['afterContextClick'] = await page.evaluate(() => ({
    contextPage: document.querySelectorAll('.context-page').length,
    popover: document.querySelectorAll('.chat-context-pop, [class*="context-pop"]').length,
    title: document.querySelector('.mobile-title')?.textContent ?? null,
  }))
}

// ⑥ 批准方式：权限胶囊（aria-label 以「切换权限」开头）
const pills = await page.locator('.chat-pill').all()
for (const pill of pills) {
  const label = await pill.getAttribute('aria-label')
  if (label !== null && label.startsWith('切换权限')) {
    await pill.click()
    await page.waitForTimeout(1800)
    results['afterPermissionClick'] = await page.evaluate(() => ({
      approvalModePage: document.querySelectorAll('.approval-mode-page').length,
      sheet: document.querySelectorAll('.chat-picker-panel').length,
      title: document.querySelector('.mobile-title')?.textContent ?? null,
    }))
    break
  }
}

// ⑫ 大纲：真实滚轮上滑 → 滑杆出现 → 轻点
await page.mouse.move(195, 500)
await page.mouse.wheel(0, -3000)
await page.waitForTimeout(1800)
results.scrubberAfterScroll = await page.locator('[aria-label^="轮次导航"]').count()
if (results.scrubberAfterScroll > 0) {
  const handle = page.locator('[aria-label^="轮次导航"]').first()
  const box = await handle.boundingBox()
  if (box !== null) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(1800)
  }
  results.afterScrubberTap = await page.evaluate(() => ({
    outlinePage: document.querySelectorAll('.outline-page').length,
    title: document.querySelector('.mobile-title')?.textContent ?? null,
  }))
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
