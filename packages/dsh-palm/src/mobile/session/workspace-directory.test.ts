/**
 * 工作区名字的唯一真源：三种来源按序退让，`ready` 区分权威名与临时名。
 */
import { describe, expect, it } from 'vitest'
import { lastPathSegment, resolveWorkspace } from './workspace-directory.ts'

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
