/**
 * Mobile-surface business API: the handful of host RPC methods the
 * simplified surface needs. Types come from the harness apiproxy contract
 * (type-only imports; the wire schemas stay in the bundle only through the
 * rpc/mux layers).
 */

import type { WorkspaceView } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import type { AgentPresetEntry } from '@deepseek-ai/dsh-host-apiproxy/api/agent-presets'
import type { SessionSummary, SessionModels, SessionProjectionsBlock } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
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

/** One session.list page; omit the cursor for the first page. */
export async function listSessions(cursor?: string): Promise<SessionPage> {
  return await callUnary<SessionPage>('session.list', cursor === undefined ? {} : { cursor })
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

/** One slash command the host registry advertises (name + description). */
export interface CommandDescriptor {
  name: string
  description: string
  input?: { hint?: string }
}

/** List the host's registered slash commands (read-only discovery). */
export async function listCommands(): Promise<CommandDescriptor[]> {
  const response = await callUnary<{ items?: CommandDescriptor[] }>('mobile.commands', {})
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
 * The host-side fallback transcription service (dsh-palm.yaml `transcribe:`),
 * if any — the phone imports it into its own service list so the desktop
 * config shows up in the settings card without retyping the key.
 */
export async function fetchHostVoiceServices(): Promise<Array<Omit<VoiceService, 'id'>>> {
  const response = await callUnary<{ services: Array<Omit<VoiceService, 'id'>> }>('mobile.voiceServices', {})
  return response.services
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
