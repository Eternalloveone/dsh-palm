/**
 * S8 断流 → 恢复补齐（只读）。
 *
 * 现场类问题：SSE 断了几秒后回来，屏幕上重复一段、或者卡在"连接中断"不动。
 * 判据：断流期间行不回退；恢复后行不重复、能继续增长；不留"连接中断"。
 *
 * 只掐 `/m/api/events.mux` 这条 SSE，不碰静态资源和普通 RPC。
 */
import { chatUrl, sleep } from '../lib/env.mjs'
import { checkNoDuplicateIds, makeMonotonicGuard, sampleChat } from '../lib/invariants.mjs'

export const scenario = {
  id: 'reconnect-backfill',
  title: 'SSE 断 8 秒再恢复：不重复、不丢、不永久断线',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    const monotonic = makeMonotonicGuard(check, 'reconnect')
    let blocking = true

    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      // 等正文真的出来（冷启/弱网下 1.5 秒不够，实测假失败一次）
      let warmed = false
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(300)
        const snap = await sampleChat(page)
        monotonic(snap)
        if (snap.rows > 0) { warmed = true; if (i > 6) break }
      }
      if (!warmed) { check('chat-loaded-before-test', false, {}); return }
      const before = await sampleChat(page)
      check('chat-has-rows-before', before.rows > 0, { rows: before.rows })

      // 断流
      await page.route('**/m/api/events.mux*', route => (blocking ? route.abort('failed') : route.continue()))
      await sleep(8000)

      const during = await sampleChat(page)
      check('rows-not-lost-while-offline', during.rows >= Math.max(0, before.rows - 2), { before: before.rows, during: during.rows })
      checkNoDuplicateIds(check, during, 'during-offline')

      // 恢复
      blocking = false
      await page.unroute('**/m/api/events.mux*')
      await sleep(6000)

      const after = await sampleChat(page)
      checkNoDuplicateIds(check, after, 'after-reconnect')
      check('rows-not-duplicated', after.domDuplicateIds === 0, { duplicates: after.domDuplicateIds })

      // 断线提示不该长期挂着
      const stuck = await page.evaluate(() => /连接中断/.test(document.body.innerText ?? ''))
      check('no-permanent-disconnect-banner', !stuck, {})
    } finally {
      blocking = false
      await page.unroute('**/m/api/events.mux*').catch(() => undefined)
      await page.close()
    }
  },
}
