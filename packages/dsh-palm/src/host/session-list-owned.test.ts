/**
 * 归属表 = `sessionIds` ∪ 按 `cwd` 推出来的归属（2026-11-10「抽屉只剩当前会话」）。
 *
 * `sessionIds` 是带 TTL 的索引，落后一拍时按它过滤会把绝大多数行滤掉。`cwd` 与
 * `path` 是两端都能看到的事实，所以宿主侧也要并进来；而且必须**最长前缀优先**，
 * 否则父工作区会把子工作区的会话抢走。
 */
import { describe, expect, it } from 'vitest'
import { normalizeWorkspacePath, ownedByWorkspaces } from './session-list.ts'

describe('normalizeWorkspacePath', () => {
  it('反斜杠/大小写/尾斜杠归一', () => {
    expect(normalizeWorkspacePath('D:\\work\\Alpha\\')).toBe('d:/work/alpha')
    expect(normalizeWorkspacePath(undefined)).toBe('')
  })
})

describe('ownedByWorkspaces', () => {
  const workspaces = [
    { workspaceId: 'ws-parent', path: 'D:\\work\\Alpha', sessionIds: ['p0'] },
    { workspaceId: 'ws-child', path: 'D:\\work\\Alpha\\1.Code\\07.FEP', sessionIds: [] },
    { workspaceId: 'ws-other', path: 'D:\\work\\dsh-palm' },
  ]
  const rows = [
    { sessionId: 'p0', cwd: 'D:\\work\\Alpha' },
    { sessionId: 'p1', cwd: 'D:\\work\\Alpha\\notes' },
    { sessionId: 'c1', cwd: 'D:\\work\\Alpha\\1.Code\\07.FEP' },
    { sessionId: 'c2', cwd: 'D:\\work\\Alpha\\1.Code\\07.FEP\\sub' },
    { sessionId: 'o1', cwd: 'D:/WORK/dsh-palm' },
    { sessionId: 'none', cwd: 'D:\\elsewhere' },
  ]

  const owned = ownedByWorkspaces(workspaces, rows)
  const of = (id: string): string[] => [...(owned.get(id) ?? [])].sort()

  it('sessionIds 里的会话照旧保留', () => {
    expect(of('ws-parent')).toContain('p0')
  })

  it('cwd 落在工作区目录下就算归属（子目录也算）', () => {
    expect(of('ws-parent')).toEqual(['p0', 'p1'])
  })

  it('嵌套工作区按最长前缀归属：父工作区不抢子工作区的会话', () => {
    expect(of('ws-child')).toEqual(['c1', 'c2'])
    expect(of('ws-parent')).not.toContain('c1')
  })

  it('大小写/斜杠不同的路径照样认得', () => {
    expect(of('ws-other')).toEqual(['o1'])
  })

  it('谁都不在的 cwd 不归给任何人', () => {
    const all = [...owned.values()].flatMap(set => [...set])
    expect(all).not.toContain('none')
  })
})
