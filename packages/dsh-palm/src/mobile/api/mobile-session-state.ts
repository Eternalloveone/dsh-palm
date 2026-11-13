/**
 * `mobile.sessionState` 的实现（P2：整方法 + 两个投影读取函数一并外移）。
 *
 * 一份原子快照：行 + 队列 + 回合 + 队列版本都在同一个切面上。
 *
 * 手机端以前要三次调用（logTail / inbox / turnState）才能拼出一屏，三次落在不同
 * 时刻，于是"队列说还有一条、回合说已经开始了"这类矛盾随时可见。这里一次给全，
 * 客户端按 seq / revision 单调合并（见 mobile/session-store.ts）。
 *
 * @module dsh-palm/mobile/api/mobile-session-state
 */
import type { ServerResponse } from 'node:http'
import { RpcId } from '../../api-proxy-types.ts'
import { goalActivationOf, goalSnapshotOf, preferLiveGoal } from '../../host/commands-goals.ts'
import { liveInboxOf, queueItemsOf, queueRevisionOf, queueTokenOf, queueVersionOf } from '../../host/queue-inbox.ts'
import { computeTurnState } from '../../host/running-evidence.ts'
import { liveProjections } from '../../host/live-projections.ts'
import { writeJson } from '../../http.ts'
import { readChatTailPage } from '../../mobile-log-source.ts'
import { readInboxProjection } from './inbox-fresh.ts'
import { processState } from './process-state.ts'

/** 读目标投影：活的优先，其次枚举快照；`wantsFresh` 时再向宿主现读一次。 */
export async function readGoalProjection(
  proxy: { sessions: { history: (request: never) => Promise<unknown> } },
  deps: unknown,
  sessionId: string,
  wantsFresh: boolean,
): Promise<{ goal: unknown; activation?: 'armed' | 'disarmed' }> {
  const live = goalSnapshotOf(deps as never, sessionId)
  let goal: unknown = preferLiveGoal(live, processState.sessionProjectionSnapshots.get(sessionId)?.block.values?.['goal'])
  if (wantsFresh && live === undefined) {
    try {
      const page = await proxy.sessions.history({
        rpcId: RpcId('dsh-palm-mobile-goal'),
        payload: { sessionId, maxMessages: 1, fresh: true },
      } as never) as { result: { ok: boolean; value?: unknown } }
      if (page.result.ok) {
        const values = (page.result.value as { projections?: { values?: Record<string, unknown> } }).projections?.values
        if (values?.['goal'] !== undefined) goal = values['goal']
      }
    } catch {
      // 读不到就用快照：目标条显示旧相位，比整条消失好。
    }
  }
  const activation = goalActivationOf(deps as never, sessionId)
  return { goal: goal === undefined ? null : goal, ...(activation === undefined ? {} : { activation }) }
}

/** 处理器上下文。 */
/** 首屏最多要多少行（与 logTail 的 READ_CHAT_MAX_ROWS 同量级，防离谱入参）。 */
const ENTRY_MAX_ROWS = 400
/**
 * 首屏尾窗上限：1 MB。
 *
 * 实测（2026-11-13，本机 63.8 MB 的会话）：2 MB 窗口读一次尾部就 Allocation error，
 * 而 512 KB 就能稳稳折出 120 行（532 ms）。扩窗只是"行数不够"的兜底，收到 1 MB
 * 几乎不影响首屏，却把"客户端传个大数把宿主读爆"这条路堵死。
 */
const ENTRY_MAX_WINDOW_BYTES = 1024 * 1024
/** 首屏要带的投影键：权限选择器与上下文压力计都靠这一份基线。 */
const ENTRY_PROJECTION_KEYS = ['permissions', 'contextPressure'] as const

/**
 * 首屏投影：页里带了就用页里的；否则先问宿主投影服务（contextPressure 不进摘要），
 * 再退那宿主会话枚举留下的快照。都没有就不带，客户端保留已有基线。
 * @param sessionId - 会话 id
 * @param fromPage - 尾页自带的投影（可选）
 * @returns 可直接塞进响应的投影块；都没有时为 undefined
 */
