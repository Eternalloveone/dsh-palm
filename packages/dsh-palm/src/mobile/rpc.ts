/**
 * Mobile-surface unary RPC over the shared /api transport: the four-quadrant
 * envelope (client-request → server-response), minted rpcIds, and typed
 * error mapping. This is a thin, self-contained slice of the harness
 * apiproxy fetch carrier — the mobile page is an independent bundle and must
 * not depend on the main UI's module loader, so the wire contract is
 * reimplemented here over plain fetch.
 */

/** Transport-level failure (network, HTTP status, malformed envelope). */
export class RpcTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RpcTransportError'
  }
}

/** A business error the host answered with (200 + err result). */
export class RpcCallError extends Error {
  /** The wire error (code + message + details). */
  readonly error: { code: string; message: string }

  constructor(error: { code: string; message: string }) {
    super(error.message)
    this.name = 'RpcCallError'
    this.error = error
  }
}

let rpcCounter = 0

/** Default ceiling for one unary call (weak links must reach a terminal
 * state instead of hanging the composer/buttons forever). */
export const DEFAULT_RPC_TIMEOUT_MS = 60_000

/** Mint one process-unique rpcId (stable under crypto.randomUUID absence). */
export function mintRpcId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  rpcCounter += 1
  return `${random}-${rpcCounter.toString(36)}`
}

/**
 * One unary call: POST /m/api/<method> (the plugin's own mobile channel —
 * NOT the connection plugin's /api prefix, so the tunneled Host never needs
 * to enter the transport trust fence) with the client-request envelope,
 * resolve the server-response value, reject with the mapped error classes.
 * @param method - the dotted RPC method, e.g. `session.list`.
 * @param payload - the business payload.
 * @param signal - optional caller abort.
 * @param timeoutMs - built-in ceiling (default 60 s; pass 0 to disable).
 * @returns the response value.
 */
export async function callUnary<T>(
  method: string,
  payload: unknown,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS,
): Promise<T> {
  const rpcId = mintRpcId()
  // Manual timeout wiring (AbortSignal.timeout/any are too new for older
  // phone WebViews): one controller fed by the caller's signal and a timer.
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
  }
  const onOuterAbort = (): void => { controller.abort() }
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  let response: Response
  try {
    try {
      response = await fetch(`/m/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        signal: controller.signal,
      })
    } catch (error) {
      let reason: string
      if (error instanceof DOMException && error.name === 'AbortError') {
        reason = timedOut ? 'timeout' : 'aborted'
      } else {
        reason = error instanceof Error ? error.message : String(error)
      }
      throw new RpcTransportError(timedOut ? '请求超时，请重试' : `transport failed: ${reason}`)
    }
    if (!response.ok) {
      // Surface the host's machine-readable refusal message (e.g. the 64 KiB
      // payload cap) instead of a bare status. 403 stays the raw literal: the
      // pairing gate classifies it as the unpaired-device marker.
      let detail: string | undefined
      if (response.status !== 403) {
        try {
          const body = await response.json() as { error?: { message?: unknown } }
          if (typeof body?.error?.message === 'string') detail = body.error.message
        } catch {
          // Non-JSON error body: fall back to the status literal.
        }
      }
      throw new RpcTransportError(detail !== undefined ? detail : `HTTP ${String(response.status)}`)
    }
    let envelope: unknown
    try {
      envelope = await response.json()
    } catch (error) {
      // A body read that fails because the caller aborted (history-load timeout)
      // is a cancellation, not a malformed payload — surface it as such.
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new RpcTransportError(timedOut ? '请求超时，请重试' : '请求超时或已取消，请重试')
      }
      throw new RpcTransportError('malformed response body')
    }
    const parsed = envelope as { type?: unknown; rpcId?: unknown; result?: unknown }
    if (parsed?.type !== 'server-response' || parsed.rpcId !== rpcId) {
      throw new RpcTransportError('response envelope mismatch')
    }
    const result = parsed.result as { ok?: boolean; value?: unknown; error?: { code: string; message: string } }
    if (result?.ok === true) return result.value as T
    if (result?.ok === false && result.error !== undefined) {
      throw new RpcCallError(result.error)
    }
    throw new RpcTransportError('malformed result envelope')
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}
