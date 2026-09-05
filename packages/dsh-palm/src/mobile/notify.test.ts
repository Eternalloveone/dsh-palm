// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  disableWebPush, enableWebPush, notificationPermission, notificationSupported,
  notifyActive, notifyDeepLink, requestNotificationPermission, startNotify,
  stopNotify, webPushState, webPushSupported,
} from './notify.ts'

vi.mock('./api.ts', () => ({
  readNotifyConfig: vi.fn(),
  pushSubscribe: vi.fn(),
  pushUnsubscribe: vi.fn(),
}))
import { pushSubscribe, pushUnsubscribe, readNotifyConfig } from './api.ts'

const readNotifyConfigMock = vi.mocked(readNotifyConfig)
const pushSubscribeMock = vi.mocked(pushSubscribe)
const pushUnsubscribeMock = vi.mocked(pushUnsubscribe)

/** jsdom has no Notification/EventSource: stub both. */
class MockNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted')
  static instances: MockNotification[] = []
  title: string
  options: NotificationOptions
  onclick: ((this: Notification, ev: Event) => unknown) | null = null
  close = vi.fn()
  constructor(title: string, options?: NotificationOptions) {
    this.title = title
    this.options = options ?? {}
    MockNotification.instances.push(this)
  }
}

class MockEventSource {
  static instances: MockEventSource[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  close = vi.fn()
  constructor(public url: string) {
    MockEventSource.instances.push(this)
  }
}

/** Deliver one SSE frame to the latest EventSource instance. */
function deliver(data: string): void {
  const source = MockEventSource.instances.at(-1)
  source?.onmessage?.({ data })
}

/** A fake PushSubscription (L2). */
function fakeSubscription(): { endpoint: string; getKey: ReturnType<typeof vi.fn>; unsubscribe: ReturnType<typeof vi.fn> } {
  return {
    endpoint: 'https://push.example/1',
    getKey: vi.fn((name: string) => name === 'p256dh' ? new Uint8Array([1, 2, 3]).buffer : new Uint8Array([4, 5]).buffer),
    unsubscribe: vi.fn(async () => true),
  }
}

/** A fake pushManager + service worker registration. */
function fakePushManager(): {
  getSubscription: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  install(): void
} {
  const pushManager = {
    getSubscription: vi.fn(async () => undefined),
    subscribe: vi.fn(async () => fakeSubscription()),
  }
  const registration = { pushManager }
  const serviceWorker = { ready: Promise.resolve(registration) }
  return {
    getSubscription: pushManager.getSubscription,
    subscribe: pushManager.subscribe,
    install: () => {
      Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true })
      vi.stubGlobal('PushManager', class {})
    },
  }
}

const notifyFrame = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  type: 'notify',
  payload: {
    id: 'job-bash-1-x1',
    kind: 'task-done',
    title: '任务完成',
    body: '「pnpm test」已完成',
    sessionId: 's-1',
    workspaceId: 'w-1',
    ts: 1_700_000_000_000,
    ...overrides,
  },
})

beforeEach(() => {
  MockNotification.instances = []
  MockEventSource.instances = []
  MockNotification.permission = 'default'
  MockNotification.requestPermission.mockClear()
  vi.stubGlobal('Notification', MockNotification)
  vi.stubGlobal('EventSource', MockEventSource)
  readNotifyConfigMock.mockReset()
  pushSubscribeMock.mockReset()
  pushUnsubscribeMock.mockReset()
  readNotifyConfigMock.mockResolvedValue({
    turnThresholdMs: 30_000,
    turnCooldownMs: 120_000,
    hideDetails: false,
    kinds: { jobs: false, todo: true, turns: false },
    vapidPublicKey: 'aGVsbG8',
    channels: { serverchan: { configured: false }, bark: { configured: false }, telegram: { configured: false }, pushplus: { configured: false } },
  })
})

afterEach(() => {
  stopNotify()
  vi.unstubAllGlobals()
})

describe('notification capability', () => {
  it('reports support and the current permission', () => {
    expect(notificationSupported()).toBe(true)
    expect(notificationPermission()).toBe('default')
    MockNotification.permission = 'granted'
    expect(notificationPermission()).toBe('granted')
  })

  it('requests permission through the browser API', async () => {
    const result = await requestNotificationPermission()
    expect(result).toBe('granted')
    expect(MockNotification.requestPermission).toHaveBeenCalledOnce()
  })
})

describe('L1 channel lifecycle', () => {
  it('does not open the SSE channel before permission is granted', () => {
    startNotify()
    expect(MockEventSource.instances).toHaveLength(0)
    expect(notifyActive()).toBe(false)
  })

  it('opens the channel once permission is granted', () => {
    MockNotification.permission = 'granted'
    startNotify()
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0]?.url).toBe('/m/api/events.notify')
    expect(notifyActive()).toBe(true)
  })

  it('is idempotent while running', () => {
    MockNotification.permission = 'granted'
    startNotify()
    startNotify()
    expect(MockEventSource.instances).toHaveLength(1)
  })

  it('stopNotify closes the channel', () => {
    MockNotification.permission = 'granted'
    startNotify()
    stopNotify()
    expect(MockEventSource.instances[0]?.close).toHaveBeenCalledOnce()
    expect(notifyActive()).toBe(false)
  })
})

