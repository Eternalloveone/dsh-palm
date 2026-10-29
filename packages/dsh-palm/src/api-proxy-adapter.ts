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
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions/types'
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
  SubagentListEntry,
  SettingsNamespaceView,
  MuxFrame,
  ApprovalOutcome,
} from './api-proxy-types.ts'
import { RpcId } from './api-proxy-types.ts'
import { HistoryAdapter } from './api-proxy-history.ts'
import { permissionOptionsSource } from './permission-options.ts'
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

/**
 * 手机应答里的审批结论，用于**宿主决策**。与 `answerOutcomeOf` 分开是有意的：那个还兼职
 * 「撤下面板」的展示语义（读不出就按 `allowed-once` 记），决策路径必须 **fail-closed**——
 * 读不出结论就是 `unavailable`（不授权），解析失败绝不能等于放行。
 */
function approvalOutcomeOf(value: unknown): ApprovalOutcome {
  const outcome = (value as { outcome?: unknown } | null | undefined)?.outcome
  return outcome === 'allowed-once' || outcome === 'rejected' || outcome === 'cancelled' || outcome === 'unavailable'
    ? outcome
    : 'unavailable'
}

/**
 * 手机应答里的问题答案，用于宿主决策。手机把它包在 client-response 信封里
 * （`{ sessionId, answer: { answers } }`，sessionId 供宿主做归属校验），而 DSH 的
 * `user-questions/request` waterfall 只接受答案本身 `{ answers }`：把信封整个交回去，
 * `dsh-tool-ask-user` 会在 `answers.map` 上抛错，用户的选择就此丢失。
 *
 * 拿不到答案数组时返回 `null`（调用方拒绝这条 waterfall）——不伪造空批次，因为空批次
 * 与「用户什么都没选」无法区分，正是要修的那种静默失效。
 */
function questionAnswerOf(value: unknown): AskUserQuestionAnswer | null {
  // 兼容两种到达形状：带 sessionId 的标准信封，以及已经拆好的载荷。
  const envelope = value as { answer?: unknown; answers?: unknown } | null | undefined
  const candidate = (envelope?.answer ?? envelope) as { answers?: unknown } | null | undefined
  if (!Array.isArray(candidate?.answers)) return null
  return { answers: candidate.answers as AskUserQuestionAnswer['answers'] }
}

/** 适配层：在 ApiProxy 之上暴露内部钩子（手机在线状态、图片附件、dispose）。 */
/**
 * 「这台机器上是否存在可打开的设置文档」。
 *
 * 宿主在 0.1.x → 0.2.x 之间把这个探测器换了名字也换了形状：
 *   · 0.1.x：`settings.canOpenAgentPresetDirectory()`
 *   · 0.2.x：`settingsController.describe().hasDocument`
 * 两代都试一遍，都没有就返回 false（它只影响按钮是否可点，不该让整块功能报错）。
 */
function canOpenSettingsDocument(settings: unknown): boolean {
  const probe = settings as
    | {
      canOpenAgentPresetDirectory?: () => boolean
      describe?: (options?: { redactSecrets?: boolean }) => { hasDocument?: boolean } | undefined
    }
    | undefined
  if (probe === undefined || probe === null) return false
  try {
    if (typeof probe.canOpenAgentPresetDirectory === 'function') {
      return probe.canOpenAgentPresetDirectory() === true
    }
    if (typeof probe.describe === 'function') {
      return probe.describe({ redactSecrets: true })?.hasDocument === true
    }
  } catch {
    // 设置提供方没挂上时这些调用会抛：当作「没有」，不打断预设列表。
  }
  return false
}

