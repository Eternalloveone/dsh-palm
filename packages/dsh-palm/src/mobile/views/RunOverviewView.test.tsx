// @vitest-environment jsdom
/**
 * RunOverviewView：跨会话的运行卡片 + 刚结束清单。
 *
 * 这一版的重点（相对旧的 jobs-only 版）：
 *  - 卡片第二三行来自尾页（动作/步数/已跑/最近活动），不是 hero 计数；
 *  - 子代理单独成行、点得开（打开它自己的只读会话）；
 *  - 跑完的会话不消失，落到「刚结束」，带用时/状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RunOverviewView, SUBAGENT_SESSION_MAX, type RunOverviewMux } from './RunOverviewView.tsx'
import type { MuxFrame } from '../../api-proxy-types'
import { clearFinishedRuns, recordFinishedRun } from '../recent-finished.ts'

const api = vi.hoisted(() => ({
  listSessions: vi.fn(),
  subagentsList: vi.fn(),
  logTail: vi.fn(),
  // 宿主账本：默认「老宿主」，没有这个方法（Promise 直接 reject）——
  // 页面必须照常工作，只有显式 stub 的用例才走同步路径。
  fetchFinishedRuns: vi.fn(() => Promise.reject(new Error('unavailable'))),
  appendFinishedRun: vi.fn(() => Promise.resolve()),
}))

vi.mock('../api.ts', () => api)

type Listener = (frame: MuxFrame) => void
type Row = { sessionId: string; jobs: unknown[] }

/** A minimal MuxClient stand-in exposing the snapshot surface the page uses. */
function muxStub(initial: Row[] = [], runningSeed: string[] = []) {
  const rows: Row[] = [...initial]
  const runningIds: string[] = [...runningSeed]
  const listeners = new Set<Listener>()
  return {
    jobsSnapshot: () => [...rows],
    runningSessionsSnapshot: () => [...runningIds],
    onFrame(listener: Listener): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    pushJobs(next: Row[]): void {
      rows.length = 0
      rows.push(...next)
      for (const listener of listeners) {
        listener({ type: 'session/jobs', sessionId: 'x', jobs: [] } as never)
      }
    },
    push(frame: MuxFrame): void {
      for (const listener of listeners) listener(frame)
    },
  } as unknown as RunOverviewMux & {
    pushJobs(next: Row[]): void
    push(frame: MuxFrame): void
  }
}

const job = (over: { id: string; label?: string; status?: string; finishedAt?: number }): unknown => ({
  id: over.id,
  kind: 'shell',
  label: over.label ?? '后台任务',
  status: over.status ?? 'running',
  startedAt: 1_700_000_000_000,
  ...(over.finishedAt !== undefined ? { finishedAt: over.finishedAt } : {}),
})

/** A session.list row for the fetchRoster mock. */
function sessionRow(sessionId: string, running: boolean, cwd?: string): Record<string, unknown> {
  return {
    sessionId,
    updatedAt: 1_700_000_000_000,
    running,
    blank: false,
    ...(cwd === undefined ? {} : { cwd }),
    projections: {},
  }
}

/** One subagents.list child entry (host already filled activity + timing). */
function child(
  id: string,
  label: string,
  over: { activity?: 'running' | 'inactive'; turnStartAt?: number; lastEventAt?: number } = {},
): Record<string, unknown> {
  return {
    kind: 'child',
    id,
    activity: over.activity ?? 'running',
    hasChildren: false,
    mode: 'one-shot',
    label,
    ...(over.turnStartAt === undefined ? {} : { turnStartAt: over.turnStartAt }),
    ...(over.lastEventAt === undefined ? {} : { lastEventAt: over.lastEventAt }),
  }
}

function catalog(entries: Array<Record<string, unknown>>): Record<string, unknown> {
  return { entries, parentAvailable: true }
}

const T0 = 1_700_000_000_000

