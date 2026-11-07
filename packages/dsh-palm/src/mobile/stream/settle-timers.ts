/**
 * Cancellable "settle burst" timers.
 *
 * After a turn lands, ChatView pins the list to the bottom a few more times
 * (60 ms … 4 s) because heights keep growing afterwards (fonts, cards, images).
 * Two problems with the naive `for (delay of …) setTimeout(...)`:
 *
 * 1. **Nothing cancels them.** Switching sessions unmounts the view, but up to
 *    nine timers per turn end keep firing for four seconds — the audit counted
 *    30–70 pending at once during a long answer, each doing a forced layout read.
 * 2. **They keep firing after the job is done.** Once the list is pinned
 *    (gap ≤ 2) or the reader has scrolled away, every later tick still reads
 *    `scrollHeight` for nothing.
 *
 * This helper gives the burst an owner (`cancel()`) and lets the callback stop
 * the remaining ticks by returning `true`. Pure scheduling — the caller keeps
 * the DOM work.
 *
 * @module dsh-palm/mobile/settle-timers
 */

/** Handle for one scheduled burst. */
export interface SettleBurst {
  /** Cancel every pending tick (idempotent). */
  cancel(): void
  /** How many ticks have run (test seam). */
  readonly ran: number
}

/** Timer functions used by the burst (test seam). */
export interface SettleClock {
  setTimeout(handler: () => void, ms: number): ReturnType<typeof setTimeout>
  clearTimeout(id: ReturnType<typeof setTimeout>): void
}

const defaultClock: SettleClock = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: id => clearTimeout(id),
}

/**
 * Schedule one burst of ticks.
 *
 * @param delays - millisecond offsets, ascending.
 * @param tick - called per tick; return `true` when the burst is done (remaining
 *   ticks are cancelled).
 * @param timers - clock seam (tests pass fake timers).
 * @returns a cancellable handle.
 */
export function scheduleSettleBurst(
  delays: readonly number[],
  tick: (index: number) => boolean,
  timers: SettleClock = defaultClock,
): SettleBurst {
  const pending = new Set<ReturnType<typeof setTimeout>>()
  let ran = 0
  let cancelled = false

  const cancel = (): void => {
    if (cancelled) return
    cancelled = true
    for (const id of pending) timers.clearTimeout(id)
    pending.clear()
  }

  const handle: SettleBurst = {
    cancel,
    get ran() { return ran },
  }

  delays.forEach((delay, index) => {
    const id = timers.setTimeout(() => {
      pending.delete(id)
      if (cancelled) return
      ran += 1
      let done = false
      try {
        done = tick(index)
      } catch {
        // A throwing tick must not leave the rest of the burst scheduled.
        done = true
      }
      if (done) cancel()
    }, delay)
    pending.add(id)
  })

  return handle
}
