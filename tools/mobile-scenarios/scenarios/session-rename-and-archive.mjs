/**
 * S31 会话管理：重命名 / 归档（manual）。
 *
 * 守的格子：J7×D（数据一致）、J7×U（可操作）、J7×I9（失败可举证）。
 *
 * 用户场景：把一条会话改个名、再归档掉 —— 列表要**跟着变**。
 * 这里**自建一条临时会话**（跑完自己归档），绝不碰 runner 的专用测试会话。
 *
 * 2026-11-01 实测校准：
 *   · 空白标题被宿主拒绝（`session/title-invalid`）；
 *   · 改名后列表 **1.8 秒**就跟上了（之前的 20 秒假红是"边跑边改名、自动标题盖回来"）；
 *   · 归档后立刻不在活跃列表。
 */
import { listUrl, rpc, sleep } from '../lib/env.mjs'

export const scenario = {
  id: 'session-rename-and-archive',
  manual: true,
  title: '重命名/归档：宿主与列表同步，非法输入要拒绝',
  async run(ctx) {
    const { context, check, workspaceId } = ctx
    const created = await rpc('session.create', { workspaceId })
    const sessionId = created?.value?.sessionId ?? created?.sessionId
    check('temp-session-created', typeof sessionId === 'string' && sessionId !== '', { sessionId })
    if (typeof sessionId !== 'string' || sessionId === '') return

    // 名字要短：列表行标题会截断，长名字永远匹配不上
    const newName = `PT${Date.now() % 100000}`
    const page = await context.newPage()
    try {
      // 先让它有内容：列表只列有内容的会话
      await rpc('session.prompt', {
        sessionId,
        content: [{ type: 'text', text: '[palm-e2e] 只回"好"，不要用工具。' }],
      })
      // **必须等这一轮真的收工再改名**：宿主收工时会用首条消息生成自动标题，
      // 改早了会被它盖回去（实测：列表里始终是自动标题，看起来像"改名没生效"）。
      for (let i = 0; i < 240; i += 1) {
        await sleep(1000)
        const roster = await rpc('mobile.runningSessions', {})
        if (!(roster?.value?.sessionIds ?? []).includes(sessionId)) break
      }
      await sleep(1200)

      // ① 空白标题被拒绝
      const blank = await rpc('session.rename', { sessionId, title: '   ' })
      check('rename-rejects-empty-title', blank?.ok === false && /title|invalid/i.test(blank?.error?.code ?? ''), {
        code: blank?.error?.code,
      })

      // ② 列表页先打开，再改名 —— 量它多久跟上（这才是用户看到的界面）
      await page.goto(listUrl(), { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)

      const renamedAt = Date.now()
      const renamed = await rpc('session.rename', { sessionId, title: newName })
      check('rename-applies-new-title', renamed?.value?.title === newName, { returnedTitle: renamed?.value?.title })

      // 界面能否看到：列表是虚拟滚动的，40 条会话里这条不一定在可视区，
      // 用 innerText 判会假红（实测：同一步在独立探针里 1.8 秒就能看到）。
      // 所以这里判**宿主返回给列表的那份数据**，界面渲染由 search-and-jump /
      // long-session-window 那两个场景负责。
      let listedTitle = ''
      for (let i = 0; i < 40; i += 1) {
        await sleep(250)
        const listed = await rpc('session.list', { workspaceId })
        const row = (listed?.value?.items ?? []).find(item => (item.sessionId ?? item.id) === sessionId)
        listedTitle = row?.projections?.values?.title ?? ''
        if (listedTitle === newName) break
      }
      check('list-data-shows-renamed-title', listedTitle === newName, {
        listedTitle,
        elapsedMs: Date.now() - renamedAt,
      })

      // ③ 归档后不在活跃列表
      await rpc('workspace.archiveSession', { sessionId })
      await sleep(800)
      const alive = (await rpc('session.list', { workspaceId }))?.value?.items ?? []
      check('archived-session-leaves-list', alive.some(item => (item.sessionId ?? item.id) === sessionId) === false, {
        listed: alive.length,
      })
    } finally {
      await page.close()
      await rpc('workspace.archiveSession', { sessionId }).catch(() => undefined)
    }
  },
}
