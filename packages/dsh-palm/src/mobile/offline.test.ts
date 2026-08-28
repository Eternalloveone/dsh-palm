// @vitest-environment jsdom
/** offline outbox: queue → flush → failure keeps the remainder queued. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  enqueuePrompt, flushOutbox, listOutbox, removeFromOutbox, resetOutboxForTest,
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
})
