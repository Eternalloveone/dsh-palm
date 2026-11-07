/**
 * `push.config` 的实现（P2：整方法外移）。
 *
 * 一个方法三种模式：
 * - `{ test: true }`：设置页的"发一条测试通知"，走通知引擎（不是直接调投递函数，
 *   否则收件箱与遥测都不会留痕，测试会"成功"但两边都是空的）；
 * - `{ get: true }`：读脱敏配置，只回"是否已配置"，绝不回凭证；首次读时顺手生成 VAPID 密钥；
 * - `{ set: {...} }`：增量合并写入（字段级：没给的字段保留现状）。
 *
 * @module dsh-palm/mobile/api/push-config
 */
import type { ServerResponse } from 'node:http'
import { writeJson } from '../../http.ts'

/** 通道配置（值都是明文，读出时只回是否已配置）。 */
interface PushChannels {
  serverchan?: { sendKey?: string }
  bark?: { key?: string }
  telegram?: { botToken?: string; chatId?: string }
  wxpusher?: { spt?: string }
  pushplus?: { token?: string }
}

/** 通知配置的形状（本域只读这些字段）。 */
interface PushConfigShape {
  turnThresholdMs: number
  turnCooldownMs: number
  hideDetails?: boolean
  kinds?: { jobs?: boolean; todo?: boolean; turns?: boolean; approvals?: boolean }
  channels?: PushChannels
}

/** 通知存储与引擎里本域用到的最小面。 */
interface PushConfigNotify {
  engine: { publishTest: () => void }
  store: {
    getConfig: () => PushConfigShape
    ensureVapid: () => { publicKey: string }
    setConfig: (next: never) => void
  }
}

/** 处理器需要的最小上下文。 */
export interface PushConfigContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: { notify?: PushConfigNotify }
}

/** 发一个错误/结果帧。 */
function reply(res: ServerResponse, rpcId: string, result: unknown): void {
  writeJson(res, 200, { type: 'server-response', rpcId, result })
}

