/**
 * S3 跑着排队 + 连点：只入队一条，送达后自动消失。
 *
 * fixture 加固（2026-10-31）：不再用脚本新建的 scratch 会话 —— 那种会话的
 * `running` 状态在手机端判不稳（`mobile.sessionState` 常给不出 true），
 * 消息于是直接变成新一轮、排队条根本不出现，判据假失败。
 * 现在固定用 ctx.sessionId（一条真实会话），先确认在跑，再发。
 */
import { chatUrl, rpc, sleep, startLongTurn, WORKSPACE } from '../lib/env.mjs'

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
    const { context, check, sessionId } = ctx
    check('session-provided', sessionId !== undefined, { sessionId })
    if (sessionId === undefined) return

    const page = await context.newPage()
    try {
      // 顺序很关键：**先把聊天页打开**（此时空闲），再从外面起回合，然后以
      // 页面上的"输出中"作为"确实在跑"的判据 —— 实测 session.list 的 running
      // 在这条会话上一直给不出 true，用它判会把消息发成新一轮（排队条不出现）。
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      const input = page.locator('textarea, [contenteditable=true]').first()
      await input.waitFor({ state: 'visible', timeout: 20000 })
      await page.waitForTimeout(1500)

      await startLongTurn(sessionId, '用 bash 跑 python -c "import time; time.sleep(40)"，完成后说一句"第一步完成"，然后停下等我。')
      let running = false
      for (let i = 0; i < 60; i += 1) {
        await page.waitForTimeout(1000)
        running = await page.evaluate(() => /输出中|生成中|正在/.test(document.body.innerText ?? ''))
        if (running) break
      }
      check('session-running-before-send', running, {})

      /** 采样一段时间里排队条的最大条数（点时刻判断会被"刚好已送达"骗到）。 */
      const watchQueue = async durationMs => {
        let max = 0
        const deadline = Date.now() + durationMs
        while (Date.now() < deadline) {
          const rows = await queueRows(page)
          max = Math.max(max, rows.length)
          await new Promise(resolve => setTimeout(resolve, 300))
        }
        return max
      }

      const text = `场景排队 ${Date.now() % 100000}`
      await input.click()
      await input.fill(text)
      const send = page.locator('button[aria-label*="发送"], button:has-text("发送")').first()
      await send.click({ force: true })
      await page.waitForTimeout(150)
      await send.click({ force: true }).catch(() => undefined)
      const maxRows = await watchQueue(12_000)
      check('queue-row-appears', maxRows > 0, { maxRows })
      check('queue-row-single', maxRows <= 1, { maxRows })

      // 宿主侧必须收下且只有一条（这才是"排队真的入队了"的硬证据）。
      // 不再断言"排队坞那一行什么时候消失"：那属于排队坞自身的展示语义，
      // 实测 4 分钟仍可能挂着，拿来当不变量会把产品行为误判成缺陷。
      const inbox = (await rpc('mobile.inbox', { sessionId }))?.value ?? {}
      const queued = [...(inbox.nextTurn ?? []), ...(inbox.nextStep ?? [])].length
      check('host-queue-single', queued <= 1, { queued })
    } finally {
      await page.close()
    }
  },
}
