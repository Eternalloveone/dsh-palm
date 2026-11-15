/**
 * Mobile-surface unary RPC over the shared /api transport: the four-quadrant
 * envelope (client-request → server-response), minted rpcIds, and typed
 * error mapping. This is a thin, self-contained slice of the harness
 * apiproxy fetch carrier — the mobile page is an independent bundle and must
 * not depend on the main UI's module loader, so the wire contract is
 * reimplemented here over plain fetch.
 */

import { beginSpan } from './perf.ts'

/** Transport-level failure (network, HTTP status, malformed envelope). */
export class RpcTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RpcTransportError'
  }
}

/** A business error the host answered with (200 + err result). */
/**
 * 宿主的方法级错误码带命名空间前缀（`session/queue-item-not-found`、
 * `session/steer-unavailable`），而界面里判的是裸名。
 *
 * 这里统一剥掉一层 `xxx/` 前缀，让每个调用点只写一次判据 —— 之前没剥，
 * `code === 'queue-item-not-found'` 永远不成立，于是「这条已经不在队列里」被误报成
 * 「删除没送到宿主」，「轮次已结束」也被当成网络失败（真机反馈过两次）。
 */
export function normalizeRpcCode(code: string): string {
  const slash = code.indexOf('/')
  return slash > 0 ? code.slice(slash + 1) : code
}

export class RpcCallError extends Error {
  /** The wire error (code + message + details). */
  readonly error: { code: string; message: string }

  constructor(error: { code: string; message: string }) {
    super(error.message)
    this.name = 'RpcCallError'
    this.error = { code: normalizeRpcCode(error.code), message: error.message }
  }
}

let rpcCounter = 0

/** Default ceiling for one unary call (weak links must reach a terminal
 * state instead of hanging the composer/buttons forever). */
export const DEFAULT_RPC_TIMEOUT_MS = 60_000

/** Mint one process-unique rpcId (stable under crypto.randomUUID absence). */
export function mintRpcId(): string {  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  rpcCounter += 1
  return `${random}-${rpcCounter.toString(36)}`
}

/**
 * 连通性的**真值**：每一次真实请求的结局。
 *
 * `navigator.onLine` 在安卓上很不可靠 —— 换基站、切 5G/流量、锁屏一会儿之后它会一直
 * 停在 false，而且 `online` 事件可能永远不来。真机就是这样：网络早就好了，横幅还挂着
 * 「网络已断开」，发出去的话全进了离线队列。所以"在线"只认宿主答没答话：HTTP 回了
 * （哪怕是 500）就是通的，fetch 自己抛了才是断的。
 */
type ConnectivityListener = (online: boolean) => void

const connectivityListeners = new Set<ConnectivityListener>()

/** 订阅连通性变化（返回退订函数）。 */
export function onConnectivityChange(listener: ConnectivityListener): () => void {
  connectivityListeners.add(listener)
  return () => { connectivityListeners.delete(listener) }
}

/** 连续多少次"没答话"才认定为断网（一次超时可能只是某一个调用慢）。 */
const OFFLINE_AFTER_SILENT_FAILURES = 2

let silentFailures = 0

/** 报告一次请求结局（内部用，也供 mux 帧到达这类证据调用）。 */
export function reportConnectivity(online: boolean): void {
  if (online) silentFailures = 0
  for (const listener of [...connectivityListeners]) {
    try {
      listener(online)
    } catch {
      // 订阅者自己的事：一条坏订阅不该影响请求本身。
    }
  }
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
/**
 * **传输层 IO**（W4-2）：RPC 唯一碰网络的地方。
 *
 * 为什么要有这一层：`callUnary` 里内联 `fetch` 意味着"超时/断网/宿主 4xx"这三条最
 * 容易出错的路径只能靠 mock 全局 `fetch` 来测——mock 全局的代价是每条用例都要记得
 * 还原，漏一次就污染整份测试文件。注入之后，失败面变成显式对象，测试里给一个会
 * 抛错的假 IO 就够了。
 */
export interface RpcIO {
  fetch: (input: string, init: RequestInit) => Promise<Response>
}

const defaultIO: RpcIO = {
  fetch: (input, init) => fetch(input, init),
}

let io: RpcIO = defaultIO

/** 换掉传输层（测试用；生产代码不要调）。 */
export function setRpcIO(next: RpcIO): void {
  io = next
}

/** 还原默认传输层。 */
export function resetRpcIO(): void {
  io = defaultIO
}

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
      response = await io.fetch(`/m/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        signal: controller.signal,
      })
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      /**
       * 「我们自己不要这次答案」不是链路证据（2026-11-12 真机，切旧会话必闪横幅）。
       *
       * 会话切换时旧页还要活 260 ms（转场动画）才卸载，卸载会 abort 仍在飞的尾页读
       * （`readChat` / `logTail` / `session.history`），宿主与 nginx 那头记的正是 499。
       * 把这个结局当断网，横幅就正好在新会话顶部亮「网络慢了一点，正在恢复…」——
       * 老会话尾页读 1~4 s，abort 必然打在在飞的请求上；新会话几十毫秒就读完，abort
       * 打在空处，所以桌面和快会话从来看不到。
       *
       * 页面在后台时浏览器会掐掉在飞请求，同样不是断网：回前台会重新探一次。
       */
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      const cancelled = hidden || (!timedOut && (signal?.aborted === true || aborted))
      if (cancelled) {
        throw new RpcTransportError(timedOut ? '请求超时，请重试' : '请求已取消')
      }
      const reason = aborted
        ? (timedOut ? 'timeout' : 'aborted')
        : (error instanceof Error ? error.message : String(error))
      // 请求根本没送出去：立刻算断网。超时是另一端没答 —— 链路可能是"挂着"的
      // 弱网（地铁、隧道半开），也有可能是某一个调用慢；连续两次都没答话才算断，
      // 任何一次答话都会把计数清零。
      silentFailures += 1
      if (!timedOut || silentFailures >= OFFLINE_AFTER_SILENT_FAILURES) reportConnectivity(false)
      throw new RpcTransportError(timedOut ? '请求超时，请重试' : `transport failed: ${reason}`)
    }
    // 宿主答话了（哪怕 4xx/5xx）：链路是通的。
    reportConnectivity(true)
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
    /*
     * 读 body 和解析 body 必须分开计时（2026-11-15）：
     * `response.json()` 里混着「等网络/排队」和「JSON.parse」两段，前者不占主线程、后者才占。
     * 上一版把它俩埋成一个 `json:` 区间，结果 `json:mobile.observe:2070` 这种数字分不清
     * 是宿主排队两秒还是解析两秒 —— 那正是这次要回答的问题。
     */
    const endNet = beginSpan(`net:${method}`)
    let bodyText: string
    try {
      bodyText = await response.text()
    } catch (error) {
      // A body read that fails because the caller aborted (history-load timeout)
      // is a cancellation, not a malformed payload — surface it as such.
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new RpcTransportError(timedOut ? '请求超时，请重试' : '请求超时或已取消，请重试')
      }
      throw new RpcTransportError('malformed response body')
    } finally {
      endNet()
    }
    const endParse = beginSpan(`parse:${method}`)
    try {
      envelope = JSON.parse(bodyText) as unknown
    } catch {
      throw new RpcTransportError('malformed response body')
    } finally {
      endParse()
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
