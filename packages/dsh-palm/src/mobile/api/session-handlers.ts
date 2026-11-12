/**
 * session 域的常规处理器（P2：逐方法外移，原位调用）。
 *
 * 这里的 9 个方法都很薄：转发给宿主 ApiProxy + 套应答外壳，
 * 少数几个在写操作后让相关缓存失效（否则手机上要等下个 TTL 才看到变化）。
 *
 * `session.list`（114 行，含花名册枚举与分页合成）单独在别处搬。
 *
 * @module dsh-palm/mobile/api/session-handlers
 */
import type { ApiProxy } from '../../api-proxy-types.ts'
import { bumpQueueRevision, rememberRequestBody } from '../../host/queue-inbox.ts'
import { rememberAccepted, wasAccepted } from '../../host/delivery-ledger.ts'
import { wrap } from './wrap.ts'

/** 会话处理器需要的最小上下文。 */
export interface SessionHandlerContext {
  apiProxy: ApiProxy
  rpcId: string
  request: unknown
  payload?: unknown
  signal?: AbortSignal
  /** 写操作后清花名册缓存（闭包函数，经 ctx 传入以避免反向依赖）。 */
  invalidateRosterCaches: () => void
  /** 写操作后清会话搜索索引。 */
  invalidateSessionSearch: () => void
  /**
   * 写操作之后读一次**权威队列**（方案 A：读己之写，2026-11-10）。
   *
   * 宿主不发队列变更事件（只发会滞后的 inbox 投影），手机端过去只能靠
   * 乐观项 + TTL + 正文比对去猜。写操作的 RPC 是我们自己的，返回前直接读一次
   * 活 agent 的内存 inbox（`liveInboxOf`，同步、无缓存），客户端拿到就能定论。
   *
   * 缺省（未装 agents 服务 / 测试环境）时返回 undefined，响应保持原样 —— 老宿主兼容。
   * **读不到活 agent 时也必须返回 undefined**（而不是"空队列 + 新版本"）：空的权威应答
   * 会把排队条清空并锁住版本栅栏，真机上就是「排队条要退出重进才出现」
   * （2026-11-11，见 `queueVersionForRead` 的注释）。
   */
  readQueue?: ((sessionId: string) => { items: readonly unknown[]; version: number } | undefined) | undefined
}

/** 从 payload 里取 sessionId（取不到就返回 undefined）。 */
function sessionIdOf(payload: unknown): string | undefined {
  const id = (payload as { sessionId?: unknown } | undefined)?.sessionId
  return typeof id === 'string' ? id : undefined
}

/** 从 payload 里取投递身份（客户端生成的 `requestId`）。 */
function requestIdOf(payload: unknown): string | undefined {
  const id = (payload as { requestId?: unknown } | undefined)?.requestId
  return typeof id === 'string' && id !== '' ? id : undefined
}

/** 新建会话：花名册与列表都会变，缓存要失效。 */
export async function sessionCreate(ctx: SessionHandlerContext): Promise<unknown> {
  ctx.invalidateRosterCaches()
  return wrap(ctx.rpcId, await ctx.apiProxy.sessions.create(ctx.request as never))
}

/** 会话历史。 */
export async function sessionHistory(ctx: SessionHandlerContext): Promise<unknown> {
  return wrap(ctx.rpcId, await ctx.apiProxy.sessions.history(ctx.request as never))
}

/** 会话内搜索（可被客户端中断）。 */
export async function sessionSearch(ctx: SessionHandlerContext): Promise<unknown> {
  const signal = ctx.signal ?? new AbortController().signal
  return wrap(ctx.rpcId, await ctx.apiProxy.sessions.search(ctx.request as never, signal))
}

/**
 * 发消息：搜索索引失效 + 队列版本 +1（手机端乐观排队项据此退场）。
 *
 * 2026-11-11 补上**投递身份桥**：`rememberRequestBody` 早就写好了却从没被调用，
 * 于是队列行永远带不上客户端的 `requestId`，而客户端的送达核实只认身份
 * （`probeQueueForRequest`）—— 核实必然说"没有"，8 秒后判成"没送到"，
 * 真机上就是「提示发送失败、内容回退到输入框」，可那条其实已经排队成功。
 *
 * 做法：投递前后各读一次队列，按 id 取差集 —— 新冒出来的那一行就是这次投递的宿主行。
 */
