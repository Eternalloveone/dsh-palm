import { describe, expect, it } from 'vitest'
import { resolveCommandDirectory, visibleSessionRows, type CommandRegistry, type AgentLookup } from './mobile-api.ts'

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

/**
 * The phone's + menu command directory. The Web deployment moves per-agent
 * rows (plan-mode, command-compact) into agent presets, so the directory must
 * resolve the SESSION's agent view — the same catalog the desktop `/` popup
 * lists — and fall back to the plain-context view only when no agent resolves.
 */

/** A registry whose per-agent view adds the preset-mounted rows. */
const registry = (): CommandRegistry => ({
  list: (agent: unknown) => agent === undefined
    ? [
      { name: 'export', description: 'Download this Session log as a ZIP archive' },
      { name: 'goal', description: 'set or view the goal for a long-running task' },
    ]
    : [
      { name: 'compact', description: 'Compact older conversation history' },
      { name: 'export', description: 'Download this Session log as a ZIP archive' },
      { name: 'goal', description: 'set or view the goal for a long-running task' },
      { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]' } },
    ],
  execute: async () => undefined,
})

const agents = (): AgentLookup => ({ get: (sessionId: string) => sessionId === 's-live' ? { session: { id: 's-live' } } : undefined })

describe('resolveCommandDirectory', () => {
  it('resolves the session agent view when the session is live (plan/compact included)', () => {
    const items = resolveCommandDirectory(registry(), agents(), 's-live')
    expect(items.map(item => item.name)).toEqual(['compact', 'export', 'goal', 'plan'])
    expect(items.find(item => item.name === 'plan')?.input).toEqual({ hint: '[off|message]' })
  })

  it('falls back to the plain-context view when the session resolves no agent', () => {
    const items = resolveCommandDirectory(registry(), agents(), 's-unknown')
    expect(items.map(item => item.name)).toEqual(['export', 'goal'])
  })

  it('falls back to the plain-context view without a session id', () => {
    const items = resolveCommandDirectory(registry(), agents(), undefined)
    expect(items.map(item => item.name)).toEqual(['export', 'goal'])
  })

  it('falls back to the plain-context view when the agent service is not composed', () => {
    const items = resolveCommandDirectory(registry(), undefined, 's-live')
    expect(items.map(item => item.name)).toEqual(['export', 'goal'])
  })

  it('returns an empty directory when the command registry is not composed', () => {
    expect(resolveCommandDirectory(undefined, agents(), 's-live')).toEqual([])
  })
})
