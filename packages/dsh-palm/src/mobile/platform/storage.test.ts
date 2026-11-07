// @vitest-environment jsdom
/**
 * storage.ts — the persistent-bucket request.
 *
 * The property that matters is that every outcome is survivable: granted, refused,
 * unsupported or throwing all leave the caches working and leave something
 * readable in `storageInfo()` for the next capture. Asked for once, never twice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensurePersistentStorage, resetStorageRequest, storageInfo } from './storage.ts'

/** Install (or remove) a fake StorageManager on navigator. */
function stubStorage(value: unknown): void {
  Object.defineProperty(navigator, 'storage', { value, configurable: true })
}

beforeEach(() => {
  resetStorageRequest()
  stubStorage(undefined)
})

describe('persistent storage', () => {
  it('asks once and records the grant plus the estimate', async () => {
    const persist = vi.fn(async () => true)
    stubStorage({
      persist,
      persisted: async () => true,
      estimate: async () => ({ usage: 1024, quota: 4096 }),
    })

    await ensurePersistentStorage()
    await ensurePersistentStorage()

    expect(persist).toHaveBeenCalledTimes(1)
    expect(storageInfo()).toMatchObject({ persisted: true, usage: 1024, quota: 4096 })
    expect(storageInfo().at).toBeTypeOf('number')
  })

  it('treats a refusal as a normal outcome, not an error', async () => {
    stubStorage({
      persist: async () => false,
      persisted: async () => false,
      estimate: async () => ({ usage: 10, quota: 20 }),
    })

    await ensurePersistentStorage()

    expect(storageInfo()).toMatchObject({ persisted: false, usage: 10, quota: 20 })
    expect(storageInfo().note).toBeUndefined()
  })

  it('notes `denied` when the StorageManager throws', async () => {
    stubStorage({
      persist: async () => { throw new Error('nope') },
      persisted: async () => false,
      estimate: async () => { throw new Error('nope') },
    })

    await ensurePersistentStorage()

    expect(storageInfo().note).toBe('denied')
  })

  it('notes `unsupported` without a StorageManager', async () => {
    await ensurePersistentStorage()
    expect(storageInfo().note).toBe('unsupported')
  })

  it('survives a StorageManager that exposes neither method', async () => {
    stubStorage({})
    await ensurePersistentStorage()
    expect(storageInfo()).toMatchObject({ persisted: false })
    expect(storageInfo().note).toBeUndefined()
  })

  it('handles an estimate that omits the numbers', async () => {
    stubStorage({ persist: async () => true, persisted: async () => true, estimate: async () => ({}) })
    await ensurePersistentStorage()
    expect(storageInfo()).toMatchObject({ persisted: true })
    expect(storageInfo().usage).toBeUndefined()
  })
})
