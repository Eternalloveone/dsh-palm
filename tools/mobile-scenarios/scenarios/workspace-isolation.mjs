/**
 * S24 多工作区不串（只读）。
 *
 * 用户动作：在工作区之间来回切。
 *
 * 判据：
 *   ① 至少有两个工作区（只有一个就跳过，不算失败）；
 *   ② 两个工作区的会话集合**互不相交**（同一批会话不该同时出现在两边）；
 *   ③ 切回来之后列表还能正常出内容（不白屏、不是空壳）。
 *
 * 说明：这里只读宿主数据 + 只读页面，不做任何写操作。
 */
import { WORKSPACE, listUrl, rpc } from '../lib/env.mjs'

export const scenario = {
  id: 'workspace-isolation',
  title: '切工作区：会话集合不串、切回来不白屏',
  async run(ctx) {
    const { context, check } = ctx

    const list = await rpc('workspace.list', {})
    const workspaces = (list?.value?.workspaces ?? list?.value?.items ?? []).map(item => ({
      id: item.id ?? item.workspaceId ?? item.path,
      name: item.name ?? item.title ?? String(item.id ?? ''),
    })).filter(entry => typeof entry.id === 'string' && entry.id !== '')

    check('workspace-list-available', workspaces.length > 0, { count: workspaces.length })
    if (workspaces.length < 2) {
      check('needs-two-workspaces-skip', true, { note: '只有 1 个工作区，跳过隔离判据' })
      return
    }

    /** 某个工作区的会话 id 集合（直接问宿主，不依赖页面）。 */
    const sessionsOf = async workspaceId => {
      const page = (await rpc('session.list', { workspaceId }))?.value?.items ?? []
      return new Set(page.map(item => item.sessionId ?? item.id).filter(id => typeof id === 'string'))
    }

    const [first, second] = workspaces
    const firstIds = await sessionsOf(first.id)
    const secondIds = await sessionsOf(second.id)
    const overlap = [...firstIds].filter(id => secondIds.has(id))
    check('session-sets-disjoint', overlap.length === 0, {
      first: firstIds.size,
      second: secondIds.size,
      overlap: overlap.slice(0, 3),
    })

    // ③ 页面上切过去再切回来，列表仍然有东西
    const page = await context.newPage()
    try {
      await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
      const before = await page.evaluate(() => document.querySelectorAll('.mobile-row, [data-session-id], .mobile-row-sess').length)

      await page.goto(`http://127.0.0.1:3080/m/?workspace=${encodeURIComponent(second.id)}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
      const other = await page.evaluate(() => document.querySelectorAll('.mobile-row, [data-session-id], .mobile-row-sess').length)

      await page.goto(`http://127.0.0.1:3080/m/?workspace=${encodeURIComponent(first.id)}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2500)
      const back = await page.evaluate(() => document.querySelectorAll('.mobile-row, [data-session-id], .mobile-row-sess').length)

      check('list-renders-after-switch', before > 0 && back > 0, { before, other, back })
      // 两个工作区行数不该"完全一样到可疑"——真不同就更好；相同也不算错（可能恰好都空）
      check('switch-does-not-blank', back > 0, { back })
      void WORKSPACE
    } finally {
      await page.close()
    }
  },
}
