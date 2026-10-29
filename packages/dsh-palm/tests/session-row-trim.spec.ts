/**
 * session.list 的行裁剪（2026-10-21）。
 *
 * 真机埋点：一页 40 行 248~384 KB，其中 99% 是手机端从不读取的投影
 * （单行 turnOutline 最大 53 KB / 279 轮）。手机只读 sessionId / updatedAt /
 * running / blank / cwd 与 projections.values 里的 title、preview、sessionStats。
 * 这里把「只留这些」和「真的只剩这些」一起钉住 —— 裁过头会让列表变成无标题的 id 列表，
 * 裁不够则每次进列表都要在 4G 上多走 200~300 KB。
 */
import { describe, expect, it } from 'vitest'
import { trimSessionListRow } from '../src/mobile-api.ts'

/** One host roster row as the ApiProxy answers it (all projections included). */
function hostRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 'session-1',
    updatedAt: 1_760_000_000_000,
    running: false,
    blank: false,
    cwd: 'D:/work/dsh-palm',
    formatStatus: 'ok',
    agentAvailable: true,
    projections: {
      asOfSeq: 42,
      values: {
        title: '会话标题',
        preview: '最后一句',
        sessionStats: { turns: 7, toolCalls: 3 },
        turnOutline: Array.from({ length: 20 }, (_, i) => ({ turn: i, summary: 'x'.repeat(200) })),
        tokenUsage: { input: 1, output: 2 },
        contextPressure: { used: 1, limit: 2 },
        permissions: { mode: 'ask' },
        agentPreset: 'default',
        imageLimits: { maxBytes: 1 },
      },
    },
    ...overrides,
  }
}

describe('session.list row trim', () => {
  it('keeps the fields the phone surface reads', () => {
    const row = trimSessionListRow(hostRow() as { updatedAt: number; sessionId: string })
    expect(row.sessionId).toBe('session-1')
    expect(row.updatedAt).toBe(1_760_000_000_000)
    expect(row.running).toBe(false)
    expect(row.blank).toBe(false)
    expect(row.cwd).toBe('D:/work/dsh-palm')
    const values = (row as { projections?: { values?: Record<string, unknown> } }).projections?.values
    expect(values?.title).toBe('会话标题')
    expect(values?.preview).toBe('最后一句')
    expect(values?.sessionStats).toEqual({ turns: 7, toolCalls: 3 })
  })

  it('drops the projections the phone never renders (turnOutline is the heavy one)', () => {
    const row = trimSessionListRow(hostRow() as { updatedAt: number; sessionId: string })
    const projections = (row as { projections?: { values?: Record<string, unknown>; asOfSeq?: number } }).projections
    expect(projections?.values).not.toHaveProperty('turnOutline')
    expect(projections?.values).not.toHaveProperty('tokenUsage')
    expect(projections?.values).not.toHaveProperty('permissions')
    expect(projections?.values).not.toHaveProperty('imageLimits')
    // The projection block's own scalar (asOfSeq) stays: it is tiny and rides along.
    expect(projections?.asOfSeq).toBe(42)
  })

  it('leaves a row without projections untouched (same reference, no allocation)', () => {
    const bare = { sessionId: 'session-2', updatedAt: 5, running: true, blank: false }
    expect(trimSessionListRow(bare)).toBe(bare)
  })

  it('drops the whole projection shell when no kept key is present', () => {
    const row = trimSessionListRow({
      sessionId: 'session-3',
      updatedAt: 6,
      running: false,
      blank: true,
      projections: { values: { turnOutline: [{ turn: 1 }], permissions: { mode: 'ask' } } },
    })
    expect(row).not.toHaveProperty('projections')
    expect(row.blank).toBe(true)
  })

  it('shrinks a real-shaped page by an order of magnitude', () => {
    const page = Array.from({ length: 40 }, (_, i) => hostRow({ sessionId: `session-${String(i)}` }))
    const before = Buffer.byteLength(JSON.stringify(page), 'utf8')
    const after = Buffer.byteLength(JSON.stringify(page.map(trimSessionListRow)), 'utf8')
    expect(before).toBeGreaterThan(150_000)
    expect(after).toBeLessThan(before / 10)
  })
})
