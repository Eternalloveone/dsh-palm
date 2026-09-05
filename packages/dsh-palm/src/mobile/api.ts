/**
 * Mobile-surface business API: the handful of host RPC methods the
 * simplified surface needs. Types come from the harness apiproxy contract
 * (type-only imports; the wire schemas stay in the bundle only through the
 * rpc/mux layers).
 */

import type { WorkspaceView } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import type { AgentPresetEntry } from '@deepseek-ai/dsh-host-apiproxy/api/agent-presets'
import type { SessionSummary, SessionModels, SessionProjectionsBlock } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import type { SubagentCatalog } from '@deepseek-ai/dsh-host-apiproxy/api/subagents'
import type { RenderMessage, TodoSnapshot } from './messages.ts'
import { callUnary } from './rpc.ts'
import type { PromptPart } from './image.ts'
import type { VoiceService } from './voice-services.ts'

/** One session.list page. */
export interface SessionPage {
  items: SessionSummary[]
  /** Continuation cursor; undefined once the tail is reached. */
  nextCursor?: string
  hasMore: boolean
}

/** The session.create result (the id is the commit the caller navigates to). */
export interface CreatedSession {
  sessionId: string
  /** The composition the new session runs (echoed so the caller can label it). */
  agentPreset?: string
}

/** Agent presets available when composing a new session. */
export interface AgentPresetRoster {
  presets: readonly AgentPresetEntry[]
  authorable: boolean
  hasDocument: boolean
}

/** One history page (already bounded to whole messages by the host). */
export interface HistoryPage {
  events: import('@deepseek-ai/dsh-host-apiproxy/api/sessions').HistoryEntry[]
  hasMore: boolean
  /**
   * Projection baseline riding the tail page (permissions select etc.);
   * absent when the deployment mounts no projection registry.
   */
  projections?: SessionProjectionsBlock
}

/** Read-only display preferences the plugin answers locally on `/m/api`. */
export interface MobilePreferences {
  /** Plain Enter sends the drafted prompt (false: Enter inserts a newline). */
  mobileEnterToSend: boolean
}

/** The desktop theme preference (host `ui-theme`), synced to the phone. */
export type ThemePreference = 'light' | 'dark' | 'system'

/** The full redacted settings surface (desktop-parity configuration cards). */
export interface MobileSettingsRead {
  writable: boolean
  hasDocument: boolean
  namespaces: import('@deepseek-ai/dsh-host-apiproxy/api/settings').SettingsNamespaceView[]
}

/** Read the full redacted settings surface (schemas + values, no secrets). */
export async function readSettings(): Promise<MobileSettingsRead> {
  return await callUnary<MobileSettingsRead>('settings.read', {})
}

/** Write whitelisted host setting paths (see SETTINGS_WRITE_WHITELIST). */
export async function mutateSettings(
  ns: string,
  ops: Array<{ op: 'set'; path: string[]; value: unknown }>,
  expectedRevision?: number,
): Promise<void> {
  const payload: Record<string, unknown> = { ns, ops }
  if (expectedRevision !== undefined) payload.expectedRevision = expectedRevision
  await callUnary<unknown>('settings.mutate', payload)
}

/** The workspace roster (session ids come back per workspace). */
export async function listWorkspaces(): Promise<WorkspaceView[]> {
  const { items } = await callUnary<{ items: WorkspaceView[] }>('workspace.list', {})
  return items
}

/** Read-only mobile display preferences (answered by the plugin, not the host proxy). */
export async function fetchMobilePreferences(): Promise<MobilePreferences> {
  return await callUnary<MobilePreferences>('mobile.preferences', {})
}

/** The redacted notify config the phone may read (no credentials). */
export interface NotifyConfigView {
  turnThresholdMs: number
  turnCooldownMs: number
  hideDetails: boolean
  /** Effective per-kind gates (as the host applies them). */
  kinds: { jobs: boolean; todo: boolean; turns: boolean }
  vapidPublicKey?: string
  channels: {
    serverchan: { configured: boolean }
    bark: { configured: boolean }
    telegram: { configured: boolean }
    pushplus: { configured: boolean }
  }
}

