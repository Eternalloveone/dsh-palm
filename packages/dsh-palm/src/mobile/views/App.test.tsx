// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { RpcTransportError } from '../rpc.ts'
import { clearOutlineCache } from '../outline-cache.ts'

const api = vi.hoisted(() => ({
  fetchMobilePreferences: vi.fn(),
  history: vi.fn(),
  listSessions: vi.fn(),
  listWorkspaces: vi.fn(),
  logTail: vi.fn(),
  observeSession: vi.fn().mockResolvedValue(undefined),
  prompt: vi.fn(),
  readChat: vi.fn(),
  readSettings: vi.fn().mockResolvedValue({}),
  runningSessions: vi.fn().mockResolvedValue({ sessionIds: [] }),
  turnOutlineOf: vi.fn().mockResolvedValue({ turns: null }),
  setThemePreference: vi.fn(),
}))

const mux = vi.hoisted(() => ({ resync: vi.fn(), pause: vi.fn(), observe: vi.fn(), start: vi.fn(), stop: vi.fn(), refreshRunning: vi.fn(), onFrame: vi.fn() }))

vi.mock('../api.ts', () => api)
vi.mock('../mux.ts', () => ({
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
    refreshRunning(): Promise<void> { mux.refreshRunning(); return Promise.resolve() }
  },
}))
vi.mock('./WorkspaceView.tsx', () => ({ WorkspaceView: () => <div>workspace-ready</div> }))
vi.mock('./SessionListView.tsx', () => ({ SessionListView: () => <div>sessions-ready</div> }))
vi.mock('./ChatView.tsx', () => ({ ChatView: () => <div>chat-ready</div> }))
vi.mock('./SettingsView.tsx', () => ({ SettingsView: () => <div>settings-ready</div> }))

import { App, backTargetOf, createLazyView, loadChatPage, mobilePairStateForError } from './App.tsx'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('mobile paired-device gate', () => {
  it('distinguishes a missing paired cookie from a transport outage', () => {
    expect(mobilePairStateForError(new RpcTransportError('HTTP 403'))).toBe('unpaired')
    expect(mobilePairStateForError(new RpcTransportError('HTTP 503'))).toBe('unavailable')
    expect(mobilePairStateForError(new Error('offline'))).toBe('unavailable')
  })

  it('keeps a valid paired context usable after a failed QR token', async () => {
    api.fetchMobilePreferences.mockResolvedValue({ mobileEnterToSend: true })
    render(<App initialPairError="配对链接已被使用。" />)

    await waitFor(() => expect(screen.getByText('workspace-ready')).toBeDefined())
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
    expect(screen.queryByText('workspace-ready')).toBeNull()
  })
})

describe('「返回」的落点（漏一个页面就是死按钮）', () => {
  const workspaceRow = { workspaceId: 'w-1', path: 'D:/w', title: 'w', sessionIds: [], createdAt: '', updatedAt: '' }
  const standaloneRow = { ...workspaceRow, workspaceId: 'standalone' }
  const sessionRow = { sessionId: 's-1', title: 't', updatedAt: 0, running: false, blank: false }
  /** 路由对象的测试替身：只关心 kind 与两个分支标志。 */
  const route = (value: Record<string, unknown>): never => value as never

  it('子代理只读页返回运行中页（真机：进去出不来）', () => {
    expect(backTargetOf(route({ kind: 'sub-chat', sessionId: 'c-1' }))).toEqual({ kind: 'run-overview' })
  })

  it('运行中页返回首页', () => {
    expect(backTargetOf(route({ kind: 'run-overview' }))).toEqual({ kind: 'workspaces' })
  })

  it('会话页的三个分支：搜索定位 / 从运行中进入 / 独立会话 / 普通进入', () => {
    expect(backTargetOf(route({ kind: 'chat', session: sessionRow, workspace: workspaceRow }), { fromLocate: true }))
      .toEqual({ kind: 'workspaces' })
    expect(backTargetOf(route({ kind: 'chat', session: sessionRow, workspace: workspaceRow, fromRunOverview: true })))
      .toEqual({ kind: 'run-overview' })
    expect(backTargetOf(route({ kind: 'chat', session: sessionRow, workspace: standaloneRow })))
      .toEqual({ kind: 'workspaces' })
    expect(backTargetOf(route({ kind: 'chat', session: sessionRow, workspace: workspaceRow })))
      .toEqual({ kind: 'sessions', workspace: workspaceRow })
  })

  it('会话列表 / 设置 / 首页都有落点，首页原地不动', () => {
    expect(backTargetOf(route({ kind: 'sessions', workspace: workspaceRow }))).toEqual({ kind: 'workspaces' })
    expect(backTargetOf(route({ kind: 'settings', workspace: workspaceRow }))).toEqual({ kind: 'sessions', workspace: workspaceRow })
    expect(backTargetOf(route({ kind: 'workspaces' }))).toEqual({ kind: 'workspaces' })
  })
})

