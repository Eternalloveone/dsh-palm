/**
 * S21 跑着的时候按「停止」（manual）。
 *
 * 用户动作：一条命令跑太久 → 点输入区那个红色停止键。
 *
 * 判据：
 *   ① 停止键真的在（在跑时才有，且不是「发送」）；
 *   ② 按下去之后「输出中」消失；
 *   ③ 这一轮落在终态（已中断 / 已完成 / 失败），不会永远转圈；
 *   ④ 停止之后还**能继续发消息**（不该把输入区锁死）。
 */
import { chatUrl, rpc, startLongTurn, waitUntilIdle } from '../lib/env.mjs'

const STOP = 'button[aria-label="停止"], .chat-send-stop, button[aria-label*="停止"]'

export const scenario = {
  id: 'stop-mid-turn',
  needsTurn: true,
  manual: true,
  title: '跑着时按停止：落终态、能继续发',
  async run(ctx) {
    const { context, check, testSessionId } = ctx
    check('test-session-provided', testSessionId !== undefined, { testSessionId })
    if (testSessionId === undefined) return

    // 先起一条会跑一阵的命令，让停止有意义
    await startLongTurn(testSessionId, '用 bash 跑 python -c "import time; time.sleep(60)"，完成后说一句"好了"。')

    const page = await context.newPage()
    try {
      await page.goto(chatUrl(testSessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      // 等它真的在跑
      let running = false
      for (let i = 0; i < 40 && !running; i += 1) {
        await page.waitForTimeout(500)
        running = await page.evaluate(() => /输出中/.test(document.body.innerText ?? ''))
      }
      check('turn-is-running', running, {})

      // ① 停止键在
      const stop = page.locator(STOP).first()
      const stopVisible = (await stop.count()) > 0 && await stop.isVisible().catch(() => false)
      check('stop-button-present', stopVisible, {})
      if (!stopVisible) return

      await stop.click({ force: true })

      // ②「输出中」消失
      let settled = false
      for (let i = 0; i < 60; i += 1) {
        await page.waitForTimeout(500)
        settled = await page.evaluate(() => !/输出中/.test(document.body.innerText ?? ''))
        if (settled) break
      }
      check('running-indicator-clears', settled, {})

      // ③ 这一轮落在终态，或者至少给出"已停止"的明确回应。
      //    （实测：命令跑在 bash 里时被中断，这一轮可能一张卡都没产出来，
      //     此时"已中断"卡根本不存在 —— 判据不能只认卡片文案。）
      const state = await page.evaluate(() => {
        const text = document.body.innerText ?? ''
        return {
          terminalCard: /已中断|已完成|失败|出错/.test(text),
          stopHint: /已停止/.test(text),
          stillRunningWording: /运行中|执行中|深度求索中/.test(text),
        }
      })
      check('turn-settles-with-feedback', (state.terminalCard || state.stopHint) && !state.stillRunningWording, state)

      // ④ 停止之后输入还能用（能写、能发）
      const input = page.locator('textarea, [contenteditable=true]').first()
      await input.click()
      await input.fill('[palm-e2e] 停止后还能发吗')
      const typed = await input.inputValue().catch(() => '')
      check('composer-usable-after-stop', typed.includes('停止后还能发'), { typed: typed.slice(0, 20) })
      // 不发出去（避免污染会话），清掉即可
      await input.fill('')
      await waitUntilIdle(testSessionId, 60_000).catch(() => undefined)
    } finally {
      await page.close()
    }
  },
}
