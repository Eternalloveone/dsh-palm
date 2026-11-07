/**
 * The mobile surface's data channel: `/m/api` proxies the host ApiProxy
 * service for the standalone phone page. The phone's RPC calls ride THIS
 * prefix instead of the connection plugin's `/api` — so the tunneled Host
 * never needs to enter the connection trust fence (a distributable plugin
 * cannot change that fence), and this plugin's own pairing gate is the
 * access control instead.
 *
 * Security model:
 * - Every request must carry a live paired-device cookie (the same gate
 *   semantic as the LAN fence), enforced before any host call.
 * - Only an explicit allowlist of methods is proxied ON THIS PREFIX. The
 *   allowlist constrains the /m/api proxy alone: the same paired-device
 *   cookie also passes the global api/gate, so a paired device is a
 *   full-control credential for the host /api surface outside the SDK's
 *   loopback-pinned privileged set (settings/credentials/agentPreset/host
 *   actions/llm.discoverModels). Pairing is full device trust.
 * - `session.list` is paged here (the host API returns everything; this
 *   layer slices stable pages) so the phone never transfers the whole list.
 * - The live mux stream is bridged over Server-Sent Events on the same
 *   prefix (one-directional push; answers to questions/approvals ride the
 *   unary channel), gated identically.
 */

export type { MobileDirectoryEntry, MobileDirectoryListing } from './host/directory.ts'
/** Short-lived cache: the phone's settings page must not hammer provider APIs. */
let usageCache: { at: number; view: UsageView } | undefined
const USAGE_CACHE_TTL_MS = 60_000

import {
  hydrateSessionRoster, isRosterHydrated, markRosterHydrated, markRosterRefreshed, persistSessionRoster,
  rosterFileOf, rosterLastRefreshAt, rosterOwnedCache, rosterTtlCache, setRosterFile, setRosterOwnedCache, setRosterTtlCache,
} from './host/session-roster.ts'
import { afterCursor, parseSessionListCursor, sessionListCursor, toRosterItems, trimSessionListRow, visibleSessionRows } from './host/session-list.ts'
export { toRosterItems, trimSessionListRow, visibleSessionRows } from './host/session-list.ts'
export type { RosterItem } from './host/session-list.ts'
import type { RosterItem } from './host/session-list.ts'
import { subagentCatalogWithActivity, unwrapProxyValue, LIVE_RUNNING_RESEED_MS, RUNNING_SESSIONS_TTL_MS, liveRunningSeededAtOf, mobileRunningCacheOf, setFinishedRunNotifier, setMobileRunningCache, setRunningProxy, isLiveSessionRunning, isLiveSessionNotRunningConfirmed, noteRunningFrame, noteRunningEvidence, adoptRunningBaseline, pruneRunningEvidence, reseedRunning, verifiedRunningSessionIds, computeTurnState, turnVerdict, TURN_ABANDONED_MS } from './host/running-evidence.ts'
export { isLiveSessionRunning, isLiveSessionNotRunningConfirmed, noteRunningFrame, noteRunningEvidence, adoptRunningBaseline, pruneRunningEvidence, reseedRunning, verifiedRunningSessionIds, computeTurnState, turnVerdict, TURN_ABANDONED_MS } from './host/running-evidence.ts'
import { documentRows, excludedText, rowSearchableText, searchCorpusOf, searchableText, stripHiddenAssistantText } from './host/search-text.ts'
export { documentRows, searchCorpusOf } from './host/search-text.ts'
// SearchDocumentRow 跟着文档行一起搬到 search-text.ts，这里只借类型（不进运行时）。
import type { SearchDocumentRow } from './host/search-text.ts'
import { mergeFinishedRuns, readFinishedRuns, writeFinishedRuns } from './host/finished-runs.ts'
// `export … from` 不进本文件作用域（这条踩过多次）：noteHostFinishedRun 还要用这个类型。
import type { FinishedRunEntry } from './host/finished-runs.ts'
export { mergeFinishedRuns, readFinishedRuns, writeFinishedRuns } from './host/finished-runs.ts'
export type { FinishedRunEntry } from './host/finished-runs.ts'
import { bumpQueueRevision, liveInboxOf, queueItemsOf, queueRevisionOf, queueTokenOf, rememberRequestBody } from './host/queue-inbox.ts'