export interface ApiProxyAdapter extends ApiProxy {
  /** 手机 SSE 订阅数变化时由 mobile-api 的 SSE 桥调用。 */
  setPhoneConnected(connected: boolean): void
  /**
   * 当前仍在等手机作答的 approval/question 帧（`{ rpcId, payload }`，与 mux 流同形）。
   *
   * 为什么需要：手机可能在提问发生的那一刻**没有活着的流**——App 在后台、锁屏、
   * 隧道抖动、EventSource 正在重连——那时它不在在线名单里。此前的做法是"没在线就
   * 整条跳过"，于是手机端永远看不到这张卡片（桌面照常弹出、也就照常在桌面答掉），
   * 而问答没有任何离线通知兜底。现在待答条目不再按在线与否丢弃，而是留在这里：手机
   * 的下一条流一建立，SSE 路由先把这份快照补发给它，卡片就出现了（客户端按 rpcId
   * 去重，重复回放不会重复入列）。
   * @returns 快照帧（审批在前、提问在后；顺序与广播顺序无关）。
   */
  pendingFrames(): Array<{ rpcId: string; payload: MuxFrame }>
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
  /** 当初广播给手机的那条 `approval/requested` 帧：新连接的开场快照原样补发它。 */
  payload: MuxFrame
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

/** 一条已转发给手机、正在等应答的问题批次（同样是被 waterfall 挡住的一次 ask）。 */
interface PendingQuestionRequest {
  sessionId: string
  /** 当初广播给手机的那条 `question/requested` 帧：新连接的开场快照原样补发它。 */
  payload: MuxFrame
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

/**
 * 桌面先答时那条审批的展示结论。桌面链路的返回值**就是** `ApprovalOutcome` 本身
 * （`ui-approval` 的 client 直接把面板结论交回 waterfall），不是手机那种
 * `{sessionId, approvalId, outcome}` 信封——套用 {@link approvalOutcomeOf} 会把
 * 每一个结论都读成 `unavailable`。信封形状也容忍（跨线值不假设）。
 */
function desktopApprovalOutcome(value: unknown): ApprovalOutcome {
  const outcome = typeof value === 'string'
    ? value
    : (value as { outcome?: unknown } | null | undefined)?.outcome
  return outcome === 'allowed-once' || outcome === 'rejected' || outcome === 'cancelled' || outcome === 'unavailable'
    ? outcome
    : 'unavailable'
}

/** 一次双端竞答里"桌面那一侧"的把手。 */
interface DesktopArm {
  /** 下游（api-remotes → 桌面网关）的应答：桌面真的答了才 resolve。 */
  readonly answer: Promise<unknown>
  /** 撤销桌面那条 pending：网关据此给桌面广播 cancel 帧，面板随之消失。 */
  cancel(reason: unknown): void
}

/**
 * 把一次宿主交互同时交给**下游链路**（api-remotes → 桌面网关 → 桌面面板）。
 *
 * 关键在信号替换：网关只认 `request.signal`（`api/gateway/src/index.ts` 的
 * `startRemoteEvent` 在 signal abort 时 `cancelRemoteEvent`，并向所有收到过这条
 * 请求的客户端推 `cancel` 帧）。我们换上一个「原信号 + 本闸门」的复合信号，
 * 于是：原信号的语义（轮次中断）原样保留，而我们自己也能在手机先答时把桌面那条
 * pending 撤掉——桌面面板因此消失，而不是留一个永远等不到结论的空面板。
 * @param request - waterfall 请求（`signal` 会被替换成复合信号）。
 * @param next - 下游 waterfall。
 * @returns 桌面侧应答与撤销开关。
 */
function armDesktopRace(request: { signal?: AbortSignal }, next: () => Promise<unknown>): DesktopArm {
  const gate = new AbortController()
  const original = request.signal
  const composite = original === undefined ? gate.signal : AbortSignal.any([original, gate.signal])
  try {
    request.signal = composite
  } catch {
    // 冻结的请求对象（理论上不存在）：退化成"不撤桌面面板"，竞答本身照常。
  }
  let answer: Promise<unknown>
  try {
    answer = Promise.resolve(next())
  } catch (error) {
    answer = Promise.reject(error)
  }
  // 桌面"放弃"（没有客户端在看这个会话）会立刻 reject。那不是竞答的失败，
  // 调用方按需处理；这里先兜一层，免得成为 unhandled rejection。
  answer.catch(() => { /* 由调用方决定 */ })
  return { answer, cancel: (reason: unknown) => { gate.abort(reason) } }
}

/** 双端竞答的差异点：谁登记、谁撤面板。 */
interface DualAnswerBridge {
  /** waterfall 请求；`signal` 会被换成复合信号（见 armDesktopRace）。 */
  request: { signal?: AbortSignal }
  /** 下游 waterfall（桌面链路）。 */
  next: () => Promise<unknown>
  /** 手机应答条目登记（rpcId → resolve/reject）。 */
  register: (entry: { resolve: (value: unknown) => void; reject: (error: unknown) => void }) => void
  /** 撤销登记（结清后调用，重复调用无害）。 */
  unregister: () => void
  /** 登记完成后把请求推给手机（此刻它已经能被应答）。 */
  announce: () => void
  /** 桌面先答：给手机发一条 resolved 帧，撤掉手机那边的面板与 pending 追踪。 */
  retirePhonePanel: (value: unknown) => void
  /**
   * 此刻是否有活着的手机流。**只**用于收尾判据：桌面链路说"没人能答"时，若一个手机
   * 流都没有，就没人可能作答了，不必让 agent 空悬（见 {@link bridgeDualAnswer}）。
   * 它**不**决定要不要把请求交给手机——那是开场快照存在的理由。
   */
  phoneOnline: () => boolean
}

/**
 * 双端竞答：手机面板与桌面面板**同时在**，谁先答谁作数，输家那条被撤掉。
 *
 * 此前这里是「有手机在线就整批转给手机并且挡住 waterfall」：桌面永远收不到请求，
 * 手机没看这个会话时就一直挂着（实测悬停 1m55s 后被中断）。改成竞答后，
 * 任一端作答都能推进 agent，另一端的面板立刻消失。
 * @param spec - 见 {@link DualAnswerBridge}。
 * @returns 交给 waterfall 的结果（第一份到达的答案）。
 */
function bridgeDualAnswer(spec: DualAnswerBridge): Promise<unknown> {
  const desktop = armDesktopRace(spec.request, spec.next)
  return new Promise<unknown>((resolve, reject) => {
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      spec.unregister()
      action()
    }
    spec.register({
      resolve: (value: unknown) => finish(() => {
        // 手机先答：撤掉桌面那条 pending，桌面面板消失。
        desktop.cancel(new Error('手机端已作答'))
        resolve(value)
      }),
      reject: (error: unknown) => finish(() => {
        desktop.cancel(new Error('手机端未作答'))
        reject(error)
      }),
    })
    spec.announce()
    desktop.answer.then(
      (value: unknown) => finish(() => {
        // 桌面先答：让手机撤面板 + 通知它的 pending 追踪（否则轮询会把旧的
        // 批次再端回来，面板复活）。
        spec.retirePhonePanel(value)
        resolve(value)
      }),
      (error: unknown) => {
        // 桌面链路没有可答的客户端（没有客户端在看这个会话）。手机有活着的流就继续
        // 等它；一个都没有时没人可能作答，把桌面那条失败原样交回去，别让 agent 空悬
        //（此前这里无条件等待，实测悬停 1m55s 后被中断）。
        if (!spec.phoneOnline()) finish(() => { reject(error) })
      },
    )
  })
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

