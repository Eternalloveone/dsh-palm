/**
 * `mobile.runningSessions` 的实现（P2：整方法外移）。
 *
 * 回答「现在哪些主会话正挂着 agent 在跑」。运行总览的徽标用它播种，
 * 这样一个在手机打开之前（或本页挂载之前）就已经开始生成的会话仍然算数——
 * 它的 turn/start 帧已经丢了，而 session.list 自己的 TTL 还可能说 running:false。
 *
 * @module dsh-palm/mobile/api/mobile-running
 */
import type { ServerResponse } from 'node:http'
import { writeJson } from '../../http.ts'
import {
  LIVE_RUNNING_RESEED_MS,
  RUNNING_SESSIONS_TTL_MS,
  liveRunningSeededAtOf,
  mobileRunningCacheOf,
  pruneRunningEvidence,
  reseedRunning,
  setMobileRunningCache,
  setRunningProxy,
  verifiedRunningSessionIds,
} from '../../host/running-evidence.ts'

/** 处理器上下文。 */
export interface RunningSessionsContext {
  res: ServerResponse
  rpcId: string
  apiProxy: unknown
}

/** 哪些主会话正在跑（一个 TTL 窗口一次宿主读；徽标不是延迟敏感的）。 */
export async function mobileRunningSessions(ctx: RunningSessionsContext): Promise<void> {
  const { res, rpcId } = ctx
  const apiProxy = ctx.apiProxy as never
  setRunningProxy(apiProxy)
  const runningCache = mobileRunningCacheOf()
  if (runningCache !== undefined && runningCache.proxy === apiProxy && Date.now() - runningCache.at < RUNNING_SESSIONS_TTL_MS) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { sessionIds: runningCache.sessionIds } },
    })
    return
  }
  // 有基线就立刻答复，过期与否都在后台刷新：手机上等一次枚举的代价是整屏
  // "运行中"迟到（冷启动实测 24.7 秒），比偶尔一份稍旧的答案糟糕。
  if (liveRunningSeededAtOf() !== 0) {
    // 答复前先清一次"很久没有任何证据"的记录。
    //
    // 2026-10-31 真机：没有任何会话在跑，工作区徽标还写着「运行中 9」——
    // 因为清理只发生在 reseed（最多 5 分钟一次）里，而徽标每几十秒就问一次，
    // 问到的一直是没清过的旧集合。这里把清理挪到答复路径上，最多晚一轮。
    pruneRunningEvidence()
    const sessionIds = await verifiedRunningSessionIds()
    setMobileRunningCache({ at: Date.now(), proxy: apiProxy, sessionIds })
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { sessionIds } },
    })
    if (Date.now() - liveRunningSeededAtOf() >= LIVE_RUNNING_RESEED_MS) void reseedRunning()
    return
  }
  try {
    // 进程启动后第一次问：现在取一次基线。之后每一次都是内存读，
    // 帧会一直把桌面端的开始/结束送进镜像。
    await reseedRunning()
    if (liveRunningSeededAtOf() === 0) throw new Error('running baseline unavailable')
    pruneRunningEvidence()
    const sessionIds = await verifiedRunningSessionIds()
    setMobileRunningCache({ at: Date.now(), proxy: apiProxy, sessionIds })
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { sessionIds } },
    })
  } catch (error) {
    console.error('mobile.runningSessions failed', error)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: '运行状态查询失败，请稍后重试' } },
    })
  }
}
