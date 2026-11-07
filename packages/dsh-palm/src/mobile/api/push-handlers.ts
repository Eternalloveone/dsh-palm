/**
 * push 域的本地处理器（P2：逐方法外移，原位调用）。
 *
 * 这两个方法只碰通知存储与设备 cookie，不经过宿主 ApiProxy：
 * - `push.subscribe`：把本设备的 Web Push 订阅存下来（设备 cookie 即身份）。
 * - `push.unsubscribe`：解除订阅。
 *
 * 通知功能是可选依赖：没有 notify 时回 `notify-unavailable`，与搬出前一致。
 *
 * @module dsh-palm/mobile/api/push-handlers
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readCookie } from '../../gate.ts'
import { writeJson } from '../../http.ts'

/** 通知存储里本域用到的最小面。 */
interface PushSubscriptionStore {
  addSubscription: (deviceId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) => void
  removeSubscription: (deviceId: string) => void
}

/** 处理器需要的最小上下文。 */
export interface PushHandlerContext {
  req: IncomingMessage
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: { notify?: { store: PushSubscriptionStore } }
  service: { config: { cookieName: string } }
}

/** 通知不可用时的统一应答。 */
function notifyUnavailable(res: ServerResponse, rpcId: string): void {
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: false, error: { code: 'notify-unavailable', message: '通知功能不可用' } },
  })
}

/** 保存本设备的 Web Push 订阅。 */
export function pushSubscribe(ctx: PushHandlerContext): void {
  const { req, res, parsed, rpcId, deps, service } = ctx
  const notify = deps.notify
  if (notify === undefined) {
    notifyUnavailable(res, rpcId)
    return
  }
  const body = parsed.payload as { subscription?: unknown } | undefined
  const subscription = body?.subscription as { endpoint?: unknown; keys?: unknown } | undefined
  const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint : ''
  const keys = subscription?.keys as { p256dh?: unknown; auth?: unknown } | undefined
  const p256dh = typeof keys?.p256dh === 'string' ? keys.p256dh : ''
  const auth = typeof keys?.auth === 'string' ? keys.auth : ''
  const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
  if (deviceId === undefined || endpoint === '' || p256dh === '' || auth === '') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'bad-request', message: '订阅信息不完整' } },
    })
    return
  }
  notify.store.addSubscription(deviceId, { endpoint, keys: { p256dh, auth } })
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: { stored: true } },
  })
}

/** 解除本设备的订阅（没有订阅也回成功，与搬出前一致）。 */
export function pushUnsubscribe(ctx: PushHandlerContext): void {
  const { req, res, rpcId, deps, service } = ctx
  const notify = deps.notify
  if (notify !== undefined) {
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    if (deviceId !== undefined) notify.store.removeSubscription(deviceId)
  }
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: { stored: false } },
  })
}
