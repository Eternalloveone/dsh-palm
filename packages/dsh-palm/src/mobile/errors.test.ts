// @vitest-environment jsdom
/**
 * errors.ts — the always-on ring.
 *
 * What matters: a failure is visible at all (both listener paths, including a
 * failed resource load), repeats fold instead of flooding the ring, and nothing
 * sensitive-looking survives the trip — messages are collapsed and capped, and
 * stacks are reduced to `basename:line:col` with no origins and no function names.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ERROR_FRAMES_MAX, ERROR_MESSAGE_MAX, ERROR_RING_CAP,
  errorClear, errorSnapshot, errorStats, installErrorCapture, onErrorRecord, recordError,
} from './errors.ts'

/** Dispatch a window `error` event the way a browser does for a thrown error. */
function throwAtWindow(init: { message?: string; filename?: string; lineno?: number; colno?: number; stack?: string }): void {
  const event = new Event('error') as Event & Record<string, unknown>
  event.message = init.message ?? ''
  event.filename = init.filename ?? ''
  event.lineno = init.lineno ?? 0
  event.colno = init.colno ?? 0
  event.error = init.stack === undefined ? null : { stack: init.stack }
  window.dispatchEvent(event)
}

/** Dispatch an `unhandledrejection` carrying any reason shape. */
function rejectWith(reason: unknown): void {
  const event = new Event('unhandledrejection') as Event & Record<string, unknown>
  event.reason = reason
  window.dispatchEvent(event)
}

beforeEach(() => {
  errorClear()
  installErrorCapture()
})

