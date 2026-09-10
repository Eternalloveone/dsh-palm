// @vitest-environment node
/** Foreground-subagent flat list helpers: one-shot fetch, running count, sort. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { countRunningSubagents, fetchSubagentsFlat, setSubagentActivity, sortSubagentsRunningFirst, type SubagentFlatNode } from './subagent-tree.ts'

vi.mock('./api.ts', () => ({
  subagentsList: vi.fn(),
}))
import { subagentsList } from './api.ts'

const subagentsListMock = vi.mocked(subagentsList)

const child = (id: string, activity: 'running' | 'inactive', label?: string): never => ({
  kind: 'child', id, mode: 'one-shot', activity, hasChildren: false, ...(label === undefined ? {} : { label }),
}) as never

const node = (id: string, activity: 'running' | 'inactive'): SubagentFlatNode => ({ id, label: id, activity })

beforeEach(() => { subagentsListMock.mockReset() })

describe('fetchSubagentsFlat', () => {
  it('returns the direct children in one call and fills labels', async () => {
    subagentsListMock.mockResolvedValueOnce({
      entries: [child('s1', 'running', '整理记忆'), child('s2', 'inactive')],
      parentAvailable: true,
    })
    const nodes = await fetchSubagentsFlat('root')
    expect(nodes).toEqual([
      { id: 's1', label: '整理记忆', activity: 'running' },
      { id: 's2', label: 's2', activity: 'inactive' },
    ])
    // One flat call — no recursive tree walk.
    expect(subagentsListMock).toHaveBeenCalledTimes(1)
  })

  it('skips diagnostic rows', async () => {
    subagentsListMock.mockResolvedValueOnce({
      entries: [{ kind: 'diagnostic', id: 'd1' as never, reason: 'corrupt' }, child('s1', 'inactive')],
      parentAvailable: true,
    })
    expect(await fetchSubagentsFlat('root')).toEqual([{ id: 's1', label: 's1', activity: 'inactive' }])
  })

  it('returns an empty list on a failed read', async () => {
    subagentsListMock.mockRejectedValueOnce(new Error('boom'))
    expect(await fetchSubagentsFlat('root')).toEqual([])
  })
})

describe('countRunningSubagents', () => {
  it('counts running nodes across the flat list', () => {
    expect(countRunningSubagents([node('a', 'running'), node('b', 'inactive'), node('c', 'running')])).toBe(2)
  })
})

describe('sortSubagentsRunningFirst', () => {
  it('keeps running first and preserves the original order within each group', () => {
    const sorted = sortSubagentsRunningFirst([node('a', 'inactive'), node('b', 'running'), node('c', 'inactive')])
    expect(sorted.map(n => n.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('setSubagentActivity', () => {
  it('updates a node immutably by id', () => {
    const list = [node('a', 'running'), node('b', 'inactive')]
    const next = setSubagentActivity(list, 'b', true)
    expect(next[1]?.activity).toBe('running')
    // Original is untouched.
    expect(list[1]?.activity).toBe('inactive')
  })

  it('returns the same list when the id is absent', () => {
    const list = [node('a', 'running')]
    expect(setSubagentActivity(list, 'nope', true)).toBe(list)
  })
})
