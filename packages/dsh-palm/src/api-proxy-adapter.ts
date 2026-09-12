/**
 * dsh-palm 适配层主体：把 0.1.5-rc.1 的 host controllers 包装成旧 `apiProxy` 形状。
 *
 * dsh-palm 是 host 插件，运行在 host 进程，只能用 host 侧 service
 * （`ctx.sessionController` / `ctx.workspaceController` / `ctx.settingsController` /
 * `ctx.agentPresets` / `ctx.subagents`），不能用浏览器 client 的 `ctx.remote`。
 *
 * 统一 helper `call<T>(rpcId, fn)` 把 `Promise<value>` 包成旧 `{ rpcId, result: { ok, value } }`
 * 信封，catch RemoteError → `{ ok: false, error }`。dsh-palm 其余代码（mobile-api.ts 的
 * dispatch 等）无需感知新架构。
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { WorkspaceController } from '@deepseek-ai/dsh-api-workspace-controller'
import type { SettingsController } from '@deepseek-ai/dsh-api-settings-controller'
import type { AgentPresets } from '@deepseek-ai/dsh-agent-presets'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
// 加载 approval/question 事件的 cordis Events 模块增强（使 `keyof Events` 含这些事件）。
import type {} from '@deepseek-ai/dsh-user-approval/types'
import type {} from '@deepseek-ai/dsh-user-questions/types'
import type {
  ApiProxy,
  RpcRequest,
  RpcResponse,
  RpcError,
  RpcErrorCode,
  RpcReceipt,
  ClientResponse,
  SessionModels,
  SessionSummary,
  SessionSearchItem,
  SessionProjectionsBlock,
  HistoryEntry,
  WorkspaceView,
  AgentPresetEntry,
  SubagentCatalog,
  SettingsNamespaceView,
  MuxFrame,
  ApprovalOutcome,
} from './api-proxy-types.ts'
import { RpcId } from './api-proxy-types.ts'
import { HistoryAdapter } from './api-proxy-history.ts'
import { WorkspaceListAdapter } from './api-proxy-workspace.ts'
import { MuxBroadcast, setupMuxSources } from './api-proxy-mux.ts'
import { setupAssistantStream } from './api-proxy-stream.ts'
import type { SessionObserverRegistry } from './api-proxy-observe.ts'
import type { DependencyCheck, DependencyDiagnostics } from './api-proxy-diag.ts'

/** 已读图片的缓存上限（每张最大约 256 KiB base64，够一屏来回滚动复用）。 */
const ATTACHMENT_CACHE_LIMIT = 16

/**
 * 手机应答里带的审批结论（值跨线到达，形状必须防御性解析）。解析不出时按
 * "允许一次" 记：这条帧只用来让各方把面板撤下，结论本身不参与宿主决策。
 */
function answerOutcomeOf(value: unknown): ApprovalOutcome {
  const outcome = (value as { outcome?: unknown } | null | undefined)?.outcome
  return outcome === 'allowed-once' || outcome === 'rejected' || outcome === 'cancelled' || outcome === 'unavailable'
    ? outcome
    : 'allowed-once'
}

/** 适配层：在 ApiProxy 之上暴露内部钩子（手机在线状态、图片附件、dispose）。 */
export interface ApiProxyAdapter extends ApiProxy {
  /** 手机 SSE 订阅数变化时由 mobile-api 的 SSE 桥调用。 */
  setPhoneConnected(connected: boolean): void
  /**
   * 读一张会话里引用过的图片，返回可直接放进 `<img src>` 的 data URL。
   *
   * 0.1.5 起图片字节不在会话事件里（事件只带 `attachmentId` 引用），宿主按
   * "该会话确实引用过这张图"授权后才给字节（session-controller commands.ts:383
   * 的 `attachment()`）。attachmentId 是内容寻址的 sha256，同一张图永远同一 id，
   * 所以这里按 id 长期缓存——重进会话不必再过一次隧道。
   * @param sessionId - 授权与校验引用关系的会话。
   * @param attachmentId - 事件里折出来的附件 id。
   * @returns 媒体类型与 data URL。
   */
  readAttachment(sessionId: string, attachmentId: string): Promise<{ mediaType: string; dataUrl: string }>
  /** 插件 dispose 时清理 follow 流、mux 源、事件监听。 */
  dispose(): void
}

