// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PENDING_POLL_FAST_MS, PENDING_POLL_IDLE_MS, usePendingPoll } from './use-pending-poll.ts'
import type { PendingApproval, PendingQuestionItem } from '../../api.ts'

vi.mock('../../api.ts', () => ({
  fetchPending: vi.fn(),
}))

import { fetchPending } from '../../api.ts'

const fetchPendingMock = vi.mocked(fetchPending)

type Sse = { live: boolean }

function Harness({ running, foreground, sse }: { running: boolean; foreground: boolean; sse: Sse }) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([])
  const [questions, setQuestions] = useState<PendingQuestionItem[]>([])
  const mux = { isSseLive: () => sse.live }
  usePendingPoll({
    sessionId: 's-1',
    running,
    foreground,
    mux,
    setApprovals: setApprovals as never,
    setQuestions: setQuestions as never,
  })
  return <div data-testid="counts">{`${approvals.length}/${questions.length}`}</div>
}

beforeEach(() => {
  fetchPendingMock.mockReset()
  fetchPendingMock.mockResolvedValue({ approvals: [], questions: [] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('usePendingPoll', () => {
  it('does not poll while the turn is idle', async () => {
    render(<Harness running={false} foreground sse={{ live: true }} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetchPendingMock).not.toHaveBeenCalled()
  })

  it('adopts polled approvals (and filters already-answered ones)', async () => {
    fetchPendingMock.mockResolvedValue({
      approvals: [{ rpcId: 'r1', approvalId: 'ap-1', toolName: 'bash' } as PendingApproval],
      questions: [],
    })
    const view = render(<Harness running foreground sse={{ live: true }} />)
    await waitFor(() => { expect(view.getByTestId('counts').textContent).toBe('1/0') })
  })

  it('never lets an empty poll clobber a panel', async () => {
    fetchPendingMock.mockResolvedValue({ approvals: [], questions: [] })
    const view = render(<Harness running foreground sse={{ live: true }} />)
    // First tick returns empty; the panel count stays zero and does not throw.
    await waitFor(() => { expect(fetchPendingMock).toHaveBeenCalled() })
    expect(view.getByTestId('counts').textContent).toBe('0/0')
  })

  it('uses the long cadence while SSE is live and the fast one when stalled', async () => {
    vi.useFakeTimers()
    render(<Harness running foreground sse={{ live: true }} />)
    expect(fetchPendingMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(PENDING_POLL_FAST_MS + 10)
    expect(fetchPendingMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(PENDING_POLL_IDLE_MS * 4)
    expect(fetchPendingMock).toHaveBeenCalledTimes(2)
  })
})
