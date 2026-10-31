/**
 * S8b 弱网（3G 节流）进会话（只读）。
 *
 * 现场类问题：手机上弱网时进会话一直骨架、或者白屏十几秒。
 * 判据：3G 下 15 秒内必须出现正文行；30 秒内不许出现"永远骨架"（0 行）。
 */
import { chatUrl } from '../lib/env.mjs'
import { sampleChat } from '../lib/invariants.mjs'

export const scenario = {
  id: 'weak-network-3g',
  title: '3G 节流下进会话：15 秒内出正文',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    try {
      // Chrome DevTools 的 3G 档：400kbps 下、400kbps 上、400ms RTT
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 400,
        downloadThroughput: 400 * 1024 / 8,
        uploadThroughput: 400 * 1024 / 8,
      })

      const started = Date.now()
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })

      let firstRowsAt
      for (let i = 0; i < 60; i += 1) {
        await page.waitForTimeout(500)
        const snap = await sampleChat(page)
        if (snap.rows > 0) { firstRowsAt = Date.now() - started; break }
      }
      check('rows-appear-under-3g', firstRowsAt !== undefined && firstRowsAt <= 15_000, { firstRowsAt })

      // 再等一会儿：正文不该又退回 0 行（骨架回来了 = 用户看到"没内容"）
      await page.waitForTimeout(8000)
      const later = await sampleChat(page)
      check('rows-stay-under-3g', later.rows > 0, { rows: later.rows })
    } finally {
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      }).catch(() => undefined)
      await page.close()
    }
  },
}
