/**
 * S26 列表页：能点得动 + 别太慢（只读）。
 *
 * 守的格子：J2×U（可操作）、J2×P（性能预算）。
 *
 * 用户场景：打开列表 → 想点进某个会话。点不动、或者被别的元素挡住，是最气人的一类。
 *
 * 判据：
 *   ① 会话行是真可点的：每行中心点的 `elementFromPoint` 落在该行内部（不被浮层挡住）；
 *   ② 可点热区不小：行高 ≥ 44px（手指点得中）；
 *   ③ 首屏 3 秒内出行；滚动 1.5 秒平均帧率 ≥ 40。
 */
import { listUrl } from '../lib/env.mjs'

export const scenario = {
  id: 'list-operability-and-speed',
  title: '列表行能被点中、热区够大、首屏与滚动在预算内',
  async run(ctx) {
    const { context, check } = ctx
    const page = await context.newPage()
    try {
      const startedAt = Date.now()
      await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
      let firstRowMs
      for (let i = 0; i < 60; i += 1) {
        await page.waitForTimeout(100)
        const rows = await page.evaluate(() => document.querySelectorAll('.mobile-row-sess, .mobile-row').length)
        if (rows > 0) { firstRowMs = Date.now() - startedAt; break }
      }
      check('first-row-within-budget', firstRowMs !== undefined && firstRowMs <= 3000, { firstRowMs })
      await page.waitForTimeout(600)

      // ① + ②：行可点、热区够大
      const rows = await page.evaluate(() => {
        const list = [...document.querySelectorAll('.mobile-row-sess, .mobile-row')].slice(0, 5)
        return list.map(el => {
          const rect = el.getBoundingClientRect()
          const cx = Math.round(rect.left + rect.width / 2)
          const cy = Math.round(rect.top + rect.height / 2)
          const hit = document.elementFromPoint(cx, cy)
          return {
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            hitInside: hit !== null && (el === hit || el.contains(hit)),
            hitTag: hit === null ? null : hit.tagName,
          }
        })
      })
      check('rows-exist', rows.length > 0, { rows: rows.length })
      if (rows.length > 0) {
        const tooSmall = rows.filter(row => row.height < 44)
        check('row-hot-area-large-enough', tooSmall.length === 0, { heights: rows.map(row => row.height) })
        const blocked = rows.filter(row => row.top > 0 && !row.hitInside)
        check('rows-are-tappable-not-covered', blocked.length === 0, { blocked })
      }

      // ③ 滚动帧率
      const fps = await page.evaluate(async () => {
        const scroller = document.querySelector('.mobile-scroll, .chat-scroll') ?? document.scrollingElement
        if (scroller === null) return 0
        const frames = []
        let last = performance.now()
        const started = performance.now()
        let stop = false
        const tick = () => {
          const now = performance.now()
          frames.push(now - last)
          last = now
          if (now - started >= 1500) { stop = true; return }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        const step = () => {
          if (stop) return
          scroller.scrollTop += 20
          if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) scroller.scrollTop = 0
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
        await new Promise(resolve => setTimeout(resolve, 1700))
        const usable = frames.filter(delta => delta > 0)
        if (usable.length === 0) return 0
        return Math.round(1000 / (usable.reduce((sum, delta) => sum + delta, 0) / usable.length))
      })
      check('list-scroll-fps-in-budget', fps >= 40, { fps })
    } finally {
      await page.close()
    }
  },
}
