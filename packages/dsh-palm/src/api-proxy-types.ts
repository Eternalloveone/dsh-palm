/**
 * dsh-palm 适配层类型：复刻旧 `@deepseek-ai/dsh-host-apiproxy` 的契约形状。
 *
 * 0.1.5-rc.1 里 `@deepseek-ai/dsh-host-apiproxy` 已拆分为 dsh-api-* 系列，旧包不存在。
 * 本文件是 dsh-palm 对旧 apiProxy 形状的唯一类型来源：适配层把 host controllers
 * （`ctx.sessionController` 等）包装成这些旧形状，dsh-palm 其余代码（mobile-api.ts 的
 * dispatch 等）无需感知新架构。
 *
 * 类型依据：旧包 `@deepseek-ai/dsh-host-apiproxy/lib/types/api/*.d.ts`（0.1.1-rc.2）。
 */

import { z } from 'zod'

// 本地宽松类型：避免从 @deepseek-ai/dsh-session 等包导入时解析到旧 checkout 的
// 重复类型（与 host controllers 的 npm 版本冲突）。这些类型只用于旧 apiProxy 形状，
// 运行时是普通 string/object。

/** 会话 id（宽松 string）。 */
export type SessionId = string
/** 会话事件（宽松：type 判别 + 任意字段）。 */
export type SessionEvent = { type: string; seq: number; time: number; data: unknown } & Record<string, unknown>
/** 消息 id（宽松 string）。 */
export type MessageId = string
/** 审批请求 id（宽松 string）。 */
export type ApprovalRequestId = string
/** 审批结果。 */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
/** 一个问题项。 */
export interface AskUserQuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
}

// ── 消息层：四象限 RPC 信封 ──────────────────────────────────────────────

/** 消息关联 id（branded string）。 */
export type RpcId = string & { readonly __rpcId: unique symbol }

/** 把字符串品牌化为 RpcId（编译期 cast，零运行时开销）。 */
export function RpcId(id: string): RpcId {
  return id as RpcId
}

/** 错误码 → details 类型映射（旧 RpcErrorDetailsMap 的 dsh-palm 用到的子集）。 */
export interface RpcErrorDetailsMap {
  'bad-request': { issues: unknown[] }
  'cancelled': Record<string, never>
  'session-not-found': { sessionId: SessionId }
  'session-running': { sessionId: SessionId }
  'model-unavailable': { provider: string; model: string }
  'session-conflict': { sessionId: SessionId; requestedCwd: string; existingCwd?: string }
  'invalid-time-zone': { value: string }
  'workspace-attach-failed': { sessionId: SessionId; workspaceId: string }
  'workspace-not-found': { workspaceId: string }
  'workspace-invalid-path': { path: string }
  'workspace-name-conflict': { name: string }
  'workspace-move-invalid': { workspaceId: string; sessionId: SessionId; beforeSessionId?: SessionId }
  'directory-unreadable': { path: string }
  'directory-exists': { path: string }
  'directory-create-failed': { path: string }
  'directory-picker-unavailable': { capability: string }
  'agent-preset-read-only': { agentPreset: string; reason: string }
  'agent-preset-locked': { sessionId: SessionId; agentPreset: string }
  'agent-preset-conflict': { sessionId: SessionId; requestedPreset: string; existingPreset?: string }
  'agent-preset-not-found': { agentPreset: string; available: string[] }
  'agent-preset-invalid': { agentPreset: string; reason: string }
  'agent-busy': { reason: string }
  'attachment-error': { reason: string }
  'queue-item-not-found': { itemId: MessageId }
  'steer-unavailable': { itemId: MessageId }
  'command-error': Record<string, never>
  'unknown-command': Record<string, never>
  'settings-rejected': { ns: string }
  'settings-conflict': { ns: string; expected: number; actual: number }
  'credential-rejected': { ref: string }
  'model-discovery-failed': { settingsNs: string; baseURL?: string }
  'title-invalid': { sessionId: SessionId }
  'fork-unavailable': { sessionId: SessionId }
  'subagent-parent-unavailable': { parentSessionId: SessionId }
  'subagent-not-found': { parentSessionId: SessionId; childSessionId: SessionId }
  'subagent-catalog-diagnostic': {
    parentSessionId: SessionId
    childSessionId: SessionId
    reason: 'corrupt' | 'unsupported' | 'unavailable'
  }
  'subagent-not-resumable': { childSessionId: SessionId }
  'subagent-unauthorized': { childSessionId: SessionId }
  'subagent-delivery-unavailable': { childSessionId: SessionId }
  'internal': Record<string, never>
}

