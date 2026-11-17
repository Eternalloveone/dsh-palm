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
 * - the C-case dock: queue strip, input row, and one `模型 │ 权限` capsule
 *   that opens a single model-and-permission panel.
 */

import { APPROVAL_ARGS_LIMIT, TURN_JUMP_MAX_PAGES, JUMP_PAGE_ROWS, MODELS_EXTRAS_GRACE_MS, MIN_CACHE_TAIL_ROWS, SLOW_NETWORK_CACHE_MS, OFFLINE_PROBE_MS, OFFLINE_PROBE_TIMEOUT_MS, CARD_SYNC_COOLDOWN_MS, TURN_CLOCK_THRESHOLD_MS, FOCUS_MAX_PAGES, LOST_ECHO_QUIET_MS } from './chat/lib/chat-constants.ts'
import { useChatComposerState, useChatReading, useChatSearch, useChatUi } from './chat/state/chat-machine.ts'
import { useChatSessionLifecycle } from './chat/hooks/use-chat-session-lifecycle.ts'
import { useNativeSelection } from './chat/hooks/use-chat-subscriptions.ts'
import { useSessionQueue } from './chat/hooks/use-session-queue.ts'
import { useSessionRef, useSessionState } from './chat/hooks/use-session-scope.ts'
import { resetElapsedSamples } from '../message-row/turn-clock.ts'
import { useChatOutboxFlush } from './chat/hooks/use-chat-outbox-flush.ts'
import { useChatEscape } from './chat/hooks/use-chat-escape.ts'
import { useScrollGestures } from './chat/hooks/use-chat-scroll-gestures.ts'
import { ChatInputSheets } from './chat/components/chat-input-sheets.tsx'
import { useStaleTurnHeal } from './chat/hooks/use-stale-turn-heal.ts'
import { useMobilePreferences } from './chat/hooks/use-mobile-preferences.ts'
import { useChatTimerCleanup } from './chat/hooks/use-chat-timer-cleanup.ts'
import { useSearchPrefill } from './chat/hooks/use-search-prefill.ts'
import { useInboxPoll } from './chat/hooks/use-inbox-poll.ts'
import { useMessageMenuDismiss } from './chat/hooks/use-message-menu-dismiss.ts'
import { useCardRecoveryReset } from './chat/hooks/use-card-recovery-reset.ts'
import { useCardDomProbe } from './chat/hooks/use-card-dom-probe.ts'
import { ChatOverlays } from './chat/components/chat-overlays.tsx'
export { OFFLINE_PROBE_MS, OFFLINE_PROBE_TIMEOUT_MS, CARD_SYNC_COOLDOWN_MS, TURN_CLOCK_THRESHOLD_MS, FOCUS_MAX_PAGES } from './chat/lib/chat-constants.ts'
import { REPORT_FALLBACK_MAX_PAGES, REPORT_FALLBACK_PAGE_MESSAGES, REPORT_RECOVERY_WINDOW_TURNS, loadTurnReportRows, reportCardDiagnostic } from './chat/lib/chat-turn-report.ts'
import { useChatExport } from './chat/hooks/use-chat-export.ts'
import { useQueueActions } from './chat/hooks/use-queue-actions.ts'
import { useChatInbox } from './chat/hooks/use-chat-inbox.ts'
import { useChatGoal } from './chat/hooks/use-chat-goal.ts'
import { useChatConnectivity } from './chat/hooks/use-chat-connectivity.ts'
import { useChatSubagents } from './chat/hooks/use-chat-subagents.ts'
import { useChatActions } from './chat/hooks/use-chat-actions.ts'
import { useScrollFollow } from './chat/hooks/use-chat-scroll-follow.ts'
// 测试直接从这个模块导入它；搬走后保持对外形状不变。
export { loadTurnReportRows } from './chat/lib/chat-turn-report.ts'
import { LOCATE_MAX_FIXES, LOCATE_TOLERANCE_PX, LOCATE_TOP_GAP, TURN_SCRUB_MOVE_PX, TURN_SCRUB_TRACK_INSET_PX, escapeAttr, offersRegenerate, quotePathForReference, scrubTrackRight } from './chat/state/chat-scroll.ts'
// 这两个原本从这里导出、被测试直接引用；搬走后保持对外形状不变（测试不该被迫改 import）。
export { offersRegenerate, quotePathForReference } from './chat/state/chat-scroll.ts'
import { estimateMessageHeight, messageKey } from './chat/lib/chat-layout.ts'
// 定位决策（2026-11-12）：意图 → 锚点 → 状态机。纯函数，测试在 chat/lib 下。
// 「数据还没到」不可能被它判成「找不到」，这条由状态机的不变量保证，不靠 if 拦。
import { judgeLanding } from './chat/lib/locate-landing.ts'
import { decideMiss } from './chat/lib/locate-machine.ts'
import { useRowCallbacks } from './chat/hooks/use-row-callbacks.ts'
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react'
import type { MuxFrame } from '../../api-proxy-types'
import { useChatSelector, useChatSessionStore } from '../runtime/chat/use-chat-store.ts'
import { useSessionPending } from '../runtime/chat/use-pending-store.ts'
import { loadChatPage, type ChatPageResult } from '../data/chat-page.ts'
import { createStreamState } from './chat/state/stream-state.ts'
import type { SessionView } from '../shared/session-view.ts'
import { removeDraft } from '../session/list-persist.ts'
import { locateIntentFor, keepLocateIntentAlive } from '../session/locate-intent.ts'
import { usePageVisible } from '../stream/foreground.ts'
import { useLiveClock } from '../platform/live-clock.ts'
import { useHostClock } from './chat/hooks/use-host-clock.ts'
import { formatDuration, isRowRunning } from '../render/process-rows.ts'
import { CTX_MENU_WIDTH, placeCtxMenu } from '../ctx-menu.ts'
import { createScopedStore, recallTurnReports, rememberChatSnapshot, rememberTurnReports } from '../session/chat-snapshot.ts'
import { noteChatFrame } from '../session/chat-sync-ledger.ts'
import { normalizeInsertText } from '../session/insert-queue.ts'
import { isUsableCachedPage, loadCachedHistory, saveCachedHistory } from '../session/history-cache.ts'
import { errorText, staleHostHint } from '../shared/error-text.ts'
import { cancelSession, history, prompt, sendCommand } from '../data/session.ts'
import { fetchMobilePreferences, models, selectModel, listCommands } from '../data/settings.ts'
import type { SessionModels } from '../../api-proxy-types'
import type { CommandDescriptor, MobileGoalAction, PendingApproval } from '../api.ts'
import { completedTurns, renderRows, missingTurnReports, EventFolder, foldEvents, mergeTurnReports, type RenderMessage, type TodoSnapshot, type WireEvent } from '../render/messages.ts'
/** renderRows 的实现已移到 messages.ts（会话 hook 共用）；保留导出供既有测试导入。 */
export { renderRows }
import { reportError, reportPerf, reportProbe } from '../data/diag.ts'
import { noteSeqDomain } from '../render/seq-domain.ts'
import { ledgerSnapshot, recordFrame, resetFrameLedger } from './chat/state/frame-ledger.ts'
import { FOLLOW_THRESHOLD_PX, mayAutoPin } from '../stream/scroll-machine.ts'
import { useStickToBottom } from '../ui/hooks/use-stick-to-bottom.ts'
import { usePendingPoll } from './chat/hooks/use-pending-poll.ts'
import { initialSnapshotRows, OPEN_HISTORY_MAX_PAGES, OPEN_HISTORY_TARGET_ROWS, useChatHistory } from './chat/hooks/use-chat-history.ts'
import { useChatSession } from './chat/hooks/use-chat-session.ts'
import { newestFoldTurn } from './chat/state/stream-state.ts'
import { useChatStream } from './chat/hooks/use-chat-stream.ts'
import { useChatAttachments } from './chat/hooks/use-chat-attachments.ts'
import { useChatVoice } from './chat/hooks/use-chat-voice.ts'
import { type MessageCtxMenuState } from './chat/components/message-menu.tsx'
import { ComposerMeta } from './chat/components/composer-meta.tsx'
import { OfflineBanner } from './chat/components/offline-banner.tsx'
import { ChatHeader, ChatSearchBar } from './chat/components/chat-header.tsx'
import { ChatEmptyView } from './chat/components/chat-empty.tsx'
import { alignHitIndex, normalizeSearchHits, rowCoversSeq, rowHasTerm, rowIndexOfHit as searchRowIndexOfHit, rowRendersAnyText, type SearchHit } from './chat/lib/chat-search-match.ts'
import { localSearchHits, olderHitIndex } from './chat/lib/local-search-hits.ts'
import { ChatAttentionPanels } from './chat/components/chat-attention-panels.tsx'
import { JumpControls } from './chat/components/scroll-controls.tsx'
import type { ModelPickerCatalog } from './chat/lib/tool-labels.ts'
import { subscribeDraft, useChatDraftController } from './chat/hooks/use-chat-draft.ts'
import { ComposerSection } from './chat/components/composer-section.tsx'
import { useLongPress } from '../ui/hooks/use-long-press.ts'
import { useKeyboardInset } from '../ui/hooks/use-keyboard-inset.ts'
import { adoptOlderPage, prepareOlderPage } from './chat/lib/history-page.ts'
import { dispatchFrame, type ContextPressureData, type FrameContext } from './chat/state/frame-effects.ts'
import { useChatComposer } from './chat/hooks/use-chat-composer.ts'
import { ChatRows } from './chat/components/chat-rows.tsx'

import { SessionHud } from '../components/session-hud.tsx'
import { saveChatCache, type CachedRow } from '../session/chat-cache.ts'
import {
  barsSignature,
  createSessionStatus,
  describeBars,
  sessionStatusReducer,
  sweepExpired,
  type BarsView,
  type SessionStatus,
  type StatusEvent,
} from '../stream/session-status.ts'
import { perfMark } from '../platform/perf.ts'
import { answeredQuestionsFor, noteAnsweredQuestion } from '../session/question-batches.ts'
import { answeredApprovalsFor, noteAnsweredApproval } from '../session/approval-batches.ts'
import { collectDeliveries, latestDeliveryOf, mergeDeliveries, type DeliveryRecord } from '../session/deliveries.ts'

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

/**
 * 最后一条用户消息的宿主时间（毫秒）—— 一轮秒表的**硬下界**。
 *
 * 真机 2026-11-14（用户第四次报计时不准，截图「等回话 43分34秒」，实际只跑了 8 分钟）：
 * 新一轮刚发出去时，宿主快照还停在上一轮、折叠里也还没有本轮的 assistant 行，
 * 于是 {@link newestTurnAnchor} 顺着 `own` 把**上一轮**的 turnStartAt 当成了本轮起点。
 * 上面那层「只许变早」的 min 记忆又把这个错值锁死 —— 早的永远赢，错得越早越稳。
 *
 * 所以锚点必须先过一道物理约束：**本轮不可能在本轮用户开口之前开始**。
 *
 * @param messages - 当前窗口里的渲染行
 * @returns 最后一条用户消息的时间；没有用户行时 undefined
 */
export function lastUserMessageAt(messages: readonly RenderMessage[]): number | undefined {
  let at: number | undefined
  for (const message of messages) {
    if (message.kind !== 'user') continue
    if (typeof message.time !== 'number' || !Number.isFinite(message.time)) continue
    if (at === undefined || message.time > at) at = message.time
  }
  return at
}

/**
 * 把锚点夹到「不早于最后一条用户消息」。
 *
 * 只抬下界、不压上界：晚于用户消息的候选原样返回（行上更精确的 turn/start 不该被打扰），
 * 早于它的一律视为上一轮的残留。
 *
 * @param anchor - 候选锚点（`null` = 没有开着的轮）
 * @param floor - 下界（见 {@link lastUserMessageAt}）
 * @returns 夹过的锚点
 */
export function clampAnchorToOwnTurn(
  anchor: number | null | undefined,
  floor: number | undefined,
): number | null | undefined {
  if (anchor === null || anchor === undefined) return anchor
  if (floor === undefined || !Number.isFinite(floor) || !Number.isFinite(anchor)) return anchor
  return Math.max(anchor, floor)
}

import { FinishedElsewhereBar, RunBadge, RunStatusSheet, runBadgeBits } from '../render/run-status.tsx'
import { copyText, openFilePath, shareText } from '../render/code-actions.ts'
import { MuxClient } from '../stream/mux.ts'
import { getAutoScroll, subscribeDisplayPrefs } from '../platform/display-prefs.ts'
import { timeVisibility } from '../render/ui-text.ts'
import { QueueCard } from './chat/components/queue-card.tsx'
import { queueAuthoritative } from '../stream/session-store.ts'
import { GoalBar } from '../components/goal-bar.tsx'
import {
  GOAL_CLEAR_COMMAND, GOAL_EDIT_PREFIX, GOAL_PAUSE_COMMAND, GOAL_RESUME_COMMAND, goalEditCommand,
  parseGoalProjection, type MobileGoal,
} from '../session/goal-projection.ts'
import { applyQueueItems, claimQueueHead, rebaselineQueueView } from '../stream/session-store.ts'
import { goalAction, goalOf, searchSessions } from '../data/session.ts'
import { reportConnectivity } from '../platform/rpc.ts'
import { voiceSupported } from '../platform/voice-input.ts'
import { toast } from '../components/toast.tsx'
import { useToastLift } from '../components/toast-lift.ts'
import { forgetQueuedEcho, lostQueuedEchoes, markQueuedEchoSeen, normalizeEchoText, readQueuedEchoes } from '../session/queued-echo.ts'
import { approvalPreviewText } from '../session/approval-preview.ts'
import { type TurnDeliveryFacts } from '../render/message-row.tsx'
import { PermissionConfirmSheet, PlusSheet, type PermissionSelectValue } from '../components/sheets.tsx'
import { parseProjections, projectionValues, pullProjections } from './chat/state/projections.ts'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { mergeTurnEntries, parseTurnOutline, localTurnEntries, readingTurnAt, scrubTurnIndex, seqRowIndex, turnPromptRowIndex, turnRowIndex, type TurnEntry } from '../session/turn-outline.ts'
import { collectArtifacts, type ArtifactTurn } from '../session/artifacts.ts'
import { TurnScrubber } from '../components/turn-scrubber.tsx'
import type { JobView } from '../../api-proxy-types'
import { type SubagentFlatNode } from '../session/subagent-tree.ts'
import type { HostBridge } from '../kernels/host-bridge.ts'

/** D1 handle-gesture tunables: the travel (px) a press must exceed before it
 *  counts as a scrub drag, and the horizontal inset of the scrub card's track
 *  inside the viewport (card margin + padding). The inset mirrors .turn-scrub in
 *  the stylesheet, because the finger position is mapped onto that track. */
/** 重新生成发出去后，等这么久还没开跑就复位（正常路径由 running 收走）。 */

/** Props for the chat view. */
export interface ChatViewProps {
  session: SessionView
  /** 空会话首屏：没有会话可开，同一个 ChatView 渲染空态（不跑会话逻辑）。 */
  empty?: boolean
  /** 顶栏标题下方的工作区名（10.5px）。 */
  workspaceName?: string
  /** The page-lifetime mux client (undefined before the first effect tick). */
  mux?: MuxClient | undefined
  /** P3 兼容入口：旧测试/宿主可直接注入 mux。*/
  bridge?: HostBridge<MuxFrame> | undefined
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
  /**
   * 结构坐标（2026-11-12，图谱寻址）：命中在第几轮 / 第几步。
   *
   * 它是第三个稳定锚点：`seq` 会被跨页合并打乱，`messageId` 可能不在当前窗口里，
   * 「第 12 轮第 3 步」却始终指向同一行。
   */
  initialFocusTurn?: number
  initialFocusStep?: number
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
  /** 打开上下文占用页（P6 ⑦ 屏）：面板底部入口，右状态仍保持纯展示。 */
  onOpenContext?: ((usage: { contextWindow?: number; pressureTokens?: number; projectedTokens?: number }) => void) | undefined
  /** 打开批准方式页（P6 ⑥ 屏）：面板底部入口。 */
  onOpenApprovalMode?: ((permissions: {
    currentValue: string
    options: readonly { value: string; name: string; description?: string }[]
  }) => void) | undefined
  /** 打开产物列表页（P6 ⑧ 屏）；不给就不显示入口。 */
  onOpenArtifacts?: ((turns: readonly ArtifactTurn[]) => void) | undefined
  /** 打开「任务」页（进行中 / 刚完成的总览）；不给就不显示入口。*/
  onOpenTasks?: (() => void) | undefined
  /**
   * 左上角画「返回」而不是抽屉。
   *
   * 只有「从别的页面点进来的会话」才给（页面栈里还有上一页）；根会话页没有上一页，
   * App 那边按 `canPop` 判断后再传。
   */
  onBack?: (() => void) | undefined
  /** 打开回合大纲独立页（P6 ⑫ 屏）；不给就还开浮层。 */
  onOpenOutline?: ((entries: readonly TurnEntry[], currentTurn: number) => void) | undefined
  /** 打开单文件 diff 独立页（P6 ⑩ 屏）；不给就还走浮层预览。 */
  /** 大纲页点了某一轮：回到对话后落位到它（由 App 置，ChatView 消费后清空）。 */
  pendingTurn?: { turn: number; seq: number } | undefined
  /** 消费完成回调（不清空的话返回再进会重复跳）。 */
  onPendingTurnConsumed?: (() => void) | undefined
  onOpenDiff?: ((path: string) => void) | undefined
  /** 交付卡「看全部改动」：打开交付详情页（不给就只画卡、不画入口）。 */
  onOpenDelivery?: ((facts: TurnDeliveryFacts) => void) | undefined
  /** 顶栏「☰」：打开会话抽屉（带上当前会话的产物轮次，给抽屉底部的产物入口用）。 */
  onOpenDrawer?: ((turns: readonly ArtifactTurn[]) => void) | undefined
  /** 更多菜单里的「设置」；不给就不画那一项。*/
  onOpenSettings?: (() => void) | undefined
  /** 空会话首屏发送第一句：App 建会话、投递并切到真正的话页。 */
  onStartSession?: ((text: string) => Promise<void> | void) | undefined
  /** 打开审批详情独立页（P6 ④ 屏）；不给就不显示入口。 */
  onOpenApproval?: ((approval: PendingApproval, preview?: string, argsText?: string) => void) | undefined
  /** 点运行状态面板里的一行子代理：打开它的详情页（不给就保持纯展示）。*/
  onOpenSubagent?: ((node: SubagentFlatNode) => void) | undefined
}

/* ── long sessions：已载入的行全渲染 ────────────────────────────────────
   这里原来是"行窗格 + 估高 spacer"的虚拟化：超过阈值只渲染滚动位置附近的行，
   上下用估算高度撑开。落点于是全是估出来的 —— 跳轮次永远差一截（真机「定位
   不到正确的位置上」）。

   现在照桌面的做法：**已载入的行全部渲染**，不可见行的布局/绘制交给 CSS 的
   content-visibility（浏览器会记住它自己布局过的真实高度，不是我们的估算）。
   未载入的更早历史只由一条固定高的「加载更早」按钮代表：它的高度是样式常数，
   所以"翻页之后目标轮就在顶部"可以直接写成 scrollTop = 0，全程不做高度估算。
/** Older pages paged for a focus-locate before giving up (bounded IO). */
// Search can scan deep history (mobile-api SEARCH_MESSAGES_PAGES). Keep locate
// paging bounded, but large enough to reach any result that search can return.

/** 刚发出去、还没被宿主回执认领的那条用户消息（幽灵行）。 */
export interface OutgoingFlight {
  id: string
  text: string
  at: number
  /** 宿主回执（`session.prompt` ack）的时刻：它是"已接单"的权威事实，与模型何时开始无关。 */
  acceptedAt?: number
  /** 幽灵行本身超时（宿主那条用户行迟迟不来）：停画它，但等待态还要继续。 */
  ghostExpired?: boolean
  /** 等待态已过防闪阈值（回执后 300ms）——短于它的等待不显示，避免一闪而过。 */
  awaitingReady?: boolean
}

/** 幽灵行最长挂 8 秒：弱网回执 2~5 秒是常态，再久说明这一拍读不回来（宿主行迟早自己到）。 */
const OUTGOING_TTL_MS = 8_000
/**
 * 「发出去了却没回音」的判定线：宿主那条用户行 6 秒还没落地 = 实时帧没进来。
 *
 * 幽灵行是本地状态，8 秒到期就撤；如果 `user/message` 帧始终不到（宿主按设备过滤的
 * 登记丢了、断流、闸门），屏幕上会**什么都没有**，而本地折叠永远不会自己长出这条 ——
 * 真机表现就是「发出去不回显、正文也不渲染，重开 PWA 才显示」。
 */
const SEND_ECHO_GRACE_MS = 6_000
/**
 * 等待态最长挂 10 分钟：这是"已送达但还没有任何输出"的兜底（模型排队/长上下文）。
 * 正常情况下首个过程内容一到就撤（见认领 effect），这个值只是别让占位永久赖着。
 */
