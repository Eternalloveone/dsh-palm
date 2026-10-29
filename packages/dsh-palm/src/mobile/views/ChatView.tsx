/**
 * Chat level: one session. Loads the history tail page on open, appends
 * pages upward (loadOlder), folds live mux frames in as they arrive, sends
 * prompts through session.prompt, and runs `/`-lines through the host
 * command registry (mobile.commandExec — the prompt channel never
 * dispatches commands).
 *
 * Rendering mirrors the desktop web UI's fold discipline on a small screen:
 * - reasoning text hides behind a collapsed "深度思考" disclosure,
 * - tool calls behind a collapsed tool disclosure (name + arguments),
 * - very long assistant text collapses with an explicit expand toggle,
 * - a toolbar above the composer carries the model (+ thinking effort) and
 *   permission pickers, both as bottom sheets.
 */

import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { MuxFrame } from '../../api-proxy-types'
import { loadChatPage, prompt, type ChatPageResult, type SessionView } from './App.tsx'
import { dropSessionFromCaches, loadDraft, removeDraft, saveDraft } from '../list-persist.ts'
import { holdLocateIntent, locateIntentFor, releaseLocateIntent, takeLocateIntent, touchLocateIntent } from '../locate-intent.ts'
import { forgetFinishedRun } from '../recent-finished.ts'
import { usePageVisible } from '../foreground.ts'
import { useLiveClock } from '../live-clock.ts'
import { formatDuration, isRowRunning } from '../process-rows.ts'
import { CTX_MENU_WIDTH, placeCtxMenu } from '../ctx-menu.ts'
import { recallChatSnapshot, rememberChatSnapshot } from '../chat-snapshot.ts'
import { loadCachedHistory } from '../history-cache.ts'
import { errorText, staleHostHint } from './App.tsx'
import { fetchMobilePreferences, models, renameSession, selectModel, sendCommand, cancelSession, archiveSession, fetchPending, listCommands, transcribeVoice, listSessions, history, logTail, readChat, reportPerf, runningSessions, turnState, type CommandDescriptor } from '../api.ts'
import type { SessionModels } from '../../api-proxy-types'
import type { PendingApproval, PendingQuestionItem } from '../api.ts'
import { buildPromptParts, compressImageFile, imageFromClipboard, MAX_ATTACHED_IMAGES, readAsDataURL, type AttachedImage, type PromptPart } from '../image.ts'
import { uploadAttachment, type UploadedAttachment } from '../api.ts'
import { coalesceTurnMessages, completedTurns, ensureTurnTails, keepTurnReports, preferRicherRows, expectsTurnReport, missingTurnReports, EventFolder, foldEvents, mergeTurnReports, parseTodoList, type RenderMessage, type TodoSnapshot, type WireEvent } from '../messages.ts'
import { reportDuplicateCards } from '../duplicate-report.ts'
import { reportError } from '../api.ts'
import {
  createScrollState,
  FOLLOW_THRESHOLD_PX,
  mayAutoPin,
  maySettlePin,
  scrollReducer,
  type ScrollEvent,
  type ScrollState,
} from '../scroll-machine.ts'
import { SessionHud } from '../session-hud.tsx'
import { dispatchStatusEvent } from '../session-status-store.ts'
import {
  barsSignature,
  createSessionStatus,
  describeBars,
  sessionStatusReducer,
  sweepExpired,
  type BarsView,
  type SessionStatus,
  type StatusEvent,
} from '../session-status.ts'
import { perfMark } from '../perf.ts'
import { adoptPolledQuestions, answeredQuestionsFor, noteAnsweredQuestion } from '../question-batches.ts'
import { adoptPolledApprovals, answeredApprovalsFor, noteAnsweredApproval } from '../approval-batches.ts'

/**
 * Rows → rendered list: dedupe the same turn's step rows into one process card,
 * then rebuild the 「本轮产出」 card for any turn whose report row did not come
 * with the page (a folded host page / a cached page carries rows, not the
 * `turn/end` that normally creates it — see `ensureTurnTails`).
 */
/**
 * 按轮号把交付卡从日志里读出来（翻页与补读共用）。
 *
 * 一轮的卡要 `turn/end`（以及它前面的 `deliverables/presented`）。页是按行切的，
 * 长回合的 `turn/end` 常常落在**下一页**里，于是那一页自己没有卡。
 *
 * 这里往回读到每一轮的起点为止，折出这些轮的卡。页数有上限（`REPORT_FALLBACK_MAX_PAGES`），
 * 拿不到就返回空数组 —— 调用方按「确实没有」处理，不许拿猜的顶上。
 *
 * @param wanted - 需要的轮号集合。
 * @returns 这些轮的 turn 行（可能为空）。
 */
export async function loadTurnReportRows(
  sessionId: string,
  wanted: readonly number[],
): Promise<RenderMessage[]> {
  if (wanted.length === 0) return []
  const wantedSet = new Set(wanted)
  let accumulated: WireEvent[] = []
  let cursor: number | undefined
  for (let index = 0; index < REPORT_FALLBACK_MAX_PAGES; index++) {
    const raw = await history(sessionId, cursor, REPORT_FALLBACK_PAGE_MESSAGES)
    const events = raw.events.map(entry => (entry.view === undefined
      ? entry.event
      : { ...entry.event, view: entry.view })) as WireEvent[]
    if (events.length === 0) break
    accumulated = [...events, ...accumulated]
    // 每一轮都要翻到它自己的起点：按条数截断只会拿到回合后半段。
    const started = new Set<number>()
    for (const event of accumulated) {
      if (event.type !== 'turn/start') continue
      const data = event.data as Record<string, unknown> | undefined
      const turn = typeof data?.['turn'] === 'number' ? data['turn'] : undefined
      if (turn !== undefined) started.add(turn)
    }
    if ([...wantedSet].every(turn => started.has(turn))) break
    const firstSeq = events[0]?.seq
    if (!raw.hasMore || firstSeq === undefined || firstSeq === cursor) break
    cursor = firstSeq
  }
  return foldEvents(accumulated).filter(row => (
    row.kind === 'turn' && row.turn !== undefined && wantedSet.has(row.turn)
  ))
}

/**
 * `allowGuessedTails=false`：只保留页里**真的带着** `turn/end` 折出来的卡，不猜。
 *
 * 往上翻历史时用这个模式。猜出来的卡是「从工具行推的」，几秒后 `cardRecovery` 读到真
 * `turn/end` 会把它换成正式版（文件清单可能从 1 个变成 3 个）—— 两次渲染之间内容变了，
 * 用户看到的就是「翻历史时交付卡闪一下」。历史轮次宁可先不给卡，也不要给了又改。
 */
export function renderRows(rows: readonly RenderMessage[], allowGuessedTails = true): RenderMessage[] {
  const folded = coalesceTurnMessages(rows)
  return allowGuessedTails ? ensureTurnTails(folded) : folded
}

/**
 * Report what a page actually looked like when its report card could not be
 * produced. The host writes this next to its perf captures and names the file
 * itself (see `reportPerf`), so this is write-only and path-free — and it is the
 * only way to see the phone's real payload without a device console.
 */
function reportCardDiagnostic(
  rows: readonly RenderMessage[],
  missing: readonly number[],
  attempt: { pages: number; whole: boolean; source?: 'network' | 'cache' },
): void {
  const brief = rows.slice(-40).map(row => ({
    id: row.id,
    kind: row.kind,
    turn: row.turn ?? null,
    seq: row.seq,
    text: (row.text ?? '').length,
    tools: (row.tools ?? []).map(tool => ({
      name: tool.name,
      state: tool.state,
      args: (tool.arguments ?? '').length,
      view: tool.view !== undefined,
    })),
    deliverables: row.deliverables?.length ?? 0,
    produced: (row.produced ?? []).slice(0, 6),
  }))
  try {
    void reportPerf({
      stamps: [{ at: Date.now(), label: 'carddiag' }],
      diagnostic: 'turn-report-missing',
      at: Date.now(),
      source: attempt.source ?? 'network',
      rowCount: rows.length,
      rows: brief,
      missing: [...missing],
      pages: attempt.pages,
      wholeTurn: attempt.whole,
    }, 'carddiag').catch(() => { /* 诊断本身失败不影响聊天 */ })
  } catch {
    // 老宿主没有这个入口时也只是少一条诊断：聊天照常。
  }
}

/**
 * Stable row key: (turn, step) when the row carries them, else the id.
 * Streaming rows keep (turn, step) across the pending→settled id swap
 * (synthetic `assistant,<turn>.<step>#<seq>` → host id), while the id
 * itself changes — keying by id would remount the whole message when it
 * settles, replaying the msg-in animation and dropping open states
 * (expanded diff cards, reasoning folds).
 */
function messageKey(message: RenderMessage): string {
  return message.turn !== undefined && message.step !== undefined
    ? `t${message.turn}.${message.step}`
    : message.id
}

/**
 * 折叠里最新的一轮号（只看 assistant 行：user 行不带 turn 字段，轮次尾报告卡
 * 只是产出清单、不承载过程）。活跃轮次号缺席时的兜底 —— 中途重开一个还开着的
 * 回合时，running 是从会话名单或尾页锚点恢复的，那一帧 turn/start 没经手，
 * 而正在跑的那一轮必然是折叠里最后出现的一轮。
 */
function newestFoldTurn(messages: readonly RenderMessage[]): number | undefined {
  let newest: number | undefined
  for (const message of messages) {
    if (message.kind !== 'assistant' || message.turn === undefined) continue
    if (newest === undefined || message.turn > newest) newest = message.turn
  }
  return newest
}

/**
 * 最新一轮的起点，按可信度从高到低取：
 *
 *   1. 行上的 `turnStartAt` —— 折叠盖上去的 turn/start 时间，最准；
 *   2. 行上的 `firstSeenAt` —— 这一行**首个**事件的宿主时间。长回合里 turn/start
 *      会被挤出折叠窗口和边界回读窗口（跑十几分钟、几十步就到），此时这是唯一还
 *      带着"这一轮从什么时候开始"的证据；
 *   3. 这一轮发起它的那条用户消息 —— assistant 行还没落地时（刚发完、模型还没吐
 *      第一个字）只有它在。
 *
 * 兜底绝不能退到挂载时刻：那会让打开一个已经跑了十分钟的会话从 0 秒开始数，
 * 与桌面端对不上（真机返工过的现象）。
 *
 * 特别注意别用 `message.time`：它是这一行**最后一次**被事件碰到的时刻，活跃行上
 * 就等于"现在"，拿它当锚点秒表永远从 0 数。
 */
function newestTurnAnchor(messages: readonly RenderMessage[]): number | undefined {
  const turn = newestFoldTurn(messages)
  let own: number | undefined
  let firstSeen: number | undefined
  let lastUser: number | undefined
  for (const message of messages) {
    if (message.kind === 'user') {
      // 用户行不带 turn 字段（见 newestFoldTurn 的注释），所以只能拿"最后一条"。
      const at = typeof message.time === 'number' && Number.isFinite(message.time) ? message.time : undefined
      if (at !== undefined && (lastUser === undefined || at > lastUser)) lastUser = at
      continue
    }
    if (message.kind !== 'assistant') continue
    if (turn !== undefined && message.turn !== turn) continue
    const startAt = typeof message.turnStartAt === 'number' && Number.isFinite(message.turnStartAt)
      ? message.turnStartAt
      : undefined
    if (startAt !== undefined && (own === undefined || startAt < own)) own = startAt
    const seenAt = typeof message.firstSeenAt === 'number' && Number.isFinite(message.firstSeenAt)
      ? message.firstSeenAt
      : undefined
    if (seenAt !== undefined && (firstSeen === undefined || seenAt < firstSeen)) firstSeen = seenAt
  }
  return own ?? firstSeen ?? lastUser
}

/** 回合边界事件（turn/start / turn/end）data 里的轮号；缺失或非数字即 undefined。 */
function turnNumberOf(event: WireEvent): number | undefined {
  const data = event.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const turn = (data as Record<string, unknown>)['turn']
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : undefined
}
import { FinishedElsewhereBar, RunStatusBar, RunStatusSheet } from '../run-status.tsx'
import { copyText, openFilePath, shareText } from '../code-actions.ts'
import { MuxClient } from '../mux.ts'
import { ThemeToggle } from '../theme-toggle.tsx'
import { getAutoScroll, subscribeDisplayPrefs } from '../display-prefs.ts'
import { formatFileSize, timeVisibility } from '../ui-text.ts'
import { enqueuePrompt, flushOutbox, listOutbox, removeFromOutbox, removeOutboxForSession, type OutboxEntry } from '../offline.ts'
import { QueueDock } from '../queue-dock.tsx'
import { GoalBar } from '../goal-bar.tsx'
import {
  GOAL_CLEAR_COMMAND, GOAL_EDIT_PREFIX, GOAL_PAUSE_COMMAND, GOAL_RESUME_COMMAND, goalEditCommand,
  parseGoalProjection, type MobileGoal,
} from '../goal-projection.ts'
import { FilePreviewSheet } from '../file-preview-sheet.tsx'
import { ImageLightbox } from '../image-lightbox.tsx'
import { inboxOf, sessionState, updateQueue, queueItemViewOf, type QueueItemView } from '../api.ts'
import {
  cachedSnapshot,
  addOptimisticQueueItem,
  applyQueueItems,
  applySnapshot,
  claimQueueHead,
  dropOptimisticQueueItem,
  hideQueueItem,
  queueView,
  subscribeSessionStore,
  unhideQueueItem,
} from '../session-store.ts'
import { goalAction, goalOf, searchSessions, type MobileGoalAction } from '../api.ts'
import { onConnectivityChange, reportConnectivity, RpcCallError } from '../rpc.ts'
import { startVoiceRecording, voiceSupported, type VoiceRecording } from '../voice-input.ts'
import { voiceStatusClassName, voiceStatusText } from '../voice-status.ts'
import { createLiveCaptions, type LiveCaptions } from '../live-captions.ts'
import { getVoiceServices } from '../voice-services.ts'
import { toast } from '../toast.tsx'
import { forgetQueuedEcho, lostQueuedEchoes, markQueuedEchoSeen, normalizeEchoText, readQueuedEchoes, rememberQueuedEcho } from '../queued-echo.ts'
import { turnNumberIsStale } from '../turn-liveness.ts'
import { approvalPreviewText } from '../approval-preview.ts'
import { Sheet } from '../sheet.tsx'
import { ConfirmDialog, PromptDialog } from '../dialog.tsx'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, MicIcon, ModelIcon, MoreIcon, PencilIcon, PlusIcon, SearchIcon, SendIcon, ShieldIcon } from '../icons.tsx'
import { MessageRow } from '../message-row.tsx'
import { LONG_TEXT_LIMIT, LONG_TEXT_PREVIEW } from '../markdown-text.tsx'
import { ApprovalPanel, CommandSheet, GitSheet, PermissionConfirmSheet, PlusSheet, QuestionPanel, TurnListSheet, parsePermissionSelect, type PermissionSelectValue, HostFileSheet } from '../sheets.tsx'
import { buildEffortChoices, flattenModelChoices } from '../model-choice.ts'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { mergeTurnEntries, parseTurnOutline, localTurnEntries, readingTurnAt, scrubTurnIndex, seqRowIndex, turnPromptRowIndex, turnRowIndex, type TurnEntry } from '../turn-outline.ts'
import { TurnScrubber } from '../turn-scrubber.tsx'
import { TaskStatusBar } from '../task-status.tsx'
import type { JobView } from '../../api-proxy-types'
import { SUBAGENT_POLL_MS, fetchSubagentsFlat, type SubagentFlatNode } from '../subagent-tree.ts'

/** D1 handle-gesture tunables: the travel (px) a press must exceed before it
 *  counts as a scrub drag, and the horizontal inset of the scrub card's track
 *  inside the viewport (card margin + padding). The inset mirrors .turn-scrub in
 *  the stylesheet, because the finger position is mapped onto that track. */
/** 重新生成发出去后，等这么久还没开跑就复位（正常路径由 running 收走）。 */
const REGENERATE_WATCHDOG_MS = 15_000

/**
 * 「重新生成」这个按钮该不该出现在这一行上。
 *
 * 之前判据只看本地的 running：宿主重启/断流把回合打断后，running 立刻变 false，而
 * 这一轮的过程框还挂着（turnStartAt 来自日志、没有配对的 turn/end），于是用户在
 * 「深度求索中 · 用时 3 分 55 秒」的卡片右下角看到一颗 ↻ —— 界面一边说在跑，一边
 * 让人重新生成。判据必须和过程框同源：turnLive 为真就不给按钮。
 */
export function offersRegenerate(input: {
  isLastMessage: boolean
  isAssistant: boolean
  pending: boolean
  turnLive: boolean
}): boolean {
  return input.isLastMessage && input.isAssistant && !input.pending && !input.turnLive
}

const TURN_SCRUB_MOVE_PX = 8
const TURN_SCRUB_TRACK_INSET_PX = 30

/** Right-hand x of the scrub track inside the viewport (kept above the left edge
 *  even on an absurdly narrow window, so the span can never invert). */
function scrubTrackRight(): number {
  return Math.max(TURN_SCRUB_TRACK_INSET_PX + 40, window.innerWidth - TURN_SCRUB_TRACK_INSET_PX)
}

/** Page budget for one turn jump. The first request jumps straight to the
 *  target turn's page, so this only bounds a jump whose cursor missed. */
const TURN_JUMP_MAX_PAGES = 24

/**
 * 搜索跳转取页的行数（原始事件）。默认 25 行折叠后只剩七八个渲染行，深历史里的
 * 目标行常常正好落在窗口外 —— 表现就是「翻了一页，画面没到那条命中」。锚定页一次
 * 多要一些，目标行就有很大概率直接落在这一页里。
 */
const JUMP_PAGE_ROWS = 80

/** 进会话时等 readChat 顺带回模型目录的宽限（A）。宿主窗口缓存命中时页面几十
 *  毫秒就到，宽限内到齐就不再单独发 session.models；冷读时最多晚这么久才补取，
 *  补取仍与页面读取并行，所以冷读的体感没有变化。 */
const MODELS_EXTRAS_GRACE_MS = 120

/**
 * 宿主时钟校准保留多少个样本。样本被链路延迟压低，取最大值才接近真值；
 * 窗口滑动的意义是自愈 —— 一个离谱样本只影响它还在窗口里的那几次读数。
 */
const HOST_CLOCK_SAMPLE_WINDOW = 24

/**
 * 卡片缺席时回读日志的粒度与上限：每页消息数（与宿主 history 的默认页同量级）
 * 与最多翻几页。翻到那一轮的 turn/start 就停，所以多数会话只要一两页。
 */
const REPORT_FALLBACK_PAGE_MESSAGES = 25
const REPORT_FALLBACK_MAX_PAGES = 6

/** Props for the chat view. */
export interface ChatViewProps {
  session: SessionView
  /** The page-lifetime mux client (undefined before the first effect tick). */
  mux?: MuxClient | undefined
  onBack(): void
  /** Show tool-call disclosures (owned by the app, persisted via display-prefs). */
  showToolCalls: boolean
  /** Show injected system messages (owned by the app, persisted via display-prefs). */
  showSystemMessages: boolean
  /** Message event seq retained as a history paging fallback. */
  initialFocusSeq?: number
  /** Stable folded message identity for exact locate. */
  initialFocusMessageId?: string
  /** Stable text-part identity for exact locate. */
  initialFocusPartId?: string
  /** Query paired with the target: expands and marks the visible prose. */
  initialFocusQuery?: string
  /**
   * 别的会话刚跑完：画在顶部 HUD 里（**不弹底部浮层**）。
   *
   * 底部浮层会盖住输入框（`.finish-toast` 的 z-index 高于 `.chat-composer` 且同样钉底），
   * 而聊天页恰恰是唯一在打字的页面，所以这条信息在聊天页改走顶部。
   */
  finishedElsewhere?: { sessionId: string; title: string; status: 'done' | 'error' | 'stopped'; durationMs?: number } | undefined
  /** 点了这条：跳到那个会话。 */
  onOpenFinished?: ((sessionId: string) => void) | undefined
  /** 收起这条提示。 */
  onDismissFinished?: (() => void) | undefined
}

/**
 * Hard cap on live events buffered while the initial history tail page is in
 * flight. Beyond this the oldest buffered event is dropped and a follow-up
 * history tail re-pull closes the seam.
 */
export const MAX_TAIL_BUFFER_EVENTS = 500


/** Compact token count for the context meter: 800 → "800", 30k, 1.2M. */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

/** Lazy in-place model-catalog state for the quick picker strip. */
type ModelPickerCatalog =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SessionModels }

/** Compact model label for the pill: drop a provider-y prefix, keep the
 *  last two dash segments (x-preview-f-free → f-free, deepseek-v4-flash →
 *  v4-flash); short ids stay verbatim. The full id lives in the title. */
function compactModelName(id: string): string {
  const parts = id.split('-').filter(Boolean)
  return parts.length <= 2 ? id : parts.slice(-2).join('-')
}

/** Permission tone for the shield pill: read = neutral, write = accent,
 *  full access = danger (the human-vision status channel). */
function permissionTone(value: string): 'read' | 'write' | 'full' | undefined {
  if (value === 'danger-full-access') return 'full'
  if (value.includes('write')) return 'write'
  if (value.includes('read')) return 'read'
  return undefined
}

/**
 * 权限 pill 的可见短名。这个 pill 只有 32px 高、且和模型 pill 并排，完整值
 * （danger-full-access）会被省略号吃掉，剩 "danger-full-..."——用户看不到自己
 * 现在是哪一档。可见文本用中文短名，aria-label / title 仍保留完整值。
 */
function permissionShortLabel(value: string): string {
  const tone = permissionTone(value)
  if (tone === 'full') return '完全访问'
  if (tone === 'write') return '可写'
  if (tone === 'read') return '只读'
  return displayName(value)
}

/**
 * Distance from the bottom (px) within which streaming output still auto-follows.
 * A reader who scrolled farther up than this is left alone while new chunks
 * arrive.
 */
export const BOTTOM_FOLLOW_THRESHOLD_PX = 80
/** 内容高度差小于这个值不触发补钉（布局取整、行内 padding 都会带来 1~2px 抖动）。 */
const HEIGHT_DRIFT_PX = 24
/**
 * 缓存页至少要这么多行才配先上屏。
 *
 * 尾页一页 25 行，折叠成行后通常 12~20 行；不足这个数的缓存基本都是「上一次只看到
 * 开头」的半页，画上去必然被网络页整屏替换（= 闪一下）。
 */
const MIN_CACHE_TAIL_ROWS = 12
/**
 * 慢网兜底：这么久还没等到网络页，就把「半页缓存」先画出来。
 *
 * 快网（<800ms）走无闪路径：只画一次最终内容；慢网（隧道/大会话冷读）白屏 2 秒以上
 * 比闪一下更难受，所以退一步先给内容。
 */
const SLOW_NETWORK_CACHE_MS = 800
/** 交付卡补读只覆盖最近几轮：再往前的历史轮次不该在翻页时「长出来」。 */
const REPORT_RECOVERY_WINDOW_TURNS = 2

/** Pending-item poll cadence while the SSE stream is delivering (safety net only). */
export const PENDING_POLL_IDLE_MS = 15_000
/**
 * 断网横幅挂着的时候自己探宿主的周期。安卓上 `online` 事件经常不来（换基站、
 * 锁屏回来、5G 与流量切换），只靠事件横幅会一直挂着。
 */
export const OFFLINE_PROBE_MS = 5_000
/** 单次探测自己的上限：弱网"挂着"时不能跟着默认 60 秒一起卡死。 */
export const OFFLINE_PROBE_TIMEOUT_MS = 4_000
/** 同一条卡补读失败后多久再试：列表整份换掉时卡要靠它自己回来。 */
export const CARD_SYNC_COOLDOWN_MS = 3_000
/** Pending-item poll cadence while the SSE stream is stalled (fast coverage). */
export const PENDING_POLL_FAST_MS = 1_500
/** Host running-reconciliation cadence while the indicator is on (self-heals a lost turn/end). */
/**
 * 在跑时的**兜底**核对周期。运行状态的主来源是宿主在轮次边界主动推的
 * `session/status`（见 mobile-api 的 noteRunningFrame）—— 与桌面端同源，回合开始/
 * 结束那一刻手机就知道。这一条只防"边界帧被断流丢了"，所以只在 running 时跑；
 * 没在跑时完全不轮询（以前二十秒一次的 idle 探测已删，回合开始由推送叫醒）。
 */
export const RUNNING_RECONCILE_MS = 10_000
/** 尾页最后一条事件"多久算旧"：回合活着时事件不会停这么久，超过即认为那一轮
 *  已收工、只是 turn/end 帧丢了。真在跑的回合会被下一个事件翻回运行中，所以
 *  这个阈值宁短勿长——它只影响一次误判的时长，不影响正确性。 */
export const TURN_SILENCE_MS = 60_000
/** 状态仓里的快照多久算旧：超过就顺手催一次对账（不只是回合，队列/目标/待办一起吃新）。 */
export const SNAPSHOT_STALE_MS = 12_000

/** 没在跑的时候也要偶尔核对一次：断线期间开始的轮次不会自己冒出来。 */
/** 打开会话/回到前台后的一次性核对延迟：先让宿主推的 status 帧落地，再兜一次。 */
export const INITIAL_RECONCILE_MS = 2_500
/** Consecutive listSessions failures (each RUNNING_RECONCILE_MS apart) that
 * prove the host is unreachable - the process stopped or the link is down.
 * The reconciliation can only self-heal a lost turn/end while the host answers;
 * once it has been silent this long, the indicator can never clear on its own,
 * so drop it instead of showing 输出中 for a host that is no longer running. */
export const RECONCILE_FAILURE_LIMIT = 3
/** The turn clock (desktop parity) appears once the turn has clearly been
 * running this long; shorter turns keep the plain label. */
export const TURN_CLOCK_THRESHOLD_MS = 3_000
/** Composer draft debounce: localStorage writes wait this long after the
 *  last keystroke (unmount flushes immediately regardless). */
export const DRAFT_SAVE_DEBOUNCE_MS = 1_500
/** Ceiling for one "load older messages" request before it aborts and errors.
 *
 *  15 s 只够热宿主：宿主刚起来、或者这个大会话被换出内存之后，第一次锚定读
 *  （`session.history?beforeSeq=`）实测 44~60 s，尾页 17~109 s。超时一响就只剩
 *  空白聊天页，用户看到的就是「点了搜索结果，进去什么都没有」——所以这里给到
 *  90 s，宁可在真断网时多等一会，也不要稳定地失败。 */
export const LOAD_OLDER_TIMEOUT_MS = 90_000
/**
 * 进会话时静默铺开的上下文跨度（真机反馈：一进会话就挂着「加载更早的消息」，
 * 长会话要点很多次）。一页 25 行对长会话太短，所以进会话后连续补页，直到行数
 * 够看或者页数用完；每一页都是后台静默的，首屏不等它们。
 */
export const OPEN_HISTORY_TARGET_ROWS = 120
/** 进会话时最多连续补几页（4 页 ≈ 再铺开 100 行）。 */
export const OPEN_HISTORY_MAX_PAGES = 4
/** 读到这里以内就自动接上一页，不再非得点按钮（无限上翻）。 */
export const NEAR_TOP_LOAD_PX = 240

/** 定位落点：锚点距容器顶的留白（px），量级同桌面的 align(row, 24)。 */
/**
 * `@路径` 引用：含空白的路径用双引号包起来，其余原样。
 *
 * 这套系统的既定写法是 `@绝对路径`，解析端按空白切词，所以 `D:\my project\a.ts`
 * 会被切成 `@D:\my` —— 手机上点了文件却读不到，症状还很难看出来。
 */
export function quotePathForReference(path: string): string {
  return /\s/u.test(path) ? `"${path}"` : path
}

const LOCATE_TOP_GAP = 8
/** 定位判据的容差（px）：锚点进入「顶 + 留白」这个带内就算落位。 */
const LOCATE_TOLERANCE_PX = 2
/** 读回落点之后的增量补偿帧数上限（桌面是写一次 + 读回，这里多给两帧兜 clamp）。 */
const LOCATE_MAX_FIXES = 3

/* ── long sessions：已载入的行全渲染 ────────────────────────────────────
   这里原来是"行窗格 + 估高 spacer"的虚拟化：超过阈值只渲染滚动位置附近的行，
   上下用估算高度撑开。落点于是全是估出来的 —— 跳轮次永远差一截（真机「定位
   不到正确的位置上」）。

   现在照桌面的做法：**已载入的行全部渲染**，不可见行的布局/绘制交给 CSS 的
   content-visibility（浏览器会记住它自己布局过的真实高度，不是我们的估算）。
   未载入的更早历史只由一条固定高的「加载更早」按钮代表：它的高度是样式常数，
   所以"翻页之后目标轮就在顶部"可以直接写成 scrollTop = 0，全程不做高度估算。
   代价是首次进入深历史的渲染量变大，收益是落点变成精确值、滚动不再抖。 */
/**
 * Rows at the tail that always render with real layout (no content-visibility)
 * in the non-windowed path. The auto-follow reads `el.scrollHeight` to pin the
 * bottom; content-visibility substitutes `contain-intrinsic-size` estimates for
 * off-screen rows, which would make that height approximate and land the
 * follower off the true bottom. Keeping the last ~1.5 viewports real keeps the
 * follow exact while the rows above (history) skip layout/paint.
 */
export const CONTENT_VISIBILITY_KEEP_BOTTOM = 30
/** Older pages paged for a focus-locate before giving up (bounded IO). */
// Search can scan deep history (mobile-api SEARCH_MESSAGES_PAGES). Keep locate
// paging bounded, but large enough to reach any result that search can return.
export const FOCUS_MAX_PAGES = 4096

/** Estimated line height of one rendered message row (px). */
const ESTIMATE_LINE_HEIGHT = 22
/** Approximate CJK-friendly characters per line on a phone-width column. */
const ESTIMATE_CHARS_PER_LINE = 38
/** Rows a collapsed long message clamps to (matches chat-md-collapsed). */
const ESTIMATE_MAX_LINES = 12

/** Escape a value for use inside a quoted CSS attribute selector, safe on
 *  every runtime (no reliance on `CSS.escape`, which is missing in jsdom and
 *  some embedded webviews). Message ids carry only `"`/`\` that need it. */
function escapeAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}


/**
 * 一条排队消息要「连续多久没在宿主队列里出现」才算丢了。
 * 认领（离队）→ 回合开跑 → 对话帧到达，这一段在手机上往往要几秒；20 秒足够盖住它，
 * 又短到用户真丢了消息时能及时拿回原文。
 */
const LOST_ECHO_QUIET_MS = 20_000

/** 一张消息图片的估算高度（缩略图上限 + 间距，见 .chat-msg-image）。 */
const IMAGE_TILE_ESTIMATE = 220

/** Estimate one message row's rendered height in px (spacers use this). */
export function estimateMessageHeight(message: RenderMessage): number {
  if (message.kind === 'user') {
    const lines = Math.max(1, Math.ceil(message.text.length / ESTIMATE_CHARS_PER_LINE))
    // 图片是固定高的缩略图（.chat-msg-image 的 max-height）：按张数补高度，
    // 否则含图的行在窗口化路径里会被低估，滚动位置会跳。
    const imageHeight = (message.images?.length ?? 0) * IMAGE_TILE_ESTIMATE
    return 28 + lines * ESTIMATE_LINE_HEIGHT + imageHeight
  }
  let height = 20
  if (message.reasoning !== undefined && message.reasoning !== '') height += 32
  if (message.tools !== undefined && message.tools.length > 0) height += 28
  const text = message.text
  if (text === '') return height + 24
  const collapsed = !message.pending && text.length > LONG_TEXT_LIMIT
  const shownChars = collapsed ? LONG_TEXT_PREVIEW : text.length
  const lines = Math.max(1, Math.ceil(shownChars / ESTIMATE_CHARS_PER_LINE))
  height += Math.min(lines, ESTIMATE_MAX_LINES) * ESTIMATE_LINE_HEIGHT
  if (collapsed) height += 30
  return height + 16
}

/** One display-name transform for kebab-case machine names (web-UI parity). */
function displayName(name: string): string {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}


/**
 * Render one session's chat.
 * @param props - the session, the mux client, and the back action.
 * @returns the chat surface.
 */
export function ChatView({
  session,
  mux,
  onBack,
  showToolCalls,
  showSystemMessages,
  initialFocusSeq,
  initialFocusMessageId,
  initialFocusPartId,
  initialFocusQuery,
  finishedElsewhere,
  onOpenFinished,
  onDismissFinished,
}: ChatViewProps) {
  /**
   * 首页搜索点进来的定位意图：props 丢了也能落准（见 locate-intent.ts）。
   *
   * **只在挂载时取一次并标记消费**：以前每次渲染都重新读，意图还在 TTL 内的话，
   * 之后随便一次普通打开都会把它再捡起来，首屏直接取到那条老命中所在的一页 ——
   * 真机表现就是「一进会话自动跳到很老的一轮」。
   */
  const locateIntentRef = useRef(locateIntentFor(session.sessionId))
  const locateIntent = locateIntentRef.current
  useEffect(() => {
    // 挂载即消费：之后只有转场里的第二个实例（2 秒内）能复用它。
    takeLocateIntent(session.sessionId)
  }, [session.sessionId])
  useEffect(() => {
    // 打开过就不该再挂在运行中页的「刚结束」里（真机口径：只保留没点进去看过的）。
    forgetFinishedRun(session.sessionId)
  }, [session.sessionId])
  /** 高亮用的关键词：props 丢了就用意图里那份（否则只会滚、不会涂黄）。 */
  const effectiveFocusQuery = initialFocusQuery ?? locateIntent?.query
  // 第一帧就用上一场的内存快照：进会话不再“空一帧、再内容”（真机：进会话闪一下）。
  const [messages, setMessages] = useState<RenderMessage[]>(() => recallChatSnapshot(session.sessionId)?.rows ?? [])
  // Foreground gate for every poll on this view: a frozen background PWA must
  // not keep issuing RPCs (the stream and the host-side follow are released by
  // App's observe effect; returning resyncs them).
  const foreground = usePageVisible()

  /**
   * Surface-state wrapper for setMessages: coalesce consecutive same-turn
   * assistant step rows (each model step emits its own assistant/message —
   * a busy turn would otherwise fill a history tail page with step rows and
   * push the real prior conversation, code fences included, out of view).
   */
  /** 宿主最近返回的那一页原始行：定位要用它比对，不要用屏幕上合并过的列表。
   *  合并过的列表把相邻几页的行混在一起，文本匹配会先撞到一段只有几十字的相邻
   *  行上（真机：跳到一个空白的短行，明明搜索命中的正文就在附近）。
   *  一次点击会连着翻好几页（auto-extend 链），只存最后那一页会漏掉命中所在的页，
   *  所以这里攒住最近几页的行。 */
  const rawPageRef = useRef<RenderMessage[]>([])
  const rememberRawPage = (rows: readonly RenderMessage[]): void => {
    const seen = new Set(rows.map(row => row.id))
    const kept = rawPageRef.current.filter(row => !seen.has(row.id))
    rawPageRef.current = [...rows, ...kept].slice(0, 400)
  }

  const applyMessages = (rows: RenderMessage[]): void => {
    // 换列表时把已经画出来的「本轮产出」带走：页自己不带报告行，换一次卡片就闪没
    // 一次（真机：「点进会话，卡片突然又消失了」）。
    // 页更权威但更穷（参数被剥、不带报告行）：同身份的行取两边并集，别把屏幕上
    // 更全的那份换成残缺版 —— 真机「拉历史的时候闪一下」就是这一步造成的。
    rememberRawPage(rows)
    commitRows(rows)
  }

  const [hasOlder, setHasOlder] = useState(false)
  /**
   * 列表的**唯一**提交入口。
   *
   * 约定（三条，都是踩过坑换来的）：
   *  1. 一切内容变化都经过这里，不要各处直接 `setMessages` —— 否则「折叠 → 补卡 → 合并」
   *     这三步总有地方漏做，真机上就是重复的过程条、凭空的卡片、正文往回缩。
   *  2. 合并用并集（`preferRicherRows`）：页常常比屏幕上的那份更穷（参数被剥、不带报告行），
   *     同身份的行取两边更全的那份，绝不把完整版换成残缺版。
   *  3. 交付卡要先 `keepTurnReports`：新一页里没有上一轮的报告行，但卡不能跟着消失。
   *
   * @param rows - 这一拍要展示的行（可以直接给「相对上一份」的函数）。
   * @param options.merge - 与当前列表做并集（默认 true）；false 表示整份替换。
   * @param options.allowGuessedTails - 允许按工具行「猜」交付卡（历史页传 false）。
   */
  /**
   * 现场调试钩子：地址带 `?debug=1` 时，把当前渲染的行挂到 window 上。
   *
   * 「卡里有重复过程项」这种问题，只看 DOM 分不清是工具条目重复还是 flow 部件重复，
   * 得把合并后的 rows 原样取出来看。没有这个参数时只多一次空判断，不产生副作用。
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!new URLSearchParams(window.location.search).has('debug')) return
    ;(window as unknown as { __palmRows?: unknown }).__palmRows = messages
  }, [messages])

  const commitRows = useCallback((
    rows: readonly RenderMessage[] | ((previous: readonly RenderMessage[]) => readonly RenderMessage[]),
    options: { merge?: boolean; allowGuessedTails?: boolean } = {},
  ): void => {
    const merge = options.merge !== false
    const allowGuessedTails = options.allowGuessedTails !== false
    setMessages(previous => {
      const raw = typeof rows === 'function' ? rows(previous) : rows
      const next = renderRows(keepTurnReports(previous, raw), allowGuessedTails)
      const merged = merge ? preferRicherRows(previous, next) : next
      // 现场取证：真机上偶尔还会出现「同一轮两张卡」。与其继续猜，不如在它真的发生时
      // 把当时的行数据存到宿主（每个会话 1 分钟最多一次，失败静默）。
      reportDuplicateCards(session.sessionId, merged, report => {
        void reportError(report, 'duplicate-cards').catch(() => {})
      })
      return merged
    })
  }, [session.sessionId])
  // 「离开聊天即清」：定位意图只在这一次进入里有效。转场里聊天页会短暂挂两个实例，
  // 所以卸载后留 2 秒宽限、新实例挂载即取消；真离开则宽限到点清掉，不会残留到
  // 下一次普通打开（早先 20 秒 TTL 会让「刚看完命中又点回来」莫名再跳一次）。
  useEffect(() => {
    holdLocateIntent(session.sessionId)
    return () => { releaseLocateIntent(session.sessionId) }
  }, [session.sessionId])
  // 每次列表变了就把"这一场当前画的样子"记进内存快照，供下次进会话第一帧直接铺。
  useEffect(() => {
    rememberChatSnapshot(session.sessionId, messages, hasOlder)
  }, [session.sessionId, messages, hasOlder])
  // Latest loadOlder (the tail-load effect's closure is stale by the time the
  // page lands); the auto-extend on open calls through this ref. Assigned
  // after the useCallback below (TDZ).
  const loadOlderRef = useRef<(silent?: boolean, beforeSeq?: number, chain?: boolean, maxRows?: number) => void>(() => {})
  /** 「下一条命中」那一页的预取缓存：键 = beforeSeq，取用一次就删。 */
  const pageCacheRef = useRef(new Map<number, Awaited<ReturnType<typeof loadChatPage>>>())
  // One silent auto-extend chain per session open (see the tail-load effect).
  const autoExtendedRef = useRef(false)
  // 这一轮"进会话铺开"已经补了几页（每开一次会话归零）。
  const openChainPagesRef = useRef(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [input, setInput] = useState(() => loadDraft(session.sessionId))
  // Live mirror of `input` for the unmount draft flush (the cleanup closure
  // must read the CURRENT text, not the one its render captured).
  const inputRef = useRef(input)
  inputRef.current = input
  const [sending, setSending] = useState(false)
  // Live mirror of `sending` for the back handler (a stale closure must not
  // treat an in-flight send as "nothing sent yet" and revoke the session).
  const sendingRef = useRef(sending)
  sendingRef.current = sending
  const scrollRef = useRef<HTMLDivElement | undefined>(undefined)
  const pendingRef = useRef(false)
  /** 一页在飞时被挡下的翻页请求（落地后补发，别把点击丢掉）。 */
  const queuedOlderRef = useRef<{ beforeSeq?: number } | undefined>(undefined)
  // Live mirror of `messages`：回调可能在很久之后才跑（首帧 rAF 甚至晚于尾页
  // 落地），所以它们必须读当前列表，不是闭包创建时的那一份。
  const messagesRef = useRef(messages)
  const scrollTopRef = useRef(0)
  /**
   * True while a programmatic scroll (the opening tail pin, the locate, a
   * prepend anchor correction) is in flight, so handleScroll can tell it apart
   * from a user gesture: the FIRST scroll event consumes the flag, and that
   * event may neither release the locate lock nor record a reading bookmark —
   * it is the echo of a write, not the reader leaving the bottom.
   */
  const programmaticScrollRef = useRef(false)
  /** 最近一次手指接触屏幕的时刻（判断「这次滚动是不是读者造成的」）。 */
  const lastTouchAtRef = useRef(0)
  /** 我们写进去的 scrollTop 与写入时刻：用来认领「这次 scroll 事件是我们自己造成的」。 */
  const programmaticValueRef = useRef(-1)
  const programmaticAtRef = useRef(0)
  /**
   * 滚动策略的唯一真源（见 `scroll-machine.ts`）。
   *
   * 以前这里并排躺着 `gestureUntil`／`locateLock`／`suppressFollowUntil`／`bottomGapAtUserScroll`／
   * `userScrolled`／`followedBottom` 六个 ref，每处判断都要凑齐其中三四条，漏一条就是真机上的
   * 「抢手势」「不落底」「卡片闪」。现在只往这台机器里投事件、只问它三个问题：
   * `mayAutoPin`（新内容到达要不要跟）、`maySettlePin`（布局还在长高要不要补钉）、
   * `state.gap`（离底部多远）。
   */
  const scrollStateRef = useRef<ScrollState>(createScrollState())
  const scrollEvent = useCallback((event: ScrollEvent): void => {
    scrollStateRef.current = scrollReducer(scrollStateRef.current, event)
  }, [])
  /**
   * 会话状态机：三根条的**唯一判据**（不再是影子，渲染完全由它决定）。
   *
   * 迁移期曾用它做旁路对照（只比较、不改行为）；判据对齐后已接管渲染，
   * 对照代码随之删除 —— 留着两套判据才是新隐患。
   */
  const shadowStatusRef = useRef<SessionStatus>(createSessionStatus())
  /** 三根条「该显示什么」的唯一来源（来自 `session-status.ts` 的 `describeBars`）。 */
  const [bars, setBars] = useState<BarsView>(() => describeBars(createSessionStatus(), Date.now()))
  const barsSignatureRef = useRef('')
  const shadowEvent = useCallback((event: StatusEvent): void => {
    shadowStatusRef.current = sessionStatusReducer(shadowStatusRef.current, event)
    // 单向发布：运行中页 / 首页徽标读同一份结论，不再各自拿花名册猜。
    dispatchStatusEvent(session.sessionId, event)
  }, [session.sessionId])
  /**
   * One deferred re-follow after the silent auto-extend prepend (open-time
   * older page). The old implementation re-followed from a rAF that reads
   * `el.scrollHeight` — but on a real browser the rAF can run BEFORE React
   * commits the prepended rows (each heavy row is expensive to render), so
   * the follow read the STALE height, pinned to the old tail, and — with the
   * prepend committed on top of it — the view stranded mid-history with no
   * corrector left (the stream follower key is unchanged by a prepend, the
   * windowed re-pin effect is gated on `windowed`, and the correction effect
   * returns on a missing prefix). Pinned instead by the commit-time effect
   * below, where the DOM already contains the new rows.
   */
  const followAfterPrependRef = useRef(false)
  /**
   * 手动翻页的锚点补偿：commit 后用**真实 scrollHeight 差值**把视野钉住。
   *
   * 以前用 estimateMessageHeight 累加估算，长卡片/代码块一多就偏（实测同一行被
   * 推开 1895px，等于翻一页就丢了刚才在看的地方）。高度只有渲染完才知道，所以
   * 记下翻页前的高度，提交后量差值。
   */
  const prependAnchorRef = useRef<{
    top: number
    height: number
    rowId?: string
    rowTop?: number
    rowSeq?: number
  } | undefined>(undefined)
  // The bottom gap at the USER's last gesture (recorded on every scroll
  // event). Passive content growth — a pending message finalizing into
  // taller markdown, an appended reply — changes scrollHeight without firing
  // a scroll event, so this snapshot keeps its gesture-time truth: the
  // follower never mistakes a content-driven height change for "user scrolled
  // up". Programmatic writes (scrollToBottom) land at the bottom (gap 0) and
  // are equally harmless.

  messagesRef.current = messages
  /**
   * True while the initial tail page is in flight. Live events arriving in
   * that window go to {@link liveBufferRef} instead of the message list: the
   * tail load replaces the list wholesale, so a directly folded event would
   * flash once, be discarded by the snapshot, and then be skipped forever by
   * the seq watermark.
   */
  const tailLoadingRef = useRef(true)
  /** Live session events buffered while the initial tail page loads. */
  const liveBufferRef = useRef<WireEvent[]>([])
  /** Incremental folder for this session's stream (indexes stay hot across events). */
  const folderRef = useRef<EventFolder | undefined>(undefined)
  /**
   * rAF micro-batch for live message events. SSE `onmessage` is a separate
   * macrotask per frame, so folding each event straight into `setMessages`
   * triggers one React reconcile per chunk — a fast model + many tool calls
   * can push 30+ reconciles/sec. Events are buffered here and folded together
   * on the next animation frame (one reconcile per frame, ~60/s). The fold is
   * incremental and seq-idempotent, so batching is safe; the auto-follow only
   * lags by one frame (~16ms), which is imperceptible. Non-message frames
   * (jobs/queue/approvals) and the turn/start·end·todo side-effects stay
   * immediate.
   */
  const eventBatchRef = useRef<WireEvent[]>([])
  const eventFlushRafRef = useRef<number | undefined>(undefined)
  /** Schedule one rAF flush of the buffered message events (idempotent). */
  const scheduleEventFlush = useCallback((): void => {
    if (eventFlushRafRef.current !== undefined) return
    eventFlushRafRef.current = requestAnimationFrame(() => {
      eventFlushRafRef.current = undefined
      const batch = eventBatchRef.current
      eventBatchRef.current = []
      if (batch.length === 0) return
      const folder = folderRef.current
      // Opt-in perf mark: decode/fold/coalesce done, state update about to
      // schedule (span recv→state measures the whole client pipeline). The
      // batch is stamped with its newest event's seq.
      const last = batch[batch.length - 1]
      perfMark('state', { seq: last?.seq, frame: 'session/event', detail: `batch:${batch.length}` })
      // 实时折叠的基线是 EventFolder 的快照，而它只装"页给的行"：日志补回来的报告
      // 行不在里面。以前这一步直接覆盖，于是**下一条消息一来**（用户发送、宿主推帧），
      // 上一轮的交付物卡就被快照吃掉 —— 真机「发送完当前消息，上一条的卡消失」。
      commitRows(previous => (folder === undefined ? foldEvents(batch, previous) : folder.fold(batch)))
    })
  }, [])
  /** True once the live buffer hit its cap (oldest events were dropped). */
  const liveBufferOverflowRef = useRef(false)
  /** Seq window of the events dropped from the tail-load buffer (refill). */
  const dropWindowRef = useRef<{ from: number; to: number } | undefined>(undefined)
  /** Monotonic reload epoch: only the newest reloadTail lands. */
  const reloadEpochRef = useRef(0)
  /** Abort the previous reloadTail when a new one starts (no cross-resolve). */
  const reloadControllerRef = useRef<AbortController | undefined>(undefined)

  /** The session's permission select (absent = capability not composed). */
  const [permissions, setPermissions] = useState<PermissionSelectValue | undefined>(undefined)
  /** Host context-pressure projection (token-meter): the authoritative
   *  per-session occupancy source. Fed by the history baseline and live
   *  session/projection frames; `undefined` until the first data lands. */
  const [contextPressure, setContextPressure] = useState<ContextPressureData | undefined>(undefined)
  /** The current model selection for the toolbar chip (best-effort label). */
  const [currentModel, setCurrentModel] = useState<{ provider: string; model: string; reasoningEffort?: string } | undefined>(undefined)
  /** Set when the user picked a preset that needs an explicit confirm (full access). */
  const [pendingPermission, setPendingPermission] = useState<string | undefined>(undefined)
  /** File path awaiting in-chat preview (a .file-link tap without a host opener). */
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  /** In-chat <img> source opened in the full-screen lightbox (tap-to-view). */
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  /** Which in-place quick picker strip is open below the toolbar. */
  const [picker, setPicker] = useState<'model' | 'permission' | null>(null)
  /** Whether the context-usage popover (ring tap) is open. */
  const [contextOpen, setContextOpen] = useState(false)
  /** In-flight guard for one-shot picker actions. */
  const [pickerBusy, setPickerBusy] = useState(false)
  /** Lazily cached model directory backing the quick picker (fresh per open
   *  until it loads once; the full sheet re-fetches on its own). */
  const [modelCatalog, setModelCatalog] = useState<ModelPickerCatalog>({ status: 'idle' })
  /** Whether the composer's + menu is open (图片 / 命令). */
  const [plusOpen, setPlusOpen] = useState(false)
  /** 「电脑文件」选择面板：手机上系统选择器只给相机相册时，从这里挑宿主机上的文件。 */
  const [hostFileOpen, setHostFileOpen] = useState(false)
  /** The slash-command sheet, opened straight from the composer. */
  const [commandOpen, setCommandOpen] = useState(false)
  /**
   * 已认领的命令名（桌面端那颗蓝色 chip）。
   *
   * 桌面端从命令菜单选一条命令，是把命令词作为 chip **填进输入框**，光标跟在后面
   * 等参数（`/目标` + 空格 + 目标内容），而不是立刻执行。手机端原来选中即执行，
   * 于是带参数的命令（`/goal`、`/plan`…）根本没机会填参数。这里保存命令名，输入框
   * 只留参数部分，发送时再拼回去。
   */
  const [claimedCommand, setClaimedCommand] = useState<string | undefined>(undefined)
  /** Images picked or pasted into the composer, awaiting send (community-style attach). */
  const [attachImages, setAttachImages] = useState<AttachedImage[]>([])
  /** Live mirror of attachImages for the async addImage cap check (no stale closure). */
  const attachImagesRef = useRef(attachImages)
  useEffect(() => { attachImagesRef.current = attachImages }, [attachImages])
  /** 已交给宿主暂存、等着随下一条 prompt 发出去的附件（receiptId + 展示名）。 */
  /**
   * 待发附件（桌面端 composer 那颗 chip 的复刻）。
   *
   * 为什么本地先立一条：宿主上传是一整个 base64 往返，隧道里一张 20 MB 的文件要
   * 几十秒。以前只有**上传成功之后**才往列表里放 —— 用户选完文件，发送框一片空白，
   * 看起来就像"附件没加进去"（真机反馈）。现在选完立刻挂一条 uploading 的 chip，
   * 成功转 ready、失败转 failed（点一下重传），发送框始终反映用户选了什么。
   */
  const [attachFiles, setAttachFiles] = useState<StagedFile[]>([])
  /** 正在上传的附件个数：>0 时先别发，免得发出一条缺附件的消息。 */
  const [uploadingFiles, setUploadingFiles] = useState(0)
  const attachFilesRef = useRef(attachFiles)
  useEffect(() => { attachFilesRef.current = attachFiles }, [attachFiles])

  /**
   * Composer draft persistence: debounced writes while typing (a keystroke
   * must not hit localStorage every key), an immediate flush on unmount /
   * session switch, and removal once the text is sent (or emptied). The
   * draft survives chat round-trips and PWA cold starts, per session.
   */
  useEffect(() => {
    if (input === '') {
      removeDraft(session.sessionId)
      return
    }
    const id = setTimeout(() => { saveDraft(session.sessionId, input) }, DRAFT_SAVE_DEBOUNCE_MS)
    return () => { clearTimeout(id) }
  }, [input, session.sessionId])
  useEffect(() => {
    return () => {
      // Unmount / session switch: flush the CURRENT text immediately (the
      // debounce timer may never fire if the view is torn down first).
      if (inputRef.current !== '') saveDraft(session.sessionId, inputRef.current)
    }
  }, [session.sessionId])
  /** 上一次点出来的文件选择框节点：下一次打开前先摘掉，避免节点堆积。 */
  const pickerInputRef = useRef<HTMLInputElement | null>(null)
  /** 输入框元素句柄：认领命令后把焦点移到参数区。 */
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  /** Host slash-command directory (fetched lazily when the + menu opens). */
  const [commands, setCommands] = useState<CommandDescriptor[] | undefined>(undefined)
  /** 上一次拉命令目录的时刻：失败后 3 秒内不重复打宿主。 */
  const commandFetchAtRef = useRef(0)
  /** Quoted message (context bar above the composer; sent as a blockquote preamble). */
  const [quoted, setQuoted] = useState<string | undefined>(undefined)
  /** Whether the composer holds focus (quick-command bar shows with the keyboard). */
  const [composerFocused, setComposerFocused] = useState(false)
  /**
   * 是否连不上宿主。判据不是 `navigator.onLine`（安卓上它会一直停在 false），
   * 而是"最近一次真实请求有没有答话"——见 rpc.ts 的连通性总线；断着的时候每 5 秒
   * 自己探一次，答话就恢复。
   */
  const [offline, setOffline] = useState(false)
  const [queuedCount, setQueuedCount] = useState(0)
  /** The queued outbox entries (banner lets the user remove one at a time). */
  const [queuedEntries, setQueuedEntries] = useState<OutboxEntry[]>([])
  /** Voice recording sheet + the live recorder handle and its phase. */
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voicePartial, setVoicePartial] = useState('')
  const [voicePhase, setVoicePhase] = useState<'recording' | 'transcribing'>('recording')
  const voiceRef = useRef<VoiceRecording | undefined>(undefined)
  /** 波形元素：响度直接写进它的 CSS 变量，免得每 85ms 触发一次整页重渲染。 */
  const voiceWaveRef = useRef<HTMLDivElement | null>(null)
  /** 「完成」按钮与打开前的焦点：面板打开把焦点送进来，关掉还回原处。 */
  const voiceDoneRef = useRef<HTMLButtonElement | null>(null)
  const voiceReturnFocusRef = useRef<HTMLElement | null>(null)
  /** 已录秒数：面板上给一个看得见的节奏，别只有一句「正在听...」。 */
  const [voiceElapsed, setVoiceElapsed] = useState(0)
  const voiceStatus = voiceStatusText(voicePhase, voicePartial, voiceElapsed)
  /** 每次打开/关闭都换一个代号：面板关掉之后回来的转写结果按代号丢弃。 */
  const voiceRunRef = useRef(0)
  /** True while the chat is mounted; guards async voice callbacks after unmount. */
  const mountedRef = useRef(true)
  /** Pinch-zoom state for code blocks (one active gesture at a time). */
  const pinchRef = useRef<{ block: HTMLElement; dist0: number; scale0: number } | undefined>(undefined)
  /**
   * Composer preference from the plugin's host settings (default true keeps
   * the legacy Enter-to-send behavior until the preference loads).
   */
  const [mobileEnterToSend, setMobileEnterToSend] = useState(true)
  /** Whether the assistant is currently generating (turn/start..turn/end). */
  const [running, setRunning] = useState(false)
  /** 同值的 ref 镜像：send() 的成功回调要知道"这条消息是排队发出去的"，但它不该
   *  因为每轮 running 翻转就重建（回调里的闭包会过期，而重建会让输入区的 onKeyDown
   *  在回合切换的瞬间拿到旧 send）。 */
  const runningRef = useRef(running)
  runningRef.current = running
  /**
   * 当前活跃轮次的**轮号**（turn/start 帧里带回来的那一个）。它与 {@link running}
   * 同生同灭：凡是写 running 的地方都一起写这里（帧里的 turn/start、turn/end、
   * 名单/尾页锚点的恢复、reconcile 探针、steer 被拒），所以行级判据看到的活跃
   * 轮次永远就是底部状态行看到的那一轮。轮号缺席（中途重开时 running 是从名单
   * 或尾页锚点恢复的，手上没有那一帧）时由 {@link liveTurn} 退回折叠里的最新一轮。
   */
  const [runningTurn, setRunningTurn] = useState<number | undefined>(undefined)
  /**
   * 被宿主放弃的回合（重启/被杀/断流，turn/end 永远没来）。
   *
   * 之前这种回合会在 reconcile 判停后落到 `ok` 分支：卡片显示「已完成 ✅ 用时 X」，
   * 正文却是断在半句的 partial 或者空白 —— 假成功，桌面端同一轮是中断态。这里把
   * 它记下来，渲染时给整轮盖上 maxTokens（已有的「已中断」通道），文案与桌面端一致。
   */
  const [abandonedTurn, setAbandonedTurn] = useState<number | undefined>(undefined)
  /** 渲染前给被打断的那一轮盖「已中断」标记（见 abandonedTurn）。 */
  const rowOfInterrupted = (message: RenderMessage): RenderMessage => (
    abandonedTurn !== undefined && message.turn === abandonedTurn && message.maxTokens !== true
      ? { ...message, maxTokens: true }
      : message
  )

  /** Pending-message queue for this session (desktop QueueDock equivalent),
   *  seeded from the mux's retained snapshot so a freshly opened chat shows
   *  messages queued before it mounted. */
  /**
   * 当前目标（桌面端 composer 上方那条 goal 指示条的复刻）。
   * undefined = 还没读到；null = 没有目标 / 已完成 —— 两种情况都不渲染条子。
   */
  const [goal, setGoal] = useState<MobileGoal | null | undefined>(undefined)
  /** 目标命令在途中：四个按钮同时置灰，避免连点发出两条 /goal。 */
  const [goalBusy, setGoalBusy] = useState(false)

  const [queueItems, setQueueItems] = useState<QueueItemView[]>(() => {
    // 先用状态仓里的缓存秒开（重进会话不空白），没有再退回 mux 保留的那份。
    const cached = queueView(session.sessionId)
    return cached.length > 0 ? cached : (mux?.cachedQueueFor(session.sessionId) ?? [])
  })
  /** 有排队项在屏幕上：轮询要加密（长度而不是数组本身进依赖，免得每次刷新都重建定时器）。 */
  const hasPendingQueue = queueItems.length > 0
  /**
   * 宿主的待发投影（`inbox.next-turn`）就是"排队等下一轮"的那些消息 —— 桌面端
   * QueueDock 读的也是它。手机端此前只等一条 `session/queue` 帧，而宿主从不发这个
   * 帧（它只发投影帧），所以无论排几条，手机上那张卡片都不会出现。
   */
  const applyInbox = useCallback((value: unknown): void => {
    const rows = (value as { 'next-turn'?: unknown } | null | undefined)?.['next-turn']
    if (!Array.isArray(rows)) return
    const items = rows.map((row, index) => queueItemViewOf({
      id: typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : String(index),
      placement: 'queued',
      message: row as { content?: unknown },
    }))
    // 老宿主只回 inbox 投影：把它当成一次"队列快照"进仓，界面仍然只有一个来源
    // （否则本地一隐藏某条，订阅者按空快照重算，排队条会闪一下再被填回来）。
    applyQueueItems(session.sessionId, items)
    startTransition(() => { setQueueItems(queueView(session.sessionId)) })
  }, [session.sessionId])
  /**
   * 立刻向宿主问一次排队快照（投影帧在手机上到不了，这是唯一可靠来源）。
   *
   * 只有刚改过队列时才要求 fresh：那一次宿主会现开一帧 follow 取当下投影；
   * 平时的 5 秒轮询走快照，否则每条排队消息都会拖着一次整日志读。
   */
  const refreshInbox = useCallback((options: { fresh?: boolean } = {}): void => {
    // 失败重试一次。宿主快照是手机上唯一可靠的队列来源（宿主的投影帧到不了），
    // 一次隧道抖动就把它丢掉，界面上就会留一张既不会走、也删不掉的旧卡片。
    const fallback = (retry: boolean): void => {
      // 老宿主没有 `mobile.sessionState`（或者这条通道这次读失败）：退回 inbox
      // 投影。队列显示得旧一点，总比整条队列消失好 —— 版本无关的底线。
      void inboxOf(session.sessionId, options).then(
        (value) => { if (mountedRef.current) applyInbox(value.inbox) },
        () => { if (retry && mountedRef.current) window.setTimeout(() => { ask(false) }, 400) },
      )
    }
    const ask = (retry: boolean): void => {
      if (typeof sessionState !== 'function') { fallback(retry); return }
      void sessionState(session.sessionId, options).then(
        (snapshot) => {
          if (!mountedRef.current) return
          // 快照进状态仓（行/队列/回合一起对齐），队列视图再从仓里取 —— 界面只有一个
          // 权威来源，乐观项与权威值不会互相覆盖（见 session-store.ts）。
          applySnapshot(snapshot)
          setQueueItems(queueView(session.sessionId))
          // 目标与待办跟着同一份快照落地：以前目标条要靠自己的 15/20 秒轮询，
          // 电脑上改了目标手机上要等十几秒；现在跟着聊天本身的对账节奏（1.5~8 秒）走，
          // 而且和回合状态同一切面，不会出现「目标说进行中、回合已结束」。
          if ('goal' in snapshot) applyGoalRef.current(snapshot.goal, snapshot.goalActivation)
          if (snapshot.todo !== undefined) adoptTodoRef.current(snapshot.todo)
        },
        () => { fallback(retry) },
      )
    }
    ask(true)
  }, [session.sessionId, applyInbox])
  /**
   * 目标 / 待办的落地函数在下面才定义（refreshInbox 要先声明）：用 ref 转一手，
   * 免得为了它们把整个回调挪位置、再牵动依赖数组。
   */
  const applyGoalRef = useRef<(value: unknown, activation?: 'armed' | 'disarmed') => void>(() => {})
  const adoptTodoRef = useRef<(next: { seq: number; items: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> }) => void>(() => {})

  /**
   * 状态仓的订阅：别的入口（发送/插队/删除的乐观项、快照落地）改了队列，这里同步一次。
   * 订阅按 sessionId 过滤，同一时刻只有当前会话会重渲染。
   */
  useEffect(() => {
    const unsubscribe = subscribeSessionStore((changed) => {
      if (changed !== session.sessionId || !mountedRef.current) return
      setQueueItems(queueView(session.sessionId))
    })
    return unsubscribe
  }, [session.sessionId])
  /** 帧回调里要"立刻问一次宿主"（turn/start 清空队列之后）：走 ref，免得为它重订阅事件流。 */
  // 排队消息对账：只有证据毫无歧义时才把原文放回输入框。
  // 「不在队列里」本身不能说明问题 —— 宿主把消息认领成下一轮的那一刻它就离开队列，
  // 而证明送达的对话帧要晚几秒才到。所以三个条件全满足才算丢：①已经有一阵没在队列
  // 里出现（20 秒，时间基准用最后一次「看见它在队列里」，不是排队时刻）；②对话里
  // 始终没有它；③当前没有任何回合在跑。少了第③条，认领中的消息就会被当成丢失，
  // 明明发出去了又退回到输入框。
  useEffect(() => {
    const echoes = readQueuedEchoes()
    if (echoes.length === 0) return
    const delivered = new Set(messages.filter(message => message.kind === 'user').map(message => message.text))
    const queuedTexts = queueItems.map(item => item.text)
    for (const echo of echoes) {
      // 已经进了对话：这条排队已经送达，删掉本地底稿。
      if (delivered.has(echo.text)) { forgetQueuedEcho(echo.sessionId, echo.text); continue }
      // 还在队列里：记下「这一刻它还在排队」，后面的判据以它为准。
      if (queuedTexts.some(text => normalizeEchoText(text) === normalizeEchoText(echo.text))) {
        markQueuedEchoSeen(echo.sessionId, echo.text, Date.now())
      }
    }
    // 有回合在跑：认领、送达、对话帧都在路上，任何一条现在都不能判丢失。
    // 用 roster 上的 running 兜底：进会话的第一帧里 running 状态还没建起来，只看本地状态会漏。
    if (running || session.running === true) return
    const first = lostQueuedEchoes(
      readQueuedEchoes(),
      session.sessionId,
      queuedTexts,
      [...delivered],
      { now: Date.now(), quietMs: LOST_ECHO_QUIET_MS },
    )[0]
    if (first === undefined) return
    forgetQueuedEcho(first.sessionId, first.text)
    setInput(previous => (previous.trim() === '' ? first.text : previous))
    toast('这条排队消息没能送达，已放回输入框')
  }, [queueItems, messages, session.sessionId, running, session.running])

  // 队列非空时加密到 2 秒：这时候屏幕上正挂着用户刚排的那几条，宿主一投递、
  // 一删除，手机必须马上跟上。空了就退回常规节奏 —— 没有卡片要看，问得再勤
  // 也只是白烧一次隧道往返。
  useEffect(() => {
    refreshInbox()
    const timer = window.setInterval(() => {
      if (!document.hidden) refreshInbox()
      // 有排队项时 1.5 秒对一次（宿主投递走的不是帧，只能问）；跑着时 3 秒；
    // 空闲 8 秒。写操作本身已经即时生效（乐观项 + 回执），这里只负责收敛。
  }, hasPendingQueue ? 1500 : running ? 3000 : 8000)
    // 从后台切回来立刻对一次：息屏那段时间的帧全丢了。
    const onVisible = (): void => { if (!document.hidden) refreshInbox() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [running, refreshInbox, hasPendingQueue])
  /**
   * 目标投影 → 目标条状态。宿主线上形状是 `{ current }`，解析在 parseGoalProjection 里；
   * 已完成/已清除/空目标一律落成 null（条子消失），与桌面端 GoalBar 同一规则。
   */
  const applyGoal = useCallback((value: unknown, activation?: 'armed' | 'disarmed'): void => {
    const parsed = parseGoalProjection(value, activation)
    startTransition(() => { setGoal(parsed) })
  }, [])
  applyGoalRef.current = applyGoal

  /**
   * 打开会话先问一次。目标只在手机上点动作时改变，所以这里不带 fresh：读花名册快照
   * 就够，省掉一次现开 follow（那条路会和聊天读抢宿主）。
   */
  const refreshGoal = useCallback((options: { fresh?: boolean } = {}): void => {
    void goalOf(session.sessionId, options).then(
      (value) => { if (mountedRef.current) applyGoal(value.goal, value.activation) },
      () => undefined,
    )
  }, [session.sessionId, applyGoal])

  useEffect(() => {
    // 只兜这一次：目标现在随 `mobile.sessionState` 的原子快照一起回来（和回合状态
    // 同一时刻），不再自己开 15/20 秒的轮询 —— 那既慢（电脑上改了要等十几秒）又和
    // 回合状态不同步。这里留着是为了**老宿主**（快照里没有 goal 字段）仍然能显示。
    refreshGoal()
  }, [refreshGoal])
  /**
   * The running turn's logged `turn/start` event time (epoch ms), the turn
   * clock's anchor (desktop parity). Null while no turn is open or when the
   * boundary fell outside the loaded window — the clock then falls back to
   * the view's mount time, exactly like the desktop TurnStatus.
   */
  const [turnStartAt, setTurnStartAt] = useState<number | null>(null)
  /** 当前计时锚点的即时值（effect 里要判断「锚点是不是过期了」）。 */
  const turnStartAtRef = useRef<number | null>(null)
  useEffect(() => { turnStartAtRef.current = turnStartAt }, [turnStartAt])
  /** Turn-clock mount fallback (see turnStartAt). */
  const mountTimeRef = useRef(Date.now())
  /** Host−phone clock delta, calibrated by every live frame (see onFrame). */
  const hostClockOffsetRef = useRef(0)
  /** 最近几次校准样本（宿主事件时间 − 收到时的本机时间），只留最后这一小撮。 */
  const hostClockSamplesRef = useRef<number[]>([])
  /** 权限投影补给进行中（按钮可以连点）。 */
  const permissionPullRef = useRef(false)
  /** 本会话最后一次真的送来事件流的时间。只有本会话的 session/event 才算数
   *  （心跳和别的会话的帧不算），所以它不会因为链路空闲就被刷新。 */
  const lastSessionEventAtRef = useRef(0)
  /** 一次只跑一个运行状态核对（重连基线帧与定时器会同时想查）。 */
  const reconcileInFlightRef = useRef(false)
  /** 连续几次核对拿不到宿主答复（宿主进程没了/链路断了）。 */
  const reconcileFailureRef = useRef(0)
  /** 组件是否还挂着：核对是异步的，回来时可能已经换页。 */
  const aliveRef = useRef(true)
    /** Sustained host silence (RECONCILE_FAILURE_LIMIT failed roster reads):
   * the live channel is gone and nothing local can prove the turn ended. The
   * clock and its anchor are deliberately KEPT - a phone that switched
   * networks or woke from a locked screen must not lose the elapsed time it
   * was watching - and only the wording changes until an answer (or a live
   * frame) comes back. */
  const [hostLost, setHostLost] = useState(false)
  /** Latest `session/jobs` snapshot for this session (background tasks the
   * parent owns: subagent delegations, bash/pwsh runs, …). The host pushes a
   * full snapshot after every registry commit; empty = no tasks. The initial
   * value replays the mux client's cached snapshot so tasks already running
   * when this chat opens are visible immediately (the mux baseline arrives at
   * app boot, before any chat is mounted). */
  const [jobs, setJobs] = useState<JobView[]>(() => mux?.cachedJobsFor(session.sessionId) ?? [])
  /** Latest `todo/write` snapshot for this session (the plan strip above the
   * newest message). Adoption is last-write-wins by seq: history pages and
   * live frames can race, and an older page must never clobber a newer live
   * snapshot. Cleared on turn/start (the host clears the projection there). */
  const [todo, setTodo] = useState<TodoSnapshot | undefined>(undefined)
  const adoptTodo = useCallback((next: TodoSnapshot | undefined): void => {
    if (next === undefined) return
    setTodo(previous => (previous !== undefined && next.seq <= previous.seq ? previous : next))
  }, [])
  adoptTodoRef.current = adoptTodo
  /** Adopt one live `todo/write` event into the plan strip (malformed → keep). */
  const adoptTodoLatest = useCallback((event: WireEvent): void => {
    const items = parseTodoList(event.data)
    if (items === undefined) return
    adoptTodo({ seq: event.seq, items })
  }, [adoptTodo])
  /** On turn/end, mirror the host projection's normalization: a task still
   * `in_progress` when the turn ends reads as completed (agents routinely skip
   * the final all-done write, which would otherwise leave the strip stuck on an
   * intermediate state until the next turn/start). `pending` items were never
   * started and stay untouched; the next turn/start clears the whole list. */
  const normalizeTurnEndTodo = useCallback((): void => {
    setTodo(previous => previous === undefined ? previous : {
      seq: previous.seq,
      items: previous.items.map(item => item.status === 'in_progress'
        ? { ...item, status: 'completed' }
        : item),
    })
  }, [])
  /** Foreground subagents for this session (the flat live delegation list).
   * Built from `subagents.list` and overlaid with host/session-status flips. */
  const [subagents, setSubagents] = useState<SubagentFlatNode[]>([])
  /** Whether the run-status bottom sheet (subagents + todo plan + background jobs) is up. */
  const [runStatusOpen, setRunStatusOpen] = useState(false)
  /** Whether a stop request is in flight (guards the composer's stop button). */
  const [stopping, setStopping] = useState(false)
  /** Pending tool approvals awaiting user decision (#1025). */
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([])
  /** Pending questions awaiting user answer (#1025). */
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestionItem[]>([])
  /** Displayed title (renames apply locally right away). */
  const [title, setTitle] = useState(session.title)
  /** The header 更多 menu (rename / copy session id). */
  const [moreOpen, setMoreOpen] = useState(false)
  /** The read-only git sheet (branch / changes / commits). */
  const [gitOpen, setGitOpen] = useState(false)
  /** Turn-list bottom sheet visibility. */
  const [turnListOpen, setTurnListOpen] = useState(false)
  // Esc 关弹层：手机上没有这个键，但平板/桌面浏览器/外接键盘上它是第一反应。
  // 实测此前按 Esc 什么都不发生——遮罩拦着，只能去点空白处。
  useEffect(() => {
    const anyOpen = picker !== null || moreOpen || runStatusOpen || turnListOpen || gitOpen || contextOpen || plusOpen || commandOpen
    if (!anyOpen) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setPicker(null)
      setMoreOpen(false)
      setRunStatusOpen(false)
      setTurnListOpen(false)
      setGitOpen(false)
      setContextOpen(false)
      setPlusOpen(false)
      setCommandOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [picker, moreOpen, runStatusOpen, turnListOpen, gitOpen, contextOpen, plusOpen, commandOpen])
  /** The host `turnOutline` projection raw value (parsed into the merged
   *  list below). Absent until the tail projection baseline lands. */
  const [turnOutlineRaw, setTurnOutlineRaw] = useState<unknown>(undefined)
  /** Merged host outline + locally-loaded turns, sorted by turn ascending. */
  const turnEntries = useMemo(
    () => mergeTurnEntries(parseTurnOutline(turnOutlineRaw), localTurnEntries(messages)),
    [turnOutlineRaw, messages],
  )
  /** The highest turn NUMBER in the outline: the "of N" denominator. The turn
   *  number, not the entry count, so an outline that starts after turn 1 (or is
   *  only partly merged) still reads "7 / 43" instead of "7 / 12". */
  const maxTurn = turnEntries[turnEntries.length - 1]?.turn ?? 0
  /** The host outline's own newest turn (0 until the projection lands). The
   *  host projection is the session's FULL turn list, so — unlike `maxTurn`,
   *  which only sees the rows currently loaded — it does not grow while deep
   *  history pages in. */
  const hostNewestTurn = useMemo(
    () => parseTurnOutline(turnOutlineRaw).reduce((newest, entry) => Math.max(newest, entry.turn), 0),
    [turnOutlineRaw],
  )
  /** The newest turn the turn handle judges against: the host outline when it
   *  has landed, the merged outline (local rows only) before that. */
  const newestTurn = hostNewestTurn > 0 ? hostNewestTurn : maxTurn
  /** The currently-viewed turn (the row nearest the top of the viewport). */
  const [currentTurn, setCurrentTurn] = useState(0)
  /** What the handle and the sheet highlight show: the tracked reading turn,
   *  falling back to the newest turn until the first scroll reports a position. */
  const shownTurn = currentTurn > 0 ? currentTurn : maxTurn
  const currentTurnRef = useRef(currentTurn)
  currentTurnRef.current = currentTurn
  const turnEntriesRef = useRef(turnEntries)
  turnEntriesRef.current = turnEntries
  const sessionIdRef = useRef(session.sessionId)
  sessionIdRef.current = session.sessionId
  /** Debounce handle for the scroll-settle reading save. */
  const readingTimerRef = useRef<number | undefined>(undefined)
  /** Pending turn-jump target seq while paging it in (see jumpToTurn). */
  /** Target of a turn jump that must page history in first: the outline's
   *  boundary seq, the turn NUMBER to match once a page lands (the seq alone
   *  cannot match — see locateSeq), and how many follow-up pages this jump has
   *  already spent. */
  /** 每次定位 +1：同一条消息里有多处命中时 focusMsgId 不变，只靠它触发重定位。 */
  const [locateTick, setLocateTick] = useState(0)
  const pendingTurnSeqRef = useRef<number | undefined>(undefined)
  const pendingTurnNumberRef = useRef<number | undefined>(undefined)
  /** 搜索命中落在哪一段（一行里多处命中时用来说明是哪一处）。 */
  const pendingTurnPartIdRef = useRef<string | undefined>(undefined)
  /** 这一条命中是该段里的第几处（同一段里同一个词出现多次时对位）。 */
  const pendingTurnOccurrenceRef = useRef(0)
  /** 搜索命中的消息 id（两条读取通道里唯一一致的键，定位优先用它）。 */
  const pendingTurnMessageIdRef = useRef<string | undefined>(undefined)
  /** 命中的片段：跨通道唯一一致的定位依据（原文本身）。 */
  const pendingTurnSnippetRef = useRef<string | undefined>(undefined)
  /** 这次跳转要落到第几条命中：落地后才把它写进计数器（没落地不动数字）。 */
  const pendingTurnAtRef = useRef<number | undefined>(undefined)
  const pendingTurnPagesRef = useRef(0)
  /** D1 scrub state: the index into `turnEntries` the finger points at while the
   *  handle is held; undefined means the scrubber is closed. */
  const [scrubIndex, setScrubIndex] = useState<number | undefined>(undefined)
  /** Live bookkeeping for one handle gesture: where the press landed (the drag
   *  threshold is measured against it) and whether it ever travelled, so the
   *  release can tell a tap (open the list) from a scrub. */
  const scrubGestureRef = useRef<
    { pointerId: number; startX: number; moved: boolean } | undefined
  >(undefined)
  /** Rename dialog visibility. */
  const [renaming, setRenaming] = useState(false)
  /** Delete-session confirm dialog visibility. */
  const [deleting, setDeleting] = useState(false)
  /** Long-press message menu: viewport position + the bubble's plain text,
   *  plus the message's RAW markdown when it differs (tool-interleaved flow
   *  turns carry their payload in flow runs, invisible in `text`). */
  /** 菜单打开的时刻：长按抬手后浏览器还会补一次 click，它会打在背板上把菜单立刻关掉。 */
  const ctxMenuOpenedAtRef = useRef(0)
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    text: string
    raw?: string
    /** Message kind drives the message-specific actions (edit for user). */
    kind?: RenderMessage['kind']
    messageId?: string
    /** 长按落在过程行上：这一行的标题/摘要/状态与命令原文，行级操作用。 */
    row?: { title: string; summary: string; state: string; command?: string }
    /** 被长按的元素："选择文字"用它决定在哪一块上建选区。 */
    target?: Element
    /** 当前选区里有字（有选区时菜单只留"复制选中内容"）。 */
    selected?: string
  } | undefined>(undefined)
  /** The user message being edited-and-resent (回填后重发为新 prompt). */
  const [editMessage, setEditMessage] = useState<{ messageId: string; text: string } | undefined>(undefined)
  /** 自动滚动偏好（设置 → 自动滚动）。订阅而不是只在挂载时读一次：在设置里
      关掉之后，当前这个会话当场就该停滚，不用退出去重进。 */
  const autoScroll = useSyncExternalStore(subscribeDisplayPrefs, getAutoScroll)

  // Read-only mobile display preferences ride the plugin's local
  // `/m/api` method; a failure keeps the default (Enter sends).
  useEffect(() => {
    let cancelled = false
    void fetchMobilePreferences().then(
      (preferences) => {
        if (!cancelled) setMobileEnterToSend(preferences.mobileEnterToSend !== false)
      },
      () => { /* keep the default */ },
    )
    return () => { cancelled = true }
  }, [])

  /* ── offline mode ──────────────────────────────────────────────────── */

  /** Refresh the queued count + entry list (banner reads both). */
  const refreshOutbox = useCallback((): void => {
    void listOutbox().then(entries => {
      setQueuedCount(entries.length)
      setQueuedEntries(entries)
    })
  }, [])

  /**
   * 探一次宿主：成功即在线，失败/超时即仍断。
   *
   * 自带短超时：默认 60 秒的请求超时在"弱网挂着"的场景下会让探测本身卡住，横幅
   * 既不会撤也不会重探。4 秒没答话就当这次没通。
   */
  const probeHost = useCallback((): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => { resolve(false) }, OFFLINE_PROBE_TIMEOUT_MS)
    })
    const call = Promise.resolve()
      .then(() => history(session.sessionId, undefined, 1))
      .then(() => true, () => false)
    return Promise.race([call, timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    })
  }, [session.sessionId])

  /**
   * 连通性：真值来自真实请求（rpc 总线），`navigator.onLine` 只当"可能断了"的提示。
   *
   * 断着的时候自己探：每 5 秒一次，另外在回到前台、重新聚焦、页面从缓存恢复时立刻
   * 探一次 —— 安卓换网/锁屏回来最常见的就是 `online` 事件不来了，只靠事件横幅会一
   * 直挂着，发出去的话也一直进离线队列。
   */
  useEffect(() => {
    const unsubscribe = onConnectivityChange(online => { setOffline(!online) })
    const onOfflineHint = (): void => { setOffline(true) }
    const onOnlineHint = (): void => { void probeHost().then(reachable => { setOffline(!reachable) }) }
    window.addEventListener('offline', onOfflineHint)
    window.addEventListener('online', onOnlineHint)
    window.addEventListener('focus', onOnlineHint)
    window.addEventListener('pageshow', onOnlineHint)
    document.addEventListener('visibilitychange', onOnlineHint)
    return () => {
      unsubscribe()
      window.removeEventListener('offline', onOfflineHint)
      window.removeEventListener('online', onOnlineHint)
      window.removeEventListener('focus', onOnlineHint)
      window.removeEventListener('pageshow', onOnlineHint)
      document.removeEventListener('visibilitychange', onOnlineHint)
    }
  }, [probeHost])

  // 断开期间自己恢复：每 5 秒探一次宿主（通了就撤横幅，队列随即自动发出去）。
  useEffect(() => {
    refreshOutbox()
  }, [refreshOutbox])
  useEffect(() => {
    if (!offline) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      if (cancelled) return
      void probeHost().then((reachable) => {
        if (cancelled) return
        if (reachable) {
          setOffline(false)
          refreshOutbox()
        } else {
          timer = setTimeout(tick, OFFLINE_PROBE_MS)
        }
      })
    }
    timer = setTimeout(tick, OFFLINE_PROBE_MS)
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer) }
  }, [offline, session.sessionId, refreshOutbox])

  /** Drop one queued prompt (the banner's per-entry remove button). */
  const removeQueuedEntry = useCallback((id: string): void => {
    void removeFromOutbox(id).then(() => { refreshOutbox() })
  }, [refreshOutbox])

  /** Deliver the queued prompts once the connection is back. */
  const flushQueue = useCallback((): void => {
    void flushOutbox(entry => prompt(entry.sessionId, textParts(entry.text))).then(
      ({ sent, failed }) => {
        if (sent > 0) toast(failed > 0 ? `已同步 ${sent} 条，${failed} 条待重试` : `已同步 ${sent} 条消息`)
        refreshOutbox()
        if (sent > 0) mux?.poke()
      },
    )
  }, [mux, refreshOutbox])

  /**
   * 排队底稿必须跟着宿主动作走：编辑要换成新文本、删除/插话要一并删除。
   * 否则被删掉的排队消息会在 20 秒后「自己回到输入框」，用户以为见鬼。
   */
  const handleQueueEdit = useCallback(async (itemId: string, text: string): Promise<void> => {
    const item = queueItems.find(entry => entry.id === itemId)
    const previous = item?.text
    // 附件/图片原样带回去：只改正文，不能把排队项里的文件丢掉（宿主那边收据还在）。
    const keep = Array.isArray(item?.keepParts) ? item.keepParts : []
    const content = [
      ...(text.trim() === '' ? [] : [{ type: 'text' as const, text }]),
      ...(keep as Array<{ type: 'file'; receiptId: string } | { type: 'image'; attachmentId: string }>),
    ]
    try {
      await updateQueue(session.sessionId, itemId, { kind: 'edit', content })
      if (previous !== undefined) forgetQueuedEcho(session.sessionId, previous)
      rememberQueuedEcho({ sessionId: session.sessionId, text, at: Date.now() })
      refreshInbox({ fresh: true })
    } catch (reason: unknown) {
      // 宿主拒绝了这次改动。和删除一样要分清两种原因：id 在宿主队列里已经找不到
      // （手机上那份是旧快照），还是请求根本没送到（隧道抖动）。
      // 队列数据以宿主为准，所以不凭空删行 —— 但要**立刻现查一次**：手机上投影帧
      // 本来就不来，只留一句「已开始发送」、卡片继续挂着，用户看到的就是"发了却没清"。
      refreshInbox({ fresh: true })
      const code = reason instanceof RpcCallError ? reason.error.code : undefined
      if (code === 'queue-item-not-found') {
        setQueueItems(rows => rows.filter(item => item.id !== itemId))
        toast('这条已经不在队列里了，已从列表移除')
        return
      }
      toast('编辑没送到宿主，检查一下网络再试')
    }
  }, [session.sessionId, refreshInbox, queueItems])

  /** Remove a queued message on the host. */
  const handleQueueRemove = useCallback(async (itemId: string): Promise<void> => {
    const previous = queueItems.find(item => item.id === itemId)?.text
    // 还没被宿主认下来的乐观项（id 以 local- 开头）：宿主根本不知道这一条，
    // 拿它去调 session.updateQueue 只会得到 bad-request/not-found，界面却弹
    // 「删除没送到宿主」（真机：点了删除、队列条还在，只多一条报错）。本地删掉即可。
    if (itemId.startsWith('local-')) {
      dropOptimisticQueueItem(session.sessionId, itemId)
      setQueueItems(queueView(session.sessionId))
      if (previous !== undefined) forgetQueuedEcho(session.sessionId, previous)
      refreshInbox({ fresh: true })
      return
    }
    // 本地先摘掉（状态仓的隐藏表），宿主快照回来之前卡片就消失；失败再放回去。
    hideQueueItem(session.sessionId, itemId)
    try {
      await updateQueue(session.sessionId, itemId, { kind: 'remove' })
      // 宿主已确认删除：本机先摘掉这一行。宿主的待发投影不会主动推到手机
      // （只有 fresh 查询才拿得到），不摘就会一直挂着一条已经删掉的排队消息。
      setQueueItems(rows => rows.filter(item => item.id !== itemId))
      // 删掉的就是不会发送了：底稿一起清，否则对账会把它「救」回输入框。
      if (previous !== undefined) forgetQueuedEcho(session.sessionId, previous)
      refreshInbox({ fresh: true })
    } catch (reason: unknown) {
      const code = reason instanceof RpcCallError ? reason.error.code : undefined
      // 两种失败天差地别，不能混成一句「已开始发送」：
      //   queue-item-not-found —— 宿主队列里没有这个 id。手机手里那份可能是打开会话
      //     时的旧快照（宿主的投影帧到不了手机），拿旧 id 去删当然删不到。这时卡片
      //     已经没有任何对应的队列项，留在屏幕上只会变成一张"删不掉的幽灵"。
      //   其它 —— 请求根本没到宿主（隧道抖动）。队列里也许还留着，界面什么都不该动。
      refreshInbox({ fresh: true })
      if (code === 'queue-item-not-found') {
        setQueueItems(rows => rows.filter(item => item.id !== itemId))
        toast('这条已经不在队列里了，已从列表移除')
        return
      }
      // 真失败：撤掉本地隐藏，让权威队列重新显示这一条。
      // 错误码一起说出来：隧道超时（network）与宿主拒绝（host）要分别处理，
      // 只写「没送到宿主」时下次还得靠猜（真机反馈过这条）。
      unhideQueueItem(session.sessionId, itemId)
      toast(`删除没成功（${code ?? 'network'}），请再试一次`)
    }
  }, [session.sessionId, refreshInbox, queueItems])

  /** Steer a queued message into the running turn (only while running). */
  const handleQueueSteer = useCallback(async (itemId: string): Promise<void> => {
    const previous = queueItems.find(item => item.id === itemId)?.text
    // 同上：本地乐观项宿主还没收下，插队一定失败。与其弹一句看不懂的报错，
    // 不如直说「还在发送中」。
    if (itemId.startsWith('local-')) {
      toast('这条还在发送中，稍等一下再插队')
      return
    }
    // 点下去就让它从队列里消失：插队的语义是"进当前回合"，不该在排队条上多留几百毫秒。
    hideQueueItem(session.sessionId, itemId)
    try {
      await updateQueue(session.sessionId, itemId, { kind: 'steer' })
      // 宿主已把这条塞进当前回合：它不再排队，本机立刻摘行。宿主的待发投影不会
      // 推到手机，只等帧的话那张卡片会一直挂到下一轮对账 —— 用户看到的就是
      // 「插队发送之后排队条没及时消失」。
      setQueueItems(rows => rows.filter(item => item.id !== itemId))
      // 插话成功了：这条已经进了当前回合，底稿不清就会被对账判成「没送达」再回输入框。
      if (previous !== undefined) forgetQueuedEcho(session.sessionId, previous)
      refreshInbox({ fresh: true })
      toast('已插入当前回合')
    } catch (reason: unknown) {
      const code = reason instanceof RpcCallError ? reason.error.code : undefined
      if (code === 'steer-unavailable') {
        // The host says the current turn no longer accepts steering — it
        // ended, but the turn/end frame may have been lost to a degraded
        // SSE channel. Mirror the host's running state so the UI stops
        // offering steer on a finished turn.
        unhideQueueItem(session.sessionId, itemId)
        toast('当前轮次已结束，无法插话')
        setRunning(false)
        setRunningTurn(undefined)
        setTurnStartAt(null)
        return
      }
      // queue-item-not-found (already claimed / cold session) or a
      // transport failure: the agent may still be running, so the running
      // indicator stays untouched. The queue dock itself is authoritative
      // host data and is never cleared here — the next snapshot converges it.
      if (code === 'queue-item-not-found') {
        refreshInbox({ fresh: true })
      } else {
        // 真失败（请求没到宿主）：把这一条放回排队条。
        unhideQueueItem(session.sessionId, itemId)
      }
      toast(code === 'queue-item-not-found' ? '消息已开始发送，无法插话' : '插话失败')
    }
  }, [session.sessionId, refreshInbox])

  // Connection restored: drain the outbox automatically.
  useEffect(() => {
    if (offline) return
    void listOutbox().then(entries => {
      if (entries.length === 0) return
      flushQueue()
    })
  }, [offline, flushQueue])

  // The + menu's command directory loads lazily on first open (weak links
  // never pay for it up front); a failure degrades to an empty list. The
  // session id resolves the agent's effective command view (per-agent rows
  // like /plan and /compact live in agent presets on the Web deployment).
  useEffect(() => {
    // 手动敲 / 也要认领成 chip，所以输入框里出现斜杠就开始拉目录。
    const wantsDirectory = plusOpen || commandOpen || input.startsWith('/')
    if (!wantsDirectory || commands !== undefined) return
    // 一次失败不能把整个会话的目录钉死成空：真机上就是这么"有时候"看不见 /goal、
    // /plan 的（首次拉取撞上宿主忙或弱网）。失败不缓存，1 秒后再试。
    if (Date.now() - commandFetchAtRef.current < 1000) return
    commandFetchAtRef.current = Date.now()
    let cancelled = false
    void listCommands(session.sessionId).then(
      (items) => { if (!cancelled) setCommands(items) },
      () => { /* 保持未加载：下一次打开面板或继续输入时重试 */ },
    )
    return () => { cancelled = true }
  }, [plusOpen, commandOpen, commands, session.sessionId, input])

  /** Refill a dropped seq window (tail overflow) page by page, from its
   * newest edge backwards, trimming rows already present in the fold (the
   * page below the window's bottom overlaps the tail snapshot). Best-effort:
   * a failure only logs. */
  const refillGap = useCallback((gap: { from: number; to: number }, signal: AbortSignal, isCancelled: () => boolean): void => {
    let beforeSeq = gap.to + 1
    const refill = (): void => {
      void loadChatPage(session.sessionId, beforeSeq, signal).then(
        (fresh) => {
          if (isCancelled()) return
          const folder = folderRef.current
          const older = renderRows(fresh.rows)
          // Drop rows at/below the window's bottom edge: they already live in
          // the tail snapshot and prepending them would duplicate rows.
          const trimmed = older.filter(row => (row.startSeq ?? row.seq) >= gap.from)
          if (trimmed.length > 0) {
            if (folder === undefined) {
              commitRows(previous => [...trimmed, ...previous])
            } else {
              folder.prepend(trimmed)
              applyMessages(folder.snapshot())
            }
          }
          const oldestSeq = trimmed.length > 0 ? (trimmed[0]?.startSeq ?? trimmed[0]?.seq) : undefined
          // Stop when the page reached the window's bottom edge, history
          // ended, or the cursor failed to advance (no older rows).
          if (oldestSeq === undefined || oldestSeq <= gap.from || !fresh.hasMore) return
          if (oldestSeq >= beforeSeq) return
          beforeSeq = oldestSeq
          refill()
        },
        (reason: unknown) => {
          if (!isCancelled()) console.warn('history gap refill failed', reason)
        },
      )
    }
    refill()
  }, [session.sessionId])

  // Tail page on open (content loads only when the session is opened).
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    // A stuck history load must not keep the chat empty forever: abort it and
    // surface the transport error. 但 30 s 太短了——冷启动/大会话被换出内存后，
    // 首页读实测 17~109 s，30 s 一响就必然是一张空白页（用户说的「点了结果进不去」）。
    // 给到 150 s，覆盖实测最慢的那一档；真正的死链仍然会在这里断掉。
    const timeout = setTimeout(() => {
      controller.abort(new DOMException('history load timed out', 'TimeoutError'))
    }, 150_000)
    // 带着定位意图进来的：这一页可能要等 40~160 秒（冷启动/大会话），而意图只活
    // 20 秒。等的这段时间里每 5 秒续一次，页落地就停 —— 否则页到了、关键词早丢了，
    // 表现就是「滚到那条附近，但一个字都没高亮」。
    const intentKeepAlive = locateIntentFor(session.sessionId) === undefined
      ? undefined
      : window.setInterval(() => { touchLocateIntent(session.sessionId) }, 5_000)
    const stopIntentKeepAlive = (): void => {
      if (intentKeepAlive !== undefined) window.clearInterval(intentKeepAlive)
    }
    tailLoadingRef.current = true
    liveBufferRef.current = []
    liveBufferOverflowRef.current = false
    dropWindowRef.current = undefined
    autoExtendedRef.current = false
  openChainPagesRef.current = 0
    folderRef.current = undefined
    // 时钟校准是**本会话**的：换会话就从零开始攒样本，否则上一场的偏移会
    // 直接套到这一场的秒表上（锚点是宿主时间，偏移偏多少秒表就偏多少）。
    hostClockSamplesRef.current = []
    // A session switch must not let a pending rAF flush fold the PREVIOUS
    // session's buffered events into the new session's folder: drop the batch
    // and cancel the scheduled flush.
    eventBatchRef.current = []
    if (eventFlushRafRef.current !== undefined) {
      cancelAnimationFrame(eventFlushRafRef.current)
      eventFlushRafRef.current = undefined
    }
    setTitle(session.title)
    // A session switch starts a fresh read position: the next fold key change
    // (the new tail page) must follow to the bottom unconditionally.
    // 新会话：滚动状态机整体归零（跟随窗口、手势、定位锁、方向）。
    scrollEvent({ type: 'open', at: Date.now() })
    lastMessageKeyRef.current = undefined
    // 这一场本次运行里打开过：直接把上次画的行同步铺上来，网络页到了再覆盖。
    // 没打开过才回到空表 + 加载中（跨刷新的场景仍由 IndexedDB 缓存兜底）。
    const seeded = recallChatSnapshot(session.sessionId)
    setLoading(seeded === undefined)
    setError(undefined)
    // 走唯一提交入口：缓存页与网络页可能是两套 id，直接 setMessages 会绕过
    // 身份合并，屏幕上就是「同一段内容两份」。
    commitRows(seeded?.rows ?? [])
    setHasOlder(seeded?.hasOlder ?? false)
    // Pending approvals/questions are per-session state: without this a
    // switch leaks session A's cards into session B, where the user could
    // approve a tool call for the wrong chat. The next poll/frame repopulates
    // the new session's own items.
    setPendingApprovals([])
    setPendingQuestions([])
    // The answered-item memory is per session and lives at module scope
    // (question-batches.ts / approval-batches.ts): a switch neither leaks it into
    // the next chat nor has to clear it — pending rpcIds are never reused.
    setContextPressure(undefined)
    // The plan strip is per-session state too (the loaded tail re-seeds it).
    setTodo(undefined)
    // 行里的 running 只是过渡值：进会话后 mobile.turnState 会立刻给出宿主的判决并覆盖它。
    // 这个字段本身不可信（实测刚跑完的会话仍是 true），但**不能**在连不上宿主时把它
    // 收掉 —— 那正是「网络抖一下，秒表被清零」的老毛病；连不上只标链路（连接中断），
    // 回合和时钟都留着。
    setRunning(session.running === true)
    setStopArmed(false)
    // 会话切换：上一轮的轮号绝不能留给下一场（名单恢复的 running 会把它当成
    // 活跃轮次，把上一场那一轮的卡片误判成运行中）。
    setRunningTurn(undefined)
    setTurnStartAt(null)
    // Cache-first: seed the view from the cached tail page immediately so a
    // reopen paints instantly (stale-while-revalidate); the network load
    // below overwrites with fresh data and refreshes the cache. `networkLanded`
    // guards the race — once the network load resolves, a late cache seed
    // must not clobber the fresh page.
    let networkLanded = false
    // 模型目录随页面回来时存这里：稍后的补取定时器据此跳过多发的一次往返。
    let extraModels: SessionModels | undefined
    // True when the cache-first seed painted a cached tail page. On a cache
    // hit we skip the auto-extend (one less network page + re-render), so a
    // reopen stays instant; the manual loadOlder button still pages further.
    let cacheHit = false
    /** 把缓存页画上去（只在还没有网络页时有效）。 */
    const paintCache = (cached: ChatPageResult | undefined): void => {
      if (cancelled || networkLanded || cached === undefined || cacheHit) return
      cacheHit = true
      const folder = new EventFolder(cached.rows, cached.maxSeq)
      folderRef.current = folder
      applyMessages(folder.fold([]))
      setHasOlder(cached.hasMore)
      setLoading(false)
      reportCardDiagnostic(renderRows(folder.fold([])), [], { pages: 0, whole: false, source: 'cache' })
    }
    void loadCachedHistory<ChatPageResult>(session.sessionId).then(cached => {
      if (cancelled || networkLanded || cached === undefined) return
      // 够一整页的缓存：立刻上屏（快网也就是一闪而过的过渡）。
      // 半页缓存（上一次只看到开头几行）：先不画 —— 画上去网络页一到就整屏换掉，
      // 正文/过程条/卡片一起变，就是「进会话闪一下」。
      if (cached.rows.length >= MIN_CACHE_TAIL_ROWS) {
        paintCache(cached)
        return
      }
      // 但弱网下不能一直白屏：800ms 还没等到网络页，就把这半页先画出来
      // （可用性优先）。网络页到了照旧合并，不会更差。
      window.setTimeout(() => {
        if (cancelled || networkLanded) return
        paintCache(cached)
      }, SLOW_NETWORK_CACHE_MS)
    })
    // 带定位打开时，首屏直接取"目标所在的那一页"（beforeSeq 直指命中 seq+1），
    // 不再先取尾页、再靠一次跳页去追目标：那次跳页在转场/重挂载里经常落空，
    // 表现就是「进去了、停在会话开头/尾部，没有高亮」。
    const openLocateSeq = initialFocusSeq ?? locateIntent?.seq
    void loadChatPage(session.sessionId, openLocateSeq === undefined ? undefined : openLocateSeq + 1, controller.signal, ['models'], (authority) => {
      // 宿主权威页姗姗来迟（1.5s 后），但带着尾页没有的投影：轮次大纲、以及
      // 更完整的上下文压力。消息本身不换 —— 那份尾部已经渲染好了，换掉只会
      // 让用户看到闪烁。
      if (cancelled) return
      const values = authority.projections?.values as Record<string, unknown> | undefined
      if (values === undefined) return
      if (values['permissions'] !== undefined) setPermissions(parsePermissionSelect(values['permissions']))
      if (values['contextPressure'] !== undefined) setContextPressure(parseContextPressure(values['contextPressure']))
      if (values['turnOutline'] !== undefined) setTurnOutlineRaw(values['turnOutline'])
      if (values['inbox'] !== undefined) applyInbox(values['inbox'])
    }).then(
      (page) => {
        stopIntentKeepAlive()
        if (cancelled) return
        networkLanded = true
        // Buffered live events re-fold on top of the snapshot; the watermark
        // (page.maxSeq — the host window's event floor) drops any the
        // snapshot already includes, so nothing is lost or doubled.
        const buffered = liveBufferRef.current
        liveBufferRef.current = []
        tailLoadingRef.current = false
        const folder = new EventFolder(page.rows, page.maxSeq)
        folderRef.current = folder
        const foldedRows = folder.fold(buffered)
        applyMessages(foldedRows)
        setHasOlder(page.hasMore)
        // Seed the plan strip from the page's todo snapshot (newest
        // todo/write in the window; live frames adopt above it by seq).
        // Buffered live events already adopted on arrival.
        if (page.todo !== undefined) adoptTodo(page.todo)
        // 模型目录随这次读取一起回来了（A）：立刻落位，稍后的补取定时器会跳过。
        const included = page.extras?.models
        if (included !== undefined) {
          extraModels = included
          setCurrentModel(included.current)
          setModelCatalog(previous => previous.status === 'idle' ? { status: 'ready', data: included } : previous)
        }
        // 进会话就把上下文铺开：一页 25 行对长会话太短，以前只静默补一页，
        // 用户还是得反复点「加载更早的消息」。
        //
        // 铺开的几页**一次提交**：以前每页单独落地（整份列表换一次 + 滚动校正
        // 一次），进会话连着跳好几下 —— 真机「一进会话就闪烁几下」。现在先把页
        // 拉完，攒成一份再画一次；中途失败就停在已经拿到的那部分。
        // 带搜索定位打开时不铺开：定位自己会一跳到位（beforeSeq 直指目标页）。
        const locatePending = initialFocusSeq !== undefined || initialFocusMessageId !== undefined
        if (page.hasMore && !autoExtendedRef.current && !locatePending) {
          autoExtendedRef.current = true
          void (async (): Promise<void> => {
            const holder = folderRef.current
            if (holder === undefined) return
            let older: RenderMessage[] = []
            let loaded = holder.snapshot().length
            let pages = 1
            let hasMore = page.hasMore
            while (pages <= OPEN_HISTORY_MAX_PAGES && hasMore && loaded < OPEN_HISTORY_TARGET_ROWS) {
              const first = older[0] ?? holder.snapshot()[0]
              if (first === undefined) break
              const beforeSeq = first.startSeq ?? first.seq
              let olderPage: ChatPageResult
              try {
                olderPage = await loadChatPage(session.sessionId, beforeSeq, controller.signal)
              } catch {
                break
              }
              if (cancelled) return
              pages += 1
              // 宿主回了空/畸形页（旧宿主、被网关截断）：按"没有更早的了"收尾，
              // 不要在铺开链里抛 —— 那会变成一个未捕获的 rejection。
              if (olderPage === undefined || !Array.isArray(olderPage.rows)) break
              const rows = renderRows(olderPage.rows)
              if (rows.length === 0) break
              older = [...rows, ...older]
              loaded = holder.snapshot().length + older.length
              hasMore = olderPage.hasMore
            }
            if (cancelled || older.length === 0) {
              setLoading(false)
              return
            }
            holder.prepend(older)
            // 铺开的行插在尾部之上：让提交后的贴底逻辑把视野钉回最新一条。
            followAfterPrependRef.current = true
            applyMessages(holder.snapshot())
            setHasOlder(hasMore)
          })()
        }
        setLoading(false)
        // Restore the turn-clock anchor from the tail window (desktop
        // parity): the window carries the open turn/start's logged time when
        // the boundary is within reach, so a mid-turn reload keeps the real
        // elapsed time instead of counting from mount. A live turn/start
        // frame already anchored it (newer) — never overwrite that.
        if (page.turnStartAt !== undefined) {
          setTurnStartAt(prev => prev ?? page.turnStartAt ?? null)
          // 把这个真起点也种进折叠：窗口里看不到 turn/start 时，收工定格只能退回
          // 「窗口最早一行」当锚点，秒表会在收工时往回跳（真机 8分37秒 → 6分48秒）。
          folderRef.current?.noteOpenTurnStart(page.turnStartAt)
          // The anchor is a clock, not a verdict. It used to raise the running
          // flag on its own, on the theory that an open boundary outweighs the
          // roster's agent-liveness flag while a subagent runs. In practice a
          // turn that died without writing its turn/end left exactly that
          // boundary behind, so every reopen of that chat painted 输出中 over a
          // session the desktop knew was idle. Opening a chat now takes the
          // roster's `running` as the verdict (seeded above, and corrected by
          // the host's `session/status` frame as soon as one lands); the anchor
          // only decides where the stopwatch starts.
          //
          // 名单说这个会话不在跑，页面却留了一条开着的边界：这一轮是被打断的（宿主重启、
          // 进程被杀、断流），不是正常收工。记下来，渲染时写「已中断」而不是「已完成」。
          // 只有「名单说不跑」还不够 —— 一轮正跑着时名单也可能滞后；再加一条日志彻底静默
          // 的证据（宿主集合与日志都在说这轮没了），才判它被打断。
          const silent = page.lastEventAt !== undefined && Date.now() - page.lastEventAt > TURN_SILENCE_MS
          if (session.running !== true && silent) {
            setAbandonedTurn(previous => previous ?? newestFoldTurn(foldedRows))
          }
          setRunningTurn(undefined)
        }
        // The page's projection baseline seeds the permission picker.
        // The `permissions` key is declared by the deployment's permission
        // plugin (augmentation), so the base SDK map is indexed loosely.
        // A page WITHOUT a projection block says nothing about permissions:
        // the log-tail fast path carries none, and treating that as "no
        // permissions" would blank the picker on every chat open. Only a page
        // that actually carries projections may overwrite the baseline.
        if (page.projections !== undefined) {
          const projections = page.projections.values as Record<string, unknown> | undefined
          setPermissions(parsePermissionSelect(projections?.['permissions']))
          setContextPressure(parseContextPressure(projections?.['contextPressure']))
          setTurnOutlineRaw(projections?.['turnOutline'])
          if (projections?.['inbox'] !== undefined) applyInbox(projections['inbox'])
        }
        // The buffer overflowed while waiting (oldest events were dropped):
        // refill the dropped seq window page by page, from its newest edge
        // backwards, until the whole window is covered or history ends. A
        // flat tail re-pull would only return events the fold already
        // consumed (seq <= maxSeq) and the dropped range would stay missing.
        // Best-effort: a failure here only logs, it must not replace the
        // loaded state with an error.
        if (dropWindowRef.current !== undefined) {
          const gap = dropWindowRef.current
          dropWindowRef.current = undefined
          liveBufferOverflowRef.current = false
          refillGap(gap, controller.signal, () => cancelled)
        }
      },
      (reason: unknown) => {
        stopIntentKeepAlive()
        if (cancelled) return
        // Load failed: flush the buffer so the live stream still renders.
        const buffered = liveBufferRef.current
        liveBufferRef.current = []
        tailLoadingRef.current = false
        if (buffered.length > 0) {
          const folder = folderRef.current
          applyMessages(folder === undefined ? foldEvents(buffered) : folder.fold(buffered))
        }
        setError(errorText(reason))
        setLoading(false)
      },
    )
    // Best-effort current-model label for the toolbar chip; the sheet
    // always re-reads a fresh directory on open. The same fetch seeds the
    // quick-picker catalog, so opening the strip right after mount never
    // issues a duplicate request.
    //
    // A（聚合读取）：目录通常已经随 readChat 的 extras 回来了，所以先等一小会
    // ——二次进入会话时宿主窗口缓存命中，页面几十毫秒就到，这一次往返就省了；
    // 冷读（大文件）时最多晚 120ms 才自己取，跟页面读取并行，体感不变。
    const modelsFallback = window.setTimeout(() => {
      if (cancelled || extraModels !== undefined) return
      void models(session.sessionId).then(
        (directory) => {
          if (cancelled) return
          // 补取只填空位：宽限期内用户已经手选过模型（chip 已落位），这里绝不能
          // 把它覆盖回宿主的旧值。
          setCurrentModel(previous => previous ?? directory.current)
          setModelCatalog(previous => previous.status === 'idle' ? { status: 'ready', data: directory } : previous)
        },
        (reason: unknown) => {
          if (cancelled) return
          setModelCatalog(previous => previous.status === 'idle' ? { status: 'error', message: errorText(reason) } : previous)
        },
      )
    }, MODELS_EXTRAS_GRACE_MS)
    return () => {
      cancelled = true
      stopIntentKeepAlive()
      clearTimeout(timeout)
      window.clearTimeout(modelsFallback)
      controller.abort()
    }
  }, [session.sessionId, applyInbox])
  /** 帧回调里要"立刻问一次宿主"（turn/start 清空队列之后）：走 ref，免得为它重订阅事件流。 */
  const refreshInboxRef = useRef(refreshInbox)
  refreshInboxRef.current = refreshInbox


  /** 校正"这一轮到底还在不在跑"。
   *
   *  以日志尾页的轮次边界为准：宿主在服务端就折好了尾页（实测 17~31 ms /
   *  99 KB），而 session.history 要解压整份日志——52 MB 的会话实测 34 秒，
   *  那段等待本身就是用户眼里的"刷新很慢"。旧宿主没有尾页通道时才退回
   *  宿主列表 + 历史窗口扫描。 */
  const reconcileRunning = useCallback((): void => {
    if (reconcileInFlightRef.current) return
    reconcileInFlightRef.current = true
    const reachable = (): void => {
      reconcileFailureRef.current = 0
      if (aliveRef.current) setHostLost(false)
    }
    const unreachable = (): void => {
      reconcileFailureRef.current += 1
      // 连续失败只标记"链路没了"，不动运行状态：撤掉会让用户正在看的
      // 运行时钟凭空消失（见 hostLost 的说明）。
      if (aliveRef.current && reconcileFailureRef.current >= RECONCILE_FAILURE_LIMIT) setHostLost(true)
    }
    const adopt = (open: boolean, startAt: number | undefined): void => {
      if (!aliveRef.current) return
      setRunning(previous => (previous === open ? previous : open))
      if (!open) {
        // 探针也是 turn/end：活跃轮次同样清空，行级判据不能停在旧轮上。
        setRunningTurn(undefined)
        setTurnStartAt(null)
        // 外部锚点只在"这一轮还开着"时有意义：清掉，免得下一轮收工时拿它定格。
        folderRef.current?.clearOpenTurnStart()
        normalizeTurnEndTodo()
        return
      }
      // Anchor the clock at the logged start (desktop parity): a live frame
      // that already supplied a newer anchor wins.
      if (startAt !== undefined) {
        setTurnStartAt(previous => previous ?? startAt)
        // 同一份真起点也交给折叠：否则收工那一刻用时会被"窗口最早一行"缩短。
        folderRef.current?.noteOpenTurnStart(startAt)
      }
    }
    // 收工/在跑只有一个来源：宿主的 turnState。它把"转发帧看到过的边界"与"日志写下的
    // 边界"按 seq 比一次再回答；手机不再拿静默时长、日志窗口里看不看得见边界、会话表
    // 行的 running 去推断——那三条都曾经把正跑着的一轮判成已完成。旧宿主没有这个方法
    // （或这一次读失败）时才退回尾页那套。
    const reconcileFromTail = (): void => {
    void logTail(session.sessionId).then(
      (page) => {
        // 尾页本身就是宿主可达的证明。
        reachable()
        if (page.turnOpen === false) {
          // 日志最后一条边界是 turn/end：这一轮确实收工了。
          adopt(false, undefined)
          return
        }
        // 静默**不是**收工的凭据。一条编译命令跑三分钟、一次大文件读写，这段时间日志
        // 里一行事件都没有；此前"最后事件已经很久就判收工"正是"命令还在跑、过程框却
        // 写着已完成"的来源（工具行还停在运行中，头尾自相矛盾）。收工只认两条硬证据：
        // 日志最后一条边界是 turn/end（上面那条），或者宿主自己说这轮不跑了。
        //
        // 这里问的是 runningSessions 而不是 session.list 行上的 running：实测列表行会
        // 说谎——一轮正跑着（尾页锚点开着、最新事件 0 秒前），列表那一行还是 running=false，
        // 专用集合却把它算在里面。拿列表行当收工凭据，就会在每一轮跑到一半时把过程框
        // 判成已完成。
        const openedAt = page.turnStartAt
        const moving = page.lastEventAt !== undefined && Date.now() - page.lastEventAt <= TURN_SILENCE_MS
        void runningSessions().then(
          ({ sessionIds }) => {
            reachable()
            // 宿主集合说在跑就是在跑——哪怕日志一声不响（命令正跑着）。
            if (sessionIds.includes(session.sessionId)) { adopt(true, openedAt); return }
            // 集合说没在跑、可日志刚刚还在动：这一轮确实活着（集合靠帧维护，会落后）。
            if (moving) { adopt(true, openedAt); return }
            // 两条都没有：边界开着却彻底静了，集合也不认——这一轮是死在断流窗口里了。
            // 记下这一轮：它不是正常收工（没有 turn/end），要写「已中断」而不是「已完成」。
            setAbandonedTurn(previous => previous ?? runningTurnRef.current ?? newestFoldTurn(messagesRef.current))
            adopt(false, undefined)
          },
          () => { adopt(true, openedAt) },
        )
        // 尾页说"还开着"就是真的还开着：宿主那一侧的窗口是从日志尾部折的，
        // turn/end 是最后一条边界，读不到它意味着它真的还没写下来。这里不再
        // 去问宿主的运行集合——实测宿主一整轮只推了一条 session/status（260 秒
        // 的监听里零条 running=false），那个集合既不能及时亮也不会及时灭，问了
        // 反而把正确的判断改错。
        adopt(true, page.turnStartAt)
      },
      () => {
        // 旧宿主读不到日志尾页：退回宿主列表判可达性 + 历史窗口扫描。
        void listSessions().then(
          (page) => {
            reachable()
            const row = page.items.find(item => item.sessionId === session.sessionId)
            // 只有明确说"跑着"的行才短路。缺行不算：列表按 updatedAt 分页，
            // 一个安静了一阵的会话会掉出首页，把它当"不跑"会让指示器永远卡住。
            if (row !== undefined && row.running !== false) return
            void (async (): Promise<void> => {
              try {
                const hpage = await history(session.sessionId, undefined, 1)
                for (let i = hpage.events.length - 1; i >= 0; i--) {
                  const type = hpage.events[i]?.event?.type
                  if (type === 'turn/end') {
        // 正常收工：清掉中断标记，下一轮不许继承。
        setAbandonedTurn(undefined)
        adopt(false, undefined)
        return
      }
                  if (type === 'turn/start') {
                    const time = hpage.events[i]?.event?.time
                    adopt(true, typeof time === 'number' && Number.isFinite(time) ? time : undefined)
                    return
                  }
                }
              } catch { /* transient; the next cadence retries */ }
            })()
          },
          () => { unreachable() },
        )
      },
    ).finally(() => { reconcileInFlightRef.current = false })
    }
    // 回合判定不再单独打 `mobile.turnState`：原子快照里已经有 turn（和行/队列同一个
    // 切面），这里直接读状态仓里那份。快照太旧（空闲时 chat 侧每 8 秒一问）就顺手
    // 催一次对账 —— 一次往返同时服务队列、回合、目标和待办，省掉一整条通道。
    const cached = cachedSnapshot(session.sessionId)
    const snapshotAge = cached === undefined ? Number.POSITIVE_INFINITY : Date.now() - cached.asOf
    if (cached === undefined || snapshotAge > SNAPSHOT_STALE_MS) {
      refreshInboxRef.current()
    }
    if (cached === undefined) {
      // 第一次核对还没有快照可读：退回尾页那套（宿主老、或刚打开还没落地）。
      reconcileFromTail()
      reconcileInFlightRef.current = false
      return
    }
    reachable()
    adopt(cached.turn.running === true, cached.turn.turnStartAt)
    reconcileInFlightRef.current = false
  }, [session.sessionId, normalizeTurnEndTodo])

  // Live frames: fold session events for this session in as they arrive.
  useEffect(() => {
    if (mux === undefined) return
    return mux.onFrame((frame: MuxFrame, frameRpcId?: string) => {
      // 帧能到就是通的：安卓上 navigator.onLine 会撒谎，实时帧不会。
      reportConnectivity(true)
      // Every live host event frame carries a `time` the host wrote moments
      // before dispatch, so it calibrates the host-clock offset. The running
      // turn's elapsed math then matches the DESKTOP clock (same host)
      // instead of drifting fast/slow by the phone's NTP skew over a public
      // link (a few seconds is normal phone-vs-PC clock difference). The
      // turn/start boundary frame is excluded: it anchors the clock and may
      // legitimately carry an older logged time.
      const frameEvent = (frame as { event?: { type?: unknown; time?: unknown } }).event
      if (typeof frameEvent?.time === 'number'
        && Number.isFinite(frameEvent.time)
        && frameEvent.type !== 'turn/start') {
        // 每个样本都被链路延迟压低（收到本机时间永远晚于事件的宿主时间），
        // 所以**最小的延迟**才是最近真值的那个，也就是样本里的最大值。
        // 以前每帧直接覆盖：一帧慢 300ms 就把整体读数顶低 300ms，下一帧又顶回来 ——
        // 屏幕上就是秒数忽快忽慢、偶尔跨两秒。取最近 N 个样本的最大值，既稳又能
        // 自愈（一次离谱样本会随窗口滑出）。
        const samples = hostClockSamplesRef.current
        samples.push(frameEvent.time - Date.now())
        if (samples.length > HOST_CLOCK_SAMPLE_WINDOW) samples.shift()
        hostClockOffsetRef.current = Math.max(...samples)
      }
      // Any frame proves the link is back (and the host alive).
      setHostLost(false)
      // The host's own running verdict. `turn/end` is the usual way the
      // indicator clears, but that frame can be lost (a reconnect window, a
      // killed turn, a stream that degraded to polling) and then nothing else
      // ever lowers it: the page kept painting the last turn as 深度求索中 and
      // claimed 输出中 while the desktop showed nothing running. The roster
      // event is the authoritative correction — it carries what the host
      // believes, independently of whether this page saw the boundary.
      if (frame.type === 'session/status') {
        if (frame.sessionId !== session.sessionId) return
        const hostRunning = frame.running === true
        setRunning(hostRunning)
        // 花名册优先级最低：能被实时帧/宿主快照盖掉，只负责纠正「帧丢了」的残留。
        shadowEvent({ type: 'turn', at: Date.now(), source: 'roster', running: hostRunning })
        if (!hostRunning) {
          // Settling here must also drop the active-turn pointer and the clock
          // anchor, or the last turn keeps matching `liveTurn` and stays
          // "running" with a stopwatch that never stops.
          setRunningTurn(undefined)
          setTurnStartAt(null)
        }
        return
      }
      if (frame.type === 'session/event') {
        if (frame.sessionId !== session.sessionId) return
        // 本会话真的在送事件——核对判据之外的旁证，也用于链路活性判断。
        lastSessionEventAtRef.current = Date.now()
        const event = frame.view === undefined
          ? frame.event as WireEvent
          : { ...frame.event, view: frame.view } as WireEvent
        // Track the turn running state for the "outputting" indicator (#1017).
        if (typeof event.type === 'string') {
          if (event.type === 'turn/start') {
            setRunning(true);             // 同一帧带着轮号：行级"还在跑"判据靠它认出"这一步属于正在跑的那一轮"
            // （宿主按步发 assistant/message，按步定格的行自己看不出回合还开着）。
            setRunningTurn(turnNumberOf(event))
        setAbandonedTurn(undefined)
            // Anchor the turn clock at the logged start (desktop parity):
            // a mid-turn reload keeps the real elapsed time.
            setTurnStartAt(typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : Date.now())
            // A turn start is when subagents spawn; refresh the tree.
            refreshSubagentsRef.current()
            // The host clears the todo projection at turn/start; mirror it so
            // a stale plan never outlives the turn that wrote it.
            //
            // 但**水位要留着**：直接 setTodo(undefined) 把上一轮那份计划的 seq 也丢了，
            // 之后一页更旧的历史（里面带着上一轮的 todo/write）就能把它重新塞回来 ——
            // 新回合已经开始、屏幕上却还挂着上一轮的计划（真机排查时可见的串轮）。
            // 保留 seq、清空条目：新回合自己的 todo/write seq 更大，照常落地。
            setTodo(previous => previous === undefined ? previous : { seq: previous.seq, items: [] })
            // A turn start claims the pending queue (the agent picks up the
            // next queued message in FIFO order). The host broadcasts a fresh
            // session/queue snapshot, but that frame can be lost when the SSE
            // channel degrades to fallback polling (which does not replay
            // session/queue). Clear the local queue view so a claimed message
            // never lingers as a phantom row that can no longer be edited or
            // removed.
            // 清空只是"队首被认领"的乐观视图：一轮开始只拿走队首一条，剩下的必须
            // 留着。以前清完就等下一次轮询（空闲时 20 秒），期间手机上整条队列消失，
            // 而桌面端（读宿主投影）还挂着 —— 真机就是这个现象。清完立刻问一次真值。
            // 只认领队首一条（宿主是 FIFO），其余还排着 —— 而且必须**从状态仓里**
            // 一起移走：只清本地列表的话，下一份快照（可能是几分钟前的投影）会把
            // 被认领的那条画回来，排队条就「消失→出现」闪一下。
            claimQueueHead(session.sessionId)
            startTransition(() => { setQueueItems(queueView(session.sessionId)) })
            refreshInboxRef.current({ fresh: true })
          }
          if (event.type === 'turn/end') {
            // 这一轮的收尾是**亲眼看到**的：它的卡由实时帧自己折出来（带参数、
            // 带 tool/result 的 meta），不必再为它回读日志。
            const closed = turnNumberOf(event)
            if (closed !== undefined) liveClosedTurnsRef.current.add(closed)
            setRunning(false)
            // 亲眼看到的收尾：frame 优先级，只有 local（宿主复核）能再改它。
            shadowEvent({
              type: 'turn',
              at: Date.now(),
              source: 'frame',
              running: false,
              ...(closed === undefined ? {} : { turnNo: closed }),
            })
            // 活跃轮次随之清空：按步定格的行立刻回到 已完成/已中断/失败。
            setRunningTurn(undefined)
            setTurnStartAt(null)
            // Mirror the host's turn/end normalization (see normalizeTurnEndTodo).
            normalizeTurnEndTodo()
          }
          // todo/write is a full-list snapshot (last-write-wins): adopt it
          // into the plan strip. It keeps flowing into the fold below, which
          // ignores unknown types, so the message stream is unaffected.
          if (event.type === 'todo/write') startTransition(() => { adoptTodoLatest(event) })
        }
        if (tailLoadingRef.current) {
          if (liveBufferRef.current.length >= MAX_TAIL_BUFFER_EVENTS) {
            // Bound the tail-load window: drop the oldest buffered event and
            // remember its seq window so the follow-up refill can re-fetch
            // exactly the dropped range (a flat tail re-pull would only
            // return events the fold already consumed). Warn once per load.
            const dropped = liveBufferRef.current.shift()
            if (dropped !== undefined) {
              const current = dropWindowRef.current
              dropWindowRef.current = current === undefined
                ? { from: dropped.seq, to: dropped.seq }
                : { from: Math.min(current.from, dropped.seq), to: Math.max(current.to, dropped.seq) }
            }
            if (!liveBufferOverflowRef.current) {
              console.warn(
                `history tail is slow: live buffer reached ${MAX_TAIL_BUFFER_EVENTS} events; the dropped seq window will be re-fetched`,
              )
              liveBufferOverflowRef.current = true
            }
          }
          liveBufferRef.current.push(event)
          return
        }
        // rAF micro-batch: buffer the event and fold all buffered events on
        // the next animation frame (one reconcile per frame instead of one
        // per SSE chunk). The immediate side-effects above (turn/start·end,
        // todo/write) already ran synchronously, so the running indicator and
        // plan strip stay responsive; only the message fold is deferred.
        eventBatchRef.current.push(event)
        scheduleEventFlush()
        return
      }
      // Live projection pushes keep the permission picker and the context
      // usage chip current.
      if (frame.type === 'session/projection' && frame.sessionId === session.sessionId) {
        if (frame.key === 'permissions') setPermissions(parsePermissionSelect(frame.value))
        if (frame.key === 'contextPressure') setContextPressure(parseContextPressure(frame.value))
        // 排队消息也走投影：宿主从不发 `session/queue`，发的是 `inbox`。漏了这条，
        // 手机端就永远看不到"已排队"的那几条。
        if (frame.key === 'inbox') applyInbox(frame.value)
        // 目标条也走投影：宿主在目标每次变更后推 key='goal' 的帧。
        if (frame.key === 'goal') applyGoal(frame.value)
        return
      }
      // 目标激活态帧：桌面端点暂停只撤授权（durable 相位仍 active），投影不会变，
      // 所以必须靠这一帧把条子的按钮从「暂停」换成「继续」。
      if (frame.type === 'goal/activation' && frame.sessionId === session.sessionId) {
        setGoal(current => current === null || current === undefined ? current : { ...current, activation: frame.activation })
        return
      }
      // Background-task snapshot for this session (subagent delegations etc.).
      // The host sends a full set after every registry commit; adopt it whole.
      if (frame.type === 'session/jobs' && frame.sessionId === session.sessionId) {
        startTransition(() => { setJobs(frame.jobs) })
        return
      }
      // New mux-generation baseline: the host re-subscribes every session on
      // each stream (re)open and pushes its queue/jobs snapshots right after —
      // and only when non-empty. An omitted baseline means "empty", so any
      // rows retained from the previous generation would linger as phantoms
      // (the same re-baseline reset the desktop runtime applies to its queue
      // mirror on session/subscribed). Drop both views; the frames that follow
      // this one — if any — repopulate them.
      if (frame.type === 'session/subscribed' && frame.sessionId === session.sessionId) {
        startTransition(() => { setQueueItems([]); setJobs([]) })
        // 新一条连接的基线帧：断线期间丢掉的 turn/end（或 turn/start）不会重放，
        // 手机就会一直停在"输出中"，或者该亮的时候不亮。基线一到就核一次。
        reconcileRunning()
        return
      }
      // Pending-message queue snapshot for this session (desktop QueueDock
      // equivalent): adopt the whole set on every change.
      if (frame.type === 'session/queue' && frame.sessionId === session.sessionId) {
        startTransition(() => {
          // 帧里带 placement，但手机端不采信 steering 这个值：点过「立即发送」之后宿主
          // 会把它标成 steering，而排队条只渲染 queued —— 于是这条在手机上整个消失，
          // 桌面端（读 next-turn 投影，那里没有 placement）却一直挂着。宿主的 next-turn
          // 才是"还在排队"的真值：只要它没把这条移走，两端就该都显示。
          const items = (frame.items ?? []).map(item => queueItemViewOf({
            id: String(item.id),
            placement: 'queued',
            message: item.message as never,
          }))
          // 帧也进状态仓：队列只有一个来源，本地隐藏/乐观项才不会跟帧互相盖掉。
          applyQueueItems(session.sessionId, items)
          setQueueItems(queueView(session.sessionId))
        })
        return
      }
      // Approval/question frames for this session (#1025).
      if (!('sessionId' in frame) || frame.sessionId !== session.sessionId) return
      if (frame.type === 'approval/requested') {
        startTransition(() => {
          setPendingApprovals(previous => {
            // This phone already answered it: the host replays what it still
            // holds, and a replay must never resurrect an answered panel.
            if (answeredApprovalsFor(session.sessionId).has(frame.approvalId as string)) return previous
            if (previous.some(a => a.approvalId === frame.approvalId)) return previous
            return [...previous, {
              rpcId: frameRpcId ?? '',
              approvalId: frame.approvalId as string,
              toolName: frame.toolName,
              callId: frame.callId as string | undefined,
              reason: frame.reason,
            }]
          })
        })
        return
      }
      if (frame.type === 'approval/resolved') {
        startTransition(() => {
          setPendingApprovals(previous => previous.filter(a => a.approvalId !== frame.approvalId))
        })
        return
      }
      if (frame.type === 'question/requested') {
        const items = (frame.questions as Array<{
          id: string; question: string; detail?: string; header?: string
          options?: Array<{ label: string; description?: string }>; multiSelect?: boolean
        }>).map(item => ({ rpcId: frameRpcId ?? '', ...item }))
        // A batch this phone already answered is never re-shown: the host
        // replays every still-pending question on each mux (re)subscribe, so a
        // late replay must not resurrect an answered panel.
        const unanswered = items.filter(q => !answeredQuestionsFor(session.sessionId).has(q.rpcId))
        startTransition(() => { setPendingQuestions(unanswered) })
        return
      }
      if (frame.type === 'question/resolved') {
        startTransition(() => { setPendingQuestions([]) })
        return
      }
    })
  }, [mux, session.sessionId, reconcileRunning, applyInbox])

  // Weak-network polling fallback: when the assistant is running, poll for
  // pending approvals/questions so the phone can act even if the SSE channel
  // drops frames (#1025). The cadence adapts to the live stream: while SSE is
  // delivering (pending items also arrive as frames) poll slowly as a safety
  // net; only while it is stalled does the poll go fast.
  useEffect(() => {
    if (!running || !foreground) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      if (cancelled) return
      void fetchPending(session.sessionId).then(
        (state) => {
          if (cancelled) return
          // Polling is a weak-network fallback: never let an empty poll result
          // clobber a panel the live SSE stream already showed. A dropped
          // question/requested frame (tunnel blip) would otherwise make the
          // panel vanish seconds after it appears. Only adopt non-empty results.
          startTransition(() => {
            // A response already in flight when the user answered still carries
            // the retired approval: filtered out like the question batch is.
            setPendingApprovals(prev =>
              adoptPolledApprovals(prev, state.approvals, answeredApprovalsFor(session.sessionId)))
            // The poll is authoritative for what the host still holds, but the
            // tracker behind it can carry a batch this phone already answered
            // (its question/resolved frame was missed): see question-batches.ts.
            setPendingQuestions(prev =>
              adoptPolledQuestions(prev, state.questions, answeredQuestionsFor(session.sessionId)))
          })
        },
        () => { /* transient; next tick retries */ },
      )
      const live = mux?.isSseLive() ?? true
      // While SSE is delivering, pending items also arrive as frames — the
      // poll is only a safety net for dropped frames, so it runs at a long
      // cadence (4× the idle interval) instead of adding a request every
      // 15 s on a weak link. Only a stalled SSE goes fast.
      timer = setTimeout(tick, live ? PENDING_POLL_IDLE_MS * 4 : PENDING_POLL_FAST_MS)
    }
    tick()
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer) }
  }, [running, session.sessionId, mux, foreground])

  // Running reconciliation: the live turn/end frame can be lost to a tunnel
  // blip - the EventSource reconnects, its keep-alives resume, the polling
  // fallback never arms, and the indicator would stay on for a finished turn
  // until the next full reload. The same is true in reverse: a turn that starts
  // while the phone is dozing never announces itself. So this cadence runs in
  // BOTH directions and stays cheap - `reconcileRunning` reads the server-folded
  // log tail (~20 ms) instead of session.history (34 s on a 52 MB session).
  useEffect(() => {
    aliveRef.current = true
    if (!foreground) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = (): void => {
      if (cancelled) return
      // 兜底核对。运行状态的主来源现在是宿主在轮次边界主动推的 session/status
      // （与桌面端同源）：回合开始/结束那一刻手机就知道，不再每十秒重新怀疑一次。
      // 这里只覆盖"边界帧被断流丢了"——所以只在跑着的时候排下一拍，没在跑就停，
      // 回合开始由那条推送叫醒。
      reconcileRunning()
      if (running) timer = setTimeout(tick, RUNNING_RECONCILE_MS)
    }
    // 打开会话、回到前台、running 翻转：先让推送落地，再兜一次。
    timer = setTimeout(tick, INITIAL_RECONCILE_MS)
    return () => {
      cancelled = true
      aliveRef.current = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [running, session.sessionId, mux, foreground, reconcileRunning])
  // Foreground subagents: fetch on mount/session-switch, and refetch on
  // turn/start (see onFrame). One flat subagents.list call — no recursive
  // tree walk. The live host/session-status overlay keeps running flips
  // instant between fetches.
  const refreshSubagents = useCallback(() => {
    void fetchSubagentsFlat(session.sessionId).then(
      (nodes) => { startTransition(() => { setSubagents(nodes) }) },
      () => { /* transient; the next trigger retries */ },
    )
  }, [session.sessionId])
  const refreshSubagentsRef = useRef(refreshSubagents)
  refreshSubagentsRef.current = refreshSubagents
  useEffect(() => {
    refreshSubagents()
  }, [refreshSubagents])
  // While the turn is open, poll the flat list so the run-status sheet stays
  // fresh (new subagents spawn mid-turn; the host stream is not forwarded).
  useEffect(() => {
    if (!running || !foreground) return
    const id = setInterval(() => { refreshSubagentsRef.current() }, SUBAGENT_POLL_MS)
    return () => { clearInterval(id) }
  }, [running, foreground])

  // The turn clock (desktop parity) anchors HERE: this file owns the anchor (the
  // logged turn/start, fallback: mount time) and the host-time offset. The 1 Hz
  // ticker is `useLiveClock` (live-clock.ts) and its counter is handed ONLY to
  // the rows that are actually running - as a prop, so it wakes them through the
  // memo even when their own frozen interval never comes back. The reading itself
  // is taken from the wall clock at render time, so a re-render is a refresh. The
  // clock span only renders past TURN_CLOCK_THRESHOLD_MS (short turns keep the
  // plain label).
  // The clock rides the turn ANCHOR, not the running flag: that flag is a
  // liveness heuristic (roster seed, reconcile verdict) which flaps on a
  // flaky phone link, and every flap used to zero the elapsed time the user
  // was watching. The anchor is written by the turn/start boundary (live
  // frame or history tail) and cleared only by the matching turn/end.
  //
  // 锚点缺了就退回"这一轮自己的行"：折叠时已经把 turnStartAt 盖在行上，行也带
  // 时间。此前这里直接退到挂载时刻，于是打开一个已经跑了十分钟的会话，秒表从 0
  // 开始数——一个明显不对的数比没有数更糟。挂载时刻只留给"连行都没有"的情形
  // （宿主的运行集合说在跑，但一条本轮的记录都还没折出来）。
  // 失帧自愈：turn/end 与 turn/start 是两帧，手机在弱网/切后台时经常漏掉其中一帧。
  // 漏了 turn/end，runningTurn 和计时锚点就永远停在上一轮 —— 上一轮的卡片一直「正在回答」
  // 并继续数秒，而新一轮的秒表从上一轮的起点开始算（截图里 46 秒就是这么来的）。
  //
  // 判据只用一条不会误伤的证据：**出现了轮号更大的 assistant 行**。那说明更晚的一轮已经在
  // 写回复了，手上这个轮号必然是过期的。不能拿「更新的用户消息」当判据 —— 插话（steer）和
  // 排队消息被认领都是在同一轮里追加用户消息，那样会把正在跑的这一轮误清零。
  useEffect(() => {
    if (runningTurn === undefined) return
    const newer = turnNumberIsStale(runningTurn, messages)
    if (!newer) return
    setRunningTurn(undefined)
    setTurnStartAt(null)
  }, [messages, runningTurn])


  /** reconcile 是长寿命 effect：ref 里放最新轮号（messages 已有 messagesRef）。 */
  const runningTurnRef = useRef<number | undefined>(runningTurn)
  useEffect(() => { runningTurnRef.current = runningTurn }, [runningTurn])

  const clockAnchor = turnStartAt ?? (running ? (newestTurnAnchor(messages) ?? mountTimeRef.current) : null)
  /**
   * 当前活跃轮次（没有活跃回合时 undefined）—— 逐层传给 MessageRow → AssistantBody
   * → ProcessGroup 的 liveTurn，行级"还在跑"判据的第三个分量。
   *
   * 门控就是底部状态行的门控：那条 `输出中 / 连接中断` 行是
   * `{running && ...}` 渲染出来的，所以这里也只能看 running —— 否则会出现
   * "状态行说结束了、某张卡还在数秒"的自相矛盾。running 为假时任何行都不是
   * 运行中：turn/end（或 reconcile 探针）一到，活跃轮次立刻消失，按步定格的行
   * 马上回到 已完成/已中断/失败。
   *
   * 轮号优先用 turn/start 帧带回来的（runningTurn）；中途重开这种没有帧的场景
   * 退回折叠里最新的一轮 assistant 行。
   */
  //
  // 「这一轮还开着吗」跟**锚点**走，不跟 running 这个旗标走。running 是启发式的，
  // 断一下网、丢掉一帧就会翻假；锚点只在日志里真的写到 turn/end 时才清空。以前行级
  // 判据挂在 running 上：它一翻假，settled 立刻把所有过程框的头改成「已完成」，而里面
  // 那条命令的工具行还在「运行中」——同一个框里前后矛盾。

  const cardRecoveryRef = useRef<{ busy: boolean; pending: boolean; cooling: Map<number, number>; confirmed: Set<number> }>({ busy: false, pending: false, cooling: new Map(), confirmed: new Set() })
  const liveClosedTurnsRef = useRef<Set<number>>(new Set())
  const turnLive = running || turnStartAt !== null
  /**
   * 活跃轮次（帧里没带轮号时的兜底）。
   *
   * 兜底是"最后出现的那一轮"，但**已经收工的那一轮不算** —— 收工的证据有两种：
   * 亲眼见过它的 turn/end，或它的卡是被日志确认过的（补读那一遍）。以前没有这层
   * 过滤：发送完一条消息、新回合的 turn/start 还没到时，"最后出现的一轮"就是刚刚
   * 结束的上一轮，于是它的交付物卡被当成"这轮还在跑"藏起来 —— 真机现象就是
   * 「发送完当前消息，上一条的卡消失」。
   */
  const newestLiveTurn = ((): number | undefined => {
    const newest = newestFoldTurn(messages)
    if (newest === undefined) return undefined
    if (liveClosedTurnsRef.current.has(newest)) return undefined
    if (cardRecoveryRef.current.confirmed.has(newest)) return undefined
    return newest
  })()
  const liveTurn = turnLive ? (runningTurn ?? newestLiveTurn) : undefined
  /**
   * 秒表心跳：只有存在活跃回合、且页面可见时才跑。它每秒变的这个数会作为 prop
   * 传给"正在跑"的那几行（见 live-clock.ts）—— 于是哪怕那一行自己的定时器被
   * 浏览器冻住没回来，props 变化也照样把它叫醒，读数（渲染时取墙钟）立刻跟上。
   * 不跑的行收不到这个 prop，memo 照旧挡住它们。
   */
  const liveClockTick = useLiveClock(turnLive && foreground)
  /**
   * 目标条上的进度摘要：已跑多久、走到第几步。
   *
   * 「第几步」用最新那张过程卡的步数（和过程条同一个来源），所以两处永远一致。
   */
  const goalMeta = ((): string | undefined => {
    if (goal === null || goal === undefined) return undefined
    const parts: string[] = []
    if (running && turnStartAt !== null) {
      const elapsed = Date.now() - turnStartAt + hostClockOffsetRef.current
      if (elapsed > 1_000) parts.push(`已跑 ${formatDuration(elapsed)}`)
    }
    const newest = messages.length > 0 ? messages[messages.length - 1] : undefined
    const step = newest?.step
    if (step !== undefined && step > 0) parts.push(`第 ${step} 步`)
    return parts.length === 0 ? undefined : parts.join(' · ')
  })()
  /** 一次性探针用：最近一次渲染决定的绘制窗口与当前活跃轮次。 */
  const paintProbeRef = useRef<Record<string, unknown> | undefined>(undefined)
  const paintProbeUsedRef = useRef(false)
  useEffect(() => {
    if (paintProbeUsedRef.current) return
    paintProbeUsedRef.current = true
    const timer = window.setTimeout(() => {
      const probe = paintProbeRef.current
      if (probe === undefined) return
      try {
        void reportPerf({
          stamps: [{ at: Date.now(), label: 'carddom' }],
          diagnostic: 'card-dom',
          at: Date.now(),
          ...probe,
          painted: document.querySelectorAll('.chat-turn-tail').length,
          paintedRows: document.querySelectorAll('.chat-msg').length,
          fromBottom: (() => {
            const node = scrollRef.current
            return node === undefined ? null : Math.round(node.scrollHeight - node.scrollTop - node.clientHeight)
          })(),
        }, 'carddom').catch(() => { /* 探针失败不影响聊天 */ })
      } catch {
        // 老宿主没有这个入口：少一条探针而已。
      }
    }, 2_500)
    return () => { window.clearTimeout(timer) }
  }, [session.sessionId])
  /**
   * 「本轮产出」卡片的**唯一来源**：日志里那一轮 `tool/result` 的 meta。
   *
   * 页（loadChatPage 折出来的行）只用来显示，不参与"产出了哪些文件"的判断 —— 它会被
   * 投影剥掉参数、有时只剩工具名，窗口还会把一轮里早先的 edit 截掉；真机就是这样一会
   * 儿有卡、一会儿整轮没卡。这里对列表里每一个"没亲眼看到收尾"的已完成回合回读一次
   * 日志，翻到它自己的 `turn/start` 才折，拿到的是整轮清单。
   *
   * 亲眼看过 turn/end 的回合跳过：它的卡本来就是从同一批实时事件折出来的。
   */
  /** 补读跑着的时候列表又变了：跑完再补一轮（否则那一批回合永远轮不到）。 */
  const [cardSyncTick, setCardSyncTick] = useState(0)
  useEffect(() => {
    cardRecoveryRef.current = { busy: false, pending: false, cooling: new Map(), confirmed: new Set() }
    liveClosedTurnsRef.current = new Set()
  }, [session.sessionId])
  useEffect(() => {
    const state = cardRecoveryRef.current
    if (state.busy) { state.pending = true; return }
    const rows = renderRows(messages)
    // 两种回合要回读日志：
    // ① 这一轮现在**没有卡** —— 列表会被整份换掉好几次（缓存页 → 网络页 → 实时重放
    //    基线、往上补页），卡跟着没了；靠"补过一次就记账"会把它永久丢掉，真机就是
    //    这样「点进会话，卡片突然又消失」。
    // ② 卡在，但还没被日志确认过（页里那版是猜的）—— 读一次拿到真清单就不再读。
    const missing = new Set(missingTurnReports(rows))
    const now = Date.now()
    const done = completedTurns(rows)
    // 只补「最近两轮」的卡。历史轮次也补的话，往上翻的那几秒里卡片会一张张冒出来 ——
    // 用户看到的就是「翻历史时交付卡闪一下」。历史页该由页自己带卡（带 turn/end 才有）。
    const newestDone = done.reduce((max, turn) => (turn > max ? turn : max), 0)
    const wanted = done.filter(turn => (
      !liveClosedTurnsRef.current.has(turn)
      && (state.cooling.get(turn) ?? 0) <= now
      && (missing.has(turn) || !state.confirmed.has(turn))
      && newestDone - turn <= REPORT_RECOVERY_WINDOW_TURNS
    ))
    if (wanted.length === 0) return
    state.busy = true
    const run = async (): Promise<void> => {
      const wantedSet = new Set(wanted)
      let accumulated: WireEvent[] = []
      let cursor: number | undefined
      let pages = 0
      let whole = false
      for (let index = 0; index < REPORT_FALLBACK_MAX_PAGES; index++) {
        const raw = await history(session.sessionId, cursor, REPORT_FALLBACK_PAGE_MESSAGES)
        pages += 1
        const events = raw.events.map(entry => (entry.view === undefined
          ? entry.event
          : { ...entry.event, view: entry.view })) as WireEvent[]
        if (events.length === 0) break
        accumulated = [...events, ...accumulated]
        // 每一轮都要翻到它自己的起点：按条数截断只会拿到回合后半段。
        const started = new Set<number>()
        for (const event of accumulated) {
          if (event.type !== 'turn/start') continue
          const data = event.data as Record<string, unknown> | undefined
          const turn = typeof data?.['turn'] === 'number' ? data['turn'] : undefined
          if (turn !== undefined) started.add(turn)
        }
        whole = [...wantedSet].every(turn => started.has(turn))
        if (whole) break
        const firstSeq = events[0]?.seq
        if (!raw.hasMore || firstSeq === undefined || firstSeq === cursor) break
        cursor = firstSeq
      }
      // 只要日志给出了这一轮的任何报告行就采用（页里那版是猜测，同 id 会被替换）。
      const recovered = foldEvents(accumulated).filter(row => (
        row.kind === 'turn' && row.turn !== undefined && wantedSet.has(row.turn)
      ))
      // 同上：交付卡回读也必须过唯一入口，否则和缓存页各自画一份。
      if (recovered.length > 0) commitRows(previous => mergeTurnReports(previous, recovered))
      else reportCardDiagnostic(rows, wanted, { pages, whole, source: 'network' })
      markTried()
    }
    /** 这一批冷却一会儿再重读（列表又换掉时冷却过期，卡会自己补回来）。 */
    const markTried = (): void => {
      const until = Date.now() + CARD_SYNC_COOLDOWN_MS
      for (const turn of wanted) state.cooling.set(turn, until)
    }
    void run().catch(() => {
      // 补不到就照原样显示：卡片缺席，聊天本身不受影响；冷却过后再试。
      markTried()
    }).finally(() => {
      state.busy = false
      // 跑的时候列表又变了（补页落地、实时帧收尾）：再来一轮，别把新回合落下。
      if (state.pending) {
        state.pending = false
        setCardSyncTick(tick => tick + 1)
      }
    })
  }, [messages, session.sessionId, cardSyncTick])
  /**
   * 这一行是否已被裁决为「停」（秒表定格、状态词收尾）。
   *
   * 判据必须**按轮**，不能只看「这一场有没有回合在跑」：
   * 以前只要 turnLive 就把所有卡都当成在跑，于是新的一轮开始时，上一轮那张
   * 已经收工的卡也顶着「深度求索中」和**同一个秒表**（秒表是会话级的），
   * 屏幕上就是两张长得一样的过程卡（真机 2026-10-29 反复复现）。
   */
  const settledOf = (message: RenderMessage): boolean => {
    if (!turnLive) return true
    if (abandonedTurn !== undefined && message.turn === abandonedTurn) return true
    // 取两边更大的那个：runningTurn 可能比屏幕上最新的一轮旧（帧延迟 / 断线重连），
    // 只看它会把最新一轮判成已停、把旧一轮判成在跑——屏幕上就是多张顶着秒表的卡。
    const newest = Math.max(runningTurn ?? -1, newestFoldTurn(messages) ?? -1)
    // 缺轮号的行不能默认为「正在跑」：上一轮残留的卡会顶着秒表，看起来像又跑了一轮
    // （真机：两张卡用时一模一样）。判据用 pending —— 那是「还在流」的唯一可靠信号，
    // 比「是不是最后一行」稳（最后一行也可能是刚落地的收工行）。
    if (message.turn === undefined) return message.pending !== true
    return message.turn !== newest
  }


  /** Mark everything seen: advance the seen-turn baseline to the newest
   * turn and clear the unread badge. */
  const markSeen = useCallback(() => {
    const last = messagesRef.current[messagesRef.current.length - 1]
    if (last !== undefined) {
      lastSeenTurnRef.current = Math.max(lastSeenTurnRef.current, last.turn ?? 0)
    }
    setUnreadCount(0)
  }, [])

  /** The turn of the row nearest the top of the viewport.
   *
   *  Only assistant rows carry a `turn` (user prompts and command rows do not —
   *  see messages.ts chunkTarget), so the top row itself often has none. The
   *  reading turn is therefore the first row AT OR BELOW the top row that has a
   *  turn (the prompt above it began that turn), scanning upward only as a
   *  fallback. It never falls back to the newest turn: doing so made the handle
   *  report the tail while the reader was deep in history.
   *
   *  行全渲染之后，这里不再需要"前缀和反查行号"：直接按 DOM 的真实几何找
   *  视口顶部那一行即可（estimateMessageHeight 只在没有布局的环境里兜底）。
   *  Returns undefined when no loaded row carries a turn. */
  const deriveCurrentTurn = (scrollTop: number): number | undefined => {
    const list = messagesRef.current
    const count = list.length
    if (count === 0) return undefined
    const el = scrollRef.current
    let index = count - 1
    if (el !== undefined && typeof el.querySelectorAll === 'function') {
      const rows = el.querySelectorAll<HTMLElement>('[data-mid]')
      const anchorTop = el.getBoundingClientRect().top + 8
      let best = -1
      for (let i = 0; i < rows.length; i++) {
        const mid = rows[i].dataset['mid']
        if (mid === undefined) continue
        const at = list.findIndex(message => message.id === mid)
        if (at < 0) continue
        // 第一条底边越过视口顶的行，就是"正在读的那一行"。
        if (rows[i].getBoundingClientRect().bottom >= anchorTop) { best = at; break }
      }
      if (best >= 0) index = best
    } else {
      let acc = 0
      index = count - 1
      for (let i = 0; i < count; i++) {
        acc += estimateMessageHeight(list[i])
        if (acc > scrollTop) { index = i; break }
      }
    }
    return readingTurnAt(list, index)
  }


  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (el === undefined) return
    // 先取旧位置再覆盖：以前是先写 scrollTopRef 再比较，于是 `up` 永远是 false，
    // 「读者往上滑」这个最重要的意图一直没被识别出来（跟手冲突、翻页被拽到底都源于此）。
    const previousTop = scrollTopRef.current
    const movingUp = el.scrollTop < previousTop - 1
    scrollTopRef.current = el.scrollTop
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    // A programmatic scroll (the opening tail pin, the locate, a prepend
    // anchor correction) must not be mistaken for a user gesture: it would
    // release the locate lock and let the follower re-pin the viewport to the
    // tail. Only a genuine user scroll releases the lock — and, below, only a
    // genuine user gesture may record a reading bookmark.
    // 这次 scroll 是不是我们自己写的？必须**值也对得上**才算：只认标记的话，一次没有
    // 回声的写入会把读者接下来的真实手势吃掉（继而被当成「他贴在底部」而拽走画面）。
    const claimed = programmaticScrollRef.current
      && Math.abs(el.scrollTop - programmaticValueRef.current) <= 2
      && Date.now() - programmaticAtRef.current < 250
    programmaticScrollRef.current = false
    const programmatic = claimed
    // 位置**永远**按量到的写：程序化写入的回声里 el.scrollTop 已经变了，它就是读者
    // 此刻的真实位置（老代码也是无条件记 gap 的，漏掉这一步会让「读者在历史里」
    // 被当成「贴底」，随后新消息一到就把画面拽走）。
    scrollEvent({ type: 'measure', gap })
    // 只有**手指参与过**的滚动才算读者手势：
    //  · 手指还按着，或刚松手 800ms 内（惯性滑行）；
    //  · 否则一律当成回声/浏览器滚动锚定 —— 这类事件以前会被误判成手势，
    //    把跟随锁存（stick）和补钉（userMoved）一起关掉，结果进会话停在离底 245px 的地方。
    const touchedRecently = Date.now() - lastTouchAtRef.current < 800
    if (!programmatic && (touchedRecently || scrollStateRef.current.touching)) {
      // 真实手势再补一层语义：见过手势、顺延静默窗口、释放定位锁。
      scrollEvent({ type: 'gesture', at: Date.now(), gap, up: movingUp })
      scrollEvent({ type: 'locate-end' })
    }
    // The jump-to-latest button appears once the reader scrolled away from
    // the bottom (same threshold the auto-follower uses); React bails out on
    // unchanged values, so this costs nothing while scrolling.
    setShowJumpToLatest(gap > BOTTOM_FOLLOW_THRESHOLD_PX)
    // A bookmark means "the reader left the bottom to read history", so it is
    // guarded by the same gap criterion as the 「回到最新消息」 button. Settling
    // at (or near) the bottom is reading the newest content — the opening pin
    // lands mid-history only because the container still carries estimated
    // heights at that moment, and that must never become a bookmark.
    const leftBottom = gap > BOTTOM_FOLLOW_THRESHOLD_PX
    if (!programmatic) {
      // Track the turn whose row sits nearest the top of the viewport (the
      // reader's position): drives the turn-list highlight and the handle's
      // current/total readout. Mirrors locateWindow's scrollTop→row conversion.
      // 0 means "no position yet"; the render falls back to the newest turn
      // once. A programmatic event is the echo of a write, not the reader's
      // position, so it must not overwrite the tracked turn either.
      const readPosition = deriveCurrentTurn(el.scrollTop) ?? 0
      setCurrentTurn(readPosition)
    }
    // Scrolling back to the bottom counts as reading: clear the unread
    // badge and advance the seen-turn baseline, so a reader who manually
    // scrolls down (instead of tapping the jump button) also clears the
    // tally. React bails out on an unchanged count, so this is free while
    // the reader is already at the bottom.
    if (gap <= BOTTOM_FOLLOW_THRESHOLD_PX) markSeen()
    // 「读者滚过没有」由状态机在 gesture 事件里记（见 scroll-machine.ts）。
    // 无限上翻：读到接近顶部就自动接上一页，不再让用户为了"再往前看一点"
    // 反复点按钮。要求内容确实比视口高（否则刚挂载时的 scrollTop=0 会被当成
    // 读到顶）、并且当前没有在飞的请求。prepend 之后锚点会把 scrollTop 抬高，
    // 条件自然失效，不会连发。
    if (hasOlder && !pendingRef.current
        && el.scrollHeight > el.clientHeight
        && el.scrollTop <= NEAR_TOP_LOAD_PX) {
      loadOlderRef.current(true)
    }
  }, [hasOlder, markSeen])

  useEffect(() => () => {
    if (eventFlushRafRef.current !== undefined) cancelAnimationFrame(eventFlushRafRef.current)
  }, [])

  // Drop any pending reading timer when the view goes away: the timer only
  // drove the retired 「回到上次」 bookmark, so nothing else needs flushing.
  useEffect(() => () => {
    if (readingTimerRef.current !== undefined) {
      window.clearTimeout(readingTimerRef.current)
      readingTimerRef.current = undefined
    }
  }, [])

  /**
   * Write a programmatic scroll position. handleScroll reads the flag as "the
   * next scroll event is the echo of this write, not a reader gesture" — such
   * an event does not release the locate lock.
   * Armed only when the write really moves the container: an unchanged
   * scrollTop fires no scroll event, and the stale flag would then swallow the
   * reader's next genuine gesture.
   */
  const setScrollTopProgrammatically = useCallback((el: HTMLDivElement, value: number): void => {
    if (el.scrollTop !== value) {
      programmaticScrollRef.current = true
      programmaticValueRef.current = value
      programmaticAtRef.current = Date.now()
    }
    el.scrollTop = value
    scrollTopRef.current = el.scrollTop
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el === undefined) return
    setScrollTopProgrammatically(el, el.scrollHeight)
    // 这一写就是「我在最新消息这里」：交给状态机的 pin 事件记账。
    scrollEvent({ type: 'pin' })
  }, [setScrollTopProgrammatically, scrollEvent])

  /** 钉到真正的底部。已载入的行全渲染，所以 el.scrollHeight 就是真值 —— 不再有
   *  "估高 spacer 要补一个修正量"这一步（那正是以前落点永远差一截的来源）。 */
  const pinToRealBottom = useCallback(() => {
    const el = scrollRef.current
    if (el === undefined) return
    setScrollTopProgrammatically(el, el.scrollHeight)
  }, [setScrollTopProgrammatically])

  /**
   * 钉底之后再补两拍。
   *
   * commit 那一刻量到的 scrollHeight 常常**已经过期**：计划胶囊、字体、图片、
   * 「加载更早的消息」按钮都在这一帧之后才把高度长出来，于是首屏停在离底 30~40px
   * 的地方（真机实测 gap=34）。rAF 一拍解决绝大多数，120ms 那一拍兜字体/图片。
   * 只在读者本来就贴底时补，往上翻历史的人不受影响。
   */
  const settleBottomAfterCommit = useCallback(() => {
    const pinIfShort = (): void => {
      const el = scrollRef.current
      if (el === undefined) return
      if (!maySettlePin(scrollStateRef.current, Date.now())) return
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      if (gap <= 2) return
      setScrollTopProgrammatically(el, el.scrollHeight)
      lastScrollHeightRef.current = el.scrollHeight
    }
    // 布局安定前反复补：长列表的高度是分段长出来的（content-visibility 行铺开、
    // 卡片补进来、字体换行），一次 rAF 只覆盖最简单的情况。拍子递减，最多到 1.5 秒；
    // 读者一动手（状态机的 userMoved）就整段作废。
    requestAnimationFrame(pinIfShort)
    // 尾巴拉长到 4 秒：实测「再次进入」时最后一段高度（交付卡、图片、字体换行）
    // 可能在 1.5 秒之后才长出来，那时停在离底 41px 的地方，最后一行被切一半。
    // 安全的前提是 pinIfShort 只对「读者没动过手」生效（maySettlePin）。
    for (const delay of [60, 180, 400, 800, 1_500, 2_500, 3_500, 4_000]) {
      window.setTimeout(() => { pinIfShort() }, delay)
    }
  }, [setScrollTopProgrammatically])

  /**
   * 手指按下/抬起：这段时间里**绝不抢滚动**。
   *
   * 用原生监听（passive）而不是 JSX 属性：那个容器上已经有缩放/长按的手势处理器，
   * 再挂 React 的 onTouchStart 会互相吃掉，而且在滚动容器上挂非 passive 监听会拖慢滚动。
   */
  useEffect(() => {
    // 挂在 window 上而不是 scrollRef.current 上：聊天页是「先加载态、后渲染列表」，
    // 挂载那一刻容器可能还不存在，挂到容器上就永远挂不上 —— 手势于是全被当成
    // 程序化回声，跟随锁存关不掉（真机：往上翻之后画面又被拽回底部）。
    const inChat = (target: EventTarget | null): boolean =>
      target instanceof Element && target.closest('.chat-scroll') !== null
    const start = (event: Event): void => {
      if (!inChat(event.target)) return
      lastTouchAtRef.current = Date.now()
      scrollEvent({ type: 'touch-start', at: Date.now() })
    }
    const end = (event: Event): void => {
      if (!inChat(event.target)) return
      lastTouchAtRef.current = Date.now()
      scrollEvent({ type: 'touch-end', at: Date.now() })
    }
    // 滚轮也算读者意图：桌面/宽屏用鼠标滚一圈，同样不该被当成程序化回声。
    const wheel = (event: Event): void => {
      if (!inChat(event.target)) return
      lastTouchAtRef.current = Date.now()
    }
    window.addEventListener('touchstart', start, { passive: true })
    window.addEventListener('touchend', end, { passive: true })
    window.addEventListener('touchcancel', end, { passive: true })
    window.addEventListener('wheel', wheel, { passive: true })
    return () => {
      window.removeEventListener('touchstart', start)
      window.removeEventListener('touchend', end)
      window.removeEventListener('touchcancel', end)
      window.removeEventListener('wheel', wheel)
    }
  }, [scrollEvent])

  /**
   * 视口自己变了也要跟随：输入框那一带的高度不是恒定的（模型名换行、上下文百分比、
   * 排队条/状态条出现又消失、键盘弹出），`chat-scroll` 的 clientHeight 一变，
   * scrollTop 不动就凭空多出几十像素的 gap —— 真机实测 34px、而且**没有任何消息变化**，
   * 所以只靠 messages 变化触发的跟随永远补不上（诊断：写入时 client=682，之后变成 648）。
   */
  useEffect(() => {
    const el = scrollRef.current
    if (el === undefined) return
    if (typeof ResizeObserver === 'undefined') return
    const pin = (): void => {
      // 只有「读者本来就贴底」时才补钉；往上翻历史的人不许被拽回来。
      if (!mayAutoPin(scrollStateRef.current, Date.now())) return
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight
      if (gap <= 2) return
      setScrollTopProgrammatically(el, el.scrollHeight)
      lastScrollHeightRef.current = el.scrollHeight
    }
    const observer = new ResizeObserver(pin)
    // 容器（视口高度）和**内容**（消息列表）都要盯：以前只盯容器，于是
    // 「消息没变、内容长高」（卡片展开、图片、字体换行）时收不到通知，gap 一路累积
    // 到几百像素（真机 243px，最后一行被切一半）。
    observer.observe(el)
    const content = el.firstElementChild
    if (content !== null) observer.observe(content)
    return () => { observer.disconnect() }
  }, [setScrollTopProgrammatically])

  // Track the last message's fold key so scrolling only fires when the
  // newest message actually changes (seq bump and/or pending flip). Runs
  // after React has committed the render, so scrollHeight reflects the
  // freshly appended content.
  const lastMessageKeyRef = useRef<string | undefined>(undefined)
  /**
   * 上一次跟随后的内容高度。
   *
   * 最后一行的身份没变、内容高度却变了，是最常见的一种「进会话不落到底、反而往上滑
   * 一小段」：缓存页（矮）先上屏并被钉到底，网络页到了把同一批行换成更高的版本
   * （卡片补进来、markdown 展开、图片撑开），scrollTop 不动，内容在视口上方长高，
   * 画面就往上滑了。所以身份相同也要比一次高度。
   */
  const lastScrollHeightRef = useRef(0)
  /** Whether the reader scrolled away from the bottom (jump-to-latest button). */
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  /** New turns that arrived while the reader was away (badge count). One
   * agent reply — however many messages and tool calls it spans — counts as
   * one, so the badge grows at reply pace, not message pace. */
  const [unreadCount, setUnreadCount] = useState(0)
  /** Highest turn the reader has seen; the unread tally counts above it. */
  const lastSeenTurnRef = useRef(0)

  /**
   * 回合在跑时每 5 秒重投一次状态。
   *
   * 两个作用：① 租约续期（否则 30 秒没输入就「过期」，状态条会在跑动中消失）；
   * ② 让「卡住了」的判据有机会被重新算 —— 没有新帧的时候，没人触发重算，
   * 那句提示就永远不出现。
   */
  useEffect(() => {
    if (!running) return
    const tick = window.setInterval(() => {
      const rows = messagesRef.current
      let lastActivityAt: number | undefined
      for (let index = Math.max(0, rows.length - 8); index < rows.length; index += 1) {
        const time = rows[index]?.time
        if (typeof time === 'number' && (lastActivityAt === undefined || time > lastActivityAt)) lastActivityAt = time
      }
      const at = Date.now()
      shadowEvent({
        type: 'turn',
        at,
        source: 'frame',
        running: true,
        ...(runningTurnRef.current === undefined ? {} : { turnNo: runningTurnRef.current }),
        ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
      })
      // 任务/后台任务/目标也一起续租：它们在跑动期间不会变，但租约会过期 ——
      // 不续的话「有任务」那一版状态条会在 12 秒后自己消失，看起来像丢了。
      const current = shadowStatusRef.current
      if (current.plan !== undefined) {
        shadowEvent({ type: 'plan', at, source: 'snapshot', todo: current.plan.value })
      }
      if (current.jobs !== undefined) {
        shadowEvent({
          type: 'jobs',
          at,
          source: 'snapshot',
          jobs: current.jobs.value,
          subagents: current.subagents?.value ?? [],
        })
      }
      if (current.goal !== undefined) {
        shadowEvent({ type: 'goal', at, source: 'snapshot', goal: current.goal.value })
      }
    }, 5_000)
    return () => { window.clearInterval(tick) }
  }, [running, shadowEvent])

  /**
   * 阶段 0 的影子对照。
   *
   * 每根条的输入一变就投一次事件，然后比较「影子机说该显示什么」与
   * 「现有 UI 实际显示什么」。差异只记录、不改变任何行为。
   */
  useEffect(() => {
    const now = Date.now()
    // 步序取这一轮里出现过的最大 step（过程条头只显示用时，不显示步序）。
    // 轮号不一定拿得到（有的宿主只给行的状态），此时用「最靠后那一行所在的轮」兜底 ——
    // 正在跑的那一轮永远在列表末尾。
    let activeTurn = runningTurn
    if (activeTurn === undefined && running) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const turn = messages[index]?.turn
        if (turn !== undefined) { activeTurn = turn; break }
      }
    }
    let turnStep: number | undefined
    // 从**未合并**的行里数：合并后的一条过程卡只留第一步的 step（合并的意义就是
    // 把多步并成一条），拿它数步序永远得到 1。folder 快照是原始行。
    const rawRows = folderRef.current?.snapshot() ?? messages
    if (activeTurn !== undefined) {
      for (const row of rawRows) {
        if (row.turn !== activeTurn || row.step === undefined) continue
        if (turnStep === undefined || row.step > turnStep) turnStep = row.step
      }
    }
    // 最后一次「有输出」的时刻：新近 8 行的最大 time。用来判断这一轮是不是卡住了。
    let lastActivityAt: number | undefined
    for (let index = Math.max(0, messages.length - 8); index < messages.length; index += 1) {
      const time = messages[index]?.time
      if (typeof time === 'number' && (lastActivityAt === undefined || time > lastActivityAt)) lastActivityAt = time
    }
    shadowEvent({
      type: 'turn',
      at: now,
      source: 'frame',
      running,
      ...(runningTurn === undefined ? {} : { turnNo: runningTurn }),
      ...(turnStep === undefined ? {} : { step: turnStep }),
      ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
    })
    shadowEvent({ type: 'queue', at: now, source: 'snapshot', items: queueItems })
    shadowEvent({ type: 'goal', at: now, source: 'snapshot', goal, busy: goalBusy })
    shadowEvent({ type: 'plan', at: now, source: 'snapshot', todo })
    shadowEvent({ type: 'jobs', at: now, source: 'snapshot', jobs, subagents })
    shadowStatusRef.current = sweepExpired(shadowStatusRef.current, now)
    const shadowText = barsSignature(describeBars(shadowStatusRef.current, now))
    const view = describeBars(shadowStatusRef.current, now)
    // 真值推进（判据唯一来源）：只在签名变化时 setState，避免每拍重渲染。
    const viewSignature = barsSignature(view)
    if (viewSignature !== barsSignatureRef.current) {
      barsSignatureRef.current = viewSignature
      setBars(view)
    }
  }, [running, runningTurn, messages, queueItems, goal, goalBusy, todo, jobs, subagents, shadowEvent])

  /** Jump back to the newest message and re-arm the auto-follower. */
  const jumpToLatest = useCallback(() => {
    // 明确意图：读者要跟最新，锁存直接打开（否则「回到最新」之后新消息又不跟了）。
    scrollEvent({ type: 'stick-on', at: Date.now() })
    scrollEvent({ type: 'pin' })
    setShowJumpToLatest(false)
    markSeen()
    scrollToBottom()
  }, [markSeen, scrollToBottom, scrollEvent])

  /** Locate one message row for a jump, reusing the search-hit locate machinery
   *  (focusMsgId + focusTargetRef + the layout-effect scroll): sets the same
   *  guards so the auto-follower and windowing stand down while it renders.
   *  {@link turnRowIndex} decides the row — a turn jump passes its turn number
   *  because the outline's boundary seq lands in the gap between rows. */
  const locateSeq = useCallback((seq: number, turn?: number, partId?: string, occurrence?: number, messageId?: string, snippet?: string): void => {
    const list = messagesRef.current
    // DOM 优先：翻页刚把这一行写进 DOM、React 列表还差一拍时，只按状态判断会误判成
    // 「没有这一行」，于是退到「seq 覆盖到的那一行」——真机就是把深历史命中甩到列表
    // 第一行（scrollTop=8、焦点行没有高亮）。状态里有而 DOM 里没有时照旧按状态走，
    // 两边都认不到才不落地，交给翻页继续取。
    const exactIndex = messageId === undefined || messageId === '' ? -1 : list.findIndex(item => item.id === messageId)
    if (messageId !== undefined && messageId !== '' && exactIndex < 0 && typeof document !== 'undefined') {
      const present = document.querySelector<HTMLElement>(`[data-message-id="${messageId.replace(/"/gu, '\\"')}"]`) !== null
      if (!present) return
    }
    const found = turn === undefined || turn < 0 ? rowIndexOfHit(list, seq, messageId, snippet) : turnRowIndex(list, turn, seq)
    if (found < 0 && exactIndex < 0) return
    // 轮次跳转落到"这一轮的提问"那一行：turnRowIndex 认的是带 turn 的 assistant
    // 行，问题在它上面一格 —— 只滚到回答行，等于把提问切在视口外（真机「定位不
    // 太准」）。行级定位（搜索命中）不动。
    // turn 为 -1 是「只按 seq 认行」的搜索定位：它已经认准了那一行，不能再往上挪
    // 到提问行——那正是「搜到了却停在上一段空白」的来源。
    const index = turn === undefined || turn < 0 ? found : turnPromptRowIndex(list, found)
    const row = index >= 0 ? list[index] : undefined
    // 行只在 DOM 里（状态还差一拍）：按命中自带的 messageId 聚焦，不要去猜别的行。
    const focusId = row?.id ?? messageId
    if (focusId === undefined) return
    setFocusMsgId(focusId)
    // 命中可能落在这一行的某个片段上（一行里多处命中时 focusMsgId 相同）：
    // 记下片段，滚动时优先滚到它，并靠 locateTick 让定位 effect 重新跑一遍。
    focusPartIdRef.current = partId
    // 同一段里同一个词可能出现好几次：occurrence 是"这一条命中是该段里的第几处"，
    // 滚动时按它取第 n 个 <mark>，否则永远停在第一个 mark 上（真机"一动不动/停错处"）。
    focusOccurrenceRef.current = occurrence ?? 0
    focusTargetRef.current = seq
    focusRowFirstRef.current = turn !== undefined
    focusScrolledRef.current = false
    setLocateTick(previous => previous + 1)
    locatingRef.current = true
    // 定位锁交给状态机：自带 2 秒上限，到点自解（不会永久挡住跟随）。
    scrollEvent({ type: 'locate-start', at: Date.now(), holdMs: 2_000 })
    // 轮次号取带 turn 的那一行（回答行）的：退到提问行之后它自己已经没有 turn 了，
    // 用提问行会让滑条上的"当前读数"停在上一轮。
    const rowTurn = list[found]?.turn
    if (rowTurn !== undefined) setCurrentTurn(rowTurn)
    // 复核一次：这一发定位可能被排队中的翻页/提交时序盖掉（实测有一处命中被甩到
    // 列表最顶端 scrollTop=20，可视区里一个高亮都没有）。命中行确实在 DOM 里、但
    // 里面没有标记进视口，就直接把第一个标记滚到视口中央 —— 只做补救，不重排逻辑。
    const verifyToken = (locateVerifyTokenRef.current += 1)
    if (typeof document !== 'undefined' && typeof window !== 'undefined') {
      const wantedId = messageId ?? focusId
      // 三次复核：翻页、提交、滚动补偿都可能晚一拍，一次复核不够（实测仍有一处命中
      // 被甩到列表顶端、可视区里没有高亮）。
      window.setTimeout(() => {
        if (locateVerifyTokenRef.current !== verifyToken) return
        const node = document.querySelector<HTMLElement>(`[data-message-id="${wantedId.replace(/"/gu, '\\"')}"]`)
        if (node === null) return
        // 行已经载进来、但滚动没跟过去（实测目标行 top=-5193，视口还停在列表尾部）。
        // 这一行此刻没有 <mark>——高亮只在焦点行里渲染——所以只能按行滚，别找标记。
        const rowBox = node.getBoundingClientRect()
        if (rowBox.bottom < 0 || rowBox.top > window.innerHeight) {
          if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' })
          return
        }
        const marks = Array.from(node.querySelectorAll<HTMLElement>('.chat-search-mark'))
        const target = marks[occurrence ?? 0] ?? marks[0]
        if (target === undefined) return
        const box = target.getBoundingClientRect()
        if (box.bottom > 0 && box.top < window.innerHeight && box.height > 0) return
        if (typeof target.scrollIntoView !== 'function') return
        target.scrollIntoView({ block: 'center' })
      }, 320)
    }
  }, [])

  // ---- 会话内搜索（期 3）----
  // 走宿主的 mobile.search(sessionId)：索引里一个会话的命中是一次查询，
  // 不再把这个会话的历史翻到底。命中按 seq 升序，上一处/下一处就是数组下标。
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearchTerm, setChatSearchTerm] = useState('')
  const [chatSearchHits, setChatSearchHits] = useState<Array<{ seq: number; snippet: string; messageId?: string; partId?: string }>>([])
  const [chatSearchAt, setChatSearchAt] = useState(0)
  /**
   * 停止要不要二次确认。
   *
   * 运行中主键是「排队」、紧挨着一个小方块「停止」——两个都点过一次的人知道有多容易
   * 打错。破坏性动作改成两拍：第一拍把按钮变成「确认停止」，2.5 秒不动自动收回。
   */
  const [stopArmed, setStopArmed] = useState(false)
  const [chatSearchBusy, setChatSearchBusy] = useState(false)
  /** 命中在已加载窗口之外、正在翻那一页（1~3 秒）：计数旁要说一声，别让人以为没反应。 */
  const [chatSearchJumping, setChatSearchJumping] = useState(false)
  /** 宿主那边命中超过一次给的上限（200 处）：计数显示成「3/200+」，别假装只有 200 处。 */
  const [chatSearchHasMore, setChatSearchHasMore] = useState(false)
  /** 索引还在后台建（宿主回 fallback）：如实提示，别假装搜过。 */
  const [chatSearchWarming, setChatSearchWarming] = useState(false)
  const chatSearchAbortRef = useRef<AbortController | undefined>(undefined)
  /** 上一次「上一个/下一个」真正落在哪一行、第几处：连着落在同一处时说明画面不会动。 */
  const lastChatLandingRef = useRef<{ rowId: string; occurrence: number } | undefined>(undefined)
  /** 定位复核代次：每次 locateSeq 递增，过期的补救回调直接作废。 */
  const locateVerifyTokenRef = useRef(0)
  /** 已经为哪条命中强制翻过页（同一条不重复翻，避免来回打转）。 */
  const forcedPageKeysRef = useRef<Set<string>>(new Set())
  /** 翻页收敛监控：连续几次翻页没带来新行（宿主游标卡住），用来及时认输。 */
  const pendingTurnStallsRef = useRef(0)
  const pendingTurnRowCountRef = useRef(-1)
  const chatSearchComposingRef = useRef(false)
  const [chatSearchComposeTick, setChatSearchComposeTick] = useState(0)
  /** 搜索词的实时镜像：跳转/收尾要在回调里判断"这一行正文里真有这个词"，
   *  读 state 会拿到调用那一刻的闭包值（词换了还在用旧词）。 */
  const chatSearchTermRef = useRef('')
  chatSearchTermRef.current = chatSearchTerm.trim()

  /** 会话内搜索的当前词：跳过去的那一行按它做词级高亮，并把被折叠的长段展开。 */
  const chatHitQuery = chatSearchOpen ? chatSearchTerm.trim() : ''

  /** 行里真正能搜的文本：assistant 工具步骤行的正文在 flow 里，text 是空的——
     只拿 text 比对会把这类命中判成"原文没渲染"，白白翻页。 */
  const rowSearchRows = useCallback((list: readonly RenderMessage[]) => list.map(row => {
    const flowText = (row.flow ?? []).filter(part => part.kind === 'text').map(part => (part.kind === 'text' ? part.text : '')).join('\n')
    return {
      seq: row.seq,
      startSeq: row.startSeq,
      id: row.id,
      stepSeqs: row.stepSeqs,
      text: row.searchText !== undefined && row.searchText !== '' ? row.searchText : (flowText === '' ? row.text : `${row.text}\n${flowText}`),
    }
  }), [])
  /** 这一行的正文里是否真的有搜索词。
   *
   *  合并行（一轮多步打包成一张卡）的行 id 是卡自己的 id，不等于索引里那条消息的
   *  messageId；判断"命中在不在窗口里"只能退到「seq 落在这一行的区间里 + 这一行的
   *  正文真的有这个词」。只按 seq 认行是不够的：游标偏一点就会落到相邻那张不含词
   *  的卡上，用户看到的就是"跳过去了却没有高亮"。
   */
  const rowHasTerm = useCallback((row: RenderMessage, term: string): boolean => {
    if (term === '') return true
    if (row.text.includes(term)) return true
    if ((row.searchText ?? '').includes(term)) return true
    return (row.flow ?? []).some(part => part.kind === 'text' && part.text.includes(term))
  }, [])
  /** 这一行会不会把 `seq` 这一步的**正文**渲染出来。
   *
   *  合并行的 `seq` 是这一轮的水位（回合尾巴、页尾校准、preferRicherRows 都会把它抬高），
   *  比它自己最后一个渲染步还大；只按 `startSeq..seq` 判区间就会认下一条根本不在这一行
   *  里的命中。真机：命中 seq=1057（turn 11 的答案）被认成 turn 9 那张 `seq` 水位=1057
   *  的卡，卡里只有 766 的正文 —— 两条命中双双落在同一个高亮上，计数在走、画面不动。
   *  所以优先按 `flow` 里**正文段自己的 seq** 认：它才是真正渲染出来的那一步。 */
  const rowCoversSeq = useCallback((row: RenderMessage, seq: number): boolean => {
    const textSeqs: number[] = []
    for (const part of row.flow ?? []) {
      if (part.kind === 'text' && typeof part.seq === 'number') textSeqs.push(part.seq)
    }
    if (textSeqs.length > 0) return textSeqs.includes(seq)
    const steps = row.stepSeqs ?? []
    if (steps.length > 0) return steps.includes(seq)
    return (row.startSeq ?? row.seq) <= seq && seq <= row.seq
  }, [])
  /** 这一行在屏幕上会不会画出任何正文（答案体或过程体）。
   *
   *  索引是按宿主折叠出的行建的，手机上这一格可能只剩工具调用和推理：这时候无论
   *  怎么定位都不会有高亮（真机 失败 4/28：焦点行 `6d15fd97` 一个标记都没有）。
   *  这种行不能当落点用。 */
  const rowRendersAnyText = useCallback((row: RenderMessage): boolean => {
    if (row.text.trim() !== '') return true
    return (row.flow ?? []).some(part => part.kind === 'text' && part.text.trim() !== '')
  }, [])
  /** 命中在屏幕列表里的下标：先在宿主原始页里认行，再按 id 映射回列表。 */
  const richestRowOfSeq = useCallback((list: readonly RenderMessage[], seq: number): number => {
    let best = -1
    let bestLength = -1
    for (let index = 0; index < list.length; index += 1) {
      const row = list[index]
      if (row === undefined) continue
      if (row.seq !== seq && !(row.stepSeqs ?? []).includes(seq)) continue
      const flowText = (row.flow ?? []).filter(part => part.kind === 'text').map(part => (part.kind === 'text' ? part.text : '')).join('\n')
      const length = (row.searchText ?? '').length + flowText.length + row.text.length
      if (length > bestLength) {
        bestLength = length
        best = index
      }
    }
    return best
  }, [])
  const rowIndexOfHit = useCallback((list: readonly RenderMessage[], seq: number, messageId?: string, snippet?: string): number => {
    // 索引直接给出了这一条命中属于哪一行（messageId）：屏幕上已经有这一行就按它落，
    // 不要再用片段去猜——索引与屏幕的行边界不一致时，猜会把落点挪到相邻的短行上。
    if (messageId !== undefined && messageId !== '') {
      const byId = list.findIndex(row => row.id === messageId)
      if (byId >= 0) return byId
    }
    // 索引里的「一行」和屏幕上的一行不是同一个边界：索引按整个会话合并，屏幕按窗口
    // 切开，同一个 seq 可能落在相邻的两行里。片段相似度会被 markdown 剥掉的符号拉低，
    // 于是退一步用「短锚点」直接找：8 个连续字几乎不可能被剥没。
    const probe = (snippet ?? '').replace(/^…+/u, '').replace(/…+$/u, '').replace(/\s+/gu, ' ').trim()
    if (probe.length >= 8) {
      const anchors = [probe.slice(0, 8), probe.slice(Math.floor((probe.length - 8) / 2), Math.floor((probe.length - 8) / 2) + 8), probe.slice(-8)]
      for (const anchor of anchors) {
        const at = list.findIndex(row => {
          const flowText = (row.flow ?? []).filter(part => part.kind === 'text').map(part => (part.kind === 'text' ? part.text : '')).join('\n')
          return `${row.searchText ?? ''}\n${row.text}\n${flowText}`.replace(/\s+/gu, ' ').includes(anchor)
        })
        if (at >= 0) return at
      }
    }
    const page = rawPageRef.current
    if (page.length > 0) {
      const pageIndex = seqRowIndex(rowSearchRows(page), seq, messageId, snippet)
      const row = pageIndex >= 0 ? page[pageIndex] : undefined
      if (row !== undefined) {
        const inList = list.findIndex(item => item.id === row.id)
        if (inList >= 0) return inList
      }
    }
    // 先让屏幕列表自己也按片段认一次：命中所在的长行不一定带着命中的 seq（合并行
    // 记的是它最后一步的 seq），光按 seq 找会落到前面那行短的上面。
    const inListByText = seqRowIndex(rowSearchRows(list), seq, messageId, snippet)
    if (inListByText >= 0) return inListByText
    // 退一步：同一个 seq 在屏幕上可能对应好几行（合并行 + 拆出来的短行），取正文最长
    // 的那一行——短的那行只有几十个字，跳过去等于跳到空白处。
    const richest = richestRowOfSeq(list, seq)
    if (richest >= 0) return richest
    return -1
  }, [rowSearchRows, richestRowOfSeq])
  /** 跳到第 n 个命中：在已加载窗口里直接定位，否则先把那一页翻进来。 */
  const gotoChatHit = useCallback((hits: readonly { seq: number; partId?: string; messageId?: string; snippet?: string; paragraph?: string; matchIndex?: number }[], at: number): void => {
    const list = messagesRef.current
    // 这一条命中是"同一行里的第几处"：一轮被打包成一张卡片时，卡里好几条消息
    // 都可能命中同一个词（seq 各不相同）。只按 seq 分组会把这些全算成第 0 处，
    // 于是每次切换都滚到卡里第一个 <mark>——真机就是"点了下一个，画面不动"。
    const landingOf = (candidate: { seq: number; messageId?: string; snippet?: string }, candidateAt: number): { index: number; rowId: string; occurrence: number } | undefined => {
      // 命中有精确身份（索引给了 messageId）时，屏幕上必须真有这一行。rowIndexOfHit
      // 认不到时会退到「seq 覆盖到的那一行」，对深历史里的命中来说就是最近的一行 ——
      // 连着好几条命中全落到同一格、计数器在走画面不动，就是这么来的。这种"猜"出来的
      // 落点不算数：交给翻页分支去把这条命中自己那一页载进来。
      const hasId = candidate.messageId !== undefined && candidate.messageId !== ''
      if (hasId && !list.some(row => row.id === candidate.messageId)) {
        // 合并行（一轮多步打成一张卡）的行 id 不是索引里那条消息的 id：这时上面那条
        // 「精确 id 必须存在」永远不成立，于是每按一次「下一个」都当成"不在窗口"，
        // 反复去取同一个 beforeSeq=seq+1 的页，行数和计数一起冻住（真机 编译 停在
        // 3/11、rows 停在 62）。退一步的判据必须同时满足两件事：这行盖住命中的
        // seq，且这行正文里真的有这个词 —— 只按 seq 认会落到相邻那张不含词的卡上。
        const term = chatSearchTermRef.current
        const byCover = list.some(row => rowCoversSeq(row, candidate.seq) && rowHasTerm(row, term))
        console.debug(`[land] seq=${candidate.seq} id=${(candidate.messageId ?? '').slice(0, 8)} byCover=${byCover}`)
        if (!byCover) return undefined
      }
      const index = rowIndexOfHit(list, candidate.seq, candidate.messageId, candidate.snippet)
      if (index < 0) return undefined
      const rowId = list[index]?.id ?? ''
      let occurrence = 0
      for (let i = 0; i < candidateAt; i += 1) {
        const other = hits[i]
        if (other === undefined) continue
        const otherIndex = rowIndexOfHit(list, other.seq, other.messageId, other.snippet)
        if (otherIndex >= 0 && list[otherIndex]?.id === rowId) occurrence += 1
      }
      return { index, rowId, occurrence }
    }
    // 连着按「下一个」却落在同一行的同一处：计数器在走、画面不动（真机连按三次停在
    // 同一个点）。这说明这条命中的消息在屏幕上没有自己的节点（合并行 / 窗口边界），
    // 在窗口里怎么滚都是那一格 —— 把它自己那一页翻进来，让待收尾 effect 按 seq 收口。
    const previous = lastChatLandingRef.current
    const hit = hits[at]
    if (hit === undefined) return
    const landed = landingOf(hit, at)
    console.debug(`[goto] at=${at} seq=${hit.seq} landed=${landed === undefined ? 'no' : landed.rowId.slice(0, 8) + '#' + landed.occurrence}`)
    const hitKey = `${hit.messageId ?? `seq:${hit.seq}`}#${hit.partId ?? ''}`
    const repeated = landed !== undefined && previous !== undefined &&
      landed.rowId === previous.rowId && landed.occurrence === previous.occurrence &&
      !forcedPageKeysRef.current.has(hitKey)
    lastChatLandingRef.current = landed === undefined ? undefined : { rowId: landed.rowId, occurrence: landed.occurrence }
    // 认下的这一行必须**已经画在屏幕上**：列表状态和 DOM 差一拍时（刚翻完一页、
    // 窗口正在换），locateSeq 拿到一个还没渲染的行 id 会设焦点却找不到元素，于是
    // 「1/11」亮了、屏上一条高亮都没有（真机：开场自动定位落在 44 行那版窗口上）。
    // 这时走下面那条翻页/软定位分支，等这一行真的铺出来再收口。
    const landedVisible = landed === undefined || typeof document === 'undefined'
      || document.querySelector<HTMLElement>(`[data-message-id="${escapeAttr(landed.rowId)}"]`) !== null
    // 行在列表里、DOM 还差一拍（刚翻完一页或列表正换）：照样先按索引落位，再在下一帧
    // 补一次定位。**不要**为了这一拍退回翻页分支 —— 那是白白多读一页历史，用户看到
    // 的就是「点一下要等半秒」。
    if (landed !== undefined && !repeated) {
      // 这一行在屏幕上根本没有正文（宿主把这条消息的正文投在别处，或这一格只剩工具
      // 和推理）：索引能搜到它，屏幕上却没有任何可以高亮的文字。别在这里空转、也别
      // 翻页等一份永远不来的正文 —— 就近亮一处含词的行，让用户看得见、点得动。
      const landedRow = list.find(row => row.id === landed.rowId)
      const term = chatSearchTerm.trim()
      if (landedRow !== undefined && term !== '' && !rowHasTerm(landedRow, term) && !rowRendersAnyText(landedRow)) {
        const soft = list.findIndex(row => rowHasTerm(row, term))
        if (soft >= 0) {
          const row = list[soft]
          if (row !== undefined) {
            setChatSearchAt(at)
            scrollEvent({ type: 'suppress', until: Date.now() + 1_500 })
            locateSeq(row.seq, undefined, undefined, 0, row.id, term)
            return
          }
        }
      }
      // 方案 A：优先用索引给的「这一段里第几处」。在 DOM 里数第 N 个标记，在折叠
      // 卡片上数不准（一张卡只渲染一个标记），索引的 matchIndex 才是和段落绑定的数。
      // 但一张卡里落进好几条索引文档时，matchIndex 全是"各自文档里的第 0 处"：
      // 这时只有行内的第 N 处（landed.occurrence）能把它们分开 —— 否则两条命中
      // 取到同一个 <mark>，滚到同一格，计数在走、画面不动（真机 编译 3/11→4/11）。
      const occurrence = landed.occurrence > 0
        ? landed.occurrence
        : typeof hit.matchIndex === 'number' ? hit.matchIndex : landed.occurrence
      // 真落地了才动计数器：落点没变时数字先走，就是「数字在变、画面不动」。
      setChatSearchAt(at)
    scrollEvent({ type: 'suppress', until: Date.now() + 1_500 })
      // 定位用**刚落成的这一行**的 id，不要再用索引给的 messageId：合并卡的行 id
      // 不是索引里那条消息的 id，locateSeq 会因为"列表里没有这个 id"直接返回，于是
      // 计数器前进、视口一动不动（真机 编译 4/11 那一格）。
      locateSeq(hit.seq, undefined, hit.partId, occurrence, landed.rowId, hit.snippet)
      if (!landedVisible) {
        // 这一行还没铺进 DOM：等 React 提交完再定位一次（locateTick 会驱动定位 effect）。
        setTimeout(() => setLocateTick(previous => previous + 1), 120)
      }
      return
    }
    if (repeated) forcedPageKeysRef.current.add(hitKey)
    // 命中在更早的历史里：借轮次跳转那套"翻页 + pending 收尾"，turn 用 -1
    // 表示只按 seq 区间认行。目标行还没载入，同卡多命中分不开，先记 0：
    // 落地后用户再点一次就会走上面的窗口内分支按行内序号重定位。
    // 先把「这一屏里确实写着这个词的行」亮出来：精确行可能在更早的历史里，
    // 翻页要好几秒，而这段时间画面不能一动不动（"点了下一个却停在原地"是用户
    // 最先报的那条）。就近找一个含词的行，用户至少能看到高亮；收尾 effect 找到
    // 精确行后会用 focus 覆盖掉这个临时落点。
    const term = chatSearchTerm.trim()
    const withTerm = term === '' ? -1 : list.findIndex(row => {
      const texts = [row.searchText ?? '', row.text]
      for (const part of row.flow ?? []) if (part.kind === 'text') texts.push(part.text)
      return texts.some(text => text.includes(term))
    })
    if (withTerm >= 0) {
      const row = list[withTerm]
      if (row !== undefined) locateSeq(row.seq, undefined, undefined, 0, row.id, term)
    } else {
      const approximate = turnRowIndex(list, -1, hit.seq)
      if (approximate >= 0) {
        const row = list[approximate]
        if (row !== undefined) locateSeq(row.seq, undefined, undefined, 0, row.id)
      }
    }
    toast('正在载入…')
    // 用户自己发起了会话内跳转：把「打开会话时自动定位第一条命中」那条链退休。它不会
    // 知道目标已经换了，会继续往前翻，翻到历史开头还没有目标时退到「第一个含关键词
    // 的旧行」，把刚落对的视口顶回列表顶端（真机日志：先 OK 8373c5a7，随后又被
    // 9d72e259 顶掉）。
    focusAttemptsRef.current = FOCUS_MAX_PAGES
    focusJumpedRef.current = true
    pendingTurnSeqRef.current = hit.seq
    pendingTurnNumberRef.current = -1
    pendingTurnPartIdRef.current = hit.partId
    pendingTurnOccurrenceRef.current = typeof hit.matchIndex === 'number' ? hit.matchIndex : 0
    pendingTurnMessageIdRef.current = hit.messageId
    pendingTurnSnippetRef.current = hit.snippet
    pendingTurnAtRef.current = at
    pendingTurnPagesRef.current = 0
    pendingTurnStallsRef.current = 0
    pendingTurnRowCountRef.current = -1
    // 一次就把「命中所在的那一页」多要些行（默认 25 行折叠后只剩七八行，目标行
    // 常常正好在窗口外，翻一页也到不了）。收尾 effect 里再续翻时同样按这个行数。
    setChatSearchJumping(true)
    // 兜底：读不到就停在原地，别让「载入中」永远挂着（目标行可能根本不在日志里）。
    window.setTimeout(() => { setChatSearchJumping(false) }, 2_500)
    loadOlderRef.current(true, hit.seq + 1, false, JUMP_PAGE_ROWS)
    // 让待收尾 effect 立刻评估一次：它负责「还在翻/翻到了」这两种收尾，也是
    // 一页在飞时唯一能把这次点击接下去的地方（见该 effect 的排队重试）。
    setLocateTick(previous => previous + 1)
  }, [locateSeq])

  // 预取「下一条命中」那一页。
  //
  // 命中在窗口里时跳转是本地活儿（实测 60~90ms）；不在窗口里就得现场读一页历史：
  // 宿主折页、把页首对齐到回合开头、序列化回来，再在手机上折叠插入 —— 真机体感就是
  // "这一下卡住了"（实测一处 1.2s，手机上更久）。落地之后闲着的时候把下一页取回来
  // 放着，用户真按「下一个」时直接命中缓存，只花折叠 + 滚动的钱。
  useEffect(() => {
    if (chatSearchHits.length === 0) return
    const next = chatSearchHits[chatSearchAt + 1]
    if (next === undefined || next.seq < 0) return
    const beforeSeq = next.seq + 1
    if (pageCacheRef.current.has(beforeSeq)) return
    if (messagesRef.current.some(row => rowCoversSeq(row, next.seq))) return
    const timer = setTimeout(() => {
      if (pendingRef.current || pageCacheRef.current.has(beforeSeq)) return
      void loadChatPage(session.sessionId, beforeSeq, undefined, undefined, undefined, JUMP_PAGE_ROWS).then(
        page => { pageCacheRef.current.set(beforeSeq, page) },
        () => undefined,
      )
    }, 500)
    return () => { clearTimeout(timer) }
  }, [chatSearchAt, chatSearchHits, session.sessionId])

  useEffect(() => {
    const term = chatSearchTerm.trim()
    chatSearchAbortRef.current?.abort()
    chatSearchAbortRef.current = undefined
    if (term === '') {
      setChatSearchHits([])
      setChatSearchAt(0)
      setChatSearchBusy(false)
      setChatSearchWarming(false)
      setChatSearchHasMore(false)
      return
    }
    if (chatSearchComposingRef.current) return
    setChatSearchBusy(true)
    const controller = new AbortController()
    chatSearchAbortRef.current = controller
    const timer = setTimeout(() => {
      // Promise.resolve 兜住 mock/旧宿主返回 undefined 的情况：搜索失败不该炸整个会话页。
      // perSession 是宿主侧会话内分支的条数上限（宿主再夹一次），200 处够长会话翻。
      void Promise.resolve(searchSessions({ query: term, sessionId: session.sessionId, perSession: 200 }, controller.signal)).then(
        (result) => {
          if (controller.signal.aborted) return
          setChatSearchBusy(false)
          setChatSearchWarming(result.fallback === true)
          const seenHitKeys = new Set<string>()
          const hits = (result.items ?? [])
            .filter(item => item.seq !== undefined)
            .map(item => ({
              seq: item.seq as number,
              snippet: item.snippet ?? '',
              ...(item.messageId === undefined ? {} : { messageId: item.messageId }),
              ...(item.partId === undefined ? {} : { partId: item.partId }),
              ...(item.paragraph === undefined ? {} : { paragraph: item.paragraph }),
              ...(item.matchIndex === undefined ? {} : { matchIndex: item.matchIndex }),
            }))
            // 同一条消息/同一段在索引里可能出现多次（旧库里的重复行）。不去重的话
            // 计数器从 4/50 走到 5/50、目标还是同一行同一处 —— 用户看到的就是
            // 「数字在变，位置一直不动」。按 消息 + 片段 去重，让每一格都真的换个位置。
            .filter((hit) => {
              const key = `${hit.messageId ?? `seq:${hit.seq}`}#${hit.partId ?? ''}`
              if (seenHitKeys.has(key)) return false
              seenHitKeys.add(key)
              return true
            })
            .sort((a, b) => a.seq - b.seq)
          setChatSearchHits(hits)
          setChatSearchHasMore(result.hasMore === true)
          // 从首页搜索点进来时，定位意图里带着「用户点的是哪一处」。这时不能把下标
          // 归 0 再跳到第一处（等于把用户从点的那处拽走），要按意图对齐到同一个位置，
          // 顺便让计数器显示成「3/28」——否则进来只有高亮、没有计数，也没法接着按
          // 「下一个」。
          const intent = locateIntentFor(session.sessionId)
          const intentTerm = (intent?.query ?? '').trim()
          if (intent !== undefined && intentTerm === term && hits.length > 0) {
            const byId = intent.messageId === undefined ? -1 : hits.findIndex(hit => hit.messageId === intent.messageId)
            const bySeq = byId >= 0 || intent.seq === undefined ? -1 : hits.findIndex(hit => hit.seq >= (intent.seq ?? 0))
            const aligned = byId >= 0 ? byId : bySeq >= 0 ? bySeq : 0
            setChatSearchAt(aligned)
            return
          }
          setChatSearchAt(0)
          if (hits.length > 0) gotoChatHit(hits, 0)
        },
        () => {
          if (!controller.signal.aborted) setChatSearchBusy(false)
    setChatSearchJumping(false)
        },
      )
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [chatSearchTerm, chatSearchComposeTick, session.sessionId, gotoChatHit])
  /** Jump to a turn from the outline sheet or the scrubber: in-window turns
   *  scroll in place; turns outside the loaded window page the target's rows in
   *  first, then the pending effect below finishes the locate.
   *
   *  The page cursor is the NEXT turn's boundary, not this turn's own seq: the
   *  host pages END at the requested beforeSeq, and a turn's seq is its
   *  turn/start boundary — asking for it fetches everything BEFORE the turn and
   *  never the turn itself. The next boundary lands this turn's rows instead. */
  const jumpToTurn = useCallback((entry: TurnEntry): void => {
    setTurnListOpen(false)
    const inWindow = turnRowIndex(messagesRef.current, entry.turn, entry.seq) >= 0
    if (inWindow) {
      locateSeq(entry.seq, entry.turn)
      return
    }
    // hasOlder 只是"宿主上一次说没有更早的"。它很容易被一次失败的翻页写坏：
    // 翻页请求带了个偏掉的游标 → 宿主回空页 + hasMore: false → 这个布尔从此
    // 恒假，轮次清单里点任何一轮都只弹「没有更早的轮次」，连试都不试。
    // 用户明确点了某一轮就实打实翻一次；真到头了由 pending 的页数预算收尾。
    const at = turnEntries.findIndex(candidate => candidate.turn === entry.turn)
    const nextSeq = at >= 0 ? turnEntries[at + 1]?.seq : undefined
    setCurrentTurn(0)
    toast('正在载入…')
    pendingTurnSeqRef.current = entry.seq
    pendingTurnNumberRef.current = entry.turn
    pendingTurnPagesRef.current = 0
      pendingTurnStallsRef.current = 0
      pendingTurnRowCountRef.current = -1
    loadOlderRef.current(true, nextSeq ?? entry.seq + 1)
  }, [locateSeq, turnEntries])

  /**
   * 跳到"只知道轮次号、手上还没有这一轮"的轮次：实打实往回翻，翻到了由 pending
   * 那套收尾（按轮次号认行，不依赖大纲里的 seq）。
   *
   * 为什么需要：滑条轴按宿主的最高轮次画（57 轮就是 57 格），但手机上真正有行的
   * 只有最近十几轮 —— 宿主的大纲也只覆盖最近一段。以前滑到最早那几轮，松手只弹
   * 一句「还没载入，往上滑加载历史」，等于滑不过去（真机：「没法滑动历史轮次条到
   * 前面的轮次」）。既然用户明确指了第几轮，就翻给它，页数预算由 pending 收尾。
   */
  const jumpToTurnNumber = useCallback((turn: number): void => {
    setTurnListOpen(false)
    setCurrentTurn(0)
    toast('正在载入…')
    // seq = -1：这一轮的真实边界 seq 不知道，交给按轮次号匹配；-1 不会命中任何
    // 行的 [startSeq, seq] 区间，避免"以为找到了"而停在错误的行上。
    pendingTurnSeqRef.current = -1
    pendingTurnNumberRef.current = turn
    pendingTurnPagesRef.current = 0
      pendingTurnStallsRef.current = 0
      pendingTurnRowCountRef.current = -1
    loadOlderRef.current(true)
  }, [])

  /** Handle touch-down: expand the scrubber in place, already pointing at the
   *  turn under the finger (the knob sits under the finger from the first
   *  frame). The RELEASE decides what the press meant — a press that never
   *  travelled opens the turn list (B), a drag jumps to the pointed turn. */
  const startScrub = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    // 轴长用宿主的最高轮次，不是已加载的条数：大纲只覆盖最近十几轮时，
    // 按条数算的滑块根本走不到最早那一轮（截图里「第 44 / 57 轮」卡在最左边）。
    if (maxTurn < 2) return
    scrubGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      moved: false,
    }
    setScrubIndex(scrubTurnIndex(event.clientX, TURN_SCRUB_TRACK_INSET_PX, scrubTrackRight(), maxTurn))
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [maxTurn])

  /** Handle drag: the finger's own position picks the turn, so either screen
   *  edge reaches the oldest/newest turn instead of stopping wherever the press
   *  happened to leave room. */
  const moveScrub = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = scrubGestureRef.current
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return
    if (Math.abs(event.clientX - gesture.startX) > TURN_SCRUB_MOVE_PX) gesture.moved = true
    setScrubIndex(scrubTurnIndex(event.clientX, TURN_SCRUB_TRACK_INSET_PX, scrubTrackRight(), maxTurn))
  }, [maxTurn])

  /** Handle release: travel means a scrub, so the release jumps to the pointed
   *  turn. A press that never moved keeps B's behaviour and opens the list,
   *  which also covers a long press — holding never just does nothing. */
  const endScrub = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = scrubGestureRef.current
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return
    scrubGestureRef.current = undefined
    const index = scrubIndex
    setScrubIndex(undefined)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const tap = !gesture.moved
    if (tap) {
      setTurnListOpen(true)
      return
    }
    // 轴上的位置是绝对轮次（index + 1），不是数组下标。大纲里没有这一轮（手机上
    // 只覆盖最近一段）时**不能只是弹一句**：用户既然指到了第几轮，就按轮次号往回
    // 翻到它 —— 否则滑条在最早那几轮上是死的。
    const turn = index === undefined ? undefined : index + 1
    if (turn === undefined) return
    const entry = turnEntries.find(item => item.turn === turn)
    if (entry === undefined) {
      jumpToTurnNumber(turn)
      return
    }
    jumpToTurn(entry)
  }, [jumpToTurn, jumpToTurnNumber, scrubIndex, turnEntries])

  /** The browser stole the pointer (scroll takeover, system gesture): close the
   *  scrubber without jumping. Also fires after our own release, where the
   *  gesture ref is already cleared and this is a no-op. */
  const cancelScrub = useCallback((event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = scrubGestureRef.current
    if (gesture === undefined || gesture.pointerId !== event.pointerId) return
    scrubGestureRef.current = undefined
    setScrubIndex(undefined)
  }, [])

  // Finish a pending out-of-window turn jump: the moment the target turn's row
  // shows up, locate it. Until then keep paging back — a jump across hundreds of
  // turns rarely lands in one page, and a cursor that missed has to be retried
  // with ordinary paging. The budget stops a hopeless jump from grinding through
  // the whole log, and the toast says so rather than leaving 「正在载入…」hanging.
  useEffect(() => {
    const seq = pendingTurnSeqRef.current
    if (seq === undefined) return
    const turn = pendingTurnNumberRef.current
    const wantedMessageId = pendingTurnMessageIdRef.current
    const hasId = wantedMessageId !== undefined && wantedMessageId !== ''
    // 搜索命中带 messageId 时，屏幕上必须真有这一行。rowIndexOfHit 认不到时会退到
    // 「seq 覆盖到的那一行」——命中的 seq 落在合并行/相邻行的区间里，就会定位到一行
    // 没有这个词的地方（实测：焦点跳到 9d72e259，可视区里一个高亮都没有）。
    const idPresent = !hasId || messagesRef.current.some(row => row.id === wantedMessageId)
    const isSearchJump = turn === undefined || turn < 0
    const coveredIndex = !idPresent && isSearchJump
      ? messagesRef.current.findIndex(row => rowCoversSeq(row, seq) && rowHasTerm(row, chatSearchTermRef.current))
      : -1
    const index = coveredIndex >= 0
      ? coveredIndex
      : !idPresent
        ? -1
        : isSearchJump ? rowIndexOfHit(messagesRef.current, seq, wantedMessageId, pendingTurnSnippetRef.current) : turnRowIndex(messagesRef.current, turn, seq)
    console.debug(`[pend] seq=${seq} idPresent=${idPresent} covered=${coveredIndex} index=${index} rows=${messagesRef.current.length}`)
    if (index >= 0) {
      // seq = -1 是"只知道轮次号"的跳转：这一轮自己的锚点就是它的行。
      const found = messagesRef.current[index]
      const wantedPartId = pendingTurnPartIdRef.current
      const wantedOccurrence = pendingTurnOccurrenceRef.current
      pendingTurnSeqRef.current = undefined
      pendingTurnNumberRef.current = undefined
      pendingTurnPartIdRef.current = undefined
      pendingTurnOccurrenceRef.current = 0
      pendingTurnMessageIdRef.current = undefined
      pendingTurnSnippetRef.current = undefined
      pendingTurnPagesRef.current = 0
      pendingTurnStallsRef.current = 0
      pendingTurnRowCountRef.current = -1
      // 落地了：搜索条上的「载入中…」该停了（它只在翻页那 1~3 秒里说话）。
      setChatSearchJumping(false)
      const landedAt = pendingTurnAtRef.current
      pendingTurnAtRef.current = undefined
      // 真找到这一行了，计数器才前进（没落地不动数字）。
      if (landedAt !== undefined) setChatSearchAt(landedAt)
      // 靠「这一行覆盖了 seq 且正文里有这个词」认出来的行，**行 id 是它自己的**：
      // 索引给的 messageId 在窗口里根本不存在（宿主那一页没送到它）。拿索引 id 去
      // 定位，locateSeq 找不到行就直接返回 —— 用户看到的还是上一处临时落点（真机
      // 失败 4/28、5/28 两次都停在 6d15fd97、零高亮）。
      if (coveredIndex >= 0) {
        locateSeq(found?.seq ?? seq, turn, undefined, 0, found?.id, pendingTurnSnippetRef.current)
        return
      }
      locateSeq(seq >= 0 ? seq : (found?.startSeq ?? found?.seq ?? 0), turn, wantedPartId, wantedOccurrence, wantedMessageId, pendingTurnSnippetRef.current)
      return
    }
    // hasOlder 会被一次失败的翻页写坏（见 jumpToTurn），所以第一页无论如何都要试；
    // 只有"试过一页之后宿主仍说没有更早的"才算到头。
    // 翻了几页还精确找不到：退到「seq 所在/最接近的那一行」给个落点，比一句「翻不到」有用；
    // 真正到头（宿主说没有更早的）或预算耗尽才算失败。
    //
    // 搜索命中（带 messageId 的）例外：它有精确身份，退到"最接近的那一行"就是用户报的
    // 「数字在变、位置不动」（好几条命中都落在同一行上）。所以这类命中不提前退，一直
    // 翻到它自己的行出现为止；只有连续两页都翻不出新行（宿主把游标卡住了）才认输。
    const rowCount = messagesRef.current.length
    if (rowCount === pendingTurnRowCountRef.current) pendingTurnStallsRef.current += 1
    else { pendingTurnStallsRef.current = 0; pendingTurnRowCountRef.current = rowCount }
    const exactIdentity = wantedMessageId !== undefined && wantedMessageId !== ''
    // 有精确身份的命中一律翻到底：'两页没新行'对它是误判（locateTick 触发的重算也会被算成没新行），
    // 提前退到近似行正好就是用户报的'跳到没有高亮的地方'。真正的认输交给下面的页预算和空页检查。
    const patience = exactIdentity ? TURN_JUMP_MAX_PAGES : 2
    if (index < 0 && pendingTurnPagesRef.current >= patience && (turn === undefined || turn < 0)) {
      const fallback = turnRowIndex(messagesRef.current, -1, seq)
      if (fallback >= 0) {
        const foundFallback = messagesRef.current[fallback]
        const pidFallback = pendingTurnPartIdRef.current
        const occFallback = pendingTurnOccurrenceRef.current
        const midFallback = pendingTurnMessageIdRef.current
        const snipFallback = pendingTurnSnippetRef.current
        pendingTurnSeqRef.current = undefined
        pendingTurnNumberRef.current = undefined
        pendingTurnPartIdRef.current = undefined
        pendingTurnOccurrenceRef.current = 0
        pendingTurnMessageIdRef.current = undefined
        pendingTurnSnippetRef.current = undefined
        pendingTurnPagesRef.current = 0
        pendingTurnStallsRef.current = 0
        pendingTurnRowCountRef.current = -1
        pendingTurnAtRef.current = undefined
        locateSeq(seq >= 0 ? seq : (foundFallback?.startSeq ?? foundFallback?.seq ?? 0), turn, pidFallback, occFallback, midFallback, snipFallback)
        return
      }
    }
    if (pendingTurnPagesRef.current >= TURN_JUMP_MAX_PAGES || (!hasOlder && pendingTurnPagesRef.current > 0 && pendingTurnStallsRef.current >= 2)) {
      pendingTurnSeqRef.current = undefined
      pendingTurnNumberRef.current = undefined
      pendingTurnPartIdRef.current = undefined
      pendingTurnOccurrenceRef.current = 0
      pendingTurnMessageIdRef.current = undefined
      pendingTurnSnippetRef.current = undefined
      pendingTurnPagesRef.current = 0
      pendingTurnStallsRef.current = 0
      pendingTurnRowCountRef.current = -1
      toast(turn === undefined || turn < 0
        ? '这一处命中的原文没渲染出来（可能在折叠或隐藏内容里），已尽量靠近它'
        : `第 ${turn} 轮不在更早的历史里`)
      return
    }
    // 已有一页在飞时不能丢掉这次点击：loadOlder 会直接 return，没人再唤醒定位，
    // 真机表现就是「点了下一个，画面一动不动」。等它落地再重试，且不消耗页预算。
    if (pendingRef.current) {
      const retry = setTimeout(() => setLocateTick(previous => previous + 1), 200)
      return () => { clearTimeout(retry) }
    }
    pendingTurnPagesRef.current += 1
    // 搜索命中（turn 为 -1 / 未定义 = 只知道 seq）：直接要「到这一处为止」的那一页。
    // 按首页游标一页页往回翻，深历史里只会越翻越远，最后只能弹一句「翻不到」。
    loadOlderRef.current(true, turn === undefined || turn < 0 ? seq + 1 : undefined, false, turn === undefined || turn < 0 ? JUMP_PAGE_ROWS : undefined)
  }, [messages, hasOlder, locateSeq, locateTick])

  // Keep the newest content visible. This covers the initial tail page (the
  // effect runs after commit, fixing the stale scrollHeight from the old
  // open-time scrollToBottom), live streaming chunks on the pending message,
  // and finalized/appended messages. Prepending older pages via loadOlder
  // leaves the last message untouched, so it never disturbs the scroll
  // position. A reader who scrolled away from the bottom is left alone:
  // follow only within {@link BOTTOM_FOLLOW_THRESHOLD_PX} of the bottom.
  // Layout (not passive) so the OPENING tail pins BEFORE the first paint —
  // a passive effect fires after paint, leaving the opening frame painted at
  // the top of history before the jump (observed as a top-of-history flash
  // on open). Steady-state streaming keeps the same code path, and its DOM
  // writes stay in the same phase they always were.
  useLayoutEffect(() => {
    const last = messages[messages.length - 1]
    if (last === undefined) return
    const key = last.seq + ':' + (last.pending === true ? 'p' : 'f')
    if (key === lastMessageKeyRef.current) {
      // 身份没变，但高度可能变了（流式正文变长、缓存页换网络页、卡片补进来）。
      //
      // 曾经用「高度抖动 ≥ HEIGHT_DRIFT_PX 才算变了」来省滚动写入。实测这是错的：
      // 流式输出每次只长几像素，阈值永远够不着，而 lastScrollHeight 每帧都被更新，
      // 于是 gap 一路累积 —— 真机实测离底 423px，最后一行被切掉一半。
      // 现在只看「读者是不是贴着底」（状态机的 stick 锁存，24px 内才算），贴底就补钉。
      const box = scrollRef.current
      if (box !== undefined && autoScroll && mayAutoPin(scrollStateRef.current, Date.now(), true)) {
        const gap = box.scrollHeight - box.scrollTop - box.clientHeight
        if (gap > 2) scrollToBottom()
        lastScrollHeightRef.current = box.scrollHeight
      }
      return
    }
    lastMessageKeyRef.current = key
    // 刚跳到的位置不能被「跟随最新消息」顶掉：真机实测第 4 条命中落地后 scrollTop
    // 被推到 8（列表顶端），焦点行也换成了没有高亮的另一行。
    // 只有「安静期」在这里早退（发送后的挂载动画、刚跳转落地的那一下）。
    // 读者停在历史里不是早退的理由 —— 未读计数还得涨（那条判据在下面）。
    if (Date.now() < scrollStateRef.current.suppressUntil) return
    // Opt-in perf mark: React committed the newest message (span recv→commit
    // is the full client event-to-DOM latency of this frame).
    perfMark('commit', { seq: last.seq, frame: 'session/event', detail: last.kind })
    const el = scrollRef.current
    if (el === undefined) return
    if (!scrollStateRef.current.followed) {
      // First tail of this session: always follow (the chat opens at the
      // newest message, whatever the scroll position left by a previous
      // session). The opening baseline also seeds the unread tally.
      lastSeenTurnRef.current = last.turn ?? 0
      scrollToBottom()
      lastScrollHeightRef.current = el.scrollHeight
      settleBottomAfterCommit()
      return
    }
    // Unread tally: count turns that arrived after the reader's last seen
    // turn while they were away from the bottom. A following reader sees the
    // content immediately and never accumulates a badge; loadOlder prepends
    // leave the last turn untouched, so they never count. Messages within
    // one turn (tool calls, follow-up chunks) share the turn and count once.
    if ((last.turn ?? 0) > lastSeenTurnRef.current) {
      lastSeenTurnRef.current = last.turn ?? 0
      if (scrollStateRef.current.gap > FOLLOW_THRESHOLD_PX) {
        setUnreadCount(count => count + 1)
      }
    }
    // 自动滚动 off (settings): the reader drives the scroll position.
    if (!autoScroll) return
    // 一条判据管四种情况：读者是否贴底、定位锁是否还在、手指是否还在动、发送后安静期。
    // 全在 `scroll-machine.ts` 里，不再各自记住一份快照。
    if (!mayAutoPin(scrollStateRef.current, Date.now(), true)) return
    scrollToBottom()
    lastScrollHeightRef.current = el.scrollHeight
    settleBottomAfterCommit()
  }, [messages, scrollToBottom, autoScroll, settleBottomAfterCommit])

  // Silent prepend re-follow, run at COMMIT time: this fires right after
  // React has committed the prepended auto-extend page (before the next
  // paint), so scrollToBottom reads the real post-prepend scrollHeight.
  // See followAfterPrependRef for why the follow cannot run from loadOlder's
  // own rAF — that can land before the commit and strand the view in
  // history with nothing left to correct it.
  useLayoutEffect(() => {
    // 翻页锚点补偿优先：它必须在本次 commit 之后、下一次绘制之前量高度。
    const pending = prependAnchorRef.current
    if (pending !== undefined) {
      prependAnchorRef.current = undefined
      const box = scrollRef.current
      if (box !== undefined) {
        // 有「具体的那一行」时**只按行校准**：高度差在窗口化渲染下会低估（占位行还没量），
        // 也会因为并发插入而高估到整页高度 —— 高估就等于把读者直接扔到最底部（实测 17793px）。
        // 行位置是屏幕上真实发生的事，不会过冲。
        if (pending.rowId === undefined) {
          const grown = box.scrollHeight - pending.height
          if (grown > 0) {
            // 程序化移动：这次位移不是读者离开底部，不该记书签。
            setScrollTopProgrammatically(box, pending.top + grown)
            lastScrollHeightRef.current = box.scrollHeight
          }
        }
        // 二次校准：按「那条锚点行现在在哪」把差补回去。窗口化渲染让高度差不可靠，
        // 而行位置是屏幕上真实发生的事。跑两拍，覆盖行陆续量出高度的情况。
        if (pending.rowId !== undefined && pending.rowTop !== undefined) {
          const rowId = pending.rowId
          const rowTop = pending.rowTop
          const rowSeq = pending.rowSeq
          const correct = (): void => {
            const scroller = scrollRef.current
            if (scroller === undefined) return
            let row = scroller.querySelector(`[data-message-id="${CSS.escape(rowId)}"]`)
            if (row === null && typeof rowSeq === 'number' && rowSeq > 0) {
              // 那一条被换成了新 id（页面行/实时行两套 id）：找 seq 最接近的等价行。
              let best: Element | null = null
              let bestGap = Number.POSITIVE_INFINITY
              for (const candidate of scroller.querySelectorAll('[data-row-seq]')) {
                const gap = Math.abs(Number(candidate.getAttribute('data-row-seq') ?? '0') - rowSeq)
                if (gap < bestGap) { bestGap = gap; best = candidate }
              }
              row = best
            }
            if (row === null) return
            const delta = Math.round(row.getBoundingClientRect().top) - rowTop
            // 夹住异常值：相差超过两屏说明拿到了错的元素，宁可不补也不要把读者甩走。
            if (Math.abs(delta) <= 2 || Math.abs(delta) > scroller.clientHeight * 2) return
            setScrollTopProgrammatically(scroller, Math.max(0, scroller.scrollTop + delta))
          }
          correct()
          requestAnimationFrame(correct)
          for (const delay of [80, 200, 400, 800]) window.setTimeout(correct, delay)
        }
      }
      // 静默补页那条路走下面的跟随逻辑，手动翻页到这里就结束。
      if (!followAfterPrependRef.current) return
    }
    if (!followAfterPrependRef.current) return
    followAfterPrependRef.current = false
    // 判据用 stick（读者没上滑过），不用「当前 gap ≤ 80」：补页本身会把内容撑高，
    // 等落地后再看 gap 早就超过 80 了，于是永远不跟随、停在半路（真机 423px）。
    if (!scrollStateRef.current.stick && scrollStateRef.current.gap > FOLLOW_THRESHOLD_PX) return
    scrollToBottom()
    const box = scrollRef.current
    if (box !== undefined) lastScrollHeightRef.current = box.scrollHeight
    // 页面是「先铺估算高度、再量真实行高」的：只滚一次会停在离底几百像素的地方
    // （实测 245~437px），而这一刻之后往往不再有新的 commit 来纠正。补钉尾巴必须跟上。
    settleBottomAfterCommit()
  }, [messages, scrollToBottom, settleBottomAfterCommit])

  // The question/approval panels mount below the message list; when one
  // appears, bring it into view — the reader is usually watching the turn and
  // would otherwise never see the panel (it sits past the last message).
  // A reader who scrolled up through history is still left alone.
  useEffect(() => {
    if (pendingQuestions.length === 0 && pendingApprovals.length === 0) return
    if (!autoScroll) return
    const el = scrollRef.current
    if (el === undefined) return
    if (scrollStateRef.current.gap > FOLLOW_THRESHOLD_PX) return
    scrollToBottom()
  }, [pendingQuestions.length, pendingApprovals.length, scrollToBottom, autoScroll])

  // Keyboard: when the visual viewport resizes (soft keyboard opens), keep
  // the composer pinned above the keyboard and the newest message visible.
  useEffect(() => {
    const vv = window.visualViewport
    if (vv == null) return
    const viewport = vv
    const onResize = (): void => {
      if (!autoScroll) return
      if (!mayAutoPin(scrollStateRef.current, Date.now())) return
      scrollToBottom()
    }
    viewport.addEventListener('resize', onResize)
    return () => { viewport.removeEventListener('resize', onResize) }
  }, [autoScroll, scrollToBottom])

  /* ── message context menu (long-press) ─────────────────────────────── */

  /**
   * 审批卡片上「将要执行什么」：宿主帧只给工具名，参数在会话日志里同 callId 的
   * tool/call 上。找不到（老日志/帧被裁掉）就返回 undefined，卡片保持原样。
   */
  const approvalPreviewOf = useCallback((approval: PendingApproval): string | undefined => {
    if (approval.callId === undefined) return undefined
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const tools = messages[i]!.tools
      if (tools === undefined) continue
      const hit = tools.find(tool => tool.callId === approval.callId)
      if (hit !== undefined) return approvalPreviewText(hit.arguments)
    }
    return undefined
  }, [messages])

  /** Auto-dismiss the context menu after 3s without action, or on Esc. */
  useEffect(() => {
    if (ctxMenu === undefined) return
    const timer = window.setTimeout(() => { setCtxMenu(undefined) }, 3000)
    // 接了实体键盘（iPad、外接键盘）时 Esc 是最顺手的取消；背景点击在键盘场景下够不到。
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setCtxMenu(undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  /** Quote a message: the composer shows a quote bar and the send prepends
   * the reference context (first 200 chars are enough for the agent). */
  const quoteIntoComposer = useCallback((text: string): void => {
    setQuoted(text.slice(0, 200))
  }, [])

  /** Resend an edited user message as a fresh prompt. The agent session is
   *  append-only, so the edited text goes out as a new user message (with a
   *  small note that the user revised the earlier question, so the model
   *  re-answers against the corrected intent instead of repeating the old). */
  const sendEditedMessage = useCallback((messageId: string, newText: string): void => {
    setEditMessage(undefined)
    void prompt(session.sessionId, textParts(`用户修改了之前的提问，请忽略旧提问的回复，按修改后的内容重新回答：\n\n${newText}`)).then(
      () => { mux?.poke() },
      () => { toast('重新发送失败，请重试') },
    )
  }, [session.sessionId, mux])

  /** ↻ 的三态：待点 / 已发出（转圈）/ 发出失败（变红可再点）。 */
  const [regenerateState, setRegenerateState] = useState<'idle' | 'busy' | 'failed'>('idle')
  /** 发出到轮次开跑之间这段窗口的防连点闸门。 */
  const regenerateInFlightRef = useRef(false)
  /** 「会新增一条回答」这句只提示一次，不常驻界面。 */
  const regenerateHintShownRef = useRef(false)
  /** 发出去但一轮没起来的兜底复位。 */
  const regenerateWatchdogRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** Regenerate the last assistant reply: ask the agent to re-answer the user
   *  question that immediately preceded it. The session is append-only, so
   *  this goes out as a fresh prompt (the old reply stays in history); the
   *  wording tells the model to set it aside and answer anew. */
  const handleRegenerate = useCallback((message: RenderMessage): void => {
    // 一次只发一条。按钮发出后要等轮次真的开跑才消失，中间这段双击会追加
    // 好几条"请忽略上一条回答"，而这些行删不掉。
    if (regenerateInFlightRef.current) return
    regenerateInFlightRef.current = true
    setRegenerateState('busy')
    if (!regenerateHintShownRef.current) {
      regenerateHintShownRef.current = true
      toast('将新增一条回答，原来的保留')
    }
    const rows = messagesRef.current
    const index = rows.findIndex(row => row.id === message.id)
    let question = ''
    for (let i = index - 1; i >= 0; i--) {
      const row = rows[i]
      if (row !== undefined && row.kind === 'user') {
        question = row.text
        break
      }
    }
    const body = question !== ''
      ? `请忽略上一条回答，针对原始问题重新作答：\n\n${question}`
      : '请忽略上一条回答，重新作答刚才的问题。'
    void prompt(session.sessionId, textParts(body)).then(
      () => {
        mux?.poke()
        // 正常路径由 `running` 翻真把按钮收走并复位；万一一轮没起来，别让它
        // 永远转圈——兜一个底，仍然允许再点。
        if (regenerateWatchdogRef.current !== undefined) clearTimeout(regenerateWatchdogRef.current)
        regenerateWatchdogRef.current = setTimeout(() => {
          regenerateWatchdogRef.current = undefined
          regenerateInFlightRef.current = false
          setRegenerateState('idle')
        }, REGENERATE_WATCHDOG_MS)
      },
      () => {
        regenerateInFlightRef.current = false
        setRegenerateState('failed')
        toast('重新生成失败，请重试')
      },
    )
  }, [session.sessionId, mux])

  /** Re-pull the tail history page: a settled command may rewrite history
   * (/compact shadows older turns), which live frames alone cannot undo.
   * Live events arriving DURING the re-pull are buffered (tailLoadingRef)
   * and re-folded on top of the fresh page — without the guard they would
   * fold into the old folder and get lost when it is replaced. Only the
   * newest reload lands (epoch + abort of the previous one), so two rapid
   * reloads cannot have a slow first resolve overwrite the second's rows. */
  const reloadTail = useCallback((): void => {
    reloadControllerRef.current?.abort()
    const controller = new AbortController()
    reloadControllerRef.current = controller
    const epoch = reloadEpochRef.current + 1
    reloadEpochRef.current = epoch
    tailLoadingRef.current = true
    void loadChatPage(session.sessionId, undefined, controller.signal).then(
      (page) => {
        if (epoch !== reloadEpochRef.current) return
        const buffered = liveBufferRef.current
        liveBufferRef.current = []
        tailLoadingRef.current = false
        const folder = new EventFolder(page.rows, page.maxSeq)
        folderRef.current = folder
        const foldedRows = folder.fold(buffered)
        applyMessages(foldedRows)
        setHasOlder(page.hasMore)
        // The re-pull window overflowed too: refill the dropped range like
        // the initial load does.
        const gap = dropWindowRef.current
        if (gap !== undefined) {
          dropWindowRef.current = undefined
          liveBufferOverflowRef.current = false
          refillGap(gap, controller.signal, () => epoch !== reloadEpochRef.current)
        }
      },
      () => {
        if (epoch !== reloadEpochRef.current) return
        tailLoadingRef.current = false
        // Failure: drain the buffered live events into the old folder, or
        // they linger in the buffer unseen.
        const buffered = liveBufferRef.current
        liveBufferRef.current = []
        if (buffered.length > 0) {
          const folder = folderRef.current
          applyMessages(folder === undefined ? foldEvents(buffered) : folder.fold(buffered))
        }
      },
    )
  }, [session.sessionId, refillGap])

  /**
   * Run one slash-command line through the host registry. A matched line is
   * executed host-side (never reaching the model): its result text becomes a
   * toast and the history tail reloads. An unmatched line falls through to an
   * ordinary prompt, matching the desktop composer's catalog-miss behavior;
   * that fallthrough rejects on send failure so a caller can keep the draft.
   */
  const runCommand = useCallback((line: string): Promise<void> => {
    // 只在真的慢的时候提示「正在执行」：命令大多几十毫秒就回来，立刻弹一个提示再马上
    // 消失，纯粹是闪屏噪音（真机：`/goal` 建完目标，屏幕上先闪一条、再冒一大段回执）。
    // 慢网（隧道）下 1.2 秒还没有回话才提示，那才是需要安慰的时候。
    const pending = window.setTimeout(() => {
      toast(`正在执行 ${line.trim().split(/\s+/)[0]}…`)
    }, 1200)
    return sendCommand(session.sessionId, line).then(
      (outcome) => {
        window.clearTimeout(pending)
        mux?.poke()
        if (outcome.matched) {
          // 成功的回执不再弹窗：会话里那张命令卡就是回执，目标类命令还有目标条。
          // 之前把宿主返的整段文本（Goal created Status… Rounds… Commands…）糊在
          // 屏幕中央，正好盖住它要说清楚的那个目标条。
          //
          // 但失败必须说话：`/goal` 参数错、`/permission` 用法错时宿主返回的就是那段
          // 说明，静默掉等于让人对着没反应的输入框发呆。
          if (outcome.kind === 'error' && outcome.text !== undefined && outcome.text !== '') {
            toast(outcome.text)
          }
          reloadTail()
          return
        }
        return prompt(session.sessionId, textParts(line)).then(() => { mux?.poke() })
      },
      (reason: unknown) => {
        window.clearTimeout(pending)
        setError(errorText(reason))
      },
    )
  }, [session.sessionId, mux, reloadTail])

  /**
   * 目标动作（暂停/恢复/编辑/清除）都走宿主命令注册表：手机端没有桌面那条
   * 
emote.goals.* 通道，而 /goal <verb> 是同一套语义的公开入口。
   * 命令发出去之后立刻带 fresh 重读一次投影 —— 宿主处理是异步的，不重读就会
   * 停在旧相位上（点了暂停还写着「进行中的目标」）。
   */
  /**
   * 把条子上按下的动作落到宿主。
   *
   * 优先走原生 `mobile.goalAction`：它调宿主目标服务，暂停=撤授权、恢复=重新授权，
   * 与桌面端那条 暂停/继续 完全一致（命令行的 `/goal pause` 改的是 durable 相位，
   * 语义不同，所以不能当主路）。宿主没装目标服务（老版本/被裁的宿主）时回退到
   * `/goal …` 命令通道 —— 退化的只是语义精度，动作仍然生效。
   */
  const runGoalAction = useCallback((action: MobileGoalAction, objective?: string): void => {
    setGoalBusy(true)
    const settle = (value: { goal: unknown; activation?: 'armed' | 'disarmed' } | undefined): void => {
      setGoalBusy(false)
      if (!mountedRef.current || value === undefined) return
      setGoal(parseGoalProjection(value.goal, value.activation))
    }
    void goalAction(session.sessionId, action, objective === undefined ? {} : { objective }).then(
      (value) => { settle(value) },
      () => {
        // 老宿主：退回命令通道。
        const line = action === 'pause' ? GOAL_PAUSE_COMMAND
          : action === 'resume' ? GOAL_RESUME_COMMAND
            : action === 'clear' ? GOAL_CLEAR_COMMAND
              : goalEditCommand(objective ?? '')
        void runCommand(line).then(
          () => {
            setGoalBusy(false)
            if (!mountedRef.current) return
            void goalOf(session.sessionId, { fresh: true }).then(
              (value) => { if (mountedRef.current) setGoal(parseGoalProjection(value.goal, value.activation)) },
              () => undefined,
            )
          },
          () => { setGoalBusy(false) },
        )
      },
    )
  }, [runCommand, session.sessionId])

  /** 条子上的 `/goal <verb>` 文本 → 原生动作（老宿主回退时仍用原文）。 */
  const handleGoalCommand = useCallback((line: string): void => {
    const verb = line.trim()
    if (verb === GOAL_PAUSE_COMMAND) { runGoalAction('pause'); return }
    if (verb === GOAL_RESUME_COMMAND) { runGoalAction('resume'); return }
    if (verb === GOAL_CLEAR_COMMAND) { runGoalAction('clear'); return }
    if (verb.startsWith(`${GOAL_EDIT_PREFIX}`)) {
      const objective = verb.slice(GOAL_EDIT_PREFIX.length).trim()
      if (objective !== '') { runGoalAction('edit', objective); return }
    }
    setGoalBusy(true)
    void runCommand(line).then(
      () => {
        setGoalBusy(false)
        if (!mountedRef.current) return
        void goalOf(session.sessionId, { fresh: true }).then(
          (value) => { if (mountedRef.current) setGoal(parseGoalProjection(value.goal, value.activation)) },
          () => undefined,
        )
      },
      () => { setGoalBusy(false) },
    )
  }, [runCommand, runGoalAction, session.sessionId])


  /** Rename through session.rename; the header title updates immediately. */
  const handleRename = useCallback(async (value: string): Promise<void> => {
    setRenaming(false)
    try {
      await renameSession(session.sessionId, value)
      setTitle(value)
      toast('已重命名')
    } catch (reason) {
      toast(errorText(reason))
    }
  }, [session.sessionId])

  /**
   * Delete the session through the host archive RPC (the same semantics the
   * desktop's delete uses): the workspace-side row leaves every roster and
   * never reappears after a refresh, while the session log stays on disk and
   * remains restorable from the desktop. The local cleanup runs either way;
   * an RPC failure keeps the previously-local-only removal (the chat would
   * reappear on reload) and surfaces why.
   */
  const handleDeleteSession = useCallback((): void => {
    setDeleting(false)
    setMessages([])
    void removeOutboxForSession(session.sessionId).then(() => { refreshOutbox() })
    void archiveSession(session.sessionId).catch((reason: unknown) => {
      toast(`删除未生效：${errorText(reason)}`)
    })
    onBack()
  }, [session.sessionId, onBack, refreshOutbox])

  /**
   * Back with blank-session revocation: a session that was created but never
   * received a message (blank, zero rendered rows) is revoked on exit — the
   * desktop keeps no blank sessions either, and a "new chat" the user leaves
   * without writing must not linger in the roster. The host is re-checked
   * (tail 1 message) before archiving so an in-flight send whose echo has
   * not landed yet is never destroyed; a send in progress is skipped
   * outright. The local caches drop the row synchronously so the returning
   * list never flashes it.
   */
  const handleBack = useCallback((): void => {
    if (session.blank && messagesRef.current.length === 0 && !sendingRef.current) {
      dropSessionFromCaches(session.sessionId)
      void history(session.sessionId, undefined, 1).then(
        (page) => {
          const hasContent = page.events.some(entry =>
            entry.event.type === 'user/message' || entry.event.type === 'assistant/message')
          if (!hasContent) void archiveSession(session.sessionId).catch(() => { /* 撤销失败：保留会话 */ })
        },
        () => { /* 确认查询失败：保守不删 */ },
      )
    }
    onBack()
  }, [session, onBack])

  /** Long-press / right-click on a bubble opens the context menu. The copied
   * text comes from the render state (full text, or the full reasoning for
   * thinking-only turns) — not from the DOM, where folded bodies are absent.
   * Returns whether a message bubble was hit (suppresses the native menu). */
  const openCtxFromTarget = (target: EventTarget | null, x: number, y: number): boolean => {
    // 已有文字选区时让位给系统（局部复制优先），不弹自定义菜单。
    if (window.getSelection()?.toString() !== '') return false
    const element = target instanceof Element ? target : null
    // markdown 图片：让位系统菜单（Android/iOS 长按保存图片、桌面右键另存），
    // 自定义菜单只管消息文字（复制/引用）。
    if (element !== null && element.closest('img') !== null) return false
    // 过程行（运行命令/写入/读取…）自带身份：长按它就该操作这一行，而不是整条
    // 回复。否则菜单里只有三个动作，连复制的是哪一行都看不出来。
    const stepRow = element?.closest<HTMLElement>('.chat-step') ?? null
    const step = stepRow === null
      ? undefined
      : {
          title: stepRow.getAttribute('data-step-title') ?? '',
          summary: stepRow.getAttribute('data-step-summary') ?? '',
          state: stepRow.getAttribute('data-step-state') ?? '',
          ...(stepRow.querySelector('pre.chat-tool-args')?.textContent === undefined
            ? {}
            : { command: stepRow.querySelector('pre.chat-tool-args')?.textContent ?? '' }),
        }
    const bubble = element?.closest('.chat-msg') ?? null
    if (bubble === null) return false
    const mid = bubble.getAttribute('data-mid')
    const message = mid === null ? undefined : messagesRef.current.find(candidate => candidate.id === mid)
    if (message === undefined) return true
    // Flow turns put their markdown in the text runs; join them so a long
    // report can be copied verbatim ("复制原文") even though `text` is empty.
    const flowText = message.flow !== undefined && message.flow.length > 0
      ? message.flow.filter(part => part.kind === 'text').map(part => part.text).join('\n').trim()
      : ''
    const text = message.text !== undefined && message.text !== '' ? message.text : message.reasoning ?? ''
    const raw = flowText !== '' ? flowText : undefined
    if (text.trim() !== '' || raw !== undefined) {
      // 锚点用来把菜单放到"不遮住目标"的位置：过程行优先，其次气泡本身；
      // 目标比半屏还高时退化成手指附近的一条线（否则只能夹取、又会盖住内容）。
      const anchorEl = stepRow ?? bubble
      const rect = anchorEl.getBoundingClientRect()
      const tall = rect.height > window.innerHeight * 0.6
      const anchor = tall
        ? { top: y, bottom: y, left: rect.left, right: rect.right }
        : { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
      openCtxAt(x, y, text, raw, message.kind, message.id, step, anchor, element ?? undefined)
    }
    return true
  }
  const longPressRef = useRef<{ timer: number; x: number; y: number } | undefined>(undefined)
  const cancelLongPress = useCallback(() => {
    if (longPressRef.current !== undefined) {
      clearTimeout(longPressRef.current.timer)
      longPressRef.current = undefined
    }
  }, [])
  useEffect(() => () => { cancelLongPress() }, [cancelLongPress])
  // 原生选区优先：一旦浏览器真的开始选字（哪怕我们 500ms 的定时器已经排上队），
  // 立刻撤掉长按与自定义菜单，让用户能拖手柄、用系统菜单复制片段。
  useEffect(() => {
    const onSelectionChange = (): void => {
      if ((window.getSelection()?.toString() ?? '') === '') return
      cancelLongPress()
      setCtxMenu(undefined)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => { document.removeEventListener('selectionchange', onSelectionChange) }
  }, [cancelLongPress])

  /** 在被长按的那一块上建选区，交给系统手柄与复制菜单。 */
  const selectTextBlock = useCallback((target: Element | undefined): boolean => {
    if (target === undefined) return false
    // 就近取一个"文字块"：消息正文 / 思考正文 / 命令参数 / 代码块。
    const block = target.closest('.chat-md-body, .chat-flow-text, .chat-think-body, .chat-msg-text, .chat-tool-args, .code-block, pre') ?? target
    const selection = window.getSelection()
    if (selection === null) return false
    const range = document.createRange()
    range.selectNodeContents(block)
    selection.removeAllRanges()
    selection.addRange(range)
    return selection.toString().trim() !== ''
  }, [])

  const openCtxAt = useCallback((
    x: number,
    y: number,
    text: string,
    raw?: string,
    kind?: RenderMessage['kind'],
    messageId?: string,
    row?: { title: string; summary: string; state: string; command?: string },
    anchor?: { top: number; bottom: number; left: number; right: number },
    target?: Element,
  ): void => {
    // 尺寸只用来选边：宽固定，高按动作条数估（每项 44 + 内边距 + 行头）。
    const itemCount = 2 // 引用 / 取消
      + (row === undefined ? 0 : 1) // 复制这一行
      + (row?.command === undefined ? 0 : 1) // 复制命令
      + (raw === undefined || row !== undefined ? 0 : 1) // 复制原文（行级时并入复制整条回复）
      + 1 // 复制 / 复制整条回复 —— 无条件渲染的一项，文本为空时它也在（漏算会把底部的取消推出屏幕）
      + (kind === 'user' && messageId !== undefined ? 1 : 0) // 编辑并重新发送
      + (row === undefined ? 1 : 0) // 分享（行级不提供）
      + (target === undefined ? 0 : 1) // 选择文字
    const menuHeight = itemCount * 44 + 12 + (row === undefined ? 0 : 34)
    const fallback = { top: y - 22, bottom: y + 22, left: x - 30, right: x + 30 }
    const placement = placeCtxMenu(
      anchor ?? fallback,
      { width: CTX_MENU_WIDTH, height: menuHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    ctxMenuOpenedAtRef.current = Date.now()
    setCtxMenu({
      x: placement.left,
      y: placement.top,
      text,
      raw,
      ...(kind !== undefined ? { kind } : {}),
      ...(messageId !== undefined ? { messageId } : {}),
      ...(row !== undefined && (row.title !== '' || row.summary !== '') ? { row } : {}),
      ...(target !== undefined ? { target } : {}),
    })
  }, [])

  /** File-path links render inside markdown HTML; delegate the click to the
   * host file opener (postMessage + window.dshOpenFile). */
  /** File-path links render inside markdown HTML. Where the host injects a
   *  native file opener (desktop embedding), the tap delegates to it; a
   *  standalone phone has no such hook, so the tap opens the in-chat preview
   *  sheet (mobile.readFile behind the scenes). */
  const handleScrollClick = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    const element = event.target instanceof Element ? event.target : null
    // An in-chat markdown <img> (remote URL or attached data URL) opens the
    // full-screen lightbox on a tap; long-press save still works (the native
    // context menu handles it — we only intercept a plain click).
    if (element !== null) {
      const image = element.closest('img')
      if (image !== null && !(element instanceof HTMLAnchorElement)) {
        const src = image.getAttribute('src')
        if (src !== null && src !== '' && !src.startsWith('data:image/svg')) {
          event.preventDefault()
          setLightboxSrc(src)
          return
        }
      }
    }
    const target = element?.closest('.file-link') ?? null
    if (target === null) return
    const path = target.getAttribute('data-path')
    if (path === null || path === '') return
    event.preventDefault()
    if (typeof window.dshOpenFile === 'function') {
      openFilePath(path)
      return
    }
    setPreviewPath(path)
  }, [])

  /* ── code-block pinch zoom (two fingers, transform scale) ──────────── */

  const pinchDistance = (touches: { [index: number]: { clientX: number; clientY: number } }): number => {
    const a = touches[0]
    const b = touches[1]
    if (a === undefined || b === undefined) return 0
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }
  const applyPinch = useCallback((scale: number): void => {
    const pinch = pinchRef.current
    if (pinch === undefined) return
    const clamped = Math.min(3, Math.max(1, scale))
    const pre = pinch.block.querySelector('pre')
    if (pre !== null) {
      pre.style.transformOrigin = '0 0'
      pre.style.transform = clamped <= 1.02 ? '' : `scale(${clamped})`
    }
  }, [])

  /** Load one older page and prepend it. The fold is directional (incremental
   *  tails only), so the older page folds standalone and concatenates ahead —
   *  host page boundaries never cut a message, so the seam is exact. */
  const loadOlder = useCallback((silent = false, beforeSeqOverride?: number, chain = false, maxRows?: number) => {
    if (pendingRef.current) {
      // 已经有一页在飞：记下这次请求，落地后接着发出。直接 return 会让调用方以为
      // 翻过了——搜索「下一个」正好撞在这个时序上（刚翻完一条命中，下一条点击进来
      // 时上一页还没落地），真机表现就是计数变了、画面一动不动。
      queuedOlderRef.current = { beforeSeq: beforeSeqOverride }
      return
    }
    pendingRef.current = true
    // The auto-extend on open must not flash the button's "加载中…" state.
    if (!silent) setLoading(true)
    // The folder snapshot is authoritative (the auto-extend on open runs
    // before React re-renders, so the closure's `messages` is still stale).
    const first = folderRef.current?.snapshot()[0] ?? messages[0]
    if (first === undefined) {
      pendingRef.current = false
      if (!silent) setLoading(false)
      return
    }
    // A stalled older-page load must not leave "加载中…" forever: abort it
    // and surface a retryable error (weak links time out instead of hanging).
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort(new DOMException('load older timed out', 'TimeoutError'))
    }, LOAD_OLDER_TIMEOUT_MS)
    // A coalesced turn message spans many step rows; page by its FIRST row's
    // seq, otherwise the request re-fetches already-shown steps of the same
    // turn and prepending duplicates their text. A search-locate may override
    // the cursor to jump straight to the target's page (one RPC instead of
    // paging back one page at a time through deep history).
    const beforeSeq = beforeSeqOverride ?? (first.startSeq ?? first.seq)
    // 「下一个」要现场读页时最费时间（宿主折页 + 对齐回合，手机上 1~3 秒）。落地后
    // 空闲时已经把下一条命中的那一页预取到这里，点击时直接命中，不再等网络。
    const cached = pageCacheRef.current.get(beforeSeq)
    if (cached !== undefined) pageCacheRef.current.delete(beforeSeq)
    // Record the anchor BEFORE the fetch: React's commit-time focus scroll
    // restoration can zero the container's scrollTop while the old page is
    // swapped, which would make the anchor shift below the wrong content.
    const anchorTop = silent ? undefined : (scrollRef.current?.scrollTop ?? scrollTopRef.current)
    // 高度也要在**发请求之前**记：请求落地后 React 可能已经提交了新内容，那时量到的
    // 是增量之后的高度，差值就是 0（补偿会失效）。
    const heightBefore = scrollRef.current?.scrollHeight
    // 同时记一条**具体的行**：窗口化渲染时 scrollHeight 会滞后（占位行还没量），
    // 只按高度差补偿会少补几百像素。落地后用这一行的位移做二次校准。
    const anchorRow = silent
      ? undefined
      : (() => {
        const rows = scrollRef.current?.querySelectorAll('[data-message-id]') ?? []
        for (const row of rows) {
          const rect = row.getBoundingClientRect()
          if (rect.bottom > 80) {
            return {
              id: row.getAttribute('data-message-id') ?? '',
              top: Math.round(rect.top),
              // 也记 seq：页面合并会把同一条换成另一个 id（页面行 vs 实时行），
              // 只按 id 找不到时还能按「seq 最接近的那一行」校准。
              seq: Number(row.getAttribute('data-row-seq') ?? '0'),
            }
          }
        }
        return undefined
      })()
    const pageRequest = cached === undefined
      ? loadChatPage(session.sessionId, beforeSeq, controller.signal, undefined, undefined, maxRows)
      : Promise.resolve(cached)
    void pageRequest.then(
      async (page) => {
        clearTimeout(timeout)
        pendingRef.current = false
        if (!silent) setLoading(false)
        let older = renderRows(page.rows, false)
        // 无感加载历史卡：这一页里已经收工、却因为 turn/end 落在下一页而没有卡的轮次，
        // 在这里**一次读齐再提交**。页与卡同一次 setMessages 落地 —— 用户看不到
        // 「卡片后来才长出来」的那一下。读不到就照原样提交（不猜、不占位）。
        //
        // 上限 3 轮：一页 25 行最多就跨两三轮，读再多只是拖慢翻页。
        const lackingTurns = missingTurnReports(older).slice(-3)
        if (lackingTurns.length > 0) {
          try {
            const cards = await loadTurnReportRows(session.sessionId, lackingTurns)
            if (cards.length > 0) {
              older = renderRows(mergeTurnReports(older, cards), false)
              for (const turn of lackingTurns) cardRecoveryRef.current.confirmed.add(turn)
            }
          } catch {
            // 读不到就当没有卡：历史翻页不能被一次失败拦住。
          }
        }
        rememberRawPage(page.rows)
        const folder = folderRef.current
        // 跳转取页（maxRows 有值）取到的可能是**和当前窗口不接壤**的一段历史：窗口停在
        // 更早那一屏，而这一次的命中在更靠后的位置。直接 prepend 会把两段不相邻的历史
        // 拼在一起，中间那一段就永久缺了 —— 落在缺口里的命中只能就近贴到一条覆盖范围
        // 虚高的行上（真机 失败 4/28、5/28：两条都贴在 6d15fd97、一个高亮都没有，
        // scrollTop 却在动）。这种情况下改用这一页重新开窗，让窗口永远是一段连续历史。
        const pageMinSeq = older.reduce((min, row) => Math.min(min, row.startSeq ?? row.seq), Number.POSITIVE_INFINITY)
        const windowMinSeq = first.startSeq ?? first.seq
        const reseed = folder !== undefined && maxRows !== undefined && older.length > 0 && pageMinSeq >= windowMinSeq
        if (folder === undefined) {
          // 走统一入口：补页同样要保住上一轮的交付卡（直接 renderRows 会把它挤掉），
          // 并且与其它提交一样做「同身份并集合并」。历史页不猜卡。
          commitRows(previous => [...older, ...previous], { allowGuessedTails: false })
        } else if (reseed) {
          const pageMaxSeq = older.reduce((max, row) => Math.max(max, row.seq), Number.NEGATIVE_INFINITY)
          const keep = folder.snapshot().filter(row => (row.startSeq ?? row.seq) > pageMaxSeq)
          folder.seed([...older, ...keep])
          applyMessages(folder.snapshot())
        } else {
          folder.prepend(older)
          applyMessages(folder.snapshot())
        }
        // 空页不写 hasOlder：一个偏掉的游标也会回空页，把它当成「到头了」写下去，
        // 整条历史就再也翻不动了（每次点都只弹「没有更早的轮次」）。
        if (older.length > 0) setHasOlder(page.hasMore)

        // Keep the visual anchor: the prepend pushes content down by the
        // inserted rows' real height, so advance the scroll position by the
        // same amount (行全渲染，量到的就是真值)。
        // 搜索跳转的取页（maxRows 有值）例外：这一页的存在意义就是把命中行送到位，
        // 落点由 locateSeq 决定。锚点补偿的 rAF 恰好会和它抢滚动位置 —— 实测有一处
        // 命中被补偿甩到列表最顶端（scrollTop 20、焦点落在没有高亮的行上）。
        const el = scrollRef.current
        if (el !== undefined && older.length > 0 && maxRows === undefined) {
          if (silent && scrollStateRef.current.gap <= FOLLOW_THRESHOLD_PX) {
            // The silent auto-extend on open prepends ABOVE the tail: the
            // tail page already followed to the bottom, and a plain anchor
            // shift would strand the view mid-history (the last message's
            // key never changes, so the stream follower never re-fires).
            // Defer the re-follow to the commit-time effect (see
            // followAfterPrependRef): a rAF here can run before React has
            // committed the prepend, and a scrollToBottom that reads the
            // pre-commit scrollHeight pins to the OLD tail — leaving the
            // view stranded in history once the prepend lands.
            followAfterPrependRef.current = true
          } else {
            // 记下翻页前的真实高度与锚点，commit 后按 scrollHeight 差值补偿。
            // （估算高度在长卡片/代码块上会差出上千像素。）
            prependAnchorRef.current = {
              top: anchorTop ?? el.scrollTop,
              height: heightBefore ?? el.scrollHeight,
              ...(anchorRow === undefined ? {} : { rowId: anchorRow.id, rowTop: anchorRow.top, rowSeq: anchorRow.seq }),
            }
          }
        }
        // 铺开链放在锚点/跟随之后：先保证这一页落地的视野不动，再决定要不要
        // 接着补。静默补页、行数够了或页数到顶就停。
        if (chain && page.hasMore && openChainPagesRef.current < OPEN_HISTORY_MAX_PAGES) {
          const loadedRows = folderRef.current?.snapshot().length ?? (messages.length + older.length)
          if (loadedRows < OPEN_HISTORY_TARGET_ROWS) {
            openChainPagesRef.current += 1
            loadOlderRef.current(true, undefined, true)
          }
        }
        // 被挡住的那一发补上（见 loadOlder 开头的排队分支）。
        const queued = queuedOlderRef.current
        if (queued !== undefined) {
          queuedOlderRef.current = undefined
          loadOlderRef.current(true, queued.beforeSeq, false, maxRows)
        }
      },
      (reason: unknown) => {
        clearTimeout(timeout)
        pendingRef.current = false
        setLoading(false)
        // The auto-extend on open is best-effort: a failure keeps the loaded
        // tail and the manual button — it must not surface an error.
        if (!silent) setError(errorText(reason))
        const queued = queuedOlderRef.current
        if (queued !== undefined) {
          queuedOlderRef.current = undefined
          loadOlderRef.current(true, queued.beforeSeq, false, maxRows)
        }
      },
    )
  }, [session.sessionId, messages, scrollToBottom, setScrollTopProgrammatically])
  loadOlderRef.current = loadOlder

  // Focus-locate (search-hit open): scroll the chat to the row covering the
  // target message seq once it loads, paging back a bounded number of times
  // when the row sits in older history. One highlight per open; a target
  // that never surfaces gives up silently (the chat stays at the tail).
  const focusPendingRef = useRef<number | undefined>(initialFocusSeq)
  const focusMessageIdRef = useRef<string | undefined>(initialFocusMessageId)
  const focusPartIdRef = useRef<string | undefined>(initialFocusPartId)
  /** 这一条命中是该片段里的第几处（同一段里同一个词出现多次时对位 <mark>）。 */
  const focusOccurrenceRef = useRef(0)
  const focusAttemptsRef = useRef(0)
  /** Whether the deep-history locate already jumped straight to the target's
   *  page (one RPC) instead of paging back one page at a time. */
  const focusJumpedRef = useRef(false)
  const [focusMsgId, setFocusMsgId] = useState<string | undefined>(undefined)
  /** The located step seq, paired with focusMsgId for the post-render scroll. */
  const focusTargetRef = useRef<number | undefined>(undefined)
  /** True when the locate anchor is the ROW itself, not a step/search mark inside
   *  it (turn jumps): the row `data-message-id` is the prompt row, while the seq
   *  we match by belongs to the answer row below it — resolving `[data-step-seq]`
   *  would scroll to the answer and hide the question again. */
  const focusRowFirstRef = useRef(false)
  /** One-shot guard: scroll to the located step exactly once per open. */
  const focusScrolledRef = useRef(false)
  /** 收尾校准的令牌：新的定位开始时作废上一次还在排队的校准。 */
  const locateSettleRef = useRef(0)
  /** 标题命中只提示一次，别每帧弹。 */
  const titleOnlyToastRef = useRef(false)
  /** True while a search-locate has resolved its target row but has not yet
   *  scrolled the anchor into view. During this window the opening tail-pin /
   *  windowed re-locate must stand down — otherwise they repurpose the render
   *  window to the tail and window the located row OUT of the DOM, so the
   *  anchor never surfaces and the locate silently fails (intermittent
   *  "search shows it but I can't see it" on long, windowed sessions). */
  const locatingRef = useRef(false)
  /** 这次"带定位打开"已经处理完（落到了行，或确认翻不到）：它是一次性意图，
   *  不能再跟着 `messages` 的每一次变化重跑。
   *
   *  以前这个 effect 没有一次性闸门，`focusMessageIdRef` 又永不清空，于是每次列表
   *  变化（翻一页、会话内搜索跳一处）都把焦点和落点重新抢回"打开时那一条命中"。
   *  会话内连按「下一个」时真机表现就是：pending 已经把焦点挪到新命中，下一拍又被
   *  拽回开场那条（可视区里一个高亮都没有，focusId 永远是开场那条）。 */
  const openLocateDoneRef = useRef(false)
  // App keeps the chat route keyed by session, so locating another hit in the
  // same session reuses this component. Re-arm the locate state for each new
  // target instead of treating the first open as the only one.
  useEffect(() => {
    // 首页搜索点进来的会话：props 里可能一路丢干净（转场双挂载 / 同一路由重挂载），
    // 意图表里那份是最后一道兜底 —— 少了它就只剩"滚到附近、一个字不高亮"。
    focusPendingRef.current = initialFocusSeq ?? locateIntent?.seq
    focusMessageIdRef.current = initialFocusMessageId ?? locateIntent?.messageId
    focusPartIdRef.current = initialFocusPartId ?? locateIntent?.partId
    focusAttemptsRef.current = 0
    focusJumpedRef.current = false
    focusTargetRef.current = undefined
    focusRowFirstRef.current = false
    focusScrolledRef.current = false
    openLocateDoneRef.current = false
    scrollEvent({ type: 'locate-end' })
    programmaticScrollRef.current = false
    locatingRef.current = initialFocusSeq !== undefined || initialFocusMessageId !== undefined || initialFocusPartId !== undefined
    setFocusMsgId(undefined)
  }, [initialFocusSeq, initialFocusMessageId, initialFocusPartId, initialFocusQuery])
  // 从首页搜索点进来：把会话内搜索一起打开并填好词。少了这一步，用户进来只有
  // 一次性的高亮、搜索框是空的 —— 计数不显示，也没法接着按「上一个/下一个」。
  // 只认**意图表**里的那份（props 的 initialFocusQuery 是普通「进入并定位」路径，
  // 那条路径本来就不该弹出搜索框）。
  const searchPrefillRef = useRef('')
  useEffect(() => {
    const intent = locateIntentFor(session.sessionId)
    const query = (intent?.query ?? '').trim()
    if (query === '') return
    const key = `${session.sessionId}#${query}`
    if (searchPrefillRef.current === key) return
    searchPrefillRef.current = key
    setChatSearchOpen(true)
    setChatSearchTerm(query)
  }, [session.sessionId])
  useEffect(() => {
    // 每帧现取：useMemo 一旦在意图写入之前跑过，就永远缓存 undefined（表现为
    // 「第一次进有高亮、之后同样的点击没有」）。
    const liveIntent = locateIntentFor(session.sessionId)
    const target = focusPendingRef.current ?? liveIntent?.seq
    const targetMessageId = focusMessageIdRef.current ?? liveIntent?.messageId
    const focusQueryText = initialFocusQuery ?? liveIntent?.query
    const queryText = focusQueryText?.trim() ?? ''
    if ((target === undefined && targetMessageId === undefined) || loading) {
      // 只靠关键词打开（标题命中解不出正文 seq）：这里没有可跳的锚点，就是
      // 普通打开这场会话。明说一句，别让用户以为"应该高亮但没高亮"。
      if (!loading && queryText !== '' && !titleOnlyToastRef.current) {
        titleOnlyToastRef.current = true
        toast('这条命中在会话标题上，已打开会话')
      }
      return
    }
    // 带定位打开只处理一次：落到行之后，焦点归会话内搜索/轮次跳转所有。
    if (openLocateDoneRef.current) return
    const messagesNow = messages
    const query = queryText.toLowerCase()
    const queryMatches = (message: RenderMessage): boolean => {
      if (query === '') return true
      const text = message.text.toLowerCase()
      if (text.includes(query)) return true
      const needles = query.match(/[\p{L}\p{N}_]+/gu) ?? []
      return needles.length > 0 && needles.every(needle => text.includes(needle))
    }
    // A seq range is necessary but not sufficient after turn coalescing: a
    // stale/shifted seq can fall inside a merged row that does not contain the
    // searched text. Accept the range only when the row also matches query.
    const idRowIndex = targetMessageId === undefined ? -1 : messagesNow.findIndex(message => message.id === targetMessageId)
    const partMatches = (message: RenderMessage): boolean => {
      if (targetMessageId !== undefined && message.id !== targetMessageId) return false
      if (focusPartIdRef.current === undefined) return true
      return message.flow?.some(part => part.kind === 'text' && part.partId === focusPartIdRef.current) === true
    }
    // The messageId is the AUTHORITATIVE identity: once it matched a rendered
    // row, do NOT let the text-query veto it. The search index matched the
    // flow's per-part text, while queryMatches checks the row's merged
    // `message.text` — on a multi-step turn these can differ, so a legitimate
    // hit would be vetoed and the locate would fall back to an OLDER row
    // containing the keyword ("searched the newest message, landed
    // mid-history"). queryMatches is only a guard against a stale/shifted SEQ
    // landing in a row that lacks the text; a resolved messageId needs no such
    // guard.
    const stableRowIndex = idRowIndex >= 0 && partMatches(messagesNow[idRowIndex]) ? idRowIndex : -1
    const firstLoadedSeq = messagesNow[0]?.startSeq ?? messagesNow[0]?.seq
    const targetIsAtOrAfterLoadedStart = target === undefined || firstLoadedSeq === undefined || target >= firstLoadedSeq
    const seqRowIndex = target === undefined || !targetIsAtOrAfterLoadedStart ? -1 : messagesNow.findIndex(message =>
      // Search indexes the exact text-part/chunk seq, while a finalized row's
      // public seq is the final event seq. For a single-step row startSeq is
      // absent, so requiring target >= message.seq rejects a valid hit after
      // pending→finalization and falls back to the first older query match.
      target <= message.seq && queryMatches(message))
    // An authoritative target that is not in the opening tail is not a
    // legitimate query fallback. The tail may contain the same keyword in an
    // older row; choosing it here both shows a misleading fallback toast and
    // prevents the history pager from ever loading the real target. Keep the
    // query fallback only for legacy query-only opens, or after all history is
    // exhausted below.
    const hasAuthoritativeTarget = targetMessageId !== undefined || target !== undefined
    // 带 messageId 的命中（索引给的精确身份）永远不走「取第一个含关键词的旧行」这条
    // 退路：那条退路会把深历史命中落到 index 0——真机实测正是它把已经落对的跳转顶回
    // 列表顶端（scrollTop=8、焦点行不含关键词）。只有「只有 seq/关键词」的老式打开，
    // 且在历史还没翻完时才允许关键词兜底。
    const queryFallbackIndex = targetMessageId !== undefined || (hasAuthoritativeTarget && hasOlder)
      ? -1
      : messagesNow.findIndex(queryMatches)
    const rowIndex = stableRowIndex >= 0 ? stableRowIndex : seqRowIndex >= 0 ? seqRowIndex : queryFallbackIndex
    // 命中行还必须真的含关键词。索引的 id/seq 与渲染行的 id/seq 来自两条通道，
    // 逐条并不总对齐：落到一行却不含关键词时，全页一个 mark 都不会出现，用户
    // 看到的就是「跳过去了但没高亮」。这时在本窗口里取离它最近、确实含关键词
    // 的行。**目标行不在窗口里时不走这条退路**：那会落到更早的一条同词消息上，
    // 正是「搜最新的，落到了历史中段」——交给下面的翻页直接跳到目标页。
    const markableIndex = rowIndex < 0
      ? -1
      : (query === '' || queryMatches(messagesNow[rowIndex])
          ? rowIndex
          : (() => {
            let best = -1
            let bestDistance = Number.POSITIVE_INFINITY
            messagesNow.forEach((message, index) => {
              if (!queryMatches(message)) return
              const distance = Math.abs(index - rowIndex)
              if (distance < bestDistance) { best = index; bestDistance = distance }
            })
            return best
          })())
    console.debug(`[locate] initial: msgId=${targetMessageId ?? '-'} seq=${target ?? '-'} partId=${focusPartIdRef.current ?? '-'} query=${initialFocusQuery ?? '-'}; rows=${messagesNow.length}; resolved index=${rowIndex} markable=${markableIndex} (stable=${stableRowIndex} seqRow=${seqRowIndex})`)
    if (markableIndex < 0) {
      if (hasOlder && focusAttemptsRef.current < FOCUS_MAX_PAGES) {
        // Don't burn an attempt on a load that is already in flight (the
        // opening auto-extend): that page still lands and re-triggers this
        // effect, so counting it would exhaust the page budget early and a
        // deeper target would give up before it surfaces.
        if (!pendingRef.current) {
          focusAttemptsRef.current += 1
          // First miss with a known target seq: jump straight to the target's
          // page instead of paging back one page at a time through deep
          // history (a hit 100 pages back would otherwise take ~100 serial
          // RPCs and read as a failed locate). Fall back to normal paging
          // after the jump if the target still has not surfaced.
          if (!focusJumpedRef.current && target !== undefined) {
            focusJumpedRef.current = true
            loadOlderRef.current(true, target + 1)
          } else {
            loadOlderRef.current(true)
          }
        }
      } else {
        // Give up on this locate: release the window guard so the normal
        // follower (locateWindow / pinToRealBottom) is not left permanently
        // blocked — otherwise every later scroll in this session stops
        // relocating the window and the chat appears frozen mid-history.
        // 有明确目标却全篇找不到关键词：不是"跳偏了"，是这条命中不在这段日志里
        // （会话被编辑/删除，或索引落后）。明说，别让用户以为定位成功了。
        if (query !== '' && rowIndex >= 0) toast('未能在当前日志定位到这条命中')
        focusPendingRef.current = undefined
        openLocateDoneRef.current = true
        locatingRef.current = false
        scrollEvent({ type: 'locate-end' })
      }
      return
    }
    focusPendingRef.current = undefined
    // 一次性：这一条开场的命中已经认到行了，之后列表怎么涨都别再抢焦点。
    openLocateDoneRef.current = true
    const row = messagesNow[markableIndex]
    setFocusMsgId(row.id)
    // Diagnostic: if a messageId came from search but the row was resolved by
    // seq/query fallback, the target id did not match any rendered row — most
    // likely the searched message was still streaming (pending, synthetic id)
    // when indexed and has now finalized with a different id, so the locate
    // lands on an older row instead of the newest one.
    if (targetMessageId !== undefined && stableRowIndex < 0) {
      toast(`定位回退: 目标 ${targetMessageId} 未命中，定位到 ${row.id}（消息可能在更新中）`)
    }
    // The target row is resolved: own the window until its anchor scrolls in
    // (see locatingRef), so the opening tail-pin cannot repurpose the render
    // window to the tail and window this row out before it renders.
    locatingRef.current = true
    // Hold the auto-follower off until the user scrolls: a message update
    // after the locate would otherwise re-pin the viewport to the tail.
    scrollEvent({ type: 'locate-start', at: Date.now(), holdMs: 2_000 })
    // If the seq was stale but the paired query found a loaded row, use that
    // row's own anchor; otherwise the old target would still miss the DOM.
    // 换过行（原命中行不含关键词）时也用换到的那行自己的 seq：拿旧 seq 去查
    // data-step-seq 会落到另一个片段上，等于没定位。
    focusTargetRef.current = markableIndex !== rowIndex
      ? (row.startSeq ?? row.seq)
      : stableRowIndex >= 0 ? target : seqRowIndex >= 0 ? target : (row.startSeq ?? row.seq)
    focusScrolledRef.current = false
  }, [messages, hasOlder, loading, initialFocusSeq, initialFocusMessageId, initialFocusPartId, initialFocusQuery])

  // Scroll to the located step AFTER the window renders it. setWin is async,
  // so a same-frame querySelector would miss the freshly-windowed rows; this
  // effect runs once the focused row is in the DOM. The one-shot guard keeps
  // a later user scroll (which also changes `win`) from re-yanking the view.
  // useLayoutEffect instead of useEffect: it runs synchronously AFTER the DOM
  // commit but BEFORE the browser paints, so the windowed rows are laid out and
  // getBoundingClientRect reports their current positions — no rAF deferral is
  // needed to escape a stale (pre-windowed or pre-reflow) layout. That stale
  // layout is exactly why the previous rAF-based scroll left the viewport at
  // the tail ("keyword highlighted but never jumped").
  useLayoutEffect(() => {
    if (focusMsgId === undefined) return
    if (focusScrolledRef.current) return
    const target = focusTargetRef.current
    if (target === undefined && initialFocusMessageId === undefined && initialFocusPartId === undefined) return
    const el = scrollRef.current
    if (el === undefined) return
    const scrollTo = (): void => {
      // 定位是**远离底部**的一次滚动：先把这个意图告诉状态机，免得同一批
      // effect 里读到的还是「贴底」而把画面拽回尾部。
      scrollEvent({ type: 'locate-start', at: Date.now(), holdMs: 2_000 })
      // 定位执行器：照桌面的 use-chat-viewport 做 —— 量一次锚点、写一次 scrollTop、
      // **读回**真实落点当权威结果；只有落点仍偏才补"还差的那几像素"。
      // 以前是同一套估算盲写 12 次：越补越偏，真机就是"定位不到正确的位置上"。
      let tries = 0
      // 这一轮里已经替用户展开过的折叠开关：只点一次，别再关上/反复点。
      const expandedToggles = new Set<HTMLElement>()
      const run = (): void => {
        const el2 = scrollRef.current
        if (el2 === undefined) { console.debug('[locate] scroll container missing'); locatingRef.current = false; return }
        // 转场里可能同时挂着两个聊天实例（旧的还没卸载）。离屏的那个跑定位会"成功"
        // 滚到自己的位置，而用户看到的那一屏纹丝不动 —— 真机原话「数字在变，位置
        // 一直不动」。排好版之前（高度 0）先让一帧，别把这次定位判死。
        const boxRect = el2.getBoundingClientRect()
        // jsdom（单测）里所有几何都是 0：别拿它当"没排版/离屏"，否则定位永远不执行。
        const laidOut = boxRect.height > 0
        if (laidOut && (boxRect.bottom <= 0 || boxRect.top >= window.innerHeight)) {
          console.debug('[locate] skip: this chat instance is off-screen')
          locatingRef.current = false
          return
        }
        // 两个实例可能重叠在视口里：被盖住的那个不许再跑定位。用命中测试（谁在点
        // 上面）判断，比比 z-index 更实际 —— 旧实例滚得再"成功"，用户看到的还是
        // 新实例那一屏。
        if (laidOut && typeof document.elementFromPoint === 'function') {
          const px = Math.min(window.innerWidth - 1, Math.max(0, boxRect.left + boxRect.width / 2))
          const py = Math.min(window.innerHeight - 1, Math.max(0, boxRect.top + boxRect.height / 2))
          const onTop = document.elementFromPoint(px, py)
          if (onTop !== null && !el2.contains(onTop)) {
            console.debug('[locate] skip: this chat instance is covered by another one')
            locatingRef.current = false
            return
          }
        }
        const messageEl = el2.querySelector(`[data-message-id="${escapeAttr(focusMsgId)}"]`)
        // The exact search keyword: the focused row renders it inside a
        // <mark class="chat-search-mark"> wherever it sits in the text. Scrolling
        // to the row/step TOP is not enough — on a long markdown (or a long
        // coalesced turn) the matched word can be mid-bubble, off-viewport below
        // the row root even though the root itself is in view. Scroll to the
        // mark so the keyword is actually reached.
        // 命中落在一个具体片段上时，先滚到那个片段、再滚到它里面的第一个 mark：
        // 一行里多处命中时（focusMsgId 相同）全行第一个 mark 是别处的命中，看着就是"不准"。
        const wantedPartId = focusPartIdRef.current ?? initialFocusPartId
        const partEl = wantedPartId === undefined ? null : messageEl?.querySelector(`[data-part-id="${escapeAttr(wantedPartId)}"]`) ?? null
        const allMarks = Array.from((partEl ?? messageEl)?.querySelectorAll<HTMLElement>('.chat-search-mark') ?? [])
        const wantedOccurrence = focusOccurrenceRef.current
        const isProse = (mark: HTMLElement): boolean => mark.closest('.chat-msg-text, .chat-md-body, .chat-flow-answer, [data-part-id="answer"]') !== null
        // 只认正文里的标记：用户气泡、答案段落、过程卡里的步骤正文。推理链（深度思考）
        // 与工具卡仍然不参与 —— 它们从来不是索引的命中来源。
        const proseMarks = allMarks.filter(isProse)
        // 合并卡里每一步的正文都有自己的 data-step-seq 锚点：命中落在哪一步，就只在
        // 那一步的标记里取第 N 处。全行混着取的话，同一张卡里两条命中（第 766 步和
        // 第 1057 步）会双双取到全行第一个 mark —— 计数在走、画面一模一样。
        const stepScope = target === undefined || focusRowFirstRef.current
          ? null
          : messageEl?.querySelector(`[data-step-seq="${escapeAttr(String(target))}"]`) ?? null
        const stepMarks = stepScope === null
          ? []
          : Array.from(stepScope.querySelectorAll<HTMLElement>('.chat-search-mark')).filter(isProse)
        // 第 N 处的计数口径是**整行**（见 gotoChatHit 的 occurrence），所以取标记也得
        // 按整行取：索引给的 partId 只指向这一步的正文，卡里其余步骤的正文（前几步的
        // 答案被打包进过程卡）同样是命中落点。目标步在卡里没有锚点（跨页合并把这一步
        // 折到别处去了）时，就退到整行的正文标记，别缩在 partEl 里只剩一个。
        const rowProseMarks = stepMarks.length > 0
          ? stepMarks
          : Array.from(messageEl?.querySelectorAll<HTMLElement>('.chat-search-mark') ?? []).filter(isProse)
        const pool = rowProseMarks.length > 0 ? rowProseMarks : proseMarks
        // 该行里可见的 mark 可能比命中数少（命中落在折叠/隐藏文本里）。越界时不要
        // 悄悄退回第一个 mark——那会让「下一个」看起来原地不动。
        const markEl = pool.length === 0
          ? null
          : (pool[Math.min(wantedOccurrence, pool.length - 1)] ?? null)
        // 标记落在折叠里（高度 0）：先展开再重算，否则滚过去也是一片空白，
        // 用户看到的还是「位置没动」。折叠开关带 aria-expanded，点它最稳。
        if (laidOut && markEl !== null && markEl.getBoundingClientRect().height === 0 && tries < LOCATE_MAX_FIXES) {
          const toggle = markEl.closest<HTMLElement>('[aria-expanded="false"]')
          if (toggle !== null && !expandedToggles.has(toggle)) {
            expandedToggles.add(toggle)
            toggle.click()
            tries += 1
            requestAnimationFrame(run)
            return
          }
        }
        // 要第 N 处命中，但这一行只渲染出更少的标记（其余在折叠组里）：先展开这一行
        // 里还没打开的折叠，再重算。否则「下一个」会原地不动 —— 计数器走了、画面没走。
        if (laidOut && wantedOccurrence >= pool.length && tries < LOCATE_MAX_FIXES && messageEl !== null) {
          // 长用户消息默认只渲染前 N 个字，后面的命中藏在「展开全文（N 字）」按钮后面。
          // 那个按钮没有 aria-expanded，只认文本 —— 不点开就永远只有一个标记，真机
          // 连按三次「下一个」都停在同一个位置，就是这个。
          const folded = [
            ...Array.from(messageEl.querySelectorAll<HTMLElement>('[aria-expanded="false"]')),
            ...Array.from(messageEl.querySelectorAll<HTMLElement>('.chat-msg-toggle'))
              .filter(node => (node.textContent ?? '').includes('展开')),
          ].find(node => !expandedToggles.has(node))
          if (folded !== undefined) {
            expandedToggles.add(folded)
            folded.click()
            tries += 1
            requestAnimationFrame(run)
            return
          }
        }
        const stepEl = target === undefined || focusRowFirstRef.current ? null : el2.querySelector(`[data-step-seq="${escapeAttr(String(target))}"]`)
        // 一轮被打包成一张卡片时，卡里每一步都可能命中：没有精确的那一步就退到
        // 「seq 不超过命中的最近一步」，让每一条命中都有各自的落点。
        const nearestStepEl = stepEl ?? (target === undefined || focusRowFirstRef.current ? null : (() => {
          const scope = messageEl ?? el2
          let best: HTMLElement | null = null
          let bestSeq = Number.NEGATIVE_INFINITY
          for (const candidate of Array.from(scope.querySelectorAll<HTMLElement>('[data-step-seq]'))) {
            const value = Number(candidate.getAttribute('data-step-seq'))
            if (Number.isFinite(value) && value <= target && value > bestSeq) {
              best = candidate
              bestSeq = value
            }
          }
          return best
        })())
        // 有 mark 就先滚 mark：那是"这一处命中"本身，比它所在的步骤/行都精确
        // （一行里多处命中、或命中在步骤中段时，按步骤滚会把那处留在视口外）。
        const anchor = markEl ?? nearestStepEl ?? partEl ?? messageEl ?? (target === undefined ? null : el2.querySelector(`[data-row-seq="${escapeAttr(String(target))}"]`))
        if (anchor === null) {
          if (tries >= 10) { console.debug(`[locate] anchor never surfaced (focusMsgId=${focusMsgId} seq=${target ?? '-'})`); locatingRef.current = false; return }
          tries += 1
          requestAnimationFrame(run)
          return
        }
        // 先强制一次同步重排再读几何：content-visibility 的行要等布局才知道真实
        // 位置，读到的 rect 才是这一帧的。
        void el2.scrollHeight
        const cRect = el2.getBoundingClientRect()
        const off = anchor.getBoundingClientRect().top - cRect.top - LOCATE_TOP_GAP
        const before = el2.scrollTop
        // Mark this as a programmatic scroll so handleScroll does not treat it
        // as a user gesture and release the locate lock (nor record a reading
        // bookmark for the located turn).
        if (Math.abs(off) > 0.5) setScrollTopProgrammatically(el2, Math.max(0, el2.scrollTop + off))
        // 读回：真机上 scrollTop 会被 clamp（内容还没铺满、图片回填），落点是
        // 读回来的这个数，不是我们算出来的那个数。
        const landed = el2.scrollTop
        requestAnimationFrame(() => {
          const el2b = scrollRef.current
          if (el2b === undefined) { locatingRef.current = false; return }
          const aTop = anchor.getBoundingClientRect().top
          const cTop = el2b.getBoundingClientRect().top
          const cH = el2b.clientHeight
          // If the container reports no viewport height the layout is still
          // unstable (or jsdom gives 0) — trust the scroll rather than report a
          // false miss and hammer the retry loop.
          if (cH <= 0) {
            focusScrolledRef.current = true
            locatingRef.current = false
            return
          }
          // 判据是"锚点落在视口顶附近"，不是"锚点在屏内"：后者的容差有一整屏
          // （600px），落点偏半屏也算过，于是偏了也没人重试。
          const slack = Math.min(48, Math.max(16, cH * 0.25))
          // 滚不动了（内容还没铺满一屏、或已经到底）时，"锚点在视口顶附近"是
          // 个不可能达成的判据：scrollTop 被 clamp，补多少次都是同一个数，最后
          // 白烧 3 次补偿还判失败。这种情况只要锚点整块落在视口里就算到位。
          const atScrollEnd = el2b.scrollTop + cH >= el2b.scrollHeight - 2
          const anchorHeight = anchor.getBoundingClientRect().height
          const inView = (aTop >= cTop - LOCATE_TOLERANCE_PX && aTop <= cTop + slack)
            || (atScrollEnd && aTop >= cTop - LOCATE_TOLERANCE_PX && aTop + anchorHeight <= cTop + cH)
          if (inView) {
            // 落点真的在视口里。**不要在这里清意图**：转场里聊天页可能挂两个
            // 实例，先成功的那个把意图清掉，真正显示的那个就再也拿不到关键词，
            // 于是「定位成功、一个字都不高亮」。靠 TTL 自然过期。
            console.debug(`[locate] OK focusMsgId=${focusMsgId} seq=${target ?? '-'} scrollTop ${before}->${landed} (read ${el2b.scrollTop}) after ${tries} fix(es)`)
            focusScrolledRef.current = true
            locatingRef.current = false
            // 收尾校准：content-visibility 的行会在这之后陆续拿到真实高度，
            // 上面那几行一变高，刚对好的落点就被撑走（实测 mark 被挤到视口外
            // 5950px）。这里在之后半秒内再校两次，偏出容差就补回来。
            const settleToken = ++locateSettleRef.current
            // 收尾校准必须盯**同一个**锚点：以前取 `row.querySelector('.chat-search-mark')`
            // （全行第一个标记），一张卡里两条命中落在不同标记上时，校准会把第二个
            // 拉回第一个的位置 —— 两次数出来同一个 scrollTop，"下一个"看着原地不动。
            const settleAim = anchor
            const settleIndex = markEl === null ? -1 : pool.indexOf(markEl)
            // 一行能有十几处标记，行顶对齐不等于「有一处高亮在视口里」：合并卡里过程
            // 组展开、content-visibility 的行随后拿到真实高度，mark 会被撑到视口外
            // （真机 重启 开场自动定位：焦点行有 9 个标记、视口里一个都没有）。
            // 收尾阶段兜底把**某处标记**拉进视口，而不是只把行顶对到位置。
            const ensureMarkInView = (box: HTMLDivElement): void => {
              const row = box.querySelector<HTMLElement>(`[data-message-id="${escapeAttr(focusMsgId)}"]`)
              if (row === null) return
              const marks = [...row.querySelectorAll<HTMLElement>('.chat-search-mark')]
              if (marks.length === 0) return
              const view = box.getBoundingClientRect()
              const visible = marks.some(mark => {
                const rect = mark.getBoundingClientRect()
                return rect.bottom > view.top && rect.top < view.bottom
              })
              if (visible) return
              const first = marks[0]
              if (first === undefined) return
              const off = first.getBoundingClientRect().top - view.top - LOCATE_TOP_GAP
              setScrollTopProgrammatically(box, Math.max(0, box.scrollTop + off))
            }
            const settle = (remaining: number): void => {
              window.setTimeout(() => {
                if (locateSettleRef.current !== settleToken) return
                const box = scrollRef.current
                if (box === undefined) return
                const row = box.querySelector<HTMLElement>(`[data-message-id="${escapeAttr(focusMsgId)}"]`)
                const aim = settleAim.isConnected
                  ? settleAim
                  : (settleIndex >= 0 ? row?.querySelectorAll<HTMLElement>('.chat-search-mark')[settleIndex] : undefined) ?? row
                if (aim === null || aim === undefined) return
                const off = aim.getBoundingClientRect().top - box.getBoundingClientRect().top - LOCATE_TOP_GAP
                if (Math.abs(off) > Math.max(24, LOCATE_TOP_GAP * 3)) {
                  setScrollTopProgrammatically(box, Math.max(0, box.scrollTop + off))
                }
                ensureMarkInView(box)
                if (remaining > 1) settle(remaining - 1)
              }, 220)
            }
            settle(3)
            return
          }
          // 补偿只写差额：落点偏多少就补多少，不重算绝对位置（重算正是以前越补
          // 越偏的原因）。
          const delta = aTop - cTop - LOCATE_TOP_GAP
          console.debug(`[locate] fix #${tries + 1}: off=${Math.round(delta)} anchorTop=${Math.round(aTop)} scrollTop=${Math.round(el2b.scrollTop)} scrollH=${Math.round(el2b.scrollHeight)}`)
          if (tries < LOCATE_MAX_FIXES) {
            tries += 1
            setScrollTopProgrammatically(el2b, Math.max(0, el2b.scrollTop + delta))
            requestAnimationFrame(run)
            return
          }
          // Diagnose: report the numbers on-screen so the user can send the
          // screenshot and we can see WHY the scroll never lands.
          toast(`定位未成功(共${messages.length}条, 目标≈${Math.round(landed)}, 当前${Math.round(el2b.scrollTop)}/${Math.round(el2b.scrollHeight)})`)
          focusScrolledRef.current = true
          locatingRef.current = false
        })
      }
      // Run synchronously inside the layout effect (before paint) so the layout
      // is the committed windowed one; the verify step still re-runs on later
      // frames if a competing effect pushed the row back off-screen.
      run()
    }
    // Prefer the exact step anchor; fall back to the row itself (non-flow
    // rows render no per-step anchor, and their seq equals the row seq).
    const findAnchor = (): Element | null => {
      // Prefer the RENDERED row (focusMsgId) over the raw target: the locate
      // effect already resolved focusMsgId to a row that IS in the DOM (its
      // highlight is showing). When the search hit carried only a seq (no
      // messageId), the target seq may be a flow-part seq that matches no
      // data-step-seq/data-row-seq — but the row root always carries
      // data-message-id=focusMsgId, so scrolling to it is always possible.
      const messageEl = el.querySelector(`[data-message-id="${escapeAttr(focusMsgId)}"]`)
      const markEl = messageEl?.querySelector<HTMLElement>('.chat-search-mark')
      const partEl = initialFocusPartId === undefined ? null : messageEl?.querySelector(`[data-part-id="${escapeAttr(initialFocusPartId)}"]`) ?? null
      // Prefer the EXACT step anchor over the message root. A search hit
      // carries a seq that maps to one text part's `data-step-seq`; scrolling
      // to the root instead lands at the TOP of a long coalesced turn where
      // the matched keyword (buried mid-bubble) is off-screen — the user then
      // reports "the keyword isn't in the history". Fall back to the root only
      // when no precise anchor exists (non-flow rows have only data-row-seq).
      const stepEl = target === undefined ? null : el.querySelector(`[data-step-seq="${escapeAttr(String(target))}"]`)
      return stepEl ?? markEl ?? partEl ?? messageEl ?? (target === undefined ? null : el.querySelector(`[data-row-seq="${escapeAttr(String(target))}"]`))
    }
    const anchor = findAnchor()
    if (anchor !== null) {
      scrollTo()
      return
    }
    // The window may not have rendered the target row yet (setWin is async
    // and React commits after this effect). Mobile history paging and Markdown
    // parsing can exceed a few hundred milliseconds, so keep waiting for the
    // actual anchor instead of silently abandoning a valid search hit.
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    const retry = (): void => {
      attempts += 1
      if (attempts > 120) {
        // Last resort: scroll to the focused row by its id even if the exact
        // step anchor never surfaced (a coalescing edge case) — better than
        // leaving the chat at the tail.
        const rowEl = el.querySelector(`[data-mid="${focusMsgId}"]`)
        if (rowEl !== null) scrollTo()
        // Give up: release the window guard so later scrolls/locates still work.
        locatingRef.current = false
        return
      }
      const el2 = scrollRef.current
      if (el2 === undefined) return
      // Wait only for the RENDERED row by its stable id; scrollTo internally
      // resolves the finest anchor (step → part → row root) on the next frame.
      const messageEl2 = el2.querySelector(`[data-message-id="${escapeAttr(focusMsgId)}"]`)
      if (messageEl2 === null) {
        timer = setTimeout(retry, 50)
        return
      }
      scrollTo()
    }
    timer = setTimeout(retry, 50)
    return () => clearTimeout(timer)
  }, [focusMsgId, locateTick, initialFocusMessageId, initialFocusPartId, setScrollTopProgrammatically])

  /** Add a picked/pasted image: compress it, then append to the attach list. */
  const addImage = useCallback((file: File) => {
    void compressImageFile(file).then(({ image, failed }) => {
      // A decode failure (HEIC etc.) can't be sent: drop it and tell the user
      // instead of silently keeping an unusable attachment.
      if (failed) {
        toast('该图片无法解码，已忽略')
        return
      }
      // Over the cap: refuse loudly rather than silently dropping the image.
      if (attachImagesRef.current.length >= MAX_ATTACHED_IMAGES) {
        toast(`最多附加 ${MAX_ATTACHED_IMAGES} 张图片`)
        return
      }
      setAttachImages(previous => [...previous, image])
    })
  }, [])

  /**
   * 待发附件的一条（桌面端 composer 那颗 chip 的复刻）。
   *
   * `status` 三态决定 chip 的样子：uploading「上传中…」、ready「大小」、
   * failed「上传失败，点按重试」。上传失败的那条**留着**，让用户看得到是哪一条、
   * 能重传或移除 —— 以前是直接消失，发送框里什么都看不到。
   */
  interface StagedFile {
    /** 本地键：宿主收据要等回包才有，chip 先挂在它上面。 */
    localId: string
    name: string
    bytes?: number
    status: 'uploading' | 'ready' | 'failed'
    /** 宿主铸的收据（status === 'ready' 时必有）。 */
    receiptId?: string
    /**
     * 重传要用的原文件。
     *
     * 编辑「带附件的排队消息」时回填的 chip 没有原文件（字节在宿主那边、收据还在）：
     * 这种只能发送/移除，不能重传 —— 所以这里可空。
     */
    file?: File  /** 这次上传的取消句柄（弱网卡住时点「取消」就停，不必等 120 秒超时）。 */
    abort?: AbortController
  }
  /** 单个附件上限（与宿主 `mobile.uploadAttachment` 的 20 MB 判据同源）。 */
  const MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024
  /** 一次最多挂几个文件：再多手机端那一条附件栏就挤成一行了。 */
  const MAX_ATTACHED_FILES = 5

  /**
   * 把选中的任意文件交给宿主暂存（`mobile.uploadAttachment`），成功后挂进待发列表。
   *
   * 为什么要走宿主：prompt 里文件附件的正式形态是 `{ type: 'file', receiptId }`，字节
   * 由宿主附件服务落盘、按会话暂存，手机端只在线上传一个 id。桌面那条 `/upload`
   * 直传通道走桌面鉴权，手机走不通，所以由插件在移动通道里代传。
   */
  /** 把一条待发附件交给宿主暂存，成功/失败各自改写这条 chip 的状态。 */
  const uploadStaged = useCallback((localId: string, file: File): void => {
    setUploadingFiles(previous => previous + 1)
    const controller = new AbortController()
    // 挂上取消句柄：chip 上的「取消」用它叫停（超时另有 120 秒兜底）。
    setAttachFiles(previous => previous.map(item => item.localId === localId
      ? { ...item, abort: controller }
      : item))
    void readAsDataURL(file).then(
      (dataUrl) => {
        // data URL → 纯 base64：宿主只收 base64，前缀它自己不需要。
        const comma = dataUrl.indexOf(',')
        const data = comma < 0 ? '' : dataUrl.slice(comma + 1)
        if (data === '') throw new Error('empty')
        if (controller.signal.aborted) throw new Error('cancelled')
        return uploadAttachment(session.sessionId, { name: file.name, data }, controller.signal)
      },
    ).then(
      (uploaded) => {
        setAttachFiles(previous => previous.map(item => item.localId === localId
          ? {
              ...item,
              status: 'ready',
              receiptId: uploaded.receiptId,
              name: uploaded.name === '' ? item.name : uploaded.name,
              bytes: uploaded.bytes ?? item.bytes,
            }
          : item))
      },
      () => {
        setAttachFiles(previous => previous.map(item => item.localId === localId ? { ...item, status: 'failed' } : item))
      },
    ).finally(() => {
      setUploadingFiles(previous => Math.max(0, previous - 1))
      // 句柄用完即弃：留着只会让 chip 记着一个已经结束的 controller。
      setAttachFiles(previous => previous.map(item => item.localId === localId
        ? { ...item, abort: undefined }
        : item))
    })
  }, [session.sessionId])

  const addFiles = useCallback((files: readonly File[]) => {
    if (files.length === 0) return
    const room = MAX_ATTACHED_FILES - attachFilesRef.current.length
    if (room <= 0) {
      toast(`最多附加 ${MAX_ATTACHED_FILES} 个文件`)
      return
    }
    const accepted = files.slice(0, room)
    if (files.length > room) toast(`最多附加 ${MAX_ATTACHED_FILES} 个文件`)
    for (const file of accepted) {
      if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
        toast(`${file.name} 超过 20 MB，已忽略`)
        continue
      }
      const localId = `staged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      // 先立 chip（上传中），再传字节：发送框必须立刻显示用户选了什么。
      setAttachFiles(previous => [...previous, {
        localId,
        name: file.name,
        bytes: file.size,
        status: 'uploading',
        file,
      }])
      uploadStaged(localId, file)
    }
  }, [uploadStaged])

  /** 失败的那条点一下就重传（原 File 还留着；编辑回填的收据条目没有原文件，重传无从谈起）。 */
  const retryStaged = useCallback((localId: string): void => {
    const target = attachFilesRef.current.find(item => item.localId === localId)
    if (target === undefined || target.status !== 'failed' || target.file === undefined) return
    setAttachFiles(previous => previous.map(item => item.localId === localId ? { ...item, status: 'uploading' } : item))
    uploadStaged(localId, target.file)
  }, [uploadStaged])

  /**
   * 打开图片 / 拍照用的选择框。
   *
   * 为什么不复用「文件」那一项：文件走的是菜单项里 label 直连的原生输入框，图片和拍照
   * 仍用程序化点击。每次现造一个新节点，属性在进 DOM 前设好，避免浏览器沿用上一次的
   * 选择器配置（真机上这个坑让「文件」一直弹相册）。这里只服务图片类型的两条路。
   */
  const openPicker = useCallback((mode: 'image' | 'camera'): void => {
    document.querySelectorAll<HTMLInputElement>('input.chat-picker-input').forEach(node => { node.remove() })
    pickerInputRef.current = null
    const input = document.createElement('input')
    input.type = 'file'
    input.className = 'chat-picker-input'
    input.multiple = mode !== 'camera'
    input.setAttribute('accept', 'image/*')
    if (mode === 'camera') input.setAttribute('capture', 'environment')
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])]
      for (const file of files) addImage(file)
      input.remove()
      if (pickerInputRef.current === input) pickerInputRef.current = null
    })
    input.addEventListener('cancel', () => {
      input.remove()
      if (pickerInputRef.current === input) pickerInputRef.current = null
    })
    pickerInputRef.current = input
    document.body.appendChild(input)
    const native = input as HTMLInputElement & { showPicker?: () => void }
    try {
      if (typeof native.showPicker === 'function') native.showPicker()
      else input.click()
    } catch {
      input.click()
    }
  }, [addImage])  /**
   * 认领一条命令：把命令词变成蓝色 chip，输入框只留参数。
   * @param name 命令名（菜单里那一项，不带斜杠）。
   * @param argument 已经在输入框里的参数文本（手动输入 `/goal x` 时把 x 留下）。
   */
  const claimCommand = useCallback((name: string, argument = ''): void => {
    if (name.trim() === '') return
    setClaimedCommand(name.trim())
    setInput(argument)
    // 手机上光标必须落在参数区，否则用户会以为还要再点一下输入框。
    requestAnimationFrame(() => { composerRef.current?.focus() })
  }, [])

  /**
   * 撤掉 chip = 取消这条命令：chip 和参数一起清掉，回到普通输入状态。
   *
   * 这里曾经把命令词拼回输入框（想"不丢用户敲的字"），结果点了 × 框里反而冒出一行
   * `/goal`，看着像没生效——参数本来就只对这条命令有意义，取消命令就该一起撤销。
   */
  const releaseCommand = useCallback((): void => {
    if (claimedCommand === undefined) return
    setClaimedCommand(undefined)
    setInput('')
    removeDraft(session.sessionId)
    requestAnimationFrame(() => { composerRef.current?.focus() })
  }, [claimedCommand, session.sessionId])

  /**
   * 目录晚到的补认领：用户先敲了 `/goal 目标`，命令目录那一刻还没拉回来，于是那一
   * 次 onChange 认领不了。目录一到位就把命令词收成 chip，参数留在输入框。
   */
  useEffect(() => {
    if (claimedCommand !== undefined || commands === undefined) return
    const typed = /^\/([A-Za-z][\w-]*)[ \u00a0]+([\s\S]*)$/.exec(input)
    if (typed === null) return
    if (commands.some(command => command.name === typed[1])) claimCommand(typed[1] ?? '', typed[2] ?? '')
  }, [commands, input, claimedCommand, claimCommand])

  /** Send the drafted prompt (the echoed user/message arrives over mux).
   * Offline: queue in IndexedDB instead — the reconnect effect drains it. */
  const send = useCallback(() => {
    const text = input.trim()
    if ((text === '' && attachImages.length === 0 && attachFiles.length === 0) || sending) return
    // 附件还在上传：这一刻发出去会少一个文件，用户却以为发全了。
    if (uploadingFiles > 0) {
      toast('附件还在上传，稍等一下')
      return
    }
    // 失败的那条挡发送：带着它发出去等于用户以为发全了、实际少一个文件。
    if (attachFiles.some(item => item.status === 'failed')) {
      toast('有附件上传失败，点一下那条重试或移除')
      return
    }
    // 点下发送这一刻回合是否在跑：**必须在发请求前定格**。宿主接单后立刻开出新回合，
    // turn/start 帧往往比这 promise 的 resolve 先到，回调里再读 running 就永远是 true
    // —— 明明没人跑，也会弹"已排队"。
    const queuedByRunning = runningRef.current
    // Offline: images can't queue (too big for the outbox), text can.
    if (offline) {
      if (text === '') {
        toast('离线状态暂不支持发送图片')
        return
      }
      if (text.startsWith('/')) {
        toast('离线状态暂不支持执行命令')
        return
      }
      if (attachImages.length > 0) {
        toast('图片需联网发送，本次仅保存文本')
      }
      const body = quoted !== undefined ? `引用消息：\n> ${quoted.replace(/\n+/g, ' ')}\n\n${text}` : text
      // 包一层 Promise.resolve：写 IndexedDB 在某些老 WebView 上会同步抛/返回非
      // promise，直接 `.then` 会把整个发送按钮打断。
      void Promise.resolve()
        .then(() => enqueuePrompt({ id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, sessionId: session.sessionId, text: body, queuedAt: Date.now() }))
        .then(() => {
          setInput('')
          removeDraft(session.sessionId)
          setQuoted(undefined)
          setAttachImages([])
          toast('已离线保存，恢复网络后自动发送')
          refreshOutbox()
        })
      return
    }
    // A bare slash-line is a command, not a prompt: run it through the host
    // registry (session.prompt would deliver it to the model verbatim).
    // Quotes and image attachments compose a prompt, so they keep prompt
    // semantics even when the text starts with '/'.
    // 认领的命令（蓝色 chip）在发送这一刻拼回完整命令行：chip 只是展示，线上仍是
    // `/goal 目标内容` 这一行。
    const commandLine = claimedCommand === undefined
      ? (text.startsWith('/') ? text : undefined)
      : `/${claimedCommand}${text === '' ? '' : ` ${text}`}`
    if (commandLine !== undefined && quoted === undefined && attachImages.length === 0 && attachFiles.length === 0) {
      setSending(true)
      void runCommand(commandLine).then(
        () => {
          setSending(false)
          setInput('')
          setClaimedCommand(undefined)
          removeDraft(session.sessionId)
          // 命令不产生回合、也不进队列：`/goal …` 建完目标后必须立刻问一次，否则手机上的
          // 目标条要等到下一次轮询才出现（真机：宿主回 Goal created，条子没出来）。
          refreshGoal()
        },
        () => { setSending(false) },
      )
      return
    }
    setSending(true)
    // A quoted draft composes the citation banner INTO the text part and
    // still carries the attached images (buildPromptParts appends them).
    // 只有 ready 的附件有收据；失败的那条留在 chip 上等用户处理。
    const readyFiles = attachFiles.flatMap(item => item.status === 'ready' && item.receiptId !== undefined
      ? [{ receiptId: item.receiptId }]
      : [])
    const body: PromptPart[] = quoted !== undefined && text !== ''
      ? buildPromptParts(`引用消息：\n> ${quoted.replace(/\n+/g, ' ')}\n\n${text}`, attachImages, readyFiles)
      : buildPromptParts(input, attachImages, readyFiles)
    // 回合进行中发的消息会成为"排队"：先本地画一条（状态仓的乐观项），不等宿主快照。
    // 以前这里只有一次 `refreshInbox({fresh:true})`，宿主要现开一帧 follow 再回包，
    // 弱网下就是"点了发送，排队条半天不出来"。
    const queueText = body.find(part => part.type === 'text')?.text ?? ''
    const optimisticId = queuedByRunning && queueText !== ''
      ? addOptimisticQueueItem(session.sessionId, { text: queueText, placement: 'queued' })
      : undefined
    void prompt(session.sessionId, body).then(
      () => {
        setSending(false)
        setInput('')
        removeDraft(session.sessionId)
        setAttachImages([])
        setAttachFiles([])
        setQuoted(undefined)
        // 回合进行中发出去的消息是**排队**（session.prompt 的 mode=queue），本轮结束后
        // 宿主自己接着发：不告诉用户，他会以为消息丢了。判据用发请求前的那一刻。
        if (queuedByRunning) {
      toast('已排队，本轮结束后自动发送')
      // 队列只活在宿主内存里：宿主一重启，这条就无声消失。本地留一份原文，
      // 等排队卡片对不上号时再交还给用户（见下面的对账 effect）。
      // 底稿必须和宿主 inbox 里那行逐字一致（引用消息是拼进去的），
      // 否则对账时会被误判成丢失。
      const queuedEchoText = body.find(part => part.type === 'text')?.text ?? ''
      if (queuedEchoText !== '') {
        rememberQueuedEcho({ sessionId: session.sessionId, text: queuedEchoText, at: Date.now() })
      }
    }
        // 排队卡片立刻跟上，不用等轮询。
        //
        // 这里**不能**把乐观项撤掉：宿主回执只说明「收下了」，而它读的队列投影
        // 可能是几分钟前的快照 —— 撤早了界面上就是一片空白（真机：点了发送，
        // 排队条不出现）。乐观项交给 session-store 按「文本对上真条目 / 45 秒超时」退场。
        // 刚发出去当然算「有输出」：把活动时间推到现在。
        // 否则状态条会拿上一轮的旧行时间戳当证据，闪一下「已 N 秒没有新输出」。
        shadowEvent({
          type: 'turn',
          at: Date.now(),
          source: 'local',
          running: true,
          lastActivityAt: Date.now(),
        })
        refreshInbox({ fresh: true })
        // `/goal …` 这类命令不产生回合，running 不会变，光等轮询的话新建的目标要等
        // 十几秒才冒出条子（真机：目标建好了、条子没出现）。发完就问一次。
        refreshGoal()
        // Fresh activity just started: drop the poll backoff so the mux
        // fallback picks the reply up immediately, not after the stall window.
        mux?.poke()
      },
      (reason: unknown) => {
        // The draft is deliberately NOT cleared on failure (only the success
        // path wipes it), so the user's text/images survive to be retried —
        // retry is just pressing send again. Surface the real reason (and the
        // stale-host hint when the host may still run an old allowlist) so a
        // failed send never looks silent.
        setSending(false)
        // 没送出去：本地那条乐观排队项必须撤掉，否则会留一张永远不会发出去的卡。
        if (optimisticId !== undefined) dropOptimisticQueueItem(session.sessionId, optimisticId)
        const message = errorText(reason)
        const hint = staleHostHint(message)
        setError(hint !== undefined ? `${message} ${hint}` : message)
        toast(hint !== undefined ? '发送失败，请重启 dsh web 后再试' : `发送失败：${message}`)
      },
    )
  }, [input, attachImages, attachFiles, uploadingFiles, sending, session.sessionId, mux, quoted, runCommand, refreshInbox, refreshGoal, claimedCommand])

  /* ── voice input ───────────────────────────────────────────────────── */

  const voicePartialRef = useRef('')
  /** 实时字幕机与它的取样定时器（录音中才存在）。 */
  const voiceCaptionsRef = useRef<LiveCaptions | undefined>(undefined)
  const voiceCaptionTimerRef = useRef<number | undefined>(undefined)
  /** 收掉实时字幕：停掉取样定时器，并丢弃在飞的结果。 */
  const stopCaptions = useCallback((): void => {
    voiceCaptionsRef.current?.stop()
    voiceCaptionsRef.current = undefined
    if (voiceCaptionTimerRef.current !== undefined) {
      window.clearInterval(voiceCaptionTimerRef.current)
      voiceCaptionTimerRef.current = undefined
    }
  }, [])

  // Release the mic when the chat unmounts (session switch / back): a pending
  // getUserMedia authorization or a live recorder must never leak the
  // MediaStream (the browser's recording indicator would stay on). The
  // mountedRef guard also stops the async openVoice callback from setting
  // state on an unmounted component.
  useEffect(() => () => {
    mountedRef.current = false
    stopCaptions()
    voiceRef.current?.cancel()
    voiceRef.current = undefined
  }, [stopCaptions])

  // 录音面板上的秒表：只在真的在录的时候走，转写中停住。
  useEffect(() => {
    if (!voiceOpen || voicePhase !== 'recording') return
    const started = Date.now()
    const timer = window.setInterval(() => {
      setVoiceElapsed(Math.min(60, Math.floor((Date.now() - started) / 1000)))
    }, 1000)
    return () => { window.clearInterval(timer) }
  }, [voiceOpen, voicePhase])

  /** Discard the current recording and close the sheet. */
  /**
   * 面板的焦点管理：打开时记住是谁打开的（语音按钮），关上还给它。
   * 不做这件事的话，面板一关焦点落回 body，接着按空格会滚动页面而不是再按一次语音。
   */
  useEffect(() => {
    if (!voiceOpen) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    voiceReturnFocusRef.current = previous
    voiceDoneRef.current?.focus()
    return () => {
      const target = voiceReturnFocusRef.current
      voiceReturnFocusRef.current = null
      if (target !== null && target.isConnected) target.focus()
    }
  }, [voiceOpen])

  const closeVoice = useCallback((): void => {
    // 换代号：正在跑的转写回来时对不上号，就不再往输入框里塞字。
    voiceRunRef.current += 1
    stopCaptions()
    voiceRef.current?.cancel()
    voiceRef.current = undefined
    setVoiceElapsed(0)
    voicePartialRef.current = ''
    setVoicePartial('')
    setVoiceOpen(false)
    setVoicePhase('recording')
  }, [])

  /** Finish recording → upload the WAV → transcribe → fill the composer. */
  const finishVoice = useCallback((): void => {
    const recorder = voiceRef.current
    if (recorder === undefined) {
      setVoiceOpen(false)
      return
    }
    voiceRef.current = undefined
    // 松手之后由最终转写说话，字幕立刻收掉（否则迟到的字幕会让面板闪一下）。
    stopCaptions()
    const run = voiceRunRef.current
    setVoicePhase('transcribing')
    setVoiceElapsed(0)
    void recorder.stop().then(
      (wavBase64) => {
        voicePartialRef.current = '转写中...'
        setVoicePartial('转写中...')
        void transcribeVoice(wavBase64, getVoiceServices()).then(
          (text) => {
            // 用户已经关掉面板（取消了这次录音）：结果直接丢弃。
            if (run !== voiceRunRef.current) return
            voicePartialRef.current = ''
            setVoicePartial('')
            setVoiceOpen(false)
            setVoicePhase('recording')
            if (text.trim() !== '') {
              setInput(previous => (previous.trim() === '' ? text.trim() : `${previous.replace(/\s+$/, '')} ${text.trim()}`))
            }
          },
          (reason: unknown) => {
            setVoiceOpen(false)
            setVoicePhase('recording')
            toast(reason instanceof Error ? reason.message : String(reason))
          },
        )
      },
      (message: unknown) => {
        setVoiceOpen(false)
        setVoicePhase('recording')
        toast(message instanceof Error ? message.message : String(message))
      },
    )
  }, [])

  /** Open the recording sheet and start capturing audio. */
  const openVoice = useCallback((): void => {
    voicePartialRef.current = ''
    voiceRunRef.current += 1
    setVoiceElapsed(0)
    setVoicePhase('recording')
    void startVoiceRecording({
      // The 60 s hard cap is reached: auto-finish so the sheet transcribes
      // what was captured instead of sitting on "正在听..." forever.
      onTimeout: () => { finishVoice() },
      // 波形跟着真实响度起伏：麦克风被静音、戴耳机、被别的应用抢占时，用户能自己看出来。
      onLevel: (level) => { voiceWaveRef.current?.style.setProperty('--voice-level', String(level)) },
    }).then(
      (recorder) => {
        // The chat unmounted while the mic was still authorizing: release
        // the stream instead of opening a sheet on a dead component.
        if (!mountedRef.current) {
          recorder.cancel()
          return
        }
        voiceRef.current = recorder
        setVoiceOpen(true)
        // 实时字幕：边录边把已录到的音频送去转写。宿主没有流式 ASR，这里是
        // 「滚动整段重转」——节流与并发由 live-captions 把关，失败静默。
        const captions = createLiveCaptions({
          transcribe: (audio) => transcribeVoice(audio, getVoiceServices()),
          onText: (text) => {
            voicePartialRef.current = text
            setVoicePartial(text)
          },
        })
        voiceCaptionsRef.current = captions
        // 每 700ms 看一次：真正发不发由字幕机按 2s 节奏与在飞状态决定。
        voiceCaptionTimerRef.current = window.setInterval(() => {
          // 传函数而不是值：被节流挡下的那一半就不用编码整段 WAV。
        captions.offer(() => voiceRef.current?.snapshot())
        }, 700)
      },
      (message: unknown) => {
        if (mountedRef.current) toast(message instanceof Error ? message.message : String(message))
      },
    )
  }, [finishVoice])

  /**
   * Stop the active turn (desktop parity: the composer's primary button
   * becomes a stop button while running). The turn/end frame arriving over
   * mux flips the button back; a failed request surfaces through the chat
   * error line.
   */
  const stopTurn = useCallback(() => {
    if (stopping) return
    setStopping(true)
    void cancelSession(session.sessionId).then(
      () => { setStopping(false) },
      (reason: unknown) => {
        setStopping(false)
        setError(errorText(reason))
      },
    )
  }, [stopping, session.sessionId])

  const modelLabel = currentModel?.model ?? '模型'
  const permissionLabel = permissions === undefined
    ? undefined
    : permissions.options.find(option => option.value === permissions.currentValue)?.name
      ?? displayName(permissions.currentValue)

  // Context usage chip: the host's context-pressure projection (token-meter)
  // is the authoritative per-session occupancy source — it is computed for
  // every session and pushed live, so the chip stays resident. `undefined`
  // (no projection yet, or a provider that never reports either side) renders
  // as "上下文 --".
  const contextUsage = useMemo(() => {
    const window = contextPressure?.contextWindow
    const pressure = contextPressure?.pressureTokens
    if (window === undefined || window <= 0 || pressure === undefined || pressure < 0) return undefined
    const pct = Math.min(100, Math.max(0, Math.round(pressure / window * 100)))
    return { pct, window, pressure }
  }, [contextPressure])

  /* ── in-place quick picker (model / permission) ──────────────────────
     Opens the horizontal option strip below the toolbar; the full bottom
     sheet stays reachable through the trailing "全部…" card. */
  const loadModelCatalog = useCallback(() => {
    setModelCatalog(previous => previous.status === 'ready' ? previous : { status: 'loading' })
    void models(session.sessionId).then(
      (data) => { setModelCatalog({ status: 'ready', data }) },
      (reason: unknown) => { setModelCatalog({ status: 'error', message: errorText(reason) }) },
    )
  }, [session.sessionId])

  const openModelPicker = (): void => {
    setContextOpen(false)
    setPicker('model')
    if (modelCatalog.status === 'idle') loadModelCatalog()
  }

  const openPermissionPicker = (): void => {
    setContextOpen(false)
    setPicker('permission')
  }

  /** 拉一次会话投影（权限档位在这里面）。
   *
   *  尾页快速通道带不回权限：那组投影来自宿主的会话枚举，冷启动/深链进来时
   *  枚举还没跑过，手机就没有基线，权限按钮整块不渲染——用户看到的就是"权限
   *  面板消失了"。按钮现在总是显示，缺数据时点它就地补一次。 */
  const requestPermissionsOnce = useCallback((): void => {
    if (permissionPullRef.current) return
    permissionPullRef.current = true
    void readChat(session.sessionId).then(
      (page) => {
        permissionPullRef.current = false
        const values = page.projections?.values as Record<string, unknown> | undefined
        if (values !== undefined) {
          setPermissions(parsePermissionSelect(values['permissions']))
          setContextPressure(parseContextPressure(values['contextPressure']))
          setTurnOutlineRaw(values['turnOutline'])
        }
        // 数据一到就打开选择器：用户点的是"看看能不能改"，不是"刷新一下"。
        setContextOpen(false)
        setPicker('permission')
      },
      (reason: unknown) => {
        permissionPullRef.current = false
        setError(errorText(reason))
      },
    )
  }, [session.sessionId])

  /** Toggle the context-usage popover on the ring. */
  const toggleContextPop = (): void => {
    if (contextUsage === undefined) return
    setPicker(null)
    setContextOpen(previous => !previous)
  }

  /** One-shot model switch from the strip; the chip label follows the result. */
  const applyModel = useCallback((selection: { provider: string; model: string; reasoningEffort?: string }): void => {
    if (pickerBusy) return
    setPickerBusy(true)
    void selectModel(session.sessionId, selection).then(
      (result) => {
        setPickerBusy(false)
        setCurrentModel(result.selected)
        setPicker(null)
      },
      (reason: unknown) => {
        setPickerBusy(false)
        setError(errorText(reason))
      },
    )
  }, [pickerBusy, session.sessionId])

  /** One-shot permission switch. Full access never applies directly: the
   *  popover and the old permission sheet used to disagree here — one asked
   *  first, the other switched silently. Both now funnel through the same
   *  confirmation sheet. */
  /** 权限档位以宿主为准。
   *
   *  手机上点完档位会先写一个乐观值（立刻反馈），但宿主可能对档位做归一化、也可能
   *  这次切换根本没落盘；投影帧是"变了才推"，一旦那帧丢了，药丸就会停在手机自己
   *  编的档位上，用户下次点开选择器看到"选了却没生效"。所以动作成功后再问一次投影，
   *  让宿主的答案覆盖乐观值。
   */
  const syncPermissionsFromHost = useCallback((): void => {
    void readChat(session.sessionId).then(
      (page) => {
        const values = page.projections?.values as Record<string, unknown> | undefined
        if (values?.['permissions'] !== undefined) setPermissions(parsePermissionSelect(values['permissions']))
      },
      () => undefined,
    )
  }, [session.sessionId])

  const applyPermission = useCallback((next: string): void => {
    if (next === permissions?.currentValue) {
      setPicker(null)
      return
    }
    if (next === 'danger-full-access') {
      setPicker(null)
      setPendingPermission(next)
      return
    }
    if (pickerBusy) return
    setPickerBusy(true)
    void sendCommand(session.sessionId, `/permission ${next}`).then(
      (outcome) => {
        setPickerBusy(false)
        if (!outcome.matched) {
          setError('权限命令未在宿主注册，无法切换')
          return
        }
        setPermissions(previous => previous === undefined ? previous : { ...previous, currentValue: next })
        setPicker(null)
        // 乐观值只是过渡，宿主说了算。
        syncPermissionsFromHost()
      },
      (reason: unknown) => {
        setPickerBusy(false)
        setError(errorText(reason))
      },
    )
  }, [pickerBusy, permissions, session.sessionId])

  // Timestamp de-dup: each minute bucket shows only its LAST row's clock
  // (computed over the full list so windowed slices stay consistent).
  const timeFlags = useMemo(
    () => timeVisibility(messages.map(message => message.time)),
    [messages],
  )
  // Quick-command context: the newest SETTLED assistant reply carries a code
  // fence — that's when the code follow-ups make sense to offer. Scanning
  // settled rows only also keeps this memo stable across stream frames (a
  // pending row's text changes every chunk, which would re-run the
  // includes() scan on the whole accumulated text per frame). 压缩上下文
  // is context-free and always offered.
  // 一次性现场探针：把"状态里有几行报告、DOM 里真的画出几个"一起报回去。
  // 卡片问题只有这个对照能定位（行在状态里、却没画出来 = 渲染丢行）。
  paintProbeRef.current = {
    liveTurn,
    running,
    anchored: turnStartAt !== null,
    rows: messages.length,
    tails: messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.kind === 'turn')
      .map(({ message, index }) => ({
        turn: message.turn ?? null,
        index,
        produced: message.produced?.length ?? 0,
        delivered: message.deliverables?.length ?? 0,
      })),
  }

  // Re-pin to the tail while the reader is at the bottom and the content
  // height settles. The opening scrollToBottom lands on an ESTIMATED height
  // in windowed mode (rows are measured after the first paint), and the
  // last-message key never changes when the measurement converges, so the
  // stream follower above would never re-fire. A reader who never scrolled
  // away follows the settled tail; one who scrolled up through history is
  // left alone (same gap guard).
  // A full render (non-windowed) is exact AT the moment it scrolls, but the
  // list keeps growing afterwards — the page lands after the cache seed, the
  // recovered report card is merged in, images resolve — and each append drops
  // the reader that far above the tail. 真机实测：进会话后距底 1135px，最新一轮
  // 的交付物卡片就在屏幕下方，看起来"卡片没了"。所以两种渲染模式都要补。
  // The re-pin defers to the next frame: the measurement just landed in
  // state, and the DOM height only reflects it after React commits —
  // reading it synchronously would pin to the PREVIOUS (estimated) height
  // and yank the view away from the real tail.
  /** 上一次补底时的尾行 key 与行数：分辨"列表真的长了"和"只是测量收敛"。 */
  const lastTailKeyRef = useRef<string | undefined>(undefined)
  const lastRowCountRef = useRef(0)
  useEffect(() => {
    if (locatingRef.current) return
    if (!scrollStateRef.current.followed) return
    if (!autoScroll) return
    // 判据是"读者自己滚走过没有"，不是间距快照：程序化滚动不开火 scroll 事件，
    // 进会话时间距快照还是"未知"（MAX），照它挡就一辈子不补。
    if (showJumpToLatest) return
    // 全量渲染（非窗口化）只在**列表真的长了**才补：进会话先画缓存、随后落页、
    // 再并回补出来的报告卡、图片再撑开 —— 每一次都会把"当时贴着底"的读者留在
    // 上方（真机实测距底 1135px，最新一轮卡片就在屏幕外）。缓存尾页和网络页常常
    // 结束在同一条消息上，末尾 key 不变，只是前面多出几行 —— 所以行数也算。
    const tail = messages[messages.length - 1]
    const tailKey = tail === undefined ? undefined : messageKey(tail)
    const appended = tailKey !== undefined && tailKey !== lastTailKeyRef.current
    const grew = messages.length > lastRowCountRef.current
    if (!appended && !grew) return
    // 补到底之后才记账：这一帧的 rAF 可能被下一次渲染清掉，提前记账会把该补的
    // 那次吃掉。行全渲染 ⇒ commit 后的这一刻 DOM 已经是最终高度，直接补。
    lastTailKeyRef.current = tailKey
    lastRowCountRef.current = messages.length
    pinToRealBottom()
  }, [messages, pinToRealBottom, autoScroll, showJumpToLatest])



  // 轮次真的开跑 ⇒ 按钮已经被收走，状态一并复位，下一次点击是干净的一次。
  useEffect(() => {
    if (!running) return
    if (regenerateWatchdogRef.current !== undefined) {
      clearTimeout(regenerateWatchdogRef.current)
      regenerateWatchdogRef.current = undefined
    }
    regenerateInFlightRef.current = false
    setRegenerateState('idle')
  }, [running])

  useEffect(() => () => {
    if (regenerateWatchdogRef.current !== undefined) clearTimeout(regenerateWatchdogRef.current)
  }, [])

  // Regenerate affordance: only the LAST settled assistant reply gets a
  // ↻ button (re-running an older reply would detach from current context).
  // `!running` gates it to the whole turn completing — a tool-interleaved
  // turn's intermediate segments settle (pending → false) before turn/end,
  // so without the gate the button would flash after every segment.
  /**
   * 主键的分态：桌面的规则是「草稿为空才把主键让给停止」。运行中仍有草稿时主键必须还是
   * "发送"（走排队通道），否则手机在回合进行中根本没有把消息排进队的入口；停止另给
   * 一个小键，运行期间常驻。
   */
  // 只有 chip、参数还没填也算有内容：命令本身就可能是完整的（/compact）。
  // 只挂了一个文件、没打字，也是"有内容可发"：不算空，否则发送键是灰的（真机上就是点了没反应）。
  const draftEmpty = input.trim() === '' && attachImages.length === 0 && attachFiles.length === 0 && claimedCommand === undefined
  const primaryStops = running && draftEmpty

  const lastMessageId = messages[messages.length - 1]?.id
  const regenerateFor = (message: RenderMessage): (() => void) | undefined =>
    offersRegenerate({
      isLastMessage: message.id === lastMessageId,
      isAssistant: message.kind === 'assistant',
      pending: message.pending === true,
      turnLive,
    })
      ? () => handleRegenerate(message)
      : undefined

  return (
    <div className="chat">
      <header className="mobile-header">
        <div className="mobile-headerSlot">
          <button type="button" className="mobile-back" aria-label="返回" onClick={handleBack}>‹</button>
        </div>
        <div className="mobile-titleWrap">
          <h1 className="mobile-title mobile-titleInline">{title}</h1>
        </div>
        <div className="mobile-headerSlot mobile-headerSlot-right">
          <button
            type="button"
            className="mobile-iconbtn"
            aria-label="搜索本会话"
            onClick={() => {
              setChatSearchOpen(open => !open)
              setChatSearchTerm('')
            }}
          >
            <SearchIcon />
          </button>
          <button type="button" className="mobile-iconbtn" aria-label="更多" onClick={() => { setMoreOpen(true) }}>
            <MoreIcon />
          </button>
          <ThemeToggle />
        </div>
      </header>
      {chatSearchOpen && (
        <div className="chat-search" role="search">
          <input
            type="search"
            className="chat-search-input"
            placeholder="搜索本会话…"
            aria-label="搜索本会话"
            autoFocus
            value={chatSearchTerm}
            onChange={(event) => { setChatSearchTerm(event.target.value) }}
            onCompositionStart={() => { chatSearchComposingRef.current = true }}
            onCompositionEnd={(event) => {
              chatSearchComposingRef.current = false
              setChatSearchTerm(event.currentTarget.value)
              setChatSearchComposeTick(tick => tick + 1)
            }}
          />
          <span className="chat-search-count" role="status">
            {chatSearchBusy
              ? '搜索中…'
              : chatSearchWarming
                ? '索引建立中'
                : chatSearchHits.length === 0
                  ? '无命中'
                  : `${chatSearchAt + 1}/${chatSearchHits.length}${chatSearchHasMore ? '+' : ''}`}
          </span>
          {/* 命中在窗口外、正在翻那一页：计数旁边单独一句，别把数字挤掉。 */}
          {chatSearchJumping && !chatSearchBusy && chatSearchHits.length > 0 && (
            <span className="chat-search-hint">载入中…</span>
          )}
          <button
            type="button"
            className="mobile-iconbtn"
            aria-label="上一个"
            disabled={chatSearchHits.length === 0}
            onClick={() => { gotoChatHit(chatSearchHits, (chatSearchAt - 1 + chatSearchHits.length) % chatSearchHits.length) }}
          >
            <ChevronUpIcon />
          </button>
          <button
            type="button"
            className="mobile-iconbtn"
            aria-label="下一个"
            disabled={chatSearchHits.length === 0}
            onClick={() => { gotoChatHit(chatSearchHits, (chatSearchAt + 1) % chatSearchHits.length) }}
          >
            <ChevronDownIcon />
          </button>
          <button
            type="button"
            className="mobile-iconbtn"
            aria-label="关闭搜索"
            onClick={() => { setChatSearchOpen(false); setChatSearchTerm('') }}
          >
            <CloseIcon />
          </button>
        </div>
      )}
      {error !== undefined && <p className="mobile-error mobile-pad">{error}</p>}
      {(offline || queuedCount > 0) && (
        <div
          className="chat-offline-banner"
          role="status"
          style={{ flexDirection: 'column', alignItems: 'stretch', padding: '8px 16px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span>
              {offline
                ? '网络已断开，消息将在恢复后发送'
                : queuedCount > 0
                  ? `${queuedCount} 条离线消息待发送`
                  : ''}
            </span>
            {!offline && queuedCount > 0 && (
              <button type="button" className="chat-offline-retry" onClick={flushQueue}>重试</button>
            )}
          </div>
          {queuedEntries.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {queuedEntries.map(entry => (
                <li key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.text}</span>
                  <button
                    type="button"
                    className="chat-offline-retry"
                    aria-label="移除待发送消息"
                    onClick={() => { removeQueuedEntry(entry.id) }}
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div
        className="chat-scroll"
        ref={ref => { scrollRef.current = ref ?? undefined }}
        onScroll={handleScroll}
        onClick={handleScrollClick}
        onDoubleClick={(event) => {
          // Double-tap a code block to reset its pinch scale.
          const block = event.target instanceof Element ? event.target.closest('.code-block') : null
          if (block === null) return
          const pre = block.querySelector('pre')
          if (pre !== null) pre.style.transform = ''
        }}
        onContextMenu={(event) => {
          if (openCtxFromTarget(event.target, event.clientX, event.clientY)) {
            event.preventDefault()
            cancelLongPress()
          }
        }}
        onTouchStart={(event) => {
          // Two fingers on a code block = pinch zoom; single finger keeps the
          // long-press menu gesture.
          if (event.touches.length >= 2) {
            cancelLongPress()
            const target = event.target instanceof Element ? event.target : null
            const block = target?.closest<HTMLElement>('.code-block') ?? null
            if (block !== null) {
              const dist0 = pinchDistance(event.touches)
              if (dist0 > 0) {
                const current = block.querySelector('pre')?.style.transform ?? ''
                const scale0 = current === '' ? 1 : Number(/scale\(([\d.]+)\)/.exec(current)?.[1] ?? 1)
                pinchRef.current = { block, dist0, scale0 }
                return
              }
            }
            pinchRef.current = undefined
            return
          }
          pinchRef.current = undefined
          const touch = event.touches[0]
          if (touch === undefined) return
          const target = event.target instanceof Element ? event.target : null
          if (target === null || target.closest('.chat-msg') === null) return
          // 代码块/图片可选中或可长按：交给系统（文字选择 / 图片菜单），
          // 自定义菜单（编辑/复制/引用）接管消息正文长按。
          if (target.closest('.code-block pre, img') !== null) return
          const { clientX, clientY } = touch
          const timer = window.setTimeout(() => {
            longPressRef.current = undefined
            openCtxFromTarget(target, clientX, clientY)
          }, 500)
          longPressRef.current = { timer, x: clientX, y: clientY }
        }}
        onTouchMove={(event) => {
          if (pinchRef.current !== undefined && event.touches.length >= 2) {
            const dist = pinchDistance(event.touches)
            if (dist > 0) applyPinch(pinchRef.current.scale0 * dist / pinchRef.current.dist0)
            return
          }
          cancelLongPress()
        }}
        onTouchEnd={(event) => {
          if (pinchRef.current !== undefined && event.touches.length < 2) pinchRef.current = undefined
          cancelLongPress()
        }}
        onTouchCancel={(event) => {
          if (pinchRef.current !== undefined && event.touches.length < 2) pinchRef.current = undefined
          cancelLongPress()
        }}
      >
        {hasOlder && (
          <button type="button" className="chat-load-older" disabled={loading} onClick={() => { void loadOlder() }}>
            {loading ? '加载中…' : '加载更早的消息'}
          </button>
        )}
        {messages.map((message, index) => {
          // 行全渲染：不可见行交给 content-visibility（浏览器自己记住布局过的
          // 真实高度，不是我们估的数）。尾部 CONTENT_VISIBILITY_KEEP_BOTTOM 行
          // 保持真实布局，贴底时 el.scrollHeight 才是精确值。
          // 跑着的那一轮不画报告卡（turn/end 之后才出）。
          if (message.kind === 'turn' && liveTurn !== undefined && message.turn === liveTurn) return null
          const cv = index < messages.length - CONTENT_VISIBILITY_KEEP_BOTTOM
            ? { contentVisibility: 'auto' as const, containIntrinsicSize: `auto ${estimateMessageHeight(message)}px` }
            : undefined
          return (
              <MessageRow
                key={messageKey(message)}
                message={rowOfInterrupted(message)}
                sessionId={session.sessionId}
                showToolCalls={showToolCalls}
                showSystemMessages={showSystemMessages}
                clockOffsetMs={hostClockOffsetRef.current}
                liveTurnStartAt={clockAnchor ?? undefined}
                liveTurn={liveTurn}
      settled={settledOf(message)}
      liveClockTick={isRowRunning(rowOfInterrupted(message), liveTurn, settledOf(message)) ? liveClockTick : undefined}
                showTime={timeFlags[index] === true}
                focused={message.id === focusMsgId}
                focusedQuery={message.id === focusMsgId && chatHitQuery !== '' ? chatHitQuery : effectiveFocusQuery}
          focusExpand={message.id === focusMsgId && chatHitQuery !== ''}
                style={cv}
                onOpenFile={(path) => { setPreviewPath(path) }}
                onRegenerate={regenerateFor(message)}
                regenerateState={regenerateState}
              />
            )
          })}
        {loading && messages.length === 0 && <p className="chat-typing">加载中…</p>}
        {!loading && messages.length === 0 && <p className="chat-typing">还没有消息，发一句话开始吧</p>}
        {running && (
          <div className="chat-turn-status" role="status" aria-label={hostLost ? '连接中断' : '输出中'}>
            {hostLost ? '连接中断' : '输出中'}<span className="chat-turn-dots" aria-hidden><span /><span /><span /></span>
          </div>
        )}
        {pendingApprovals.map(approval => (
          <ApprovalPanel
            key={approval.approvalId}
            approval={approval}
            preview={approvalPreviewOf(approval)}
            sessionId={session.sessionId}
            onResolved={(id) => {
              noteAnsweredApproval(session.sessionId, id)
              setPendingApprovals(prev => prev.filter(a => a.approvalId !== id))
            }}
          />
        ))}
        {pendingQuestions.length > 0 && (
          <QuestionPanel
            questions={pendingQuestions}
            sessionId={session.sessionId}
            onResolved={(rpcId) => {
              noteAnsweredQuestion(session.sessionId, rpcId)
              setPendingQuestions(prev => prev.filter(q => q.rpcId !== rpcId))
            }}
          />
        )}
        {showJumpToLatest && turnEntries.length >= 2 && (
          <button
            type="button"
            className={'chat-jump-turns' + (scrubIndex !== undefined ? ' chat-jump-turns-live' : '')}
            aria-label="轮次导航：轻点开清单，按住拖动刮擦"
            onPointerDown={startScrub}
            onPointerMove={moveScrub}
            onPointerUp={endScrub}
            onPointerCancel={cancelScrub}
            onLostPointerCapture={cancelScrub}
            onClick={(event) => { if (event.detail === 0) setTurnListOpen(true) }}
          >
            <span className="chat-jump-turns-label">{shownTurn}/{maxTurn}</span>
          </button>
        )}
        {showJumpToLatest && (
          <button
            type="button"
            className={'chat-jump-latest' + (unreadCount > 0 ? ' chat-jump-latest-hot' : '')}
            aria-label="回到最新消息"
            onClick={jumpToLatest}
          >
            <ChevronDownIcon width={20} height={20} />
            {unreadCount > 0 && <span className="chat-jump-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </button>
        )}
      </div>
      {/* 排队/目标/状态已经统一收进下面的 SessionHud。 */}
      {/*
       * 会话 HUD：顶部这一组状态条的唯一渲染点。
       *
       * 顺序固定为「为什么在跑（目标）→ 接下来要发什么（排队）→ 跑到哪了（任务）」——
       * 以前这三条按各自插入位置排，谁先渲染谁在上；现在只有这里决定顺序和是否出现。
       * 容器是 `display: contents`，纯结构、不产生新的布局盒（外观与之前一致）。
       */}
      <SessionHud
        goal={<GoalBar goal={bars.goalBar !== undefined ? goal : undefined} busy={goalBusy} onCommand={handleGoalCommand} {...(goalMeta === undefined ? {} : { meta: goalMeta })} />}
        queue={bars.queueBar > 0 ? (
          <QueueDock
            items={queueItems}
            running={running}
            onEdit={handleQueueEdit}
            onRemove={handleQueueRemove}
            onSteer={handleQueueSteer}
          />
        ) : undefined}
        status={(finishedElsewhere === undefined && bars.statusBar === undefined) ? undefined : (
          <>
            {finishedElsewhere !== undefined && (
              <FinishedElsewhereBar
                title={finishedElsewhere.title}
                status={finishedElsewhere.status}
                durationMs={finishedElsewhere.durationMs}
                onOpen={() => { onOpenFinished?.(finishedElsewhere.sessionId) }}
                onDismiss={() => { onDismissFinished?.() }}
              />
            )}
            {bars.statusBar === undefined ? null : (
          <RunStatusBar
            todo={todo}
            jobs={jobs}
            subagents={subagents}
            text={bars.statusBar}
            live={running}
            onOpen={() => { setRunStatusOpen(true) }}
          />
            )}
          </>
        )}
      />
      {scrubIndex !== undefined && maxTurn >= 2 && (
        <TurnScrubber entries={turnEntries} index={scrubIndex} total={maxTurn} />
      )}

      <div className="chat-tools">
        <div className="chat-tools-actions">
          <button
            type="button"
            className="chat-pill"
            onClick={openModelPicker}
            aria-haspopup="listbox"
            aria-label={currentModel === undefined ? '切换模型' : `切换模型：${compactModelName(currentModel.model)}`}
            title={currentModel === undefined ? undefined : `${currentModel.provider}/${currentModel.model}`}
          >
            <ModelIcon width={16} height={16} />
            <span className="chat-pill-name">{currentModel === undefined ? '模型' : compactModelName(currentModel.model)}</span>
            <span className="chat-pill-chevron" aria-hidden>▾</span>
          </button>
          <button
            type="button"
            className={'chat-pill chat-pill-perm chat-pill-perm-' + (permissions === undefined ? 'read' : permissionTone(permissions.currentValue) ?? 'read')}
            onClick={permissions === undefined ? requestPermissionsOnce : openPermissionPicker}
            aria-haspopup="listbox"
            aria-label={permissions === undefined ? '切换权限：读取中' : `切换权限：${permissionLabel}`}
            title={permissions === undefined ? '读取权限档位' : permissionLabel}
          >
            <ShieldIcon width={16} height={16} />
            <span className="chat-pill-name">{permissions === undefined ? '权限' : permissionShortLabel(permissions.currentValue)}</span>
          </button>
        </div>
        <div
          className={"chat-context" + (contextUsage !== undefined && contextUsage.pct >= 80 ? " chat-context-warn" : "")}
          role="status"
          onClick={toggleContextPop}
          aria-expanded={contextOpen}
        >
          {contextUsage === undefined ? (
            <>上下文 --</>
          ) : (
            <>
              <svg className="chat-context-ring" width="26" height="26" viewBox="0 0 26 26" aria-hidden>
                <circle className="chat-context-ring-track" cx="13" cy="13" r="10.5" fill="none" strokeWidth="3.5" />
                <circle
                  className="chat-context-ring-fill"
                  cx="13" cy="13" r="10.5" fill="none" strokeWidth="3.5"
                  strokeDasharray={`${contextUsage.pct / 100 * 65.97} 65.97`}
                  transform="rotate(-90 13 13)"
                />
              </svg>
              <span
                title={`${fmtTokens(contextUsage.pressure)}/${fmtTokens(contextUsage.window)}`}
              >{contextUsage.pct}%</span>
            </>
          )}
        </div>
        {contextOpen && contextUsage !== undefined && (
          <div className="chat-context-pop" role="tooltip">
            <div className="chat-context-pop-title">上下文用量</div>
            <div className="chat-context-pop-figures">
              {fmtTokens(contextUsage.pressure)}<span>/</span>{fmtTokens(contextUsage.window)}
            </div>
            <div className="chat-context-pop-sub">已使用 {contextUsage.pct}%</div>
          </div>
        )}
      </div>
      {contextOpen && <div className="chat-context-pop-scrim" onClick={() => { setContextOpen(false) }} />}
      {picker !== null && <div className="chat-picker-scrim" onClick={() => { setPicker(null) }} />}
      {picker === 'model' && (
        <div className="chat-picker-panel" role="menu" aria-label="选择模型">
          {modelCatalog.status === 'loading' && <span className="chat-picker-status">正在加载模型目录…</span>}
          {modelCatalog.status === 'error' && (
            <>
              <span className="chat-picker-status chat-picker-error">{modelCatalog.message}</span>
              {staleHostHint(modelCatalog.message) !== undefined && (
                <span className="chat-picker-status chat-picker-hint">{staleHostHint(modelCatalog.message)}</span>
              )}
              <button type="button" className="chat-picker-more" onClick={loadModelCatalog}>重试</button>
            </>
          )}
          {modelCatalog.status === 'ready' && (
            <>
              {(() => {
                const current = currentModel ?? modelCatalog.data.current
                // 同名模型（两个 provider 各有一个 V4.1-Flash）在列表里长得一模一样，
                // 只能靠猜；重名时才补 provider 名，没重名的保持干净。
                const nameCounts = new Map<string, number>()
                for (const group of modelCatalog.data.groups) {
                  for (const model of group.models) nameCounts.set(model.name, (nameCounts.get(model.name) ?? 0) + 1)
                }
                const modelRow = (group: { id: string; name: string }, model: SessionModels['groups'][number]['models'][number]): ReactNode => {
                  const isSelected = current !== undefined && current.provider === group.id && current.model === model.id
                  const shownName = (nameCounts.get(model.name) ?? 0) > 1 ? `${model.name} · ${group.name}` : model.name
                  return (
                    <button
                      type="button"
                      key={`${group.id}:${model.id}`}
                      className={'chat-picker-row' + (isSelected ? ' chat-picker-row-selected' : '')}
                      disabled={pickerBusy}
                      onClick={() => {
                        applyModel({
                          provider: group.id,
                          model: model.id,
                          ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
                        })
                      }}
                    >
                      <span className="chat-picker-row-check" aria-hidden>
                        {isSelected ? <CheckIcon width={14} height={14} /> : null}
                      </span>
                      <span className="chat-picker-row-copy">
                        <span className="chat-picker-row-title">{shownName}</span>
                      </span>
                    </button>
                  )
                }
                // 宿主报的当前模型可能不在目录里（实测 chip 是 v4.1-flash:1017，目录里
                // 只有深索 V4.1-Flash / V4-Pro），那种情况下整张表没有一项打勾，用户
                // 看不出自己在用什么。补一个"当前"分组把在用的那项摆出来。
                const inCatalog = current !== undefined && modelCatalog.data.groups.some(
                  group => group.id === current.provider && group.models.some(model => model.id === current.model),
                )
                const currentGroup = current !== undefined && !inCatalog
                  ? (
                      <div className="chat-picker-group" key="__current">
                        <div className="chat-picker-group-title">当前</div>
                        <button type="button" className="chat-picker-row chat-picker-row-selected" disabled={pickerBusy} onClick={() => {}}>
                          <span className="chat-picker-row-check" aria-hidden><CheckIcon width={14} height={14} /></span>
                          <span className="chat-picker-row-copy">
                            <span className="chat-picker-row-title">{current.model}</span>
                            <span className="chat-picker-row-sub">{current.provider}</span>
                          </span>
                        </button>
                      </div>
                    )
                  : null
                return (
                  <>
                    {currentGroup}
                    {modelCatalog.data.groups.map(group => (
                      <div className="chat-picker-group" key={group.id}>
                        <div className="chat-picker-group-title">{group.name}</div>
                        {group.models.map(model => modelRow(group, model))}
                      </div>
                    ))}
                  </>
                )
              })()}
              {(() => {
                // Thinking-effort choices for the currently selected model.
                // Derived by the shared helper so this popover and any other
                // surface can never disagree on which effort is in force.
                const selected = currentModel ?? modelCatalog.data.current
                const { choices: effortChoices, effective: effectiveEffort } = buildEffortChoices(modelCatalog.data, selected)
                if (effortChoices.length === 0) return null
                return (
                  <div className="chat-picker-group">
                    <div className="chat-picker-group-title">思考强度</div>
                    {effortChoices.map(choice => {
                      const isSelected = effectiveEffort === choice.effort
                      return (
                        <button
                          type="button"
                          key={choice.key}
                          className={'chat-picker-row' + (isSelected ? ' chat-picker-row-selected' : '')}
                          disabled={pickerBusy}
                          onClick={() => {
                            applyModel({
                              provider: selected.provider,
                              model: selected.model,
                              ...(choice.effort !== undefined ? { reasoningEffort: choice.effort } : {}),
                            })
                          }}
                        >
                          <span className="chat-picker-row-check" aria-hidden>
                            {isSelected ? <CheckIcon width={14} height={14} /> : null}
                          </span>
                          <span className="chat-picker-row-copy">
                            <span className="chat-picker-row-title">{choice.label}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
            </>
          )}
        </div>
      )}
      {picker === 'permission' && permissions !== undefined && (
        <div className="chat-picker-panel" role="menu" aria-label="选择权限">
          {permissions.options.map(option => {
            const isSelected = option.value === permissions.currentValue
            return (
              <button
                type="button"
                key={option.value}
                className={'chat-picker-row'
                  + (isSelected ? ' chat-picker-row-selected' : '')
                  + (option.value === 'danger-full-access' ? ' chat-picker-row-danger' : '')}
                disabled={pickerBusy}
                onClick={() => { applyPermission(option.value) }}
              >
                <span className="chat-picker-row-check" aria-hidden>
                  {isSelected ? <CheckIcon width={14} height={14} /> : null}
                </span>
                <span className="chat-picker-row-copy">
                  <span className="chat-picker-row-title">{option.name}</span>
                  {option.description !== undefined && <span className="chat-picker-row-sub">{option.description}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {runStatusOpen && (
        <RunStatusSheet
          todo={todo}
          jobs={jobs}
          subagents={subagents}
          onClose={() => { setRunStatusOpen(false) }}
        />
      )}
      <div className="chat-composer">
        {quoted !== undefined && (
          <div className="chat-quote-bar" role="note" aria-label="引用消息">
            <span className="chat-quote-text">{quoted.slice(0, 20)}{quoted.length > 20 ? '…' : ''}</span>
            <button type="button" className="chat-quote-close" aria-label="取消引用" onClick={() => { setQuoted(undefined) }}>
              <CloseIcon width={14} height={14} />
            </button>
          </div>
        )}
        {attachImages.length > 0 && (
          <div className="chat-attach-bar" role="list" aria-label="待发送图片">
            {attachImages.map((image, index) => (
              <div key={index} className="chat-attach-item" role="listitem">
                <img className="chat-attach-img" src={image.dataUrl} alt="待发送图片" />
                <button
                  type="button"
                  className="chat-attach-remove"
                  aria-label="移除图片"
                  onClick={() => { setAttachImages(previous => previous.filter((_, i) => i !== index)) }}
                >×</button>
              </div>
            ))}
          </div>
        )}
        {attachFiles.length > 0 && (
          <div className="chat-file-bar" role="list" aria-label="待发送附件">
            {attachFiles.map((file, index) => (
              <div key={file.localId} className={`chat-file-item is-${file.status}`} role="listitem">
                <svg className="chat-file-glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                  <path d="M9 1.5 H4.5 A1.5 1.5 0 0 0 3 3 V13 A1.5 1.5 0 0 0 4.5 14.5 H11.5 A1.5 1.5 0 0 0 13 13 V5.5 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  <path d="M9 1.5 V5.5 H13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
                <span className="chat-file-name">{file.name}</span>
                {file.status === 'ready' && file.bytes !== undefined && (
                  <span className="chat-file-size">{formatFileSize(file.bytes)}</span>
                )}
                {file.status === 'uploading' && (
                  <>
                    <span className="chat-file-status">上传中…</span>
                    <button
                      type="button"
                      className="chat-file-cancel"
                      aria-label={`取消上传 ${file.name}`}
                      onClick={() => {
                        file.abort?.abort()
                        setAttachFiles(previous => previous.filter(item => item.localId !== file.localId))
                      }}
                    >取消</button>
                  </>
                )}
                {file.status === 'failed' && (
                  <button
                    type="button"
                    className="chat-file-retry"
                    aria-label={`重新上传 ${file.name}`}
                    onClick={() => { retryStaged(file.localId) }}
                  >上传失败，点按重试</button>
                )}
                <button
                  type="button"
                  className="chat-file-remove"
                  aria-label={`移除附件 ${file.name}`}
                  onClick={() => { setAttachFiles(previous => previous.filter((_, i) => i !== index)) }}
                >×</button>
              </div>
            ))}
          </div>
        )}
        <div className="chat-inputbar">
          <button
            type="button"
            className="chat-attach-btn"
            aria-label="添加内容"
            aria-haspopup="dialog"
            onClick={() => { setPlusOpen(true) }}
          >
            <PlusIcon width={20} height={20} />
          </button>
          <button
            type="button"
            className="chat-attach-btn"
            aria-label="斜杠命令"
            aria-haspopup="dialog"
            onClick={() => { setCommandOpen(true) }}
          >
            <span className="chat-slash-glyph" aria-hidden="true">/</span>
          </button>
          {voiceSupported() && (
            <button
              type="button"
              className="chat-attach-btn"
              aria-label="语音输入"
              onClick={openVoice}
            >
              <MicIcon width={20} height={20} />
            </button>
          )}
          {/* 命令 chip 摆在输入框**里面**（边框和背景挪到 .chat-field 上）：与输入框
              同一条中心线垂直居中，输入框被挤窄/长高都跟着走，不会像并排摆时那样把
              框压扁，也不会像单独一行那样把输入区顶起来。 */}
          <div className="chat-field">
          {claimedCommand !== undefined && (
            <span className="chat-command-chip" role="note" aria-label="待发送命令">
              <span className="chat-command-chipText">/{claimedCommand}</span>
              <button
                type="button"
                className="chat-command-chipClose"
                aria-label="取消命令"
                onClick={releaseCommand}
              >
                <CloseIcon width={12} height={12} />
              </button>
            </span>
          )}
          <textarea
            ref={composerRef}
            className="chat-input"
            rows={1}
            value={input}
            placeholder={claimedCommand === undefined ? '说点什么...' : '输入命令参数，回车执行'}
            enterKeyHint={mobileEnterToSend ? 'send' : 'enter'}
            onChange={(event) => {
              const value = event.target.value
              // 手动敲 `/命令名 ` 也算认领：桌面端同样把命令词收成 chip，参数留在后面。
              const typed = claimedCommand === undefined
                ? /^\/([A-Za-z][\w-]*)[ \u00a0]+([\s\S]*)$/.exec(value)
                : null
              if (typed !== null && commands?.some(command => command.name === typed[1]) === true) {
                claimCommand(typed[1] ?? '', typed[2] ?? '')
                return
              }
              setInput(value)
            }}
            onFocus={() => { setComposerFocused(true) }}
            onBlur={() => { setComposerFocused(false) }}
            onPaste={(event) => {
              const files = imageFromClipboard(event.clipboardData)
              if (files.length > 0) {
                event.preventDefault()
                for (const file of files) addImage(file)
              }
            }}
            onKeyDown={(event) => {
              // isComposing: skip Enter while a Chinese IME is composing, so
              // confirming a candidate never fires a send mid-composition.
              if (mobileEnterToSend && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send()
              }
            }}
          />
          </div>
          {running && !primaryStops && (
            <button
              type="button"
              className={stopArmed ? 'chat-stop-mini chat-stop-mini-armed' : 'chat-stop-mini'}
              aria-label={stopping ? '停止中' : stopArmed ? '确认停止' : '停止'}
              disabled={stopping}
              onClick={() => {
                if (!stopArmed) {
                  // 第一拍只是「举枪」：2.5 秒没人再点就收回，什么都不会发生。
                  setStopArmed(true)
                  window.setTimeout(() => { setStopArmed(false) }, 2_500)
                  return
                }
                setStopArmed(false)
                void stopTurn()
              }}
            >
              {stopArmed ? (
                <span className="chat-stop-mini-text">确认</span>
              ) : (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                  <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
                </svg>
              )}
            </button>
          )}
          <button
            type="button"
            className={primaryStops
              ? 'chat-send chat-send-stop'
              : running ? 'chat-send chat-send-queued' : 'chat-send'}
            {...(primaryStops
              ? { 'aria-label': stopping ? '停止中' : '停止' }
              : { 'aria-label': running ? '排队发送' : '发送' })}
            disabled={primaryStops ? stopping : sending || draftEmpty}
            onClick={() => { if (primaryStops) void stopTurn(); else void send() }}
          >
            {/* 三种形态必须一眼可辨：发送（纸飞机）／排队（胶囊上写「排队」）／停止（方块）。
                排队态原来是「纸飞机 + 角上一只小钟」，既挤又看不出什么意思；直接写字最省解释。 */}
            {primaryStops ? (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
              </svg>
            ) : running ? (
              <span className="chat-send-queuedText" aria-hidden="true">排队</span>
            ) : (
              <SendIcon />
            )}
          </button>
        </div>
      </div>
      {plusOpen && (
        <PlusSheet
          onPickImage={() => { setPlusOpen(false); openPicker('image') }}
          onPickCamera={() => { setPlusOpen(false); openPicker('camera') }}
          onPickFiles={(picked) => { setPlusOpen(false); addFiles(picked) }}
          onPickHostFile={() => { setPlusOpen(false); setHostFileOpen(true) }}
          onClose={() => { setPlusOpen(false) }}
        />
      )}
      {hostFileOpen && (
        <HostFileSheet
          {...(session.cwd === undefined ? {} : { rootPath: session.cwd })}
          onClose={() => { setHostFileOpen(false) }}
          onPick={(pickedPath, pickedName) => {
            setHostFileOpen(false)
            // 引用而不是搬运：手机上系统选择器给不了文件时，这条把宿主机上的路径写进
            // 输入框（`@路径` 是这套系统的既定写法），agent 直接按路径读，不用上传字节。
            setInput(previous => {
              const trimmed = previous.replace(/\s+$/u, '')
              // 路径里有空格必须包起来：`@D:\my project\a.ts` 会被读成 `@D:\my`，
              // agent 于是去读一个不存在的文件（真机上就是「引用了但读不到」）。
              const ref = `@${quotePathForReference(pickedPath)}`
              return trimmed === '' ? `${ref} ` : `${trimmed} ${ref} `
            })
            toast(`已引用 ${pickedName}`)
          }}
        />
      )}      {commandOpen && (
        <CommandSheet
          commands={commands}
          onPickCommand={(line) => {
            setCommandOpen(false)
            // 桌面端行为：选中命令只把它填进输入框（蓝色 chip，光标在参数区），
            // 由用户补参数、自己按发送。原来这里直接执行，`/goal` 这类带参命令
            // 在手机上一次填参数的机会都没有。
            claimCommand(line.replace(/^\//, ''))
          }}
          onClose={() => { setCommandOpen(false) }}
        />
      )}

      {pendingPermission !== undefined && (
        <PermissionConfirmSheet
          sessionId={session.sessionId}
          target={pendingPermission}
          onChanged={(value) => {
            setPermissions(previous => previous === undefined ? previous : { ...previous, currentValue: value })
            // 面板里改完同样以宿主为准（可能被宿主拒绝或归一化）。
            syncPermissionsFromHost()
          }}
          onClose={() => { setPendingPermission(undefined) }}
        />
      )}
      {turnListOpen && (
        <TurnListSheet
          entries={turnEntries}
          currentTurn={shownTurn}
          onPick={jumpToTurn}
          onClose={() => { setTurnListOpen(false) }}
        />
      )}
      {previewPath !== null && (
        <FilePreviewSheet path={previewPath} sessionId={session.sessionId} onClose={() => { setPreviewPath(null) }} />
      )}
      {lightboxSrc !== null && (
        <ImageLightbox src={lightboxSrc} alt="聊天图片" onClose={() => { setLightboxSrc(null) }} />
      )}
      {moreOpen && (
        <Sheet title={title} onClose={() => { setMoreOpen(false) }}>
          <div role="menu" aria-label="会话操作">
            <button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setMoreOpen(false); setRenaming(true) }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">重命名会话</span>
              </span>
              <PencilIcon width={16} height={16} />
            </button>
            <button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setMoreOpen(false); void copyText(session.sessionId) }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title">复制会话 ID</span>
              </span>
            </button>
            {session.cwd !== undefined && session.cwd !== '' && (
              <button
                type="button"
                role="menuitem"
                className="sheet-option"
                onClick={() => { setMoreOpen(false); setGitOpen(true) }}
              >
                <span className="sheet-option-copy">
                  <span className="sheet-option-title">查看改动</span>
                  <span className="sheet-option-desc">分支、未提交的改动、最近提交</span>
                </span>
              </button>
            )}
            <div className="sheet-option-divider" aria-hidden />
            <button
              type="button"
              role="menuitem"
              className="sheet-option"
              onClick={() => { setMoreOpen(false); setDeleting(true) }}
            >
              <span className="sheet-option-copy">
                <span className="sheet-option-title" style={{ color: 'var(--danger)' }}>删除会话</span>
              </span>
            </button>
          </div>
        </Sheet>
      )}
      {gitOpen && session.cwd !== undefined && session.cwd !== '' && (
        <GitSheet cwd={session.cwd} onClose={() => { setGitOpen(false) }} />
      )}
      {renaming && (
        <PromptDialog
          title="重命名会话"
          initial={title}
          confirmLabel="保存"
          onCancel={() => { setRenaming(false) }}
          onConfirm={(value) => { void handleRename(value) }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="删除会话"
          body={<>确定删除「{title}」吗？该会话将从所有设备消失（电脑上的会话记录保留，可从桌面找回）。</>}
          confirmLabel="删除"
          tone="danger"
          onCancel={() => { setDeleting(false) }}
          onConfirm={handleDeleteSession}
        />
      )}
      {voiceOpen && (
        <div className="voice-backdrop" onClick={() => { closeVoice() }}>
          <div
            className="voice-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="语音输入"
            onClick={(event) => { event.stopPropagation() }}
            onKeyDown={(event) => {
              // 键盘（iPad 外接键盘/桌面浏览器）与读屏用户：Esc 必须能退出，
              // 否则这个面板只能靠点背景关掉，而背景正好在手指最容易误触的位置。
              if (event.key === 'Escape') {
                event.stopPropagation()
                closeVoice()
              }
            }}
          >
            <div
              ref={voiceWaveRef}
              className={'voice-wave' + (voicePhase === 'transcribing' ? ' voice-wave-idle' : '')}
              data-live={voicePhase === 'recording' ? '1' : undefined}
              aria-hidden
            >
              <span /><span /><span /><span /><span />
            </div>
            {/* 文案与警示色都来自 voiceStatusText：最后 10 秒提醒，转写中/有部分转写时不提醒。 */}
            <div
              className={voiceStatusClassName(voiceStatus)}
              role="status"
            >
              {voiceStatus.text}
            </div>
            <div className="voice-actions">
              <button
                type="button"
                className="voice-cancel"
                onClick={closeVoice}
              >取消</button>
              <button
                ref={voiceDoneRef}
                type="button"
                className="voice-done"
                disabled={voicePhase === 'transcribing'}
                onClick={finishVoice}
              >
                {voicePhase === 'transcribing' ? '请稍候' : '完成'}
              </button>
            </div>
          </div>
        </div>
      )}
      {ctxMenu !== undefined && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => {
              // 长按抬手后浏览器会补一次 click：它打在背板上，会把刚打开的菜单
              // 立刻关掉（真机/模拟器都复现）。刚打开的这一小段窗口内忽略。
              if (Date.now() - ctxMenuOpenedAtRef.current < 400) return
              setCtxMenu(undefined)
            }}
            onContextMenu={(event) => { event.preventDefault(); setCtxMenu(undefined) }}
          />
          <div
            className="ctx-menu"
            role="menu"
            aria-label="消息操作"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            {ctxMenu.row !== undefined && (
              <div className="ctx-head" role="presentation">
                <span className="ctx-head-text">
                  {ctxMenu.row.title}
                  {ctxMenu.row.summary === '' ? '' : ' · ' + ctxMenu.row.summary}
                </span>
                {ctxMenu.row.state !== '' && <span className="ctx-head-state">{ctxMenu.row.state}</span>}
              </div>
            )}
            {ctxMenu.row !== undefined && (
              <button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => {
                  const { row } = ctxMenu
                  setCtxMenu(undefined)
                  if (row !== undefined) void copyText((row.title + (row.summary === '' ? '' : ' · ' + row.summary)).trim(), '已复制这一行')
                }}
              >
                复制这一行
              </button>
            )}
            {ctxMenu.row?.command !== undefined && ctxMenu.row.command !== '' && (
              <button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => {
                  const { row } = ctxMenu
                  setCtxMenu(undefined)
                  if (row?.command !== undefined) void copyText(row.command, '已复制命令')
                }}
              >
                复制命令
              </button>
            )}
            {ctxMenu.kind === 'user' && ctxMenu.messageId !== undefined && (
              <button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => {
                  const { text, messageId } = ctxMenu
                  setCtxMenu(undefined)
                  if (messageId !== undefined) setEditMessage({ messageId, text })
                }}
              >
                编辑并重新发送
              </button>
            )}
            {ctxMenu.raw !== undefined && ctxMenu.row === undefined && (
              <button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => { const { raw } = ctxMenu; setCtxMenu(undefined); void copyText(raw ?? '', '已复制原文') }}
              >
                复制原文
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={() => { const { text } = ctxMenu; setCtxMenu(undefined); void copyText(text) }}
            >
              {ctxMenu.row === undefined ? '复制' : '复制整条回复'}
            </button>
            <button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={() => { const { text } = ctxMenu; setCtxMenu(undefined); quoteIntoComposer(text) }}
            >
              引用
            </button>
            {ctxMenu.row === undefined && (
              <button
                type="button"
                role="menuitem"
                className="ctx-item"
                onClick={() => { const { raw, text } = ctxMenu; setCtxMenu(undefined); void shareText(raw ?? text) }}
              >
                分享
              </button>
            )}
            {(() => {
              const canSelect = ctxMenu.target !== undefined
              if (!canSelect) return null
              return (
                <button
                  type="button"
                  role="menuitem"
                  className="ctx-item"
                  onClick={() => {
                    const { target } = ctxMenu
                    setCtxMenu(undefined)
                    // 建好选区后浏览器会抬起手柄，系统"复制"菜单随之可用。
                    selectTextBlock(target)
                  }}
                >
                  选择文字
                </button>
              )
            })()}
            <button
              type="button"
              role="menuitem"
              className="ctx-item ctx-item-cancel"
              onClick={() => { setCtxMenu(undefined) }}
            >
              取消
            </button>
          </div>
        </>
      )}
      {editMessage !== undefined && (
        <PromptDialog
          title="编辑并重新发送"
          initial={editMessage.text}
          confirmLabel="发送"
          onCancel={() => { setEditMessage(undefined) }}
          onConfirm={(value) => { sendEditedMessage(editMessage.messageId, value) }}
        />
      )}
    </div>
  )
}

/** Wrap a plain-text prompt (quote preamble / offline entry / regenerate) into parts. */
function textParts(text: string): PromptPart[] {
  return [{ type: 'text', text }]
}

/** Wire shape of the host token-meter context-pressure projection. */
type ContextPressureData = {
  contextWindow?: number
  pressureTokens?: number
  projectedTokens?: number
}

/** Loose parse of the contextPressure projection (host augmentation). */
function parseContextPressure(value: unknown): ContextPressureData | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  return {
    ...(typeof v['contextWindow'] === 'number' ? { contextWindow: v['contextWindow'] } : {}),
    ...(typeof v['pressureTokens'] === 'number' ? { pressureTokens: v['pressureTokens'] } : {}),
    ...(typeof v['projectedTokens'] === 'number' ? { projectedTokens: v['projectedTokens'] } : {}),
  }
}

/* ── bottom sheets ───────────────────────────────────────────────────── */

/* Shared sheet chrome lives in ../sheet.tsx; the pickers below compose it. */

