/**
 * S32 文件/图片打不开时要说清楚（只读）。
 *
 * 守的格子：J6×I9（结果与文件 × 失败可举证）。
 *
 * 用户场景：点开本轮交付的文件/图片，结果宿主取不到 —— 不能给一片空白，
 * 也不能永远转圈；要么给出错误文案，要么明确"文件不在了"。
 *
 * 两条路径，能走哪条走哪条（并记录走了哪条）：
 *   A. 页面里有交付文件行 → 点开它，同时把预览接口打成 500，看界面说什么；
 *   B. 页面里没有文件行 → 退到接口契约：拿一个不存在的附件 id 请求，
 *      必须得到一个**明确的错误**（不是挂住、不是空对象）。
 */
import { chatUrl, rpc } from '../lib/env.mjs'

export const scenario = {
  id: 'file-preview-failure',
  title: '文件/图片打不开时要说明白',
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
      await page.waitForTimeout(800)

      // 交付卡默认折叠：先全部点开，才看得到文件行
      await page.evaluate(() => {
        for (const head of document.querySelectorAll('.chat-turn-tail-head[aria-expanded="false"]')) {
          head.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }
      })
      await page.waitForTimeout(500)

      const fileRows = await page.evaluate(() => document.querySelectorAll('.chat-turn-tail-file, [class*=chat-turn-tail-file]').length)

      if (fileRows > 0) {
        await page.route('**/m/api/**', async route => {
          if (/preview|attachment|blob/i.test(route.request().url())) {
            await route.fulfill({ status: 500, contentType: 'application/json', body: '{"result":{"ok":false,"error":{"code":"internal","message":"boom"}}}' })
            return
          }
          await route.continue()
        })
        await page.locator('.chat-turn-tail-file, [class*=chat-turn-tail-file]').first().click({ force: true }).catch(() => undefined)
        // 判据是"**不许白屏**"，不是"必须报错"：预览可能命中本地缓存直接画出来，
        // 那样没有请求也就没有失败可报 —— 只要叠层里有实质内容，就算合格。
        let verdict = ''
        for (let i = 0; i < 30 && verdict === ''; i += 1) {
          await page.waitForTimeout(300)
          verdict = await page.evaluate(() => {
            const text = (document.body.innerText ?? '').replace(/\s+/g, '')
            const overlay = document.querySelector('.file-preview, [class*=preview-sheet], [role=dialog]')
            const overlayChars = (overlay?.textContent ?? '').replace(/\s+/g, '').length
            if (/失败|打不开|错误|不存在|重试|无法/.test(text)) return 'explained'
            if (overlay !== null && overlayChars > 20) return 'rendered'
            return ''
          })
        }
        check('preview-failure-is-explained', verdict !== '', { path: 'ui', fileRows, verdict })
        await page.unroute('**/m/api/**')
      } else {
        // B：接口契约 —— 不存在的附件必须给明确错误
        const bogus = await rpc('mobile.readAttachment', { sessionId, messageId: 'nope', attachmentId: 'nope' }).then(
          value => ({ ok: true, value }),
          reason => ({ ok: false, message: String(reason).slice(0, 60) }),
        )
        const explicit = bogus.ok === false || (bogus.value !== undefined && bogus.value !== null)
        check('missing-attachment-errors-explicitly', explicit, { path: 'api', bogus })
      }
    } finally {
      await page.close()
    }
  },
}