async function readInboxProjection(proxy: ApiProxy, sessionId: string, wantsFresh: boolean): Promise<unknown> {
  let inbox: unknown = sessionProjectionSnapshots.get(sessionId)?.block.values?.['inbox']
  // 快照里还挂着待发项时不能信它：那一项可能早就被宿主投递出去了（投递不改这份
  // 快照），手机端就会一直显示一条已经发出去的排队消息。此时现读一次，带节流。
  const autoFresh = shouldRefreshInbox(inbox, Date.now(), inboxFreshAt.get(sessionId) ?? null)
  if (autoFresh) inboxFreshAt.set(sessionId, Date.now())
  if (wantsFresh || autoFresh) {
    try {
      const page = await proxy.sessions.history({ rpcId: RpcId('dsh-palm-mobile-inbox'), payload: { sessionId, maxMessages: 1, fresh: true } } as never)
      if (page.result.ok) {
        const values = (page.result.value as { projections?: { values?: Record<string, unknown> } }).projections?.values
        if (values?.['inbox'] !== undefined) inbox = values['inbox']
      }
    } catch {
      // 读不到就用快照，卡片显示旧一点总比不显示好。
    }
  }
  return inbox
}
export { bumpQueueRevision, liveInboxOf, queueItemsOf, queueRevisionOf, rememberRequestBody, textOfInboxContent } from './host/queue-inbox.ts'
import { CommandRegistry, AgentLookup, FileUploadsLike, GoalViewLike, GoalLookup, CommandDescriptorView, resetCommandDirectoryCache, resolveCommandDirectory, GoalActivationView, goalActivationOf, goalSnapshotOf, preferLiveGoal, GoalActionResultLike, applyGoalAction } from './host/commands-goals.ts'
export { resetCommandDirectoryCache, resolveCommandDirectory, goalActivationOf, goalSnapshotOf, preferLiveGoal, applyGoalAction } from './host/commands-goals.ts'
export type { CommandRegistry, AgentLookup, FileUploadsLike, GoalViewLike, GoalLookup, CommandDescriptorView, GoalActivationView, GoalActionResultLike } from './host/commands-goals.ts'
import { MOBILE_READ_FILE_MAX_BYTES, MOBILE_READ_IMAGE_MAX_BYTES, IMAGE_MIME } from './host/directory.ts'
import { mobileAncestryCrumbs, isImagePath, isAbsolutePath, readCandidates, windowsDrives, isWindowsDriveRoot, mobileListDirectory } from './host/directory.ts'
export { mobileAncestryCrumbs, isImagePath, isAbsolutePath, readCandidates, windowsDrives, isWindowsDriveRoot, mobileListDirectory } from './host/directory.ts'
import { ERROR_REPORT_KEEP, ERROR_REPORT_BYTES_MAX, ERROR_MESSAGE_MAX, ERROR_PUSH_COOLDOWN_MS, errorFingerprint, validateErrorReport, writeErrorReport, pruneErrorReports, errorSeen, errorPushDecision, resetErrorPushCooldown, pushErrorOnce, ingestErrorReport } from './host/error-report.ts'
export { ERROR_REPORT_KEEP, ERROR_REPORT_BYTES_MAX, ERROR_MESSAGE_MAX, ERROR_PUSH_COOLDOWN_MS, errorFingerprint, validateErrorReport, writeErrorReport, pruneErrorReports, errorSeen, errorPushDecision, resetErrorPushCooldown, pushErrorOnce, ingestErrorReport } from './host/error-report.ts'
import { PERF_CAPTURE_KEEP, PERF_CAPTURE_MAX_BYTES, PERF_RAW_MAX_BYTES, perfCaptureKind, prunePerfCaptures, validatePerfCapture, writePerfCapture } from './host/perf-capture.ts'
export { PERF_CAPTURE_KEEP, PERF_CAPTURE_MAX_BYTES, PERF_RAW_MAX_BYTES, perfCaptureKind, prunePerfCaptures, validatePerfCapture, writePerfCapture } from './host/perf-capture.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ApiProxy, MuxFrame, RpcRequest, SubagentCatalog } from './api-proxy-types'
import { RpcId } from './api-proxy-types'
import { MUX_FRAME_TYPES } from './shared/mux-frames.ts'
import type { SessionFolders } from './folders.ts'
import { mergeRunningBaseline, staleRunningEvidence } from './running-baseline.ts'
import type { ApiProxyAdapter } from './api-proxy-adapter.ts'
import type { PendingTracker } from './mobile-pending.ts'
import type { PairingService } from './pairing.ts'
import type { NotifyService } from './notify/notify-engine.ts'
import type { NotifyEvent } from './notify/notify-engine.ts'
import { deliverL2 } from './notify/notify-deliver.ts'
import { asJsonObject, readBoundedJson, writeJson } from './http.ts'
import { isLoopbackClient, readCookie } from './gate.ts'
import { deviceHandleOf, resolveDeviceHandle } from './device-handle.ts'
import { resolveTranscribeServices, transcribeWav } from './voice-transcribe.ts'
import { buildUsageView, type UsageProviderConfig, type UsageView } from './usage/usage-check.ts'
import { opendir, rename, stat, readFile as fsReadFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import type { ChatWindowService } from './chat-window.ts'
import { READ_CHAT_DEFAULT_ROWS, READ_CHAT_MAX_ROWS, type ChatPage } from './chat-window.ts'
import { coalesceTurnMessages, EventFolder, foldEvents, type RenderMessage } from './mobile/messages.ts'
import { processModel } from './mobile/process-rows.ts'
import type { PreviewCacheService } from './preview-cache.ts'
import type { SessionObserverRegistry } from './api-proxy-observe.ts'
import type { DependencyDiagnostics } from './api-proxy-diag.ts'
import { PREVIEWS_MAX_SESSIONS } from './preview-cache.ts'
import { fetchLatestVersion, isNewerVersion } from './latest-version.ts'
import { readChatTailPage, readTurnBoundary } from './mobile-log-source.ts'
import { readGitSummary } from './mobile-git.ts'
import { SearchIndex, stripToolBlocks, type SearchIndexRow } from './search-index.ts'
import { SearchIndexer } from './search-indexer.ts'
import pkg from '../package.json'

/**
 * Methods the phone surface may call. Everything else is refused HERE — but
 * note the paired-device cookie also passes the global api/gate for the full
 * ApiProxy surface (gate.ts), so a paired phone is a full-control credential:
 * the allowlist only constrains this /m/api proxy, not the cookie's reach.
 * stop() revokes every device; the loopback panel can also revoke one
 * device at a time.
 */
export const MOBILE_ALLOWLIST: ReadonlySet<string> = new Set([
  'mobile.listDirectory',
  'mobile.readFile',
  'mobile.readChat',
  'mobile.logTail',
  'mobile.sessionState',
  'mobile.gitSummary',
  'workspace.create',
  'workspace.list',
  'workspace.rename',
  'workspace.delete',
  // Session delete (the desktop's archive semantics): idempotent, reversible,
  // single-id — makes the phone's delete persist across refreshes.
  'workspace.archiveSession',
  'agentPreset.list',
  'session.create',
  'session.list',
  'session.history',
  'session.search',
  'session.prompt',
  'session.updateQueue',
  'session.models',
  'session.selectModel',
  // 会话页的子代理徽标/树要读它（只读、按 parent 限定）。此前不在名单里，
  // 每打开一个会话都吃一次 403，徽标于是永远是空的。
  'subagent.list',
  'session.rename',
  'session.cancel',
  'settings.read',
  'settings.mutate',
])

/**
 * Settings writes a paired phone may issue. The host settings domain is
 * loopback-only over HTTP, so the plugin is the phone's only path into it —
 * and it must be the narrowest path: only path-addressed `set` ops inside
 * these exact namespace paths pass. Everything sensitive (keys, plugins,
 * model endpoints, network, permissions, memory) stays desktop-only.
 * `unset` is refused on purpose: removal semantics are never needed from
 * the phone. A `'*'` entry allows any single field of that namespace
 * (UI-only namespaces like dsh-better-sidebar).
 */
const SETTINGS_WRITE_WHITELIST: Record<string, readonly (readonly string[])[]> = {
  'ui-theme': [['preference']],
  'ui-conversation': [['busyEnter']],
  'subagent-model-selection-settings': [['enabled'], ['allowedModels']],
  'agent-default-model': [['model'], ['provider'], ['reasoningEffort']],
  'agent-loop': [['maxParallelToolCalls']],
  'better-sidebar': [['*']],
  // 手机自己的配置。`enabled` 故意不在列表里：关掉远程访问入口会让这台手机
  // 立刻失去连接，这个开关只能从桌面端关。
  'dsh-palm': [['mobileEnterToSend'], ['offlineAfterMs'], ['maxDevices'], ['tokenTtlMs']],
}

/**
 * Locally answered display-preference method (the phone's read-only
 * surface preferences; never proxied to the host ApiProxy and never a
 * settings-domain write).
 */
const MOBILE_PREFERENCES_METHOD = 'mobile.preferences'
const MOBILE_PENDING_METHOD = 'mobile.pending'
const MOBILE_RESPOND_METHOD = 'mobile.respond'
const MOBILE_LIST_DIRECTORY_METHOD = 'mobile.listDirectory'
/** Read one text file's content for the phone's file-preview sheet. */
const MOBILE_READ_FILE_METHOD = 'mobile.readFile'
const MOBILE_COMMANDS_METHOD = 'mobile.commands'
/**
 * 手机上选一个文件交给宿主暂存（`ctx.fileUploads.upload`），拿回一个 receiptId。
 *
 * 宿主的 prompt 内容里 `{ type: 'file', receiptId }` 才是文件附件的正式形态：字节由
 * 附件服务落盘、按会话暂存，模型收到的是引用而不是一段内联 base64。手机端没有桌面
 * 那条 `/upload` 直传通道（那条走桌面鉴权），所以由插件在本通道里代传。
 */
/**
 * 一条 prompt 里最多带几个文件附件。
 *
 * 手机端本来就在选片时拦着（`MAX_ATTACHED_FILES = 5`），但那只是礼貌：这条通道对已
 * 配对设备是全权，换个客户端（或一次脚本）就能塞 50 个。宿主侧再数一次，超了直接拒，
 * 免得一次误操作把整轮上下文撑爆。
 */
export const MAX_PROMPT_FILE_PARTS = 5

/** 数一条 prompt 里的文件附件（`{ type: 'file' }` 部分）。 */
export function countPromptFileParts(payload: unknown): number {
  const content = (payload as { content?: unknown } | null | undefined)?.content
  if (!Array.isArray(content)) return 0
  let count = 0
  for (const part of content) {
    if (typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'file') count += 1
  }
  return count
}

const MOBILE_UPLOAD_ATTACHMENT_METHOD = 'mobile.uploadAttachment'
/** 单个附件 base64 的字节上限（20 MB 原始字节约 27 MB base64，留一点余量）。 */
const MAX_ATTACHMENT_BASE64_CHARS = 28 * 1024 * 1024
const MOBILE_TRANSCRIBE_METHOD = 'mobile.transcribe'
/** Recent completion-notify decisions (the phone's notification inbox). */
const MOBILE_NOTIFY_EVENTS_METHOD = 'mobile.notifyEvents'
/** npm registry latest-version lookup for the About sheet (host-side). */
const MOBILE_LATEST_VERSION_METHOD = 'mobile.latestVersion'
/** Global session search with workspace attribution (home-page search). */
const MOBILE_SEARCH_ALL_METHOD = 'mobile.searchAll'
/** 自建索引版全局/会话内搜索（期 2）：按会话分组，带高亮区间与游标分页。 */
const MOBILE_SEARCH_METHOD = 'mobile.search'
/** 会话内搜索一次给多少处（上一处/下一处的水位表）：常用字在长会话里能有几百处，
 *  给 200 处既够点，也不会把一次响应撑得太大；超出就标 hasMore，客户端显示「200+」。 */
const CHAT_SEARCH_HITS = 200
/**
 * One host-side running-session enumeration (the run-overview entry's badge):
 * which main-agent sessions have an attached agent running RIGHT NOW. Unlike
 * the mux mirrors this cannot be missed by a late page open — it reads the
 * host's own session table directly. Bounded to the same TTL as session.list
 * so the badge never queries faster than the roster refresh.
 */
const MOBILE_RUNNING_SESSIONS_METHOD = 'mobile.runningSessions'
/**
 * 一轮的实时状态（v3.6）：`{ running, turnStartAt?, lastEventAt?, asOf }`。
 *
 * 这是手机唯一该读的「还在跑吗」：宿主把帧镜像与日志边界按 seq 比一次，给出结论。
 * 手机端不再自己推断（静默阈值、边界缺席、名单 running 全部退场）。
 */
const MOBILE_TURN_STATE_METHOD = 'mobile.turnState'
/**
 * 轮次大纲（导航清单要的 `{ turn, seq, prompt, response }[]`）。
 *
 *  尾页刻意不带它（一个 87 KB，首屏不需要），而手机端的宿主权威页又只在"尾页完全没有
 *  投影"时才补 —— 尾页一旦带上了权限/上下文投影，这份大纲就永远到不了手机，于是
 *  轮次清单里只剩已加载的那两三抡。这里单独开一条只读通道：数据来自花名册枚举留下的
 *  投影快照（内存查表，不读日志、不触发整页解压）。
 */
const MOBILE_TURN_OUTLINE_METHOD = 'mobile.turnOutline'
/** 排队消息的宿主快照（inbox 投影的 next-turn）。宿主只发投影帧、从不发
 *  session/queue；而投影帧实测也到不了手机（排队后 6 秒 0 帧），所以这里按需直读
 *  同一份花名册快照，不读日志、不解压。 */
const MOBILE_INBOX_METHOD = 'mobile.inbox'
/**
 * 目标投影（`mobile.goal` 与 `mobile.sessionState` 共用）。
 *
 * 优先问进程内的目标服务：会话里刚建的目标在花名册快照里还没有，只读快照就是
 * 「目标条永远不出现」。服务不可用（没装/会话冷）时退回快照，必要时现读一页日志。
 */
async function readGoalProjection(
  proxy: ApiProxy,
  deps: { agents?: AgentLookup | undefined; goals?: GoalLookup | undefined },
  sessionId: string,
  wantsFresh: boolean,
): Promise<{ goal: unknown; activation?: 'armed' | 'disarmed' }> {
  const live = goalSnapshotOf(deps, sessionId)
  let goal: unknown = preferLiveGoal(live, sessionProjectionSnapshots.get(sessionId)?.block.values?.['goal'])
  if (wantsFresh && live === undefined) {
    try {
      const page = await proxy.sessions.history({ rpcId: RpcId('dsh-palm-mobile-goal'), payload: { sessionId, maxMessages: 1, fresh: true } } as never)
      if (page.result.ok) {
        const values = (page.result.value as { projections?: { values?: Record<string, unknown> } }).projections?.values
        if (values?.['goal'] !== undefined) goal = values['goal']
      }
    } catch {
      // 读不到就用快照：目标条显示旧相位，比整条消失好。
    }
  }
  const activation = goalActivationOf(deps, sessionId)
  return { goal: goal === undefined ? null : goal, ...(activation === undefined ? {} : { activation }) }
}

/** 原子快照：行 + 队列 + 回合一次给全（手机端状态仓的唯一权威来源）。 */
const MOBILE_SESSION_STATE_METHOD = 'mobile.sessionState'

/** 队列版本：每次入队/插队/删除/编辑 +1，客户端据此让乐观项退场。 */
const MOBILE_GOAL_METHOD = 'mobile.goal'
/**
 * 目标动作（暂停/恢复/编辑/清除）的原生通道。
 *
 * 桌面端那条 `remote.goals.*` 在手机上不可用，`/goal <verb>` 命令虽然也能改相位，
 * 但**暂停的语义不一样**：桌面端点暂停只是撤掉"允许自动继续"这条进程内授权
 * （durable 相位仍写着 active），命令行的 `/goal pause` 却把 durable 相位改成
 * paused。手机照抄命令就会出现"桌面点了暂停、手机条子还写暂停"的错位 —— 用户
 * 看到的就是这个。这里直连宿主目标服务，动作语义与桌面端逐字一致。
 */
export const MOBILE_GOAL_ACTION_METHOD = 'mobile.goalAction'
/** The published package the About sheet checks against. */
const PACKAGE_NAME = '@eternalloveone/dsh-palm'
/**
 * The host-side fallback transcription service (dsh-palm.yaml `transcribe:`),
 * returned so the phone can import it into its own service list. The phone
 * is a paired device (full trust) and the key already rides every transcribe
 * request from the phone, so returning it here adds no new exposure.
 */
const MOBILE_VOICE_SERVICES_METHOD = 'mobile.voiceServices'
/**
 * Local slash-command EXECUTION (the directory method above is discovery
 * only). The host prompt channel does not intercept `/`-prefixed text, so a
 * command line sent through `session.prompt` reaches the model verbatim —
 * this method is the phone's only correct way to run one.
 */
const MOBILE_COMMAND_EXEC_METHOD = 'mobile.commandExec'
/**
 * Read-only git summary for one directory (branch / changes / recent
 * commits). Answered locally on the host: the phone gets one structured
 * answer instead of shelling out and parsing text, and the command set is
 * fixed so nothing on the phone can mutate a repository.
 */
const MOBILE_GIT_SUMMARY_METHOD = 'mobile.gitSummary'
/**
 * Folded-view chat reads (v3): the host serves message rows from its
 * mux-fed window cache instead of the raw event stream. Answered locally;
 * the phone falls back to `session.history` when this method is absent.
 */
const MOBILE_READ_CHAT_METHOD = 'mobile.readChat'
/** 会话日志尾部直读（C）：只解尾部 zstd 帧，供手机折叠首屏。 */
const MOBILE_LOG_TAIL_METHOD = 'mobile.logTail'
/**
 * `mobile.readChat` 可以顺带取回的小读取（白名单）：打开会话时这两份目录本来
 * 各自要一次隧道往返，现在跟页面一起回来。名字之外的请求一律忽略。
 */
const READ_CHAT_INCLUDE_NAMES = ['models', 'subagents'] as const
type ReadChatIncludeName = (typeof READ_CHAT_INCLUDE_NAMES)[number]

/** 解析 `readChat` 的 `include`：只认白名单，去重且保持请求顺序。 */
function readChatInclude(raw: unknown): ReadChatIncludeName[] {
  if (!Array.isArray(raw)) return []
  const picked: ReadChatIncludeName[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const name = READ_CHAT_INCLUDE_NAMES.find(candidate => candidate === value)
    if (name !== undefined && !picked.includes(name)) picked.push(name)
  }
  return picked
}
/**
 * Batch last-message previews (v3.1): the session-list page's preview lines
 * served from the host's mux-fed preview cache in ONE call — instead of one
 * full-log `session.history` read per row. Answered locally; the phone falls
 * back to per-row history reads when this method is absent.
 */
const MOBILE_PREVIEWS_METHOD = 'mobile.previews'
/**
 * Which session the phone has open (v3.4). The host opens ONE
 * `session.follow({assistantStream:true})` for it, which is what turns on
 * token-level streaming; the phone re-asserts on a slow cadence so a dropped
 * SSE stream cannot leave the registration stale.
 */
const MOBILE_OBSERVE_METHOD = 'mobile.observe'
/** 依赖自检（手机端「关于」里的自检列表）。 */
const MOBILE_DIAGNOSTICS_METHOD = 'mobile.diagnostics'
/**
 * Write-only perf capture intake (v1.3.5). The phone's instrumentation
 * (`window.__dshPalmPerf.stats()`, armed by `?perf=1`) is measured IN the
 * browser, so the numbers can only come from the device — this method is how
 * they get here without asking the user to wire up remote debugging: the phone
 * taps a button, the host writes one JSON file, and the agent reads it.
 */
const MOBILE_PERF_METHOD = 'mobile.perf'
/**
 * 「刚结束」账本的宿主侧落盘。
 *
 * 手机端原来只在 localStorage 里记一份：换个浏览器/清一次缓存，运行中页的「刚结束」
 * 就空了。账本放宿主这边（跟着 perfDir 走），同一台机器的任何客户端读到同一份。
 */
const MOBILE_FINISHED_RUNS_METHOD = 'mobile.finishedRuns'
/**
 * Write-only error-report intake. The always-on mobile error ring hands each
 * debounced record here; the host validates the (already-sanitized) shape,
 * writes it to `dsh-palm-errors/`, and pushes on first sight of a fingerprint,
 * gated by a 60-minute cooldown. The file name is generated host-side so the
 * record's strings can never steer a path.
 */
const MOBILE_ERROR_METHOD = 'mobile.error'
/** 会话里引用过的图片字节（事件只带 attachmentId 引用，字节按需取）。 */
const MOBILE_READ_ATTACHMENT_METHOD = 'mobile.readAttachment'
/**
 * Mux frames every paired device receives regardless of which session it has
 * open: the control mirrors (queue/jobs/projection), the session-list state,
 * and the approval/question panels — all global surfaces that do not follow
 * the open chat. Every other frame is session-scoped and filtered per device
 * (see `handleEvents`), so a phone never pays tunnel traffic for sessions it
 * is not looking at.
 */
const MUX_ALWAYS_FORWARDED = new Set<string>([
  'session/subscribed',
  'session/queue',
  'session/jobs',
  'session/projection',
  'session/added',
  'session/removed',
  'session/status',
  'session/activity',
  'session/error',
  'approval/requested',
  'approval/resolved',
  'question/requested',
  'question/resolved',
  'stream/error',
])
/**
 * Per-provider usage/balance display (consumed quota for Ollama Cloud, balance
 * for DeepSeek...). Answered locally by the plugin: reads the desktop's
 * configured providers, resolves each key through the host credentials service
 * (the key never leaves the host), and returns only display facts.
 */
const MOBILE_USAGE_METHOD = 'mobile.usage'
const MOBILE_SEARCH_MESSAGES_METHOD = 'mobile.searchMessages'
/**
 * Web Push subscription management (L2) + notify config (thresholds, L3
 * channels). All three are plugin-local methods: they never proxy a host
 * method, and the paired-device gate is the only access control.
 */
const MOBILE_PUSH_SUBSCRIBE_METHOD = 'push.subscribe'
const MOBILE_PUSH_UNSUBSCRIBE_METHOD = 'push.unsubscribe'
const MOBILE_PUSH_CONFIG_METHOD = 'push.config'
/**
 * Paired-device management (P1/P2/P3): list devices, revoke one, rename one,
 * and promote one to primary. All four are plugin-local methods answered by
 * the pairing service — never proxied to the host ApiProxy. The paired-device
 * gate is the only access control (a paired phone is full trust).
 */
const MOBILE_PAIR_DEVICES_METHOD = 'pair.devices'
const MOBILE_PAIR_REVOKE_METHOD = 'pair.revoke'
const MOBILE_PAIR_RENAME_METHOD = 'pair.rename'
const MOBILE_PAIR_SET_PRIMARY_METHOD = 'pair.setPrimary'
/**
 * Session folders (F1): one plugin-local method carrying a discriminated
 * action. Grouping lives host-side so the desktop and every paired phone agree,
 * and so a revoked phone's local wipe cannot destroy the user's organisation.
 * Payload: `{ action: 'list' | 'create' | 'rename' | 'remove' | 'assign', … }`.
 */
const MOBILE_FOLDERS_METHOD = 'mobile.folders'

/**
 * Discover configured providers from the host settings surface. The phone
 * never sees a key here: `apiKeyEnv` is a credential-ref *name* (role
 * `credential-ref`, not `secret`, so the redactor keeps it) and the key itself
 * is resolved host-side through `deps.resolveKey` in the handler.
 */
async function discoverUsageProviders(apiProxy: ApiProxy): Promise<UsageProviderConfig[]> {
  const described = await apiProxy.settings.describe({ rpcId: RpcId('usage-discover'), payload: {} })
  const result = described?.result as
    | { ok?: boolean; value?: { namespaces?: Array<{ ns?: string; value?: unknown }> } }
    | undefined
  if (result?.ok !== true) return []
  const namespaces = result.value?.namespaces ?? []
  // llm-pi-ai: the OpenAI-compatible route table keyed by provider.
  const fromRouteTable = (): UsageProviderConfig[] => {
    const found = namespaces.find(entry => entry.ns === 'llm-pi-ai')
    const providers = (found?.value as { providers?: Record<string, unknown> } | undefined)?.providers
    if (providers === undefined) return []
    return Object.entries(providers).flatMap(([route, raw]) => {
      if (typeof raw !== 'object' || raw === null) return []
      const rec = raw as { apiKeyEnv?: unknown; baseURL?: unknown; displayName?: unknown }
      return [{
        route,
        ...typeof rec.baseURL === 'string' ? { baseURL: rec.baseURL } : {},
        ...typeof rec.displayName === 'string' ? { displayName: rec.displayName } : {},
        ...typeof rec.apiKeyEnv === 'string' ? { apiKeyEnv: rec.apiKeyEnv } : {},
      }]
    })
  }
  // llm-deepseek: the dedicated gateway namespace. The key itself is a
  // stripped secret and never rides the describe view, but its credential-ref
  // *name* is plain config (llm-deepseek's apiKeyEnv field, documented default
  // DEEPSEEK_API_KEY) — the desktop's stored key resolves host-side through
  // the credentials service, exactly as the provider library does at request
  // time.
  const deepseekValue = namespaces.find(entry => entry.ns === 'llm-deepseek')?.value as
    | { models?: unknown; baseURL?: unknown; apiKeyEnv?: unknown }
    | undefined
  const deepseekPresent = deepseekValue !== undefined
    && (Array.isArray(deepseekValue.models) || typeof deepseekValue.baseURL === 'string')
  const fromDeepseek: UsageProviderConfig[] = deepseekPresent
    ? [{
        route: 'deepseek',
        displayName: 'DeepSeek 官方',
        ...(typeof deepseekValue.baseURL === 'string' ? { baseURL: deepseekValue.baseURL } : {}),
        apiKeyEnv: typeof deepseekValue.apiKeyEnv === 'string' && deepseekValue.apiKeyEnv.length > 0
          ? deepseekValue.apiKeyEnv
          : 'DEEPSEEK_API_KEY',
      }]
    : []
  return [...fromRouteTable(), ...fromDeepseek]
}

/** One session.list page (thin phones load incrementally). */
const SESSION_PAGE_SIZE = 40
/** Concurrent SSE mux subscriptions allowed per server (reconnect-tolerant). */
const MAX_SSE_SUBSCRIBERS = 8

/** session.list sort cache: content key -> sorted row array (see dispatch). */
let sessionListSortedCache: { key: string; items: Array<{ updatedAt: number; sessionId: string }> } | undefined

/** 「刚结束」账本的落盘文件（位置同样由 perfDir 决定，源码里不出现本机路径）。 */
let finishedRunsFile: string | undefined
/** 两次后台刷新之间的最小间隔：枚举要 6~30 秒，刷太勤会把宿主变成其他界面的瓶颈。 */
const SESSION_LIST_REFRESH_MIN_MS = 60_000
/** 落盘快照的体积上限；超出即视为异常文件，不读。实测花名册快照约 2.3 MB（全局所有
 *  会话），所以这里必须留足余量 —— 上限设成 2 MB 时会被静默跳过、冷启动修复形同失效。 */
const ROSTER_SNAPSHOT_MAX_BYTES = 16_000_000

/**
 * 宿主记账：全局 mux 流里看到某会话 `turn/end` 就写一条「刚结束」。
 *
 * 为什么必须在宿主侧：客户端的账本只覆盖"手机当时开着、并且看到了这一轮"的会话。
 * 手机没开、或者这一轮是在桌面端跑完的，就永远进不了账本 —— 真机表现是
 * 「刚跑完的会话在运行中页的『刚结束』里找不到」。
 *
 * 标题留空：这里拿不到会话标题，客户端合并时会用自己已知的标题补上（见 recent-finished）。
 */
/** 从花名册缓存里取一条会话的标题（取不到就空串，客户端会兜底）。 */
function titleForSession(sessionId: string): string {
  const items = rosterTtlCache()?.rawItems
  if (items === undefined) return ''
  for (const item of items) {
    if (String(item.sessionId) !== sessionId) continue
    const title = item.projections?.values?.title
    return typeof title === 'string' ? title : ''
  }
  return ''
}

setFinishedRunNotifier(noteHostFinishedRun)

export function noteHostFinishedRun(sessionId: string, finishedAt: number, status: 'done' | 'stopped' | 'error' = 'done'): void {
  // 只记**主会话**：子代理的子会话 id 不带 `session-` 前缀（实测形如
  // `27620806-5737-4663-…`），它们不该出现在用户的「刚结束」清单里。
  if (!sessionId.startsWith('session-')) return
  if (finishedRunsFile === undefined || sessionId === '') return
  try {
    const now = Date.now()
    // 标题尽力从花名册缓存里捞（有就填，没有就留空由客户端补）。
    const title = titleForSession(sessionId)
    const merged = mergeFinishedRuns(readFinishedRuns(finishedRunsFile, now), [{
      sessionId,
      title,
      finishedAt,
      status,
    }], now)
    writeFinishedRuns(finishedRunsFile, merged)
  } catch {
    // 账本写失败不能影响实时流
  }
}

/** Short TTL for the host session-list enumeration (v3.1+; see dispatch).
 *  30s because the phone's list view re-renders cached rows immediately and
 *  re-validates in the background — the TTL only bounds the background
 *  refresh's host cost, and freshness is carried by the row-level update. */
const SESSION_LIST_TTL_MS = 30_000
/** The TTL cache: host rows + archive set, re-served within the window.
 *  Bound to the apiProxy instance so independent proxies (tests spin up one
 *  per server) never share a stale enumeration. */
/** 会话投影快照（每次全量枚举时整体替换）。
 *
 *  手机的权限选择器/上下文占用/轮次大纲都以尾页投影为基线，而日志尾部里只有
 *  消息事件。直接为主页补一次 `sessions.list` 是不可接受的：枚举三千多个会话
 *  要 6~30 秒（见 refreshSessionRoster 的注释）。枚举本来就在跑（列表页），顺手
 *  把每行的投影留下即可，尾页读取只是查表。 */
let sessionProjectionSnapshots = new Map<string, { at: number; block: { asOfSeq?: number; values?: Record<string, unknown> } }>()
/**
 * 排队投影（inbox）上一次"现读"的时刻。
 *
 * 花名册快照里的 inbox 只有在枚举会话时才刷新，**宿主把排队消息认领成下一轮时它不会
 * 变**——手机端照这份快照轮询，卡片就永远挂着「排队中」。所以只要快照里还显示有待发
 * 项，就得开一帧 follow 拿当下的真值；这里记一次时刻，避免每 5 秒的轮询都去读宿主。
 */
const inboxFreshAt = new Map<string, number>()
/** 待发投影的现读节流：手机上每 5 秒轮询一次，宿主这边最多 4 秒真读一次。 */
const INBOX_FRESH_INTERVAL_MS = 4000

/**
 * 快照里**没有**待发项时的现读节流（比上面松）。
 *
 * 空快照原来一律不现读 —— 于是「桌面端新排了一条」手机永远发现不了：快照只在枚举
 * 会话时刷新，桌面往队列里塞消息不会改它，手机就一直按这份空快照画（真机反馈：
 * 桌面有排队消息、手机没有排队条，2026-10-30）。空快照也要能发现新出现的东西，
 * 只是可以慢一点：手机轮询最快 1.5 秒一次，宿主这边 10 秒真读一次足够，也避免
 * 每次都去抢同会话的聊天读。
 */
const INBOX_EMPTY_FRESH_INTERVAL_MS = 3_000

/**
 * 快照里的 inbox 还挂着待发项时，是否需要现读一次真值。
 *
 * 花名册快照只在枚举会话时刷新，宿主把排队消息认领成下一轮并不会更新它——照快照
 * 轮询，手机上那张卡片就永远显示「排队中」，而消息其实早发出去了。这里给出判据，
 * 由调用方决定真的去开 follow（带节流，别把每次轮询都变成一次整页读）。
 */
export function shouldRefreshInbox(
  inbox: unknown,
  now: number,
  lastFreshAt: number | null,
  intervalMs: number = INBOX_FRESH_INTERVAL_MS,
  emptyIntervalMs: number = INBOX_EMPTY_FRESH_INTERVAL_MS,
): boolean {
  const rows = (inbox as { 'next-turn'?: unknown } | null | undefined)?.['next-turn']
  // 快照里还有待发项：要盯着它被宿主认领（否则卡片永远挂「排队中」）。
  // 快照里是空的：也要（更慢地）现读 —— 桌面可能在手机看不到的地方新排了消息，
  // 而快照不会因为队列变化而刷新。两个方向都必须对账。
  const pending = Array.isArray(rows) && rows.length > 0
  if (lastFreshAt === null) return true
  return now - lastFreshAt >= (pending ? intervalMs : emptyIntervalMs)
}
/** 尾页随消息一起下发的投影键（首屏渲染要用的那几个，都很小）。
 *  turnOutline 刻意不在里面：它能有 87 KB，而首屏并不需要它。 */
const TAIL_PAGE_PROJECTION_KEYS = ['permissions', 'contextPressure'] as const
/** TTL for the workspace roster / agent-preset roster caches (v3.2). */
const ROSTER_TTL_MS = 30_000
/** TTL for mobile.runningSessions (the badge is not latency-critical and the
 *  host enumeration is the same session.list walk, so the caches align). */
/**
 * mobile.runningSessions 的答复缓存。
 *
 * 15 秒 → 4 秒（2026-11-01 重启后实测：别处起跑后手机要 13 秒才看见「运行中」，
 * 其中 15 秒缓存就是主因 —— 缓存窗口比前端的 4 秒核对还长，前端问得再勤也是旧答案）。
 * 这个调用本身只是内存读 + 少量日志边界核实，4 秒完全撑得住。
 */
/** reseedRunning 需要的那份代理，随每次请求刷新。 */
let workspaceListTtlCache: { at: number; proxy: ApiProxy; response: { rpcId: string; result: unknown } } | undefined
/** agentPreset.list TTL cache (see dispatch). */
let agentPresetTtlCache: { at: number; proxy: ApiProxy; response: { rpcId: string; result: unknown } } | undefined

/**
 * Drop the roster caches after a mutation the phone itself performed
 * (create/rename/delete/archive): those changes must be visible on the next
 * visit immediately, not after the TTL. MUTATING methods call this; the
 * session-list TTL is also dropped so the new row set shows right away.
 */
function invalidateRosterCaches(): void {
  setRosterTtlCache(undefined)
  workspaceListTtlCache = undefined
  ordinarySearchSnapshotCache = undefined
  // 会话新增/归档/改名：索引要尽快跟上（否则新会话搜不到、已归档的还在）。
  scheduleSearchSync()
}

/**
 * A mutation the phone just performed: drop the roster snapshot and make sure
 * the index catches up soon. Sending a message must not leave search blind for
 * a full re-sync interval, so schedule one incremental pass (multiple mutations
 * inside the window collapse into a single pass).
 */
function invalidateSessionSearch(): void {
  ordinarySearchSnapshotCache = undefined
  scheduleSearchSync()
}

/** One deferred incremental index pass, coalescing bursts of mutations. */
let searchSyncTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSearchSync(): void {
  if (searchSyncTimer !== undefined) return
  searchSyncTimer = setTimeout(() => {
    searchSyncTimer = undefined
    void activeSearchIndexer?.runOnce().catch(() => undefined)
  }, SEARCH_SYNC_DEBOUNCE_MS)
  searchSyncTimer.unref?.()
}

/** TTL for the session→workspace/title attribution backing mobile.searchAll. */
const LOCATE_TTL_MS = 60_000
/** 当前在跑的索引器（宿主进程内唯一）：写操作后可以立刻催它增量同步。 */
let activeSearchIndexer: SearchIndexer | undefined
let locateSessionCache: {
  at: number
  workspace: Map<string, string>
  title: Map<string, string>
  workspaceTitle: Map<string, string>
} | undefined

/**
 * sessionId → owning workspaceId + display title, from workspace.list's
 * attach relation and session.list's title projection. Cache refreshes every
 * LOCATE_TTL_MS; a failed enumeration returns empty maps so the search still
 * answers (hits just lack attribution and fall back to their snippet).
 */
async function locateSessionMeta(apiProxy: ApiProxy): Promise<{
  workspace: Map<string, string>
  title: Map<string, string>
  workspaceTitle: Map<string, string>
}> {
  const now = Date.now()
  if (locateSessionCache !== undefined && now - locateSessionCache.at < LOCATE_TTL_MS) {
    return locateSessionCache
  }
  const workspace = new Map<string, string>()
  const title = new Map<string, string>()
  const workspaceTitle = new Map<string, string>()
  try {
    const [wsResponse, sessionResponse] = await Promise.all([
      apiProxy.workspace.list({ rpcId: RpcId('dsh-palm-locate-ws'), payload: {} } as never),
      apiProxy.sessions.list({ rpcId: RpcId('dsh-palm-locate-s'), payload: {} } as never),
    ])
    const wsValue = (wsResponse as { result?: { ok?: boolean; value?: { items?: Array<{ workspaceId: string; path?: string; title?: string; sessionIds?: string[] }> } } }).result?.value
    const workspacePaths: Array<{ id: string; path: string }> = []
    for (const item of wsValue?.items ?? []) {
      if (typeof item.title === 'string' && item.title !== '') {
        workspaceTitle.set(item.workspaceId, item.title)
      }
      if (typeof item.path === 'string' && item.path !== '') {
        workspacePaths.push({ id: item.workspaceId, path: item.path })
      }
      for (const sessionId of item.sessionIds ?? []) {
        workspace.set(sessionId, item.workspaceId)
      }
    }
    const sessionValue = (sessionResponse as { result?: { ok?: boolean; value?: { items?: Array<{ sessionId: string; cwd?: string; projections?: { values?: Record<string, unknown> } }> } } }).result?.value
    // Some sessions are not explicitly attached to a workspace, but were
    // created under one of its directories. Longest-prefix cwd attribution
    // recovers the owning workspace without another RPC and avoids labeling
    // ordinary project sessions as standalone.
    const normalizePath = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
    for (const item of sessionValue?.items ?? []) {
      const values = item.projections?.values
      const itemTitle = typeof values?.title === 'string' && values.title !== '' ? values.title : undefined
      if (itemTitle !== undefined) title.set(item.sessionId, itemTitle)
      if (!workspace.has(item.sessionId) && typeof item.cwd === 'string' && item.cwd !== '') {
        const cwd = normalizePath(item.cwd)
        const owner = workspacePaths
          .filter(entry => {
            const path = normalizePath(entry.path)
            return cwd === path || cwd.startsWith(`${path}/`)
          })
          .sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length)[0]
        if (owner !== undefined) workspace.set(item.sessionId, owner.id)
      }
    }
  } catch {
    // best-effort attribution
  }
  locateSessionCache = { at: now, workspace, title, workspaceTitle }
  return locateSessionCache
}
/** Message-level hits kept per expanded session hit (bounded view). */
const SEARCH_MESSAGES_LIMIT = 8

