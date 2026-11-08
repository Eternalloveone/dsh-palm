import { describe, expect, it } from 'vitest'
import { backTargetOf, chatRouteOf } from './App.tsx'
import { createPageStack, currentOf, popPage, pushPage } from '../kernels/page-stack.ts'

/**
 * 返回落点的穷尽性证明（2026-11-08「单一会话页 + 抽屉」）。
 *
 * 会话页是**根**：它没有上一页，返回键也不在它的页头里；子页全部叠在它上面，
 * 返回 = 弹回所属会话（外观弹回设置）。这里对每一种路由断言：
 * 弹栈得到的那一页 == `backTargetOf` 的兜底结论。
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
const session = { sessionId: 's-1', title: '会话', updatedAt: 0, running: false, blank: false } as never
const approvalRow = { approvalId: 'ap-1', callId: 'c-1', tool: 'write_file', risk: 'write' } as never

const chat: Route = chatRouteOf(session, workspace)

/** 每种路由的"进入它之前在哪一页"（栈模型的答案）。 */
const PUSHED_FROM: Record<Kind, Route> = {
  chat,
  search: chat,
  settings: chat,
  appearance: { kind: 'settings', session, workspace },
  artifacts: chat,
  'artifact-summary': { kind: 'artifacts', session, workspace, turns: [] },
  diff: chat,
  delivery: chat,
  approval: chat,
  context: chat,
  outline: chat,
  'approval-mode': chat,
}

/** 各路由的样本。 */
const SAMPLES: Route[] = [
  chat,
  { kind: 'search', session, workspace },
  { kind: 'settings', session, workspace },
  { kind: 'appearance', session, workspace },
  { kind: 'artifacts', session, workspace, turns: [] },
  { kind: 'artifact-summary', session, workspace, turn: 2, turns: [] },
  { kind: 'diff', session, workspace, path: 'src/a.ts' },
  { kind: 'delivery', session, workspace, facts: { turn: 2, deliverables: [], changes: [] } },
  { kind: 'approval', session, workspace, approval: approvalRow },
  { kind: 'context', session, workspace, usage: {} },
  { kind: 'outline', session, workspace, turns: [], currentTurn: 1 },
  { kind: 'approval-mode', session, workspace, permissions: { currentValue: 'ask', options: [] } },
]

describe('页面栈 vs backTargetOf（会话页是根）', () => {
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

  it('会话页是根：返回自己（没有上一页，交给系统退出）', () => {
    expect(backTargetOf(chat)).toEqual(chat)
  })

  it('设置/搜索的兜底落点是它们所属的会话', () => {
    expect(backTargetOf({ kind: 'settings', session, workspace })).toEqual(chat)
    expect(backTargetOf({ kind: 'search', session, workspace })).toEqual(chat)
  })

  it('外观的兜底落点是设置，不是会话', () => {
    expect(backTargetOf({ kind: 'appearance', session, workspace }))
      .toEqual({ kind: 'settings', session, workspace })
  })

  it('深链冷启动：栈里只有会话一页，弹栈是空操作', () => {
    const onlyChat = createPageStack<Route>('chat', chat)
    expect(popPage(onlyChat)).toBe(onlyChat)
  })
})