/** A tail page as `mobile.logTail` returns it (one assistant row mid-turn). */
function tailPage(over: {
  turnStartAt?: number
  lastEventAt?: number
  turnOpen?: boolean
  toolName?: string
  toolArgs?: string
  toolState?: string
  text?: string
  step?: number
  pending?: boolean
  durationMs?: number
} = {}): Record<string, unknown> {
  const turnStartAt = over.turnStartAt ?? T0
  return {
    rows: [{
      id: 'r1',
      kind: 'assistant',
      text: over.text ?? '',
      step: over.step ?? 3,
      time: turnStartAt + 60_000,
      turnStartAt,
      pending: over.pending ?? true,
      ...(over.durationMs === undefined ? {} : { durationMs: over.durationMs }),
      tools: [{
        callId: 'c1',
        name: over.toolName ?? 'bash',
        arguments: over.toolArgs ?? '{"command":"pnpm test"}',
        state: over.toolState ?? 'running',
      }],
    }],
    maxSeq: 10,
    hasMore: true,
    turnStartAt,
    ...(over.turnOpen === undefined ? {} : { turnOpen: over.turnOpen }),
    ...(over.lastEventAt === undefined ? {} : { lastEventAt: over.lastEventAt }),
  }
}

const emptyPage = { items: [], nextCursor: undefined, hasMore: false }

