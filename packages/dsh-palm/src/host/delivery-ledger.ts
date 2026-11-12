/**
 * 投递账本：宿主**确认受理**过的 `requestId`。
 *
 * 为什么需要（2026-11-12 用户：「已经发送完了，排队消息还会撤回到发送框」→「动」）：
 *
 * 手机端判断"这条发出去没有"一直是**猜**：读队列（消息可能已被消费）、读会话尾部
 * 60 行（消息可能被后续几十行工具输出顶出窗口）。两个都找不到就判失败、把正文放回
 * 输入框 —— 而它其实早就进会话了。前一次修的是"别把没找到当没送到"，那是把误判
 * 概率压小；真正的解法是**让宿主在被受理的那一刻记一笔**，手机端来问这一笔。
 *
 * 记账点只有一个：`session.prompt` 成功返回时。这一笔记的是事实，不是推断：
 * 只要它存在，那条消息就一定进了宿主。
 *
 * 边界：
 * - 只记 `sessionId + requestId`，不记正文，不落盘（重启后回到"不知道"，
 *   调用方拿到 unknown 时**不会**回撤）。
 * - 有 TTL 和容量上限，长时间运行不会无限长。
 *
 * @module dsh-palm/host/delivery-ledger
 */

/** 一条记录多久之后不再回答（毫秒）。核实窗口是 25 秒，10 分钟足够宽。 */
export const DELIVERY_LEDGER_TTL_MS = 10 * 60_000

/** 最多记多少条（超出按插入顺序淘汰最旧的）。 */
export const DELIVERY_LEDGER_MAX = 500

interface AcceptedEntry {
  at: number
}

const accepted = new Map<string, AcceptedEntry>()

const keyOf = (sessionId: string, requestId: string): string => `${sessionId}\u0000${requestId}`

/**
 * 记一次"宿主已受理"。
 *
 * @param sessionId - 会话 id
 * @param requestId - 客户端生成的投递 id
 * @param now - 当前时间（测试注入）
 */
export function rememberAccepted(sessionId: string, requestId: string, now: number = Date.now()): void {
  if (sessionId === '' || requestId === '') return
  accepted.set(keyOf(sessionId, requestId), { at: now })
  // 超量：从最旧的删起（Map 保插入顺序）。
  while (accepted.size > DELIVERY_LEDGER_MAX) {
    const oldest = accepted.keys().next()
    if (oldest.done === true) break
    accepted.delete(oldest.value)
  }
}

/**
 * 这笔投递是不是宿主明确受理过。
 *
 * @param sessionId - 会话 id
 * @param requestId - 客户端生成的投递 id
 * @param now - 当前时间（测试注入）
 * @returns 受理过返回 true；没记过、或已过期返回 false
 */
export function wasAccepted(sessionId: string, requestId: string, now: number = Date.now()): boolean {
  const entry = accepted.get(keyOf(sessionId, requestId))
  if (entry === undefined) return false
  if (now - entry.at > DELIVERY_LEDGER_TTL_MS) {
    accepted.delete(keyOf(sessionId, requestId))
    return false
  }
  return true
}

/** 清空（只给测试用，别在生产路径里调）。 */
export function resetDeliveryLedger(): void {
  accepted.clear()
}
