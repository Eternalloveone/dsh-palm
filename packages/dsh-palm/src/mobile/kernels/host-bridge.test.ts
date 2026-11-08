import { describe, expect, it, vi } from 'vitest'
import { createHostBridge } from './host-bridge.ts'
import type { HostFrameLike, HostFrameSource } from './host-bridge.ts'

interface TestFrame extends HostFrameLike {
  type: string
}

/** 造一个可手动推帧的源，并记录 start/stop 次数。 */
function makeSource(): {
  source: HostFrameSource<TestFrame>
  push: (frame: TestFrame) => void
  starts: number[]
  stops: number[]
  listenerCount: () => number
} {
  const listeners = new Set<(frame: TestFrame) => void>()
  const starts: number[] = []
  const stops: number[] = []
  return {
    source: {
      start: () => { starts.push(1) },
      stop: () => { stops.push(1) },
      onFrame: listener => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    push: frame => { for (const listener of [...listeners]) listener(frame) },
    starts,
    stops,
    listenerCount: () => listeners.size,
  }
}

describe('host-bridge', () => {
  it('attaches exactly one source listener no matter how many consumers', () => {
    const { source, listenerCount } = makeSource()
    const bridge = createHostBridge(source)
    bridge.start()
    bridge.onFrame(() => {})
    bridge.onFrame(() => {})
    bridge.onType('session/event', () => {})
    expect(listenerCount()).toBe(1)
  })

  it('fans a frame out to every subscriber in order', () => {
    const { source, push } = makeSource()
    const bridge = createHostBridge(source)
    bridge.start()
    const seen: string[] = []
    bridge.onFrame(frame => seen.push('a:' + frame.type))
    bridge.onFrame(frame => seen.push('b:' + frame.type))
    push({ type: 'session/event' })
    expect(seen).toEqual(['a:session/event', 'b:session/event'])
  })

  it('delivers only matching types through onType', () => {
    const { source, push } = makeSource()
    const bridge = createHostBridge(source)
    bridge.start()
    const seen: string[] = []
    bridge.onType('session/jobs', frame => seen.push(frame.type))
    push({ type: 'session/event' })
    push({ type: 'session/jobs' })
    expect(seen).toEqual(['session/jobs'])
  })

  it('stops delivering after unsubscribe', () => {
    const { source, push } = makeSource()
    const bridge = createHostBridge(source)
    bridge.start()
    const listener = vi.fn()
    const off = bridge.onFrame(listener)
    push({ type: 'a' })
    off()
    push({ type: 'b' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(bridge.listenerCount()).toBe(0)
  })

  it('is start-idempotent and counts a generation per start', () => {
    const { source, starts } = makeSource()
    const bridge = createHostBridge(source)
    bridge.start()
    bridge.start()
    expect(starts).toHaveLength(1)
    expect(bridge.generation()).toBe(1)
    bridge.stop()
    bridge.start()
    expect(bridge.generation()).toBe(2)
  })

  it('detaches and clears listeners on stop', () => {
    const { source, push, stops, listenerCount } = makeSource()
    const bridge = createHostBridge(source)
    bridge.start()
    const listener = vi.fn()
    bridge.onFrame(listener)
    bridge.stop()
    push({ type: 'after-stop' })
    expect(stops).toHaveLength(1)
    expect(listenerCount()).toBe(0)
    expect(listener).not.toHaveBeenCalled()
    expect(bridge.listenerCount()).toBe(0)
  })

  it('keeps dispatching when one listener throws', () => {
    const { source, push } = makeSource()
    const bridge = createHostBridge(source)
    bridge.start()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const after = vi.fn()
    bridge.onFrame(() => { throw new Error('slice blew up') })
    bridge.onFrame(after)
    push({ type: 'x' })
    expect(after).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not skip listeners that unsubscribe during dispatch', () => {
    const { source, push } = makeSource()
    const bridge = createHostBridge(source)
    bridge.start()
    const second = vi.fn()
    const off = bridge.onFrame(() => { off() })
    bridge.onFrame(second)
    push({ type: 'x' })
    expect(second).toHaveBeenCalledTimes(1)
  })
})