  const permissionOptions = permissionOptionsSource(ctx)
  const history = new HistoryAdapter(session, permissionOptions)
  const workspaceList = new WorkspaceListAdapter(workspace)
  const broadcast = new MuxBroadcast()
  const muxSignal = new AbortController()
  const disposeMux = setupMuxSources(ctx, session, broadcast, muxSignal.signal, diagnostics, permissionOptions)
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
  // 手机在线的审批**同时**交给下游（桌面）与手机：双端竞答，先答者作数。
  // request/next 用宽松类型 + as never 规避 approval 事件类型解析到旧 checkout 的问题。
  const disposeApproval = ctx.on('approval/request', ((request: { agent?: { id: string }; toolName: string; callId?: string; reason?: string; signal?: AbortSignal }, next: () => Promise<unknown>) => {
    // 这里**不再**看手机在线与否：手机可能恰好在后台或重连中，但它回来时仍应看到这条
    // 还在等它的审批（新连接的开场快照会补发）。没人可能作答时由 phoneOnline 收尾。
    const sessionId = request.agent?.id
    if (sessionId === undefined) return next()
    const rpcId = RpcId(`approval-${randomUUID()}`)
    const approvalId = RpcId(`approval-id-${randomUUID()}`)
    const payload: MuxFrame = {
      type: 'approval/requested',
      sessionId: sessionId as never,
      approvalId: approvalId as never,
      toolName: request.toolName,
      ...(request.callId !== undefined ? { callId: request.callId } : {}),
      ...(request.reason !== undefined ? { reason: request.reason } : {}),
    }
    return bridgeDualAnswer({
      request,
      next,
      phoneOnline: () => phoneConnected,
      register: (entry) => {
        pendingApprovals.set(rpcId, {
          sessionId,
          approvalId,
          payload,
          resolve: entry.resolve as (v: unknown) => void,
          reject: entry.reject as (e: unknown) => void,
        })
      },
      unregister: () => { pendingApprovals.delete(rpcId) },
      announce: () => { broadcast.emitWithRpcId(rpcId, payload) },
      retirePhonePanel: (value: unknown) => {
        broadcast.emitWithRpcId(RpcId(`approval-resolved-${randomUUID()}`), {
          type: 'approval/resolved',
          sessionId: sessionId as never,
          approvalId: approvalId as never,
          outcome: desktopApprovalOutcome(value),
        })
      },
    })
  }) as never, { prepend: true })

