/**
 * Queued messages the host has not delivered yet.
 *
 * A queued message is DURABLE on the host (it lives in the session event log as
 * an `agent/inbox/spliced` event, so a restart replays it back). What is not
 * durable is the window between "queued" and "delivered": the host claims the
 * item as the next turn, it leaves the queue, and the transcript frame that
 * proves delivery lands seconds later. A restart in that window interrupts the
 * turn, which is the case that really loses a message.
 *
 * So the phone keeps its own copy of what it queued and restores it ONLY when
 * the evidence is unambiguous: gone from the queue for a while, never in the
 * transcript, and no turn running right now. Anything less hands a delivered
 * message back to the composer and invites a duplicate send — the phone would
 * say "did not go through" about a message that already went through.
 *
 * @module dsh-palm/mobile/queued-echo
 */

/** One message the phone queued on the host. */
export interface QueuedEcho {
  /** Session the message was queued into. */
  sessionId: string
  /** The text that was queued. */
  text: string
  /** When it was queued (epoch ms). */
  at: number
  /**
   * When the phone last saw it sitting in the host queue (epoch ms).
   *
   * Absence from the queue alone proves nothing: a queued message leaves the
   * queue exactly when the host claims it as the next turn. Only a copy that
   * has been gone from the queue for a while is suspicious.
   */
  seenAt?: number
}

/** Storage key (localStorage; the list is tiny and only read on inbox refreshes). */
const ECHO_KEY = 'dsh.palm.queuedEcho'
/** Bound on remembered items so a long queue cannot grow without end. */
const MAX_ECHOES = 20

/** Collapse whitespace so "a  b" and "a b" compare equal. */
export function normalizeEchoText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** Read the remembered items (bad payloads are dropped, never thrown). */
export function readQueuedEchoes(): QueuedEcho[] {
  try {
    const raw = localStorage.getItem(ECHO_KEY)
    if (raw === null || raw === '') return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is QueuedEcho => {
      if (typeof entry !== 'object' || entry === null) return false
      const value = entry as Record<string, unknown>
      if (typeof value.sessionId !== 'string' || typeof value.text !== 'string' || typeof value.at !== 'number') return false
      return value.seenAt === undefined || typeof value.seenAt === 'number'
    })
  } catch {
    return []
  }
}

function writeQueuedEchoes(echoes: QueuedEcho[]): void {
  try { localStorage.setItem(ECHO_KEY, JSON.stringify(echoes.slice(-MAX_ECHOES))) } catch { /* private mode */ }
}

/** Remember one queued message (same session + text replaces the earlier copy). */
export function rememberQueuedEcho(echo: QueuedEcho): void {
  const key = normalizeEchoText(echo.text)
  const echoes = readQueuedEchoes()
  const existing = echoes.find(entry => entry.sessionId === echo.sessionId && normalizeEchoText(entry.text) === key)
  const rest = echoes.filter(entry => !(entry.sessionId === echo.sessionId && normalizeEchoText(entry.text) === key))
  rest.push({
    sessionId: echo.sessionId,
    text: echo.text,
    // 重新排队时保留最早的排队时间，但只在没给新值时才沿用旧的见队时间。
    at: existing?.at ?? echo.at,
    seenAt: echo.seenAt ?? existing?.seenAt,
  })
  writeQueuedEchoes(rest)
}

/** Bump the last-seen-in-queue time for one copy (it is still pending). */
export function markQueuedEchoSeen(sessionId: string, text: string, at: number): void {
  const key = normalizeEchoText(text)
  const echoes = readQueuedEchoes()
  const echo = echoes.find(entry => entry.sessionId === sessionId && normalizeEchoText(entry.text) === key)
  if (echo === undefined) return
  echo.seenAt = at
  writeQueuedEchoes(echoes)
}

/** Drop the copies for one session whose text matches. */
export function forgetQueuedEcho(sessionId: string, text: string): void {
  const key = normalizeEchoText(text)
  writeQueuedEchoes(readQueuedEchoes().filter(entry => !(entry.sessionId === sessionId && normalizeEchoText(entry.text) === key)))
}

/** Options for {@link lostQueuedEchoes}. */
export interface LostEchoOptions {
  /** Current time (epoch ms) — injected so the rule stays testable. */
  now: number
  /**
   * How long a copy must have been missing from the queue before it counts as
   * lost. Anything shorter races the host's claim and the transcript frame.
   */
  quietMs: number
}

/**
 * Copies the host no longer has and the transcript never received.
 *
 * @param echoes - Remembered queue copies.
 * @param sessionId - Session being viewed.
 * @param queueTexts - Texts still sitting in the host's inbox.
 * @param transcriptTexts - User texts already in the transcript.
 * @param options - Clock + quiet window (see {@link LostEchoOptions}).
 */
export function lostQueuedEchoes(
  echoes: readonly QueuedEcho[],
  sessionId: string,
  queueTexts: readonly string[],
  transcriptTexts: readonly string[],
  options: LostEchoOptions,
): QueuedEcho[] {
  const queue = new Set(queueTexts.map(normalizeEchoText))
  const delivered = new Set(transcriptTexts.map(normalizeEchoText))
  return echoes.filter(entry => {
    if (entry.sessionId !== sessionId) return false
    const key = normalizeEchoText(entry.text)
    if (key === '') return false
    if (queue.has(key) || delivered.has(key)) return false
    const quietSince = entry.seenAt ?? entry.at
    return options.now - quietSince >= options.quietMs
  })
}
