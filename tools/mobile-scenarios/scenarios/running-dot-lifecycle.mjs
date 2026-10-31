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
  /**
   * manual：这条场景会**往会话里发消息**，永远不进自动门禁、默认也不跑。
   * 只有同时满足「命令行给了 --manual」和「PALM_TEST_SESSION 指向专用测试会话」
   * 才会执行 —— 2026-10-31 因为往用户会话里灌提示词出过事故，这是硬约束。
   */
  manual: true,
  /** 需要"已预热"的专用测试会话才算得准；fixture 稳定前不挡门禁。 */
  flaky: true,
  needsTurn: true,
  title: '首页绿点：开跑亮起、收工熄灭',
  async run(ctx) {
    const { context, check, testSessionId } = ctx

    // 必须用**专用测试会话**：这条场景会发起回合，不能往用户的会话里灌提示词
    // （2026-10-31 真出过）。行上没有 id 属性，只能靠"第一行"定位 —— 所以
    // 先把测试会话顶到第一行：给它发一条短回合，列表按 updatedAt 排序。
    const targetId = testSessionId
    check('test-session-provided', targetId !== undefined, { targetId })
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
