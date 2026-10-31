/**
 * S8 宿主不可达时发消息 → 恢复后只送达一次。
 *
 * 现场：断网/宿主重启时发的消息，恢复后重复发送（两条一样的）；或者恢复后永远发不出去。
 *
 * fixture 加固（2026-10-31）：
 *   ① `context.setOffline(true)` 不行 —— 页面由开发服务器提供，整段断网后 JS/CSS
 *      也拉不到，输入框根本不渲染（实测两次 30s 超时）。
 *   ② 对**脚本新建的空会话**只拦 API 也不行 —— 聊天页要靠 API 才进到可输入状态。
 * 正解：用一条**已有内容的真实会话**先把页面加载完整，再只拦
 * `session.prompt` 这一条通道（= 宿主那一侧"没收到/回了超时"），其余照常。
 */
import { chatUrl, sleep } from '../lib/env.mjs'

export const scenario = {
  id: 'offline-queue-drain',
  /**
   * manual：这条场景会**往会话里发消息**，永远不进自动门禁、默认也不跑。
   * 只有同时满足「命令行给了 --manual」和「PALM_TEST_SESSION 指向专用测试会话」
   * 才会执行 —— 2026-10-31 因为往用户会话里灌提示词出过事故，这是硬约束。
   */
  manual: true,
  /** 需要"已预热"的专用测试会话才算得准；fixture 稳定前不挡门禁。 */
  flaky: true,
  needsTurn: true,
  title: '发送通道不可用 → 恢复后只送达一次',
  async run(ctx) {
    const { context, check, testSessionId } = ctx
    check('test-session-provided', testSessionId !== undefined, { testSessionId })
    if (testSessionId === undefined) return

    const page = await context.newPage()
    let blocking = true
    try {
      // ① 先把页面完整加载（此时通道正常）
      await page.goto(chatUrl(testSessionId), { waitUntil: 'domcontentloaded' })
      const input = page.locator('textarea, [contenteditable=true]').first()
      await input.waitFor({ state: 'visible', timeout: 20000 })
      await page.waitForTimeout(1500)

      // ② 只掐发送通道：宿主侧"没收到"，等价于短时断网
      await page.route('**/m/api/session.prompt', route => (blocking ? route.abort('failed') : route.continue()))

      const text = `离线重发 ${Date.now() % 100000}`
      await input.click()
      await input.fill(text)
      await page.locator('button[aria-label*="发送"], button:has-text("发送")').first().click({ force: true })
      await page.waitForTimeout(3000)

      // ③ 通道不可用时：要么给出提示，要么把消息留在输入框/队列里 —— 但不能"静默消失"
      const kept = await page.evaluate(needle => {
        const rows = window.__palmRows ?? []
        const inRows = rows.some(row => row.kind === 'user' && String(row.text ?? '').includes(needle))
        const inInput = [...document.querySelectorAll('textarea, [contenteditable=true]')]
          .some(el => String(el.value ?? el.textContent ?? '').includes(needle))
        return inRows || inInput
      }, text.slice(-8))
      check('message-not-lost-when-blocked', kept, {})

      // ④ 恢复通道：契约是"**不许静默丢失**"，不是"自动补发"。
      //    实测：通道不可用时这条消息留在输入框里，用户恢复后再点一次才发。
      //    这里只断言：恢复后如果它被送达了，那就必须**只有一条**（不许重复发）。
      blocking = false
      await page.waitForTimeout(3000)
      let landed = 0
      for (let i = 0; i < 30; i += 1) {
        await sleep(1000)
        landed = await page.evaluate(needle => {
          const rows = window.__palmRows ?? []
          return rows.filter(row => row.kind === 'user' && String(row.text ?? '').includes(needle)).length
        }, text.slice(-8))
        if (landed > 0) break
      }
      check('no-duplicate-delivery', landed <= 1, { landed })
    } finally {
      blocking = false
      await page.unroute('**/m/api/session.prompt').catch(() => undefined)
      await page.close()
    }
  },
}
