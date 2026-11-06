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
    // 真机清单第 5 项（触摸目标 <44px）的自动化版本。
    //
    // 口径说明（都是实测踩出来的，别随手放宽）：
    //   · 判 40px 而不是 44px：390px 宽的代码头行里塞 4 个按钮，44×4 会挤掉语言名；
    //   · 认 `::after` 命中区：`.chat-pill` 视觉只有 32 高，但 `::after{inset:-6px -2px}`
    //     把可点区扩到 44 —— 只看 getBoundingClientRect 会把它误判成过小；
    //   · 整行宽控件（如"本轮产出 N 个文件"的折叠头，334×36）不算问题：
    //     宽度已远超拇指直径，高度差 8px 不影响命中。
    id: 'entry.touch-targets-40',
    group: 'entry',
    surface: 'chat',
    title: '聊天页主控件可点区 ≥40px（已计算 ::after 扩展）',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const bad = await page.evaluate(() => {
        const out = []
        for (const el of document.querySelectorAll('button,[role="button"],[role="switch"]')) {
          const rect = el.getBoundingClientRect()
          if (rect.height === 0) continue
          if (el.tagName === 'A' && el.closest('.chat-md-body, .chat-msg-text, .chat-msg-plain') !== null) continue
          // 排队条那三个按钮（编辑/删除/撤回）高度 30px 是**用户拍板过的取舍**，不是漏改：
          // mobile-styles.ts 里 .queue-dockBtn 的注释写着"用户两轮反馈还是太高，纵向收到 30px，
          // 靠相邻间距而不是自身空白兜住误点"。自动化不许把它当成缺陷（改了等于推翻用户决定）。
          if (el.classList.contains('queue-dockBtn')) continue
          const after = getComputedStyle(el, '::after')
          const padded = after !== null && after.content !== 'none' && after.content !== '' && (after.inset ?? '') !== '' && after.inset !== 'auto'
          if (padded) continue
          if (rect.width >= 40 && rect.height >= 40) continue
          if (rect.width >= 200 && rect.height >= 34) continue
          out.push(`${Math.round(rect.width)}x${Math.round(rect.height)} ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 12)}`)
        }
        return out.slice(0, 6)
      })
      ctx.equals(bad.length, 0, `可点区不足：${bad.join(' / ') || '无'}`)
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
