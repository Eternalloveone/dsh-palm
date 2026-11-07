/**
 * Page assembly for older history.
 *
 * Two things happen to a fetched page before it reaches the row model:
 *
 * - {@link prepareOlderPage}: render it and recover the report cards whose
 *   `turn/end` landed on the next page (read once, so the card never "grows"
 *   after the page is already on screen);
 * - {@link adoptOlderPage}: prepend it to the fold, or reseed the window when a
 *   locate page does not touch the current window (two disjoint windows spliced
 *   together would leave a permanent hole).
 *
 * Both were inline closures in ChatView; extracting them is S3c-2 and leaves
 * ChatView with wiring only.
 *
 * @module dsh-palm/mobile/views/chat/history-page
 */

import type { ChatPageResult } from '../../../data/chat-page.ts'
import {
  mergeTurnReports,
  missingTurnReports,
  renderRows,
  type EventFolder,
  type RenderMessage,
} from '../../../render/messages.ts'
import type { ChatSessionHandle } from '../hooks/use-chat-session.ts'

/** Dependencies for {@link prepareOlderPage}. */
export interface PrepareOlderOptions {
  sessionId: string
  /** Remember the raw host page for locate matching. */
  rememberRawPage(rows: readonly RenderMessage[]): void
  /** Per-session card-recovery bookkeeping (confirmed turns). */
  cardRecovery: { confirmed: Set<number> }
  /** Read report rows for turns whose card is missing from the page. */
  loadCards(sessionId: string, turns: readonly number[]): Promise<RenderMessage[]>
  /** Remember recovered cards for the next open. */
  rememberCards(sessionId: string, cards: RenderMessage[]): void
}

/**
 * Render one older page and attach report cards that are recoverable now.
 * @param page - host page.
 * @param options - session id, raw-page sink, card bookkeeping.
 * @returns rows ready to adopt.
 */
export async function prepareOlderPage(page: ChatPageResult, options: PrepareOlderOptions): Promise<RenderMessage[]> {
  let older = renderRows(page.rows, false)
  // A settled turn whose `turn/end` arrived on the NEXT page: read its card now
  // so page and card commit together (the card must not appear later).
  const lackingTurns = missingTurnReports(older).slice(-3)
  if (lackingTurns.length > 0) {
    try {
      const cards = await options.loadCards(options.sessionId, lackingTurns)
      if (cards.length > 0) {
        // Remember it: next open, the card lands with the body in one commit.
        options.rememberCards(options.sessionId, cards)
        older = renderRows(mergeTurnReports(older, cards), false)
        for (const turn of lackingTurns) options.cardRecovery.confirmed.add(turn)
      }
    } catch {
      // A failed card read must not block history paging.
    }
  }
  options.rememberRawPage(page.rows)
  return older
}

/** Dependencies for {@link adoptOlderPage}. */
export interface AdoptOlderOptions {
  /** The page fold, when the session is opened (may still be undefined). */
  folder: EventFolder | undefined
  /** The session's single commit point (used when there is no fold yet). */
  commitRows: ChatSessionHandle['commitRows']
  /** Adopt the fold's new snapshot into the view. */
  applyRows(rows: RenderMessage[]): void
}

/**
 * Fold one older page into the view.
 *
 * A locate page (`maxRows`) can be disjoint from the current window: prepending
 * it would splice two non-adjacent stretches and leave a permanent hole, so in
 * that case the window is reseeded around the page instead.
 *
 * @param older - prepared rows.
 * @param context - `maxRows` and the first row the fetch started from.
 * @param options - fold, commit point, adopt callback.
 */
export function adoptOlderPage(
  older: readonly RenderMessage[],
  context: { maxRows?: number; first: RenderMessage },
  options: AdoptOlderOptions,
): void {
  const { folder } = options
  const pageMinSeq = older.reduce((min, row) => Math.min(min, row.startSeq ?? row.seq), Number.POSITIVE_INFINITY)
  const windowMinSeq = context.first.startSeq ?? context.first.seq
  const reseed = folder !== undefined && context.maxRows !== undefined && older.length > 0 && pageMinSeq >= windowMinSeq

  if (folder === undefined) {
    options.commitRows(previous => [...older, ...previous], { allowGuessedTails: false })
  } else if (reseed) {
    const pageMaxSeq = older.reduce((max, row) => Math.max(max, row.seq), Number.NEGATIVE_INFINITY)
    const keep = folder.snapshot().filter(row => (row.startSeq ?? row.seq) > pageMaxSeq)
    folder.seed([...older, ...keep])
    options.applyRows(folder.snapshot())
  } else {
    folder.prepend(older)
    options.applyRows(folder.snapshot())
  }
}