describe('global error capture', () => {
  it('captures a thrown error with a reduced source and stack', () => {
    // Installing twice must not double-count (the second call is a no-op).
    installErrorCapture()
    throwAtWindow({
      message: 'boom',
      filename: 'https://host:3080/m/mobile.js',
      lineno: 12,
      colno: 34,
      stack: 'Error: boom\n    at run (https://host:3080/m/mobile.js:12:34)\n    at go (https://host:3080/m/app.js:5:6)',
    })

    const [record] = errorSnapshot()
    expect(record?.kind).toBe('error')
    expect(record?.message).toBe('boom')
    // source is basename-only as well: the host intake takes `file:line:col`, and
    // a URL here would both leak the origin and be refused on arrival.
    expect(record?.source).toBe('mobile.js:12:34')
    expect(JSON.stringify(record)).not.toContain('host:3080')
    // Frames lose their origins and the `at fn (...)` wrapper.
    expect(record?.frames).toEqual(['mobile.js:12:34', 'app.js:5:6'])
    expect(record?.count).toBe(1)
    expect(errorStats().total).toBe(1)
  })

  it('folds a repeat into the existing entry and moves it to the front', () => {
    recordError({ kind: 'error', message: 'first' })
    recordError({ kind: 'error', message: 'second' })
    recordError({ kind: 'error', message: 'first' })

    const snapshot = errorSnapshot()
    expect(snapshot).toHaveLength(2)
    expect(snapshot[0]?.message).toBe('first')
    expect(snapshot[0]?.count).toBe(2)
    expect(snapshot[1]?.message).toBe('second')
    // Two distinct entries, three failures.
    expect(errorStats()).toMatchObject({ total: 3, kinds: { error: 3 } })
  })

  it('collapses whitespace and caps the message length', () => {
    recordError({ kind: 'error', message: 'a\n\n   b\t c' })
    expect(errorSnapshot()[0]?.message).toBe('a b c')

    errorClear()
    recordError({ kind: 'error', message: 'x'.repeat(ERROR_MESSAGE_MAX * 2) })
    const message = errorSnapshot()[0]?.message ?? ''
    expect(message.length).toBe(ERROR_MESSAGE_MAX)
    expect(message.endsWith('…')).toBe(true)

    errorClear()
    recordError({ kind: 'error', message: '' })
    expect(errorSnapshot()[0]?.message).toBe('unknown error')
  })

  it('keeps at most ERROR_FRAMES_MAX distinct frames', () => {
    recordError({
      kind: 'error',
      message: 'deep',
      stack: ['Error: deep', '    at a (https://h/a.js:1:1)', '    at b (https://h/b.js:2:2)', '    at c (https://h/c.js:3:3)', '    at d (https://h/d.js:4:4)'].join('\n'),
    })
    expect(errorSnapshot()[0]?.frames).toHaveLength(ERROR_FRAMES_MAX)
  })

  it('captures unhandled rejections of every reason shape', () => {
    rejectWith(new Error('thrown reason'))
    rejectWith('string reason')
    rejectWith({ code: 42 })
    const circular: Record<string, unknown> = {}
    circular.self = circular
    rejectWith(circular)

    const kinds = errorSnapshot().map(record => record.message)
    expect(kinds).toEqual(['[object Object]', '{"code":42}', 'string reason', 'thrown reason'])
    expect(errorStats().kinds.rejection).toBe(4)
  })

  it('captures a failed resource load without leaking the origin', () => {
    const image = document.createElement('img')
    image.src = 'https://internal.example:8080/private/pic.png?token=secret'
    document.body.appendChild(image)
    image.dispatchEvent(new Event('error'))
    image.remove()

    const [record] = errorSnapshot()
    expect(record?.kind).toBe('resource')
    expect(record?.message).toBe('img 加载失败')
    expect(record?.source).toBe('pic.png')
    expect(JSON.stringify(record)).not.toContain('internal.example')
    expect(JSON.stringify(record)).not.toContain('secret')
  })

  it('caps the ring but keeps counting every failure', () => {
    for (let index = 0; index < ERROR_RING_CAP + 5; index++) {
      recordError({ kind: 'error', message: `failure ${index}` })
    }
    expect(errorSnapshot()).toHaveLength(ERROR_RING_CAP)
    expect(errorStats().total).toBe(ERROR_RING_CAP + 5)
    // Newest first: the last one recorded is the head of the ring.
    expect(errorSnapshot()[0]?.message).toBe(`failure ${ERROR_RING_CAP + 4}`)
  })

  it('clear() empties both the ring and the total', () => {
    recordError({ kind: 'error', message: 'gone' })
    errorClear()
    expect(errorSnapshot()).toEqual([])
    expect(errorStats()).toEqual({ total: 0, kinds: {}, recent: [] })
  })

  it('never throws when the platform has no window', () => {
    vi.stubGlobal('window', undefined)
    try {
      expect(() => { installErrorCapture() }).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('onErrorRecord receiver hook', () => {
  it('notifies on a new record, and on a repeat fold with the latest count', () => {
    const seen: Array<{ message: string; count: number }> = []
    const unsubscribe = onErrorRecord(record => { seen.push({ message: record.message, count: record.count }) })
    try {
      recordError({ kind: 'error', message: 'boom' })
      recordError({ kind: 'error', message: 'boom' })
      recordError({ kind: 'error', message: 'other' })
      // The repeat folds into the SAME entry, so the listener sees the count
      // escalate on the second event — not a duplicate first-sight.
      expect(seen.map(entry => entry.count)).toEqual([1, 2, 1])
      expect(seen[1]?.message).toBe('boom')
    } finally {
      unsubscribe()
    }
  })

  it('a throwing listener must not break recordError', () => {
    const unsubscribe = onErrorRecord(() => { throw new Error('listener broke') })
    try {
      expect(() => { recordError({ kind: 'error', message: 'survives' }) }).not.toThrow()
      expect(errorSnapshot()[0]?.message).toBe('survives')
    } finally {
      unsubscribe()
    }
  })

  it('unsubscribing stops delivery', () => {
    const listener = vi.fn()
    const unsubscribe = onErrorRecord(listener)
    unsubscribe()
    recordError({ kind: 'error', message: 'after unsubscribe' })
    expect(listener).not.toHaveBeenCalled()
  })
})
