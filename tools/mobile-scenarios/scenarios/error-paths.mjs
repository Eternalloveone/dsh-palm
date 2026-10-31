/**
 * S12 错误路径（只读）。
 *
 * 用户场景：点了被删掉的会话、链接失效、宿主报错。
 * 判据：给出明确提示（不是白屏、不是永远骨架）；随后进正常会话仍然正常。
 */
import { chatUrl } from '../lib/env.mjs'
import { sampleChat } from '../lib/invariants.mjs'

export const scenario = {
  id: 'error-paths',
  title: '打不开的会话要明说，不白屏不转圈',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    try {
      // ① 不存在的会话 id
      await page.goto(chatUrl('session-00000000-0000-4000-8000-000000000000'), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(6000)

      const info = await page.evaluate(() => {
        const body = document.body.innerText ?? ''
        return {
          rows: document.querySelectorAll('[data-message-id]').length,
          hasInput: document.querySelectorAll('textarea, [contenteditable=true]').length > 0,
          saysSomething: /失败|错误|不存在|找不到|无法打开|错误/.test(body),
          hasLoadingText: /加载中/.test(body),
          text: body.replace(/\s+/g, ' ').slice(0, 80),
        }
      })
      // 要么给出错误提示，要么至少保留可交互输入区 —— 不能既没内容又没提示还一直"加载中"
      check('error-surfaced', info.saysSomething || info.hasInput, info)
      check('not-stuck-loading-forever', !(info.rows === 0 && info.hasLoadingText && !info.saysSomething), info)

      // ② 回到正常会话：不能因为一次失败就坏掉
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      let rows = 0
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(300)
        const snap = await sampleChat(page)
        rows = snap.rows
        if (rows > 0) break
      }
      check('recovers-on-valid-session', rows > 0, { rows })
    } finally {
      await page.close()
    }
  },
}