function entryProjections(
  sessionId: string,
  fromPage: { asOfSeq?: number; values?: Record<string, unknown> } | undefined,
): { asOfSeq?: number; values?: Record<string, unknown> } | undefined {
  if (fromPage !== undefined) return fromPage
  // 摘要里没有 contextPressure（宿主把它标成 summary:false）：回落到宿主投影服务按 key 读。
  const block = liveProjections(sessionId, ENTRY_PROJECTION_KEYS)
    ?? processState.sessionProjectionSnapshots.get(sessionId)?.block
  if (block === undefined) return undefined
  const values: Record<string, unknown> = {}
  for (const key of ENTRY_PROJECTION_KEYS) {
    if (block.values?.[key] !== undefined) values[key] = block.values[key]
  }
  if (Object.keys(values).length === 0) return undefined
  return {
    ...(block.asOfSeq === undefined ? {} : { asOfSeq: block.asOfSeq }),
    values,
  }
}

/**
 * 解析首屏窗口参数并夹进安全区间。
 *
 * 客户端（尤其老版本/被改过的 PWA）可能传 0、负数、NaN、或者一个把内存读爆的大数；
 * 这里统一夹：行数 1~400，窗口 128 KB~4 MB。
 *
 * @param body - RPC payload（字段都可能缺或类型不对）
 * @returns 夹好的参数；没传的字段不出现（宿主用默认值）
 */
export function entryReadOptions(
  body: { maxRows?: unknown; windowBytes?: unknown } | undefined,
): { maxRows?: number; windowBytes?: number } {
  const rawRows = body?.maxRows
  const maxRows = typeof rawRows === 'number' && Number.isFinite(rawRows)
    ? Math.min(Math.max(1, Math.round(rawRows)), ENTRY_MAX_ROWS)
    : undefined
  const rawWindow = body?.windowBytes
  const windowBytes = typeof rawWindow === 'number' && Number.isFinite(rawWindow)
    ? Math.min(Math.max(128 * 1024, Math.round(rawWindow)), ENTRY_MAX_WINDOW_BYTES)
    : undefined
  return {
    ...(maxRows === undefined ? {} : { maxRows }),
    ...(windowBytes === undefined ? {} : { windowBytes }),
  }
}

/**
 * 尾页窗口缓存：同一会话 + 同一参数在 800ms 内复用同一份折叠结果。
 *
 * 为什么需要：冷启动时 `mobile.sessionState` 会被调好几次（队列轮询、回合对账、首屏），
 * 每次都要读文件 + 解 zstd + 折叠。宿主是单线程，实测五次并发互相排队，首屏那次 120 行
 * 要等两秒 —— 手机上就是"先几张卡、正文后到"。800ms 是"同一帧用户动作"的量级。
 */
const ENTRY_TAIL_TTL_MS = 800
interface EntryTailCacheEntry {
  at: number
  page: Awaited<ReturnType<typeof readChatTailPage>>
  maxRows?: number
  windowBytes?: number
}
const entryTailCache = new Map<string, EntryTailCacheEntry>()

/** 读尾页，命中 800ms 缓存就不重复读文件。 */
async function readEntryTail(
  sessionId: string,
  maxRows: number | undefined,
  windowBytes: number | undefined,
): Promise<Awaited<ReturnType<typeof readChatTailPage>>> {
  const now = Date.now()
  const hit = entryTailCache.get(sessionId)
  if (hit !== undefined && now - hit.at < ENTRY_TAIL_TTL_MS
    && hit.maxRows === maxRows && hit.windowBytes === windowBytes) {
    return hit.page
  }
  const page = await readChatTailPage(sessionId, maxRows, windowBytes)
  if (entryTailCache.size >= 8) entryTailCache.clear()
  entryTailCache.set(sessionId, { at: now, page, maxRows, windowBytes })
  return page
}

