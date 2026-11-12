// @vitest-environment jsdom
/**
 * 置顶存储的测试。
 *
 * 这里钉的是三件容易做错的事：坏数据不能炸、取消置顶要真的删、置顶是**本机**偏好
 * 所以只碰 localStorage 别的地方一律不写。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPinsForTest,
  loadPinnedSessions,
  loadPinnedWorkspaces,
  togglePinnedSession,
  togglePinnedWorkspace,
} from './pins.ts'

beforeEach(() => { clearPinsForTest(); localStorage.clear() })

describe('会话置顶', () => {
  it('初始为空', () => {
    expect(loadPinnedSessions().size).toBe(0)
  })

  it('toggle 一次钉上，再 toggle 取消', () => {
    expect(togglePinnedSession('s1')).toBe(true)
    expect([...loadPinnedSessions()]).toEqual(['s1'])
    expect(togglePinnedSession('s1')).toBe(false)
    expect(loadPinnedSessions().size).toBe(0)
  })

  it('新钉的排在最前（最近钉的优先）', () => {
    togglePinnedSession('a')
    togglePinnedSession('b')
    expect([...loadPinnedSessions()]).toEqual(['b', 'a'])
  })

  it('可以钉多个', () => {
    togglePinnedSession('a')
    togglePinnedSession('b')
    togglePinnedSession('c')
    expect(loadPinnedSessions().size).toBe(3)
  })

  it('取消其中一个不影响其他', () => {
    togglePinnedSession('a')
    togglePinnedSession('b')
    togglePinnedSession('a')
    expect([...loadPinnedSessions()]).toEqual(['b'])
  })
})

describe('工作区置顶', () => {
  it('与会话置顶互不干扰', () => {
    togglePinnedSession('s1')
    togglePinnedWorkspace('/repo/a')
    expect([...loadPinnedSessions()]).toEqual(['s1'])
    expect([...loadPinnedWorkspaces()]).toEqual(['/repo/a'])
  })

  it('toggle 可逆', () => {
    expect(togglePinnedWorkspace('/repo/a')).toBe(true)
    expect(togglePinnedWorkspace('/repo/a')).toBe(false)
    expect(loadPinnedWorkspaces().size).toBe(0)
  })
})

describe('坏数据', () => {
  it('不是 JSON 当空处理，不抛', () => {
    localStorage.setItem('dsh.palm.pinnedSessions', '{not json')
    expect(loadPinnedSessions().size).toBe(0)
  })

  it('不是数组当空处理', () => {
    localStorage.setItem('dsh.palm.pinnedSessions', '{"a":1}')
    expect(loadPinnedSessions().size).toBe(0)
  })

  it('数组里混入非字符串时只保留字符串', () => {
    localStorage.setItem('dsh.palm.pinnedSessions', '["a",1,null,"",{"x":1},"b"]')
    expect([...loadPinnedSessions()]).toEqual(['a', 'b'])
  })

  it('取消到空时把 key 删掉（不留空数组）', () => {
    togglePinnedSession('a')
    togglePinnedSession('a')
    expect(localStorage.getItem('dsh.palm.pinnedSessions')).toBeNull()
  })
})