/** Read the notify config (thresholds + channel presence, credentials redacted). */
export async function readNotifyConfig(): Promise<NotifyConfigView> {
  return await callUnary<NotifyConfigView>('push.config', { get: true })
}

/** Write notify config fields (thresholds; channel credentials in M2). */
export async function writeNotifyConfig(patch: {
  turnThresholdMs?: number
  turnCooldownMs?: number
  hideDetails?: boolean
  kinds?: { jobs?: boolean; todo?: boolean; turns?: boolean }
  channels?: {
    serverchan?: { sendKey: string }
    bark?: { key: string }
    telegram?: { botToken: string; chatId: string }
    pushplus?: { token: string }
  }
}): Promise<void> {
  await callUnary<unknown>('push.config', { set: patch })
}

/** Push one synthetic event through the configured L3 channels (test button). */
export async function testNotifyChannels(): Promise<void> {
  await callUnary<unknown>('push.config', { test: true })
}

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

/** One completion-notification decision, as the phone's inbox renders it. */
export interface NotifyEventView {
  id: string
  kind: 'task-done' | 'task-failed' | 'turn-done' | 'todo-done'
  title: string
  body: string
  sessionId: string
  workspaceId?: string
  ts: number
}

/** The recent decisions (newest first; bounded by the host engine). */
export async function notifyEvents(): Promise<{ items: NotifyEventView[] }> {
  return await callUnary<{ items: NotifyEventView[] }>('mobile.notifyEvents', {})
}

/** The published latest version + whether the local one is behind. */
export async function latestVersion(): Promise<{ latest: string; isNewer: boolean }> {
  return await callUnary<{ latest: string; isNewer: boolean }>('mobile.latestVersion', {})
}

/**
 * Main-agent sessions whose attached agent is running right now (host-side
 * enumeration). The run-overview entry seeds its badge from this so a session
 * that started generating before the phone opened still counts — its
 * turn/start frame is gone by then and session.list's TTL may be stale.
 */
export async function runningSessions(): Promise<{ sessionIds: string[] }> {
  return await callUnary<{ sessionIds: string[] }>('mobile.runningSessions', {})
}

/** One session.list page; omit the cursor for the first page. */
export async function listSessions(cursor?: string): Promise<SessionPage> {
  return await callUnary<SessionPage>('session.list', cursor === undefined ? {} : { cursor })
}

/** One host-side full-roster search hit (message content across sessions). */
export interface SessionSearchHit {
  kind: 'title' | 'message'
  sessionId: string
  /** The matched content window (bounded by the host). */
  snippet: string
  /** Session display title when the host can resolve it. */
  title?: string
  /** Owning workspace when the host can attribute it (home-page locate). */
  workspaceId?: string
  /** Owning workspace's display title (host-resolved), so the row can label
   *  the owner even before the local roster finishes loading. */
  workspaceTitle?: string
  /** Stable folded message identity for exact locate. */
  messageId?: string
  /** Stable text-part identity inside the folded message. */
  partId?: string
  /** First matched message's event seq, retained for history paging fallback. */
  seq?: number
}

/** Search every session's messages across the whole host (with attribution). */
export async function searchAll(query: string): Promise<{ items: SessionSearchHit[]; hasMore: boolean; partial?: boolean }> {
  return await callUnary<{ items: SessionSearchHit[]; hasMore: boolean; partial?: boolean }>('mobile.searchAll', { query })
}

/** One message-level hit inside one session (the lazy expanded view). */
export interface SessionMessageHit {
  /** The matched message event's seq — chat rows cover the range
   *  [startSeq, seq], so this targets the exact row to scroll to. */
  seq: number
  messageId?: string
  partId?: string
  /** Surrounding plain-text excerpt around the match (host-clipped). */
  snippet: string
}

/**
 * Locate message-level hits inside ONE session (`mobile.searchMessages`,
 * answered by the host): the lazy detail behind an expanded search-hit row.
 * Bounded to the first 8 hits and a defensive history-page ceiling; the
 * locate scan continues through the session so deep search results remain
 * addressable. Results are cached for 60s.
 */
