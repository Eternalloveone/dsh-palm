import { describe, expect, it } from 'vitest'
import { visibleSessionRows } from './mobile-api.ts'

/**
 * The phone's session.list page slices come from this filtered array: the
 * host session.list still returns deleted sessions while an attached live
 * registry entry survives (a deleted session stays in memory until the dsh
 * process restarts), so without the archive filter a session removed on the
 * desktop reappears on the phone roster.
 */

const row = (sessionId: string, updatedAt = 1): { updatedAt: number; sessionId: string; origin?: 'subagent' } =>
  ({ sessionId, updatedAt })

/** A subagent row (host marks these with origin: 'subagent'). */
const sub = (sessionId: string, updatedAt = 1): { updatedAt: number; sessionId: string; origin?: 'subagent' } =>
  ({ sessionId, updatedAt, origin: 'subagent' })

describe('visibleSessionRows', () => {
  it('passes every main-agent session when nothing is archived', () => {
    const rows = [row('s-1', 3), row('s-2', 2), row('s-3', 1)]
    expect(visibleSessionRows(rows, new Set())).toEqual(rows)
  })

  it('drops subagent sessions', () => {
    const rows = [row('s-1'), sub('sub-1'), row('s-2')]
    expect(visibleSessionRows(rows, new Set()).map(r => r.sessionId)).toEqual(['s-1', 's-2'])
  })

  it('drops sessions in the archive set', () => {
    const rows = [row('s-1'), row('s-2'), row('s-3')]
    const visible = visibleSessionRows(rows, new Set(['s-2']))
    expect(visible.map(r => r.sessionId)).toEqual(['s-1', 's-3'])
  })

  it('filters subagent and archived together, preserving host order', () => {
    const rows = [
      row('s-1', 5),
      sub('sub-a', 4),
      row('s-archived', 3),
      row('s-2', 2),
      sub('sub-b', 1),
    ]
    const visible = visibleSessionRows(rows, new Set(['s-archived']))
    expect(visible.map(r => r.sessionId)).toEqual(['s-1', 's-2'])
  })
})
