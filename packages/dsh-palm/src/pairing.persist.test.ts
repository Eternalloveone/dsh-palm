/**
 * PairingService device-session persistence: with `devicesFile` set, sessions
 * written on accept/stop/revoke/sweep survive a process restart (a new
 * PairingService instance). lastSeenAt is flushed on sweep, not on every
 * touch; idle sessions older than idleExpireMs are dropped on load.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pairingConfigOf } from './index.ts'
import { DEFAULT_IDLE_EXPIRE_MS, PairingService, type PairingClock, type PairingConfig } from './pairing.ts'

const BASE_CONFIG: Omit<PairingConfig, 'devicesFile'> = {
  tokenTtlMs: 60_000,
  offlineAfterMs: 25_000,
  maxDevices: 4,
  idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
  cookieName: 'dsh_pair',
}

/** Deterministic clock: tokens are issued in a fixed, readable sequence. */
function makeClock(): PairingClock & { advance(ms: number): void } {
  let n = 0
  let time = 1_000_000
  return {
    now: () => time,
    randomToken: () => `tok${(n++).toString().padStart(6, '0')}`,
    randomCode: () => `4829${String(n % 10)}${String((n + 1) % 10)}`,
    advance: (ms: number) => { time += ms },
  }
}

/** Pair a device on a service: issue a token and immediately accept it. */
function pairDevice(service: PairingService): string {
  service.setPublicBaseUrl('https://pairing.example.trycloudflare.com')
  const { token } = service.issue()
  const result = service.accept(token)
  if (!result.ok) throw new Error(`pair failed: ${result.code}`)
  return result.deviceId
}

