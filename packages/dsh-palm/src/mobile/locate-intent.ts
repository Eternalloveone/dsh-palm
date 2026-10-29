/**
 * 搜索定位的一次性意图：从「工作区首页搜索」点中一条命中开始，到这里被聊天页
 * 消费为止。
 *
 * 为什么不靠 props 往下传：这条链路要穿过 首页 → 路由 → 工作区 → 会话列表 → 聊天页
 * 五层（还会经过转场里的双实例、以及「同一路由重挂载」）。任何一层丢字段，
 * 表现都是「进去了、也滚了，但一个字都没高亮」——实测就是这么丢的。这里改成
 * 一个模块级、按 sessionId 取用的短时意图：谁挂载谁读，读到就用，成功后清掉。
 */

export type LocateIntent = {
  sessionId: string
  /** 命中所在的 event seq（索引里的锚点）。 */
  seq?: number
  /** 稳定消息 id（宿主 wire id）。 */
  messageId?: string
  /** 文本片段 id，用于在一行之内定位到具体那一段。 */
  partId?: string
  /** 命中关键词：没有它就没有高亮，定位只剩「滚到附近」。 */
  query?: string
  /** 写入时刻，用于过期丢弃（一次点击不该影响一分钟后的普通打开）。 */
  at: number
}

/** 一次点击的意图最多活这么久：超过就当作普通打开会话。 */
export const LOCATE_INTENT_TTL_MS = 20_000

/** 记录每个意图被消费的时刻与续期次数（防「一次搜索影响之后每次进会话」）。 */
interface IntentMeta {
  consumedAt?: number
  renewals: number
}

const INTENTS = new Map<string, LocateIntent>()
const META = new Map<string, IntentMeta>()

/** 已消费的意图还能被「转场里的第二个实例」复用多久。 */
export const LOCATE_CONSUMED_REUSE_MS = 2_000
/**
 * 续期上限（40 × 5s ≈ 200 秒）。
 *
 * 为什么是这个量级：冷启动 / 大会话的首屏实测 40~160 秒，等待期间必须能续命（否则页
 * 到了、意图已过期，只剩滚动没有高亮）。但也要有上限 —— 一页永远回不来时，不能无限续。
 */
export const LOCATE_MAX_RENEWALS = 40

/** 记下一次定位意图（覆盖同会话的上一条）。 */
export function rememberLocateIntent(intent: Omit<LocateIntent, 'at'>): void {
  INTENTS.set(intent.sessionId, { ...intent, at: Date.now() })
  META.set(intent.sessionId, { renewals: 0 })
}

/**
 * 取这个会话当前的定位意图。**不消费**：转场里聊天页可能挂载两次，消费式读取
 * 会让真正显示的那一次拿不到；清理交给 {@link clearLocateIntent}。
 */
export function locateIntentFor(sessionId: string): LocateIntent | undefined {
  const found = INTENTS.get(sessionId)
  if (found === undefined) return undefined
  const meta = META.get(sessionId)
  // 已经消费过、而且不止一次挂载的时间窗：不再复用。
  // 真机（2026-10-29）：做完一次搜索定位之后再正常点进这个会话，首屏会直接取
  // 「命中那一页」——表现就是「一进会话自动跳到很老的一轮」。
  if (meta?.consumedAt !== undefined && Date.now() - meta.consumedAt > LOCATE_CONSUMED_REUSE_MS) {
    INTENTS.delete(sessionId)
    META.delete(sessionId)
    return undefined
  }
  if (Date.now() - found.at > LOCATE_INTENT_TTL_MS) {
    INTENTS.delete(sessionId)
    META.delete(sessionId)
    return undefined
  }
  return found
}

/**
 * 取用并标记「已消费」。一进会话就该调用一次：之后同一意图只能再被转场里的
 * 第二个实例复用（{@link LOCATE_CONSUMED_REUSE_MS} 之内）。
 */
export function takeLocateIntent(sessionId: string): LocateIntent | undefined {
  const intent = locateIntentFor(sessionId)
  if (intent === undefined) return undefined
  const meta = META.get(sessionId)
  META.set(sessionId, { renewals: meta?.renewals ?? 0, consumedAt: Date.now() })
  return intent
}

/** 定位完成（用户确实看到高亮）或放弃后清掉，别让它影响下一次普通打开。 */
export function clearLocateIntent(sessionId: string): void {
  INTENTS.delete(sessionId)
  META.delete(sessionId)
}

/**
 * 续期：意图的 TTL 是「20 秒没人管」，不是「20 秒内必须做完」。
 *
 * 为什么需要：冷启动或大会话（几千条、几十 MB）的首屏实测 40~160 秒才回来，
 * 而 TTL 只有 20 秒——页到了、意图已经过期，结果就是「滚到了附近，但一个字都不
 * 高亮」。聊天页在等这一页的时候每 5 秒续一次，落地就停，TTL 的初衷（别影响
 * 之后的普通打开）仍然成立。
 */
export function touchLocateIntent(sessionId: string): void {
  const found = INTENTS.get(sessionId)
  if (found === undefined) return
  const meta = META.get(sessionId) ?? { renewals: 0 }
  // 有上限：一页永远读不回来时，意图不能跟着无限续命。
  if (meta.renewals >= LOCATE_MAX_RENEWALS) return
  meta.renewals += 1
  META.set(sessionId, meta)
  found.at = Date.now()
}

/**
 * 卸载后留一点宽限再清。转场里聊天页会「旧实例卸载、新实例挂载」几乎同时发生，
 * 卸载即清会让真正显示的那一次拿不到意图（早先就是这么把高亮清没的）。
 */
export const LOCATE_INTENT_LINGER_MS = 2_000

const PENDING_CLEARS = new Map<string, ReturnType<typeof setTimeout>>()

/** 聊天页挂载（或换会话）：取消待清理，别把刚到手的意图清掉。 */
export function holdLocateIntent(sessionId: string): void {
  const pending = PENDING_CLEARS.get(sessionId)
  if (pending === undefined) return
  clearTimeout(pending)
  PENDING_CLEARS.delete(sessionId)
}

/** 聊天页卸载（离开聊天）：宽限到期就清，绝不残留到下一次普通打开。 */
export function releaseLocateIntent(sessionId: string): void {
  holdLocateIntent(sessionId)
  PENDING_CLEARS.set(sessionId, setTimeout(() => {
    PENDING_CLEARS.delete(sessionId)
    clearLocateIntent(sessionId)
  }, LOCATE_INTENT_LINGER_MS))
}

/** 只给测试用：清空意图与元数据（含待清理的定时器）。 */
export function resetLocateIntentsForTest(): void {
  INTENTS.clear()
  META.clear()
  for (const timer of PENDING_CLEARS.values()) clearTimeout(timer)
  PENDING_CLEARS.clear()
}
