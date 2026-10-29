/**
 * 卡片与消息交互（cards 组）：过程卡展开、交付卡折叠、长按菜单、引用/复制。
 */
import { chatMetrics, dragContent } from '../lib/harness.mjs'

export default [
  {
    id: 'cards.proc-expand',
    group: 'cards',
    surface: 'chat',
    title: '点过程条头能展开/收起',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const info = await page.evaluate(async () => {
        const heads = [...document.querySelectorAll('.chat-proc-head')]
        const target = heads[Math.max(0, heads.length - 2)] ?? heads[0]
        if (target === undefined) return { error: '没有过程条' }
        const read = () => ({
          aria: target.getAttribute('aria-expanded'),
          lines: target.parentElement?.querySelectorAll('.chat-proc-line').length ?? 0,
        })
        const before = read()
        target.click()
        await new Promise(resolve => setTimeout(resolve, 400))
        const opened = read()
        target.click()
        await new Promise(resolve => setTimeout(resolve, 400))
        const closed = read()
        return { before, opened, closed }
      })
      ctx.assert(info.error === undefined, info.error ?? '未知错误')
      const changed = info.before.aria !== info.opened.aria || info.before.lines !== info.opened.lines
      ctx.assert(changed, `点击没有改变展开状态（${JSON.stringify(info.before)} → ${JSON.stringify(info.opened)}）`)
      return `${info.before.aria}/${info.before.lines} → ${info.opened.aria}/${info.opened.lines}`
    },
  },
  {
    id: 'cards.delivery-head-tap-size',
    group: 'cards',
    surface: 'chat',
    title: '交付卡头部热区 ≥ 30px',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const box = await page.evaluate(() => {
        const head = document.querySelector('.chat-turn-tail-head')
        if (head === null) return null
        const rect = head.getBoundingClientRect()
        return { width: Math.round(rect.width), height: Math.round(rect.height) }
      })
      ctx.assert(box !== null, '没有交付卡')
      ctx.atLeast(box.height, 30, `交付卡头部高度（${box.width}x${box.height}）`)
      return `${box.width}x${box.height}`
    },
  },
  {
    id: 'cards.delivery-toggle',
    group: 'cards',
    surface: 'chat',
    title: '交付卡能折叠/展开',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      // 盯「被点的那张卡自己」：全局计数会被别的卡干扰，也测不出 aria 是否真的翻转。
      const result = await page.evaluate(async () => {
        const heads = [...document.querySelectorAll('.chat-turn-tail-head')]
        const head = heads[heads.length - 1]
        if (head === undefined) return { error: '没有交付卡' }
        head.scrollIntoView({ block: 'center' })
        await new Promise(resolve => setTimeout(resolve, 200))
        const card = head.closest('.chat-turn-tail')
        const read = () => ({
          aria: head.getAttribute('aria-expanded'),
          sections: card === null ? -1 : card.querySelectorAll('.chat-turn-tail-section').length,
          files: card === null ? -1 : card.querySelectorAll('.chat-turn-tail-file').length,
        })
        const before = read()
        head.click()
        await new Promise(resolve => setTimeout(resolve, 500))
        const collapsed = read()
        head.click()
        await new Promise(resolve => setTimeout(resolve, 400))
        return { before, collapsed, restored: read() }
      })
      ctx.assert(result.error === undefined, result.error ?? '未知错误')
      ctx.assert(
        result.before.aria !== result.collapsed.aria || result.before.sections !== result.collapsed.sections,
        `折叠没有效果（${JSON.stringify(result.before)} → ${JSON.stringify(result.collapsed)}）`,
      )
      ctx.assert(
        result.restored.aria === result.before.aria,
        `再点一次没有恢复（${JSON.stringify(result.collapsed)} → ${JSON.stringify(result.restored)}）`,
      )
      return `${result.before.aria}/${result.before.files}文件 → ${result.collapsed.aria}/${result.collapsed.files}文件`
    },
  },
  {
    id: 'cards.long-press-menu',
    group: 'cards',
    surface: 'chat',
    title: '长按消息正文出现操作菜单',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      // 找一条**真的可见**的正文来长按。
      //
      // 不能直接取 `.chat-md-body` 的最后一条：这一轮如果还在跑，末尾那些正文挂在
      // 过程卡里（收起时高度为 0），Playwright 的 scrollItIntoView 对零高度元素不生效，
      // 于是时而找不到坐标（实测过一次假失败）。这里改成：先筛「有实际尺寸」的正文，
      // 再从下往上一档档滚，直到某条落进可点区域；实在没有就跳过（不冒充通过）。
      let spot = null
      for (let attempt = 0; attempt < 10 && spot === null; attempt += 1) {
        spot = await page.evaluate(() => {
          // 只挑**过程卡之外**的正文：卡片里的正文是过程体，长按菜单挂在外层消息行上，
          // 点进去不会弹菜单（实测「长按后没有出现菜单」就是这么来的）。
          const all = [...document.querySelectorAll('.chat-msg .chat-md-body')]
          const bodies = all.filter(el => el.closest('.chat-proc') === null)
          if (bodies.length === 0) bodies.push(...all)
          // 正文块动辄一两千像素高：要求「顶部落在某个窄带」几乎永不成立（实测正是这条让
          // 用例假失败）。改成「整块与可点区域相交」，点击点再夹进可视范围。
          const BAND_TOP = 140
          const BAND_BOTTOM = 520
          for (let i = bodies.length - 1; i >= 0; i -= 1) {
            const rect = bodies[i].getBoundingClientRect()
            if (rect.height < 24 || rect.width < 100) continue
            const intersects = rect.top < BAND_BOTTOM && rect.bottom > BAND_TOP
            if (!intersects) continue
            const y = Math.round(Math.min(BAND_BOTTOM, Math.max(BAND_TOP, rect.top + 60)))
            return { x: Math.round(rect.x + 24), y }
          }
          return null
        })
        if (spot === null) {
          // 必须用**真手势**往上滚：直接写 scrollTop 会被应用当成程序化回声、重新钉回底部
          // （实测改 8 次 scrollTop 一点没动，于是这条用例一直报「视口里没有可长按的正文」）。
          await dragContent(page, 340)
        }
      }
      ctx.assert(spot !== null, '视口里没有可长按的正文')
      const session = await page.context().newCDPSession(page)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: spot.x, y: spot.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
      })
      await page.waitForTimeout(800)
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(700)
      const menu = await page.evaluate(() => {
        const el = document.querySelector('.ctx-menu')
        return el === null ? null : [...el.querySelectorAll('button')].map(button => (button.textContent ?? '').trim())
      })
      ctx.assert(menu !== null, '长按后没有出现菜单')
      ctx.atLeast(menu.length, 3, `菜单项数量（${menu.join('/')}）`)
      await page.keyboard.press('Escape')
      return menu.join('/')
    },
  },
  {
    id: 'cards.elapsed-sane',
    group: 'cards',
    surface: 'chat',
    title: '过程卡用时不是 NaN/负值/零点',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const times = await page.evaluate(() =>
        [...document.querySelectorAll('.chat-proc-time')].map(el => (el.textContent ?? '').trim()).slice(-6),
      )
      for (const text of times) {
        ctx.assert(!/NaN|undefined|^-/.test(text), `异常用时文案：${text}`)
      }
      return times.join(' / ') || '（无用时文案）'
    },
  },
]