  // ── respond 桥接：question ─────────────────────────────────────────────
  const disposeQuestion = ctx.on('user-questions/request' as never, ((request: { agent?: { id: string }; questions: unknown[]; signal?: AbortSignal }, next: () => Promise<unknown>) => {
    // 同上：不按在线与否跳过。手机端的问题面板曾经"消失"，就是这条门槛的锅——手机在
    // 后台时它恰好不在在线名单里，于是整条请求被静默交给桌面，手机永远收不到。
    const sessionId = request.agent?.id
    if (sessionId === undefined) return next()
    const rpcId = RpcId(`question-${randomUUID()}`)
    const payload: MuxFrame = {
      type: 'question/requested',
      sessionId: sessionId as never,
      questions: request.questions as never,
    }
    return bridgeDualAnswer({
      request,
      next,
      phoneOnline: () => phoneConnected,
      register: (entry) => {
        pendingQuestions.set(rpcId, {
          sessionId,
          payload,
          resolve: entry.resolve as (v: unknown) => void,
          reject: entry.reject as (e: unknown) => void,
        })
      },
      unregister: () => { pendingQuestions.delete(rpcId) },
      announce: () => { broadcast.emitWithRpcId(rpcId, payload) },
      retirePhonePanel: () => {
        broadcast.emitWithRpcId(RpcId(`question-resolved-${randomUUID()}`), {
          type: 'question/resolved',
          sessionId: sessionId as never,
          questionRpcId: rpcId as never,
          outcome: 'answered',
        })
      },
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
    pendingFrames(): Array<{ rpcId: string; payload: MuxFrame }> {
      return [
        ...[...pendingApprovals].map(([rpcId, entry]) => ({ rpcId, payload: entry.payload })),
        ...[...pendingQuestions].map(([rpcId, entry]) => ({ rpcId, payload: entry.payload })),
      ]
    },
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
      // 手机端「谁在跑」的探针只带最近 200 条的 limit：不转发时宿主会把整张
      // 会话表枚举一遍（冷启动实测 24.7 秒），请求在手机上根本等不到答复。
      // 只有正整数才转发；不带 limit 时 payload 与旧实现逐字节一致，游标分页不受影响。
      list: (request) => call(request.rpcId, () => {
        const payload = request.payload as { cursor?: string; limit?: number }
        const query: { cursor?: string; limit?: number } = { cursor: payload.cursor }
        if (typeof payload.limit === 'number' && Number.isSafeInteger(payload.limit) && payload.limit > 0) {
          query.limit = payload.limit
        }
        return cast<Promise<{ items: SessionSummary[] }>>(session.list(query as never, new AbortController().signal))
      }),
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
          // hasDocument 从 roster 移除。宿主 0.1.x 用 settings.canOpenAgentPresetDirectory()，
          // 0.2.x 删了它、改成 settingsController.describe().hasDocument —— 两种都试，都没有就当没有。
          hasDocument: canOpenSettingsDocument(settings),
        }
      }),
    },

    subagents: {
      // 方法名跟着宿主版本走：0.1.x 叫 remoteExportList（直接回带 parentAvailable 的目录），
      // 0.2.x 换成 listChildren（回裸条目数组，没有 activity）。按运行期是否存在来探测，
      // 插件就不再因为宿主升级而整块失效 —— 真机上"子代理永远是空"就是这么来的。
      list: (request, signal) => call(request.rpcId, async () => {
        const parentSessionId = request.payload.parentSessionId as never
        const abort = signal ?? new AbortController().signal
        const runtime = subagents as unknown as {
          listChildren?: (id: never, signal?: AbortSignal) => Promise<readonly RawSubagentEntry[] | undefined>
          remoteExportList?: (id: never, signal: AbortSignal) => Promise<SubagentCatalog>
        }
        if (typeof runtime.listChildren === 'function') {
          const rows = await runtime.listChildren(parentSessionId, abort)
          // activity 由调用方（mobile-api）按子会话的日志边界补：这一层拿不到运行态。
          return { parentAvailable: true, entries: (rows ?? []).map(toCatalogEntry) } satisfies SubagentCatalog
        }
        if (typeof runtime.remoteExportList === 'function') {
          return await runtime.remoteExportList(parentSessionId, abort)
        }
        throw new Error('宿主没有子代理查询能力（listChildren / remoteExportList 都不存在）')
      }),
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
        // 决策路径拿的是载荷本身（裸 ApprovalOutcome），不是手机的信封。
        if (message.result.ok) approval.resolve(approvalOutcomeOf(message.result.value))
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
        // 同审批：DSH 的 waterfall 要答案本身（`{ answers }`），不是手机的信封。
        const answer = message.result.ok ? questionAnswerOf(message.result.value) : null
        if (answer !== null) question.resolve(answer)
        else question.reject(new Error(message.result.ok ? '手机端应答缺少 answers' : message.result.error.message))
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

/**
 * 宿主 0.2.x `listChildren` 的裸条目（只有身份，没有运行态）。
 *
 * `mode` 是宿主的生命周期口径：continuable 可以续聊，one-shot / external /
 * unknown 都是一次性的。手机上只区分"能不能再发消息"，所以只保留这两类。
 */
interface RawSubagentEntry {
  id: string
  mode?: string
  label?: string
}

/** 裸条目 → 手机侧目录行（activity 由 mobile-api 按子会话边界补）。 */
export function toCatalogEntry(entry: RawSubagentEntry): SubagentListEntry {
  const label = typeof entry.label === 'string' && entry.label !== '' ? entry.label : undefined
  const base = {
    kind: 'child' as const,
    id: entry.id as never,
    // 老宿主由 remoteExportList 给真值；新宿主这里只能先占位，mobile-api 会覆盖。
    activity: 'inactive' as const,
    // 深一层是否有子代理要另读一次目录，手机上不展开树，先给 false。
    hasChildren: false,
  }
  return entry.mode === 'continuable' && label !== undefined
    ? { ...base, mode: 'continuable' as const, label }
    : { ...base, mode: 'one-shot' as const, ...(label === undefined ? {} : { label }) }
}

/** RemoteError → 旧 RpcError 形状。 */
function toRpcError(error: unknown): RpcError {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {}
  const code = typeof record.code === 'string' ? record.code : 'internal'
  const message = error instanceof Error ? error.message : String(error)
  const details = record.details ?? {}
  return { code: code as RpcErrorCode, message, details: details as never } as RpcError
}
