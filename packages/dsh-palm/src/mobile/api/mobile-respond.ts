/**
 * `mobile.respond` 的实现（P2：整方法外移）。
 *
 * **归属绑定**是这里最重要的一条安全约束：rpcId 必须是挂起项，而且必须属于
 * 手机声称的那个会话。否则一台手机可以应答任何它猜到的 rpcId——桌面与手机
 * 同时在线时，任意一方都能抢先处理对方的审批/提问。挂起跟踪器把每个 pending
 * 的 rpcId 记在发起它的会话名下，所以应答在到达宿主之前就已经绑定了会话。
 * 不在挂起列表里的 rpcId（别处已处理、或从来没跟踪过）一律拒绝，绝不静默转发。
 *
 * @module dsh-palm/mobile/api/mobile-respond
 */
import type { ServerResponse } from 'node:http'
import { RpcId } from '../../api-proxy-types.ts'
import { writeJson } from '../../http.ts'

/** 挂起跟踪器里本域用到的最小面。 */
interface PendingTrackerView {
  ownerOfRpcId: (rpcId: string) => string | undefined
  resolveApprovalByRpcId: (rpcId: string) => void
  resolveQuestionByRpcId: (rpcId: string) => void
}

/** 处理器上下文。 */
export interface RespondContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: unknown
  apiProxy: unknown
}

/** 应答一个挂起的审批/提问。 */
export async function mobileRespond(ctx: RespondContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const deps = ctx.deps as { pendingTracker: PendingTrackerView }
  const apiProxy = ctx.apiProxy as {
    respond: (request: never) => Promise<{ accepted: boolean }>
  }
  const payload = parsed.payload as
    | { rpcId?: unknown; response?: { sessionId?: unknown } }
    | undefined
  const targetRpcId = typeof payload?.rpcId === 'string' ? payload.rpcId : ''
  const claimedSessionId = typeof payload?.response?.sessionId === 'string' ? payload.response.sessionId : undefined
  const ownerSession = deps.pendingTracker.ownerOfRpcId(targetRpcId)
  if (ownerSession === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'not-found', message: '待处理项不存在或已处理' } },
    })
    return
  }
  if (claimedSessionId !== ownerSession) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'conflict', message: '待处理项不属于当前会话' } },
    })
    return
  }
  try {
    const receipt = await apiProxy.respond({
      type: 'client-response',
      rpcId: RpcId(targetRpcId),
      result: { ok: true, value: payload?.response },
    } as never)
    // 应答已经消费了挂起项，就地退场，不必等 resolved 帧走完 mux 流：
    // 手机经常是"答完就走"，而留在跟踪器里的面板会在下次进入时又装回来
    // （mobile.pending 读的就是这个跟踪器）。两个调用对另一种面板都是空操作。
    if (receipt.accepted) {
      deps.pendingTracker.resolveApprovalByRpcId(targetRpcId)
      deps.pendingTracker.resolveQuestionByRpcId(targetRpcId)
    }
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: receipt },
    })
  } catch (error) {
    // 宿主的应答错误属于内部细节（例如该项已被处理），手机只需要稳定拒绝，
    // 绝不回传宿主原文。
    console.error('mobile.respond failed', error)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: '应答失败，请重试' } },
    })
  }
}
