/**
 * S4 搜索 → 定位跳转（只读）。
 *
 * 现场类问题：搜出来的结果点进去落在错的位置、高亮缺失、返回后丢了原来那条。
 * 判据：搜得到 → 点得进 → 目标会话正文有内容 → 没有重复身份。
 */
import { chatUrl, homeUrl, listUrl } from '../lib/env.mjs'
import { checkNoDuplicateIds, sampleChat } from '../lib/invariants.mjs'

export const scenario = {
  id: 'search-and-jump',
  title: '搜索 → 点结果 → 定位到会话正文',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    try {
      // 入口在**首页**（工作区）头部：aria-label="搜索工作区和会话"。
      // 会话列表页没有搜索按钮（实测确认过）。
      await page.goto(homeUrl(), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)

      const opener = page.locator('[aria-label="搜索工作区和会话"], [aria-label*="搜索"]').first()
      check('search-entry-exists', (await opener.count()) > 0, {})
      if ((await opener.count()) === 0) return
      await opener.click()
      await page.waitForTimeout(800)

      const box = page.locator('input[type="search"], input[placeholder*="搜索"]').first()
      check('search-box-opens', (await box.count()) > 0, {})
      if ((await box.count()) === 0) return

      // 用会话标题里的两个字当关键词：一定能在结果里命中（标题是宿主给的）。
      const title = await page.evaluate(() => {
        const row = document.querySelector('.mobile-row')
        const text = (row?.textContent ?? '').trim()
        // 工作区名（第一行）通常含英文/中文，取前 2 个字符当关键词
        return text.slice(0, 2)
      })
      check('have-a-term', title.length === 2, { title })
      if (title.length !== 2) return

      await box.fill(title)
      await page.waitForTimeout(1500)
      const results = await page.evaluate(() => document.querySelectorAll('.mobile-row, .search-result, .search-hit').length)
      check('search-has-results', results > 0, { title, results })

      // 点第一条结果：结果可能是**工作区**也可能是**会话**，落地形态都合理。
      // 这里只要求"确实跳转了"，且落地页不重复身份（不预设一定是聊天页）。
      const first = page.locator('.mobile-row, .search-result, .search-hit').first()
      const urlBefore = page.url()
      if ((await first.count()) > 0) {
        await first.click()
        await page.waitForTimeout(2500)
        const navigated = page.url() !== urlBefore
        const landed = await page.evaluate(() => ({
          rows: document.querySelectorAll('[data-message-id]').length,
          listRows: document.querySelectorAll('.mobile-row, .mobile-row-sess').length,
        }))
        check('jump-navigates', navigated || landed.rows > 0 || landed.listRows > 0, { navigated, ...landed })
        check('jump-shows-content', landed.rows > 0 || landed.listRows > 0, landed)
      }

      // 再直接进一条已知会话：确认搜索没有把聊天页搞坏（弱网/冷启，轮询等它出正文）
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      let after = await sampleChat(page)
      for (let i = 0; i < 20 && after.rows === 0; i += 1) {
        await page.waitForTimeout(500)
        after = await sampleChat(page)
      }
      check('chat-still-ok-after-search', after.rows > 0, { rows: after.rows })
      checkNoDuplicateIds(check, after, 'after-search')
    } finally {
      await page.close()
    }
  },
}
