// @vitest-environment jsdom
/**
 * App 壳层（2026-11-08「单一会话页 + 抽屉」）。
 *
 * 这里只测**导航与启动落点**：会话正文页、抽屉内容本身各有自己的测试。
 * 启动规则只有一条 —— 宿主 `session.list` 的最近一个会话（它本来就按最近排序，
 * 壳层不再造排序）；一个都没有就停在同一个 ChatView 的空态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { RpcTransportError } from '../platform/rpc.ts'
import { clearOutlineCache } from '../session/outline-cache.ts'

const api = vi.hoisted(() => ({
  fetchMobilePreferences: vi.fn(),
  history: vi.fn(),
  logTail: vi.fn(),
  readChat: vi.fn(),
  turnOutlineOf: vi.fn(),
  readSettings: vi.fn().mockResolvedValue({}),
}))

const host = vi.hoisted(() => ({
  createSession: vi.fn(),
  listSessions: vi.fn(),
  observeSession: vi.fn(),
  prompt: vi.fn(),
  sendCommand: vi.fn(),
  listWorkspaces: vi.fn(),
  runningSessions: vi.fn(),
}))

const mux = vi.hoisted(() => ({
  resync: vi.fn(), pause: vi.fn(), observe: vi.fn(), start: vi.fn(), stop: vi.fn(),
  refreshRunning: vi.fn(), onFrame: vi.fn(),
}))

vi.mock('../api.ts', () => api)
vi.mock('../data/session.ts', () => host)
vi.mock('../data/workspace.ts', () => ({ listWorkspaces: host.listWorkspaces }))
vi.mock('../data/settings.ts', () => ({
  fetchMobilePreferences: api.fetchMobilePreferences,
  readSettings: api.readSettings,
  mutateSettings: vi.fn(),
  // 抽屉「用量」行的小字会去问当前模型的 provider（views/use-usage-chip.ts）：
  // 这一屏的测试不关心用量，给一个「查不到」的空实现即可（抽屉退回「余额」）。
  models: vi.fn().mockResolvedValue({ current: { provider: 'test', model: 'test' }, routable: true, groups: [], failures: [] }),
}))
vi.mock('../data/usage.ts', () => ({
  fetchUsage: vi.fn().mockResolvedValue({ providers: [], fetchedAt: 0 }),
  // 抽屉打开时会问一次「谁在跑 / 刚跑完哪些」：缺了这两个函数，那次调用会同步抛错，
  // 抽屉就永远停在「正在读取会话…」（本文件 2026-11-16 加任务页用例时才会踩到）。
  fetchFinishedRuns: vi.fn().mockResolvedValue([]),
  clearHostFinishedRuns: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('../data/diag.ts', () => ({
  logTail: vi.fn().mockResolvedValue({ rows: [] }),
  reportError: vi.fn(),
}))
vi.mock('../stream/mux.ts', () => ({
  MuxClient: class {
    start(): void { mux.start() }
    stop(): void { mux.stop() }
    observe(sessionId?: string): void { mux.observe(sessionId) }
    resync(): void { mux.resync() }
    pause(): void { mux.pause() }
    onFrame(listener: (frame: unknown) => void): () => void { mux.onFrame(listener); return () => {} }
    jobsSnapshot(): Array<{ sessionId: string; jobs: never[] }> { return [] }
    liveJobCount(): number { return 0 }
    runningSessionsSnapshot(): string[] { return [] }
    pendingSnapshot(): Array<{ sessionId: string }> { return [] }
    refreshRunning(): Promise<void> { mux.refreshRunning(); return Promise.resolve() }
  },
}))
vi.mock('./ChatView.tsx', () => ({
  ChatView: (props: {
    session: { title: string }
    empty?: boolean
    workspaceName?: string
    onOpenDrawer?(turns: readonly never[]): void
    onOpenSettings?(): void
    onStartSession?(text: string): void
  }) => (
    <div>
      {props.empty === true ? 'empty-chat' : 'chat-ready'}
      <span>{props.session.title}</span>
      <span>{props.workspaceName ?? ''}</span>
      <button type="button" aria-label="open-drawer" onClick={() => { props.onOpenDrawer?.([]) }}>drawer</button>
      <button type="button" aria-label="open-settings" onClick={() => { props.onOpenSettings?.() }}>settings</button>
      <button type="button" aria-label="start-session" onClick={() => { props.onStartSession?.('你好') }}>start</button>
    </div>
  ),
}))
vi.mock('./SettingsView.tsx', () => ({ SettingsView: () => <div>settings-ready</div> }))
/**
 * 「任务」页在这一屏只当导航用：它自己怎么取数、怎么标注工作区各有测试。
 * 这里要的是它交给 App 的那份会话快照（`cwd` 必须带上，App 靠它认领工作区）。
 */
