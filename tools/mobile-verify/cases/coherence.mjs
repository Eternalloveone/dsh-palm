/**
 * 画面自洽（coherence 组）：这一屏作为一个整体必须成立。
 *
 * 这里不测"某个入口的某个 bug"，而测**四条不变量**——真机上"莫名其妙的画面"
 * （2026-11-14 19:52：新建会话里挂着一张上一场的交付卡 + 「还没有消息」）全都落在
 * 这四条里。以后每修一条同类问题，就在这一组加一条自洽断言，而不是只加那个入口的用例。
 *
 * 1. 有卡 ⇒ 屏上一定有正文（卡不能是唯一有内容的东西）
 * 2. 卡与空态互斥（「还没有消息」和卡不同屏）
 * 3. 「加载更早」不挂在空列表上
 * 4. 卡的归属戳 = 当前会话（跨会话串味一眼可见）
 */
import { chatMetrics } from '../lib/harness.mjs'

/** 页面侧取一次"画面五元组"：正文 / 卡 / 空态 / 更早 / 当前会话。 */
const coherenceOf = page =>
  page.evaluate(() => {
    const cardNode = document.querySelector('.chat-turn-tail-row, .chat-turn-tail')
    const older = document.querySelector('.chat-load-older')
    const typingNode = document.querySelector('.chat-typing')
    // 当前会话 id：状态条/行上的 data 属性和 URL 都带；取 URL 里 /s/<id> 或 ?session=
    const match = /\/s\/([^/?#]+)/.exec(location.pathname + location.search)
      ?? /[?&]session=([^&#]+)/.exec(location.search)
    return {
      bodies: document.querySelectorAll('.chat-md-body').length,
      msgs: document.querySelectorAll('.chat-msg').length,
      // 只数真正的消息行：尾部槽位自己也有 data-message-id（turn-tail:N），算进去会把
      // "空列表"伪装成"有行"，第 3 条不变量就失效了。
      rows: [...document.querySelectorAll('[data-message-id]')]
        .filter(node => !(node.getAttribute('data-message-id') ?? '').startsWith('turn-tail:')).length,
      cards: document.querySelectorAll('.chat-turn-tail, .chat-turn-tail-row').length,
      cardOwner: cardNode === null ? null : cardNode.getAttribute('data-owner'),
      typing: typingNode === null ? null : (typingNode.textContent ?? '').trim(),
      older: older !== null,
      sessionId: match === null ? null : decodeURIComponent(match[1]),
    }
  })

/** 四条不变量；任何一条不成立就抛（detail 带当时的五元组，方便复现）。 */
function assertCoherent(ctx, state, where) {
  const brief = JSON.stringify(state)
  // 正文 = 有正文块（助手结论）或至少有画出来的消息行：只数 .chat-md-body 会把
  // "只有过程/只有图片"的会话误判成空。
  const content = state.bodies + state.msgs
  ctx.assert(!(state.cards > 0 && content === 0), `${where}：有卡却一行正文都没有（${brief}）`)
  ctx.assert(!(state.cards > 0 && state.typing !== null), `${where}：卡和「还没有消息」同屏（${brief}）`)
  ctx.assert(!(state.older && state.rows === 0), `${where}：「加载更早」挂在空列表上（${brief}）`)
  if (state.cardOwner !== null && state.sessionId !== null) {
    ctx.equals(state.cardOwner, state.sessionId, `${where}：卡的归属戳不是当前会话`)
  }
}

/** 反复采样一小段时间：竞态窗口里的"坏帧"也算失败。 */
async function sampleFor(ctx, page, where, ms = 1_600) {
  const deadline = Date.now() + ms
  let sampled = 0
  while (Date.now() < deadline) {
    assertCoherent(ctx, await coherenceOf(page), `${where}（第 ${sampled + 1} 帧）`)
    sampled += 1
    await page.waitForTimeout(120)
  }
  return sampled
}

/** 打开抽屉，列出会话行。 */
async function openDrawer(ctx, page) {
  await page.getByRole('button', { name: '会话抽屉' }).first().click({ timeout: 15_000 })
  await page.waitForTimeout(1_200)
  const rows = await page.evaluate(() => document.querySelectorAll('.palm-drawer-rows li').length)
  ctx.atLeast(rows, 1, '抽屉里的会话行数')
  return rows
}

export default [
  {
    id: 'coherence.chat-entry',
    group: 'coherence',
    surface: 'chat',
    title: '进会话之后 1.6 秒内每 120ms 采一帧：卡/正文/空态/更早必须自洽',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const frames = await sampleFor(ctx, page, '进会话')
      const m = await chatMetrics(page)
      return `frames=${frames} rows=${m.rows} cards=${m.cards}`
    },
  },
  {
    id: 'coherence.session-switch',
    group: 'coherence',
    surface: 'chat',
    title: '换会话（抽屉点第二行）期间不出现上一场的卡/空态错配',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      const rows = await openDrawer(ctx, page)
      if (rows < 2) ctx.skip('这个工作区只有一个会话')
      await page.locator('.palm-drawer-rows li').nth(1).click({ timeout: 15_000 })
      const frames = await sampleFor(ctx, page, '换会话')
      const state = await coherenceOf(page)
      return `frames=${frames} ${JSON.stringify(state)}`
    },
  },
  {
    id: 'coherence.new-session',
    group: 'coherence',
    surface: 'chat',
    title: '新建会话：空列表上不许挂卡、不许挂「加载更早」',
    async run(ctx, { page }) {
      await ctx.waitForChatRows(page)
      await openDrawer(ctx, page)
      await page.locator('.palm-drawer-new').first().click({ timeout: 15_000 })
      const frames = await sampleFor(ctx, page, '新建会话')
      const state = await coherenceOf(page)
      // 新建会话必须是"干净的"：0 行、0 卡、不显示更早。
      ctx.atMost(state.cards, 0, '新建会话里的交付卡数')
      ctx.assert(state.older === false, `新建会话里出现了「加载更早的消息」（${JSON.stringify(state)}）`)
      // 用例自己收尾：把这次建出来的空会话归档，别在用户的抽屉里留垃圾。
      if (state.sessionId !== null) {
        await page.evaluate(async id => {
          await fetch('/m/api/workspace.archiveSession', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'client-request',
              rpcId: `coherence-${Date.now()}`,
              method: 'workspace.archiveSession',
              payload: { sessionId: id },
            }),
          })
        }, state.sessionId).catch(() => undefined)
      }
      return `frames=${frames} typing=${state.typing ?? '—'} created=${state.sessionId ?? '未知'}`
    },
  },
]
