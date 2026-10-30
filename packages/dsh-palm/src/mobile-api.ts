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
import type { ApiProxy, MuxFrame, RpcRequest, SubagentCatalog } from './api-proxy-types'
import { RpcId } from './api-proxy-types'
import { mergeRunningBaseline, staleRunningEvidence } from './running-baseline.ts'
import type { ApiProxyAdapter } from './api-proxy-adapter.ts'
import type { PendingTracker } from './mobile-pending.ts'
import type { PairingService } from './pairing.ts'
import type { NotifyService } from './notify/notify-engine.ts'
import type { NotifyEvent } from './notify/notify-engine.ts'
import { deliverL2 } from './notify/notify-deliver.ts'
import { asJsonObject, readBoundedJson, writeJson } from './http.ts'
import { readCookie } from './gate.ts'
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
const queueRevisions = new Map<string, number>()

function queueRevisionOf(sessionId: string): number {
  return queueRevisions.get(sessionId) ?? 0
}

function bumpQueueRevision(sessionId: string): void {
  queueRevisions.set(sessionId, queueRevisionOf(sessionId) + 1)
}

/**
 * 队列**内容指纹**：任何来源的改动都会让它变。
 *
 * `queueRevision` 只有手机端自己的写操作会 +1 —— 桌面端排一条消息时它不变，而手机端
 * 按「版本没变 = 队列没变」处理，于是**桌面排的消息手机永远看不到**（2026-10-30 真机，
 * 已用「另一客户端入队 + 手机采样」复现：宿主 queue=1，手机 25 秒无排队条）。
 *
 * 这里再给一个从队列内容算出来的指纹（id + 正文长度），手机端用它判"权威队列变了没"：
 * 谁改的都算。两个数各司其职：
 *   - `queueRevision`：只回答「我那次写操作落地了吗」（乐观项退场用）；
 *   - `queueToken`：只回答「权威队列本身变了没」（任何客户端）。
 */
function queueTokenOf(items: readonly { id: string; text: string }[]): string {
  return items.map(item => `${item.id}:${item.text.length}`).join('|')
}

/**
 * 队列投影读取（`mobile.inbox` 与 `mobile.sessionState` 共用）。
 *
 * 花名册快照是几分钟前枚举的：删除/编辑之后还拿它就会把已经删掉的行又画回来，看起来
 * 就像"删不掉"。所以改完队列的那一次（客户端带 fresh）现开一帧 follow 取当下投影；
 * 平时（回合跑着时每几秒一问）只读快照 —— 每次都读一页 history 会跟同会话的聊天读
 * 抢宿主，弱网下卡片反而更慢。
 */
/**
 * 从**活的 agent** 上直读待发队列（权威来源）。
 *
 * DSH 0.2.x 的权威数据在 `ctx.agents.get(sessionId).inbox`：
 *   - `nextTurn`: 等下一轮开跑的排队消息
 *   - `nextStep`: 已经插进**正在跑的这一轮**、等下一步边界消费的消息
 * 宿主自己处理队列命令时读的就是它（见 @deepseek-ai/dsh-session-controller 的
 * `agent.inbox.nextTurn.find(...)`）。
 *
 * 为什么不能只读投影快照：`inbox` 投影是从**持久 splice** 重建的，而花名册那份快照
 * 只在枚举会话时刷新 —— 消息被认领成这一轮的用户消息之后，快照里那条还会挂一阵子。
 * 实测（2026-10-30）：对话里已经出现该用户气泡，`mobile.sessionState` 仍回 `queue=1`，
 * 于是手机端排队条一直挂着。
 *
 * 活的 agent 上读到的就是当下真值：认领那一刻它就没了。形状按 `queueItemsOf` 吃过的
 * `{ 'next-turn': [...] }` 返回，调用方不需要分支。
 */
export function liveInboxOf(agents: AgentLookup | undefined, sessionId: string): { 'next-turn': readonly unknown[] } | undefined {
  if (agents === undefined) return undefined
  let agent: unknown
  try {
    agent = agents.get(sessionId)
  } catch {
    return undefined
  }
  if (agent === null || agent === undefined || typeof agent !== 'object') return undefined
  const inbox = (agent as { inbox?: unknown }).inbox
  if (inbox === null || inbox === undefined || typeof inbox !== 'object') return undefined
  const source = inbox as { nextTurn?: unknown; 'next-turn'?: unknown }
  const nextTurn = source.nextTurn ?? source['next-turn']
  if (!Array.isArray(nextTurn)) return undefined
  // 只报 nextTurn：nextStep 是「已经插进这一轮」的输入，界面上它已经是对话的一部分，
  // 再列进排队条就是重复（正是「消息发完了排队条还在」的另一种形态）。
  return { 'next-turn': nextTurn as readonly unknown[] }
}

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

/**
 * inbox 投影 → 手机侧队列行。
 *
 * 两种线上形状都要吃：
 *  ①`session/queue` 帧（桌面插件时代）：`{ id, placement, message: { content } }`；
 *  ②inbox 投影（宿主 0.2.x）：`next-turn` 里就是**裸的 UserMessage**，`content` 在行上，
 *    没有 `message` 这一层。
 *
 * 只认 ① 的时候，投影过来的每一条正文都是空的 —— 手机上就是「2 条排队」加两行空白
 * （真机截图）。所以这里先看行上的 `content`，再退回 `message.content`。
 */
export function queueItemsOf(inbox: unknown): Array<{ id: string; placement: 'queued' | 'steering' | 'context'; text: string; editable: boolean; receipts?: string[]; keepParts?: unknown[] }> {
  const rows = (inbox as { 'next-turn'?: unknown } | null | undefined)?.['next-turn']
  if (!Array.isArray(rows)) return []
  const items: Array<{ id: string; placement: 'queued' | 'steering' | 'context'; text: string; editable: boolean }> = []
  rows.forEach((row, index) => {
    const record = (row ?? {}) as {
      id?: unknown
      placement?: unknown
      content?: unknown
      text?: unknown
      message?: { content?: unknown; text?: unknown }
    }
    const blocks = record.content ?? record.message?.content
    const rawText = record.text ?? record.message?.text
    const receipts: string[] = []
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        const part = block as { type?: unknown; receiptId?: unknown }
        if (part.type === 'file' && typeof part.receiptId === 'string' && part.receiptId !== '') receipts.push(part.receiptId)
      }
    }
    const text = typeof rawText === 'string' && rawText !== '' ? rawText.trim() : textOfInboxContent(blocks)
    // 能不能就地编辑：正文必须可改，附件/图片这些**原样保留**（收据和 attachmentId
    // 都还在宿主手里，拼回去不用重传字节）。只有认不出的块类型才判为不可编辑。
    const keepParts: unknown[] = []
    let hasUnknownPart = false
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        const type = (block as { type?: unknown }).type
        if (type === 'text') continue
        if (type === 'file' || type === 'image') { keepParts.push(block); continue }
        hasUnknownPart = true
      }
    }
    const editable = Array.isArray(blocks)
      ? blocks.length > 0 && !hasUnknownPart
      : text !== ''
    items.push({
      id: typeof record.id === 'string' ? record.id : String(index),
      placement: record.placement === 'steering' ? 'steering' : record.placement === 'context' ? 'context' : 'queued',
      text,
      editable,
      // 文件附件只带收据（给界面显示用）；`keepParts` 是编辑时要拼回去的原样块。
      ...(receipts.length === 0 ? {} : { receipts }),
      ...(keepParts.length === 0 ? {} : { keepParts }),
    })
  })
  return items
}

/**
 * 队列项正文（够卡片显示一行）。
 *
 * 非文本块也要出一段占位：只排队了一张图片时，正文是空的 —— 界面上就是「2 条排队」
 * 加两行空白（真机截图）。给个 `[图片]` 至少能看出这条是什么。
 */
function textOfInboxContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const type = (block as { type?: unknown }).type
    if (type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string' && text.trim() !== '') parts.push(text.trim())
      continue
    }
    if (typeof type === 'string' && type !== '') {
      parts.push(type === 'image' ? '[图片]' : type === 'file' ? '[附件]' : `[${type}]`)
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
/**
 * 目标条读取：把会话的 goal 投影原样交给手机端（{ current } 由客户端解析）。
 * 队列那条路（mobile.inbox）已经证明同一个快照里能拿到投影，这里复用同一条：
 * 平时读快照，只有刚点过动作（fresh）时才现开一帧 follow 取当下值。
 */
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
/** 账本最多留多少条（够放一两天的工作，按会话去重）。 */
const FINISHED_RUNS_MAX = 60
/**
 * 一条账本存活多久。
 *
 * 真机口径（2026-10-29）：运行中页的「刚结束」应该是**我没点进去看过**的那些会话，
 * 而不是「最近半小时结束的」。所以存活期给到 7 天，真正的剔除靠「打开过就删」。
 */
const FINISHED_RUNS_TTL_MS = 7 * 24 * 60 * 60_000
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

/** One directory row the mobile browser can enter (directories + symlinks to dirs). */
interface MobileDirectoryEntry {
  name: string
  path: string
  hidden: boolean
  /** 带上文件一起列时才有：区分目录与文件（目录浏览老调用方不看这两个字段）。 */
  kind?: 'dir' | 'file'
  /** 文件的字节数（只有 kind === 'file' 时有）。 */
  bytes?: number
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

/** Upper bound for one file-preview read (256 KiB: code/text files preview; huge logs refuse). */
const MOBILE_READ_FILE_MAX_BYTES = 256 * 1024

/** Upper bound for one image-preview read (8 MiB: photo/screenshot preview). */
const MOBILE_READ_IMAGE_MAX_BYTES = 8 * 1024 * 1024

/** File extension → image media type (for base64 data URLs in previews). */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
}

/** True when a path names a raster/vector image we can preview as data URL. */
function isImagePath(value: string): boolean {
  const base = value.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  return IMAGE_MIME[ext] !== undefined
}

/** True for an absolute path on Windows (`C:\…` / `C:/…`) or POSIX (`/…`). */
function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\')
}