beforeEach(() => {
  clearFinishedRuns()
  api.subagentsList.mockResolvedValue(catalog([]))
  api.logTail.mockResolvedValue(tailPage())
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** 页面全部文本：这一版结构改动多，用文本包含比逐个 query 稳。 */
const text = (): string => document.body.textContent ?? ''

describe('RunOverviewView', () => {
  it('renders the empty state when nothing runs and nothing finished', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue(emptyPage)
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('当前没有运行中的会话或任务')).toBeTruthy())
  })

  it('shows a running session with its action, step and elapsed time', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true, 'D:\\work\\dsh-palm')], nextCursor: undefined, hasMore: false })
    api.logTail.mockResolvedValue(tailPage({
      turnStartAt: Date.now() - 724_000,
      lastEventAt: Date.now() - 3_000,
      step: 7,
    }))
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('pnpm test')).toBeTruthy())
    // 动作标题、步数、已跑时长、工作区、最近活动都在这张卡上。
    expect(text()).toContain('运行命令')
    expect(text()).toContain('第 7 步')
    expect(text()).toMatch(/已跑 1[12]分\d+秒/)
    expect(text()).toContain('dsh-palm')
    expect(text()).toContain('有活动')
    // 尾页读取用的是在跑的那个会话。
    expect(api.logTail).toHaveBeenCalledWith('s-live', 25)
  })

  it('does not claim "回合运行中" once the tail page answers', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(api.logTail).toHaveBeenCalled())
    await waitFor(() => expect(text()).not.toContain('回合运行中'))
  })

  it('counts sessions and background jobs in the group header', async () => {
    const mux = muxStub([{ sessionId: 's-live', jobs: [job({ id: 'j1', label: '跑真机回归' })] }])
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(text()).toContain('1 个会话'))
    expect(text()).toContain('1 个后台任务')
  })

  it('folds live background jobs behind one line and expands on tap', async () => {
    const mux = muxStub([{ sessionId: 's-live', jobs: [job({ id: 'j1', label: '跑真机回归' })] }])
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    const fold = await screen.findByRole('button', { name: /另有 1 个后台任务/ })
    expect(screen.queryByText('跑真机回归')).toBeNull()
    fireEvent.click(fold)
    expect(screen.getByText('跑真机回归')).toBeTruthy()
  })

  it('explains that nothing runs instead of listing settled-only sessions', async () => {
    const mux = muxStub([
      { sessionId: 's-settled', jobs: [job({ id: 'j2', status: 'completed', finishedAt: T0 + 100_000, label: '收尾' })] },
    ])
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-settled', false)], nextCursor: undefined, hasMore: false })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(text()).toContain('当前没有会话在运行'))
    expect(screen.queryByText('收尾')).toBeNull()
  })

  it('adds a session to the running group when a live turn/start frame lands', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue(emptyPage)
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('当前没有运行中的会话或任务')).toBeTruthy())
    mux.push({ type: 'session/event', sessionId: 's-fresh', event: { type: 'turn/start', seq: 5 } } as never)
    await waitFor(() => expect(text()).toContain('s-fresh'))
  })

  it('seeds sessions already running before the page opened from the mux snapshot', async () => {
    const mux = muxStub([], ['s-early'])
    api.listSessions.mockResolvedValue(emptyPage)
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('会话 s-early')).toBeTruthy())
  })

  it('opens the session chat on card tap with a best-effort title', async () => {
    const mux = muxStub([{ sessionId: 's-live', jobs: [job({ id: 'j1' })] }])
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    const onOpen = vi.fn()
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={onOpen} />)
    const card = await screen.findByRole('button', { name: /s-live/ })
    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledWith({ sessionId: 's-live', title: '会话 s-live' })
  })

  it('titles a session by its directory name, not the whole windows path', async () => {
    const mux = muxStub([{ sessionId: 's-win', jobs: [job({ id: 'j1' })] }])
    api.listSessions.mockResolvedValue({
      items: [sessionRow('s-win', true, 'D:\\dev\\app')],
      nextCursor: undefined,
      hasMore: false,
    })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(text()).toContain('app'))
    expect(text()).not.toContain('D:\\dev\\app')
  })

  it('adopts a title the host projects after the page opened', async () => {
    const mux = muxStub([], ['s-late'])
    api.listSessions.mockResolvedValue(emptyPage)
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('会话 s-late')).toBeTruthy())
    mux.push({
      type: 'session/projection',
      sessionId: 's-late',
      key: 'title',
      value: '修手机端标题',
      seq: 9,
    } as never)
    await waitFor(() => expect(screen.getByText('修手机端标题')).toBeTruthy())
  })

  it('renders the running card from the first roster page instead of waiting for the rest', async () => {
    const mux = muxStub()
    api.listSessions.mockImplementation((cursor?: string) => {
      if (cursor === undefined) {
        return Promise.resolve({ items: [sessionRow('s-first', true)], nextCursor: 'p2', hasMore: true })
      }
      return new Promise(() => {})
    })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(text()).toContain('s-first'))
    expect(text()).toContain('1 个会话')
  })

  it('calls onBack from the header back button', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue(emptyPage)
    const onBack = vi.fn()
    render(<RunOverviewView mux={mux} onBack={onBack} onOpenSession={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('RunOverviewView 刚结束', () => {
  it('keeps a finished session visible with status and duration', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue(emptyPage)
    recordFinishedRun({
      sessionId: 'session-done',
      title: '互容CDMA数据仅显示一行',
      finishedAt: Date.now() - 120_000,
      durationMs: 519_000,
      status: 'done',
      summary: '已经把三处原因改掉了',
    })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('互容CDMA数据仅显示一行')).toBeTruthy())
    expect(text()).toContain('已完成')
    expect(text()).toContain('8分39秒')
    expect(text()).toContain('2 分钟前')
    // 没有会话在跑时也要有解释，而不是一片空白。
    expect(text()).toContain('当前没有会话在运行')
  })

  it('marks a failed run and opens it on tap', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue(emptyPage)
    recordFinishedRun({
      sessionId: 'session-bad',
      title: '手机端过程条计时排查',
      finishedAt: Date.now() - 300_000,
      durationMs: 130_000,
      status: 'error',
    })
    const onOpen = vi.fn()
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={onOpen} />)
    await waitFor(() => expect(text()).toContain('出错退出'))
    fireEvent.click(screen.getByText('手机端过程条计时排查'))
    expect(onOpen).toHaveBeenCalledWith({ sessionId: 'session-bad', title: '手机端过程条计时排查' })
  })

  it('clears the list from 全部清空', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue(emptyPage)
    recordFinishedRun({
      sessionId: 'session-done',
      title: '跑完的会话',
      finishedAt: Date.now() - 60_000,
      status: 'done',
    })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('跑完的会话')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '全部清空' }))
    await waitFor(() => expect(screen.queryByText('跑完的会话')).toBeNull())
  })

  it('hides a finished entry once that session runs again', async () => {
    const mux = muxStub([], ['session-done'])
    api.listSessions.mockResolvedValue(emptyPage)
    recordFinishedRun({
      sessionId: 'session-done',
      title: '又开始跑了',
      finishedAt: Date.now() - 60_000,
      status: 'done',
    })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('会话 done')).toBeTruthy())
    expect(screen.queryByText('又开始跑了')).toBeNull()
  })
})