export async function searchMessages(sessionId: string, query: string): Promise<{ items: SessionMessageHit[] }> {
  return await callUnary<{ items: SessionMessageHit[] }>('mobile.searchMessages', { sessionId, query })
}

/** Read the available agent compositions for a new session. */
export async function listAgentPresets(): Promise<AgentPresetRoster> {
  return await callUnary<AgentPresetRoster>('agentPreset.list', {})
}

/**
 * Create a blank session (entity birth precedes the first message). Name a
 * workspace to attach it there, or a cwd; omitting both uses the host cwd.
 */
export async function createSession(
  options: { workspaceId?: string; cwd?: string; agentPreset?: string } = {},
): Promise<CreatedSession> {
  return await callUnary<CreatedSession>('session.create', options)
}

/**
 * One history window; omit beforeSeq for the tail page, pass a signal to abort.
 * The mobile page size is 25 (the desktop uses 30): a page of 30 messages
 * can exceed 1 MB of JSON for tool-heavy sessions, which over a slow phone
 * link outlives the client's history-load timeout and surfaces as a
 * transport error. 25 keeps the tail page small enough to load reliably
 * while still showing a screen and a half of context on open (the loadOlder
 * button pages further on demand).
 */
export async function history(
  sessionId: string,
  beforeSeq?: number,
  maxMessages = 25,
  signal?: AbortSignal,
): Promise<HistoryPage> {
  return await callUnary<HistoryPage>('session.history', {
    sessionId,
    maxMessages,
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
  }, signal)
}

/** One folded chat page (v3 `mobile.readChat`): rows, watermark, and seeds. */
export interface ChatPage {
  /** Folded message rows (never coalesced — the surface coalesces at render). */
  rows: RenderMessage[]
  /** Event-seq watermark of the page's source window (replay floor for live
   *  frames that may overlap a previous open of the same session). */
  maxSeq: number
  hasMore: boolean
  /** Newest valid todo/write in the page's events, when any. */
  todo?: TodoSnapshot
  /** Tail-page projection baseline, when available. */
  projections?: SessionProjectionsBlock
  /** The running turn's logged `turn/start` time (epoch ms) when the window
   *  holds an open turn boundary — the turn-clock anchor (desktop parity).
   *  Tail reads carry it; older-page reads never do. */
  turnStartAt?: number
}

/**
 * Folded-view chat read (v3): the host serves message rows from its mux-fed
 * window cache instead of the raw event stream — a repeat visit to a session
 * costs zero log reads, and the wire carries rows instead of the full chunk/
 * tool event tail. Fall back to {@link history} + a local fold when the host
 * answers unavailable (older plugin); see App.loadChatPage.
 */
export async function readChat(
  sessionId: string,
  beforeSeq?: number,
  maxRows = 25,
  signal?: AbortSignal,
): Promise<ChatPage> {
  return await callUnary<ChatPage>('mobile.readChat', {
    sessionId,
    ...(beforeSeq !== undefined ? { beforeSeq } : {}),
    ...(maxRows !== 25 ? { maxRows } : {}),
  }, signal)
}

/** One batch preview row (summary is '' when the session has no text yet). */
export interface SessionPreview {
  sessionId: string
  summary: string
  updatedAt: number
}

/** Cap on one batch preview request (host-side limit is the same). */
export const SESSION_PREVIEW_BATCH_LIMIT = 200

/**
 * Batch last-message previews (v3.1): the session-list page's preview lines
 * served by the host in ONE call — cached rows cost zero host log reads; a
 * session without a cache entry costs one lazy tail read. Fall back to
 * per-row {@link history} reads when the host answers unavailable (older
 * plugin); see SessionListView.loadPreviews.
 */
export async function previews(
  sessionIds: readonly string[],
  signal?: AbortSignal,
): Promise<SessionPreview[]> {
  const ids = sessionIds.filter(id => id !== '').slice(0, SESSION_PREVIEW_BATCH_LIMIT)
  if (ids.length === 0) return []
  const response = await callUnary<{ items: SessionPreview[] }>('mobile.previews', { sessionIds: ids }, signal)
  return response.items
}

