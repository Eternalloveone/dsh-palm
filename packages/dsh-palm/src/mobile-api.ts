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

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { PendingTracker } from './mobile-pending.ts'
import type { PairingService } from './pairing.ts'
import { asJsonObject, readBoundedJson, writeJson } from './http.ts'
import { readCookie } from './gate.ts'
import { resolveTranscribeServices, transcribeWav } from './voice-transcribe.ts'
import { opendir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/**
 * Methods the phone surface may call. Everything else is refused HERE — but
 * note the paired-device cookie also passes the global api/gate for the full
 * ApiProxy surface (gate.ts), so a paired phone is a full-control credential:
 * the allowlist only constrains this /m/api proxy, not the cookie's reach.
 * stop() revokes every device; the loopback panel can also revoke one
 * device at a time.
 */
const MOBILE_ALLOWLIST = new Set([
  'mobile.listDirectory',
  'workspace.create',
  'workspace.list',
  'workspace.rename',
  'workspace.delete',
  'agentPreset.list',
  'session.create',
  'session.list',
  'session.history',
  'session.search',
  'session.prompt',
  'session.models',
  'session.selectModel',
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
  'agent-presets': [['default']],
  'subagent-model': [['model'], ['provider']],
  'agent-default-model': [['model'], ['provider'], ['reasoningEffort']],
  'at-file': [['enabled']],
  'agent-loop': [['maxParallelToolCalls']],
  'dsh-market': [['allowRestart']],
  'dsh-better-sidebar': [['*']],
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
const MOBILE_COMMANDS_METHOD = 'mobile.commands'
const MOBILE_TRANSCRIBE_METHOD = 'mobile.transcribe'
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

/** One directory row the mobile browser can enter (directories + symlinks to dirs). */
interface MobileDirectoryEntry {
  name: string
  path: string
  hidden: boolean
}

/** One-level directory listing with ancestor breadcrumbs (host.listDirectory shape). */
interface MobileDirectoryListing {
  path: string
  home: string
  crumbs: MobileDirectoryEntry[]
  entries: MobileDirectoryEntry[]
  truncated: boolean
}

/** Ancestor chain from the filesystem root to `target` inclusive (breadcrumb rows). */
function mobileAncestryCrumbs(target: string): MobileDirectoryEntry[] {
  const crumbs: MobileDirectoryEntry[] = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    crumbs.unshift({ name: parent === current ? current : basename(current), path: current, hidden: false })
    if (parent === current) return crumbs
    current = parent
  }
}

/**
 * List one directory level over the host filesystem (directories + symlinks
 * to directories, name-sorted, bounded at 1000 rows with `truncated`).
 * Local patch (2026-08-23): host.listDirectory is gated on the composed
 * directory-picker capability, which resolves to `native` on Windows loopback
 * binds — the mobile workspace browser (#977) therefore failed there. This
 * plugin-side listing replicates the browse backend's shape and works on
 * every platform.
 *
 * Windows drive switching: at a drive root (e.g. `C:\`) the listing prepends a
 * "此电脑" crumb; clicking it lists the available drives (A:-Z:), and clicking
 * a drive enters that drive's root. The upstream browse backend has no drive
 * picker, so only the starting drive was reachable.
 */

/** Sentinel path for the "This PC" drive picker (never a real filesystem path). */
const THIS_PC = 'this-pc'

/** Windows drive letters that exist (A:-Z:), rendered as the This-PC drive picker. */
async function windowsDrives(): Promise<MobileDirectoryEntry[]> {
  const drives: MobileDirectoryEntry[] = []
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code)
    const root = `${letter}:\\`
    try {
      await stat(root)
      drives.push({ name: root, path: root, hidden: false })
    } catch {
      // drive absent
    }
  }
  return drives
}

/** True when the resolved path is a Windows drive root (e.g. `C:\`). */
function isWindowsDriveRoot(target: string): boolean {
  return /^[A-Za-z]:[\\/]$/.test(target)
}

