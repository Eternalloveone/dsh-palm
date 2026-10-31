/**
 * S4b 长会话滚动：上滑翻页 → 回底（只读）。
 *
 * 现场类问题：翻页后位置乱跳、回到最新时没贴底、翻出来的行把屏幕顶飞。
 * 判据：翻页后锚点漂移 ≤ 32px；滚回底部 gap ≤ 4px；无重复身份。
 */
import { chatUrl } from '../lib/env.mjs'
import { checkNoDuplicateIds, checkPinnedToBottom, sampleChat } from '../lib/invariants.mjs'

export const scenario = {
  id: 'long-scroll-anchor',
  title: '上滑翻页再回底：锚点不漂、回底贴住',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      for (let i = 0; i < 20; i += 1) {
        await page.waitForTimeout(100)
        const snap = await sampleChat(page)
        if (snap.rows > 5) break
      }

      const result = await page.evaluate(async () => {
        const scroller = document.querySelector('[data-chat-scroll]') ?? document.scrollingElement ?? document.documentElement
        scroller.scrollTop = 0
        await new Promise(resolve => setTimeout(resolve, 600))
        // 锚点必须**当前就在视口里**：取第一行的话它本来在上方（top 是负几千），
        // 翻页后自然位移上万像素 —— 那是位置语义，不是"漂移"（实测假失败 11784px）。
        const pickAnchor = () => {
          const rowsAll = [...document.querySelectorAll('[data-message-id]')]
          return rowsAll.find(el => {
            const rect = el.getBoundingClientRect()
            return rect.top >= 8 && rect.top <= window.innerHeight - 8
          }) ?? null
        }
        let anchor = pickAnchor()
        if (anchor === null) {
          // 贴底/贴顶时可能一个都没落在视口里：滚到中间再取一次
          scroller.scrollTop = Math.round(scroller.scrollHeight * 0.4)
          await new Promise(resolve => setTimeout(resolve, 500))
          anchor = pickAnchor()
        }
        const before = anchor === null ? null : Math.round(anchor.getBoundingClientRect().top)
        const button = [...document.querySelectorAll('button')].find(el => (el.textContent ?? '').includes('加载更早'))
        if (button !== undefined) {
          button.click()
          await new Promise(resolve => setTimeout(resolve, 2600))
        }
        const after = anchor === null ? null : Math.round(anchor.getBoundingClientRect().top)
        return {
          hasButton: button !== undefined,
          before,
          after,
          drift: before === null || after === null ? null : Math.abs(after - before),
        }
      })

      if (result.before === null) { check('anchor-skip', true, { note: '没取到视口内的锚点，跳过' }); return }
      check('anchor-exists', true, { before: result.before })
      check('anchor-drift-small', result.drift === null || result.drift <= 32, result)
      // 没有更早内容时不算失败（fixture 性质）
      if (!result.hasButton) check('no-older-pages-skip', true, {})

      // 回底
      await page.evaluate(() => {
        const scroller = document.querySelector('[data-chat-scroll]') ?? document.scrollingElement ?? document.documentElement
        scroller.scrollTop = scroller.scrollHeight
      })
      await page.waitForTimeout(1200)
      const snap = await sampleChat(page)
      checkPinnedToBottom(check, snap, 'after-scroll-back')
      checkNoDuplicateIds(check, snap, 'after-scroll-back')
    } finally {
      await page.close()
    }
  },
}
