// @vitest-environment jsdom
/** Mobile workspace landing: roster rendering and QR deep-link selection. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { mobileWorkspaceTarget } from './App.tsx'
import { WorkspaceView, workspaceKind } from './WorkspaceView.tsx'

vi.mock('../api.ts', () => ({
  listWorkspaces: vi.fn(),
  listDirectory: vi.fn(),
  createWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  searchAll: vi.fn(),
  searchMessages: vi.fn(),
}))
import { listWorkspaces, listDirectory, createWorkspace, deleteWorkspace, searchAll, searchMessages } from '../api.ts'

const listWorkspacesMock = vi.mocked(listWorkspaces)
const listDirectoryMock = vi.mocked(listDirectory)
const createWorkspaceMock = vi.mocked(createWorkspace)
const deleteWorkspaceMock = vi.mocked(deleteWorkspace)
const searchAllMock = vi.mocked(searchAll)
const searchMessagesMock = vi.mocked(searchMessages)

const workspaces: WorkspaceRow[] = [
  {
    workspaceId: 'ws-1' as never,
    path: '/tmp/first',
    title: 'First',
    sessionIds: [] as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    workspaceId: 'ws-2' as never,
    path: '/tmp/second',
    title: 'Second',
    sessionIds: [] as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('mobile workspace deep link', () => {
  it('reads a non-empty workspace target from the query', () => {
    expect(mobileWorkspaceTarget('?workspace=ws-2')).toBe('ws-2')
    expect(mobileWorkspaceTarget('?workspace=')).toBeUndefined()
    expect(mobileWorkspaceTarget('')).toBeUndefined()
  })

  it('opens the targeted workspace as soon as the roster loads', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    const onPick = vi.fn()

    render(<WorkspaceView initialWorkspaceId="ws-2" onPick={onPick} />)

    await waitFor(() => expect(onPick).toHaveBeenCalledWith(workspaces[1]))
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('falls back to the roster when the target no longer exists', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    const onPick = vi.fn()

    render(<WorkspaceView initialWorkspaceId="missing" onPick={onPick} />)

    expect(await screen.findByText('First')).toBeTruthy()
    expect(await screen.findByText('Second')).toBeTruthy()
    expect(onPick).not.toHaveBeenCalled()
  })
})

describe('mobile workspace kind', () => {
  const row = (workspaceId: string, path = '/proj/code', title = 'Code', hasSessions = true): WorkspaceRow => ({
    workspaceId: workspaceId as never,
    path,
    title,
    sessionIds: (hasSessions ? ['s-1'] : []) as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  it('marks the three most recent workspaces as active', () => {
    const recents = ['a', 'b', 'c', 'd']
    expect(workspaceKind(row('a'), recents)).toBe('active')
    expect(workspaceKind(row('b'), recents)).toBe('active')
    expect(workspaceKind(row('c'), recents)).toBe('active')
    // The 4th recent no longer fits the 活跃项目 group: falls back to kind.
    expect(workspaceKind(row('d'), recents)).toBe('code')
  })

  it('is not active when the recents list is empty or the id is unknown', () => {
    expect(workspaceKind(row('a'), [])).toBe('code')
    expect(workspaceKind(row('x'), ['a'])).toBe('code')
  })

  it('keeps test-path and empty-session heuristics after the active check', () => {
    expect(workspaceKind(row('t', '/rigs/spec-runner', 'Rig'), ['other'])).toBe('test')
    expect(workspaceKind(row('plain', '/proj/plain', 'Plain', false), ['other'])).toBe('plain')
    // A recent-but-test workspace stays active: recency wins over the path.
    expect(workspaceKind(row('t', '/rigs/spec-runner', 'Rig'), ['t'])).toBe('active')
  })
})

describe('mobile workspace creation', () => {
  it('shows new workspace button and navigates to directory browser', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    listDirectoryMock.mockResolvedValue({
      path: '/home/user',
      home: '/home/user',
      crumbs: [{ name: '', path: '/', hidden: false }, { name: 'home', path: '/home', hidden: false }, { name: 'user', path: '/home/user', hidden: false }],
      entries: [
        { name: 'projects', path: '/home/user/projects', hidden: false },
        { name: '.config', path: '/home/user/.config', hidden: true }
      ],
      truncated: false
    })

    const onPick = vi.fn()
    render(<WorkspaceView onPick={onPick} />)

    // Wait for workspaces to load
    const createBtn = await screen.findByText('新建工作区')
    
    // Click create button
    fireEvent.click(createBtn)

    // Verify directory browser renders
    expect(await screen.findByText('选择目录')).toBeTruthy()
    
    // Verify crumbs
    expect(await screen.findByText('user')).toBeTruthy()
    
    // Verify entries
    expect(await screen.findByText('projects')).toBeTruthy()
    expect(await screen.findByText('.config')).toBeTruthy()
  })

  it('navigates into directory and allows breadcrumb navigation', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    
    // Initial dir
    listDirectoryMock.mockResolvedValueOnce({
      path: '/home/user',
      home: '/home/user',
      crumbs: [{ name: '', path: '/', hidden: false }, { name: 'home', path: '/home', hidden: false }, { name: 'user', path: '/home/user', hidden: false }],
      entries: [{ name: 'projects', path: '/home/user/projects', hidden: false }],
      truncated: false
    })

    const onPick = vi.fn()
    render(<WorkspaceView onPick={onPick} />)

    // Open dir browser
    fireEvent.click(await screen.findByText('新建工作区'))
    
    // Wait for first dir listing
    const projBtn = await screen.findByText('projects')

    // Prepare next listing
    listDirectoryMock.mockResolvedValueOnce({
      path: '/home/user/projects',
      home: '/home/user',
      crumbs: [
        { name: '', path: '/', hidden: false },
        { name: 'home', path: '/home', hidden: false },
        { name: 'user', path: '/home/user', hidden: false },
        { name: 'projects', path: '/home/user/projects', hidden: false }
      ],
      entries: [{ name: 'foo', path: '/home/user/projects/foo', hidden: false }],
      truncated: false
    })

    // Click into folder
    fireEvent.click(projBtn)

    // Verify new contents load
    expect(await screen.findByText('foo')).toBeTruthy()
    
    // Check breadcrumb
    const homeCrumb = screen.getByText('home')
    expect(homeCrumb).toBeTruthy()
    
    // Click breadcrumb
    listDirectoryMock.mockResolvedValueOnce({
      path: '/home',
      home: '/home/user',
      crumbs: [{ name: '', path: '/', hidden: false }, { name: 'home', path: '/home', hidden: false }],
      entries: [{ name: 'user', path: '/home/user', hidden: false }],
      truncated: false
    })
    
    fireEvent.click(homeCrumb)
    expect(await screen.findByText('user')).toBeTruthy()
  })

  it('creates workspace successfully', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    listDirectoryMock.mockResolvedValue({
      path: '/home/user/projects/foo',
      home: '/home/user',
      crumbs: [{ name: '', path: '/', hidden: false }, { name: 'foo', path: '/home/user/projects/foo', hidden: false }],
      entries: [],
      truncated: false
    })

    const newWorkspace = { ...workspaces[0], workspaceId: 'ws-new' as never, title: 'foo' }
    createWorkspaceMock.mockResolvedValue({
      workspace: newWorkspace,
      created: true
    })

    const onPick = vi.fn()
    render(<WorkspaceView onPick={onPick} />)

    fireEvent.click(await screen.findByText('新建工作区'))
    
    const selectBtn = await screen.findByText('选择此目录')
    fireEvent.click(selectBtn)

    expect(await screen.findByText('创建中…')).toBeTruthy()
    
    await waitFor(() => {
      expect(createWorkspaceMock).toHaveBeenCalledWith('/home/user/projects/foo')
      expect(onPick).toHaveBeenCalledWith(newWorkspace)
    })
  })

  it('handles errors from directory listing and workspace creation', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    listDirectoryMock.mockRejectedValue(new Error('Permission denied'))

    const onPick = vi.fn()
    render(<WorkspaceView onPick={onPick} />)

    fireEvent.click(await screen.findByText('新建工作区'))

    // Verify error from listing
    expect(await screen.findByText('Permission denied')).toBeTruthy()
    
    // Retry with success
    listDirectoryMock.mockResolvedValue({
      path: '/home',
      home: '/home/user',
      crumbs: [],
      entries: [],
      truncated: false
    })
    fireEvent.click(screen.getByText('重试'))
    
    const selectBtn = await screen.findByText('选择此目录')
    
    // Fail creation
    createWorkspaceMock.mockRejectedValue(new Error('Already exists'))
    fireEvent.click(selectBtn)

    expect(await screen.findByText('Already exists')).toBeTruthy()
  })
})

describe('mobile workspace recents', () => {
  function stubStorage(initial: Record<string, string>): Map<string, string> {
    const store = new Map<string, string>(Object.entries(initial))
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value) },
        removeItem: (key: string) => { store.delete(key) },
        clear: () => { store.clear() },
      },
    })
    return store
  }

  it('removes a deleted recent workspace from the ordered list', async () => {
    const store = stubStorage({ 'dsh.palm.recentWorkspaces': JSON.stringify(['ws-1', 'ws-2']) })
    listWorkspacesMock.mockResolvedValue(workspaces)
    deleteWorkspaceMock.mockResolvedValue({ deleted: true })
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('First')
    const row = screen.getByText('First').closest('button')!
    fireEvent.contextMenu(row)
    fireEvent.click(await screen.findByRole('menuitem', { name: /删除工作区/ }))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(deleteWorkspaceMock).toHaveBeenCalledWith('ws-1')
    })
    // The deleted id leaves the stored list; the other recent stays.
    expect(JSON.parse(store.get('dsh.palm.recentWorkspaces') ?? '[]')).toEqual(['ws-2'])
  })

  it('migrates the legacy single-value recent key into the list format', () => {
    const store = stubStorage({ 'dsh.palm.recentWorkspace': 'ws-1' })
    listWorkspacesMock.mockResolvedValue(workspaces)
    render(<WorkspaceView onPick={() => {}} />)
    // Migration runs at read: the list key now carries the id and the legacy
    // key is dropped (asserted synchronously after first render).
    expect(JSON.parse(store.get('dsh.palm.recentWorkspaces') ?? '[]')).toEqual(['ws-1'])
    expect(store.get('dsh.palm.recentWorkspace')).toBeUndefined()
  })
})

describe('WorkspaceView first-run welcome', () => {
  afterEach(() => {
    try { localStorage.removeItem('dsh.palm.welcomeSeen') } catch { /* non-fatal */ }
  })

  it('shows the one-shot onboarding card on first open', async () => {
    render(<WorkspaceView onPick={() => {}} />)
    expect(await screen.findByText(/配对成功/)).toBeTruthy()
    expect(screen.getByText(/三步上手/)).toBeTruthy()
  })

  it('dismisses the card forever once acknowledged', async () => {
    const first = render(<WorkspaceView onPick={() => {}} />)
    fireEvent.click(await first.findByRole('button', { name: '知道了' }))
    expect(first.queryByText(/配对成功/)).toBeNull()
    // A later mount (fresh component) stays silent: the dismissal persisted.
    const second = render(<WorkspaceView onPick={() => {}} />)
    expect(second.queryByText(/配对成功/)).toBeNull()
  })
})

