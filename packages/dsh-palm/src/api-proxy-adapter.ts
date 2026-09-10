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
} from './api-proxy-types.ts'
import { RpcId } from './api-proxy-types.ts'
import { HistoryAdapter } from './api-proxy-history.ts'
import { WorkspaceListAdapter } from './api-proxy-workspace.ts'
import { MuxBroadcast, setupMuxSources } from './api-proxy-mux.ts'

/** 适配层：在 ApiProxy 之上暴露内部钩子（手机在线状态、dispose）。 */
export interface ApiProxyAdapter extends ApiProxy {
  /** 手机 SSE 订阅数变化时由 mobile-api 的 SSE 桥调用。 */
  setPhoneConnected(connected: boolean): void
  /** 插件 dispose 时清理 follow 流、mux 源、事件监听。 */
  dispose(): void
}

/**
 * 构造适配层。ctx 需已装配 host controllers（web-app bundle 提供）。
 */
export function makeApiProxyAdapter(ctx: Context): ApiProxyAdapter {
  const session = ctx.get('sessionController') as SessionController
  const workspace = ctx.get('workspaceController') as WorkspaceController
  const settings = ctx.get('settingsController') as SettingsController
  const agentPresets = ctx.get('agentPresets') as AgentPresets
  const subagents = ctx.get('subagents') as SubagentRuntime

  const history = new HistoryAdapter(session)
  const workspaceList = new WorkspaceListAdapter(workspace)
  const broadcast = new MuxBroadcast()
  const muxSignal = new AbortController()
  const disposeMux = setupMuxSources(session, broadcast, muxSignal.signal)

  // 手机在线状态（SSE 桥报告）。respond 桥接据此决定拦截还是委托。
  let phoneConnected = false
  // 待应答的 approval/question：rpcId → resolve/reject。
  const pendingApprovals = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  const pendingQuestions = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()

  // ── respond 桥接：approval ─────────────────────────────────────────────
  // 前置拦截 host 的 approval/request waterfall，转发给手机，返回 Promise 等手机应答。
  // request/next 用宽松类型 + as never 规避 approval 事件类型解析到旧 checkout 的问题。
  const disposeApproval = ctx.on('approval/request', ((request: { agent?: { id: string }; toolName: string; callId?: string; reason?: string }, next: () => Promise<unknown>) => {
    if (!phoneConnected) return next()
    const sessionId = request.agent?.id
    if (sessionId === undefined) return next()
    const rpcId = RpcId(`approval-${randomUUID()}`)
    broadcast.emitWithRpcId(rpcId, {
      type: 'approval/requested',
      sessionId: sessionId as never,
      approvalId: RpcId(`approval-id-${randomUUID()}`) as never,
      toolName: request.toolName,
      ...(request.callId !== undefined ? { callId: request.callId } : {}),
      ...(request.reason !== undefined ? { reason: request.reason } : {}),
    })
    return new Promise<unknown>((resolve, reject) => {
      pendingApprovals.set(rpcId, { resolve: resolve as (v: unknown) => void, reject: reject as (e: unknown) => void })
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
      pendingQuestions.set(rpcId, { resolve: resolve as (v: unknown) => void, reject: reject as (e: unknown) => void })
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
    dispose(): void {
      disposeMux()
      disposeApproval()
      disposeQuestion()
      muxSignal.abort()
      workspaceList.dispose()
      history.clearAll()
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
      mux: (request, signal) => broadcast.subscribe(signal),
    },

    respond: async (message: ClientResponse): Promise<RpcReceipt> => {
      const rpcId = message.rpcId
      const approval = pendingApprovals.get(rpcId)
      if (approval !== undefined) {
        pendingApprovals.delete(rpcId)
        if (message.result.ok) approval.resolve(message.result.value)
        else approval.reject(new Error(message.result.error.message))
        return { accepted: true }
      }
      const question = pendingQuestions.get(rpcId)
      if (question !== undefined) {
        pendingQuestions.delete(rpcId)
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
