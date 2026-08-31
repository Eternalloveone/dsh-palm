/** mux: live-event client, SSE delivery + stall-driven polling fallback. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MuxClient, type EventSourceLike } from './mux.ts'
import { EventFolder, type WireEvent } from './messages.ts'
import { RpcTransportError } from './rpc.ts'
import type { HistoryPage } from './api.ts'

/** A recorded fake EventSource (delivery driven by the test). */
interface FakeSource extends EventSourceLike {
  url: string
  closed: boolean
  close: () => void
}

/** Create an EventSource factory that records every opened source. */
function makeSources(): { factory: (url: string) => EventSourceLike; sources: FakeSource[] } {
  const sources: FakeSource[] = []
  const factory = (url: string): EventSourceLike => {
    const source: FakeSource = {
      url,
      onmessage: null,
      onerror: null,
      closed: false,
      close: () => { source.closed = true },
    }
    sources.push(source)
    return source
  }
  return { factory, sources }
}

/** One history page whose events carry sequential ids. */
function pageOf(seqs: readonly number[]): HistoryPage {
  return {
    hasMore: false,
    events: seqs.map(seq => ({
      event: { type: 'user/message', seq, time: seq * 1_000, data: { text: String(seq) } },
    })),
  } as unknown as HistoryPage
}

/** The inclusive integer range [from, to]. */
function buildRange(from: number, to: number): number[] {
  const out: number[] = []
  for (let value = from; value <= to; value += 1) out.push(value)
  return out
}

/** A server-request envelope carrying one mux frame (the SSE wire shape). */
function envelopeWith(payload: unknown): string {
  return JSON.stringify({ type: 'server-request', rpcId: 'r1', method: 'events.mux', payload })
}

/** Options common to every test: tight clocks, injected data source. */
function baseOptions(pollLatest: (sessionId: string) => Promise<HistoryPage>, factory: (url: string) => EventSourceLike) {
  return { sourceFactory: factory, pollLatest, stallThresholdMs: 800, pollIntervalMs: 400 }
}

