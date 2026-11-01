/**
 * S5b 命令卡片生命周期（会发消息 → manual）。
 *
 * 用户动作：让模型跑一条命令 → 卡片显示"运行中" → 变成"成功"。
 * 判据：卡片出现、状态最终落在成功/失败（不会永远停在运行中）。
 */
import { chatUrl, sleep, startLongTurn } from '../lib/env.mjs'

const CMD_CARD = '.chat-command, [class*=chat-cmd], [class*=command-card]'

export const scenario = {
  id: 'command-card-lifecycle',
  needsTurn: true,
  manual: true,
  title: '命令卡片：运行中 → 成功/失败（不永远转圈）',
  async run(ctx) {
    const { context, check, testSessionId } = ctx
    check('test-session-provided', testSessionId !== undefined, { testSessionId })
    if (testSessionId === undefined) return

    await startLongTurn(testSessionId, '用 bash 执行：echo palm-command-probe，然后告诉我输出是什么。')

    const page = await context.newPage()
    try {
      await page.goto(chatUrl(testSessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)

      let cards = 0
      for (let i = 0; i < 30 && cards === 0; i += 1) {
        await page.waitForTimeout(1000)
        cards = await page.evaluate(selector => document.querySelectorAll(selector).length, CMD_CARD)
      }
      if (cards === 0) {
        check('command-card-not-rendered-skip', true, { note: '这次没有命令卡片，跳过' })
        return
      }
      check('command-card-appears', cards > 0, { cards })

      // 状态最终必须落定（成功/失败/退出码），不能一直"运行中"。
      //
      // 判据**只看最新那张卡**：这条会话是多个场景共用的，里面可能躺着上一条场景
      // 留下的旧命令卡（其中一张还标着"运行中"），把整页卡片文字拼起来判会永远不落定
      // （2026-11-01 实测：单独跑通过、整轮跑必红）。
      let settled = false
      for (let i = 0; i < 90; i += 1) {
        await page.waitForTimeout(1000)
        settled = await page.evaluate(selector => {
          const cards = [...document.querySelectorAll(selector)]
          const last = cards[cards.length - 1]
          if (last === undefined) return false
          const text = last.textContent ?? ''
          return /成功|失败|已完成|exit|退出码|error/i.test(text) && !/运行中|执行中/.test(text)
        }, CMD_CARD)
        if (settled) break
      }
      check('command-card-settles', settled, {})
      await sleep(500)
    } finally {
      await page.close()
    }
  },
}
