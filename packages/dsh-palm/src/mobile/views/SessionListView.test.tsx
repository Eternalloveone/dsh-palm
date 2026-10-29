// @vitest-environment jsdom
/** SessionListView: owned-row filtering, incremental pages, session creation. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react'
import type { WorkspaceView as WorkspaceRow } from '../../api-proxy-types'
import type { ChatPage } from '../api.ts'
import { SessionListView, sessionListCache, sessionPreviewCache, RUNNING_STALE_MS, FIRST_PAGE_TIMEOUT_MS, type SessionListViewProps } from './SessionListView.tsx'
import { type SessionView } from './App.tsx'

// The api module is fully mocked; the view's App.tsx helpers stay real.
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
  listSessions: vi.fn(),
  listWorkspaces: vi.fn(),
  listAgentPresets: vi.fn(),
  createSession: vi.fn(),
  archiveSession: vi.fn(async () => ({ archivedSessionIds: [] })),
  previews: vi.fn(),
  // 默认「没有会话在跑」：这些用例关心的是 mux 帧怎么落到列表上。
  runningSessions: vi.fn(async () => ({ sessionIds: [] })),
  // 列表会对宿主说"在跑"的会话用尾页核实一次。默认给一个"边界还开着、但最新
  // 事件早已不动"的尾页，等于核实为没在跑，不改动既有用例的预期。
  logTail: vi.fn(async () => ({
    rows: [],
    maxSeq: 0,
    hasMore: false,
    turnStartAt: 1_700_000_000_000,
    lastEventAt: 1_700_000_001_000,
  })),
  history: vi.fn(),
  searchAll: vi.fn(),
  searchMessages: vi.fn(),
  searchSessions: vi.fn(),
}))
vi.mock('../offline.ts', () => ({
  removeOutboxForSession: vi.fn(),
}))
import { archiveSession as archiveSessionApi, createSession, listAgentPresets, listSessions, listWorkspaces, logTail, previews, runningSessions, history, searchAll, searchMessages, searchSessions } from '../api.ts'
import { removeOutboxForSession } from '../offline.ts'

const listSessionsMock = vi.mocked(listSessions)
const listWorkspacesMock = vi.mocked(listWorkspaces)
const listAgentPresetsMock = vi.mocked(listAgentPresets)
const createSessionMock = vi.mocked(createSession)
const archiveSessionMock = vi.mocked(archiveSessionApi)
const previewsMock = vi.mocked(previews)
const runningSessionsMock = vi.mocked(runningSessions)
const logTailMock = vi.mocked(logTail)
const historyMock = vi.mocked(history)
const searchAllMock = vi.mocked(searchAll)
const searchMessagesMock = vi.mocked(searchMessages)
const searchSessionsMock = vi.mocked(searchSessions)
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
  searchAllMock.mockResolvedValue({ items: [], hasMore: false })
  // 默认「索引还没建好」：既有用例继续覆盖旧路径兜底；索引路径由新用例单独覆盖。
  searchSessionsMock.mockResolvedValue({ items: [], total: 0, hasMore: false, tookMs: 0, fallback: true })
  searchMessagesMock.mockResolvedValue({ items: [] })
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
    // 第二页不再需要点"加载更多会话"：哨兵进入视野后会自动补页，直到把列表填满
    // （真机反馈"有时候要点好几次才看到更多会话"的修复）。
    expect(await screen.findByText('第二页会话')).toBeTruthy()
    expect(screen.queryByText('elsewhere')).toBeNull()
    // 续页必须把 workspaceId 一起带给宿主：宿主在切片前按工作区过滤，每页返回的都是
    // 本工作区的会话 —— 这是"每翻一屏要点很多次"与"往深处拉超时"的共同解。
    expect(listSessionsMock).toHaveBeenLastCalledWith('c1', 'w-1')
    expect(listSessionsMock).toHaveBeenNthCalledWith(1, undefined, 'w-1')
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

  it('预设没有写说明时，问号也能点开并给出解释（不能是个点不动的死按钮）', async () => {
    // 真机反馈（2026-10-29）：宿主给的 4 个预设全都没有 description，而问号按钮
    // 当时是 `disabled={presetDescription === undefined}` —— 点上去毫无反应。
    listAgentPresetsMock.mockResolvedValue({
      presets: [{ id: 'standard', name: 'standard', trust: 'system', isDefault: true }],
      authorable: false,
      hasDocument: false,
    })
    renderList()

    const help = await screen.findByRole('button', { name: '模式说明' })
    expect((help as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(help)

    const sheet = await screen.findByRole('dialog', { name: 'Agent 模式说明' })
    expect(within(sheet).getByText(/这个模式没有写说明/)).toBeTruthy()
    expect(within(sheet).getByText(/已有会话保持原样/)).toBeTruthy()
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
    // The store write is deferred and coalesced (list-persist): the window's
    // flush is what a cold start would have seen, and the page-hide path runs
    // it early.
    document.dispatchEvent(new Event('pagehide'))
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

/**
 * Live list frames: the host mirrors its `api-session/*` events onto the mux
 * (`session/added`, `session/removed`, `session/status`, `session/activity`,
 * `session/error`), so the roster tracks the desktop without a re-fetch.
 */
