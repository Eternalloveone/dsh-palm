/**
 * S8 离线发消息 → 恢复后只送达一次。
 *
 * 现场：断网时发的消息，恢复后重复发送（两条一样的）；或者恢复后永远发不出去。
 * 判据：离线时消息进本地队列（不报错崩溃）；恢复后正文里出现且只出现一次。
 */
import { chatUrl, createScratchSession, rpc, sleep } from '../lib/env.mjs'

export const scenario = {
  id: 'offline-queue-drain',
  title: '断网发消息 → 恢复后只送达一次',
  async run(ctx) {
    const { context, check } = ctx
    const sessionId = await createScratchSession()
    check('scratch-created', sessionId !== undefined, { sessionId })
    if (sessionId === undefined) return

    const page = await context.newPage()
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      const text = `离线重发 ${Date.now() % 100000}`
      await context.setOffline(true)
      const input = page.locator('textarea, [contenteditable=true]').first()
      await input.fill(text)
      await page.locator('button[aria-label*="发送"], button:has-text("发送")').first().click({ force: true })
      await page.waitForTimeout(2000)

      // 离线期间：界面要给出"断网/待发"的反馈，而不是静默失败
      const offlineHint = await page.evaluate(() => /网络已断开|将在恢复后发送|离线/.test(document.body.innerText ?? ''))
      check('offline-hint-shown', offlineHint, {})

      await context.setOffline(false)
      // 恢复后等它真正送达（最多 60 秒）
      let landed = 0
      for (let i = 0; i < 60; i += 1) {
        await sleep(1000)
        landed = await page.evaluate(needle => {
          const rows = window.__palmRows ?? []
          return rows.filter(row => row.kind === 'user' && String(row.text ?? '').includes(needle)).length
        }, text.slice(-8))
        if (landed > 0) break
      }
      check('delivered-after-reconnect', landed === 1, { landed })

      // 再等一会儿，确认没有"重发第二遍"
      await sleep(5000)
      const again = await page.evaluate(needle => {
        const rows = window.__palmRows ?? []
        return rows.filter(row => row.kind === 'user' && String(row.text ?? '').includes(needle)).length
      }, text.slice(-8))
      check('delivered-once', again === 1, { again })

      const inbox = (await rpc('mobile.inbox', { sessionId }))?.value ?? {}
      const queued = [...(inbox.nextTurn ?? []), ...(inbox.nextStep ?? [])].length
      check('host-queue-empty', queued === 0, { queued })
    } finally {
      await context.setOffline(false).catch(() => undefined)
      await page.close()
    }
  },
}