/**
 * Send a prompt (queued: the agent picks it up in order). `parts` supports
 * text plus attached images (`{ type: 'image', mediaType, data, name? }`);
 * the host promotes image bytes to durable references.
 */
export async function prompt(sessionId: string, parts: PromptPart[]): Promise<void> {
  await callUnary<{ accepted: true }>('session.prompt', {
    sessionId,
    mode: 'queue',
    content: parts,
  })
}

/** One pending inbox occurrence in the host's `session/queue` snapshot. */
export interface QueueItemView {
  /** Message identity used by queue mutations. */
  id: string
  /** FIFO placement: queued (next turn) / steering (next step) / context. */
  placement: 'queued' | 'steering' | 'context'
  /** The pending message's preview text (empty for non-text content). */
  text: string
  /** True when the pending content is plain text (the only editable kind). */
  editable: boolean
}

/**
 * Map one raw host queue item (the `session/queue` frame shape) into the
 * phone's queue row view. The host frame type is merge-extensible (content
 * blocks carry a wide payload), so the mapper reads only the narrow fields it
 * needs and never asserts the full shape.
 */
export function queueItemViewOf(item: {
  id: string
  placement: 'queued' | 'steering' | 'context'
  message?: { content?: unknown }
}): QueueItemView {
  const blocks = Array.isArray(item.message?.content)
    ? (item.message.content as Array<{ type?: string; text?: string }>)
    : []
  const editable = blocks.length > 0 && blocks.every(block => block.type === 'text' && typeof block.text === 'string')
  const text = editable
    ? (blocks as Array<{ text: string }>).map(block => block.text).join('')
    : blocks
      .map(block => block.type === 'text' && typeof block.text === 'string' ? block.text : `[${block.type ?? '内容'}]`)
      .join(' ')
      .trim()
  return { id: item.id, placement: item.placement, text, editable }
}

/** A queue mutation: edit the pending text, remove it, or steer it into the
 *  running turn (only while the agent is running). */
export type QueueAction =
  | { kind: 'edit'; content: Array<{ type: 'text'; text: string }> }
  | { kind: 'remove' }
  | { kind: 'steer' }

/** Edit / remove / steer one pending queued message on the host. */
export async function updateQueue(sessionId: string, itemId: string, action: QueueAction): Promise<void> {
  await callUnary<{ accepted: true }>('session.updateQueue', { sessionId, itemId, action })
}

/** One slash command the host registry advertises (name + description). */
export interface CommandDescriptor {
  name: string
  description: string
  input?: { hint?: string }
}

/**
 * List the host's registered slash commands for one session (read-only
 * discovery). The session id resolves the agent whose effective command view
 * the phone shows — the same catalog the desktop composer's `/` popup lists.
 */
export async function listCommands(sessionId: string): Promise<CommandDescriptor[]> {
  const response = await callUnary<{ items?: CommandDescriptor[] }>('mobile.commands', { sessionId })
  return response.items ?? []
}

/** One executed slash-command outcome from the host registry. */
export interface CommandExecOutcome {
  /** false: the line did not resolve to a registered command (nothing ran). */
  matched: boolean
  kind?: 'success' | 'error'
  /** The command's own human result text (usage/state feedback), when any. */
  text?: string
}

/**
 * Execute one slash-command line through the host command registry
 * (`mobile.commandExec` — the same interception the desktop composer uses).
 * Never send a `/`-line through `prompt`: the host prompt channel does not
 * dispatch commands, so the line would reach the model verbatim.
 *
 * The cap is long (180 s) instead of the 60 s default: `/compact` summarizes
 * through the model and can outlive it. A finite ceiling still beats the
 * old disabled timeout — a hung link otherwise pins the composer's sending
 * state forever with no way to recover.
 */
export async function sendCommand(sessionId: string, line: string): Promise<CommandExecOutcome> {
  return await callUnary<CommandExecOutcome>('mobile.commandExec', { sessionId, line }, undefined, 180_000)
}

