/**
 * S20 回合状态与交付卡：以宿主结论为准（只读）。
 *
 * 用户场景：别的页面上这一轮在跑 / 已经跑完，手机上的"运行态"和「本轮产出」
 * 必须和宿主说的一致 —— 不许自己猜。
 *
 * 运行态的读法（2026-11-08 起）：底部那条「输出中／连接中断」状态行已经删掉，
 * 现在只认输入区主键 —— 在跑时它的 aria-label 是「停止」，否则是「发送／排队发送」。
 *
 * 判据（都拿宿主 `mobile.turnState` 当唯一事实）：
 *   ① 宿主说没在跑 → 输入区不许停在「停止」；
 *   ② 宿主说没在跑 → 交付卡可以出现；宿主说在跑 → 最新那轮的交付卡不许出现；
 *   ③ 页面不许自作主张显示「连接中断」/「输出中」这类文案。
 */
import { chatUrl, rpc } from '../lib/env.mjs'

const hostVerdict = async sessionId => {
  const reply = await rpc('mobile.turnState', { sessionId })
  const value = reply?.value ?? reply
  return { running: value?.running === true, seq: value?.seq }
}

export const scenario = {
  id: 'turn-state-authoritative',
  title: '回合状态/交付卡与宿主结论一致',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(250)
        if (await page.evaluate(() => document.querySelectorAll('[data-message-id]').length > 0)) break
      }
      // 给对账一拍时间（首帧之后才是宿主的结论）
      await page.waitForTimeout(2500)

      const host = await hostVerdict(sessionId)
      const dom = await page.evaluate(() => ({
        // 在跑 = 输入区主键是「停止」（唯一剩下的运行态开关）。
        running: document.querySelector('[aria-label="停止"]') !== null,
        // 旧状态行的两句话都不许再出现在正文里。
        staleWording: [...document.querySelectorAll('.chat-msg, .chat-rows')]
          .some(node => /输出中|连接中断/.test(node.textContent ?? '')),
        cards: [...document.querySelectorAll('.chat-turn-tail')].map(el => (el.textContent ?? '').slice(0, 40)),
        hasProcess: document.querySelectorAll('.chat-proc, .chat-proc-current').length > 0,
      }))

      check('host-verdict-known', typeof host.running === 'boolean', host)
      // ① 宿主说没在跑，输入区就不该停在「停止」
      if (!host.running) {
        check('no-running-ui-when-host-idle', dom.running === false, dom)
      }
      // ③ 宿主可达时不该出现「输出中」/「连接中断」这类文案
      check('no-stale-wording', dom.staleWording === false, dom)
      // ② 在跑时**不许再多出一张卡**：屏幕上可能已经有前几轮的卡（那是应该看到的），
      //    但最新这一轮在跑的时候不能冒出新卡 —— 这正是用户反馈的问题。
      if (host.running) {
        const before = dom.cards.length
        await page.waitForTimeout(4000)
        const after = await page.evaluate(() => document.querySelectorAll('.chat-turn-tail').length)
        check('no-new-card-while-running', after <= before, { before, after })
      }
    } finally {
      await page.close()
    }
  },
}
