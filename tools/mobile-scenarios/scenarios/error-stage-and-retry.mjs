/**
 * S30 出错时的阶段文案 + 还能不能操作（只读）。
 *
 * 守的格子：J9×I6（阶段显式）、J9×U（可操作）。
 *
 * 用户场景：宿主挂了/接口 500 的时候，用户看到的不能是"永远转圈"，也不能是
 * "一句话都没有的白屏"；而且**重试按钮必须真能点**（点了要重新发请求）。
 *
 * 判据：
 *   ① 出错后 5 秒内出现可读说明（不是永久骨架）；
 *   ② 页面上有可点的重试入口，且它确实触发了新请求（拦一层计数）；
 *   ③ 点完重试、恢复接口后，内容能回来（说明重试不是摆设）。
 */
import { listUrl } from '../lib/env.mjs'

export const scenario = {
  id: 'error-stage-and-retry',
  title: '出错时说明白 + 重试真能点、真能恢复',
  async run(ctx) {
    const { context, check } = ctx
    const page = await context.newPage()
    let apiCalls = 0
    try {
      // 先让列表正常打开一次（页面本身能起来）
      await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)

      // 接口全挂：页面必须给说明
      let blocked = true
      await page.route('**/m/api/**', async route => {
        apiCalls += 1
        if (!blocked) { await route.continue(); return }
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"result":{"ok":false,"error":{"code":"internal","message":"boom"}}}' })
      })
      await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })

      let explained = false
      for (let i = 0; i < 20 && !explained; i += 1) {
        await page.waitForTimeout(250)
        explained = await page.evaluate(() => /失败|错误|连不上|重试|稍后/.test(document.body.innerText ?? ''))
      }
      check('error-is-explained', explained, {})

      // ② 重试入口可点，并且真的发请求
      const retry = page.locator('button:has-text("重试"), [role=button]:has-text("重试"), .chat-retry').first()
      const retryVisible = (await retry.count()) > 0 && await retry.isVisible().catch(() => false)
      check('retry-affordance-present', retryVisible, {})
      if (retryVisible) {
        const beforeCalls = apiCalls
        await retry.click({ force: true }).catch(() => undefined)
        await page.waitForTimeout(1500)
        check('retry-triggers-requests', apiCalls > beforeCalls, { beforeCalls, after: apiCalls })

        // ③ 放开接口后再点一次：内容要回来
        blocked = false
        await retry.click({ force: true }).catch(() => undefined)
        let recovered = false
        for (let i = 0; i < 40 && !recovered; i += 1) {
          await page.waitForTimeout(250)
          recovered = await page.evaluate(() => document.querySelectorAll('.mobile-row, [data-session-id]').length > 0)
        }
        check('retry-recovers-content', recovered, {})
      }
      await page.unroute('**/m/api/**')
    } finally {
      await page.close()
    }
  },
}
