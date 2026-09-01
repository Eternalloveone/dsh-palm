/**
 * PairingService six-digit pairing-code semantics: issue() binds a code to
 * the token, accept() resolves either the token secret or the code, the code
 * is one-time like the token, and stop()/re-issue invalidate it.
 */
import { describe, expect, it } from 'vitest'
import { PairingService, type PairingClock, type PairingConfig } from './pairing.ts'

const BASE_CONFIG: PairingConfig = {
  tokenTtlMs: 60_000,
  offlineAfterMs: 25_000,
  maxDevices: 4,
  cookieName: 'dsh_pair',
}

/** Deterministic clock: fixed token/code sequences, manually advanceable time. */
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

function makeService(clock: PairingClock = makeClock()): PairingService {
  const service = new PairingService(BASE_CONFIG, clock)
  service.setPublicBaseUrl('https://pairing.example.trycloudflare.com')
  return service
}

describe('PairingService pairing codes', () => {
  it('issue() returns a six-digit code bound to the token', () => {
    const service = makeService()
    const { token, code } = service.issue()
    expect(code).toMatch(/^\d{6}$/)
    expect(service.accept(code)).toEqual({ ok: true, deviceId: expect.any(String) })
    // The token itself is consumed by the code accept (one secret per token).
    expect(service.accept(token)).toEqual({ ok: false, code: 'used' })
  })

  it('accept() resolves the token secret as before', () => {
    const service = makeService()
    const { token } = service.issue()
    expect(service.accept(token)).toEqual({ ok: true, deviceId: expect.any(String) })
  })

  it('an unknown code is refused like an unknown token', () => {
    const service = makeService()
    service.issue()
    expect(service.accept('000000')).toEqual({ ok: false, code: 'invalid' })
  })

  it('a code is one-time: the second accept with it is refused', () => {
    const service = makeService()
    const { code } = service.issue()
    expect(service.accept(code).ok).toBe(true)
    expect(service.accept(code)).toEqual({ ok: false, code: 'used' })
  })

  it('re-issuing invalidates the previous code', () => {
    const service = makeService()
    const first = service.issue()
    const second = service.issue()
    expect(second.code).not.toBe(first.code)
    expect(service.accept(first.code)).toEqual({ ok: false, code: 'invalid' })
    expect(service.accept(second.code).ok).toBe(true)
  })

  it('stop() revokes the code along with the token', () => {
    const service = makeService()
    const { code } = service.issue()
    service.stop()
    expect(service.accept(code)).toEqual({ ok: false, code: 'invalid' })
  })

  it('an expired code is refused like an expired token', () => {
    const clock = makeClock()
    const service = makeService(clock)
    const { code } = service.issue()
    // Advance the clock past the 60 s token TTL.
    clock.advance(61_000)
    expect(service.accept(code)).toEqual({ ok: false, code: 'invalid' })
  })
})
