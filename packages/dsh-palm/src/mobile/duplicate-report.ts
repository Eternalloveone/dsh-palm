/**
 * 「同一轮出现多张过程卡」的现场取证。
 *
 * 这一批重复问题已经被修过几轮（缺 turn、缺 step、pending 行、页面行/实时行两套 id），
 * 但真机上仍偶尔出现。与其继续猜，不如在**用户真的看到它的那一刻**把当时的行数据
 * 存下来：一次一份 JSON，落到宿主的 dsh-palm-errors/ 目录，事后直接读。
 *
 * 设计约束：
 * - 只上报「疑似重复」，判据保守（同轮 + 工具调用重叠 / 正文相同 / seq 区间重叠）；
 * - 每个会话最多 1 分钟一次，避免刷屏；
 * - 上报失败一律吞掉 —— 诊断绝不能影响聊天。
 *
 * @module dsh-palm/mobile/duplicate-report
 */

/** 一行里我们关心的字段（避免把整段正文塞进报告）。 */
export interface DuplicateRowBrief {
  id: string
  kind: string
  turn: number | null
  step: number | null
  seq: number
  startSeq: number | null
  pending: boolean
  textLength: number
  textHead: string
  toolCalls: string[]
}

/** 一对疑似重复的行。 */
export interface DuplicatePair {
  reason: 'same-turn-same-text' | 'shared-tool' | 'overlapping-seq'
  turn: number | null
  a: DuplicateRowBrief
  b: DuplicateRowBrief
}

/** 诊断上报的最小形状（与 mobile.error 的入参一致）。 */
export interface DuplicateReportSink {
  (report: { kind: string; rows: DuplicateRowBrief[]; pairs: DuplicatePair[]; sessionId: string; at: number }): void
}

const ROW_MAX = 24
const TEXT_HEAD = 40

function brief(row: {
  id: string
  kind: string
  turn?: number
  step?: number
  seq: number
  startSeq?: number
  pending?: boolean
  text?: string
  tools?: readonly { callId: string }[]
}): DuplicateRowBrief {
  return {
    id: row.id.slice(0, 40),
    kind: row.kind,
    turn: row.turn ?? null,
    step: row.step ?? null,
    seq: row.seq,
    startSeq: row.startSeq ?? null,
    pending: row.pending === true,
    textLength: (row.text ?? '').length,
    textHead: (row.text ?? '').replace(/\s+/g, ' ').slice(0, TEXT_HEAD),
    toolCalls: (row.tools ?? []).map(tool => tool.callId).slice(0, 12),
  }
}

/**
 * 找出屏幕上「本该是一张卡却成了两张」的助手行对。
 *
 * 判据（任一命中即算）：
 * 1. 同一轮 + 正文相同（>=16 字）—— 重试/分片重放；
 * 2. 工具调用有交集 —— 同一次调用的两份；
 * 3. seq 区间重叠且同轮 —— 页面窗口与实时流各画了一份。
 */
export function findDuplicateCards(
  rows: readonly {
    id: string
    kind: string
    turn?: number
    step?: number
    seq: number
    startSeq?: number
    pending?: boolean
    text?: string
    tools?: readonly { callId: string }[]
  }[],
): DuplicatePair[] {
  const pairs: DuplicatePair[] = []
  const assistants = rows.filter(row => row.kind === 'assistant')
  for (let i = 0; i < assistants.length; i += 1) {
    for (let j = i + 1; j < assistants.length; j += 1) {
      const a = assistants[i]!
      const b = assistants[j]!
      const sameTurn = a.turn !== undefined && a.turn === b.turn
      const textA = (a.text ?? '').replace(/\s+/g, ' ').trim()
      const textB = (b.text ?? '').replace(/\s+/g, ' ').trim()
      const toolsA = new Set((a.tools ?? []).map(tool => tool.callId))
      const sharedTool = (b.tools ?? []).some(tool => toolsA.has(tool.callId))
      const aMin = a.startSeq ?? a.seq
      const aMax = a.seq
      const bMin = b.startSeq ?? b.seq
      const bMax = b.seq
      const overlapSeq = aMax >= bMin && bMax >= aMin && a.id !== b.id
      let reason: DuplicatePair['reason'] | undefined
      // 判据分两层：
      //   · 强证据（与轮号无关）—— 同一次工具调用出现在两行，或两行的 seq 区间重叠。
      //     一次工具调用只有一个 callId，一份数据只有一个 seq 区间，重复就是重复。
      //     真机上「页面快照行」和「实时流行」正是同一 seq 的两份，之前这里要求同轮才算，
      //     于是一边有轮号、一边没有时被漏掉（现场一个报告都没收到）。
      //   · 弱证据（要求同轮）—— 正文完全相同。不同轮说同样的话是正常内容，不能算。
      if (sharedTool) reason = 'shared-tool'
      else if (overlapSeq) reason = 'overlapping-seq'
      else if (sameTurn && textA.length >= 16 && textA === textB) reason = 'same-turn-same-text'
      if (reason === undefined) continue
      pairs.push({ reason, turn: a.turn ?? null, a: brief(a), b: brief(b) })
    }
  }
  return pairs
}

const lastReportAt = new Map<string, number>()
/** 同一会话的报告间隔。 */
export const DUPLICATE_REPORT_GAP_MS = 60_000

/**
 * 检测 + 上报（同一会话 1 分钟最多一次）。
 * @returns 命中的重复对（便于测试），没命中就是空数组。
 */
export function reportDuplicateCards(
  sessionId: string,
  rows: readonly Parameters<typeof findDuplicateCards>[0][number][],
  sink: DuplicateReportSink,
  now: number = Date.now(),
): DuplicatePair[] {
  const pairs = findDuplicateCards(rows)
  if (pairs.length === 0) return pairs
  // 注意：不能把「没上报过」当成 0 —— 那样页面刚打开的头一分钟里的第一次重复会被
  // 静默丢掉，而第一次往往正是我们要的现场。
  const last = lastReportAt.get(sessionId)
  if (last !== undefined && now - last < DUPLICATE_REPORT_GAP_MS) return pairs
  lastReportAt.set(sessionId, now)
  try {
    sink({
      kind: 'duplicate-cards',
      sessionId,
      at: now,
      rows: rows.slice(-ROW_MAX).map(brief),
      pairs: pairs.slice(0, 4),
    })
  } catch {
    // 诊断失败不影响聊天。
  }
  return pairs
}

/** 只给测试用。 */
export function resetDuplicateReporterForTest(): void {
  lastReportAt.clear()
}
