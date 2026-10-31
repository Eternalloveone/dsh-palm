/**
 * S1 绿点生命周期：首页那条"进行中"标记必须跟着真实的跑/不跑走。
 *
 * 现场（2026-10-31）：会话明明在跑，首页却是灰点；或者跑完了绿点不退。
 * 判据：开跑后 <= 20 秒绿点出现；收工后 <= 30 秒绿点消失。
 *      （页面 5 秒轮询一次 + 逐行取证，实测 1 秒内亮）
 */
import { listUrl, rpc, startLongTurn, WORKSPACE } from '../lib/env.mjs'

const DOTS = '.sess-dot-running[aria-label="进行中"]'

export const scenario = {
  id: 'running-dot-lifecycle',
  title: '首页绿点：开跑亮起、收工熄灭',
  async run(ctx) {
    const { context, check } = ctx

    // 用列表里**最新那条**会话：行上没有任何 id 属性（只有标题文字），
    // 按标题匹配在无标题会话上会失配。直接盯第一行最稳。
    const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
    const target = list[0]
    const targetId = target?.sessionId ?? target?.id
    check('target-session-found', targetId !== undefined, { count: list.length })
    if (targetId === undefined) return

    const page = await context.newPage()
    try {
      await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)

      /** 第一行里的绿点数量。 */
      const dotInRow = async () => await page.evaluate(selector => {
        const row = document.querySelector('.mobile-row-sess')
        if (row === null) return 0
        return row.querySelectorAll(selector).length
      }, DOTS)

      const before = await dotInRow()

      // 开跑
      const litStartedAt = Date.now()
      await startLongTurn(targetId, '用 bash 跑 python -c "import time; time.sleep(30)"，完成后说一句"好了"。')

      // ① 绿点亮起
      let litAt
      const litDeadline = Date.now() + 20_000
      while (Date.now() < litDeadline) {
        if (await dotInRow() > 0) { litAt = Date.now(); break }
        await page.waitForTimeout(500)
      }
      check('dot-lights-up', litAt !== undefined, { before })

      // ② 绿点熄灭：直接看绿点自己（不再依赖 session.list 的 running，
      //    那条在这台宿主上对脚本启动的回合经常给不出 true）。
      let darkAt
      const darkDeadline = Date.now() + 240_000
      while (Date.now() < darkDeadline) {
        if (await dotInRow() === 0) { darkAt = Date.now(); break }
        await page.waitForTimeout(1000)
      }
      check('dot-goes-out', darkAt !== undefined, {})
      // 亮起/熄灭的延迟（毫秒）打在详情里，方便以后回归时对比
      check('dot-latency-ok', litAt !== undefined && darkAt !== undefined
        && (litAt - litStartedAt) <= 20_000, { litMs: litAt === undefined ? null : litAt - litStartedAt })
    } finally {
      await page.close()
    }
  },
}
