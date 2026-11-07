/**
 * Keep the reader anchored when a message gets SHORTER.
 *
 * Two real causes:
 * - a >6000-char answer folds to 45vh when the turn closes (audit P1: "正在看底部
 *   的人会被抽走内容");
 * - a streaming block is replaced by its settled parse with a smaller height.
 *
 * This module answers one question only: *did the content meaningfully shrink?*
 * The "may I move the reader" half belongs to the scroll state machine
 * (`maySettlePin`): it is the component that knows whether a finger moved the
 * list. Keeping the two apart means this predicate stays a pure function.
 *
 * @module dsh-palm/mobile/scroll-shrink
 */

/** One observed shrink. */
export interface ShrinkObservation {
  /** Height of the message body before the shrink (px). */
  before: number
  /** Height after the shrink (px). */
  after: number
  /** Ignore sub-pixel/layout noise below this many px of shrink. */
  minimumShrink?: number
}

/**
 * Whether the content shrank enough to warrant a re-pin (caller still applies
 * `maySettlePin` before touching scrollTop).
 *
 * @param input - measured heights.
 * @returns true when the shrink is at or above the threshold.
 */
export function shouldRepinAfterShrink(input: ShrinkObservation): boolean {
  const minimumShrink = input.minimumShrink ?? 24
  const shrunk = input.before - input.after
  return Number.isFinite(shrunk) && shrunk >= minimumShrink
}
