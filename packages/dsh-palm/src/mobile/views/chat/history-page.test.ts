// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { adoptOlderPage, prepareOlderPage } from './history-page.ts'
import type { EventFolder, RenderMessage } from '../../messages.ts'
import type { ChatPageResult } from '../App.tsx'

function row(id: string, seq: number, extra: Partial<RenderMessage> = {}): RenderMessage {
  return { id, role: 'assistant', text: id, seq, ...extra } as RenderMessage
}

function page(rows: RenderMessage[]): ChatPageResult {
  return { rows, hasMore: true } as unknown as ChatPageResult
}

describe('prepareOlderPage', () => {
  it('renders the page and remembers the raw host rows', async () => {
    const raw = [row('a', 1)]
    const remembered: Array<readonly RenderMessage[]> = []
    const rows = await prepareOlderPage(page(raw), {
      sessionId: 's-1',
      rememberRawPage: value => remembered.push(value),
      cardRecovery: { confirmed: new Set<number>() },
      loadCards: vi.fn(async () => []),
      rememberCards: vi.fn(),
    })
    expect(remembered[0]).toBe(raw)
    expect(rows.length).toBeGreaterThan(0)
  })

  it('merges cards that were read for a missing turn', async () => {
    const rows = await prepareOlderPage(page([row('a', 1)]), {
      sessionId: 's-1',
      rememberRawPage: () => {},
      cardRecovery: { confirmed: new Set<number>() },
      loadCards: vi.fn(async () => [row('card', 2, { kind: 'turn', turn: 1 } as Partial<RenderMessage>)]),
      rememberCards: vi.fn(),
    })
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('adoptOlderPage', () => {
  it('prepends into the fold and adopts its snapshot', () => {
    const folder = {
      snapshot: () => [row('x', 9)],
      seed: vi.fn(),
      prepend: vi.fn(),
    } as unknown as EventFolder
    const applied: RenderMessage[][] = []
    adoptOlderPage([row('a', 1)], { first: row('x', 9) }, {
      folder,
      commitRows: vi.fn(),
      applyRows: rows => applied.push(rows),
    })
    expect(folder.prepend).toHaveBeenCalled()
    expect(applied).toHaveLength(1)
  })

  it('reseeds the window for a disjoint locate page', () => {
    const folder = {
      snapshot: () => [row('z', 50), row('y', 2)],
      seed: vi.fn(),
      prepend: vi.fn(),
    } as unknown as EventFolder
    adoptOlderPage([row('a', 30)], { first: row('x', 1), maxRows: 40 }, {
      folder,
      commitRows: vi.fn(),
      applyRows: vi.fn(),
    })
    expect(folder.seed).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'z' })])
    expect(folder.prepend).not.toHaveBeenCalled()
  })

  it('commits through the row model when the fold does not exist yet', () => {
    const commitRows = vi.fn()
    adoptOlderPage([row('a', 1)], { first: row('x', 9) }, {
      folder: undefined,
      commitRows,
      applyRows: vi.fn(),
    })
    expect(commitRows).toHaveBeenCalledTimes(1)
  })
})
