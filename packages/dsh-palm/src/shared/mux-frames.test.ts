import { describe, expect, it } from 'vitest'
import { MUX_FRAME_TABLE, MUX_FRAME_TYPES, isMuxFrame } from './mux-frames.ts'

/**
 * The frame table is the single source both halves validate against. These
 * tests pin the two failure modes that already shipped once:
 *  - an arm exists in the union but not in the table (host emits, phone drops:
 *    this is what silently killed `goal/activation`);
 *  - the table accepts a discriminant the union does not know.
 */
describe('mux frame table', () => {
  it('accepts every key it declares', () => {
    for (const type of Object.keys(MUX_FRAME_TABLE)) {
      expect(MUX_FRAME_TYPES.has(type as never)).toBe(true)
      expect(isMuxFrame({ type })).toBe(true)
    }
  })

  it('knows goal/activation (host emits it, ChatView waits for it)', () => {
    expect(MUX_FRAME_TYPES.has('goal/activation')).toBe(true)
    expect(isMuxFrame({ type: 'goal/activation', sessionId: 's', activation: 'armed' })).toBe(true)
  })

  it('knows the mux keep-alive frame', () => {
    expect(isMuxFrame({ type: 'mux/ping' })).toBe(true)
  })

  it('keeps the inferred turn boundary distinct from the host bus status frame', () => {
    // Same payload shape, different producer: the client arbitrates by source,
    // so both must be routable and neither may be aliased to the other.
    expect(isMuxFrame({ type: 'session/status', sessionId: 's', running: true })).toBe(true)
    expect(isMuxFrame({ type: 'session/turn-boundary', source: 'inferred', sessionId: 's', running: true })).toBe(true)
    expect(MUX_FRAME_TYPES.has('session/status')).toBe(true)
    expect(MUX_FRAME_TYPES.has('session/turn-boundary')).toBe(true)
  })

  it('rejects unknown discriminants and non-objects', () => {
    expect(isMuxFrame({ type: 'session/unknown' })).toBe(false)
    expect(isMuxFrame({ type: 42 })).toBe(false)
    expect(isMuxFrame(null)).toBe(false)
    expect(isMuxFrame('session/event')).toBe(false)
  })
})