const AWAITING_TTL_MS = 600_000

/**
 * 这一行是否是"模型已经开始输出"的证据（工具/流程/推理/正文任一）。
 *
 * 等待态（`submitted`）只在它出现之前显示 —— 它是"宿主已接单、模型还没开口"的唯一可见信号。
 */
function hasModelOutput(row: RenderMessage): boolean {
  if (row.kind !== 'assistant') return false
  return (row.tools?.length ?? 0) > 0
    || (row.flow?.length ?? 0) > 0
    || (row.reasoning ?? '') !== ''
    || row.text !== ''
}

/**
 * Render one session's chat.
 * @param props - the session, the mux client, and the back action.
 * @returns the chat surface.
 */
export function ChatView(props: ChatViewProps) {
  if (props.empty === true) {
    return (
      <ChatEmptyView
        title={props.session.title}
        {...(props.workspaceName === undefined ? {} : { workspaceName: props.workspaceName })}
        onOpenDrawer={props.onOpenDrawer === undefined ? undefined : () => { props.onOpenDrawer?.([]) }}
        {...(props.onOpenSettings === undefined ? {} : { onOpenSettings: props.onOpenSettings })}
        onStartSession={props.onStartSession ?? (() => { /* 空会话发送由 App 提供 */ })}
      />
    )
  }
  return <ChatSessionView {...props} />
}

