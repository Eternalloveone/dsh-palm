// @vitest-environment jsdom
/** SessionListView: owned-row filtering, incremental pages, session creation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { SessionListView, type SessionListViewProps } from './SessionListView.tsx'
import { type SessionView } from './App.tsx'

// The api module is fully mocked; the view's App.tsx helpers stay real.
vi.mock('../api.ts', () => ({
  listSessions: vi.fn(),
  listWorkspaces: vi.fn(),
  listAgentPresets: vi.fn(),
  createSession: vi.fn(),
}))
vi.mock('../offline.ts', () => ({
  removeOutboxForSession: vi.fn(),
}))
import { createSession, listAgentPresets, listSessions } from '../api.ts'
import { removeOutboxForSession } from '../offline.ts'

const listSessionsMock = vi.mocked(listSessions)
const listAgentPresetsMock = vi.mocked(listAgentPresets)
const createSessionMock = vi.mocked(createSession)
const removeOutboxForSessionMock = vi.mocked(removeOutboxForSession)

const workspace: WorkspaceRow = {
  workspaceId: 'w-1' as never,
  path: '/tmp/demo',
  title: '演示项目',
  sessionIds: ['s-1'] as never,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** A session.list summary row. */
function summary(sessionId: string, updatedAt: number, extra: Record<string, unknown> = {}): never {
  return { sessionId, updatedAt, running: false, blank: false, ...extra } as never
}

let picked: SessionView | undefined

function renderList(props: Partial<SessionListViewProps> = {}): void {
  picked = undefined
  render(
    <SessionListView
      workspace={workspace}
      onBack={() => {}}
      onPick={(session) => { picked = session }}
      onOpenSettings={() => {}}
      {...props}
    />,
  )
}

beforeEach(() => {
  listSessionsMock.mockResolvedValue({ items: [], hasMore: false })
  listAgentPresetsMock.mockResolvedValue({ presets: [], authorable: false, hasDocument: false })
  createSessionMock.mockResolvedValue({ sessionId: 's-new' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SessionListView roster', () => {
  it('shows only the sessions that belong to the workspace directory', async () => {
    listSessionsMock.mockResolvedValue({
      items: [
        summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '改造移动端' } } }),
        summary('s-sub', 1_650_000_000_000, { cwd: '/tmp/demo/sub', projections: { values: { title: '子目录会话' } } }),
        summary('s-case', 1_640_000_000_000, { cwd: '/TMP/DEMO', projections: { values: { title: '大小写路径' } } }),
        summary('s-other', 1_600_000_000_000, { cwd: '/tmp/foreign' }),
        summary('s-nocwd', 1_590_000_000_000),
      ],
      hasMore: false,
    })
    renderList()

    expect(await screen.findByText('改造移动端')).toBeTruthy()
    expect(screen.queryByText('子目录会话')).not.toBeNull()
    expect(screen.queryByText('大小写路径')).not.toBeNull()
    // Sessions outside the workspace directory (or without a recorded cwd)
    // must stay hidden — the list is the project's, not the global history.
    expect(screen.queryByText(/foreign/)).toBeNull()
    expect(screen.queryByText(/nocwd/)).toBeNull()
  })

  it('shows the empty state when the workspace has no sessions', async () => {
    renderList()
    expect(await screen.findByText(/还没有会话/)).toBeTruthy()
  })

  it('appends further pages through the cursor, still filtered to the workspace', async () => {
    listSessionsMock.mockResolvedValueOnce({
      items: [summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo' })],
      hasMore: true,
      nextCursor: 'c1',
    })
    listSessionsMock.mockResolvedValueOnce({
      items: [
        summary('s-2', 1_600_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '第二页会话' } } }),
        summary('s-foreign', 1_500_000_000_000, { cwd: '/elsewhere' }),
      ],
      hasMore: false,
    })
    renderList()
    await screen.findByText('demo')
    fireEvent.click(screen.getByRole('button', { name: /加载更多会话/ }))
    expect(await screen.findByText('第二页会话')).toBeTruthy()
    expect(screen.queryByText('elsewhere')).toBeNull()
    expect(listSessionsMock).toHaveBeenLastCalledWith('c1')
  })

  it('shows the full timestamp and drops the raw session-id tail', async () => {
    listSessionsMock.mockResolvedValue({
      items: [summary('session-abcdef12-3456-7890-abcd-1234567890ab', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '同名任务' } } })],
      hasMore: false,
    })
    renderList()
    await screen.findByText('同名任务')
    // Full date+clock (timezone-agnostic shape), and no "#tail" id suffix.
    expect(screen.getByText(/\d{2}-\d{2} \d{2}:\d{2}/)).toBeTruthy()
    expect(screen.queryByText(/#90ab/)).toBeNull()
  })
})

