/**
 * **同一次页面生命周期里"这一场刚同步过、之后没有新帧"的账本**（2026-11-14）。
 *
 * 为什么需要：切会话是这台手机上最频繁的动作（A → B → A 一分钟能来回好几次），
 * 而每次进会话都要重新问宿主拿同一份尾页 —— 真机实测那次读取在宿主单线程里要
 * 500~900ms（解 zstd 帧 + 折叠 40 行），恰好在用户最在意"点了要多久出来"的位置。
 *
 * 判据只有一条：**这条 mux 流在同步之后没有再给过这一场的任何帧**。
 * 连接是活的、事件是流式推的 —— 真有什么新内容，它一定会先落成一条帧；
 * 帧没来，说明内容确实没变，本地那份就是当前状态。
 *
 * 三条保守约束（缺一不可，宁可多读一次也不许显示旧内容）：
 *   1. 只在**同一次页面生命周期**内生效：账本在内存里，刷新页面即清零
 *      （跨刷新的"上次同步时刻"不可信，`Date.now()` 也可能被系统时钟跳变污染）；
 *   2. 超过 {@link SYNC_TRUST_MS} 就不再信任，重新问宿主一次；
 *   3. 收到这一场的任何帧就作废。
 *
 * @module dsh-palm/mobile/session/chat-sync-ledger
 */

/** 账本多久之后不再可信（毫秒）。 */
export const SYNC_TRUST_MS = 120_000

interface LedgerEntry {
  /** 网络页落到本地的时间。 */
  syncedAt: number
  /** 同步之后收到的帧数：非 0 表示内容可能已经变了。 */
  framesSinceSync: number
}

const entries = new Map<string, LedgerEntry>()
/** 上限：只服务"最近来回切的那几场"。 */
const MAX_ENTRIES = 16

/** 记下这一场刚刚从网络同步过（行已落地）。 */
export function noteChatSynced(sessionId: string, at: number = Date.now()): void {
  if (sessionId === '') return
  entries.delete(sessionId)
  entries.set(sessionId, { syncedAt: at, framesSinceSync: 0 })
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next()
    if (oldest.done === true) break
    entries.delete(oldest.value)
  }
}

/** 记下这一场来了一帧（内容可能已变，本地那份不再可信）。 */
export function noteChatFrame(sessionId: string): void {
  const entry = entries.get(sessionId)
  if (entry === undefined) return
  entry.framesSinceSync += 1
}

/**
 * 这一次进会话能不能直接用手上那份、跳过网络重取。
 *
 * @param sessionId - 会话 id
 * @param now - 当前时间（毫秒），注入便于测试
 * @returns true = 刚同步过且之后没有新帧（可以直接用本地行）
 */
export function canSkipEntryRead(sessionId: string, now: number = Date.now()): boolean {
  if (sessionId === '') return false
  const entry = entries.get(sessionId)
  if (entry === undefined) return false
  if (entry.framesSinceSync > 0) return false
  const age = now - entry.syncedAt
  return age >= 0 && age <= SYNC_TRUST_MS
}

/** 测试用：清空账本（模块级状态会跨用例存活）。 */
export function resetChatSyncLedger(): void {
  entries.clear()
}