vi.mock('./TasksView.tsx', () => ({
  TasksView: (props: {
    onOpen(session: { sessionId: string; title: string; cwd: string; updatedAt: number; running: boolean; blank: boolean }): void
  }) => (
    <div>
      tasks-ready
      <button
        type="button"
        aria-label="task-foreign"
        onClick={() => { props.onOpen({ sessionId: 's-2', title: '别的工作区的会话', cwd: 'D:/w-2', updatedAt: 5, running: false, blank: false }) }}
      >foreign</button>
      <button
        type="button"
        aria-label="task-orphan"
        onClick={() => { props.onOpen({ sessionId: 's-3', title: '无主目录的会话', cwd: 'D:/nowhere', updatedAt: 6, running: false, blank: false }) }}
      >orphan</button>
    </div>
  ),
}))

import { App, mobilePairStateForError } from './App.tsx'
import { createLazyView } from '../lazy-view.tsx'
import { loadChatPage } from '../data/chat-page.ts'
import { savePersistedList } from '../session/list-persist.ts'

const WORKSPACE = { workspaceId: 'w-1', path: 'D:/w-1', title: 'dsh-palm', sessionIds: ['s-1'], createdAt: '', updatedAt: '' }
const OTHER_WORKSPACE = { workspaceId: 'w-2', path: 'D:/w-2', title: 'other', sessionIds: [], createdAt: '', updatedAt: '' }
const ROW = {
  sessionId: 's-1',
  updatedAt: 9,
  running: false,
  blank: false,
  projections: { values: { title: '最近会话' } },
}

