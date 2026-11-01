/**
 * S23 发送**真的**失败（manual）。
 *
 * 用户动作：宿主挂了 / 通道 500，点发送。
 *
 * 判据（和「假失败」正好相反的那一半）：
 *   ① 明确告诉用户失败了（`发送失败` 字样），不许静默；
 *   ② 原文**留在输入框**里，用户不用重打；
 *   ③ 恢复之后重发能成功（证明失败判定没把发送通道锁死）。
 */
import { chatUrl, sleep } from '../lib/env.mjs'

export const scenario = {
  id: 'send-really-fails',
  needsTurn: true,
  manual: true,
  title: '真失败要说清楚、原文保留、恢复后能重发',
  async run(ctx) {
    const { context, check, testSessionId } = ctx
    check('test-session-provided', testSessionId !== undefined, { testSessionId })
    if (testSessionId === undefined) return

    const page = await context.newPage()
    const text = `真失败 ${Date.now() % 100000}`
    let blocked = true
    try {
      // 把 session.prompt 直接打成 500：这是"宿主真的没接住"
      await page.route('**/m/api/session.prompt', async route => {
        if (!blocked) { await route.continue(); return }
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ type: 'server-response', rpcId: 'x', result: { ok: false, error: { code: 'internal', message: '宿主内部错误' } } }),
        })
      })

      await page.goto(chatUrl(testSessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      const input = page.locator('textarea, [contenteditable=true]').first()
      await input.click()
      await input.fill(text)
      await page.waitForTimeout(300)
      await page.keyboard.press('Enter')

      // ① 明确报错
      let saidFailed = false
      for (let i = 0; i < 30 && !saidFailed; i += 1) {
        await page.waitForTimeout(500)
        saidFailed = await page.evaluate(() => /发送失败|没发出去|重新发送失败/.test(document.body.innerText ?? ''))
      }
      check('failure-is-announced', saidFailed, {})

      // ② 原文还在输入框
      const kept = await input.inputValue().catch(() => '')
      check('original-text-kept', kept.includes(text), { kept: kept.slice(0, 24) })

      // ③ 恢复后重发能成功：把拦截撤掉，再按一次回车
      blocked = false
      await page.unroute('**/m/api/session.prompt')
      // 同一正文 1.5 秒内重复提交会被当成手抖连点直接丢掉（产品的去抖规则），
      // 所以重发前必须等过这个窗口，否则测的是去抖、不是恢复后能不能发。
      await page.waitForTimeout(2200)
      await page.locator('textarea, [contenteditable=true]').first().click()
      await page.keyboard.press('Enter')
      let accepted = false
      for (let i = 0; i < 30 && !accepted; i += 1) {
        await sleep(500)
        accepted = await page.evaluate(() => (document.querySelector('textarea')?.value ?? '').trim() === '')
      }
      check('resend-succeeds-after-recovery', accepted, {})
    } finally {
      await page.close()
    }
  },
}
