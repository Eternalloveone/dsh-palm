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
import { liveInboxOf, queueItemsOf, queueRevisionOf, queueTokenOf } from '../../host/queue-inbox.ts'
import { computeTurnState } from '../../host/running-evidence.ts'
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
  const body = parsed.payload as { sessionId?: unknown; fresh?: unknown } | undefined
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
  const turnState = async (): Promise<{ running: boolean; turnStartAt?: number; lastEventAt?: number; asOf: number }> => {
    try {
      return await computeTurnState(sessionId)
    } catch {
      return { running: false, asOf: Date.now() }
    }
  }
  const [page, inbox, turn, goalView] = await Promise.all([
    readChatTailPage(sessionId),
    (async () => liveInboxOf(deps as never, sessionId)
      ?? await readInboxProjection(proxy, sessionId, wantsFreshQueue).catch(() => undefined))(),
    turnState(),
    // 目标与待办也在这张切面上：客户端不用再单独轮询 mobile.goal，
    // 目标条与回合状态也就不会出现「一个说进行中、一个说已结束」。
    readGoalProjection(proxy, deps, sessionId, wantsFreshQueue)
      .catch((): { goal: unknown; activation?: 'armed' | 'disarmed' } => ({ goal: null })),
  ])
  if (page === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'unavailable', message: '会话状态不可读' } },
    })
    return
  }
  const queueItems = queueItemsOf(inbox as never)
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: {
      ok: true,
      value: {
        sessionId,
        rows: page.rows,
        maxSeq: page.maxSeq,
        queue: queueItems,
        queueRevision: queueRevisionOf(sessionId),
        queueToken: queueTokenOf(queueItems),
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
