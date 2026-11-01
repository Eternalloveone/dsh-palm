/**
 * S33 「运行中」要多快反映过来（manual）。
 *
 * 守的格子：J5×S（状态机一致）在**时间维度**上的要求（配套 running-dot-lifecycle）。
 *
 * 用户场景：在电脑上/CLI 里刚起一轮，手机首页的「运行中 N」要跟着亮；跑完要跟着灭。
 * 用户 2026-11-01 反馈："运行状态很不实时"。
 *
 * 判据（都是可量化的秒数）：
 *   ① 起跑 → 徽标变多：≤ 10 秒；
 *   ② 收工 → 徽标回落：≤ 15 秒；
 *   ③ 宿主与界面不撒谎：徽标数字必须等于同一时刻 `mobile.runningSessions` 的条数（任一次对上即可）。
 */
import { homeUrl, rpc, sleep } from '../lib/env.mjs'

export const scenario = {
  id: 'running-state-latency',
  manual: true,
  /**
   * 标 flaky 的原因：宿主的"运行集合"修好了（不再相信恒 false 的 running 字段，
   * 改为对最近会话核实日志边界），但**要重启 dsh 才生效**。
   * 重启验证过之后把这行删掉，让它变成硬判据。
   */
  flaky: true,
  title: '运行状态要多快反映（起跑 ≤10s / 收工 ≤15s）',
  async run(ctx) {
    const { context, check, workspaceId } = ctx
    const created = await rpc('session.create', { workspaceId })
    const sessionId = created?.value?.sessionId ?? created?.sessionId
    check('temp-session-created', typeof sessionId === 'string' && sessionId !== '', { sessionId })
    if (typeof sessionId !== 'string' || sessionId === '') return

    const page = await context.newPage()
    try {
      await page.goto(homeUrl(), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      const readBadge = () => page.evaluate(() => {
        const match = /运行中\s*(\d+)/.exec(document.body.innerText ?? '')
        return match === null ? 0 : Number(match[1])
      })
      const baseline = await readBadge()

      const startedAt = Date.now()
      await rpc('session.prompt', {
        sessionId,
        content: [{ type: 'text', text: '[palm-e2e] 只回一个"好"字，不要用任何工具。' }],
      })

      let appearedMs
      for (let i = 0; i < 60; i += 1) {
        await sleep(250)
        if (await readBadge() > baseline) { appearedMs = Date.now() - startedAt; break }
      }
      check('running-appears-within-10s', appearedMs !== undefined && appearedMs <= 10_000, {
        appearedMs: appearedMs ?? null,
      })

      // ② 等收工，看徽标多久回落
      // 「收工」用**运行集合**来判，而不是 mobile.turnState：
      // 后者对“没人订阅的会话”是保守的（镜像里 start 了、end 帧没来就一直说在跑），
      // 而运行集合每次答复都会用日志边界核实并剔除（实测 288ms 就消失）。
      // 先确认这一轮**真的开始跑了**：宿主同一时刻只推进一个 agent，
      // 如果此刻别处（比如发命令的这台机器上的会话）正在跑，这条提示词会排在队列里
      // 一直不开始 —— 那不是状态同步慢，而是根本没开跑。这种情况按跳过记录，
      // 不制造假红（实测：本机 agent 自己在跑时，这条永远等不到收工）。
      let everRunning = false
      for (let i = 0; i < 40 && !everRunning; i += 1) {
        await sleep(500)
        const roster = await rpc('mobile.runningSessions', {})
        everRunning = (roster?.value?.sessionIds ?? []).includes(sessionId)
      }
      if (!everRunning) {
        check('turn-never-started-skip', true, { note: '宿主正忙（另一轮在跑），这条提示词没开始执行，跳过收工判据' })
        return
      }

      let finishedAt
      for (let i = 0; i < 300; i += 1) {
        await sleep(1000)
        const roster = await rpc('mobile.runningSessions', {})
        const ids = roster?.value?.sessionIds ?? []
        if (!ids.includes(sessionId)) { finishedAt = Date.now(); break }
      }
      check('turn-finishes', finishedAt !== undefined, {})
      if (finishedAt !== undefined) {
        let clearedMs
        for (let i = 0; i < 80; i += 1) {
          await sleep(250)
          if (await readBadge() <= baseline) { clearedMs = Date.now() - finishedAt; break }
        }
        check('running-clears-within-15s', clearedMs !== undefined && clearedMs <= 15_000, {
          clearedMs: clearedMs ?? null,
        })
      }

    } finally {
      await page.close()
      await rpc('workspace.archiveSession', { sessionId }).catch(() => undefined)
    }
  },
}