/** 闭包错误码联合。 */
export type RpcErrorCode = keyof RpcErrorDetailsMap

/** 业务错误（code 为判别字段）。 */
export type RpcError = {
  [C in RpcErrorCode]: { code: C; message: string; details: RpcErrorDetailsMap[C] }
}[RpcErrorCode]

/** 业务成功/失败结果。 */
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError }

/** 请求窄形：rpcId 显式，payload 为业务载荷。 */
export interface RpcRequest<P> {
  rpcId: RpcId
  payload: P
}

/** 响应窄形：rpcId 回显请求。 */
export interface RpcResponse<T> {
  rpcId: RpcId
  result: RpcResult<T>
}

/** 客户端发起的调用（wire 载体：POST /api/<method>）。 */
export interface ClientRequest {
  type: 'client-request'
  rpcId: RpcId
  method: string
  payload: unknown
}

/** 服务端响应（wire 载体：POST 的 HTTP 响应体）。 */
export interface ServerResponse {
  type: 'server-response'
  rpcId: RpcId
  result: RpcResult<unknown>
}

/** 服务端发起的消息（wire 载体：下游流帧）。 */
export interface ServerRequest {
  type: 'server-request'
  rpcId: RpcId
  method: string
  payload: unknown
}

/** 对 ServerRequest 的响应（wire 载体：POST /api/respond）。 */
export interface ClientResponse {
  type: 'client-response'
  rpcId: RpcId
  result: RpcResult<unknown>
}

/** 权威 wire 全形联合。 */
export type RpcMessage = ClientRequest | ServerResponse | ServerRequest | ClientResponse

/** 载体回执。 */
export type RpcReceipt = { accepted: true } | { accepted: false; reason: 'not-pending' | 'bad-response' }

// ── 域类型 ──────────────────────────────────────────────────────────────

/** 会话列表行。 */
export interface SessionSummary {
  sessionId: SessionId
  updatedAt: number
  running: boolean
  blank: boolean
  parentSessionId?: SessionId
  seedLength?: number
  origin?: 'subagent'
  cwd?: string
  agentPreset?: string
  projections?: SessionProjectionsBlock
}

/** 会话投影基线块。 */
export interface SessionProjectionsBlock {
  asOfSeq: number
  values: Record<string, unknown>
}

/** 会话模型目录（旧 SessionModels）。 */
export interface SessionModels {
  current: ModelSelection
  routable: boolean
  groups: ModelProviderGroup[]
  failures: ModelCatalogFailure[]
}

/** 完整模型选择。 */
export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** 一个 provider 及其成功加载的模型目录。 */
export interface ModelProviderGroup {
  id: string
  name: string
  models: ModelCatalogModel[]
}

/** 一个 provider 的目录查找失败。 */
export interface ModelCatalogFailure {
  id: string
  name: string
  message: string
}

/** 一个模型。 */
export interface ModelCatalogModel {
  id: string
  name: string
  description?: string
  reasoning?: ModelReasoning
}

/** 一个模型的推理元数据。 */
export interface ModelReasoning {
  efforts: ModelReasoningEffort[]
  defaultEffort?: string
}

/** 一个推理档位。 */
export interface ModelReasoningEffort {
  id: string
  name: string
  description?: string
}

/** 一条历史页条目：原始事件 + 可选渲染意图。 */
export interface HistoryEntry {
  event: SessionEvent
  view?: unknown
}

/** 会话内容搜索结果。 */
export interface SessionSearchItem {
  sessionId: SessionId
  snippet: string
}

/** 工作区行。 */
export interface WorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds: SessionId[]
  createdAt: string
  updatedAt: string
}