beforeEach(() => {
  host.listWorkspaces.mockReset()
  host.listSessions.mockReset()
  host.createSession.mockReset()
  host.prompt.mockReset()
  host.observeSession.mockReset().mockResolvedValue(undefined)
  host.runningSessions.mockReset().mockResolvedValue({ sessionIds: [] })
  api.fetchMobilePreferences.mockReset().mockResolvedValue({ mobileEnterToSend: true })
  host.listWorkspaces.mockResolvedValue([WORKSPACE, OTHER_WORKSPACE])
  host.listSessions.mockResolvedValue({ items: [ROW], hasMore: false })
  host.createSession.mockResolvedValue({ sessionId: 's-new' })
  host.prompt.mockResolvedValue({ ok: true })
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('mobile paired-device gate', () => {
  it('distinguishes a missing paired cookie from a transport outage', () => {
    expect(mobilePairStateForError(new RpcTransportError('HTTP 403'))).toBe('unpaired')
    expect(mobilePairStateForError(new RpcTransportError('HTTP 503'))).toBe('unavailable')
    expect(mobilePairStateForError(new Error('offline'))).toBe('unavailable')
  })

  it('keeps a valid paired context usable after a failed QR token', async () => {
    render(<App initialPairError="配对链接已被使用。" />)
    await waitFor(() => expect(screen.getByText('chat-ready')).toBeDefined())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the pairing screen only when the mobile gateway rejects the device', async () => {
    api.fetchMobilePreferences.mockRejectedValue(new RpcTransportError('HTTP 403'))
    render(<App initialPairError="配对链接已被使用。" />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('配对链接已被使用。'))
  })

  it('shows a retryable connection failure rather than mounting remote views on outage', async () => {
    api.fetchMobilePreferences.mockRejectedValue(new RpcTransportError('HTTP 503'))
    render(<App />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法连接到运行中的 DSH host。'))
    expect(screen.queryByText('chat-ready')).toBeNull()
  })
})

describe('启动落点（直接进会话正文页）', () => {
  it('取宿主列表的第一个会话，不经过任何列表页', async () => {
    host.listSessions.mockResolvedValue({
      // 子代理 / 未归属的散会话排在前面：启动不能落进抽屉里都找不到的会话。
      items: [
        { sessionId: 's-sub', title: '子代理', updatedAt: 10, running: false, blank: false },
        ROW,
      ],
      hasMore: false,
    })
    render(<App />)
    await waitFor(() => expect(screen.getByText('chat-ready')).toBeDefined())
    expect(screen.getByText('最近会话')).toBeDefined()
    expect(screen.getByText('dsh-palm')).toBeDefined()
    expect(screen.queryByText('sessions-ready')).toBeNull()
    expect(screen.queryByText('workspace-ready')).toBeNull()
  })

  it('一个会话都没有：同一个 ChatView 画空态，不另造页面', async () => {
    host.listSessions.mockResolvedValue({ items: [], hasMore: false })
    render(<App />)
    await waitFor(() => expect(screen.getByText('empty-chat')).toBeDefined())
    expect(screen.getByText('新会话')).toBeDefined()
    // 空态里仍能开抽屉：身份区、新建、搜索、设置都在。
    expect(screen.getByRole('button', { name: 'open-drawer' })).toBeDefined()
  })

  it('启动探针失败也停在空态，并把原因说出来', async () => {
    host.listSessions.mockRejectedValue(new RpcTransportError('HTTP 503'))
    render(<App />)
    await waitFor(() => expect(screen.getByText('empty-chat')).toBeDefined())
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('打开会话失败'))
  })

  it('URL 指名会话且本地有标题时，首帧直接进那个会话', async () => {
    api.logTail.mockResolvedValue({ rows: [], maxSeq: 0, hasMore: false })
    savePersistedList('w-1', {
      rows: [{ sessionId: 's-deep', title: '双端问题面板同步方案', updatedAt: 0, running: false, blank: false }],
      hasMore: false,
    })
    window.history.replaceState(null, '', '/?workspace=w-1&session=s-deep')
    render(<App />)
    await waitFor(() => expect(screen.getByText('chat-ready')).toBeDefined())
    expect(screen.getByText('双端问题面板同步方案')).toBeDefined()
    expect(screen.queryByText('empty-chat')).toBeNull()
    window.localStorage.removeItem('dsh-palm.list.v1.w-1')
  })

  it('进入会话后 URL 带上 workspace 与 session（刷新能回到原会话）', async () => {
    window.history.replaceState(null, '', '/?debug=1')
    render(<App />)
    await waitFor(() => expect(screen.getByText('chat-ready')).toBeDefined())
    await waitFor(() => {
      const params = new URLSearchParams(window.location.search)
      expect(params.get('workspace')).toBe('w-1')
      expect(params.get('session')).toBe('s-1')
    })
    // 与位置无关的参数不能被顺手清掉（调试/性能开关是用户自己开的）。
    expect(new URLSearchParams(window.location.search).get('debug')).toBe('1')
  })
})

describe('抽屉是唯一导航', () => {
  // 2026-11-11 用户要求删掉「产物与文档」入口（右上角「⋯ → 这一轮的产物」是同一个入口），
  // 抽屉底部只剩「设置 / 用量」两行；用例名跟着改，免得下次又在三入口上打转。
  it('抽屉里有身份区、新建、搜索、设置 / 用量两入口', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('chat-ready')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'open-drawer' }))
    expect(screen.getByRole('button', { name: /新建会话/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /搜索会话和消息/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /设置/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /用量/ })).toBeDefined()
    expect(screen.queryByRole('button', { name: /产物与文档/ })).toBeNull()
    expect(screen.getAllByText('dsh-palm').length).toBeGreaterThan(0)
  })

  it('抽屉里点设置：设置页叠在会话上', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('chat-ready')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'open-drawer' }))
    fireEvent.click(screen.getByRole('button', { name: /设置/ }))
    await waitFor(() => expect(screen.getByText('settings-ready')).toBeDefined())
  })

  it('新建会话：先建会话，再切到它的正文页', async () => {
    host.listSessions.mockResolvedValue({ items: [ROW], hasMore: false })
    render(<App />)
    await waitFor(() => expect(screen.getByText('chat-ready')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'open-drawer' }))
    fireEvent.click(screen.getByRole('button', { name: /新建会话/ }))
    await waitFor(() => expect(host.createSession).toHaveBeenCalledTimes(1))
    expect(host.createSession).toHaveBeenCalledWith({ workspaceId: 'w-1' })
    await waitFor(() => expect(screen.getByText('新会话')).toBeDefined())
    // 只建会话，不自动发消息。
    expect(host.prompt).not.toHaveBeenCalled()
  })

  it('空态首屏发送：建会话后把第一句投递给它', async () => {
    host.listSessions.mockResolvedValue({ items: [], hasMore: false })
    render(<App />)
    await waitFor(() => expect(screen.getByText('empty-chat')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'start-session' }))
    await waitFor(() => expect(host.prompt).toHaveBeenCalledWith('s-new', [{ type: 'text', text: '你好' }]))
  })

  it('负断言：没有会话列表页 / 工作区页的路由入口', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('chat-ready')).toBeDefined())
    expect(screen.queryByText('sessions-ready')).toBeNull()
    expect(screen.queryByText('workspace-ready')).toBeNull()
  })
})

