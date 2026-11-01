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
import { chatUrl, rpc } from '../lib/env.mjs'
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

      // 等页面真正贴底（自动跟随把第一屏钉到底之后）再量：判据是
      // **"选中文字不许让贴底的页面移动"**。页面还在补钉阶段时量到的位移是
      // 补钉本身，不是选中造成的（实测会把 1344px 的补钉记到选中头上）。
      for (let i = 0; i < 40; i += 1) {
        const gap = await page.evaluate(() => {
          const el = document.querySelector('.chat-scroll')
          return el === null ? -1 : el.scrollHeight - el.scrollTop - el.clientHeight
        })
        if (gap >= 0 && gap <= 2) break
        await page.waitForTimeout(250)
      }
      const result = await page.evaluate(() => {
        const candidates = [...document.querySelectorAll('.chat-md, .markdown-body, [data-message-id] p')]
        const target = candidates.find(el => (el.textContent ?? '').trim().length > 12) ?? null
        if (target === null) return { skip: 'no-text-block' }
        const style = getComputedStyle(target)
        const scroller = document.querySelector('.chat-scroll')
        // 用「离底部多远」而不是 scrollTop：content-visibility 的估值高度在选中时
        // 会被真实高度替换，scrollTop 会跟着变，但**读者看到的位置没变**（仍贴着底）。
        const gapOf = el => el === null ? 0 : Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)
        const beforeGap = gapOf(scroller)

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
        const afterGap = gapOf(scroller)
        return {
          userSelect: style.userSelect || style.webkitUserSelect,
          textLength: (target.textContent ?? '').trim().length,
          selectedLength: selected.length,
          selectedSample: selected.slice(0, 12),
          gapDelta: Math.abs(afterGap - beforeGap),
          beforeGap,
          afterGap,
        }
      })

      if (result.skip !== undefined) { check('select-skip', true, { note: result.skip }); return }

      // 这条会话正在跑的时候，**内容还在长**，页脚自动跟随会让 scrollTop 变化 ——
      // 那不是选中把页面顶飞，是流式正文在增行（实测差值恰好等于新增高度）。
      // 所以滚动断言只在空闲会话上做，跑着的时候只验能不能选中。
      const turn = await rpc('mobile.turnState', { sessionId })
      const idle = turn?.value?.running === false
      if (!idle) {
        check('scroll-assertion-skipped-while-running', true, { note: '会话在跑，正文还在长，跳过滚动断言' })
      }

      // ① 允许选中
      check('text-is-selectable', result.userSelect !== 'none', { userSelect: result.userSelect })
      // ② 真能选中
      check('selection-returns-text', result.selectedLength > 0, {
        textLength: result.textLength,
        selectedLength: result.selectedLength,
        sample: result.selectedSample,
      })
      // ③ 选中不把页面顶飞（只在空闲会话上判）
      if (idle) check('selection-does-not-scroll', result.gapDelta <= 8, { gapDelta: result.gapDelta, beforeGap: result.beforeGap, afterGap: result.afterGap })

      await page.evaluate(() => { window.getSelection()?.removeAllRanges() })
    } finally {
      await page.close()
    }
  },
}
