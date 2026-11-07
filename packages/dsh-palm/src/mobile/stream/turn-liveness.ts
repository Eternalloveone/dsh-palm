/**
 * Whether the phone's tracked turn number has gone stale.
 *
 * The live turn number is written by the `turn/start` frame and cleared by
 * `turn/end`. On a weak link or after the page was backgrounded, one of those two
 * frames is routinely lost — without `turn/end` the previous turn keeps reading
 * 深度求索中 forever, and because the clock anchor still points at that turn's
 * start, the next turn's stopwatch counts from it.
 *
 * The fix is to let the tracked number expire on evidence rather than only on a
 * frame. The evidence used here is narrow on purpose: an ASSISTANT row whose turn
 * number is higher than the tracked one proves a later turn is already writing.
 *
 * The obvious alternative — "a user message newer than the clock anchor" — is
 * wrong: steering (插话) and a claimed queue message both append user rows inside
 * the SAME turn, and keying on those would zero a card that is still running.
 *
 * @module dsh-palm/mobile/turn-liveness
 */

/** Minimal row shape this rule needs (a RenderMessage satisfies it). */
export interface TurnScopedRow {
  /** Row kind; only `assistant` rows carry a turn number. */
  readonly kind: string
  /** Host turn number, when the row belongs to one. */
  readonly turn?: number
}

/**
 * True when a row of a LATER turn already exists.
 *
 * @param runningTurn - Turn number the phone currently considers live.
 * @param messages - Rows currently folded for the session.
 */
export function turnNumberIsStale(
  runningTurn: number | undefined,
  messages: readonly TurnScopedRow[],
): boolean {
  if (runningTurn === undefined) return false
  return messages.some(message => (
    message.kind === 'assistant' && message.turn !== undefined && message.turn > runningTurn
  ))
}
