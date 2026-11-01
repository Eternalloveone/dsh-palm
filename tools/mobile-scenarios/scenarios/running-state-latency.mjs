/**
 * S33 「运行中」页面的状态要多快反映（manual）。
 *
 * 守的格子：J5×S（状态机一致）在**时间维度**上的要求（配套 running-dot-lifecycle）。
 *
 * 用户场景（2026-11-01 真机）：在电脑上刚起一轮，手机点开「运行中」要能看到它；
 * 跑完要跟着消失 —— 用户当时看到的是「5 条早就结束的会话一直挂着运行中」。
 *
 * 判据：
 *   ① 起跑 → 条数 +1：≤ 10 秒；
 *   ② 收工 → 回基线：≤ 15 秒；
 *   ③ 再等 10 秒不许回来（残留）。
 */
import { homeUrl, rpc, sleep } from '../lib/env.mjs'

export const scenario = {
  id: 'running-state-latency',
  manual: true,
  title: '运行中页面：起跑 ≤10s 出现、收工 ≤15s 消失',
  async run(ctx) {
    const { context, check, workspaceId } = ctx
    const created = await rpc('session.create', { workspaceId })
    const sessionId = created?.value?.sessionId ?? created?.sessionId
    check('temp-session-created', typeof sessionId === 'string' && sessionId !== '', { sessionId })
    if (typeof sessionId !== 'string' || sessionId === '') return

    const page = await context.newPage()
    try {
      // ① 进「运行中」页：首页点那颗「运行中 N」入口
      await page.goto(homeUrl(), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      const chip = page.locator(':text-matches("运行中")').first()
      await chip.click({ force: true }).catch(() => undefined)
      await page.waitForTimeout(2500)

      /** 「正在运行 N 个会话」里的 N；读不到就退化成数行。 */
      const runningCount = () => page.evaluate(() => {
        const match = /正在运行\s*(\d+)\s*个会话/.exec(document.body.innerText ?? '')
        if (match !== null) return Number(match[1])
        return document.querySelectorAll('.run-row, [class*=run-row], [class*=runoverview-row]').length
      })
      const baseline = await runningCount()
      const opened = await page.evaluate(() => /运行中|正在运行/.test(document.body.innerText ?? ''))
      check('run-overview-opened', opened, { baseline })

      // ② 起跑 → 条数 +1
      const startedAt = Date.now()
      await rpc('session.prompt', {
        sessionId,
        content: [{ type: 'text', text: '[palm-e2e] 只回一个"好"字，不要用任何工具。' }],
      })
      let appearedMs
      for (let i = 0; i < 40; i += 1) {
        await sleep(250)
        if (await runningCount() > baseline) { appearedMs = Date.now() - startedAt; break }
      }
      check('running-appears-within-10s', appearedMs !== undefined && appearedMs <= 10_000, { appearedMs: appearedMs ?? null })

      // ③ 等收工（用宿主运行集合判，和页面同源）
      let finishedAt
      for (let i = 0; i < 300; i += 1) {
        await sleep(1000)
        const roster = await rpc('mobile.runningSessions', {})
        if (!(roster?.value?.sessionIds ?? []).includes(sessionId)) { finishedAt = Date.now(); break }
      }
      check('turn-finishes', finishedAt !== undefined, {})
      if (finishedAt === undefined) return

      let clearedMs
      for (let i = 0; i < 60; i += 1) {
        await sleep(250)
        if (await runningCount() <= baseline) { clearedMs = Date.now() - finishedAt; break }
      }
      check('running-clears-within-15s', clearedMs !== undefined && clearedMs <= 15_000, { clearedMs: clearedMs ?? null })

      // ④ 再等 10 秒不许回来
      await sleep(10_000)
      const after = await runningCount()
      check('stays-cleared-after-10s', after <= baseline, { after, baseline })
    } finally {
      await page.close()
      await rpc('workspace.archiveSession', { sessionId }).catch(() => undefined)
    }
  },
}
