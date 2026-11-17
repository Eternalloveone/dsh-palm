// @vitest-environment jsdom
/**
 * 折叠状态的持久化：记住展开过的组，坏数据不崩。
 *
 * 只测存储层（读/写/坏数据/上限）；「展开后重新挂载还是展开的」由组件测试覆盖。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { EXPANDED_GROUPS_KEY, readExpandedGroups, writeExpandedGroups } from './workspace-picker-store.ts'

beforeEach(() => { localStorage.clear() })

describe('折叠状态存储', () => {
  it('写进去再读出来还是那些组键', () => {
    writeExpandedGroups(['project:D:\\proj\\dsh-palm', 'project:D:\\proj\\proj-a\\1.Code'])
    expect(readExpandedGroups()).toEqual(['project:D:\\proj\\dsh-palm', 'project:D:\\proj\\proj-a\\1.Code'])
  })

  it('没有记录时是空数组', () => {
    expect(readExpandedGroups()).toEqual([])
  })

  it('坏数据（不是数组 / 不是 JSON）当没记录，不抛', () => {
    localStorage.setItem(EXPANDED_GROUPS_KEY, '{"a":1}')
    expect(readExpandedGroups()).toEqual([])
    localStorage.setItem(EXPANDED_GROUPS_KEY, 'not-json')
    expect(readExpandedGroups()).toEqual([])
    localStorage.setItem(EXPANDED_GROUPS_KEY, '["ok", 3, null, ""]')
    expect(readExpandedGroups()).toEqual(['ok'])
  })

  it('超出上限时只保留最后写入的那些（不会越攒越大）', () => {
    const many = Array.from({ length: 250 }, (_, i) => `project:k${i}`)
    writeExpandedGroups(many)
    const back = readExpandedGroups()
    expect(back.length).toBe(200)
    expect(back[back.length - 1]).toBe('project:k249')
  })
})
