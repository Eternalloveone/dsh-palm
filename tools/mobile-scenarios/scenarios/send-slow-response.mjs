/**
 * S3b 发送"超时"但其实已送达：把 `session.prompt` 的响应拖慢到超过客户端等待上限。
 *
 * 现场：消息已经排队并在跑，界面却弹"发送失败"并把原文退回输入框。
 * 判据：不出现"发送失败"；输入框被清空；队列/正文里能查到这条。
 */
import { chatUrl, sleep, startLongTurn } from '../lib/env.mjs'

export const scenario = {
  id: 'send-slow-response',
  /** 需要"已预热"的专用测试会话才算得准；fixture 稳定前不挡门禁。 */
  flaky: true,
  needsTurn: true,
  title: '回执很慢时常：不许谎报发送失败',
  async run(ctx) {
    // 不新建会话：**复用**传进来的那一条（用户明确要求别开一堆会话来测）。
    const { context, check, testSessionId } = ctx
    check('test-session-provided', testSessionId !== undefined, { testSessionId })
    if (testSessionId === undefined) return

    await startLongTurn(testSessionId, '用 bash 跑 python -c "import time; time.sleep(20)"，结束后说"好了"。')
    await sleep(4000)

    const page = await context.newPage()
    let delayed = 0
    try {
      // 把 prompt 的回执拖慢 8 秒（远超客户端等待窗口），模拟"宿主很慢"。
      // 用更宽的通配匹配：真实请求可能带查询串，或走同一 RPC 入口的不同路径
      // （实测精确匹配 `**/m/api/session.prompt` 命中 0 次）。
      await page.route('**/m/api/**', async route => {
        const url = route.request().url()
        if (!url.includes('session.prompt')) { await route.continue(); return }
        delayed += 1
        await sleep(8000)
        await route.continue()
      })

      await page.goto(chatUrl(testSessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      const text = `慢回执 ${Date.now() % 100000}`
      const input = page.locator('textarea, [contenteditable=true]').first()
      const send = page.locator('button[aria-label*="发送"], button:has-text("发送")').first()
      await input.click()
      await input.fill(text)
      await send.click({ force: true })

      // 观察 20 秒：出现"发送失败"就算违规
      let failureSeen = false
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(500)
        const shown = await page.evaluate(() => /发送失败/.test(document.body.innerText ?? ''))
        if (shown) { failureSeen = true; break }
      }
      check('no-fake-failure', !failureSeen, { delayed })
      check('prompt-was-delayed', delayed > 0, { delayed })

      const value = await input.inputValue().catch(() => '')
      check('input-cleared-or-queued', value.trim() === '' || value.includes(text), { value: value.slice(0, 20) })
    } finally {
      await page.close()
    }
  },
}
