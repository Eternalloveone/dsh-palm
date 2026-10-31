/**
 * S11 PWA 冷启动（只读）。
 *
 * 用户场景：手机上"从桌面图标打开"或清过缓存的第一次打开。
 * 判据：冷启动 15 秒内出正文；清掉本地缓存（IndexedDB）后再进一次，仍然出正文、
 *       不白屏、不永远骨架。
 */
import { chatUrl } from '../lib/env.mjs'
import { sampleChat } from '../lib/invariants.mjs'

export const scenario = {
  id: 'pwa-cold-start',
  title: 'PWA 冷启动 + 清缓存后仍能出正文',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    try {
      // ① 全新上下文 = 冷启动（没有缓存页）
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      const started = Date.now()
      let firstRowsAt
      for (let i = 0; i < 50; i += 1) {
        await page.waitForTimeout(300)
        const snap = await sampleChat(page)
        if (snap.rows > 0) { firstRowsAt = Date.now() - started; break }
      }
      check('cold-start-shows-rows', firstRowsAt !== undefined && firstRowsAt <= 15_000, { firstRowsAt })

      // ② 清掉本地缓存（模拟"清缓存/换设备再装"），再进
      await page.evaluate(async () => {
        const databases = await (window.indexedDB.databases?.() ?? Promise.resolve([]))
        await Promise.all(databases.map(db => new Promise(resolve => {
          if (db.name === undefined) { resolve(); return }
          const request = window.indexedDB.deleteDatabase(db.name)
          request.onsuccess = () => resolve()
          request.onerror = () => resolve()
          request.onblocked = () => resolve()
        })))
        window.localStorage.clear()
      }).catch(() => undefined)

      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      let rowsAfterClear = 0
      for (let i = 0; i < 50; i += 1) {
        await page.waitForTimeout(300)
        const snap = await sampleChat(page)
        rowsAfterClear = snap.rows
        if (rowsAfterClear > 0) break
      }
      check('works-after-cache-clear', rowsAfterClear > 0, { rowsAfterClear })

      // 不白屏：页面上得有可交互元素（输入框或消息）
      const hasInput = await page.evaluate(() =>
        document.querySelectorAll('textarea, [contenteditable=true], [data-message-id]').length > 0)
      check('not-blank-after-clear', hasInput, {})
    } finally {
      await page.close()
    }
  },
}