describe('收工浮层（跑完立刻知道是哪一个）', () => {
  /** turn/end 帧：宿主把结束原因写在 data.reason.kind 上。 */
  const turnEnd = (sessionId: string, kind: string, time: number): unknown => ({
    type: 'session/event',
    sessionId,
    event: { type: 'turn/end', seq: 42, time, data: { turn: 1, reason: { kind } } },
  })

  const tailPage = {
    rows: [{
      id: 'a-1',
      kind: 'assistant',
      text: '已经把三处原因改掉了\n细节不用看',
      pending: false,
      turnStartAt: 1_700_000_000_000,
      time: 1_700_000_519_000,
      durationMs: 519_000,
    }],
    maxSeq: 42,
    hasMore: true,
    projections: { asOfSeq: 42, values: { title: '互容CDMA数据仅显示一行' } },
  }

  it('pops a capsule with the title and duration when another session finishes', async () => {
    api.fetchMobilePreferences.mockResolvedValue({ mobileEnterToSend: true })
    api.logTail.mockResolvedValueOnce(tailPage)
    render(<App initialPairError="配对链接已被使用。" />)
    await waitFor(() => expect(screen.getByText('workspace-ready')).toBeDefined())

    const listener = mux.onFrame.mock.calls[0]?.[0] as (frame: unknown) => void
    expect(listener).toBeTypeOf('function')
    await act(async () => {
      listener(turnEnd('session-done', 'completed', 1_700_000_519_000))
      await Promise.resolve()
    })

    await waitFor(() => expect(document.body.textContent).toContain('互容CDMA数据仅显示一行'))
    expect(document.body.textContent).toContain('已完成')
    expect(document.body.textContent).toContain('8分39秒')
    // 同时记进"刚结束"账本：切到运行中页还在。
    const { finishedRuns } = await import('../recent-finished.ts')
    const entries = finishedRuns(1_700_000_519_000)
    expect(entries[0]?.sessionId).toBe('session-done')
    expect(entries[0]?.summary).toBe('已经把三处原因改掉了')
  })

  it('marks a failed turn and only records each turn/end once', async () => {
    api.fetchMobilePreferences.mockResolvedValue({ mobileEnterToSend: true })
    api.logTail.mockResolvedValueOnce(tailPage)
    render(<App initialPairError="配对链接已被使用。" />)
    await waitFor(() => expect(screen.getByText('workspace-ready')).toBeDefined())
    const listener = mux.onFrame.mock.calls[0]?.[0] as (frame: unknown) => void

    await act(async () => {
      listener(turnEnd('session-bad', 'error', 1_700_000_600_000))
      listener(turnEnd('session-bad', 'error', 1_700_000_600_500))
      await Promise.resolve()
    })

    await waitFor(() => expect(document.body.textContent).toContain('出错退出'))
    const { finishedRuns } = await import('../recent-finished.ts')
    expect(finishedRuns(1_700_000_600_500)).toHaveLength(1)
  })
})

