/**
 * Chat row-model ownership (the fold).
 *
 * ChatView used to own the rendered rows and their single commit point. That
 * made every data concern ("what is on screen") inseparable from the view, and
 * kept the history layer from ever owning `rows`. This hook owns the state and
 * the fold contract:
 *
 * 1. every content change goes through {@link commitRows} — coalescing,
 *    report-card retention and identity union all happen there;
 * 2. merging is a union (`preferRicherRows`): a page is often poorer than what
 *    is already painted, and a complete row must never be replaced by a
 *    stripped one;
 * 3. report cards are kept across replacements (`keepTurnReports`).
 *
 * The stream/history layers write through this hook; ChatView renders
 * `rows`. Extracted as S3c-1.
 *
 * @module dsh-palm/mobile/views/chat/use-chat-session
 */

import { useCallback, useState } from 'react'
import {
  dedupeById,
  dedupeSameStep,
  keepTurnReports,
  preferRicherRows,
  type RenderMessage,
  renderRows,
} from '../../messages.ts'
import { reportDuplicateCards } from '../../duplicate-report.ts'
import { reportError } from '../../data/diag.ts'

/** Options for the row model. */
export interface ChatSessionOptions {
  sessionId: string
  /** First-paint rows (in-memory snapshot). */
  initialRows: RenderMessage[]
  /** The turn currently open (guards guessed report tails). */
  getOpenTurn(): number | undefined
}

/** Row model + the only write entry point. */
export interface ChatSessionHandle {
  /** Rendered rows (what the view paints). */
  rows: RenderMessage[]
  /** Raw setter (rare: clearing a session). */
  setRows: React.Dispatch<React.SetStateAction<RenderMessage[]>>
  /**
   * The single commit point for rendered rows.
   * @param rows - rows for this commit (or a function of the previous rows).
   * @param options.merge - union with the previous rows (default true).
   * @param options.allowGuessedTails - allow guessing report tails from tools.
   */
  commitRows(
    rows: readonly RenderMessage[] | ((previous: readonly RenderMessage[]) => readonly RenderMessage[]),
    options?: { merge?: boolean; allowGuessedTails?: boolean },
  ): void
}

/**
 * Create the row model for one chat.
 * @param options - session id, first-paint rows, open-turn getter.
 * @returns rows plus the commit point.
 */
export function useChatSession(options: ChatSessionOptions): ChatSessionHandle {
  const { sessionId, initialRows, getOpenTurn } = options
  const [rows, setRows] = useState<RenderMessage[]>(initialRows)

  const commitRows = useCallback((
    incoming: readonly RenderMessage[] | ((previous: readonly RenderMessage[]) => readonly RenderMessage[]),
    commitOptions: { merge?: boolean; allowGuessedTails?: boolean } = {},
  ): void => {
    const merge = commitOptions.merge !== false
    const allowGuessedTails = commitOptions.allowGuessedTails !== false
    setRows(previous => {
      const raw = typeof incoming === 'function' ? incoming(previous) : incoming
      const next = renderRows(keepTurnReports(previous, raw), allowGuessedTails, getOpenTurn())
      const merged = dedupeById(merge ? preferRicherRows(previous, next) : next)
      // Live evidence: a duplicate card occasionally still shows up on a real
      // phone. Store the rows at that moment (at most once per minute per
      // session, silent on failure) instead of guessing.
      const deduped = [...dedupeSameStep(merged)]
      reportDuplicateCards(sessionId, deduped, report => {
        void reportError(report, 'duplicate-cards').catch(() => {})
      })
      return deduped
    })
  }, [sessionId, getOpenTurn])

  return { rows, setRows, commitRows }
}
