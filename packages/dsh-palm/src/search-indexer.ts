/**
 * Search index maintenance: full backfill once per session, then "newer" syncs.
 *
 * The index only ever learns from the caller (`listSessions` roster + a
 * `readRows` page reader that folds history the same way the chat renders), so
 * this module stays testable and free of host imports.
 *
 * Sync rules per session:
 *   - never indexed, or an earlier full walk was cut short → `full`
 *     (walk newest → oldest, resuming from `oldestSeq` when a pass ran out of pages)
 *   - `updatedAt` moved past the indexed watermark              → `newer`
 *     (walk newest → oldest until the page reaches the watermark)
 *   - `updatedAt` unchanged and complete                        → `skip` (zero history reads)
 *   - gone from the roster                                      → drop its docs
 */

import type { SearchIndex, SearchIndexRow } from './search-index.ts'

/** Session metadata the indexer needs (a subset of the roster row). */
export interface SyncSessionMeta {
  sessionId: string
  updatedAt: number
  title?: string
  workspaceId?: string
}

/** A page of folded, seq-mapped rows read from one session's history. */
export interface SyncPage {
  rows: readonly SearchIndexRow[]
  hasMore: boolean
  /**
   * Cursor for the NEXT (older) read, derived from every event in the page —
   * not just the rows that made it into the index. A page can fold to zero
   * rows (a stretch of tool/reasoning events) while `hasMore` stays true; without
   * this cursor such a page is a dead end and the session can never finish
   * (measured: 59/317 sessions stuck mid-walk, every pass re-reading the same page).
   */
  nextBeforeSeq?: number
}

export type SyncMode = 'full' | 'newer' | 'skip'

export interface SyncPlan {
  mode: SyncMode
  /** Why this decision was made (shows up in the shadow log / diagnostics). */
  reason: string
}

/** Decide whether a session needs indexing, without reading any history. */
export function planSync(
  meta: SyncSessionMeta,
  state: { updatedAt: number; complete: boolean; indexedThroughSeq: number; oldestSeq?: number } | undefined,
): SyncPlan {
  if (state === undefined) return { mode: 'full', reason: 'not-indexed' }
  if (!state.complete) return { mode: 'full', reason: 'resume' }
  if (meta.updatedAt > state.updatedAt) return { mode: 'newer', reason: 'updated' }
  return { mode: 'skip', reason: 'fresh' }
}

export interface SearchIndexerDeps {
  index: SearchIndex
  /** Ordinary (non-subagent) sessions only — the roster the phone may show. */
  listSessions(): Promise<readonly SyncSessionMeta[]>
  /** Read one history page, folded and seq-mapped. `beforeSeq` walks backwards. */
  readRows(sessionId: string, beforeSeq: number | undefined, maxMessages: number): Promise<SyncPage>
  now?(): number
  log?(message: string): void
  /** History messages requested per page (the host default elsewhere is 25). */
  pageSize?: number
  /** Cap on pages per session per run (a huge session resumes on the next run). */
  maxPagesPerSession?: number
  /** Consecutive empty pages after which the older history is skipped for good. */
  maxEmptyPagesPerSession?: number
  /** Pause between pages so the host event loop stays responsive. */
  throttleMs?: number
  /** Sessions walked concurrently. */
  concurrency?: number
}

export interface SyncRunResult {
  sessions: number
  indexed: number
  docs: number
  pages: number
  skipped: number
  dropped: number
  tookMs: number
  errors: number
  /** Sessions whose older history was skipped (tool-only stretch / page cap). */
  truncated: number
}

export interface SearchIndexerStatus {
  running: boolean
  /** True once a pass needed no work at all (every roster session is current). */
  ready: boolean
  sessionsTotal: number
  sessionsIndexed: number
  docs: number
  bytes: number
  lastRun?: { tookMs: number; sessions: number; docs: number; pages: number; indexed: number; skipped: number }
}

