/**
 * Intent 内核（W3-6）：**一次用户意图只投递一次**。
 *
 * 病灶：`send()` 里有两道手写闸门 —— 一个 `sendInFlightRef` 时间戳、一个
 * `lastSubmitRef` 的「同会话同正文 1.5 秒内算同一次」。它们散在 hook 的 ref 里，
 * 既没法单独测试，也容易被下一个改发送逻辑的人漏掉（真机截图：排队条上两条
 * 一模一样的消息）。这里把它们收成**一个可注入时钟的状态机**，语义只此一份。
 *
 * 三道判据（顺序即优先级）：
 * 1. `inflight` —— 上一次提交还在窗口内（默认 30 秒，覆盖一次网络往返 + 宿主接单）；
 * 2. `duplicate` —— 同一会话、同一段正文在 1.5 秒内重复提交（用户在等反馈，又点了一下）；
 * 3. 其余一律 `accept`，并在同一次调用里记账。
 *
 * 为什么用"提交账本"而不是布尔量：判据 2 需要正文作为键，只记 `true/false` 表达不了。
 *
 * @module dsh-palm/mobile/kernels/intent
 */

/** 一次提交尝试的结论。 */
export type SubmitVerdict = 'accept' | 'inflight' | 'duplicate'

export interface SubmitLedgerOptions {
  /** 在途窗口：这段时间内任何再次提交都拒（毫秒）。 */
  inflightMs?: number
  /** 同正文去重窗口（毫秒）。 */
  dedupeMs?: number
  /** 注入时钟（测试用，默认 `Date.now`）。 */
  now?: () => number
}

export interface SubmitLedger {
  /**
   * 尝试提交一次意图。
   *
   * @param key - 作用域键（通常是会话 id）；不同会话互不影响
   * @param text - 正文；空串表示"只有附件"，不参与去重判据
   */
  attempt(key: string, text: string): SubmitVerdict
  /** 上一次提交已经落定（成功或失败都算）：解除在途封锁。 */
  settle(): void
  /** 换会话/登出：全部清零。 */
  reset(): void
}

/** 默认在途窗口：一次网络往返 + 宿主接单的余量。 */
export const SUBMIT_INFLIGHT_MS = 30_000
/** 默认同正文去重窗口。 */
export const SUBMIT_DEDUPE_MS = 1_500

/**
 * 造一个提交账本。
 *
 * @param options - 窗口大小与时钟注入
 */
export function createSubmitLedger(options: SubmitLedgerOptions = {}): SubmitLedger {
  const inflightMs = options.inflightMs ?? SUBMIT_INFLIGHT_MS
  const dedupeMs = options.dedupeMs ?? SUBMIT_DEDUPE_MS
  const now = options.now ?? (() => Date.now())
  let inflightAt = 0
  let last: { stamp: string; at: number } = { stamp: '', at: 0 }

  return {
    attempt(key: string, text: string): SubmitVerdict {
      const at = now()
      if (inflightAt !== 0 && at - inflightAt < inflightMs) return 'inflight'
      const stamp = `${key}\u0000${text}`
      if (text !== '' && last.stamp === stamp && at - last.at < dedupeMs) return 'duplicate'
      // 记账发生在**通过判据之后**：被拒的尝试不能刷新窗口，否则连点会把封锁越推越远。
      inflightAt = at
      last = { stamp, at }
      return 'accept'
    },
    settle(): void {
      inflightAt = 0
    },
    reset(): void {
      inflightAt = 0
      last = { stamp: '', at: 0 }
    },
  }
}
