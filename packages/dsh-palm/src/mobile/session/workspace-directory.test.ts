/**
 * 工作区名字的唯一真源：三种来源按序退让，`ready` 区分权威名与临时名。
 */
import { describe, expect, it } from 'vitest'
import { cwdInWorkspace, lastPathSegment, resolveWorkspace, workspaceIdForCwd } from './workspace-directory.ts'

describe('resolveWorkspace', () => {
  it('路由自带标题就用它，ready=true', () => {
    const view = resolveWorkspace({ workspaceId: 'w1', title: 'dsh-palm', path: '/repo/dsh-palm' })
    expect(view).toEqual({ name: 'dsh-palm', path: '/repo/dsh-palm', ready: true })
  })

  it('路由只有 id：去列表查真名（深链冷启动就是这一路）', () => {
    const view = resolveWorkspace(
      { workspaceId: 'w9', title: '', path: '' },
      [{ workspaceId: 'w9', title: 'EspPet', path: 'D:\\work\\EspPet' }],
    )
    expect(view).toEqual({ name: 'EspPet', path: 'D:\\work\\EspPet', ready: true })
  })

  it('列表还没回来：用路径末段兜底，ready=false', () => {
    const view = resolveWorkspace({ workspaceId: 'w9', title: '', path: 'D:\\work\\dsh-palm' })
    expect(view).toEqual({ name: 'dsh-palm', path: 'D:\\work\\dsh-palm', ready: false })
  })

  it('列表有行但没标题、路由也没路径：用列表那条的路径推名字', () => {
    const view = resolveWorkspace(
      { workspaceId: 'w9', title: '', path: '' },
      [{ workspaceId: 'w9', title: '', path: '/home/me/repo' }],
    )
    expect(view).toEqual({ name: 'repo', path: '/home/me/repo', ready: false })
  })

  it('什么都没有：给一个中性名字，绝不再出现「本机工作区」', () => {
    const view = resolveWorkspace({ workspaceId: '', title: '', path: '' })
    expect(view.name).toBe('工作区')
    expect(view.ready).toBe(false)
  })

  it('标题是纯空白也当没给', () => {
    const view = resolveWorkspace({ workspaceId: 'w1', title: '   ', path: '/repo/alpha' })
    expect(view).toEqual({ name: 'alpha', path: '/repo/alpha', ready: false })
  })
})

describe('lastPathSegment', () => {
  it('认 Windows 与 POSIX 两种分隔符', () => {
    expect(lastPathSegment('D:\\work\\dsh-palm')).toBe('dsh-palm')
    expect(lastPathSegment('/home/me/dsh-palm')).toBe('dsh-palm')
    expect(lastPathSegment('/home/me/dsh-palm/')).toBe('dsh-palm')
  })

  it('空路径给空串（调用方再决定显示什么）', () => {
    expect(lastPathSegment('')).toBe('')
    expect(lastPathSegment('/')).toBe('')
  })
})

describe('cwdInWorkspace（归属只认路径这个事实）', () => {
  it('同一个目录、以及它下面的子目录都算', () => {
    expect(cwdInWorkspace('D:\\work\\dsh-palm', 'd:/work/dsh-palm/')).toBe(true)
    expect(cwdInWorkspace('D:\\work\\dsh-palm\\packages\\palm', 'D:\\work\\dsh-palm')).toBe(true)
  })

  it('同级但不同名不算（不能靠前缀字符串骗过去）', () => {
    expect(cwdInWorkspace('D:\\work\\dsh-palm-old', 'D:\\work\\dsh-palm')).toBe(false)
    expect(cwdInWorkspace('D:\\work\\DP503', 'D:\\work\\dsh-palm')).toBe(false)
  })

  it('任一侧没有路径：给「不知道」而不是「不属于」', () => {
    // 这两个必须分开：调用方对「不知道」保持原样，对「不属于」才排除。
    expect(cwdInWorkspace(undefined, 'D:\\work\\dsh-palm')).toBeUndefined()
    expect(cwdInWorkspace('D:\\work\\dsh-palm', '')).toBeUndefined()
  })
})

describe('workspaceIdForCwd（会话属于哪个工作区）', () => {
  const list = [
    { workspaceId: 'w-palm', title: 'dsh-palm', path: 'D:\\work\\dsh-palm' },
    { workspaceId: 'w-dp503', title: 'DP503', path: 'D:\\work\\DP503' },
  ]

  it('按路径认领，大小写/斜杠不同也认得出', () => {
    expect(workspaceIdForCwd('d:/work/dp503/', list)).toBe('w-dp503')
    expect(workspaceIdForCwd('D:\\work\\dsh-palm\\packages\\palm', list)).toBe('w-palm')
  })

  it('嵌套工作区取路径最长的那个', () => {
    const nested = [...list, { workspaceId: 'w-sub', path: 'D:\\work\\dsh-palm\\packages' }]
    expect(workspaceIdForCwd('D:\\work\\dsh-palm\\packages\\palm', nested)).toBe('w-sub')
    expect(workspaceIdForCwd('D:\\work\\dsh-palm\\src', nested)).toBe('w-palm')
  })

  it('认不出来就给 undefined（不在任何工作区目录里 / 没有 cwd / 表还没回来）', () => {
    expect(workspaceIdForCwd('D:\\work\\nowhere', list)).toBeUndefined()
    expect(workspaceIdForCwd(undefined, list)).toBeUndefined()
    expect(workspaceIdForCwd('D:\\work\\dsh-palm', [])).toBeUndefined()
  })
})
