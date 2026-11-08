import { describe, expect, it, vi } from 'vitest'
import { createListCacheSlice } from './list-cache-slice.ts'
import type { ListCacheDeps } from './list-cache-slice.ts'

function makeDeps(overrides: Partial<ListCacheDeps> = {}): ListCacheDeps & {
  sessionListCache: Map<string, { rows: readonly unknown[]; hasMore: boolean; at: number }>
  queuePersistedList: ReturnType<typeof vi.fn>
  queuePersistedPreviews: ReturnType<typeof vi.fn>
  maintainPersistedCaches: ReturnType<typeof vi.fn>
} {
  const sessionListCache = new Map()
  return {
    sessionListCache,
    loadPersistedPreviews: () => [['s-1', 'persisted summary']] as Array<[string, string]>,
    maintainPersistedCaches: vi.fn(),
    queuePersistedList: vi.fn(),
    queuePersistedPreviews: vi.fn(),
    ...overrides,
  } as never
}

describe('list-cache-slice', () => {
  it('seeds the preview cache from the persisted store exactly once', () => {
    const deps = makeDeps()
    const slice = createListCacheSlice(deps)
    slice.ensureSeeded()
    expect(slice.sessionPreviewCache.get('s-1')).toBe('persisted summary')
    expect(deps.maintainPersistedCaches).toHaveBeenCalledTimes(1)

    slice.sessionPreviewCache.set('s-2', 'fresh')
    slice.ensureSeeded()
    // 第二次不再回灌，也不会用持久层覆盖内存里的新值
    expect(slice.sessionPreviewCache.get('s-2')).toBe('fresh')
    expect(deps.maintainPersistedCaches).toHaveBeenCalledTimes(1)
  })

  it('writes the roster page to memory with a timestamp and queues persistence', () => {
    const deps = makeDeps()
    const slice = createListCacheSlice(deps)
    slice.writeList('ws-1', { rows: [{ id: 'a' }], hasMore: true })
    const cached = deps.sessionListCache.get('ws-1')
    expect(cached?.rows).toHaveLength(1)
    expect(typeof cached?.at).toBe('number')
    expect(deps.queuePersistedList).toHaveBeenCalledWith('ws-1', { rows: [{ id: 'a' }], hasMore: true })
  })

  it('never persists inside the write path of the preview map', () => {
    const deps = makeDeps()
    const slice = createListCacheSlice(deps)
    slice.ensureSeeded()
    expect(deps.queuePersistedPreviews).not.toHaveBeenCalled()
    slice.syncPreviews()
    expect(deps.queuePersistedPreviews).toHaveBeenCalledTimes(1)
    expect(deps.queuePersistedPreviews.mock.calls[0][0]).toBe(slice.sessionPreviewCache)
  })
})