describe('SessionListView creation', () => {
  it('creates a blank session in the workspace and opens it immediately', async () => {
    renderList()
    await screen.findByText(/还没有会话/)

    fireEvent.click(screen.getByRole('button', { name: '+ 新建会话' }))

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith({ workspaceId: 'w-1' })
    })
    await waitFor(() => {
      expect(picked).toBeDefined()
    })
    expect(picked?.sessionId).toBe('s-new')
    expect(picked?.blank).toBe(true)
    // The optimistic blank row IS visible (title 新会话 + 新 status chip):
    // without it the fresh session would be unreachable from the roster
    // until a re-fetch gives it content.
    await waitFor(() => {
      expect(screen.getByText('新会话')).toBeTruthy()
    })
    expect(screen.getByText('新')).toBeTruthy()
  })

  it('creates the session with the selected agent preset', async () => {
    listAgentPresetsMock.mockResolvedValue({
      presets: [
        { id: 'router-standard', name: 'Router Standard', trust: 'system', isDefault: true },
        { id: 'router-spec', name: 'Router Spec', description: '规格驱动模式', trust: 'system', isDefault: false },
      ],
      authorable: false,
      hasDocument: false,
    })
    renderList()

    // The mode picker is a custom trigger opening a bottom-sheet list.
    const trigger = await screen.findByRole('button', { name: 'Agent 模式' })
    expect(trigger.textContent).toContain('Router Standard')
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('button', { name: /Router Spec/ }))
    fireEvent.click(screen.getByRole('button', { name: '+ 新建会话' }))

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith({ workspaceId: 'w-1', agentPreset: 'router-spec' })
    })
    // The description lives behind the "?" hint: open the sheet to read it.
    fireEvent.click(await screen.findByRole('button', { name: '模式说明' }))
    const helpSheet = await screen.findByRole('dialog', { name: 'Agent 模式说明' })
    expect(within(helpSheet).getByText(/规格驱动模式/)).toBeTruthy()
  })

  it('skips a broken default preset and disables it in the picker', async () => {
    listAgentPresetsMock.mockResolvedValue({
      presets: [
        { id: 'broken-default', trust: 'system', isDefault: true, broken: 'missing plugin' },
        { id: 'local-router', name: 'Local Router', trust: 'user', isDefault: false },
      ],
      authorable: false,
      hasDocument: false,
    })
    renderList()

    const trigger = await screen.findByRole('button', { name: 'Agent 模式' })
    expect(trigger.textContent).toContain('Local Router')
    fireEvent.click(trigger)
    const broken = await screen.findByRole('button', { name: /broken-default（默认）（不可用）/ })
    expect(broken.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Local Router（本地）/ })).toBeTruthy()
  })

  it('keeps default session creation available when the preset roster fails', async () => {
    listAgentPresetsMock.mockRejectedValue(new Error('preset roster unavailable'))
    renderList()
    await screen.findByText(/还没有会话/)

    const button = await screen.findByRole('button', { name: '+ 新建会话' })
    await waitFor(() => { expect(button.hasAttribute('disabled')).toBe(false) })
    fireEvent.click(button)

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith({ workspaceId: 'w-1' })
    })
  })

  it('waits for the preset roster before enabling session creation', async () => {
    let resolvePresets: (value: Awaited<ReturnType<typeof listAgentPresets>>) => void = () => {}
    listAgentPresetsMock.mockReturnValue(new Promise(resolve => { resolvePresets = resolve }))
    renderList()

    const button = screen.getByRole('button', { name: '+ 新建会话' })
    expect(button.hasAttribute('disabled')).toBe(true)

    resolvePresets({ presets: [], authorable: false, hasDocument: false })
    await waitFor(() => { expect(button.hasAttribute('disabled')).toBe(false) })
  })

  it('keeps the button disabled while a creation is in flight', async () => {
    let resolveCreate: (value: { sessionId: string }) => void = () => {}
    createSessionMock.mockReturnValue(new Promise(resolve => { resolveCreate = resolve }))
    renderList()
    await screen.findByText(/还没有会话/)

    fireEvent.click(screen.getByRole('button', { name: '+ 新建会话' }))
    const button = await screen.findByRole('button', { name: '创建中…' })
    expect(button.hasAttribute('disabled')).toBe(true)

    resolveCreate({ sessionId: 's-new' })
    await waitFor(() => { expect(picked).toBeDefined() })
  })

  it('shows the stale-host hint when creation is refused with HTTP 403', async () => {
    createSessionMock.mockRejectedValue(new Error('HTTP 403'))
    renderList()
    await screen.findByText(/还没有会话/)

    fireEvent.click(screen.getByRole('button', { name: '+ 新建会话' }))

    expect(await screen.findByText(/HTTP 403/)).toBeTruthy()
    expect(await screen.findByText(/重启 dsh web/)).toBeTruthy()
    expect(picked).toBeUndefined()
  })
})

describe('SessionListView search scope', () => {
  it('shows a hint that search only covers loaded rows when more pages exist', async () => {
    listSessionsMock.mockResolvedValue({
      items: [summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '改造移动端' } } })],
      hasMore: true,
      nextCursor: 'c1',
    })
    renderList()
    await screen.findByText('改造移动端')
    fireEvent.click(screen.getByRole('button', { name: '搜索会话' }))
    fireEvent.change(screen.getByPlaceholderText('搜索标题或内容…'), { target: { value: 'xyz' } })
    expect(await screen.findByText(/搜索仅覆盖已加载的 1 条会话/)).toBeTruthy()
  })
})

describe('SessionListView delete', () => {
  it('deletes a session from the row menu and clears its outbox', async () => {
    listSessionsMock.mockResolvedValue({
      items: [summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '改造移动端' } } })],
      hasMore: false,
    })
    removeOutboxForSessionMock.mockResolvedValue(undefined)
    renderList()
    await screen.findByText('改造移动端')
    // Open the row action menu (contextmenu covers mouse; long-press covers touch).
    const row = screen.getByText('改造移动端').closest('button')!
    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByRole('menuitem', { name: /删除会话/ }))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(removeOutboxForSessionMock).toHaveBeenCalledWith('s-1')
    })
    // The row is removed from the local list.
    expect(screen.queryByText('改造移动端')).toBeNull()
  })
})
