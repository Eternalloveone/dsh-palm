/**
 * **轮次报告的回读与缺卡诊断**（W3：从 `ChatView.tsx` 抽出的第三批）。
 *
 * 「回读」有个反直觉的点：**按条数截断拿不到回合起点**。一个跑了 40 步的回合，翻一页
 * 25 条只拿到后半段，报告卡就永远缺前半。所以每一轮都要翻到 `turn/start` 为止。
 *
 * 「缺卡诊断」是手机端唯一能把真实载荷送出来的通道（真机上没有 console）：只写不带路径，
 * 由宿主命名落盘。
 *
 * @module dsh-palm/mobile/views/chat/chat-turn-report
 */
import { reportPerf } from '../../../data/diag.ts'
import { history } from '../../../data/session.ts'
import { foldEvents, type RenderMessage, type WireEvent } from '../../../messages.ts'

/**
 * Rows → rendered list: dedupe the same turn's step rows into one process card,
 * then rebuild the 「本轮产出」 card for any turn whose report row did not come
 * with the page (a folded host page / a cached page carries rows, not the
 * `turn/end` that normally creates it — see `ensureTurnTails`).
 */
/**
 * 按轮号把交付卡从日志里读出来（翻页与补读共用）。
 *
 * 一轮的卡要 `turn/end`（以及它前面的 `deliverables/presented`）。页是按行切的，
 * 长回合的 `turn/end` 常常落在**下一页**里，于是那一页自己没有卡。
 *
 * 这里往回读到每一轮的起点为止，折出这些轮的卡。页数有上限（`REPORT_FALLBACK_MAX_PAGES`），
 * 拿不到就返回空数组 —— 调用方按「确实没有」处理，不许拿猜的顶上。
 *
 * @param wanted - 需要的轮号集合。
 * @returns 这些轮的 turn 行（可能为空）。
 */
export async function loadTurnReportRows(
  sessionId: string,
  wanted: readonly number[],
): Promise<RenderMessage[]> {
  if (wanted.length === 0) return []
  const wantedSet = new Set(wanted)
  let accumulated: WireEvent[] = []
  let cursor: number | undefined
  for (let index = 0; index < REPORT_FALLBACK_MAX_PAGES; index++) {
    const raw = await history(sessionId, cursor, REPORT_FALLBACK_PAGE_MESSAGES)
    const events = raw.events.map(entry => (entry.view === undefined
      ? entry.event
      : { ...entry.event, view: entry.view })) as WireEvent[]
    if (events.length === 0) break
    accumulated = [...events, ...accumulated]
    // 每一轮都要翻到它自己的起点：按条数截断只会拿到回合后半段。
    const started = new Set<number>()
    for (const event of accumulated) {
      if (event.type !== 'turn/start') continue
      const data = event.data as Record<string, unknown> | undefined
      const turn = typeof data?.['turn'] === 'number' ? data['turn'] : undefined
      if (turn !== undefined) started.add(turn)
    }
    if ([...wantedSet].every(turn => started.has(turn))) break
    const firstSeq = events[0]?.seq
    if (!raw.hasMore || firstSeq === undefined || firstSeq === cursor) break
    cursor = firstSeq
  }
  return foldEvents(accumulated).filter((row: RenderMessage) => (
    row.kind === 'turn' && row.turn !== undefined && wantedSet.has(row.turn)
  ))
}

/**
 * Report what a page actually looked like when its report card could not be
 * produced. The host writes this next to its perf captures and names the file
 * itself (see `reportPerf`), so this is write-only and path-free — and it is the
 * only way to see the phone's real payload without a device console.
 */
export function reportCardDiagnostic(
  rows: readonly RenderMessage[],
  missing: readonly number[],
  attempt: { pages: number; whole: boolean; source?: 'network' | 'cache' },
): void {
  const brief = rows.slice(-40).map(row => ({
    id: row.id,
    kind: row.kind,
    turn: row.turn ?? null,
    seq: row.seq,
    text: (row.text ?? '').length,
    tools: (row.tools ?? []).map(tool => ({
      name: tool.name,
      state: tool.state,
      args: (tool.arguments ?? '').length,
      view: tool.view !== undefined,
    })),
    deliverables: row.deliverables?.length ?? 0,
    produced: (row.produced ?? []).slice(0, 6),
  }))
  try {
    void reportPerf({
      stamps: [{ at: Date.now(), label: 'carddiag' }],
      diagnostic: 'turn-report-missing',
      at: Date.now(),
      source: attempt.source ?? 'network',
      rowCount: rows.length,
      rows: brief,
      missing: [...missing],
      pages: attempt.pages,
      wholeTurn: attempt.whole,
    }, 'carddiag').catch(() => { /* 诊断本身失败不影响聊天 */ })
  } catch {
    // 老宿主没有这个入口时也只是少一条诊断：聊天照常。
  }
}

/**
 * 卡片缺席时回读日志的粒度与上限：每页消息数（与宿主 history 的默认页同量级）
 * 与最多翻几页。翻到那一轮的 turn/start 就停，所以多数会话只要一两页。
 */
export const REPORT_FALLBACK_PAGE_MESSAGES = 25

export const REPORT_FALLBACK_MAX_PAGES = 6

/** 交付卡补读只覆盖最近几轮：再往前的历史轮次不该在翻页时「长出来」。 */
export const REPORT_RECOVERY_WINDOW_TURNS = 2
