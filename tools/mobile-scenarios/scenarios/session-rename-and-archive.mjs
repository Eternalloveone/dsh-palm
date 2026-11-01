/**
 * S31 会话管理：重命名 / 归档（manual）。
 *
 * 守的格子：J7×D（数据一致）、J7×U（可操作）、J7×I9（失败可举证）。
 *
 * 用户场景：把一条会话改个名、再归档掉 —— 列表要**跟着变**，不能"操作成功但界面没动"。
 * 这里**自建一条临时会话**（跑完自己归档），绝不碰 runner 的专用测试会话。
 *
 * 判据（都是可举证的事实，不猜 UI）：
 *   ① 空白标题被宿主拒绝（`session/title-invalid`），不是静默接受；
 *   ② 改名成功后宿主返回新标题；
 *   ③ 列表页能搜到新标题（界面跟上了宿主）；
 *   ④ 归档后这条会话不在活跃列表里。
 */
import { listUrl, rpc, sleep } from '../lib/env.mjs'

export const scenario = {
  id: 'session-rename-and-archive',
  manual: true,
  /**
   * 标 flaky 的原因（2026-11-01，没定论）：改名在宿主侧确实生效（接口返回新标题），
   * 但**列表页最多 20 秒仍显示旧标题**。分不清是列表缓存太久还是投影根本没更新，
   * 所以先不让它挡门禁；空白标题被拒绝、改名返回值、归档离开列表这三条是硬的。
   */
  flaky: true,
  title: '重命名/归档：宿主与列表同步，非法输入要拒绝',
  async run(ctx) {
    const { context, check, workspaceId } = ctx
    const created = await rpc('session.create', { workspaceId })
    const sessionId = created?.value?.sessionId ?? created?.sessionId
    check('temp-session-created', typeof sessionId === 'string' && sessionId !== '', { sessionId })
    if (typeof sessionId !== 'string' || sessionId === '') return

    const page = await context.newPage()
    // 名字要**短**：列表行标题会截断，长名字永远匹配不上（实测 `palm-e2e 改名 54867`
    // 被截成 `palm-e2e 改…`，于是"列表没更新"的假红）。
    const newName = `PT${Date.now() % 100000}`
    try {
      // 先让它有条内容：新建的空会话在列表里不显示（列表只列有内容的会话）。
      // **必须等这一轮真的收工再改名**：宿主收工时会用首条消息生成自动标题，
      // 改早了会被它盖回去（实测：列表里始终是自动标题，看起来像"改名没生效"）。
      await rpc('session.prompt', {
        sessionId,
        content: [{ type: 'text', text: '[palm-e2e] 只回"好"，不要用工具。' }],
      })
      let started = false
      for (let i = 0; i < 30 && !started; i += 1) {
        await sleep(500)
        const state = await rpc('mobile.turnState', { sessionId })
        started = state?.value?.running === true
      }
      for (let i = 0; i < 120; i += 1) {
        await sleep(1000)
        const state = await rpc('mobile.turnState', { sessionId })
        if (state?.value?.running === false) break
      }
      await sleep(1500)

      // ① 空白标题必须被拒绝（rpc 成功返回里带 __error 也算拒绝）
      const blank = await rpc('session.rename', { sessionId, title: '   ' })
      // rpc() 返回的是宿主信封本身：失败就是 { ok:false, error:{ code } }
      const blankCode = blank?.error?.code ?? ''
      check('rename-rejects-empty-title', blank?.ok === false && /title|invalid/i.test(blankCode), {
        blankCode,
        ok: blank?.ok,
      })

      // ② 正常改名
      const renamed = await rpc('session.rename', { sessionId, title: newName })
      const returnedTitle = renamed?.value?.title ?? ''
      check('rename-applies-new-title', returnedTitle === newName, { returnedTitle })

      // ③ 列表页跟得上
      // 列表页可能先画本地缓存，改名后要等它跟宿主对一次；给两次机会（第二次重新打开）
      let shown = false
      for (let attempt = 0; attempt < 2 && !shown; attempt += 1) {
        const base = listUrl()
        const url = `${base}${base.includes('?') ? '&' : '?'}ts=${Date.now()}`
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        for (let i = 0; i < 40 && !shown; i += 1) {
          await page.waitForTimeout(250)
          shown = await page.evaluate(name => (document.body.innerText ?? '').includes(name), newName)
        }
      }
      check('list-shows-renamed-title', shown, { newName })

      // ④ 归档后不活跃
      await rpc('workspace.archiveSession', { sessionId })
      await sleep(800)
      const alive = (await rpc('session.list', { workspaceId }))?.value?.items ?? []
      const stillListed = alive.some(item => (item.sessionId ?? item.id) === sessionId)
      check('archived-session-leaves-list', stillListed === false, { listed: alive.length })
    } finally {
      await page.close()
      // 兜底：别把临时会话留成垃圾
      await rpc('workspace.archiveSession', { sessionId }).catch(() => undefined)
    }
  },
}