describe('RunOverviewView 子代理', () => {
  it('lists children under the card and folds beyond three', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    api.subagentsList.mockResolvedValue(catalog([
      child('c1', '整理记忆'),
      child('c2', '跑真机回归'),
      child('c3', '写报告'),
      child('c4', '查日志'),
      child('c5', '收尾'),
    ]))
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} onOpenSubagent={() => {}} />)
    await waitFor(() => expect(screen.getByText('整理记忆')).toBeTruthy())
    expect(text()).toContain('5 个子代理')
    expect(screen.queryByText('查日志')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /还有 2 个子代理/ }))
    expect(screen.getByText('查日志')).toBeTruthy()
    expect(screen.getByText('收尾')).toBeTruthy()
  })

  it('opens a child transcript with its label and parent title', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue({
      items: [{ ...sessionRow('s-live', true), projections: { values: { title: '梳理测试函数逻辑' } } }],
      nextCursor: undefined,
      hasMore: false,
    })
    api.subagentsList.mockResolvedValue(catalog([child('c1', '整理记忆', { turnStartAt: Date.now() - 130_000 })]))
    const onOpenSub = vi.fn()
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} onOpenSubagent={onOpenSub} />)
    const row = await screen.findByRole('button', { name: /整理记忆/ })
    fireEvent.click(row)
    expect(onOpenSub).toHaveBeenCalledWith({
      sessionId: 'c1',
      label: '整理记忆',
      parentTitle: '梳理测试函数逻辑',
    })
  })

  it('shows how long a running child has been running', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    api.subagentsList.mockResolvedValue(catalog([
      child('c1', '整理记忆', { turnStartAt: Date.now() - 130_000 }),
    ]))
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} onOpenSubagent={() => {}} />)
    await waitFor(() => expect(text()).toContain('2分1'))
  })

  it('drops the subagent job row once the child rows cover it', async () => {
    const mux = muxStub([{ sessionId: 's-live', jobs: [{ ...job({ id: 'j1', label: '整理记忆' }) as object, kind: 'subagent' }] }])
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    api.subagentsList.mockResolvedValue(catalog([child('c1', '整理记忆')]))
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('整理记忆')).toBeTruthy())
    expect(screen.getAllByText('整理记忆')).toHaveLength(1)
    // 子代理那份 job 行被子代理行取代了：不该再出现"另有 N 个后台任务"的折叠行。
    expect(screen.queryByRole('button', { name: /个后台任务/ })).toBeNull()
  })

  it('keeps the job row when the host does not answer', async () => {
    const mux = muxStub([{ sessionId: 's-live', jobs: [job({ id: 'j1', label: '整理记忆' })] }])
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    api.subagentsList.mockRejectedValue(new Error('boom'))
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    const fold = await screen.findByRole('button', { name: /另有 1 个后台任务/ })
    fireEvent.click(fold)
    expect(screen.getByText('整理记忆')).toBeTruthy()
  })

  it('never asks for subagents of a session that is not running', async () => {
    const mux = muxStub([
      { sessionId: 's-settled', jobs: [job({ id: 'j2', status: 'completed', finishedAt: T0 + 100_000, label: '收尾' })] },
    ])
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-settled', false)], nextCursor: undefined, hasMore: false })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(text()).toContain('当前没有会话在运行'))
    expect(api.subagentsList).not.toHaveBeenCalled()
  })

  it('bounds the poll to the first live sessions', async () => {
    const mux = muxStub()
    const rows = Array.from({ length: SUBAGENT_SESSION_MAX + 1 }, (_, index) => sessionRow(`s-${index}`, true))
    api.listSessions.mockResolvedValue({ items: rows, nextCursor: undefined, hasMore: false })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(api.subagentsList).toHaveBeenCalledTimes(SUBAGENT_SESSION_MAX))
    expect(api.subagentsList).toHaveBeenCalledWith('s-0')
    expect(api.subagentsList).not.toHaveBeenCalledWith(`s-${SUBAGENT_SESSION_MAX}`)
  })

  it('不把子会话单独列成一张卡（它已经挂在父卡片的子代理行里）', async () => {
    // 子代理自己也会 emit turn/start，于是它同样出现在运行集合里。以前它会顶着一张
    // "会话 632d7f42"这样的无名卡，跟父卡片下那行子代理重复。
    const mux = muxStub([], ['s-live', 'c-child'])
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    api.subagentsList.mockResolvedValue(catalog([child('c-child', '跑真机回归')]))
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('跑真机回归')).toBeTruthy())
    // 只剩父卡片一张：子代理以自己的名字出现在它下面。
    expect(document.querySelectorAll('.runov-sess')).toHaveLength(1)
    expect(text()).not.toContain('会话 c-child')
    expect(text()).toContain('1 个会话')
  })
})

