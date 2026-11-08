/**
 * 排队投影（inbox）的现读节流与读取实现（P2：从 mobile-api.ts 前置搬出）。
 *
 * 两条对账方向都必须覆盖：
 * - 快照里还有待发项 → 要盯着它被宿主认领（否则卡片永远挂「排队中」）；
 * - 快照里是空的 → 也要（更慢地）现读，因为桌面可能在手机看不到的地方新排了消息，
 *   而快照不会因为队列变化而刷新。
 *
 * @module dsh-palm/mobile/api/inbox-fresh
 */
import { RpcId } from '../../api-proxy-types.ts'
import { processState } from './process-state.ts'

/** 待发投影的现读节流：手机上每 5 秒轮询一次，宿主这边最多 4 秒真读一次。 */
const INBOX_FRESH_INTERVAL_MS = 4_000
/** 快照里没有待发项时的更慢轮询间隔。 */
const INBOX_EMPTY_FRESH_INTERVAL_MS = 3_000

/** 每个会话上一次真读的时间（节流用）。 */
const inboxFreshAt = new Map<string, number>()

/** 是否需要现读一次会话的排队投影。 */
export function shouldRefreshInbox(
  inbox: unknown,
  now: number,
  lastFreshAt: number | null,
  intervalMs: number = INBOX_FRESH_INTERVAL_MS,
  emptyIntervalMs: number = INBOX_EMPTY_FRESH_INTERVAL_MS,
): boolean {
  const rows = (inbox as { 'next-turn'?: unknown } | null | undefined)?.['next-turn']
  const pending = Array.isArray(rows) && rows.length > 0
  if (lastFreshAt === null) return true
  return now - lastFreshAt >= (pending ? intervalMs : emptyIntervalMs)
}

/** 读一个会话的排队投影；快照不可信时按节流现读一次。 */
export async function readInboxProjection(
  proxy: { sessions: { history: (request: never) => Promise<unknown> } },
  sessionId: string,
  wantsFresh: boolean,
): Promise<unknown> {
  let inbox: unknown = processState.sessionProjectionSnapshots.get(sessionId)?.block.values?.['inbox']
  // 快照里还挂着待发项时不能信它：那一项可能早就被宿主投递出去了（投递不改这份
  // 快照），手机端就会一直显示一条已经发出去的排队消息。此时现读一次，带节流。
  const autoFresh = shouldRefreshInbox(inbox, Date.now(), inboxFreshAt.get(sessionId) ?? null)
  if (autoFresh) inboxFreshAt.set(sessionId, Date.now())
  if (wantsFresh || autoFresh) {
    try {
      const page = await proxy.sessions.history({
        rpcId: RpcId('dsh-palm-mobile-inbox'),
        payload: { sessionId, maxMessages: 1, fresh: true },
      } as never) as { result: { ok: boolean; value?: unknown } }
      if (page.result.ok) {
        const values = (page.result.value as { projections?: { values?: Record<string, unknown> } }).projections?.values
        if (values?.['inbox'] !== undefined) inbox = values['inbox']
      }
    } catch {
      // 读不到就用快照，卡片显示旧一点总比不显示好。
    }
  }
  return inbox
}
