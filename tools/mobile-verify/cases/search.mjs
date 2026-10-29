/**
 * 搜索（search 组）：首页搜索命中、高亮数量、会话内搜索、进入会话后的对齐。
 */
export default [
  {
    id: 'search.home-highlights',
    group: 'search',
    surface: 'roster',
    title: '首页搜索有命中且带高亮',
    async run(ctx, { page }) {
      await page.waitForTimeout(2_200)
      const trigger = page.locator('.ws-search-trigger, [aria-label*="搜索"]').first()
      ctx.assert((await trigger.count()) > 0, '首页没有搜索入口')
      await trigger.click()
      await page.waitForTimeout(500)
      const box = page.locator('input[placeholder*="搜索"]').first()
      ctx.assert((await box.count()) > 0, '点开后没有输入框')
      await box.fill('')
      await box.type('重启', { delay: 40 })
      await page.waitForTimeout(1_800)
      const marks = await page.locator('mark.search-mark').count()
      ctx.atLeast(marks, 1, '高亮数量')
      return `${marks} 处高亮`
    },
  },
  {
    id: 'search.chat-in-session',
    group: 'search',
    surface: 'chat',
    title: '会话内搜索能出结果并高亮',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const opener = page.locator('[aria-label*="搜索本会话"]').first()
      ctx.assert((await opener.count()) > 0, '聊天页没有搜索入口')
      await opener.click()
      await page.waitForTimeout(600)
      const box = page.locator('input[placeholder*="搜索本会话"]').first()
      ctx.assert((await box.count()) > 0, '搜索框没有打开')
      // 面板刚挂上时输入框可能还没接上受控状态，首字会被吞（实测偶发 0 命中）：
      // 先等它真正可交互，再打字；仍然没高亮就补打一次。
      await box.waitFor({ state: 'visible', timeout: 5_000 })
      await page.waitForTimeout(300)
      let marks = 0
      for (let attempt = 0; attempt < 2 && marks === 0; attempt += 1) {
        await box.click()
        await box.fill('')
        await page.waitForTimeout(150)
        await box.type('编译', { delay: 45 })
        for (let tick = 0; tick < 10 && marks === 0; tick += 1) {
          await page.waitForTimeout(400)
          marks = await page.locator('mark').count()
        }
      }
      ctx.atLeast(marks, 1, '会话内高亮数量')
      return `${marks} 处`
    },
  },
]
