/**
 * 场景压测的**共享判据**。
 *
 * 这一周的疑难杂症（重复过程卡、过程条消失、交付卡提前出现、卡片被改写、
 * 灰点不变绿、假失败）没有一个是"单次操作断言"能抓到的 —— 它们都在
 * "某个顺序 + 某个中间态"里。所以判据集中写在这里，场景只负责编排步骤。
 *
 * 每条判据都对应一个真机现场，改动前先看注释里的现场描述。
 */

/** 采一帧聊天页现场。 */
export async function sampleChat(page) {
  return await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.chat-turn-tail')]
    const rows = window.__palmRows ?? []
    const withProcess = rows.filter(row => row.kind === 'assistant' && (
      (row.tools?.length ?? 0) > 0 || (row.flow?.length ?? 0) > 0 || (row.reasoning ?? '') !== ''
    ))
    // 只算**当前这一页**：切页动画期间旧页仍挂在 DOM 里（`.page-exit-*`），
    // 两页渲染同一条会话时同一个 id 会同时出现两份 —— 那是滑动转场，不是缺陷。
    // 2026-11-01 实测：转场 120~550ms 内两页并存，之后旧页卸载。
    const ids = [...document.querySelectorAll('[data-message-id]')]
      .filter(el => el.closest('[class*=page-exit]') === null)
      .map(el => el.getAttribute('data-message-id'))
  const dupSamples = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].slice(0, 4)
    const scroller = document.scrollingElement ?? document.documentElement
    return {
      rows: document.querySelectorAll('[data-message-id]').length,
      modelRows: rows.length,
      domDuplicateIds: ids.length - new Set(ids).size,
    domDuplicateSamples: dupSamples,
    scrollers: document.querySelectorAll('.chat-scroll').length,
    chats: document.querySelectorAll('.chat-input').length,
      proc: document.querySelectorAll('.chat-proc').length,
      hasProcessData: withProcess.length > 0,
      reportCards: cards.filter(card => /本轮产出/.test(card.textContent ?? '')).length,
      // 按"轮"记卡片内容，**取数据层而不是 DOM 下标**：
      //   ① 卡片列表会随历史补页增长（实测 4 张 → 14 张），用下标 0 比较会把
      //      "新插进来的旧卡"误判成"这张卡被改写了"；
      //   ② 数据层还能看出到底是哪一类字段在变（deliverables / produced）。
      cardTextByTurn: Object.fromEntries(rows
        .filter(row => row.kind === 'turn')
        .map(row => [
          `t${row.turn === undefined ? 'last' : row.turn}`,
          JSON.stringify({
            files: (row.deliverables ?? []).map(file => file.path),
            produced: row.produced ?? [],
          }),
        ])),
      running: /输出中|生成中|深度求索中|正在/.test(document.body.innerText ?? ''),
      gap: Math.max(0, Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)),
    }
  })
}

/** 采一帧任意页面的"单元数量"。 */
export async function sampleUnits(page, selector) {
  return await page.evaluate(sel => document.querySelectorAll(sel).length, selector)
}

/**
 * 判据：页面上没有重复的 DOM 身份（React key 撞了会丢行/重复行）。
 * 现场：同一轮两张过程卡、同一行渲染两次。
 */
export function checkNoDuplicateIds(check, snap, label) {
  check('dom-duplicate-id', snap.domDuplicateIds === 0, { label, duplicates: snap.domDuplicateIds, samples: snap.domDuplicateSamples, scrollers: snap.scrollers, chats: snap.chats })
}

/**
 * 判据：会话在跑、且数据里确实有过程内容时，屏幕上必须有过程条。
 * 现场：2026-10-31 反复出现的"过程条消失，只剩左侧时间"。
 */
export function checkProcessVisibleWhileRunning(check, snap, label) {
  if (!snap.running || !snap.hasProcessData) return
  check('process-card-visible', snap.proc > 0, { label, proc: snap.proc, rows: snap.rows })
}

/**
 * 判据：会话在跑时，本轮不该出现"本轮产出"交付卡。
 * 现场：会话还在跑，屏幕上先冒出一张交付结果卡。
 *
 * 允许 1 张（可能是上一轮已收工的卡留在上方），本轮新增才算违规 —— 由调用方
 * 在进入时先记一次基线，再用 checkReportCardGrew。
 */
export function reportCardBaseline(snap) {
  return snap.reportCards
}

export function checkReportCardNotGrew(check, snap, baseline, label) {
  if (!snap.running) return
  check('report-card-not-grew', snap.reportCards <= baseline, { label, baseline, now: snap.reportCards })
}

/**
 * 判据：行数不许倒退（缓存/网络页替换时最容易踩）。
 * 现场：进会话"先短后长"或列表塌一半又长回来。
 */
export function makeMonotonicGuard(check, label) {
  let max = 0
  let allowedShrinks = 0
  const startedAt = Date.now()
  return snap => {
    // 0 行 = 还在加载（两拍提交的第一拍），不是"倒退"。
    if (snap.rows === 0) return
    // 会话在跑时，尾部窗口本来就会随新行重排（一次合法的窗口收缩），
    // 不能当成"行数倒退"。真机实测：在跑的会话里严格单调会假失败 4 条。
    if (snap.running === true) {
      max = Math.max(max, snap.rows)
      return
    }
    // 进会话头 3 秒里允许**一次**任意幅度的回落：这是"缓存页 → 权威页"的合法替换
    // （实测 132 行缓存页被 61 行的权威页换掉，不是数据回退）。
    // 3 秒之后任何回落、以及头 3 秒里的第二次回落，都算不稳定。
    if (snap.rows < max) {
      const inEntryPhase = Date.now() - startedAt < 3000
      if (inEntryPhase && allowedShrinks === 0) {
        allowedShrinks += 1
      } else {
        check('rows-monotonic', false, { label, from: max, to: snap.rows, entryPhase: inEntryPhase })
      }
    }
    max = Math.max(max, snap.rows)
  }
}

/**
 * 判据：卡片文案不许被改写（猜卡被真卡替换的现场）。
 */
export function makeCardTextGuard(check, label, { graceMs = 0 } = {}) {
  const startedAt = Date.now()
  const previousByTurn = new Map()
  return snap => {
    const entries = Object.entries(snap.cardTextByTurn ?? {})
    // 会话**正在跑**时不判：这一轮还在产出，卡片本来就该跟着变（只读会话常常
    // 就是用户自己那条在跑的会话）。收工之后文案必须稳定。
    if (snap.running === true) return
    // 宽限期内允许一次"猜卡 → 真卡"的收敛（内容可能不全，真卡一到就替换）。
    const inGrace = Date.now() - startedAt < graceMs
    for (const [turn, current] of entries) {
      const previous = previousByTurn.get(turn)
      if (!inGrace && previous !== undefined && previous !== current) {
        check('card-text-stable', false, { label, turn, from: previous, to: current })
      }
      previousByTurn.set(turn, current)
    }
  }
}

/** 判据：贴底（聊天页稳定后必须停在最新一条）。 */
export function checkPinnedToBottom(check, snap, label) {
  if (snap.rows === 0) return
  check('pinned-to-bottom', snap.gap <= 4, { label, gap: snap.gap })
}