interface OrdinarySearchSession {
  sessionId: string
  updatedAt: number
  title?: string
}

interface OrdinarySearchSnapshot {
  sessions: OrdinarySearchSession[]
  byId: Map<string, OrdinarySearchSession>
  workspace: Map<string, string>
  workspaceTitle: Map<string, string>
  rosterPartial: boolean
}

let ordinarySearchSnapshotCache: { at: number; proxy: ApiProxy; value: OrdinarySearchSnapshot } | undefined

/**
 * One authoritative roster for all search paths. Classification failures are
 * fail-closed: an unknown session must never leak a subagent conversation.
 *
 * 冷取一次要 3 秒（宿主那侧要扫会话 + 工作区），而 30 秒 TTL 一过又得重来 ——
 * 表现就是「隔一会儿再搜，第一次要等 3 秒」。所以缓存过期后先进 stale 窗口：
 * 立刻用旧名册作答，后台再刷新（子代理在索引阶段就已排除，旧名册最多让标签
 * 晚几分钟更新，不会漏出不该看的会话）。
 */
const SESSION_SNAPSHOT_STALE_MS = 5 * 60_000
let ordinarySearchSnapshotRefresh: Promise<unknown> | undefined

async function ordinarySearchSnapshot(apiProxy: ApiProxy): Promise<OrdinarySearchSnapshot> {
  const cached = ordinarySearchSnapshotCache
  const fresh = cached !== undefined && cached.proxy === apiProxy && Date.now() - cached.at < SESSION_LIST_TTL_MS
  if (fresh) return cached.value
  const stale = cached !== undefined && cached.proxy === apiProxy && Date.now() - cached.at < SESSION_SNAPSHOT_STALE_MS
  if (stale) {
    // 后台刷新：失败就算了（旧名册还能用），下次再试。必须吞掉异常，否则后台
    // Promise 变成 unhandledRejection 会把宿主进程带走。
    ordinarySearchSnapshotRefresh ??= loadOrdinarySearchSnapshot(apiProxy)
      .catch(() => undefined)
      .finally(() => { ordinarySearchSnapshotRefresh = undefined })
    return cached.value
  }
  const pending = loadOrdinarySearchSnapshot(apiProxy)
  ordinarySearchSnapshotRefresh = pending.catch(() => undefined).finally(() => { ordinarySearchSnapshotRefresh = undefined })
  return await pending
}

