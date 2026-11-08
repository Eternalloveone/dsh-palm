/**
 * 宿主 RPC 小客户端：只用于「找 fixture」与「对账宿主真值」。
 *
 * 手机端的每个读接口都是 `POST /m/api/<method>`，体是 client-request 信封，
 * 回包 `result.ok === true` 时真值在 `result.value`。
 */

/** 一个会话条目里我们关心的字段（宿主版本不同，字段可能缺，全部按可选处理）。 */
export const pickSessionId = row =>
  typeof row === 'object' && row !== null
    ? row.sessionId ?? row.id ?? row.session?.id
    : undefined

export function createRpc({ base, pair }) {
  let seq = 0
  const call = async (method, payload = {}) => {
    seq += 1
    const response = await fetch(`${base}/m/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `dsh_pair=${pair}` },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: `verify-${seq}`,
        method,
        payload,
      }),
    })
    const body = await response.json().catch(() => undefined)
    const result = body?.result
    if (result?.ok !== true) {
      throw new Error(`${method} 失败：${JSON.stringify(result?.error ?? body).slice(0, 200)}`)
    }
    return result.value
  }
  return { call }
}

/**
 * 找 fixture：一个工作区、一个「长会话」（用来验证翻历史）、在跑的会话（验证实时状态）。
 *
 * 全部按「宿主真值 + 兜底默认」来，找不到就退回环境变量/默认值，不让验收脚本因为
 * 某台机器上恰好没有在跑的会话而整体挂掉（那种情况只跳过相应用例）。
 */
export async function discoverFixtures({ rpc, fallback }) {
  const fixtures = { ...fallback, running: [] }

  // 工作区：手机端的 workspace 列表接口在各版本名字不同，逐个试。
  const workspaceCandidates = ['mobile.workspaces', 'mobile.listWorkspaces', 'workspace.list']
  for (const method of workspaceCandidates) {
    try {
      const value = await rpc.call(method, {})
      const rows = value?.workspaces ?? value?.rows ?? value?.items ?? (Array.isArray(value) ? value : [])
      const first = rows?.[0]
      const id = first?.workspaceId ?? first?.id
      if (typeof id === 'string' && id !== '') {
        fixtures.workspaceId = fixtures.workspaceId ?? id
        break
      }
    } catch {
      // 这个方法不存在：试下一个
    }
  }

  // 在跑的会话
  try {
    const running = await rpc.call('mobile.runningSessions', {})
    const ids = Array.isArray(running?.sessionIds) ? running.sessionIds : []
    fixtures.running = ids.filter(id => typeof id === 'string')
  } catch {
    fixtures.running = []
  }

  // 长会话：按会话列表里的「消息数/轮次」挑最大的那个（决定翻页用例测哪条）。
  try {
    const page = await rpc.call('session.list', { workspaceId: fixtures.workspaceId })
    const rows = page?.sessions ?? page?.rows ?? page?.items ?? []
    const scored = rows
      .map(row => ({
        id: pickSessionId(row),
        weight: Number(row.messageCount ?? row.messages ?? row.turns ?? row.rowCount ?? 0) || 0,
        updatedAt: Number(row.updatedAt ?? row.updated ?? 0) || 0,
      }))
      .filter(row => typeof row.id === 'string' && row.id !== '')
      .sort((a, b) => (b.weight - a.weight) || (b.updatedAt - a.updatedAt))
    // 优先挑「没在跑」的长会话：正在流式输出的那条会不断追加行，翻页/搜索类用例会
    // 因为窗口被改而间歇失败（实测：同一套用例在我这一轮正在跑时红，空闲时全绿）。
    // 空闲 + **够长**：翻页/滚动用例需要一条真能翻的会话（实测换到一条很短的
    // 空闲会话后，「加载更早」根本没有可翻的内容）。20 行是经验下界。
    const MIN_ROWS = 20
    // 注意：本宿主的 session.list **不返回消息数**，weight 恒为 0 —— 只按 weight 挑等于
    // 没挑，实测会落到一条 4 行的会话上，于是「进会话落在最新位置」直接判失败
    // （rows > 5 不成立）。所以按 updatedAt 从新到旧**真去数**行数，够长就用它。
    const quietOrdered = scored
      .filter(row => !fixtures.running.includes(row.id))
      .sort((a, b) => (b.weight - a.weight) || (b.updatedAt - a.updatedAt))
    // 注意：raw 行数会**高估**长短 —— 一条回复常被拆成几十个 assistant 片段，
    // 合并成一行后页面可能只有 4 行（实测 session-3dac00：raw 28 行 → 屏幕上 4 行）。
    // 所以判据取「真对话行（user/assistant）」并要求至少 MIN_ROWS，别用总行数。
    const measure = async row => {
      try {
        const page = await rpc.call('mobile.readChat', { sessionId: row.id, maxRows: 120 })
        const items = page?.rows ?? page?.messages ?? []
        return items.filter(item => item?.kind === 'user' || item?.kind === 'assistant').length
      } catch {
        return 0
      }
    }
    let longQuiet = []
    for (const row of quietOrdered.slice(0, 15)) {
      if (row.weight >= MIN_ROWS) { longQuiet.push(row); continue }
      if (await measure(row) >= MIN_ROWS) longQuiet.push(row)
      if (longQuiet.length >= 3) break
    }
    /**
     * 能力探针（2026-10-31）：用例不只需要"长会话"，还需要特定的**内容形态** ——
     *   · cards.* 需要一条带交付卡的会话；
     *   · scroll.load-older-appends 需要"还有更早消息"（hasMore）；
     *   · search.chat-in-session 固定搜「编译」，那条会话里得真出现这两个字；
     *   · composer.context-ring 需要会话已有上下文统计。
     * 以前只按"长 + 空闲"挑，7 条用例因此一直红（全是 fixture 不足，不是产品问题）。
     * 这里对前 10 个候选各读一次尾页，按需要的形态打分，挑最高的那条。
     */
    const capabilitiesOf = async id => {
      try {
        const page = await rpc.call('mobile.readChat', { sessionId: id, maxRows: 40 })
        const rows = Array.isArray(page?.rows) ? page.rows : []
        const text = rows.map(row => String(row?.text ?? '')).join(' ')
        // 上下文环要有真数值：它来自尾页投影 contextPressure（用例读的是"上下文 N%"）。
        const pressure = page?.contextPressure
        const context = pressure !== undefined && pressure !== null
          && Number(pressure.used ?? pressure.usedTokens ?? 0) > 0
        return {
          rows: rows.length,
          hasMore: page?.hasMore === true,
          delivery: rows.some(row => (row?.deliverables?.length ?? 0) > 0),
          compiling: text.includes('编译'),
          context,
        }
      } catch {
        return { rows: 0, hasMore: false, delivery: false, compiling: false }
      }
    }
    let bestFixture = null
    for (const candidate of quietOrdered.slice(0, 10)) {
      const caps = await capabilitiesOf(candidate.id)
      const score = (caps.delivery ? 3 : 0) + (caps.hasMore ? 3 : 0)
        + (caps.compiling ? 2 : 0) + (caps.context ? 2 : 0) + (caps.rows >= 20 ? 1 : 0)
      if (bestFixture === null || score > bestFixture.score) {
        bestFixture = { id: candidate.id, score, caps }
      }
      if (score >= 11) break // 全都有：不必再试
    }
    if (bestFixture !== null) fixtures.fixtureWhy = bestFixture

    const quiet = longQuiet.length > 0 ? longQuiet : quietOrdered
    const preferred = quiet.length > 0 ? quiet : scored
    // 兜底默认值（fallback）在这里通常已经填过一个 sessionId，如果只在 undefined 时挑，
    // 这段等于死代码：实测整套用例一直跑在那条默认的**短会话**上（4 行），
    // 「进会话落在最新位置」因此判 rows > 5 不成立。
    // 除非调用者用 PALM_SESSION 明确点名，否则一律换成现场数出来的「长且空闲」会话。
    const explicitSession = process.env.PALM_SESSION !== undefined && process.env.PALM_SESSION !== ''
    if (!explicitSession && bestFixture !== null) fixtures.sessionId = bestFixture.id
    else if (!explicitSession && preferred[0] !== undefined) fixtures.sessionId = preferred[0].id
    else if (preferred[0] !== undefined && fixtures.sessionId === undefined) fixtures.sessionId = preferred[0].id
    // 兜底值（配置里的默认会话）如果**正在跑**，也换到一条空闲的长会话：
    // 翻页/搜索/长按这些用例对时序敏感，而正在流式输出的会话会不断追加行、
    // 把窗口与滚动状态改掉（实测同一套用例因此间歇失败）。实时相关的用例另有
    // `fixtures.running`，不受这里影响。
    if (fixtures.sessionId !== undefined && fixtures.running.includes(fixtures.sessionId) && quiet[0] !== undefined) {
      fixtures.sessionId = quiet[0].id
    }
    fixtures.longSessionId = scored[0]?.id ?? fixtures.sessionId
    fixtures.sessions = scored.map(row => row.id)
  } catch {
    fixtures.longSessionId = fixtures.sessionId
  }

  return fixtures
}

/** 读会话尾页（用例里用来对账「屏幕上一条 = 宿主一轮」这类断言）。 */
export async function readTail(rpc, sessionId, maxRows = 24) {
  const page = await rpc.call('mobile.readChat', { sessionId, maxRows })
  return Array.isArray(page?.rows) ? page.rows : []
}