describe('「任务」进别的工作区的会话（2026-11-16 真机：会话被算进了当前工作区）', () => {
  /**
   * 打开抽屉 → 点「任务」→ 点某一行。
   *
   * @param label - 任务页里那一行的 aria-label
   */
  async function openTaskRow(label: string): Promise<void> {
    render(<App />)
    await waitFor(() => expect(screen.getByText('chat-ready')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'open-drawer' }))
    fireEvent.click(screen.getByRole('button', { name: /任务/ }))
    fireEvent.click(await screen.findByRole('button', { name: label }))
  }

  it('工作区跟着会话的 cwd 走：进的是 w-2，不是原来那个 w-1', async () => {
    await openTaskRow('task-foreign')
    await waitFor(() => expect(screen.getByText('other')).toBeDefined())
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('workspace')).toBe('w-2')
    })
  })

  it('cwd 不属于任何工作区：留在原地，但侧边栏不把这条会话排进本工作区的行里', async () => {
    await openTaskRow('task-orphan')
    await waitFor(() => expect(screen.getByText('无主目录的会话')).toBeDefined())
    // 工作区没变（认不出来就不硬跳），顶栏仍是原来那个。
    expect(screen.getAllByText('dsh-palm').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'open-drawer' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /新建会话/ })).toBeDefined())
    // 会话正文里那一处标题仍在，抽屉里不该再出现第二处。
    expect(screen.getAllByText('无主目录的会话')).toHaveLength(1)
    // 抽屉照常画本工作区的行（宿主这一页到货后）。
    await waitFor(() => expect(screen.getAllByText('最近会话').length).toBeGreaterThan(0))
    expect(screen.getAllByText('无主目录的会话')).toHaveLength(1)
  })
})

