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
import { processState, type OrdinarySearchSession, type OrdinarySearchSnapshot } from './mobile/api/process-state.ts'
import { isAllowedSettingsOp } from './mobile/api/settings.ts'
import { readChatInclude } from './mobile/api/chat-include.ts'

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
import { makeMobileDispatchTable, type MobileDispatchContext } from './mobile/api/dispatch.ts'
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
import { coalesceTurnMessages, EventFolder, foldEvents, type RenderMessage } from './mobile/render/messages.ts'
import { processModel } from './mobile/render/process-rows.ts'
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

/** One session.list page (thin phones load incrementally). */
/** Concurrent SSE mux subscriptions allowed per server (reconnect-tolerant). */
const MAX_SSE_SUBSCRIBERS = 8

/** session.list sort cache: content key -> sorted row array (see dispatch). */

/** 「刚结束」账本的落盘文件（位置同样由 perfDir 决定，源码里不出现本机路径）。 */
/** 两次后台刷新之间的最小间隔：枚举要 6~30 秒，刷太勤会把宿主变成其他界面的瓶颈。 */
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
  if (processState.finishedRunsFile === undefined || sessionId === '') return
  try {
    const now = Date.now()
    // 标题尽力从花名册缓存里捞（有就填，没有就留空由客户端补）。
    const title = titleForSession(sessionId)
    const merged = mergeFinishedRuns(readFinishedRuns(processState.finishedRunsFile, now), [{
      sessionId,
      title,
      finishedAt,
      status,
    }], now)
    writeFinishedRuns(processState.finishedRunsFile, merged)
  } catch {
    // 账本写失败不能影响实时流
  }
}

/** Short TTL for the host session-list enumeration (v3.1+; see dispatch).
 *  30s because the phone's list view re-renders cached rows immediately and
 *  re-validates in the background — the TTL only bounds the background
 *  refresh's host cost, and freshness is carried by the row-level update. */
/** The TTL cache: host rows + archive set, re-served within the window.
 *  Bound to the apiProxy instance so independent proxies (tests spin up one
 *  per server) never share a stale enumeration. */
/** 会话投影快照（每次全量枚举时整体替换）。
 *
 *  手机的权限选择器/上下文占用/轮次大纲都以尾页投影为基线，而日志尾部里只有
 *  消息事件。直接为主页补一次 `sessions.list` 是不可接受的：枚举三千多个会话
 *  要 6~30 秒（见 refreshSessionRoster 的注释）。枚举本来就在跑（列表页），顺手
 *  把每行的投影留下即可，尾页读取只是查表。 */
/**
 * 排队投影（inbox）上一次"现读"的时刻。
 *
 * 花名册快照里的 inbox 只有在枚举会话时才刷新，**宿主把排队消息认领成下一轮时它不会
 * 变**——手机端照这份快照轮询，卡片就永远挂着「排队中」。所以只要快照里还显示有待发
 * 项，就得开一帧 follow 拿当下的真值；这里记一次时刻，避免每 5 秒的轮询都去读宿主。
 */
/** 待发投影的现读节流：手机上每 5 秒轮询一次，宿主这边最多 4 秒真读一次。 */

/**
 * 快照里**没有**待发项时的现读节流（比上面松）。
 *
 * 空快照原来一律不现读 —— 于是「桌面端新排了一条」手机永远发现不了：快照只在枚举
 * 会话时刷新，桌面往队列里塞消息不会改它，手机就一直按这份空快照画（真机反馈：
 * 桌面有排队消息、手机没有排队条，2026-10-30）。空快照也要能发现新出现的东西，
 * 只是可以慢一点：手机轮询最快 1.5 秒一次，宿主这边 10 秒真读一次足够，也避免
 * 每次都去抢同会话的聊天读。
 */

/** 尾页随消息一起下发的投影键（首屏渲染要用的那几个，都很小）。
 *  turnOutline 刻意不在里面：它能有 87 KB，而首屏并不需要它。 */
