/**
 * pair 域的本地处理器（P2：逐方法外移，原位调用）。
 *
 * 这里有一条重要的安全约束（注释写在原实现里，搬出来时一并保留）：
 * - 设备 id 就是会话凭证，所以花名册只暴露派生的 handle，绝不回 id；
 * - "移除其他设备"和"设为主设备"只能在桌面端（loopback）操作，
 *   否则被偷的手机可以把自己提权、把主人踢下线。
 *
 * @module dsh-palm/mobile/api/pair-handlers
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { deviceHandleOf, resolveDeviceHandle } from '../../device-handle.ts'
import { isLoopbackClient, readCookie } from '../../gate.ts'
import { writeJson } from '../../http.ts'

/** 花名册里需要的设备字段（其余不读，就不声明）。 */
export interface PairedDeviceView {
  id: string
  createdAt: number
  lastSeenAt: number
  online: boolean
  userAgent?: string
  name?: string
  primary?: boolean
}

/** 配对服务里本域用到的最小面。 */
export interface PairServiceView {
  config: { cookieName: string; maxDevices: number }
  snapshot: () => { devices: PairedDeviceView[] }
  revoke: (deviceId: string) => unknown
  renameDevice: (deviceId: string, name: string) => unknown
  setPrimary: (deviceId: string) => unknown
}

/** 处理器需要的最小上下文。 */
export interface PairHandlerContext {
  req: IncomingMessage
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  service: PairServiceView
}

/** 统一回一个错误帧。 */
function fail(res: ServerResponse, rpcId: string, code: string, message: string): void {
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: false, error: { code, message } },
  })
}

/** 配对设备花名册（当前设备用 `current: true` 标出）。 */
export function pairDevices(ctx: PairHandlerContext): void {
  const { req, res, rpcId, service } = ctx
  const currentDeviceId = readCookie(req.headers.cookie, service.config.cookieName)
  const devices = service.snapshot().devices.map(device => ({
    handle: deviceHandleOf(device.id),
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    online: device.online,
    ...(device.userAgent !== undefined ? { userAgent: device.userAgent } : {}),
    ...(device.name !== undefined ? { name: device.name } : {}),
    ...(device.primary === true ? { primary: true } : {}),
    current: device.id === currentDeviceId,
  }))
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: { devices, maxDevices: service.config.maxDevices } },
  })
}

/** 移除设备：只能移除自己，移除别的设备需要桌面端。 */
export function pairRevoke(ctx: PairHandlerContext): void {
  const { req, res, parsed, rpcId, service } = ctx
  const body = parsed.payload as { handle?: unknown } | undefined
  const handle = typeof body?.handle === 'string' ? body.handle : ''
  const target = resolveDeviceHandle(service.snapshot().devices, handle)
  if (target === undefined) {
    fail(res, rpcId, 'bad-request', '设备不存在')
    return
  }
  const currentDeviceId = readCookie(req.headers.cookie, service.config.cookieName)
  if (target !== currentDeviceId && !isLoopbackClient(req)) {
    fail(res, rpcId, 'desktop-only', '移除其他设备请在桌面端操作')
    return
  }
  const removed = service.revoke(target)
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: { removed } },
  })
}

/** 重命名设备。 */
export function pairRename(ctx: PairHandlerContext): void {
  const { res, parsed, rpcId, service } = ctx
  const body = parsed.payload as { handle?: unknown; name?: unknown } | undefined
  const handle = typeof body?.handle === 'string' ? body.handle : ''
  const name = typeof body?.name === 'string' ? body.name : ''
  const target = resolveDeviceHandle(service.snapshot().devices, handle)
  if (target === undefined) {
    fail(res, rpcId, 'bad-request', '设备不存在')
    return
  }
  const renamed = service.renameDevice(target, name)
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: { renamed } },
  })
}

/** 设为主设备：主设备免空闲过期，属于提权，只允许桌面端。 */
export function pairSetPrimary(ctx: PairHandlerContext): void {
  const { req, res, parsed, rpcId, service } = ctx
  if (!isLoopbackClient(req)) {
    fail(res, rpcId, 'desktop-only', '设为主设备请在桌面端操作')
    return
  }
  const body = parsed.payload as { handle?: unknown } | undefined
  const handle = typeof body?.handle === 'string' ? body.handle : ''
  const target = resolveDeviceHandle(service.snapshot().devices, handle)
  if (target === undefined) {
    fail(res, rpcId, 'bad-request', '设备不存在')
    return
  }
  const promoted = service.setPrimary(target)
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: true, value: { promoted } },
  })
}
