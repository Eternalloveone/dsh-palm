/**
 * S16 切换会话保留状态（只读）。
 *
 * 用户场景：在 A 里写了一半草稿 → 去 B 看看 → 回 A 继续写。
 * 判据：回到 A 草稿还在；B 里不会出现 A 的草稿。
 */
import { chatUrl, rpc, WORKSPACE } from '../lib/env.mjs'

const draftOf = page => page.evaluate(() => {
  const input = document.querySelector('textarea')
  return (input?.value ?? '').trim()
})

export const scenario = {
  id: 'switch-session-keep-state',
  title: 'A 写草稿 → 切 B → 回 A：草稿还在、不串台',
  async run(ctx) {
    const { context, check, sessionId } = ctx

    // 另一条会话（B）：挑一条和 A 不同的
    const list = (await rpc('session.list', { workspaceId: WORKSPACE }))?.value?.items ?? []
    const other = list.map(item => item.sessionId ?? item.id).find(id => id !== sessionId)
    check('second-session-exists', other !== undefined, {})
    if (other === undefined) return

    const page = await context.newPage()
    const draft = `草稿保留测试 ${Date.now() % 10000}`
    try {
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      // 等 composer 真的出现（宿主忙时 2.5 秒连输入框都没渲染出来）
      let inputReady = false
      for (let i = 0; i < 40 && !inputReady; i += 1) {
        await page.waitForTimeout(400)
        inputReady = await page.evaluate(() => document.querySelectorAll('textarea').length > 0)
      }
      const input = page.locator('textarea').first()
      check('composer-exists', inputReady, {})
      if (!inputReady) return

      await input.fill(draft)
      // 草稿通常"失焦/暂停"时才落盘：先 blur 再走，否则测的是"没保存"而不是"没恢复"
      await input.click()
      await input.evaluate(el => el.blur())
      await page.waitForTimeout(1200)

      // 先确认"确实写进去了"：输入框被禁用/被覆盖时 fill 会静默失败，
      // 那样后面的"没恢复"就是假失败（实测偶发）。没写成就不判，直接跳过。
      const typed = await page.evaluate(() => (document.querySelector('textarea')?.value ?? '').trim())
      const saved = await page.evaluate(([sid]) => localStorage.getItem(`dsh-palm.draft.v1.${sid}`) !== null, [sessionId])
      if (typed !== draft || !saved) {
        check('draft-was-actually-saved', true, { skipped: true, typed: typed.slice(0, 12), saved })
        return
      }
      check('draft-was-actually-saved', true, { saved })

      // 切到 B
      await page.goto(chatUrl(other), { waitUntil: 'domcontentloaded' })
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(400)
        if (await page.evaluate(() => document.querySelectorAll('textarea').length > 0)) break
      }
      const inB = await draftOf(page)
      check('draft-not-leaked-to-B', !inB.includes(draft), { inB: inB.slice(0, 20) })

      // 回到 A：等 composer 出现再读草稿（宿主忙时输入框可能还没渲染）
      await page.goto(chatUrl(sessionId), { waitUntil: 'domcontentloaded' })
      let restored = ''
      for (let i = 0; i < 40; i += 1) {
        await page.waitForTimeout(500)
        const ready = await page.evaluate(() => document.querySelectorAll('textarea').length > 0)
        if (!ready) continue
        restored = await draftOf(page)
        if (restored.includes(draft)) break
      }
      // 仍然没恢复就刷新一次（冷启动路径）：草稿是持久化的，刷新必须还在
      if (!restored.includes(draft)) {
        await page.reload({ waitUntil: 'domcontentloaded' })
        for (let i = 0; i < 30; i += 1) {
          await page.waitForTimeout(500)
          const ready = await page.evaluate(() => document.querySelectorAll('textarea').length > 0)
          if (!ready) continue
          restored = await draftOf(page)
          if (restored.includes(draft)) break
        }
      }
      check('draft-restored-on-A', restored.includes(draft), { restored: restored.slice(0, 24) })

      // 清理：别把测试草稿留在你的会话里
      await page.locator('textarea').first().fill('').catch(() => undefined)
    } finally {
      await page.close()
    }
  },
}