/** 一个 agent preset 行。 */
export interface AgentPresetEntry {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly isDefault: boolean
  readonly name?: string
  readonly description?: string
  readonly broken?: string
}

/** 子代理目录。 */
export interface SubagentCatalog {
  entries: SubagentListEntry[]
  parentAvailable: boolean
}

/** 子代理目录行。 */
export type SubagentListEntry =
  | {
    kind: 'child'
    id: SessionId
    activity: 'running' | 'inactive'
    hasChildren: boolean
  } & (
    | { mode: 'one-shot'; label?: string }
    | { mode: 'continuable'; label: string }
  )
  | { kind: 'diagnostic'; id: SessionId; reason: 'corrupt' | 'unsupported' | 'unavailable' }

/** 设置命名空间视图。 */
export interface SettingsNamespaceView {
  ns: string
  schema: unknown
  value: unknown
  base?: unknown
  user?: unknown
  applies: 'live' | 'restart'
  secrets: SettingsSecretView[]
  revision: number
}

/** 设置 secret 槽。 */
export interface SettingsSecretView {
  path: string[]
  set: boolean
}

/** 设置路径操作。 */
export type SettingsPathOpView =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** 后台任务行。 */
export interface JobView {
  id: string
  kind: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  detail?: string
  startedAt: number
  finishedAt?: number
}

/** 工具渲染意图。 */
export type ToolEventView =
  | { for: 'call'; view: unknown }
  | { for: 'result'; view: unknown }

/** 待处理收件箱条目。 */
export interface QueuedInboxItem {
  id: MessageId
  placement: 'queued' | 'steering' | 'context'
  message: unknown
}

/** mux 流帧联合。 */
export type MuxFrame =
  | { type: 'session/event'; sessionId: SessionId; event: SessionEvent; view?: ToolEventView }
  | { type: 'session/subscribed'; sessionId: SessionId; lastSeq: number }
  | { type: 'approval/requested'; sessionId: SessionId; approvalId: ApprovalRequestId; toolName: string; callId?: string; reason?: string }
  | { type: 'approval/resolved'; sessionId: SessionId; approvalId: ApprovalRequestId; outcome: ApprovalOutcome }
  | { type: 'question/requested'; sessionId: SessionId; questions: AskUserQuestionItem[] }
  | { type: 'question/resolved'; sessionId: SessionId; questionRpcId: RpcId; outcome: 'answered' | 'cancelled' }
  | { type: 'session/queue'; sessionId: SessionId; items: QueuedInboxItem[] }
  | { type: 'session/jobs'; sessionId: SessionId; jobs: JobView[] }
  | { type: 'session/projection'; sessionId: SessionId; key: string; value: unknown; seq: number }
  | { type: 'stream/error'; error: RpcError }

/**
 * mux 流帧的本地宽松 zod schema（复刻旧 `events.schema` 的 muxFrameSchema）。
 * 只校验 `type` 判别字段是否属于已知 mux 帧类型（未知帧被丢弃，与旧行为一致），
 * 其余字段保持宽松——业务层已按 MuxFrame 形状消费，无需在此深校验。
 */
export const muxFrameSchema = z.custom<MuxFrame>((data) => {
  if (typeof data !== 'object' || data === null) return false
  const type = (data as { type?: unknown }).type
  return typeof type === 'string' && MUX_FRAME_TYPES.has(type)
})

/** 已知 mux 帧类型集合（muxFrameSchema 的判别依据）。 */
const MUX_FRAME_TYPES = new Set<string>([
  'session/event',
  'session/subscribed',
  'approval/requested',
  'approval/resolved',
  'question/requested',
  'question/resolved',
  'session/queue',
  'session/jobs',
  'session/projection',
  'stream/error',
])

/**
 * server-request 信封的本地宽松 zod schema（复刻旧 `rpc.schema` 的 serverRequestSchema）。
 * payload 槽保持宽松（业务层做第二层解析）。
 */
export const serverRequestSchema = z.object({
  type: z.literal('server-request'),
  rpcId: z.string(),
  method: z.string(),
  payload: z.unknown(),
})

