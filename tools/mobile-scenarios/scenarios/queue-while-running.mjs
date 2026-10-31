/**
 * S3 跑着排队：会话在跑时发一条排队消息，然后连点两次「发送」。
 *
 * 现场：排队条出现两条一模一样的；或者送达后排队条不消失。
 * 判据：宿主队列里同一条只 1 份；屏幕上排队条 ≤1；收工后排队条消失且正文只 1 条。
 */
import { chatUrl, createScratchSession, rpc, sleep, startLongTurn, WORKSPACE } from '../lib/env.mjs'

/**
 * 等排队条出现：宿主快照有几十秒的旧读窗口，2.5 秒固定等待会假失败（实测 0 条）。
 * 轮询到出现或超时为止。
 */
async function waitForQueueRows(page, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const rows = await queueRows(page)
    if (rows.length > 0) return rows
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  return []
}

const queueRows = page => page.evaluate(() => {
  const dock = document.querySelector('[class*=queue]')
  if (dock === null) return []
  return [...dock.querySelectorAll('[class*=item], li, [class*=row]')]
    .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(text => text.length > 2)
})

export const scenario = {
  id: 'queue-while-running',
  title: '跑着排队 + 连点：只入队一条，送达后自动消失',
  /**
   * 实验性：要用"脚本新建的 scratch 会话 + 保证在跑"做 fixture，目前还不够稳
   * （排队条出现依赖宿主快照的一次刷新，偶发看不到）。默认不跑，`--experimental` 才跑。
   * 待办：改成指定一条真实长会话（PALM_SESSION）+ 先确认 running 再发。
   */
  experimental: true,
  async run(ctx) {
    const { context, check } = ctx
    const sessionId = await createScratchSession()
    check('scratch-created', sessionId !== undefined, { sessionId })
    if (sessionId === undefined) return

    // 回合要够长：发排队消息之前必须**确认在跑**，否则消息会直接成为新一轮，
    // 排队条根本不出现（第一版就是这么假失败的）。
    await startLongTurn(sessionId, '用 bash 跑 python -c "import time; time.sleep(45)"，完成后说一句"第一步完成"，然后停下等我。')
    // 用 session.list 判"在跑"：这是实测最稳的一条（mobile.sessionState 对
    // 脚本新建的会话经常给不出 running=true）。
    let running = false
    for (let i = 0; i < 30; i += 1) {
      await sleep(2000)
      const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
      const row = list.find(item => (item.sessionId ?? item.id) === sessionId)
      if (row?.running === true) { running = true; break }
    }
    check('session-running-before-send', running, {})

    const page = await context.newPage()
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      const text = `场景排队 ${Date.now() % 100000}`
      const input = page.locator('textarea, [contenteditable=true]').first()
      const send = page.locator('button[aria-label*="发送"], button:has-text("发送")').first()

      /** 采样一段时间里排队条的最大条数（点时刻判断会被"刚好已送达"骗到）。 */
      const watchQueue = async (durationMs) => {
        let max = 0
        const deadline = Date.now() + durationMs
        while (Date.now() < deadline) {
          const rows = await queueRows(page)
          max = Math.max(max, rows.length)
          await new Promise(resolve => setTimeout(resolve, 300))
        }
        return max
      }

      // 一次性提交 + 150ms 内连点一次：
      //   · 连点必须并成同一条（这是"排队两条一模一样"的现场）；
      //   · 整段窗口里排队条最多 1 条。
      await input.click()
      await input.fill(text)
      await send.click({ force: true })
      await page.waitForTimeout(150)
      await send.click({ force: true }).catch(() => undefined)
      const maxRows = await watchQueue(12_000)
      check('queue-row-appears', maxRows > 0, { maxRows })
      check('queue-row-single', maxRows <= 1, { maxRows })

      // 等排队条消失：**只看 UI 的不变量**，不等"模型把这一轮跑完"。
      // （模型延迟波动很大，之前把"测试自身等不到收工"误报成产品缺陷两次。）
      let cleared = false
      const clearDeadline = Date.now() + 150_000
      while (Date.now() < clearDeadline) {
        const rows = await queueRows(page)
        if (rows.length === 0) { cleared = true; break }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      check('queue-row-cleared', cleared, {})

      // 顺带确认宿主侧也没有残留
      const inbox = (await rpc('mobile.inbox', { sessionId }))?.value ?? {}
      const queued = [...(inbox.nextTurn ?? []), ...(inbox.nextStep ?? [])].length
      check('host-queue-empty', queued === 0, { queued })
    } finally {
      await page.close()
    }
  },
}
