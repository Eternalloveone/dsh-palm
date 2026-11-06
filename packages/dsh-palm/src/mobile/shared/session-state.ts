/**
 * "Is this running?" — the single vocabulary for a turn's live state.
 *
 * The phone used to answer this question in five places with five predicates
 * (host frame, mux list, roster heartbeat, row model, tool state). They are
 * different *layers*, not five copies — but the two pure ones kept drifting.
 * This module owns them so the layers can compose:
 *
 * - {@link isRowRunning}: row level (pending / running tool / current turn).
 * - {@link resolveSessionRunning}: roster level (host verdict wins; otherwise
 *   the mux's `running` is trusted unless its heartbeat went quiet).
 *
 * @module dsh-palm/mobile/shared/session-state
 */

import type { RenderMessage } from '../messages.ts'

/**
 * Whether one rendered row is still live.
 *
 * A turn that was cut mid-stream never receives its settled assistant/message,
 * so `pending` stays true forever; the host saying the turn is over wins over
 * any leftover flag. Rows from an older turn are never "running now" — their
 * pending/工具 frames merely lost their own turn/end.
 *
 * @param message - rendered row.
 * @param liveTurn - the turn the host currently reports as running, if known.
 * @param settled - true when the turn has a terminal frame.
 * @returns true when the row should keep its live clock/fold open.
 */
export function isRowRunning(message: RenderMessage, liveTurn?: number, settled?: boolean): boolean {
  if (settled === true) return false
  if (liveTurn !== undefined && message.turn !== undefined && message.turn < liveTurn) return false
  return message.pending === true
    || (message.tools ?? []).some(tool => tool.state === 'running')
    || (liveTurn !== undefined && message.turn !== undefined && message.turn === liveTurn)
}

/** Signals that feed the roster-level verdict. */
export interface SessionRunningSignals {
  /** Host verdict (desktop parity): when present it is the only answer. */
  hostSaid?: boolean
  /** Mux-reported running flag. */
  reported?: boolean
  /** True when no heartbeat arrived for longer than the stale window. */
  quiet?: boolean
}

/**
 * Resolve whether a session is running for the roster.
 *
 * A "running" mark must be kept alive by something: a lost turn/end frame or a
 * huge cold-start reconcile would otherwise leave the green dot on forever.
 * When the host has spoken, it wins; otherwise trust the mux unless it has gone
 * quiet for {@link RUNNING_STALE_MS}.
 *
 * @param signals - host verdict, mux flag, heartbeat staleness.
 * @returns the running flag to render, or undefined when nothing is known.
 */
export function resolveSessionRunning(signals: SessionRunningSignals): boolean | undefined {
  const { hostSaid, reported, quiet } = signals
  return hostSaid !== undefined ? hostSaid : ((reported === true && quiet === true) ? false : reported)
}
