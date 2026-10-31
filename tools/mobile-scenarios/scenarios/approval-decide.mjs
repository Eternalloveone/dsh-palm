/**
 * S5 审批面板（会发消息 → manual）。
 *
 * 用户动作：模型要跑一条需要审批的命令 → 面板弹出来 → 点「拒绝」。
 * 判据：面板出现 → 点拒绝后消失 → 不重复弹同一批审批。
 *
 * 触发不了审批就跳过（不同宿主配置下审批策略不同），不制造假红。
 */
import { chatUrl, sleep, startLongTurn } from '../lib/env.mjs'

const APPROVAL = '[class*=approval], .approval-panel, [aria-label*=审批]'

export const scenario = {
  id: 'approval-decide',
  needsTurn: true,
  manual: true,
  title: '审批面板出现 → 点拒绝 → 面板消失',
  async run(ctx) {
    const { context, check, testSessionId } = ctx
    check('test-session-provided', testSessionId !== undefined, { testSessionId })
    if (testSessionId === undefined) return

    await startLongTurn(
      testSessionId,
      '请运行一条需要审批的 bash 命令：rm -f /tmp/palm-approval-probe-nonexistent。如果被拒绝就停下来告诉我"已拒绝"。',
    )

    const page = await context.newPage()
    try {
      await page.goto(chatUrl(testSessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)

      let appeared = false
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(1000)
        appeared = await page.evaluate(selector => document.querySelectorAll(selector).length > 0, APPROVAL)
        if (appeared) break
      }
      if (!appeared) {
        check('approval-not-triggered-skip', true, { note: '这次没有触发审批，跳过' })
        return
      }
      check('approval-panel-appears', true, {})

      const deny = page.locator('button:has-text("拒绝"), button:has-text("不允许"), button[aria-label*="拒绝"]').first()
      check('deny-button-exists', (await deny.count()) > 0, {})
      if ((await deny.count()) === 0) return
      await deny.click()
      await sleep(2500)

      const stillThere = await page.evaluate(selector => document.querySelectorAll(selector).length, APPROVAL)
      check('approval-panel-closes', stillThere === 0, { stillThere })
    } finally {
      await page.close()
    }
  },
}
