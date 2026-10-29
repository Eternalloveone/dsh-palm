/**
 * 进入会话相关的用例（entry 组）。
 *
 * 这一组踩过的坑最多：落不到底部、同一轮画成两张过程卡、一进会话闪一句
 * 「已 N 秒没有新输出」、再次进入被搜索定位带到很老的一轮。
 */
import { chatMetrics } from '../lib/harness.mjs'

export default [
  {
    id: 'entry.lands-at-bottom',
    group: 'entry',
    surface: 'chat',
    title: '进会话落在最新消息（离底部 ≤ 8px）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const m = await chatMetrics(page)
      ctx.assert(m.rows > 5, `只渲染了 ${m.rows} 行`)
      ctx.atMost(m.gapToBottom, 8, '离底部距离')
      return `rows=${m.rows} gap=${m.gapToBottom}`
    },
  },
  {
    id: 'entry.one-live-card',
    group: 'entry',
    surface: 'chat',
    title: '同一时刻只有一张「在跑」的过程卡',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const m = await chatMetrics(page)
      ctx.atMost(m.liveCards, 1, '在跑的过程卡数量')
      return `live=${m.liveCards}/${m.cards}`
    },
  },
  {
    id: 'entry.no-stall-flash',
    group: 'entry',
    surface: 'chat',
    title: '进会话不闪「已 N 秒没有新输出」',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const m = await chatMetrics(page)
      ctx.assert(m.strip === null || !/没有新输出/.test(m.strip), `状态条出现：${m.strip}`)
      return m.strip === null ? '状态条不显示（正常）' : `strip=${m.strip}`
    },
  },
  {
    id: 'entry.no-duplicate-ids',
    group: 'entry',
    surface: 'chat',
    title: '同一条消息不会在屏幕上出现两次',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const m = await chatMetrics(page)
      ctx.equals(m.duplicateIds, 0, '重复的 data-message-id 数量')
      return `rows=${m.rows}`
    },
  },
  {
    id: 'entry.no-tiny-targets',
    group: 'entry',
    surface: 'chat',
    title: '聊天页没有小于 30px 的可点控件',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const m = await chatMetrics(page)
      ctx.equals(m.tiny.length, 0, `过小控件：${m.tiny.join(' / ') || '无'}`)
      return '0 个'
    },
  },
  {
    id: 'entry.no-horizontal-overflow',
    group: 'entry',
    surface: 'chat',
    title: '聊天页没有横向溢出',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const m = await chatMetrics(page)
      ctx.equals(m.overflowX, 0, '横向溢出像素')
      return `overflowX=${m.overflowX}`
    },
  },
  {
    id: 'entry.reentry-stays-at-tail',
    group: 'entry',
    surface: 'chat',
    title: '再次进入同一会话仍在最新位置（不被旧定位带走）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      // 先离开再回来：这正是「搜索之后又正常点进来」的路径。
      await page.goto(`${ctx.base}${`/m/?workspace=${ctx.fixtures.workspaceId}`}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_200)
      await page.goto(
        page.url().includes('session=') ? page.url() : `${ctx.base}/m/?workspace=${ctx.fixtures.workspaceId}&session=${encodeURIComponent(ctx.fixtures.sessionId)}`,
        { waitUntil: 'domcontentloaded' },
      )
      await page.waitForTimeout(300)
      await page.goto(`${ctx.base}/m/?workspace=${ctx.fixtures.workspaceId}&session=${encodeURIComponent(ctx.fixtures.sessionId)}`, {
        waitUntil: 'domcontentloaded',
      })
      await ctx.waitForChatRows(page)
      const m = await chatMetrics(page)
      ctx.atMost(m.gapToBottom, 8, '再次进入时的离底部距离')
      return `gap=${m.gapToBottom}`
    },
  },
  {
    id: 'entry.loading-skeleton-visible',
    group: 'entry',
    surface: 'chat',
    title: '首屏加载期间有可见的「加载中」提示（不是纯白）',
    async run(ctx, { page }) {
      const text = await page.evaluate(() => (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 120))
      ctx.assert(text.length > 0, '首屏完全空白')
      return text.slice(0, 40)
    },
  },
]
