/**
 * The automatic error outbox: subscribes to `errors.ts`'s receiver hook,
 * debounces a quiet window, then hands each newly-seen failure to a `send`
 * callback ONE record per call (matching the `mobile.error` contract — the
 * host expects `{ report, label }` with a single record, and the client-side
 * ring+fold already converges a render loop into one record + one count).
 *
 * Ownership: everything network-y lives HERE, not in errors.ts. That module
 * keeps its "no network / no storage / no timers" promise while this one does
 * the debounce. A failed send is swallowed — the record is still in the memory
 * ring and the manual paths (report perf / copy error) are unaffected — and a
 * record is sent at most once per reporter lifetime.
 *
 * @module dsh-palm/mobile/errors-report
 */

import { onErrorRecord, type ErrorRecord } from './errors.ts'

/** How long a quiet window quiets before pending records are handed over. */
export const ERROR_REPORT_DEBOUNCE_MS = 2000

export interface ErrorReporterDeps {
  /** Deliver one record (host-bound RPC, clipboard, anything). */
  send: (record: ErrorRecord) => void | Promise<void>
  /** Quiet window before a flush; defaults to {@link ERROR_REPORT_DEBOUNCE_MS}. */
  delayMs?: number
}

/**
 * Wire the error ring to a sender. Returns `() => void` that unsubscribes and
 * inactivates the pending timers. With no errors, this schedules nothing and
 * calls nothing.
 */
export function installErrorReporter({ send, delayMs = ERROR_REPORT_DEBOUNCE_MS }: ErrorReporterDeps): () => void {
  /** Records already handed over (a repeat fold is never sent again). */
  const sent = new Set<ErrorRecord>()
  /** Distinct records awaiting a flush within the current quiet window. */
  let pending: ErrorRecord[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const flush = (): void => {
    timer = undefined
    const batch = pending
    pending = []
    for (const record of batch) {
      // A repeat folded into the same object after a flush is already marked
      // sent; this guard is what makes "at most one call per record" hold.
      if (sent.has(record)) continue
      sent.add(record)
      try {
        void send(record)
      } catch {
        // Best-effort: the record lives on in the ring; manual paths remain.
      }
    }
  }

  const schedule = (): void => {
    if (stopped) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(flush, delayMs)
  }

  const unsubscribe = onErrorRecord((record) => {
    if (sent.has(record)) return
    // Reference dedupe: repeated folds mutate the SAME object, so one entry here
    // carries the latest count once the quiet window closes.
    if (!pending.includes(record)) pending.push(record)
    schedule()
  })

  return () => {
    stopped = true
    unsubscribe()
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
}