export interface SessionStateContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: unknown
  apiProxy: unknown
}

/** 一屏所需的全部状态：行 + 队列 + 回合 + 目标 + 版本号，同一个切面。 */
export async function mobileSessionState(ctx: SessionStateContext): Promise<void> {
  const { res, parsed, rpcId, deps } = ctx
  const proxy = ctx.apiProxy as {
    sessions: { history: (request: never) => Promise<unknown> }
  }
  const body = parsed.payload as {
    sessionId?: unknown
    fresh?: unknown
    rows?: unknown
    /** 首屏要多少行（不传就是默认的尾页大小）。 */
    maxRows?: unknown
    /** 尾部字节窗口：客户端按自己实测的进会话耗时在 512 KB / 2 MB 之间选。 */
    windowBytes?: unknown
  } | undefined
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
  if (sessionId === '') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
    })
    return
  }
  const wantsFreshQueue = body?.fresh === true
  // 回不回行（C2）：整页行是这份快照里最贵的一段（一次 129 KB），回合对账只读 `turn`。
  const wantsRows = body?.rows !== false
  // 先读尾页：行、队列投影和轮次边界都在这一份里。旧实现让 `computeTurnState`
  // 再读一遍同一个尾页（真机一次 sessionState 两次日志读），这里把边界直接传下去。
  // 夹在与 mobile.logTail 同一区间里：客户端传离谱的值不该把宿主内存读爆。
  const { maxRows, windowBytes } = entryReadOptions(body)
  const page = await readEntryTail(sessionId, maxRows, windowBytes)
  if (page === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'unavailable', message: '会话状态不可读' } },
    })
    return
  }
  const boundary = page.turnBoundary === undefined
    ? undefined
    : {
        ...page.turnBoundary,
        ...(page.lastEventAt === undefined ? {} : { lastEventAt: page.lastEventAt }),
      }
  type TurnView = { running: boolean; turnStartAt?: number; lastEventAt?: number; asOf: number }
  const [inbox, turn, goalView] = await Promise.all([
    (async () => liveInboxOf(deps as never, sessionId)
      ?? await readInboxProjection(proxy, sessionId, wantsFreshQueue).catch(() => undefined))(),
    (async (): Promise<TurnView> => {
      try {
        return await computeTurnState(sessionId, boundary)
      } catch {
        return { running: false, asOf: Date.now() }
      }
    })(),
    // 目标与待办也在这张切面上：客户端不用再单独轮询 mobile.goal，
    // 目标条与回合状态也就不会出现「一个说进行中、一个说已结束」。
    readGoalProjection(proxy, deps, sessionId, wantsFreshQueue)
      .catch((): { goal: unknown; activation?: 'armed' | 'disarmed' } => ({ goal: null })),
  ])
  const queueItems = queueItemsOf(inbox as never)
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: {
      ok: true,
      value: {
        sessionId,
        ...(wantsRows ? { rows: page.rows } : {}),
        maxSeq: page.maxSeq,
        hasMore: page.hasMore,
        ...(entryProjections(sessionId, page.projections) === undefined
          ? {}
          : { projections: entryProjections(sessionId, page.projections) }),
        queue: queueItems,
        queueRevision: queueRevisionOf(sessionId),
        queueToken: queueTokenOf(queueItems),
        queueVersion: queueVersionOf(sessionId),
        ...(page.todo === undefined ? {} : { todo: page.todo }),
        goal: goalView.goal,
        ...(goalView.activation === undefined ? {} : { goalActivation: goalView.activation }),
        turn: {
          running: turn.running === true,
          ...(turn.turnStartAt === undefined ? {} : { turnStartAt: turn.turnStartAt }),
          ...(turn.lastEventAt === undefined ? {} : { lastEventAt: turn.lastEventAt }),
        },
        asOf: turn.asOf ?? Date.now(),
      },
    },
  })
}