const DEFAULT_PAGE_SIZE = 60
const DEFAULT_MAX_PAGES = 240
const DEFAULT_THROTTLE_MS = 60
const DEFAULT_CONCURRENCY = 4
/**
 * Consecutive empty pages tolerated before a session's backward walk is declared
 * done. Tool/reasoning-only stretches are common and each history read costs ~10s
 * on big logs, so walking them to the very beginning is not worth it: the newest
 * pages are already indexed, older messages in those particular sessions are not.
 */
const DEFAULT_MAX_EMPTY_PAGES = 8
/** Delay before the very first background walk (let the host finish booting). */
export const DEFAULT_START_DELAY_MS = 15_000
/** Re-check cadence once the first pass finished. */
export const DEFAULT_RESYNC_MS = 5 * 60_000

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Background indexer. `runOnce()` is the unit of work; `start()` wires it to a
 * delayed first pass plus a periodic re-sync, and never throws outward: a failed
 * pass leaves the previous index content in place and simply retries later.
 */
export class SearchIndexer {
  private readonly deps: SearchIndexerDeps
  private readonly pageSize: number
  private readonly maxPages: number
  private readonly throttleMs: number
  private readonly concurrency: number
  private readonly maxEmptyPages: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private stopped = false
  private lastRun: SyncRunResult | undefined
  private sessionsTotal = 0
  private sessionsIndexed = 0
  private lastAt = 0