/** 一条已转发给手机、正在等应答的审批（宿主 approval/request waterfall 被它挡住）。 */
interface PendingApprovalRequest {
  sessionId: string
  approvalId: string
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

/** 一条已转发给手机、正在等应答的问题批次（同样是被 waterfall 挡住的一次 ask）。 */
interface PendingQuestionRequest {
  sessionId: string
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

/**
 * 构造适配层。ctx 需已装配 host controllers（web-app bundle 提供）。
 */
export function makeApiProxyAdapter(
  ctx: Context,
  observers: SessionObserverRegistry,
  diagnostics: DependencyDiagnostics,
): ApiProxyAdapter {
  const session = ctx.get('sessionController') as SessionController
  const workspace = ctx.get('workspaceController') as WorkspaceController
  const settings = ctx.get('settingsController') as SettingsController
  const agentPresets = ctx.get('agentPresets') as AgentPresets
  const subagents = ctx.get('subagents') as SubagentRuntime

  // 依赖自检（setup 期能证的那部分）：四个 session 方法是否存在。总线订阅的登记
  // 在各自的 setup 里做，运行期帧数由 note() 统计。
  const methodChecks: Array<[string, DependencyCheck['kind']]> = [
    ['session.control', 'event'],
    ['session.follow', 'method'],
    ['session.page', 'method'],
    ['session.list', 'method'],
  ]
  for (const [name, kind] of methodChecks) {
    const method = (session as unknown as Record<string, unknown>)[name.slice('session.'.length)]
    const ok = typeof method === 'function'
    diagnostics.register(name, kind, ok, ok ? undefined : '宿主未提供该方法')
  }

  const history = new HistoryAdapter(session)
  const workspaceList = new WorkspaceListAdapter(workspace)
  const broadcast = new MuxBroadcast()
  const muxSignal = new AbortController()
  const disposeMux = setupMuxSources(ctx, session, broadcast, muxSignal.signal, diagnostics)
  // 手机正在看的会话的 token 级流式：直接订阅宿主 `agent/assistant-stream` 总线
  // （session-controller 自己也是这么消费的，见 api-proxy-stream.ts），
  // 翻译成手机 fold 认识的持久形状事件后走同一个广播。
  const disposeStream = setupAssistantStream({ ctx, broadcast, observers, signal: muxSignal.signal, diagnostics })

  // ── 图片附件读取 ───────────────────────────────────────────────────────
  // 会话事件只带 `attachmentId` 引用（0.1.5 起字节不再内联），宿主按"该会话确实
  // 引用过这张图"授权后才给字节。attachmentId 是内容寻址的 sha256，同一张图永远
  // 同一 id，所以按 id 长期缓存；上限之外的按插入顺序淘汰（LRU 足够，图的复用是
  // 局部的：同一屏来回滚动）。
  const attachmentCache = new Map<string, { mediaType: string; dataUrl: string }>()
  const readAttachment = async (sessionId: string, attachmentId: string): Promise<{ mediaType: string; dataUrl: string }> => {
    const cached = attachmentCache.get(attachmentId)
    if (cached !== undefined) return cached
    const call = (session as unknown as {
      attachment?: (request: { sessionId: string; attachmentId: string }) => Promise<{ attachment: { mediaType?: unknown }; data: unknown }>
    }).attachment
    if (typeof call !== 'function') throw new Error('宿主未提供 session.attachment')
    const result = await call.call(session, { sessionId, attachmentId })
    const mediaType = typeof result?.attachment?.mediaType === 'string' ? result.attachment.mediaType : 'image/jpeg'
    if (typeof result?.data !== 'string' || result.data === '') throw new Error('附件内容为空')
    const value = { mediaType, dataUrl: `data:${mediaType};base64,${result.data}` }
    attachmentCache.set(attachmentId, value)
    if (attachmentCache.size > ATTACHMENT_CACHE_LIMIT) {
      const oldest = attachmentCache.keys().next()
      if (!oldest.done) attachmentCache.delete(oldest.value)
    }
    return value
  }

  // 手机在线状态（SSE 桥报告）。respond 桥接据此决定拦截还是委托。
  let phoneConnected = false
  // 待应答的 approval/question：rpcId → resolve/reject。审批条目另外记住会话与
  // approvalId——应答之后要广播 approval/resolved，把这条审批在所有客户端与宿主
  // tracker 上结掉（见 respond）。
  const pendingApprovals = new Map<string, PendingApprovalRequest>()
  const pendingQuestions = new Map<string, PendingQuestionRequest>()

  // ── respond 桥接：approval ─────────────────────────────────────────────
  // 前置拦截 host 的 approval/request waterfall，转发给手机，返回 Promise 等手机应答。
  // request/next 用宽松类型 + as never 规避 approval 事件类型解析到旧 checkout 的问题。
  const disposeApproval = ctx.on('approval/request', ((request: { agent?: { id: string }; toolName: string; callId?: string; reason?: string }, next: () => Promise<unknown>) => {
    if (!phoneConnected) return next()
    const sessionId = request.agent?.id
    if (sessionId === undefined) return next()
    const rpcId = RpcId(`approval-${randomUUID()}`)
    const approvalId = RpcId(`approval-id-${randomUUID()}`)
    broadcast.emitWithRpcId(rpcId, {
      type: 'approval/requested',
      sessionId: sessionId as never,
      approvalId: approvalId as never,
      toolName: request.toolName,
      ...(request.callId !== undefined ? { callId: request.callId } : {}),
      ...(request.reason !== undefined ? { reason: request.reason } : {}),
    })
    return new Promise<unknown>((resolve, reject) => {
      pendingApprovals.set(rpcId, {
        sessionId,
        approvalId,
        resolve: resolve as (v: unknown) => void,
        reject: reject as (e: unknown) => void,
      })
    })
  }) as never, { prepend: true })

  // ── respond 桥接：question ─────────────────────────────────────────────
  const disposeQuestion = ctx.on('user-questions/request' as never, ((request: { agent?: { id: string }; questions: unknown[] }, next: () => Promise<unknown>) => {
    if (!phoneConnected) return next()
    const sessionId = request.agent?.id
    if (sessionId === undefined) return next()
    const rpcId = RpcId(`question-${randomUUID()}`)
    broadcast.emitWithRpcId(rpcId, {
      type: 'question/requested',
      sessionId: sessionId as never,
      questions: request.questions as never,
    })
    return new Promise<unknown>((resolve, reject) => {
      pendingQuestions.set(rpcId, {
        sessionId,
        resolve: resolve as (v: unknown) => void,
        reject: reject as (e: unknown) => void,
      })
    })
  }) as never, { prepend: true })

  // ── 统一信封 helper ───────────────────────────────────────────────────
  const call = async <T>(rpcId: string, fn: () => Promise<T>): Promise<RpcResponse<T>> => {
    try {
      return { rpcId: RpcId(rpcId), result: { ok: true, value: await fn() } }
    } catch (error) {
      return { rpcId: RpcId(rpcId), result: { ok: false, error: toRpcError(error) } }
    }
  }

  const adapter: ApiProxyAdapter = {
    setPhoneConnected(connected: boolean): void { phoneConnected = connected },
    readAttachment,
    dispose(): void {
      disposeMux()
      disposeStream()
      disposeApproval()
      disposeQuestion()
      muxSignal.abort()
      workspaceList.dispose()
      history.clearAll()
      attachmentCache.clear()
    },

    sessions: {
      list: (request) => call(request.rpcId, () =>
        cast<Promise<{ items: SessionSummary[] }>>(session.list({ cursor: request.payload.cursor }, new AbortController().signal))),
      history: (request) => call(request.rpcId, () =>
        history.page(request.payload) as Promise<{ events: HistoryEntry[]; hasMore: boolean; projections?: SessionProjectionsBlock }>),
      search: (request, signal) => call(request.rpcId, () =>
        cast<Promise<{ items: SessionSearchItem[]; hasMore: boolean }>>(session.search({ query: request.payload.query }, signal ?? new AbortController().signal))),
      create: (request) => call(request.rpcId, () =>
        cast<Promise<{ sessionId: string; agentPreset?: string }>>(session.create(request.payload as never))),
      prompt: (request) => call(request.rpcId, () =>
        cast<Promise<{ accepted: true }>>(session.prompt(
          { requestId: RpcId(`req-${randomUUID()}`) as never, ...request.payload } as never,
          new AbortController().signal,
        ))),
      models: (request) => call(request.rpcId, () =>
        session.modelCatalog().then(toSessionModels)),
      selectModel: (request) => call(request.rpcId, () =>
        cast<Promise<{ selected: { provider: string; model: string; reasoningEffort?: string } }>>(session.selectModel(request.payload as never))),
      rename: (request) => call(request.rpcId, () =>
        cast<Promise<{ title: string; seq: number }>>(session.rename(request.payload as never))),
      cancel: (request) => call(request.rpcId, () =>
        cast<Promise<{ accepted: true }>>(session.cancel(request.payload as never))),
      updateQueue: (request) => call(request.rpcId, () =>
        cast<Promise<{ accepted: true }>>(session.updateQueue(request.payload as never))),
    },

    workspace: {
      list: (request) => call(request.rpcId, () =>
        workspaceList.list() as Promise<{ items: WorkspaceView[]; archivedSessionIds: string[] }>),
      create: (request) => call(request.rpcId, () =>
        cast<Promise<{ workspace: WorkspaceView; created: boolean }>>(workspace.create(request.payload as never))),
      rename: (request) => call(request.rpcId, () =>
        cast<Promise<{ workspace: WorkspaceView }>>(workspace.rename(request.payload as never))),
      delete: (request) => call(request.rpcId, () =>
        cast<Promise<{ deleted: true }>>(workspace.delete(request.payload as never))),
      archiveSession: (request) => call(request.rpcId, () =>
        cast<Promise<{ archivedSessionIds: string[] }>>(workspace.archiveSession(request.payload as never))),
    },

    agentPresets: {
      list: (request) => call(request.rpcId, async () => {
        const roster = await agentPresets.remoteExportList()
        return {
          presets: cast<AgentPresetEntry[]>(roster.presets),
          authorable: roster.authorable,
          // hasDocument 从 roster 移除，改由 settings.canOpenAgentPresetDirectory() 探测。
          hasDocument: settings.canOpenAgentPresetDirectory(),
        }
      }),
    },

    subagents: {
      list: (request, signal) => call(request.rpcId, () =>
        cast<Promise<SubagentCatalog>>(subagents.remoteExportList(request.payload.parentSessionId as never, signal ?? new AbortController().signal))),
    },

    settings: {
      describe: (request) => call(request.rpcId, () =>
        cast<Promise<{ writable: boolean; hasDocument: boolean; namespaces: SettingsNamespaceView[] }>>(settings.describe())),
      mutate: (request) => call(request.rpcId, () =>
        cast<Promise<SettingsNamespaceView>>(settings.mutate(request.payload.ns, request.payload.ops as never, request.payload.expectedRevision))),
    },

    events: {
      mux: (request, signal, accept) => broadcast.subscribe(signal, accept),
    },

    respond: async (message: ClientResponse): Promise<RpcReceipt> => {
      const rpcId = message.rpcId
      const approval = pendingApprovals.get(rpcId)
      if (approval !== undefined) {
        pendingApprovals.delete(rpcId)
        // 让这条审批在所有读者那里结掉：手机端的 pending tracker 与其他客户端
        // 只能从这条帧知道审批已经结束，而此前没有任何发射点——已应答的审批会
        // 在 tracker 里滞留到插件生命期结束，重新进会话时面板就会复活。
        broadcast.emitWithRpcId(RpcId(`approval-resolved-${randomUUID()}`), {
          type: 'approval/resolved',
          sessionId: approval.sessionId as never,
          approvalId: approval.approvalId as never,
          outcome: message.result.ok ? answerOutcomeOf(message.result.value) : 'unavailable',
        })
        if (message.result.ok) approval.resolve(message.result.value)
        else approval.reject(new Error(message.result.error.message))
        return { accepted: true }
      }
      const question = pendingQuestions.get(rpcId)
      if (question !== undefined) {
        pendingQuestions.delete(rpcId)
        // 与审批同款：这条帧此前没有发射点，手机端 tracker 只能靠它才知道批次已结束。
        broadcast.emitWithRpcId(RpcId(`question-resolved-${randomUUID()}`), {
          type: 'question/resolved',
          sessionId: question.sessionId as never,
          questionRpcId: rpcId as never,
          outcome: message.result.ok ? 'answered' : 'cancelled',
        })
        if (message.result.ok) question.resolve(message.result.value)
        else question.reject(new Error(message.result.error.message))
        return { accepted: true }
      }
      return { accepted: false, reason: 'not-pending' }
    },
  }

  return adapter
}

/** 新 ModelCatalog → 旧 SessionModels（current/routable 字段映射）。 */
function toSessionModels(catalog: ModelCatalog): SessionModels {
  return {
    current: cast<SessionModels['current']>(catalog.default),
    routable: catalog.routableProviders.length > 0,
    groups: cast<SessionModels['groups']>(catalog.groups),
    failures: cast<SessionModels['failures']>(catalog.failures),
  }
}

/** 类型断言 helper：避免续行 `as unknown as` 的解析问题。 */
function cast<T>(value: unknown): T {
  return value as T
}

/** RemoteError → 旧 RpcError 形状。 */
function toRpcError(error: unknown): RpcError {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {}
  const code = typeof record.code === 'string' ? record.code : 'internal'
  const message = error instanceof Error ? error.message : String(error)
  const details = record.details ?? {}
  return { code: code as RpcErrorCode, message, details: details as never } as RpcError
}