describe('WorkspaceView global search', () => {
  beforeEach(() => {
    searchAllMock.mockReset()
    searchAllMock.mockResolvedValue({ items: [], hasMore: false })
    searchMessagesMock.mockReset()
    searchMessagesMock.mockResolvedValue({ items: [] })
  })

  it('shows session hits across workspaces with their owner labels', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchAllMock.mockResolvedValue({
      items: [
        { kind: 'message', sessionId: 's-x', snippet: '支付回调里的密钥校验', workspaceId: 'ws-1', seq: 7 },
        { kind: 'message', sessionId: 's-y', snippet: '无法归属的旧片段', seq: 8 },
      ],
      hasMore: false,
    })
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('First')
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }))
    fireEvent.change(screen.getByPlaceholderText('搜索工作区或会话…'), { target: { value: '支付' } })
    // The sessions group renders with the owning workspace title (or a
    // generic label when attribution is missing).
    expect(await screen.findByText('会话')).toBeTruthy()
    expect(screen.getAllByText('支付回调里的密钥校验').length).toBeGreaterThan(0)
    expect(screen.getByText('First')).toBeTruthy()
    // Attributionless hits label 未分组, not the misleading 其他工作区.
    expect(screen.getByText('未分组')).toBeTruthy()
    expect(searchAllMock).toHaveBeenCalledWith('支付')
  })

  it('resolves the owner from the local roster when host attribution is missing', async () => {
    const withAttach = [
      { ...workspaces[0]!, sessionIds: ['s-x'] as never },
      workspaces[1]!,
    ]
    listWorkspacesMock.mockResolvedValue(withAttach)
    searchAllMock.mockResolvedValue({
      items: [{ kind: 'message', sessionId: 's-x', snippet: '支付回调里的密钥校验', seq: 7 }],
      hasMore: false,
    })
    const onLocate = vi.fn()
    render(<WorkspaceView onPick={() => {}} onLocateSession={onLocate} />)
    await screen.findByText('First')
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }))
    fireEvent.change(screen.getByPlaceholderText('搜索工作区或会话…'), { target: { value: '支付' } })
    await screen.findByText('会话')
    // Attribution is missing on the hit, but the phone's own roster carries
    // the attach relation: show the REAL workspace name, and locate with the
    // resolved workspace id - no dead page reload, no misleading label.
    expect(screen.getByText('First')).toBeTruthy()
    expect(screen.queryByText('其他工作区')).toBeNull()
    expect(screen.queryByText('未分组')).toBeNull()
    fireEvent.click(screen.getAllByText(/支付回调里的密钥校验/).at(-1)!)
    await waitFor(() => {
      expect(onLocate).toHaveBeenCalledWith('s-x', 'ws-1', 7, '支付')
    })
  })

  it('restores the search surface from initialSearch and reports snapshots', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchAllMock.mockResolvedValue({ items: [], hasMore: false })
    const onApplied = vi.fn()
    const onSnapshot = vi.fn()
    render(
      <WorkspaceView
        onPick={() => {}}
        initialSearch={{ open: true, term: '排查' }}
        onSearchApplied={onApplied}
        onSearchSnapshot={onSnapshot}
      />,
    )
    // The search box is open with the restored term, and the app was told the
    // one-shot restore is consumed.
    const input = await screen.findByPlaceholderText('搜索工作区或会话…') as HTMLInputElement
    expect(input.value).toBe('排查')
    expect(onApplied).toHaveBeenCalledTimes(1)
    // Live state is reported (open + term) so the app can restore it on return.
    expect(onSnapshot).toHaveBeenCalledWith(expect.any(Boolean), expect.any(String))
    // It restores only once: a later render does not re-apply.
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
  })

  it('hides the create-workspace action while searching', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchAllMock.mockResolvedValue({ items: [], hasMore: false })
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('First')
    expect(screen.getByText('新建工作区')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }))
    fireEvent.change(screen.getByPlaceholderText('搜索工作区或会话…'), { target: { value: '支付' } })
    await screen.findByText('没有匹配的工作区或会话')
    expect(screen.queryByText('新建工作区')).toBeNull()
  })

  it('labels a hit with the host-resolved workspace title before the roster loads', async () => {
    // The roster is still loading (items undefined), but the host already
    // resolved the owner: the row must show the real workspace title, not
    // 未分组.
    // The roster is empty (still loading), but the host already resolved the
    // owner: the row must show the real workspace title, not 未分组.
    listWorkspacesMock.mockResolvedValue([])
    searchAllMock.mockResolvedValue({
      items: [{ kind: 'message', sessionId: 's-x', snippet: '支付回调里的密钥校验', workspaceId: 'ws-1', workspaceTitle: 'dsh-palm', seq: 7 }],
      hasMore: false,
    })
    render(<WorkspaceView onPick={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }))
    fireEvent.change(screen.getByPlaceholderText('搜索工作区或会话…'), { target: { value: '支付' } })
    await screen.findByText('会话')
    expect(screen.getByText('dsh-palm')).toBeTruthy()
    expect(screen.queryByText('未分组')).toBeNull()
  })

  it('shows the combined empty state when nothing matches anywhere', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchAllMock.mockResolvedValue({ items: [], hasMore: false })
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('First')
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }))
    fireEvent.change(screen.getByPlaceholderText('搜索工作区或会话…'), { target: { value: '不存在的词' } })
    expect(await screen.findByText('没有匹配的工作区或会话')).toBeTruthy()
  })

  it('opens a session hit straight to its first matched message', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchAllMock.mockResolvedValue({
      items: [{ kind: 'message', sessionId: 's-x', snippet: '支付回调里的密钥校验', workspaceId: 'ws-1', seq: 7 }],
      hasMore: false,
    })
    const onLocate = vi.fn()
    render(<WorkspaceView onPick={() => {}} onLocateSession={onLocate} />)
    await screen.findByText('First')
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }))
    fireEvent.change(screen.getByPlaceholderText('搜索工作区或会话…'), { target: { value: '支付' } })
    await screen.findByText('会话')
    // The host hit already carries the exact matched sequence and is opened
    // directly, without a second per-session search.
    fireEvent.click(screen.getAllByText(/支付回调里的密钥校验/).at(-1)!)
    await waitFor(() => {
      expect(searchMessagesMock).not.toHaveBeenCalled()
      expect(onLocate).toHaveBeenCalledWith('s-x', 'ws-1', 7, '支付')
    })
  })

  it('opens a standalone hit directly when no workspace anywhere claims it', async () => {
    // No host attribution and the local roster has no attach relation for
    // the hit: the parent's onOpenDirect chat shortcut must fire, not a
    // dead 未找到所属工作区 toast or a page reload.
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchAllMock.mockResolvedValue({
      items: [{ kind: 'message', sessionId: 's-orphan', snippet: '孤立会话的支付逻辑', seq: 7 }],
      hasMore: false,
    })
    const onOpenDirect = vi.fn()
    render(<WorkspaceView onPick={() => {}} onOpenDirect={onOpenDirect} />)
    await screen.findByText('First')
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }))
    fireEvent.change(screen.getByPlaceholderText('搜索工作区或会话…'), { target: { value: '支付' } })
    await screen.findByText('会话')
    expect(screen.getByText('未分组')).toBeTruthy()
    fireEvent.click(screen.getAllByText(/孤立会话的支付逻辑/).at(-1)!)
    await waitFor(() => {
      expect(onOpenDirect).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 's-orphan', snippet: '孤立会话的支付逻辑' }),
        7,
        '支付',
      )
    })
  })

  it('keeps the workspace filter working when the session lookup fails', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchAllMock.mockRejectedValue(new Error('network down'))
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('First')
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }))
    fireEvent.change(screen.getByPlaceholderText('搜索工作区或会话…'), { target: { value: 'Second' } })
    // The workspace-name filter still matches locally.
    expect(await screen.findByText('Second')).toBeTruthy()
    expect(screen.queryByText('会话')).toBeNull()
  })
})