describe('RunOverviewView 收工纠正', () => {
  it('尾页说这一轮已收工，卡片就从"正在运行"里退场（花名册还在说 running=true）', async () => {
    // 真机现场：会话 14:24 就答完了，花名册那一行还写着 running=true，
    // 于是一张"已跑 9分58秒"的卡一直挂着数秒。
    const mux = muxStub()
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-done', true)], nextCursor: undefined, hasMore: false })
    api.logTail.mockResolvedValue(tailPage({
      turnOpen: false,
      turnStartAt: Date.now() - 598_000,
      lastEventAt: Date.now() - 180_000,
      pending: false,
      toolState: 'ok',
    }))
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    // 先按花名册渲染出来（首帧不可避免），尾页回来后立刻退场。
    await waitFor(() => expect(api.logTail).toHaveBeenCalled())
    await waitFor(() => expect(document.querySelectorAll('.runov-sess')).toHaveLength(0))
    expect(text()).toContain('当前没有会话在运行')
    expect(text()).not.toContain('已跑')
  })

  it('尾页没说收工时保持原样（不知道 ≠ 收工）', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    api.logTail.mockResolvedValue(tailPage({ turnStartAt: Date.now() - 60_000 }))
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(api.logTail).toHaveBeenCalled())
    expect(document.querySelectorAll('.runov-sess')).toHaveLength(1)
    expect(text()).toContain('已跑')
  })

  it('定期向宿主核对运行集合（mux.refreshRunning）', async () => {
    const base = muxStub()
    const refreshRunning = vi.fn().mockResolvedValue(undefined)
    const mux = Object.assign(base, { refreshRunning }) as unknown as RunOverviewMux
    api.listSessions.mockResolvedValue(emptyPage)
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(refreshRunning).toHaveBeenCalled())
  })

  it('会话跑完的那一刻就落到「刚结束」——全部跑完后页面不是空的', async () => {
    // 真机反馈：所有会话跑完，运行中页一片空白（刚结束压根没留下）。
    const mux = muxStub([], ['s-done'])
    api.listSessions.mockResolvedValue({
      items: [{ ...sessionRow('s-done', true), projections: { values: { title: '跑完的会话' } } }],
      nextCursor: undefined,
      hasMore: false,
    })
    api.logTail.mockResolvedValue(tailPage({
      turnOpen: true,
      turnStartAt: Date.now() - 120_000,
      lastEventAt: Date.now() - 5_000,
      text: '已经改好了',
      durationMs: 120_000,
      pending: false,
      toolState: 'ok',
    }))
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('跑完的会话')).toBeTruthy())

    // 宿主说这一轮结束了：卡片退场的同时，账本里必须留下一条。
    api.logTail.mockResolvedValue(tailPage({
      turnOpen: false,
      turnStartAt: Date.now() - 120_000,
      lastEventAt: Date.now() - 4_000,
      text: '已经改好了',
      durationMs: 120_000,
      pending: false,
      toolState: 'ok',
    }))
    mux.push({ type: 'session/event', sessionId: 's-done', event: { type: 'turn/end', seq: 9, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } } } as never)
    await waitFor(() => expect(document.querySelectorAll('.runov-sess')).toHaveLength(0))
    await waitFor(() => expect(text()).toContain('刚结束'))
    expect(text()).toContain('已完成')
    expect(text()).toContain('2分0秒')
  })
})
