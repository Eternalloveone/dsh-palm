/**
 * S3 跑着排队：会话在跑时发一条排队消息，然后连点两次「发送」。
 *
 * 现场：排队条出现两条一模一样的；或者送达后排队条不消失。
 * 判据：宿主队列里同一条只 1 份；屏幕上排队条 ≤1；收工后排队条消失且正文只 1 条。
 */
import { chatUrl, createScratchSession, rpc, sleep, startLongTurn, waitUntilIdle, WORKSPACE } from '../lib/env.mjs'

const queueRows = page => page.evaluate(() => {
  const dock = document.querySelector('[class*=queue]')
  if (dock === null) return []
  return [...dock.querySelectorAll('[class*=item], li, [class*=row]')]
    .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(text => text.length > 2)
})

export const scenario = {
  id: 'queue-while-running',
  title: '跑着排队 + 连点：只入队一条，送达后自动消失',
  async run(ctx) {
    const { context, check } = ctx
    const sessionId = await createScratchSession()
    check('scratch-created', sessionId !== undefined, { sessionId })
    if (sessionId === undefined) return

    await startLongTurn(sessionId, '用 bash 跑两次 python -c "import time; time.sleep(20)"，各自完成后说一句"第N步完成"。')
    await sleep(6000)

    const page = await context.newPage()
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      const text = `场景排队 ${Date.now() % 100000}`
      const input = page.locator('textarea, [contenteditable=true]').first()
      const send = page.locator('button[aria-label*="发送"], button:has-text("发送")').first()

      await input.click()
      await input.fill(text)
      await send.click({ force: true })
      await page.waitForTimeout(2500)
      const rows1 = await queueRows(page)
      check('queue-row-single', rows1.length === 1, { stage: 'after-first-send', rows: rows1.length })

      // 同文本连点两次（1.5 秒窗口内）
      await input.click()
      await input.fill(text)
      await send.click({ force: true })
      await page.waitForTimeout(150)
      await send.click({ force: true }).catch(() => undefined)
      await page.waitForTimeout(2500)
      const rows2 = await queueRows(page)
      check('queue-row-single-after-double-tap', rows2.length === 1, { stage: 'after-double-tap', rows: rows2.length })

      // 等这一轮收工：排队条应当消失，正文里这条用户消息只出现一次
      const idle = await waitUntilIdle(sessionId, 120_000)
      check('turn-finished', idle, {})
      await page.waitForTimeout(3000)
      const rows3 = await queueRows(page)
      check('queue-row-cleared', rows3.length === 0, { stage: 'after-idle', rows: rows3.length })

      const occurrences = await page.evaluate(needle => {
        const rows = window.__palmRows ?? []
        return rows.filter(row => row.kind === 'user' && String(row.text ?? '').includes(needle)).length
      }, text.slice(-8))
      check('user-message-once', occurrences === 1, { occurrences })

      // 顺带确认宿主侧也没有残留
      const inbox = (await rpc('mobile.inbox', { sessionId }))?.value ?? {}
      const queued = [...(inbox.nextTurn ?? []), ...(inbox.nextStep ?? [])].length
      check('host-queue-empty', queued === 0, { queued })
    } finally {
      await page.close()
    }
  },
}
