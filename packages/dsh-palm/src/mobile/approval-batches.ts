/**
 * Answered-approval bookkeeping, shared by the chat's approval panel and the
 * weak-network poll.
 *
 * The polling fallback (`mobile.pending`) is served by the host's pending
 * tracker, and nothing ever retired an approval from it: `approval/resolved`
 * had no emitter, so an approval this phone had already answered stayed in the
 * tracker for the plugin's lifetime and the poll handed it straight back. The
 * chat kept no memory of its own answers either, so re-entering the session
 * re-installed the panel — the reported ghost.
 *
 * The memory below is the client half of the fix and lives at MODULE scope: see
 * answered-ids.ts for why a component ref is exactly the wrong home for it. The
 * host retires the approval on the answer too, but that says nothing about a
 * poll response already in flight when the user tapped — which is what this
 * drops.
 *
 * @module dsh-palm/mobile/approval-batches
 */

import { createAnsweredIds } from './answered-ids.ts'
import type { PendingApproval } from './api.ts'

/** Answered approvalIds per session (module scope: survives a chat remount). */
export const answeredApprovals = createAnsweredIds()

/** Remember that this phone answered `approvalId` in `sessionId`. */
export function noteAnsweredApproval(sessionId: string, approvalId: string): void {
  answeredApprovals.note(sessionId, approvalId)
}

/** The approvalIds this phone has already answered in `sessionId`. */
export function answeredApprovalsFor(sessionId: string): ReadonlySet<string> {
  return answeredApprovals.forSession(sessionId)
}

/**
 * Adopt one `mobile.pending` poll result over the panel's current state — the
 * approval twin of `adoptPolledQuestions` (question-batches.ts).
 *
 * `answered` holds the approvalIds this phone already submitted; they are
 * filtered out of both sides. A non-empty poll result replaces the panel (the
 * poll is authoritative for what the host still holds), while an empty one
 * keeps the panel the live stream showed. The current array is returned
 * unchanged when nothing was dropped, so an idle poll never re-renders.
 */
export function adoptPolledApprovals(
  current: PendingApproval[],
  polled: PendingApproval[],
  answered: ReadonlySet<string>,
): PendingApproval[] {
  const fresh = polled.filter(approval => !answered.has(approval.approvalId))
  if (fresh.length > 0) return fresh
  const kept = current.filter(approval => !answered.has(approval.approvalId))
  return kept.length === current.length ? current : kept
}
