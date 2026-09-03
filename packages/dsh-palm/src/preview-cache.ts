/**
 * Host-side last-message preview cache (v3.1).
 *
 * The session-list page used to pull one `session.history` read per preview
 * row — and every read is a FULL log parse on the host (JSONL is sequential
 * media: "tail 1 message" still scans the whole file), so a 12-row preview
 * burst cost up to twelve full parses of possibly-huge logs on EVERY list
 * visit. This service kills that cost:
 *
 * - `previews(sessionIds)` serves cached summaries in one RPC; a session
 *   without a cache entry is read lazily ONCE (tail 1 message, folded with
 *   the same pure fold the phone uses), then its entry is kept.
 * - The host mux event stream feeds every cached entry's tail state machine
 *   (O(1) per event): the last user/assistant/command message text keeps
 *   advancing live, so a repeat list visit is pure memory.
 * - Entries are LRU-bounded; cold sessions without events since the plugin
 *   started cost exactly one lazy log read over their whole lifetime.
 *
 * Summary semantics are identical to the phone's own preview path
 * (`previewSummary` on the last non-empty message text/reasoning) — the
 * state machine consumes the SAME event shapes the mobile fold does
 * (textFromContent / reasoningFromContent / chunkTarget).
 */

import { EventFolder, foldEvents, textFromContent, reasoningFromContent } from './mobile/messages.ts'
import type { WireEvent } from './mobile/messages.ts'
import { previewSummary } from './mobile/ui-text.ts'

/** LRU cap on cached entries (several hundred sessions fit comfortably). */
export const PREVIEW_CACHE_LIMIT = 500
/** Lazy-read concurrency cap (keep a slow tunnel quiet during a cold burst). */
export const PREVIEW_READ_CONCURRENCY = 3
/** One batch RPC may name at most this many sessions. */
export const PREVIEWS_MAX_SESSIONS = 200

/** The tail-state machine's view of the newest message. */
interface TailState {
  readonly kind: 'user' | 'assistant' | 'command'
  text: string
  reasoning?: string
  /** Latest event epoch ms that touched this message. */
  time: number
}

interface PreviewEntry {
  state: TailState | undefined
  /** `previewSummary` of the newest non-empty message ('' = nothing yet). */
  summary: string
  /** Epoch ms of the latest content that produced the summary. */
  updatedAt: number
  lastAccessedAt: number
}

/** One preview row served to the phone. */
export interface PreviewView {
  sessionId: string
  /** The one-line summary; '' when the session has no text content yet. */
  summary: string
  updatedAt: number
}

/** The lazy-read source: one tail-message history read (wired by the plugin). */
export type PreviewHistoryFetcher = (
  sessionId: string,
) => Promise<{ events: ReadonlyArray<{ event: WireEvent; view?: unknown }> }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** A text-delta target from a chunk event ({ text, kind }); null for others. */
function chunkTextOf(data: unknown): { text: string; kind: 'text' | 'reasoning' } | null {
  const record = isRecord(data) ? data : {}
  const chunk = record['chunk']
  if (isRecord(chunk)) {
    if (chunk['type'] !== 'text-delta' && chunk['type'] !== 'reasoning-delta') return null
    const text = pickString(chunk['text'])
    if (text === undefined) return null
    return { text, kind: chunk['type'] === 'reasoning-delta' ? 'reasoning' : 'text' }
  }
  const text = pickString(record['text'])
  if (text === undefined) return null
  return { text, kind: pickString(record['kind']) === 'reasoning' ? 'reasoning' : 'text' }
}

/** The newest non-empty summary over folded rows (phone-parity back-scan). */
function summaryOfRows(rows: ReadonlyArray<{ kind: string; text: string; reasoning?: string }>): string {
  for (let index = rows.length - 1; index >= 0; index--) {
    const message = rows[index]
    if (message === undefined) continue
    const source = message.text !== '' ? message.text : message.reasoning ?? ''
    if (source !== '') return previewSummary(source)
  }
  return ''
}

