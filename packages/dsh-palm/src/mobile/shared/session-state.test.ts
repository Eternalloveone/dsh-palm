import { describe, expect, it } from 'vitest'
import { isRowRunning, resolveSessionRunning } from './session-state.ts'
import type { RenderMessage } from '../messages.ts'

/** Minimal rendered row; only the fields the predicate reads. */
function row(overrides: Partial<RenderMessage> = {}): RenderMessage {
  return { id: 'm1', role: 'assistant', text: 'hi', ...overrides } as RenderMessage
}

describe('isRowRunning', () => {
  it('is true for a pending row', () => {
    expect(isRowRunning(row({ pending: true }), undefined, false)).toBe(true)
  })

  it('is true while a tool is running', () => {
    expect(isRowRunning(row({ tools: [{ state: 'running' }] } as Partial<RenderMessage>), undefined, false)).toBe(true)
  })

  it('is true when the row belongs to the live turn', () => {
    expect(isRowRunning(row({ turn: 7 }), 7, false)).toBe(true)
  })

  it('is false for rows of an older turn', () => {
    expect(isRowRunning(row({ turn: 6, pending: true }), 7, false)).toBe(false)
  })

  it('is false once the host settled the turn', () => {
    expect(isRowRunning(row({ turn: 7, pending: true }), 7, true)).toBe(false)
  })
})

describe('resolveSessionRunning', () => {
  it('lets the host verdict win', () => {
    expect(resolveSessionRunning({ hostSaid: false, reported: true })).toBe(false)
    expect(resolveSessionRunning({ hostSaid: true, reported: false })).toBe(true)
  })

  it('trusts a fresh mux report', () => {
    expect(resolveSessionRunning({ reported: true, quiet: false })).toBe(true)
  })

  it('drops a stale mux report', () => {
    expect(resolveSessionRunning({ reported: true, quiet: true })).toBe(false)
  })

  it('passes through an unknown state', () => {
    expect(resolveSessionRunning({})).toBeUndefined()
  })
})
