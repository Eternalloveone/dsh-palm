/**
 * 首屏自适应窗口：按「上次进会话多久出内容」在 512 KB / 2 MB 之间选尾部读取窗口。
 *
 * 背景：首屏一次读够（2 MB 尾窗）能减少"先短后长"的补页，但超长会话在弱设备上
 * 读 2 MB 明显更慢（实测 628d：2 MB → 1.7s，512 KB → 0.7s）。所以：
 *
 *   · 默认 **512 KB**（先快出内容；"历史全在"由本地缓存负责，不靠网络页）
 *   · 只有实测够快（上次 ≤ 800ms）才放宽到 **2 MB**
 *
 * 取最近 3 次的平均，避免一次抖动就来回切。状态存 localStorage，跨刷新生效。
 *
 * @module dsh-palm/mobile/entry-perf
 */

const STORAGE_NAME = 'dsh-palm.entry-perf.v1'
/** 保留最近几次首屏耗时。 */
const KEEP = 3
/** 超过这个耗时就用保守窗口（保留给文档/测试引用）。 */
export const ENTRY_SLOW_MS = 1200
/** 只有平均耗时 ≤ 这个值，才放宽到 2 MB 尾窗。 */
export const ENTRY_FAST_MS = 800
/** 宽松窗口：一次尽量拿全。 */
export const TAIL_WINDOW_WIDE_BYTES = 2 * 1024 * 1024
/** 保守窗口：先保证出内容快。 */
export const TAIL_WINDOW_NARROW_BYTES = 512 * 1024

let latencies: number[] | undefined

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function load(): number[] {
  if (latencies !== undefined) return latencies
  const store = storage()
  if (store === undefined) {
    latencies = []
    return latencies
  }
  try {
    const raw = store.getItem(STORAGE_NAME)
    const parsed = raw === null ? [] : JSON.parse(raw)
    latencies = Array.isArray(parsed)
      ? parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).slice(-KEEP)
      : []
  } catch {
    latencies = []
  }
  return latencies
}

/** 记一次首屏耗时（毫秒）。 */
export function rememberEntryLatency(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return
  const next = [...load(), Math.round(ms)].slice(-KEEP)
  latencies = next
  try {
    storage()?.setItem(STORAGE_NAME, JSON.stringify(next))
  } catch {
    // 存不了就算了：内存里这份本次会话仍然有效。
  }
}

/** 这一台设备现在该用多宽的尾部窗口。 */
export function preferredTailWindowBytes(): number {
  const seen = load()
  if (seen.length === 0) return TAIL_WINDOW_NARROW_BYTES
  const average = seen.reduce((sum, value) => sum + value, 0) / seen.length
  // 只有"确实快"才放宽；慢一点就守住窄窗口。
  return average <= ENTRY_FAST_MS ? TAIL_WINDOW_WIDE_BYTES : TAIL_WINDOW_NARROW_BYTES
}

/** 测试用：清空。 */
export function resetEntryPerfForTest(): void {
  latencies = undefined
  try {
    storage()?.removeItem(STORAGE_NAME)
  } catch {
    // ignore
  }
}
