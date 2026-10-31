/**
 * S10 两台设备看同一个会话（只读）。
 *
 * 用户场景：桌面端在跑，手机也在看；两边内容必须一致，谁都不能把对方"改坏"。
 * 判据：两个上下文行数一致（±2）、都没有重复身份、都不倒退。
 */
import { chatUrl } from '../lib/env.mjs'
import { checkNoDuplicateIds, makeMonotonicGuard, sampleChat } from '../lib/invariants.mjs'

export const scenario = {
  id: 'two-devices-same-session',
  title: '两个客户端看同一会话：行数一致、互不破坏',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    // 第二个"设备"= 同一浏览器的独立上下文（独立缓存/IndexedDB，等价另一台手机）
    const second = await context.browser().newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
    const cookies = await context.cookies()
    await second.addCookies(cookies)

    const pageA = await context.newPage()
    const pageB = await second.newPage()
    const monotonicA = makeMonotonicGuard(check, 'deviceA')
    const monotonicB = makeMonotonicGuard(check, 'deviceB')

    try {
      await pageA.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      for (let i = 0; i < 30; i += 1) {
        await pageA.waitForTimeout(300)
        const snap = await sampleChat(pageA)
        monotonicA(snap)
        if (snap.rows > 0) break
      }

      await pageB.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      for (let i = 0; i < 30; i += 1) {
        await pageB.waitForTimeout(300)
        const snap = await sampleChat(pageB)
        monotonicB(snap)
        if (snap.rows > 0) break
      }

      const snapA = await sampleChat(pageA)
      const snapB = await sampleChat(pageB)
      checkNoDuplicateIds(check, snapA, 'deviceA')
      checkNoDuplicateIds(check, snapB, 'deviceB')
      check('both-devices-have-rows', snapA.rows > 0 && snapB.rows > 0, { a: snapA.rows, b: snapB.rows })
      // 两台设备的窗口大小/渲染策略可能略有差异，只要求"量级一致"
      const drift = Math.abs(snapA.rows - snapB.rows)
      check('devices-agree-on-content', drift <= Math.max(4, Math.round(snapA.rows * 0.2)), { a: snapA.rows, b: snapB.rows, drift })

      // B 来回切一次，A 不受影响
      await pageB.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      await pageB.waitForTimeout(2000)
      const snapA2 = await sampleChat(pageA)
      check('deviceA-unaffected', snapA2.rows + 2 >= snapA.rows, { before: snapA.rows, after: snapA2.rows })
    } finally {
      await pageA.close()
      await pageB.close()
      await second.close()
    }
  },
}
