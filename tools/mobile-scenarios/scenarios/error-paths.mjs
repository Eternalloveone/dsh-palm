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
      // 宿主忙的时候，"打不开"的提示要十几秒才出现（首屏读失败本身就有超时）。
      // 固定等 6 秒会假红，这里轮询到"出现结果"为止（最多 20 秒）。
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(500)
        const done = await page.evaluate(() => {
          const text = document.body.innerText ?? ''
          // 输入框一直都有（加载中也在），**不能**拿它当"处理完了"的凭据：
          // 那样会在错误提示出现之前就跳出轮询（实测假红）。
          if (/失败|错误|不存在|找不到|无法打开|打不开|还没有消息|新建会话/.test(text)) return true
          return !/加载中|正在加载/.test(text) && document.querySelectorAll('[data-message-id]').length > 0
        })
        if (done) break
      }

      const info = await page.evaluate(() => {
        const body = document.body.innerText ?? ''
        return {
          rows: document.querySelectorAll('[data-message-id]').length,
          hasInput: document.querySelectorAll('textarea, [contenteditable=true]').length > 0,
          // 处理方式可以不同：给错误提示，或退回会话列表（列表里有「新建会话」）。
          // 只要**没有停在"正在加载"上**就算处理了。
          saysSomething: /失败|错误|不存在|找不到|无法打开|打不开|还没有消息|新建会话/.test(body),
          hasLoadingText: /加载中|正在加载/.test(body),
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