export async function sessionPrompt(ctx: SessionHandlerContext): Promise<unknown> {
  const sessionId = sessionIdOf(ctx.payload)
  const requestId = requestIdOf(ctx.payload)
  ctx.invalidateSessionSearch()
  const before = sessionId !== undefined && requestId !== undefined ? ctx.readQueue?.(sessionId) : undefined
  const reply = await ctx.apiProxy.sessions.prompt(ctx.request as never)
  /*
   * **受理事实**（2026-11-12）：prompt 成功返回 = 宿主已经收下这条消息。
   * 手机端之后不必再靠"队列里有没有 / 尾部 60 行里有没有"去推断 —— 直接问这笔账。
   * 这是整套送达判断里唯一一条**不是猜**的证据。
   */
  if (sessionId !== undefined && requestId !== undefined) rememberAccepted(sessionId, requestId)
  if (sessionId !== undefined) bumpQueueRevision(sessionId)
  if (sessionId !== undefined && requestId !== undefined && before !== undefined) {
    const after = ctx.readQueue?.(sessionId)
    if (after !== undefined) {
      const known = new Set(before.items.map(row => (row as { id?: unknown }).id))
      const added = after.items.filter(row => !known.has((row as { id?: unknown }).id))
      rememberRequestBody(added.map(row => [requestId, String((row as { id?: unknown }).id ?? '')]))
    }
  }
  return wrap(ctx.rpcId, attachQueue(reply, sessionId, ctx))
}

/**
 * 这笔投递宿主受理过没有。
 *
 * 2026-11-12 用户：「已经发送完了，排队消息还会撤回到发送框」→「动」。
 * 客户端核实送达时**先问这里**，问到 `accepted: true` 就不再往下猜队列和正文尾部。
 * 没记过（宿主重启过、或者真的没送到）返回 `accepted: false` —— 那是"不知道"，
 * 调用方按 unknown 处理，不会把正文放回输入框。
 */
export async function sessionDeliveryCheck(ctx: SessionHandlerContext): Promise<unknown> {
  const sessionId = sessionIdOf(ctx.payload)
  const requestId = requestIdOf(ctx.payload)
  const accepted = sessionId !== undefined && requestId !== undefined && wasAccepted(sessionId, requestId)
  return wrap(ctx.rpcId, { result: { accepted } })
}

/** 可选模型清单。 */
export async function sessionModels(ctx: SessionHandlerContext): Promise<unknown> {
  return wrap(ctx.rpcId, await ctx.apiProxy.sessions.models(ctx.request as never))
}

/** 选模型。 */
export async function sessionSelectModel(ctx: SessionHandlerContext): Promise<unknown> {
  return wrap(ctx.rpcId, await ctx.apiProxy.sessions.selectModel(ctx.request as never))
}

/** 重命名：列表标题来自投影，缓存要失效。 */
export async function sessionRename(ctx: SessionHandlerContext): Promise<unknown> {
  ctx.invalidateRosterCaches()
  return wrap(ctx.rpcId, await ctx.apiProxy.sessions.rename(ctx.request as never))
}

/** 取消当前回合。 */
export async function sessionCancel(ctx: SessionHandlerContext): Promise<unknown> {
  return wrap(ctx.rpcId, await ctx.apiProxy.sessions.cancel(ctx.request as never))
}

/** 改队列：编辑/删除/插队都会让队列换代，版本号 +1。 */
export async function sessionUpdateQueue(ctx: SessionHandlerContext): Promise<unknown> {
  const sessionId = sessionIdOf(ctx.payload)
  const reply = await ctx.apiProxy.sessions.updateQueue(ctx.request as never)
  if (sessionId !== undefined) bumpQueueRevision(sessionId)
  return wrap(ctx.rpcId, attachQueue(reply, sessionId, ctx))
}

/**
 * 把**权威队列**挂到写操作的应答里（方案 A 的核心，2026-11-10）。
 *
 * 宿主的 inbox 投影会滞后，手机端过去只能自己猜（乐观项 + TTL + 正文比对）。
 * 写操作是我们经手的，返回前直接读一次活 agent 的内存 inbox，客户端拿到就是定论。
 *
 * 只在"宿主应答带 `result.value` 对象"时附加：老宿主/异常形状原样返回，不做兼容猜测。
 */
function attachQueue(
  reply: { result: unknown },
  sessionId: string | undefined,
  ctx: SessionHandlerContext,
): { result: unknown } {
  if (sessionId === undefined || ctx.readQueue === undefined) return reply
  const fresh = ctx.readQueue(sessionId)
  // 读不到活 agent（没有可冒充权威的来源）：应答保持原样，客户端继续用快照收敛。
  // 绝不能在这里塞 `queue: []` —— 那会把排队条清空并锁住版本栅栏（2026-11-11）。
  if (fresh === undefined) return reply
  const result = reply.result as { value?: unknown } | null | undefined
  const value = result?.value
  if (value === null || typeof value !== 'object') return reply
  return {
    ...reply,
    result: {
      ...result,
      value: { ...(value as Record<string, unknown>), queue: fresh.items, queueVersion: fresh.version },
    },
  }
}