async function mobileListDirectory(path: string | undefined): Promise<MobileDirectoryListing> {
  const home = homedir()
  // This-PC drive picker (Windows): list available drives instead of a level.
  if (path === THIS_PC) {
    return {
      path: THIS_PC,
      home,
      crumbs: [{ name: '此电脑', path: THIS_PC, hidden: false }],
      entries: await windowsDrives(),
      truncated: false,
    }
  }
  const target = resolve(path ?? home)
  const maxEntries = 1000
  const keep = maxEntries + 1
  const collected: Array<{ name: string; isDirectory: boolean; isSymbolicLink: boolean }> = []
  let evicted = false
  try {
    const dir = await opendir(target)
    try {
      for (;;) {
        const dirent = await dir.read()
        if (dirent === null) break
        if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue
        collected.push({ name: dirent.name, isDirectory: dirent.isDirectory(), isSymbolicLink: dirent.isSymbolicLink() })
      }
    } finally {
      await dir.close()
    }
  } catch (error: unknown) {
    throw new Error(`cannot list ${target}: ${error instanceof Error ? error.message : String(error)}`)
  }
  // One sort instead of the previous per-insert binary splice (O(n^2) on big
  // directories); the window keeps the first `keep` rows by name.
  collected.sort((left, right) => left.name.localeCompare(right.name))
  const window = collected.length > keep ? collected.slice(0, keep) : collected
  evicted = collected.length > keep
  const entries: MobileDirectoryEntry[] = []
  let truncated = evicted
  for (const candidate of window) {
    const entryPath = join(target, candidate.name)
    let enterable = candidate.isDirectory
    if (!enterable && candidate.isSymbolicLink) {
      try {
        enterable = (await stat(entryPath)).isDirectory()
      } catch {
        continue // broken/cyclic symlink: not enterable
      }
    }
    if (!enterable) continue
    if (entries.length === maxEntries) {
      truncated = true
      break
    }
    entries.push({ name: candidate.name, path: entryPath, hidden: candidate.name.startsWith('.') })
  }
  const crumbs = mobileAncestryCrumbs(target)
  // Windows: at a drive root, prepend a "此电脑" crumb so the user can switch drives.
  if (isWindowsDriveRoot(target)) {
    crumbs.unshift({ name: '此电脑', path: THIS_PC, hidden: false })
  }
  return { path: target, home, crumbs, entries, truncated }
}

/** One session.list page (thin phones load incrementally). */
const SESSION_PAGE_SIZE = 40
/** Concurrent SSE mux subscriptions allowed per server (reconnect-tolerant). */
const MAX_SSE_SUBSCRIBERS = 8

/** session.list sort cache: content key -> sorted row array (see dispatch). */
let sessionListSortedCache: { key: string; items: Array<{ updatedAt: number; sessionId: string }> } | undefined
/** SSE keep-alive ping cadence for the live mux stream (single connection). */
const DEFAULT_EVENTS_HEARTBEAT_MS = 15_000

/** Encode one list position as an opaque continuation cursor. */
function sessionListCursor(updatedAt: number, sessionId: string): string {
  return `${updatedAt}:${sessionId}`
}

/** Parse a cursor; malformed cursors mean "start over" (safe failure mode). */
function parseSessionListCursor(cursor: string): { updatedAt: number; sessionId: string } | undefined {
  const separator = cursor.indexOf(':')
  if (separator < 0) return undefined
  const updatedAt = Number(cursor.slice(0, separator))
  if (!Number.isFinite(updatedAt)) return undefined
  return { updatedAt, sessionId: cursor.slice(separator + 1) }
}

/** Whether a row comes strictly after the cursor position. */
function afterCursor(row: { updatedAt: number; sessionId: string }, position: { updatedAt: number; sessionId: string }): boolean {
  return row.updatedAt < position.updatedAt
    || (row.updatedAt === position.updatedAt && row.sessionId > position.sessionId)
}

/**
 * Rows the phone surface may show, in host order: main-agent sessions
 * (origin not 'subagent') that were not archived with
 * `workspace.deleteSession` / `workspace.archiveSession`. The host archive
 * set (from `workspace.list`) hides removed sessions on the desktop, but the
 * host `session.list` still returns attached ones from its live registry —
 * without this filter a session deleted on the desktop reappears on the
 * phone roster (and in pagination, since the page slices come from this
 * filtered array).
 */
export function visibleSessionRows(
  rawItems: ReadonlyArray<{ updatedAt: number; sessionId: string; origin?: 'subagent' }>,
  archivedSessionIds: ReadonlySet<string>,
): Array<{ updatedAt: number; sessionId: string }> {
  return rawItems.filter(item => item.origin !== 'subagent' && !archivedSessionIds.has(String(item.sessionId)))
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
  /** SSE keep-alive ping cadence for the mux stream (default 15000 ms; test seam). */
  eventsHeartbeatMs?: number
}