/**
 * Transcribe one base64 WAV through the phone-configured speech-to-text
 * services (`mobile.transcribe`, answered by the plugin). The services are
 * tried in order by the host; the cap is long (180 s) because a slow link
 * can stretch the call.
 */
export async function transcribeVoice(audio: string, services: VoiceService[]): Promise<string> {
  const response = await callUnary<{ text: string }>('mobile.transcribe', { audio, services }, undefined, 180_000)
  return response.text
}

/**
 * The host-side fallback transcription services (dsh-palm.yaml `transcribe:`),
 * if any — display facts only. The host API keys never leave the host, so
 * these services cannot be used from the phone and are not merged into the
 * local service list (see syncHostVoiceServices).
 */
export async function fetchHostVoiceServices(): Promise<Array<{ name: string; baseURL: string; model: string }>> {
  const response = await callUnary<{ services: Array<{ name: string; baseURL: string; model: string }> }>('mobile.voiceServices', {})
  return response.services
}

/* ── per-provider usage / balance display ─────────────────────────────── */

/** Per-model usage inside a provider's report. */
export interface UsageModelRow {
  name: string
  requestCount: number
}

/** One provider's displayed usage/balance row (display facts only, no keys). */
export interface UsageProviderView {
  name: string
  baseURL?: string
  kind: 'usage' | 'balance'
  status: 'ok' | 'no-key' | 'unsupported' | 'error'
  plan?: string
  usedPercent?: number
  sessionUsed?: number
  models?: UsageModelRow[]
  balance?: string
  fetchedAt: number
}

/** The full usage surface, synced from the desktop's configured providers. */
export interface UsageView {
  providers: UsageProviderView[]
  fetchedAt: number
}

/**
 * Fetch the per-provider usage/balance surface (`mobile.usage`, answered by the
 * plugin host-side). The desktop's configured providers drive the rows; a
 * provider with no public balance/usage endpoint is labelled `unsupported`, one
 * the desktop has no key for is `no-key`. Pass `refresh` to bypass the host's
 * short cache.
 */
export async function fetchUsage(refresh?: boolean): Promise<UsageView> {
  return await callUnary<UsageView>('mobile.usage', refresh === true ? { refresh: true } : {})
}

/** Rename one session (the chat page's 更多 menu). */
export async function renameSession(sessionId: string, title: string): Promise<unknown> {
  return await callUnary<unknown>('session.rename', { sessionId, title })
}

/**
 * Stop the session's active turn (the mobile stop button). Pending queued
 * work is preserved and resumes in FIFO order once cancellation settles.
 */
export async function cancelSession(sessionId: string): Promise<{ accepted: true }> {
  return await callUnary<{ accepted: true }>('session.cancel', { sessionId })
}

/** Direct-child subagent catalog for one parent (labels + activity + hasChildren). */
export async function subagentsList(parentSessionId: string): Promise<SubagentCatalog> {
  return await callUnary<SubagentCatalog>('subagent.list', { parentSessionId })
}

/** Fresh advisory model directory for one session (current + groups + failures). */
export async function models(sessionId: string): Promise<SessionModels> {
  return await callUnary<SessionModels>('session.models', { sessionId })
}

/** Select the complete model selection (provider/model/reasoning effort) for a session. */
export async function selectModel(
  sessionId: string,
  selection: { provider: string; model: string; reasoningEffort?: string },
): Promise<{ selected: { provider: string; model: string; reasoningEffort?: string } }> {
  return await callUnary<{ selected: { provider: string; model: string; reasoningEffort?: string } }>('session.selectModel', {
    sessionId,
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {}),
  })
}

/* ── pending approvals / questions (#1025) ───────────────────────────── */

/** One pending tool approval awaiting the user's decision. */
export interface PendingApproval {
  /** The approval/requested frame's rpcId — the wire correlation the answer echoes. */
  rpcId: string
  approvalId: string
  toolName: string
  callId?: string
  reason?: string
}

/** One pending question group awaiting the user's answer. */
export interface PendingQuestionItem {
  /** The question/requested frame's rpcId — the wire correlation the answer echoes. */
  rpcId: string
  id: string
  question: string
  detail?: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
}

