/**
 * The spare copy beside the device store.
 *
 * Regression cover for 2026-10-20: after a dsh restart the phone was asked to
 * pair again, because the store on disk had come back empty. A fresh store and
 * a wiped store look identical on boot, so persist() now writes a `.bak` from
 * the same bytes and loadPersisted() falls back to it — but only when the copy
 * still has devices, so a device revoked on purpose is never resurrected.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_IDLE_EXPIRE_MS, PairingService, type PairingClock, type PairingConfig } from '../src/pairing.ts'

interface AuditRecord {
  action?: unknown
  deviceId?: unknown
  reason?: unknown
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-palm-store-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeClock(): PairingClock {
  let serial = 0
  return {
    now: () => Date.parse('2026-10-20T10:00:00.000Z'),
    randomToken: () => `tok${(serial++).toString().padStart(6, '0')}`,
    randomCode: () => '482913',
  }
}

function configOf(devicesFile: string, overrides: Partial<PairingConfig> = {}): PairingConfig {
  return {
    tokenTtlMs: 60_000,
    offlineAfterMs: 25_000,
    maxDevices: 4,
    idleExpireMs: DEFAULT_IDLE_EXPIRE_MS,
    cookieName: 'dsh_pair',
    devicesFile,
    ...overrides,
  }
}

/** A fresh process: same files on disk, nothing shared in memory. */
function boot(devicesFile: string): PairingService {
  const service = new PairingService(configOf(devicesFile), makeClock())
  service.setPublicBaseUrl('https://pairing.example.test')
  return service
}

/** Issue a token and accept it, returning the device id (the cookie value). */
function pair(service: PairingService, userAgent?: string): string {
  const { token } = service.issue()
  const result = service.accept(token, userAgent)
  if (!result.ok) throw new Error(`pair failed: ${result.code}`)
  return result.deviceId
}

function readAudit(file: string): AuditRecord[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as AuditRecord)
}

function deviceIds(file: string): string[] {
  return Object.keys(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)
}

describe('device store spare copy', () => {
  it('writes the missing copy on the boot that finds an older store', () => {
    const devicesFile = join(dir, 'devices.json')
    // A store left by a build that predates the copy: devices, no `.bak`.
    const service = boot(devicesFile)
    const deviceId = pair(service)
    rmSync(`${devicesFile}.bak`)

    boot(devicesFile)
    expect(existsSync(`${devicesFile}.bak`)).toBe(true)
    expect(deviceIds(`${devicesFile}.bak`)).toEqual([deviceId])
  })

  it('keeps a copy beside the store on every write', () => {
    const devicesFile = join(dir, 'devices.json')
    const service = boot(devicesFile)
    const deviceId = pair(service)
    expect(existsSync(`${devicesFile}.bak`)).toBe(true)
    expect(deviceIds(`${devicesFile}.bak`)).toEqual([deviceId])
  })

  it('brings the devices back when the store is emptied outside the process', () => {
    const devicesFile = join(dir, 'devices.json')
    const auditFile = join(dir, 'devices.audit.log')
    const deviceId = pair(boot(devicesFile), 'Mozilla/5.0 Phone')

    // Something outside dsh-palm empties the store; the next boot sees "{}".
    writeFileSync(devicesFile, '{}')
    const restarted = boot(devicesFile)

    expect(restarted.hasDevice(deviceId)).toBe(true)
    // And the store on disk is repaired, so the next boot needs no fallback.
    expect(deviceIds(devicesFile)).toEqual([deviceId])
    expect(readAudit(auditFile).map(record => record.action)).toContain('store-restore')
  })

  it('brings them back when the store file is gone entirely', () => {
    const devicesFile = join(dir, 'devices.json')
    const deviceId = pair(boot(devicesFile))
    rmSync(devicesFile)

    const restarted = boot(devicesFile)
    expect(restarted.hasDevice(deviceId)).toBe(true)
    expect(deviceIds(devicesFile)).toEqual([deviceId])
  })

  it('does not resurrect a device that was revoked on purpose', () => {
    const devicesFile = join(dir, 'devices.json')
    const service = boot(devicesFile)
    const deviceId = pair(service)
    expect(service.revoke(deviceId)).toBe(true)
    // A deliberate revoke clears both files, so the copy has nothing to give.
    expect(deviceIds(devicesFile)).toEqual([])
    expect(deviceIds(`${devicesFile}.bak`)).toEqual([])

    const restarted = boot(devicesFile)
    expect(restarted.hasDevice(deviceId)).toBe(false)
    expect(deviceIds(devicesFile)).toEqual([])
  })

  it('does not resurrect a device after stop() either', () => {
    const devicesFile = join(dir, 'devices.json')
    const service = boot(devicesFile)
    const deviceId = pair(service)
    service.stop()

    const restarted = boot(devicesFile)
    expect(restarted.hasDevice(deviceId)).toBe(false)
  })

  it('leaves the audit trail of a deliberate revoke exactly as it was', () => {
    const devicesFile = join(dir, 'devices.json')
    const auditFile = join(dir, 'devices.audit.log')
    const service = boot(devicesFile)
    const first = pair(service)
    service.revoke(first)
    // A wipe this process meant is not a "the store was lost" event; the
    // restore record only appears when a boot actually had to fall back.
    expect(readAudit(auditFile).map(record => record.action)).toEqual(['accept', 'revoke'])
  })

  it('still boots with an empty table when neither file is usable', () => {
    const devicesFile = join(dir, 'devices.json')
    writeFileSync(devicesFile, 'not json at all')
    writeFileSync(`${devicesFile}.bak`, '')
    const service = boot(devicesFile)
    expect(service.snapshot().deviceCount).toBe(0)
    // A pair right after boot still works and repairs both files.
    const deviceId = pair(service)
    expect(deviceIds(devicesFile)).toEqual([deviceId])
    expect(deviceIds(`${devicesFile}.bak`)).toEqual([deviceId])
  })
})
