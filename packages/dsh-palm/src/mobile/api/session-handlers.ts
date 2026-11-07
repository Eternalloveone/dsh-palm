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
import { bumpQueueRevision } from '../../host/queue-inbox.ts'
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
}

/** 从 payload 里取 sessionId（取不到就返回 undefined）。 */
function sessionIdOf(payload: unknown): string | undefined {
  const id = (payload as { sessionId?: unknown } | undefined)?.sessionId
  return typeof id === 'string' ? id : undefined
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

/** 发消息：搜索索引失效 + 队列版本 +1（手机端乐观排队项据此退场）。 */
export async function sessionPrompt(ctx: SessionHandlerContext): Promise<unknown> {
  const sessionId = sessionIdOf(ctx.payload)
  ctx.invalidateSessionSearch()
  const reply = await ctx.apiProxy.sessions.prompt(ctx.request as never)
  if (sessionId !== undefined) bumpQueueRevision(sessionId)
  return wrap(ctx.rpcId, reply)
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
  return wrap(ctx.rpcId, reply)
}
