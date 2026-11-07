/**
 * Mobile-surface business API: the handful of host RPC methods the
 * simplified surface needs. Types come from the harness apiproxy contract
 * (type-only imports; the wire schemas stay in the bundle only through the
 * rpc/mux layers).
 */

import type { WorkspaceView } from '../api-proxy-types'
import type { AgentPresetEntry } from '../api-proxy-types'
import type { SessionSummary, SessionModels, SessionProjectionsBlock } from '../api-proxy-types'
import type { SubagentCatalog } from '../api-proxy-types'
import type { RenderMessage, TodoSnapshot } from './render/messages.ts'
import { callUnary } from './platform/rpc.ts'
import { READ_CHAT_TIMEOUT_MS } from './data/chat-helpers.ts'
export { READ_CHAT_TIMEOUT_MS } from './data/chat-helpers.ts'
import { SESSION_PREVIEW_BATCH_LIMIT } from './data/limits.ts'
import { lastObserveAt, setLastObserveAt } from './data/observe-latch.ts'
import { OBSERVE_ASSERT_MIN_MS, PREFERENCES_TTL_MS, MODELS_TTL_MS, WORKSPACE_ROSTER_TTL_MS } from './data/limits.ts'
import { rosterCached, rosterInFlight, setRosterCached, setRosterInFlight } from './data/workspace-roster.ts'
import type { ChatPage, MobileHealthView, HostFinishedRun, UsageView, ChatOpenExtras, DependencyCheckView, UsageProviderView, UsageModelRow, DeliveryRecordView, DeliveryStatsView, NotifyConfigView, NotifyEventView, PendingState, PendingApproval, PendingQuestionItem, DirectoryListing, DirectoryEntry, FilePreview, SessionPreview, CommandDescriptor, MobilePreferences, MobileSettingsRead, PairedDevicesView, PairedDeviceView, AgentPresetRoster, UploadedAttachment, WorkspaceCreateResult, ChatOpenInclude, CommandExecOutcome, CreatedSession, HistoryPage, IndexedSearchResult, MobileGoalAction, PromptMode, QueueAction, QueueItemView, SessionFoldersView, SessionFolderView, SessionMessageHit, SessionPage, SessionSearchHit, TurnState, IndexedSearchItem, QueueEditPart } from './mobile-types.ts'
import { coalescedRead, invalidateReadCoalescing } from './data/read-coalescing.ts'

export { invalidateReadCoalescing }
import type { PromptPart } from './platform/image.ts'
import type { VoiceService } from './platform/voice-services.ts'



/** The desktop theme preference (host `ui-theme`), synced to the phone. */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * 工作区花名册变了的唯一出口：建/改名/删工作区，以及会改变工作区下会话清单的
 * 建会话/改名/删会话。5 秒复用窗口是给"反复进出页面"省往返的，写入之后还留着
 * 它就会把刚删掉的行画回来、把刚建的藏起来（真机表现：删了工作区还能看见，退出
 * 再进才有变化）。所以每个写操作成功后都必须清掉它。
 */
export { invalidateWorkspaceRoster } from './data/invalidate-roster.ts'
// `export … from` 不进本文件作用域（踩过多次）：api.ts 里的写操作还要直接调它。
import { invalidateWorkspaceRoster } from './data/invalidate-roster.ts'

/** Store this device's Web Push subscription host-side (L2). */
export async function pushSubscribe(subscription: {
  endpoint: string
  keys: { p256dh: string; auth: string }
}): Promise<void> {
  await callUnary<unknown>('push.subscribe', { subscription })
}

/** Remove this device's Web Push subscription host-side (L2). */
export async function pushUnsubscribe(): Promise<void> {
  await callUnary<unknown>('push.unsubscribe', {})
}

/**
 * Main-agent sessions whose attached agent is running right now (host-side
 * enumeration). The run-overview entry seeds its badge from this so a session
 * that started generating before the phone opened still counts — its
 * turn/start frame is gone by then and session.list's TTL may be stale.
 */
/**
 * 一轮的实时状态，宿主给的结论：`{ running, turnStartAt?, lastEventAt?, asOf }`。
 *
 * 这是手机唯一该问「还在跑吗」的地方。宿主把"转发的帧看到的轮次边界"和"日志写下的
 * 边界"按 seq 比一次再回答；手机端不再拿静默时长、日志窗口里看不看得见边界、会话表
 * 行的 running 去推断——那三条都曾经把正跑着的一轮判成已完成。
 */

/**
 * 排队消息（宿主 `inbox` 投影里的 next-turn）。
 *
 * 桌面端 QueueDock 读的就是这份投影；手机端此前只等 `session/queue` 帧，而宿主从不发
 * 它，投影帧实测也到不了手机 —— 于是排队卡片永远是空的。这里直接问宿主要快照。
 */
/**
 * 排队快照。
 *
 * resh 只在**刚改过队列**（发送/删除/编辑）时用：宿主那边 fresh=1 会现开一帧 follow
 * 并读一页 history，而手机在回合跑着的时候每 5 秒问一次 —— 那样每条排队消息都要
 * 拖一次整日志读，弱网下反而更慢。平时走宿主的投影快照，改完自己再要一次新的。
 */

/**
 * Folded-view chat read (v3): the host serves message rows from its mux-fed
 * window cache instead of the raw event stream — a repeat visit to a session
 * costs zero log reads, and the wire carries rows instead of the full chunk/
 * tool event tail. Fall back to {@link history} + a local fold when the host
 * answers unavailable (older plugin); see App.loadChatPage.
 */

