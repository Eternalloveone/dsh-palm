import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CHANNEL_ADAPTERS, deliverL2, deliverL3, testNotifyEvent } from './notify-deliver.ts'
import { NotifyStore, type NotifyConfig } from './notify-store.ts'
import type { NotifyEvent } from './notify-engine.ts'

vi.mock('web-push', () => ({
  default: {
    sendNotification: vi.fn(),
    generateVAPIDKeys: vi.fn(() => ({ publicKey: 'vapid-pub', privateKey: 'vapid-priv' })),
    WebPushError: class WebPushError extends Error {
      statusCode: number
      constructor(message: string, statusCode: number) {
        super(message)
        this.statusCode = statusCode
      }
    },
  },
}))

import webpush from 'web-push'

const sendNotificationMock = vi.mocked(webpush.sendNotification)

const event: NotifyEvent = {
  id: 'job-bash-1-x1',
  kind: 'task-done',
  title: '任务完成',
  body: '「pnpm test」已完成',
  sessionId: 's-1',
  workspaceId: 'w-1',
  ts: 1_700_000_000_000,
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response)
  vi.stubGlobal('fetch', fetchMock)
  sendNotificationMock.mockReset()
  sendNotificationMock.mockResolvedValue({ statusCode: 201 } as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** A scratch store with a VAPID pair and one subscription. */
function storeWithSubscription(): { store: NotifyStore; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-notify-'))
  const file = join(dir, 'notify.json')
  const store = new NotifyStore(file)
  store.setConfig({ vapid: { publicKey: 'vapid-pub', privateKey: 'vapid-priv' } })
  store.addSubscription('dev-1', {
    endpoint: 'https://push.example/1',
    keys: { p256dh: 'p256dh-1', auth: 'auth-1' },
  })
  return { store, cleanup: () => { rmSync(dir, { recursive: true, force: true }) } }
}

describe('L3 adapters', () => {
  it('serverchan posts a form body to the SendKey endpoint', async () => {
    const config: NotifyConfig = { turnThresholdMs: 30_000, turnCooldownMs: 120_000, channels: { serverchan: { sendKey: 'SCT-key' } } }
    await CHANNEL_ADAPTERS[0]!.send(config, event)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://sctapi.ftqq.com/SCT-key.send')
    const body = init?.body as URLSearchParams
    expect(body.get('title')).toBe('任务完成')
    expect(body.get('desp')).toContain('pnpm test')
  })

  it('bark posts a JSON body to the key path', async () => {
    const config: NotifyConfig = { turnThresholdMs: 30_000, turnCooldownMs: 120_000, channels: { bark: { key: 'bark-key' } } }
    await CHANNEL_ADAPTERS[1]!.send(config, event)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.day.app/bark-key')
    const body = JSON.parse(String(init?.body)) as { title: string; body: string }
    expect(body.title).toBe('任务完成')
    expect(body.body).toContain('pnpm test')
  })

  it('telegram posts a JSON body to the bot sendMessage endpoint', async () => {
    const config: NotifyConfig = {
      turnThresholdMs: 30_000,
      turnCooldownMs: 120_000,
      channels: { telegram: { botToken: '123:ABC', chatId: '42' } },
    }
    await CHANNEL_ADAPTERS[2]!.send(config, event)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.telegram.org/bot123:ABC/sendMessage')
    const body = JSON.parse(String(init?.body)) as { chat_id: string; text: string }
    expect(body.chat_id).toBe('42')
    expect(body.text).toContain('任务完成')
  })

  it('pushplus posts a JSON body with the token and honors a success code', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 200, msg: 'success', data: {} }),
    } as unknown as Response)
    const config: NotifyConfig = {
      turnThresholdMs: 30_000,
      turnCooldownMs: 120_000,
      channels: { pushplus: { token: 'pp-token' } },
    }
    await CHANNEL_ADAPTERS[3]!.send(config, event)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://www.pushplus.plus/send')
    const body = JSON.parse(String(init?.body)) as { token: string; title: string; content: string; template: string }
    expect(body.token).toBe('pp-token')
    expect(body.title).toBe('任务完成')
    expect(body.content).toContain('pnpm test')
    expect(body.template).toBe('txt')
  })

  it('pushplus surfaces business failures via the payload code', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ code: 404, msg: '用户不存在' }),
    } as unknown as Response)
    const config: NotifyConfig = {
      turnThresholdMs: 30_000,
      turnCooldownMs: 120_000,
      channels: { pushplus: { token: 'pp-bad' } },
    }
    await expect(CHANNEL_ADAPTERS[3]!.send(config, event)).rejects.toThrow('pushplus 用户不存在')
  })

  it('a channel without credentials is a no-op', async () => {
    const config: NotifyConfig = { turnThresholdMs: 30_000, turnCooldownMs: 120_000 }
    for (const adapter of CHANNEL_ADAPTERS) {
      await adapter.send(config, event)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a non-ok response throws (the caller logs it)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response)
    const config: NotifyConfig = { turnThresholdMs: 30_000, turnCooldownMs: 120_000, channels: { bark: { key: 'k' } } }
    await expect(CHANNEL_ADAPTERS[1]!.send(config, event)).rejects.toThrow('bark HTTP 500')
  })
})

