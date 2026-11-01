/**
 * S32 交付文件/图片的预览：点得开、打不开时要说清楚（只读）。
 *
 * 守的格子：J6×I9（结果与文件 × 失败可举证）。
 *
 * 用户场景：点开本轮交付的文件/图片 —— 它得**真的打开**；取不到时要说话，不能白屏。
 *
 * 2026-11-01 实测校准：
 *   · 点交付文件行确实会弹出预览层（`.file-preview` / `[role=dialog]` 从 0 变 1）；
 *   · 之前的假红是因为交付卡默认折叠、没先点开就给 0 行，且文字条件写错了。
 */
import { chatUrl } from '../lib/env.mjs'

const OVERLAY = '[role=dialog], .file-preview, [class*=preview-sheet]'

export const scenario = {
  id: 'file-preview-failure',
  title: '交付文件能点开；打不开时要说明白',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      for (let i = 0; i < 60; i += 1) {
        await page.waitForTimeout(250)
        if (await page.evaluate(() => document.querySelectorAll('[data-message-id]').length > 0)) break
      }
      await page.waitForTimeout(1200)

      // 交付卡默认折叠：先点开，才看得到文件行
      await page.evaluate(() => {
        for (const head of document.querySelectorAll('.chat-turn-tail-head[aria-expanded="false"]')) {
          head.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }
      })
      await page.waitForTimeout(600)

      const fileRows = await page.evaluate(() => document.querySelectorAll('.chat-turn-tail-file').length)
      if (fileRows === 0) {
        check('no-file-row-skip', true, { note: '这条会话没有交付文件行，跳过' })
        return
      }
      check('file-rows-present', fileRows > 0, { fileRows })

      // ① 正常点开：预览层必须出现（这是"文件真的能看"）
      await page.locator('.chat-turn-tail-file').first().click({ force: true }).catch(() => undefined)
      let opened = false
      for (let i = 0; i < 40 && !opened; i += 1) {
        await page.waitForTimeout(250)
        opened = await page.evaluate(sel => document.querySelectorAll(sel).length > 0, OVERLAY)
      }
      check('file-preview-opens', opened, {})
      if (!opened) return

      // 关掉预览，恢复现场
      await page.keyboard.press('Escape').catch(() => undefined)
      await page.waitForTimeout(600)

      // ② 取不到内容时：要么给出错误文案，要么预览层里有实质内容 —— **不许白屏**
      await page.route('**/m/api/**', async route => {
        if (/preview|attachment|blob|file/i.test(route.request().url())) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: '{"result":{"ok":false,"error":{"code":"internal","message":"boom"}}}' })
          return
        }
        await route.continue()
      })
      await page.locator('.chat-turn-tail-file').first().click({ force: true }).catch(() => undefined)
      let verdict = ''
      for (let i = 0; i < 40 && verdict === ''; i += 1) {
        await page.waitForTimeout(250)
        verdict = await page.evaluate(sel => {
          const text = (document.body.innerText ?? '').replace(/\s+/g, '')
          if (/失败|打不开|错误|不存在|重试|无法/.test(text)) return 'explained'
          const overlay = document.querySelector(sel)
          if (overlay !== null && (overlay.textContent ?? '').replace(/\s+/g, '').length > 20) return 'rendered'
          return ''
        }, OVERLAY)
      }
      check('preview-never-blank', verdict !== '', { verdict })
      await page.unroute('**/m/api/**')
    } finally {
      await page.close()
    }
  },
}
