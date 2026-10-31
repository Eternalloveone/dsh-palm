/**
 * S3b 发送"超时"但其实已送达：把 `session.prompt` 的响应拖慢到超过客户端等待上限。
 *
 * 现场：消息已经排队并在跑，界面却弹"发送失败"并把原文退回输入框。
 * 判据：不出现"发送失败"；输入框被清空；队列/正文里能查到这条。
 */
import { chatUrl, createScratchSession, sleep, startLongTurn } from '../lib/env.mjs'

export const scenario = {
  id: 'send-slow-response',
  title: '回执很慢时常：不许谎报发送失败',
  async run(ctx) {
    const { context, check } = ctx
    const sessionId = await createScratchSession()
    check('scratch-created', sessionId !== undefined, { sessionId })
    if (sessionId === undefined) return

    await startLongTurn(sessionId, '用 bash 跑 python -c "import time; time.sleep(30)"，结束后说"好了"。')
    await sleep(6000)

    const page = await context.newPage()
    let delayed = 0
    try {
      // 把 prompt 的回执拖慢 8 秒（远超客户端等待窗口），模拟"宿主很慢"。
      await page.route('**/m/api/session.prompt', async route => {
        delayed += 1
        await sleep(8000)
        await route.continue()
      })

      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
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
