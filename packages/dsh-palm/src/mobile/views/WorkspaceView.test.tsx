// @vitest-environment jsdom
/** Mobile workspace landing: roster rendering and QR deep-link selection. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { WorkspaceView as WorkspaceRow } from '../../api-proxy-types'
import { mobileWorkspaceTarget } from './App.tsx'
import { WorkspaceView, workspaceKind } from './WorkspaceView.tsx'

vi.mock('../api.ts', () => ({
  // 打开会话时会向宿主要一次排队快照（投影帧到不了手机）。
  inboxOf: vi.fn(async () => ({ inbox: null })),
  // 原子快照（行 + 队列 + 回合）：默认没有任何在跑的回合与排队项，用例自己改。
  sessionState: vi.fn(async (sessionId: string) => ({
    sessionId,
    rows: [],
    maxSeq: 0,
    queue: [],
    queueRevision: 0,
    turn: { running: false },
    asOf: Date.now(),
  })),
  goalOf: vi.fn(async () => ({ goal: null })),
  listWorkspaces: vi.fn(),
  listDirectory: vi.fn(),
  createWorkspace: vi.fn(),
  renameWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  searchAll: vi.fn(),
  searchMessages: vi.fn(),
  // 默认让宿主索引「还没建好」，老用例继续走 mobile.searchAll 那条路；
  // 索引路径的行为由后面的专门用例覆盖。
  searchSessions: vi.fn(async () => ({ items: [], total: 0, hasMore: false, tookMs: 0, fallback: true })),
}))
import { listWorkspaces, listDirectory, createWorkspace, deleteWorkspace, searchAll, searchMessages, searchSessions, type IndexedSearchItem } from '../api.ts'

const listWorkspacesMock = vi.mocked(listWorkspaces)
const listDirectoryMock = vi.mocked(listDirectory)
const createWorkspaceMock = vi.mocked(createWorkspace)
const deleteWorkspaceMock = vi.mocked(deleteWorkspace)
const searchAllMock = vi.mocked(searchAll)
const searchMessagesMock = vi.mocked(searchMessages)
const searchSessionsMock = vi.mocked(searchSessions)

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

  it('no longer splits test-looking paths into their own group (they are code projects)', () => {
    // 2026-10-29：首页去掉「测试项目」分区 —— 按 path 分词分组会把正经项目也误判进去。
    expect(workspaceKind(row('t', '/rigs/spec-runner', 'Rig'), ['other'])).toBe('code')
    expect(workspaceKind(row('e2e', '/svc/e2e-harness', 'Harness'), ['other'])).toBe('code')
    expect(workspaceKind(row('plain', '/proj/plain', 'Plain', false), ['other'])).toBe('plain')
    // 最近打开过的工作区仍然优先算活跃。
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
    expect(await screen.findByText('消息')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /支付回调里的密钥校验/ }).length).toBeGreaterThan(0)
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
    await screen.findByText('消息')
    // Attribution is missing on the hit, but the phone's own roster carries
    // the attach relation: show the REAL workspace name, and locate with the
    // resolved workspace id - no dead page reload, no misleading label.
    expect(screen.getByText('First')).toBeTruthy()
    expect(screen.queryByText('其他工作区')).toBeNull()
    expect(screen.queryByText('未分组')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /支付回调里的密钥校验/ }).at(-1)!)
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
    await screen.findByText('消息')
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
    await screen.findByText('消息')
    // The host hit already carries the exact matched sequence and is opened
    // directly, without a second per-session search.
    fireEvent.click(screen.getAllByRole('button', { name: /支付回调里的密钥校验/ }).at(-1)!)
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
    await screen.findByText('消息')
    expect(screen.getByText('未分组')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /孤立会话的支付逻辑/ }).at(-1)!)
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

describe('mobile workspace search matching', () => {
  const row = (workspaceId: string, title: string, path: string): WorkspaceRow => ({
    workspaceId: workspaceId as never,
    path,
    title,
    sessionIds: [] as never,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  const openSearch = async (term: string): Promise<void> => {
    // 工具栏按钮用 aria-label 定位：命中行的标题里也可能含「搜索」，按 /搜索/ 找按钮会撞车。
    fireEvent.click(screen.getByLabelText('搜索工作区和会话'))
    fireEvent.change(screen.getByPlaceholderText('搜索工作区或会话…'), { target: { value: term } })
  }

  it('matches the directory name as well as the title', async () => {
    listWorkspacesMock.mockResolvedValue([
      row('ws-a', '随手记', 'D:\\work\\dsh-palm'),
      row('ws-b', '无关项目', 'D:\\work\\other'),
    ])
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('随手记')
    await openSearch('dsh-palm')
    // 标题不含关键词，但目录末段命中 ⇒ 仍然出现，别的项目被过滤掉。
    expect(await screen.findByText('随手记')).toBeTruthy()
    expect(screen.queryByText('无关项目')).toBeNull()
  })

  it('ranks a title hit above a longer title that merely contains it', async () => {
    listWorkspacesMock.mockResolvedValue([
      row('ws-long', '会话搜索结果面板的重构计划', '/tmp/long'),
      row('ws-short', '搜索', '/tmp/short'),
    ])
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('搜索')
    await openSearch('搜索')
    await waitFor(() => {
      expect(document.querySelectorAll('.card-titleText').length).toBe(2)
    })
    const titles = Array.from(document.querySelectorAll('.card-titleText')).map(node => node.textContent ?? '')
    // 第一条工作区命中必须是「标题就是关键词」的那条，不是更长的正文式标题。
    expect(titles[0]).toBe('搜索')
    expect(titles[1]).toBe('会话搜索结果面板的重构计划')
  })

  it('marks the matched characters so the row explains why it matched', async () => {
    listWorkspacesMock.mockResolvedValue([row('ws-a', '手机端搜索', '/tmp/a')])
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('手机端搜索')
    await openSearch('搜索')
    const marks = await waitFor(() => {
      const found = document.querySelectorAll('.search-mark')
      expect(found.length).toBeGreaterThan(0)
      return found
    })
    expect(marks[0]?.textContent).toBe('搜索')
  })

  it('does not paint a subsequence-only match (「项甲」命中「项目甲」只排序、不涂黄)', async () => {
    listWorkspacesMock.mockResolvedValue([row('ws-a', '项目甲', '/tmp/a')])
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('项目甲')
    await openSearch('项甲')
    // 行仍然出现（子序列命中参与筛选与排序），但不上色：把不相干的单字涂黄像乱码。
    expect(await screen.findByText('项目甲')).toBeTruthy()
    expect(document.querySelectorAll('.search-mark')).toHaveLength(0)
  })

  it('caps the workspace group and says how many are hidden', async () => {
    listWorkspacesMock.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => row(`ws-${index}`, `项目 ${index}`, `/tmp/p${index}`)),
    )
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('项目 0')
    await openSearch('项目')
    expect(await screen.findByText(/另有 2 个工作区命中/)).toBeTruthy()
  })

  it('索引路径：同一会话的多条命中各占一行，点第 2 条带它自己的 seq 打开', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchSessionsMock.mockResolvedValue({
      items: [{
        kind: 'message',
        sessionId: 's-x',
        workspaceId: 'ws-1',
        title: '支付会话',
        snippet: '第一条摘要',
        hits: 2,
        seq: 7,
        messageId: 'm1',
        messages: [
          { seq: 7, messageId: 'm1', snippet: '第一条摘要' },
          { seq: 9, messageId: 'm2', snippet: '第二条摘要' },
        ],
      }],
      total: 1,
      hasMore: false,
      nextOffset: 12,
      tookMs: 3,
    })
    const onLocate = vi.fn()
    render(<WorkspaceView onPick={() => {}} onLocateSession={onLocate} />)
    await screen.findByText('First')
    await openSearch('支付')
    await screen.findByText('消息')
    // 两条命中都在，且标了「2/2」说明这个会话有几条。
    expect(screen.getByText('第二条摘要')).toBeTruthy()
    expect(screen.getByText('2/2')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /第二条摘要/ }).at(-1)!)
    await waitFor(() => { expect(onLocate).toHaveBeenCalled() })
    // 走的是第二条自己的 seq，不是这个会话的最佳命中（末尾还带着它的 messageId）。
    expect(onLocate.mock.calls[0]?.slice(0, 4)).toEqual(['s-x', 'ws-1', 9, '支付'])
    expect(onLocate.mock.calls[0]?.[4]).toBe('m2')
  })

  it('fork 副本合并成一行并标副本数（同一段历史在多个 session id 下各一份）', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    const copy = (sessionId: string, title?: string): IndexedSearchItem => ({
      kind: 'message',
      sessionId,
      workspaceId: 'ws-1',
      ...(title === undefined ? {} : { title }),
      snippet: '同一段摘要',
      hits: 1,
      seq: 7,
      messageId: 'm1',
      messages: [{ seq: 7, messageId: 'm1', snippet: '同一段摘要' }],
    })
    searchSessionsMock.mockResolvedValue({
      // 副本里有的带标题、有的是未命名：合并后代表行要取有标题的那份。
      items: [copy('s-a'), copy('s-b'), copy('s-c', '账单会话')],
      total: 3,
      hasMore: false,
      nextOffset: 12,
      tookMs: 3,
    })
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('First')
    await openSearch('支付')
    await screen.findByText('消息')
    // 三份副本只有一行内容，副本数如实标出来（否则用户看到三行一模一样的结果）。
    expect(screen.getAllByText('同一段摘要')).toHaveLength(1)
    expect(screen.getByText('3 个副本')).toBeTruthy()
    expect(screen.getByText('账单会话')).toBeTruthy()
  })

  it('没有标题的会话不再把摘要开头当标题重复一遍', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchSessionsMock.mockResolvedValue({
      items: [{
        kind: 'message',
        sessionId: 's-notitle',
        workspaceId: 'ws-1',
        snippet: '这一段命中正文的开头部分',
        hits: 1,
        seq: 5,
        messageId: 'm5',
        messages: [{ seq: 5, messageId: 'm5', snippet: '这一段命中正文的开头部分' }],
      }],
      total: 1,
      hasMore: false,
      nextOffset: 12,
      tookMs: 3,
    })
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('First')
    await openSearch('支付')
    await screen.findByText('消息')
    expect(screen.getByText('未命名会话')).toBeTruthy()
    // 摘要只出现一次（以前标题取摘要前 24 字，正文又渲染一遍）。
    expect(screen.getAllByText(/这一段命中正文的开头部分/)).toHaveLength(1)
  })

  it('输入法组词期间不发请求，组词结束才搜一次', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchSessionsMock.mockResolvedValue({ items: [], total: 0, hasMore: false, nextOffset: 12, tookMs: 1 })
    searchSessionsMock.mockClear()
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('First')
    fireEvent.click(screen.getByLabelText('搜索工作区和会话'))
    const input = screen.getByPlaceholderText('搜索工作区或会话…')
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'zhifu' } })
    // 拼音串不该把宿主问一遍（中文打到一半的串搜出来全是噪音）。
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(searchSessionsMock).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input, { target: { value: '支付' } })
    await waitFor(() => { expect(searchSessionsMock).toHaveBeenCalledTimes(1) })
    expect(searchSessionsMock.mock.calls[0]?.[0]).toMatchObject({ query: '支付', offset: 0 })
  })

  it('回车直接打开第一条命中', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchSessionsMock.mockResolvedValue({
      items: [{ kind: 'message', sessionId: 's-x', workspaceId: 'ws-1', title: '支付会话', snippet: '支付回调里的密钥校验', hits: 1, seq: 7, messageId: 'm1' }],
      total: 1,
      hasMore: false,
      nextOffset: 12,
      tookMs: 2,
    })
    const onLocate = vi.fn()
    render(<WorkspaceView onPick={() => {}} onLocateSession={onLocate} />)
    await screen.findByText('First')
    await openSearch('支付')
    await screen.findByText('消息')
    fireEvent.keyDown(screen.getByPlaceholderText('搜索工作区或会话…'), { key: 'Enter' })
    await waitFor(() => { expect(onLocate).toHaveBeenCalled() })
    expect(onLocate.mock.calls[0]?.slice(0, 4)).toEqual(['s-x', 'ws-1', 7, '支付'])
  })

  it('加载更多：把下一页追加在后面，不替换已有结果', async () => {
    listWorkspacesMock.mockResolvedValue(workspaces)
    searchSessionsMock
      .mockResolvedValueOnce({
        items: [{ kind: 'message', sessionId: 's-x', title: '支付会话', snippet: '第一页的命中', hits: 1, seq: 7 }],
        total: 2,
        hasMore: true,
        nextOffset: 12,
        tookMs: 2,
      })
      .mockResolvedValueOnce({
        items: [{ kind: 'message', sessionId: 's-y', title: '另一个会话', snippet: '第二页的命中', hits: 1, seq: 11 }],
        total: 2,
        hasMore: false,
        nextOffset: 24,
        tookMs: 2,
      })
    render(<WorkspaceView onPick={() => {}} />)
    await screen.findByText('First')
    await openSearch('支付')
    expect(await screen.findByText('第一页的命中')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多结果' }))
    expect(await screen.findByText('第二页的命中')).toBeTruthy()
    // 第一页的结果没有被第二页顶掉。
    expect(screen.getByText('第一页的命中')).toBeTruthy()
    expect(searchSessionsMock.mock.calls[1]?.[0]).toMatchObject({ query: '支付', offset: 12 })
  })
})
