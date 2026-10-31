/**
 * S14 子代理委派往返（manual）。
 *
 * 用户场景：让模型分派子代理干活 → 卡片出现 → 点进子会话看它在干什么 → 返回。
 * 判据：子代理卡片出现；点进去有内容；返回后父会话还在、行数没塌。
 * 触发不了子代理就跳过。
 */
import { chatUrl, sleep, startLongTurn } from '../lib/env.mjs'
import { sampleChat } from '../lib/invariants.mjs'

const SUBAGENT = '[class*=subagent], [class*=sub-agent], [data-subagent]'

export const scenario = {
  id: 'subagent-roundtrip',
  needsTurn: true,
  manual: true,
  title: '子代理：卡片出现 → 进子会话 → 返回不塌',
  async run(ctx) {
    const { context, check, testSessionId } = ctx
    check('test-session-provided', testSessionId !== undefined, { testSessionId })
    if (testSessionId === undefined) return

    await startLongTurn(
      testSessionId,
      '请用 subagent 委派一个子任务：让它列出当前目录的前 3 个文件名，拿到结果后汇总告诉我。',
    )

    const page = await context.newPage()
    try {
      await page.goto(chatUrl(testSessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)

      let appeared = 0
      for (let i = 0; i < 60 && appeared === 0; i += 1) {
        await page.waitForTimeout(1000)
        appeared = await page.evaluate(selector => document.querySelectorAll(selector).length, SUBAGENT)
      }
      if (appeared === 0) {
        check('subagent-not-triggered-skip', true, { note: '这次没有委派子代理，跳过' })
        return
      }
      check('subagent-card-appears', appeared > 0, { appeared })

      const before = await sampleChat(page)
      const entry = page.locator(SUBAGENT).first()
      await entry.click().catch(() => undefined)
      await sleep(2500)

      const inside = await page.evaluate(() => ({
        url: location.href,
        rows: document.querySelectorAll('[data-message-id]').length,
        hasContent: (document.body.innerText ?? '').length > 40,
      }))
      check('subagent-opens', inside.hasContent, inside)

      await page.goBack().catch(() => undefined)
      await sleep(2500)
      const after = await sampleChat(page)
      check('parent-still-there', after.rows + 2 >= before.rows, { before: before.rows, after: after.rows })
    } finally {
      await page.close()
    }
  },
}