describe('SessionListView live session frames', () => {
  /** Minimal mux stand-in: captures the list's frame listener for hand-off. */
  class FakeMux {
    listeners = new Set<(frame: unknown) => void>()
    onFrame(listener: (frame: unknown) => void): () => void {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    }
    emit(frame: unknown): void {
      act(() => { for (const listener of this.listeners) listener(frame) })
    }
  }

  /** The workspace's two rows, newest first (s-sub outranks s-1). */
  function twoRows(): void {
    listSessionsMock.mockResolvedValue({
      items: [
        summary('s-sub', 1_800_000_000_000, { cwd: '/tmp/demo/sub', projections: { values: { title: '会话二' } } }),
        summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '会话一' } } }),
      ],
      hasMore: false,
    })
  }

  /** The rendered row titles, in DOM order. */
  function renderedTitles(): string[] {
    return Array.from(document.querySelectorAll('.sess-title')).map(node => node.textContent ?? '')
  }

  it('flips the running badge from a session/status frame', async () => {
    twoRows()
    const mux = new FakeMux()
    renderList({ mux: mux as never })
    await screen.findByText('会话一')
    expect(screen.queryByText('进行中')).toBeNull()

    mux.emit({ type: 'session/status', sessionId: 's-1', running: true })
    expect(screen.getAllByText('进行中')).toHaveLength(1)

    mux.emit({ type: 'session/status', sessionId: 's-1', running: false })
    expect(screen.queryByText('进行中')).toBeNull()
  })

  it('does not paint a green dot from the first page before the tail confirms it', async () => {
    // 真机现象（返回列表时卡片先绿一下）：首页来自宿主，而宿主那边的 running 会滞后
    // ——刚跑完的会话仍然被标成在跑。所以页面的 true 不能直接画。
    listSessionsMock.mockResolvedValue({
      items: [summary('s-1', 1_700_000_000_000, { running: true, cwd: '/tmp/demo', projections: { values: { title: '会话一' } } })],
      hasMore: false,
    })
    runningSessionsMock.mockResolvedValue({ sessionIds: [] })
    let releaseTail: (page: ChatPage) => void = () => {}
    logTailMock.mockImplementation(() => new Promise((resolve) => { releaseTail = resolve }))
    renderList()
    await screen.findByText('会话一')
    expect(screen.queryByText('进行中')).toBeNull()
    releaseTail({ rows: [], maxSeq: 3, hasMore: false, turnStartAt: Date.now() - 1_000 })
    expect(await screen.findAllByText('进行中')).toHaveLength(1)
  })

  it('drops a green dot that was baked into the cached page', async () => {
    // 从列表点进会话、跑完、再回来：缓存里那一行还带着上次的 running=true，
    // 挂载时如果照抄，就会先画出一个早就该熄灭的绿点。
    sessionListCache.set(String(workspace.workspaceId), {
      rows: [{ sessionId: 's-1', title: '缓存里还在跑', updatedAt: 1_700_000_000_000, running: true, blank: false } as never],
      hasMore: false,
      at: Date.now(),
    })
    listSessionsMock.mockResolvedValue({
      items: [summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '缓存里还在跑' } } })],
      hasMore: false,
    })
    runningSessionsMock.mockResolvedValue({ sessionIds: [] })
    renderList()
    // 挂载这一帧就不许有绿点。
    expect(screen.queryByText('进行中')).toBeNull()
    await screen.findByText('缓存里还在跑')
    expect(screen.queryByText('进行中')).toBeNull()
  })
  it('never flashes 进行中 while the tail check for a host claim is still in flight', async () => {
    // 真机现象：从会话列表切到设置（列表重挂载 / mux 重连都会触发核对），卡片先亮一下
    // 「进行中」再变「已完成」。宿主的运行集合会残留早就跑完的会话，所以"宿主说在跑"
    // 必须先拿日志尾页核实，核实期间不许点灯。
    twoRows()
    runningSessionsMock.mockResolvedValue({ sessionIds: ['s-1'] })
    let releaseTail: (page: ChatPage) => void = () => {}
    logTailMock.mockImplementation(() => new Promise((resolve) => { releaseTail = resolve }))
    renderList({ mux: new FakeMux() as never })
    await screen.findByText('会话一')
    // 核对还没回来：一个「进行中」都不许出现。
    await waitFor(() => { expect(runningSessionsMock).toHaveBeenCalled() })
    expect(screen.queryByText('进行中')).toBeNull()
    // 尾页说边界还开着：这时才亮。
    releaseTail({ rows: [], maxSeq: 3, hasMore: false, turnStartAt: Date.now() - 1_000 })
    expect(await screen.findAllByText('进行中')).toHaveLength(1)
  })
  it('shows a session the host says is running when no status frame ever arrived', async () => {
    // 手机可能是在会话已经开跑之后才打开列表的：它手里没有那条 turn/start，
    // 只能问宿主。列表以前完全不问，于是"运行中"时有时无。
    twoRows()
    runningSessionsMock.mockResolvedValue({ sessionIds: ['s-1'] })
    // 尾页核实通过：边界开着，而且最新事件就是刚刚写的。
    logTailMock.mockResolvedValue({
      rows: [],
      maxSeq: 3,
      hasMore: false,
      turnStartAt: Date.now() - 5_000,
      lastEventAt: Date.now() - 1_000,
    })
    const mux = new FakeMux()
    renderList({ mux: mux as never })
    await screen.findByText('会话一')
    expect(await screen.findAllByText('进行中')).toHaveLength(1)
  })

  it('keeps the badge while a long command runs silently, and drops it when the boundary closes', async () => {
    // 静默**不是**收工的凭据：一条编译命令跑三分钟、一次大文件读写，这期间日志里
    // 一行事件都没有。此前拿"最新事件已经很久"当收工判据，真机上就这么把正在跑的
    // 会话判成已结束。收工只认日志里的 turn/end。
    twoRows()
    runningSessionsMock.mockResolvedValue({ sessionIds: ['s-1'] })
    logTailMock.mockResolvedValue({
      rows: [],
      maxSeq: 3,
      hasMore: false,
      turnStartAt: 1_700_000_000_000,
      // 边界开着，而且十分钟没有任何事件——命令在跑，只是不出声。
      lastEventAt: 1_700_000_001_000,
    })
    const mux = new FakeMux()
    renderList({ mux: mux as never })
    await screen.findByText('会话一')
    expect(await screen.findAllByText('进行中')).toHaveLength(1)

    // 边界真收口了（尾页最后一条是 turn/end）才撤标。宿主的运行集合带 30 s 缓存，
    // 所以把时钟推过去，让这次核对真的问到宿主的集合。
    logTailMock.mockResolvedValue({ rows: [], maxSeq: 4, hasMore: false })
    const realNow = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 31_000)
    try {
      mux.emit({ type: 'session/subscribed', sessionId: 's-1' })
      await waitFor(() => { expect(screen.queryByText('进行中')).toBeNull() })
    } finally {
      spy.mockRestore()
    }
  })

  it('clears a stale running badge from the host answer once the frame is old', async () => {
    // 断线期间丢掉的 turn/end 不会重放；没有这次校正，列表会一直标着一个
    // 早就结束的会话（真机现象：桌面端没会话在跑，手机还显示运行中）。
    twoRows()
    const mux = new FakeMux()
    renderList({ mux: mux as never })
    await screen.findByText('会话一')
    mux.emit({ type: 'session/status', sessionId: 's-1', running: true })
    expect(screen.getAllByText('进行中')).toHaveLength(1)

    // 30 秒后宿主说它没在跑（缓存也过期了），一次新的连接基线触发核对。
    const realNow = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 31_000)
    try {
      runningSessionsMock.mockResolvedValue({ sessionIds: [] })
      mux.emit({ type: 'session/subscribed', sessionId: 's-1' })
      await waitFor(() => { expect(screen.queryByText('进行中')).toBeNull() })
    } finally {
      spy.mockRestore()
    }
  })
  it('drops a running badge that has been silent past its lifetime', async () => {
    // 宿主的结束帧会丢，宿主的核对要枚举几千个会话（冷启动实测 24 秒，手机上
    // 等不到）。没有自己的心跳，绿点就会挂着不下来——真机上就是这样。
    twoRows()
    const mux = new FakeMux()
    renderList({ mux: mux as never })
    await screen.findByText('会话一')
    mux.emit({ type: 'session/status', sessionId: 's-1', running: true })
    expect(screen.getAllByText('进行中')).toHaveLength(1)

    const realNow = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow + RUNNING_STALE_MS + 1_000)
    try {
      // 任何一次重渲染都会重新算一遍行状态；静默超时后它就不该再亮。
      mux.emit({ type: 'session/activity', sessionId: 's-2', updatedAt: realNow + 5_000 })
      await waitFor(() => { expect(screen.queryByText('进行中')).toBeNull() })
    } finally {
      spy.mockRestore()
    }
  })
  it('re-sorts the roster from a session/activity frame', async () => {
    twoRows()
    const mux = new FakeMux()
    renderList({ mux: mux as never })
    await screen.findByText('会话一')
    expect(renderedTitles()).toEqual(['会话二', '会话一'])

    mux.emit({ type: 'session/activity', sessionId: 's-1', updatedAt: 1_900_000_000_000 })
    expect(renderedTitles()).toEqual(['会话一', '会话二'])
  })

  it('drops a row on session/removed', async () => {
    twoRows()
    const mux = new FakeMux()
    renderList({ mux: mux as never })
    await screen.findByText('会话二')

    mux.emit({ type: 'session/removed', sessionId: 's-sub' })
    expect(screen.queryByText('会话二')).toBeNull()
    expect(screen.getByText('会话一')).toBeTruthy()
  })

  it('inserts a session the desktop just created in this workspace — and only that one', async () => {
    twoRows()
    const mux = new FakeMux()
    renderList({ mux: mux as never })
    await screen.findByText('会话一')

    // Another workspace's session: the roster filter would hide it, so a live
    // insert must not smuggle it in.
    mux.emit({ type: 'session/added', summary: summary('s-other', 1_950_000_000_000, { cwd: '/tmp/foreign' }) })
    expect(screen.queryByText('foreign')).toBeNull()

    mux.emit({
      type: 'session/added',
      summary: summary('s-fresh', 1_900_000_000_000, {
        cwd: '/tmp/demo',
        projections: { values: { title: '刚建的会话' } },
      }),
    })
    expect(await screen.findByText('刚建的会话')).toBeTruthy()
    // Newest activity first, matching the host's own ordering.
    expect(renderedTitles()[0]).toBe('刚建的会话')
  })

  it('marks a failed session and clears the mark when it runs again', async () => {
    twoRows()
    const mux = new FakeMux()
    renderList({ mux: mux as never })
    await screen.findByText('会话一')

    mux.emit({ type: 'session/error', sessionId: 's-1', message: 'agent failed' })
    expect(screen.getByText('出错').getAttribute('title')).toBe('agent failed')

    mux.emit({ type: 'session/status', sessionId: 's-1', running: true })
    expect(screen.queryByText('出错')).toBeNull()
  })

  it('applies a frame that lands while the first page is still loading', async () => {
    let release: ((page: unknown) => void) | undefined
    listSessionsMock.mockReturnValue(new Promise((resolve) => { release = resolve }) as never)
    const mux = new FakeMux()
    renderList({ mux: mux as never })

    // The status frame beats the page: it must survive the page landing.
    mux.emit({ type: 'session/status', sessionId: 's-1', running: true })
    release?.({
      items: [summary('s-1', 1_700_000_000_000, { cwd: '/tmp/demo', projections: { values: { title: '会话一' } } })],
      hasMore: false,
    })

    expect(await screen.findByText('会话一')).toBeTruthy()
    expect(screen.getAllByText('进行中')).toHaveLength(1)
  })

  it('ignores frames that are not list state', async () => {
    twoRows()
    const mux = new FakeMux()
    renderList({ mux: mux as never })
    await screen.findByText('会话一')
    const before = renderedTitles()

    mux.emit({ type: 'session/event', sessionId: 's-1', event: { type: 'turn/start', seq: 1 } })
    mux.emit({ type: 'session/projection', sessionId: 's-1', key: 'title', value: '投影标题', seq: 2 })
    expect(renderedTitles()).toEqual(before)
  })
})

  it('keeps the real first-load error instead of overwriting it with the watchdog', async () => {
    // 看门狗只负责把「永久锁死」降级成可重试：失败分支不拆它，12 秒后它照样开火，
    // 用「加载超时」把真正的错误（没配对、隧道断了）盖掉，用户照着错误提示排查，
    // 方向从一开始就是错的。所以这里必须真的把假时钟推过窗口 —— 只等 20 毫秒等于没测。
    listSessionsMock.mockRejectedValue(new Error('unauthorized: 设备未配对'))
    vi.useFakeTimers()
    try {
      renderList()
      await vi.advanceTimersByTimeAsync(0)
      expect(screen.getByText(/设备未配对/)).toBeTruthy()
      await vi.advanceTimersByTimeAsync(FIRST_PAGE_TIMEOUT_MS + 1_000)
      expect(screen.queryByText(/加载超时/)).toBeNull()
      expect(screen.getByText(/设备未配对/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
