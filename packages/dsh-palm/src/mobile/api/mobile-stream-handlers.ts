/**
 * `mobile.*` 里与运行态、通知收件箱、附件读取有关的处理器（P2：逐方法外移）。
 *
 * 这四个都是"手机问宿主现在怎么样"的读接口：
 * - `observe`：手机报当前打开的会话，宿主据此只跟一条助手流；
 * - `turnState`：唯一该问的「还在跑吗」，宿主比完帧镜像与日志边界再回答；
 * - `notifyEvents`：通知收件箱 + 投递遥测（把"没收到"和"没东西可发"分开）；
 * - `readAttachment`：按会话引用关系授权的图片字节读取。
 *
 * @module dsh-palm/mobile/api/mobile-stream-handlers
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiProxyAdapter } from '../../api-proxy-adapter.ts'
import { readCookie } from '../../gate.ts'
import { writeJson } from '../../http.ts'
import {
  computeTurnState,
  liveRunningSeededAtOf,
  reseedRunning,
  setRunningProxy,
} from '../../host/running-evidence.ts'

/** 通知能力的最小面（收件箱 + 投递遥测）。 */
interface NotifyView {
  engine: { recentEvents: () => unknown }
  store: { deliverySummary: () => unknown; recentDeliveries: () => unknown }
}

/** 观察者能力的最小面。 */
interface ObserversView {
  observe: (deviceId: string, sessionId: string | undefined) => void
}

/** 运行态/观察处理器上下文。 */
export interface ObserveContext {
  req: IncomingMessage
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: { observers?: ObserversView }
  service: { config: { cookieName: string } }
  apiProxy: unknown
}

/** 报「手机现在打开的是哪个会话」，顺带预热「谁在跑」的基线。 */
export function mobileObserve(ctx: ObserveContext): void {
  const { req, res, rpcId, parsed, service, apiProxy } = ctx
  setRunningProxy(apiProxy as never)
  if (liveRunningSeededAtOf() === 0) void reseedRunning()
  const observers = ctx.deps.observers
  if (observers === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'unavailable', message: '实时流服务不可用' } },
    })
    return
  }
  const body = parsed.payload as { sessionId?: unknown } | undefined
  const raw = body?.sessionId
  const sessionId = typeof raw === 'string' && raw !== '' ? raw : undefined
  const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
  if (deviceId !== undefined) observers.observe(deviceId, sessionId)
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: { observing: sessionId ?? null } },
  })
}

/** 会话状态处理器上下文。 */
export interface TurnStateContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
}

/** 「这个会话还在跑吗」——客户端不再自己推断。 */
export async function mobileTurnState(ctx: TurnStateContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const body = parsed.payload as { sessionId?: unknown } | undefined
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
  if (sessionId === '') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
    })
    return
  }
  try {
    const state = await computeTurnState(sessionId)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: state },
    })
  } catch (error) {
    console.error('mobile.turnState failed', error)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'unavailable', message: '轮次状态不可读' } },
    })
  }
}

/** 通知收件箱处理器上下文。 */
export interface NotifyEventsContext {
  res: ServerResponse
  rpcId: string
  deps: { notify?: NotifyView }
}

/** 通知收件箱（引擎的有界决策日志，最新在前）+ 投递遥测。 */
export function mobileNotifyEvents(ctx: NotifyEventsContext): void {
  const { res, rpcId } = ctx
  const notify = ctx.deps.notify
  if (notify === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'notify-unavailable', message: '通知功能不可用' } },
    })
    return
  }
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: {
      ok: true,
      value: {
        items: notify.engine.recentEvents(),
        // 投递遥测：宿主到底试过发什么，用来区分"没收到"与"没东西可发"。
        stats: notify.store.deliverySummary(),
        deliveries: notify.store.recentDeliveries(),
      },
    },
  })
}

/** 附件读取处理器上下文。 */
export interface ReadAttachmentContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  apiProxy: unknown
}

/**
 * 读图片字节（0.1.5 起事件只带 attachmentId 引用）。
 *
 * 宿主按"该会话确实引用过这张图"授权，所以 sessionId 必须一起带上；
 * 适配层按内容寻址的 id 长期缓存，同一张图只过一次隧道。
 */
export async function mobileReadAttachment(ctx: ReadAttachmentContext): Promise<void> {
  const { res, parsed, rpcId } = ctx
  const body = parsed.payload as { sessionId?: unknown; attachmentId?: unknown } | undefined
  const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
  const attachmentId = typeof body?.attachmentId === 'string' && body.attachmentId !== '' ? body.attachmentId : undefined
  if (sessionId === undefined || attachmentId === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'invalid-request', message: '缺少会话或附件标识' } },
    })
    return
  }
  try {
    const value = await (ctx.apiProxy as ApiProxyAdapter).readAttachment(sessionId, attachmentId)
    writeJson(res, 200, { type: 'server-response', rpcId, result: { ok: true, value } })
  } catch (error) {
    // 稳定文案，不外泄宿主细节（图片读不到只影响这一张图的显示）。
    console.error('mobile.readAttachment failed', error)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'internal', message: '图片读取失败' } },
    })
  }
}