/** 读/写/测试通知配置。 */
export function pushConfig(ctx: PushConfigContext): void {
  const { res, parsed, rpcId, deps } = ctx
  const notify = deps.notify
  if (notify === undefined) {
    reply(res, rpcId, { ok: false, error: { code: 'notify-unavailable', message: '通知功能不可用' } })
    return
  }
  const body = parsed.payload as { get?: unknown; set?: unknown; test?: unknown } | undefined

  if (body?.test === true) {
    notify.engine.publishTest()
    reply(res, rpcId, { ok: true, value: { sent: true } })
    return
  }

  if (body?.get === true) {
    const config = notify.store.getConfig()
    const channels = config.channels
    // 首次读时生成 VAPID 密钥，手机才能直接订阅 Web Push。
    const vapid = notify.store.ensureVapid()
    reply(res, rpcId, {
      ok: true,
      value: {
        turnThresholdMs: config.turnThresholdMs,
        turnCooldownMs: config.turnCooldownMs,
        hideDetails: config.hideDetails === true,
        // 生效开关：缺省回落到安静默认（jobs 关、todo 开、turns 关）。
        kinds: {
          jobs: config.kinds?.jobs === true,
          todo: config.kinds?.todo !== false,
          turns: config.kinds?.turns === true,
          approvals: config.kinds?.approvals !== false,
        },
        vapidPublicKey: vapid.publicKey,
        channels: {
          serverchan: { configured: channels?.serverchan?.sendKey !== undefined && channels.serverchan.sendKey !== '' },
          bark: { configured: channels?.bark?.key !== undefined && channels.bark.key !== '' },
          telegram: {
            configured: channels?.telegram?.botToken !== undefined && channels.telegram.botToken !== '' && channels.telegram.chatId !== undefined && channels.telegram.chatId !== '',
          },
          wxpusher: { configured: channels?.wxpusher?.spt !== undefined && channels.wxpusher.spt !== '' },
          pushplus: { configured: channels?.pushplus?.token !== undefined && channels.pushplus.token !== '' },
        },
      },
    })
    return
  }

  const patch = body?.set as {
    turnThresholdMs?: unknown
    turnCooldownMs?: unknown
    hideDetails?: unknown
    kinds?: unknown
    channels?: unknown
  } | undefined
  if (patch === undefined) {
    reply(res, rpcId, { ok: false, error: { code: 'bad-request', message: '缺少配置内容' } })
    return
  }

  const next: Record<string, unknown> = {}
  if (typeof patch.turnThresholdMs === 'number' && Number.isFinite(patch.turnThresholdMs)) {
    next.turnThresholdMs = Math.max(0, Math.round(patch.turnThresholdMs))
  }
  if (typeof patch.turnCooldownMs === 'number' && Number.isFinite(patch.turnCooldownMs)) {
    next.turnCooldownMs = Math.max(0, Math.round(patch.turnCooldownMs))
  }
  if (typeof patch.hideDetails === 'boolean') {
    next.hideDetails = patch.hideDetails
  }

  const kinds = patch.kinds as { jobs?: unknown; todo?: unknown; turns?: unknown; approvals?: unknown } | undefined
  if (kinds !== undefined) {
    const currentKinds = notify.store.getConfig().kinds ?? {}
    next.kinds = {
      ...(kinds.jobs !== undefined
        ? { jobs: kinds.jobs === true }
        : currentKinds.jobs !== undefined ? { jobs: currentKinds.jobs } : {}),
      ...(kinds.todo !== undefined
        ? { todo: kinds.todo === true }
        : currentKinds.todo !== undefined ? { todo: currentKinds.todo } : {}),
      ...(kinds.turns !== undefined
        ? { turns: kinds.turns === true }
        : currentKinds.turns !== undefined ? { turns: currentKinds.turns } : {}),
      ...(kinds.approvals !== undefined
        ? { approvals: kinds.approvals === true }
        : currentKinds.approvals !== undefined ? { approvals: currentKinds.approvals } : {}),
    }
  }

  const channels = patch.channels as {
    serverchan?: unknown
    bark?: unknown
    telegram?: unknown
    wxpusher?: unknown
    pushplus?: unknown
  } | undefined
  if (channels !== undefined) {
    const current = notify.store.getConfig().channels ?? {}
    const serverchan = channels.serverchan as { sendKey?: unknown } | undefined
    const bark = channels.bark as { key?: unknown } | undefined
    const telegram = channels.telegram as { botToken?: unknown; chatId?: unknown } | undefined
    const wxpusher = channels.wxpusher as { spt?: unknown } | undefined
    const pushplus = channels.pushplus as { token?: unknown } | undefined
    next.channels = {
      ...(serverchan !== undefined
        ? { serverchan: { sendKey: typeof serverchan.sendKey === 'string' ? serverchan.sendKey : '' } }
        : current.serverchan !== undefined ? { serverchan: current.serverchan } : {}),
      ...(bark !== undefined
        ? { bark: { key: typeof bark.key === 'string' ? bark.key : '' } }
        : current.bark !== undefined ? { bark: current.bark } : {}),
      ...(telegram !== undefined
        ? { telegram: { botToken: typeof telegram.botToken === 'string' ? telegram.botToken : '', chatId: typeof telegram.chatId === 'string' ? telegram.chatId : '' } }
        : current.telegram !== undefined ? { telegram: current.telegram } : {}),
      ...(wxpusher !== undefined
        ? { wxpusher: { spt: typeof wxpusher.spt === 'string' ? wxpusher.spt : '' } }
        : current.wxpusher !== undefined ? { wxpusher: current.wxpusher } : {}),
      ...(pushplus !== undefined
        ? { pushplus: { token: typeof pushplus.token === 'string' ? pushplus.token : '' } }
        : current.pushplus !== undefined ? { pushplus: current.pushplus } : {}),
    }
  }

  notify.store.setConfig(next as never)
  reply(res, rpcId, { ok: true, value: { saved: true } })
}
