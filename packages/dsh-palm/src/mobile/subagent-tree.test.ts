// @vitest-environment node
/** Foreground-subagent tree helpers: recursive fetch, running count, activity overlay. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { collectSubagentIds, countRunningSubagents, fetchSubagentTree, setSubagentActivity, type SubagentNode } from './subagent-tree.ts'

vi.mock('./api.ts', () => ({
  subagentsList: vi.fn(),
}))
import { subagentsList } from './api.ts'

const subagentsListMock = vi.mocked(subagentsList)

const child = (id: string, activity: 'running' | 'inactive', hasChildren: boolean, label?: string): never => ({
  kind: 'child', id, mode: 'one-shot', activity, hasChildren, ...(label === undefined ? {} : { label }),
}) as never

const node = (id: string, activity: 'running' | 'inactive', children: SubagentNode[] = []): SubagentNode => ({
  id, label: id, activity, children,
})

beforeEach(() => { subagentsListMock.mockReset() })

describe('countRunningSubagents', () => {
  it('counts running nodes across the whole tree', () => {
    const tree = [
      node('a', 'running', [node('a1', 'running'), node('a2', 'inactive')]),
      node('b', 'inactive'),
    ]
    expect(countRunningSubagents(tree)).toBe(2)
  })
})

describe('setSubagentActivity', () => {
  it('updates a nested node immutably by id', () => {
    const tree = [node('a', 'running', [node('a1', 'inactive')])]
    const next = setSubagentActivity(tree, 'a1', true)
    expect(next[0]?.children[0]?.activity).toBe('running')
    // Original is untouched.
    expect(tree[0]?.children[0]?.activity).toBe('inactive')
  })

  it('returns the same tree when the id is absent', () => {
    const tree = [node('a', 'running')]
    expect(setSubagentActivity(tree, 'nope', true)).toBe(tree)
  })
})

describe('collectSubagentIds', () => {
  it('collects every id in the tree', () => {
    const tree = [node('a', 'running', [node('a1', 'inactive')]), node('b', 'inactive')]
    expect(collectSubagentIds(tree)).toEqual(new Set(['a', 'a1', 'b']))
  })
})

describe('fetchSubagentTree', () => {
  it('walks the catalog recursively and fills labels', async () => {
    subagentsListMock
      .mockResolvedValueOnce({ entries: [child('s1', 'running', true, '整理记忆')], parentAvailable: true })
      .mockResolvedValueOnce({ entries: [child('s1a', 'inactive', false, '分析结果')], parentAvailable: true })
    const tree = await fetchSubagentTree('root')
    expect(tree).toEqual([
      { id: 's1', label: '整理记忆', activity: 'running', children: [
        { id: 's1a', label: '分析结果', activity: 'inactive', children: [] },
      ] },
    ])
    expect(subagentsListMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to the id when a child has no label', async () => {
    subagentsListMock.mockResolvedValueOnce({ entries: [child('s1', 'inactive', false)], parentAvailable: true })
    const tree = await fetchSubagentTree('root')
    expect(tree[0]?.label).toBe('s1')
  })

  it('returns an empty tree on a failed read', async () => {
    subagentsListMock.mockRejectedValueOnce(new Error('boom'))
    expect(await fetchSubagentTree('root')).toEqual([])
  })
})
