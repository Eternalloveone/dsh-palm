/**
 * Capped per-session memory of the panel items this phone has already answered.
 *
 * Module scope is the whole point. A component ref — any state whose life is the
 * chat's — is cleared by the very navigation that reproduced the ghost panels:
 * leaving a session and re-entering it. By then the host's polling fallback can
 * hand the answered item straight back (the tracker behind it misses the
 * resolved frame when the phone answers and leaves in the same breath), and a
 * chat with no memory of its own answers re-renders the panel.
 *
 * Both panels share this shape — approvals (approval-batches.ts) and question
 * batches (question-batches.ts) — each with its own instance, so one session's
 * approvals and questions never mix.
 *
 * @module dsh-palm/mobile/answered-ids
 */

/** One per-session answered-id memory. */
export interface AnsweredIds {
  /** The raw store (exported for tests, which clear it between cases). */
  readonly store: Map<string, Set<string>>
  /** Remember that this phone answered `id` in `sessionId`. */
  note(sessionId: string, id: string): void
  /** The ids answered in `sessionId` (a shared empty set when there are none). */
  forSession(sessionId: string): ReadonlySet<string>
  /** Drop every session's memory (tests). */
  clear(): void
}

/** Shared empty set: a session with no answers must not allocate. */
const NO_ANSWERS: ReadonlySet<string> = new Set()

/**
 * Build one memory. Ids are minted per request and never reused, so the cap only
 * bounds a very long-lived session's growth; the oldest entries drop first.
 * @param cap - how many ids to remember per session.
 * @returns the memory.
 */
export function createAnsweredIds(cap = 64): AnsweredIds {
  const store = new Map<string, Set<string>>()
  return {
    store,
    note(sessionId: string, id: string): void {
      let answered = store.get(sessionId)
      if (answered === undefined) {
        answered = new Set()
        store.set(sessionId, answered)
      }
      answered.add(id)
      while (answered.size > cap) {
        const oldest = answered.values().next().value
        if (oldest === undefined) break
        answered.delete(oldest)
      }
    },
    forSession(sessionId: string): ReadonlySet<string> {
      return store.get(sessionId) ?? NO_ANSWERS
    },
    clear(): void {
      store.clear()
    },
  }
}