describe('MuxClient polling fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('does not poll while the SSE channel is fresh', async () => {
    const { factory } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const frames: unknown[] = []
    client.onFrame(frame => { frames.push(frame) })
    client.start()
    client.observe('s1')
    await vi.advanceTimersByTimeAsync(400) // well under the stall threshold
    expect(pollLatest).not.toHaveBeenCalled()
    expect(frames).toHaveLength(0)
    client.stop()
  })

  it('starts polling after silence and emits appended events as session/event frames', async () => {
    const { factory } = makeSources()
    const pages = [pageOf([0]), pageOf([0, 1])]
    const pollLatest = vi.fn(async (_sessionId: string) => pages.shift() ?? pageOf([]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const frames: Array<{ type: string; sessionId: string; event?: { seq: number } }> = []
    client.onFrame(frame => { frames.push(frame as never) })
    client.start()
    client.observe('s1')

    // Nothing live within a poll interval until the stall window passes.
    await vi.advanceTimersByTimeAsync(400)
    expect(pollLatest).not.toHaveBeenCalled()

    // The single tick (400 ms) crosses the 800 ms stall threshold at 1200 ms:
    // the same tick then runs the first poll and emits seq 0.
    await vi.advanceTimersByTimeAsync(800) // 1200ms total -> first stall crossing tick
    expect(pollLatest).toHaveBeenCalledWith('s1')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ type: 'session/event', sessionId: 's1' })
    expect(frames[0]?.event).toMatchObject({ seq: 0 })

    // The next poll emits only the appended event (seq 1), not seq 0 again.
    await vi.advanceTimersByTimeAsync(400)
    expect(frames).toHaveLength(2)
    expect(frames[1]?.event).toMatchObject({ seq: 1 })
    client.stop()
  })

  it('sorts an out-of-order history page before advancing the watermark', async () => {
    const { factory } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([2, 1, 3]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const seqs: number[] = []
    client.onFrame((frame) => {
      if (frame.type === 'session/event' && typeof frame.event.seq === 'number') seqs.push(frame.event.seq)
    })
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1200)
    expect(seqs).toEqual([1, 2, 3])
    client.stop()
  })

  it('emits a multi-page gap refill strictly ascending across pages', async () => {
    const { factory } = makeSources()
    // First poll plants the watermark at 100; the second poll finds a gap
    // wider than one page, so the chain pulls the tail page (151..200) then
    // the older refill page (101..150). The tail page arrives first — the
    // emitted order must still come out ascending overall, or the fold
    // consumer's per-batch watermark would read the refill as replays and
    // drop the whole 101..150 range forever.
    const pages = [pageOf([100]), pageOf(buildRange(151, 200)), pageOf(buildRange(101, 150))]
    const pollLatest = vi.fn(async (_sessionId: string) => pages.shift() ?? pageOf([]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const seqs: number[] = []
    client.onFrame((frame) => {
      if (frame.type === 'session/event' && typeof frame.event.seq === 'number') seqs.push(frame.event.seq)
    })
    client.start()
    client.observe('s1')

    // First poll: no watermark yet -> tail page only, watermark = 100.
    await vi.advanceTimersByTimeAsync(1200)
    expect(seqs).toEqual([100])

    // Second poll: the two-page gap refill arrives in one strictly
    // ascending run — the refill page before the tail page.
    await vi.advanceTimersByTimeAsync(400)
    expect(seqs).toEqual([100, ...buildRange(101, 200)])
    client.stop()
  })

  it('a gap refill loses no rows to the fold consumer (per-frame fold, ChatView path)', async () => {
    const { factory } = makeSources()
    const pages = [pageOf([100]), pageOf(buildRange(151, 200)), pageOf(buildRange(101, 150))]
    const pollLatest = vi.fn(async (_sessionId: string) => pages.shift() ?? pageOf([]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const folder = new EventFolder()
    client.onFrame((frame) => {
      if (frame.type === 'session/event') {
        // ChatView folds each delivered frame on its own: the fold's
        // watermark is re-snapshotted per call, so any out-of-order emit
        // would permanently discard the rows that arrive late.
        folder.fold([frame.event as unknown as WireEvent])
      }
    })
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1200) // watermark = 100
    await vi.advanceTimersByTimeAsync(400) // gap refill chain emitted

    const folded = folder.snapshot().map(message => message.seq)
    expect(folded).toEqual(buildRange(100, 200))
    client.stop()
  })

  it('keeps the watermark so a repeated page never re-emits old events', async () => {
    const { factory } = makeSources()
    // Two calls return the same page: the second must emit nothing.
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0, 1, 2]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const frames: Array<{ type: string; event?: { seq: number } }> = []
    client.onFrame(frame => { frames.push(frame as never) })
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1200) // first poll -> 3 events
    expect(frames).toHaveLength(3)

    await vi.advanceTimersByTimeAsync(400) // second poll -> same page, nothing new
    expect(frames).toHaveLength(3)
    client.stop()
  })

  it('stops polling when observe is cleared and keeps it stopped', async () => {
    const { factory } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1200)
    expect(pollLatest).toHaveBeenCalled()

    client.observe(undefined)
    const callsAfterClear = pollLatest.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(pollLatest.mock.calls.length).toBe(callsAfterClear)
    client.stop()
  })

  it('stops polling on stop(), closing any live source', async () => {
    const { factory, sources } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1200)
    expect(pollLatest).toHaveBeenCalled()

    client.stop()
    const callsAfterStop = pollLatest.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(pollLatest.mock.calls.length).toBe(callsAfterStop)
    expect(sources[0]?.closed).toBe(true)
  })

  it('returns to SSE when a frame arrives, dropping the fallback poller', async () => {
    const { factory, sources } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const frames: unknown[] = []
    client.onFrame(frame => { frames.push(frame) })
    client.start()
    client.observe('s1')

    // Stall into polling.
    await vi.advanceTimersByTimeAsync(1200)
    expect(pollLatest).toHaveBeenCalledTimes(1)

    // A live mux frame proves SSE delivers again -> fallback stops.
    sources[0]?.onmessage?.({ data: envelopeWith({ type: 'session/subscribed', sessionId: 's1', lastSeq: 4 }) })

    await vi.advanceTimersByTimeAsync(2000)
    expect(pollLatest.mock.calls.length).toBe(1) // polling stopped after the live frame
    const live = frames.filter(frame => (frame as { type?: string })?.type === 'session/subscribed')
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ type: 'session/subscribed', sessionId: 's1' })
    client.stop()
  })

  it('recovers when a previously-live SSE stream becomes silently stalled', async () => {
    const { factory, sources } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([5]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    const frames: Array<{ type: string; event?: { seq: number } }> = []
    client.onFrame(frame => { frames.push(frame as never) })
    client.start()
    client.observe('s1')

    sources[0]?.onmessage?.({ data: envelopeWith({ type: 'session/subscribed', sessionId: 's1', lastSeq: 4 }) })
    await vi.advanceTimersByTimeAsync(2400)
    expect(pollLatest).not.toHaveBeenCalled()

    // A once-live stream gets three stall windows; the next scheduler tick
    // crosses that boundary and starts the ordinary-HTTP recovery path.
    await vi.advanceTimersByTimeAsync(400)
    expect(pollLatest).toHaveBeenCalledTimes(1)
    expect(frames.at(-1)?.event).toMatchObject({ seq: 5 })
    client.stop()
  })

  it('backs empty polls off and resets to the base cadence after progress', async () => {
    const { factory } = makeSources()
    const pages = [pageOf([]), pageOf([1]), pageOf([1, 2])]
    const pollLatest = vi.fn(async (_sessionId: string) => pages.shift() ?? pageOf([]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1200)
    expect(pollLatest).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(400)
    expect(pollLatest).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(400)
    expect(pollLatest).toHaveBeenCalledTimes(2)

    // The productive second poll resets the next delay from 800 ms to 400 ms.
    await vi.advanceTimersByTimeAsync(400)
    expect(pollLatest).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(400)
    expect(pollLatest).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(400)
    expect(pollLatest).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(400)
    expect(pollLatest).toHaveBeenCalledTimes(5)
    client.stop()
  })

  it('drives the whole lifecycle on a single scheduler tick (one interval)', async () => {
    const { factory } = makeSources()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    try {
      const pages = [pageOf([0]), pageOf([0, 1])]
      const pollLatest = vi.fn(async (_sessionId: string) => pages.shift() ?? pageOf([]))
      const client = new MuxClient('/m/api/events.mux', {
        sourceFactory: factory,
        pollLatest,
        stallThresholdMs: 1500,
        pollIntervalMs: 2000,
      })
      client.start()
      client.observe('s1')

      // Exactly one interval is ever created: the single tick scheduler.
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)

      // The tick fires below the stall threshold without polling.
      await vi.advanceTimersByTimeAsync(1000)
      expect(pollLatest).not.toHaveBeenCalled()

      // The same interval arms the fallback once silence passes the threshold
      // (tick at 2000 crosses 1500) and runs the first poll immediately.
      await vi.advanceTimersByTimeAsync(1100) // 2100ms total
      expect(pollLatest).toHaveBeenCalledTimes(1)
      expect(setIntervalSpy).toHaveBeenCalledTimes(1) // still one timer

      // Subsequent polls ride the same tick at the poll cadence (2000 ms).
      await vi.advanceTimersByTimeAsync(2000)
      expect(pollLatest).toHaveBeenCalledTimes(2)
      client.stop()
    } finally {
      setIntervalSpy.mockRestore()
    }
  })

  it('paces polls on the tick only after the stall phase ends', async () => {
    const { factory } = makeSources()
    const pages = [pageOf([0]), pageOf([0, 1]), pageOf([0, 1, 2]), pageOf([0, 1, 2, 3])]
    const pollLatest = vi.fn(async (_sessionId: string) => pages.shift() ?? pageOf([]))
    const client = new MuxClient('/m/api/events.mux', {
      sourceFactory: factory,
      pollLatest,
      stallThresholdMs: 800,
      pollIntervalMs: 400,
    })
    client.start()
    client.observe('s1')

    // At 1200 ms the stall threshold is crossed on this single 400 ms tick.
    await vi.advanceTimersByTimeAsync(1200)
    expect(pollLatest).toHaveBeenCalledTimes(1)

    // Each subsequent 400 ms tick is a poll, matching the poll cadence.
    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(400)
    expect(pollLatest).toHaveBeenCalledTimes(4)
    client.stop()
  })

  it('observe() already in the stall window starts the single-tick poller immediately', async () => {
    const { factory } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([0]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    client.start()
    // Advance well past the stall threshold while nothing is observed.
    await vi.advanceTimersByTimeAsync(2000)
    expect(pollLatest).not.toHaveBeenCalled()

    // Observing a session now is already in the stall window: poll right away.
    client.observe('s1')
    expect(pollLatest).toHaveBeenCalledTimes(1)
    client.stop()
  })

  it('a session switch resets the backoff: the new session polls right away', async () => {
    const { factory } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    client.start()
    client.observe('s1')
    // Empty polls back off: by the second poll the delay has grown past the
    // base cadence (interval doubling), so polls are spaced far apart.
    await vi.advanceTimersByTimeAsync(3000)
    const pollsBeforeSwitch = pollLatest.mock.calls.length
    expect(pollsBeforeSwitch).toBeGreaterThanOrEqual(2)

    // Switching to a different session drops the old session's stall: the
    // next scheduler tick (400 ms) must fire the poller again immediately
    // (fresh pollDelay, nextPollAt=0).
    client.observe('s2')
    await vi.advanceTimersByTimeAsync(450)
    expect(pollLatest.mock.calls.length).toBeGreaterThan(pollsBeforeSwitch)
    expect(pollLatest.mock.calls[pollLatest.mock.calls.length - 1]?.[0]).toBe('s2')
    client.stop()
  })

  it('poke() drops the backoff so the fallback polls immediately', async () => {
    const { factory } = makeSources()
    const pollLatest = vi.fn(async (_sessionId: string) => pageOf([]))
    const client = new MuxClient('/m/api/events.mux', baseOptions(pollLatest, factory))
    client.start()
    client.observe('s1')
    await vi.advanceTimersByTimeAsync(3000)
    const pollsBefore = pollLatest.mock.calls.length
    expect(pollsBefore).toBeGreaterThanOrEqual(2)

    // A user action (prompt sent) pokes: the next scheduler tick fires the
    // poll instead of waiting out the backoff window.
    client.poke()
    await vi.advanceTimersByTimeAsync(450)
    expect(pollLatest.mock.calls.length).toBeGreaterThan(pollsBefore)
    client.stop()
  })

  it('stops polling and notifies onUnpaired when a poll hits a terminal 403 (unpaired)', async () => {
    const { factory, sources } = makeSources()
    const onUnpaired = vi.fn()
    const pollLatest = vi.fn(async (_sessionId: string) => {
      throw new RpcTransportError('HTTP 403')
    })
    const client = new MuxClient('/m/api/events.mux', {
      sourceFactory: factory,
      pollLatest,
      stallThresholdMs: 800,
      pollIntervalMs: 400,
      onUnpaired,
    })
    client.start()
    client.observe('s1')

    // Stall into polling; the first poll throws 403 (device revoked/stopped).
    await vi.advanceTimersByTimeAsync(1200)
    expect(pollLatest).toHaveBeenCalledTimes(1)
    expect(onUnpaired).toHaveBeenCalledTimes(1)

    // The client stopped itself: no further polls, and the source is closed —
    // no zombie polling into a 60 s backoff after revoke/stop.
    const callsAfter = pollLatest.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(pollLatest.mock.calls.length).toBe(callsAfter)
    expect(sources[0]?.closed).toBe(true)
    client.stop()
  })

  it('treats a 401 as terminal too (unpaired), stopping the poller', async () => {
    const { factory, sources } = makeSources()
    const onUnpaired = vi.fn()
    const pollLatest = vi.fn(async (_sessionId: string) => {
      throw new RpcTransportError('HTTP 401')
    })
    const client = new MuxClient('/m/api/events.mux', {
      sourceFactory: factory,
      pollLatest,
      stallThresholdMs: 800,
      pollIntervalMs: 400,
      onUnpaired,
    })
    client.start()
    client.observe('s1')

    await vi.advanceTimersByTimeAsync(1200)
    expect(onUnpaired).toHaveBeenCalledTimes(1)
    const callsAfter = pollLatest.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(pollLatest.mock.calls.length).toBe(callsAfter)
    expect(sources[0]?.closed).toBe(true)
    client.stop()
  })

  it('keeps polling (backoff) on a transient error, not a terminal one', async () => {
    const { factory } = makeSources()
    const onUnpaired = vi.fn()
    const pollLatest = vi.fn(async (_sessionId: string) => {
      throw new RpcTransportError('HTTP 503')
    })
    const client = new MuxClient('/m/api/events.mux', {
      sourceFactory: factory,
      pollLatest,
      stallThresholdMs: 800,
      pollIntervalMs: 400,
      onUnpaired,
    })
    client.start()
    client.observe('s1')

    // A 503 is transient: the poller stays alive (backing off) and the UI is
    // NOT told the device is unpaired.
    await vi.advanceTimersByTimeAsync(1200)
    expect(pollLatest).toHaveBeenCalledTimes(1)
    expect(onUnpaired).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(pollLatest.mock.calls.length).toBeGreaterThan(1)
    client.stop()
  })
})