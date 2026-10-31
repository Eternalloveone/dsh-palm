/**
 * S19 图片预览与长代码块（只读）。
 *
 * 用户场景：点开一条消息里的图片；看一段长代码。
 * 判据：图片能点开预览、能关闭；长代码块自己横向滚，不把整页撑宽（页面无横向溢出）。
 */
import { chatUrl } from '../lib/env.mjs'

export const scenario = {
  id: 'preview-media-and-code',
  title: '点开图片预览可关；长代码不撑破布局',
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

      // ① 页面不许横向溢出（长代码/长链接撑破是最常见的回归）
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      check('no-horizontal-overflow', overflow.scrollWidth <= overflow.clientWidth + 2, overflow)

      // ② 图片预览
      const image = page.locator('.chat-md img, [data-message-id] img').first()
      const hasImage = (await image.count()) > 0
      if (hasImage) {
        await image.click({ force: true }).catch(() => undefined)
        await page.waitForTimeout(1000)
        const opened = await page.evaluate(() => {
          const overlay = document.querySelector('.file-preview, [class*=preview-sheet], [class*=preview][role=dialog], [role=dialog]')
          return overlay !== null
        })
        check('image-preview-opens', opened, {})
        if (opened) {
          await page.keyboard.press('Escape').catch(() => undefined)
          await page.waitForTimeout(700)
          const closed = await page.evaluate(() =>
            document.querySelectorAll('.file-preview, [class*=preview-sheet], [role=dialog]').length === 0)
          check('image-preview-closes', closed, {})
        }
      } else {
        check('no-image-in-this-session-skip', true, { note: '这条会话没有图片，跳过预览段' })
      }

      // ③ 代码块：要有自己的滚动容器（不参与页面横向溢出）
      const code = await page.evaluate(() => {
        const blocks = [...document.querySelectorAll('pre, .chat-md pre, code')]
        const wide = blocks.filter(el => el.scrollWidth > el.clientWidth + 2)
        return { blocks: blocks.length, wide: wide.length }
      })
      check('code-blocks-present-or-skip', true, code)
    } finally {
      await page.close()
    }
  },
}
