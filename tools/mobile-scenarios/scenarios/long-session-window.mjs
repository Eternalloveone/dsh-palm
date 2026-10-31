/**
 * S10 长会话反复进入：首帧不回落、卡片文案不被改写、不重复 key。
 *
 * 用一条**真实长会话**（PALM_SESSION）进出 4 次。现场：长会话里进会话时
 * "先短后长"、卡片被换掉、行数塌一段又长回来。
 */
import { chatUrl } from '../lib/env.mjs'
import {
  checkNoDuplicateIds,
  checkPinnedToBottom,
  makeCardTextGuard,
  makeMonotonicGuard,
  sampleChat,
} from '../lib/invariants.mjs'

export const scenario = {
  id: 'long-session-window',
  title: '长会话反复进入 4 次：首帧不回落、卡片不改写',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    // 头 2.5 秒允许猜卡被真卡替换（已知收敛），之后必须彻底稳定 —— 用户看到
    // "卡片又被改写一遍"就是宽限期结束之后还在变。
    const cardText = makeCardTextGuard(check, 'long-session', { graceMs: 2500 })
    let baselineRows = 0

    try {
      for (let round = 1; round <= 4; round += 1) {
        const monotonic = makeMonotonicGuard(check, `long-session#${round}`)
        await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
        let firstRows = 0
        for (let i = 0; i < 30; i += 1) {
          await page.waitForTimeout(100)
          const snap = await sampleChat(page)
          if (i === 1) firstRows = snap.rows
          // 长会话的 DOM 只保留一屏+缓冲，行数随滚动/补页裁剪是正常的
          // （实测 132 → 61）。这里只查"再进首帧不回落"（warm-first-frame）。
          if (snap.rows < 100) monotonic(snap)
          cardText(snap)
          checkNoDuplicateIds(check, snap, `long-session#${round}`)
          if (i === 29) checkPinnedToBottom(check, snap, `long-session#${round}`)
        }
        if (round === 1) baselineRows = firstRows
        // 第 2 次起：首帧行数不该明显少于第一次（缓存应当已经热了）
        if (round > 1) {
          check('warm-first-frame', firstRows >= Math.max(0, baselineRows - 5), { round, firstRows, baselineRows })
        }
      }
    } finally {
      await page.close()
    }
  },
}
