/**
 * Pending-approval/question polling (weak-network fallback).
 *
 * The live SSE channel is the primary source; this poll exists so a dropped
 * frame (tunnel blip, doze) cannot leave an approval panel invisible while the
 * turn waits forever. It adopts only non-empty results: an empty poll must
 * never clobber a panel the stream already showed.
 *
 * Extracted from ChatView as the first slice of S3. It has no DOM coupling —
 * the setters are the whole interface — so it can be tested on its own clock.
 *
 * @module dsh-palm/mobile/views/chat/use-pending-poll
 */

import { startTransition, useEffect, type Dispatch, type SetStateAction } from 'react'
import { fetchPending } from '../../data/notify.ts'
import type { PendingApproval, PendingQuestionItem } from '../../api.ts'
import { adoptPolledApprovals, answeredApprovalsFor } from '../../approval-batches.ts'
import { adoptPolledQuestions, answeredQuestionsFor } from '../../question-batches.ts'

/** Poll cadence while the live stream is healthy (safety net only). */
export const PENDING_POLL_IDLE_MS = 15_000
/** Poll cadence while the live stream is stalled. */
export const PENDING_POLL_FAST_MS = 1_500

/** Minimal view of the mux client this hook needs. */
export interface PendingSse {
  isSseLive(): boolean
}

/** Everything the poll needs from the chat view. */
export interface PendingPollOptions {
  sessionId: string
  running: boolean
  foreground: boolean
  mux: PendingSse | undefined
  setApprovals: Dispatch<SetStateAction<PendingApproval[]>>
  setQuestions: Dispatch<SetStateAction<PendingQuestionItem[]>>
}

/**
 * Poll pending approvals/questions on a cadence that adapts to the live stream.
 * @param options - session id, activity flags, mux liveness, state setters.
 */
export function usePendingPoll(options: PendingPollOptions): void {
  const { sessionId, running, foreground, mux, setApprovals, setQuestions } = options

  useEffect(() => {
    if (!running || !foreground) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = (): void => {
      if (cancelled) return
      void fetchPending(sessionId).then(
        (state) => {
          if (cancelled) return
          startTransition(() => {
            setApprovals(prev => adoptPolledApprovals(prev, state.approvals, answeredApprovalsFor(sessionId)))
            setQuestions(prev => adoptPolledQuestions(prev, state.questions, answeredQuestionsFor(sessionId)))
          })
        },
        () => { /* transient; next tick retries */ },
      )
      // While SSE is delivering, pending items also arrive as frames — the poll
      // is a safety net, so it runs at a long cadence instead of adding a
      // request every 15 s on a weak link. Only a stalled SSE goes fast.
      const live = mux?.isSseLive() ?? true
      timer = setTimeout(tick, live ? PENDING_POLL_IDLE_MS * 4 : PENDING_POLL_FAST_MS)
    }

    tick()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [running, sessionId, mux, foreground, setApprovals, setQuestions])
}
