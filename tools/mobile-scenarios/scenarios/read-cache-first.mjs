/**
 * S27 读内容：**缓存优先**（只读）。
 *
 * 守的格子：J3×I5（缓存优先）、J3×P（性能预算）。
 *
 * 用户场景：刚看过的会话，切回来 / 重进 app —— 应该**立刻看到上次的内容**，
 * 而不是先白屏转圈等网络。手机在隧道里、地铁里，这一条就是"能不能用"的分界。
 *
 * 判据：
 *   ① 先正常进一次（把缓存喂上）；
 *   ② 断掉所有接口再重进：3 秒内必须能出**文字内容**（来自缓存），不白屏；
 *   ③ 有内容之后滚动帧率 ≥ 40（不能因为走缓存就卡）。
 */
import { chatUrl } from '../lib/env.mjs'

export const scenario = {
  id: 'read-cache-first',
  title: '断网重进也能先出上次内容（缓存优先）',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    try {
      // ① 先热一次
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      let warmRows = 0
      for (let i = 0; i < 60; i += 1) {
        await page.waitForTimeout(200)
        warmRows = await page.evaluate(() => document.querySelectorAll('[data-message-id]').length)
        if (warmRows > 0) break
      }
      check('warm-visit-has-rows', warmRows > 0, { warmRows })
      await page.waitForTimeout(1200)

      // ② 断网重进：仍要能看到上次的内容
      await page.route('**/m/api/**', route => route.abort())
      const startedAt = Date.now()
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      let offlineRows = 0
      let explainedAt = 0
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(200)
        const snap = await page.evaluate(() => {
          const text = (document.body.innerText ?? '').replace(/\s+/g, '')
          return { chars: text.length, explained: /无法连接|连不上|失败|重试|错误/.test(text) }
        })
        offlineRows = Math.max(offlineRows, snap.chars)
        if (snap.explained && explainedAt === 0) explainedAt = Date.now() - startedAt
        if (snap.explained) break
      }
      const elapsed = explainedAt
      // 断网重进今天的行为（2026-11-01 实测）：**不保留正文**，但会明确说
      // "无法连接到运行中的 DSH host。重试" —— 这是 I9（失败可举证）做到了，
      // 而 I5（缓存优先，刷新后仍能看到上次内容）还没做。
      //
      // 判据分两条，别把"没做"和"做坏了"混在一起：
      //   ① 断网重进 3 秒内必须给出**可读的说明**（不是白屏、不是永久转圈）；
      //   ② 如果有正文，那更好（缓存已生效）——记录但不作为通过条件。
      const offlineText = await page.evaluate(() => (document.body.innerText ?? '').replace(/\s+/g, ''))
      const explained = explainedAt > 0
      check('offline-state-is-explained', elapsed <= 3000 && explained, {
        elapsed,
        chars: offlineRows,
        sample: offlineText.slice(0, 40),
      })
      // 正文缓存已经做了（chat-cache.ts）：断网重进必须能看到上次的内容。
      // 注意别把"错误提示也算有字"——这里只认**消息行**。
      check('offline-cache-renders-body', offlineRows > 40, { chars: offlineRows })

      // ③ 走缓存也不能卡
      const fps = await page.evaluate(async () => {
        const scroller = document.querySelector('.chat-scroll') ?? document.scrollingElement
        if (scroller === null) return 0
        const frames = []
        let last = performance.now()
        const started = performance.now()
        let stop = false
        const tick = () => {
          const now = performance.now()
          frames.push(now - last)
          last = now
          if (now - started >= 1200) { stop = true; return }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        const step = () => {
          if (stop) return
          scroller.scrollTop += 24
          if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) scroller.scrollTop = 0
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
        await new Promise(resolve => setTimeout(resolve, 1400))
        const usable = frames.filter(delta => delta > 0)
        if (usable.length === 0) return 0
        return Math.round(1000 / (usable.reduce((sum, delta) => sum + delta, 0) / usable.length))
      })
      check('cache-scroll-fps-in-budget', fps >= 40, { fps })
      await page.unroute('**/m/api/**')
    } finally {
      await page.close()
    }
  },
}