describe('L1 delivery', () => {
  it('shows a system notification for a notify frame while hidden', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    MockNotification.permission = 'granted'
    startNotify()
    deliver(notifyFrame())
    expect(MockNotification.instances).toHaveLength(1)
    const notification = MockNotification.instances[0]
    expect(notification?.title).toBe('任务完成')
    expect(notification?.options.body).toContain('pnpm test')
    expect(notification?.options.tag).toBe('job-bash-1-x1')
  })

  it('does not disturb a visible page', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    MockNotification.permission = 'granted'
    startNotify()
    deliver(notifyFrame())
    expect(MockNotification.instances).toHaveLength(0)
  })

  it('ignores malformed frames without breaking the stream', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    MockNotification.permission = 'granted'
    startNotify()
    deliver('{not json')
    deliver(JSON.stringify({ type: 'server-request', rpcId: 'r' }))
    expect(MockNotification.instances).toHaveLength(0)
  })

  it('clicking the notification navigates to the deep link', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    MockNotification.permission = 'granted'
    startNotify()
    deliver(notifyFrame())
    const notification = MockNotification.instances[0]
    expect(notification).toBeDefined()
    const href = notifyDeepLink(JSON.parse(notifyFrame()).payload)
    expect(href).toContain('/m/')
    expect(href).toContain('workspace=w-1')
    expect(href).toContain('session=s-1')
  })
})

describe('deep link', () => {
  it('omits the workspace parameter when unknown', () => {
    const href = notifyDeepLink({
      id: 'turn-s-1-1',
      kind: 'turn-done',
      title: '回复完成',
      body: '回复已完成',
      sessionId: 's-1',
      ts: 1,
    })
    expect(href).toContain('session=s-1')
    expect(href).not.toContain('workspace=')
  })
})

describe('Web Push (L2)', () => {
  it('reports support only with a service worker and PushManager', () => {
    expect(webPushSupported()).toBe(false)
    const fake = fakePushManager()
    fake.install()
    expect(webPushSupported()).toBe(true)
  })

  it('webPushState returns the current subscription (or undefined)', async () => {
    const fake = fakePushManager()
    fake.install()
    expect(await webPushState()).toBeUndefined()
    const subscription = fakeSubscription()
    fake.getSubscription.mockResolvedValue(subscription)
    expect(await webPushState()).toBe(subscription)
  })

  it('enableWebPush subscribes and stores the subscription host-side', async () => {
    const fake = fakePushManager()
    fake.install()
    MockNotification.permission = 'granted'
    const ok = await enableWebPush()
    expect(ok).toBe(true)
    expect(fake.subscribe).toHaveBeenCalledOnce()
    const options = fake.subscribe.mock.calls[0]![0] as { userVisibleOnly: boolean; applicationServerKey: unknown }
    expect(options.userVisibleOnly).toBe(true)
    expect(options.applicationServerKey).toBeInstanceOf(Uint8Array)
    expect(pushSubscribeMock).toHaveBeenCalledOnce()
    const stored = pushSubscribeMock.mock.calls[0]![0]
    expect(stored.endpoint).toBe('https://push.example/1')
    expect(stored.keys.p256dh).toBeTruthy()
    expect(stored.keys.auth).toBeTruthy()
  })

  it('enableWebPush refuses without granted permission', async () => {
    const fake = fakePushManager()
    fake.install()
    expect(await enableWebPush()).toBe(false)
    expect(fake.subscribe).not.toHaveBeenCalled()
  })

  it('enableWebPush refuses without a VAPID public key', async () => {
    const fake = fakePushManager()
    fake.install()
    MockNotification.permission = 'granted'
    readNotifyConfigMock.mockResolvedValue({
      turnThresholdMs: 30_000,
      turnCooldownMs: 120_000,
      hideDetails: false,
      kinds: { jobs: false, todo: true, turns: false },
      channels: { serverchan: { configured: false }, bark: { configured: false }, telegram: { configured: false }, pushplus: { configured: false } },
    })
    expect(await enableWebPush()).toBe(false)
    expect(fake.subscribe).not.toHaveBeenCalled()
  })

  it('disableWebPush unsubscribes locally and drops the host record', async () => {
    const fake = fakePushManager()
    fake.install()
    const subscription = fakeSubscription()
    fake.getSubscription.mockResolvedValue(subscription)
    await disableWebPush()
    expect(subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(pushUnsubscribeMock).toHaveBeenCalledOnce()
  })
})