/** TTL for the workspace roster / agent-preset roster caches (v3.2). */
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
/** agentPreset.list TTL cache (see dispatch). */

/**
 * Drop the roster caches after a mutation the phone itself performed
 * (create/rename/delete/archive): those changes must be visible on the next
 * visit immediately, not after the TTL. MUTATING methods call this; the
 * session-list TTL is also dropped so the new row set shows right away.
 */
function invalidateRosterCaches(): void {
  setRosterTtlCache(undefined)
  processState.workspaceListTtlCache = undefined
  processState.ordinarySearchSnapshotCache = undefined
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
  processState.ordinarySearchSnapshotCache = undefined
  scheduleSearchSync()
}

/** One deferred incremental index pass, coalescing bursts of mutations. */
function scheduleSearchSync(): void {
  if (processState.searchSyncTimer !== undefined) return
  processState.searchSyncTimer = setTimeout(() => {
    processState.searchSyncTimer = undefined
    void processState.activeSearchIndexer?.runOnce().catch(() => undefined)
  }, SEARCH_SYNC_DEBOUNCE_MS)
  processState.searchSyncTimer.unref?.()
}

/** TTL for the session→workspace/title attribution backing mobile.searchAll. */
/** 当前在跑的索引器（宿主进程内唯一）：写操作后可以立刻催它增量同步。 */

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
  if (processState.locateSessionCache !== undefined && now - processState.locateSessionCache.at < LOCATE_TTL_MS) {
    return processState.locateSessionCache
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
  processState.locateSessionCache = { at: now, workspace, title, workspaceTitle }
  return processState.locateSessionCache
}
/** Message-level hits kept per expanded session hit (bounded view). */


/**
 * One authoritative roster for all search paths. Classification failures are
 * fail-closed: an unknown session must never leak a subagent conversation.
 *
 * 冷取一次要 3 秒（宿主那侧要扫会话 + 工作区），而 30 秒 TTL 一过又得重来 ——
 * 表现就是「隔一会儿再搜，第一次要等 3 秒」。所以缓存过期后先进 stale 窗口：
 * 立刻用旧名册作答，后台再刷新（子代理在索引阶段就已排除，旧名册最多让标签
 * 晚几分钟更新，不会漏出不该看的会话）。
 */



interface SearchDocument {
  rows: SearchDocumentRow[]
  complete: boolean
}