/** host 流帧联合。 */
export type HostFrame =
  | { type: 'host/session-added'; sessionId: SessionId; blank: boolean; parentSessionId?: SessionId; origin?: 'subagent'; cwd?: string; agentPreset?: string }
  | { type: 'host/session-removed'; sessionId: SessionId }
  | { type: 'host/session-status'; sessionId: SessionId; running: boolean }
  | { type: 'host/agent-error'; sessionId: SessionId; message: string }
  | { type: 'host/workspace-changed'; workspace: WorkspaceView }
  | { type: 'host/workspace-removed'; workspaceId: string }
  | { type: 'host/workspace-order-changed'; workspaceIds: string[] }
  | { type: 'host/archived-sessions-changed'; archivedSessionIds: SessionId[] }
  | { type: 'host/remote-event'; event: string; args: unknown[] }
  | { type: 'stream/error'; error: RpcError }

// ── ApiProxy 根接口（适配层要复刻的形状） ────────────────────────────────

/** 旧 ApiProxy 根接口：dsh-palm 用到的 domain/method。 */
export interface ApiProxy {
  sessions: {
    list(request: RpcRequest<{ cursor?: string }>): Promise<RpcResponse<{ items: SessionSummary[] }>>
    history(request: RpcRequest<{ sessionId: SessionId; beforeSeq?: number; maxMessages?: number }>): Promise<RpcResponse<{ events: HistoryEntry[]; hasMore: boolean; projections?: SessionProjectionsBlock }>>
    search(request: RpcRequest<{ query: string }>, signal: AbortSignal): Promise<RpcResponse<{ items: SessionSearchItem[]; hasMore: boolean }>>
    create(request: RpcRequest<{ workspaceId?: string; cwd?: string; sessionId?: SessionId; agentPreset?: string }>): Promise<RpcResponse<{ sessionId: SessionId; agentPreset?: string }>>
    prompt(request: RpcRequest<{ sessionId: SessionId; mode: 'queue' | 'steer'; content: unknown[]; clientTimeZone?: string }>): Promise<RpcResponse<{ accepted: true }>>
    models(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<SessionModels>>
    selectModel(request: RpcRequest<{ sessionId: SessionId; provider: string; model: string; reasoningEffort?: string }>): Promise<RpcResponse<{ selected: ModelSelection }>>
    rename(request: RpcRequest<{ sessionId: SessionId; title: string }>): Promise<RpcResponse<{ title: string; seq: number }>>
    cancel(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ accepted: true }>>
    updateQueue(request: RpcRequest<{ sessionId: SessionId; itemId: MessageId; action: unknown }>): Promise<RpcResponse<{ accepted: true }>>
  }
  workspace: {
    list(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<{ items: WorkspaceView[]; archivedSessionIds: SessionId[] }>>
    create(request: RpcRequest<{ path: string }>): Promise<RpcResponse<{ workspace: WorkspaceView; created: boolean }>>
    rename(request: RpcRequest<{ workspaceId: string; title: string }>): Promise<RpcResponse<{ workspace: WorkspaceView }>>
    delete(request: RpcRequest<{ workspaceId: string }>): Promise<RpcResponse<{ deleted: true }>>
    archiveSession(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ archivedSessionIds: SessionId[] }>>
  }
  agentPresets: {
    list(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<{ presets: AgentPresetEntry[]; authorable: boolean; hasDocument: boolean }>>
  }
  subagents: {
    list(request: RpcRequest<{ parentSessionId: SessionId }>, signal?: AbortSignal): Promise<RpcResponse<SubagentCatalog>>
  }
  settings: {
    describe(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<{ writable: boolean; hasDocument: boolean; namespaces: SettingsNamespaceView[] }>>
    mutate(request: RpcRequest<{ ns: string; ops: SettingsPathOpView[]; expectedRevision?: number }>): Promise<RpcResponse<SettingsNamespaceView>>
  }
  events: {
    mux(request: RpcRequest<{ since?: Record<SessionId, number> }>, signal: AbortSignal): AsyncIterable<RpcRequest<MuxFrame>>
  }
  respond(message: ClientResponse): Promise<RpcReceipt>
}