/**
 * Candidate absolute targets for one file-preview path. An absolute path
 * resolves as-is. A relative path (the form agents usually write) is tried
 * against every plausible base — the owning session's cwd first (the agent
 * worked there), then the host process cwd, then every workspace path, then
 * directories recovered from ABSOLUTE file paths that already appear in the
 * session's chat window (an agent that writes `packages/…/mux.ts` relative
 * to the checkout it edits has almost always also printed the same file as
 * `C:\…\dsh-source\dsh-palm\packages\…` somewhere in the same conversation).
 * The caller stats each candidate and uses the first that exists.
 */
async function readCandidates(
  apiProxy: ApiProxy,
  raw: string,
  sessionId: string | undefined,
  chatWindows: ChatWindowService | undefined,
): Promise<string[]> {
  if (isAbsolutePath(raw)) return [resolve(raw)]
  const bases: string[] = []
  /** Exact absolute targets recovered from the chat window (already full paths). */
  const candidatesRaw: string[] = []
  if (sessionId !== undefined) {
    try {
      const response = await apiProxy.sessions.list({ rpcId: RpcId('dsh-palm-readfile'), payload: {} } as never)
      const items = (response as { result?: { ok?: boolean; value?: { items?: Array<{ sessionId: string; cwd?: string }> } } }).result?.value?.items ?? []
      const cwd = items.find(item => item.sessionId === sessionId)?.cwd
      if (typeof cwd === 'string' && cwd !== '') bases.push(cwd)
    } catch {
      // session lookup failed: fall through to the remaining bases
    }
  }
  try {
    bases.push(process.cwd())
    const response = await apiProxy.workspace.list({ rpcId: RpcId('dsh-palm-readfile-ws'), payload: {} } as never)
    const wsItems = (response as { result?: { ok?: boolean; value?: { items?: Array<{ path?: string }> } } }).result?.value?.items ?? []
    for (const item of wsItems) {
      if (typeof item.path === 'string' && item.path !== '') bases.push(item.path)
    }
  } catch {
    // workspace enumeration failed: process.cwd() is already in the list
  }
  // Directories that already contain this path as an absolute mention in the
  // same conversation are the most precise base for an agent-relative path.
  if (sessionId !== undefined && chatWindows !== undefined) {
    try {
      const page = await chatWindows.tail(sessionId, READ_CHAT_MAX_ROWS)
      const absPaths = new Set<string>()
      for (const row of page.rows) {
        const text = row.text ?? ''
        // Match absolute Windows/POSIX paths inside the row text.
        for (const match of text.matchAll(/(?:[A-Za-z]:[\\/]|\/)[^\s`"'<>|]+/g)) {
          const token = match[0].trimEnd()
          // Keep tokens that look like file paths (a separator and a
          // dot-extension); strip trailing punctuation that the regex may
          // have swallowed is handled by trimEnd above (paths rarely end in
          // CJK punctuation, so a `.`/`,` boundary is not stripped here).
          if (/[\\/]/.test(token) && /\.[A-Za-z0-9]{1,8}$/.test(token)) absPaths.add(token)
        }
      }
      const rawNorm = raw.replaceAll('\\', '/')
      // 1) An absolute path that ENDS with the raw relative path is the exact
      //    target (agent printed it; resolve straight to it).
      for (const abs of absPaths) {
        if (abs.replaceAll('\\', '/').endsWith(rawNorm)) candidatesRaw.push(abs)
      }
      // 2) Otherwise offer each absolute path's directory as a base.
      for (const abs of absPaths) {
        const dir = dirname(abs)
        if (dir !== abs && dir !== '.') bases.push(dir)
      }
    } catch {
      // window unavailable: rely on the bases already collected
    }
  }
  const seen = new Set<string>()
  const candidates: string[] = []
  // Exact absolute paths recovered from the window come first (they are the
  // very file the agent meant when it printed the relative form).
  for (const exact of candidatesRaw) {
    if (exact === '') continue
    const target = resolve(exact)
    if (seen.has(target)) continue
    seen.add(target)
    candidates.push(target)
  }
  for (const base of bases) {
    if (base === '') continue
    const target = resolve(base, raw)
    if (seen.has(target)) continue
    seen.add(target)
    candidates.push(target)
  }
  return candidates
}

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

async function mobileListDirectory(path: string | undefined, files = false): Promise<MobileDirectoryListing> {
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
        if (!dirent.isDirectory() && !dirent.isSymbolicLink() && !files) continue
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
    if (!enterable) {
      // 文件行：只有调用方要文件（files=true）时才会走到这里，带上字节数给手机显示。
      if (!files) continue
      let bytes: number | undefined
      try {
        bytes = (await stat(entryPath)).size
      } catch {
        continue // 读不到大小的（权限/竞态删掉）就别列了
      }
      if (entries.length === maxEntries) {
        truncated = true
        break
      }
      entries.push({ name: candidate.name, path: entryPath, hidden: candidate.name.startsWith('.'), kind: 'file', bytes })
      continue
    }
    if (entries.length === maxEntries) {
      truncated = true
      break
    }
    entries.push({ name: candidate.name, path: entryPath, hidden: candidate.name.startsWith('.'), kind: 'dir' })
  }
  const crumbs = mobileAncestryCrumbs(target)
  // Windows: at a drive root, prepend a "此电脑" crumb so the user can switch drives.
  if (isWindowsDriveRoot(target)) {
    crumbs.unshift({ name: '此电脑', path: THIS_PC, hidden: false })
  }
  return { path: target, home, crumbs, entries, truncated }
}

/** Short-lived cache: the phone's settings page must not hammer provider APIs. */
let usageCache: { at: number; view: UsageView } | undefined
const USAGE_CACHE_TTL_MS = 60_000

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

/**
 * 列表行在手机端真正被读取的字段：`mobile/views/App.tsx` 的 `toSessionView` 取
 * sessionId / updatedAt / running / blank / cwd 与 `projections.values` 里的
 * title、preview、sessionStats，`RunOverviewView` 只再要 title / running / blank。
 *
 * 宿主返回的每一行都带着全部投影：实测一页 40 行 248~384 KB，其中 99% 是别的投影
 * （单行 `turnOutline` 最大 53 KB / 279 轮）。这些字节在 4G 上要走 1~2 秒、还要被
 * 手机解析和 JSON 序列化一次，然后丢掉。这里在发车前沿白名单裁掉。
 */
const SESSION_LIST_KEPT_PROJECTIONS = ['title', 'preview', 'sessionStats'] as const

/** Strip a host roster row down to the fields the phone surface actually reads. */
export function trimSessionListRow<T extends { updatedAt: number; sessionId: string }>(row: T): T {
  const projections = (row as { projections?: { values?: Record<string, unknown> } }).projections
  const values = projections?.values
  // 没有投影：这行本来就小（只剩 id/时间/状态），原样发。
  if (projections === undefined || values === undefined) return row
  const kept: Record<string, unknown> = {}
  let keptCount = 0
  for (const key of SESSION_LIST_KEPT_PROJECTIONS) {
    const value = values[key]
    if (value !== undefined) {
      kept[key] = value
      keptCount += 1
    }
  }
  // 三个白名单键都没有：整块投影都没用，连外壳一起省掉（比留着空对象再小一点）。
  if (keptCount === 0) {
    const { projections: _dropped, ...rest } = row as T & { projections?: unknown }
    return rest as T
  }
  return { ...row, projections: { ...projections, values: kept } }
}

/**
 * 会话归属：workspaceId → 该工作区拥有的 sessionId 集合。与 sessionListTtlCache 在
 * 同一次 workspace.list 枚举里一起刷新，因此续页复用旧快照时依然能按工作区过滤。
 */
let sessionListOwnedCache: Map<string, Set<string>> | undefined
/** 落盘花名册快照的文件名（位置由插件的 perfDir 决定，源码里不出现任何本机路径）。 */
let sessionRosterCacheFile: string | undefined
/** 「刚结束」账本的落盘文件（位置同样由 perfDir 决定，源码里不出现本机路径）。 */
let finishedRunsFile: string | undefined
/** 落盘快照只回读一次；读不到就走全量枚举。 */
let sessionRosterHydrated = false
/** 两次后台刷新之间的最小间隔：枚举要 6~30 秒，刷太勤会把宿主变成其他界面的瓶颈。 */
const SESSION_LIST_REFRESH_MIN_MS = 60_000
let sessionRosterLastRefreshAt = 0
/** 落盘快照的体积上限；超出即视为异常文件，不读。实测花名册快照约 2.3 MB（全局所有
 *  会话），所以这里必须留足余量 —— 上限设成 2 MB 时会被静默跳过、冷启动修复形同失效。 */
const ROSTER_SNAPSHOT_MAX_BYTES = 16_000_000

/**
 * One roster row: a host `session.list` item kept as-is. The snapshot persists
 * these rows and serves paged lists from them, so the item must keep every
 * field the phone renders — `projections.values` carries the title, the
 * preview line and the turn count, and dropping them turned every row into
 * "新会话" (2026-10-20). `blank` is the flag the phone filters on.
 */
export interface RosterItem {
  updatedAt: number
  sessionId: string
  origin?: 'subagent'
  blank?: boolean
  running?: boolean
  cwd?: string
  projections?: { values?: Record<string, unknown> }
  [field: string]: unknown
}

/**
 * Copy host session rows into roster rows. A shallow copy only: the snapshot
 * must round-trip everything the row renders (see {@link RosterItem}), and the
 * previous narrowing here is what erased the titles.
 */
export function toRosterItems(items: ReadonlyArray<RosterItem>): RosterItem[] {
  return items.map(item => ({ ...item }))
}

/**
 * 首帧前把落盘的花名册快照读回内存 —— 这是"跨 DSH 重启也不冷启动"的关键：重启后
 * 第一次 session.list 直接毫秒返回，新鲜度交给随后的后台刷新补。`at: 0` 是刻意的：
 * 让这次返回立刻触发一次后台刷新（标准 SWR）。
 */
function hydrateSessionRoster(apiProxy: ApiProxy): void {
  if (sessionRosterHydrated) return
  sessionRosterHydrated = true
  const file = sessionRosterCacheFile
  if (file === undefined) return
  try {
    if (statSync(file).size > ROSTER_SNAPSHOT_MAX_BYTES) return
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      rawItems?: RosterItem[]
      archivedIds?: string[]
      owned?: Array<[string, string[]]>
    }
    if (!Array.isArray(parsed.rawItems)) return
    sessionListTtlCache = {
      at: 0,
      proxy: apiProxy,
      rawItems: parsed.rawItems,
      archivedIds: new Set((parsed.archivedIds ?? []).map(String)),
    }
    sessionListOwnedCache = new Map(
      (parsed.owned ?? []).map(([id, ids]) => [String(id), new Set(ids.map(String))] as [string, Set<string>]),
    )
  } catch { /* 没有可用的落盘快照：走全量枚举 */ }
}


/** 账本里的一条（与客户端 `FinishedRun` 同形，宿主只存不解释）。 */
export interface FinishedRunEntry {
  sessionId: string
  title: string
  finishedAt: number
  status: 'done' | 'error' | 'stopped'
  durationMs?: number
  summary?: string
}

/** 读账本（文件不存在/坏文件都当空）。顺手按 TTL 与条数上限裁剪。 */
export function readFinishedRuns(file: string | undefined, now: number): FinishedRunEntry[] {
  if (file === undefined) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is FinishedRunEntry => {
      if (typeof entry !== 'object' || entry === null) return false
      const row = entry as Partial<FinishedRunEntry>
      return typeof row.sessionId === 'string'
        && typeof row.title === 'string'
        && typeof row.finishedAt === 'number'
        && (row.status === 'done' || row.status === 'error' || row.status === 'stopped')
        && now - row.finishedAt < FINISHED_RUNS_TTL_MS
    }).slice(0, FINISHED_RUNS_MAX)
  } catch {
    return []
  }
}

/**
 * 合并一次上报的账本条目，返回合并后的全量。
 *
 * 合并语义用**会话 + 收工时刻**做键：同一会话只保留最新一条（与客户端一致），
 * 不同客户端先后上报同一条也不会重复。
 */
export function mergeFinishedRuns(
  current: readonly FinishedRunEntry[],
  incoming: readonly FinishedRunEntry[],
  now: number,
): FinishedRunEntry[] {
  const bySession = new Map<string, FinishedRunEntry>()
  for (const entry of [...current, ...incoming]) {
    if (typeof entry.finishedAt !== 'number' || now - entry.finishedAt >= FINISHED_RUNS_TTL_MS) continue
    const previous = bySession.get(entry.sessionId)
    if (previous === undefined || entry.finishedAt >= previous.finishedAt) bySession.set(entry.sessionId, entry)
  }
  return [...bySession.values()].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, FINISHED_RUNS_MAX)
}

/** 写账本（失败静默：账本丢一条不能影响聊天）。 */
export function writeFinishedRuns(file: string | undefined, entries: readonly FinishedRunEntry[]): void {
  if (file === undefined) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(entries))
  } catch {
    // 磁盘满/只读：保持内存行为即可
  }
}

/** 把花名册快照落盘（失败静默）。DSH 重启后靠它免掉冷启动那一次 6~30 秒的全量枚举。 */
function persistSessionRoster(): void {
  const file = sessionRosterCacheFile
  const snapshot = sessionListTtlCache
  if (file === undefined || snapshot === undefined) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({
      at: snapshot.at,
      rawItems: snapshot.rawItems,
      archivedIds: [...snapshot.archivedIds],
      owned: [...(sessionListOwnedCache ?? new Map<string, Set<string>>())].map(([id, ids]) => [id, [...ids]]),
    }))
  } catch { /* 落盘失败不影响内存缓存 */ }
}
/** Short TTL for the host session-list enumeration (v3.1+; see dispatch).
 *  30s because the phone's list view re-renders cached rows immediately and
 *  re-validates in the background — the TTL only bounds the background
 *  refresh's host cost, and freshness is carried by the row-level update. */
const SESSION_LIST_TTL_MS = 30_000
/** The TTL cache: host rows + archive set, re-served within the window.
 *  Bound to the apiProxy instance so independent proxies (tests spin up one
 *  per server) never share a stale enumeration. */
let sessionListTtlCache: {
  at: number
  proxy: ApiProxy
  rawItems: RosterItem[]
  archivedIds: Set<string>
} | undefined
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
const RUNNING_SESSIONS_TTL_MS = 15_000
/** 查"谁在跑"时只看最近更新的这一批会话：运行中的会话每一帧都在写
 *  updatedAt，必然落在这一批里，而全量枚举几千条是几秒到几十秒的活——
 *  手机上这个请求常常等不到答复，"进行中"就永远退不掉。 */
const RUNNING_SESSIONS_SCAN_LIMIT = 200
/** Running-session cache (see dispatch). */
let mobileRunningCache: {
  at: number
  proxy: ApiProxy
  sessionIds: string[]
} | undefined

/* ── 「谁在跑」的服务端镜像 ──────────────────────────────────────────────
   手机每问一次就得让宿主把会话表枚举一遍，冷启动实测 24.7 秒——手机上这个
   请求根本等不到答复，于是"运行中"迟迟不出现、或者出现了不肯消失。

   这里在服务端留一份镜像：每一条转发给手机的 mux 帧都顺带把 session/status
   记下来，于是手机再问就是一次内存读（微秒级），而且桌面端一开跑，下一帧
   就把状态送进去了。只有进程启动后的第一次问才需要枚举一遍做基线。 */
const liveRunningSessionIds = new Set<string>()
/**
 * 宿主**明确说过「这条会话没在跑」**的集合（session/status 的 running:false）。
 *
 * 只有这种正面证据才允许按「日志静默」把一轮判成中断。以前用的是「运行集合里没有它」
 * —— 集合为空时同样「没有」，于是长回合（编译、跑测试静默几分钟）会被判成收工：
 * 手机上「输出中」时有时无、过程条秒表也跟着闪（真机反馈）。
 */
const liveNotRunningConfirmed = new Set<string>()
/** 基线是什么时候取到的；0 表示还没有取过。 */
let liveRunningSeededAt = 0

/**
 * Whether a session is working right now, from the same mirror the phone
 * reads. The notify engine uses it to drop "reply finished" pushes that only
 * mark an internal sub-turn: the session is demonstrably still running, so
 * nothing has been handed back to the user yet.
 */
export function isLiveSessionRunning(sessionId: string): boolean {
  return liveRunningSessionIds.has(sessionId)
}

/**
 * 宿主是否**明确**说过这条会话当前没在跑（收到过 status 帧的 running:false）。
 *
 * false 只代表「没收到过否定证据」，不代表「在跑」：判「这一轮死在半路」时必须要求
 * 这个正面证据，否则一次静默就被误判成收工（真机：输出中时有时无）。
 */
export function isLiveSessionNotRunningConfirmed(sessionId: string): boolean {
  return liveNotRunningConfirmed.has(sessionId)
}
/**
 * 基线的保底重取间隔：帧是实时的，但断流期间会漏，所以隔一阵子重对一次。
 *
 * 不能缩短：reseed 只认宿主的 `sessions.list(...).running`，而实测那个字段
 * 在正在跑的会话上也是 false（40 个会话全 false，含本机正在跑的这一轮）。
 * 也就是说基线恒为空、真正的运行集合全靠 `session/status` 帧喂；把间隔改小
 * 只会让 reseed 反复把这套集合清空，正在跑的会话反而被抹掉。
 */
const LIVE_RUNNING_RESEED_MS = 5 * 60_000
let liveRunningReseedInFlight = false
let liveRunningReseedPromise: Promise<void> | undefined

/**
 * 每一条「正在跑」最后一次有证据的时刻（帧或基线）。用来给「谁都没再提它」设一个上限，
 * 但绝不因为一次空基线就删 —— 上游的 running 字段实测恒 false，清一次就等于把
 * 正在跑的长回合判成「已中断」。
 */
const liveRunningEvidence = new Map<string, number>()

/** 记一次运行证据（帧或基线都算）。 */
function noteRunningEvidence(sessionId: string, at: number = Date.now()): void {
  liveRunningEvidence.set(sessionId, at)
}

/** 用宿主枚举出来的结果当基线：**只并集，不清空**（见 running-baseline.ts 的注释）。 */
function adoptRunningBaseline(sessionIds: string[]): void {
  const merged = mergeRunningBaseline(liveRunningSessionIds, sessionIds)
  liveRunningSessionIds.clear()
  for (const sessionId of merged) {
    liveRunningSessionIds.add(sessionId)
    noteRunningEvidence(sessionId)
  }
  liveRunningBaseline = new Set(sessionIds)
  liveRunningSeededAt = Date.now()
  pruneRunningEvidence()
}

/** 最近一次基线里出现过的会话（静默清理时要豁免它们）。 */
let liveRunningBaseline: ReadonlySet<string> = new Set()

/** 清掉「帧和基线都没再提到」的运行记录，给漏掉的 turn/end 兜底。 */
function pruneRunningEvidence(now: number = Date.now()): void {
  for (const sessionId of staleRunningEvidence(liveRunningEvidence, liveRunningBaseline, now)) {
    liveRunningEvidence.delete(sessionId)
    liveRunningSessionIds.delete(sessionId)
  }
}

/** 重取基线。同一时刻只有一次在飞，等待者共享同一个 promise——
 *  第一次问"谁在跑"的人会等这一份，而不是自己再枚举一遍。 */
function reseedRunning(): Promise<void> {
  if (liveRunningReseedPromise !== undefined) return liveRunningReseedPromise
  liveRunningReseedPromise = runReseed().finally(() => { liveRunningReseedPromise = undefined })
  return liveRunningReseedPromise
}

async function runReseed(): Promise<void> {
  if (liveRunningReseedInFlight) return
  liveRunningReseedInFlight = true
  try {
    const list = await apiProxyForRunning?.sessions.list({
      rpcId: RpcId('dsh-palm-running-reseed'),
      payload: { limit: RUNNING_SESSIONS_SCAN_LIMIT },
    } as never)
    const items = (list as { result?: { ok?: boolean; value?: { items?: Array<{
      sessionId: string
      origin?: 'subagent'
      running?: boolean
      blank?: boolean
    }> } } }).result?.value?.items ?? []
    adoptRunningBaseline(items
      .filter(item => item.origin !== 'subagent' && item.running === true && item.blank !== true)
      .map(item => String(item.sessionId)))
  } catch {
    // 失败就把上一次的基线留着：过期的答案比没有答案强。
  } finally {
    liveRunningReseedInFlight = false
  }
}

/**
 * 「这一轮还开着吗」的**唯一**来源：宿主自己在转发时看到的轮次边界。
 *
 * 以前这件事被四个地方各算一遍——上游会话表的 running 字段（实测全是 false，
 * 含正在跑的那一轮）、session/status 帧（只在有人跟着这条流时才推）、日志尾页
 * （只解 48 帧，长回合的边界被挤出窗口）、手机端的静默阈值（长命令一定会中招）。
 * 四个都不完整，拼出来的结论自然时对时错，而且手机每十秒重算一次，错了也不会自愈。
 *
 * 现在只有这里记账：宿主每转发一条 session/event，看到 turn/start、turn/end 就在
 * 这里落下一条记录（带 seq，用来和日志读出的边界比谁更新）。手机只读结论，不再推断。
 */
const turnBoundaryMirror = new Map<string, { running: boolean; startAt?: number; seq: number; at: number }>()

/**
 * 记一条发给手机的帧里的运行状态（status 帧）与轮次边界（event 帧）。
 *
 * @returns 遇到轮次边界时，这一轮的新状态 —— 调用方据此**主动**再推一条
 *   `session/status` 给手机。桌面端从不自己推断"这一轮还开着吗"，它读的就是宿主
 *   给的这个布尔值；手机端过去没有这条推送，只能每十秒问一次、靠日志边界比对来
 *   猜，边界被挤出折叠窗口时就猜成"已完成"。把结论在边界帧到的当下推过去，手机端
 *   就和桌面端同源了，核对也退化成兜底。
 */
export function noteRunningFrame(
  frame: { payload?: unknown },
): { sessionId: string; running: boolean } | undefined {
  const payload = frame.payload as { type?: string; sessionId?: unknown; running?: unknown; event?: unknown } | undefined
  const sessionId = payload?.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  if (payload?.type === 'session/status') {
    if (payload.running === true) {
      liveRunningSessionIds.add(sessionId)
      liveNotRunningConfirmed.delete(sessionId)
      noteRunningEvidence(sessionId)
    } else if (payload.running === false) {
      liveRunningSessionIds.delete(sessionId)
      liveRunningEvidence.delete(sessionId)
      liveNotRunningConfirmed.add(sessionId)
    }
    return undefined
  }
  if (payload?.type !== 'session/event') return undefined
  const event = payload.event as { type?: unknown; time?: unknown; seq?: unknown } | undefined
  const type = event?.type
  if (type !== 'turn/start' && type !== 'turn/end') return undefined
  const seq = typeof event?.seq === 'number' && Number.isFinite(event.seq) ? event.seq : -1
  const time = typeof event?.time === 'number' && Number.isFinite(event.time) ? event.time : undefined
  // 每条事件都是"这条会话还活着"的证据：长回合里命令一跑好几分钟，只有 turn/start
  // 和 status 帧喂证据的话，集合会在五分钟的静默上限里把它清掉，随后核对就答"没在跑"。
  noteRunningEvidence(sessionId)
  const running = type === 'turn/start'
  if (running) {
    liveRunningSessionIds.add(sessionId)
    liveNotRunningConfirmed.delete(sessionId)
  } else {
    liveRunningSessionIds.delete(sessionId)
  }
  turnBoundaryMirror.set(sessionId, {
    running,
    ...(running && time !== undefined ? { startAt: time } : {}),
    seq,
    at: Date.now(),
  })
  return { sessionId, running }
}

/**
 * 一条"边界开着、可人早就没了"的容差：日志最新事件停过这么久、宿主的运行集合里也没有它，
 * 就认定这一轮死在半路（turn/end 没写下来）。
 *
 *  为什么需要：宿主重启、进程被杀、断流都会让一轮不写 turn/end，那条 turn/start 边界
 *  会永远开着，于是 `computeTurnState` 一直答"还在跑"，手机上就是"会话早就跑完了，
 *  却突然又冒出一行输出中"。本机实测两条：一条最新事件停在 8.3 小时前，一条停在 65 天前。
 *
 *  为什么是 3 分钟：判据里的第二个条件是「宿主运行集合里没有它」——真正在跑的回合会被豁免，
 *  所以这里只需要覆盖「重启/被杀之后日志再也不动」的情形。30 分钟意味着手机上要盯着一个
 *  早就死掉的秒表半小时，然后还显示「已完成」，两头都错。3 分钟足够长（超大编译仍在运行集合
 *  里），又能在用户回到 app 时给出「已中断」；判早了也不致命：下一个事件会把时间刷新，二十秒
 *  内重新亮起来。
 */
/** 把 apiProxy 的 RPC 信封拆成 value；形状不符时返回 undefined（extras 是纯增益，缺了走老路径）。 */
function unwrapProxyValue(reply: unknown): unknown {
  const result = (reply as { result?: { ok?: boolean; value?: unknown } } | null | undefined)?.result
  return result?.ok === true ? result.value : undefined
}

export const TURN_ABANDONED_MS = 3 * 60_000

/**
 * 本进程启动时刻。比它更早开始的回合不可能还活着 —— 宿主重启会杀掉所有回合，
 * 而那种情况下往往既没有 status 帧也没有 turn/end：这是「死在半路」最硬的证据。
 */
const HOST_STARTED_AT = Date.now() - Math.round(process.uptime() * 1000)

/** 把"边界开着 / 日志最新事件 / 宿主运行集合"三件事收成一个结论（纯函数，便于测试）。 */
export function turnVerdict(input: {
  boundaryOpen: boolean
  /** false＝根本没有边界可读（不是"读到 turn/end"）。默认按"已知"处理。 */
  boundaryKnown?: boolean
  lastEventAt?: number
  live: boolean
  /** 宿主明确说过它没在跑（status 帧 running:false）；未知时省略。 */
  liveConfirmedIdle?: boolean
  /** 这一轮开始得比当前宿主进程还早（宿主重启过 ⇒ 回合必然已经没了）。 */
  turnStartedBeforeHost?: boolean
  now: number
}): { running: boolean; abandoned: boolean } {
  if (!input.boundaryOpen) {
    // 「边界读不到」不等于「收工了」。一跑得久（几十步、几千帧）时 turn/start 会被挤出
    // 折叠窗口；宿主重启后帧镜像也是空的。真机表现就是命令还在跑、过程框却写着已完成，
    // 而且每十秒核对一次、次次都答"没在跑"。这种情况看另外两条证据：宿主运行集合里
    // 还有它，或者日志刚刚还在动（三分钟内）。读完是 turn/end 的（boundaryKnown 为真）
    // 仍然照旧判收工 —— 那是明确的边界，不能凭集合残留把死回合点亮。
    if (input.boundaryKnown === false) {
      const fresh = input.lastEventAt !== undefined && input.now - input.lastEventAt <= TURN_ABANDONED_MS
      return { running: input.live === true || fresh, abandoned: false }
    }
    return { running: false, abandoned: false }
  }
  // 「死在半路」必须同时满足三条：①边界开着；②宿主**明确**说过它没在跑
  // （liveConfirmedIdle，来自 status 帧的 running:false）；③日志静默超过阈值。
  //
  // 以前 ② 用的是「运行集合里没有它」—— 集合为空时同样成立，于是长回合里一次几分钟
  // 的静默（编译、跑测试、长命令）就把这一轮判成收工：手机上的「输出中」消失、秒表
  // 停住，下一条事件到了又出现（真机反馈：时有时无）。
  // 静默超过阈值只是「可疑」，还要一条**硬证据**才敢判死：
  //  ①这一轮开始得比宿主进程还早（宿主重启过，回合必然没了）；或
  //  ②宿主明确说过它没在跑（status 帧 running:false）。
  // 只凭「运行集合里没有它」就判死是错的：集合为空时也会命中，长回合里几分钟静默
  // （编译、跑测试）就被当成收工 —— 手机上的「输出中」时有时无、秒表跟着闪。
  const silent = input.lastEventAt !== undefined
    && input.now - input.lastEventAt > TURN_ABANDONED_MS
  const hardEvidence = input.turnStartedBeforeHost === true || input.liveConfirmedIdle === true
  const abandoned = input.live !== true && silent && hardEvidence
  return { running: !abandoned, abandoned }
}

/** 一轮的实时状态；帧镜像与日志边界按 seq 取较新者，都没有就说没在跑。 */
export async function computeTurnState(
  sessionId: string,
): Promise<{ running: boolean; turnStartAt?: number; lastEventAt?: number; asOf: number }> {
  // 日志是记录：它写下的边界谁也改不了；帧镜像只是"更快知道"，所以两者按 seq 比新。
  const boundary = await readTurnBoundary(sessionId)
  const mirror = turnBoundaryMirror.get(sessionId)
  const asOf = Date.now()
  const boundarySeq = boundary?.seq ?? -1
  const fromMirror = mirror !== undefined && mirror.seq >= boundarySeq
  const open = fromMirror ? mirror.running : boundary?.type === 'turn/start'
  const startAt = fromMirror ? mirror.startAt : boundary?.type === 'turn/start' ? boundary.time : undefined
  const verdict = turnVerdict({
    boundaryOpen: open === true,
    boundaryKnown: boundary !== undefined || mirror !== undefined,
    ...(boundary?.lastEventAt === undefined ? {} : { lastEventAt: boundary.lastEventAt }),
    live: isLiveSessionRunning(sessionId),
    liveConfirmedIdle: isLiveSessionNotRunningConfirmed(sessionId),
    turnStartedBeforeHost: startAt !== undefined && startAt < HOST_STARTED_AT,
    now: asOf,
  })
  return {
    running: verdict.running,
    ...(verdict.running && startAt !== undefined ? { turnStartAt: startAt } : {}),
    ...(boundary?.lastEventAt === undefined ? {} : { lastEventAt: boundary.lastEventAt }),
    asOf,
  }
}
/**
 * 子代理目录 + 运行态（手机上那张卡的呼吸点与已跑时长都靠它）。
 *
 * 宿主 0.2.x 的 `listChildren` 只回身份：谁被派出去、叫什么、能不能续聊。运行态得从
 * 子会话自己的日志边界看 —— 子会话和普通会话是同一套日志定位（按 sessionId 找文件），
 * 所以直接复用 `computeTurnState`，父会话怎么判断，子会话就怎么判断，口径一致。
 * 老宿主的 `remoteExportList` 本来带 activity，这里只补缺的那部分，不覆盖真值。
 */
async function subagentCatalogWithActivity(
  request: unknown,
  proxy: ApiProxy,
): Promise<{ rpcId: string; result: unknown }> {
  const envelope = await proxy.subagents.list(request as never) as { rpcId: string; result: unknown }
  const raw = unwrapProxyValue(envelope) as SubagentCatalog | undefined
  if (raw === undefined) return envelope
  const entries = await Promise.all((raw.entries ?? []).map(async entry => {
    if (entry.kind !== 'child') return entry
    let state: { running: boolean; turnStartAt?: number; lastEventAt?: number } | undefined
    try {
      state = await computeTurnState(String(entry.id))
    } catch {
      state = undefined
    }
    if (state === undefined) return entry
    return {
      ...entry,
      activity: state.running ? 'running' as const : 'inactive' as const,
      ...(state.turnStartAt === undefined ? {} : { turnStartAt: state.turnStartAt }),
      ...(state.lastEventAt === undefined ? {} : { lastEventAt: state.lastEventAt }),
    }
  }))
  return { ...envelope, result: { ok: true, value: { ...raw, entries } } }
}
/** reseedRunning 需要的那份代理，随每次请求刷新。 */
let apiProxyForRunning: ApiProxy | undefined/** workspace.list TTL cache (see dispatch). */
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
  sessionListTtlCache = undefined
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

/**
 * Strip fenced code blocks (```lang … ```) from a message body so a search
 * term inside a code fence does not match — code is not conversational text.
 */
function stripHiddenAssistantText(text: string): string {
  return stripToolBlocks(text)
    // Both closed and interrupted fences are non-conversational surfaces.
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    // Inline model thinking is rendered as a disclosure, not reply prose.
    // Treat an interrupted tag as hidden through the end as well.
    .replace(/<think(?:\s[^>]*)?>[\s\S]*?(?:<\/think>|$)/gi, '')
}

/**
 * The text a search may match for one folded message row: the user's sent
 * message and the assistant's reply BODY only. Reasoning (the thinking
 * chain), tool-call arguments/results, and fenced code blocks are excluded —
 * a search hit must be visible in the conversation, not buried in a tool
 * payload or a collapsed disclosure.
 */
/**
 * 行里"能搜到的正文"：readChat/logTail 的行有时把正文放在 flow（工具步骤流）里，
 * text 是空的（实测 25 行里 19 行如此），而索引侧同一段文字在 text 里。取并集才能
 * 让手机端按这段文本把命中落准行。
 */
function rowSearchableText(row: RenderMessage): string {
  const body = searchableText(row)
  const parts: string[] = []
  if (body !== '') parts.push(body)
  for (const part of row.flow ?? []) {
    if (part.kind === 'text' && part.text !== '') parts.push(part.text)
  }
  return parts.join('\n')
}
function searchableText(row: RenderMessage): string {
  if (row.kind === 'user') {
    return row.sourceKind === undefined || row.sourceKind === 'user' ? row.text : ''
  }
  if (row.kind === 'assistant') return stripHiddenAssistantText(row.text)
  return ''
}

/**
 * The NON-searchable text of one row (reasoning chain + tool-call arguments).
 * Used to tell a hit that matched only excluded content apart from a hit that
 * simply sits deeper than the bounded scan: the former is dropped, the latter
 * is kept best-effort so a correct session is not lost.
 */
function excludedText(row: RenderMessage): string {
  if (row.kind !== 'assistant') return ''
  const parts: string[] = []
  if (row.reasoning !== undefined && row.reasoning !== '') parts.push(row.reasoning)
  for (const tool of row.tools ?? []) {
    if (tool.arguments !== undefined && tool.arguments !== '') parts.push(tool.arguments)
  }
  return parts.join('\n')
}


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

interface SearchDocumentRow {
  seq: number
  messageId?: string
  partId?: string
  text: string
  folded: string
  user: boolean
}

interface SearchDocument {
  rows: SearchDocumentRow[]
  complete: boolean
}


/**
 * 索引口径的唯一真源（A）：一条消息**手机端最终显示的那段正文**，加上它在屏幕上
 * 的坐标（seq + partId）。
 *
 * 规则只有两条，和用户看到的一一对应：
 * - 用户发送内容 → 气泡正文（`.chat-msg-text`，`data-part-id="body"`）；
 * - 助手正文答案 → 答案段（`.chat-flow-answer[data-part-id="answer"]`），代码块、
 *   ` thinking`、工具块都剥掉；
 * - 其它（系统行、非用户来源、无答案的助手行）→ 不入库。
 *
 * 为什么要它单独成一个函数：索引端和渲染端各写一份判断，就是之前反复出问题的
 * 根源（搜得到、点进去没高亮 / 搜到推理链）。渲染端认的 part-id 就由这里给出。
 */
export function searchCorpusOf(row: RenderMessage): { seq: number; partId?: string; text: string } | undefined {
  if (row.kind === 'assistant') {
    // settled=true 是刻意的：索引要可复现，不能让「这一轮还在跑」改变入库内容。
    const model = processModel(row, undefined, true)
    const answer = model.answer === undefined ? '' : stripHiddenAssistantText(model.answer)
    if (answer.trim() === '') return undefined
    // 渲染端只在 answerSeq 存在时把它包进 data-part-id="answer" 的节点；否则是裸
    // MarkdownText，此时给 partId 反而指不到元素。
    return {
      seq: model.answerSeq ?? row.startSeq ?? row.seq,
      ...(model.answerSeq === undefined ? {} : { partId: 'answer' }),
      text: answer,
    }
  }
  if (row.kind !== 'user') return undefined
  const text = searchableText(row)
  if (text === '') return undefined
  // 用户消息画成气泡正文，给它一个 part-id，定位就能按坐标落，不用在整行里找词。
  return { seq: row.startSeq ?? row.seq, partId: 'body', text }
}

export function documentRows(rows: readonly RenderMessage[]): SearchDocumentRow[] {
  const result: SearchDocumentRow[] = []
  for (const row of rows) {
    const corpus = searchCorpusOf(row)
    if (corpus === undefined) continue
    result.push({
      seq: corpus.seq,
      messageId: row.id,
      ...(corpus.partId === undefined ? {} : { partId: corpus.partId }),
      text: corpus.text,
      folded: corpus.text.toLowerCase(),
      user: row.kind === 'user',
    })
  }
  return result
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
 * `workspace.deleteSession` / `workspace.archiveSession`, and that hold
 * something. The host archive set (from `workspace.list`) hides removed
 * sessions on the desktop, but the host `session.list` still returns attached
 * ones from its live registry — without this filter a session deleted on the
 * desktop reappears on the phone roster (and in pagination, since the page
 * slices come from this filtered array).
 *
 * Blank sessions (`blank: true`, no turn ever sent) are hidden for the same
 * reason the desktop tree hides them (`ui-workspace` keeps only the current
 * one): the desktop mints a blank session per "new chat" and per workspace
 * switch, and 542 of them had accumulated here by 2026-10-20 — the phone used
 * to list every one. The phone has no "current blank session" notion, so all
 * of them go.
 */
export function visibleSessionRows(
  rawItems: ReadonlyArray<RosterItem>,
  archivedSessionIds: ReadonlySet<string>,
): Array<{ updatedAt: number; sessionId: string }> {
  return rawItems.filter(item =>
    item.origin !== 'subagent'
    && item.blank !== true
    && !archivedSessionIds.has(String(item.sessionId)))
}

/**
 * The set of subagent session ids (origin: 'subagent'). Search must exclude
 * them the same way the session roster does — subagent sessions are internal
 * working sessions, not user conversations. Reuses the session-list TTL cache
 * when fresh; a fetch failure degrades to "no filter" (best-effort).
 */
async function subagentSessionIds(apiProxy: ApiProxy): Promise<Set<string>> {
  const now = Date.now()
  const ttl = sessionListTtlCache
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
   * 测试/端到端用：开跑后**等**第一趟索引走完再返回，这样断言不必和后台赛跑。
   * 生产不设（建库全程后台，首个 pass 延迟 15s）。
   */
  searchIndexEager?: boolean | undefined
}

/** Perf captures kept on disk: newest `PERF_CAPTURE_KEEP` win, older pruned. */
export const PERF_CAPTURE_KEEP = 20

/**
 * Size ceiling for one aggregate capture. `stats()` is a few KB, so anything past
 * this is a client bug or a probe — and it keeps the intake comfortably inside
 * the route's small-JSON body budget.
 */
export const PERF_CAPTURE_MAX_BYTES = 64 * 1024

/**
 * Ceiling for the raw mark ring (`__dshPalmPerf.toJSON()`). A full 2048-mark
 * buffer is ~200 KB and is the ONLY form that can locate an individual outlier
 * span (it keeps per-mark timestamps, stage and detail), so it gets its own.
 */
export const PERF_RAW_MAX_BYTES = 512 * 1024

/**
 * Which of the two capture forms this is: the raw mark ring (`stamps`) or the
 * `stats()` aggregate (`spans`). `invalid` means it is not a capture at all.
 */
export function perfCaptureKind(capture: unknown): 'raw' | 'aggregate' | 'invalid' {
  if (capture === null || typeof capture !== 'object' || Array.isArray(capture)) return 'invalid'
  return Array.isArray((capture as Record<string, unknown>).stamps) ? 'raw' : 'aggregate'
}

/**
 * Refuse anything that is not a perf capture. The phone sends exactly what
 * `__dshPalmPerf.stats()` or `.toJSON()` returns (timings, frame counts, event
 * kinds — no message content, see mobile/perf.ts), so a body that cannot be that
 * shape is a client bug or a probe, and neither belongs on disk.
 * @returns the refusal reason, or undefined when the capture looks right.
 */
export function validatePerfCapture(capture: unknown): string | undefined {
  const kind = perfCaptureKind(capture)
  if (kind === 'invalid') return '缺少性能抓取数据'
  const record = capture as Record<string, unknown>
  const bytes = Buffer.byteLength(JSON.stringify(capture))
  if (kind === 'raw') {
    // A raw capture without marks carries nothing the aggregate does not, and
    // would only add noise to the capture directory.
    if ((record.stamps as unknown[]).length === 0) return '原始抓取里没有标记'
    return bytes > PERF_RAW_MAX_BYTES ? '原始抓取超过体积上限' : undefined
  }
  const spans = record.spans
  if (spans === null || typeof spans !== 'object' || Array.isArray(spans)) return '性能抓取缺少 spans 聚合'
  const spanRecord = spans as Record<string, unknown>
  if (spanRecord.toState === undefined && spanRecord.toCommit === undefined) return '性能抓取缺少 spans.toState/toCommit'
  if (bytes > PERF_CAPTURE_MAX_BYTES) return '性能抓取超过体积上限'
  return undefined
}

/**
 * Write one capture into `dir` and return its absolute path.
 *
 * The file name is built HERE — clock, a sanitized label and the capture kind —
 * so nothing from the wire can steer a path: the label keeps only
 * `[A-Za-z0-9_-]` (no dots, no separators) and is length-capped, and the
 * extension is fixed. Captures are pruned to the newest
 * {@link PERF_CAPTURE_KEEP} so a measurement loop cannot fill the disk.
 */
export function writePerfCapture(
  dir: string,
  capture: unknown,
  label: string,
  now: number,
  kind: 'raw' | 'aggregate' = 'aggregate',
): string {
  mkdirSync(dir, { recursive: true })
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const safe = label.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'device'
  const file = join(dir, `capture-${stamp}-${safe}-${kind}.json`)
  // 0600: the capture is diagnostic detail about the host's own UI, not a
  // shared document (the same posture as the devices store).
  writeFileSync(file, JSON.stringify(capture), { encoding: 'utf8', mode: 0o600 })
  prunePerfCaptures(dir, PERF_CAPTURE_KEEP)
  return file
}

/** Keep the newest `keep` captures in `dir` (best effort: never throws). */
export function prunePerfCaptures(dir: string, keep: number): void {
  try {
    // The ISO stamp leads the name, so a name sort is an age sort.
    const files = readdirSync(dir).filter(name => name.startsWith('capture-') && name.endsWith('.json')).sort()
    for (const stale of files.slice(0, Math.max(0, files.length - keep))) {
      try {
        rmSync(join(dir, stale), { force: true })
      } catch {
        // non-fatal: the next write tries again
      }
    }
  } catch {
    // non-fatal: an unreadable directory must not fail the capture
  }
}

/* ── mobile.error intake ───────────────────────────────────────────────────── */

/** Error reports kept on disk: newest `ERROR_REPORT_KEEP` win, older pruned. */
export const ERROR_REPORT_KEEP = 20
/** Size ceiling for one report's JSON body (a probe or a client bug past this). */
export const ERROR_REPORT_BYTES_MAX = 64 * 1024

/**
 * Message ceiling, mirroring the client ring (`errors.ts` ERROR_MESSAGE_MAX).
 * The body ceiling must NOT stand in for this one: a 5 KB "message" cannot have
 * come from the ring, and accepting it would quietly widen the contract the
 * design pinned (≤240 chars, longer is refused).
 */
export const ERROR_MESSAGE_MAX = 240
/** First report of a fingerprint pushes; later pushes wait this long. */
export const ERROR_PUSH_COOLDOWN_MS = 60 * 60 * 1000
/** Allowed report kinds — mirrors the `ErrorKind` union in mobile/errors.ts. */
const ERROR_KINDS = new Set(['error', 'rejection', 'resource'])

/** `file.ext:line:col` with no path separators (basename shape). */
const FRAME_SHAPE = /^[^/\\]+:\d+:\d+$/

/**
 * The identity of a report: `sha256(kind + "\n" + message + "\n" + source)` cut
 * to 8 hex chars. This is the HOST-side spelling of the client ring's dedupe key
 * (kind + message + source, see mobile/errors.ts), so the two ends cannot diverge
 * on "is this the same error".
 */
export function errorFingerprint(report: { kind?: unknown; message?: unknown; source?: unknown }): string {
  const kind = String(report.kind ?? '')
  const message = String(report.message ?? '')
  const source = report.source === undefined ? '' : String(report.source)
  return createHash('sha256').update(`${kind}\n${message}\n${source}`).digest('hex').slice(0, 8)
}

/**
 * Refuse anything that is not a well-formed error report. The phone sends the
 * sanitized shape it ALREADY keeps (no full stack, no origin, no argument text),
 * so a body that cannot be that shape is a client bug or a probe. The frame shape
 * is basename only — any path separator is an attempt to carry a path, and it is
 * refused here AND can never reach the file name.
 * @returns the refusal reason, or undefined when the report looks right.
 */
export function validateErrorReport(report: unknown): string | undefined {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return '错误报告不是对象'
  const record = report as Record<string, unknown>
  if (!ERROR_KINDS.has(String(record.kind))) return '错误报告 kind 非法'
  if (typeof record.message !== 'string' || record.message === '') return '错误报告缺少 message'
  if (record.message.length > ERROR_MESSAGE_MAX) return '错误报告 message 超过 240 字'
  if (record.source !== undefined) {
    if (typeof record.source !== 'string' || record.source === '') return '错误报告 source 非法'
    if (!FRAME_SHAPE.test(record.source)) return '错误报告 source 不是 file:line:col'
  }
  if (record.frames !== undefined) {
    if (!Array.isArray(record.frames)) return '错误报告 frames 不是数组'
    if (record.frames.length > 3) return '错误报告帧数超过 3 条'
    for (const frame of record.frames) {
      if (typeof frame !== 'string' || !FRAME_SHAPE.test(frame)) return '错误报告帧不是 basename:line:col'
    }
  }
  if (typeof record.count !== 'number' || !Number.isInteger(record.count) || record.count < 1) return '错误报告 count 非法'
  // The whole-report ceiling is still enforced: a frame string is a basename
  // shape but has no length bound of its own.
  if (Buffer.byteLength(JSON.stringify(report)) > ERROR_REPORT_BYTES_MAX) return '错误报告超过体积上限'
  return undefined
}

/**
 * Write one report into `dir` and return its absolute path.
 *
 * The file name is built HERE — clock and the fingerprint — so nothing from the
 * wire can steer a path: the fingerprint is 8 hex chars and the clock is the
 * host's own. Reports are pruned to the newest {@link ERROR_REPORT_KEEP}, and
 * the fingerprint rides the name so the intake can tell whether it has seen this
 * error before by scanning the directory.
 */
export function writeErrorReport(dir: string, report: unknown, now: number): string {
  mkdirSync(dir, { recursive: true })
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const fingerprint = errorFingerprint(report as { kind?: unknown; message?: unknown; source?: unknown })
  const file = join(dir, `error-${stamp}-${fingerprint}.json`)
  // 0600: reports are diagnostic detail about the host's own device, not
  // shared documents (the same posture as the devices store and perf captures).
  writeFileSync(file, JSON.stringify(report), { encoding: 'utf8', mode: 0o600 })
  pruneErrorReports(dir, ERROR_REPORT_KEEP)
  return file
}

/** Keep the newest `keep` reports in `dir` (best effort: never throws). */
export function pruneErrorReports(dir: string, keep: number): void {
  try {
    const files = readdirSync(dir).filter(name => name.startsWith('error-') && name.endsWith('.json')).sort()
    for (const stale of files.slice(0, Math.max(0, files.length - keep))) {
      try {
        rmSync(join(dir, stale), { force: true })
      } catch {
        // non-fatal: the next write tries again
      }
    }
  } catch {
    // non-fatal: an unreadable directory must not fail the report
  }
}

/** Whether a report for this fingerprint already sits in `dir`. */
export function errorSeen(dir: string, fingerprint: string): boolean {
  try {
    return readdirSync(dir).some(name => name.endsWith(`-${fingerprint}.json`))
  } catch {
    return false
  }
}

/**
 * The push policy for one report. A fingerprint is pushed on first SIGHT —
 * i.e. only when its report does not already sit in the directory — and even
 * that waits out the 60-minute cooldown since the last push. A fingerprint that
 * already exists is a repeat and is never pushed (it is still written/pruned).
 * The result is a policy, not a delivery guarantee — delivery is best-effort
 * and channel failures never undo the write.
 */
export function errorPushDecision(args: { exists: boolean; lastPushAt: number | undefined; now: number }): { push: boolean; reason: 'first-seen' | 'cooldown' | 'repeat' } {
  if (args.exists) return { push: false, reason: 'repeat' }
  const withinCooldown = args.lastPushAt !== undefined && args.now - args.lastPushAt < ERROR_PUSH_COOLDOWN_MS
  return withinCooldown ? { push: false, reason: 'cooldown' } : { push: true, reason: 'first-seen' }
}

/** Cooldown clock for error pushes, one per plugin lifetime. */
let lastErrorPushAt: number | undefined = undefined

/** Time-travel/reset seam for the intake unit test (not part of the contract). */
export function resetErrorPushCooldown(): void {
  lastErrorPushAt = undefined
}

/** The in-memory cooldown clock (reads, never mutates). */
function currentCooldown(): number | undefined {
  return lastErrorPushAt
}

/**
 * Push one error report once, reusing the existing L3/L2 delivery. Built as a
 * distinct helper so the intake branch stays thin and the notify capability is
 * optional: when `notify` is absent the intake simply writes and returns — it
 * never constructs a failure out of a missing notifier.
 */
export function pushErrorOnce(notify: NotifyService | undefined, report: { message?: unknown; kind?: unknown }, fingerprint: string): void {
  if (notify === undefined) return
  const message = String(report.message ?? 'unknown error')
  const event: NotifyEvent = {
    id: `error-${fingerprint}`,
    kind: 'task-failed',
    title: '手机端出错',
    body: `[${String(report.kind ?? 'error')}] ${message.slice(0, 120)}`,
    sessionId: '',
    ts: Date.now(),
  }
  // Route the report through the engine so it reaches the inbox and the
  // delivery telemetry too; going straight to the channel functions meant a
  // failed report was invisible everywhere except the host log.
  notify.engine.publish(event)
}

/**
 * The intake branch for `mobile.error`: validate → write (which prunes) →
 * decide whether to push on first sight (cooldown-gated) → report the verdict.
 * `exists` is computed BEFORE the write (a first sight of a fingerprint must see
 * the pre-write directory), so the sequence is read-exists → write → push. The
 * cooldown clock is the module-level in-memory value, one per plugin lifetime;
 * `resetCooldown` is a test-only seam to bring it back to a known state.
 */
export function ingestErrorReport(input: {
  dir: string
  report: unknown
  notify: NotifyService | undefined
  now: number
  hasSeen?: (dir: string, f: string) => boolean
  push?: (n: NotifyService | undefined, r: { message?: unknown; kind?: unknown }, f: string) => void
}): { file: string; bytes: number; pushed: boolean } {
  const fingerprint = errorFingerprint(input.report as { kind?: unknown; message?: unknown; source?: unknown })
  const exists = (input.hasSeen ?? errorSeen)(input.dir, fingerprint)
  const decision = errorPushDecision({ exists, lastPushAt: currentCooldown(), now: input.now })
  const file = writeErrorReport(input.dir, input.report, input.now)
  if (decision.push) {
    lastErrorPushAt = input.now
    ;(input.push ?? pushErrorOnce)(input.notify, input.report as { message?: unknown; kind?: unknown }, fingerprint)
  }
  return { file, bytes: Buffer.byteLength(JSON.stringify(input.report)), pushed: decision.push }
}

/**
 * Minimal command-registry surface the mobile directory needs. The host
 * `CommandRuntime.list(agent)` resolves the effective view for one agent —
 * the same catalog the desktop composer's `/` popup shows. Passing the
 * session's agent is required for Web deployments, where per-agent rows
 * (plan-mode, command-compact) live in agent presets and are invisible to
 * the plain-context view; `undefined` (the global view) is only the
 * fallback when no agent resolves.
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

/**
 * 宿主附件服务里手机端用得到的那一件事：把一段 base64 落盘并暂存成一个 receipt。
 * 真实服务（@deepseek-ai/dsh-client-file-upload 的 FileUploads）还带 resolve/bindPrompt
 * 等一堆方法，插件不碰它们，所以只声明这一个调用面。
 */
export interface FileUploadsLike {
  upload(
    agent: unknown,
    request: { data: string; name?: string },
    signal: AbortSignal,
  ): Promise<{ receiptId: string; file?: { name?: string; bytes?: number } }>
}

/** 宿主目标视图里手机端用得到的字段。 */
export interface GoalViewLike {
  readonly id: string
  readonly revision: number
  readonly phase: string
  readonly objective: string
  /** 进程内"允许自动继续"授权；桌面端那条 暂停/继续 按钮就是看它。 */
  readonly activation?: 'armed' | 'disarmed'
}

/**
 * 宿主目标服务的最小面（`ctx.goals`）。
 *
 * 只声明手机端要用的五个方法，签名照宿主 `GoalService` 的公开 API。服务没装上
 * （宿主裁掉 @deepseek-ai/dsh-goal）时 deps 里没有它，目标条退回"只读投影 + 命令
 * 通道"的老样子，不会因此整条消失。
 */
export interface GoalLookup {
  get(agent: unknown): GoalViewLike | undefined
  pause(agent: unknown, ref: { id: string; revision: number }): GoalViewLike
  resume(agent: unknown, ref: { id: string; revision: number }): GoalViewLike
  edit(agent: unknown, ref: { id: string; revision: number }, request: { objective: string }): GoalViewLike
  clear(agent: unknown, ref: { id: string; revision: number }): unknown
}

/**
 * Resolve the command directory the phone's + menu shows for one session.
 *
 * The host `CommandRuntime.list(agent)` resolves the effective view for one
 * agent — the same catalog the desktop composer's `/` popup lists. The Web
 * deployment moves per-agent rows (plan-mode, command-compact) into agent
 * presets, so the plain-context view (`list(undefined)`) would silently miss
 * `/plan` and `/compact`; the session's agent view is the correct directory.
 * A session that resolves no agent (unknown id, or the agent service is not
 * composed) falls back to the plain-context view.
 *
 * @param registry - the host command registry (absent when not composed).
 * @param agents - the live agent lookup (absent when not composed).
 * @param sessionId - the session whose agent view to resolve.
 * @returns the name-sorted effective command descriptors.
 */
/** 一份命令目录条目（宿主注册表返回的形状）。 */
export interface CommandDescriptorView {
  name: string
  description: string
  input?: { hint?: string }
}

/**
 * 最近一次从"活的会话 agent"拿到的完整命令目录。
 *
 * 为什么需要它：命令目录是**按会话 agent 解析**的，而手机上打开的历史会话多半没有
 * 活的 agent（宿主的 ctx.agents.get 是空的），目录就只剩全局那几条 —— 真机表现就是
 * "这个会话有 /goal、/plan，换个会话就没了"。命令目录本身不随会话变化（除了 plan
 * mode 这种状态），所以把最后见到的完整一份留在这里，冷会话拿它补齐。
 */
let fullDirectoryCache: readonly CommandDescriptorView[] = []

/** 清空上面那份缓存（只给用例用）。 */
export function resetCommandDirectoryCache(): void {
  fullDirectoryCache = []
}

export function resolveCommandDirectory(
  registry: CommandRegistry | undefined,
  agents: AgentLookup | undefined,
  sessionId: string | undefined,
): readonly { name: string; description: string; input?: { hint?: string } }[] {
  if (registry === undefined) return []
  const agent = sessionId === undefined || agents === undefined
    ? undefined
    : agents.get(sessionId)
  // 两份目录取并集，而不是"agent 解析不到就只剩全局那几条"。
  //
  // 真机 2026-10-22：斜杠面板里 /goal、/plan 有时整条消失，只剩 export/feedback/
  // mnemon/permission —— 那一次恰好是会话的 agent 还没建起来（新会话、刚重启、
  // 或手机上先点开了 + 再进会话），于是退回了 plain-context 视角。命令目录不该
  // 因为"此刻没有 agent"就少给命令：agent 视角有的优先，全局视角里其余的也留着。
  const collected = new Map<string, CommandDescriptorView>()
  const absorb = (list: readonly CommandDescriptorView[]): void => {
    for (const command of list) {
      collected.set(command.name, {
        name: command.name,
        description: command.description,
        ...(command.input !== undefined ? { input: command.input } : {}),
      })
    }
  }
  absorb(registry.list(undefined))
  if (agent !== undefined && agent !== null) {
    const view = registry.list(agent)
    // 记下这份"完整视角"：没活的 agent 的会话（历史会话、刚打开还没发过言的会话）
    // 就靠它补齐 /plan、/compact 这些挂在 agent 预设上的行。
    fullDirectoryCache = view
    absorb(view)
  } else {
    absorb(fullDirectoryCache)
  }
  return [...collected.values()].sort((left, right) => left.name.localeCompare(right.name))
}

/** 手机端能看见的激活取值（与宿主 `GoalActivation` 同词）。 */
export type GoalActivationView = 'armed' | 'disarmed'

/**
 * 读一个会话目标此刻的进程内授权（armed/disarmed）。
 *
 * 宿主的线上投影只发 durable 快照（`{ current }`），**故意不含** activation
 * —— 那是"本进程还会不会自动继续"的进程内状态。桌面端靠 `remote.goals.get`
 * 拿它，手机端没有那条通道，于是只能看见 durable 相位：桌面上点过暂停（只是
 * 撤授权，相位仍是 active）之后，手机条子还写着"暂停"。这里直连宿主目标服务
 * （`ctx.goals` + `ctx.agents`）把这个值取出来。
 *
 * 任何一步不可用（服务没装、会话没活着的 agent、宿主改签名）都返回 undefined，
 * 调用方按"未知"处理：条子退回只读投影的老行为，不会白屏也不会报错。
 *
 * @param deps - 插件依赖（只用 agents / goals 两项，缺席即降级）。
 * @param sessionId - 会话 id。
 * @returns armed / disarmed，或取不到时的 undefined。
 */
export function goalActivationOf(
  deps: { agents?: AgentLookup | undefined; goals?: GoalLookup | undefined },
  sessionId: string,
): GoalActivationView | undefined {
  if (deps.agents === undefined || deps.goals === undefined) return undefined
  try {
    const agent = deps.agents.get(sessionId)
    if (agent === undefined || agent === null) return undefined
    const view = deps.goals.get(agent)
    const activation = view?.activation
    return activation === 'armed' || activation === 'disarmed' ? activation : undefined
  } catch {
    // 宿主目标服务拒绝（会话没活着的 agent、内部错误）时静默降级。
    return undefined
  }
}

/**
 * 现取当前目标的投影形状（`{ current }`）。
 *
 * 手机端原来读的是花名册快照里的 `goal` 投影 —— 那份快照只在枚举会话时刷新。用户在
 * 会话里刚用 `/goal 做点什么` 建了目标，快照里根本没有它，于是手机端的目标条一直不
 * 出现（真机 2026-10-22）。目标服务本来就在进程里，直接问它，不读日志也不算抢宿主。
 *
 * @returns 投影形状；宿主没装目标服务或会话没有活着的 agent 时返回 undefined，调用方
 *   回退到快照/现读日志的老路。
 */
export function goalSnapshotOf(
  deps: { agents?: AgentLookup | undefined; goals?: GoalLookup | undefined },
  sessionId: string,
): { current: GoalViewLike | null } | undefined {
  if (deps.agents === undefined || deps.goals === undefined) return undefined
  try {
    const agent = deps.agents.get(sessionId)
    if (agent === undefined || agent === null) return undefined
    const view = deps.goals.get(agent as never)
    if (view === undefined || view === null) return { current: null }
    return { current: view }
  } catch {
    return undefined
  }
}

/**
 * 目标值的来源选择：现取得到就用现取的，问不到才退回花名册快照。
 *
 * `undefined` 专门表示"问不到"（宿主没装目标服务、会话冷），`null` 表示"确实没有目标"
 * —— 两者混用会让目标条要么永远不消失、要么永远不出现。
 */
export function preferLiveGoal(live: unknown, snapshot: unknown): unknown {
  return live === undefined ? snapshot : live
}

/** 一次目标动作的结局：成功带新视图，失败带可下发的原因。 */
export type GoalActionResultLike =
  | { ok: true; goal?: GoalViewLike; activation?: GoalActivationView }
  | { ok: false; code: string; message: string }

/**
 * 执行手机上的一次目标动作（暂停/恢复/编辑/清除）。
 *
 * 语义与桌面端 `remote.goals.*` 逐一对应：暂停 = 撤授权（durable 相位保持
 * active），恢复 = 重新授权（相位是 paused 时同时把相位翻回 active），编辑/清除
 * 用当前 revision 做 CAS。ref 从服务现读，不接受手机传来的 revision —— 手机可能
 * 停在旧的一帧上，照它写会把别人的改动覆盖掉。
 *
 * @param deps - 插件依赖（agents / goals）。
 * @param sessionId - 会话 id。
 * @param action - pause / resume / edit / clear。
 * @param objective - edit 的新目标文本（其余动作忽略）。
 * @returns 结局；调用方只负责把 ok:false 翻成 HTTP 答复。
 */
export function applyGoalAction(
  deps: { agents?: AgentLookup | undefined; goals?: GoalLookup | undefined },
  sessionId: string,
  action: 'pause' | 'resume' | 'edit' | 'clear',
  objective = '',
): GoalActionResultLike {
  if (deps.agents === undefined || deps.goals === undefined) {
    return { ok: false, code: 'unavailable', message: '宿主目标服务不可用' }
  }
  try {
    const agent = deps.agents.get(sessionId)
    if (agent === undefined || agent === null) {
      return { ok: false, code: 'unavailable', message: '这个会话没有运行中的 agent' }
    }
    const goals = deps.goals
    const current = goals.get(agent)
    if (current === undefined) return { ok: false, code: 'no-current-goal', message: '当前没有目标' }
    const ref = { id: current.id, revision: current.revision }
    if (action === 'clear') {
      goals.clear(agent, ref)
      return { ok: true }
    }
    const view = action === 'pause' ? goals.pause(agent, ref)
      : action === 'resume' ? goals.resume(agent, ref)
        : goals.edit(agent, ref, { objective })
    const activation = view.activation
    return {
      ok: true,
      goal: view,
      ...(activation === 'armed' || activation === 'disarmed' ? { activation } : {}),
    }
  } catch (error) {
    return { ok: false, code: 'goal-action-failed', message: error instanceof Error ? error.message : String(error) }
  }
}

/** Mobile API route paths. */
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
  sessionRosterCacheFile = deps.perfDir === undefined ? undefined : join(deps.perfDir, 'roster-snapshot.json')
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
        const currentDeviceId = readCookie(req.headers.cookie, service.config.cookieName)
        const devices = service.snapshot().devices.map(device => ({
          id: device.id,
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
        const body = parsed.payload as { deviceId?: unknown } | undefined
        const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : ''
        if (deviceId === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少设备 id' } },
          })
          return
        }
        const removed = service.revoke(deviceId)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { removed } },
        })
      } else if (method === MOBILE_PAIR_RENAME_METHOD) {
        const body = parsed.payload as { deviceId?: unknown; name?: unknown } | undefined
        const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : ''
        const name = typeof body?.name === 'string' ? body.name : ''
        if (deviceId === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少设备 id' } },
          })
          return
        }
        const renamed = service.renameDevice(deviceId, name)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { renamed } },
        })
      } else if (method === MOBILE_PAIR_SET_PRIMARY_METHOD) {
        const body = parsed.payload as { deviceId?: unknown } | undefined
        const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : ''
        if (deviceId === '') {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'bad-request', message: '缺少设备 id' } },
          })
          return
        }
        const promoted = service.setPrimary(deviceId)
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { promoted } },
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
        apiProxyForRunning = apiProxy
        // Which main-agent sessions have an attached agent running right now.
        // The run-overview badge seeds from this so a session that started
        // generating BEFORE the phone opened (or before this page mounted)
        // still counts — its turn/start frame is gone and session.list's own
        // TTL can still say running:false. One host read per TTL window; the
        // badge is not latency-critical, so 30 s matches session.list's cache.
        const runningCache = mobileRunningCache
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
        if (liveRunningSeededAt !== 0) {
          const sessionIds = [...liveRunningSessionIds]
          mobileRunningCache = { at: Date.now(), proxy: apiProxy, sessionIds }
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: true, value: { sessionIds } },
          })
          if (Date.now() - liveRunningSeededAt >= LIVE_RUNNING_RESEED_MS) void reseedRunning()
          return
        }
        try {
          // 进程启动后第一次问：现在取一次基线。之后每一次都是内存读，帧会
          // 一直把桌面端的开始/结束送进镜像。
          await reseedRunning()
          if (liveRunningSeededAt === 0) throw new Error('running baseline unavailable')
          const sessionIds = [...liveRunningSessionIds]
          mobileRunningCache = { at: Date.now(), proxy: apiProxy, sessionIds }
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
        const body = parsed.payload as { sessionId?: unknown; maxRows?: unknown } | undefined
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
          const page = await readChatTailPage(sessionId, maxRows)
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
        apiProxyForRunning = apiProxy
        if (liveRunningSeededAt === 0) void reseedRunning()
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
        // 依赖自检（v3.4）：palm 与宿主的耦合点都是内部契约，升级时可能静默失效
        // （订阅都在 try/catch 里降级）。这里把 setup 期登记与运行期帧计数交出去，
        // 让"哪条断了"在手机上一眼可见。
        const diagnostics = deps.diagnostics
        if (diagnostics === undefined) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId,
            result: { ok: false, error: { code: 'unavailable', message: '自检服务不可用' } },
          })
          return
        }
        writeJson(res, 200, {
          type: 'server-response',
          rpcId,
          result: { ok: true, value: { checks: diagnostics.snapshot(), now: Date.now() } },
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
            payload: { type: 'session/status', sessionId: boundary.sessionId, running: boundary.running },
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
  sessionRosterLastRefreshAt = Date.now()
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
      sessionListTtlCache = {
        at: Date.now(),
        proxy: apiProxy,
        rawItems: toRosterItems(full.result.value.items as RosterItem[]),
        archivedIds: new Set((wsValue?.archivedSessionIds ?? []).map(id => String(id))),
      }
      sessionListOwnedCache = new Map(
        (wsValue?.items ?? []).map(item => [
          String(item.workspaceId),
          new Set((item.sessionIds ?? []).map(id => String(id))),
        ]),
      )
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
    const ttl = sessionListTtlCache
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
      && now - sessionRosterLastRefreshAt >= SESSION_LIST_REFRESH_MIN_MS
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
      const snapshot = sessionListTtlCache
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
    const ownedIds = workspaceId === undefined ? undefined : sessionListOwnedCache?.get(workspaceId)
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