/** 手机侧写操作后多久安排一次增量同步（多次操作合并成一次）。 */
/** 旧入口 mobile.searchAll 最多回多少个会话（老客户端的分页语义）。 */
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
export { buildHealthReport } from './mobile/api/health-report.ts'

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
import { registerSearchIndex } from './mobile/api/search-index-registry.ts'
import type { MobileApiCtx } from './mobile/api/context.ts'
import { LOCATE_TTL_MS, MAX_ATTACHMENT_BASE64_CHARS, ROSTER_TTL_MS, SEARCH_ALL_SESSIONS, SEARCH_MESSAGES_LIMIT, SEARCH_SYNC_DEBOUNCE_MS, SESSION_LIST_REFRESH_MIN_MS, SESSION_LIST_TTL_MS, SESSION_PAGE_SIZE, SESSION_SNAPSHOT_STALE_MS, USAGE_CACHE_TTL_MS } from './mobile/api/constants.ts'
import { wrap } from './mobile/api/wrap.ts'
import { workspaceList } from './mobile/api/workspace-list.ts'
import { workspaceCreate, workspaceDelete, workspaceRename, workspaceArchiveSession } from './mobile/api/workspace-mutations.ts'
import { settingsRead, settingsMutate } from './mobile/api/settings-handlers.ts'
import { pushSubscribe, pushUnsubscribe } from './mobile/api/push-handlers.ts'
import { pairDevices, pairRevoke, pairRename, pairSetPrimary } from './mobile/api/pair-handlers.ts'
import { agentPresetList, subagentList } from './mobile/api/roster-handlers.ts'
import { sessionCreate, sessionHistory, sessionSearch, sessionPrompt, sessionModels, sessionSelectModel, sessionRename, sessionCancel, sessionUpdateQueue } from './mobile/api/session-handlers.ts'
import { sessionList as sessionListHandler } from './mobile/api/session-list-handler.ts'
import { pushConfig } from './mobile/api/push-config.ts'
import { mobilePending, mobilePreferences, mobileTranscribe } from './mobile/api/mobile-handlers.ts'
import { mobileCommands, mobileGitSummary, mobileLatestVersion } from './mobile/api/mobile-info-handlers.ts'
import { mobileListDirectoryHandler, mobileVoiceServices } from './mobile/api/mobile-fs-handlers.ts'
import { mobileNotifyEvents, mobileObserve, mobileReadAttachment, mobileTurnState } from './mobile/api/mobile-stream-handlers.ts'
import { mobilePerf, mobileTurnOutline } from './mobile/api/mobile-runtime-handlers.ts'
import { mobileError, mobileSearchMessages } from './mobile/api/mobile-search-handlers.ts'
import { mobileCommandExec, mobilePreviews } from './mobile/api/mobile-action-handlers.ts'
import { mobileFinishedRuns } from './mobile/api/mobile-finished-runs.ts'
import { mobileRunningSessions } from './mobile/api/mobile-running.ts'
import { mobileRespond } from './mobile/api/mobile-respond.ts'
import { mobileReadFile } from './mobile/api/mobile-file-handlers.ts'
import { mobileLogTail } from './mobile/api/mobile-log-tail.ts'
import { mobileReadChat } from './mobile/api/mobile-read-chat.ts'
import { mobileFolders } from './mobile/api/mobile-folders.ts'
import { mobileUploadAttachment } from './mobile/api/mobile-upload.ts'
import { mobileDiagnostics } from './mobile/api/health-report.ts'
import { MOBILE_ALLOWLIST } from './mobile/api/allowlist.ts'
import { mobileUsage } from './mobile/api/mobile-usage.ts'
import { mobileSessionState, readGoalProjection } from './mobile/api/mobile-session-state.ts'
import { readInboxProjection, shouldRefreshInbox } from './mobile/api/inbox-fresh.ts'
import { ordinarySearchSnapshot } from './mobile/api/search-snapshot.ts'
import { mobileSearch } from './mobile/api/mobile-search.ts'
export { shouldRefreshInbox }
export { MOBILE_ALLOWLIST }
// 索引库的登记与关闭搬到 api/search-index-registry.ts（B 步第一块）。
export { closeSearchIndexes, registerSearchIndex } from './mobile/api/search-index-registry.ts'
export function makeMobileApiRoutes(deps: MobileApiDeps): WebRoute[] {
  // 花名册快照的落盘位置：跟着 perfDir 走（由插件配置决定），源码里不写任何本机路径。
  // perfDir 未配置时（测试环境）自动退化为纯内存缓存。
  setRosterFile(deps.perfDir === undefined ? undefined : join(deps.perfDir, 'roster-snapshot.json'))
  processState.finishedRunsFile = deps.perfDir === undefined ? undefined : join(deps.perfDir, 'finished-runs.json')
  const { service, apiProxy, mobileEnterToSend } = deps

  // ---- B2：闭包状态收拢到 ctx ----
  // 只收「一个 makeMobileApiRoutes 实例内部、被多个分支共用」的可变状态与三个共享
  // 工具函数。模块级单例缓存（locateSessionCache / workspaceListTtlCache /
  // agentPresetTtlCache / ordinarySearchSnapshotCache / searchSyncTimer /
  // sessionProjectionSnapshots / inboxFreshAt / sessionListSortedCache / usageCache）
  // 搬进来会从「进程一份」变成「实例一份」，语义会变，原样留在模块作用域；
  // finishedRunsFile 同理 —— 模块级 noteHostFinishedRun() 也要读写它，不能收进实例。
  const ctx: MobileApiCtx<MobileApiDeps> = {
    deps,
    service,
    apiProxy,
    mobileEnterToSend,
    eventsHeartbeatMs: deps.eventsHeartbeatMs ?? DEFAULT_EVENTS_HEARTBEAT_MS,
    // 下面三个是函数声明（hoisted），所以可以在这里先引用、后面再定义；
    // 别把它们改回 const 箭头函数 —— 那样这个初始化会踩 TDZ。
    // ---- 自建搜索索引（期 1：影子模式，不改变任何现有返回）----
    searchIndexPromise: undefined,
    searchIndexer: undefined,
    ensureSearchIndex,
    touchDeviceFor,
    gateOk,
    activeEvents: 0,
    activeNotifyEvents: 0,
  }

  /**
   * 第一次手机请求时才起索引。宿主启动不抢资源；建库在后台按 60ms/页限速跑，
   * 手机照旧用旧路径，索引追上之前不给任何结论。
   */
  async function ensureSearchIndex(): Promise<SearchIndex | undefined> {
    if (ctx.searchIndexPromise !== undefined) return await ctx.searchIndexPromise
    ctx.searchIndexPromise = (async () => {
      const path = deps.searchIndexPath
      if (path === undefined) return undefined
      const index = await SearchIndex.open(path)
      if (index === undefined) return undefined
      registerSearchIndex(index)
      const indexer = new SearchIndexer({
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
      ctx.searchIndexer = indexer
      processState.activeSearchIndexer = indexer
      indexer.start()
      // 端到端测试要确定性：先把第一趟跑完，免得断言和后台建库赛跑。
      if (deps.searchIndexEager === true) await indexer.runOnce()
      return index
    })()
    return await ctx.searchIndexPromise
  }

  // 构造即开跑：索引在后台自己建，手机就算一直不开也会追上（首个 pass 延迟 15s，
  // 建库按 60ms/页限速，不占宿主启动时间）。
  void ctx.ensureSearchIndex().catch(() => undefined)

  /**
   * Refresh the paired device's presence and report whether it is live.
   * The mobile surface (unlike the desktop Web UI) has no `/api/pair/heartbeat`
   * sender, so any activity on the mobile channel — a gated RPC, or the live
   * SSE stream staying open — must count as presence. Without this, an
   * idle-but-connected phone ages past `offlineAfterMs` and the desktop panel
   * wrongly reports it as disconnected.
   */
  function touchDeviceFor(req: IncomingMessage): boolean {
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    if (deviceId === undefined) return false
    return service.touchDevice(deviceId)
  }

  /** The phone gate: a live paired-device cookie, or nothing else proceeds. */
  function gateOk(req: IncomingMessage): boolean {
    return ctx.touchDeviceFor(req)
  }

  type MethodContext = MobileDispatchContext & typeof ctx
  const localHandlers = makeMobileDispatchTable<MethodContext>([
      [MOBILE_FINISHED_RUNS_METHOD, async (ctx) => mobileFinishedRuns(ctx)],
      [MOBILE_PERF_METHOD, async (ctx) => mobilePerf(ctx)],
      [MOBILE_ERROR_METHOD, async (ctx) => mobileError(ctx)],
      [MOBILE_PREFERENCES_METHOD, async (ctx) => mobilePreferences(ctx)],
      [MOBILE_PENDING_METHOD, async (ctx) => mobilePending(ctx)],
      [MOBILE_RESPOND_METHOD, async (ctx) => mobileRespond(ctx)],
      [MOBILE_LIST_DIRECTORY_METHOD, async (ctx) => mobileListDirectoryHandler(ctx)],
      [MOBILE_READ_FILE_METHOD, async (ctx) => mobileReadFile(ctx)],
      [MOBILE_UPLOAD_ATTACHMENT_METHOD, async (ctx) => mobileUploadAttachment(ctx)],
      [MOBILE_COMMANDS_METHOD, async (ctx) => mobileCommands(ctx)],
      [MOBILE_COMMAND_EXEC_METHOD, async (ctx) => mobileCommandExec(ctx)],
      [MOBILE_VOICE_SERVICES_METHOD, async (ctx) => mobileVoiceServices(ctx)],
      [MOBILE_PUSH_SUBSCRIBE_METHOD, async (ctx) => pushSubscribe(ctx)],
      [MOBILE_PUSH_UNSUBSCRIBE_METHOD, async (ctx) => pushUnsubscribe(ctx)],
      [MOBILE_PUSH_CONFIG_METHOD, async (ctx) => pushConfig(ctx)],
      [MOBILE_PAIR_DEVICES_METHOD, async (ctx) => pairDevices(ctx)],
      [MOBILE_PAIR_REVOKE_METHOD, async (ctx) => pairRevoke(ctx)],
      [MOBILE_PAIR_RENAME_METHOD, async (ctx) => pairRename(ctx)],
      [MOBILE_PAIR_SET_PRIMARY_METHOD, async (ctx) => pairSetPrimary(ctx)],
      [MOBILE_FOLDERS_METHOD, async (ctx) => mobileFolders(ctx)],
      [MOBILE_NOTIFY_EVENTS_METHOD, async (ctx) => mobileNotifyEvents(ctx)],
      [MOBILE_GIT_SUMMARY_METHOD, async (ctx) => mobileGitSummary(ctx)],
      [MOBILE_LATEST_VERSION_METHOD, async (ctx) => mobileLatestVersion(ctx)],
      [MOBILE_TURN_OUTLINE_METHOD, async (ctx) => mobileTurnOutline(ctx)],
      [MOBILE_INBOX_METHOD, async (ctx) => {
        const { res, parsed, rpcId, apiProxy } = ctx
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
      }],
      [MOBILE_SESSION_STATE_METHOD, async (ctx) => mobileSessionState(ctx)],
      [MOBILE_GOAL_METHOD, async (ctx) => {
        const { res, parsed, rpcId, deps, apiProxy } = ctx
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
      }],
      [MOBILE_GOAL_ACTION_METHOD, async (ctx) => {
        const { res, parsed, rpcId, deps } = ctx
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
      }],
      [MOBILE_TURN_STATE_METHOD, async (ctx) => mobileTurnState(ctx)],
      [MOBILE_RUNNING_SESSIONS_METHOD, async (ctx) => mobileRunningSessions(ctx)],
      [MOBILE_SEARCH_METHOD, async (ctx) => mobileSearch(ctx)],
      [MOBILE_SEARCH_ALL_METHOD, async (ctx) => {
        const { res, parsed, rpcId, apiProxy, ensureSearchIndex } = ctx
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
      }],
      [MOBILE_SEARCH_MESSAGES_METHOD, async (ctx) => mobileSearchMessages(ctx)],
      [MOBILE_USAGE_METHOD, async (ctx) => mobileUsage(ctx)],
      [MOBILE_READ_CHAT_METHOD, async (ctx) => mobileReadChat(ctx)],
      [MOBILE_LOG_TAIL_METHOD, async (ctx) => mobileLogTail(ctx)],
      [MOBILE_OBSERVE_METHOD, async (ctx) => mobileObserve(ctx)],
      [MOBILE_DIAGNOSTICS_METHOD, async (ctx) => mobileDiagnostics(ctx)],
      [MOBILE_READ_ATTACHMENT_METHOD, async (ctx) => mobileReadAttachment(ctx)],
      [MOBILE_PREVIEWS_METHOD, async (ctx) => mobilePreviews(ctx)],
      [MOBILE_TRANSCRIBE_METHOD, async (ctx) => mobileTranscribe(ctx)],
  ])

  async function handleProxy(ctx: MethodContext): Promise<void> {
    const { req, res, method, parsed, rpcId, apiProxy } = ctx
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

  const methods = makeMobileDispatchTable<MethodContext>([
    ...Array.from(MOBILE_ALLOWLIST, method => [method, handleProxy] as const),
    ...localHandlers,
  ])

  const handleMethod = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    // 第一次通过门禁的手机请求就顺手把索引拉起来（幂等；之后再进来只是等同一个 promise）。
    void ctx.ensureSearchIndex().catch(() => undefined)
    if (!ctx.gateOk(req)) {
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
    const local = localHandlers.has(method)
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
    const handler = methods.get(method) ?? handleProxy
    await handler({ ...ctx, req, res, method, parsed, rpcId })
  }

  // 并发 SSE 预算（activeEvents / activeNotifyEvents）已收进 ctx，见函数开头。

  /** Bridge the host mux stream over SSE: one `data:` frame per mux frame. */
  const handleEvents = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    // 第一次通过门禁的手机请求就顺手把索引拉起来（幂等；之后再进来只是等同一个 promise）。
    void ctx.ensureSearchIndex().catch(() => undefined)
    if (!ctx.gateOk(req)) {
      writeJson(res, 403, {
        ok: false,
        error: { code: 'unpaired', message: 'mobile session is not paired' },
      })
      return
    }
    // Cap concurrent subscriptions so one device (or a reconnect storm) cannot
    // hold an unbounded number of host mux streams and heartbeat timers. The
    // EventSource reconnects, so a refusal is transient.
    if (ctx.activeEvents >= MAX_SSE_SUBSCRIBERS) {
      writeJson(res, 429, { ok: false, error: { code: 'too-many-events', message: 'too many live streams' } })
      return
    }
    ctx.activeEvents += 1
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
      ctx.activeEvents -= 1
      ;(apiProxy as ApiProxyAdapter).setPhoneConnected(ctx.activeEvents > 0)
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
      ctx.touchDeviceFor(req)
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
    }, ctx.eventsHeartbeatMs)
    const onClose = (): void => {
      if (closed) return
      closed = true
      controller.abort()
      clearInterval(heartbeat)
      ctx.activeEvents -= 1
      // The plain socket close (tunnel blip, app backgrounded, phone gone) used
      // to decrement the count and stop: only endStream() — the revocation path
      // — ever refreshed the flag, so ONE closed stream left the host believing
      // a phone was online for the rest of the process. That stale flag made the
      // bridge keep a phone-side branch alive for a stream nobody reads; the
      // desktop's own panel is what answers in that state (dual-answer race in
      // api-proxy-adapter.ts), so the flag must track the live subscriptions.
      ;(apiProxy as ApiProxyAdapter).setPhoneConnected(ctx.activeEvents > 0)
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
    void ctx.ensureSearchIndex().catch(() => undefined)
    if (!ctx.gateOk(req)) {
      req.resume()
      writeJson(res, 403, { ok: false, error: { code: 'unpaired', message: 'mobile session is not paired' } })
      return
    }
    if (ctx.activeNotifyEvents >= MAX_SSE_SUBSCRIBERS) {
      writeJson(res, 429, { ok: false, error: { code: 'too-many-events', message: 'too many live streams' } })
      return
    }
    ctx.activeNotifyEvents += 1
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
      ctx.activeNotifyEvents -= 1
      res.end()
    }
    const heartbeat = setInterval(() => {
      if (closed) return
      if (!deviceStillPaired()) {
        endStream()
        return
      }
      ctx.touchDeviceFor(req)
      try {
        res.write(': ping\n\n')
      } catch {
        // The write failed; the close handler tears the subscription down.
      }
    }, ctx.eventsHeartbeatMs)
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
      ctx.activeNotifyEvents -= 1
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


async function dispatch(apiProxy: ApiProxy, method: string, payload: unknown, rpcId: string, signal?: AbortSignal): Promise<unknown> {
  const request: RpcRequest<unknown> = { rpcId: RpcId(rpcId), payload }
  const ctx = { apiProxy, payload, rpcId, signal, request }
  type ProxyContext = typeof ctx
  const sessionList = makeMobileDispatchTable<ProxyContext, unknown>([
  ['session.list', async (ctx) => sessionListHandler({ apiProxy: ctx.apiProxy, payload: ctx.payload, rpcId: ctx.rpcId, request: ctx.request })],
  ])
  // The ApiProxy unary methods resolve to the internal response shape
  // ({ rpcId, result }) without the transport envelope the phone's callUnary
  // requires — wrap every pass-through in the same 'server-response'
  // envelope session.list builds above.
  const methods = makeMobileDispatchTable<ProxyContext, unknown>([
    ...sessionList,
    ['workspace.list', async (ctx) => workspaceList({ apiProxy: ctx.apiProxy, rpcId: ctx.rpcId, request: ctx.request })],
    ['workspace.create', async (ctx) => workspaceCreate({ apiProxy: ctx.apiProxy, rpcId: ctx.rpcId, request: ctx.request, invalidateRosterCaches })],
    ['workspace.rename', async (ctx) => workspaceRename({ apiProxy: ctx.apiProxy, rpcId: ctx.rpcId, request: ctx.request, invalidateRosterCaches })],
    ['workspace.delete', async (ctx) => workspaceDelete({ apiProxy: ctx.apiProxy, rpcId: ctx.rpcId, request: ctx.request, invalidateRosterCaches })],
  // Session delete (= the desktop's archive semantics): the row leaves every
  // roster and never reappears after a refresh, while the session log stays
  // on disk (restorable from the desktop). Without this the phone's delete
  // was a local-only removal and the session resurrected on the next roster
  // fetch. Idempotent, reversible, single-id scoped — safe to expose here.
    ['workspace.archiveSession', async (ctx) => workspaceArchiveSession({ apiProxy: ctx.apiProxy, rpcId: ctx.rpcId, request: ctx.request, invalidateRosterCaches })],
  ['agentPreset.list', async (ctx) => agentPresetList(ctx)],
  ['session.create', async (ctx) => sessionCreate({ ...ctx, invalidateRosterCaches, invalidateSessionSearch })],
  ['session.history', async (ctx) => sessionHistory({ ...ctx, invalidateRosterCaches, invalidateSessionSearch })],
  ['session.search', async (ctx) => sessionSearch({ ...ctx, invalidateRosterCaches, invalidateSessionSearch })],
  ['session.prompt', async (ctx) => sessionPrompt({ ...ctx, invalidateRosterCaches, invalidateSessionSearch })],
  ['session.models', async (ctx) => sessionModels({ ...ctx, invalidateRosterCaches, invalidateSessionSearch })],
  ['session.selectModel', async (ctx) => sessionSelectModel({ ...ctx, invalidateRosterCaches, invalidateSessionSearch })],
  ['session.rename', async (ctx) => sessionRename({ ...ctx, invalidateRosterCaches, invalidateSessionSearch })],
  ['session.cancel', async (ctx) => sessionCancel({ ...ctx, invalidateRosterCaches, invalidateSessionSearch })],
  ['session.updateQueue', async (ctx) => sessionUpdateQueue({ ...ctx, invalidateRosterCaches, invalidateSessionSearch })],
  ['subagent.list', async (ctx) => subagentList(ctx)],
    ['settings.read', async (ctx) => settingsRead(ctx)],
    ['settings.mutate', async (ctx) => settingsMutate(ctx)],
  ])
  
  const handler = methods.get(method)
  if (handler !== undefined) return await handler(ctx)
  throw new Error(`unhandled allowlisted method ${method}`)
}

/** Whether a path-addressed op names exactly one whitelisted path (set only).
 * A `'*'` entry matches any single field of the namespace. */
