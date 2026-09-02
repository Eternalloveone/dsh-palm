import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_SUBSCRIPTIONS, NotifyStore } from './notify-store.ts'

/** A scratch store on a temp file (removed after the test). */
function scratch(): { store: NotifyStore; file: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-notify-'))
  const file = join(dir, 'notify.json')
  return {
    store: new NotifyStore(file),
    file,
    cleanup: () => { rmSync(dir, { recursive: true, force: true }) },
  }
}

const subscription = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: 'p256dh-' + endpoint, auth: 'auth-' + endpoint },
})

describe('NotifyStore defaults', () => {
  it('starts with the default config and no subscriptions', () => {
    const { store, cleanup } = scratch()
    try {
      expect(store.getConfig()).toEqual({ turnThresholdMs: 30_000, turnCooldownMs: 120_000 })
      expect(store.listSubscriptions()).toEqual({})
    } finally {
      cleanup()
    }
  })

  it('tolerates a corrupt file (defaults, never a throw)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-notify-'))
    const file = join(dir, 'notify.json')
    try {
      writeFileSync(file, '{not json', 'utf8')
      const store = new NotifyStore(file)
      expect(store.getConfig().turnThresholdMs).toBe(30_000)
      expect(store.listSubscriptions()).toEqual({})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('tolerates a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-notify-'))
    try {
      const store = new NotifyStore(join(dir, 'absent.json'))
      expect(store.getConfig().turnThresholdMs).toBe(30_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('NotifyStore config', () => {
  it('merges patches and persists them to disk', () => {
    const { store, file, cleanup } = scratch()
    try {
      store.setConfig({ turnThresholdMs: 45_000 })
      expect(store.getConfig().turnThresholdMs).toBe(45_000)
      expect(store.getConfig().turnCooldownMs).toBe(120_000)
      // A fresh store over the same file sees the persisted value.
      const reloaded = new NotifyStore(file)
      expect(reloaded.getConfig().turnThresholdMs).toBe(45_000)
    } finally {
      cleanup()
    }
  })

  it('keeps VAPID and channel credentials across reloads', () => {
    const { store, file, cleanup } = scratch()
    try {
      store.setConfig({
        vapid: { publicKey: 'pub', privateKey: 'priv' },
        channels: { serverchan: { sendKey: 'SCT-key' } },
      })
      const reloaded = new NotifyStore(file)
      expect(reloaded.getConfig().vapid).toEqual({ publicKey: 'pub', privateKey: 'priv' })
      expect(reloaded.getConfig().channels?.serverchan?.sendKey).toBe('SCT-key')
    } finally {
      cleanup()
    }
  })

  it('generates a VAPID key pair on first ensure and reuses it after', () => {
    const { store, file, cleanup } = scratch()
    try {
      const first = store.ensureVapid()
      expect(first.publicKey).toBeTruthy()
      expect(first.privateKey).toBeTruthy()
      expect(first.publicKey).not.toBe(first.privateKey)
      // Idempotent: the same pair comes back, and a reload sees it too.
      expect(store.ensureVapid()).toEqual(first)
      const reloaded = new NotifyStore(file)
      expect(reloaded.ensureVapid()).toEqual(first)
    } finally {
      cleanup()
    }
  })
})

describe('NotifyStore subscriptions', () => {
  it('stores one subscription per device and persists it', () => {
    const { store, file, cleanup } = scratch()
    try {
      store.addSubscription('dev-1', subscription('https://push.example/1'))
      expect(store.listSubscriptions()['dev-1']?.endpoint).toBe('https://push.example/1')
      const reloaded = new NotifyStore(file)
      expect(reloaded.listSubscriptions()['dev-1']?.keys.auth).toBe('auth-https://push.example/1')
    } finally {
      cleanup()
    }
  })

  it('replaces a device subscription on re-subscribe', () => {
    const { store, cleanup } = scratch()
    try {
      store.addSubscription('dev-1', subscription('https://push.example/1'))
      store.addSubscription('dev-1', subscription('https://push.example/2'))
      const entries = Object.values(store.listSubscriptions())
      expect(entries).toHaveLength(1)
      expect(entries[0]?.endpoint).toBe('https://push.example/2')
    } finally {
      cleanup()
    }
  })

  it('removes a device subscription', () => {
    const { store, cleanup } = scratch()
    try {
      store.addSubscription('dev-1', subscription('https://push.example/1'))
      store.removeSubscription('dev-1')
      expect(store.listSubscriptions()).toEqual({})
    } finally {
      cleanup()
    }
  })

  it('removes every subscription matching an endpoint (410 cleanup)', () => {
    const { store, cleanup } = scratch()
    try {
      store.addSubscription('dev-1', subscription('https://push.example/1'))
      store.addSubscription('dev-2', subscription('https://push.example/1'))
      store.addSubscription('dev-3', subscription('https://push.example/3'))
      store.removeSubscriptionByEndpoint('https://push.example/1')
      expect(Object.keys(store.listSubscriptions())).toEqual(['dev-3'])
    } finally {
      cleanup()
    }
  })

  it('FIFO-evicts the oldest subscriptions past the cap', () => {
    const { store, cleanup } = scratch()
    try {
      for (let index = 0; index < MAX_SUBSCRIPTIONS + 5; index++) {
        store.addSubscription(`dev-${index}`, subscription(`https://push.example/${index}`))
      }
      const entries = Object.entries(store.listSubscriptions())
      expect(entries).toHaveLength(MAX_SUBSCRIPTIONS)
      // The five oldest devices were evicted.
      expect(entries.some(([id]) => id === 'dev-0')).toBe(false)
      expect(entries.some(([id]) => id === 'dev-4')).toBe(false)
      expect(entries.some(([id]) => id === 'dev-5')).toBe(true)
    } finally {
      cleanup()
    }
  })
})

describe('NotifyStore file round-trip', () => {
  it('writes a parseable JSON file', () => {
    const { store, file, cleanup } = scratch()
    try {
      store.addSubscription('dev-1', subscription('https://push.example/1'))
      store.setConfig({ turnThresholdMs: 60_000 })
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { config?: unknown; subscriptions?: unknown }
      expect(raw.config).toBeTruthy()
      expect(raw.subscriptions).toBeTruthy()
    } finally {
      cleanup()
    }
  })
})
