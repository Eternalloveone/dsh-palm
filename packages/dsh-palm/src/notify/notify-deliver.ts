/**
 * L3 delivery: third-party push channels (Server酱 / Bark / Telegram /
 * WxPusher / PushPlus) that reach the phone even when the PWA is fully
 * closed. All are plain outbound HTTPS webhooks — no public inbound port,
 * no browser dependency.
 *
 * PushPlus is demoted, not deleted: it now requires paid verification, so
 * WxPusher took the recommended slot, but a config that already carries a
 * pushplus token must keep delivering instead of failing silently.
 *
 * Failures are logged and swallowed: notifications are best-effort, and one
 * dead channel must never break the engine or the other channels.
 */

import webpush from 'web-push'
import type { NotifyConfig, NotifyStore } from './notify-store.ts'
import type { NotifyEvent } from './notify-engine.ts'

const SERVERCHAN_BASE = 'https://sctapi.ftqq.com'
const BARK_BASE = 'https://api.day.app'
const TELEGRAM_BASE = 'https://api.telegram.org'
const WXPUSHER_SIMPLE_PUSH = 'https://wxpusher.zjiecode.com/api/send/message/simple-push'
/** Legacy channel (demoted): wired only for configs that already carry a token. */
const PUSHPLUS_BASE = 'https://www.pushplus.plus/send'

/** One third-party channel adapter. */
export interface ChannelAdapter {
  name: string
  /** Send one event; a disabled channel (no credentials) is a no-op. */
  send(config: NotifyConfig, event: NotifyEvent): Promise<void>
}

