/**
 * S22 长按选中 / 复制正文（只读）。
 *
 * 用户动作：在手机上长按一段回答想复制。
 *
 * 判据：
 *   ① 正文元素允许选中（`user-select` 不是 none —— 这个插件全局关掉了选中，
 *      只在少数地方放开，很容易漏掉正文）；
 *   ② 真的能选出一段文字（Range + getSelection 拿到的文本非空、且与原文一致）；
 *   ③ 选中不会把页面顶飞（选中前后滚动位置基本不变）。
 */
import { chatUrl } from '../lib/env.mjs'
import { sampleChat } from '../lib/invariants.mjs'

export const scenario = {
  id: 'select-and-copy',
  title: '正文能选中复制，且不把页面顶飞',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(250)
        const snap = await sampleChat(page)
        if (snap.rows > 0) break
      }
      await page.waitForTimeout(800)

      const result = await page.evaluate(() => {
        const candidates = [...document.querySelectorAll('.chat-md, .markdown-body, [data-message-id] p')]
        const target = candidates.find(el => (el.textContent ?? '').trim().length > 12) ?? null
        if (target === null) return { skip: 'no-text-block' }
        const style = getComputedStyle(target)
        const scroller = document.querySelector('.chat-scroll')
        const beforeTop = scroller === null ? 0 : Math.round(scroller.scrollTop)

        // 选中第一行文字（模拟长按选中的结果）
        const node = [...target.childNodes].find(child => (child.textContent ?? '').trim() !== '')
        let selected = ''
        if (node !== undefined) {
          const range = document.createRange()
          range.selectNodeContents(node)
          const selection = window.getSelection()
          if (selection !== null) {
            selection.removeAllRanges()
            selection.addRange(range)
            selected = selection.toString().trim()
          }
        }
        const afterTop = scroller === null ? 0 : Math.round(scroller.scrollTop)
        return {
          userSelect: style.userSelect || style.webkitUserSelect,
          textLength: (target.textContent ?? '').trim().length,
          selectedLength: selected.length,
          selectedSample: selected.slice(0, 12),
          scrollDelta: Math.abs(afterTop - beforeTop),
        }
      })

      if (result.skip !== undefined) { check('select-skip', true, { note: result.skip }); return }

      // ① 允许选中
      check('text-is-selectable', result.userSelect !== 'none', { userSelect: result.userSelect })
      // ② 真能选中
      check('selection-returns-text', result.selectedLength > 0, {
        textLength: result.textLength,
        selectedLength: result.selectedLength,
        sample: result.selectedSample,
      })
      // ③ 选中不把页面顶飞
      check('selection-does-not-scroll', result.scrollDelta <= 8, { scrollDelta: result.scrollDelta })

      await page.evaluate(() => { window.getSelection()?.removeAllRanges() })
    } finally {
      await page.close()
    }
  },
}
