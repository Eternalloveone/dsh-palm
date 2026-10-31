/**
 * S9 切后台再回来：状态不许倒退、不许重复卡、过程条不许丢。
 *
 * 用 Visibility API 的真实事件模拟（手机切到后台再切回来）。判据与跨页一致，
 * 但中间多了"页面隐藏 8 秒"这一段 —— 真机上这一段最容易出现重连后整屏重画。
 */
import { chatUrl, sleep } from '../lib/env.mjs'
import {
  checkNoDuplicateIds,
  checkProcessVisibleWhileRunning,
  makeCardTextGuard,
  makeMonotonicGuard,
  sampleChat,
} from '../lib/invariants.mjs'

export const scenario = {
  id: 'background-return',
  title: '切后台 8 秒回来：不重画、不丢过程条',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    const monotonic = makeMonotonicGuard(check, 'background')
    const cardText = makeCardTextGuard(check, 'background')

    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      for (let i = 0; i < 10; i += 1) {
        await page.waitForTimeout(150)
        const snap = await sampleChat(page)
        monotonic(snap)
        checkNoDuplicateIds(check, snap, 'before-hidden')
      }

      // 隐藏（切后台）
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await sleep(8000)

      // 回来
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      for (let i = 0; i < 20; i += 1) {
        await page.waitForTimeout(200)
        const snap = await sampleChat(page)
        monotonic(snap)
        cardText(snap)
        checkNoDuplicateIds(check, snap, 'after-visible')
        checkProcessVisibleWhileRunning(check, snap, 'after-visible')
      }
    } finally {
      await page.close()
    }
  },
}
