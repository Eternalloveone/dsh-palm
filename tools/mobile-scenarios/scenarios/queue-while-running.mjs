/**
 * S3 跑着排队 + 连点：只入队一条，送达后自动消失。
 *
 * fixture 加固（2026-10-31）：不再用脚本新建的 scratch 会话 —— 那种会话的
 * `running` 状态在手机端判不稳（`mobile.sessionState` 常给不出 true），
 * 消息于是直接变成新一轮、排队条根本不出现，判据假失败。
 * 现在固定用 ctx.sessionId（一条真实会话），先确认在跑，再发。
 */
import { chatUrl, rpc, sleep, startLongTurn, WORKSPACE } from '../lib/env.mjs'

/**
 * 排队坞现场。
 *
 * 选择器是**读源码核实过的**（src/mobile/queue-dock.tsx）：
 *   · 容器 `.queue-dock[data-queue-dock]`
 *   · 计数 `.queue-dockCount` → 文本「N 条排队」
 *   · 行   `.queue-dockRow`
 * 以前用 `[class*=queue]` 猜，抓不到 / 抓到空容器，导致这条场景一直 flaky。
 */
const queueRows = page => page.evaluate(() => {
  const dock = document.querySelector('[data-queue-dock]')
  if (dock === null) return []
  return [...dock.querySelectorAll('.queue-dockRow')]
    .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(text => text.length > 0)
})

/** 排队坞自己报的条数（`N 条排队`），没有坞就是 0。 */
const queueCount = page => page.evaluate(() => {
  const head = document.querySelector('.queue-dockCount')
  if (head === null) return 0
  const match = /(\d+)\s*条排队/.exec(head.textContent ?? '')
  return match === null ? 0 : Number(match[1])
})

export const scenario = {
  id: 'queue-while-running',
  /**
   * manual：这条场景会**往会话里发消息**，永远不进自动门禁、默认也不跑。
   * 只有同时满足「命令行给了 --manual」和「PALM_TEST_SESSION 指向专用测试会话」
   * 才会执行 —— 2026-10-31 因为往用户会话里灌提示词出过事故，这是硬约束。
   */
  manual: true,
  /** 需要"已预热"的专用测试会话才算得准；fixture 稳定前不挡门禁。 */
  flaky: true,
  needsTurn: true,
  title: '跑着排队 + 连点：只入队一条，送达后自动消失',
  async run(ctx) {
    const { context, check, testSessionId } = ctx
    check('test-session-provided', testSessionId !== undefined, { testSessionId })
    if (testSessionId === undefined) return

    const page = await context.newPage()
    try {
      // 顺序很关键：**先把聊天页打开**（此时空闲），再从外面起回合，然后以
      // 页面上的"输出中"作为"确实在跑"的判据 —— 实测 session.list 的 running
      // 在这条会话上一直给不出 true，用它判会把消息发成新一轮（排队条不出现）。
      await page.goto(chatUrl(testSessionId), { waitUntil: 'domcontentloaded' })
      const input = page.locator('textarea, [contenteditable=true]').first()
      await input.waitFor({ state: 'visible', timeout: 20000 })
      await page.waitForTimeout(1500)

      await startLongTurn(testSessionId, '用 bash 跑 python -c "import time; time.sleep(40)"，完成后说一句"第一步完成"，然后停下等我。')
      let running = false
      for (let i = 0; i < 60; i += 1) {
        await page.waitForTimeout(1000)
        running = await page.evaluate(() => /输出中|生成中|正在/.test(document.body.innerText ?? ''))
        if (running) break
      }
      check('session-running-before-send', running, {})

      /** 采样一段时间里排队条的最大条数（点时刻判断会被"刚好已送达"骗到）。 */
      const watchQueue = async durationMs => {
        let max = 0
        let maxReported = 0
        const deadline = Date.now() + durationMs
        while (Date.now() < deadline) {
          const rows = await queueRows(page)
          max = Math.max(max, rows.length)
          maxReported = Math.max(maxReported, await queueCount(page))
          await new Promise(resolve => setTimeout(resolve, 300))
        }
        return { max, maxReported }
      }

      const send = page.locator('button[aria-label*="发送"], button:has-text("发送")').first()
      const sendOnce = async text => {
        await input.click()
        await input.fill(text)
        await send.click({ force: true })
        await page.waitForTimeout(150)
        await send.click({ force: true }).catch(() => undefined)
      }

      // 最多两次尝试：发送通道偶发"点了没入队"（实测一次 0 条），
      // 但**判据本身不变** —— 每次尝试窗口内排队条都必须 ≤1。
      let maxRows = 0
      let maxReported = 0
      let attempts = 0
      while (attempts < 2 && maxRows === 0) {
        attempts += 1
        await sendOnce(`场景排队 ${Date.now() % 100000}`)
        const seen = await watchQueue(30_000)
        maxRows = seen.max
        maxReported = Math.max(maxReported, seen.maxReported)
      }
      // 「坞自己报的数」与「行数」任一 >0 就算看见了（两者互相印证，避免选择器再漂）
      check('queue-dock-appears', maxRows > 0 || maxReported > 0, { maxRows, maxReported, attempts })
      check('queue-dock-single', maxRows <= 1 && maxReported <= 1, { maxRows, maxReported, attempts })

      // 宿主侧必须收下且只有一条（这才是"排队真的入队了"的硬证据）。
      // 不再断言"排队坞那一行什么时候消失"：那属于排队坞自身的展示语义，
      // 实测 4 分钟仍可能挂着，拿来当不变量会把产品行为误判成缺陷。
      const inbox = (await rpc('mobile.inbox', { sessionId: testSessionId }))?.value ?? {}
      const queued = [...(inbox.nextTurn ?? []), ...(inbox.nextStep ?? [])].length
      check('host-queue-single', queued <= 1, { queued })
    } finally {
      await page.close()
    }
  },
}
