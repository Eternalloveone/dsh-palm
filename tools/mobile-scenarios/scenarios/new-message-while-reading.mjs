/**
 * S17 看历史时有新内容 / 回到底部（只读）。
 *
 * 用户场景：上滑翻旧消息 → 想回到最新。
 * 判据：上滑后出现"回到底部"类入口；点它回到贴底（gap ≤ 4px）。
 *       （"真有新消息"需要会话在跑，属于 manual 场景，这里只测可控的部分。）
 */
import { chatUrl } from '../lib/env.mjs'
import { sampleChat } from '../lib/invariants.mjs'

export const scenario = {
  id: 'new-message-while-reading',
  /**
   * 实验性：**它抓到一个待确认的行为**。
   *
   * 现象（2026-10-31 实测）：会话**正在跑**时，把 `.chat-scroll` 滚到 40% 处，
   * 1.5 秒后又回到贴底（gap=0）—— 也就是说流式输出过程中很难停在历史位置。
   *
   * 这可能是"新内容到达时自动跟随"的既定行为，也可能是"用户上滑被强行拽回"的缺陷；
   * 需要真机上人工确认期望语义（流式时是否应该停止跟随）。确认后再决定判据方向。
   * 在此之前不进门禁，避免把"待定行为"当成缺陷。
   */
  experimental: true,
  title: '上滑看历史 → 回到底部入口 → 贴底',
  async run(ctx) {
    const { context, check, sessionId } = ctx
    const page = await context.newPage()
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(250)
        const snap = await sampleChat(page)
        if (snap.rows > 5) break
      }

      // 等首帧稳定 + 等容器真的可滚动（内容不够高时 scrollTop 设了也白设）
      await page.waitForTimeout(1500)
      let scrollable = false
      for (let i = 0; i < 40; i += 1) {
        const metrics = await page.evaluate(() => {
          const scroller = document.querySelector('.chat-scroll')
          return scroller === null ? null : { sh: scroller.scrollHeight, ch: scroller.clientHeight }
        })
        if (metrics !== null && metrics.sh > metrics.ch + 800) { scrollable = true; break }
        await page.waitForTimeout(300)
      }
      check('content-is-scrollable', scrollable, {})

      // 上滑（滚到 40% 处，稳定可测）
      await page.evaluate(() => {
        const scroller = document.querySelector('.chat-scroll') ?? document.scrollingElement
        if (scroller !== null) scroller.scrollTop = Math.round(scroller.scrollHeight * 0.4)
      })
      await page.waitForTimeout(1500)

      // 找"回到底部"入口：按钮文案/aria 里带"底部/最新/新消息"
      const entry = await page.evaluate(() => {
        const candidates = [...document.querySelectorAll('button, [role=button]')]
        const hit = candidates.find(el => /底部|最新|新消息|下到底/.test(
          `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`,
        ))
        return hit === undefined ? null : { text: (hit.textContent ?? '').trim().slice(0, 10), cls: (hit.className ?? '').toString().slice(0, 30) }
      })
      // 硬不变量：上滑之后**不许被强行拽回底部**（用户正在看历史）
      const afterScroll = await page.evaluate(() => {
        const scroller = document.querySelector('.chat-scroll') ?? document.scrollingElement
        return { top: Math.round(scroller.scrollTop), gap: Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) }
      })
      check('stays-where-user-scrolled', afterScroll.gap > 200, afterScroll)

      // 「回到底部」入口只在有新增内容时才出现：有就验证它真的能回底
      if (entry === null) {
        check('bottom-entry-not-needed', true, { note: '没有新增内容时不需要该入口' })
        return
      }
      check('back-to-bottom-entry', true, { entry })

      if (entry !== null) {
        const button = page.locator('button, [role=button]').filter({ hasText: /底部|最新|新消息/ }).first()
        if ((await button.count()) > 0) {
          await button.click().catch(() => undefined)
        } else {
          await page.evaluate(() => {
            const el = [...document.querySelectorAll('button, [role=button]')]
              .find(node => /底部|最新|新消息/.test(`${node.textContent ?? ''} ${node.getAttribute('aria-label') ?? ''}`))
            el?.click()
          })
        }
        await page.waitForTimeout(1200)
        const snap = await sampleChat(page)
        check('click-returns-to-bottom', snap.gap <= 6, { gap: snap.gap })
      }
    } finally {
      await page.close()
    }
  },
}