describe('foreground resync', () => {
  const visibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState')

  beforeEach(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  afterEach(() => {
    if (visibilityState !== undefined) {
      Object.defineProperty(document, 'visibilityState', visibilityState)
    } else {
      Reflect.deleteProperty(document, 'visibilityState')
    }
  })

  function setVisibility(state: 'visible' | 'hidden'): void {
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  it('resyncs the stream and re-asserts the observation when the page returns', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('chat-ready')).toBeDefined())
    await waitFor(() => {
      expect(mux.start).toHaveBeenCalledTimes(1)
      expect(host.observeSession).toHaveBeenCalledWith('s-1')
    })
    setVisibility('hidden')
    mux.resync.mockClear()
    mux.pause.mockClear()
    host.observeSession.mockClear()

    setVisibility('visible')

    expect(mux.resync).toHaveBeenCalledTimes(1)
    expect(mux.pause).not.toHaveBeenCalled()
    await waitFor(() => expect(host.observeSession).toHaveBeenCalled())
  })

  it('releases the observation instead of streaming to a hidden screen', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('chat-ready')).toBeDefined())
    await waitFor(() => expect(host.observeSession).toHaveBeenCalledWith('s-1'))
    mux.resync.mockClear()
    mux.pause.mockClear()
    host.observeSession.mockClear()

    setVisibility('hidden')

    expect(mux.resync).not.toHaveBeenCalled()
    expect(mux.pause).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(host.observeSession).toHaveBeenCalledWith(undefined))
  })
})

describe('turn outline on chat open', () => {
  const page = {
    rows: [],
    maxSeq: 10,
    hasMore: false,
    turnStartAt: undefined,
    projections: { asOfSeq: 9, values: { permissions: 'full', contextPressure: 42 } },
  }

  beforeEach(() => {
    api.logTail.mockReset()
    api.readChat.mockReset()
    api.turnOutlineOf.mockReset()
    clearOutlineCache()
  })

  it('fetches the outline separately when the tail page carries projections without it', async () => {
    api.logTail.mockResolvedValue(page)
    api.turnOutlineOf.mockResolvedValue({ turns: [{ turn: 1, seq: 1, prompt: 'a', response: 'b' }] })
    const authority: Array<{ projections?: { values?: Record<string, unknown> } }> = []
    await loadChatPage('s-1', undefined, undefined, ['models'], (p) => { authority.push(p as never) })
    await waitFor(() => { expect(authority.length).toBe(1) })
    expect(authority[0]?.projections?.values?.['turnOutline']).toEqual([{ turn: 1, seq: 1, prompt: 'a', response: 'b' }])
    // 尾页已经有投影了，绝不能再触发那次昂贵的权威页读取。
    expect(api.readChat).not.toHaveBeenCalled()
  })
})

describe('lazy view warm-up (no blank frame on route change)', () => {
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((res) => { resolve = res })
    return { promise, resolve }
  }

  it('resolves the chunk without rendering, so the page can open on the next frame', async () => {
    const gate = deferred<{ default: () => ReactElement }>()
    const loader = vi.fn(() => gate.promise)
    const { View, warm } = createLazyView(loader)
    const warmed = warm()
    expect(loader).toHaveBeenCalledTimes(1)
    gate.resolve({ default: () => <div>真实页面</div> })
    await warmed
    render(<View />)
    expect(screen.getByText('真实页面')).toBeTruthy()
    expect(document.querySelector('.page-loading')).toBeNull()
  })

  it('never renders a blank stage when a lazy view is opened cold', async () => {
    const gate = deferred<{ default: () => ReactElement }>()
    const { View } = createLazyView(() => gate.promise)
    render(<View />)
    expect(document.querySelector('.page-loading')).not.toBeNull()
    gate.resolve({ default: () => <div>真实页面</div> })
    await waitFor(() => { expect(screen.getByText('真实页面')).toBeTruthy() })
  })
})