/**
 * Map one raw host queue item (the `session/queue` frame shape) into the
 * phone's queue row view. The host frame type is merge-extensible (content
 * blocks carry a wide payload), so the mapper reads only the narrow fields it
 * needs and never asserts the full shape.
 */

/** A queue mutation: edit the pending text, remove it, or steer it into the
 *  running turn (only while the agent is running). */

/**
 * 把一个文件的 base64 交给宿主暂存（`mobile.uploadAttachment`）。
 *
 * 手机端不直传宿主桌面的 `/upload` 通道（那条走桌面鉴权），由插件代传：宿主的附件
 * 服务落盘后回一个 receiptId，prompt 里带 `{ type: 'file', receiptId }` 即可。超时
 * 给到 120 秒：一张照片在隧道里也要几十秒，而误触重发比等久一点更烦人。
 */

/* ── per-provider usage / balance display ─────────────────────────────── */

/* ── pending approvals / questions (#1025) ───────────────────────────── */

/* ── read-only git summary ───────────────────────────────────────────── */

/** One changed path (see the host's mobile-git module). */
export interface GitFileChange {
  path: string
  status: string
  staged: boolean
}

/** One recent commit. */
export interface GitCommit {
  shortHash: string
  subject: string
  author: string
  at: number
}

/** What the git sheet renders. */
export interface GitSummary {
  repo: boolean
  branch?: string
  ahead?: number
  behind?: number
  files: GitFileChange[]
  commits: GitCommit[]
  warning?: string
}

/** Read the repository state of one directory (never mutates it). */
export async function fetchGitSummary(cwd: string): Promise<GitSummary> {
  return await callUnary<GitSummary>('mobile.gitSummary', { cwd })
}

/* ── directory browsing / workspace creation (#977) ──────────────────── */

/* ── paired-device management (P1/P2/P3) ─────────────────────────────── */

/* ── session folders (F1) ────────────────────────────────────────────── */

// diag 域的实现已搬到 data/impl/diag.ts（W4-4）；这里只转出，对外 API 不变。
export { latestVersion, logTail, readDiagnostics, reportError, reportPerf } from './data/impl/diag.ts'


// usage 域的实现已搬到 data/impl/usage.ts（W4-4）；这里只转出，对外 API 不变。
export { appendFinishedRun, clearHostFinishedRuns, fetchFinishedRuns, fetchUsage, removeHostFinishedRun } from './data/impl/usage.ts'


// 共享类型搬到 mobile-types.ts（W4-4）；这里只转出。
export type { ChatPage, MobileHealthView, HostFinishedRun, UsageView, ChatOpenExtras, DependencyCheckView, UsageProviderView, UsageModelRow, DeliveryRecordView, DeliveryStatsView, NotifyConfigView, NotifyEventView, PendingState, PendingApproval, PendingQuestionItem, DirectoryListing, DirectoryEntry, FilePreview, SessionPreview, CommandDescriptor, MobilePreferences, MobileSettingsRead, PairedDevicesView, PairedDeviceView, AgentPresetRoster, UploadedAttachment, WorkspaceCreateResult, ChatOpenInclude, CommandExecOutcome, CreatedSession, HistoryPage, IndexedSearchResult, MobileGoalAction, PromptMode, QueueAction, QueueItemView, SessionFoldersView, SessionFolderView, SessionMessageHit, SessionPage, SessionSearchHit, TurnState, IndexedSearchItem, QueueEditPart } from './mobile-types.ts'


// notify 域的实现已搬到 data/impl/notify.ts（W4-4）；这里只转出，对外 API 不变。
export { fetchPending, notifyEvents, readNotifyConfig, testNotifyChannels, writeNotifyConfig } from './data/impl/notify.ts'


// voice 域的实现已搬到 data/impl/voice.ts（W4-4）；这里只转出，对外 API 不变。
export { fetchHostVoiceServices, transcribeVoice } from './data/impl/voice.ts'


// fs 域的实现已搬到 data/impl/fs.ts（W4-4）；这里只转出，对外 API 不变。
export { readFile, readAttachment, listDirectory, previews } from './data/impl/fs.ts'


// settings 域的实现已搬到 data/impl/settings.ts（W4-4）；这里只转出，对外 API 不变。
export { readSettings, mutateSettings, fetchMobilePreferences, selectModel, models, listCommands, listDevices, renameDevice, revokeDevice, setPrimaryDevice } from './data/impl/settings.ts'


// workspace 域的实现已搬到 data/impl/workspace.ts（W4-4）；这里只转出，对外 API 不变。
export { listWorkspaces, createWorkspace, deleteWorkspace, renameWorkspace, listAgentPresets, uploadAttachment } from './data/impl/workspace.ts'


// session 域的实现已搬到 data/impl/session.ts（W4-4）；这里只转出，对外 API 不变。
export { turnOutlineOf, sessionState, inboxOf, goalOf, goalAction, turnState, runningSessions, listSessions, searchAll, searchSessions, searchMessages, createSession, history, readChat, observeSession, prompt, newRequestId, queueItemViewOf, updateQueue, sendCommand, renameSession, cancelSession, subagentsList, respondApproval, respondQuestion, archiveSession, readSessionFolders, createSessionFolder, renameSessionFolder, removeSessionFolder, assignSessionFolder } from './data/impl/session.ts'
