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

import { useCallback } from 'react'
import {
  collapseDuplicateRows,
  dedupeById,
  dedupeSameStep,
  keepTurnReports,
  hideHistoricalProcessCards,
  mergeSameTurnRows,
  preferRicherRows,
  type RenderMessage,
  renderRows,
} from '../../../render/messages.ts'
import { reportDuplicateCards } from '../../../session/duplicate-report.ts'
import { reportError, reportProbe } from '../../../data/diag.ts'
import { useSessionState } from './use-session-scope.ts'

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
  // 行属于本会话：换会话即回到该会话的首帧快照（否则 A 的行会被 commitRows 的并集留下来）。
  const [rows, setRows] = useSessionState<RenderMessage[]>(sessionId, initialRows)

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
      // 最后一道：用与轮号无关的强证据（共享 callId / seq 区间重叠）收敛。
      // 上面的 dedupeSameStep 依赖 turn+step，缺轮号时整条放弃 —— 真机上"快照行 + 流行"
      // 正是这种形态，于是同一轮的过程条会画两遍（2026-11-12 用户再次复现）。
      const collapsed = collapseDuplicateRows(merged)
      const deduped = [...dedupeSameStep(collapsed)]
      // 再一道：同一轮两份并成一份（2026-11-16 冷启动真机两次复现：一张绿点 33 次 + 一张红点 15 次；
      // 两张都绿点、标题都叫「成了」的 33 次 + 17 次）。两份 id、seq 区间、turn+step 全对不上，
      // 上面三道都认不出 —— 这里不看状态、不看 seq，同 turn 直接收一行。
      const settled = mergeSameTurnRows(deduped)
      if (settled.merged.length > 0) {
        // 探针是尽力而为：测试/老宿主没接这条通道时不能把提交打断。
        void reportProbe?.('turn-duplicate', { sessionId, rows: merged.length, turnDuplicates: settled.merged })
      }
      reportDuplicateCards(sessionId, settled.rows, report => {
        void reportError(report, 'duplicate-cards').catch(() => {})
      })
      // 过程条卡只留最近两轮：更早的轮次挂着卡，屏幕上就是一排「过程条」。
      return hideHistoricalProcessCards(settled.rows)
    })
  }, [sessionId, getOpenTurn])

  return { rows, setRows, commitRows }
}
