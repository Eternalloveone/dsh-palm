// @vitest-environment jsdom
/** SessionListView: owned-row filtering, incremental pages, session creation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { SessionListView, sessionListCache, sessionPreviewCache, type SessionListViewProps } from './SessionListView.tsx'
import { type SessionView } from './App.tsx'

// The api module is fully mocked; the view's App.tsx helpers stay real.
vi.mock('../api.ts', () => ({
  listSessions: vi.fn(),
  listWorkspaces: vi.fn(),
  listAgentPresets: vi.fn(),
  createSession: vi.fn(),
  archiveSession: vi.fn(async () => ({ archivedSessionIds: [] })),
  previews: vi.fn(),
  history: vi.fn(),
}))
vi.mock('../offline.ts', () => ({
  removeOutboxForSession: vi.fn(),
}))
import { archiveSession as archiveSessionApi, createSession, listAgentPresets, listSessions, listWorkspaces, previews, history } from '../api.ts'
import { removeOutboxForSession } from '../offline.ts'

const listSessionsMock = vi.mocked(listSessions)
const listWorkspacesMock = vi.mocked(listWorkspaces)
const listAgentPresetsMock = vi.mocked(listAgentPresets)
const createSessionMock = vi.mocked(createSession)
const archiveSessionMock = vi.mocked(archiveSessionApi)
const previewsMock = vi.mocked(previews)
const historyMock = vi.mocked(history)
const removeOutboxForSessionMock = vi.mocked(removeOutboxForSession)

const workspace: WorkspaceRow = {
  workspaceId: 'w-1' as never,
  path: '/tmp/demo',
  title: '演示项目',
  sessionIds: ['s-1', 's-sub', 's-case'] as never,
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
  listWorkspacesMock.mockResolvedValue([workspace])
  listAgentPresetsMock.mockResolvedValue({ presets: [], authorable: false, hasDocument: false })
  createSessionMock.mockResolvedValue({ sessionId: 's-new' })
  // The v3.1 batch preview path: empty by default (rows fall back to their
  // stats lines); per-row history fallback stays unmocked (unused).
  previewsMock.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // The cross-mount caches are module state, and their persisted mirror
  // lives in localStorage — clear both so every case starts from a cold
  // roster (the caches are exactly what other cases assert about, so
  // isolation is load-bearing).
  sessionListCache.clear()
  sessionPreviewCache.clear()
  localStorage.clear()
})

describe('SessionListView roster', () => {
  it('shows only the sessions attached to the workspace (desktop parity)', async () => {
    listSessionsMock.mockResolvedValue({
      items: [
        summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '改造移动端' } } }),
        summary('s-sub', 1_650_000_000_000, { cwd: '/tmp/demo/sub', projections: { values: { title: '子目录会话' } } }),
        summary('s-case', 1_640_000_000_000, { cwd: '/TMP/DEMO', projections: { values: { title: '大小写路径' } } }),
        // A standalone session whose cwd happens to live under the workspace
        // directory is NOT attached — the desktop GUI keeps it out of the
        // roster (未分组), and the phone must match.
        summary('s-orphan', 1_630_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '未挂载会话' } } }),
        summary('s-other', 1_600_000_000_000, { cwd: '/tmp/foreign' }),
        summary('s-nocwd', 1_590_000_000_000),
      ],
      hasMore: false,
    })
    renderList()

    expect(await screen.findByText('改造移动端')).toBeTruthy()
    expect(screen.queryByText('子目录会话')).not.toBeNull()
    expect(screen.queryByText('大小写路径')).not.toBeNull()
    // Sessions outside the owned id set must stay hidden — the list is the
    // project's, not the global history, and standalone sessions never
    // reappear (they would otherwise show on the phone but not the desktop).
    expect(screen.queryByText(/未挂载会话/)).toBeNull()
    expect(screen.queryByText(/foreign/)).toBeNull()
    expect(screen.queryByText(/nocwd/)).toBeNull()
  })

  it('shows the empty state when the workspace has no sessions', async () => {
    renderList()
    expect(await screen.findByText(/还没有会话/)).toBeTruthy()
  })

  it('shows a session created after the list last mounted (back-from-chat remount)', async () => {
    // The workspace prop snapshot predates the new session; the refreshed
    // roster carries it, so the owned-row filter must not drop the row.
    listWorkspacesMock.mockResolvedValue([{ ...workspace, sessionIds: ['s-1', 's-new'] } as never])
    listSessionsMock.mockResolvedValue({
      items: [summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo' }), summary('s-new', 1_800_000_000_000)],
      hasMore: false,
    })
    renderList()
    expect(await screen.findByText('新会话')).toBeTruthy()
  })

  it('falls back to the workspace snapshot when the roster refresh fails', async () => {
    listWorkspacesMock.mockRejectedValue(new Error('network down'))
    listSessionsMock.mockResolvedValue({
      items: [summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo' })],
      hasMore: false,
    })
    renderList()
    // The list still renders from the snapshot's owned ids — the refresh is
    // best-effort and must never block the roster.
    expect(await screen.findByText('demo')).toBeTruthy()
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
    // s-2 is attached on the second page; s-foreign is not owned.
    const pagedWorkspace: WorkspaceRow = { ...workspace, sessionIds: ['s-1', 's-2'] as never }
    listWorkspacesMock.mockResolvedValue([pagedWorkspace])
    renderList({ workspace: pagedWorkspace })
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
    const longIdWorkspace: WorkspaceRow = { ...workspace, sessionIds: ['session-abcdef12-3456-7890-abcd-1234567890ab'] as never }
    listWorkspacesMock.mockResolvedValue([longIdWorkspace])
    renderList({ workspace: longIdWorkspace })
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
  it('deletes a session from the row menu, archives it on the host, and clears its outbox', async () => {
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
      // The delete is REAL: the host archive write fires, so the row cannot
      // resurrect on the next roster fetch (the archive set rides
      // workspace.list and session.list filters it).
      expect(archiveSessionMock).toHaveBeenCalledWith('s-1')
    })
    // The row is removed from the local list.
    expect(screen.queryByText('改造移动端')).toBeNull()
  })
})

describe('SessionListView previews (v3.1 batch)', () => {  it('pulls previews for the loaded page in ONE batched call and renders them', async () => {
    listSessionsMock.mockResolvedValue({
      items: [
        summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '改造移动端' } } }),
        summary('s-sub', 1_690_000_000_000, { cwd: '/tmp/demo', blank: true }),
        summary('s-case', 1_680_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '另一个' } } }),
      ],
      hasMore: false,
    })
    previewsMock.mockResolvedValue([
      { sessionId: 's-1', summary: '已完成修改', updatedAt: 1_700_000_000_001 },
      { sessionId: 's-case', summary: '[代码] ts', updatedAt: 1_680_000_000_001 },
    ])
    renderList()
    await screen.findByText('改造移动端')
    // One batch call naming exactly the non-blank, uncached rows.
    await waitFor(() => {
      expect(previewsMock).toHaveBeenCalledTimes(1)
      expect(previewsMock.mock.calls[0]?.[0]).toEqual(['s-1', 's-case'])
    })
    expect(await screen.findByText('已完成修改')).toBeTruthy()
    expect(await screen.findByText('[代码] ts')).toBeTruthy()
    // The blank session is never preview-read.
    expect(historyMock).not.toHaveBeenCalled()
  })

  it('falls back to per-row history reads when the batch preview call fails', async () => {
    listSessionsMock.mockResolvedValue({
      items: [
        summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '改造移动端' } } }),
      ],
      hasMore: false,
    })
    previewsMock.mockRejectedValue(new Error('unavailable'))
    historyMock.mockResolvedValue({
      events: [{
        event: {
          type: 'assistant/message',
          seq: 3,
          time: 1_700_000_000_001,
          data: {
            turn: 0,
            step: 0,
            message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '降级方案也能预览' }] },
          },
        } as never,
      }],
      hasMore: false,
    })
    renderList()
    // The fallback path folds the 1-message tail into the row preview.
    expect(await screen.findByText('降级方案也能预览', {}, { timeout: 3000 })).toBeTruthy()
    expect(historyMock).toHaveBeenCalledWith('s-1', undefined, 1, expect.any(AbortSignal))
  })
})

describe('SessionListView cross-mount cache (v3.2)', () => {
  /** Seed the module cache as a previous visit would have left it. */
  const seedCache = (rows: SessionView[], at = Date.now()): void => {
    sessionListCache.set('w-1', { rows, cursor: undefined, hasMore: false, at })
  }

  it('renders the cached roster instantly on return and re-validates in the background', async () => {
    seedCache([
      { sessionId: 's-1', title: '缓存的会话', updatedAt: 1_700_000_000_000, running: false, blank: false },
    ])
    listSessionsMock.mockResolvedValue({
      items: [
        summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '刷新的标题' } } }),
      ],
      hasMore: false,
    })
    renderList()
    // The cached row paints synchronously — no skeleton, no RPC wait.
    expect(screen.getByText('缓存的会话')).toBeTruthy()
    expect(screen.queryByText('刷新的标题')).toBeNull()
    // The background refresh still ran and reconciled the row titles.
    expect(await screen.findByText('刷新的标题')).toBeTruthy()
    expect(listSessionsMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the roster visible when the background refresh fails (silent)', async () => {
    seedCache([
      { sessionId: 's-1', title: '缓存的会话', updatedAt: 1_700_000_000_000, running: false, blank: false },
    ])
    listSessionsMock.mockRejectedValue(new Error('roster read failed'))
    renderList()
    // The cached rows stay; no error banner surfaces.
    expect(screen.getByText('缓存的会话')).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(screen.queryByText(/roster read failed/)).toBeNull()
  })

  it('shows the skeleton instead of stale rows once the cache has aged out', async () => {
    seedCache([
      { sessionId: 's-1', title: '过期的会话', updatedAt: 1_700_000_000_000, running: false, blank: false },
    ], Date.now() - 61_000)
    listSessionsMock.mockResolvedValue({
      items: [summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '新数据' } } })],
      hasMore: false,
    })
    renderList()
    // Past the TTL: the cold-load skeleton shows, then the fresh roster.
    expect(document.querySelector('.skel-row')).not.toBeNull()
    expect(await screen.findByText('新数据')).toBeTruthy()
  })

  it('restores the persisted roster on PWA cold start (localStorage, no memory cache)', async () => {
    // A previous page life persisted its list; this mount has NO memory cache
    // (fresh page). The persisted rows paint instantly.
    localStorage.setItem('dsh-palm.list.v1.w-1', JSON.stringify({
      v: 1,
      rows: [{ sessionId: 's-1', title: '冷启动的会话', updatedAt: 1_700_000_000_000, running: false, blank: false }],
      hasMore: false,
      savedAt: Date.now(),
    }))
    listSessionsMock.mockResolvedValue({
      items: [
        summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '刷新后的标题' } } }),
      ],
      hasMore: false,
    })
    renderList()
    // Instantly from the store — no skeleton, no RPC wait.
    expect(screen.getByText('冷启动的会话')).toBeTruthy()
    expect(screen.queryByText('刷新后的标题')).toBeNull()
    // The background refresh reconciles the title.
    expect(await screen.findByText('刷新后的标题')).toBeTruthy()
  })

  it('persists refreshed rows back to localStorage for the NEXT cold start', async () => {
    listSessionsMock.mockResolvedValue({
      items: [summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '已刷新' } } })],
      hasMore: false,
    })
    renderList()
    await screen.findByText('已刷新')
    const persisted = JSON.parse(localStorage.getItem('dsh-palm.list.v1.w-1') ?? 'null') as {
      v: number
      rows: Array<{ sessionId: string; title: string }>
      savedAt: number
    } | null
    expect(persisted?.v).toBe(1)
    expect(persisted?.rows[0]).toMatchObject({ sessionId: 's-1', title: '已刷新' })
    expect(Date.now() - (persisted?.savedAt ?? 0)).toBeLessThan(60_000)
  })
})