async function loadOrdinarySearchSnapshot(apiProxy: ApiProxy): Promise<OrdinarySearchSnapshot> {
  const [sessionResponse, workspaceResponse] = await Promise.all([
    apiProxy.sessions.list({ rpcId: RpcId('dsh-palm-search-roster'), payload: {} } as never),
    apiProxy?.workspace?.list === undefined ? undefined : apiProxy.workspace.list({ rpcId: RpcId('dsh-palm-search-workspaces'), payload: {} } as never).catch(() => undefined),
  ])
  const sessionResult = (sessionResponse as { result?: { ok?: boolean; value?: { items?: Array<{ sessionId: string; updatedAt?: number; cwd?: string; origin?: string; projections?: { values?: Record<string, unknown> } }>; hasMore?: boolean } } }).result
  if (sessionResult?.ok !== true) throw new Error('search session classification unavailable')
  const workspaceResult = (workspaceResponse as { result?: { ok?: boolean; value?: { items?: Array<{ workspaceId: string; path?: string; title?: string; sessionIds?: string[] }>; archivedSessionIds?: string[] } } } | undefined)?.result
  const archived = new Set(workspaceResult?.ok === true ? (workspaceResult.value?.archivedSessionIds ?? []).map(String) : [])
  const workspace = new Map<string, string>()
  const workspaceTitle = new Map<string, string>()
  const workspacePaths: Array<{ workspaceId: string; path: string }> = []
  const normalizePath = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  if (workspaceResult?.ok === true) {
    for (const item of workspaceResult.value?.items ?? []) {
      if (typeof item.title === 'string' && item.title !== '') workspaceTitle.set(item.workspaceId, item.title)
      if (typeof item.path === 'string' && item.path !== '') workspacePaths.push({ workspaceId: item.workspaceId, path: normalizePath(item.path) })
      for (const sessionId of item.sessionIds ?? []) workspace.set(String(sessionId), item.workspaceId)
    }
  }
  const sessions: OrdinarySearchSession[] = []
  for (const item of sessionResult.value?.items ?? []) {
    const sessionId = String(item.sessionId)
    if (item.origin === 'subagent' || archived.has(sessionId)) continue
    const projectedTitle = item.projections?.values?.title
    sessions.push({
      sessionId,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
      ...(typeof projectedTitle === 'string' && projectedTitle !== '' ? { title: projectedTitle } : {}),
    })
    if (!workspace.has(sessionId) && typeof item.cwd === 'string' && item.cwd !== '') {
      const cwd = normalizePath(item.cwd)
      const owner = workspacePaths
        .filter(entry => cwd === entry.path || cwd.startsWith(`${entry.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0]
      if (owner !== undefined) workspace.set(sessionId, owner.workspaceId)
    }
  }
  const value: OrdinarySearchSnapshot = {
    sessions,
    byId: new Map(sessions.map(item => [item.sessionId, item])),
    workspace,
    workspaceTitle,
    rosterPartial: sessionResult.value?.hasMore === true,
  }
  ordinarySearchSnapshotCache = { at: Date.now(), proxy: apiProxy, value }
  return value
}

interface SearchDocument {
  rows: SearchDocumentRow[]
  complete: boolean
}


/** 手机侧写操作后多久安排一次增量同步（多次操作合并成一次）。 */
const SEARCH_SYNC_DEBOUNCE_MS = 3_000
/** 旧入口 mobile.searchAll 最多回多少个会话（老客户端的分页语义）。 */
const SEARCH_ALL_SESSIONS = 20
/** Short-lived cache for mobile.searchAll (query keyed). */
type SearchAllHit = {
  kind: 'title' | 'message'
  sessionId: string
  messageId?: string
  partId?: string
  snippet: string
  /** A/C：命中所在整段 + 段内第几处（老宿主没有这两个字段，客户端要兜住）。 */
  paragraph?: string
  matchIndex?: number
  title?: string
  workspaceId?: string
  workspaceTitle?: string
  seq?: number
}

/**
 * Keep-alive cadence for the mobile SSE streams.
 *
 * This has to stay comfortably below the client's stall threshold (12 s, see
 * DEFAULT_STALL_THRESHOLD_MS in mobile/mux.ts). At 15 s the phone's liveness
 * clock expired between pings no matter what the stream was doing, so an idle
 * session always fell back to polling and the next real event waited for a
 * poll instead of arriving on the wire. 5 s leaves room for a slow event loop
 * or a jittery tunnel while still being cheap: the frame is ~130 bytes.
 */
const DEFAULT_EVENTS_HEARTBEAT_MS = 5_000

/**
 * The set of subagent session ids (origin: 'subagent'). Search must exclude
 * them the same way the session roster does — subagent sessions are internal
 * working sessions, not user conversations. Reuses the session-list TTL cache
 * when fresh; a fetch failure degrades to "no filter" (best-effort).
 */
async function subagentSessionIds(apiProxy: ApiProxy): Promise<Set<string>> {
  const now = Date.now()
  const ttl = rosterTtlCache()
  if (ttl !== undefined && ttl.proxy === apiProxy && now - ttl.at < SESSION_LIST_TTL_MS) {
    return new Set(ttl.rawItems.filter(item => item.origin === 'subagent').map(item => String(item.sessionId)))
  }
  try {
    const response = await apiProxy.sessions.list({ rpcId: RpcId('dsh-palm-search-subagent'), payload: {} } as never)
    const items = (response as { result?: { ok?: boolean; value?: { items?: Array<{ sessionId: string; origin?: 'subagent' }> } } }).result?.value?.items ?? []
    return new Set(items.filter(item => item.origin === 'subagent').map(item => String(item.sessionId)))
  } catch {
    return new Set()
  }
}

/** Route-family dependencies. */
export interface MobileApiDeps {
  /** The pairing service (device gate + cookie name). */
  service: PairingService
  /** The host ApiProxy service (injected by the plugin). */
  apiProxy: ApiProxy
  /** The pending tracker. */
  pendingTracker: PendingTracker
  /** The resolved mobile composer preference (live per request). */
  mobileEnterToSend: () => boolean
  /** The host command registry (absent when the commands service is not composed). */
  commands?: CommandRegistry | undefined
  /** The live agent registry (absent when the agent service is not composed). */
  agents?: AgentLookup | undefined
  /** The host goal service (absent when @deepseek-ai/dsh-goal is not composed). */
  goals?: GoalLookup | undefined
  /** 宿主文件上传服务（absent 时不支持手机端添加附件）。 */
  fileUploads?: FileUploadsLike | undefined
  /**
   * The completion-notify feature (engine + store). Absent when the plugin
   * was composed without it (older configs); the push.* methods and the
   * events.notify stream then answer 404/403 like any unknown method.
   */
  notify?: NotifyService | undefined
  /**
   * Resolve one credential ref name (e.g. `OLLAMA_API_KEY`) to its value. The
   * plugin wires this to the host `credentials` service so the usage feature
   * never touches a key on the phone — resolution happens host-side and the
   * returned value is consumed and discarded here.
   */
  resolveKey?: (refName: string) => Promise<string | undefined>
  /** SSE keep-alive frame cadence for the mux stream (default 5000 ms; test seam). */
  eventsHeartbeatMs?: number
  /**
   * The folded-view chat-window service (v3): `mobile.readChat` reads
   * through it. Absent (older plugin wiring) the method answers
   * unavailable and the phone falls back to `session.history` + local fold.
   */
  chatWindows?: ChatWindowService | undefined
  /**
   * The batch preview service (v3.1): `mobile.previews` reads through it.
   * Absent, the phone falls back to per-row history preview reads.
   */
  previews?: PreviewCacheService | undefined
  /**
   * The session-observer registry (v3.4): `mobile.observe` records which
   * session the phone has open, and the host then translates that session's
   * token stream off the `agent/assistant-stream` host bus (see
   * api-proxy-stream.ts) — that is what brings token-level streaming to the
   * phone. It doubles as the routing table for per-device SSE filtering.
   * Absent, the method answers unavailable and the phone keeps message-level
   * live updates only.
   */
  observers?: SessionObserverRegistry | undefined
  /**
   * 依赖自检收集器。手机端「关于」里的自检列表读它：setup 期登记的各条宿主契约
   * 是否可用，加上运行期各总线事件收到过多少帧（事件被改名/停发时注册仍会成功，
   * 只有帧计数能证明它还活着）。
   */
  diagnostics?: DependencyDiagnostics | undefined
  /**
   * Directory that accepts `mobile.perf` captures (absent = the method answers
   * unavailable). The plugin passes one next to its devices store, so a capture
   * lands beside the rest of the plugin's own state.
   */
  perfDir?: string | undefined
  /**
   * Directory that accepts `mobile.error` reports (absent = the method answers
   * unavailable, and only the memory ring keeps failures). Same posture as
   * {@link perfDir}: the plugin passes one next to its devices store.
   */
  errorDir?: string | undefined
  /**
   * 自建搜索索引库的落盘路径（node:sqlite 单文件）。缺省或 Node 不带
   * 
ode:sqlite 时整套索引关闭，搜索退回宿主 FTS + 子串补扫的旧路径。
   */
  searchIndexPath?: string | undefined
  /**
   * Session folders (F1). Absent = the phone hides folder chips and
   * `mobile.folders` answers unavailable (older plugin wiring).
   */
  folders?: SessionFolders | undefined
  /**
   * 测试/端到端用：开跑后**等**第一趟索引走完再返回，这样断言不必和后台赛跑。
   * 生产不设（建库全程后台，首个 pass 延迟 15s）。
   */
  searchIndexEager?: boolean | undefined
}

/**
 * What the phone's "关于 → 健康" block shows.
 *
 * `csv`-style single facts are not enough to answer "why is my phone silent":
 * the host must say which protocol/frames it speaks (contract drift), how many
 * push subscriptions exist, and whether deliveries are failing. Combined with
 * the client-side service-worker state this replaces the old manual
 * `COMPATIBILITY.md` checklist ("go look at five places").
 */
export interface MobileHealthReport {
  /** dsh-palm version answering this request. */
  palmVersion: string
  /** Mobile wire revision (bumped only on breaking frame/method changes). */
  wire: number
  /** Frame discriminants this host may publish. */
  frames: string[]
  /** Methods this host exposes on /m/api. */
  methods: string[]
  /** Dependency self-check snapshot (setup registration + runtime frame counts). */
  checks: unknown[]
  /** Push state; absent when the notify feature is not composed. */
  push?: {
    subscriptions: number
    delivery?: { total: number; sent: number; failed: number; dropped: number; since: number }
  }
  /** Epoch ms this report was built. */
  now: number
}

/**
 * Build the health report from the live deps.
 * @param deps - notify + diagnostics sources (both optional).
 * @param now - clock seam for tests.
 * @returns the payload `mobile.diagnostics` answers with.
 */
export function buildHealthReport(
  deps: Pick<MobileApiDeps, 'notify' | 'diagnostics'>,
  now: number = Date.now(),
): MobileHealthReport {
  const notify = deps.notify
  let push: MobileHealthReport['push']
  if (notify !== undefined) {
    const subscriptions = Object.keys(notify.store.listSubscriptions()).length
    const summary = notify.store.deliverySummary()
    push = {
      subscriptions,
      delivery: {
        total: summary.total,
        sent: summary.sent,
        failed: summary.failed,
        dropped: summary.dropped,
        since: summary.since,
      },
    }
  }
  return {
    palmVersion: pkg.version,
    wire: 1,
    frames: [...MUX_FRAME_TYPES],
    methods: [...MOBILE_ALLOWLIST].sort(),
    checks: deps.diagnostics?.snapshot() ?? [],
    ...(push !== undefined ? { push } : {}),
    now,
  }
}

/** Perf captures kept on disk: newest `PERF_CAPTURE_KEEP` win, older pruned. */
export const MOBILE_API_PATHS = {
  events: '/m/api/events.mux',
  notify: '/m/api/events.notify',
} as const

/** The mobile-api prefix (every other path under it is a method name). */
const MOBILE_API_PREFIX = '/m/api'
/** Method extraction: the prefix plus one slash. */
const MOBILE_API_METHOD_PREFIX = `${MOBILE_API_PREFIX}/`

/**
 * Build the mobile data-channel routes.
 * @param deps - pairing service + apiProxy.
 * @returns the routes to register on webServer.
 */
/**
 * 进程内已打开的索引库。宿主停服和端到端测试收尾时统一关掉 —— sqlite 文件句柄
 * 不释放，Windows 上连临时目录都删不掉。
 */
const openSearchIndexes = new Set<SearchIndex>()

/** 关闭本进程打开过的全部搜索索引（停服 / 测试收尾用）。 */
export function closeSearchIndexes(): void {
  for (const index of openSearchIndexes) index.close()
  openSearchIndexes.clear()
}
export function makeMobileApiRoutes(deps: MobileApiDeps): WebRoute[] {
  // 花名册快照的落盘位置：跟着 perfDir 走（由插件配置决定），源码里不写任何本机路径。
  // perfDir 未配置时（测试环境）自动退化为纯内存缓存。
  setRosterFile(deps.perfDir === undefined ? undefined : join(deps.perfDir, 'roster-snapshot.json'))
  finishedRunsFile = deps.perfDir === undefined ? undefined : join(deps.perfDir, 'finished-runs.json')
  const { service, apiProxy, mobileEnterToSend } = deps
  const eventsHeartbeatMs = deps.eventsHeartbeatMs ?? DEFAULT_EVENTS_HEARTBEAT_MS

  // ---- 自建搜索索引（期 1：影子模式，不改变任何现有返回）----
  let searchIndexPromise: Promise<SearchIndex | undefined> | undefined
  let searchIndexer: SearchIndexer | undefined

  /**
   * 第一次手机请求时才起索引。宿主启动不抢资源；建库在后台按 60ms/页限速跑，
   * 手机照旧用旧路径，索引追上之前不给任何结论。
   */
  const ensureSearchIndex = async (): Promise<SearchIndex | undefined> => {
    if (searchIndexPromise !== undefined) return await searchIndexPromise
    searchIndexPromise = (async () => {
      const path = deps.searchIndexPath
      if (path === undefined) return undefined
      const index = await SearchIndex.open(path)
      if (index === undefined) return undefined
      openSearchIndexes.add(index)
      searchIndexer = new SearchIndexer({
        index,
        // 花名册复用搜索那套快照：subagent / 空会话 / 已归档会话都在这里被排除。
        listSessions: async () => (await ordinarySearchSnapshot(apiProxy)).sessions,
        readRows: async (sessionId, beforeSeq, maxMessages) => {
          const request = {
            rpcId: RpcId('dsh-palm-search-index'),
            payload: { sessionId, maxMessages, ...(beforeSeq === undefined ? {} : { beforeSeq }) },
          }
          const response = await apiProxy.sessions.history(request as never)
          if (!response.result.ok) return { rows: [], hasMore: false }
          const value = response.result.value as { events?: Array<{ event: unknown; view?: unknown }>; hasMore?: boolean } | undefined
          // 历史页按「条数」切，切点可能落在一轮（turn）中间：这一页折出来的第一张卡
          // 只是「半截回合」。手机端的窗口是按整轮折叠的，索引若按半截行建文档，就会
          // 出现「搜得到、点过去一个高亮都没有」的命中（真机：一条命中的正文只存在于
          // 索引里）。往前补读到 turn/start 或用户消息为止，索引与渲染才用同一个切点。
          let rawEvents = value?.events ?? []
          let hasMore = value?.hasMore === true
          const isBoundary = (entry: { event?: unknown } | undefined): boolean => {
            const type = (entry?.event as { type?: unknown } | undefined)?.type
            return type === 'turn/start' || type === 'user/message'
          }
          for (let attempt = 0; attempt < 3; attempt += 1) {
            if (rawEvents.length === 0 || isBoundary(rawEvents[0])) break
            const oldestSeq = (rawEvents[0]?.event as { seq?: unknown } | undefined)?.seq
            if (typeof oldestSeq !== 'number') break
            const older = await apiProxy.sessions.history({
              rpcId: RpcId('dsh-palm-search-index-align'),
              payload: { sessionId, maxMessages, beforeSeq: oldestSeq },
            } as never)
            if (!older.result.ok) break
            const olderValue = older.result.value as { events?: Array<{ event: unknown; view?: unknown }>; hasMore?: boolean } | undefined
            const olderEvents = olderValue?.events ?? []
            if (olderEvents.length === 0) break
            // 补读必须真的更早：游标若被当成「含端点」，同一段会被重复读三遍。
            const olderMax = olderEvents.reduce((max, item) => {
              const at = (item.event as { seq?: unknown } | undefined)?.seq
              return typeof at === 'number' && at > max ? at : max
            }, -1)
            if (olderMax < 0 || olderMax >= oldestSeq) break
            rawEvents = [...olderEvents, ...rawEvents]
            hasMore = olderValue?.hasMore === true
          }
          const events = rawEvents.map(entry => ({ ...(entry.event as object), ...(entry.view !== undefined ? { view: entry.view } : {}) }))
          const folded = coalesceTurnMessages(new EventFolder(foldEvents(events as never)).snapshot())
          const rows: SearchIndexRow[] = documentRows(folded).map(row => ({
            messageId: row.messageId ?? `${sessionId}:${row.seq}`,
            seq: row.seq,
            ...(row.partId !== undefined ? { partId: row.partId } : {}),
            text: row.text,
            user: row.user,
          }))
          // 页游标取「这一页所有事件」的最小 seq：一整页工具/推理事件折叠后是 0 条文档，
          // 但索引器仍然得往更早走，否则这个会话永远补不完。
          let nextBeforeSeq: number | undefined
          for (const entry of rawEvents) {
            const seq = (entry.event as { seq?: unknown } | undefined)?.seq
            if (typeof seq !== 'number') continue
            if (nextBeforeSeq === undefined || seq < nextBeforeSeq) nextBeforeSeq = seq
          }
          return {
            rows,
            hasMore,
            ...(nextBeforeSeq === undefined ? {} : { nextBeforeSeq }),
          }
        },
        log: (message) => { console.log('[dsh-palm search-index]', message) },
      })
      activeSearchIndexer = searchIndexer
      searchIndexer.start()
      // 端到端测试要确定性：先把第一趟跑完，免得断言和后台建库赛跑。
      if (deps.searchIndexEager === true) await searchIndexer.runOnce()
      return index
    })()
    return await searchIndexPromise
  }

  // 构造即开跑：索引在后台自己建，手机就算一直不开也会追上（首个 pass 延迟 15s，
  // 建库按 60ms/页限速，不占宿主启动时间）。
  void ensureSearchIndex().catch(() => undefined)

  /**
   * Refresh the paired device's presence and report whether it is live.
   * The mobile surface (unlike the desktop Web UI) has no `/api/pair/heartbeat`
   * sender, so any activity on the mobile channel — a gated RPC, or the live
   * SSE stream staying open — must count as presence. Without this, an
   * idle-but-connected phone ages past `offlineAfterMs` and the desktop panel
   * wrongly reports it as disconnected.
   */
  const touchDeviceFor = (req: IncomingMessage): boolean => {
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    if (deviceId === undefined) return false
    return service.touchDevice(deviceId)
  }

  /** The phone gate: a live paired-device cookie, or nothing else proceeds. */
  const gateOk = (req: IncomingMessage): boolean => {
    return touchDeviceFor(req)
  }

  const handleMethod = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    // 第一次通过门禁的手机请求就顺手把索引拉起来（幂等；之后再进来只是等同一个 promise）。
    void ensureSearchIndex().catch(() => undefined)
    if (!gateOk(req)) {
      // Rejected early: drain whatever body the client sent so the request
      // stream (and the keep-alive connection) is released, not stalled.
      req.resume()
      writeJson(res, 403, { ok: false, error: { code: 'unpaired', message: 'mobile session is not paired' } })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    if (!pathname.startsWith(MOBILE_API_METHOD_PREFIX)) {
      req.resume()
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown mobile api path' } })
      return
    }
    const method = pathname.slice(MOBILE_API_METHOD_PREFIX.length)
    const isTranscribe = method === MOBILE_TRANSCRIBE_METHOD
    const isPrompt = method === 'session.prompt'
    const local = method === MOBILE_PREFERENCES_METHOD
      || method === MOBILE_PENDING_METHOD
      || method === MOBILE_RESPOND_METHOD
      || method === MOBILE_LIST_DIRECTORY_METHOD
      || method === MOBILE_READ_FILE_METHOD
      || method === MOBILE_COMMANDS_METHOD
      || method === MOBILE_UPLOAD_ATTACHMENT_METHOD
      || method === MOBILE_COMMAND_EXEC_METHOD
      || method === MOBILE_VOICE_SERVICES_METHOD
      || method === MOBILE_PUSH_SUBSCRIBE_METHOD
      || method === MOBILE_PUSH_UNSUBSCRIBE_METHOD
      || method === MOBILE_PUSH_CONFIG_METHOD
      || method === MOBILE_NOTIFY_EVENTS_METHOD
      || method === MOBILE_GIT_SUMMARY_METHOD
      || method === MOBILE_LATEST_VERSION_METHOD
      || method === MOBILE_SEARCH_METHOD
      || method === MOBILE_SEARCH_ALL_METHOD
      || method === MOBILE_SEARCH_MESSAGES_METHOD
      || method === MOBILE_RUNNING_SESSIONS_METHOD
      || method === MOBILE_TURN_STATE_METHOD
      || method === MOBILE_TURN_OUTLINE_METHOD
      || method === MOBILE_INBOX_METHOD
      || (method as string) === MOBILE_SESSION_STATE_METHOD
      || method === MOBILE_GOAL_METHOD
      || method === MOBILE_GOAL_ACTION_METHOD
      || method === MOBILE_USAGE_METHOD
      || method === MOBILE_READ_CHAT_METHOD
      || method === MOBILE_LOG_TAIL_METHOD
      || method === MOBILE_OBSERVE_METHOD
      || method === MOBILE_DIAGNOSTICS_METHOD
      || method === MOBILE_PERF_METHOD
      || method === MOBILE_FINISHED_RUNS_METHOD
      || method === MOBILE_ERROR_METHOD
      || method === MOBILE_READ_ATTACHMENT_METHOD
      || method === MOBILE_PREVIEWS_METHOD
      || method === MOBILE_PAIR_DEVICES_METHOD
      || method === MOBILE_PAIR_REVOKE_METHOD
      || method === MOBILE_PAIR_RENAME_METHOD
      || method === MOBILE_PAIR_SET_PRIMARY_METHOD
      || method === MOBILE_FOLDERS_METHOD
      || isTranscribe
    if (!MOBILE_ALLOWLIST.has(method) && !local) {
      req.resume()
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: `method ${method} is not exposed to the mobile surface` } })
      return
    }
    let envelope: unknown
    try {
      // Voice transcription carries a base64 WAV (~2.5 MB per 10 s of 16 kHz
      // mono); session.prompt carries attached images (up to 4 × 256 KiB of
      // base64 per the mobile image compressor, image.ts DEFAULT_MAX_BYTES);
      // a perf capture carries either a few KB of aggregates or the raw mark
      // ring (~200 KB, see PERF_RAW_MAX_BYTES); everything else stays at the
      // small JSON budget.
      const bodyBudget = isTranscribe
        ? 12 * 1024 * 1024
        // 附件上传是这条通道里唯一"本来就很大"的请求：默认那 64 KB 只够放一段
        // JSON，20 MB 的文件会被 413 挡在门外（实测就是这里把附件功能掐死）。
        // 给这条方法一份自己的预算，再留 1 MB 给 JSON 包装（名字、会话 id、转义）。
        : isPrompt ? 2 * 1024 * 1024
          : method === MOBILE_PERF_METHOD ? PERF_RAW_MAX_BYTES + 4096
            : method === MOBILE_UPLOAD_ATTACHMENT_METHOD ? MAX_ATTACHMENT_BASE64_CHARS + 1024 * 1024
              : 64 * 1024
      envelope = await readBoundedJson(req, bodyBudget)
    } catch (error) {
      if (error instanceof Error && error.message === 'body too large') {
        // Consume the remainder to EOF BEFORE answering. The strict reader
        // stops mid-stream on overflow; replying while the request body is
        // still in flight leaves the connection in a half-consumed state —
        // with `connection: close` the server tears the socket down right
        // after the response flush, and a client still uploading then hits
        // ECONNRESET on its write side (flaky, scheduling-dependent; seen
        // repeatedly in the image-budget spec). Draining first keeps the
        // close orderly on both sides. The drain is bounded by the client's
        // own upload; a client that aborts mid-drain is answered anyway
        // (writeJson swallows a dead socket).
        try {
          for await (const _chunk of req) { /* discard */ }
        } catch {
          // The client aborted mid-upload; fall through to the response.
        }
        // The message rides back through callUnary and shows verbatim on the
        // phone, so it must match the failing channel: a long recording vs an
        // oversized image payload are different problems.
        const message = isTranscribe
          ? '录音过长，请缩短后重试'
          : isPrompt
            ? '内容过大，请压缩图片后重试'
            : '内容过大，无法发送'
        writeJson(res, 400, { ok: false, error: { code: 'payload-too-large', message } })
      } else {
        writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid json body' } })
      }
      return
    }
    const parsed = envelope as { rpcId?: unknown; payload?: unknown }
    const rpcId = typeof parsed?.rpcId === 'string' ? parsed.rpcId : ''
    if (rpcId === '') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing rpcId' } })
      return
    }
    if (isPrompt) {
      const files = countPromptFileParts(parsed.payload)
      if (files > MAX_PROMPT_FILE_PARTS) {
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: {
            ok: false,
            error: { code: 'too-many-files', message: `一次最多 ${MAX_PROMPT_FILE_PARTS} 个文件（收到 ${files} 个）` },
          },
        })
        return
      }
    }
    if (local) {
      if (method === MOBILE_FINISHED_RUNS_METHOD) {
        // 「刚结束」账本：读 / 追加 / 清空。文件跟着 perfDir 走，客户端不传任何路径。
        const body = parsed.payload as { op?: unknown; entries?: unknown; sessionIds?: unknown } | undefined
        const op = body?.op
        try {
          if (op === 'read') {
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: true, value: { entries: readFinishedRuns(finishedRunsFile, Date.now()) } },
            })
            return
          }
          if (op === 'clear') {
            writeFinishedRuns(finishedRunsFile, [])
            writeJson(res, 200, { type: 'server-response', rpcId, result: { ok: true, value: { accepted: true } } })
            return
          }
          if (op === 'remove') {
            // 打开过就删：这就是「只保留没点进去看过的」的实现。
            const ids = Array.isArray(body?.sessionIds)
              ? body.sessionIds.filter((id): id is string => typeof id === 'string')
              : []
            const now = Date.now()
            const kept = readFinishedRuns(finishedRunsFile, now).filter(entry => !ids.includes(entry.sessionId))
            writeFinishedRuns(finishedRunsFile, kept)
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: true, value: { entries: kept } },
            })
            return
          }
          if (op === 'append') {
            const incoming = Array.isArray(body?.entries) ? body.entries : []
            const now = Date.now()
            const merged = mergeFinishedRuns(readFinishedRuns(finishedRunsFile, now), incoming as FinishedRunEntry[], now)
            writeFinishedRuns(finishedRunsFile, merged)
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: true, value: { entries: merged } },
            })
            return
          }
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '未知的账本操作' } },
          })
        } catch (error) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'unavailable', message: String(error) } },
          })
        }
        return
      }
      if (method === MOBILE_PERF_METHOD) {
        const payload = parsed.payload as { capture?: unknown; label?: unknown }
        // Write-only, inert and path-free: the name is generated host-side from
        // the clock and a sanitized label, the body must look like a perf
        // aggregate, and nothing in this branch can read or overwrite anything
        // else — a phone can only ever append a capture to the capture dir.
        const rejection = validatePerfCapture(payload?.capture)
        if (rejection !== undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: rejection } },
          })
          return
        }
        if (deps.perfDir === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'unavailable', message: '宿主未启用性能抓取目录' } },
          })
          return
        }
        try {
          const file = writePerfCapture(
            deps.perfDir,
            payload.capture,
            typeof payload.label === 'string' ? payload.label : 'device',
            Date.now(),
            perfCaptureKind(payload.capture) === 'raw' ? 'raw' : 'aggregate',
          )
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { file: basename(file), bytes: Buffer.byteLength(JSON.stringify(payload.capture)) } },
          })
        } catch (error) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : '写入性能抓取失败' } },
          })
        }
      } else if (method === MOBILE_ERROR_METHOD) {
        const payload = parsed.payload as { report?: unknown; label?: unknown }
        // Write-only, inert and path-free, exactly like mobile.perf: the file
        // name is generated host-side from the clock and the fingerprint, the
        // body must pass strict shape validation (including basename-only frames
        // — a path separator is refused), and nothing here can read or
        // overwrite anything else. On first sight of a fingerprint the intake
        // pushes once (cooldown-gated); a missing notify feature writes and
        // returns without pushing, never an error.
        const rejection = validateErrorReport(payload?.report)
        if (rejection !== undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: rejection } },
          })
          return
        }
        if (deps.errorDir === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'unavailable', message: '宿主未启用错误上报目录' } },
          })
          return
        }
        try {
          const result = ingestErrorReport({ dir: deps.errorDir, report: payload?.report, notify: deps.notify, now: Date.now() })
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { file: basename(result.file), bytes: result.bytes, pushed: result.pushed } },
          })
        } catch (error) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : '写入错误上报失败' } },
          })
        }
      } else if (method === MOBILE_PREFERENCES_METHOD) {
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { mobileEnterToSend: mobileEnterToSend() } },
        })
      } else if (method === MOBILE_PENDING_METHOD) {
        const payload = parsed.payload as any
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: deps.pendingTracker.pending(payload?.sessionId) },
        })
      } else if (method === MOBILE_RESPOND_METHOD) {
        const payload = parsed.payload as any
        // Ownership binding: the rpcId must be a pending item, and it must
        // belong to the session the phone claims. Without this, a phone could
        // answer any rpcId it guesses — and with desktop + phone both online,
        // either could pre-empt the other's approval/question. The pending
        // tracker records each pending rpcId under the session that requested
        // it, so the answer is bound to that session before it reaches the
        // host. An rpcId that is not pending (already resolved elsewhere, or
        // never tracked) is refused rather than silently forwarded.
        const targetRpcId = typeof payload?.rpcId === 'string' ? payload.rpcId : ''
        const claimedSessionId = typeof payload?.response?.sessionId === 'string' ? payload.response.sessionId : undefined
        const ownerSession = deps.pendingTracker.ownerOfRpcId(targetRpcId)
        if (ownerSession === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'not-found', message: '待处理项不存在或已处理' } },
          })
          return
        }
        if (claimedSessionId !== ownerSession) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'conflict', message: '待处理项不属于当前会话' } },
          })
          return
        }
        try {
          const receipt = await apiProxy.respond({
            type: 'client-response',
            rpcId: RpcId(targetRpcId),
            result: { ok: true, value: payload.response },
          })
          // The answer consumed the pending item, so retire it here rather than
          // waiting for the resolved frame to travel the mux stream: the phone
          // routinely answers and leaves in the same breath, and a panel left in
          // the tracker is what re-installed itself on the next visit
          // (mobile.pending serves this tracker). Each call is a no-op for the
          // other panel kind.
          if (receipt.accepted) {
            deps.pendingTracker.resolveApprovalByRpcId(targetRpcId)
            deps.pendingTracker.resolveQuestionByRpcId(targetRpcId)
          }
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: receipt },
          })
        } catch (error) {
          // The host's respond error is internal (e.g. the item was already
          // resolved); the phone only needs a stable refusal, never the
          // host's message.
          console.error('mobile.respond failed', error)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: '应答失败，请重试' } },
          })
        }
      } else if (method === MOBILE_LIST_DIRECTORY_METHOD) {
        const payload = parsed.payload as { path?: unknown; files?: unknown } | undefined
        try {
          // files=true：连文件一起列（手机端「电脑文件」挑选用）。缺省仍只列目录，
          // 工作区浏览那些老调用方拿到的还是原来那套形状。
          const listing = await mobileListDirectory(
            typeof payload?.path === 'string' ? payload.path : undefined,
            payload?.files === true,
          )
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: listing },
          })
        } catch {
          // The host path must not leak to the phone; a generic refusal is
          // enough to render the "不可读" state in the picker.
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'directory-unreadable', message: '目录不可读' } },
          })
        }
      } else if (method === MOBILE_READ_FILE_METHOD) {
        // Text-file preview for the chat's file-path links. The phone is a
        // paired device (full host trust, same boundary as listDirectory);
        // the remaining guards are defensive depth, not the trust line: only
        // a real, regular file is read, the payload is size-bounded, and the
        // bytes must decode as UTF-8 text with no NUL — so a binary/dir
        // answer can never ride this channel. A RELATIVE path (the usual
        // form agents write, e.g. `packages/…/mux.ts`) resolves against the
        // session's cwd when `sessionId` is supplied; without one it can
        // only be read when it resolves from the host process cwd.
        const body = parsed.payload as { path?: unknown; sessionId?: unknown } | undefined
        const raw = typeof body?.path === 'string' ? body.path.trim() : ''
        if (raw === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少文件路径' } },
          })
          return
        }
        try {
          const candidates = await readCandidates(apiProxy, raw, typeof body?.sessionId === 'string' ? body.sessionId : undefined, deps.chatWindows)
          let target: string | undefined
          let info: Awaited<ReturnType<typeof stat>> | undefined
          for (const candidate of candidates) {
            try {
              const probe = await stat(candidate)
              if (probe.isFile()) { target = candidate; info = probe; break }
            } catch {
              // candidate absent: try the next base
            }
          }
          if (target === undefined || info === undefined) {
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: false, error: { code: 'file-unreadable', message: '文件不可读' } },
            })
            return
          }
          const isImage = isImagePath(target)
          if (info.size > (isImage ? MOBILE_READ_IMAGE_MAX_BYTES : MOBILE_READ_FILE_MAX_BYTES)) {
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: false, error: { code: 'file-too-large', message: isImage ? '图片过大，无法预览' : '文件过大，无法预览' } },
            })
            return
          }
          const bytes = await fsReadFile(target)
          if (isImage) {
            const ext = (target.split(/[\\/]/).pop() ?? '').split('.').pop()?.toLowerCase() ?? ''
            const mediaType = IMAGE_MIME[ext] ?? 'application/octet-stream'
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: {
                ok: true,
                value: {
                  kind: 'image' as const,
                  path: target,
                  name: basename(target),
                  dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}`,
                },
              },
            })
            return
          }
          if (bytes.includes(0)) {
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: false, error: { code: 'not-text', message: '二进制文件无法预览' } },
            })
            return
          }
          const text = bytes.toString('utf8')
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { kind: 'text' as const, path: target, name: basename(target), text } },
          })
        } catch {
          // Never leak host paths/errors; the phone renders a generic refusal.
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'file-unreadable', message: '文件不可读' } },
          })
        }
      } else if (method === MOBILE_UPLOAD_ATTACHMENT_METHOD) {
        // 手机端「添加附件」：把选中的文件交给宿主附件服务落盘并暂存，回一个
        // receiptId；随后那条 prompt 用 `{ type: 'file', receiptId }` 引用它。
        //
        // 三条判据都是防御深度而不是信任线（手机=已配对设备）：要有附件服务、
        // 要有活的会话 agent（receipt 绑定在 agent 的会话上）、字节要有上限，
        // 免得一次误选把整份日志/一段视频当附件塞进 rpc 通道。
        const body = parsed.payload as { sessionId?: unknown; name?: unknown; data?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
        const data = typeof body?.data === 'string' ? body.data : ''
        const rawName = typeof body?.name === 'string' ? body.name.trim() : ''
        const name = rawName === '' ? undefined : rawName
        const uploads = deps.fileUploads
        const agent = sessionId === undefined || deps.agents === undefined
          ? undefined
          : deps.agents.get(sessionId)
        if (uploads === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'upload-unavailable', message: '当前宿主不支持添加附件' } },
          })
          return
        }
        if (agent === undefined || agent === null) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'session-cold', message: '这个会话还没准备好，稍后再试' } },
          })
          return
        }
        if (data === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '附件内容是空的' } },
          })
          return
        }
        if (data.length > MAX_ATTACHMENT_BASE64_CHARS) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'payload-too-large', message: '附件太大（上限 20 MB）' } },
          })
          return
        }
        // 设备中途离开就取消这次落盘，不留半份文件。
        const abort = new AbortController()
        res.on('close', () => { if (!res.writableEnded) abort.abort() })
        try {
          const value = await uploads.upload(agent, { data, ...(name === undefined ? {} : { name }) }, abort.signal)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: {
              ok: true,
              value: {
                receiptId: value.receiptId,
                name: value.file?.name ?? name ?? '附件',
                ...(value.file?.bytes === undefined ? {} : { bytes: value.file.bytes }),
              },
            },
          })
        } catch {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'upload-failed', message: '附件上传失败，请重试' } },
          })
        }
      } else if (method === MOBILE_COMMANDS_METHOD) {
        // The host command registry is a plugin service, not an ApiProxy
        // domain: answer locally. The phone's + menu is session-scoped, so the
        // directory resolves the SESSION's agent view — the same effective
        // catalog the desktop composer's `/` popup shows. That matters because
        // the Web deployment moves per-agent rows (plan-mode, command-compact)
        // into agent presets: the plain-context view would silently miss
        // `/plan` and `/compact`. A session that resolves no agent falls back
        // to the plain-context view.
        const body = parsed.payload as { sessionId?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
        const items = resolveCommandDirectory(deps.commands, deps.agents, sessionId)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { items } },
        })
      } else if (method === MOBILE_COMMAND_EXEC_METHOD) {
        // Execute one slash-command line through the host CommandRuntime —
        // the same interception the desktop composer's adjudicated path uses.
        // `session.prompt` never dispatches commands, so this local method is
        // the phone's only channel that cannot leak a `/`-line to the model.
        // A long command like /compact summarizes through the model, so the
        // answer waits with the phone: the request abort (device left
        // mid-call) cancels the host-side handler signal.
        const body = parsed.payload as { sessionId?: unknown; line?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
        const line = typeof body?.line === 'string' ? body.line : undefined
        const abort = new AbortController()
        res.on('close', () => { if (!res.writableEnded) abort.abort() })
        let execution: { commandId: string; result: { kind: string; text?: string } } | undefined
        try {
          const agent = sessionId === undefined || deps.agents === undefined
            ? undefined
            : deps.agents.get(sessionId)
          execution = agent === undefined || deps.commands === undefined || line === undefined
            ? undefined
            : await deps.commands.execute(agent, line, [], abort.signal)
        } catch (error) {
          // Aborted device or a handler crash: the lifecycle is already logged
          // host-side; the phone only needs a terminal envelope. The host's
          // error message is internal and never echoed to the phone.
          console.error('mobile.commandExec failed', error)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: {
              ok: false,
              error: { code: 'command-failed', message: '命令执行失败，请稍后重试' },
            },
          })
          return
        }
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: {
            ok: true,
            value: execution === undefined
              ? { matched: false }
              : { matched: true, kind: execution.result.kind, ...(execution.result.text !== undefined ? { text: execution.result.text } : {}) },
          },
        })
      } else if (method === MOBILE_VOICE_SERVICES_METHOD) {
        // The host-side fallback services (dsh-palm.yaml `transcribe:`), so
        // the phone can show what the desktop config provides. The host API
        // key NEVER leaves the host: the phone cannot use these services
        // directly (transcription rides the host channel, which falls back
        // to this config when the phone sends no services), so only the
        // display facts are returned.
        const dedicated = await resolveTranscribeServices()
        const services = dedicated === undefined
          ? []
          : dedicated.flatMap(entry => 'error' in entry
            ? []
            : [{
              name: entry.service.name ?? 'host 配置',
              baseURL: entry.service.baseURL.replace(/\/+$/, ''),
              model: entry.service.model,
            }])
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { services } },
        })
      } else if (method === MOBILE_PUSH_SUBSCRIBE_METHOD) {
        // L2: store this device's Web Push subscription. The paired-device
        // cookie IS the device identity — the same full-trust credential the
        // rest of /m/api rides — so the subscription is bound to it without a
        // separate handshake. The notify feature is optional: without it the
        // method answers 403 like any unknown local method.
        const notify = deps.notify
        if (notify === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'notify-unavailable', message: '通知功能不可用' } },
          })
          return
        }
        const body = parsed.payload as { subscription?: unknown } | undefined
        const subscription = body?.subscription as { endpoint?: unknown; keys?: unknown } | undefined
        const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint : ''
        const keys = subscription?.keys as { p256dh?: unknown; auth?: unknown } | undefined
        const p256dh = typeof keys?.p256dh === 'string' ? keys.p256dh : ''
        const auth = typeof keys?.auth === 'string' ? keys.auth : ''
        const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
        if (deviceId === undefined || endpoint === '' || p256dh === '' || auth === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '订阅信息不完整' } },
          })
          return
        }
        notify.store.addSubscription(deviceId, { endpoint, keys: { p256dh, auth } })
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { stored: true } },
        })
      } else if (method === MOBILE_PUSH_UNSUBSCRIBE_METHOD) {
        const notify = deps.notify
        if (notify !== undefined) {
          const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
          if (deviceId !== undefined) notify.store.removeSubscription(deviceId)
        }
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { stored: false } },
        })
      } else if (method === MOBILE_PUSH_CONFIG_METHOD) {
        // Read (redacted) or write the notify config. Reads never return
        // credentials — only whether each L3 channel is configured — while
        // writes accept the plaintext values (the paired device is full
        // trust, the same stance as the rest of /m/api).
        const notify = deps.notify
        if (notify === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'notify-unavailable', message: '通知功能不可用' } },
          })
          return
        }
        const body = parsed.payload as { get?: unknown; set?: unknown; test?: unknown } | undefined
        if (body?.test === true) {
          // Settings-page test button: publish one synthetic event through the
          // engine, exactly like a real notification. Sending it straight to
          // the delivery functions (the old behaviour) skipped the inbox and
          // the telemetry, so a test could "succeed" while both stayed empty.
          notify.engine.publishTest()
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { sent: true } },
          })
          return
        }
        if (body?.get === true) {
          const config = notify.store.getConfig()
          const channels = config.channels
          // The VAPID key pair is generated on first read so the phone can
          // subscribe to Web Push without a separate setup step.
          const vapid = notify.store.ensureVapid()
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: {
              ok: true,
              value: {
                turnThresholdMs: config.turnThresholdMs,
                turnCooldownMs: config.turnCooldownMs,
                hideDetails: config.hideDetails === true,
                // Effective kind gates (absent config falls back to the
                // quiet defaults: jobs off, todo on, turns off).
                kinds: {
                  jobs: config.kinds?.jobs === true,
                  todo: config.kinds?.todo !== false,
                  turns: config.kinds?.turns === true,
                  approvals: config.kinds?.approvals !== false,
                },
                vapidPublicKey: vapid.publicKey,
                channels: {
                  serverchan: { configured: channels?.serverchan?.sendKey !== undefined && channels.serverchan.sendKey !== '' },
                  bark: { configured: channels?.bark?.key !== undefined && channels.bark.key !== '' },
                  telegram: {
                    configured: channels?.telegram?.botToken !== undefined && channels.telegram.botToken !== '' && channels.telegram.chatId !== undefined && channels.telegram.chatId !== '',
                  },
                  wxpusher: { configured: channels?.wxpusher?.spt !== undefined && channels.wxpusher.spt !== '' },
                  pushplus: { configured: channels?.pushplus?.token !== undefined && channels.pushplus.token !== '' },
                },
              },
            },
          })
          return
        }
        const patch = body?.set as { turnThresholdMs?: unknown; turnCooldownMs?: unknown; hideDetails?: unknown; kinds?: unknown; channels?: unknown } | undefined
        if (patch === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少配置内容' } },
          })
          return
        }
        const next: Record<string, unknown> = {}
        if (typeof patch.turnThresholdMs === 'number' && Number.isFinite(patch.turnThresholdMs)) {
          next.turnThresholdMs = Math.max(0, Math.round(patch.turnThresholdMs))
        }
        if (typeof patch.turnCooldownMs === 'number' && Number.isFinite(patch.turnCooldownMs)) {
          next.turnCooldownMs = Math.max(0, Math.round(patch.turnCooldownMs))
        }
        if (typeof patch.hideDetails === 'boolean') {
          next.hideDetails = patch.hideDetails
        }
        const kinds = patch.kinds as { jobs?: unknown; todo?: unknown; turns?: unknown; approvals?: unknown } | undefined
        if (kinds !== undefined) {
          const currentKinds = notify.store.getConfig().kinds ?? {}
          next.kinds = {
            ...(kinds.jobs !== undefined
              ? { jobs: kinds.jobs === true }
              : currentKinds.jobs !== undefined ? { jobs: currentKinds.jobs } : {}),
            ...(kinds.todo !== undefined
              ? { todo: kinds.todo === true }
              : currentKinds.todo !== undefined ? { todo: currentKinds.todo } : {}),
            ...(kinds.turns !== undefined
              ? { turns: kinds.turns === true }
              : currentKinds.turns !== undefined ? { turns: currentKinds.turns } : {}),
            ...(kinds.approvals !== undefined
              ? { approvals: kinds.approvals === true }
              : currentKinds.approvals !== undefined ? { approvals: currentKinds.approvals } : {}),
          }
        }
        const channels = patch.channels as { serverchan?: unknown; bark?: unknown; telegram?: unknown; wxpusher?: unknown; pushplus?: unknown } | undefined
        if (channels !== undefined) {
          const current = notify.store.getConfig().channels ?? {}
          const serverchan = channels.serverchan as { sendKey?: unknown } | undefined
          const bark = channels.bark as { key?: unknown } | undefined
          const telegram = channels.telegram as { botToken?: unknown; chatId?: unknown } | undefined
          const wxpusher = channels.wxpusher as { spt?: unknown } | undefined
          const pushplus = channels.pushplus as { token?: unknown } | undefined
          next.channels = {
            ...(serverchan !== undefined
              ? { serverchan: { sendKey: typeof serverchan.sendKey === 'string' ? serverchan.sendKey : '' } }
              : current.serverchan !== undefined ? { serverchan: current.serverchan } : {}),
            ...(bark !== undefined
              ? { bark: { key: typeof bark.key === 'string' ? bark.key : '' } }
              : current.bark !== undefined ? { bark: current.bark } : {}),
            ...(telegram !== undefined
              ? { telegram: { botToken: typeof telegram.botToken === 'string' ? telegram.botToken : '', chatId: typeof telegram.chatId === 'string' ? telegram.chatId : '' } }
              : current.telegram !== undefined ? { telegram: current.telegram } : {}),
            ...(wxpusher !== undefined
              ? { wxpusher: { spt: typeof wxpusher.spt === 'string' ? wxpusher.spt : '' } }
              : current.wxpusher !== undefined ? { wxpusher: current.wxpusher } : {}),
            ...(pushplus !== undefined
              ? { pushplus: { token: typeof pushplus.token === 'string' ? pushplus.token : '' } }
              : current.pushplus !== undefined ? { pushplus: current.pushplus } : {}),
          }
        }
        notify.store.setConfig(next as never)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { saved: true } },
        })
      } else if (method === MOBILE_PAIR_DEVICES_METHOD) {
        // Paired-device roster for the phone's device-management screen. The
        // current device's id rides the cookie so the UI can mark "this phone".
        //
        // The row carries `handle`, NOT `id`: the id is the session credential
        // (see pairing.ts DeviceSnapshot), and returning it here would let one
        // paired phone impersonate every other one — the loopback
        // /api/pair/status response deliberately strips `devices` for the same
        // reason (routes.ts). The admin methods below resolve the handle back.
        const currentDeviceId = readCookie(req.headers.cookie, service.config.cookieName)
        const devices = service.snapshot().devices.map(device => ({
          handle: deviceHandleOf(device.id),
          createdAt: device.createdAt,
          lastSeenAt: device.lastSeenAt,
          online: device.online,
          ...(device.userAgent !== undefined ? { userAgent: device.userAgent } : {}),
          ...(device.name !== undefined ? { name: device.name } : {}),
          ...(device.primary === true ? { primary: true } : {}),
          current: device.id === currentDeviceId,
        }))
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { devices, maxDevices: service.config.maxDevices } },
        })
      } else if (method === MOBILE_PAIR_REVOKE_METHOD) {
        const body = parsed.payload as { handle?: unknown } | undefined
        const handle = typeof body?.handle === 'string' ? body.handle : ''
        const target = resolveDeviceHandle(service.snapshot().devices, handle)
        if (target === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '设备不存在' } },
          })
          return
        }
        const currentDeviceId = readCookie(req.headers.cookie, service.config.cookieName)
        // Revoking *another* device is an anti-theft control, so it must not be
        // reachable from the device it is meant to constrain: a phone can always
        // drop itself ("退出本机"), everything else is desktop-only.
        if (target !== currentDeviceId && !isLoopbackClient(req)) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'desktop-only', message: '移除其他设备请在桌面端操作' } },
          })
          return
        }
        const removed = service.revoke(target)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { removed } },
        })
      } else if (method === MOBILE_PAIR_RENAME_METHOD) {
        const body = parsed.payload as { handle?: unknown; name?: unknown } | undefined
        const handle = typeof body?.handle === 'string' ? body.handle : ''
        const name = typeof body?.name === 'string' ? body.name : ''
        const target = resolveDeviceHandle(service.snapshot().devices, handle)
        if (target === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '设备不存在' } },
          })
          return
        }
        const renamed = service.renameDevice(target, name)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { renamed } },
        })
      } else if (method === MOBILE_PAIR_SET_PRIMARY_METHOD) {
        // "Primary" is exempt from idle expiry, so promoting a device is a
        // privilege grant. Handing it to a phone lets a stolen handset promote
        // itself and kick the owner out — desktop only, same as revoke-other.
        if (!isLoopbackClient(req)) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'desktop-only', message: '设为主设备请在桌面端操作' } },
          })
          return
        }
        const body = parsed.payload as { handle?: unknown } | undefined
        const handle = typeof body?.handle === 'string' ? body.handle : ''
        const target = resolveDeviceHandle(service.snapshot().devices, handle)
        if (target === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '设备不存在' } },
          })
          return
        }
        const promoted = service.setPrimary(target)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { promoted } },
        })
      } else if (method === MOBILE_FOLDERS_METHOD) {
        // Session folders (F1). One method, discriminated action: the surface is
        // tiny (list/create/rename/remove/assign) and every action answers the
        // full snapshot so the phone never has to merge partial state.
        const folders = deps.folders
        if (folders === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'unavailable', message: '会话分组不可用' } },
          })
          return
        }
        const body = parsed.payload as {
          action?: unknown
          name?: unknown
          folderId?: unknown
          sessionId?: unknown
        } | undefined
        const action = typeof body?.action === 'string' ? body.action : 'list'
        if (action === 'list') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: folders.list() },
          })
          return
        }
        if (action === 'create') {
          const created = folders.create(body?.name)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: created === undefined
              ? { ok: false, error: { code: 'bad-request', message: '分组名不可用或已存在' } }
              : { ok: true, value: { ...folders.list(), created } },
          })
          return
        }
        if (action === 'rename') {
          const folderId = typeof body?.folderId === 'string' ? body.folderId : ''
          const renamed = folders.rename(folderId, body?.name)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: renamed
              ? { ok: true, value: folders.list() }
              : { ok: false, error: { code: 'bad-request', message: '分组不存在或改名失败' } },
          })
          return
        }
        if (action === 'remove') {
          const folderId = typeof body?.folderId === 'string' ? body.folderId : ''
          const removed = folders.remove(folderId)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { ...folders.list(), removed } },
          })
          return
        }
        if (action === 'assign') {
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
          const folderId = typeof body?.folderId === 'string' ? body.folderId : null
          const assigned = folders.assign(sessionId, folderId)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: assigned
              ? { ok: true, value: folders.list() }
              : { ok: false, error: { code: 'bad-request', message: '分组不存在' } },
          })
          return
        }
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: false, error: { code: 'bad-request', message: '未知的分组操作' } },
        })
      } else if (method === MOBILE_NOTIFY_EVENTS_METHOD) {
        // The phone's notification inbox: the engine's bounded decision log
        // (newest first). A missing notify feature answers the same refusal
        // as push.config.
        const notify = deps.notify
        if (notify === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'notify-unavailable', message: '通知功能不可用' } },
          })
          return
        }
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: {
            ok: true,
            value: {
              items: notify.engine.recentEvents(),
              // Delivery telemetry: what the host actually tried to send, so
              // "nothing arrived" can be told apart from "nothing to send".
              stats: notify.store.deliverySummary(),
              deliveries: notify.store.recentDeliveries(),
            },
          },
        })
      } else if (method === MOBILE_GIT_SUMMARY_METHOD) {
        // Read-only repository summary for one directory. The phone asks for
        // the workspace it is already looking at; anything that is not a
        // git work tree is a normal "not a repo" answer, not an error.
        const payload = parsed.payload as { cwd?: unknown } | undefined
        const cwd = typeof payload?.cwd === 'string' ? payload.cwd : ''
        if (cwd === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'invalid-argument', message: '缺少目录' } },
          })
          return
        }
        const summary = await readGitSummary(cwd)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: summary },
        })
      } else if (method === MOBILE_LATEST_VERSION_METHOD) {
        // About-sheet update check. The registry may be unreachable from the
        // host network; the phone then sees a stable refusal, never a hang.
        const latest = await fetchLatestVersion(PACKAGE_NAME)
        if (latest === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'network', message: '无法连接 npm registry，请稍后重试' } },
          })
          return
        }
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: {
            ok: true,
            value: { latest, isNewer: isNewerVersion(latest, pkg.version) },
          },
        })
      } else if (method === MOBILE_TURN_OUTLINE_METHOD) {
        // 轮次大纲有两个来源，按可靠度排：枚举快照 → 现读一次宿主投影。
        //
        // 只信枚举快照是不够的：那一页是"最近更新的 N 个会话"，打开一个很久
        // 以前的会话时它根本不在里面，手机端就只剩本地已加载的那几轮 —— 真机
        // 表现是「轮次 · 共 5 轮」，滑条分母 549 却一格历史都点不开。
        const body = parsed.payload as { sessionId?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
        if (sessionId === '' ) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
          })
          return
        }
        let outline: unknown = sessionProjectionSnapshots.get(sessionId)?.block.values?.['turnOutline']
        if (!Array.isArray(outline)) {
          // 现开一帧 follow，从 `session.history` 的投影基线里取。这条比枚举快照贵
          // （大会话能到几十 KB，实测 279 轮约 53 KB），但客户端有五分钟缓存，一次
          // 打开只付一次；总比"历史永远列不出来"强。
          try {
            const page = await apiProxy.sessions.history({
              rpcId: RpcId('dsh-palm-mobile-outline'),
              payload: { sessionId, maxMessages: 1, fresh: true },
            } as never)
            if (page.result.ok) {
              const values = (page.result.value as { projections?: { values?: Record<string, unknown> } })
                .projections?.values
              if (Array.isArray(values?.['turnOutline'])) outline = values['turnOutline']
            }
          } catch { /* 拿不到就维持原样，界面显示本地那几轮 */ }
        }
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { turns: outline === undefined ? null : outline } },
        })
      } else if (method === MOBILE_INBOX_METHOD) {
        // 排队消息：同一份花名册快照里就有（inbox 投影），不读日志、不解压。
        const body = parsed.payload as { sessionId?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
        if (sessionId === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
          })
          return
        }
        const wantsFresh = (parsed.payload as { fresh?: unknown } | undefined)?.fresh === true
        const inbox = await readInboxProjection(apiProxy, sessionId, wantsFresh)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { inbox: inbox === undefined ? null : inbox } },
        })
      } else if ((method as string) === MOBILE_SESSION_STATE_METHOD) {
        // 一份原子快照：行 + 队列 + 回合 + 队列版本都在同一个切面上。
        //
        // 手机端以前要三次调用（logTail / inbox / turnState）才能拼出一屏，三次落在
        // 不同时刻，于是"队列说还有一条、回合说已经开始了"这类矛盾随时可见。这里一次
        // 给全，客户端按 seq / revision 单调合并（见 mobile/session-store.ts）。
        const body = parsed.payload as { sessionId?: unknown; fresh?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
        if (sessionId === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
          })
          return
        }
        const wantsFreshQueue = body?.fresh === true
        const turnState = async (): Promise<{ running: boolean; turnStartAt?: number; lastEventAt?: number; asOf: number }> => {
          try {
            return await computeTurnState(sessionId)
          } catch {
            return { running: false, asOf: Date.now() }
          }
        }
        const [page, inbox, turn, goalView] = await Promise.all([
          readChatTailPage(sessionId),
          (async () => liveInboxOf(deps.agents, sessionId)
            ?? await readInboxProjection(apiProxy, sessionId, wantsFreshQueue).catch(() => undefined))(),
          turnState(),
          // 目标与待办也在这张切面上：客户端不用再单独轮询 mobile.goal，
          // 目标条与回合状态也就不会出现「一个说进行中、一个说已结束」。
          readGoalProjection(apiProxy, deps, sessionId, wantsFreshQueue)
            .catch((): { goal: unknown; activation?: 'armed' | 'disarmed' } => ({ goal: null })),
        ])
        if (page === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'unavailable', message: '会话状态不可读' } },
          })
          return
        }
        const queueItems = queueItemsOf(inbox)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: {
            ok: true,
            value: {
              sessionId,
              rows: page.rows,
              maxSeq: page.maxSeq,
              queue: queueItems,
              queueRevision: queueRevisionOf(sessionId),
              queueToken: queueTokenOf(queueItems),
              ...(page.todo === undefined ? {} : { todo: page.todo }),
              goal: goalView.goal,
              ...(goalView.activation === undefined ? {} : { goalActivation: goalView.activation }),
              turn: {
                running: turn.running === true,
                ...(turn.turnStartAt === undefined ? {} : { turnStartAt: turn.turnStartAt }),
                ...(turn.lastEventAt === undefined ? {} : { lastEventAt: turn.lastEventAt }),
              },
              asOf: turn.asOf ?? Date.now(),
            },
          },
        })
      } else if (method === MOBILE_GOAL_METHOD) {
        // 目标条：宿主 goal 投影的线上形状是 { current }，原样交出去由客户端解析。
        const body = parsed.payload as { sessionId?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
        if (sessionId === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
          })
          return
        }
        // 目标改动只发生在手机上点动作的那一刻，所以平时读快照就够；带 fresh 时
        // 现开一帧 follow 取当下投影（动作刚发出去，快照里可能还是旧相位）。
        const wantsFreshGoal = (parsed.payload as { fresh?: unknown } | undefined)?.fresh === true
        const value = await readGoalProjection(apiProxy, deps, sessionId, wantsFreshGoal)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value },
        })
      } else if (method === MOBILE_GOAL_ACTION_METHOD) {
        // 目标动作直连宿主服务：暂停=撤授权（durable 相位不变），恢复=重新授权，
        // 编辑/清除走同一套 CAS。命令通道的老路留给没有本方法的旧宿主。
        const body = parsed.payload as { sessionId?: unknown; action?: unknown; objective?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
        const action = body?.action
        const objective = typeof body?.objective === 'string' ? body.objective.trim() : ''
        const fail = (code: string, message: string): void => {
          writeJson(res, 200, { type: 'server-response', rpcId, result: { ok: false, error: { code, message } } })
        }
        if (sessionId === '') {
          fail('bad-request', '缺少会话 id')
          return
        }
        if (action !== 'pause' && action !== 'resume' && action !== 'edit' && action !== 'clear') {
          fail('bad-request', '未知的目标动作')
          return
        }
        if (action === 'edit' && objective === '') {
          fail('bad-request', '目标内容为空')
          return
        }
        const outcome = applyGoalAction(deps, sessionId, action, objective)
        if (!outcome.ok) {
          fail(outcome.code, outcome.message)
          return
        }
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: {
            ok: true,
            value: {
              ...(outcome.goal === undefined ? {} : { goal: { current: outcome.goal } }),
              ...(outcome.activation === undefined ? {} : { activation: outcome.activation }),
            },
          },
        })
      } else if (method === MOBILE_TURN_STATE_METHOD) {
        // 手机唯一该问的「还在跑吗」。宿主比完帧镜像与日志边界再回答，客户端不再推断。
        const body = parsed.payload as { sessionId?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
        if (sessionId === '' ) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
          })
          return
        }
        try {
          const state = await computeTurnState(sessionId)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: state },
          })
        } catch (error) {
          console.error('mobile.turnState failed', error)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'unavailable', message: '轮次状态不可读' } },
          })
        }
      } else if (method === MOBILE_RUNNING_SESSIONS_METHOD) {
        setRunningProxy(apiProxy)
        // Which main-agent sessions have an attached agent running right now.
        // The run-overview badge seeds from this so a session that started
        // generating BEFORE the phone opened (or before this page mounted)
        // still counts — its turn/start frame is gone and session.list's own
        // TTL can still say running:false. One host read per TTL window; the
        // badge is not latency-critical, so 30 s matches session.list's cache.
        const runningCache = mobileRunningCacheOf()
        if (runningCache !== undefined && runningCache.proxy === apiProxy && Date.now() - runningCache.at < RUNNING_SESSIONS_TTL_MS) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { sessionIds: runningCache.sessionIds } },
          })
          return
        }
        // 有基线就立刻答复，过期与否都在后台刷新：手机上等一次枚举的代价是
        // 整屏"运行中"迟到（冷启动实测 24.7 秒），比偶尔一份稍旧的答案糟糕。
        if (liveRunningSeededAtOf() !== 0) {
          // 答复前先清一次"很久没有任何证据"的记录。
          //
          // 2026-10-31 真机：没有任何会话在跑，工作区徽标还写着「运行中 9」——
          // 因为清理只发生在 reseed（最多 5 分钟一次）里，而徽标每几十秒就问一次，
          // 问到的一直是没清过的旧集合。这里把清理挪到答复路径上，最多晚一轮。
          pruneRunningEvidence()
          const sessionIds = await verifiedRunningSessionIds()
          setMobileRunningCache({ at: Date.now(), proxy: apiProxy, sessionIds })
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { sessionIds } },
          })
          if (Date.now() - liveRunningSeededAtOf() >= LIVE_RUNNING_RESEED_MS) void reseedRunning()
          return
        }
        try {
          // 进程启动后第一次问：现在取一次基线。之后每一次都是内存读，帧会
          // 一直把桌面端的开始/结束送进镜像。
          await reseedRunning()
          if (liveRunningSeededAtOf() === 0) throw new Error('running baseline unavailable')
          pruneRunningEvidence()
          const sessionIds = await verifiedRunningSessionIds()
          setMobileRunningCache({ at: Date.now(), proxy: apiProxy, sessionIds })
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { sessionIds } },
          })
        } catch (error) {
          console.error('mobile.runningSessions failed', error)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: '运行状态查询失败，请稍后重试' } },
          })
        }
      } else if (method === MOBILE_SEARCH_METHOD) {
        // 期 2：自建索引版搜索。索引还没建好（或 Node 不带 node:sqlite）时回
        // `fallback: true`，手机端据此退回旧的 mobile.searchAll —— 不会出现
        // 「索引没建完就搜不到」的空结果。
        const body = parsed.payload as { query?: unknown; sessionId?: unknown; sessions?: unknown; perSession?: unknown; offset?: unknown } | undefined
        const query = typeof body?.query === 'string' ? body.query.trim() : ''
        if (query === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少搜索词' } },
          })
          return
        }
        const fallback = (): void => {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { items: [], total: 0, hasMore: false, tookMs: 0, fallback: true } },
          })
        }
        try {
          const index = await ensureSearchIndex()
          if (index === undefined || index.stats().docs === 0) {
            fallback()
            return
          }
          const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
          const clamp = (value: unknown, min: number, max: number, fallbackValue: number): number => {
            const parsedValue = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallbackValue
            return Math.min(Math.max(parsedValue, min), max)
          }
          const perSession = clamp(body?.perSession, 1, 5, 2)
          const sessionCap = clamp(body?.sessions, 5, 40, 12)
          const offset = clamp(body?.offset, 0, 200, 0)
          const started = performance.now()
          const snapshot = await ordinarySearchSnapshot(apiProxy)
          const workspaceOf = (id: string): Record<string, string> => {
            const workspaceId = snapshot.workspace.get(id)
            const workspaceTitle = snapshot.workspaceTitle.get(id)
            return {
              ...(workspaceId === undefined ? {} : { workspaceId }),
              ...(workspaceTitle === undefined ? {} : { workspaceTitle }),
            }
          }
          const items: Array<Record<string, unknown>> = []

          if (sessionId !== undefined) {
            // 会话内搜索：不分组，按命中顺序给位置列表（上一处/下一处靠它）。
            // 以前这里写死 50 条、hasMore 恒为 false：常用字在长会话里能有两三百处，
            // 客户端只看到 1/50，后面的一律点不到（真机实测某会话「的」722 处）。
            // 现在按 CHAT_SEARCH_HITS 取、多取一条判 hasMore，如实告诉客户端「还有」。
            const hits = index.querySessionHits(query, sessionId, CHAT_SEARCH_HITS + 1)
            const truncated = hits.length > CHAT_SEARCH_HITS
            const visible = truncated ? hits.slice(0, CHAT_SEARCH_HITS) : hits
            const tookMs = Math.round((performance.now() - started) * 10) / 10
            for (const hit of visible) {
              items.push({
                kind: 'message',
                sessionId: hit.sessionId,
                seq: hit.seq,
                messageId: hit.messageId,
                ...(hit.partId === undefined ? {} : { partId: hit.partId }),
                snippet: hit.snippet,
                ...(hit.paragraph === undefined ? {} : { paragraph: hit.paragraph }),
                ...(hit.matchIndex === undefined ? {} : { matchIndex: hit.matchIndex }),
                ranges: hit.ranges,
                user: hit.user,
              })
            }
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: true, value: { items, total: items.length, hasMore: truncated, tookMs, source: 'index' } },
            })
            return
          }

          const page = index.queryGroupsDetailed(query, { limits: perSession, sessions: sessionCap, offset })
          const tookMs = Math.round((performance.now() - started) * 10) / 10
          const hasMore = page.hasMore
          const seen = new Set(page.groups.map(group => group.sessionId))
          // 标题命中只在第一页给（翻页时再塞一遍会让「加载更多」看起来没变化）；
          // 已经出现在消息命中里的会话不重复列。
          if (offset === 0) {
            for (const hit of index.titleHits(query, sessionCap)) {
              if (seen.has(hit.sessionId) || !snapshot.byId.has(hit.sessionId)) continue
              items.push({
                kind: 'title',
                sessionId: hit.sessionId,
                title: hit.title,
                hits: 0,
                ...workspaceOf(hit.sessionId),
              })
            }
          }
          for (const group of page.groups) {
            const meta = snapshot.byId.get(group.sessionId)
            // 花名册里没有的（子代理 / 已归档 / 已删除）一律不返回，和列表口径一致。
            if (meta === undefined) continue
            const best = group.best
            // 每条命中单独一行：手机端可以直接点「第 2 条」跳到那条，而不是只能跳到最佳那条。
            const messages = group.messages.map(hit => ({
              seq: hit.seq,
              messageId: hit.messageId,
              ...(hit.partId === undefined ? {} : { partId: hit.partId }),
              snippet: hit.snippet,
              ...(hit.paragraph === undefined ? {} : { paragraph: hit.paragraph }),
              ...(hit.matchIndex === undefined ? {} : { matchIndex: hit.matchIndex }),
              ranges: hit.ranges,
              user: hit.user,
            }))
            items.push({
              kind: 'message',
              sessionId: group.sessionId,
              ...(meta.title === undefined ? {} : { title: meta.title }),
              hits: group.hits,
              seq: best.seq,
              messageId: best.messageId,
              ...(best.partId === undefined ? {} : { partId: best.partId }),
              snippet: best.snippet,
              ...(best.paragraph === undefined ? {} : { paragraph: best.paragraph }),
              ...(best.matchIndex === undefined ? {} : { matchIndex: best.matchIndex }),
              ranges: best.ranges,
              user: best.user,
              messages,
              ...workspaceOf(group.sessionId),
            })
          }
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: {
              ok: true,
              value: { items, total: page.totalGroups, hasMore, nextOffset: offset + page.groups.length, tookMs, source: 'index' },
            },
          })
        } catch (error) {
          console.error('mobile.search failed', error)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: '搜索失败，请稍后重试' } },
          })
        }      } else if (method === MOBILE_SEARCH_ALL_METHOD) {
        // 旧入口留着（老客户端还在调），但内部换成索引：返回形状不变
        // （每个会话一条 + 标题命中），一次查询就算完，不读任何会话历史。
        const body = parsed.payload as { query?: unknown } | undefined
        const query = typeof body?.query === 'string' ? body.query.trim() : ''
        if (query === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少搜索词' } },
          })
          return
        }
        try {
          const snapshot = await ordinarySearchSnapshot(apiProxy)
          const index = await ensureSearchIndex()
          if (index === undefined) {
            // 宿主没有可用的 sqlite：如实说「没搜全」，别假装搜过。
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: true, value: { items: [], hasMore: false, partial: true } },
            })
            return
          }
          const workspaceOf = (id: string): Record<string, string> => {
            const workspaceId = snapshot.workspace.get(id)
            const workspaceTitle = workspaceId === undefined ? undefined : snapshot.workspaceTitle.get(workspaceId)
            return {
              ...(workspaceId === undefined ? {} : { workspaceId }),
              ...(workspaceTitle === undefined ? {} : { workspaceTitle }),
            }
          }
          const items: SearchAllHit[] = []
          for (const hit of index.titleHits(query, SEARCH_ALL_SESSIONS)) {
            if (!snapshot.byId.has(hit.sessionId)) continue
            items.push({ kind: 'title', sessionId: hit.sessionId, snippet: hit.title, title: hit.title, ...workspaceOf(hit.sessionId) })
          }
          const groups = index.queryGroups(query, { limits: 1, sessions: SEARCH_ALL_SESSIONS })
          for (const group of groups) {
            const session = snapshot.byId.get(group.sessionId)
            if (session === undefined) continue
            const best = group.best
            items.push({
              kind: 'message',
              sessionId: group.sessionId,
              snippet: best.snippet,
              ...(best.paragraph === undefined ? {} : { paragraph: best.paragraph }),
              ...(best.matchIndex === undefined ? {} : { matchIndex: best.matchIndex }),
              seq: best.seq,
              ...(best.messageId === undefined ? {} : { messageId: best.messageId }),
              ...(best.partId === undefined ? {} : { partId: best.partId }),
              ...(session.title === undefined ? {} : { title: session.title }),
              ...workspaceOf(group.sessionId),
            })
          }
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { items, hasMore: groups.length >= SEARCH_ALL_SESSIONS } },
          })
        } catch (error) {
          console.error('mobile.searchAll failed', error)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: '会话搜索失败，请稍后重试' } },
          })
        }
      } else if (method === MOBILE_SEARCH_MESSAGES_METHOD) {
        // 会话内定位：一次索引查询。旧实现要把这个会话的历史翻到底（最多
        // 4096 页）才能确定 seq，现在命中行本身就带 seq。
        const body = parsed.payload as { sessionId?: unknown; query?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
        const query = typeof body?.query === 'string' ? body.query.trim() : ''
        if (sessionId === '' || query === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少会话或搜索词' } },
          })
          return
        }
        try {
          const index = await ensureSearchIndex()
          const hits = index === undefined ? [] : index.query(query, { sessionId, limit: SEARCH_MESSAGES_LIMIT })
          const items = hits.map(hit => ({
            seq: hit.seq,
            ...(hit.messageId === undefined ? {} : { messageId: hit.messageId }),
            ...(hit.partId === undefined ? {} : { partId: hit.partId }),
            snippet: hit.snippet,
            ...(hit.paragraph === undefined ? {} : { paragraph: hit.paragraph }),
            ...(hit.matchIndex === undefined ? {} : { matchIndex: hit.matchIndex }),
          }))
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { items } },
          })
        } catch (error) {
          console.error('mobile.searchMessages failed', error)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: '消息定位失败，请稍后重试' } },
          })
        }
      } else if (method === MOBILE_USAGE_METHOD) {
        // Per-provider usage/balance, synced from the desktop's configured
        // providers. `refresh: true` bypasses the short cache. Keys resolve
        // host-side only; the phone receives display facts alone.
        const body = parsed.payload as { refresh?: unknown } | undefined
        const force = body?.refresh === true
        const cached = usageCache !== undefined
          && !force
          && Date.now() - usageCache.at < USAGE_CACHE_TTL_MS
        let fresh: UsageView | undefined
        if (!cached) {
          try {
            const providers = await discoverUsageProviders(apiProxy)
            const view = await buildUsageView(providers, refName =>
              deps.resolveKey === undefined ? Promise.resolve(undefined) : deps.resolveKey(refName))
            usageCache = { at: Date.now(), view }
            fresh = view
          } catch (error) {
            // Internal failures (a settings read glitch, a provider adapter
            // throwing) surface as a stable refusal, never the host detail.
            console.error('mobile.usage failed', error)
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: false, error: { code: 'internal', message: '用量查询失败，请稍后重试' } },
            })
            return
          }
        }
        // Serve the fresh view, else the still-valid cached one (never reached
        // without either: cached implies usageCache is populated).
        const served: UsageView | undefined = fresh ?? usageCache?.view
        if (served === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: '用量查询失败，请稍后重试' } },
          })
          return
        }
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: served },
        })
      } else if (method === MOBILE_READ_CHAT_METHOD) {
        // Folded-view chat read (v3): serve message rows from the host's
        // mux-fed window cache. A window hit never touches the log; a cold
        // read (or an older-page read) folds one `session.history` page. The
        // phone falls back to `session.history` + local fold when this
        // method is unavailable (older host) or fails.
        const windows = deps.chatWindows
        if (windows === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'unavailable', message: '折叠会话读取不可用' } },
          })
          return
        }
        const body = parsed.payload as { sessionId?: unknown; beforeSeq?: unknown; maxRows?: unknown; include?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
        if (sessionId === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
          })
          return
        }
        const rawBeforeSeq = body?.beforeSeq
        const beforeSeq = typeof rawBeforeSeq === 'number' && Number.isFinite(rawBeforeSeq) ? rawBeforeSeq : undefined
        const rawMaxRows = body?.maxRows
        const maxRows = typeof rawMaxRows === 'number' && Number.isFinite(rawMaxRows)
          ? Math.min(Math.max(1, Math.round(rawMaxRows)), READ_CHAT_MAX_ROWS)
          : READ_CHAT_DEFAULT_ROWS
        try {
          const page: ChatPage = beforeSeq === undefined
            ? await windows.tail(sessionId, maxRows)
            : await windows.before(sessionId, beforeSeq, maxRows)
          // 每行带上**索引里那份正文**（与 documentRows 用同一个 searchableText 算）。
          // 手机端的搜索定位只靠它能把命中落准：索引的 seq/id 来自 history 折叠，
          // 渲染行的 seq/id 来自窗口投影，两条通道逐条并不对齐（实测命中 seq 会落到
          // 内容完全不同的相邻消息上），而这段文本两边一字不差。
          const pageWithSearchText: ChatPage = {
            ...page,
            rows: page.rows.map(row => ({ ...row, searchText: rowSearchableText(row) })),
          }
          // 打开会话时顺带把小读取带回去（A）：模型目录、子代理目录本来要各走
          // 一次隧道往返，弱网下每个 150~400ms。这里在服务端并行取齐，挂在同
          // 一个响应里；任何一项失败都不影响页面本身（缺失即让客户端按老路径
          // 单独再取），所以 extras 是纯增益的附加字段。
          const include = readChatInclude(body?.include)
          if (include.length === 0) {
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: true, value: pageWithSearchText },
            })
            return
          }
          const extras: Record<string, unknown> = {}
          await Promise.all(include.map(async (name) => {
            try {
              // apiProxy 的每个方法都返回 RPC 信封 { rpcId, result: { ok, value } }（见
              // api-proxy-adapter 的 call()），而 extras 要的是 value 本身。直接挂信封会让手机上
              // 的模型目录读成 undefined，chip 和选择器全空。
              if (name === 'models') extras['models'] = unwrapProxyValue(await apiProxy.sessions.models({ sessionId } as never))
              else if (name === 'subagents') extras['subagents'] = unwrapProxyValue(await apiProxy.subagents.list({ parentSessionId: sessionId } as never))
            } catch (error) {
              console.error('mobile.readChat extra failed: ' + name, error)
            }
          }))
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { ...pageWithSearchText, extras } },
          })
        } catch (error) {
          // Internal failures never leak host paths or log details: a stable
          // generic message is all the client sees (it falls back to the
          // raw history path on this channel anyway).
          console.error('mobile.readChat failed', error)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: '会话内容读取失败，请稍后重试' } },
          })
        }
      } else if ((method as string) === MOBILE_LOG_TAIL_METHOD) {
        // 上面那串比较把 method 窄成了剩余字面量的联合，这里显式放宽类型。
        // 会话日志直读（C）：只解尾部若干 zstd 帧，就地折叠成与宿主同形的
        // rows 再回给手机。宿主的 session.page 每次都整文件解压（52 MB 实测
        // 4.1 s），而尾部帧只有几十毫秒 —— 大会话首屏的差距全在这里。
        // 这条通道只读、只给尾部；翻旧页仍然走宿主（它维护投影与窗口缓存）。
        const body = parsed.payload as { sessionId?: unknown; maxRows?: unknown; windowBytes?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : ''
        if (sessionId === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少会话 id' } },
          })
          return
        }
        const rawMaxRows = body?.maxRows
        const maxRows = typeof rawMaxRows === 'number' && Number.isFinite(rawMaxRows)
          ? Math.min(Math.max(1, Math.round(rawMaxRows)), READ_CHAT_MAX_ROWS)
          : undefined
        try {
          // 服务端就折叠成 rows：原始事件约是可见行的两倍（52 MB 会话实测
          // 408 KB 事件 → 约 210 KB 行），弱网下这段字节差比解压更值钱。
          // 首屏自适应：客户端按自己实测的进会话耗时在 512 KB / 2 MB 之间选。
        // 上限夹在 4 MB，防止旧客户端传一个离谱的值把内存读爆。
        const rawWindow = body?.windowBytes
        const windowBytes = typeof rawWindow === 'number' && Number.isFinite(rawWindow)
          ? Math.min(Math.max(128 * 1024, Math.round(rawWindow)), 4 * 1024 * 1024)
          : undefined
        const page = await readChatTailPage(sessionId, maxRows, windowBytes)
          if (page === undefined) {
            // 找不到日志（会话刚建、或压缩存储换了布局）：让手机回落到宿主路径。
            writeJson(res, 200, {
              type: 'server-response',
              rpcId,
              result: { ok: false, error: { code: 'unavailable', message: '日志尾部不可读' } },
            })
            return
          }
          // 权限、上下文压力这些投影**不在日志里**：手机的权限选择器以尾页投影
          // 为基线，缺了它整块就不渲染（实测就是"权限面板消失"）。投影来自宿主
          // 会话枚举——那次枚举很贵（六到三十秒），但列表页本来就在跑，所以只查
          // 它留下的快照；查不到就不带，手机端会保留已有基线。
          //
          // 只带首屏要用的键：整块里 turnOutline 一个就 87 KB（尾页消息自己才
          // 99 KB），那部分留给稍后的宿主权威页。
          if (page.projections === undefined) {
            const snapshot = sessionProjectionSnapshots.get(sessionId)
            if (snapshot !== undefined) {
              const values: Record<string, unknown> = {}
              for (const key of TAIL_PAGE_PROJECTION_KEYS) {
                if (snapshot.block.values?.[key] !== undefined) values[key] = snapshot.block.values[key]
              }
              ;(page as { projections?: { asOfSeq?: number; values?: Record<string, unknown> } }).projections = {
                ...(snapshot.block.asOfSeq === undefined ? {} : { asOfSeq: snapshot.block.asOfSeq }),
                values,
              }
            }
          }
          // 首屏同样要带 searchText：手机端搜到命中后按它落行。日志直读这条通道
          // 若缺这段文本，定位就退回「text + flow」自行猜，实测会停到别的段落上。
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { ...page, rows: page.rows.map(row => ({ ...row, searchText: rowSearchableText(row) })) } },
          })
        } catch (error) {
          console.error('mobile.logTail failed', error)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: '日志尾部读取失败' } },
          })
        }
      } else if (method === MOBILE_OBSERVE_METHOD) {
        // 手机一打开页面就来这里，顺手把「谁在跑」的基线预热掉：等用户点进
        // 会话列表时它多半已经好了，不必让"运行中"晚二十几秒才出现。
        setRunningProxy(apiProxy)
        if (liveRunningSeededAtOf() === 0) void reseedRunning()
        // Which session the phone has open (v3.4): the host keeps exactly one
        // assistant-stream follow for the observed sessions, so this is the
        // signal that turns token-level streaming on for the chat on screen.
        // An absent/empty sessionId means the phone left the chat.
        const observers = deps.observers
        if (observers === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'unavailable', message: '实时流服务不可用' } },
          })
          return
        }
        const body = parsed.payload as { sessionId?: unknown } | undefined
        const raw = body?.sessionId
        const sessionId = typeof raw === 'string' && raw !== '' ? raw : undefined
        const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
        if (deviceId !== undefined) observers.observe(deviceId, sessionId)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { observing: sessionId ?? null } },
        })
      } else if (method === MOBILE_DIAGNOSTICS_METHOD) {
        // 依赖自检 + 健康报告：palm 与宿主的耦合点都是内部契约，升级时可能静默
        // 失效（订阅都在 try/catch 里降级）。这里把 setup 期登记、运行期帧计数、
        // 协议/帧/方法面、推送订阅与投递结果一起交出去，让"哪条断了""为什么手机
        // 没响"在手机上一眼可见 —— 不再靠 COMPATIBILITY.md 的人工五步核对。
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: buildHealthReport(deps) },
        })
      } else if (method === MOBILE_READ_ATTACHMENT_METHOD) {
        // 图片字节（0.1.5 起事件只带 attachmentId 引用）。宿主按"该会话确实引用过
        // 这张图"授权，所以 sessionId 必须一起带上；适配层按内容寻址的 id 长期缓存，
        // 同一张图只过一次隧道。
        const body = parsed.payload as { sessionId?: unknown; attachmentId?: unknown } | undefined
        const sessionId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
        const attachmentId = typeof body?.attachmentId === 'string' && body.attachmentId !== '' ? body.attachmentId : undefined
        if (sessionId === undefined || attachmentId === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'invalid-request', message: '缺少会话或附件标识' } },
          })
          return
        }
        try {
          const value = await (apiProxy as ApiProxyAdapter).readAttachment(sessionId, attachmentId)
          writeJson(res, 200, { type: 'server-response', rpcId, result: { ok: true, value } })
        } catch (error) {
          // 稳定文案，不外泄宿主细节（图片读不到只影响这一张图的显示）。
          console.error('mobile.readAttachment failed', error)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: '图片读取失败' } },
          })
        }
      } else if (method === MOBILE_PREVIEWS_METHOD) {
        // Batch last-message previews (v3.1): one call for the list page's
        // preview burst, served from the host's mux-fed cache — cached rows
        // cost zero log reads, cold rows one lazy tail read each. A session
        // that cannot be read is answered with an empty summary (the row
        // falls back to its stats line), never an error.
        const previews = deps.previews
        if (previews === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'unavailable', message: '预览服务不可用' } },
          })
          return
        }
        const body = parsed.payload as { sessionIds?: unknown } | undefined
        const rawIds = Array.isArray(body?.sessionIds) ? body.sessionIds : []
        const sessionIds = rawIds
          .filter((id): id is string => typeof id === 'string' && id !== '')
          .slice(0, PREVIEWS_MAX_SESSIONS)
        if (sessionIds.length === 0) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { items: [] } },
          })
          return
        }
        try {
          const items = await previews.previews(sessionIds)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { items } },
          })
        } catch (error) {
          console.error('mobile.previews failed', error)
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'internal', message: '预览读取失败，请稍后重试' } },
          })
        }
      } else if (isTranscribe) {
        // Voice → text through the phone-configured speech-to-text services
        // (OpenAI-compatible /audio/transcriptions endpoints, tried in
        // order). The service list rides the request from the phone; the
        // plugin config file backs it up when the phone sends none. Only
        // the transcript travels back to the phone.
        const payload = parsed.payload as { audio?: unknown; services?: unknown }
        const audio = typeof payload?.audio === 'string' ? payload.audio : ''
        const result = await transcribeWav(audio, payload?.services)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: 'text' in result
            ? { ok: true, value: { text: result.text } }
            : { ok: false, error: { code: 'transcribe-failed', message: result.error } },
        })
      }
      return
    }
    try {
      // Cancel the host-side work when the phone goes away mid-call (the
      // response stream closing before we answer means nobody is listening).
      // Only methods the host API declares cancellable (session.search today)
      // can honor it; the rest finish and their response is dropped by the
      // writeJson guard on the closed socket.
      const abort = new AbortController()
      res.on('close', () => { if (!res.writableEnded) abort.abort() })
      const response = await dispatch(apiProxy, method, parsed?.payload, rpcId, abort.signal)
      // Pass the request so large payloads (session.list, history pages) are
      // gzip-compressed for the phone link.
      writeJson(res, 200, response, {}, req)
    } catch {
      // Internal failures never leak host paths or method names to the phone:
      // a stable generic message is all the client sees.
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'internal', message: '内部错误，请重试' } },
      })
    }
  }

  /** Concurrent SSE mux subscriptions (each holds a host mux stream + timer). */
  let activeEvents = 0
  /** Concurrent notify SSE subscriptions (shared budget with the mux stream). */
  let activeNotifyEvents = 0

  /** Bridge the host mux stream over SSE: one `data:` frame per mux frame. */
  const handleEvents = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    // 第一次通过门禁的手机请求就顺手把索引拉起来（幂等；之后再进来只是等同一个 promise）。
    void ensureSearchIndex().catch(() => undefined)
    if (!gateOk(req)) {
      writeJson(res, 403, {
        ok: false,
        error: { code: 'unpaired', message: 'mobile session is not paired' },
      })
      return
    }
    // Cap concurrent subscriptions so one device (or a reconnect storm) cannot
    // hold an unbounded number of host mux streams and heartbeat timers. The
    // EventSource reconnects, so a refusal is transient.
    if (activeEvents >= MAX_SSE_SUBSCRIBERS) {
      writeJson(res, 429, { ok: false, error: { code: 'too-many-events', message: 'too many live streams' } })
      return
    }
    activeEvents += 1
    ;(apiProxy as ApiProxyAdapter).setPhoneConnected(true)
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    // Flush the response head now. Node only puts headers on the wire with the
    // first write or end(), so an SSE stream with no pending frames kept the
    // browser's EventSource in CONNECTING until the first heartbeat — up to the
    // full keep-alive interval. The phone reads that as "no stream yet" and
    // starts polling, which is the delay users see when the desktop begins a
    // turn and the phone keeps showing idle.
    res.flushHeaders()
    // 开场快照：手机可能在提问/审批发生的那一刻没有活着的流（App 在后台、锁屏、隧道
    // 抖动、正在重连），于是它从没收到过那条 `question/requested`，桌面也就照常在桌面
    // 被答掉了——用户看到的现象是"手机端问题面板消失了"。待答条目仍然留在适配层，
    // 这里在新流建立后立刻补发一份，手机一连上就能看到仍在等它的卡片（客户端按 rpcId
    // 去重，重复回放不会重复入列）。也补喂 host 侧待答追踪，让轮询兜底同样能看到它。
    for (const frame of (apiProxy as ApiProxyAdapter).pendingFrames()) {
      deps.pendingTracker.onFrame(frame as never)
      const wire = { type: 'server-request' as const, rpcId: frame.rpcId, method: 'events.mux', payload: frame.payload }
      res.write(`data: ${JSON.stringify(wire)}\n\n`)
    }
    const controller = new AbortController()
    let closed = false
    // The gate only ran at connect time; a revoked/stopped device must lose
    // its live stream promptly, so re-check the device table on every frame
    // and on the keepalive (stop()/revoke() tear the stream down this way,
    // not only on the next reconnect).
    const deviceStillPaired = (): boolean => {
      const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
      return deviceId !== undefined && service.hasDevice(deviceId)
    }
    // Per-device frame filter (v3.4): the tunnel carries the phone's mobile
    // data, so only the session this device has open rides it. Control, list
    // and approval/question frames are global state (task strip, roster,
    // pending panel) and always pass. Without the registry (older wiring) the
    // stream stays unfiltered — exactly the previous behavior.
    const observers = deps.observers
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    let observed = new Set(observers === undefined || deviceId === undefined ? [] : observers.sessionsFor(deviceId))
    const disposeObserved = observers?.onChange(() => {
      observed = new Set(deviceId === undefined ? [] : observers.sessionsFor(deviceId))
    })
    const acceptFrame = observers === undefined
      ? undefined
      : (frame: MuxFrame): boolean => {
        if (MUX_ALWAYS_FORWARDED.has(frame.type)) return true
        const sessionId = (frame as { sessionId?: unknown }).sessionId
        return typeof sessionId === 'string' && observed.has(sessionId)
      }
    const endStream = (): void => {
      if (closed) return
      closed = true
      controller.abort()
      clearInterval(heartbeat)
      activeEvents -= 1
      ;(apiProxy as ApiProxyAdapter).setPhoneConnected(activeEvents > 0)
      // The live stream is the observation's lifetime: a device that is gone
      // must not stay registered. A second tab on the same device re-asserts
      // through `mobile.observe` within its refresh cadence, so this cannot
      // leave a live chat without streaming.
      if (deviceId !== undefined) observers?.release(deviceId)
      disposeObserved?.()
      res.end()
    }
    const heartbeat = setInterval(() => {
      if (closed) return
      if (!deviceStillPaired()) {
        endStream()
        return
      }
      // An open SSE stream proves the phone is still live even while the agent
      // idles (no RPC traffic), so refresh presence alongside the transport
      // keepalive — otherwise an idle phone drifts to "disconnected".
      touchDeviceFor(req)
      try {
        // A real mux frame, not an SSE comment. Comments are legal transport
        // keep-alives, but the EventSource spec drops them before the page ever
        // sees them, so a client tracking liveness from delivered frames kept
        // concluding the stream was dead. `mux/ping` reaches the client as a
        // frame it can count, which is what keeps it off the polling fallback.
        res.write(`data: ${JSON.stringify({ type: 'server-request', rpcId: 'mux-ping', method: 'events.mux', payload: { type: 'mux/ping' } })}\n\n`)
      } catch {
        // The write failed; the close handler tears the subscription down.
      }
    }, eventsHeartbeatMs)
    const onClose = (): void => {
      if (closed) return
      closed = true
      controller.abort()
      clearInterval(heartbeat)
      activeEvents -= 1
      // The plain socket close (tunnel blip, app backgrounded, phone gone) used
      // to decrement the count and stop: only endStream() — the revocation path
      // — ever refreshed the flag, so ONE closed stream left the host believing
      // a phone was online for the rest of the process. That stale flag made the
      // bridge keep a phone-side branch alive for a stream nobody reads; the
      // desktop's own panel is what answers in that state (dual-answer race in
      // api-proxy-adapter.ts), so the flag must track the live subscriptions.
      ;(apiProxy as ApiProxyAdapter).setPhoneConnected(activeEvents > 0)
      disposeObserved?.()
    }
    res.on('close', onClose)
    req.on('close', onClose)
    try {
      const frames = apiProxy.events.mux({ rpcId: RpcId(`mobile-mux-${Date.now().toString(36)}`), payload: {} }, controller.signal, acceptFrame)
      for await (const frame of frames) {
        if (closed) break
        // Revocation takes effect on the next frame, not the next reconnect.
        if (!deviceStillPaired()) {
          endStream()
          break
        }
        deps.pendingTracker.onFrame(frame as any)
        // 顺带把运行状态记进内存镜像：手机下一次问就是一次内存读。
        const boundary = noteRunningFrame(frame as { payload?: unknown })
        // The host mux stream yields bare { rpcId, payload } frames; the mobile
        // client validates the full server-request envelope ({ type, rpcId,
        // method, payload }) and silently drops anything else — unwrapped
        // frames made the phone believe SSE was dead and fall back to polling
        // (3s cadence, the "visible lag" vs desktop). Wrap every frame so the
        // live stream actually reaches the client.
        const wire = { type: 'server-request' as const, rpcId: frame.rpcId, method: 'events.mux', payload: frame.payload }
        // A turn boundary just moved: tell the phone the new verdict instead of
        // letting it infer one. This is the desktop's model — the store's
        // `running` flag IS the answer, nobody re-derives it from log edges.
        // The extra frame rides the same socket and is tiny (one status line).
        if (boundary !== undefined) {
          const verdict = {
            type: 'server-request' as const,
            rpcId: frame.rpcId,
            method: 'events.mux',
            payload: {
              // The inferred verdict gets its own discriminant: the host bus
              // also emits `session/status`, and two frames of the same type
              // with different semantics (and no version) made the running dot
              // flicker when a new turn started right after turn/end.
              type: 'session/turn-boundary',
              source: 'inferred' as const,
              sessionId: boundary.sessionId,
              running: boundary.running,
              ...(boundary.seq === undefined ? {} : { seq: boundary.seq }),
            },
          }
          try { res.write(`data: ${JSON.stringify(verdict)}\n\n`) } catch { /* close handler tears it down */ }
        }
        // Backpressure: a slow phone must not buffer unbounded frames in the
        // socket. Pause consuming the mux stream until the write drains.
        if (!res.write(`data: ${JSON.stringify(wire)}\n\n`)) {
          await new Promise<void>(resolve => {
            res.once('drain', () => { resolve() })
            res.once('close', () => { resolve() })
          })
          if (closed) break
        }
      }
    } catch {
      // The stream ended or errored; the EventSource reconnects.
    } finally {
      controller.abort()
      clearInterval(heartbeat)
    }
    if (!closed) res.end()
  }

  /**
   * The L1 completion-notify stream: one SSE connection per phone that
   * forwards NotifyEngine decisions as `{ type: 'notify', payload }` frames.
   * Deliberately separate from events.mux — the phone's MuxClient validates
   * every frame against the host mux schema and drops unknown types, so a
   * notify frame riding that stream would be silently discarded. The notify
   * module owns this connection (reconnect + heartbeat) independently of
   * the chat stream.
   */
  const handleNotifyEvents = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const notify = deps.notify
    if (notify === undefined) {
      writeJson(res, 403, { ok: false, error: { code: 'notify-unavailable', message: '通知功能不可用' } })
      return
    }
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    // 第一次通过门禁的手机请求就顺手把索引拉起来（幂等；之后再进来只是等同一个 promise）。
    void ensureSearchIndex().catch(() => undefined)
    if (!gateOk(req)) {
      req.resume()
      writeJson(res, 403, { ok: false, error: { code: 'unpaired', message: 'mobile session is not paired' } })
      return
    }
    if (activeNotifyEvents >= MAX_SSE_SUBSCRIBERS) {
      writeJson(res, 429, { ok: false, error: { code: 'too-many-events', message: 'too many live streams' } })
      return
    }
    activeNotifyEvents += 1
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    let closed = false
    const deviceStillPaired = (): boolean => {
      const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
      return deviceId !== undefined && service.hasDevice(deviceId)
    }
    const endStream = (): void => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      activeNotifyEvents -= 1
      res.end()
    }
    const heartbeat = setInterval(() => {
      if (closed) return
      if (!deviceStillPaired()) {
        endStream()
        return
      }
      touchDeviceFor(req)
      try {
        res.write(': ping\n\n')
      } catch {
        // The write failed; the close handler tears the subscription down.
      }
    }, eventsHeartbeatMs)
    const unsubscribe = notify.engine.subscribe((event) => {
      if (closed) return
      if (!deviceStillPaired()) {
        endStream()
        return
      }
      const wire = { type: 'notify' as const, payload: event }
      if (!res.write(`data: ${JSON.stringify(wire)}\n\n`)) {
        // A slow phone must not buffer unbounded frames; drop the write and
        // let the EventSource reconnect (the decision is already delivered
        // to the other channels).
        res.once('drain', () => {})
      }
    })
    const onClose = (): void => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      activeNotifyEvents -= 1
      unsubscribe()
    }
    res.on('close', onClose)
    req.on('close', onClose)
  }

  return [
    { kind: 'prefix', path: MOBILE_API_PREFIX, handler: handleMethod },
    { kind: 'exact', path: MOBILE_API_PATHS.events, handler: handleEvents },
    { kind: 'exact', path: MOBILE_API_PATHS.notify, handler: handleNotifyEvents },
  ]
}