describe('PairingService device persistence', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'remote-web-ui-persist-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('restores paired sessions across a process restart', () => {
    const file = join(dir, 'devices.json')
    const first = new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())
    const deviceId = pairDevice(first)
    expect(readFileSync(file, 'utf8')).toContain(deviceId)
    // Device ids are session credentials: the persisted file is 0600.
    // win32: NTFS has no POSIX mode bits and Node ignores the writeFileSync
    // mode option there, so the mode assertion only applies on POSIX (#772).
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600)
    }

    // Simulated restart: a brand-new service instance reading the same file.
    const second = new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())
    expect(second.hasDevice(deviceId)).toBe(true)
  })

  it('carries devicesFile through the config mapping used by sync() (regression)', () => {
    const file = join(dir, 'devices.json')
    const mapped = pairingConfigOf({
      tokenTtlMs: 60_000,
      offlineAfterMs: 25_000,
      maxDevices: 4,
      idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
      cookieName: 'dsh_pair',
      devicesFile: file,
    })
    expect(mapped.devicesFile).toBe(file)
  })

  it('keeps persisting after a sync-style service.config rebuild', () => {
    const file = join(dir, 'devices.json')
    const service = new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())
    // applyImpl/sync() reassigns service.config from the resolved config on
    // mount and on every settings change; the rebuild must not drop devicesFile.
    service.config = pairingConfigOf({
      tokenTtlMs: 60_000,
      offlineAfterMs: 25_000,
      maxDevices: 4,
      idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
      cookieName: 'dsh_pair',
      devicesFile: file,
    })
    const deviceId = pairDevice(service)
    const restarted = new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())
    expect(restarted.hasDevice(deviceId)).toBe(true)
  })

  it('clamps a persisted table to maxDevices when the file holds more sessions', () => {
    const file = join(dir, 'devices.json')
    writeFileSync(file, JSON.stringify({
      dev1: { createdAt: 1_000, lastSeenAt: 1_000 },
      dev2: { createdAt: 2_000, lastSeenAt: 2_000 },
      dev3: { createdAt: 3_000, lastSeenAt: 3_000 },
    }))
    const service = new PairingService({ ...BASE_CONFIG, maxDevices: 2, devicesFile: file }, makeClock())
    expect(service.hasDevice('dev3')).toBe(true)
    expect(service.hasDevice('dev2')).toBe(true)
    expect(service.hasDevice('dev1')).toBe(false)
  })

  it('keeps sessions memory-only when devicesFile is unset', () => {
    const first = new PairingService({ ...BASE_CONFIG }, makeClock())
    const deviceId = pairDevice(first)
    // No file was written; a fresh instance without the option knows nothing.
    const second = new PairingService({ ...BASE_CONFIG }, makeClock())
    expect(second.hasDevice(deviceId)).toBe(false)
  })

  it('persists revocation by stop() across a restart', () => {
    const file = join(dir, 'devices.json')
    const first = new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())
    const deviceId = pairDevice(first)
    first.stop()

    const second = new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())
    expect(second.hasDevice(deviceId)).toBe(false)
  })

  it('refuses a new device when every slot is held by an online device', () => {
    const file = join(dir, 'devices.json')
    const first = new PairingService({ ...BASE_CONFIG, maxDevices: 2, devicesFile: file }, makeClock())
    const firstDevice = pairDevice(first)
    const secondDevice = pairDevice(first)
    // Both slots are held by freshly-paired (online) devices: a third pairing
    // must be refused with device-cap-full, never silently evict an online one.
    first.setPublicBaseUrl('https://pairing.example.trycloudflare.com')
    const { token } = first.issue()
    const result = first.accept(token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('device-cap-full')
    expect(first.hasDevice(firstDevice)).toBe(true)
    expect(first.hasDevice(secondDevice)).toBe(true)
  })

  it('evicts an idle device (not the online or primary one) when the cap is reached', () => {
    const file = join(dir, 'devices.json')
    const clock = makeClock()
    const first = new PairingService({ ...BASE_CONFIG, maxDevices: 2, devicesFile: file }, clock)
    const primaryDevice = pairDevice(first) // first device becomes primary
    const idleDevice = pairDevice(first)
    // Age the second device past the offline window so it becomes idle; the
    // primary stays online (its lastSeenAt is untouched).
    clock.advance(30_000)
    first.touchDevice(primaryDevice) // keep the primary online
    const thirdDevice = pairDevice(first) // evicts the idle device, not the primary
    expect(first.hasDevice(idleDevice)).toBe(false)
    expect(first.hasDevice(primaryDevice)).toBe(true)
    expect(first.hasDevice(thirdDevice)).toBe(true)

    const second = new PairingService({ ...BASE_CONFIG, maxDevices: 2, devicesFile: file }, makeClock())
    expect(second.hasDevice(primaryDevice)).toBe(true)
    expect(second.hasDevice(thirdDevice)).toBe(true)
    expect(second.hasDevice(idleDevice)).toBe(false)
  })

  it('tolerates a corrupt or missing file instead of refusing to boot', () => {
    const file = join(dir, 'devices.json')
    writeFileSync(file, '{ this is not json !!!')
    expect(() => new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())).not.toThrow()

    const ghost = join(dir, 'does-not-exist.json')
    expect(() => new PairingService({ ...BASE_CONFIG, devicesFile: ghost }, makeClock())).not.toThrow()
  })

  it('promotes one device to primary and demotes the previous primary', () => {
    const service = new PairingService({ ...BASE_CONFIG }, makeClock())
    const firstDevice = pairDevice(service) // becomes primary automatically
    const secondDevice = pairDevice(service)
    expect(service.setPrimary(secondDevice)).toBe(true)
    const snapshot = service.snapshot()
    const first = snapshot.devices.find(device => device.id === firstDevice)
    const second = snapshot.devices.find(device => device.id === secondDevice)
    expect(first?.primary).toBeUndefined()
    expect(second?.primary).toBe(true)
    // Unknown ids are a no-op.
    expect(service.setPrimary('nope')).toBe(false)
  })

  it('renames a device and clears the name on an empty value', () => {
    const service = new PairingService({ ...BASE_CONFIG }, makeClock())
    const deviceId = pairDevice(service)
    expect(service.renameDevice(deviceId, '  我的手机  ')).toBe(true)
    expect(service.snapshot().devices[0]?.name).toBe('我的手机')
    expect(service.renameDevice(deviceId, '   ')).toBe(true)
    expect(service.snapshot().devices[0]?.name).toBeUndefined()
    expect(service.renameDevice('nope', 'x')).toBe(false)
  })

  it('does not persist lastSeenAt on touch; sweep flushes it', () => {
    const file = join(dir, 'devices.json')
    const now = { value: 1_000_000 }
    let n = 0
    const clock: PairingClock = {
      now: () => now.value,
      randomToken: () => `tok${(n++).toString().padStart(6, '0')}`,
      randomCode: () => `4829${String(n % 10)}${String((n + 1) % 10)}`,
    }
    const first = new PairingService({ ...BASE_CONFIG, devicesFile: file }, clock)
    const deviceId = pairDevice(first)
    const afterAccept = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { lastSeenAt: number }>
    expect(afterAccept[deviceId]?.lastSeenAt).toBe(1_000_000)
    now.value = 1_500_000
    expect(first.touchDevice(deviceId)).toBe(true)
    const afterTouch = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { lastSeenAt: number }>
    expect(afterTouch[deviceId]?.lastSeenAt).toBe(1_000_000)
    first.sweep()
    const afterSweep = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { lastSeenAt: number }>
    expect(afterSweep[deviceId]?.lastSeenAt).toBe(1_500_000)

    const second = new PairingService({ ...BASE_CONFIG, devicesFile: file }, clock)
    expect(second.hasDevice(deviceId)).toBe(true)
    expect(second.snapshot().devices[0]?.lastSeenAt).toBe(1_500_000)
  })

  it('drops idle sessions on load instead of restoring them', () => {
    const file = join(dir, 'devices.json')
    writeFileSync(file, JSON.stringify({
      stale: { createdAt: 1, lastSeenAt: 1 },
    }))
    const clock: PairingClock = {
      now: () => 1 + DEFAULT_IDLE_EXPIRE_MS + 1,
      randomToken: () => 'tok',
      randomCode: () => '482913',
    }
    const service = new PairingService({ ...BASE_CONFIG, devicesFile: file }, clock)
    expect(service.hasDevice('stale')).toBe(false)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(saved).toEqual({})
  })

  it('persists a User-Agent captured at accept', () => {
    const file = join(dir, 'devices.json')
    const service = new PairingService({ ...BASE_CONFIG, devicesFile: file }, makeClock())
    service.setPublicBaseUrl('https://pairing.example.trycloudflare.com')
    const { token } = service.issue()
    const result = service.accept(token, 'Mozilla/5.0 TestPhone')
    expect(result.ok).toBe(true)
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { userAgent?: string }>
    const deviceId = result.ok ? result.deviceId : ''
    expect(saved[deviceId]?.userAgent).toBe('Mozilla/5.0 TestPhone')
  })
})