/**
 * Minimal command-registry surface the mobile directory needs. The host
 * `CommandRuntime.list(agent)` resolves the effective view for one agent;
 * passing `undefined` yields the global (plain-context) registrations, which
 * is exactly the directory a phone should see.
 */
export interface CommandRegistry {
  list(agent: unknown): readonly { name: string; description: string; input?: { hint?: string } }[]
  /**
   * Execute one `/`-line against an agent's scoped view (`undefined` result:
   * syntax or name did not resolve — the caller decides the fallthrough).
   * The host durably logs `command/run` + `command/done`; the settled result
   * never reaches the model.
   */
  execute(
    agent: unknown,
    line: string,
    images: readonly never[],
    signal: AbortSignal,
  ): Promise<{ commandId: string; result: { kind: string; text?: string } } | undefined>
}

/** Minimal live-agent lookup (`ctx.agents.get(sessionId)`). */
export interface AgentLookup {
  get(sessionId: string): unknown
}

/** Mobile API route paths. */
export const MOBILE_API_PATHS = {
  events: '/m/api/events.mux',
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
export function makeMobileApiRoutes(deps: MobileApiDeps): WebRoute[] {
  const { service, apiProxy, mobileEnterToSend } = deps
  const eventsHeartbeatMs = deps.eventsHeartbeatMs ?? DEFAULT_EVENTS_HEARTBEAT_MS

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
      || method === MOBILE_COMMANDS_METHOD
      || method === MOBILE_COMMAND_EXEC_METHOD
      || method === MOBILE_VOICE_SERVICES_METHOD
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
      // everything else stays at the small JSON budget.
      envelope = await readBoundedJson(req, isTranscribe ? 12 * 1024 * 1024 : isPrompt ? 2 * 1024 * 1024 : 64 * 1024)
    } catch (error) {
      if (error instanceof Error && error.message === 'body too large') {
        // Drain whatever the client still has in flight so the keep-alive
        // connection is released (the strict reader stops mid-stream on
        // overflow; an undrained body would misalign the next request).
        req.resume()
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
    if (local) {
      if (method === MOBILE_PREFERENCES_METHOD) {
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
        const payload = parsed.payload as { path?: unknown } | undefined
        try {
          const listing = await mobileListDirectory(typeof payload?.path === 'string' ? payload.path : undefined)
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
      } else if (method === MOBILE_COMMANDS_METHOD) {
        // The host command registry is a plugin service, not an ApiProxy
        // domain: answer locally. `list(undefined)` resolves the global
        // (plain-context) registrations — the directory a phone should see.
        const registry = deps.commands
        const items = registry === undefined
          ? []
          : registry.list(undefined).map(command => ({
            name: command.name,
            description: command.description,
            ...(command.input !== undefined ? { input: command.input } : {}),
          }))
        // /compact registers in the agent context, so the plain-context
        // listing misses it; the phone surfaces it explicitly. Execution does
        // NOT ride session.prompt (the host prompt channel never dispatches
        // commands) — the composer calls mobile.commandExec for the line.
        if (!items.some(command => command.name === 'compact')) {
          items.unshift({ name: 'compact', description: '压缩会话上下文：生成摘要并截断历史' })
        }
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

  /** Bridge the host mux stream over SSE: one `data:` frame per mux frame. */
  const handleEvents = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
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
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
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
    const endStream = (): void => {
      if (closed) return
      closed = true
      controller.abort()
      clearInterval(heartbeat)
      activeEvents -= 1
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
        res.write(': ping\n\n')
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
    }
    res.on('close', onClose)
    req.on('close', onClose)
    try {
      const frames = apiProxy.events.mux({ rpcId: RpcId(`mobile-mux-${Date.now().toString(36)}`), payload: {} }, controller.signal)
      for await (const frame of frames) {
        if (closed) break
        // Revocation takes effect on the next frame, not the next reconnect.
        if (!deviceStillPaired()) {
          endStream()
          break
        }
        deps.pendingTracker.onFrame(frame as any)
        // The host mux stream yields bare { rpcId, payload } frames; the mobile
        // client validates the full server-request envelope ({ type, rpcId,
        // method, payload }) and silently drops anything else — unwrapped
        // frames made the phone believe SSE was dead and fall back to polling
        // (3s cadence, the "visible lag" vs desktop). Wrap every frame so the
        // live stream actually reaches the client.
        const wire = { type: 'server-request' as const, rpcId: frame.rpcId, method: 'events.mux', payload: frame.payload }
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

  return [
    { kind: 'prefix', path: MOBILE_API_PREFIX, handler: handleMethod },
    { kind: 'exact', path: MOBILE_API_PATHS.events, handler: handleEvents },
  ]
}

/** Dispatch one allowlisted method through the host ApiProxy. */
async function dispatch(apiProxy: ApiProxy, method: string, payload: unknown, rpcId: string, signal?: AbortSignal): Promise<unknown> {
  const request: RpcRequest<unknown> = { rpcId: RpcId(rpcId), payload }
  if (method === 'session.list') {
    const [full, wsList] = await Promise.all([
      apiProxy.sessions.list(request as never),
      // The archive set (workspace.deleteSession/archiveSession) rides
      // workspace.list; a failure degrades to "no archive filter" instead of
      // failing the roster.
      apiProxy.workspace.list(request as never).catch(() => undefined),
    ])
    // The error path must carry the same 'server-response' envelope the
    // success path builds, or the phone's callUnary throws a transport error
    // and masks the real business error.
    if (!full.result.ok) return { type: 'server-response' as const, rpcId, result: full.result }
    const archivedIds = new Set(
      wsList?.result.ok === true
        ? (wsList.result.value.archivedSessionIds ?? []).map(id => String(id))
        : [],
    )
    const rawItems = full.result.value.items as Array<{ updatedAt: number; sessionId: string; origin?: 'subagent' }>
    const cursor = (payload as { cursor?: string } | undefined)?.cursor
    // The phone's session picker shows main-agent sessions only: subagent
    // sessions (origin: 'subagent') are internal working sessions that would
    // clutter the roster and cost transfer bytes — and sessions archived on
    // the desktop (deleted/archived) never reappear. Filter before the sort
    // cache so paging never surfaces them.
    const mainItems = visibleSessionRows(rawItems, archivedIds)
    // Every call pages (the first call with no cursor IS the first page):
    // the phone must never transfer the whole session list at once.
    // One stable page over (updatedAt desc, sessionId asc); pages never skip
    // or repeat a row while the list changes between calls. The sort is
    // cached by a content key: paging through an unchanged list never
    // re-sorts, and any host-side change invalidates the cache immediately.
    const contentKey = mainItems.map(item => `${item.sessionId}:${item.updatedAt}`).join(',')
    let items = mainItems
    if (sessionListSortedCache?.key !== contentKey) {
      mainItems.sort((a, b) => b.updatedAt - a.updatedAt
        || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
      sessionListSortedCache = { key: contentKey, items: mainItems }
      items = mainItems
    } else {
      items = sessionListSortedCache.items
    }
    const position = cursor === undefined ? undefined : parseSessionListCursor(cursor)
    const from = position === undefined ? 0 : items.findIndex(row => afterCursor(row, position))
    const start = from < 0 ? items.length : from
    const page = items.slice(start, start + SESSION_PAGE_SIZE)
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
  if (method === 'workspace.list') return wrap(await apiProxy.workspace.list(request as never))
  if (method === 'workspace.create') return wrap(await apiProxy.workspace.create(request as never))
  if (method === 'workspace.rename') return wrap(await apiProxy.workspace.rename(request as never))
  if (method === 'workspace.delete') return wrap(await apiProxy.workspace.delete(request as never))
  if (method === 'agentPreset.list') return wrap(await apiProxy.agentPresets.list(request as never))
  if (method === 'session.create') return wrap(await apiProxy.sessions.create(request as never))
  if (method === 'session.history') return wrap(await apiProxy.sessions.history(request as never))
  if (method === 'session.search') return wrap(await apiProxy.sessions.search(request as never, signal ?? new AbortController().signal))
  if (method === 'session.prompt') return wrap(await apiProxy.sessions.prompt(request as never))
  if (method === 'session.models') return wrap(await apiProxy.sessions.models(request as never))
  if (method === 'session.selectModel') return wrap(await apiProxy.sessions.selectModel(request as never))
  if (method === 'session.rename') return wrap(await apiProxy.sessions.rename(request as never))
  if (method === 'session.cancel') return wrap(await apiProxy.sessions.cancel(request as never))
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