/** The built-in L3 adapters. */
export const CHANNEL_ADAPTERS: readonly ChannelAdapter[] = [
  {
    name: 'serverchan',
    async send(config, event) {
      const sendKey = config.channels?.serverchan?.sendKey
      if (sendKey === undefined || sendKey === '') return
      const response = await fetch(`${SERVERCHAN_BASE}/${sendKey}.send`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ title: event.title, desp: event.body }),
      })
      if (!response.ok) throw new Error(`serverchan HTTP ${response.status}`)
    },
  },
  {
    name: 'bark',
    async send(config, event) {
      const key = config.channels?.bark?.key
      if (key === undefined || key === '') return
      const response = await fetch(`${BARK_BASE}/${key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: event.title, body: event.body }),
      })
      if (!response.ok) throw new Error(`bark HTTP ${response.status}`)
    },
  },
  {
    name: 'telegram',
    async send(config, event) {
      const botToken = config.channels?.telegram?.botToken
      const chatId = config.channels?.telegram?.chatId
      if (botToken === undefined || botToken === '' || chatId === undefined || chatId === '') return
      const response = await fetch(`${TELEGRAM_BASE}/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `${event.title}\n${event.body}` }),
      })
      if (!response.ok) throw new Error(`telegram HTTP ${response.status}`)
    },
  },
  {
    name: 'wxpusher',
    async send(config, event) {
      const spt = config.channels?.wxpusher?.spt
      if (spt === undefined || spt === '') return
      const response = await fetch(WXPUSHER_SIMPLE_PUSH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          spt,
          content: event.body,
          // WxPusher caps the notification summary at 100 characters; the full
          // text is already in the body, so truncating loses nothing.
          summary: event.title.slice(0, 100),
          contentType: 1,
        }),
      })
      if (!response.ok) throw new Error(`wxpusher HTTP ${response.status}`)
      // WxPusher answers 200 even for business failures; the body's code
      // carries the verdict (1000 = accepted). Surface its message so the
      // settings test button can diagnose a wrong/expired SPT.
      const json = await response.json().catch(() => null) as { code?: number; msg?: string } | null
      if (json !== null && json.code !== undefined && json.code !== 1000) {
        throw new Error(`wxpusher ${json.msg ?? `code ${json.code}`}`)
      }
    },
  },
  {
    name: 'pushplus',
    async send(config, event) {
      const token = config.channels?.pushplus?.token
      if (token === undefined || token === '') return
      const response = await fetch(`${PUSHPLUS_BASE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, title: event.title, content: event.body, template: 'txt' }),
      })
      if (!response.ok) throw new Error(`pushplus HTTP ${response.status}`)
      // pushplus answers 200 even for business failures; the payload's code
      // carries the verdict (200 = delivered). Surface its message so the
      // settings test button can diagnose a wrong/expired token.
      const json = await response.json().catch(() => null) as { code?: number; msg?: string } | null
      if (json !== null && json.code !== undefined && json.code !== 200) {
        throw new Error(`pushplus ${json.msg ?? `code ${json.code}`}`)
      }
    },
  },
]

/** Deliver one event to every configured L3 channel (best-effort). */
export async function deliverL3(config: NotifyConfig, event: NotifyEvent, store?: NotifyStore): Promise<void> {
  await Promise.all(CHANNEL_ADAPTERS.map(async (adapter) => {
    try {
      await adapter.send(config, event)
      store?.recordDelivery({ at: Date.now(), eventId: event.id, kind: event.kind, channel: adapter.name, status: 'sent' })
    } catch (error) {
      console.error(`dsh-palm: L3 channel ${adapter.name} failed`, error)
      store?.recordDelivery({
        at: Date.now(), eventId: event.id, kind: event.kind, channel: adapter.name, status: 'failed',
        detail: describeError(error),
      })
    }
  }))
}

/**
 * Deliver one event to every stored Web Push subscription (L2). A 410/404
 * from the push service means the subscription is dead (uninstalled app,
 * revoked permission) — it is removed so the table never grows stale.
 * The VAPID subject is a URL (the project page), never an email address.
 *
 * A blocked turn carries `actions`, which Android renders as lock-screen
 * buttons — the phone answers without ever opening the app. iOS's Web Push
 * has no action support and silently drops the field, so the same payload
 * still works there: tapping the notification opens the app deep-linked
 * straight onto the pending decision (see the service worker). A question is
 * not given buttons at all: it has options, and a lock screen is the wrong
 * place to pick between them.
 */
export async function deliverL2(store: NotifyStore, event: NotifyEvent): Promise<void> {
  const config = store.getConfig()
  const vapid = config.vapid
  if (vapid === undefined) return
  const decision = event.decision
  const payload = JSON.stringify({
    title: event.title,
    body: event.body,
    tag: event.id,
    data: {
      sessionId: event.sessionId,
      workspaceId: event.workspaceId,
      ...(decision !== undefined ? { decisionId: decision.id, decisionKind: decision.kind } : {}),
      ...(decision?.rpcId !== undefined ? { decisionRpcId: decision.rpcId } : {}),
    },
    ...(decision !== undefined && decision.kind === 'approval'
      ? { actions: [{ action: 'allow', title: '允许' }, { action: 'deny', title: '拒绝' }] }
      : {}),
  })
  const proxy = pushProxy()
  const subscriptions = store.listSubscriptions()
  await Promise.all(Object.values(subscriptions).map(async (subscription) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: subscription.keys },
        payload,
        {
          ...(proxy !== undefined ? { proxy } : {}),
          vapidDetails: {
            subject: 'https://github.com/Eternalloveone/dsh-palm',
            publicKey: vapid.publicKey,
            privateKey: vapid.privateKey,
          },
        },
      )
      store.recordDelivery({ at: Date.now(), eventId: event.id, kind: event.kind, channel: 'web-push', status: 'sent' })
    } catch (error) {
      if (error instanceof webpush.WebPushError && (error.statusCode === 410 || error.statusCode === 404)) {
        store.removeSubscriptionByEndpoint(subscription.endpoint)
        store.recordDelivery({
          at: Date.now(), eventId: event.id, kind: event.kind, channel: 'web-push', status: 'failed',
          detail: `subscription gone (${error.statusCode})`,
        })
      } else {
        console.error('dsh-palm: L2 push failed', error)
        store.recordDelivery({
          at: Date.now(), eventId: event.id, kind: event.kind, channel: 'web-push', status: 'failed',
          detail: describeError(error),
        })
      }
    }
  }))
}

/** A short, log-safe description of a delivery failure. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { statusCode?: unknown }).statusCode
    const text = typeof status === 'number' ? `HTTP ${status} ${error.message}` : error.message
    return text.slice(0, 120)
  }
  return String(error).slice(0, 120)
}

/**
 * The outbound proxy for Web Push. FCM is unreachable from some networks
 * (mainland China), so deployments there must route through a proxy. The
 * dedicated DSH_PALM_PUSH_PROXY variable wins; the standard HTTPS_PROXY /
 * HTTP_PROXY variables are the fallback. Undefined means direct connection.
 */
function pushProxy(): string | undefined {
  const candidates = [
    process.env.DSH_PALM_PUSH_PROXY,
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
  ]
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== '') return candidate
  }
  return undefined
}

/** A synthetic event for the settings-page test button. */
export function testNotifyEvent(): NotifyEvent {
  return {
    id: `test-${Date.now().toString(36)}`,
    kind: 'task-done',
    title: '测试通知',
    body: '这是一条来自 dsh-palm 的测试通知',
    sessionId: '',
    ts: Date.now(),
  }
}
