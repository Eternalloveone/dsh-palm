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

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'
import { loadHistory, prompt, type SessionView } from './App.tsx'
import { errorText, staleHostHint } from './App.tsx'
import { fetchMobilePreferences, models, renameSession, selectModel, sendCommand, cancelSession, fetchPending, listCommands, transcribeVoice, type CommandDescriptor } from '../api.ts'
import type { SessionModels } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import type { PendingApproval, PendingQuestionItem } from '../api.ts'
import { buildPromptParts, compressImageFile, imageFromClipboard, MAX_ATTACHED_IMAGES, type AttachedImage, type PromptPart } from '../image.ts'
import { coalesceTurnMessages, EventFolder, foldEvents, type RenderMessage, type WireEvent } from '../messages.ts'

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
import { copyText, openFilePath } from '../code-actions.ts'
import { MuxClient } from '../mux.ts'
import { ThemeToggle } from '../theme-toggle.tsx'
import { getAutoScroll } from '../display-prefs.ts'
import { timeVisibility } from '../ui-text.ts'
import { enqueuePrompt, flushOutbox, listOutbox } from '../offline.ts'
import { startVoiceRecording, voiceSupported, type VoiceRecording } from '../voice-input.ts'
import { getVoiceServices } from '../voice-services.ts'
import { toast } from '../toast.tsx'
import { Sheet } from '../sheet.tsx'
import { PromptDialog } from '../dialog.tsx'
import { CheckIcon, CloseIcon, MicIcon, ModelIcon, MoreIcon, PencilIcon, PlusIcon, SendIcon, ShieldIcon } from '../icons.tsx'
import { MessageRow } from '../message-row.tsx'
import { LONG_TEXT_LIMIT, LONG_TEXT_PREVIEW } from '../markdown-text.tsx'
import { ApprovalPanel, ModelSheet, PermissionSheet, PlusSheet, QuestionPanel, parsePermissionSelect, type PermissionSelectValue } from '../sheets.tsx'

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
 * Distance from the bottom (px) within which streaming output still auto-follows.
 * A reader who scrolled farther up than this is left alone while new chunks
 * arrive.
 */
export const BOTTOM_FOLLOW_THRESHOLD_PX = 80

/** Pending-item poll cadence while the SSE stream is delivering (safety net only). */
export const PENDING_POLL_IDLE_MS = 15_000
/** Pending-item poll cadence while the SSE stream is stalled (fast coverage). */
export const PENDING_POLL_FAST_MS = 1_500

/** Ceiling for one "load older messages" request before it aborts and errors. */
export const LOAD_OLDER_TIMEOUT_MS = 15_000

/* ── windowed rendering (long sessions) ────────────────────────────────
   Below the threshold the list renders in full (the common case and the
   one every existing test exercises). Past it, only the messages around the
   scroll position render, with estimated-height spacers above and below.
   The estimate is deliberately coarse — the overscan absorbs the error and
   every scroll re-locates from the scroll position, so errors never
   accumulate into drift. */

/** Message count above which the chat renders windowed instead of in full. */
export const WINDOW_THRESHOLD = 120
/** Messages rendered ahead of / behind the located row. */
export const WINDOW_OVERSCAN = 20
/** Target visible message rows per window. */
export const WINDOW_VISIBLE = 24

/** Estimated line height of one rendered message row (px). */
const ESTIMATE_LINE_HEIGHT = 22
/** Approximate CJK-friendly characters per line on a phone-width column. */
const ESTIMATE_CHARS_PER_LINE = 38
/** Rows a collapsed long message clamps to (matches chat-md-collapsed). */
const ESTIMATE_MAX_LINES = 12
/**
 * Fixed prefix height for a STREAMING (pending) row. Its real height grows
 * every chunk, so measuring it (or estimating from its growing text) would
 * drift the prefix sum and make the located window edge walk backwards —
 * unmounting already-rendered paragraphs above. A stable placeholder keeps
 * the window pinned; the row is measured once it settles.
 */
const PENDING_ROW_ESTIMATE = 96

