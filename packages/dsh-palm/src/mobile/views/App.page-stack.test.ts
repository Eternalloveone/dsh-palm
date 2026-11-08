import { describe, expect, it } from 'vitest'
import { backTargetOf } from './App.tsx'
import { createPageStack, currentOf, popPage, pushPage } from '../kernels/page-stack.ts'

/**
 * 迁移前的**等价性证明**（P6）。
 *
 * 现在返回上一页靠 `backTargetOf(route)`：只看当前路由，用一堆 `if` 猜"上一页是谁"。
 * 这正是历史里那些 bug 的来源——猜错就会退到不存在的页面（例如从通知直接进会话，
 * 猜出来的"上一页"是个空列表）。
 *
 * 迁移方向是**记真实的栈**：进哪页就压哪页，返回就是弹栈。
 *
 * 这个文件把两者的等价关系写死：对每一种路由，先用栈模型走一遍，
 * 断言弹出来的页与 `backTargetOf` 猜的一致。等 App 换成栈之后，本文件应删掉
 * `backTargetOf` 一侧，只留栈的断言。
 */

type Route = Parameters<typeof backTargetOf>[0]
type Kind = Route['kind']

const workspace = {
  workspaceId: 'ws-1',
  path: '/repo',
  title: 'repo',
  sessionIds: [],
  createdAt: 0,
  updatedAt: 0,
} as never
const standaloneWorkspace = { workspaceId: 'standalone', path: '', title: '未分组', sessionIds: [], createdAt: 0, updatedAt: 0 } as never
const session = { sessionId: 's-1' } as never
const approvalRow = { approvalId: 'ap-1', callId: 'c-1', tool: 'write_file', risk: 'write' } as never

/** 每种路由的"进入它之前在哪一页"（栈模型的答案）。 */
const PUSHED_FROM: Record<Kind, Route> = {
  workspaces: { kind: 'workspaces' },
  'run-overview': { kind: 'workspaces' },
  settings: { kind: 'sessions', workspace },
  sessions: { kind: 'workspaces' },
  search: { kind: 'sessions', workspace },
  chat: { kind: 'sessions', workspace },
  'sub-chat': { kind: 'run-overview' },
  approval: { kind: 'chat', session, workspace },
  // diff 也是"会话内的一层"：上一页同样是那个对话
  diff: { kind: 'chat', session, workspace },
  model: { kind: 'chat', session, workspace },
  appearance: { kind: 'settings', workspace },
  outline: { kind: 'chat', session, workspace },
  artifacts: { kind: 'chat', session, workspace },
  // ⑨ 产物摘要挂在产物列表下面：从某一轮的分组标题进来，返回就是那一页。
  'artifact-summary': { kind: 'artifacts', session, workspace, turns: [] },
  context: { kind: 'chat', session, workspace },
  'approval-mode': { kind: 'chat', session, workspace },
  // 审批详情是"会话内的一层"：上一页就是那个对话
  // 审批详情是"会话内的一层"：上一页就是那个对话
}

/** 各路由的样本。 */
const SAMPLES: Route[] = [
  { kind: 'workspaces' },
  { kind: 'run-overview' },
  { kind: 'sessions', workspace },
  { kind: 'search', workspace },
  { kind: 'settings', workspace },
  { kind: 'chat', session, workspace },
  { kind: 'sub-chat', sessionId: 'c-1' },
  { kind: 'approval', session, workspace, approval: approvalRow },
  { kind: 'diff', session, workspace, path: 'src/a.ts' },
  { kind: 'model', session, workspace },
  { kind: 'appearance', workspace },
  { kind: 'outline', session, workspace, turns: [], currentTurn: 1 },
  { kind: 'artifacts', session, workspace, turns: [] },
  { kind: 'artifact-summary', session, workspace, turn: 2, turns: [] },
  { kind: 'context', session, workspace, usage: {} },
  { kind: 'approval-mode', session, workspace, permissions: { currentValue: 'ask', options: [] } },
]

describe('页面栈 vs backTargetOf（迁移等价性）', () => {
  it('普通进入：弹栈结果与 backTargetOf 猜的一致', () => {
    for (const route of SAMPLES) {
      const from = PUSHED_FROM[route.kind]
      const stack = pushPage(
        createPageStack<Route>('root', from),
        route.kind,
        route,
      )
      const back = currentOf(popPage(stack))?.value
      expect(back, `${route.kind} 的上一页`).toEqual(backTargetOf(route))
    }
  })

  it('从通知直达会话：栈里根页就是"来源"，不需要猜', () => {
    // backTargetOf 靠 fromLocate/fromRunOverview 等标记猜；栈天生知道。
    const direct = pushPage(
      createPageStack<Route>('workspaces', { kind: 'workspaces' }),
      'chat',
      { kind: 'chat', session, workspace },
    )
    expect(currentOf(popPage(direct))?.value).toEqual({ kind: 'workspaces' })
  })

  it('独立工作区的会话：栈里没有"空列表"这一页，退不进去', () => {
    const stack = pushPage(
      createPageStack<Route>('workspaces', { kind: 'workspaces' }),
      'chat',
      { kind: 'chat', session, workspace: standaloneWorkspace },
    )
    expect(currentOf(popPage(stack))?.value).toEqual({ kind: 'workspaces' })
    // 与 backTargetOf 的特判结论一致
    expect(backTargetOf({ kind: 'chat', session, workspace: standaloneWorkspace })).toEqual({ kind: 'workspaces' })
  })

  it('从运行总览进会话：弹栈天然回到运行总览', () => {
    const stack = pushPage(
      pushPage(createPageStack<Route>('workspaces', { kind: 'workspaces' }), 'run-overview', { kind: 'run-overview' }),
      'chat',
      { kind: 'chat', session, workspace },
    )
    expect(currentOf(popPage(stack))?.value).toEqual({ kind: 'run-overview' })
  })
})
