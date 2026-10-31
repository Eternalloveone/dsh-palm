/**
 * S8 离线发消息 → 恢复后只送达一次。
 *
 * 现场：断网时发的消息，恢复后重复发送（两条一样的）；或者恢复后永远发不出去。
 * 判据：离线时消息进本地队列（不报错崩溃）；恢复后正文里出现且只出现一次。
 */
import { chatUrl, createScratchSession, rpc, sleep } from '../lib/env.mjs'

export const scenario = {
  id: 'offline-queue-drain',
  title: '断网发消息 → 恢复后只送达一次',
  /**
   * 实验性：fixture 还没稳。
   *
   * 试过两种"断网"：
   *   ① context.setOffline(true) —— 页面本身由开发服务器提供，整段断网后 JS/CSS
   *      也拉不到，输入框根本渲染不出来（两次 30s 超时）；
   *   ② 只掐 m/api 这条通道 —— 页面活着，但对**脚本新建的会话**而言，聊天页要靠 API
   *      才能进到"可输入"状态，掐掉之后重载进不去。
   *
   * 正解（待做）：先用一条**已有内容**的会话把页面加载完整，再只拦
   * `session.prompt` + `mobile.*` 三条通道，模拟"宿主刚好不可达"。
   */
  experimental: true,
  async run(ctx) {
    const { context, check } = ctx
    const sessionId = await createScratchSession()
    check('scratch-created', sessionId !== undefined, { sessionId })
    if (sessionId === undefined) return

    const page = await context.newPage()
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)

      const text = `离线重发 ${Date.now() % 100000}`
      // 注意：不能用 context.setOffline——页面本身是开发服务器提供的，整段断网会
      // 让 JS/CSS 请求也失败，输入框根本渲染不出来（实测两次 30s 超时）。
      // 这里只掐 **API 通道**（/m/api/**），等价于"宿主不可达"，页面照常活着。
      const offline = route => route.abort('failed')
      await page.route('**/m/api/**', offline)
      // 断网后页面可能正在重连/重载，输入框偶尔会暂时消失（实测 fill 30s 超时）。
      // 等它出现；仍不在就重新进一次（此时已经离线，正好测"离线也能打开"）。
      const input = page.locator('textarea, [contenteditable=true]').first()
      try {
        await input.waitFor({ state: 'visible', timeout: 8000 })
      } catch {
        await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
        await input.waitFor({ state: 'visible', timeout: 15000 })
      }
      await input.fill(text)
      await page.locator('button[aria-label*="发送"], button:has-text("发送")').first().click({ force: true })
      await page.waitForTimeout(2000)

      // 离线期间：界面要给出"断网/待发"的反馈，而不是静默失败
      const offlineHint = await page.evaluate(() => /网络已断开|将在恢复后发送|离线/.test(document.body.innerText ?? ''))
      check('offline-hint-shown', offlineHint, {})

      await page.unroute('**/m/api/**', offline)
      // 恢复后等它真正送达（最多 60 秒）
      let landed = 0
      for (let i = 0; i < 60; i += 1) {
        await sleep(1000)
        landed = await page.evaluate(needle => {
          const rows = window.__palmRows ?? []
          return rows.filter(row => row.kind === 'user' && String(row.text ?? '').includes(needle)).length
        }, text.slice(-8))
        if (landed > 0) break
      }
      check('delivered-after-reconnect', landed === 1, { landed })

      // 再等一会儿，确认没有"重发第二遍"
      await sleep(5000)
      const again = await page.evaluate(needle => {
        const rows = window.__palmRows ?? []
        return rows.filter(row => row.kind === 'user' && String(row.text ?? '').includes(needle)).length
      }, text.slice(-8))
      check('delivered-once', again === 1, { again })

      const inbox = (await rpc('mobile.inbox', { sessionId }))?.value ?? {}
      const queued = [...(inbox.nextTurn ?? []), ...(inbox.nextStep ?? [])].length
      check('host-queue-empty', queued === 0, { queued })
    } finally {
      await page.unroute('**/m/api/**').catch(() => undefined)
      await page.close()
    }
  },
}