/** Estimate one message row's rendered height in px (spacers use this). */
export function estimateMessageHeight(message: RenderMessage): number {
  if (message.kind === 'user') {
    const lines = Math.max(1, Math.ceil(message.text.length / ESTIMATE_CHARS_PER_LINE))
    return 28 + lines * ESTIMATE_LINE_HEIGHT
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

/** Extract the raw event from one history entry, carrying the host-computed
 * presentation view (if any) beside it so the fold can surface diff cards. */
function eventOf(entry: { event: WireEvent; view?: unknown }): WireEvent {
  return entry.view === undefined ? entry.event : { ...entry.event, view: entry.view }
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
export function ChatView({ session, mux, onBack, showToolCalls, showSystemMessages }: ChatViewProps) {
  const [messages, setMessages] = useState<RenderMessage[]>([])

  /**
   * Surface-state wrapper for setMessages: coalesce consecutive same-turn
   * assistant step rows (each model step emits its own assistant/message —
   * a busy turn would otherwise fill a history tail page with step rows and
   * push the real prior conversation, code fences included, out of view).
   */
  const applyMessages = (rows: RenderMessage[]): void => { setMessages(coalesceTurnMessages(rows)) }
  const [hasOlder, setHasOlder] = useState(false)
  // Latest loadOlder (the tail-load effect's closure is stale by the time the
  // page lands); the auto-extend on open calls through this ref. Assigned
  // after the useCallback below (TDZ).
  const loadOlderRef = useRef<(silent?: boolean) => void>(() => {})
  // One silent auto-extend per session open (see the tail-load effect).
  const autoExtendedRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement | undefined>(undefined)
  const pendingRef = useRef(false)
  // Windowed rendering: prefix sum of estimated row heights over `messages`,
  // rebuilt when the list changes (undefined below the window threshold).
  const prefixRef = useRef<number[] | undefined>(undefined)
  // Live mirror of `messages` for the rAF locate callback: the callback may
  // run long after it was scheduled (a first-frame rAF can outlive the tail
  // load), so it must read the CURRENT list, not the one its closure was
  // created with.
  const messagesRef = useRef(messages)
  const [win, setWin] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  const rafRef = useRef<number | undefined>(undefined)
  const scrollTopRef = useRef(0)
  // The bottom gap at the USER's last gesture (recorded on every scroll
  // event). Passive content growth — a pending message finalizing into
  // taller markdown, an appended reply — changes scrollHeight without firing
  // a scroll event, so this snapshot keeps its gesture-time truth: the
  // follower never mistakes a content-driven height change for "user scrolled
  // up". Programmatic writes (scrollToBottom) land at the bottom (gap 0) and
  // are equally harmless.
  const bottomGapAtUserScrollRef = useRef(0)
  // Windowed-height correction: real content height minus the estimated
  // prefix sum, measured on the last full (non-windowed) render frame. The
  // windowed DOM's scrollHeight is an estimate (spacers stand in for
  // unrendered rows); adding this correction to the top spacer makes the
  // real total height match, so scrolling reaches the true bottom. Zero in
  // jsdom (no layout) and below the window threshold.
  const heightCorrectionRef = useRef(0)
  // Measured real heights of rendered rows (messageId → px). Windowed mode
  // measures every rendered row after commit and blends the real heights
  // into the prefix sum, so the estimate only stands in for rows that are
  // not currently on screen. Zero in jsdom (no layout) — the estimate path
  // stays authoritative there.
  const measuredRef = useRef<Map<string, number>>(new Map())
  const [measuredTick, setMeasuredTick] = useState(0)
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
  /** Which bottom sheet is open. */
  const [sheet, setSheet] = useState<'model' | 'permission' | null>(null)
  /** Which in-place quick picker strip is open below the toolbar. */
  const [picker, setPicker] = useState<'model' | 'permission' | null>(null)
  /** Whether the context-usage popover (ring tap) is open. */
  const [contextOpen, setContextOpen] = useState(false)
  /** In-flight guard for one-shot picker actions. */
  const [pickerBusy, setPickerBusy] = useState(false)
  /** Lazily cached model directory backing the quick picker (fresh per open
   *  until it loads once; the full sheet re-fetches on its own). */
  const [modelCatalog, setModelCatalog] = useState<ModelPickerCatalog>({ status: 'idle' })
  /** Model-picker search query (reset on open; filter-as-you-type). */
  const [modelQuery, setModelQuery] = useState('')
  /** Whether the composer's + menu is open (图片 / 命令). */
  const [plusOpen, setPlusOpen] = useState(false)
  /** Images picked or pasted into the composer, awaiting send (community-style attach). */
  const [attachImages, setAttachImages] = useState<AttachedImage[]>([])
  /** Hidden file chooser backing the + menu's 图片 entry. */
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  /** Host slash-command directory (fetched lazily when the + menu opens). */
  const [commands, setCommands] = useState<CommandDescriptor[] | undefined>(undefined)
  /** Quoted message (context bar above the composer; sent as a blockquote preamble). */
  const [quoted, setQuoted] = useState<string | undefined>(undefined)
  /** Whether the composer holds focus (quick-command bar shows with the keyboard). */
  const [composerFocused, setComposerFocused] = useState(false)
  /** Offline state + queued-prompt count (banner above the chat). */
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [queuedCount, setQueuedCount] = useState(0)
  /** Voice recording sheet + the live recorder handle and its phase. */
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voicePartial, setVoicePartial] = useState('')
  const [voicePhase, setVoicePhase] = useState<'recording' | 'transcribing'>('recording')
  const voiceRef = useRef<VoiceRecording | undefined>(undefined)
  /** Pinch-zoom state for code blocks (one active gesture at a time). */
  const pinchRef = useRef<{ block: HTMLElement; dist0: number; scale0: number } | undefined>(undefined)
  /**
   * Composer preference from the plugin's host settings (default true keeps
   * the legacy Enter-to-send behavior until the preference loads).
   */
  const [mobileEnterToSend, setMobileEnterToSend] = useState(true)
  /** Whether the assistant is currently generating (turn/start..turn/end). */
  const [running, setRunning] = useState(false)
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
  /** Rename dialog visibility. */
  const [renaming, setRenaming] = useState(false)
  /** Long-press message menu: viewport position + the bubble's plain text. */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; text: string } | undefined>(undefined)
  /** Auto-scroll preference (设置 → 自动滚动); read once per mount. */
  const [autoScroll] = useState(() => getAutoScroll())

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

  // Track the connection and refresh the queued count alongside it; the
  // banner and the composer's queueing logic both read these.
  useEffect(() => {
    const update = (): void => {
      setOffline(typeof navigator !== 'undefined' && navigator.onLine === false)
      void listOutbox().then(entries => { setQueuedCount(entries.length) })
    }
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  /** Deliver the queued prompts once the connection is back. */
  const flushQueue = useCallback((): void => {
    void flushOutbox(entry => prompt(entry.sessionId, textParts(entry.text))).then(
      ({ sent, failed }) => {
        if (sent > 0) toast(failed > 0 ? `已同步 ${sent} 条，${failed} 条待重试` : `已同步 ${sent} 条消息`)
        void listOutbox().then(entries => { setQueuedCount(entries.length) })
        if (sent > 0) mux?.poke()
      },
    )
  }, [mux])

  // Connection restored: drain the outbox automatically.
  useEffect(() => {
    if (offline) return
    void listOutbox().then(entries => {
      if (entries.length === 0) return
      flushQueue()
    })
  }, [offline, flushQueue])

  // The + menu's command directory loads lazily on first open (weak links
  // never pay for it up front); a failure degrades to an empty list.
  useEffect(() => {
    if (!plusOpen || commands !== undefined) return
    let cancelled = false
    void listCommands().then(
      (items) => { if (!cancelled) setCommands(items) },
      () => { if (!cancelled) setCommands([]) },
    )
    return () => { cancelled = true }
  }, [plusOpen, commands])

  /** Refill a dropped seq window (tail overflow) page by page, from its
   * newest edge backwards, trimming rows already present in the fold (the
   * page below the window's bottom overlaps the tail snapshot). Best-effort:
   * a failure only logs. */
  const refillGap = useCallback((gap: { from: number; to: number }, signal: AbortSignal, isCancelled: () => boolean): void => {
    let beforeSeq = gap.to + 1
    const refill = (): void => {
      void loadHistory(session.sessionId, beforeSeq, signal).then(
        (fresh) => {
          if (isCancelled()) return
          const folder = folderRef.current
          const older = coalesceTurnMessages(foldEvents(fresh.events.map(eventOf)))
          // Drop rows at/below the window's bottom edge: they already live in
          // the tail snapshot and prepending them would duplicate rows.
          const trimmed = older.filter(row => (row.startSeq ?? row.seq) >= gap.from)
          if (trimmed.length > 0) {
            if (folder === undefined) {
              setMessages(previous => coalesceTurnMessages([...trimmed, ...previous]))
            } else {
              folder.prepend(trimmed)
              setMessages(coalesceTurnMessages(folder.snapshot()))
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
    // A stuck history load must not keep the chat empty (or the live buffer
    // growing) forever: abort it and surface the transport error. 30s gives a
    // slow phone link enough headroom to pull a large tool-heavy page.
    const timeout = setTimeout(() => {
      controller.abort(new DOMException('history load timed out', 'TimeoutError'))
    }, 30_000)
    tailLoadingRef.current = true
    liveBufferRef.current = []
    liveBufferOverflowRef.current = false
    dropWindowRef.current = undefined
    autoExtendedRef.current = false
    folderRef.current = undefined
    setTitle(session.title)
    // A session switch starts a fresh read position: the next fold key change
    // (the new tail page) must follow to the bottom unconditionally.
    followedBottomRef.current = false
    lastMessageKeyRef.current = undefined
    setLoading(true)
    setError(undefined)
    setMessages([])
    // Pending approvals/questions are per-session state: without this a
    // switch leaks session A's cards into session B, where the user could
    // approve a tool call for the wrong chat. The next poll/frame repopulates
    // the new session's own items.
    setPendingApprovals([])
    setPendingQuestions([])
    setContextPressure(undefined)
    // The turn indicator starts from the list page's last-known state; the
    // live turn/start frame corrects it as soon as the agent emits anything.
    setRunning(session.running === true)
    void loadHistory(session.sessionId, undefined, controller.signal).then(
      (page) => {
        if (cancelled) return
        // Buffered live events re-fold on top of the snapshot; the watermark
        // drops any the snapshot already includes, so nothing is lost or doubled.
        const buffered = liveBufferRef.current
        liveBufferRef.current = []
        tailLoadingRef.current = false
        const folder = new EventFolder(foldEvents(page.events.map(eventOf)))
        folderRef.current = folder
        applyMessages(folder.fold(buffered))
        setHasOlder(page.hasMore)
        // Auto-extend the opening context: pull one more page silently so the
        // first screen shows ~50 messages without a manual tap. Best-effort —
        // a failure keeps the loaded tail and the manual button.
        if (page.hasMore && !autoExtendedRef.current) {
          autoExtendedRef.current = true
          loadOlderRef.current(true)
        }
        setLoading(false)
        // The history-tail projection baseline seeds the permission picker.
        // The `permissions` key is declared by the deployment's permission
        // plugin (augmentation), so the base SDK map is indexed loosely.
        const projections = page.projections?.values as Record<string, unknown> | undefined
        setPermissions(parsePermissionSelect(projections?.['permissions']))
        setContextPressure(parseContextPressure(projections?.['contextPressure']))
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
        if (cancelled) return
        // Load failed: flush the buffer so the live stream still renders.
        const buffered = liveBufferRef.current
        liveBufferRef.current = []
        tailLoadingRef.current = false
        if (buffered.length > 0) {
          const folder = folderRef.current
          setMessages(coalesceTurnMessages(folder === undefined ? foldEvents(buffered) : folder.fold(buffered)))
        }
        setError(errorText(reason))
        setLoading(false)
      },
    )
    // Best-effort current-model label for the toolbar chip; the sheet
    // always re-reads a fresh directory on open. The same fetch seeds the
    // quick-picker catalog, so opening the strip right after mount never
    // issues a duplicate request.
    void models(session.sessionId).then(
      (directory) => {
        if (cancelled) return
        setCurrentModel(directory.current)
        setModelCatalog(previous => previous.status === 'idle' ? { status: 'ready', data: directory } : previous)
      },
      (reason: unknown) => {
        if (cancelled) return
        setModelCatalog(previous => previous.status === 'idle' ? { status: 'error', message: errorText(reason) } : previous)
      },
    )
    return () => {
      cancelled = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [session.sessionId])

  // Live frames: fold session events for this session in as they arrive.
  useEffect(() => {
    if (mux === undefined) return
    return mux.onFrame((frame: MuxFrame, frameRpcId?: string) => {
      if (frame.type === 'session/event') {
        if (frame.sessionId !== session.sessionId) return
        const event = frame.view === undefined
          ? frame.event as WireEvent
          : { ...frame.event, view: frame.view } as WireEvent
        // Track the turn running state for the "outputting" indicator (#1017).
        if (typeof event.type === 'string') {
          if (event.type === 'turn/start') setRunning(true)
          if (event.type === 'turn/end') setRunning(false)
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
        const folder = folderRef.current
        setMessages(previous => coalesceTurnMessages(
          folder === undefined ? foldEvents([event], previous) : folder.fold([event]),
        ))
        return
      }
      // Live projection pushes keep the permission picker and the context
      // usage chip current.
      if (frame.type === 'session/projection' && frame.sessionId === session.sessionId) {
        if (frame.key === 'permissions') setPermissions(parsePermissionSelect(frame.value))
        if (frame.key === 'contextPressure') setContextPressure(parseContextPressure(frame.value))
        return
      }
      // Approval/question frames for this session (#1025).
      if (!('sessionId' in frame) || frame.sessionId !== session.sessionId) return
      if (frame.type === 'approval/requested') {
        setPendingApprovals(previous => {
          if (previous.some(a => a.approvalId === frame.approvalId)) return previous
          return [...previous, {
            rpcId: frameRpcId ?? '',
            approvalId: frame.approvalId as string,
            toolName: frame.toolName,
            callId: frame.callId as string | undefined,
            reason: frame.reason,
          }]
        })
        return
      }
      if (frame.type === 'approval/resolved') {
        setPendingApprovals(previous => previous.filter(a => a.approvalId !== frame.approvalId))
        return
      }
      if (frame.type === 'question/requested') {
        const items = (frame.questions as Array<{
          id: string; question: string; detail?: string; header?: string
          options?: Array<{ label: string; description?: string }>; multiSelect?: boolean
        }>).map(item => ({ rpcId: frameRpcId ?? '', ...item }))
        setPendingQuestions(items)
        return
      }
      if (frame.type === 'question/resolved') {
        setPendingQuestions([])
        return
      }
    })
  }, [mux, session.sessionId])

  // Weak-network polling fallback: when the assistant is running, poll for
  // pending approvals/questions so the phone can act even if the SSE channel
  // drops frames (#1025). The cadence adapts to the live stream: while SSE is
  // delivering (pending items also arrive as frames) poll slowly as a safety
  // net; only while it is stalled does the poll go fast.
  useEffect(() => {
    if (!running) return
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
          setPendingApprovals(prev => state.approvals.length > 0 ? state.approvals : prev)
          setPendingQuestions(prev => state.questions.length > 0 ? state.questions : prev)
        },
        () => { /* transient; next tick retries */ },
      )
      const live = mux?.isSseLive() ?? true
      timer = setTimeout(tick, live ? PENDING_POLL_IDLE_MS : PENDING_POLL_FAST_MS)
    }
    tick()
    return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer) }
  }, [running, session.sessionId, mux])

  // Windowed rendering: rebuild the estimated-height prefix whenever the
  // message list changes (or a row measurement lands), then keep the window
  // around the scroll position. Measured rows use their real height; the
  // estimate only stands in for rows that are not currently rendered.
  useEffect(() => {
    if (messages.length < WINDOW_THRESHOLD) {
      prefixRef.current = undefined
      return
    }
    const prefix = [0]
    let acc = 0
    for (const message of messages) {
      // Streaming rows use a stable placeholder (see PENDING_ROW_ESTIMATE):
      // their height changes every chunk, and a drifting prefix would move
      // the located window edge and remount already-rendered paragraphs.
      acc += message.pending === true
        ? PENDING_ROW_ESTIMATE
        : (measuredRef.current.get(message.id) ?? estimateMessageHeight(message))
      prefix.push(acc)
    }
    prefixRef.current = prefix
  }, [messages, measuredTick])

  const locateWindow = useCallback(() => {
    const prefix = prefixRef.current
    if (prefix === undefined) return
    const el = scrollRef.current
    // The windowed DOM's scrollHeight is corrected to the real content
    // height (top spacer += heightCorrection), so scrollTop lives in real
    // space; the prefix sum is estimated space — subtract the correction
    // before binary-searching the row.
    const scrollTop = (el?.scrollTop ?? scrollTopRef.current) - heightCorrectionRef.current
    // Binary-search the row whose estimated top is at/below the scroll top.
    // Reads the live message count via the ref: the callback can run after
    // the list changed since it was scheduled.
    const count = messagesRef.current.length
    let low = 0
    let high = count - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (prefix[mid] !== undefined && prefix[mid]! <= scrollTop) low = mid
      else high = mid - 1
    }
    const start = Math.max(0, low - WINDOW_OVERSCAN)
    // While the newest message is still streaming, render the tail in full:
    // the bottom spacer is an estimate, and the streaming follower scrolls
    // to the real bottom every chunk — an estimated spacer under/over-shoots
    // each frame and the view jitters. With the tail real (spacer 0) the
    // follow target is exact. Settled/history views keep the window.
    const last = messagesRef.current[count - 1]
    const streaming = last !== undefined && last.pending === true
    const end = streaming
      ? count
      : Math.min(count, low + WINDOW_VISIBLE + WINDOW_OVERSCAN)
    setWin(previous => previous.start === start && previous.end === end ? previous : { start, end })
  }, [])

  const scheduleLocate = useCallback(() => {
    if (rafRef.current !== undefined) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = undefined
      locateWindow()
    })
  }, [locateWindow])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (el === undefined) return
    scrollTopRef.current = el.scrollTop
    bottomGapAtUserScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight
    scheduleLocate()
  }, [scheduleLocate])

  useEffect(() => () => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el === undefined) return
    el.scrollTop = el.scrollHeight
    scrollTopRef.current = el.scrollTop
    // Windowed mode: pin the window to the tail right away. The follow-up
    // rAF locate would land on the current scroll position, which can still
    // be 0 here (jsdom, or the very first frames) — the chat opens at the
    // newest content, so the tail window is the correct target.
    const count = messagesRef.current.length
    if (count > 0) {
      const start = Math.max(0, count - WINDOW_OVERSCAN)
      setWin(previous => previous.start === start && previous.end === count ? previous : { start, end: count })
    }
    scheduleLocate()
  }, [scheduleLocate])

  // Track the last message's fold key so scrolling only fires when the
  // newest message actually changes (seq bump and/or pending flip). Runs
  // after React has committed the render, so scrollHeight reflects the
  // freshly appended content.
  const lastMessageKeyRef = useRef<string | undefined>(undefined)
  /**
   * True once the first tail page of the CURRENT session was followed to the
   * bottom. Opening a session always lands at the newest message; afterwards
   * the follower only acts while the user is already near the bottom, so
   * streaming output never yanks a reader who scrolled up through history.
   */
  const followedBottomRef = useRef(false)

  // Keep the newest content visible. This covers the initial tail page (the
  // effect runs after commit, fixing the stale scrollHeight from the old
  // open-time scrollToBottom), live streaming chunks on the pending message,
  // and finalized/appended messages. Prepending older pages via loadOlder
  // leaves the last message untouched, so it never disturbs the scroll
  // position. A reader who scrolled away from the bottom is left alone:
  // follow only within {@link BOTTOM_FOLLOW_THRESHOLD_PX} of the bottom.
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last === undefined) return
    const key = last.seq + ':' + (last.pending === true ? 'p' : 'f')
    if (key === lastMessageKeyRef.current) return
    lastMessageKeyRef.current = key
    const el = scrollRef.current
    if (el === undefined) return
    if (!followedBottomRef.current) {
      // First tail of this session: always follow (the chat opens at the
      // newest message, whatever the scroll position left by a previous
      // session).
      followedBottomRef.current = true
      scrollToBottom()
      return
    }
    // 自动滚动 off (settings): the reader drives the scroll position.
    if (!autoScroll) return
    // Follow only while the user's own last gesture kept them near the
    // bottom (snapshot, see bottomGapAtUserScrollRef). Content growth on its
    // own never re-pins the view, so a reader who scrolled up through
    // history is left alone even when the pending message finalizes into
    // much taller markdown.
    if (bottomGapAtUserScrollRef.current > BOTTOM_FOLLOW_THRESHOLD_PX) return
    scrollToBottom()
  }, [messages, scrollToBottom, autoScroll])

  // The question/approval panels mount below the message list; when one
  // appears, bring it into view — the reader is usually watching the turn and
  // would otherwise never see the panel (it sits past the last message).
  // A reader who scrolled up through history is still left alone.
  useEffect(() => {
    if (pendingQuestions.length === 0 && pendingApprovals.length === 0) return
    if (!autoScroll) return
    const el = scrollRef.current
    if (el === undefined) return
    if (bottomGapAtUserScrollRef.current > BOTTOM_FOLLOW_THRESHOLD_PX) return
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
      if (bottomGapAtUserScrollRef.current > BOTTOM_FOLLOW_THRESHOLD_PX) return
      scrollToBottom()
    }
    viewport.addEventListener('resize', onResize)
    return () => { viewport.removeEventListener('resize', onResize) }
  }, [autoScroll, scrollToBottom])

  /* ── message context menu (long-press) ─────────────────────────────── */

  /** Auto-dismiss the context menu after 3s without action. */
  useEffect(() => {
    if (ctxMenu === undefined) return
    const timer = window.setTimeout(() => { setCtxMenu(undefined) }, 3000)
    return () => { clearTimeout(timer) }
  }, [ctxMenu])

  /** Quote a message: the composer shows a quote bar and the send prepends
   * the reference context (first 200 chars are enough for the agent). */
  const quoteIntoComposer = useCallback((text: string): void => {
    setQuoted(text.slice(0, 200))
  }, [])

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
    void loadHistory(session.sessionId, undefined, controller.signal).then(
      (page) => {
        if (epoch !== reloadEpochRef.current) return
        const buffered = liveBufferRef.current
        liveBufferRef.current = []
        tailLoadingRef.current = false
        const folder = new EventFolder(foldEvents(page.events.map(eventOf)))
        folderRef.current = folder
        applyMessages(folder.fold(buffered))
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
          setMessages(coalesceTurnMessages(folder === undefined ? foldEvents(buffered) : folder.fold(buffered)))
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
    // Immediate acknowledgement: the in-stream command card arrives over the
    // mux, but on a slow/tunnel link the toast is the first feedback.
    toast(`正在执行 ${line.trim().split(/\s+/)[0]}…`)
    return sendCommand(session.sessionId, line).then(
      (outcome) => {
        mux?.poke()
        if (outcome.matched) {
          reloadTail()
          if (outcome.text !== undefined && outcome.text !== '') toast(outcome.text)
          return
        }
        return prompt(session.sessionId, textParts(line)).then(() => { mux?.poke() })
      },
      (reason: unknown) => { setError(errorText(reason)) },
    )
  }, [session.sessionId, mux, reloadTail])

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
    const bubble = element?.closest('.chat-msg') ?? null
    if (bubble === null) return false
    const mid = bubble.getAttribute('data-mid')
    const message = mid === null ? undefined : messagesRef.current.find(candidate => candidate.id === mid)
    const text = message?.text !== undefined && message.text !== '' ? message.text : message?.reasoning ?? ''
    if (text.trim() !== '') openCtxAt(x, y, text)
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

  const openCtxAt = useCallback((x: number, y: number, text: string): void => {
    const menuWidth = 164
    const menuHeight = 100
    setCtxMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight)),
      text,
    })
  }, [])

  /** File-path links render inside markdown HTML; delegate the click to the
   * host file opener (postMessage + window.dshOpenFile). */
  const handleScrollClick = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target.closest('.file-link') : null
    if (target === null) return
    const path = target.getAttribute('data-path')
    if (path === null || path === '') return
    event.preventDefault()
    openFilePath(path)
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
  const loadOlder = useCallback((silent = false) => {
    if (pendingRef.current) return
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
    // turn and prepending duplicates their text.
    const beforeSeq = first.startSeq ?? first.seq
    // Record the anchor BEFORE the fetch: React's commit-time focus scroll
    // restoration can zero the container's scrollTop while the old page is
    // swapped, which would make the anchor shift below the wrong content.
    const anchorTop = silent ? undefined : (scrollRef.current?.scrollTop ?? scrollTopRef.current)
    void loadHistory(session.sessionId, beforeSeq, controller.signal).then(
      (page) => {
        clearTimeout(timeout)
        pendingRef.current = false
        if (!silent) setLoading(false)
        const older = coalesceTurnMessages(foldEvents(page.events.map(eventOf)))
        const folder = folderRef.current
        if (folder === undefined) {
          setMessages(previous => coalesceTurnMessages([...older, ...previous]))
        } else {
          folder.prepend(older)
          setMessages(coalesceTurnMessages(folder.snapshot()))
        }
        setHasOlder(page.hasMore)
        // Keep the visual anchor: the prepend pushes content down by the
        // inserted rows' estimated height, so advance the scroll position by
        // the same amount (rendered height lands close to the estimate).
        // The height correction measured on the previous full frame no longer
        // applies (the real prefix changed and cannot be measured windowed),
        // so drop back to pure estimation for the spacer.
        heightCorrectionRef.current = 0
        const el = scrollRef.current
        if (el !== undefined && older.length > 0) {
          if (silent && bottomGapAtUserScrollRef.current <= BOTTOM_FOLLOW_THRESHOLD_PX) {
            // The silent auto-extend on open prepends ABOVE the tail: the
            // tail page already followed to the bottom, and a plain anchor
            // shift would strand the view mid-history (the last message's
            // key never changes, so the stream follower never re-fires).
            // setMessages is async — scrollHeight still reflects the
            // pre-prepend content — so defer the re-follow to the next
            // frame, after React has committed the prepend.
            requestAnimationFrame(() => scrollToBottom())
          } else {
            const inserted = older.reduce((acc, row) => acc + estimateMessageHeight(row), 0)
            // Set from the recorded anchor, not the live scrollTop: React's
            // commit-time scroll restoration may have zeroed it while the
            // page loaded. Defer to the next frame so any commit-triggered
            // restore has already run and cannot overwrite the anchor.
            const target = (anchorTop ?? el.scrollTop) + inserted
            requestAnimationFrame(() => {
              el.scrollTop = target
              scrollTopRef.current = el.scrollTop
            })
          }
        }
      },
      (reason: unknown) => {
        clearTimeout(timeout)
        pendingRef.current = false
        setLoading(false)
        // The auto-extend on open is best-effort: a failure keeps the loaded
        // tail and the manual button — it must not surface an error.
        if (!silent) setError(errorText(reason))
      },
    )
  }, [session.sessionId, messages, scrollToBottom])
  loadOlderRef.current = loadOlder

  /** Add a picked/pasted image: compress it, then append to the attach list. */
  const addImage = useCallback((file: File) => {
    void compressImageFile(file).then(({ image }) => {
      setAttachImages(previous =>
        previous.length >= MAX_ATTACHED_IMAGES ? previous : [...previous, image],
      )
    })
  }, [])

  /** Send the drafted prompt (the echoed user/message arrives over mux).
   * Offline: queue in IndexedDB instead — the reconnect effect drains it. */
  const send = useCallback(() => {
    const text = input.trim()
    if ((text === '' && attachImages.length === 0) || sending) return
    // Offline: images can't queue (too big for the outbox), text can.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
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
      void enqueuePrompt({ id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, sessionId: session.sessionId, text: body, queuedAt: Date.now() })
        .then(() => {
          setInput('')
          setQuoted(undefined)
          setAttachImages([])
          toast('已离线保存，恢复网络后自动发送')
          void listOutbox().then(entries => { setQueuedCount(entries.length) })
        })
      return
    }
    // A bare slash-line is a command, not a prompt: run it through the host
    // registry (session.prompt would deliver it to the model verbatim).
    // Quotes and image attachments compose a prompt, so they keep prompt
    // semantics even when the text starts with '/'.
    if (text.startsWith('/') && quoted === undefined && attachImages.length === 0) {
      setSending(true)
      void runCommand(text).then(
        () => {
          setSending(false)
          setInput('')
        },
        () => { setSending(false) },
      )
      return
    }
    setSending(true)
    // A quoted draft composes the citation banner INTO the text part and
    // still carries the attached images (buildPromptParts appends them).
    const body: PromptPart[] = quoted !== undefined && text !== ''
      ? buildPromptParts(`引用消息：\n> ${quoted.replace(/\n+/g, ' ')}\n\n${text}`, attachImages)
      : buildPromptParts(input, attachImages)
    void prompt(session.sessionId, body).then(
      () => {
        setSending(false)
        setInput('')
        setAttachImages([])
        setQuoted(undefined)
        // Fresh activity just started: drop the poll backoff so the mux
        // fallback picks the reply up immediately, not after the stall window.
        mux?.poke()
      },
      (reason: unknown) => {
        setSending(false)
        setError(errorText(reason))
      },
    )
  }, [input, attachImages, sending, session.sessionId, mux, quoted, runCommand])

  /* ── voice input ───────────────────────────────────────────────────── */

  const voicePartialRef = useRef('')

  /** Discard the current recording and close the sheet. */
  const closeVoice = useCallback((): void => {
    voiceRef.current?.cancel()
    voiceRef.current = undefined
    voicePartialRef.current = ''
    setVoicePartial('')
    setVoiceOpen(false)
    setVoicePhase('recording')
  }, [])

  /** Open the recording sheet and start capturing audio. */
  const openVoice = useCallback((): void => {
    voicePartialRef.current = ''
    setVoicePhase('recording')
    void startVoiceRecording().then(
      (recorder) => {
        voiceRef.current = recorder
        setVoiceOpen(true)
      },
      (message: unknown) => { toast(message instanceof Error ? message.message : String(message)) },
    )
  }, [])

  /** Finish recording → upload the WAV → transcribe → fill the composer. */
  const finishVoice = useCallback((): void => {
    const recorder = voiceRef.current
    if (recorder === undefined) {
      setVoiceOpen(false)
      return
    }
    voiceRef.current = undefined
    setVoicePhase('transcribing')
    void recorder.stop().then(
      (wavBase64) => {
        voicePartialRef.current = '转写中...'
        setVoicePartial('转写中...')
        void transcribeVoice(wavBase64, getVoiceServices()).then(
          (text) => {
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
    setSheet(null)
    setModelQuery('')
    setContextOpen(false)
    setPicker('model')
    if (modelCatalog.status === 'idle') loadModelCatalog()
  }

  const openPermissionPicker = (): void => {
    setSheet(null)
    setContextOpen(false)
    setPicker('permission')
  }

  /** Toggle the context-usage popover on the ring. */
  const toggleContextPop = (): void => {
    if (contextUsage === undefined) return
    setSheet(null)
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

  /** One-shot permission switch; full access keeps its explicit confirm by
   *  routing through the sheet (the strip never applies it directly). */
  const applyPermission = useCallback((next: string): void => {
    if (next === permissions?.currentValue) {
      setPicker(null)
      return
    }
    if (next === 'danger-full-access') {
      setPicker(null)
      setSheet('permission')
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
  // Windowed rendering decisions (recomputed per render). Before the first
  // locate (or while a stale window follows a prepend) the tail renders in
  // full so new content never appears blank.
  const windowed = messages.length >= WINDOW_THRESHOLD
  const located = windowed && win.end > win.start
  const winStart = located ? win.start : 0
  const winEnd = located ? win.end : messages.length
  const prefix = prefixRef.current
  // The top spacer carries the height correction measured on the last full
  // render frame, so the windowed total height equals the real content
  // height (see heightCorrectionRef).
  const topSpacerHeight = prefix !== undefined && located ? (prefix[winStart] ?? 0) + heightCorrectionRef.current : 0
  const bottomSpacerHeight = prefix !== undefined && located
    ? (prefix[messages.length] ?? 0) - (prefix[winEnd] ?? prefix[messages.length] ?? 0)
    : 0

  // Keep the window around the scroll position whenever the list changes
  // (tail load, live events, prepends) or a row measurement lands — not only
  // on user scrolls.
  useEffect(() => { scheduleLocate() }, [messages, measuredTick, scheduleLocate])

  // Measure rendered rows in windowed mode and fold the real heights into
  // the prefix sum (measuredTick re-runs the prefix rebuild + locate). The
  // measurement is idempotent: unchanged heights leave measuredTick alone,
  // so the loop settles after one pass. jsdom reports no layout (0), where
  // the estimate path stays authoritative.
  useEffect(() => {
    if (!windowed) return
    const el = scrollRef.current
    if (el === undefined) return
    let changed = false
    for (const row of el.querySelectorAll<HTMLElement>('[data-mid]')) {
      // Skip streaming rows: their height grows every chunk, so measuring
      // them would re-trigger this loop every frame and drift the prefix.
      if (row.classList.contains('chat-msg-pending')) continue
      const id = row.dataset['mid']
      if (id === undefined) continue
      const height = row.offsetHeight
      if (height > 0 && measuredRef.current.get(id) !== height) {
        measuredRef.current.set(id, height)
        changed = true
      }
    }
    if (changed) setMeasuredTick(tick => tick + 1)
  }, [windowed, messages, measuredTick])

  // Measure the real content height on every full (non-windowed) render
  // frame and refresh the windowed height correction. The opening tail page
  // renders in full before the window locates, so the correction is exact
  // from the start; jsdom reports no layout (scrollHeight 0), where the
  // correction stays 0.
  useEffect(() => {
    if (windowed && located) return
    const el = scrollRef.current
    if (el === undefined) return
    const estimated = prefixRef.current?.[messages.length] ?? 0
    heightCorrectionRef.current = el.scrollHeight === 0 ? 0 : el.scrollHeight - estimated
  }, [windowed, located, messages])

  return (
    <div className="chat">
      <header className="mobile-header">
        <div className="mobile-headerSlot">
          <button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</button>
        </div>
        <div className="mobile-titleWrap">
          <h1 className="mobile-title mobile-titleInline">{title}</h1>
        </div>
        <div className="mobile-headerSlot mobile-headerSlot-right">
          <button type="button" className="mobile-iconbtn" aria-label="更多" onClick={() => { setMoreOpen(true) }}>
            <MoreIcon />
          </button>
          <ThemeToggle />
        </div>
      </header>
      {error !== undefined && <p className="mobile-error mobile-pad">{error}</p>}
      {(offline || queuedCount > 0) && (
        <div className="chat-offline-banner" role="status">
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
          // 正文/代码块/图片可选中或可长按：交给系统（文字选择 / 图片菜单），
          // 自定义菜单只对消息空白/卡片等不可选区域保留。
          if (target.closest('.chat-msg-text, .chat-msg-plain, .code-block pre, img') !== null) return
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
        {windowed ? (
          <>
            <div style={{ height: topSpacerHeight }} aria-hidden="true" />
            {messages.slice(winStart, winEnd).map((message, offset) => {
              const index = winStart + offset
              return (
                <MessageRow
                  key={messageKey(message)}
                  message={message}
                  showToolCalls={showToolCalls}
                  showSystemMessages={showSystemMessages}
                  showTime={timeFlags[index] === true}
                />
              )
            })}
            <div style={{ height: bottomSpacerHeight }} aria-hidden="true" />
          </>
        ) : (
          messages.map((message, index) => (
            <MessageRow
              key={messageKey(message)}
              message={message}
              showToolCalls={showToolCalls}
              showSystemMessages={showSystemMessages}
              showTime={timeFlags[index] === true}
            />
          ))
        )}
        {loading && messages.length === 0 && <p className="chat-typing">加载中…</p>}
        {!loading && messages.length === 0 && <p className="chat-typing">还没有消息，发一句话开始吧</p>}
        {running && (
          <div className="chat-turn-status" role="status" aria-label="输出中">
            输出中<span className="chat-turn-dots" aria-hidden><span /><span /><span /></span>
          </div>
        )}
        {pendingApprovals.map(approval => (
          <ApprovalPanel
            key={approval.approvalId}
            approval={approval}
            sessionId={session.sessionId}
            onResolved={(id) => { setPendingApprovals(prev => prev.filter(a => a.approvalId !== id)) }}
          />
        ))}
        {pendingQuestions.length > 0 && (
          <QuestionPanel
            questions={pendingQuestions}
            sessionId={session.sessionId}
            onResolved={() => { setPendingQuestions([]) }}
          />
        )}
      </div>
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
          {permissionLabel !== undefined && permissions !== undefined && (
            <button
              type="button"
              className={'chat-pill chat-pill-perm chat-pill-perm-' + (permissionTone(permissions.currentValue) ?? 'read')}
              onClick={openPermissionPicker}
              aria-haspopup="listbox"
              aria-label={`切换权限：${permissionLabel}`}
              title={permissionLabel}
            >
              <ShieldIcon width={16} height={16} />
              <span className="chat-pill-name">{permissionLabel}</span>
            </button>
          )}
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
                className="chat-context-text"
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
              <input
                type="search"
                className="chat-picker-search"
                placeholder="搜索模型…"
                value={modelQuery}
                onChange={(event) => { setModelQuery(event.target.value) }}
                aria-label="搜索模型"
                autoFocus
              />
              {(() => {
                const query = modelQuery.trim().toLowerCase()
                const choices = modelCatalog.data.groups.flatMap(group => group.models.map(model => ({ group, model })))
                const filtered = query === ''
                  ? choices
                  : choices.filter(choice => (choice.group.name + ' ' + choice.group.id + ' ' + choice.model.name + ' ' + choice.model.id).toLowerCase().includes(query))
                if (filtered.length === 0) {
                  return <span className="chat-picker-status">没有匹配的模型</span>
                }
                const current = currentModel ?? modelCatalog.data.current
                const modelRow = (group: { id: string; name: string }, model: SessionModels['groups'][number]['models'][number]): ReactNode => {
                  const isSelected = current !== undefined && current.provider === group.id && current.model === model.id
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
                        <span className="chat-picker-row-title">{model.name}</span>
                        {query !== '' && <span className="chat-picker-row-sub">{group.name}</span>}
                      </span>
                    </button>
                  )
                }
                return query === '' ? (
                  modelCatalog.data.groups.map(group => (
                    <div className="chat-picker-group" key={group.id}>
                      <div className="chat-picker-group-title">{group.name}</div>
                      {group.models.map(model => modelRow(group, model))}
                    </div>
                  ))
                ) : (
                  filtered.map(choice => modelRow(choice.group, choice.model))
                )
              })()}
              {modelQuery.trim() === '' && (
                <button type="button" className="chat-picker-more" onClick={() => { setPicker(null); setSheet('model') }}>全部…</button>
              )}
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
          <button type="button" className="chat-picker-more" onClick={() => { setPicker(null); setSheet('permission') }}>全部…</button>
        </div>
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
          <textarea
            className="chat-input"
            rows={1}
            value={input}
            placeholder="说点什么..."
            enterKeyHint={mobileEnterToSend ? 'send' : 'enter'}
            onChange={(event) => { setInput(event.target.value) }}
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
              if (mobileEnterToSend && event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void send()
              }
            }}
          />
          <button
            type="button"
            className={running ? 'chat-send chat-send-stop' : 'chat-send'}
            {...(running ? { 'aria-label': stopping ? '停止中' : '停止' } : { 'aria-label': '发送' })}
            disabled={running ? stopping : sending || (input.trim() === '' && attachImages.length === 0)}
            onClick={() => { if (running) void stopTurn(); else void send() }}
          >
            {running ? (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
              </svg>
            ) : (
              <SendIcon />
            )}
          </button>
        </div>
      </div>
      {plusOpen && (
        <PlusSheet
          commands={commands}
          onPickImage={() => { setPlusOpen(false); fileInputRef.current?.click() }}
          onPickCommand={(line) => {
            setPlusOpen(false)
            void runCommand(line).catch(() => { /* runCommand already surfaced the error */ })
          }}
          onClose={() => { setPlusOpen(false) }}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          for (const file of files) addImage(file)
          event.target.value = ''
        }}
      />
      {sheet === 'model' && (
        <ModelSheet
          sessionId={session.sessionId}
          current={currentModel}
          onCurrent={(selection) => { setCurrentModel(selection) }}
          onClose={() => { setSheet(null) }}
        />
      )}
      {sheet === 'permission' && permissions !== undefined && (
        <PermissionSheet
          sessionId={session.sessionId}
          value={permissions}
          onChanged={(value) => {
            setPermissions(previous => previous === undefined ? previous : { ...previous, currentValue: value })
          }}
          onClose={() => { setSheet(null) }}
        />
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
          </div>
        </Sheet>
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
      {voiceOpen && (
        <div className="voice-backdrop" onClick={() => { closeVoice() }}>
          <div
            className="voice-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="语音输入"
            onClick={(event) => { event.stopPropagation() }}
          >
            <div className={'voice-wave' + (voicePhase === 'transcribing' ? ' voice-wave-idle' : '')} aria-hidden>
              <span /><span /><span /><span /><span />
            </div>
            <div className="voice-text" role="status">
              {voicePhase === 'transcribing'
                ? '转写中...'
                : voicePartial !== '' ? voicePartial : '正在听...'}
            </div>
            <button
              type="button"
              className="voice-done"
              disabled={voicePhase === 'transcribing'}
              onClick={finishVoice}
            >
              {voicePhase === 'transcribing' ? '请稍候' : '完成'}
            </button>
          </div>
        </div>
      )}
      {ctxMenu !== undefined && (
        <>
          <div
            className="ctx-backdrop"
            onClick={() => { setCtxMenu(undefined) }}
            onContextMenu={(event) => { event.preventDefault(); setCtxMenu(undefined) }}
          />
          <div
            className="ctx-menu"
            role="menu"
            aria-label="消息操作"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={() => { const { text } = ctxMenu; setCtxMenu(undefined); void copyText(text) }}
            >
              复制
            </button>
            <button
              type="button"
              role="menuitem"
              className="ctx-item"
              onClick={() => { const { text } = ctxMenu; setCtxMenu(undefined); quoteIntoComposer(text) }}
            >
              引用
            </button>
          </div>
        </>
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