/** Dispatch one allowlisted method through the host ApiProxy. */
/** 全量枚举会话花名册（宿主成本高：真机实测 6~23 秒）。**单飞**：同一时刻只跑一个，
 *  并发调用共享同一个 Promise —— 埋点里那些相隔 0.5 秒、成对出现的 22 秒调用就是重复
 *  枚举，这条把它们合并成一次。成功即刷新快照与工作区归属；业务失败把 host 的 result
 *  交回调用方（首屏需要那个 envelope），异常静默（后台刷新不该打断请求）。 */
let sessionRosterInFlight: Promise<{ failure?: unknown }> | undefined

function refreshSessionRoster(apiProxy: ApiProxy, request: unknown): Promise<{ failure?: unknown }> {
  const existing = sessionRosterInFlight
  if (existing !== undefined) return existing
  markRosterRefreshed()
  const run = (async (): Promise<{ failure?: unknown }> => {
    try {
      const [full, wsList] = await Promise.all([
        apiProxy.sessions.list(request as never),
        apiProxy.workspace.list(request as never).catch(() => undefined),
      ])
      if (!full.result.ok) return { failure: full.result }
      const wsValue = (wsList?.result.ok === true ? wsList.result.value : undefined) as
        | { archivedSessionIds?: string[]; items?: Array<{ workspaceId: string; sessionIds?: string[] }> }
        | undefined
      // 顺手留下每行的投影（枚举结果本来就带），尾页读取查表即得，不用为此再
      // 枚举一次。整体替换而不是合并：删掉的会话不该在表里留下投影。
      const items = full.result.value.items as Array<{
        sessionId?: unknown
        projections?: { asOfSeq?: number; values?: Record<string, unknown> }
      }>
      const enumeratedAt = Date.now()
      const snapshots = new Map<string, { at: number; block: { asOfSeq?: number; values?: Record<string, unknown> } }>()
      for (const item of items) {
        if (typeof item.sessionId === 'string' && item.projections !== undefined) {
          snapshots.set(item.sessionId, { at: enumeratedAt, block: item.projections })
        }
      }
      sessionProjectionSnapshots = snapshots
      setRosterTtlCache({
        at: Date.now(),
        proxy: apiProxy,
        rawItems: toRosterItems(full.result.value.items as RosterItem[]),
        archivedIds: new Set((wsValue?.archivedSessionIds ?? []).map(id => String(id))),
      })
      setRosterOwnedCache(new Map(
        (wsValue?.items ?? []).map(item => [
          String(item.workspaceId),
          new Set((item.sessionIds ?? []).map(id => String(id))),
        ]),
      ))
      persistSessionRoster()
      return {}
    } catch {
      return {}
    } finally {
      sessionRosterInFlight = undefined
    }
  })()
  sessionRosterInFlight = run
  return run
}

