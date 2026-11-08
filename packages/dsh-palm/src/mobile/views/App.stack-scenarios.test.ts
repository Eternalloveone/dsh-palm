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
 * 页面栈的**场景级**行为（2026-11-08 架构收敛后）。
 *
 * 会话页是根：换会话 = 换根（不压栈）；设置/搜索/产物等子页叠在根上，
 * 返回就是弹回那个会话。工作区页、会话列表页、运行总览、子代理页都已下线。
 */

type Route = Parameters<typeof routeKeyOf>[0]

const ws = { workspaceId: 'ws-1', path: '/repo', title: 'repo', sessionIds: [], createdAt: 0, updatedAt: 0 } as never
const sessionA = { sessionId: 'a', title: 'A', updatedAt: 0, running: false, blank: false } as never
const sessionB = { sessionId: 'b', title: 'B', updatedAt: 0, running: false, blank: false } as never

const chat = (session: never): Route => ({ kind: 'chat', session, workspace: ws })
const settings = (session: never): Route => ({ kind: 'settings', session, workspace: ws })

/** 走一步：压栈 + 前进。 */
function go(stack: ReturnType<typeof createPageStack<Route>>, next: Route) {
  return pushPage(stack, routeKeyOf(next), next)
}

describe('页面栈场景（会话页是根）', () => {
  it('会话 A → 会话 B 是换根：深度始终是 1，不会堆出一串会话', () => {
    const stackA = createPageStack<Route>(routeKeyOf(chat(sessionA)), chat(sessionA))
    const rootB = createPageStack<Route>(routeKeyOf(chat(sessionB)), chat(sessionB))
    expect(depthOf(stackA)).toBe(1)
    expect(depthOf(rootB)).toBe(1)
    expect(routeKeyOf(chat(sessionA))).not.toBe(routeKeyOf(chat(sessionB)))
  })

  it('会话 → 设置 → 返回：弹回同一个会话', () => {
    let stack = createPageStack<Route>(routeKeyOf(chat(sessionA)), chat(sessionA))
    stack = go(stack, settings(sessionA))
    expect(depthOf(stack)).toBe(2)
    stack = popPage(stack)
    expect(currentOf(stack)?.key).toBe('chat:a')
  })

  it('会话 → 设置 → 外观：两层子页按顺序弹回设置、再弹回会话', () => {
    let stack = createPageStack<Route>(routeKeyOf(chat(sessionA)), chat(sessionA))
    stack = go(stack, settings(sessionA))
    stack = go(stack, { kind: 'appearance', session: sessionA, workspace: ws })
    stack = popPage(stack)
    expect(currentOf(stack)?.value.kind).toBe('settings')
    stack = popPage(stack)
    expect(currentOf(stack)?.value.kind).toBe('chat')
  })

  it('深链冷启动：栈里只有会话一页，弹栈是空操作', () => {
    const only = createPageStack<Route>(routeKeyOf(chat(sessionA)), chat(sessionA))
    expect(popPage(only)).toBe(only)
  })

  it('resetToRoot 用于"回到会话"动作：深度归 1，根页数据保留', () => {
    let stack = createPageStack<Route>(routeKeyOf(chat(sessionA)), chat(sessionA))
    stack = go(stack, settings(sessionA))
    stack = go(stack, { kind: 'appearance', session: sessionA, workspace: ws })
    const root = resetToRoot(stack)
    expect(depthOf(root)).toBe(1)
    expect(currentOf(root)?.value.kind).toBe('chat')
  })

  it('产物摘要的 key 带上目标轮次：同一会话的不同轮不会被当成同一页', () => {
    expect(routeKeyOf({ kind: 'artifact-summary', session: sessionA, workspace: ws, turn: 2, turns: [] }))
      .toBe('artifact-summary:a:2')
    expect(routeKeyOf({ kind: 'artifact-summary', session: sessionA, workspace: ws, turn: undefined, turns: [] }))
      .toBe('artifact-summary:a:earlier')
  })

  it('搜索 / 设置的 key 带工作区；会话的 key 带会话 id', () => {
    expect(routeKeyOf({ kind: 'search', session: sessionA, workspace: ws })).toBe('search:ws-1')
    expect(routeKeyOf(settings(sessionA))).toBe('settings:ws-1')
    expect(routeKeyOf(chat(sessionA))).toBe('chat:a')
  })
})
