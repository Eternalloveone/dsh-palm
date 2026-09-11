/**
 * Pending-question batch algebra, shared by the question panel and the chat's
 * weak-network poll.
 *
 * One ask() on the host is a batch: the agent blocks on it, so a session never
 * has two unanswered batches at once, and the answer is a client-response
 * echoing that batch's rpcId. The phone therefore renders ONE batch per panel
 * and answers exactly the rpcId it is showing.
 *
 * The polling fallback (mobile.pending) is served by the host-side pending
 * tracker, which is only updated from a live phone SSE loop. A
 * question/resolved frame missed while the page was hidden — or a question
 * answered from the desktop — leaves the batch in the tracker, so a poll can
 * hand back a batch the phone already answered, next to the current one.
 * These helpers keep that from putting two identical-looking question groups
 * (and a submit button that only answers one of them) on the screen.
 *
 * @module dsh-palm/mobile/question-batches
 */

import type { PendingQuestionItem } from './api.ts'

/**
 * The newest batch inside a list that may still carry older ones. The host
 * appends each ask as it arrives, so the last rpcId is the live ask; every
 * entry sharing it is one of that ask's questions.
 */
export function latestBatchOf(questions: PendingQuestionItem[]): PendingQuestionItem[] {
  if (questions.length === 0) return []
  const rpcId = questions[questions.length - 1]!.rpcId
  return questions.filter(question => question.rpcId === rpcId)
}

/**
 * Adopt one `mobile.pending` poll result over the panel's current state.
 *
 * `answered` holds the rpcIds this phone has already submitted. They are
 * filtered out of both sides: a non-empty poll result replaces the panel (the
 * poll is authoritative for what the host still holds), while an empty one
 * keeps the panel the live stream showed — minus anything already answered.
 * The current array is returned unchanged when nothing was dropped, so an
 * idle poll never re-renders the panel.
 */
export function adoptPolledQuestions(
  current: PendingQuestionItem[],
  polled: PendingQuestionItem[],
  answered: ReadonlySet<string>,
): PendingQuestionItem[] {
  const fresh = polled.filter(question => !answered.has(question.rpcId))
  if (fresh.length > 0) return fresh
  const kept = current.filter(question => !answered.has(question.rpcId))
  return kept.length === current.length ? current : kept
}
