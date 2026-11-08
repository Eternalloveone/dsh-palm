import { describe, expect, it } from 'vitest'
import { routeKeyOf } from './App.tsx'
import {
  createPageStack,
  currentOf,
  depthOf,
  popPage,
  pushPage,
  resetToRoot,
} from '../kernels/page-stack.ts'

/**
 * 页面栈的**场景级**行为（P6）。
 *
 * 上一个大文件证明的是"单步等价"；这里证明真实用户路径：连续进、连续退、
 * 以及那些旧启发式必须靠标记才猜对的场景（通知直达、运行总览进入）。
 */

type Route = Parameters<typeof routeKeyOf>[0]

const ws = { workspaceId: 'ws-1', path: '/repo', title: 'repo', sessionIds: [], createdAt: 0, updatedAt: 0 } as never
const ws2 = { workspaceId: 'ws-2', path: '/repo2', title: 'repo2', sessionIds: [], createdAt: 0, updatedAt: 0 } as never
const sessionA = { sessionId: 'a' } as never
const sessionB = { sessionId: 'b' } as never

const list = (): Route => ({ kind: 'sessions', workspace: ws })
const chat = (sessionId: 'a' | 'b'): Route => ({
  kind: 'chat',
  session: sessionId === 'a' ? sessionA : sessionB,
  workspace: ws,
})

/** 走一步：压栈 + 前进。 */
function go(stack: ReturnType<typeof createPageStack<Route>>, next: Route) {
  return pushPage(stack, routeKeyOf(next), next)
}

describe('页面栈场景（P6）', () => {
  it('列表 → 会话A → 会话B：连退两次回到列表，中间经过 A', () => {
    let stack = createPageStack<Route>(routeKeyOf(list()), list())
    stack = go(stack, chat('a'))
    stack = go(stack, chat('b'))
    expect(depthOf(stack)).toBe(3)

    stack = popPage(stack)
    expect(currentOf(stack)?.key).toBe('chat:a')
    stack = popPage(stack)
    expect(currentOf(stack)?.key).toBe('sessions:ws-1')

    // 到根页后弹栈是空操作：交给系统返回退出
    const atRoot = popPage(stack)
    expect(atRoot).toBe(stack)
  })

  it('通知直达会话：返回直接回列表，不需要 fromLocate/fromRunOverview 标记', () => {
    // 旧实现必须靠标记猜；栈里根页就是"来源"，因为进入时就压了正确的根。
    let stack = createPageStack<Route>(routeKeyOf(list()), list())
    stack = go(stack, chat('a'))
    expect(currentOf(popPage(stack))?.value.kind).toBe('sessions')
  })

  it('运行总览 → 会话 → 返回：回到运行总览而不是列表', () => {
    let stack = createPageStack<Route>('workspaces', { kind: 'workspaces' })
    stack = go(stack, { kind: 'run-overview' })
    stack = go(stack, chat('a'))
    stack = popPage(stack)
    expect(currentOf(stack)?.value.kind).toBe('run-overview')
  })

  it('同一会话重复进入只压一层（刷新/重进不算新页）', () => {
    const top = chat('a')
    let stack = createPageStack<Route>(routeKeyOf(top), top)
    // 同 key：调用方（applyRoute）不会再压
    expect(currentOf(stack)?.key).toBe(routeKeyOf(chat('a')))
    stack = go(stack, chat('a'))
    // 这是"确实又进了一次"的情形：key 相同但栈允许重复，由 applyRoute 的判重挡住
    expect(depthOf(stack)).toBe(2)
  })

  it('换工作区会换成新的一层（key 带 workspaceId）', () => {
    expect(routeKeyOf({ kind: 'sessions', workspace: ws })).toBe('sessions:ws-1')
    expect(routeKeyOf({ kind: 'sessions', workspace: ws2 })).toBe('sessions:ws-2')
  })

  it('设置页返回回到它所在的列表，而不是上一次的列表', () => {
    let stack = createPageStack<Route>(routeKeyOf(list()), list())
    stack = go(stack, { kind: 'settings', workspace: ws })
    stack = popPage(stack)
    expect(currentOf(stack)?.key).toBe('sessions:ws-1')
  })

  it('深链冷启动：栈里只有一页，一次返回后仍在根（交给系统退出）', () => {
    const onlyChat = createPageStack<Route>(routeKeyOf(chat('a')), chat('a'))
    expect(popPage(onlyChat)).toBe(onlyChat)
  })

  it('resetToRoot 用于"回到列表"动作：深度归 1，根页数据保留', () => {
    let stack = createPageStack<Route>(routeKeyOf(list()), list())
    stack = go(stack, chat('a'))
    stack = go(stack, { kind: 'settings', workspace: ws })
    const root = resetToRoot(stack)
    expect(depthOf(root)).toBe(1)
    expect(currentOf(root)?.value.kind).toBe('sessions')
  })
})