/** The tail state after a lazy read (the newest row, in state-machine shape). */
function stateOfRows(rows: ReadonlyArray<{ kind: string; text: string; reasoning?: string; time: number }>): TailState | undefined {
  const last = rows[rows.length - 1]
  if (last === undefined) return undefined
  return {
    kind: last.kind as TailState['kind'],
    text: last.text,
    ...(last.reasoning !== undefined && last.reasoning !== '' ? { reasoning: last.reasoning } : {}),
    time: last.time,
  }
}

/**
 * Preview cache + tail state machine. All methods are synchronous except the
 * lazy read; the mux watch feeds {@link onFrame} for the plugin lifetime.
 */
export class PreviewCacheService {
  private readonly entries = new Map<string, PreviewEntry>()
  /** Lazy reads in flight (dedupe simultaneous requests for one session). */
  private readonly inflight = new Map<string, Promise<PreviewView>>()

  constructor(private readonly fetchTail: PreviewHistoryFetcher) {}

  /** Number of resident entries (diagnostics/tests). */
  get size(): number {
    return this.entries.size
  }

  /** Drop every entry (tests; the service is otherwise process-lifetime). */
  clear(): void {
    this.entries.clear()
    this.inflight.clear()
  }

  /**
   * One batch preview read: cached summaries straight from memory; sessions
   * without an entry get one lazy tail read each (bounded concurrency, in
   * the same order as requested). A session whose read fails is returned
   * with an empty summary — the list row falls back to its stats line.
   */
  async previews(sessionIds: readonly string[], signal?: AbortSignal): Promise<PreviewView[]> {
    const unique = [...new Set(sessionIds)].slice(0, PREVIEWS_MAX_SESSIONS)
    const views: Array<PreviewView | undefined> = new Array(unique.length)
    const pending: number[] = []
    for (let index = 0; index < unique.length; index++) {
      const sessionId = unique[index]
      if (sessionId === undefined) continue
      const entry = this.entries.get(sessionId)
      if (entry !== undefined) {
        entry.lastAccessedAt = Date.now()
        views[index] = { sessionId, summary: entry.summary, updatedAt: entry.updatedAt }
      } else {
        pending.push(index)
      }
    }
    // Lazy reads: bounded concurrency, request order preserved.
    let cursor = 0
    const workers = Array.from({ length: Math.min(PREVIEW_READ_CONCURRENCY, pending.length) }, async () => {
      while (cursor < pending.length) {
        const index = pending[cursor]
        cursor += 1
        const sessionId = unique[index]
        if (sessionId === undefined) continue
        signal?.throwIfAborted()
        views[index] = await this.lazyRead(sessionId)
      }
    })
    await Promise.all(workers)
    return unique.map((sessionId, index) => views[index] ?? { sessionId, summary: '', updatedAt: 0 })
  }

  /** Feed one host mux `session/event` frame into the cached entries. */
  handleEvent(sessionId: string, event: WireEvent): void {
    const entry = this.entries.get(sessionId)
    if (entry === undefined) return
    this.applyEvent(entry, event)
  }

  /** Route one host mux frame (the shared background watch's per-frame hook). */
  onFrame(frame: { payload?: unknown }): void {
    const payload = frame?.payload as { type?: string; sessionId?: string; event?: WireEvent; view?: unknown } | undefined
    if (payload === null || typeof payload !== 'object') return
    if (payload.type !== 'session/event' || typeof payload.sessionId !== 'string' || payload.event === undefined) return
    this.handleEvent(payload.sessionId, payload.view === undefined ? payload.event : { ...payload.event, view: payload.view })
  }

