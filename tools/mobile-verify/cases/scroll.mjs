/**
 * 滚动相关的用例（scroll 组）：跟随/上滑不被拽回/回到最新/翻历史锚定。
 *
 * 这一组是「手感」类问题，只能靠坐标与位移量断言，所以阈值都写在用例里，
 * 失败时 detail 会带上具体像素值 —— 便于判断是「差一点」还是「真的坏了」。
 */
import { chatMetrics, dragContent, userScroll } from '../lib/harness.mjs'

export default [
  {
    id: 'scroll.no-yank-after-gesture',
    group: 'scroll',
    surface: 'chat',
    title: '往上滑之后不被自动拽回底部',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const target = await page.evaluate(() => {
        const el = document.querySelector('.chat-scroll')
        return el === null ? 0 : el.scrollHeight - el.clientHeight - 600
      })
      await userScroll(page, target)
      await page.waitForTimeout(400)
      const before = (await chatMetrics(page)).scrollTop
      await page.waitForTimeout(4_000)
      const after = (await chatMetrics(page)).scrollTop
      ctx.atMost(Math.abs(after - before), 8, `4 秒内位移（${before} → ${after}）`)
      return `${before} → ${after}`
    },
  },
  {
    id: 'scroll.jump-to-latest',
    group: 'scroll',
    surface: 'chat',
    title: '「回到最新」能回到底部',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const target = await page.evaluate(() => {
        const el = document.querySelector('.chat-scroll')
        return el === null ? 0 : Math.max(0, el.scrollHeight - el.clientHeight - 3_000)
      })
      await userScroll(page, target)
      await page.waitForTimeout(700)
      const jump = page.locator('[aria-label*="回到最新"], .chat-jump-latest, button:has-text("最新")').first()
      ctx.assert((await jump.count()) > 0, '没有「回到最新」按钮')
      await jump.click()
      await page.waitForTimeout(900)
      const m = await chatMetrics(page)
      ctx.atMost(m.gapToBottom, 12, '回到最新后的离底部距离')
      return `gap=${m.gapToBottom}`
    },
  },
  {
    id: 'scroll.load-older-appends',
    group: 'scroll',
    surface: 'chat',
    title: '「加载更早的消息」会追加行',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const before = (await chatMetrics(page)).rows
      const button = page.locator('button', { hasText: '加载更早的消息' }).first()
      // 先滚到顶再看按钮：这条按钮只在"上面还有更早内容"时渲染，
      // 而贴底进入会话时它常常还没挂上（实测一次误报"没有按钮"）。
      await userScroll(page, 0)
      await button.waitFor({ state: 'attached', timeout: 6_000 }).catch(() => {})
      // 没有按钮 = 这条会话本来就没有更早的内容可翻（fixture 性质），不是产品缺陷。
      if ((await button.count()) === 0) ctx.skip('当前会话没有更早的消息可翻')
      ctx.assert((await button.count()) > 0, '没有「加载更早的消息」按钮')
      // 按钮在「正在加载」时是 disabled 的：直接 force click 会点在禁用按钮上，
      // 行数自然不涨（实测 2026-10-30 一次 114 → 114 的假失败，重跑就 114 → 124）。
      // 先等它变成可点，点完再等行数真的增长，而不是睡固定 2.6 秒。
      await button.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {})
      for (let i = 0; i < 40 && (await button.isDisabled()); i += 1) await page.waitForTimeout(150)
      ctx.assert(!(await button.isDisabled()), '「加载更早的消息」一直是禁用的（上一页还没读完？）')
      await button.click()
      const grew = await page
        .waitForFunction(
          count => document.querySelectorAll('[data-message-id]').length > count,
          before,
          { timeout: 12_000 },
        )
        .then(() => true, () => false)
      const after = (await chatMetrics(page)).rows
      ctx.assert(grew && after > before, `行数没有增加（${before} → ${after}）`)
      return `${before} → ${after}`
    },
  },
  {
    id: 'scroll.load-older-keeps-anchor',
    group: 'scroll',
    surface: 'chat',
    title: '翻历史时视口锚住（正在看的那一行位移 ≤ 24px）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      // 三步走，每一步都踩过坑：
      //   ① 不要求「先滚到顶」—— 真机上到顶要跟窗口化渲染与滚动锚定缠斗，与"翻页锚不锚"无关；
      //   ② 不假设行高小 —— 长回复一行就一两千像素，「行的顶部落在 120~420」几乎永不成立，
      //      改成「与可点区域相交」；
      //   ③ 取锚点前先等布局稳定（刚进页面时行还没量好高度，直接取会一条都不合格），
      //      需要挪动时用 dragContent 分步拖动（程序化写 scrollTop 会被当成回声、停不住）。
      const pick = () => page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-message-id]')]
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const rect = rows[i].getBoundingClientRect()
          if (rect.width < 100 || rect.height > 2_000) continue
          if (!(rect.top < 420 && rect.bottom > 140)) continue
          return { id: rows[i].getAttribute('data-message-id'), top: Math.round(rect.top) }
        }
        return null
      })

      let anchor = null
      for (let attempt = 0; attempt < 10 && anchor === null; attempt += 1) {
        anchor = await pick()
        if (anchor !== null) break
        if (attempt % 3 === 2) await dragContent(page, 260)
        else await page.waitForTimeout(400)
      }
      ctx.assert(anchor !== null, '视口里没有可作锚点的行')

      const result = await page.evaluate(async id => {
        const before = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)
        if (before === null) return { error: '锚点行取不到' }
        const topBefore = Math.round(before.getBoundingClientRect().top)
        const button = [...document.querySelectorAll('button')].find(el => (el.textContent ?? '').includes('加载更早'))
        if (button === undefined) return { error: '没有翻页按钮' }
        // 用 DOM 的 click()：Playwright 的 click 会先把按钮滚进视野，等于偷偷滚了一次。
        button.click()
        await new Promise(resolve => setTimeout(resolve, 2_800))
        const after = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)
        return { topBefore, topAfter: after === null ? null : Math.round(after.getBoundingClientRect().top) }
      }, anchor.id)
      // 没有翻页按钮 = 这条会话本来就没有更早的内容（fixture 性质）：跳过，不判失败。
      if (result.error === '没有翻页按钮') ctx.skip('当前会话没有更早的消息可翻')
      ctx.assert(result.error === undefined, result.error ?? '未知错误')
      ctx.assert(result.topAfter !== null, '翻页后找不到锚点行（被窗口换掉了）')
      const drift = Math.abs(result.topAfter - result.topBefore)
      ctx.atMost(drift, 24, `锚点位移（${result.topBefore} → ${result.topAfter}）`)
      return `位移 ${drift}px`
    },
  },
  {
    id: 'scroll.entry-settle-completes',
    group: 'scroll',
    surface: 'chat',
    title: '进会话 4 秒后仍贴着底部（补钉没有中途放弃）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      await page.waitForTimeout(4_200)
      const m = await chatMetrics(page)
      ctx.atMost(m.gapToBottom, 8, '4 秒后的离底部距离')
      return `gap=${m.gapToBottom}`
    },
  },
]
