/**
 * **只读调用的合并窗口**（W4-4 从 `api.ts` 抽出）。
 *
 * 真机埋点（4G + CPU×4）实测：一次"打开工作区"里 `session.list` 被发了 **3 次、
 * payload 完全相同**（1614/1874/3602ms），每次 470~720ms 且各触发一次 40 行重渲染；
 * 进会话时 `mobile.preferences` 也重复。宿主侧本来就有 30s 的列表 TTL，所以这几次
 * 往返除了耗流量、占主线程之外没有任何收益 —— 并发共享一次飞行、完成后 1.2s 内复用。
 *
 * 写操作成功后调用 {@link invalidateReadCoalescing} 把窗口清掉。
 *
 * @module dsh-palm/mobile/data/read-coalescing
 */
import { callUnary } from '../platform/rpc.ts'

/**
 * 只读调用的合并窗口。真机埋点（4G + CPU×4）实测：一次"打开工作区"里
 * `session.list` 被发了 **3 次、payload 完全相同**（1614/1874/3602ms），
 * 每次 470~720ms 且各触发一次 40 行重渲染；进会话时 `mobile.preferences`
 * 也重复。宿主侧本来就有 30s 的列表 TTL，所以这几次往返除了耗流量、
 * 占主线程之外没有任何收益 —— 并发共享一次飞行、完成后 1.2s 内复用结果。
 * 写操作成功后调用 {@link invalidateReadCoalescing} 把窗口清掉。
 */
const READ_COALESCE_TTL_MS = 1_200
/** Cap on remembered results (each is one page of JSON; 48 is a few MB at most). */
const READ_RECENT_MAX = 48
const readFlights = new Map<string, Promise<unknown>>()
const readRecent = new Map<string, { at: number; value: unknown }>()
/**
 * 失效代号：每次写操作成功 +1。飞行中的读请求带着发起时的代号，回来时代号已经变了
 * 就**不许**写进复用窗口 —— 否则「刚改完设置/刚发完消息，界面又显示旧值」会复现，
 * 而且下一次读还会从这个旧窗口里拿到它。
 */
let readGeneration = 0

/** One coalesced read: share the in-flight call, then reuse the answer briefly. */
export async function coalescedRead<T>(method: string, payload: unknown, ttlMs = READ_COALESCE_TTL_MS): Promise<T> {
  const key = method + ' ' + JSON.stringify(payload ?? {})
  const recent = readRecent.get(key)
  if (recent !== undefined && Date.now() - recent.at <= ttlMs) return recent.value as T
  const flight = readFlights.get(key)
  if (flight !== undefined) return flight as T
  const generation = readGeneration
  const run = callUnary<T>(method, payload)
    .then((value) => {
      // 失效之后才回来的读：结果可能早于那次写，只能交给调用方，不能进复用窗口。
      if (generation === readGeneration) {
        readRecent.set(key, { at: Date.now(), value })
        if (readRecent.size > READ_RECENT_MAX) {
          const oldest = [...readRecent.entries()].sort((a, b) => a[1].at - b[1].at)[0]
          if (oldest !== undefined) readRecent.delete(oldest[0])
        }
      }
      return value
    })
    .finally(() => { readFlights.delete(key) })
  readFlights.set(key, run as Promise<unknown>)
  return await run
}

/**
 * **同一帧里的重复读只发一次**（2026-11-14）。
 *
 * 与 {@link coalescedRead} 的区别：这里只合并**在飞**的调用，完成后不留结果 ——
 * 会话快照这种"权威状态"不能拿旧值复用（回合在跑没在跑、队列几条，读错就是错的界面），
 * 但**同时**被几个 hook 各要一次是纯浪费。
 *
 * 真机实测（4x CPU + 4G）：切一次会话，`mobile.sessionState` 在 118ms 与 123ms
 * 各发一次、payload 完全一致，两次都在宿主单线程里读同一份日志（各 750ms），
 * 后面的请求全排在它们后面。
 *
 * @param method - RPC 方法名
 * @param payload - 业务载荷（参与去重键）
 * @returns 这一次调用的结果（多个调用方共享同一个 Promise）
 */
export async function dedupeRead<T>(method: string, payload: unknown): Promise<T> {
  const key = method + ' ' + JSON.stringify(payload ?? {})
  const flight = readFlights.get(key)
  if (flight !== undefined) return await (flight as Promise<T>)
  const run = callUnary<T>(method, payload)
  readFlights.set(key, run as Promise<unknown>)
  try {
    return await run
  } finally {
    // 只删自己：期间若有 coalescedRead 用同一个键登记了新的飞行，不能把它的删掉。
    if (readFlights.get(key) === run as unknown) readFlights.delete(key)
  }
}

/**
 * Drop the coalescing window (call after any successful mutation).
 *
 * 连在飞的读一起作废：只清窗口的话，那些请求回来仍会写进去，界面上就出现「改完又被旧值盖回去」。
 */
export function invalidateReadCoalescing(): void {
  readGeneration += 1
  // 在飞的读不再共享（新的读必须自己去问宿主），它们回来的结果也不写进窗口。
  readFlights.clear()
  readRecent.clear()
}
