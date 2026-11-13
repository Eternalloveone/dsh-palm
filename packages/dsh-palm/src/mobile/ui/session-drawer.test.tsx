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
      onOpenUsage={() => { actions.push('usage') }}
      {...overrides}
    />,
  )
  return { picked, actions }
}

describe('会话抽屉', () => {
  it('列表还在路上时画「正在读取会话…」，不抢先说没有会话', () => {
    // 三态：listing=true 表示宿主那一页还没回来，此时说"这个工作区还没有会话"是假话。
    renderDrawer({ rows: [], listing: true })
    expect(document.querySelector('.palm-drawer-empty')!.textContent).toBe('正在读取会话…')
    cleanup()
    renderDrawer({ rows: [], listing: false })
    expect(document.querySelector('.palm-drawer-empty')!.textContent).toBe('这个工作区还没有会话')
  })
  it('一条会话都没有时画一行说明，而不是留一块空白', () => {
    // 2026-11-10「会话列表显示失效」：空列表原来什么都不画，看起来就是界面坏了。
    renderDrawer({ rows: [] })
    expect(document.querySelector('.palm-drawer-empty')!.textContent).toBe('这个工作区还没有会话')
    expect(document.querySelector('.palm-drawer-group')).toBeNull()
  })

  it('按今天 / 昨天 / 更早分组，空组不画', () => {
    const now = Date.now()
    renderDrawer({
      rows: [
        session({ sessionId: 'today', title: '今天的会话', updatedAt: now }),
        session({ sessionId: 'yesterday', title: '昨天的会话', updatedAt: now - DAY }),
        session({ sessionId: 'older', title: '更早的会话', updatedAt: now - 3 * DAY }),
      ],
    })
    // 分组标题：按组头查，不要 getByText('昨天') —— 行右侧的时间也可能是「昨天」。
    const buckets = [...document.querySelectorAll('.palm-drawer-bucket')].map(node => node.textContent ?? '')
    expect(buckets.some(text => text.startsWith('今天'))).toBe(true)
    expect(buckets.some(text => text.startsWith('昨天'))).toBe(true)
    expect(buckets.some(text => text.startsWith('更早'))).toBe(true)
    expect(screen.getByText('今天的会话')).toBeTruthy()
    expect(screen.getByText('昨天的会话')).toBeTruthy()
    expect(screen.getByText('更早的会话')).toBeTruthy()
    // 分组标题带条数（2026-11-10）：空组不画，所以「今天 1」不会出现空组占位。
    expect(document.querySelector('.palm-drawer-bucket')!.textContent).toBe('今天1')

    // 只有今天一条：昨天 / 更早整组不画。
    cleanup()
    renderDrawer({ rows: [session({ sessionId: 'only-today' })] })
    expect(screen.getByText('今天')).toBeTruthy()
    expect(screen.queryByText('昨天')).toBeNull()
    expect(screen.queryByText('更早')).toBeNull()
  })

  it('当前会话行带高亮类（左侧强调轨由样式给）', () => {
    const now = Date.now()
    renderDrawer({
      rows: [session({ sessionId: 'a', title: '当前这条', updatedAt: now }), session({ sessionId: 'b', title: '另一条', updatedAt: now - 60_000 })],
      currentSessionId: 'a',
    })
    const current = document.querySelector('.palm-drawer-row-current')
    expect(current).not.toBeNull()
    expect(current!.textContent).toContain('当前这条')
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
    // 普通会话那一行没有状态条（行右侧只有那句时间，不是状态）。
    const plainRow = screen.getByText('普通会话').closest('.palm-drawer-row')
    expect(plainRow?.querySelector('.palm-drawer-title')?.textContent).toBe('普通会话')
    expect(plainRow?.querySelector('.palm-strip')).toBeNull()
    expect(plainRow?.querySelector('.palm-drawer-when')).not.toBeNull()
  })

  it('点会话行回传该会话', () => {
    const row = session({ sessionId: 'picked', title: '点我' })
    const { picked } = renderDrawer({ rows: [row] })
    fireEvent.click(screen.getByText('点我'))
    expect(picked.map(item => item.sessionId)).toEqual(['picked'])
  })

  it('标题为空时显示中性名，绝不再出现「本机工作区」', () => {
    // 2026-11-12 用户问「怎么有时候显示本机工作区」——那个词只是空标题的兜底。
    // 名字现在由 session/workspace-directory.ts 统一解析（见该文件的测试），
    // 抽屉只负责画，不再自己按路径猜。
    renderDrawer({ workspace: { title: '', path: 'D:\\work\\dsh-palm' } })
    expect(screen.getByText('工作区')).toBeTruthy()
    expect(screen.queryByText('本机工作区')).toBeNull()
  })

  it('「任务」行只在有任务时画，且在工具卡片最前面', () => {
    // 2026-11-11 用户：任务和设置对调；没有任务时整行不出现，不白占 46px。
    const { actions } = renderDrawer()
    expect(screen.queryByRole('button', { name: /^任务/ })).toBeNull()
    cleanup()
    renderDrawer({ taskLabel: '3 在跑 · 1 刚完成', onOpenTasks: () => { actions.push('tasks') } })
    const tools = [...document.querySelectorAll('.palm-drawer-tool')]
    expect(tools).toHaveLength(3)
    expect(tools[0]!.querySelector('span')!.textContent).toBe('任务')
    expect(tools[0]!.querySelector('small')!.textContent).toBe('3 在跑 · 1 刚完成')
    fireEvent.click(tools[0]!)
    expect(actions).toEqual(['tasks'])
  })

  it('工具卡片顺序：任务 → 用量 → 设置（信息在上、配置沉底）', () => {
    // 2026-11-12 用户：「设置和用量要不要调换」——换成信息类在前、配置最后一行。
    renderDrawer({ taskLabel: '1 在跑', onOpenTasks: () => {} })
    const labels = [...document.querySelectorAll('.palm-drawer-tool')]
      .map(tool => tool.querySelector('span')?.textContent)
    expect(labels).toEqual(['任务', '用量', '设置'])
  })

  it('底部两入口与新建 / 搜索各自回传动作', () => {    const { actions } = renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: /新建会话/ }))
    fireEvent.click(screen.getByRole('button', { name: /搜索会话/ }))
    // 「设置」右侧还显示当前皮肤名，所以按钮的无障碍名是「设置 石墨」：按前缀匹配。
    fireEvent.click(screen.getByRole('button', { name: /^设置/ }))
    // 「产物与文档」已删（2026-11-11）：入口在聊天页右上角「⋯ → 这一轮的产物」。
    expect(screen.queryByRole('button', { name: /产物与文档/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /用量/ }))
    expect(actions).toEqual(['new', 'search', 'settings', 'usage'])
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
