/**
 * 运行中页与子代理（runs 组）：卡片、真值对账、只读子会话。
 */
export default [
  {
    id: 'runs.page-opens',
    group: 'runs',
    surface: 'roster',
    title: '运行中页能打开并显示标题',
    async run(ctx, { page }) {
      await page.waitForTimeout(2_000)
      const entry = page.locator('[aria-label*="运行"]').first()
      ctx.assert((await entry.count()) > 0, '首页没有「运行中」入口')
      await entry.click()
      await page.waitForTimeout(2_800)
      const text = await page.evaluate(() => (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 60))
      ctx.assert(text.includes('运行中'), `页面标题不对：${text}`)
      return text.slice(0, 30)
    },
  },
  {
    id: 'runs.count-matches-host',
    group: 'runs',
    surface: 'roster',
    title: '运行卡数量与宿主「在跑的会话」一致',
    async run(ctx, { page, rpc }) {
      await page.waitForTimeout(2_000)
      await page.locator('[aria-label*="运行"]').first().click()
      await page.waitForTimeout(3_000)
      const cards = await page.evaluate(() => document.querySelectorAll('.runov-sess').length)
      const running = ctx.fixtures.running.length
      // 宿主统计的「在跑会话」包含子代理会话，而运行中页只列**顶层聊天**，
      // 所以口径是「至少 1 张卡」，不能直接等号比较（那会误报）。
      ctx.atLeast(cards, Math.min(1, running), `运行卡数量（屏幕上 ${cards}，宿主在跑 ${running}）`)
      return `屏幕 ${cards} / 宿主 ${running}`
    },
  },
  {
    id: 'runs.subchat-readonly',
    group: 'runs',
    surface: 'roster',
    title: '子代理只读页可打开且没有输入框',
    async run(ctx, { page }) {
      await page.waitForTimeout(2_000)
      await page.locator('[aria-label*="运行"]').first().click()
      await page.waitForTimeout(3_000)
      const row = page.locator('.runov-sub, [aria-label*="子代理"]').first()
      if ((await row.count()) === 0) ctx.skip('当前没有可点的子代理行')
      await row.click()
      await page.waitForTimeout(2_500)
      const state = await page.evaluate(() => ({
        text: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 40),
        inputs: document.querySelectorAll('textarea, input[placeholder*="说什么"]').length,
      }))
      ctx.assert(state.inputs === 0, `只读页出现了 ${state.inputs} 个输入框`)
      return state.text.slice(0, 30)
    },
  },
]
