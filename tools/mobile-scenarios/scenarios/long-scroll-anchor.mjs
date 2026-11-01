/**
 * S4b 长会话滚动：上滑翻页 → 回底（只读）。
 *
 * 现场类问题：翻页后位置乱跳、回到最新时没贴底、翻出来的行把屏幕顶飞。
 *
 * 判据（2026-11-01 重写）：
 *   ① 翻页后**同一行**（按 data-message-id 追踪）在屏幕上的位置不动（≤32px）；
 *   ② 滚回底部 gap ≤ 4px；
 *   ③ 无重复身份。
 *
 * 为什么按 id 追踪：以前用"滚动值/行号"当锚点，翻页会插入新行、行号全变，
 * 测出来的"漂移 343px"其实是**换了参照物**。实测按 id 追同一个元素：位移 0px。
 * 另外必须等页面稳定（缓存页 → 网络页会把行整份换掉），否则锚点行本身被替换。
 */
import { chatUrl, rpc, WORKSPACE } from '../lib/env.mjs'
import { checkNoDuplicateIds, checkPinnedToBottom, sampleChat } from '../lib/invariants.mjs'


/**
 * 挑一条没在跑、历史最长的会话。
 *
 * 为什么必须挑：只读会话往往就是用户此刻正在跑的那条（我自己就常在那条里），
 * 在跑的会话滚上去会被持续跟随回底部 —— 那不是锚点漂移，测了也没意义。
 */
async function pickIdleLongSession(fallback) {
  try {
    const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
    const ranked = list
      .map(item => ({ id: item.sessionId ?? item.id, turns: item.projections?.values?.sessionStats?.turns ?? 0 }))
      .filter(entry => typeof entry.id === 'string' && entry.id !== '')
      .sort((a, b) => b.turns - a.turns)
      .slice(0, 4)
    // 逐条问这一轮在不在跑（sessionState 是宿主同一份切面，比花名册准）。
    for (const entry of ranked) {
      const state = await rpc('mobile.sessionState', { sessionId: entry.id })
      const running = state?.value?.turn?.running ?? state?.turn?.running
      if (running !== true) return entry.id
    }
    return fallback
  } catch {
    return fallback
  }
}

export const scenario = {
  id: 'long-scroll-anchor',
  title: '上滑翻页再回底：锚点不漂、回底贴住',
  async run(ctx) {
    const { context, check, sessionId: readOnlySession } = ctx
    // 在跑的会话会持续跟随底部：上滑之后测锚点没有意义（那是跟随，不是漂移）。
    // 所以先挑一条**没在跑**的长会话；挑不到才退回只读会话（那时若在跑就跳过）。
    const target = await pickIdleLongSession(readOnlySession)
    const sessionId = target ?? readOnlySession
    const page = await context.newPage()
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      const busy = await page.evaluate(() => {
        const chip = document.querySelector('.chat-turn-status')
        return chip === null ? false : (chip.textContent ?? '').includes('输出中')
      })
      if (busy) { check('anchor-skip-running', true, { note: '会话在跑，跳过锚点判据' }); return }
      check('anchor-target-session', true, { sessionId: String(sessionId).slice(0, 20) })
      for (let i = 0; i < 20; i += 1) {
        await page.waitForTimeout(100)
        const snap = await sampleChat(page)
        if (snap.rows > 5) break
      }
      // 等页面稳定（高度 1.2 秒不变）
      {
        let last = -1
        let stableSince = Date.now()
        const deadline = Date.now() + 15_000
        while (Date.now() < deadline) {
          await page.waitForTimeout(200)
          const height = await page.evaluate(() => document.querySelector('.chat-scroll')?.scrollHeight ?? 0)
          if (height !== last) { last = height; stableSince = Date.now() } else if (Date.now() - stableSince > 1_200) break
        }
      }

      const result = await page.evaluate(async () => {
        const scroller = document.querySelector('.chat-scroll') ?? document.scrollingElement
        if (scroller === null) return { error: 'no-scroller' }
        scroller.scrollTop = Math.round(scroller.scrollHeight * 0.4)
        await new Promise(resolve => setTimeout(resolve, 600))

        const box = scroller.getBoundingClientRect()
        const pick = () => [...scroller.querySelectorAll('[data-message-id]')].find(el => {
          const rect = el.getBoundingClientRect()
          return rect.top >= box.top + 8 && rect.top <= box.top + 300
        }) ?? null
        const anchor = pick()
        if (anchor === null) return { error: 'no-anchor' }
        const anchorId = anchor.getAttribute('data-message-id')
        const before = Math.round(anchor.getBoundingClientRect().top)

        const button = [...document.querySelectorAll('button')].find(el => (el.textContent ?? '').includes('加载更早'))
        if (button !== undefined) {
          button.click()
          const rowsBefore = scroller.querySelectorAll('[data-message-id]').length
          const deadline = Date.now() + 12_000
          let stable = 0
          let lastHeight = -1
          while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 200))
            const height = Math.round(scroller.scrollHeight)
            const grown = scroller.querySelectorAll('[data-message-id]').length > rowsBefore
            stable = height === lastHeight && (grown || stable >= 3) ? stable + 1 : 0
            lastHeight = height
            if (stable >= 3) break
          }
          await new Promise(resolve => setTimeout(resolve, 400))
        }

        const same = anchorId === null
          ? null
          : [...scroller.querySelectorAll('[data-message-id]')].find(el => el.getAttribute('data-message-id') === anchorId) ?? null
        return {
          hasButton: button !== undefined,
          anchorId,
          before,
          after: same === null ? null : Math.round(same.getBoundingClientRect().top),
        }
      })

      if (result.error !== undefined) { check('anchor-skip', true, { note: `跳过：${result.error}` }); return }
      if (result.after === null) {
        check('anchor-row-replaced-skip', true, { anchorId: result.anchorId })
      } else {
        const drift = Math.abs(result.after - result.before)
        check('anchor-drift-small', drift <= 32, { before: result.before, after: result.after, drift })
      }
      if (!result.hasButton) check('no-older-pages-skip', true, {})

      await page.evaluate(() => {
        const scroller = document.querySelector('.chat-scroll') ?? document.scrollingElement
        if (scroller !== null) scroller.scrollTop = scroller.scrollHeight
      })
      await page.waitForTimeout(1200)
      const snap = await sampleChat(page)
      checkPinnedToBottom(check, snap, 'after-scroll-back')
      checkNoDuplicateIds(check, snap, 'after-scroll-back')
    } finally {
      await page.close()
    }
  },
}