  constructor(deps: SearchIndexerDeps) {
    this.deps = deps
    this.pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE
    this.maxPages = deps.maxPagesPerSession ?? DEFAULT_MAX_PAGES
    this.throttleMs = deps.throttleMs ?? DEFAULT_THROTTLE_MS
    this.concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY)
    this.maxEmptyPages = Math.max(1, deps.maxEmptyPagesPerSession ?? DEFAULT_MAX_EMPTY_PAGES)
  }

  /** One full pass over the roster: prune, then sync every session that needs it. */
  async runOnce(): Promise<SyncRunResult> {
    const started = this.now()
    const roster = await this.deps.listSessions()
    this.sessionsTotal = roster.length
    const rosterIds = new Set(roster.map(item => item.sessionId))
    let dropped = 0
    for (const sessionId of this.deps.index.indexedSessionIds()) {
      if (rosterIds.has(sessionId)) continue
      this.deps.index.dropSession(sessionId)
      dropped += 1
    }

    const queue = [...roster]
    const totals: SyncRunResult = { sessions: roster.length, indexed: 0, docs: 0, pages: 0, skipped: 0, dropped, tookMs: 0, errors: 0, truncated: 0 }
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < queue.length) {
        const position = next
        next += 1
        const meta = queue[position]
        if (meta === undefined) continue
        const state = this.deps.index.sessionState(meta.sessionId)
        const plan = planSync(meta, state)
        if (plan.mode === 'skip') {
          totals.skipped += 1
          continue
        }
        try {
          totals.docs += await this.syncSession(meta, state, plan, totals)
          totals.indexed += 1
        } catch (error) {
          totals.errors += 1
          this.log(`sync failed for ${meta.sessionId}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, () => worker()))
    totals.tookMs = this.now() - started
    this.lastRun = totals
    this.lastAt = this.now()
    this.sessionsIndexed = roster.length - totals.skipped
    this.log(`pass: ${totals.indexed}/${totals.sessions} sessions, ${totals.docs} docs, ${totals.pages} pages, ${totals.truncated} truncated, ${totals.tookMs}ms`)
    return totals
  }

  private async syncSession(
    meta: SyncSessionMeta,
    state: { updatedAt: number; complete: boolean; indexedThroughSeq: number; oldestSeq: number } | undefined,
    plan: SyncPlan,
    totals: SyncRunResult,
  ): Promise<number> {
    const collected: SearchIndexRow[] = []
    const watermark = state?.indexedThroughSeq ?? -1
    const full = plan.mode === 'full'
    // A resumed full walk continues from the oldest seq already indexed.
    let beforeSeq: number | undefined = full && state !== undefined && state.oldestSeq >= 0 ? state.oldestSeq : undefined
    let complete = state?.complete === true
    let pages = 0
    let emptyRun = 0
    let maxSeq = state?.indexedThroughSeq ?? -1
    let oldestSeq = state?.oldestSeq ?? -1
    for (; pages < this.maxPages; pages++) {
      const page = await this.deps.readRows(meta.sessionId, beforeSeq, this.pageSize)
      totals.pages += 1
      if (page.rows.length === 0) {
        // 整页都是不进索引的事件（工具、推理、系统帧）。必须按页游标继续往更早走，
        // 否则每一趟都停在同一页：会话永远 complete 不了，后台每 5 分钟白读一遍。
        if (!page.hasMore) {
          complete = true
          break
        }
        const next = page.nextBeforeSeq
        if (next === undefined || (beforeSeq !== undefined && next >= beforeSeq)) break
        emptyRun += 1
        if (emptyRun >= this.maxEmptyPages) {
          // 连续这么多页都没有正文：认了（更早的消息不进索引），
          // 否则每一趟都要把它们重读一遍，永远建不完。
          totals.truncated += 1
          complete = true
          break
        }
        beforeSeq = next
        await sleep(this.throttleMs)
        continue
      }
      let minSeq = Number.POSITIVE_INFINITY
      for (const row of page.rows) {
        collected.push(row)
        if (row.seq > maxSeq) maxSeq = row.seq
        if (row.seq < minSeq) minSeq = row.seq
      }
      emptyRun = 0
      if (oldestSeq < 0 || minSeq < oldestSeq) oldestSeq = minSeq
      if (!page.hasMore) {
        complete = true
        break
      }
      // A "newer" walk is done as soon as this page reaches what we already had:
      // everything older is indexed and unchanged.
      if (!full && watermark >= 0 && minSeq <= watermark) break
      if (beforeSeq !== undefined && Number.isFinite(minSeq) && minSeq >= beforeSeq) break
      beforeSeq = Number.isFinite(minSeq) ? minSeq : undefined
      if (beforeSeq === undefined) break
      await sleep(this.throttleMs)
    }
    return this.deps.index.upsertSession(
      {
        sessionId: meta.sessionId,
        ...(meta.title !== undefined ? { title: meta.title } : {}),
        ...(meta.workspaceId !== undefined ? { workspaceId: meta.workspaceId } : {}),
        updatedAt: meta.updatedAt,
        complete,
        indexedThroughSeq: maxSeq,
        oldestSeq,
      },
      collected,
      this.now(),
    )
  }

  /** First pass after {@link DEFAULT_START_DELAY_MS}, then every `resyncMs`. */
  start(options: { delayMs?: number; resyncMs?: number } = {}): void {
    if (this.timer !== undefined || this.stopped) return
    const delay = options.delayMs ?? DEFAULT_START_DELAY_MS
    const resync = options.resyncMs ?? DEFAULT_RESYNC_MS
    const tick = async (): Promise<void> => {
      if (this.stopped) return
      this.running = true
      try {
        await this.runOnce()
      } catch (error) {
        this.log(`pass threw: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        this.running = false
      }
      if (this.stopped) return
      this.timer = setTimeout(() => { void tick() }, resync)
      this.timer.unref?.()
    }
    this.timer = setTimeout(() => { void tick() }, delay)
    this.timer.unref?.()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  status(): SearchIndexerStatus {
    const stats = this.deps.index.stats()
    return {
      running: this.running,
      ready: this.lastRun !== undefined && this.lastRun.indexed === 0,
      sessionsTotal: this.sessionsTotal,
      sessionsIndexed: this.sessionsIndexed,
      docs: stats.docs,
      bytes: stats.bytes,
      ...(this.lastRun === undefined
        ? {}
        : {
            lastRun: {
              tookMs: this.lastRun.tookMs,
              sessions: this.lastRun.sessions,
              docs: this.lastRun.docs,
              pages: this.lastRun.pages,
              indexed: this.lastRun.indexed,
              skipped: this.lastRun.skipped,
            },
          }),
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private log(message: string): void {
    this.deps.log?.(message)
  }
}
