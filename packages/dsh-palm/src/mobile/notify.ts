/**
 * Mobile completion-notify client: the L1 SSE channel (/m/api/events.notify)
 * plus the Notification API plumbing. The server's NotifyEngine decides WHAT
 * to notify; this module only delivers (and asks for permission).
 *
 * L2 (Web Push) and L3 (third-party channels) are configured through the
 * settings page; this module owns the L1 channel and the shared permission.
 */

import { pushSubscribe, pushUnsubscribe, readNotifyConfig } from './api.ts'

/** One notify frame as the server's SSE stream delivers it. */
export interface NotifyEventWire {
  type: 'notify'
  payload: {
    id: string
    kind: 'task-done' | 'task-failed' | 'turn-done'
    title: string
    body: string
    sessionId: string
    workspaceId?: string
    ts: number
  }
}

const NOTIFY_EVENTS_URL = '/m/api/events.notify'

let source: EventSource | undefined
let active = false

/** Whether the browser can show notifications at all. */
export function notificationSupported(): boolean {
  return typeof Notification !== 'undefined'
}

/** Current permission state ('default' | 'granted' | 'denied' | 'unsupported'). */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationSupported() ? Notification.permission : 'unsupported'
}

/** Ask for permission (must run from a user gesture). */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationSupported()) return 'unsupported'
  return await Notification.requestPermission()
}

/** Whether Web Push (L2) is available in this browser. */
export function webPushSupported(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.serviceWorker !== 'undefined'
    && typeof PushManager !== 'undefined'
}

/** The current Web Push subscription, if any. */
export async function webPushState(): Promise<PushSubscription | undefined> {
  if (!webPushSupported()) return undefined
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return subscription ?? undefined
}

/** Enable Web Push: subscribe through the service worker and store the
 * subscription host-side. Returns false when the browser cannot subscribe. */
export async function enableWebPush(): Promise<boolean> {
  if (!webPushSupported()) return false
  if (Notification.permission !== 'granted') return false
  const config = await readNotifyConfig()
  if (config.vapidPublicKey === undefined) return false
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey) as unknown as BufferSource,
  })
  const p256dh = subscription.getKey('p256dh')
  const auth = subscription.getKey('auth')
  await pushSubscribe({
    endpoint: subscription.endpoint,
    keys: {
      p256dh: p256dh !== null ? base64Url(p256dh) : '',
      auth: auth !== null ? base64Url(auth) : '',
    },
  })
  return true
}

/** Disable Web Push: unsubscribe locally and drop the host-side record. */
export async function disableWebPush(): Promise<void> {
  if (!webPushSupported()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (subscription !== null) await subscription.unsubscribe()
  await pushUnsubscribe()
}

/** Decode a base64url VAPID public key into the Uint8Array pushManager wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/** Encode a raw key buffer as base64url (the wire shape push.subscribe wants). */
function base64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Start the L1 SSE channel (idempotent; requires granted permission). */
export function startNotify(): void {
  if (source !== undefined || !notificationSupported()) return
  if (Notification.permission !== 'granted') return
  active = true
  source = new EventSource(NOTIFY_EVENTS_URL)
  source.onmessage = (event) => {
    try {
      const wire = JSON.parse(event.data) as NotifyEventWire
      if (wire.type !== 'notify') return
      showNotify(wire.payload)
    } catch {
      // Malformed frame: ignore (the stream stays healthy).
    }
  }
  source.onerror = () => {
    // EventSource reconnects automatically; nothing to do.
  }
}

/** Stop the L1 channel. */
export function stopNotify(): void {
  source?.close()
  source = undefined
  active = false
}

/** Whether the L1 channel is running. */
export function notifyActive(): boolean {
  return active
}

/** Build the deep link a notification click navigates to. */
export function notifyDeepLink(event: NotifyEventWire['payload']): string {
  const url = new URL('/m/', window.location.origin)
  if (event.workspaceId !== undefined) url.searchParams.set('workspace', event.workspaceId)
  url.searchParams.set('session', event.sessionId)
  return url.toString()
}

function showNotify(event: NotifyEventWire['payload']): void {
  // Do not disturb someone actively looking at the app.
  if (document.visibilityState === 'visible') return
  const notification = new Notification(event.title, {
    body: event.body,
    tag: event.id,
    data: { sessionId: event.sessionId, workspaceId: event.workspaceId },
  })
  notification.onclick = () => {
    notification.close()
    window.focus()
    window.location.href = notifyDeepLink(event)
  }
}
