// @vitest-environment jsdom
/** offline outbox: queue → flush → failure keeps the remainder queued. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  enqueuePrompt, flushOutbox, listOutbox, removeFromOutbox, removeOutboxForSession,
  PermanentOutboxError, resetOutboxForTest,
  type OutboxEntry,
} from './offline.ts'

function entry(id: string, text = 'hello'): OutboxEntry {
  return { id, sessionId: 's-1', text, queuedAt: Number(id) }
}

beforeEach(() => {
  resetOutboxForTest()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('offline outbox', () => {
  it('queues entries in order and lists them oldest first', async () => {
    await enqueuePrompt(entry('2'))
    await enqueuePrompt(entry('1'))
    const queued = await listOutbox()
    expect(queued.map(e => e.id)).toEqual(['1', '2'])
  })

  it('flushes in order and removes delivered entries', async () => {
    await enqueuePrompt(entry('1', 'a'))
    await enqueuePrompt(entry('2', 'b'))
    const sent: string[] = []
    const result = await flushOutbox(async (e) => { sent.push(e.text) })
    expect(result).toEqual({ sent: 2, failed: 0 })
    expect(sent).toEqual(['a', 'b'])
    expect(await listOutbox()).toEqual([])
  })

  it('skips a failing entry and keeps delivering the rest', async () => {
    await enqueuePrompt(entry('1', 'a'))
    await enqueuePrompt(entry('2', 'b'))
    await enqueuePrompt(entry('3', 'c'))
    const sent: string[] = []
    const result = await flushOutbox(async (e) => {
      if (e.text === 'b') throw new Error('offline again')
      sent.push(e.text)
    })
    // 'a' and 'c' went out; the failing 'b' stays queued for the next flush
    // instead of blocking the whole outbox.
    expect(result).toEqual({ sent: 2, failed: 1 })
    expect(sent).toEqual(['a', 'c'])
    expect((await listOutbox()).map(e => e.id)).toEqual(['2'])
  })

  it('removes a single entry', async () => {
    await enqueuePrompt(entry('1'))
    await enqueuePrompt(entry('2'))
    await removeFromOutbox('1')
    expect((await listOutbox()).map(e => e.id)).toEqual(['2'])
  })

  it('does not auto-resend a sending entry (crash mid-delivery leaves it pending confirmation)', async () => {
    // Simulate a crash after the send succeeded but before the removal: the
    // entry is left with sending: true. The host has no idempotency key, so
    // re-sending could duplicate the prompt — the flush must skip it.
    await enqueuePrompt({ ...entry('1', 'a'), sending: true })
    await enqueuePrompt(entry('2', 'b'))
    const sent: string[] = []
    const result = await flushOutbox(async (e) => { sent.push(e.text) })
    // Only the to-send entry goes out; the sending one is skipped.
    expect(result).toEqual({ sent: 1, failed: 0 })
    expect(sent).toEqual(['b'])
    // The sending entry stays queued (pending confirmation), not removed.
    const remaining = await listOutbox()
    expect(remaining.map(e => e.id)).toEqual(['1'])
    expect(remaining[0]?.sending).toBe(true)
  })

  it('clears the sending flag on a failed send so the entry retries next flush', async () => {
    await enqueuePrompt(entry('1', 'a'))
    const result = await flushOutbox(async () => { throw new Error('offline again') })
    expect(result).toEqual({ sent: 0, failed: 1 })
    const remaining = await listOutbox()
    expect(remaining.map(e => e.id)).toEqual(['1'])
    expect(remaining[0]?.sending).not.toBe(true)
  })

  it('removes every queued entry for a deleted session', async () => {
    await enqueuePrompt({ ...entry('1', 'a'), sessionId: 's-1' })
    await enqueuePrompt({ ...entry('2', 'b'), sessionId: 's-1' })
    await enqueuePrompt({ ...entry('3', 'c'), sessionId: 's-2' })
    await removeOutboxForSession('s-1')
    expect((await listOutbox()).map(e => e.id)).toEqual(['3'])
  })

  it('drops an entry whose send throws PermanentOutboxError (session gone)', async () => {
    await enqueuePrompt(entry('1', 'a'))
    await enqueuePrompt(entry('2', 'b'))
    const result = await flushOutbox(async (e) => {
      if (e.text === 'a') throw new PermanentOutboxError()
    })
    // 'a' is dropped outright (never retried); 'b' is delivered normally.
    expect(result).toEqual({ sent: 1, failed: 1 })
    expect(await listOutbox()).toEqual([])
  })
})