describe('deliverL3', () => {
  it('sends to every configured channel', async () => {
    const config: NotifyConfig = {
      turnThresholdMs: 30_000,
      turnCooldownMs: 120_000,
      channels: {
        serverchan: { sendKey: 'SCT-key' },
        bark: { key: 'bark-key' },
        telegram: { botToken: '123:ABC', chatId: '42' },
      },
    }
    await deliverL3(config, event)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('a failing channel does not break the others', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const config: NotifyConfig = {
      turnThresholdMs: 30_000,
      turnCooldownMs: 120_000,
      channels: {
        serverchan: { sendKey: 'SCT-key' },
        bark: { key: 'bark-key' },
      },
    }
    await expect(deliverL3(config, event)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('deliverL2', () => {
  it('sends the event payload to every stored subscription with VAPID details', async () => {
    const { store, cleanup } = storeWithSubscription()
    try {
      await deliverL2(store, event)
      expect(sendNotificationMock).toHaveBeenCalledOnce()
      const [subscription, payload, options] = sendNotificationMock.mock.calls[0]!
      expect(subscription).toEqual({
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'p256dh-1', auth: 'auth-1' },
      })
      const parsed = JSON.parse(String(payload)) as { title: string; body: string; tag: string; data: { sessionId: string } }
      expect(parsed.title).toBe('任务完成')
      expect(parsed.body).toContain('pnpm test')
      expect(parsed.tag).toBe('job-bash-1-x1')
      expect(parsed.data.sessionId).toBe('s-1')
      const vapid = (options as { vapidDetails: { subject: string; publicKey: string; privateKey: string } }).vapidDetails
      expect(vapid.publicKey).toBe('vapid-pub')
      expect(vapid.privateKey).toBe('vapid-priv')
      expect(vapid.subject).toContain('https://')
    } finally {
      cleanup()
    }
  })

  it('does nothing without a VAPID pair', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-notify-'))
    try {
      const store = new NotifyStore(join(dir, 'notify.json'))
      await deliverL2(store, event)
      expect(sendNotificationMock).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('removes a subscription on 410 (dead endpoint)', async () => {
    const { store, cleanup } = storeWithSubscription()
    try {
      sendNotificationMock.mockRejectedValueOnce(new webpush.WebPushError('push 410', 410, {}, '', ''))
      await deliverL2(store, event)
      expect(store.listSubscriptions()).toEqual({})
    } finally {
      cleanup()
    }
  })

  it('keeps a subscription on other errors', async () => {
    const { store, cleanup } = storeWithSubscription()
    try {
      sendNotificationMock.mockRejectedValueOnce(new Error('network down'))
      await deliverL2(store, event)
      expect(Object.keys(store.listSubscriptions())).toEqual(['dev-1'])
    } finally {
      cleanup()
    }
  })

  it('routes through DSH_PALM_PUSH_PROXY when set', async () => {
    vi.stubEnv('DSH_PALM_PUSH_PROXY', 'http://127.0.0.1:7897')
    const { store, cleanup } = storeWithSubscription()
    try {
      await deliverL2(store, event)
      const options = sendNotificationMock.mock.calls[0]![2] as { proxy?: string }
      expect(options.proxy).toBe('http://127.0.0.1:7897')
    } finally {
      cleanup()
    }
  })

  it('falls back to HTTPS_PROXY when set', async () => {
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example:8080')
    const { store, cleanup } = storeWithSubscription()
    try {
      await deliverL2(store, event)
      const options = sendNotificationMock.mock.calls[0]![2] as { proxy?: string }
      expect(options.proxy).toBe('http://proxy.example:8080')
    } finally {
      cleanup()
    }
  })

  it('sends direct without any proxy variable', async () => {
    const { store, cleanup } = storeWithSubscription()
    try {
      await deliverL2(store, event)
      const options = sendNotificationMock.mock.calls[0]![2] as { proxy?: string }
      expect(options.proxy).toBeUndefined()
    } finally {
      cleanup()
    }
  })
})

describe('testNotifyEvent', () => {
  it('builds a synthetic task-done event', () => {
    const test = testNotifyEvent()
    expect(test.kind).toBe('task-done')
    expect(test.title).toBe('测试通知')
    expect(test.sessionId).toBe('')
  })
})
