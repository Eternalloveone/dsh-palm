import { createCache } from '../kernels/cache.ts'
import { CACHE_POLICIES } from '../kernels/cache-policies.ts'
import type { ChatPageResult } from '../data/chat-page.ts'

/** Prefetched history pages keyed by their numeric cursor. */
export interface PagePrefetchCache {
  get(beforeSeq: number): ChatPageResult | undefined
  has(beforeSeq: number): boolean
  set(beforeSeq: number, page: ChatPageResult): void
  delete(beforeSeq: number): void
}

/** Bounded cursor cache for search-driven history navigation. */
export function createPagePrefetchCache(): PagePrefetchCache {
  const store = createCache<ChatPageResult>({ maxEntries: CACHE_POLICIES.pagePrefetch.maxEntries })
  return {
    get: beforeSeq => store.get(String(beforeSeq)),
    has: beforeSeq => store.has(String(beforeSeq)),
    set: (beforeSeq, page) => { store.set(String(beforeSeq), page) },
    delete: beforeSeq => { store.delete(String(beforeSeq)) },
  }
}
