// @vitest-environment jsdom
/** RunOverviewView: cross-session jobs + running-session projection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RunOverviewView, type RunOverviewMux } from './RunOverviewView.tsx'
import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'

const api = vi.hoisted(() => ({
  listSessions: vi.fn(),
}))

vi.mock('../api.ts', () => api)

type Listener = (frame: MuxFrame) => void
type Row = { sessionId: string; jobs: unknown[] }

/** A minimal MuxClient stand-in exposing the snapshot surface the page uses.
 *  Seed rows before rendering (the page reads them at mount), or push a
 *  frame afterwards to simulate a live update. */
function muxStub(initial: Row[] = [], runningSeed: string[] = []) {
  const rows: Row[] = [...initial]
  const runningIds: string[] = [...runningSeed]
  const listeners = new Set<Listener>()
  return {
    // A fresh array each read (the real client builds a new snapshot too),
    // so a state update with the same underlying rows still re-renders.
    jobsSnapshot: () => [...rows],
    runningSessionsSnapshot: () => [...runningIds],
    onFrame(listener: Listener): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Replace the retained rows and notify listeners (real-client order:
     *  the cache mutates first, then the frame fires). */
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
  kind: 'subagent',
  label: over.label ?? '后台任务',
  status: over.status ?? 'running',
  startedAt: 1_700_000_000_000,
  ...(over.finishedAt !== undefined ? { finishedAt: over.finishedAt } : {}),
})

/** A session.list row for the fetchRoster mock. */
function sessionRow(sessionId: string, running: boolean): Record<string, unknown> {
  return { sessionId, updatedAt: 1_700_000_000_000, running, blank: false, projections: {} }
}

const emptyPage = { items: [], nextCursor: undefined, hasMore: false }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RunOverviewView', () => {
  it('renders the empty state when nothing runs and no snapshot exists', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue(emptyPage)
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('当前没有运行中的会话或任务')).toBeTruthy())
  })

  it('shows a running session that owns no background jobs (running-only card)', async () => {
    const mux = muxStub()
    // The roster says s-live is running; no session/jobs frames exist for it.
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('1 个会话正在运行 · 0 个后台任务')).toBeTruthy())
    expect(screen.getByText('回合中')).toBeTruthy()
    expect(screen.getByText('回合运行中')).toBeTruthy()
  })

  it('groups live sessions first with their running job rows', async () => {
    const mux = muxStub([
      { sessionId: 's-settled', jobs: [job({ id: 'j2', status: 'completed', finishedAt: 1_700_000_100_000, label: '收尾' })] },
      { sessionId: 's-live', jobs: [job({ id: 'j1', label: '跑真机回归' })] },
    ])
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true), sessionRow('s-settled', false)], nextCursor: undefined, hasMore: false })
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('1 个会话正在运行 · 1 个后台任务')).toBeTruthy())
    expect(screen.getByText('跑真机回归')).toBeTruthy()
    expect(screen.getByText('收尾')).toBeTruthy()
    expect(screen.getByText('最近结束')).toBeTruthy()
  })

  it('adds a session to the running group when a live turn/start frame lands', async () => {
    const mux = muxStub()
    api.listSessions.mockResolvedValue(emptyPage)
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('当前没有运行中的会话或任务')).toBeTruthy())
    mux.push({ type: 'session/event', sessionId: 's-fresh', event: { type: 'turn/start', seq: 5 } } as never)
    await waitFor(() => expect(screen.getByText('回合中')).toBeTruthy())
  })

  it('seeds sessions already running before the page opened from the mux snapshot', async () => {
    // The turn/start frame arrived (and was dropped) before this page mounted;
    // only the mux's running-session memory knows s-early is mid-turn now.
    const mux = muxStub([], ['s-early'])
    api.listSessions.mockResolvedValue(emptyPage)
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('1 个会话正在运行 · 0 个后台任务')).toBeTruthy())
    expect(screen.getByText('回合中')).toBeTruthy()
  })

  it('opens the session chat on card tap with a best-effort title', async () => {
    const mux = muxStub([
      { sessionId: 's-live', jobs: [job({ id: 'j1', label: '跑真机回归' })] },
    ])
    api.listSessions.mockResolvedValue({ items: [sessionRow('s-live', true)], nextCursor: undefined, hasMore: false })
    const onOpen = vi.fn()
    render(<RunOverviewView mux={mux} onBack={() => {}} onOpenSession={onOpen} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /s-live/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /s-live/ }))
    expect(onOpen).toHaveBeenCalledWith({ sessionId: 's-live', title: '会话 s-live' })
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
