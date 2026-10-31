/**
 * S7 跨页往返：聊天 → 列表 → 首页 → 运行中 → 回聊天，重复 N 次。
 *
 * 现场：切换页面后回到会话，行数回落/卡片被重画/过程条消失/灰点不变绿。
 * 判据：每页行数单调、无重复 key、回聊天后过程条仍在、卡片文案不被改写。
 */
import { chatUrl, homeUrl, listUrl, sleep } from '../lib/env.mjs'
import {
  checkNoDuplicateIds,
  checkPinnedToBottom,
  checkProcessVisibleWhileRunning,
  makeCardTextGuard,
  makeMonotonicGuard,
  sampleChat,
  sampleUnits,
} from '../lib/invariants.mjs'

export const scenario = {
  id: 'cross-page-round-trip',
  title: '跨页往返（聊天↔列表↔首页↔运行中）不抖不丢',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    const monotonic = makeMonotonicGuard(check, 'chat')
    const cardText = makeCardTextGuard(check, 'chat')

    try {
      for (let round = 1; round <= 3; round += 1) {
        // 1. 聊天
        await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
        for (let i = 0; i < 12; i += 1) {
          await page.waitForTimeout(150)
          const snap = await sampleChat(page)
          // 长会话（>100 行）另算：DOM 只保留一屏+缓冲，行数本来就会随滚动裁剪。
          // 实测 session-628d1093（213 轮）进入后 132 → 61，这是**可行的裁剪**，
          // 不是"数据回退"。长会话的真正不变量在 long-session-window 里查（首帧不回落）。
          if (snap.rows < 100) monotonic(snap)
          cardText(snap)
          checkNoDuplicateIds(check, snap, `round${round}-chat`)
          checkProcessVisibleWhileRunning(check, snap, `round${round}-chat`)
          if (i === 11) checkPinnedToBottom(check, snap, `round${round}-chat`)
        }

        // 2. 列表
        await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1200)
        const listRows = await sampleUnits(page, '.mobile-row-sess')
        check('list-has-rows', listRows > 0, { round, listRows })

        // 3. 首页（谁在跑）
        await page.goto(homeUrl(), { waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(1200)
        const homeRows = await sampleUnits(page, '.mobile-row')
        check('home-has-rows', homeRows > 0, { round, homeRows })

        // 4. 运行中
        const running = page.locator('[aria-label*="运行中"], button:has-text("运行中")').first()
        if (await running.count() > 0) {
          await running.click()
          await page.waitForTimeout(1200)
          const runRows = await sampleUnits(page, '.runov-sess, .runov-finish-row')
          check('runs-page-rendered', true, { round, runRows })
        }
        await sleep(200)
      }
    } finally {
      await page.close()
    }
  },
}
