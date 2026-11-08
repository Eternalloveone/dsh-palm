// @vitest-environment jsdom
/**
 * 会话抽屉的渲染契约（设计稿 overview.html「1 · 会话抽屉」）：
 * - 会话按今天 / 昨天 / 更早分组，空组不画；
 * - 右侧 mini 状态条只在「运行中 / 已完成」时出现，普通会话不画；
 * - 点行回传会话；底部三入口各自回传动作。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionDrawer, drawerBucketOf, type SessionDrawerProps } from './session-drawer.tsx'
import type { SessionView } from '../shared/session-view.ts'

afterEach(() => { cleanup() })

const DAY = 86_400_000

function session(overrides: Partial<SessionView> & { sessionId: string }): SessionView {
  return { title: `会话 ${overrides.sessionId}`, updatedAt: Date.now(), running: false, blank: false, ...overrides }
}

function renderDrawer(overrides: Partial<SessionDrawerProps> = {}): {
  picked: SessionView[]
  actions: string[]
} {
  const picked: SessionView[] = []
  const actions: string[] = []
  render(
    <SessionDrawer
      workspace={{ title: 'dsh-palm', path: '/repo/dsh-palm' }}
      rows={[]}
      finishedIds={new Set<string>()}
      onClose={() => { actions.push('close') }}
      onNew={() => { actions.push('new') }}
      onSearch={() => { actions.push('search') }}
      onPick={(row) => { picked.push(row) }}
      onOpenSettings={() => { actions.push('settings') }}
      onOpenArtifacts={() => { actions.push('artifacts') }}
      onOpenUsage={() => { actions.push('usage') }}
      {...overrides}
    />,
  )
  return { picked, actions }
}

describe('会话抽屉', () => {
  it('按今天 / 昨天 / 更早分组，空组不画', () => {
    const now = Date.now()
    renderDrawer({
      rows: [
        session({ sessionId: 'today', title: '今天的会话', updatedAt: now }),
        session({ sessionId: 'yesterday', title: '昨天的会话', updatedAt: now - DAY }),
        session({ sessionId: 'older', title: '更早的会话', updatedAt: now - 3 * DAY }),
      ],
    })
    expect(screen.getByText('今天')).toBeTruthy()
    expect(screen.getByText('昨天')).toBeTruthy()
    expect(screen.getByText('更早')).toBeTruthy()
    expect(screen.getByText('今天的会话')).toBeTruthy()
    expect(screen.getByText('昨天的会话')).toBeTruthy()
    expect(screen.getByText('更早的会话')).toBeTruthy()

    // 只有今天一条：昨天 / 更早整组不画。
    cleanup()
    renderDrawer({ rows: [session({ sessionId: 'only-today' })] })
    expect(screen.getByText('今天')).toBeTruthy()
    expect(screen.queryByText('昨天')).toBeNull()
    expect(screen.queryByText('更早')).toBeNull()
  })

  it('日期分桶按本地午夜切：昨天 23:59 属于昨天，今天 00:01 属于今天', () => {
    const now = new Date(2026, 10, 8, 12, 0, 0).getTime()
    const todayMidnight = new Date(2026, 10, 8, 0, 1, 0).getTime()
    const yesterdayLate = new Date(2026, 10, 7, 23, 59, 0).getTime()
    expect(drawerBucketOf(todayMidnight, now)).toBe('今天')
    expect(drawerBucketOf(yesterdayLate, now)).toBe('昨天')
    expect(drawerBucketOf(now - 5 * DAY, now)).toBe('更早')
  })

  it('mini 状态条只给运行中 / 已完成的行画，普通会话不画', () => {
    renderDrawer({
      rows: [
        session({ sessionId: 'running', title: '正在跑', running: true }),
        session({ sessionId: 'done', title: '刚跑完' }),
        session({ sessionId: 'plain', title: '普通会话' }),
      ],
      finishedIds: new Set(['done']),
    })
    expect(screen.getByText('运行中')).toBeTruthy()
    expect(screen.getByText('完成')).toBeTruthy()
    // 普通会话那一行没有状态条文本。
    const plainRow = screen.getByText('普通会话').closest('.palm-drawer-row')
    expect(plainRow?.textContent).toBe('普通会话')
  })

  it('点会话行回传该会话', () => {
    const row = session({ sessionId: 'picked', title: '点我' })
    const { picked } = renderDrawer({ rows: [row] })
    fireEvent.click(screen.getByText('点我'))
    expect(picked.map(item => item.sessionId)).toEqual(['picked'])
  })

  it('底部三入口与新建 / 搜索各自回传动作', () => {
    const { actions } = renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: /新建会话/ }))
    fireEvent.click(screen.getByRole('button', { name: /搜索会话/ }))
    fireEvent.click(screen.getByRole('button', { name: /^设置$/ }))
    fireEvent.click(screen.getByRole('button', { name: /产物与文档/ }))
    fireEvent.click(screen.getByRole('button', { name: /用量/ }))
    expect(actions).toEqual(['new', 'search', 'settings', 'artifacts', 'usage'])
  })

  it('抬头画工作区名称与路径', () => {
    renderDrawer({ workspace: { title: '示例工作区', path: '/repo/example' } })
    expect(screen.getByText('示例工作区')).toBeTruthy()
    expect(screen.getByText('/repo/example')).toBeTruthy()
  })

  it('等审批优先于运行中：同一行只画一个状态条，且说「等审批」', () => {
    renderDrawer({
      rows: [session({ sessionId: 'waiting', title: '等你点批准', running: true })],
      pendingIds: new Set(['waiting']),
    })
    expect(screen.getByText('等审批')).toBeTruthy()
    expect(screen.queryByText('运行中')).toBeNull()
  })

  it('单工作区不画切换箭头；多工作区才画，点它回传动作', () => {
    renderDrawer({ workspaceCount: 1, onSwitchWorkspace: () => {} })
    expect(screen.queryByRole('button', { name: '切换工作区' })).toBeNull()
    cleanup()
    const second = renderDrawer({ workspaceCount: 2, onSwitchWorkspace: () => { second.actions.push('switch') } })
    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    expect(second.actions).toEqual(['switch'])
  })

  it('搜索入口的文案是「搜索会话和消息」：抽屉是唯一导航', () => {
    renderDrawer()
    expect(screen.getByRole('button', { name: /搜索会话和消息/ })).toBeTruthy()
  })
})