/** The pending state for one session. */
export interface PendingState {
  approvals: PendingApproval[]
  questions: PendingQuestionItem[]
}

/** Fetch pending approvals and questions for one session (polling fallback data source). */
export async function fetchPending(sessionId: string): Promise<PendingState> {
  return await callUnary<PendingState>('mobile.pending', { sessionId })
}

/** Submit an approval decision (allowed-once or rejected). The answer is a
 * client-response echoing the approval/requested frame's rpcId. */
export async function respondApproval(
  rpcId: string,
  sessionId: string,
  approvalId: string,
  outcome: 'allowed-once' | 'rejected',
): Promise<void> {
  await callUnary<unknown>('mobile.respond', {
    rpcId,
    response: { sessionId, approvalId, outcome },
  })
}

/** Submit answers to a question group (one batch per ask, echoing its rpcId). */
export async function respondQuestion(
  rpcId: string,
  sessionId: string,
  answer: { answers: Array<{ id: string; selected: string[]; custom?: string }> },
): Promise<void> {
  await callUnary<unknown>('mobile.respond', {
    rpcId,
    response: { sessionId, answer },
  })
}

/* ── directory browsing / workspace creation (#977) ──────────────────── */

/** One entry in a directory listing. */
export interface DirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

/** The host directory listing result (one level, with ancestor breadcrumbs). */
export interface DirectoryListing {
  path: string
  home: string
  crumbs: DirectoryEntry[]
  entries: DirectoryEntry[]
  truncated: boolean
}

/** The result of creating a workspace from an existing directory. */
export interface WorkspaceCreateResult {
  workspace: WorkspaceView
  created: boolean
}

/** Browse one directory level on the host (defaults to home directory). */
export async function listDirectory(path?: string): Promise<DirectoryListing> {
  // Local patch (2026-08-23): host.listDirectory is gated on the composed
  // directory-picker capability (native on Windows loopback binds), so the
  // mobile browser uses the plugin's own fs listing instead.
  return await callUnary<DirectoryListing>('mobile.listDirectory', path === undefined ? {} : { path })
}

/** One file read back from the host for the chat's preview sheet. */
export type FilePreview =
  | { kind: 'text'; path: string; name: string; text: string }
  | { kind: 'image'; path: string; name: string; dataUrl: string }

/** Read one host file (text/image) for preview. A relative path resolves
 * against the owning session's cwd when `sessionId` is given. */
export async function readFile(path: string, sessionId?: string): Promise<FilePreview> {
  return await callUnary<FilePreview>('mobile.readFile', sessionId === undefined ? { path } : { path, sessionId })
}

/** True when a preview came back as an image data URL. */
export function isImagePreview(preview: FilePreview | undefined): preview is Extract<FilePreview, { kind: 'image' }> {
  return preview !== undefined && preview.kind === 'image'
}

/** Create a workspace from an existing host directory (does not mkdir). */
export async function createWorkspace(path: string): Promise<WorkspaceCreateResult> {
  return await callUnary<WorkspaceCreateResult>('workspace.create', { path })
}

/** Rename a workspace's display title (host validates trim/conflict). */
export async function renameWorkspace(workspaceId: string, title: string): Promise<{ workspace: WorkspaceView }> {
  return await callUnary<{ workspace: WorkspaceView }>('workspace.rename', { workspaceId, title })
}

/** Remove a workspace registration (the directory and session logs stay). */
export async function deleteWorkspace(workspaceId: string): Promise<{ deleted: true }> {
  return await callUnary<{ deleted: true }>('workspace.delete', { workspaceId })
}

/**
 * Delete one session the way the desktop does: an archive-set write that
 * removes it from every roster forever (the phone filters the archive set in
 * its session.list already), while the session log stays on disk — the
 * desktop can still surface it (unarchive). Idempotent; unknown id errors.
 */
export async function archiveSession(sessionId: string): Promise<{ archivedSessionIds: string[] }> {
  return await callUnary<{ archivedSessionIds: string[] }>('workspace.archiveSession', { sessionId })
}
