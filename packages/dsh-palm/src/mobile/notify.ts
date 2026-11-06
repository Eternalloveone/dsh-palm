/**
 * Mobile completion-notify client: the L1 SSE channel (/m/api/events.notify)
 * plus the Notification API plumbing. The server's NotifyEngine decides WHAT
 * to notify; this module only delivers (and asks for permission).
 *
 * L2 (Web Push) and L3 (third-party channels) are configured through the
 * settings page; this module owns the L1 channel and the shared permission.
 */

import { pushSubscribe, pushUnsubscribe, readNotifyConfig } from './api.ts'
import { buzz } from './display-prefs.ts'

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

/** Whether the browser can show notifications at all.
 *
 * `typeof Notification !== 'undefined'` is TRUE on Android Chrome and iOS
 * Safari/WKWebView, but the `Notification` CONSTRUCTOR throws there: both
 * platforms require `ServiceWorkerRegistration.showNotification`. The old code
 * checked only existence, opened the L1 stream, and then swallowed a
 * `TypeError` per event — the settings page said "已开启" while nothing was ever
 * shown. Capability is therefore split: showing needs either a service worker
 * registration or a constructor that actually works (desktop).
 */
export function notificationSupported(): boolean {
  if (typeof Notification === 'undefined') return false
  return true
}

/** Set when a show attempt failed; surfaced by the health page and the console. */
let notifyFailures = 0
let lastNotifyError: string | undefined
let warnedFailure = false

/** How L1 delivery has behaved on this page (health page / diagnostics). */
export interface NotifyDeliveryStats {
  failures: number
  lastError?: string
}

/** @returns failure count and the last error message, for the health page. */
export function notifyDeliveryStats(): NotifyDeliveryStats {
  return { failures: notifyFailures, ...(lastNotifyError !== undefined ? { lastError: lastNotifyError } : {}) }
}

/** Record one failed show; warn once per page so logs stay readable. */
function recordShowFailure(error: unknown): void {
  notifyFailures += 1
  lastNotifyError = error instanceof Error ? error.message : String(error)
  if (!warnedFailure) {
    warnedFailure = true
    console.warn('dsh-palm: showing a notification failed; page notifications are unavailable here', error)
  }
}

/** @returns the notification payload used by both delivery paths. */
function notificationOptions(payload: NotifyEventWire['payload']): NotificationOptions {
  return {
    body: payload.body,
    tag: payload.id,
    data: { sessionId: payload.sessionId, workspaceId: payload.workspaceId },
  }
}

/** Desktop-only fallback: the constructor path (no service worker present). */
function showThroughConstructor(title: string, options: NotificationOptions): void {
  const Constructor = globalThis.Notification as
    | (new (title: string, options?: NotificationOptions) => Notification)
    | undefined
  if (Constructor === undefined) throw new Error('Notification API unavailable')
  const notification = new Constructor(title, options)
  notification.onclick = () => {
    notification.close()
    window.focus()
    const data = options.data as { sessionId?: string; workspaceId?: string } | undefined
    if (data?.sessionId !== undefined) {
      const url = new URL('/m/', window.location.origin)
      if (data.workspaceId !== undefined) url.searchParams.set('workspace', data.workspaceId)
      url.searchParams.set('session', data.sessionId)
      window.location.href = url.toString()
    }
  }
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

/**
 * Re-subscribe when the browser rotates the push endpoint.
 *
 * `pushsubscriptionchange` fires in the worker without any payload; the worker
 * posts `{ type: 'palm:resubscribe' }` to every open window. Re-running
 * `enableWebPush()` creates a fresh subscription and re-registers it
 * host-side — otherwise the old endpoint silently 404s and push dies for the
 * rest of the install.
 *
 * @returns an unsubscribe function (for tests / remounts).
 */
export function watchPushResubscribe(): () => void {
  if (typeof navigator === 'undefined' || navigator.serviceWorker === undefined) return () => {}
  const onMessage = (event: MessageEvent): void => {
    const data: unknown = event.data
    if (data === null || typeof data !== 'object') return
    if ((data as { type?: unknown }).type !== 'palm:resubscribe') return
    void enableWebPush().catch(() => undefined)
  }
  navigator.serviceWorker.addEventListener('message', onMessage)
  return () => { navigator.serviceWorker.removeEventListener('message', onMessage) }
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

/** Start the L1 SSE channel (idempotent; requires granted permission).
 *
 * Only runs while the page is hidden: {@link showNotify} drops every event
 * while the page is visible, so an open channel there is pure overhead — the
 * mux stream is the live connection while the page is on screen. App's
 * visibility effect starts this on the way out and stops it on return. */
export function startNotify(): void {
  if (source !== undefined || !notificationSupported()) return
  if (Notification.permission !== 'granted') return
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return
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
  buzz()
  const options = notificationOptions(event)
  const serviceWorker = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
  if (serviceWorker === undefined) {
    // Desktop without a worker: the constructor is the only path, and it is
    // synchronous, which keeps the click handler trivial.
    try {
      showThroughConstructor(event.title, options)
    } catch (error) {
      recordShowFailure(error)
    }
    return
  }
  // Android Chrome and iOS only accept the registration path; the explicit
  // branch keeps that requirement visible instead of hiding it in a cast.
  void serviceWorker.ready
    .then(async (registration) => {
      if (typeof registration.showNotification === 'function') {
        await registration.showNotification(event.title, options)
        return
      }
      showThroughConstructor(event.title, options)
    })
    .catch((error: unknown) => { recordShowFailure(error) })
}
