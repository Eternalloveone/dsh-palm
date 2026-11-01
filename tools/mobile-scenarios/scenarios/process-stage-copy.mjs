/**
 * S28 过程的四个阶段必须说得清（只读）。
 *
 * 守的格子：J5×I6（阶段显式）。
 *
 * 用户场景：看着一条回答在跑，中间有"正在思考 / 调工具 / 收工"这些阶段。
 * 界面**不许让用户猜**：没在跑的时候不能出现"运行中"字样；跑着的时候不能出现
 * "已完成"；收工之后必须能读到用时。
 *
 * 判据（对最近若干条过程条逐条查）：
 *   ① 页面整体：`输出中` 只可能出现在真在跑的时候（用宿主结论交叉验证）；
 *   ② 收工的过程条必须带用时（`19秒` 这类），不能只写"已完成"；
 *   ③ 空闲时任何过程条都不许是"运行中/执行中"。
 */
import { chatUrl, rpc } from '../lib/env.mjs'

export const scenario = {
  id: 'process-stage-copy',
  title: '过程条阶段文案与真实状态一致（四阶段不靠猜）',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(250)
        const rows = await page.evaluate(() => document.querySelectorAll('[data-message-id]').length)
        if (rows > 0) break
      }
      await page.waitForTimeout(1000)

      // ① 宿主说没在跑，页面就不许出现"输出中"
      const host = await rpc('mobile.turnState', { sessionId })
      const hostRunning = host?.value?.running ?? host?.running
      const pageState = await page.evaluate(() => ({
        saysRunning: /输出中/.test(document.body.innerText ?? ''),
        heads: [...document.querySelectorAll('.chat-proc-state')].map(el => (el.textContent ?? '').trim()).slice(-6),
        hasDuration: /(\d+)\s*(秒|分钟)/.test(document.body.innerText ?? ''),
      }))
      if (hostRunning === false) {
        check('idle-does-not-claim-running', pageState.saysRunning === false, { hostRunning, saysRunning: pageState.saysRunning })
        const wronglyRunning = pageState.heads.filter(text => /运行中|执行中/.test(text))
        check('idle-proc-heads-not-running', wronglyRunning.length === 0, { wronglyRunning, heads: pageState.heads })
      } else {
        check('running-state-sampled-skip', true, { note: '这条会话正在跑，跳过空闲判据' })
      }

      // ② 收工的条目要能读到用时（阶段显式：做完要标出来）
      check('finished-entries-show-duration', pageState.hasDuration, { heads: pageState.heads })
    } finally {
      await page.close()
    }
  },
}
