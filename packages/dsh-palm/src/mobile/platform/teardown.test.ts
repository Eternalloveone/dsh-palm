// @vitest-environment jsdom
/**
 * Pairing teardown: every identity-scoped store is cleared from ONE call.
 *
 * The bug this pins: "remove this device" used to clear the roster cache, drafts
 * and pins only — the chat transcript cache kept its own index key and was never
 * registered, so a revoked phone could open its PWA offline and read the previous
 * identity's conversations. A teardown step failing must not stop the others.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onPairingTeardown, runPairingTeardown } from './teardown.ts'

const CHAT_ROW = 'dsh-palm.chat-cache.v1.s1'
const CHAT_INDEX = 'dsh-palm.chat-cache.v1.index'
const QUEUED_ECHO = 'dsh.palm.queuedEcho'
const VOICE_SERVICES = 'dsh.palm.voiceServices'

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(CHAT_ROW, '{"at":1,"rows":[]}')
  localStorage.setItem(CHAT_INDEX, '[{"sessionId":"s1","at":1}]')
  localStorage.setItem(QUEUED_ECHO, '[{"sessionId":"s1","text":"hi","at":1}]')
  localStorage.setItem(VOICE_SERVICES, '[{"id":"v1","name":"x","baseURL":"u","apiKey":"k","model":"m"}]')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runPairingTeardown', () => {
  it('clears every identity-scoped localStorage store in one call', async () => {
    await runPairingTeardown()
    expect(localStorage.getItem(CHAT_ROW)).toBeNull()
    expect(localStorage.getItem(CHAT_INDEX)).toBeNull()
    expect(localStorage.getItem(QUEUED_ECHO)).toBeNull()
    expect(localStorage.getItem(VOICE_SERVICES)).toBeNull()
  })

  it('keeps going when one step throws', async () => {
    const boom = new Error('boom')
    const unregister = onPairingTeardown(() => { throw boom })
    const after = vi.fn()
    const unregisterAfter = onPairingTeardown(after)
    const { failed } = await runPairingTeardown()
    expect(failed).toContain('boom')
    expect(after).toHaveBeenCalledOnce()
    // The built-ins still ran after the throwing step.
    expect(localStorage.getItem(CHAT_ROW)).toBeNull()
    unregister()
    unregisterAfter()
  })

  it('stops running an unregistered step', async () => {
    const step = vi.fn()
    const unregister = onPairingTeardown(step)
    unregister()
    await runPairingTeardown()
    expect(step).not.toHaveBeenCalled()
  })

  it('is safe without IndexedDB (history/outbox steps degrade, others still clear)', async () => {
    const { failed } = await runPairingTeardown()
    // jsdom has no IndexedDB; whatever the two IDB steps report, the
    // localStorage clears above must have happened.
    expect(Array.isArray(failed)).toBe(true)
    expect(localStorage.getItem(CHAT_ROW)).toBeNull()
  })
})