async function dispatch(apiProxy: ApiProxy, method: string, payload: unknown, rpcId: string, signal?: AbortSignal): Promise<unknown> {
  const request: RpcRequest<unknown> = { rpcId: RpcId(rpcId), payload }
  if (method === 'session.list') {
    // v3.1: short-TTL the host enumeration (sessions.list + workspace.list
    // fold every session's metadata on the HOST — hundreds of rows of stat/
    // projection reads per call). Returning from the list page re-pages the
    // SAME host result within seconds; the TTL serves that from memory, and
    // a call after the TTL (or any cursor paging past the first page) still
    // reads fresh. Freshness loss is bounded by the TTL; new sessions appear
    // within one TTL window just like on the desktop's polling surfaces.
    const cursor = (payload as { cursor?: string } | undefined)?.cursor
    // 可选：让宿主在切片前按工作区过滤（见下方"归属过滤"）。不传即保持旧的全局分页行为。
    const workspaceId = (payload as { workspaceId?: string } | undefined)?.workspaceId
    const now = Date.now()
    // Paging rides the same cached enumeration: within the TTL window every
    // page (first or continuation) serves one consistent cut — a cursor
    // request that re-read the host could straddle two different lists.
    // 重启后的第一次调用：先把落盘快照读回内存，首帧就不必等全量枚举。
    hydrateSessionRoster(apiProxy)
    const ttl = rosterTtlCache()
    // 首屏必须新鲜；续页（带 cursor）允许复用旧快照。
    // 本机会话库有 3395 个条目，缓存一失效就要整个枚举一遍（秒级成本），而人往下拉
    // 历史时两次请求的间隔普遍超过 TTL(30s) ⇒ 每次续页都重新枚举 ⇒ 真机反馈的
    // "越往深处拉越久、必现的长时间加载中"。续页本身只是在同一个稳定切面上按游标
    // 前进，用旧快照是安全的：真正的"列表变了"由首屏那次新鲜枚举负责。
    // 有快照就**先用它回答**（首屏与续页一视同仁），需要新鲜度时在后台重算。
    // 真机埋点把旧策略的代价钉死了：session.list 中位数 1ms、最坏 22.9 秒，而且成对
    // 并发都未命中 —— "首屏永远强制新鲜"意味着每次进入/返回都付一次 6~23 秒的全量
    // 枚举，12 秒看门狗必然报"加载超时了"。SWR 之后：有快照 ⇒ 毫秒级返回 + 后台刷新；
    // 没有快照（首次、或宿主刚重启）⇒ 只能等一次。代价：极少数情况下列表显示几秒前的
    // 快照，随后自动刷新。附带好处：并发的那第二个请求也会命中快照，不再重复枚举。
    const needRefresh = ttl !== undefined
      && (ttl.proxy !== apiProxy || now - ttl.at >= SESSION_LIST_TTL_MS)
      // 刷新节流：枚举要 6~30 秒，刷太勤会把宿主 CPU 占住、连带拖慢其他界面（埋点里
      // session.history 994ms / settings.read 224ms 正出现在枚举窗口内，事后同类调用
      // 只有 1~2ms —— 那是争用，不是那些接口本身慢）。
      && now - rosterLastRefreshAt() >= SESSION_LIST_REFRESH_MIN_MS
    let rawItems: Array<{ updatedAt: number; sessionId: string; origin?: 'subagent' }>
    let archivedIds: Set<string>
    if (ttl !== undefined) {
      rawItems = ttl.rawItems
      archivedIds = ttl.archivedIds
      if (needRefresh) refreshSessionRoster(apiProxy, request)
    } else {
      const { failure } = await refreshSessionRoster(apiProxy, request)
      // The error path must carry the same 'server-response' envelope the
      // success path builds, or the phone's callUnary throws a transport error
      // and masks the real business error.
      if (failure !== undefined) return { type: 'server-response' as const, rpcId, result: failure }
      const snapshot = rosterTtlCache()
      if (snapshot === undefined) {
        // 枚举异常（非业务错误）且手里没有任何旧快照：给一个空页，别让手机端拿到传输层错误。
        return { type: 'server-response', rpcId, result: { ok: true, value: { items: [], hasMore: false } } }
      }
      rawItems = snapshot.rawItems
      archivedIds = snapshot.archivedIds
    }
    // The phone's session picker shows main-agent sessions only: subagent
    // sessions (origin: 'subagent') are internal working sessions that would
    // clutter the roster and cost transfer bytes — and sessions archived on
    // the desktop (deleted/archived) never reappear. Filter before the sort
    // cache so paging never surfaces them.
    const mainItems = visibleSessionRows(rawItems, archivedIds)
    // 归属过滤：只保留本工作区真正拥有的会话。此前宿主返回全局 40 条、由客户端再按
    // 工作区丢弃，于是"每翻一屏只剩几条"—— 用户要么点很多次"加载更多"，要么一次连拉
    // 多页直接撞上 12 秒看门狗报超时（两种真机反馈都出现过）。
    // 归属数据与 archivedIds 同源（同一次 workspace.list），随枚举一起缓存，所以续页
    // 复用旧快照时同样具备过滤能力。workspaceId 缺失或归属未知时退回旧的全局分页行为。
    const ownedIds = workspaceId === undefined ? undefined : rosterOwnedCache()?.get(workspaceId)
    if (workspaceId !== undefined && ownedIds !== undefined && ownedIds.size === 0) {
      // 该工作区确实一个会话都没有：必须显式收尾，否则会变成"永远有下一页、永远空页"。
      return { type: 'server-response', rpcId, result: { ok: true, value: { items: [], hasMore: false } } }
    }
    const scopedItems = ownedIds === undefined
      ? mainItems
      : mainItems.filter(item => ownedIds.has(String(item.sessionId)))
    // Every call pages (the first call with no cursor IS the first page):
    // the phone must never transfer the whole session list at once.
    // One stable page over (updatedAt desc, sessionId asc); pages never skip
    // or repeat a row while the list changes between calls. The sort is
    // cached by a content key: paging through an unchanged list never
    // re-sorts, and any host-side change invalidates the cache immediately.
    // contentKey 必须并入 workspaceId，否则切换工作区会复用到另一条（错误的）序列，
    // 表现为"列表串工作区"。
    const contentKey = `${workspaceId ?? ''}|${scopedItems.map(item => `${item.sessionId}:${item.updatedAt}`).join(',')}`
    let items = scopedItems
    if (sessionListSortedCache?.key !== contentKey) {
      scopedItems.sort((a, b) => b.updatedAt - a.updatedAt
        || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
      sessionListSortedCache = { key: contentKey, items: scopedItems }
      items = scopedItems
    } else {
      items = sessionListSortedCache.items
    }
    const position = cursor === undefined ? undefined : parseSessionListCursor(cursor)
    const from = position === undefined ? 0 : items.findIndex(row => afterCursor(row, position))
    const start = from < 0 ? items.length : from
    const page = items.slice(start, start + SESSION_PAGE_SIZE).map(trimSessionListRow)
    const last = page[page.length - 1]
    const nextCursor = last !== undefined && start + page.length < items.length
      ? sessionListCursor(last.updatedAt, last.sessionId)
      : undefined
    return {
      type: 'server-response',
      rpcId,
      result: {
        ok: true,
        value: {
          items: page,
          hasMore: nextCursor !== undefined,
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        },
      },
    }
  }
  // The ApiProxy unary methods resolve to the internal response shape
  // ({ rpcId, result }) without the transport envelope the phone's callUnary
  // requires — wrap every pass-through in the same 'server-response'
  // envelope session.list builds above.
  const wrap = (response: { rpcId: string; result: unknown }): unknown => ({
    type: 'server-response' as const,
    rpcId,
    result: response.result,
  })
  if (method === 'workspace.list') {
    // v3.2: short-TTL the workspace roster — the session list re-fetches it
    // on every visit, and it only changes on create/rename/delete.
    const cached = workspaceListTtlCache
    if (cached !== undefined && cached.proxy === apiProxy && Date.now() - cached.at < ROSTER_TTL_MS) {
      return wrap(cached.response)
    }
    const response = await apiProxy.workspace.list(request as never)
    workspaceListTtlCache = { at: Date.now(), proxy: apiProxy, response }
    return wrap(response)
  }
  if (method === 'workspace.create') {
    invalidateRosterCaches()
    return wrap(await apiProxy.workspace.create(request as never))
  }
  if (method === 'workspace.rename') {
    invalidateRosterCaches()
    return wrap(await apiProxy.workspace.rename(request as never))
  }
  if (method === 'workspace.delete') {
    invalidateRosterCaches()
    return wrap(await apiProxy.workspace.delete(request as never))
  }
  // Session delete (= the desktop's archive semantics): the row leaves every
  // roster and never reappears after a refresh, while the session log stays
  // on disk (restorable from the desktop). Without this the phone's delete
  // was a local-only removal and the session resurrected on the next roster
  // fetch. Idempotent, reversible, single-id scoped — safe to expose here.
  if (method === 'workspace.archiveSession') {
    invalidateRosterCaches()
    return wrap(await apiProxy.workspace.archiveSession(request as never))
  }
  if (method === 'agentPreset.list') {
    // v3.2: the preset roster only changes on the desktop; short-TTL it.
    const cached = agentPresetTtlCache
    if (cached !== undefined && cached.proxy === apiProxy && Date.now() - cached.at < ROSTER_TTL_MS) {
      return wrap(cached.response)
    }
    const response = await apiProxy.agentPresets.list(request as never)
    agentPresetTtlCache = { at: Date.now(), proxy: apiProxy, response }
    return wrap(response)
  }
  if (method === 'session.create') {
    // The new session attaches to a workspace: the roster + list change.
    invalidateRosterCaches()
    return wrap(await apiProxy.sessions.create(request as never))
  }
  if (method === 'session.history') return wrap(await apiProxy.sessions.history(request as never))
  if (method === 'session.search') return wrap(await apiProxy.sessions.search(request as never, signal ?? new AbortController().signal))
  if (method === 'session.prompt') {
    const sessionId = (payload as { sessionId?: unknown } | undefined)?.sessionId
    invalidateSessionSearch()
    const reply = await apiProxy.sessions.prompt(request as never)
    // 队列版本 +1：手机端的乐观排队项据此退场（见 mobile/session-store.ts）。
    if (typeof sessionId === 'string') bumpQueueRevision(sessionId)
    return wrap(reply)
  }
  if (method === 'session.models') return wrap(await apiProxy.sessions.models(request as never))
  if (method === 'session.selectModel') return wrap(await apiProxy.sessions.selectModel(request as never))
  if (method === 'session.rename') {
    // The list row's title comes from projections; drop the cached envelope
    // so the renamed title shows on the next visit.
    invalidateRosterCaches()
    return wrap(await apiProxy.sessions.rename(request as never))
  }
  if (method === 'session.cancel') return wrap(await apiProxy.sessions.cancel(request as never))
  if (method === 'session.updateQueue') {
    const sessionId = (payload as { sessionId?: unknown } | undefined)?.sessionId
    const reply = await apiProxy.sessions.updateQueue(request as never)
    // 编辑/删除/插队都会让队列换代：手机端的乐观项与快照都靠这个版本号对齐。
    if (typeof sessionId === 'string') bumpQueueRevision(sessionId)
    return wrap(reply)
  }
  if (method === 'subagent.list') return wrap(await subagentCatalogWithActivity(request, apiProxy))
  if (method === 'settings.read') {
    // The full redacted settings surface (namespace schemas + values, secrets
    // stripped by the host seam) — the phone renders the same configuration
    // cards as the desktop. Writes stay whitelisted below.
    const response = await apiProxy.settings.describe(request as never)
    return wrap(response)
  }
  if (method === 'settings.mutate') {
    const body = asJsonObject(payload)
    const ns = typeof body?.ns === 'string' ? body.ns : undefined
    const ops = Array.isArray(body?.ops) ? body.ops : undefined
    const allowed = ns !== undefined ? SETTINGS_WRITE_WHITELIST[ns] : undefined
    const whitelisted = allowed !== undefined && ops !== undefined && ops.length > 0
      && ops.every(op => isAllowedSettingsOp(op, allowed))
    if (!whitelisted) {
      // Same stable refusal as the pairing 404s: the phone renders a generic
      // "不可用" without learning what is actually served.
      return {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'not-found', message: '设置项不可用' } },
      }
    }
    const expectedRevision = typeof body?.expectedRevision === 'number' ? body.expectedRevision : undefined
    const response = await apiProxy.settings.mutate({
      rpcId: RpcId(rpcId),
      payload: {
        ns,
        ops: ops as never,
        ...(expectedRevision !== undefined ? { expectedRevision } : {}),
      },
    } as never)
    return wrap(response)
  }
  throw new Error(`unhandled allowlisted method ${method}`)
}

/** Whether a path-addressed op names exactly one whitelisted path (set only).
 * A `'*'` entry matches any single field of the namespace. */
function isAllowedSettingsOp(op: unknown, allowed: readonly (readonly string[])[]): boolean {
  if (typeof op !== 'object' || op === null) return false
  const record = op as Record<string, unknown>
  if (record.op !== 'set' || !Array.isArray(record.path)) return false
  const path = record.path.map(part => (typeof part === 'string' ? part : ''))
  return allowed.some(allowedPath => {
    if (allowedPath.length === 1 && allowedPath[0] === '*') return path.length === 1
    return allowedPath.length === path.length
      && allowedPath.every((part, index) => part === path[index])
  })
}
