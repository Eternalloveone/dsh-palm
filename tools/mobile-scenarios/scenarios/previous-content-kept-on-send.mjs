/**
 * S29 上一轮的内容不许因为"我又发了一条"而倒退（manual）。
 *
 * 守的格子：J4×I3（单调：已出现的内容不倒退、不消失，然后才允许追加）。
 *
 * 用户场景：看完上一轮的回答/交付卡，接着问下一句 —— 上一轮的东西**必须还在原地**。
 * 2026-11-01 真机就出过这个毛病：一发消息，上一轮的交付卡闪没了（1→0→1）。
 *
 * 采用"两轮法"，不依赖会话里事先有什么：
 *   第一轮发出并等它收工 → 记下行数/卡片数/文本量作为基线；
 *   第二轮发出 → 采样 3 秒，**任何一项都不许低于基线**。
 */
import { chatUrl, rpc, waitUntilIdle } from '../lib/env.mjs'

export const scenario = {
  id: 'previous-content-kept-on-send',
  needsTurn: true,
  manual: true,
  title: '发新消息时上一轮的行/卡不许消失',
  async run(ctx) {
    const { context, check, testSessionId } = ctx
    check('test-session-provided', testSessionId !== undefined, { testSessionId })
    if (testSessionId === undefined) return

    const page = await context.newPage()
    try {
      await page.goto(chatUrl(testSessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      /** 只数"这一轮画出来的行"，不含骨架/空态。 */
      const sample = () => page.evaluate(() => ({
        rows: document.querySelectorAll('[data-message-id]').length,
        cards: document.querySelectorAll('.chat-turn-tail').length,
        chars: (document.body.innerText ?? '').replace(/\s+/g, '').length,
      }))

      // 第一轮：走 RPC 起一轮（带交付物，好让卡片出现），等收工
      await rpc('session.prompt', {
        sessionId: testSessionId,
        content: [{ type: 'text', text: '[palm-e2e] 用 write 工具创建 palm-e2e-mono.txt（内容 ok），然后回一句"好了"。' }],
      })
      await waitUntilIdle(testSessionId, 240_000).catch(() => undefined)
      // **不 reload**：页面自己会通过对账把这一轮补上来；reload 反而会丢掉会话上下文
      // （实测 reload 后停在列表页，行数永远是 0）。
      for (let i = 0; i < 120; i += 1) {
        await page.waitForTimeout(250)
        const snap = await sample()
        if (snap.rows > 0) break
      }

      const before = await sample()
      check('has-content-before-second-send', before.rows > 0, before)
      if (before.rows === 0) return

      // 第二轮：在页面上走真实输入发送，同时逐秒采样
      const input = page.locator('textarea, [contenteditable=true]').first()
      await input.click()
      await input.fill(`[palm-e2e] 收尾确认 ${Date.now() % 100000}：只回"收到"。`)
      await page.waitForTimeout(300)
      await page.keyboard.press('Enter')

      let minRows = before.rows
      let minCards = before.cards
      let minChars = before.chars
      for (let i = 0; i < 10; i += 1) {
        await page.waitForTimeout(300)
        const now = await sample()
        minRows = Math.min(minRows, now.rows)
        minCards = Math.min(minCards, now.cards)
        minChars = Math.min(minChars, now.chars)
      }

      // **跑着的时候不许出现新的交付卡**（真机 2026-11-01：会话还没结束就冒出交付卡）。
      // 判据：第二轮还在跑（页面显示"输出中"）时，卡片数不许比发送前多。
      const runningSample = await page.evaluate(() => ({
        running: /输出中/.test(document.body.innerText ?? ''),
        cards: document.querySelectorAll('.chat-turn-tail').length,
      }))
      if (runningSample.running) {
        check('no-new-card-while-running', runningSample.cards <= before.cards, {
          before: before.cards,
          whileRunning: runningSample.cards,
        })
      } else {
        check('no-new-card-while-running-skip', true, { note: '采样时这一轮已经收工，跳过' })
      }

      check('rows-never-shrink-on-send', minRows >= before.rows, { before: before.rows, minRows })
      check('cards-never-shrink-on-send', minCards >= before.cards, { before: before.cards, minCards })
      // 文本量允许因为"过程条收起"小幅波动，但不该腰斩（那是整段被重画掉了）
      check('body-text-not-wiped', minChars >= Math.floor(before.chars * 0.8), {
        before: before.chars,
        minChars,
      })

      await waitUntilIdle(testSessionId, 180_000).catch(() => undefined)
    } finally {
      await page.close()
    }
  },
}
