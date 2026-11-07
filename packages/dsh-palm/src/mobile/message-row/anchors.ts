/**
 * 轮次锚点记忆：一轮的起点**只可能变早、不会变晚**。
 *
 * 从 message-row.tsx 拆出来（W2-3）：这里全是纯逻辑 + sessionStorage，和渲染无关，
 * 单独一处才好为它写测试，也不让 MessageRow 的依赖面继续膨胀。
 *
 * 真机（2026-11-02 / 11-03 反复出现）：过程条计时从「5分10秒」突然跳回「1分20秒」，
 * 然后从小往大长。原因是重连/翻页/换页之后 `turnStartAt` 被重新算成"窗口里第一条
 * 事件的时间"，比真实起点晚了几分钟。
 *
 * 前两次修法都不够：① 行内 ref —— 行会在 turn/step 到位时**卸载重挂**，记忆跟着丢；
 * ② 只拦 30 秒以上跳变 —— 重挂之后新锚点照样生效。
 *
 * 现在：记忆按「会话 + 轮次」落在 **sessionStorage**，跨行、跨重挂、跨刷新都在，
 * 同一轮一律取**见过的最早**锚点（几秒级的校准也一并挡住 —— 一轮的起点是既成事实，
 * 没有任何"变晚"是合法的）。回合结束后清掉。
 *
 * @module dsh-palm/mobile/message-row/anchors
 */

/** / 重生成按钮的三态：待点、已发出、发出失败。 */
export type RegenerateState = 'idle' | 'busy' | 'failed'

const TURN_ANCHOR_PREFIX = 'dsh-palm.turn-anchor.v1.'
/** 锚点最多记这么久（一轮再长也不至于 6 小时）。 */
const TURN_ANCHOR_TTL_MS = 6 * 60 * 60_000

function anchorStorage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

/**
 * 取这一轮**见过的最早**锚点，并把更早的值记下来。
 * @param key - `${sessionId}:${turn}`。
 * @param candidate - 本次渲染拿到的宿主锚点。
 */
export function stableTurnAnchor(key: string, candidate: number | undefined): number | undefined {
  if (candidate === undefined) return undefined
  const store = anchorStorage()
  if (store === undefined) return candidate
  const storageKey = TURN_ANCHOR_PREFIX + key
  let previous: number | undefined
  try {
    const raw = store.getItem(storageKey)
    const parsed = raw === null ? Number.NaN : Number(raw)
    if (Number.isFinite(parsed) && candidate - parsed < TURN_ANCHOR_TTL_MS && candidate - parsed > -TURN_ANCHOR_TTL_MS) {
      previous = parsed
    }
  } catch {
    previous = undefined
  }
  const kept = previous === undefined ? candidate : Math.min(previous, candidate)
  if (kept !== previous) {
    try { store.setItem(storageKey, String(kept)) } catch { /* 配额满：退回不记忆 */ }
  }
  return kept
}

/** 测试用：清掉所有锚点记忆。 */
export function resetTurnAnchors(): void {
  const store = anchorStorage()
  if (store === undefined) return
  try {
    const keys = Object.keys(store).filter(key => key.startsWith(TURN_ANCHOR_PREFIX))
    for (const key of keys) store.removeItem(key)
  } catch { /* 忽略 */ }
}

/** 回合收工时清掉这一轮的锚点记忆。 */
export function forgetTurnAnchor(key: string): void {
  try { anchorStorage()?.removeItem(TURN_ANCHOR_PREFIX + key) } catch { /* 忽略 */ }
}