  /** One lazy tail read, cached and shared across concurrent requests. */
  private lazyRead(sessionId: string): Promise<PreviewView> {
    const inflight = this.inflight.get(sessionId)
    if (inflight !== undefined) return inflight
    const promise = (async (): Promise<PreviewView> => {
      try {
        const page = await this.fetchTail(sessionId)
        const events = page.events.map(entry => (
          entry.view === undefined ? entry.event : { ...entry.event, view: entry.view }
        ))
        const rows = new EventFolder(foldEvents(events)).snapshot()
        const summary = summaryOfRows(rows)
        const state = stateOfRows(rows)
        const entry: PreviewEntry = {
          state,
          summary,
          updatedAt: state?.time ?? Date.now(),
          lastAccessedAt: Date.now(),
        }
        this.put(sessionId, entry)
        return { sessionId, summary, updatedAt: entry.updatedAt }
      } catch {
        // A session that cannot be read (deleted, transient log error) is
        // served as an empty preview — the list must never block on it.
        return { sessionId, summary: '', updatedAt: 0 }
      } finally {
        this.inflight.delete(sessionId)
      }
    })()
    this.inflight.set(sessionId, promise)
    return promise
  }

  /** Insert with LRU eviction past the cap. */
  private put(sessionId: string, entry: PreviewEntry): void {
    if (!this.entries.has(sessionId) && this.entries.size >= PREVIEW_CACHE_LIMIT) {
      let oldest: { id: string; at: number } | undefined
      for (const [id, candidate] of this.entries) {
        if (oldest === undefined || candidate.lastAccessedAt < oldest.at) oldest = { id, at: candidate.lastAccessedAt }
      }
      if (oldest !== undefined) this.entries.delete(oldest.id)
    }
    this.entries.set(sessionId, entry)
  }

  /** The tail state machine: keep the newest message's text/reasoning live. */
  private applyEvent(entry: PreviewEntry, event: WireEvent): void {
    const state = entry.state
    const data = isRecord(event.data) ? event.data : {}
    switch (event.type) {
      case 'user/message': {
        const text = textFromContent(data['content'])
        entry.state = { kind: 'user', text, time: event.time }
        if (text !== '') {
          entry.summary = previewSummary(text)
          entry.updatedAt = event.time
        }
        break
      }
      case 'assistant/message': {
        const messageData = isRecord(data['message']) ? data['message'] : data
        const text = textFromContent(messageData['content'])
        const reasoning = reasoningFromContent(messageData['content'])
        entry.state = {
          kind: 'assistant',
          text,
          ...(reasoning !== '' ? { reasoning } : {}),
          time: event.time,
        }
        const source = text !== '' ? text : reasoning
        if (source !== '') {
          entry.summary = previewSummary(source)
          entry.updatedAt = event.time
        }
        break
      }
      case 'assistant/chunk':
      case 'message/chunk': {
        const chunk = chunkTextOf(event.data)
        if (chunk === null) break
        if (state !== undefined && state.kind === 'assistant') {
          entry.state = chunk.kind === 'reasoning'
            ? { ...state, reasoning: (state.reasoning ?? '') + chunk.text, time: event.time }
            : { ...state, text: state.text + chunk.text, time: event.time }
        } else {
          entry.state = chunk.kind === 'reasoning'
            ? { kind: 'assistant', text: '', reasoning: chunk.text, time: event.time }
            : { kind: 'assistant', text: chunk.text, time: event.time }
        }
        const source = entry.state.text !== '' ? entry.state.text : entry.state.reasoning ?? ''
        if (source !== '') {
          entry.summary = previewSummary(source)
          entry.updatedAt = event.time
        }
        break
      }
      case 'message/update': {
        // The mobile alias rewrites the text of the target message; the
        // cache only tracks the newest one, so an update lands when the
        // newest row is a user message (the fold's common in-place edit).
        if (state !== undefined && state.kind === 'user') {
          const text = pickString(data['text']) ?? state.text
          entry.state = { ...state, text, time: event.time }
          if (text !== '') {
            entry.summary = previewSummary(text)
            entry.updatedAt = event.time
          }
        }
        break
      }
      case 'command/run': {
        // The card starts empty; only its result text previews.
        entry.state = { kind: 'command', text: '', time: event.time }
        break
      }
      case 'command/done': {
        const resultText = pickString(data['text']) ?? ''
        entry.state = { kind: 'command', text: resultText, time: event.time }
        if (resultText !== '') {
          entry.summary = previewSummary(resultText)
          entry.updatedAt = event.time
        }
        break
      }
      default:
        break
    }
  }
}