function ChatSessionView({
  session,  workspaceName,
  mux,  bridge,
  onBack,
  showToolCalls,
  showSystemMessages,
  initialFocusSeq,
  initialFocusMessageId,
  initialFocusPartId,
  initialFocusTurn,
  initialFocusStep,
  initialFocusQuery,
  finishedElsewhere,
  onOpenFinished,
  onDismissFinished,
  onOpenContext,
  onOpenApprovalMode,
  onOpenApproval,
  onOpenDiff,
  onOpenDelivery,
  onOpenDrawer,
  onOpenSettings,
  onOpenSubagent,
  onOpenOutline,
  pendingTurn,
  onPendingTurnConsumed,
  onOpenArtifacts,
  onOpenTasks,
}: ChatViewProps) {
  /**
   * 首页搜索点进来的定位意图：props 丢了也能落准（见 locate-intent.ts）。
   *
   * **只在挂载时取一次并标记消费**：以前每次渲染都重新读，意图还在 TTL 内的话，
   * 之后随便一次普通打开都会把它再捡起来，首屏直接取到那条老命中所在的一页 ——
   * 真机表现就是「一进会话自动跳到很老的一轮」。
   */
  const locateIntentRef = useSessionRef(session.sessionId, () => locateIntentFor(session.sessionId))
  const locateIntent = locateIntentRef.current
  // 换会话时的三个一次性动作（消费定位意图 / 清「刚结束」/ 持住定位意图）在 S2-A 搬出。
  useChatSessionLifecycle(session.sessionId)
  /** 高亮用的关键词：props 丢了就用意图里那份（否则只会滚、不会涂黄）。 */
  // 只用 props 的定位词（外部"进入并定位"）。`locateIntent?.query` 是**搜索词**
  // （首页搜索结果点进来时带的），它走搜索通道（chatHitQuery），绝不能当定位词
  // 传给过程组 —— 否则思考/工具里的同词会被点亮，计数和跳转又会把过程算进去。
  const effectiveFocusQuery = initialFocusQuery
  // 第一帧就用上一场的内存快照：进会话不再“空一帧、再内容”（真机：进会话闪一下）。
  // 行模型（折叠/合并）由 use-chat-session 持有；这里只拿 rows 与唯一提交点。
  const chatSession = useChatSession({
    sessionId: session.sessionId,
    initialRows: initialSnapshotRows(session.sessionId)?.rows ?? [],
    getOpenTurn: () => openTurnRef.current,
  })
  const messages = chatSession.rows
  /**
   * 交付账本（见 `session/deliveries.ts`）：以 **turn 号**为身份、**只追加不回退**。
   * 渲染期就地合并（不是 state + effect）：卡必须和正文同一次提交落地，否则又是一帧
   * 「先正文、后卡片」的闪。
   *
   * **按会话分槽**（真机 2026-11-14 19:52，新建会话里挂着上一场的卡）：这里是渲染期写
   * ref，而 React 允许丢掉一次渲染的结果、ref 的写入却留下来 —— 单槽账本于是可能被
   * "别人的那一场"污染。分槽之后，写入只落在它自己那一场，跨会话串味结构上不成立。
   */
  const [ledgers] = useState(() => createScopedStore<DeliveryRecord[]>(8))
  const deliveries = useMemo(() => {
    const previous = ledgers.get(session.sessionId) ?? []
    if (messages.length === 0) return previous
    const merged = mergeDeliveries(previous, collectDeliveries(session.sessionId, messages))
    ledgers.set(session.sessionId, merged)
    return merged
  }, [messages, session.sessionId, ledgers])
  /** 账本里最新一条"值得看"的交付（只认本场）；卡只认它，行怎么重排都不影响。 */
  const delivery = latestDeliveryOf(deliveries, session.sessionId)
  /**
   * 实机逐帧诊断（2026-11-13 第二版）：150ms 一帧，10 秒一次上传。
   *
   * 带上 bundle 文件名 + 骨架/空态标记 + 视口高度；用来回答"进入会话的头两秒屏幕上
   * 到底是什么"，而不是靠桌面浏览器推演。
   */
  useEffect(() => {
    const frames: Array<Record<string, unknown>> = []
    const started = performance.now()
    // ChatView 是动态 import 的 chunk，不在 <script src> 里：改查 resource timing。
    const bundle = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .map(entry => entry.name)
      .find(name => name.includes('ChatView-')) ?? ''
    const timer = window.setInterval(() => {
      const scroll = document.querySelector('.chat-scroll')
      frames.push({
        t: Math.round(performance.now() - started),
        rows: document.querySelectorAll('.chat-scroll > *').length,
        cards: document.querySelectorAll('.chat-turn-tail').length,
        bodies: document.querySelectorAll('.chat-md-body').length,
        skeleton: document.querySelector('[data-skeleton]') !== null,
        typing: document.querySelector('.chat-typing') !== null,
        h: scroll === null ? 0 : scroll.scrollHeight,
        top: scroll === null ? 0 : Math.round(scroll.scrollTop),
        vh: scroll === null ? 0 : scroll.clientHeight,
      })
    }, 150)
    const stop = window.setTimeout(() => {
      window.clearInterval(timer)
      if (frames.length === 0) return
      void reportPerf({
        stamps: [{ at: Date.now(), label: 'entry-trace-v2' }],
        diagnostic: 'entry-trace-v2',
        sessionId: session.sessionId,
        bundle,
        frames,
      }, 'entry-trace-v2').catch(() => undefined)
    }, 10_000)
    return () => { window.clearInterval(timer); window.clearTimeout(stop) }
  }, [session.sessionId])


  /**
   * 这个会话"有没有消息"的证据。
   *
   * 只有**提交过行**（或宿主明确答"0 行"）之后才有资格下"空会话"的结论；
   * 在那之前 rows 为空只说明"还没到"，不是"没有"。
   *
   * 为什么不用 loading：实测 phase 比 rows 早 200~480ms 落定，用它当判据就会
   * 在那个窗口画出「还没有消息」。为什么不用 blank/turns：真机上不可靠
   * （session.turns 实测是 0，新建会话与"刚打开还没读"分不开）。
   */
  const [entryAnswered, setEntryAnswered] = useSessionState(session.sessionId, false)

  /** 流式路径的 9 个字段收一个对象（S7a-3a/3b）：换会话整体 reset，漏一个就是跨会话串帧。 */
  const streamRef = useRef(createStreamState())
  const stream = streamRef.current
  // Foreground gate for every poll on this view: a frozen background PWA must
  // not keep issuing RPCs (the stream and the host-side follow are released by
  // App's observe effect; returning resyncs them).
  const foreground = usePageVisible()

  /** 宿主最近返回的那一页原始行：定位要用它比对，不要用屏幕上合并过的列表。
   *  合并过的列表把相邻几页的行混在一起，文本匹配会先撞到一段只有几十字的相邻
   *  行上（真机：跳到一个空白的短行，明明搜索命中的正文就在附近）。
   *  一次点击会连着翻好几页（auto-extend 链），只存最后那一页会漏掉命中所在的页，
   *  所以这里攒住最近几页的行。 */
  const rawPageRef = useSessionRef<RenderMessage[]>(session.sessionId, [])
  const rememberRawPage = (rows: readonly RenderMessage[]): void => {
    const seen = new Set(rows.map(row => row.id))
    const kept = rawPageRef.current.filter(row => !seen.has(row.id))
    rawPageRef.current = [...rows, ...kept].slice(0, 400)
  }

  const applyMessages = (rows: RenderMessage[], options: { allowGuessedTails?: boolean } = {}): void => {
    // 有行就置位：断言"提交过行"与"这些行"在同一次 React 更新里，
    // 所以不会出现"已判空、行还在路上"的中间帧。
    if (rows.length > 0) setEntryAnswered(true)
    // 存**宿主那一页原始行**（不是渲染后的行）：两套 id 体系一致，恢复后再合并
    // 不会重复。曾经存渲染行，结果长会话二次进入时同一轮被画两遍（13 处重复 id）。
    saveChatCache(session.sessionId, rows as unknown as CachedRow[])
    // 换列表时把已经画出来的「本轮产出」带走：页自己不带报告行，换一次卡片就闪没
    // 一次（真机：「点进会话，卡片突然又消失了」）。
    // 页更权威但更穷（参数被剥、不带报告行）：同身份的行取两边并集，别把屏幕上
    // 更全的那份换成残缺版 —— 真机「拉历史的时候闪一下」就是这一步造成的。
    rememberRawPage(rows)
    commitRows(rows, options)
  }

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
  /** 现场调试钩子：地址带 `?debug=1` 时把当前渲染的行挂到 window 上（卡/过程条重复时取原始 rows 看）。 */
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!new URLSearchParams(window.location.search).has('debug')) return
    ;(window as unknown as { __palmRows?: unknown }).__palmRows = messages
  }, [messages])

  const commitRows = chatSession.commitRows
  // 分页历史：取页/缓存/在飞合并/链式补页在 use-chat-history 里；折叠与锚点在这里。
  const pager = useChatHistory({
    sessionId: session.sessionId,
    messages,
    getScroll: () => scrollHandle,
    actions: {
      scrollToBottom: () => scrollToBottom(),
      settleBottomAfterCommit: () => settleBottomAfterCommit(),
    },
    getFirstRow: () => stream.folder?.snapshot()[0] ?? messages[0],
    loadedRowCount: () => stream.folder?.snapshot().length ?? messages.length,
    preparePage: (page) => prepareOlderPage(page, {
      sessionId: session.sessionId,
      rememberRawPage,
      cardRecovery: cardRecoveryRef.current,
      loadCards: loadTurnReportRows,
      rememberCards: rememberTurnReports,
    }),
    adoptPage: (older, _page, ctx) => adoptOlderPage(older, ctx, {
      folder: stream.folder,
      commitRows,
      applyRows: applyMessages,
    }),
    // `olderLoading` 只驱动"加载更早"的按钮文案。
    // `setLoading` 是"整页装载"的既有信号，hydrated（状态条/交付卡的结论资格）依赖它 ——
    // 但**只在屏幕上已经有行时**才让它落定：首屏为了"一次成型"会等铺开链，
    // 这期间翻页收尾若把 phase 判成 ready，就会画一帧「还没有消息」。
    // 真机探针实证：phase=ready 且 rows=0 的那一帧（1919ms）就是它。
    onLoading: (loading) => {
      setOlderLoading(loading)
      if (!loading && messagesRef.current.length === 0) return
      setLoading(loading)
    },
    onError: (reason) => { setError(errorText(reason)) },
  })
  /** 「上一个」翻页后的落点：翻到更早一页，落地后落到**新增区域的最早一处**。 */
  const pendingPrevPageRef = useRef(false)

  const { hasOlder, setHasOlder, pendingRef, pageCacheRef, loadOlder, captureSessionGuard, markFollowAfterPrepend, recallSnapshot } = pager
  /** 正在翻更早的页：只驱动按钮文案，不参与"整页装没装完"的判断。 */
  const [olderLoading, setOlderLoading] = useState(false)
  // 每次列表变了就把"这一场当前画的样子"记进内存快照，供下次进会话第一帧直接铺。
  useEffect(() => {
    rememberChatSnapshot(session.sessionId, messages, hasOlder)
    // 进会话时列表是**分段长出来**的（缓存 → 尾页 → 自动补页链），而补拍窗口只有 1.5 秒。
    // 后到的补页把高度再拉长一次，落点就停在半路 —— 真机「刚进会话没跳到最末尾」。
    // 只在「进会话 8 秒内」补，且由滚动状态机自己判断读者有没有动手（maySettlePin）。
    if (Date.now() - openedAtRef.current < 8_000) settleBottomRef.current()
  }, [session.sessionId, messages, hasOlder])
  // Latest loadOlder (the tail-load effect's closure is stale by the time the
  // page lands); the auto-extend on open calls through this ref. Assigned
  // after the useCallback below (TDZ).
  const loadOlderRef = useRef<(silent?: boolean, beforeSeq?: number, chain?: boolean, maxRows?: number) => void>(() => {})
  loadOlderRef.current = loadOlder
  /** 「下一条命中」那一页的预取缓存：键 = beforeSeq，取用一次就删。 */
  // One silent auto-extend chain per session open (see the tail-load effect).
  // 这一轮"进会话铺开"已经补了几页（每开一次会话归零）。
  /** 这一次进会话的时刻：补页链落地后还要再钉底。 */
  const openedAtRef = useSessionRef(session.sessionId, () => Date.now())
  /** 装载态、瞬时提示、标题都在 Chat Store 里（W3-2）；setter 由 store hook 一并给出。 */
  const chat = useChatSessionStore(session.title, session.sessionId)
  const loading = chat.state.phase === 'loading'
  const error = chat.state.notice
  const { setError } = chat
  const setLoading = chat.setLoading

  // Toast 的站位：输入栏 + HUD + 键盘的实际高度写进 --toast-lift，
  // 否则排队条一出现，固定 104px 的 toast 就会盖住「撤回」（真机截图）。
  useToastLift()
  /** 输入框草稿（状态 + 按会话持久化）归 use-chat-draft（S4c 从本文件搬出）。 */
  /** 草稿**不订阅**（B3）：正文由 `ComposerSection` 自己订阅 store，这里只要取值器/写入器。 */
  const draftControl = useChatDraftController(session.sessionId)
  const setInput = draftControl.set
  /** 发送/停止/重新生成在 store 里（W3-2）。`sending`/`stopping` **不在这里订阅**：一次
   *  发送翻转两次，整表订阅会让这 4000 行连行列表重建两遍；它们下沉到作曲区自订阅。
   *  行上的「重新生成」图标 2026-11-12 已按用户要求删除，所以这里不再订阅 regenerate 状态
   *  —— 它现在只服务失败回合的重试（写在 `handleRegenerate` 里，没有读侧）。 */
  const { setSending, setStopping, setRegenerate: setRegenerateState, resetSession } = chat
  /** 实时读发送态：回调可能很久之后才跑，闭包里的值会漏掉"同一帧连点两下"。 */
  const getSending = useCallback((): boolean => chat.store.getState().sending, [chat.store])
  // Live mirror of `messages`：回调可能在很久之后才跑（首帧 rAF 甚至晚于尾页
  // 落地），所以它们必须读当前列表，不是闭包创建时的那一份。
  const messagesRef = useRef(messages)
  // 滚动机制（容器/程序化认领/状态机/补拍/手势/回钉）统一在 ui/hooks/use-stick-to-bottom 里；
  // ChatView 只保留业务判断（未读、翻页、定位）。
  const scrollHandle = useStickToBottom(session.sessionId)
  const { scrollRef, scrollTopRef, programmaticScrollRef, programmaticValueRef, programmaticAtRef, lastTouchAtRef, scrollStateRef, scrollEvent, setScrollTopProgrammatically, pinToRealBottom, scrollToBottom, settleBottomRef, settleBottomAfterCommit, lastScrollHeightRef } = scrollHandle
  /**
   * 会话状态机：三根条的**唯一判据**（不再是影子，渲染完全由它决定）。
   *
   * 迁移期曾用它做旁路对照（只比较、不改行为）；判据对齐后已接管渲染，
   * 对照代码随之删除 —— 留着两套判据才是新隐患。
   */
  const shadowStatusRef = useSessionRef<SessionStatus>(session.sessionId, createSessionStatus)
  /** 三根条「该显示什么」的唯一来源（来自 `session-status.ts` 的 `describeBars`）。 */
  const [bars, setBars] = useSessionState<BarsView>(session.sessionId, () => describeBars(createSessionStatus(), Date.now()), { snapshotKey: 'bars' })
  const barsSignatureRef = useSessionRef(session.sessionId, '')
  const shadowEvent = useCallback((event: StatusEvent): void => {
    shadowStatusRef.current = sessionStatusReducer(shadowStatusRef.current, event)
  }, [])
  // The bottom gap at the USER's last gesture (recorded on every scroll
  // event). Passive content growth — a pending message finalizing into
  // taller markdown, an appended reply — changes scrollHeight without firing
  // a scroll event, so this snapshot keeps its gesture-time truth: the
  // follower never mistakes a content-driven height change for "user scrolled
  // up". Programmatic writes (scrollToBottom) land at the bottom (gap 0) and
  // are equally harmless.

  messagesRef.current = messages
  /** The session's permission select (absent = capability not composed). */
  const [permissions, setPermissions] = useSessionState<PermissionSelectValue | undefined>(session.sessionId, undefined, { snapshotKey: 'permissions' })
  /** Host context-pressure projection (token-meter): the authoritative
   *  per-session occupancy source. Fed by the history baseline and live
   *  session/projection frames; `undefined` until the first data lands. */
  const [contextPressure, setContextPressure] = useSessionState<ContextPressureData | undefined>(session.sessionId, undefined)
  /** The current model selection for the toolbar chip (best-effort label). */
  const [currentModel, setCurrentModel] = useSessionState<{ provider: string; model: string; reasoningEffort?: string } | undefined>(session.sessionId, undefined)
  /** Set when the user picked a preset that needs an explicit confirm (full access). */
  const [pendingPermission, setPendingPermission] = useSessionState<string | undefined>(session.sessionId, undefined)
  /** File path awaiting in-chat preview (a .file-link tap without a host opener). */
  const [previewPath, setPreviewPath] = useSessionState<string | null>(session.sessionId, null)
  /** 最新的一级「看 diff」回调：代码块里的文件链也要走同一个入口。 */
  const onOpenDiffRef = useRef(onOpenDiff)
  onOpenDiffRef.current = onOpenDiff
  /** In-chat <img> source opened in the full-screen lightbox (tap-to-view). */
  const [lightboxSrc, setLightboxSrc] = useSessionState<string | null>(session.sessionId, null)
  /** Lazily cached model directory backing the quick picker (fresh per open
   *  until it loads once; the full sheet re-fetches on its own). */
  const [modelCatalog, setModelCatalog] = useSessionState<ModelPickerCatalog>(session.sessionId, { status: 'idle' })
  /**
   * 已认领的命令名（桌面端那颗蓝色 chip）。
   *
   * 桌面端从命令菜单选一条命令，是把命令词作为 chip **填进输入框**，光标跟在后面
   * 等参数（`/目标` + 空格 + 目标内容），而不是立刻执行。手机端原来选中即执行，
   * 于是带参数的命令（`/goal`、`/plan`…）根本没机会填参数。这里保存命令名，输入框
   * 只留参数部分，发送时再拼回去。
   */
  const [claimedCommand, setClaimedCommand] = useSessionState<string | undefined>(session.sessionId, undefined)
  /** 待发附件（图片 + 文件）全部归 use-chat-attachments（S4a 从本文件搬出）。 */
  const attachments = useChatAttachments({ sessionId: session.sessionId })
  const { attachImages, attachFiles, uploadingFiles, setAttachImages, setAttachFiles, addImage, addFiles, retryStaged, openPicker } = attachments

  /** 输入框元素句柄：认领命令后把焦点移到参数区。 */
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  /** Host slash-command directory (fetched lazily when the + menu opens). */
  const [commands, setCommands] = useSessionState<CommandDescriptor[] | undefined>(session.sessionId, undefined)
  /** 上一次拉命令目录的时刻：失败后 3 秒内不重复打宿主。 */
  const commandFetchAtRef = useSessionRef(session.sessionId, 0)
  /** Quoted message (context bar above the composer; sent as a blockquote preamble). */
  const [quoted, setQuoted] = useSessionState<string | undefined>(session.sessionId, undefined)
  /** True while the chat is mounted; guards async voice callbacks after unmount. */
  const mountedRef = useRef(true)
  /** 语音输入（录音面板 / 实时字幕 / 转写回填）全部归 use-chat-voice（S4b 从本文件搬出）。 */
  const { voiceOpen, voicePartial, voicePhase, voiceElapsed, voiceStatus, voiceWaveRef, voiceDoneRef, openVoice, finishVoice, closeVoice } = useChatVoice({ mountedRef, setInput, sessionId: session.sessionId })
  /** Pinch-zoom state for code blocks (one active gesture at a time). */
  const pinchRef = useRef<{ block: HTMLElement; dist0: number; scale0: number } | undefined>(undefined)

  /**
   * 缓存 = **屏幕稳定之后的完整画面**（含交付卡）。
   *
   * 进会话是两拍：先尾页（29 行），再自动补页合成完整一屏（114 行）。
   * 只在第一拍写缓存的话，下次进入会先画 29 行再被整份换成 114 行 ——
   * 用户看到的就是「进去先短后长、卡片又长一遍」。这里等画面稳定再写。
   *
   * 读端已归 `chat/use-chat-history.ts`（S3b-3，`initialSnapshotRows`）；TEMP-AB 那次
   * 「缓存首屏 → 同一轮两行（真机 13 处重复 id）」的教训与决策记在
   * audit/refactor-plan.md：先修身份合并，再谈扩大缓存读取面。
   */
  useEffect(() => {
    if (messages.length === 0) return
    const timer = setTimeout(() => {
      const maxSeq = messages.reduce((max, row) => (row.seq > max ? row.seq : max), 0)
      // 猜出来的交付卡不进缓存：下次进入先画它、几秒后被真卡替换，
      // 用户看到的就是卡片内容又变了一次。缓存只留真卡（turn/end 或回读写到的）。
      const cacheable = messages.filter(row => row.guessed !== true)
      void saveCachedHistory(session.sessionId, { rows: cacheable, maxSeq, hasOlder })
    }, 400)
    return () => { clearTimeout(timer) }
  }, [messages, hasOlder, session.sessionId])

  /** Pending-message queue for this session (desktop QueueDock equivalent),
   *  seeded from the mux's retained snapshot so a freshly opened chat shows
   *  messages queued before it mounted. */
  /**
   * 当前目标（桌面端 composer 上方那条 goal 指示条的复刻）。
   * undefined = 还没读到；null = 没有目标 / 已完成 —— 两种情况都不渲染条子。
   */
  const [goal, setGoal] = useSessionState<MobileGoal | null | undefined>(session.sessionId, undefined, { snapshotKey: 'goal' })
  /** 目标命令在途中：四个按钮同时置灰，避免连点发出两条 /goal。 */

  /**
   * 排队队列（W3-6 第一步）：**唯一所有者是会话状态仓**（stream/session-store.ts）。
   * 这里只订阅仓的变更版本并投影出当前该画的几条 —— 视图不再持有队列数组。
   * 也就没有"漏抄一次就删了还在"的第二份副本。冷启动先用 mux 保留的那份顶上。
   */
  const queueFallback = useCallback(
    () => mux?.cachedQueueFor(session.sessionId) ?? [],
    [mux, session.sessionId],
  )
  const queueItems = useSessionQueue(session.sessionId, queueFallback)
  /** 有排队项在屏幕上：轮询要加密（长度而不是数组本身进依赖，免得每次刷新都重建定时器）。 */
  const hasPendingQueue = queueItems.length > 0

  const applyGoalRef = useRef<(value: unknown, activation?: 'armed' | 'disarmed') => void>(() => {})
  const adoptTodoRef = useRef<(next: TodoSnapshot) => void>(() => {})

  /** 计划条（todo/write 快照）：流 hook 的待办归一化要在构造时就拿到 setter。 */
  const [todo, setTodo] = useSessionState<TodoSnapshot | undefined>(session.sessionId, undefined, { snapshotKey: 'todo' })
  const { applyGoal, refreshGoal, adoptTodo, adoptTodoLatest } = useChatGoal({
    sessionId: session.sessionId,
    mountedRef,
    setGoal,
    setTodo,
    startTransition,
    applyGoalRef,
    adoptTodoRef,
  })
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
  /** 帧回调要对账时立刻问一次宿主：走 ref，免得为它重订阅事件流。*/
  const refreshInboxRef = useRef<(options?: { fresh?: boolean }) => void>(() => {})
  /**
   * 流式 + 回合状态（S7a-4，从本文件搬出）。
   *
   * 这里拿到的是**所有权**：五个回合状态、唯一裁决入口、运行状态对账、缺口回填、
   * 重载尾页、换会话重置、rAF 合批。`mux.onFrame` 仍是本文件的视图分发器 —— 它把帧
   * 分给 todo/jobs/queue/permissions/… 十几个视图状态，属于装配而不是流状态。
   */
  const chatStream = useChatStream({
    sessionId: session.sessionId,
    mux,
    stream,
    messages,
    commitRows,
    applyMessages,
    setHasOlder,
    setError,
    refreshInboxRef,
    normalizeTurnEndTodo,
    foreground,
  })
  // hostLost 仍由 stream 层维护（对账循环用它续命），但页面不再渲染"连接中断"这几个字。
  const { running, verdictKnown, runningTurn, turnStartAt, abandonedTurn, applyTurnVerdict, reconcileRunning, refillGap, reloadTail, resetForSession, clearHostLost, clearActiveTurn, beginTurn, enqueueLiveEvent, noteTailPageAnchor, hasClosedTurn, markVerdictKnown, markSnapshotAlive, isRunning, getRunningTurn } = chatStream
  const { applyInbox, refreshInbox } = useChatInbox({
    sessionId: session.sessionId,
    mountedRef,
    applyTurnVerdict,
    markSnapshotAlive,
    applyGoalRef,
    adoptTodoRef,
    refreshInboxRef,
  })
  /** 同值的 ref 镜像：send() 的成功回调要知道"这条消息是排队发出去的"，但它不该
   *  因为每轮 running 翻转就重建（回调里的闭包会过期，而重建会让输入区的 onKeyDown
   *  在回合切换的瞬间拿到旧 send）。 */
  const runningRef = useRef(running)
  runningRef.current = running
  refreshInboxRef.current = refreshInbox
  /**
   * 目标 / 待办的落地函数在下面才定义（refreshInbox 要先声明）：用 ref 转一手，
   * 免得为了它们把整个回调挪位置、再牵动依赖数组。
   */

  // 队列的订阅已经在 useSessionQueue 里（W3-6）：视图订阅仓的版本号，不再抄一份数组。
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
    // 队列读数此刻可信吗？重连基线生效期间 `queueView()` 会返回空，而那个空不是证据。
    // 2026-11-10 真机：「消息都排队了，却突然回撤到输入框」——就是重连后这里判丢。
    // 把原文塞回输入框，等队列快照回来又出现一张排队卡片，同一条消息出现在两个地方。
    if (!queueAuthoritative(session.sessionId)) return
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

  // 收件箱轮询（1.5s / 3s / 8s 按状态变速 + 切回前台补一次）：宿主投递走的是帧以外
  // 的通道，客户端只能问。节奏与理由见 hooks/use-inbox-poll.ts。
  useInboxPoll({ running, hasPendingQueue, refreshInbox })
  /** 目标投影 → 目标条状态：解析在 `parseGoalProjection`（`use-chat-goal` 持有）里。 */
  applyGoalRef.current = applyGoal

  /** Turn-clock mount fallback (see turnStartAt). */
  /** 宿主时钟（见 chat/host-clock.ts）：读数在宿主时间域里减法，手机墙钟不参与。 */
  const hostClock = useHostClock()
  /** 传给消息行的宿主时间（10 秒桶）：毫秒值当 prop 会让每行的 memo 永远失效（见 use-row-callbacks）。 */
  const hostNowIdle = Math.floor(hostClock.hostNow() / 10_000) * 10_000
  /** 权限投影补给进行中（按钮可以连点）。 */
  const permissionPullRef = useSessionRef(session.sessionId, false)
  /** 本会话最后一次真的送来事件流的时间。只有本会话的 session/event 才算数
   *  （心跳和别的会话的帧不算），所以它不会因为链路空闲就被刷新。 */
  const lastSessionEventAtRef = useSessionRef(session.sessionId, 0)
  /** Latest `session/jobs` snapshot for this session (background tasks the
   * parent owns: subagent delegations, bash/pwsh runs, …). The host pushes a
   * full snapshot after every registry commit; empty = no tasks. The initial
   * value replays the mux client's cached snapshot so tasks already running
   * when this chat opens are visible immediately (the mux baseline arrives at
   * app boot, before any chat is mounted). */
  const [jobs, setJobs] = useSessionState<JobView[]>(session.sessionId, () => mux?.cachedJobsFor(session.sessionId) ?? [])
  /** Latest `todo/write` snapshot for this session (the plan strip above the
   * newest message). Adoption is last-write-wins by seq: history pages and
   * live frames can race, and an older page must never clobber a newer live
   * snapshot. Cleared on turn/start (the host clears the projection there). */
  /** Foreground subagents for this session (the flat live delegation list).
   * Built from `subagents.list` and overlaid with host/session-status flips. */
  const [subagents, setSubagents] = useSessionState<SubagentFlatNode[]>(session.sessionId, [], { snapshotKey: 'subagents' })
  /** Whether the run-status bottom sheet (subagents + todo plan + background jobs) is up. */
  /**
   * 待批审批 / 待答问题（W3-2 第二步）：事实在 `runtime/chat/pending-store.ts`。
   * 按会话分桶、模块作用域。这里只订阅当前会话那一桶——换会话不清空、不串写。
   * 切回来卡片还在；审批详情页读的也是同一份（不是导航时抄走的快照）。
   */
  const pending = useSessionPending(session.sessionId)
  const { approvals: pendingApprovals, questions: pendingQuestions } = pending
  const setPendingApprovals = pending.setApprovals
  const setPendingQuestions = pending.setQuestions
  /** Displayed title (renames apply locally right away) — W3-2 起由 Chat Store 持有。 */
  const title = chat.state.title ?? session.title
  const setTitle = chat.setTitle
  /** The header 更多 menu (rename / copy session id). */
  /** F4 export sheet (Markdown / single-file HTML, redacted). */
  /** The read-only git sheet (branch / changes / commits). */
  /** Turn-list bottom sheet visibility. */
  // Esc 关弹层：手机上没有这个键，但平板/桌面浏览器/外接键盘上它是第一反应。
  // 实测此前按 Esc 什么都不发生——遮罩拦着，只能去点空白处。
  // 纯界面开关收在一个 reducer 里：11 个 useState → 1 个（S1-A）。
  const [uiState, uiSetters] = useChatUi(session.sessionId)
  const { composerPanelOpen, plusOpen, hostFileOpen, commandOpen, moreOpen, exportOpen, runStatusOpen } = uiState
  const { composerPanelOpen: setComposerPanelOpen, plusOpen: setPlusOpen, hostFileOpen: setHostFileOpen, commandOpen: setCommandOpen, moreOpen: setMoreOpen, exportOpen: setExportOpen, runStatusOpen: setRunStatusOpen } = uiSetters

  // 滚动与阅读位置收进 reducer（S1-C）：4 个 useState → 1 个。
  // 它们必须同属一个状态机，否则会出现「按钮出现了但未读数没清」这类只在真机复现的错位。
  const [readingState, readingSetters] = useChatReading(session.sessionId)
  const { currentTurn, showJumpToLatest, unreadCount, locateTick, cardSyncTick } = readingState
  const { currentTurn: setCurrentTurn, showJumpToLatest: setShowJumpToLatest, unreadCount: setUnreadCount, locateTick: setLocateTick, cardSyncTick: setCardSyncTick } = readingSetters
  // 输入区与连接收进 reducer（S1-D）：6 个 useState → 1 个。
  // 注意 offline / mobileEnterToSend 的**真相源在外部**（连通性探测 / 宿主偏好），
  // 这里只记录最近一次已知值，不做判断。
  const [composerState, composerSetters] = useChatComposerState(session.sessionId)
  const { pickerBusy, composerFocused, mobileEnterToSend, goalBusy, stopArmed, offline } = composerState
  const { pickerBusy: setPickerBusy, composerFocused: setComposerFocused, mobileEnterToSend: setMobileEnterToSend, goalBusy: setGoalBusy, stopArmed: setStopArmed, offline: setOffline } = composerSetters
  useChatEscape({ ui: uiState, setters: uiSetters })
  /** The host `turnOutline` projection raw value (parsed into the merged
   *  list below). Absent until the tail projection baseline lands. */
  const [turnOutlineRaw, setTurnOutlineRaw] = useSessionState<unknown>(session.sessionId, undefined, { snapshotKey: 'turnOutline' })
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
  /** Target of a turn jump that must page history in first: the outline's
   *  boundary seq, the turn NUMBER to match once a page lands (the seq alone
   *  cannot match — see locateSeq), and how many follow-up pages this jump has
   *  already spent. */
  const pendingTurnSeqRef = useSessionRef<number | undefined>(session.sessionId, undefined)
  const pendingTurnNumberRef = useSessionRef<number | undefined>(session.sessionId, undefined)
  /** 搜索命中落在哪一段（一行里多处命中时用来说明是哪一处）。 */
  const pendingTurnPartIdRef = useSessionRef<string | undefined>(session.sessionId, undefined)
  /** 这一条命中是该段里的第几处（同一段里同一个词出现多次时对位）。 */
  const pendingTurnOccurrenceRef = useSessionRef(session.sessionId, 0)
  /** 搜索命中的消息 id（两条读取通道里唯一一致的键，定位优先用它）。 */
  const pendingTurnMessageIdRef = useSessionRef<string | undefined>(session.sessionId, undefined)
  /** 命中的片段：跨通道唯一一致的定位依据（原文本身）。 */
  const pendingTurnSnippetRef = useSessionRef<string | undefined>(session.sessionId, undefined)
  /** 这次跳转要落到第几条命中：落地后才把它写进计数器（没落地不动数字）。 */
  const pendingTurnAtRef = useSessionRef<number | undefined>(session.sessionId, undefined)
  const pendingTurnPagesRef = useSessionRef(session.sessionId, 0)
  /** D1 scrub state: the index into `turnEntries` the finger points at while the
   *  handle is held; undefined means the scrubber is closed. */
  const [scrubIndex, setScrubIndex] = useSessionState<number | undefined>(session.sessionId, undefined)
  /** Live bookkeeping for one handle gesture: where the press landed (the drag
   *  threshold is measured against it) and whether it ever travelled, so the
   *  release can tell a tap (open the list) from a scrub. */
  const scrubGestureRef = useSessionRef<
    { pointerId: number; startX: number; moved: boolean } | undefined
  >(session.sessionId, undefined)
  /** Rename dialog visibility. */
  /** Delete-session confirm dialog visibility. */
  /** Long-press message menu: viewport position + the bubble's plain text,
   *  plus the message's RAW markdown when it differs (tool-interleaved flow
   *  turns carry their payload in flow runs, invisible in `text`). */
  /** 菜单打开的时刻：长按抬手后浏览器还会补一次 click，它会打在背板上把菜单立刻关掉。 */
  const ctxMenuOpenedAtRef = useSessionRef(session.sessionId, 0)
  const [ctxMenu, setCtxMenu] = useSessionState<MessageCtxMenuState | undefined>(session.sessionId, undefined)
  /** The user message being edited-and-resent (回填后重发为新 prompt). */
  const [editMessage, setEditMessage] = useSessionState<{ messageId: string; text: string } | undefined>(session.sessionId, undefined)
  /** 自动滚动偏好（设置 → 自动滚动）。订阅而不是只在挂载时读一次：在设置里
      关掉之后，当前这个会话当场就该停滚，不用退出去重进。 */
  const autoScroll = useSyncExternalStore(subscribeDisplayPrefs, getAutoScroll)

  // 回车是发送还是换行：读宿主的移动端显示偏好，读失败保持默认（回车发送）。
  useMobilePreferences({ setMobileEnterToSend, fetchPreferences: fetchMobilePreferences })

  /* ── offline mode ──────────────────────────────────────────────────── */

  // 断线提示只关心「连没连上」；待发队列的界面已下线（恢复后自动重发，见 use-chat-outbox-flush）。
  useChatConnectivity({ offline, setOffline })

  // 四个排队动作在 use-queue-actions.ts（失败路径的分支比动作本身多）。

  /* ── F4 export (Markdown / single-file HTML, redacted) ─────────────── */

  /** Transcript rows worth exporting: real talk + commands, no turn cards. */
  const { copyExport, downloadExport, downloadLongImage } = useChatExport(title, messages, toast)
  const { handleQueueEdit, handleQueueRemove, handleQueueSteer, handleQueueWithdraw } = useQueueActions({
    sessionId: session.sessionId,
    queueItems,
    refreshInbox,
    setInput,
    toast,
    applyTurnVerdict,
  })

  // The + menu's command directory loads lazily on first open (weak links
  // never pay for it up front); a failure degrades to an empty list. The
  // session id resolves the agent's effective command view (per-agent rows
  // like /plan and /compact live in agent presets on the Web deployment).
  useEffect(() => {
    let cancelled = false
    const tryFetch = (): void => {
      if (cancelled) return
      // 手动敲 / 也要认领成 chip，所以输入框里出现斜杠就开始拉目录。
      if (!(plusOpen || commandOpen || draftControl.get().startsWith('/'))) return
      if (commands !== undefined) return
      // 一次失败不能把整个会话的目录钉死成空：真机上就是这么"有时候"看不见 /goal、
      // /plan 的（首次拉取撞上宿主忙或弱网）。失败不缓存，1 秒后再试。
      if (Date.now() - commandFetchAtRef.current < 1000) return
      commandFetchAtRef.current = Date.now()
      void listCommands(session.sessionId).then(
        (items) => { if (!cancelled) setCommands(items) },
        () => { /* 保持未加载：下一次打开面板或继续输入时重试 */ },
      )
    }
    tryFetch()
    // 订阅而不是把 `input` 当依赖：本组件已不因打字重渲染，那个依赖永远不会再触发。
    const unsubscribe = subscribeDraft(session.sessionId, tryFetch)
    return () => { cancelled = true; unsubscribe() }
  }, [plusOpen, commandOpen, commands, session.sessionId, draftControl])

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
    const stopIntentKeepAlive = keepLocateIntentAlive(session.sessionId) ?? (() => {})
    // 换会话：流状态整体归零 + 取消待折的 rAF 帧 + 用名单的 running 播种回合状态
    // （逐字段手工清是这套状态历史上唯一反复出问题的地方，见 resetForSession）。
    resetForSession(session.running === true)
    // 帧台账也是本会话的：不清上一次会话的帧，因果链会被污染。
    resetFrameLedger()
    // 页还没到：实时帧先入缓冲（resetStreamState 把它清成 false，这里重新拉起）。
    stream.tailLoading = true
    // 时钟校准是**本会话**的：换会话就从零开始攒样本，否则上一场的偏移会
    // 直接套到这一场的秒表上（锚点是宿主时间，偏移偏多少秒表就偏多少）。
    // 换会话：时钟基准重置（锚点是宿主时间，基准错了秒表就错；重进会话能修好正是因为它重置）。
    hostClock.reset()
  // 秒表的定锚记录也是**本会话**的：不清的话，切过去的会话（或切回来）会沿用
  // 上一场留下的锚点，读数就变成上一场的时间（真机：不同会话计时一样）。
  resetElapsedSamples()
    setTitle(session.title)
    // A session switch starts a fresh read position: the next fold key change
    // (the new tail page) must follow to the bottom unconditionally.
    // 新会话：滚动状态机整体归零（跟随窗口、手势、定位锁、方向）。
    scrollEvent({ type: 'open', at: Date.now() })
    lastMessageKeyRef.current = undefined
    // 这一场本次运行里打开过：直接把上次画的行同步铺上来，网络页到了再覆盖。
    // 没打开过才回到空表 + 加载中（跨刷新的场景仍由 IndexedDB 缓存兜底）。
    const seeded = pager.recallSnapshot()
    setLoading(seeded === undefined)
    setError(undefined)
    // 走唯一提交入口：缓存页与网络页可能是两套 id，直接 setMessages 会绕过
    // 身份合并，屏幕上就是「同一段内容两份」。
    commitRows(seeded?.rows ?? [])
    setHasOlder(seeded?.hasOlder ?? false)
    // Pending approvals/questions are per-session facts **by construction** now
    // (runtime/chat/pending-store.ts buckets them by session id): a switch just
    // reads another bucket, so A's cards can no longer leak into B — and they
    // are still there when you switch back, instead of waiting for a replay.
    // The answered-item memory is per session and lives at module scope
    // (question-batches.ts / approval-batches.ts): a switch neither leaks it into
    // the next chat nor has to clear it — pending rpcIds are never reused.
    // 会话作用域的状态（上下文占用、计划条、面板开关、引用、附件…）不在这里清：
    // 它们由 `useSessionState`/`useSessionRef` 在**渲染期**就回到新会话的初值
    // （B 的第一帧也带不上 A 的东西）。这条 effect 只管异步装载。
    // 但「在途意图」住在 Chat Store 里，是外部真相源，得显式发一条重置。
    resetSession(session.sessionId)
    // 行里的 running 只是过渡值：进会话后 mobile.turnState 会立刻给出宿主的判决并覆盖它。
    // 这个字段本身不可信（实测刚跑完的会话仍是 true），但**不能**在连不上宿主时把它
    // 收掉 —— 那正是「网络抖一下，秒表被清零」的老毛病；连不上只标链路（连接中断），
    // 回合和时钟都留着。
    // 会话切换：证据水位归零 + 名单播种 + 清活跃轮号/秒表锚点，都在 resetForSession 里。
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
      // 形状守卫：IndexedDB 里可能是上一版代码写的页（旧 schema / 半截写），
      // 直接送进 EventFolder 会在下面抛 TypeError —— 那是没被抓住的 rejection，不是降级。
      if (cancelled || networkLanded || !isUsableCachedPage(cached) || cacheHit) return
      cacheHit = true
      const folder = new EventFolder(cached.rows, cached.maxSeq)
      stream.loadedPage = true
      stream.folder = folder
      applyMessages(folder.fold([]))
      noteSeqDomain({ source: 'cache', sessionId: session.sessionId, hostMaxSeq: cached.maxSeq, pageRows: cached.rows, folder, buffered: stream.liveBuffer, report: reportProbe })
      setHasOlder(cached.hasMore)
      setLoading(false)
      reportCardDiagnostic(renderRows(folder.fold([])), [], { pages: 0, whole: false, source: 'cache' })
    }
    void loadCachedHistory<ChatPageResult>(session.sessionId).then(cached => {
      // 同一个形状守卫（paintCache 里也有一道）：坏缓存当没有，等网络页。
      if (cancelled || networkLanded || !isUsableCachedPage(cached)) return
      // 够一整页的缓存：立刻上屏（快网也就是一闪而过的过渡）。
      // 半页缓存（上一次只看到开头几行）：先不画 —— 画上去网络页一到就整屏换掉，
      // 正文/过程条/卡片一起变，就是「进会话闪一下」。
      // 250ms 还没等到网络页就把手上这份先画出来（原 800ms）：实测冷启铺满 90% 要
      // 700~1300ms，那段时间屏幕是空的。半页缓存画上去之后网络页照旧合并，
      // 有位置身份兜着，不会再出现"整屏换掉"的闪。
      if (cached.rows.length >= MIN_CACHE_TAIL_ROWS) {
        paintCache(cached)
        return
      }
      // 但弱网下不能一直白屏：800ms 还没等到网络页，就把这半页先画出来
      // （可用性优先）。网络页到了照旧合并，不会更差。
      window.setTimeout(() => {
        if (cancelled || networkLanded) return
        // 半页里只有交付卡、没有一行正文时不画：那是"先说结果、正文随后才来"的
        // 最刺眼形态，宁可多转一会儿骨架（网络页带着正文一起到）。
        // 正文不到 3 行就当它是"半页"：画出来就是"先一张交付卡、正文随后才到"
        // （手机 PWA 上的原话）。网络页会一次给全，这 1 秒里没必要先画半份。
        if (cached.rows.filter(row => row.kind !== 'turn').length < 3) return
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
      const projections = parseProjections(projectionValues(authority))
      if (projections.present.has('permissions')) setPermissions(projections.permissions)
      if (projections.present.has('contextPressure')) setContextPressure(projections.contextPressure)
      if (projections.present.has('turnOutline')) setTurnOutlineRaw(projections.turnOutline)
      if (projections.present.has('inbox')) applyInbox(projections.inbox)
    }).then(
      async (page) => {
        stopIntentKeepAlive()
        if (cancelled) return
        networkLanded = true
        /**
         * 权威尾页到了 = 这一场"在不在跑"有据可依了（页里带 turnOpen/锚点）。
         *
         * 交付卡在这之前一律不画：换会话首帧画的是内存快照（有卡），`running` 却还是
         * 默认 false —— 先画、权威结论到了再撤，就是真机看到的"卡闪一下又没了"。
         * 历史会话（纯静态）也在这一拍放开，所以不误伤"一进就有卡"。
         */
        markVerdictKnown()
        // Buffered live events re-fold on top of the snapshot; the watermark
        // (page.maxSeq — the host window's event floor) drops any the
        // snapshot already includes, so nothing is lost or doubled.
        const buffered = stream.liveBuffer
        stream.liveBuffer = []
        stream.tailLoading = false
        const folder = new EventFolder(page.rows, page.maxSeq)
        stream.loadedPage = true
      stream.folder = folder
        let foldedRows = folder.fold(buffered)
        noteSeqDomain({ source: 'entry', sessionId: session.sessionId, hostMaxSeq: page.maxSeq, pageRows: page.rows, folder, buffered, report: reportProbe })
        // 交付卡跟着正文**同一次提交**落地。
        //
        // 以前这里只提交正文，缺卡的轮次交给几秒后的 cardRecovery 去补 —— 用户看到的
        // 就是「点进会话，卡片一张张动态长出来」，违反稳定渲染原则（I4 一次成型）。
        // 现在把已收工却缺卡的轮次一次读齐，合并进同一次 setMessages；读不到就照原样
        // 提交（不猜、不占位），绝不为了"快"先画一半再改。
        // 交付卡一次性到位：**只用记忆缓存里已解析好的卡**（零延迟、内容不会再变）。
        //
        // 不在这里当场读卡：读卡要翻历史，会把首屏从 350ms 拖到 800ms，而且读回来
        // 常常只是"半轮"的卡，几秒后还要被正式版替换 —— 那正是用户看到的
        // "点进会话卡片动态加载"。第一次进（没有缓存）就交给 cardRecovery 后台补，
        // 补到就记住；**第二次起这一场就是一次成型**。
        const lackingCards = missingTurnReports(foldedRows).slice(-4)
        if (lackingCards.length > 0) {
          const remembered = recallTurnReports(session.sessionId, lackingCards)
          if (remembered.length > 0) {
            foldedRows = renderRows(mergeTurnReports(foldedRows, remembered))
            for (const card of remembered) {
              if (card.turn !== undefined) cardRecoveryRef.current.confirmed.add(card.turn)
            }
          }
        }
        if (cancelled) return
        // 进会话**不画猜的交付卡**：猜卡是按工具行重建的，内容可能不全（真机：
        // 先显示 `·memory`、随后被真卡改成 `PS1restart-dsh`，看着像卡片被改来改去）。
        // 真卡的 turn/end 与 cardRecovery 从日志读到；没有真卡的回合宁可先不显示卡片，
        // 也不要在用户眼前改一次。
        // 首屏快照带着目标一起回来：与正文同一 tick 落地，不用等 mobile.goal 那一次。
        // 老宿主没有这份字段（undefined），交给 use-chat-goal 的开场刷新兜底。
        if (page.goal !== undefined) applyGoal(page.goal, page.goalActivation)
        // 还有更早的页要铺开时**先不提交**：尾页常常只有一两轮（一张卡 + 几行正文），
        // 先画它再一页页补满，用户看到的就是「先进来一张交付卡，正文随后长出来」。
        // 条件与下面的 auto-extend 完全一致：要么一次画满，要么立刻画尾页，不留半屏。
        const locatePending = initialFocusSeq !== undefined || initialFocusMessageId !== undefined
        // 宿主答了但一行都没有：这才是"真空会话"的证据。
        if (page.rows.length === 0) setEntryAnswered(true)
        const willAutoExtend = page.hasMore && !stream.autoExtended && !locatePending
        if (!willAutoExtend) {
          applyMessages(foldedRows, { allowGuessedTails: false })
          setLoading(false)
        }
        // 把**首屏完整这一份**（含交付卡）写进缓存。
        //
        // 以前缓存里存的是 host 尾页那一小份（29 行、3 张卡），于是再次进入先画 29 行、
        // 随后被网络页整份换成 114 行 —— 用户看到的就是「进去先短后长、卡片又长一遍」。
        // 这里把最终上屏的这一份存起来：下一次进入首帧就是完整画面。
        // 缓存不在这里写：这一刻只有 host 尾页那一小份（29 行），
        // 真正上屏的完整画面是自动补页之后的 114 行 —— 见下面的 debounce 写入。
        // 空页**不写** hasOlder：宿主对"刚建出来的空会话"也可能答 `hasMore=true`
        // （窗口前面还有 session/start 之类的系统事件，但一行正文都没有），
        // 写下去就是空会话里顶着一个永远点不出东西的「加载更早的消息」（真机 2026-11-14）。
        // 首屏那条空态由 `entryAnswered` 管，这里只管"更早还有没有内容"。
        if (page.rows.length > 0) setHasOlder(page.hasMore)
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
        if (willAutoExtend) {
          stream.autoExtended = true
          void (async (): Promise<void> => {
            const holder = stream.folder
            if (holder === undefined) return
            let older: RenderMessage[] = []
            // 数**屏幕上真的有几行**：holder 里是宿主行（16 条），折完可能只有 1 行。
            // 数宿主行会让 1 行的页面被判成「已够 16 行」，整个铺开循环一次都不跑（根因）。
            let loaded = renderRows(holder.snapshot()).length
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
              // 空页不结束铺开：压缩过的会话里，更早一页可能折不出行，再往前才有人工提问。

              if (rows.length === 0) {
                hasMore = olderPage.hasMore
                continue
              }
              older = [...rows, ...older]
              loaded = holder.snapshot().length + older.length
              hasMore = olderPage.hasMore
            }
            if (older.length === 0) {
              // 一页都没补到（弱网 / 本来就没有更早的）：把尾页交出去，别让骨架一直转。
              if (!cancelled) applyMessages(holder.snapshot())
              setLoading(false)
              return
            }
            holder.prepend(older)
            // 铺开的行插在尾部之上：让提交后的贴底逻辑把视野钉回最新一条。
            markFollowAfterPrepend()
            applyMessages(holder.snapshot())
            setHasOlder(hasMore)
            setLoading(false)
          })()
        }
        // loading 的落定交给真正提交行的那一方（上面两个分支），这里只管非铺开路径。
        if (!willAutoExtend) setLoading(false)
        // 回合锚点与「被打断」判定归 use-chat-stream（S7a-4）：它只写回合状态，
        // 不碰这一页的视图状态。
        noteTailPageAnchor({
          startAt: page.turnStartAt,
          lastEventAt: page.lastEventAt,
          rosterRunning: session.running === true,
          foldedRows,
        })
        // The page's projection baseline seeds the permission picker.
        // The `permissions` key is declared by the deployment's permission
        // plugin (augmentation), so the base SDK map is indexed loosely.
        // A page WITHOUT a projection block says nothing about permissions:
        // the log-tail fast path carries none, and treating that as "no
        // permissions" would blank the picker on every chat open. Only a page
        // that actually carries projections may overwrite the baseline.
        if (page.projections !== undefined) {
          const seeded = parseProjections(projectionValues(page))
          setPermissions(seeded.permissions)
          setContextPressure(seeded.contextPressure)
          setTurnOutlineRaw(seeded.turnOutline)
          if (seeded.present.has('inbox')) applyInbox(seeded.inbox)
        }
        // The buffer overflowed while waiting (oldest events were dropped):
        // refill the dropped seq window page by page, from its newest edge
        // backwards, until the whole window is covered or history ends. A
        // flat tail re-pull would only return events the fold already
        // consumed (seq <= maxSeq) and the dropped range would stay missing.
        // Best-effort: a failure here only logs, it must not replace the
        // loaded state with an error.
        if (stream.dropWindow !== undefined) {
          const gap = stream.dropWindow
          stream.dropWindow = undefined
          stream.liveBufferOverflow = false
          refillGap(gap, controller.signal, () => cancelled)
        }
      },
      (reason: unknown) => {
        stopIntentKeepAlive()
        // 临时诊断（2026-11-16）：入口页为什么被拒。
        if (cancelled) return
        // Load failed: flush the buffer so the live stream still renders.
        const buffered = stream.liveBuffer
        stream.liveBuffer = []
        stream.tailLoading = false
        if (buffered.length > 0) {
          const folder = stream.folder
          applyMessages(folder === undefined ? foldEvents(buffered) : folder.fold(buffered))
        }
        setError(errorText(reason))
        // "宿主答不了"也是一种回答：置位后让空态/错误文案能显示出来，
        // 否则会话打不开的用户会永远看骨架（既有的明确要求）。
        setEntryAnswered(true)
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

  // Live frames: fold session events for this session in as they arrive.
  //
  // 帧分发器本体已搬到 `views/chat/frame-effects.ts`（S7a-4c）：本文件只负责
  // ① 每帧先报「链路还活着」（安卓上 navigator.onLine 会撒谎，实时帧不会）；
  // ② 装配一次 ctx 交给 dispatchFrame。ctx 在 effect 里建立，捕获的是订阅那一刻的
  //    写入方 —— 与搬走前的巨型闭包语义一致；依赖数组未变，订阅频率不变。
  useEffect(() => {
    if (bridge === undefined && mux === undefined) return
    const ctx: FrameContext = {
      sessionId: session.sessionId,
      // 流 / 回合（use-chat-stream 的语义接口）
      clearHostLost,
      isRunning,
      applyTurnVerdict,
      clearActiveTurn,
      beginTurn,
      normalizeTurnEndTodo,
      reconcileRunning,
      enqueueLiveEvent,
      reloadTail,
      // 宿主时钟校准：样本窗口与偏移都是 ref，原地写
      syncHostClock: hostClock.sync,
      // 视图写入方
      shadowEvent,
      setTodo,
      adoptTodoLatest,
      refreshSubagents: () => { refreshSubagentsRef.current() },
      refreshInbox: (options?: { fresh?: boolean }) => { refreshInboxRef.current(options) },
      claimQueueHead,
      rebaselineQueueView,
      applyQueueItems,
      setJobs,
      setPermissions,
      setContextPressure,
      applyInbox,
      applyGoal,
      setGoal,
      setPendingApprovals,
      setPendingQuestions,
      answeredApprovals: answeredApprovalsFor,
      answeredQuestions: answeredQuestionsFor,
      liveClosedTurns: liveClosedTurnsRef.current,
      lastSessionEventAt: lastSessionEventAtRef,
    }
    const subscribe = bridge === undefined ? mux?.onFrame.bind(mux) : bridge.onFrame
    if (subscribe === undefined) return
    return subscribe((frame: MuxFrame, frameRpcId?: string) => {
      reportConnectivity(true)
      // 台账先记事实（这一段时间到底收到了哪些帧），再分发。出问题时它回答
      // "断在链路还是断在渲染"，而不是再猜一次（见 frame-ledger / send-no-echo）。
      recordFrame(frame)
      // 记账按**帧自己的会话**归属，且只认会改行的那种帧（`session/event` 是日志事件：
      // 消息、工具、轮次边界都在这里）。投影/队列/子任务/状态这类帧不改行 ——
      // 拿它们作废账本只会让"切回来立刻"失效，白白再读一次日志。
      if (frame.type === 'session/event') noteChatFrame(frame.sessionId)
      dispatchFrame(ctx, frame, frameRpcId)
    })
  }, [mux, bridge, session.sessionId, reconcileRunning, applyInbox])

  // 弱网兜底轮询（审批/问题）：主来源仍是 SSE 帧，这里只防丢帧。
  usePendingPoll({
    sessionId: session.sessionId,
    running,
    foreground,
    mux,
    setApprovals: setPendingApprovals,
    setQuestions: setPendingQuestions,
  })

  // 前台子代理在 use-chat-subagents.ts（宿主不转发子代理事件，只能轮询）。
  const refreshSubagentsRef = useRef<() => void>(() => {})
  const { refreshSubagents } = useChatSubagents({
    sessionId: session.sessionId,
    running,
    foreground,
    setSubagents,
    startTransition,
    refreshSubagentsRef,
  })

  // 过期轮号的失帧自愈：判据与为什么不能用「更新的用户消息」当判据，见该模块注释。
  useStaleTurnHeal({ runningTurn, messages, clearActiveTurn })

  /**
   * 一轮的秒表锚点**只许变早**（真机 2026-11-02 / 11-03 反复出现：过程条从「5分10秒」
   * 跳回「0秒」再从小往大长）。
   *
   * 放到 ChatView 而不是行内：行会在 turn/step 到位时卸载重挂（历史遗留的 key 变化），
   * 行内的记忆跟着丢，于是又跳一次 —— 这正是"修了还在跳"的原因。
   * 同一轮里后来的更晚锚点一律不采信：一轮的起点是既成事实，只可能被更准的值纠正。
   */
  const anchorMemoryRef = useSessionRef<{ turn: number | undefined; at: number } | undefined>(session.sessionId, undefined)
  // 本轮不可能早于「最后一条用户消息」：跨轮残留（上一轮的 turnStartAt / 折叠里上一轮的
  // assistant 行）在这里被一次性挡掉，之后的 min 记忆再早也早不过这个下界。
  const anchorFloor = lastUserMessageAt(messages)
  const rawClockAnchor = clampAnchorToOwnTurn(
    turnStartAt ?? (running ? newestTurnAnchor(messages) : null),
    anchorFloor,
  )
  const clockAnchor = (() => {
    if (rawClockAnchor === null || rawClockAnchor === undefined) return rawClockAnchor
    if (!running) {
      anchorMemoryRef.current = undefined
      return rawClockAnchor
    }
    const memory = anchorMemoryRef.current
    if (memory === undefined || memory.turn !== runningTurn) {
      anchorMemoryRef.current = { turn: runningTurn, at: rawClockAnchor }
      return rawClockAnchor
    }
    // 上面已经排掉了 null/undefined，这里再 ?? 一次只是为了让类型收窄（夹下界不会把值变成空）。
    const kept = clampAnchorToOwnTurn(Math.min(memory.at, rawClockAnchor), anchorFloor) ?? rawClockAnchor
    anchorMemoryRef.current = { turn: runningTurn, at: kept }
    return kept
  })()
  /**
   * 当前活跃轮次（没有活跃回合时 undefined）—— 逐层传给 MessageRow → AssistantBody
   * → ProcessGroup 的 liveTurn，行级"还在跑"判据的第三个分量。
   *
   * 门控就是整个「还在跑」的门控：输入区主键（停止 / 发送）、任务头状态条与
   * 过程条的相位都看 running，所以这里也只能看 running —— 否则会出现
   * "状态条说结束了、某张卡还在数秒"的自相矛盾。running 为假时任何行都不是
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
   * 正在跑的那一轮（来自实时流，不靠猜）。
   *
   * 渲染期直接赋值而不是放 effect 里：commitRows 常常在本拍更早的位置被调用，
   * effect 会晚一拍 —— 那一拍 openTurn 还是 undefined，"正在跑的回合"就被当成收工，
   * 猜出一张卡（真机：一进会话过程条消失 / 卡片乱冒）。
   */
  const openTurnRef = useRef<number | undefined>(undefined)
  openTurnRef.current = turnLive ? (runningTurn ?? newestFoldTurn(messages) ?? undefined) : undefined

  /**
   * 本轮的轮号：**最后一条用户消息之后**出现的那一轮。
   *
   * 用它而不是 liveTurn：liveTurn 依赖实时帧/注册，手机偶尔拿不到；而"在跑的时候
   * 本轮的交付卡不该出现"这件事，只看位置就够了。
   */
  const activeTurn = ((): number | undefined => {
    let lastUser = -1
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.kind === 'user') { lastUser = i; break }
    }
    let turn: number | undefined
    for (let i = lastUser + 1; i < messages.length; i += 1) {
      const candidate = messages[i]?.turn
      if (candidate === undefined) continue
      if (turn === undefined || candidate > turn) turn = candidate
    }
    return turn
  })()

  /**
   * 列表里**票号最大**的那一轮。
   *
   * 用途：只知道"会话在跑"、却不知道是哪一轮时（实时帧丢了、刚重连），拿它当保守的
   * "本轮"——宁可先把最新那张交付卡藏起来，也不要让"跑着的时候冒出交付卡"再发生一次。
   */
  const newestCardTurn = ((): number | undefined => {
    let turn: number | undefined
    for (const message of messages) {
      const candidate = message.turn
      if (candidate === undefined) continue
      if (turn === undefined || candidate > turn) turn = candidate
    }
    return turn
  })()

  /**
   * 正在跑的那一轮的**过程快照**：一旦展示过工具/思考/flow，就记住。
   *
   * 为什么要它：过程条是画在"行"上的，而行会在（缓存页 → 网络页 → 权威页、窗口截断）
   * 之间被整份替换。只要某一帧把带过程信息的那一行换掉，屏幕上就只剩正文和时间 ——
   * 真机反复出现的"过程条消失"。
   *
   * 这里做粘性兜底：当前行里找不到过程信息时，用快照合成一行补在末尾。
   * **展示过的东西不会再消失。**
   *
   * 定位（2026-11-01）：这是**二次防线**，不是正确性来源。
   * 正确性来源是"回合状态单一权威源"（`applyTurnVerdict` + 宿主 `turnState`）与
   * "交付卡必须有收工证据"（`closedTurnsRef`）。这份快照只在"宿主结论还没到、
   * 而行又被整份替换"的极短窗口里防止过程条闪断；一旦宿主结论到达，它就不再参与。
   */
  const liveProcSnapshotRef = useSessionRef<Map<number, {
    tools?: RenderMessage['tools']
    flow?: RenderMessage['flow']
    reasoning?: string
  }>>(session.sessionId, () => new Map())
  /** 粘性过程条：返回新对象，必须 useMemo 固定引用，否则每渲染一次就把列表的 memo 撕掉。 */
  const stickyProcRow = useMemo((): RenderMessage | undefined => {
    if (liveTurn === undefined) return undefined
    const carries = (row: RenderMessage): boolean => (
      (row.tools?.length ?? 0) > 0 || (row.flow?.length ?? 0) > 0 || (row.reasoning ?? '') !== ''
    )
    const withProc = messages.find(row => row.turn === liveTurn && carries(row))
    if (withProc !== undefined) {
      liveProcSnapshotRef.current.set(liveTurn, {
        tools: withProc.tools,
        flow: withProc.flow,
        reasoning: withProc.reasoning,
      })
      return undefined
    }
    const snapshot = liveProcSnapshotRef.current.get(liveTurn)
    if (snapshot === undefined) return undefined
    if ((snapshot.tools?.length ?? 0) === 0 && (snapshot.flow?.length ?? 0) === 0 && (snapshot.reasoning ?? '') === '') {
      return undefined
    }
    const lastRow = messages[messages.length - 1]
    return {
      id: `live-proc:${liveTurn}`,
      kind: 'assistant',
      text: '',
      turn: liveTurn,
      seq: (lastRow?.seq ?? 0) + 0.001,
      pending: true,
      ...(snapshot.tools === undefined ? {} : { tools: snapshot.tools }),
      ...(snapshot.flow === undefined ? {} : { flow: snapshot.flow }),
      ...(snapshot.reasoning === undefined ? {} : { reasoning: snapshot.reasoning }),
    } as RenderMessage
  }, [liveTurn, messages])

  /**
   * 现场取证：**正在跑的那一轮，过程卡却不在屏幕上**（只剩正文/时间）。
   *
   * 真机截图（2026-10-31 07:46 → 07:51）：同一轮先有「深度求索中 / 思考中 / 改了 1 个文件」，
   * 几分钟后只剩时间。100ms 探针没能复现，所以改成**在真机上抓现场**：只要
   * 「这一轮在跑 且 行里确实有过程内容 且 屏幕上没有过程卡」成立，就把当时的行数据
   * 写到宿主（每轮最多一次，失败静默），下次再露头就有证据。
   */
  const procVanishTurnsRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    if (liveTurn === undefined) return
    if (procVanishTurnsRef.current.has(liveTurn)) return
    const turnRows = messages.filter(row => row.turn === liveTurn)
    if (turnRows.length === 0) return
    const hasProcess = turnRows.some(row => (
      (row.tools?.length ?? 0) > 0 || (row.flow?.length ?? 0) > 0 || (row.reasoning ?? '') !== ''
    ))
    if (!hasProcess) return
    const timer = setTimeout(() => {
      if (typeof document === 'undefined') return
      if (document.querySelector('.chat-proc') !== null) return
      procVanishTurnsRef.current.add(liveTurn)
      // 复用重复卡的上报通道：形状一致（kind + rows + pairs），宿主那张错误快照能直接看。
      void reportError({
        kind: 'proc-vanish',
        sessionId: session.sessionId,
        at: Date.now(),
        rows: messages.slice(-24).map(row => ({
          id: row.id,
          kind: row.kind,
          turn: row.turn ?? null,
          step: row.step ?? null,
          seq: row.seq,
          startSeq: row.startSeq ?? null,
          pending: row.pending === true,
          textLength: (row.text ?? '').length,
          textHead: (row.text ?? '').slice(0, 40),
          toolCalls: (row.tools ?? []).map(tool => tool.callId),
        })),
        pairs: [],
      }, 'proc-vanish').catch(() => {})
    }, 400)
    return () => { clearTimeout(timer) }
  }, [messages, liveTurn, session.sessionId])
  /**
   * 秒表心跳：只有存在活跃回合、且页面可见时才跑。它每秒变的这个数会作为 prop
   * 传给"正在跑"的那几行（见 live-clock.ts）—— 于是哪怕那一行自己的定时器被
   * 浏览器冻住没回来，props 变化也照样把它叫醒，读数（渲染时取墙钟）立刻跟上。
   * 不跑的行收不到这个 prop，memo 照旧挡住它们。
   */
  /** 心跳已下沉到消息行内部（见 MessageRow 的 rowRunning），这里不再起搏。 */
  /**
   * 状态位：空闲写「空闲」，运行中写「运行中」。
   *
   * **不在这里报秒**：一屏只留一个计时（任务头状态条），运行态另有输入框右侧的
   * 红色停止键表达；这里再走一个 mm:ss 就是同一件事第三个地方。
   */
  const dockStatus = running ? '运行中' : '空闲'
  /**
   * 目标条上的进度摘要：已跑多久、走到第几步。
   *
   * 「第几步」用最新那张过程卡的步数（和过程条同一个来源），所以两处永远一致。
   */
  const goalMeta = ((): string | undefined => {
    if (goal === null || goal === undefined) return undefined
    const parts: string[] = []
    if (running && turnStartAt !== null) {
      const hostNow = hostClock.hostNow()
      const elapsed = hostNow === undefined ? 0 : hostNow - turnStartAt
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
  // 首屏绘制探针：每个会话只报一次，看屏幕上到底画出了什么。
  useCardDomProbe({
    sessionId: session.sessionId,
    usedRef: paintProbeUsedRef,
    probeRef: paintProbeRef,
    scrollRef,
    reportPerf,
  })
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
  // 换会话重置「卡片补读」与「实时关闭回合」的记忆：两个记忆都是按会话成立的。
  useCardRecoveryReset({ sessionId: session.sessionId, cardRecoveryRef, liveClosedTurnsRef })
  useEffect(() => {
    const state = cardRecoveryRef.current
    if (state.busy) { state.pending = true; return }
    const rows = renderRows(messages)
    // 两种回合要回读日志：
    // ① 这一轮现在**没有卡** —— 列表会被整份换掉好几次（缓存页 → 网络页 → 实时重放
    //    基线、往上补页），卡跟着没了；靠"补过一次就记账"会把它永久丢掉，真机就是
    //    这样「点进会话，卡片突然又消失」。
    // ② 卡在，但还没被日志确认过（页里那版是猜的）—— 读一次拿到真清单就不再读。
    const missing = new Set(missingTurnReports(rows, openTurnRef.current))
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
      if (recovered.length > 0) {
        // 记住这次读到的真卡：下次进这一场，卡就能和正文同一次提交落地，
        // 不再出现「点进会话，卡片一张张长出来」。
        rememberTurnReports(session.sessionId, recovered)
        commitRows(previous => mergeTurnReports(previous, recovered))
      }
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
  const settledOf = useCallback((message: RenderMessage): boolean => {
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
  }, [turnLive, abandonedTurn, runningTurn, messages])

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

  // Drop any pending reading timer when the view goes away: the timer only
  // drove the retired 「回到上次」 bookmark, so nothing else needs flushing.

  // Track the last message's fold key so scrolling only fires when the
  // newest message actually changes (seq bump and/or pending flip). Runs
  // after React has committed the render, so scrollHeight reflects the
  // freshly appended content.
  const lastMessageKeyRef = useSessionRef<string | undefined>(session.sessionId, undefined)
  /**
   * 上一次跟随后的内容高度。
   *
   * 最后一行的身份没变、内容高度却变了，是最常见的一种「进会话不落到底、反而往上滑
   * 一小段」：缓存页（矮）先上屏并被钉到底，网络页到了把同一批行换成更高的版本
   * （卡片补进来、markdown 展开、图片撑开），scrollTop 不动，内容在视口上方长高，
   * 画面就往上滑了。所以身份相同也要比一次高度。
   */
  // 高度比较用上一帧值（ref 由 useStickToBottom 提供）。
  const { handleScroll } = useScrollFollow({
    scrollRef, scrollTopRef, programmaticScrollRef, programmaticValueRef, programmaticAtRef,
    lastTouchAtRef, scrollStateRef, pendingRef, loadOlderRef, scrollEvent,
    setShowJumpToLatest, setCurrentTurn, deriveCurrentTurn, markSeen, hasOlder,
  })
  /** New turns that arrived while the reader was away (badge count). One
   * agent reply — however many messages and tool calls it spans — counts as
   * one, so the badge grows at reply pace, not message pace. */
  /** Highest turn the reader has seen; the unread tally counts above it. */
  const lastSeenTurnRef = useSessionRef(session.sessionId, 0)

  /**
   * 回合在跑时每 5 秒重投一次状态。
   *
   * 两个作用：① 租约续期（否则 30 秒没输入就「过期」，状态条会在跑动中消失）；
   * ② 让「卡住了」的判据有机会被重新算——没有新帧的时候，没人触发重算，
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
      const activeTurn = getRunningTurn()
      shadowEvent({
        type: 'turn',
        at,
        source: 'frame',
        running: true,
        ...(activeTurn === undefined ? {} : { turnNo: activeTurn }),
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
   * 「现在的 UI 实际显示什么」。差异只记录、不改变任何行为。
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
    // 在**未合并**的行里数：合并后的一条过程卡只留第一步的 step（合并的意义就是
    // 把多步并成一条），拿它数步序永远得到 1。folder 快照是原始行。
    const rawRows = stream.folder?.snapshot() ?? messages
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
    focusAnchorRef.current.partId = partId
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
  // ---- 会话内搜索（期 3）----
  // 走宿主的 mobile.search(sessionId)：索引里一个会话的命中是一次查询，
  // 不再把这个会话的历史翻到底。命中按 seq 升序，上一处/下一处就是数组下标。
  //
  // 界面字段收进 reducer（S1-B）：7 个 useState → 1 个。命中数组仍留在这里（它是数据
  // 不是界面态），但"搜到哪一步了"现在是一个可枚举的状态（idle / warming / busy / jumping）。
  const [searchState, searchSetters] = useChatSearch(session.sessionId)
  const { open: chatSearchOpen, term: chatSearchTerm, at: chatSearchAt, busy: chatSearchBusy, jumping: chatSearchJumping, hasMore: chatSearchHasMore, warming: chatSearchWarming, composeTick: chatSearchComposeTick } = searchState
  const { open: setChatSearchOpen, term: setChatSearchTerm, at: setChatSearchAt, busy: setChatSearchBusy, jumping: setChatSearchJumping, hasMore: setChatSearchHasMore, warming: setChatSearchWarming, composeTick: setChatSearchComposeTick } = searchSetters

  // 不再把这个会话的历史翻到底。命中按 seq 升序，上一处/下一处就是数组下标。
  const [chatSearchHits, setChatSearchHits] = useSessionState<SearchHit[]>(session.sessionId, [])
  /** 命中数组的 ref：定位收尾 effect 里要读**最新**那一份（闭包里的是旧值）。 */
  const chatSearchHitsRef = useSessionRef<SearchHit[]>(session.sessionId, [])
  chatSearchHitsRef.current = chatSearchHits
  /** 全历史一共多少处（宿主按块/处全量计数；旧宿主没有这个字段 → undefined）。 */
  const [chatSearchMatched, setChatSearchMatched] = useSessionState<number | undefined>(session.sessionId, undefined)
  /** 索引是否覆盖整个会话：false 时上面的总数只能当"至少这么多"（显示 +）。 */
  const [chatSearchComplete, setChatSearchComplete] = useSessionState<boolean>(session.sessionId, false)
  /**
   * 停止要不要二次确认。
   *
   * 运行中主键是「排队」、紧挨着一个小方块「停止」——两个都点过一次的人知道有多容易
   * 打错。破坏性动作改成两拍：第一拍把按钮变成「确认停止」，2.5 秒不动自动收回。
   */
  const chatSearchAbortRef = useSessionRef<AbortController | undefined>(session.sessionId, undefined)
  /** 上一次「上一个/下一个」真正落在哪一行、第几处：连着落在同一处时说明画面不会动。 */
  const lastChatLandingRef = useSessionRef<{ rowId: string; occurrence: number } | undefined>(session.sessionId, undefined)
  /** 定位复核代次：每次 locateSeq 递增，过期的补救回调直接作废。 */
  const locateVerifyTokenRef = useSessionRef(session.sessionId, 0)
  /** 已经为哪条命中强制翻过页（同一条不重复翻，避免来回打转）。 */
  const forcedPageKeysRef = useSessionRef<Set<string>>(session.sessionId, () => new Set())
  /** 翻页收敛监控：连续几次翻页没带来新行（宿主游标卡住），用来及时认输。 */
  const pendingTurnStallsRef = useSessionRef(session.sessionId, 0)
  const pendingTurnRowCountRef = useSessionRef(session.sessionId, -1)
  const chatSearchComposingRef = useRef(false)
  /** 搜索词的实时镜像：跳转/收尾要在回调里判断"这一行正文里真有这个词"，
   *  读 state 会拿到调用那一刻的闭包值（词换了还在用旧词）。 */
  const chatSearchTermRef = useRef('')
  chatSearchTermRef.current = chatSearchTerm.trim()

  /** D：索引补扫期间的轮询（同一个词 2 秒一查，最多 6 次）。 */
  const [chatSearchReload, setChatSearchReload] = useState(0)
  const indexPollCountRef = useRef(0)
  const indexPollTermRef = useRef('')

  /** 会话内搜索的当前词：跳过去的那一行按它做词级高亮，并把被折叠的长段展开。 */
  const chatHitQuery = chatSearchOpen ? chatSearchTerm.trim() : ''

  // 会话内搜索的**唯一坐标系**：屏幕上的高亮节点。
  //
  // 每一处命中的身份 = (messageId, partId, offsetInPart)，与宿主索引返回的
  // (messageId, partId, matchIndex) **同构**；本地匹配、索引、DOM 定位三处说的是
  // 同一件事，不再有"整行第 N 处"这种二次推算（历次错位都来自它）。
  // 计数 = matches.length；跳转 = 直接滚那一格；过程/思考不产生 mark，所以也不会被算计。
  const [chatMarkTotal, setChatMarkTotal] = useState(0)

  interface RenderedMatch { mark: HTMLElement; messageId: string; partId: string; offset: number }

  /** 这一屏渲染出来的全部高亮，按文档顺序（part 内按出现顺序编号）。 */
  const renderedMatches = useCallback((): RenderedMatch[] => {
    if (typeof document === 'undefined') return []
    const scroller = scrollRef.current
    if (scroller === undefined) return []
    const out: RenderedMatch[] = []
    const seen = new Map<Element, number>()
    for (const mark of scroller.querySelectorAll<HTMLElement>('.chat-search-mark')) {
      const row = mark.closest<HTMLElement>('[data-message-id]')
      const messageId = row?.getAttribute('data-message-id') ?? ''
      if (messageId === '' || row === null) continue
      const part = mark.closest<HTMLElement>('[data-part-id]')
      // B（2026-11-14）：与索引的 partId 严格同构 —— 索引里用户消息是 'body'、
      // 助手答案是 'answer'。用户气泡没有 data-part-id 节点，这里默认成 'body'，
      // 两端口径就完全一致，定位不再靠"同序号夹取"猜。
      const partId = part?.getAttribute('data-part-id') ?? 'body'
      const scope: Element = part ?? row
      const offset = seen.get(scope) ?? 0
      seen.set(scope, offset + 1)
      out.push({ mark, messageId, partId, offset })
    }
    return out
  }, [])

  /** 落到某一处：只给这一格加"当前"描边并滚过去。
   *
   * **不再 setFocusMsgId**：那会给整行加焦点态 → 长文自动展开/收起、交付卡重排，
   * 布局一变，刚滚过去的位置又被弹回去（真机「点上一个不动」就是这个）。
   * 搜索落点和"进入并定位"的焦点是两件事：后者才需要展开。 */
  const gotoRenderedMatch = useCallback((match: RenderedMatch | undefined, index: number): boolean => {
    if (match === undefined) return false
    setChatSearchAt(index)
    const scroll = (): void => {
      // setChatSearchAt 会重渲染（计数随状态更新），旧节点可能已被替换：这里按
      // 坐标重新找一次，再滚。找不到才退回传入的那个节点。
      const box = scrollRef.current
      if (box === undefined) return
      const again = renderedMatches().find(item =>
        item.messageId === match.messageId && item.partId === match.partId && item.offset === match.offset)
      const node = again?.mark ?? match.mark
      for (const stale of box.querySelectorAll<HTMLElement>('.chat-search-mark-active')) {
        stale.classList.remove('chat-search-mark-active')
      }
      // 同一节点连续两次命中时动画不会重播：强制回流一次再挂 class。
      // 目标本来就在视口内时没有位移，脉冲是「确实跳到了」的唯一反馈。
      void node.offsetWidth
      node.classList.add('chat-search-mark-active')
      // 不用 element.scrollIntoView：真机上它经常滚的是**外层文档**（或 smooth 被忽略），
      // 容器纹丝不动 —— 实测「点下一个高亮坐标一个像素都没变」。直接写容器的 scrollTop。
      const delta = node.getBoundingClientRect().top - box.getBoundingClientRect().top
        - box.clientHeight / 2 + node.offsetHeight / 2
      const target = Math.max(0, box.scrollTop + delta)
      if (typeof box.scrollTo === 'function') box.scrollTo({ top: target, behavior: 'smooth' })
      else box.scrollTop = target
    }
    // 双 rAF：翻页 prepend 后布局要下一帧才稳定；只等一帧会拿旧坐标算 delta，
    // 结果是"往回点却向下滚了几千像素"（真机 prev-scrolls 实测过）。
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(scroll))
    else scroll()
    return true
  }, [renderedMatches])

  /** 自动落点：就近（视口 35% 之后第一处，没有则取最后一处）。 */
  /**
   * 把一条命中（索引口径：messageId + 该处的 matchIndex）对到屏幕上的那一格。
   * 对不上返回 undefined —— 说明它还在未加载的历史里，交给翻页定位。
   *
   * 同一行有多处时**按序号对**：索引的 matchIndex 与渲染的 offset 口径不完全一致
   * （一个按文本段、一个按 part），完全相等匹配不到就夹到范围内取第 N 处，
   * 而不是一律退到该行第一处（那样连续按「下一个」会停在同一处不动）。
   *
   * C（2026-11-14）：合并行（一轮多步打包成一张卡）或 pending→final 换了 id 时，
   * messageId 对不上任何渲染行 —— 这时用 **seq 覆盖**回退找行，再把序号夹到行内范围。
   * 这是最后一道身份兜底：seq 在合并前后是稳定的。
   */
  const markOfHit = useCallback((hit: { seq?: number; messageId?: string; matchIndex?: number } | undefined): RenderedMatch | undefined => {
    if (hit === undefined) return undefined
    const wanted = hit.matchIndex ?? 0
    const fromRow = (rowId: string): RenderedMatch | undefined => {
      const inRow = renderedMatches().filter(item => item.messageId === rowId)
      if (inRow.length === 0) return undefined
      return inRow.find(item => item.offset === wanted) ?? inRow[Math.min(wanted, inRow.length - 1)]
    }
    if (hit.messageId !== undefined && hit.messageId !== '') {
      const byId = fromRow(hit.messageId)
      if (byId !== undefined) return byId
    }
    if (hit.seq !== undefined) {
      const cover = messagesRef.current.find(row => rowCoversSeq(row, hit.seq!))
      if (cover !== undefined) return fromRow(cover.id)
    }
    return undefined
  }, [renderedMatches])

  /**
   * 自动落点：在**屏幕上已经渲染**的命中里就近选一条，index 取它在 hits 里的下标。
   *
   * 以前是"先挑屏幕上的 mark，再反查它是 hits 第几条"。matchIndex（索引口径）与
   * offset（渲染口径）一旦对不上，反查就失败、退成屏幕序号 —— 于是计数显示 9/39，
   * 按「上一个」却去翻全历史第 8 处（在很早的历史里），真机就是"点了没反应"。
   * 反过来查（hits → mark）就不会错位：index 与 hits 永远同一套。
   */
  const jumpToRenderedMark = useCallback((): boolean => {
    const hits = chatSearchHits
    const scroller = scrollRef.current
    const anchor = scroller !== undefined && scroller.clientHeight > 0
      ? scroller.getBoundingClientRect().top + scroller.clientHeight * 0.35
      : undefined
    if (hits.length > 0) {
      const candidates = hits
        .map((hit, index) => ({ index, mark: markOfHit(hit) }))
        .filter((item): item is { index: number; mark: RenderedMatch } => item.mark !== undefined)
      // 一条都对不上（索引没给 messageId/seq 覆盖不到）：退回屏幕序，至少能落在一处。
      let pick = candidates[0]
      if (pick !== undefined && anchor !== undefined) {
        const tops = candidates.map(item => Math.round(item.mark.mark.getBoundingClientRect().top))
        // 几何退化（jsdom / 还没排版）：所有高亮同一纵坐标，硬挑只会落到最后一处。
        if (new Set(tops).size > 1) {
          const found = candidates.find(item => item.mark.mark.getBoundingClientRect().top >= anchor)
          pick = found ?? candidates[candidates.length - 1]!
        }
      }
      if (pick !== undefined) return gotoRenderedMatch(pick.mark, pick.index)
    }
    // 旧宿主没有逐处数据：退回屏幕序。
    const matches = renderedMatches()
    if (matches.length === 0) return false
    let index = 0
    if (anchor !== undefined) {
      const tops = matches.map(match => Math.round(match.mark.getBoundingClientRect().top))
      if (new Set(tops).size > 1) {
        const first = tops.findIndex(top => top >= anchor)
        index = first >= 0 ? first : matches.length - 1
      }
    }
    return gotoRenderedMatch(matches[index], index)
  }, [chatSearchHits, gotoRenderedMatch, markOfHit, renderedMatches])

  /** 「上一个/下一个」：在屏幕上真实存在的高亮之间走一格（同一行内也逐格走）。 */
  const stepRenderedMark = useCallback((direction: 'next' | 'prev'): boolean => {
    const matches = renderedMatches()
    if (matches.length === 0) return false
    const current = Math.min(Math.max(chatSearchAt, 0), matches.length - 1)
    const index = direction === 'next'
      ? (current + 1) % matches.length
      : (current - 1 + matches.length) % matches.length
    return gotoRenderedMatch(matches[index], index)
  }, [chatSearchAt, gotoRenderedMatch, renderedMatches])

  /**
   * 搜索条上的计数：**屏幕上渲染出来的高亮**当分子主体。
   * - 分母：宿主给了全历史总数（C 版）就用它，否则用屏幕高亮数；
   * - `+`：索引覆盖不完整（数不全）时才有，表示"还有没数到的"。
   */
  const searchView = useMemo(() => {
    const rendered = chatMarkTotal
    // 计数口径 = **屏幕上的高亮**（分母也是它）：屏幕上有几处就显示几处，
    // 与画面一一对应、绝不含过程/思考/工具（那些不产生 mark）。
    // 屏幕之外还有命中（索引总数更大）时，分母带 `+` 说明"还有没显示出来的"。
    const external = Math.max(
      typeof chatSearchMatched === 'number' ? chatSearchMatched : 0,
      chatSearchHits.length,
    )
    if (rendered === 0) {
      return { hits: external, at: -1, more: external > 0 && chatSearchComplete !== true }
    }
    return {
      hits: rendered,
      at: Math.min(Math.max(chatSearchAt, 0), rendered - 1),
      more: external > rendered || chatSearchComplete !== true,
    }
  }, [chatMarkTotal, chatSearchAt, chatSearchMatched, chatSearchComplete, chatSearchHits.length])

  /** 首页点进来时，把落点对齐到用户点的那一处（按渲染出来的坐标找）。 */
  const markIndexForIntent = useCallback((matches: readonly RenderedMatch[], intent: { messageId?: string; seq?: number }): number => {
    if (intent.messageId !== undefined && intent.messageId !== '') {
      const byId = matches.findIndex(match => match.messageId === intent.messageId)
      if (byId >= 0) return byId
    }
    if (intent.seq !== undefined) {
      const bySeq = matches.findIndex(match => {
        const row = match.mark.closest<HTMLElement>('[data-message-id]')
        const seq = Number(row?.getAttribute('data-row-seq') ?? Number.NaN)
        return Number.isFinite(seq) && seq >= (intent.seq ?? 0)
      })
      if (bySeq >= 0) return bySeq
    }
    return 0
  }, [])

  /** 高亮渲染出来之后：同步计数，并按意图对齐或就近自动跳一次（每个词只跳一次）。 */
  const autoJumpedTermRef = useRef('')
  useEffect(() => {
    const term = chatHitQuery
    if (term === '') {
      autoJumpedTermRef.current = ''
      setChatMarkTotal(0)
      return
    }
    const matches = renderedMatches()
    setChatMarkTotal(matches.length)
    if (matches.length === 0) return
    if (autoJumpedTermRef.current === term) {
      // 翻页/展开让总数变了：只修正越界下标，不再抢焦点。
      // 上界必须是**索引处数**（hits），不是屏幕 mark 数：窗口只渲染了部分消息时
      // （屏幕 10 处、索引 14 处），拿 matches.length 夹会把 index 从 10 压到 9，
      // 点一次「上一个」看起来退了两格（真机 12/14 → 10/14）。
      const total = Math.max(chatSearchHits.length, matches.length)
      if (chatSearchAt > total - 1) setChatSearchAt(total - 1)
      return
    }
    autoJumpedTermRef.current = term
    const intent = locateIntentFor(session.sessionId)
    if (intent !== undefined && (intent.query ?? '').trim() === term) {
      const aligned = markIndexForIntent(matches, intent)
      gotoRenderedMatch(matches[aligned], aligned)
      return
    }
    jumpToRenderedMark()
  }, [chatHitQuery, chatSearchAt, chatSearchHits.length, messages, renderedMatches, gotoRenderedMatch, jumpToRenderedMark, markIndexForIntent, session.sessionId])

  /**
   * 计数跟着 DOM 变：渲染是分批的（先一行、再整段、再展开），只靠"词变了"那一次
   * effect 记总数会停在中间某个数（真机 4 处却被显示成 1 处）。这里直接盯
   * `.chat-search-mark` 的增删，DOM 里几个就记几个 —— 与屏幕永远同源。
   */
  useEffect(() => {
    if (chatHitQuery === '') {
      setChatMarkTotal(0)
      return
    }
    const sync = (): void => {
      setChatMarkTotal(previous => {
        const next = renderedMatches().length
        return previous === next ? previous : next
      })
    }
    sync()
    const scroller = scrollRef.current
    if (scroller === undefined || typeof MutationObserver === 'undefined') return
    // 性能：不要监听 characterData（流式输出时每个 delta 都会触发），
    // 也不要每次变化都 setState —— 用一帧合并一次，且数值没变就不写状态。
    // 之前是「任何 DOM 变化 → 重算 + setState → ChatView 重渲染」，
    // 搜索面板开着滑动时就是满屏重渲染（真机「上下滑动很卡」）。
    let scheduled = false
    const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        sync()
      })
    }
    const observer = new MutationObserver(schedule)
    observer.observe(scroller, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [chatHitQuery, renderedMatches])

  /**
   * 「上一个」在边界触发的那次翻页落地了：落到**新增区域的最早一处**。
   * （翻页把更早的行 prepend 进来，matches[0] 就是那条更早的命中 —— 15/29 点上一个
   * 应该是 14/29 这一侧，而不是绕回 29/29。）
   */
  useEffect(() => {
    if (!pendingPrevPageRef.current) return
    const matches = renderedMatches()
    if (matches.length === 0) return
    pendingPrevPageRef.current = false
    // 让"每个词自动跳一次"的记账保持，避免自动落点再抢一次焦点。
    autoJumpedTermRef.current = chatHitQuery
    gotoRenderedMatch(matches[0], 0)
  }, [messages, chatHitQuery, renderedMatches, gotoRenderedMatch])

  // 行匹配判据搬进 `chat-search-match.ts`（W3-3）：这里只保留一个把「宿主原始页」
  // 绑上去的包装，调用点的签名保持不变。
  const rowIndexOfHit = useCallback((
    list: readonly RenderMessage[],
    seq: number,
    messageId?: string,
    snippet?: string,
  ): number => searchRowIndexOfHit(list, { seq, messageId, snippet }, rawPageRef.current, seqRowIndex), [])
  /** 跳到第 n 个命中：在已加载窗口里直接定位，否则先把那一页翻进来。 */
  const gotoChatHit = useCallback((hits: readonly { seq: number; partId?: string; messageId?: string; snippet?: string; paragraph?: string; matchIndex?: number }[], at: number, direction: 'next' | 'prev' | 'jump' = 'next'): void => {
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
    /*
     * DOM 快通道（2026-11-11 真机：「很多情况下自动定位不到正确位置」）。
     *
     * 上一层的算法是「索引给一个 seq → 推算它在哪一轮、行内第几处、滚过去」。
     * 只要有一环认不出来（合并卡、窗口边界、同一行多处命中），它就只能降级：
     * 要么翻页把视口带走，要么就近亮一个——实测 5 个词 15 次点击里 4 次
     * 「点了下一个，视口里一个高亮都没有」，单命中词甚至会因为回绕被翻页带到别处。
     *
     * 但屏幕上**已经渲染出来的 <mark> 就是用户看到的东西**：只要这一屏里有这个词，
     * 「下一个/上一个」就该在它们之间走一步，不需要推算。所以先试这里：
     * 接管成功就直接返回，认不出来（词在更早历史里、或整卡折叠着）才落到下面的索引逻辑。
     */
    // 2026-11-13 系统性收口：**屏幕上的高亮只由 gotoRenderedMatch 处理**
    // （坐标 = messageId/partId/partOffset，直接滚那一格）。这里只剩"屏幕上找不到
    // 这一处 → 翻页把它载进来"这一条路，不再有第三套"按几何挑下一个 mark"的机制。
    const landed = landingOf(hit, at)
    const hitKey = `${hit.messageId ?? `seq:${hit.seq}`}#${hit.partId ?? ''}#${hit.matchIndex ?? ''}`
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
      // A（2026-11-14）：落地行已经确定，先按**身份**（messageId + 第几处）在屏幕
      // 上找那一格；找到就直接滚它，不再走 locateSeq 的"整行第 N 处"。
      // 跨"已加载 / 未加载"边界时，老坐标会差一处 —— 这就是"跳了但落偏"的残留。
      const identityMark = markOfHit(hit)
      if (identityMark !== undefined) {
        setChatSearchAt(at)
        gotoRenderedMatch(identityMark, at)
        return
      }
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
      // 行内第几处 = 这一行里**比它更早的命中**有几条（landingOf 数的就是这个）。
      // 宿主现在按"处"回命中（一段里同一个词出现几次就是几条），所以这个数就是屏幕
      // 上第几个 <mark>；以前按索引的 matchIndex（段内第几处）取，合并卡里会串到别处
      // —— 真机「点了下一个，高亮跳到同一格」。
      const occurrence = landed.occurrence
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

  /**
   * 「下一个」：屏幕上的命中之间逐格走，走到末位回绕到第一处。
   * （末位之外没有"更新的"内容，回绕只在眼前循环，不会跳到别处。）
   */
  /**
   * 「下一个/上一个」：沿**索引序列**（全历史逐处）走一格。
   *
   * chatSearchAt 是唯一状态：= 第几处命中（0 起）。计数与跳转都用它，
   * 不再用「屏幕 mark 下标 + 偏移」拼数字（那套在边界上必然错位：8/34 按上一个会算出 34/34）。
   * 目标在屏幕上就直接滚，没加载就交给翻页，落地后按身份对齐。
   */
  const stepSearchHit = useCallback((direction: 'next' | 'prev'): void => {
    // 导航口径与计数同源：只在**屏幕上的高亮**之间走（一定动、一定一格）。
    // 屏幕外的命中不参与上下步进 —— 那要靠翻页把那一页载进来（用户按到边界时）。
    const matches = renderedMatches()
    if (matches.length === 0) return
    const current = Math.min(Math.max(chatSearchAt, 0), matches.length - 1)
    const next = direction === 'next'
      ? (current + 1) % matches.length
      : (current - 1 + matches.length) % matches.length
    gotoRenderedMatch(matches[next], next)
  }, [chatSearchAt, gotoRenderedMatch, renderedMatches])

  const stepSearchNext = useCallback((): void => {
    stepSearchHit('next')
  }, [stepSearchHit])

  /**
   * 「上一个」：第 1 处再按一次 = 更早还有历史就翻页（8/34 → 7/34 那一侧）；
   * 真的到头才回绕到最后一处。
   */
  const stepSearchPrev = useCallback((): void => {
    const matches = renderedMatches()
    if (matches.length === 0) return
    const current = Math.min(Math.max(chatSearchAt, 0), matches.length - 1)
    if (current === 0) {
      // 屏幕第一处再往回：还有更早的历史就翻一页（有"载入中…"），否则回绕到末处。
      if (hasOlder) {
        pendingPrevPageRef.current = true
        loadOlderRef.current(false)
        window.setTimeout(() => { pendingPrevPageRef.current = false }, 4_000)
        return
      }
      stepSearchHit('prev')
      return
    }
    stepSearchHit('prev')
  }, [chatSearchAt, hasOlder, renderedMatches, stepSearchHit])

  // 预取「下一条命中」那一页。
  //
  // 命中在窗口里时跳转是本地活儿（实测 60~90ms）；不在窗口里就得现场读一页历史：
  // 宿主折页、把页首对齐到回合开头、序列化回来，再在手机上折叠插入 —— 真机体感就是
  // "这一下卡住了"（实测一处 1.2s，手机上更久）。落地之后闲着的时候把下一页取回来
  // 放着，用户真按「下一个」时直接命中缓存，只花折叠 + 滚动的钱。
  useEffect(() => {
    // 屏幕上有高亮时"下一个"走的是它们，`chatSearchAt` 不是宿主下标，预取无从谈起。
    if (chatMarkTotal > 0) return
    if (chatSearchHits.length === 0) return
    const next = chatSearchHits[Math.max(chatSearchAt, 0) + 1]
    if (next === undefined || next.seq < 0) return
    const beforeSeq = next.seq + 1
    if (pageCacheRef.current.has(beforeSeq)) return
    if (messagesRef.current.some(row => rowCoversSeq(row, next.seq))) return
    const isCurrentSession = captureSessionGuard()
    const cache = pageCacheRef.current
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (pendingRef.current || cache.has(beforeSeq)) return
      void loadChatPage(session.sessionId, beforeSeq, controller.signal, undefined, undefined, JUMP_PAGE_ROWS).then(
        page => {
          if (!controller.signal.aborted && isCurrentSession() && cache === pageCacheRef.current) cache.set(beforeSeq, page)
        },
        () => undefined,
      )
    }, 500)
    return () => {
      clearTimeout(timer)
      controller.abort(new DOMException('history prefetch cancelled', 'AbortError'))
    }
  }, [chatSearchAt, chatSearchHits, chatMarkTotal, session.sessionId, captureSessionGuard])

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
      setChatSearchMatched(undefined)
      setChatSearchComplete(false)
      return
    }
    if (chatSearchComposingRef.current) return
    setChatSearchBusy(true)
    // 自动落点不在这里做：高亮要等下一次渲染（chat-rows 收到词）才出现在 DOM 里，
    // 由上面那个「高亮渲染出来之后」的 effect 统一落点（含首页意图对齐）。
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
          // 归一化（丢无 seq / 去重 / 升序）见 chat-search-match.ts：重复行会让计数器
          // 从 4/50 走到 5/50，而目标还是同一行同一处。
          const hits = normalizeSearchHits(result.items ?? [])
          setChatSearchHits(hits)
          setChatSearchHasMore(result.hasMore === true)
          // 全历史计数（C 版）：索引覆盖不完整时只能当"至少这么多"，客户端显示 +。
          setChatSearchMatched(typeof result.matchedTotal === 'number' ? result.matchedTotal : undefined)
          setChatSearchComplete(result.indexComplete === true)
          // D：索引还在补扫（分母带 +）时，过 2 秒带着同一个词再查一次，最多 6 次；
          // 每轮宿主会推进一批页，补完 complete=true，`+` 自己就消失了。
          if (result.indexComplete !== true) {
            if (indexPollTermRef.current !== term) {
              indexPollTermRef.current = term
              indexPollCountRef.current = 0
            }
            if (indexPollCountRef.current < 6) {
              indexPollCountRef.current += 1
              window.setTimeout(() => { setChatSearchReload(previous => previous + 1) }, 2_000)
            }
          }
          // 屏幕上已经有高亮：计数与跳转都由 DOM 负责，这里只补"还有多少"。
          if (renderedMatches().length > 0) return
          // 屏幕上一处都没有（词只在更早的历史里）：才需要去未加载区翻页找。
          if (hits.length > 0) {
            const intent = locateIntentFor(session.sessionId)
            const alignedHost = alignHitIndex(hits, intent, term)
            gotoChatHit(hits, alignedHost >= 0 ? alignedHost : 0, 'jump')
          }
        },
        () => {
          if (!controller.signal.aborted) setChatSearchBusy(false)
          setChatSearchJumping(false)
        },
      )
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [chatSearchTerm, chatSearchComposeTick, chatSearchReload, session.sessionId, gotoChatHit, renderedMatches])
  /** Jump to a turn from the outline sheet or the scrubber: in-window turns
   *  scroll in place; turns outside the loaded window page the target's rows in
   *  first, then the pending effect below finishes the locate.
   *
   *  The page cursor is the NEXT turn's boundary, not this turn's own seq: the
   *  host pages END at the requested beforeSeq, and a turn's seq is its
   *  turn/start boundary — asking for it fetches everything BEFORE the turn and
   *  never the turn itself. The next boundary lands this turn's rows instead. */
  /** 大纲页选中轮次后调用（在本函数定义之后注册，避免 TDZ 与依赖顺序问题）。 */
  const jumpToTurnRef = useRef<((entry: TurnEntry) => void) | undefined>(undefined)
  const jumpToTurn = useCallback((entry: TurnEntry): void => {
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
  jumpToTurnRef.current = jumpToTurn

  /** 大纲页选中的轮次：行到位后跳过去，然后通知外部清空请求。 */
  const consumedTurnKeyRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (pendingTurn === undefined) {
      consumedTurnKeyRef.current = undefined
      return
    }
    if (messages.length === 0) return
    const key = `${pendingTurn.turn}:${pendingTurn.seq}`
    if (consumedTurnKeyRef.current === key) return
    consumedTurnKeyRef.current = key
    jumpToTurnRef.current?.({ turn: pendingTurn.turn, seq: pendingTurn.seq, prompt: '', response: '', loaded: true })
    onPendingTurnConsumed?.()
  }, [pendingTurn, messages.length, onPendingTurnConsumed])

  const jumpToTurnNumber = useCallback((turn: number): void => {
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
      onOpenOutline?.(turnEntries, shownTurn)
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
    if (index >= 0) {
      // seq = -1 是"只知道轮次号"的跳转：这一轮自己的锚点就是它的行。
      const found = messagesRef.current[index]
      const wantedPartId = pendingTurnPartIdRef.current
      // 行内第几处要按**当前列表**重算：翻页那一刻只知道"这条命中在它自己那段里第几处"，
      // 落到合并卡上要数这一行里比它更早的命中才等于屏幕上的第几个高亮。
      const pendingAt = pendingTurnAtRef.current
      const searchHits = chatSearchHitsRef.current
      let wantedOccurrence = pendingTurnOccurrenceRef.current
      if (pendingAt !== undefined && searchHits.length > 0) {
        let occurrence = 0
        for (let i = 0; i < pendingAt; i += 1) {
          const candidate = searchHits[i]
          if (candidate === undefined) continue
          const rowIndex = rowIndexOfHit(messagesRef.current, candidate.seq, candidate.messageId, candidate.snippet)
          if (rowIndex === index) occurrence += 1
        }
        wantedOccurrence = occurrence
      }
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
  // 订阅收进 ui/hooks/use-keyboard-inset（W2-5）：与 toast 定位共用同一套视口事件。
  useKeyboardInset(() => {
    if (!autoScroll) return
    if (!mayAutoPin(scrollStateRef.current, Date.now())) return
    scrollToBottom()
  })

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

  /**
   * 审批卡片「展开参数」用的原文（同 callId 的 tool/call.arguments）。
   *
   * 预览那行固定 120 字，`pnpm build && curl … | sh` 会被截在管道之前 —— 用户
   * 看到的是一条无害的构建命令。展开区给原文，宿主侧已经在 8 KB 截断。
   */
  const approvalArgsOf = useCallback((approval: PendingApproval): string | undefined => {
    if (approval.callId === undefined) return undefined
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const tools = messages[i]!.tools
      if (tools === undefined) continue
      const hit = tools.find(tool => tool.callId === approval.callId)
      if (hit !== undefined) {
        const text = hit.arguments
        if (typeof text !== 'string' || text.trim() === '') return undefined
        return text.length > APPROVAL_ARGS_LIMIT ? text.slice(0, APPROVAL_ARGS_LIMIT) : text
      }
    }
    return undefined
  }, [messages])

  // 菜单打开时 3 秒无操作或按 Esc 收起（键盘场景下背景点击够不到）。
  useMessageMenuDismiss({ open: ctxMenu !== undefined, close: () => { setCtxMenu(undefined) } })

  /** Quote a message: the composer shows a quote bar and the send prepends
   * the reference context (first 200 chars are enough for the agent). */
  const quoteIntoComposer = useCallback((text: string): void => {
    setQuoted(text.slice(0, 200))
  }, [])

  /** 发出到轮次开跑之间这段窗口的防连点闸门。 */
  const regenerateInFlightRef = useSessionRef(session.sessionId, false)
  /** 「会新增一条回答」这句只提示一次，不常驻界面。 */
  const regenerateHintShownRef = useSessionRef(session.sessionId, false)
  /** 发出去但一轮没起来的兜底复位。 */
  const regenerateWatchdogRef = useSessionRef<ReturnType<typeof setTimeout> | undefined>(session.sessionId, undefined)

  /** Regenerate the last assistant reply: ask the agent to re-answer the user
   *  question that immediately preceded it. The session is append-only, so
   *  this goes out as a fresh prompt (the old reply stays in history); the
   *  wording tells the model to set it aside and answer anew. */

  /**
   * 发送 / 队列 / 插话状态机（S8a 搬出到 views/chat/use-composer.ts）：只把作曲区
   * 当前的输入/附件/命令交进去拿回 send 一族动作；主键判据由 `ComposerSection` 现算。
   */
  const { handleRegenerate, runCommand } = useChatActions({
    sessionId: session.sessionId,
    mux,
    toast,
    setError,
    errorText,
    reloadTail,
    messagesRef,
    setRegenerateState,
    regenerateInFlightRef,
    regenerateHintShownRef,
    regenerateWatchdogRef,
  })

  /** 幽灵用户行（2026-11-14）：点发送后、宿主回执前先画"我说的那句话"，且**不进 rows**。 */
  const [outgoing, setOutgoing] = useSessionState<OutgoingFlight | undefined>(session.sessionId, undefined)

  const {
    send, sendEditedMessage, claimCommand, releaseCommand, flushQueue,
  } = useChatComposer({
    sessionId: session.sessionId, mux, offline, runningRef,
    getInput: draftControl.get, setInput, attachImages, setAttachImages, attachFiles, setAttachFiles,
    uploadingFiles, quoted, setQuoted, claimedCommand, setClaimedCommand, getSending, setSending,
    commands, shadowEvent, refreshInbox, refreshGoal, runCommand, removeDraft,
    setError, mountedRef,
    focusComposer: () => { requestAnimationFrame(() => { composerRef.current?.focus() }) },
    clearEditMessage: () => { setEditMessage(undefined) },
    onOutgoing: flight => {
      setOutgoing(flight)
      // 发送 = 明确的「跟最新」意图（2026-11-17）：把跟随锁存打开。不开的话
      // `mayAutoPin`（stream/scroll-machine.ts:175）一直返回 false，新回合的行按读者
      // 上一处历史位置落进行窗口之外，窗口只画 spacer —— 真机表现是「正文没显示 +
      // 下方一大段空白」。回执（acceptedAt 已带）与撤销（undefined）不触发。
      if (flight === undefined || flight.acceptedAt !== undefined) return
      scrollEvent({ type: 'stick-on', at: Date.now() })
      // scrollToBottom 内部已经发 `pin`，这里再发一次反而让状态与真实 gap 短暂不一致。
      scrollToBottom()
    },
  })

  /**
   * 发送后的三态（2026-11-14，对齐业界 `submitted` 态）：
   *
   * | 态 | 判据 | UI |
   * |---|---|---|
   * | 幽灵行 | 已点发送、宿主那条用户行还没到（8 秒内） | 自己那句话 + 「已送出」 |
   * | **等待输出** | 宿主用户行已到（或已回执），本轮还没有任何输出 | **「已送达 · 等待模型响应…」** |
   * | 正常 | 本轮出现过程内容/正文 | 过程条接管，占位消失 |
   *
   * 第二态就是以前完全空着的那段（实测 13.6 秒）：旧实现的占位在宿主行到达时就被认领撤掉。
   */
  const sendView = useMemo((): { ghost?: OutgoingFlight; awaiting?: true } => {
    if (outgoing === undefined) return {}
    const wanted = normalizeInsertText(outgoing.text)
    const landed = messages.slice(-40).some(row => row.kind === 'user' && normalizeInsertText(row.text) === wanted)
    if (messages.some(hasModelOutput)) return {}
    const ghost = landed || outgoing.ghostExpired === true ? undefined : outgoing
    const accepted = landed || outgoing.acceptedAt !== undefined
    // 防闪：回执后 300ms 内开始的输出不该让占位闪一下（短于感知阈值的等待不值得画）。
    const ready = landed || outgoing.awaitingReady === true
    return {
      ...(ghost === undefined ? {} : { ghost }),
      ...(accepted && ready ? { awaiting: true as const } : {}),
    }
  }, [outgoing, messages])

  /** 等待态的防闪阈值：回执后 300ms 才允许显示。 */
  useEffect(() => {
    if (outgoing === undefined || outgoing.acceptedAt === undefined || outgoing.awaitingReady === true) return
    const wait = Math.max(0, 300 - (Date.now() - outgoing.acceptedAt))
    const timer = window.setTimeout(() => {
      setOutgoing(previous => (previous === undefined ? undefined : { ...previous, awaitingReady: true }))
    }, wait)
    return () => { window.clearTimeout(timer) }
  }, [outgoing?.id, outgoing?.acceptedAt, outgoing?.awaitingReady, setOutgoing])

  /** 幽灵行 8 秒兜底（**真定时器**：旧实现只依赖 messages 变化，宿主不发帧时永远不到期）。 */
  useEffect(() => {
    if (outgoing === undefined || outgoing.acceptedAt !== undefined) return
    const timer = window.setTimeout(() => {
      setOutgoing(previous => (previous === undefined ? undefined : { ...previous, ghostExpired: true }))
    }, OUTGOING_TTL_MS)
    return () => { window.clearTimeout(timer) }
  }, [outgoing?.id, outgoing?.acceptedAt, setOutgoing])

  /**
   * 「发出去了却没回音」看门狗（2026-11-15 受控实验之后加的）。
   *
   * 判据只有一件事：6 秒内宿主那条用户行没有落地。到点就记现场（`send-no-echo`，
   * 内容是整份帧台账 → 一眼看出帧到没到）并 `reloadTail()`：尾页走普通 HTTP，不受
   * 实时链路（宿主按设备过滤 / 断流 / 闸门）影响，内容当场回来，不用重开 PWA。
   * 18 秒再补一次（宿主可能刚把这条写进日志）。
   */
  useEffect(() => {
    if (outgoing === undefined) return
    const sent = outgoing
    let reported = false
    const check = (): void => {
      const wanted = normalizeInsertText(sent.text)
      if (messagesRef.current.slice(-40).some(row => row.kind === 'user' && normalizeInsertText(row.text) === wanted)) return
      if (!reported) {
        reported = true
        const ledger = ledgerSnapshot()
        void reportProbe?.('send-no-echo', {
          sessionId: session.sessionId,
          textLength: sent.text.length,
          rows: messagesRef.current.length,
          localSeq: chatStream.stream.folder?.lastSeq ?? -1,
          batched: chatStream.stream.eventBatch.length,
          sseLive: mux?.isSseLive?.() === true,
          accepted: sent.acceptedAt !== undefined,
          tailLoading: chatStream.stream.tailLoading,
          visible: typeof document === 'undefined' || document.visibilityState === 'visible',
          // 判据：这里有 user/message → 帧到了、问题在渲染；没有 → 帧没到、问题在链路。
          frames: ledger.frames,
          framesRotated: ledger.rotated,
        }).catch(() => { /* 上报尽力而为 */ })
      }
      reloadTail()
    }
    const first = window.setTimeout(check, SEND_ECHO_GRACE_MS)
    const second = window.setTimeout(check, SEND_ECHO_GRACE_MS * 3)
    return () => {
      window.clearTimeout(first)
      window.clearTimeout(second)
    }
  }, [outgoing?.id, reloadTail])

  /** 等待态兜底：模型排队/长上下文也不能让占位永久赖在屏幕上。 */
  useEffect(() => {
    if (outgoing === undefined) return
    const deadline = (outgoing.acceptedAt ?? outgoing.at) + AWAITING_TTL_MS
    const timer = window.setTimeout(() => { setOutgoing(undefined) }, Math.max(1_000, deadline - Date.now()))
    return () => { window.clearTimeout(timer) }
  }, [outgoing?.id, outgoing?.acceptedAt, setOutgoing])

  useChatOutboxFlush(offline, flushQueue)

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
          // 参数不再展开在行内（详情面板 C1 里才有），长按菜单从 data-step-args 读。
          ...(stepRow.getAttribute('data-step-args') === null
            ? {}
            : { command: stepRow.getAttribute('data-step-args') ?? '' }),
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
  // 长按菜单的手势计时器（W2-5 抽成 ui/hooks/use-long-press：可单独测、可复用）。
  const { start: startLongPress, cancel: cancelLongPress } = useLongPress({
    onLongPress: (target, x, y) => { openCtxFromTarget(target, x, y) },
  })
  // 原生选区优先：一旦浏览器真的开始选字（哪怕我们 500ms 的定时器已经排上队），
  // 立刻撤掉长按与自定义菜单，让用户能拖手柄、用系统菜单复制片段。
  useNativeSelection({ setCtxMenu, cancelLongPress })

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
    if (onOpenDiffRef.current !== undefined) {
      onOpenDiffRef.current(path)
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

  // Focus-locate (search-hit open): scroll the chat to the row covering the
  // target message seq once it loads, paging back a bounded number of times
  // when the row sits in older history. One highlight per open; a target
  // that never surfaces gives up silently (the chat stays at the tail).
  // 一次「带定位打开」的目标：5 个字段同生同灭（重臂一起写、落点一起清），
  // 合成一个对象后重臂只有一处赋值，不会漏清某个字段。
  const focusAnchorRef = useSessionRef<{
    seq?: number
    messageId?: string
    partId?: string
    turn?: number
    step?: number
  }>(session.sessionId, {
    ...(initialFocusSeq === undefined ? {} : { seq: initialFocusSeq }),
    ...(initialFocusMessageId === undefined ? {} : { messageId: initialFocusMessageId }),
    ...(initialFocusPartId === undefined ? {} : { partId: initialFocusPartId }),
    ...(initialFocusTurn === undefined ? {} : { turn: initialFocusTurn }),
    ...(initialFocusStep === undefined ? {} : { step: initialFocusStep }),
  })

  /** 这一条命中是该片段里的第几处（同一段里同一个词出现多次时对位 <mark>）。 */
  const focusOccurrenceRef = useSessionRef(session.sessionId, 0)
  const focusAttemptsRef = useSessionRef(session.sessionId, 0)
  /** Whether the deep-history locate already jumped straight to the target's
   *  page (one RPC) instead of paging back one page at a time. */
  const focusJumpedRef = useSessionRef(session.sessionId, false)
  const [focusMsgId, setFocusMsgId] = useSessionState<string | undefined>(session.sessionId, undefined)
  /** The located step seq, paired with focusMsgId for the post-render scroll. */
  const focusTargetRef = useSessionRef<number | undefined>(session.sessionId, undefined)
  /** True when the locate anchor is the ROW itself, not a step/search mark inside
   *  it (turn jumps): the row `data-message-id` is the prompt row, while the seq
   *  we match by belongs to the answer row below it — resolving `[data-step-seq]`
   *  would scroll to the answer and hide the question again. */
  const focusRowFirstRef = useSessionRef(session.sessionId, false)
  /** One-shot guard: scroll to the located step exactly once per open. */
  const focusScrolledRef = useSessionRef(session.sessionId, false)
  /** 收尾校准的令牌：新的定位开始时作废上一次还在排队的校准。 */
  const locateSettleRef = useSessionRef(session.sessionId, 0)
  /** 这次"带定位打开"已经处理完（落到了行，或确认翻不到）：它是一次性意图，
   *  不能再跟着 `messages` 的每一次变化重跑。
   *
   *  以前这个 effect 没有一次性闸门，`focusMessageIdRef` 又永不清空，于是每次列表
   *  变化（翻一页、会话内搜索跳一处）都把焦点和落点重新抢回"打开时那一条命中"。
   *  会话内连按「下一个」时真机表现就是：pending 已经把焦点挪到新命中，下一拍又被
   *  拽回开场那条（可视区里一个高亮都没有，focusId 永远是开场那条）。 */
  const openLocateDoneRef = useRef(false)  /** 标题命中只提示一次，别每帧弹。 */
  const titleOnlyToastRef = useSessionRef(session.sessionId, false)
  /** True while a search-locate has resolved its target row but has not yet
   *  scrolled the anchor into view. During this window the opening tail-pin /
   *  windowed re-locate must stand down — otherwise they repurpose the render
   *  window to the tail and window the located row OUT of the DOM, so the
   *  anchor never surfaces and the locate silently fails (intermittent
   *  "search shows it but I can't see it" on long, windowed sessions). */
  const locatingRef = useRef(false)
  // 会话页实例跨会话复用（App 的渲染容器不按会话换 key）：定位状态除了随新的
  // 定位目标重臂，还必须随**会话**重臂 —— 否则 A 的 locating 锁/一次性闸门会挡下
  // B 的定位。所以会话 id 也在依赖里。
  useEffect(() => {
    // 首页搜索点进来的会话：props 里可能一路丢干净（转场双挂载 / 同一路由重挂载），
    // 意图表里那份是最后一道兜底 —— 少了它就只剩"滚到附近、一个字不高亮"。
    const rearmSeq = initialFocusSeq ?? locateIntent?.seq
    const rearmMessageId = initialFocusMessageId ?? locateIntent?.messageId
    const rearmPartId = initialFocusPartId ?? locateIntent?.partId
    const rearmTurn = initialFocusTurn ?? locateIntent?.turn
    const rearmStep = initialFocusStep ?? locateIntent?.step
    // 整体替换（不是逐字段赋值）：上一次目标的残留字段必须一起消失。
    focusAnchorRef.current = {
      ...(rearmSeq === undefined ? {} : { seq: rearmSeq }),
      ...(rearmMessageId === undefined ? {} : { messageId: rearmMessageId }),
      ...(rearmPartId === undefined ? {} : { partId: rearmPartId }),
      ...(rearmTurn === undefined ? {} : { turn: rearmTurn }),
      ...(rearmStep === undefined ? {} : { step: rearmStep }),
    }
    focusAttemptsRef.current = 0
    focusJumpedRef.current = false
    focusTargetRef.current = undefined
    focusRowFirstRef.current = false
    focusScrolledRef.current = false
    openLocateDoneRef.current = false
    scrollEvent({ type: 'locate-end' })
    programmaticScrollRef.current = false
    locatingRef.current = initialFocusSeq !== undefined || initialFocusMessageId !== undefined
      || initialFocusPartId !== undefined || initialFocusTurn !== undefined
    setFocusMsgId(undefined)
  }, [initialFocusSeq, initialFocusMessageId, initialFocusPartId, initialFocusTurn, initialFocusStep, initialFocusQuery, session.sessionId])
  // 从首页搜索点进来：把会话内搜索一起打开并填好词。少了这一步，用户进来只有
  // 一次性的高亮、搜索框是空的 —— 计数不显示，也没法接着按「上一个/下一个」。
  // 只认**意图表**里的那份（props 的 initialFocusQuery 是普通「进入并定位」路径，
  // 那条路径本来就不该弹出搜索框）。
  const searchPrefillRef = useRef('')
  // 带关键词进来时预填搜索框（只认意图表里的 query，不认 props 的 initialFocusQuery）。
  useSearchPrefill({
    sessionId: session.sessionId,
    prefillRef: searchPrefillRef,
    setOpen: setChatSearchOpen,
    setTerm: setChatSearchTerm,
  })
  useEffect(() => {
    // 每帧现取：useMemo 一旦在意图写入之前跑过，就永远缓存 undefined（表现为
    // 「第一次进有高亮、之后同样的点击没有」）。
    const liveIntent = locateIntentFor(session.sessionId)
    const target = focusAnchorRef.current.seq ?? liveIntent?.seq
    const targetMessageId = focusAnchorRef.current.messageId ?? liveIntent?.messageId
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
      const wanted = focusAnchorRef.current.partId
      if (wanted === undefined) return true
      /*
       * **宿主的索引给的是"角色"，不是真实 part id**（`host/search-text.ts`）：
       * 用户气泡正文标 `body`、助手回答标 `answer`，只有带 answerSeq 的行才会给真正的坐标。
       *
       * 2026-11-12 用户：「搜索匹配定位，自动跳转这个问题」。实测搜「排队」点了第一条命中，
       * 进会话后停在最底部、`.chat-msg-focus` 一个都没有 —— 因为这里拿 `'body'` 去和
       * `flow[].partId`（真实 id）逐个比，**必然 false**，于是已经精确命中的 messageId
       * 被自己否掉（stableRowIndex 变 -1），只能退回 seq 匹配；seq 一旦错位就整条放弃，
       * 放弃后普通跟随逻辑接管，视口沉到底部。
       *
       * 现在先把这两个角色词认出来，再退回真实 part id 的比较。
       */
      if (wanted === 'body') return message.kind === 'user'
      if (wanted === 'answer') return message.kind === 'assistant'
      return message.flow?.some(part => part.kind === 'text' && part.partId === wanted) === true
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
    // 第三锚点：结构坐标查表（2026-11-12）。messageId 在跨页合并后会与渲染行对不上、
    // seq 也会漂移，但「第 N 轮第 M 步」始终指向同一行 —— 宿主索引新加的 turn/step
    // 两列就是为这一格。仍要求含关键词，否则落点行没有高亮。
    const turnStepRowIndex = focusAnchorRef.current.turn === undefined
      ? -1
      : messagesNow.findIndex(message =>
        message.turn === focusAnchorRef.current.turn
        && (focusAnchorRef.current.step === undefined || message.step === focusAnchorRef.current.step)
        && queryMatches(message))
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
    const rowIndex = stableRowIndex >= 0
      ? stableRowIndex
      : turnStepRowIndex >= 0
        ? turnStepRowIndex
        : seqRowIndex >= 0
          ? seqRowIndex
          : queryFallbackIndex
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
    if (markableIndex < 0) {
      /*
       * **一行都没到 ≠ 找不到**（2026-11-12 用户：「搜索匹配定位，自动跳转这个问题」）。
       *
       * 真机日志抓到的时序：
       *   [locate] {rows:0, loading:false, done:false}   ← 首屏数据还没落地
       *   [locate] {rows:9, loading:false, done:true }   ← 已经放弃，9 行到了也不跳
       * 第一拍 `markableIndex` 必然是 -1，而 `hasOlder` 也还是 false（连第一页都没有），
       * 于是直接掉进下面的"放弃"分支：`openLocateDoneRef = true` 把这次定位锁死，
       * 数据随后到达也不会再定位一次 —— 视口就这么停在普通跟随逻辑钉的底部，
       * 一个 `.chat-msg-focus` 都没有（实测 focusCount=0、nearBottom=true）。
       *
       * 没有一行数据时**保留这次定位意图**直接返回：等首屏到达后本 effect 会再跑一次
       * （依赖里有 messages），那时才有资格判断"找得到 / 找不到"。
       */
      // 目标不在当前窗口：问无状态的 `decideMiss` 要动作。它与原 if 链逐条等价，
      // 但不持有跨渲染状态（有状态版在这个组件里活不过一次重挂载），且有测试。
      const action = decideMiss({
        rows: messagesNow.length,
        hasOlder,
        attempts: focusAttemptsRef.current,
        maxAttempts: FOCUS_MAX_PAGES,
        pending: pendingRef.current === true,
        ...(target === undefined ? {} : { jumpSeq: target }),
        jumped: focusJumpedRef.current,
      })
      // 一行都没有 ≠ 找不到：等首屏到达后本 effect 会再跑一次（依赖里有 messages）。
      if (action.type === 'wait') return
      if (action.type === 'fetch') {
        focusAttemptsRef.current += 1
        // 深历史命中第一次直跳目标页；之后一页页往前翻（反复跳同一页会原地打转）。
        if (action.jump !== undefined) {
          focusJumpedRef.current = true
          loadOlderRef.current(true, action.jump)
        } else {
          loadOlderRef.current(true)
        }
        return
      }
      // Give up on this locate: release the window guard so the normal follower
      // (locateWindow / pinToRealBottom) is not left permanently blocked —
      // otherwise every later scroll in this session stops relocating the
      // window and the chat appears frozen mid-history.
      // 有明确目标却全篇找不到关键词：不是"跳偏了"，是这条命中不在这段日志里
      // （会话被编辑/删除，或索引落后）。明说，别让用户以为定位成功了。
      if (query !== '' && rowIndex >= 0) toast('未能在当前日志定位到这条命中')
      focusAnchorRef.current.seq = undefined
      openLocateDoneRef.current = true
      locatingRef.current = false
      scrollEvent({ type: 'locate-end' })
      return
    }
    focusAnchorRef.current.seq = undefined
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
      // 定位是**远离底部**的一次滚动：先把这个意图告诉状态机，免得同一次
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
        const wantedPartId = focusAnchorRef.current.partId ?? initialFocusPartId
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
          // 判定抽到 chat/lib/locate-landing.ts（纯函数、13 条测试）：
          // containerHeight<=0 的「布局未稳」、正常贴顶、滚到头时放宽，三种情形
          // 都在那儿钉住了，这里只按结论分派。
          const verdict = judgeLanding({
            anchorTop: aTop,
            anchorHeight: anchor.getBoundingClientRect().height,
            containerTop: cTop,
            containerHeight: cH,
            scrollTop: el2b.scrollTop,
            scrollHeight: el2b.scrollHeight,
            topGap: LOCATE_TOP_GAP,
            tolerancePx: LOCATE_TOLERANCE_PX,
          })
          // If the container reports no viewport height the layout is still
          // unstable (or jsdom gives 0) — trust the scroll rather than report a
          // false miss and hammer the retry loop.
          if (verdict === 'unstable') {
            focusScrolledRef.current = true
            locatingRef.current = false
            return
          }
          if (verdict === 'landed') {
            // 落点真的在视口里。**不要在这里清意图**：转场里聊天页可能挂两个
            // 实例，先成功的那个把意图清掉，真正显示的那个就再也拿不到关键词，
            // 于是「定位成功、一个字都不高亮」。靠 TTL 自然过期。
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
          if (tries < LOCATE_MAX_FIXES) {
            tries += 1
            setScrollTopProgrammatically(el2b, Math.max(0, el2b.scrollTop + delta))
            requestAnimationFrame(run)
            return
          }
          // 补偿失败时的兜底：先把目标行本身滚进视口（至少让用户看到那一行），
          // 诊断只进控制台 —— 正式界面不弹内部数字（真机截图里那行「定位未成功(共…条…)"
          // 就是它，用户只会以为出错了）。
          const fallbackRow = el2b.querySelector<HTMLElement>(`[data-message-id="${escapeAttr(focusMsgId)}"]`)
          if (fallbackRow !== null && typeof fallbackRow.scrollIntoView === 'function') {
            fallbackRow.scrollIntoView({ block: 'center' })
          }
          console.warn('[locate] settle failed', {
            rows: messages.length,
            landed,
            scrollTop: el2b.scrollTop,
            scrollHeight: el2b.scrollHeight,
          })
          focusScrolledRef.current = true
          locatingRef.current = false
        })
      }
      // Run synchronously inside the layout effect (before paint) so the layout
      // is the committed windowed one; the verify step still re-runs on later
      // frames if a competing effect pushed the row back off-screen.
      run()
    }
    // 只判「渲染行在不在」——不再重算一遍锚点（2026-11-12）。原来的 findAnchor()
    // 把 run() 里的解析又抄了一遍且判据不一致（一个看全行第一个 mark + initialFocusPartId，
    // 一个看第 N 处 + focusPartIdRef），两套漂移就是「探测说在、执行时找不到」。
    const rowRendered = (): boolean => {
      const el2 = scrollRef.current
      if (el2 === undefined) return false
      return el2.querySelector(`[data-message-id="${escapeAttr(focusMsgId)}"]`) !== null
    }
    if (rowRendered()) {
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

  /* ── voice input ── 实现见 views/chat/use-chat-voice.ts（S4b 从本文件搬出） ── */

  /**
   * Stop the active turn (desktop parity: the composer's primary button
   * becomes a stop button while running). The turn/end frame arriving over
   * mux flips the button back; a failed request surfaces through the chat
   * error line.
   */
  const stopTurn = useCallback(() => {
    if (chat.store.getState().stopping) return
    setStopping(true)
    void cancelSession(session.sessionId).then(
      () => {
        setStopping(false)
        // 按了停止要给一句回应：以前只有底部状态行消失，用户不知道是停了还是崩了
        // （2026-11-01 真机：按停止后界面上什么都没发生，只能再看一遍列表）。
        toast('已停止这一轮')
      },
      (reason: unknown) => {
        setStopping(false)
        setError(errorText(reason))
      },
    )
  }, [chat.store, session.sessionId])

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

  /** 面板底部的两个详情入口：先关面板，再把宿主页面的数据交出去。 */
  const openContextPage = (): void => {
    if (onOpenContext === undefined || contextUsage === undefined) return
    setComposerPanelOpen(false)
    onOpenContext({ contextWindow: contextUsage.window, pressureTokens: contextUsage.pressure })
  }
  const openApprovalPage = (): void => {
    if (onOpenApprovalMode === undefined || permissions === undefined) return
    setComposerPanelOpen(false)
    onOpenApprovalMode(permissions)
  }

  /* ── 元信息胶囊里的「模型与权限」面板 ──────────────────────────────── */
  const loadModelCatalog = useCallback(() => {
    setModelCatalog(previous => previous.status === 'ready' ? previous : { status: 'loading' })
    void models(session.sessionId).then(
      (data) => { setModelCatalog({ status: 'ready', data }) },
      (reason: unknown) => { setModelCatalog({ status: 'error', message: errorText(reason) }) },
    )
  }, [session.sessionId])

  /**
   * 元信息胶囊：两颗 chip 各管一摊（2026-11-12 用户要求模型 / 权限分开）。
   *
   * 记住"现在开的是哪块"：同一颗再点= 关，换一颗= 切过去（不叠加两块面板）。
   * 打开时只拉这块面板需要的数据，不为了改权限去拉整个模型目录。
   */
  const [composerPanel, setComposerPanel] = useSessionState<'model' | 'permission' | null>(session.sessionId, null)
  const toggleComposerPanel = (which: 'model' | 'permission'): void => {
    const same = composerPanelOpen && composerPanel === which
    setComposerPanel(same ? null : which)
    setComposerPanelOpen(!same)
    if (same) return
    if (which === 'permission' && permissions === undefined) requestPermissionsOnce()
    if (which === 'model' && modelCatalog.status === 'idle') loadModelCatalog()
  }

  /** 拉一次会话投影（权限档位在这里面）。
   *
   *  尾页快速通道带不回权限：那组投影来自宿主的会话枚举，冷启动/深链进来时
   *  枚举还没跑过，手机就没有基线，权限按钮整块不渲染——用户看到的就是"权限
   *  面板消失了"。按钮现在总是显示，缺数据时点它就地补一次。 */
  const requestPermissionsOnce = useCallback((): void => {
    if (permissionPullRef.current) return
    permissionPullRef.current = true
    void pullProjections(session.sessionId).then(
      (pulled) => {
        permissionPullRef.current = false
        if (pulled.present.size === 0) return
        setPermissions(pulled.permissions)
        setContextPressure(pulled.contextPressure)
        setTurnOutlineRaw(pulled.turnOutline)
      },
      (reason: unknown) => {
        permissionPullRef.current = false
        setError(errorText(reason))
      },
    )
  }, [session.sessionId])

  /** One-shot model switch from the panel; the capsule label follows the result. */
  const applyModel = useCallback((selection: { provider: string; model: string; reasoningEffort?: string }): void => {
    if (pickerBusy) return
    setPickerBusy(true)
    void selectModel(session.sessionId, selection).then(
      (result) => {
        setPickerBusy(false)
        setCurrentModel(result.selected)
        setComposerPanelOpen(false)
      },
      (reason: unknown) => {
        setPickerBusy(false)
        setError(errorText(reason))
      },
    )
  }, [pickerBusy, session.sessionId])

  /** One-shot permission switch. Full access never applies directly — it
   *  funnels through the confirmation sheet, never a silent switch. */
  /** 权限档位以宿主为准。
   *
   *  手机上点完档位会先写一个乐观值（立刻反馈），但宿主可能对档位做归一化、也可能
   *  这次切换根本没落盘；投影帧是"变了才推"，一旦那帧丢了，药丸就会停在手机自己
   *  编的档位上，用户下次点开选择器看到"选了却没生效"。所以动作成功后再问一次投影，
   *  让宿主的答案覆盖乐观值。
   */
  const syncPermissionsFromHost = useCallback((): void => {
    void pullProjections(session.sessionId).then(
      (pulled) => {
        if (pulled.present.has('permissions')) setPermissions(pulled.permissions)
      },
      () => undefined,
    )
  }, [session.sessionId])

  const applyPermission = useCallback((next: string): void => {
    if (next === permissions?.currentValue) {
      setComposerPanelOpen(false)
      return
    }
    if (next === 'danger-full-access') {
      setComposerPanelOpen(false)
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
        setComposerPanelOpen(false)
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
  const lastTailKeyRef = useSessionRef<string | undefined>(session.sessionId, undefined)
  const lastRowCountRef = useSessionRef(session.sessionId, 0)
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

  // 卸载时清掉两个计时器（阅读位置防抖 / 重新生成看门狗）——漏一个的后果相同。
  useChatTimerCleanup({ readingTimerRef, regenerateWatchdogRef })

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
  const lastMessageId = messages[messages.length - 1]?.id
  const regenerateFor = useCallback((message: RenderMessage): (() => void) | undefined =>
    offersRegenerate({
      isLastMessage: message.id === lastMessageId,
      isAssistant: message.kind === 'assistant',
      pending: message.pending === true,
      turnLive,
      // 失败回合的尾行也给下一步动（2026-11-10）：它没有可重生成的 assistant
      // 行，`handleRegenerate` 会自己往回找到那条提问再重发。
      retryableTurn: message.kind === 'turn' && message.failed === true,
    })
      ? () => handleRegenerate(message)
      : undefined, [lastMessageId, turnLive, handleRegenerate])

  /** 行级回调（引用稳定，契约见 chat-rows 的 memo 与 chat-rows-memo.test.tsx）。 */
  const { rowOfInterrupted, isRowRunningOf, openFileOf } = useRowCallbacks({
    abandonedTurn, liveTurn, settledOf, isRowRunning, onOpenDiff, setPreviewPath,
  })

  // 消息区的触摸/右键手势（S3-A 搬出）：四种手势互相抢夺，规则集中在一处。
  const gestures = useScrollGestures({
    pinchRef, pinchDistance, applyPinch, startLongPress, cancelLongPress, openCtxFromTarget,
  })

  // 更多菜单里「这一轮的产物」：只在菜单打开时算（流式时每帧都扫一遍消息不值得）。
  const moreTurns = moreOpen ? collectArtifacts(messages) : []
  const moreArtifactCount = moreTurns[0]?.files.length ?? 0

  return (
    <div className="chat">
      <ChatHeader
        onOpenDrawer={onOpenDrawer === undefined ? undefined : () => { onOpenDrawer(collectArtifacts(messages)) }}
        onBack={onBack}
        {...(workspaceName === undefined ? {} : { workspaceName })}
        title={title}
        onMore={() => { setMoreOpen(true) }}
        {...(runBadgeBits(todo, jobs, subagents).length === 0 ? {} : {
          run: <RunBadge todo={todo} jobs={jobs} subagents={subagents} onOpen={() => { setRunStatusOpen(true) }} />,
        })}
      />
      <OfflineBanner offline={offline} />
      <ChatSearchBar
        open={chatSearchOpen}
        term={chatSearchTerm}
        setTerm={setChatSearchTerm}
        composingRef={chatSearchComposingRef}
        onCompositionEnded={() => { setChatSearchComposeTick(tick => tick + 1) }}
        busy={chatSearchBusy}
        warming={chatSearchWarming}
        hits={searchView.hits}
        at={searchView.at}
        hasMore={searchView.more}
        jumping={chatSearchJumping}
        onPrev={() => { stepSearchPrev() }}
        onNext={() => { stepSearchNext() }}
        onClose={() => { setChatSearchOpen(false); setChatSearchTerm('') }}
      />
      {error !== undefined && <p className="mobile-error mobile-pad">{error}</p>}
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
        {...gestures}
      >
        <ChatRows
          messages={messages}
          {...(delivery === undefined ? {} : { delivery })}
          {...(sendView.ghost === undefined ? {} : { outgoing: sendView.ghost })}
          {...(sendView.awaiting === true ? { awaitingOutput: true } : {})}
          sessionId={session.sessionId}
          showToolCalls={showToolCalls}
          showSystemMessages={showSystemMessages}
          hostNowMs={hostNowIdle} hostNow={hostClock.hostNow} goal={goal?.objective}
          clockAnchor={clockAnchor ?? undefined}
          liveTurn={liveTurn}
          settledOf={settledOf}
          isRowRunning={isRowRunningOf}
          timeFlags={timeFlags}
          running={running}
          runningKnown={verdictKnown}
          activeTurn={activeTurn}
          newestCardTurn={newestCardTurn}
          hasClosedTurn={hasClosedTurn}
          rowOfInterrupted={rowOfInterrupted}
          rowKeyOf={messageKey}
          estimateHeight={estimateMessageHeight}
          focusMsgId={focusMsgId}
          chatHitQuery={chatHitQuery}
          effectiveFocusQuery={effectiveFocusQuery}
          regenerateFor={regenerateFor}
          stickyProcRow={stickyProcRow}
          hasOlder={hasOlder}
          loading={loading}
          olderLoading={olderLoading}
          entryAnswered={entryAnswered}
          loadOlder={loadOlder}
          onOpenFile={openFileOf}
          {...(onOpenDelivery === undefined ? {} : { onOpenDelivery })}
        />
        <ChatAttentionPanels
          sessionId={session.sessionId}
          approvals={pendingApprovals}
          questions={pendingQuestions}
          previewOf={approvalPreviewOf}
          argsOf={approvalArgsOf}
          onOpenApproval={onOpenApproval}
          onApprovalResolved={(id) => {
            noteAnsweredApproval(session.sessionId, id)
            setPendingApprovals(prev => prev.filter(a => a.approvalId !== id))
          }}
          onQuestionResolved={(rpcId) => {
            noteAnsweredQuestion(session.sessionId, rpcId)
            setPendingQuestions(prev => prev.filter(q => q.rpcId !== rpcId))
          }}
        />
        <JumpControls
          show={showJumpToLatest}
          hasTurns={turnEntries.length >= 2}
          scrubbing={scrubIndex !== undefined}
          shownTurn={shownTurn}
          maxTurn={maxTurn}
          unreadCount={unreadCount}
          onScrubDown={startScrub}
          onScrubMove={moveScrub}
          onScrubUp={endScrub}
          onScrubCancel={cancelScrub}
          onOpenTurnList={() => { onOpenOutline?.(turnEntries, shownTurn) }}
          onJumpLatest={jumpToLatest}
        />
      </div>
      {/* 排队已移到底栏（输入行上方）；目标是「为什么在跑」，状态是「跑到哪了」。 */}
      {/*
       * 会话 HUD：顶部这一组状态条的唯一渲染点。
       *
       * 顺序固定为「为什么在跑（目标）→ 跑到哪了（任务）」——队列条属于底栏，
       * 不再混进这里。容器是 `display: contents`，纯结构、不产生新的布局盒。
       */}
      <SessionHud
        goal={<GoalBar goal={bars.goalBar !== undefined ? goal : undefined} busy={goalBusy} onCommand={handleGoalCommand} {...(goalMeta === undefined ? {} : { meta: goalMeta })} />}
        status={finishedElsewhere === undefined ? undefined : (
          <FinishedElsewhereBar
            title={finishedElsewhere.title}
            status={finishedElsewhere.status}
            durationMs={finishedElsewhere.durationMs}
            onOpen={() => { onOpenFinished?.(finishedElsewhere.sessionId) }}
            onDismiss={() => { onDismissFinished?.() }}
          />
        )}
      />
      {scrubIndex !== undefined && maxTurn >= 2 && (
        <TurnScrubber entries={turnEntries} index={scrubIndex} total={maxTurn} />
      )}

      {runStatusOpen && (
        <RunStatusSheet
          todo={todo}
          jobs={jobs}
          subagents={subagents}
          {...(onOpenSubagent === undefined ? {} : { onOpenSubagent })}
          onClose={() => { setRunStatusOpen(false) }}
        />
      )}
      {/* C 案底栏：队列条 → 输入行 → 元信息行。模型与权限面板浮在整块底栏之上。 */}
      <div className="chat-dock">
        <ComposerSection
          draft={{ sessionId: session.sessionId, quoted, setQuoted }}
          attachments={{
            attachImages,
            setAttachImages,
            attachFiles,
            setAttachFiles,
            retryStaged,
            addImage,
          }}
          commands={{
            commands,
            claimedCommand,
            claimCommand,
            releaseCommand,
            setPlusOpen,
          }}
          turn={{
            running,
            stopArmed,
            setStopArmed,
            store: chat.store,
            stopTurn,
            send,
          }}
          inputBox={{ composerRef, mobileEnterToSend }}
          voice={{
            open: voiceOpen,
            phase: voicePhase,
            partial: voicePartial,
            elapsed: voiceElapsed,
            statusText: voiceStatus.text,
            waveRef: voiceWaveRef,
            start: openVoice,
            finish: finishVoice,
            cancel: closeVoice,
          }}
          queue={{
            detail: [
              <QueueCard
                key="queue"
                sessionId={session.sessionId}
                items={queueItems}
                running={running}
                onEdit={handleQueueEdit}
                onRemove={handleQueueRemove}
                onSteer={handleQueueSteer}
                onWithdraw={handleQueueWithdraw}
              />,
            ],
          }}
        />
        <ComposerMeta
          currentModel={currentModel}
          permissions={permissions}
          modelCatalog={modelCatalog}
          contextUsage={contextUsage}
          panelOpen={composerPanelOpen}
          panel={composerPanel}
          statusText={dockStatus}
          pickerBusy={pickerBusy}
          togglePanel={toggleComposerPanel}
          closePanel={() => { setComposerPanelOpen(false); setComposerPanel(null) }}
          loadModelCatalog={loadModelCatalog}
          applyModel={applyModel}
          applyPermission={applyPermission}
          staleHint={staleHostHint}
          /* 「更多」模块已删（2026-11-12 用户要求）；压缩上下文改由圆环弹窗直接发 /compact。*/
          onCompact={() => { void sendCommand(session.sessionId, '/compact') }}
        />
      </div>
      {plusOpen && (
        <PlusSheet
          onPickImage={() => { setPlusOpen(false); openPicker('image') }}
          onPickCamera={() => { setPlusOpen(false); openPicker('camera') }}
          onPickFiles={(picked) => { setPlusOpen(false); addFiles(picked) }}
          onPickHostFile={() => { setPlusOpen(false); setHostFileOpen(true) }}
          onOpenCommands={() => { setPlusOpen(false); setCommandOpen(true) }}
          onClose={() => { setPlusOpen(false) }}
        />
      )}
      <ChatInputSheets
        hostFileOpen={hostFileOpen}
        closeHostFile={() => { setHostFileOpen(false) }}
        cwd={session.cwd}
        appendReference={(path) => {
          // 引用而不是搬运：把宿主路径写进输入框，agent 按路径读，不上传字节。
          setInput(previous => {
            const trimmed = previous.replace(/\s+$/u, '')
            const ref = `@${path}`
            return trimmed === '' ? `${ref} ` : `${trimmed} ${ref} `
          })
        }}
        notify={toast}
        commandOpen={commandOpen}
        closeCommand={() => { setCommandOpen(false) }}
        commands={commands}
        claimCommand={claimCommand}
        quotePathForReference={quotePathForReference}
      />

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
      <ChatOverlays
        filePreview={previewPath !== null ? { path: previewPath, sessionId: session.sessionId, onClose: () => { setPreviewPath(null) } } : undefined}
        lightbox={lightboxSrc !== null ? { src: lightboxSrc, alt: '聊天图片', onClose: () => { setLightboxSrc(null) } } : undefined}
        sessionSheets={{
          moreOpen, setMoreOpen, exportOpen, setExportOpen,
          artifactCount: moreArtifactCount,
          onOpenArtifacts: onOpenArtifacts === undefined ? undefined : () => { onOpenArtifacts(moreTurns) },
          onToggleSearch: () => {
            setChatSearchOpen(open => !open)
            setChatSearchTerm('')
          },
          onOpenSettings,
          onOpenTasks,
          onCopyExport: copyExport, onDownloadExport: downloadExport, onDownloadLongImage: downloadLongImage,
        }}
        messageMenu={{
          menu: ctxMenu, openedAtRef: ctxMenuOpenedAtRef,
          onClose: () => { setCtxMenu(undefined) },
          onCopy: (text, message) => { void copyText(text, message) },
          onShare: (text) => { void shareText(text) },
          onQuote: quoteIntoComposer, onSelectText: selectTextBlock,
          onEdit: setEditMessage, edit: editMessage,
          onCancelEdit: () => { setEditMessage(undefined) },
          onConfirmEdit: (value) => {
            const target = editMessage
            if (target !== undefined) sendEditedMessage(target.messageId, value)
          },
        }}
      />
    </div>
  )
}

/* ── bottom sheets ───────────────────────────────────────────────────── */

/* Shared sheet chrome lives in ../sheet.tsx; the pickers below compose it. */

