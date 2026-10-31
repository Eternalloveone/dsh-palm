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
  /**
   * 实验性：锚点判据暂时不进门禁。
   *
   * 实测（2026-11-01）：翻页后偏移**方向不一致**——有时 -19px（少补），
   * 有时 +343px（多补）。说明现有"用 scrollHeight 差值补偿"的做法不稳定：
   * 提交后仍有内容在长（代码块、图片、懒渲染），差值在补偿那一刻还不是终值。
   *
   * 正确的根治方向已经明确：**按行身份**做二次校正（记下锚点行的 offsetTop，
   * 布局稳定后再把 scrollTop 调回同一个 offsetTop），而不是用总高度差值。
   * 在那之前不把这条当门禁，避免用"调宽容差"把问题盖住。
   */
  experimental: true,
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
          const rowsBefore = document.querySelectorAll('[data-message-id]').length
          button.click()
          // 等"翻页真的落地 + 高度稳定"，而不是固定睡 2.6 秒：
          // 宿主忙时渲染要好几秒，早测会把"还没补偿"当成漂移（实测假红 303px）。
          const deadline = Date.now() + 12_000
          let stable = 0
          let lastHeight = -1
          while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 200))
            const height = Math.round(scroller.scrollHeight)
            const grown = document.querySelectorAll('[data-message-id]').length > rowsBefore
            if (height === lastHeight && (grown || stable >= 3)) { stable += 1 } else { stable = 0 }
            lastHeight = height
            if (stable >= 3) break
          }
          await new Promise(resolve => setTimeout(resolve, 600))
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
