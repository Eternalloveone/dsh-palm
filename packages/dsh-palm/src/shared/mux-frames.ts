/**
 * The one authoritative list of mux frame discriminants.
 *
 * This used to be written out three times — the `MuxFrame` union (17 arms), the
 * host's `MUX_FRAME_TYPES` (15 entries, missing `goal/activation` and
 * `mux/ping`) and the phone's own copy (16 entries, missing `goal/activation`).
 * The drift was not cosmetic: the host emits `goal/activation` and ChatView
 * waits for it, but the phone's whitelist dropped the frame on arrival, so the
 * goal bar's pause/resume button never followed the host. Two other arms
 * (`session/queue`, `session/jobs`) had no producer at all.
 *
 * Keeping the table in a browser-safe module (no zod, no node imports) lets the
 * host half and the mobile bundle share it: tsdown inlines it into `mobile.js`.
 * `Record<MuxFrame['type'], true>` makes exhaustiveness a compile error — adding
 * an arm to the union without adding it here, or vice versa, fails `tsc`.
 *
 * @module dsh-palm/shared/mux-frames
 */

import type { MuxFrame } from '../api-proxy-types.ts'

/**
 * Every known frame, keyed by discriminant. The values are meaningless; the
 * Record type is what enforces completeness.
 */
export const MUX_FRAME_TABLE: Record<MuxFrame['type'], true> = {
  'session/event': true,
  'session/subscribed': true,
  'approval/requested': true,
  'approval/resolved': true,
  'question/requested': true,
  'question/resolved': true,
  'session/queue': true,
  'session/jobs': true,
  'session/projection': true,
  'goal/activation': true,
  'session/added': true,
  'session/removed': true,
  'session/status': true,
  'session/turn-boundary': true,
  'session/activity': true,
  'session/error': true,
  'mux/ping': true,
  'stream/error': true,
}

/** The runtime set both halves (and the service worker) validate against. */
export const MUX_FRAME_TYPES: ReadonlySet<MuxFrame['type']> =
  new Set(Object.keys(MUX_FRAME_TABLE) as MuxFrame['type'][])

/**
 * Structural guard: an object carrying a known frame discriminant.
 * @param value - any decoded payload.
 * @returns true when this is a frame the client knows how to route.
 */
export function isMuxFrame(value: unknown): value is MuxFrame {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return typeof type === 'string' && MUX_FRAME_TYPES.has(type as MuxFrame['type'])
}
