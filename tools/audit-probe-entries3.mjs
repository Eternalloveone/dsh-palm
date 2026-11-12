import { chatUrl, pw } from './mobile-scenarios/lib/env.mjs'
import { PAIR_DEVICE_ID } from './lib/pair-cookie.mjs'

const PAIR = PAIR_DEVICE_ID
const sessionId = process.env['PALM_SESSION'] ?? 'session-ca097944-c111-4416-b001-ecec33ec558d'

const browser = await pw.chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await context.addCookies([{ name: 'dsh_pair', value: PAIR, domain: '127.0.0.1', path: '/' }])

async function freshChat() {
  const page = await context.newPage()
  await page.goto(chatUrl(sessionId), { waitUntil: 'networkidle' })
  await page.waitForTimeout(3200)
  return page
}

const results = {}

/* ⑥ 批准方式：新开一页只测这一个入口 */
{
  const page = await freshChat()
  const pill = page.locator('[aria-label^="切换权限"]').first()
  if (await pill.count() > 0) {
    await pill.click()
    await page.waitForTimeout(1800)
    results.approvalMode = await page.evaluate(() => ({
      page: document.querySelectorAll('.approval-mode-page').length,
      sheet: document.querySelectorAll('.chat-picker-panel').length,
      title: document.querySelector('.mobile-title')?.textContent ?? null,
    }))
  } else results.approvalMode = { missing: true }
  await page.close()
}

/* ⑫ 大纲：真实滚动（滚容器 + 派发 scroll）看滑杆是否出现 */
{
  const page = await freshChat()
  await page.evaluate(() => {
    const scroller = document.querySelector('.chat-scroll')
    if (scroller !== null) {
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 1200)
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    }
  })
  await page.waitForTimeout(2200)
  const count = await page.locator('[aria-label^="轮次导航"]').count()
  results.scrubber = { count }
  if (count > 0) {
    const handle = page.locator('[aria-label^="轮次导航"]').first()
    const box = await handle.boundingBox()
    if (box !== null) {
      await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height - 8, 60))
      await page.waitForTimeout(1800)
      results.scrubber.afterTap = await page.evaluate(() => ({
        page: document.querySelectorAll('.outline-page').length,
        title: document.querySelector('.mobile-title')?.textContent ?? null,
      }))
    }
  }
  await page.close()
}

await browser.close()
console.log(JSON.stringify(results, null, 2))
