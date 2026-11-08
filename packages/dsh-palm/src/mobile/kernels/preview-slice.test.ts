import { describe, expect, it, vi } from 'vitest'
import { fetchSessionPreview, mapLimited } from './preview-slice.ts'
import type { PreviewSliceDeps } from './preview-slice.ts'

function makeDeps(overrides: Partial<PreviewSliceDeps> = {}): PreviewSliceDeps {
  return {
    history: async () => ({ events: [{ event: { type: 'message' } }] }) as never,
    foldEvents: (() => [{ text: 'hello world' }]) as never,
    previewSummary: source => source.trim(),
    ...overrides,
  }
}

describe('fetchSessionPreview', () => {
  it('returns the summary of the last rendered message', async () => {
    const deps = makeDeps({
      foldEvents: (() => [{ text: 'first' }, { text: 'second' }]) as never,
    })
    expect(await fetchSessionPreview(deps, 's-1')).toBe('second')
  })

  it('falls back to reasoning when the message has no text', async () => {
    const deps = makeDeps({ foldEvents: (() => [{ text: '', reasoning: 'thinking...' }]) as never })
    expect(await fetchSessionPreview(deps, 's-1')).toBe('thinking...')
  })

  it('skips empty summaries and keeps walking backwards', async () => {
    const deps = makeDeps({
      foldEvents: (() => [{ text: 'real one' }, { text: '   ' }]) as never,
    })
    expect(await fetchSessionPreview(deps, 's-1')).toBe('real one')
  })

  it('returns undefined when every message summarizes to empty', async () => {
    const deps = makeDeps({ foldEvents: (() => [{ text: '' }, { text: '' }]) as never })
    expect(await fetchSessionPreview(deps, 's-1')).toBeUndefined()
  })

  it('returns undefined instead of throwing when the read fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const deps = makeDeps({ history: async () => { throw new Error('tunnel down') } })
    expect(await fetchSessionPreview(deps, 's-1')).toBeUndefined()
    spy.mockRestore()
  })

  it('asks for exactly one message (the whole point of the slice)', async () => {
    const history = vi.fn(async () => ({ events: [] }) as never)
    await fetchSessionPreview(makeDeps({ history }), 's-1')
    expect(history).toHaveBeenCalledWith('s-1', undefined, 1, undefined)
  })
})

describe('mapLimited', () => {
  it('runs every item exactly once', async () => {
    const seen: number[] = []
    await mapLimited([1, 2, 3, 4, 5], 2, async item => { seen.push(item) })
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('never exceeds the concurrency cap', async () => {
    let active = 0
    let peak = 0
    await mapLimited([1, 2, 3, 4, 5, 6], 2, async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active -= 1
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('treats a limit below 1 as 1', async () => {
    let active = 0
    let peak = 0
    await mapLimited([1, 2, 3], 0, async () => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
    })
    expect(peak).toBe(1)
  })

  it('resolves immediately for an empty list', async () => {
    await expect(mapLimited([], 3, async () => {})).resolves.toBeUndefined()
  })
})