describe('loadChatPage (v3 folded reads + fallback)', () => {
  const wireEntry = (type: string, data: unknown, seq: number): { event: { type: string; seq: number; time: number; data: unknown } } =>
    ({ event: { type, seq, time: seq * 1_000, data } })

  it('serves the folded page straight from readChat (no history call)', async () => {
    const page = {
      rows: [{ id: 'u-1', kind: 'user', text: '你好', seq: 0, time: 0 }],
      maxSeq: 7,
      hasMore: true,
      todo: { seq: 7, items: [{ content: '任务', status: 'pending' as const }] },
      projections: { asOfSeq: 7, values: {} },
    }
    api.readChat.mockResolvedValue(page)
    const { loadChatPage } = await import('./App.tsx')
    const result = await loadChatPage('s-1', undefined, new AbortController().signal)
    expect(result).toEqual(page)
    expect(api.readChat).toHaveBeenCalledWith('s-1', undefined, undefined, expect.any(AbortSignal), undefined)
    expect(api.history).not.toHaveBeenCalled()
  })

  it('passes the include whitelist through and keeps the extras on the result', async () => {
    const page = {
      rows: [],
      maxSeq: 3,
      hasMore: false,
      extras: { models: { current: { provider: 'fx', model: 'fx-1' }, groups: [] } },
    }
    api.readChat.mockResolvedValue(page)
    const { loadChatPage } = await import('./App.tsx')
    const result = await loadChatPage('s-1', undefined, new AbortController().signal, ['models'])
    expect(api.readChat).toHaveBeenCalledWith('s-1', undefined, undefined, expect.any(AbortSignal), ['models'])
    expect(result.extras).toEqual(page.extras)
  })

  it('falls back to session.history + local fold when readChat is unavailable', async () => {
    api.readChat.mockRejectedValue(new RpcTransportError('HTTP 403'))
    api.history.mockResolvedValue({
      events: [
        wireEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改一下' }] }, 0),
        wireEntry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', text: '正在' } }, 1),
        wireEntry('assistant/message', {
          turn: 0,
          step: 0,
          message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '已完成' }] },
        }, 2),
      ],
      hasMore: false,
    })
    const { loadChatPage } = await import('./App.tsx')
    const result = await loadChatPage('s-1')
    // The two paths converge: folded rows + the event watermark.
    expect(result.rows.map(row => row.text)).toEqual(['改一下', '已完成'])
    expect(result.maxSeq).toBe(2)
    expect(result.hasMore).toBe(false)
    expect(api.history).toHaveBeenCalledWith('s-1', undefined, undefined, undefined)
  })

  it('propagates a fallback-path failure (readChat down AND history down)', async () => {
    api.readChat.mockRejectedValue(new RpcTransportError('HTTP 403'))
    api.history.mockRejectedValue(new RpcTransportError('transport failed: network'))
    const { loadChatPage } = await import('./App.tsx')
    await expect(loadChatPage('s-1')).rejects.toThrow('network')
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

  /** Drive one visibility transition with an explicit target state. */
  function setVisibility(state: 'visible' | 'hidden'): void {
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  it('resyncs the stream and re-asserts the observation when the page returns', async () => {
    api.fetchMobilePreferences.mockResolvedValue({ mobileEnterToSend: true })
    render(<App />)
    await waitFor(() => expect(screen.getByText('workspace-ready')).toBeDefined())
    await waitFor(() => {
      expect(mux.start).toHaveBeenCalledTimes(1)
      expect(api.observeSession).toHaveBeenCalledWith(undefined)
    })
    setVisibility('hidden')
    mux.resync.mockClear()
    mux.pause.mockClear()
    api.observeSession.mockClear()

    setVisibility('visible')

    expect(mux.resync).toHaveBeenCalledTimes(1)
    // Coming back rebuilds the transport; it does not release it.
    expect(mux.pause).not.toHaveBeenCalled()
    // The 30 s cadence is bypassed: the host learns the page is back at once.
    await waitFor(() => expect(api.observeSession).toHaveBeenCalled())
  })

  it('releases the observation instead of streaming to a hidden screen', async () => {
    api.fetchMobilePreferences.mockResolvedValue({ mobileEnterToSend: true })
    render(<App />)
    await waitFor(() => expect(screen.getByText('workspace-ready')).toBeDefined())
    await waitFor(() => {
      expect(mux.start).toHaveBeenCalledTimes(1)
      expect(api.observeSession).toHaveBeenCalledWith(undefined)
    })
    mux.resync.mockClear()
    mux.pause.mockClear()
    api.observeSession.mockClear()

    setVisibility('hidden')

    expect(mux.resync).not.toHaveBeenCalled()
    // The transport goes with the screen: no idle socket in the background.
    expect(mux.pause).toHaveBeenCalledTimes(1)
    // Handing the session back (undefined) is what makes the host release its
    // per-session assistant-stream follow; the armed 30 s cadence is dropped
    // with it, so a frozen page issues no further asserts.
    await waitFor(() => expect(api.observeSession).toHaveBeenCalledWith(undefined))
  })
})

describe('mobile chat tail read (C)', () => {
  it('paints the tail from the folded log page without touching the host read', async () => {
    // C 的宿主侧已经把尾部日志折叠成与 readChat 同形的页，手机直接用它。
    api.logTail.mockResolvedValue({
      rows: [
        { kind: 'user', id: 'u-1', text: '第一条' },
        { kind: 'user', id: 'u-2', text: '第二条' },
      ],
      maxSeq: 2,
      hasMore: true,
    })
    api.readChat.mockImplementation(() => new Promise(() => undefined))

    const page = await loadChatPage('s-tail')

    expect(page.maxSeq).toBe(2)
    expect(page.hasMore).toBe(true)
    expect(page.rows.length).toBe(2)
    // 首屏绝不等宿主的整文件解压：它被推迟到 HOST_REFRESH_DELAY_MS 之后。
    expect(api.readChat).not.toHaveBeenCalled()
  })

  it('falls back to the host page when the log tail is unavailable', async () => {
    api.logTail.mockRejectedValue(new Error('no log'))
    api.readChat.mockResolvedValue({ rows: [], maxSeq: 9, hasMore: false })

    const page = await loadChatPage('s-host')

    expect(page.maxSeq).toBe(9)
    expect(page.hasMore).toBe(false)
  })
})

describe('turn outline on chat open', () => {
  // 尾页为了省 87 KB 不带轮次大纲，而权威页只在尾页"完全没有投影"时才补；尾页一旦
  // 带了权限/上下文投影，大纲就永远到不了手机，轮次清单只剩已加载的两三抡。
  const page = {
    rows: [],
    maxSeq: 10,
    hasMore: false,
    turnStartAt: undefined,
    projections: { asOfSeq: 9, values: { permissions: "full", contextPressure: 42 } },
  }

  beforeEach(() => {
    api.logTail.mockReset()
    api.readChat.mockReset()
    api.turnOutlineOf.mockReset()
    // 大纲是五分钟的进程内缓存：用例之间必须清掉，否则后一条会吃到前一条的副本。
    clearOutlineCache()
  })

  it('reuses the cached outline instead of downloading it again', async () => {
    // 列表↔会话来回切是手机端最频繁的动作，同一份几十 KB 的大纲不该每次都重新拉。
    api.logTail.mockResolvedValue(page)
    api.turnOutlineOf.mockResolvedValue({ turns: [{ turn: 1, seq: 1, prompt: 'a', response: 'b' }] })
    const first: Array<{ projections?: { values?: Record<string, unknown> } }> = []
    await loadChatPage('s-1', undefined, undefined, ['models'], (p) => { first.push(p as never) })
    await waitFor(() => { expect(first.length).toBe(1) })

    const second: Array<{ projections?: { values?: Record<string, unknown> } }> = []
    await loadChatPage('s-1', undefined, undefined, ['models'], (p) => { second.push(p as never) })
    expect(api.turnOutlineOf).toHaveBeenCalledTimes(1)
    // 缓存命中也必须把大纲交回界面，否则第二次打开清单又只剩已加载的轮次。
    expect(second[0]?.projections?.values?.['turnOutline']).toEqual([{ turn: 1, seq: 1, prompt: 'a', response: 'b' }])
  })

  it('fetches the outline separately when the tail page carries projections without it', async () => {
    api.logTail.mockResolvedValue(page)
    api.turnOutlineOf.mockResolvedValue({ turns: [{ turn: 1, seq: 1, prompt: 'a', response: 'b' }, { turn: 2, seq: 2, prompt: 'c', response: 'd' }] })
    const authority: Array<{ projections?: { values?: Record<string, unknown> } }> = []
    await loadChatPage('s-1', undefined, undefined, ['models'], (p) => { authority.push(p as never) })
    await waitFor(() => { expect(authority.length).toBe(1) })
    expect(authority[0]?.projections?.values?.['turnOutline']).toEqual([
      { turn: 1, seq: 1, prompt: 'a', response: 'b' },
      { turn: 2, seq: 2, prompt: 'c', response: 'd' },
    ])
    // 尾页已经有投影了，绝不能再触发那次昂贵的权威页读取。
    expect(api.readChat).not.toHaveBeenCalled()
  })

  it('does not ask again when the tail page already carried the outline', async () => {
    api.logTail.mockResolvedValue({ ...page, projections: { asOfSeq: 9, values: { turnOutline: [{ turn: 1, seq: 1, prompt: 'a', response: 'b' }] } } })
    const authority: unknown[] = []
    await loadChatPage('s-1', undefined, undefined, ['models'], (p) => { authority.push(p) })
    expect(api.turnOutlineOf).not.toHaveBeenCalled()
    expect(authority).toHaveLength(0)
  })
})

describe('lazy view warm-up (no blank frame on route change)', () => {
  /** 一块假的懒视图：loader 由测试控制什么时候 resolve。 */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
  }

  it('resolves the chunk without rendering, so the page can open on the next frame', async () => {
    const gate = deferred<{ default: () => ReactElement }>()
    const loader = vi.fn(() => gate.promise)
    const { View, warm } = createLazyView(loader)
    const warmed = warm()
    expect(loader).toHaveBeenCalledTimes(1)
    gate.resolve({ default: () => <div>真实页面</div> })
    await warmed
    // warm 之后第一次渲染就是内容，不再经过骨架，更没有空白帧。
    render(<View />)
    expect(screen.getByText('真实页面')).toBeTruthy()
    expect(document.querySelector('.page-loading')).toBeNull()
  })

  it('never renders a blank stage when a lazy view is opened cold', async () => {
    const gate = deferred<{ default: () => ReactElement }>()
    const { View } = createLazyView(() => gate.promise)
    render(<View />)
    // 冷启动也要有骨架（页头 + 灰条），不是一块空背景。
    expect(document.querySelector('.page-loading')).not.toBeNull()
    expect(document.querySelectorAll('.page-loading-rows span').length).toBeGreaterThan(0)
    gate.resolve({ default: () => <div>真实页面</div> })
    await waitFor(() => { expect(screen.getByText('真实页面')).toBeTruthy() })
  })

  it('offers a retry instead of spinning forever when the chunk fails', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('chunk down'))
      .mockResolvedValue({ default: () => <div>第二次成功</div> })
    const { View } = createLazyView(loader)
    render(<View />)
    const retry = await screen.findByText('加载失败，点一下重试')
    retry.click()
    await waitFor(() => { expect(screen.getByText('第二次成功')).toBeTruthy() })
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
