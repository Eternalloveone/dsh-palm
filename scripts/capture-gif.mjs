/**
 * Capture a README demo GIF for dsh-palm: drives the real /m/ phone UI in
 * headless Chrome against the live dsh web (127.0.0.1:3080), injects fictional
 * data (workspaces, sessions, chat history, live SSE frames), walks a
 * 42-second timeline, and renders the frames into a palette-optimized GIF via
 * ffmpeg.
 *
 * Timeline (seconds since start):
 *   0-4    pairing gate
 *   4-8    workspace -> session list (instant first paint)
 *   8-20   one process card per turn: thinking and tool rows in event order,
 *          running then settled (1.6.0)
 *  20-27   streamed answer, interactive diff card, highlighted code block
 *  27-33   turn-tail report card: deliverables + files produced (1.6.0)
 *  33-37   wake-message card (1.6.0)
 *  37-42   settings page (the two removed toggles are gone), dark theme
 *
 * Geometry: the GIF is 390x884, i.e. the 390x844 phone frame PLUS a caption
 * bar underneath it (40px - see CANVAS_H for why it is not 44). The bar is
 * never painted inside the page: each frame is a native 390x844 screenshot, and
 * the bar is a separate PNG that ffmpeg composites at y=844 for that segment's
 * time window. So a caption can never land on top of the UI, and the phone
 * pixels are exactly what the device rendered. (An earlier revision drew the
 * caption as an in-page overlay and it covered the message text - the padding
 * approach removes that whole class of bug.) The canvas is read back out of the
 * produced file rather than assumed, and the encoder falls back until the
 * header says exactly 390x884 (see the encode ladder at the end of main).
 *
 * The process card, the report card and the wake-message card are the LIVE
 * /m/ components driven by the same wire events the host sends - nothing is
 * composited after the fact. All data is fictional: workspace names, session
 * titles, chat content, file paths and the pairing code are made up, so
 * nothing private leaks into the repository (same policy as capture-panel.mjs).
 *
 * The run is idempotent: both web storages are cleared before the first
 * mocked load, so a second run starts unpaired on the light theme again.
 *
 * Alongside the GIF it rewrites the three standalone card stills the README
 * table links to - process-card.png, report-card.png and wake-card.png - by
 * capturing the same live session at deviceScaleFactor 1 (a native 390x844
 * screenshot, never a frame lifted out of the quantized GIF).
 *
 * Usage: node scripts/capture-gif.mjs [out.gif]
 * Requires: ffmpeg on PATH (or FFMPEG env var pointing at the binary).
 *
 * GIF_PROBE=1 drives the very same 42s timeline and prints the horizontal
 * overflow report, but writes nothing at all - no frames, no card stills, no
 * GIF. A cheap way to re-verify that the injected demo content still fits the
 * phone width before spending a full encode on it.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DEBUG_PORT = 9223
const OUT = process.argv[2] ?? join(process.cwd(), 'docs', 'screenshots', 'demo.gif')
const FRAMES_DIR = join(process.cwd(), '.gif-frames')
// Card stills land beside the GIF, so a dry run to a temp path stays out of the
// repository instead of quietly overwriting the committed screenshots.
const SHOT_DIR = dirname(OUT)
const TARGET = 'http://127.0.0.1:3080/m/'
const FPS = 10
const DURATION_S = 42
const TOTAL_FRAMES = FPS * DURATION_S
const WIDTH = 390
const HEIGHT = 844
// The README GIF is 390x884: the 390x844 phone frame plus a caption strip
// BELOW it. The brief asked for "390x844 + a 44px strip" AND for a total height
// of exactly 884; those two numbers disagree (844 + 44 is 888), so the stated
// acceptance figure wins and the strip is 40px tall. Either way the property
// that matters holds: the strip's y range is [844, 884), entirely outside the
// phone frame, and the frames themselves stay native 390x844 screenshots -
// ffmpeg pads to CANVAS_H and overlays the caption in the added strip. Keeping
// the height in one named constant is what makes "no caption over the UI"
// checkable rather than hoped for.
const CANVAS_H = 884
const CAPTION_H = CANVAS_H - HEIGHT
const MAX_BYTES = 2 * 1024 * 1024
// Overflow probe: skip frame writing and the ffmpeg pass (see GIF_PROBE).
const PROBE = process.env.GIF_PROBE === '1'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── fictional demo data ────────────────────────────────────────────────────

const WORKSPACES = [
  { workspaceId: 'ws-1', title: 'acme-api', path: '/home/dev/acme-api', kind: 'project', pinned: true, sessionIds: ['s-1', 's-2', 's-3'] },
  { workspaceId: 'ws-2', title: 'checkout-web', path: '/home/dev/checkout-web', kind: 'project', pinned: false, sessionIds: [] },
  { workspaceId: 'ws-3', title: 'design-notes', path: '/home/dev/design-notes', kind: 'project', pinned: false, sessionIds: [] },
]

const SESSIONS = [
  { sessionId: 's-1', title: 'Add rate limiting to the API', updatedAt: Date.now() - 3_600_000, running: true, blank: false, preview: 'Reading the current middleware chain…', projections: { values: { title: 'Add rate limiting to the API' } } },
  { sessionId: 's-2', title: 'Fix the flaky checkout webhook test', updatedAt: Date.now() - 86_400_000, running: false, blank: false, preview: 'Retries hid a race in the fixture', projections: { values: { title: 'Fix the flaky checkout webhook test' } } },
  { sessionId: 's-3', title: 'Draft the migration checklist', updatedAt: Date.now() - 172_800_000, running: false, blank: false, preview: 'Split the cutover into four stages', projections: { values: { title: 'Draft the migration checklist' } } },
]

const T0 = Date.now() - 3_600_000

const HISTORY = [
  { event: { type: 'user/message', seq: 1, time: T0, data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: 'The public API has no rate limiting yet. Can you add one?' }] } } },
  { event: { type: 'assistant/message', seq: 2, time: T0 + 1000, data: { turn: 2, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: 'A token bucket per client key fits best here. I would put it in `src/app.ts` so every route inherits it, keep the limit configurable, and return `429` with a `Retry-After` header.' }] } } } },
  { event: { type: 'user/message', seq: 3, time: T0 + 2000, data: { id: 'u-2', role: 'user', content: [{ type: 'text', text: 'Sounds good. Take a look at the middleware chain first.' }] } } },
]

// v1.6.0 reads the chat through the v3 `mobile.readChat` page, which returns
// rows the HOST already folded (RenderMessage[]), not raw events - the v2
// `session.history` shape above is kept only because the surface still
// advertises it. `maxSeq` sets the replay floor the live frames must clear.
const CHAT_ROWS = [
  { id: 'u-1', kind: 'user', text: 'The public API has no rate limiting yet. Can you add one?', seq: 1, time: T0 },
  { id: 'a-1', kind: 'assistant', turn: 2, step: 0, text: 'A token bucket per client key fits best here. I would put it in `src/app.ts` so every route inherits it, keep the limit configurable, and return `429` with a `Retry-After` header.', seq: 2, time: T0 + 1000 },
  { id: 'u-2', kind: 'user', text: 'Sounds good. Take a look at the middleware chain first.', seq: 3, time: T0 + 2000 },
]

// Turn 5 — the process-card showcase. Two working steps before the answer, so
// the group holds narration text, reasoning and tool rows in event order while
// the final step's text renders outside the group as the answer. No tool here
// carries a diff view and no deliverable is declared, so this turn produces no
// report card (the tail only appears when there is something to report).
const TURN5 = [
  { type: 'turn/start', seq: 10, data: { turn: 5 }, __ageMs: 95_000 },
  { type: 'assistant/chunk', seq: 11, data: { turn: 5, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'Reading the middleware chain first. Rate limiting belongs next to the request-id middleware, before the route table.' } } },
  { type: 'assistant/chunk', seq: 12, data: { turn: 5, step: 0, chunk: { type: 'text-delta', index: 0, text: 'Let me look at how the middleware chain is assembled.\n\n' } } },
  { type: 'tool/call', seq: 13, data: { turn: 5, step: 0, callId: 'c-search', name: 'grep', arguments: '{"pattern":"use(","path":"src"}' } },
  { type: 'tool/result', seq: 14, data: { turn: 5, step: 0, message: { source: { callId: 'c-search' } } } },
  { type: 'assistant/chunk', seq: 15, data: { turn: 5, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Only one entry point wires the middleware, so a single insert covers every route.' } } },
  { type: 'tool/call', seq: 16, data: { turn: 5, step: 1, callId: 'c-read', name: 'read', arguments: '{"path":"src/app.ts"}' } },
  { type: 'tool/result', seq: 17, data: { turn: 5, step: 1, message: { source: { callId: 'c-read' } } } },
  { type: 'tool/call', seq: 18, data: { turn: 5, step: 1, callId: 'c-test', name: 'bash', arguments: '{"description":"run the api tests","command":"pnpm test src"}' } },
  { type: 'tool/result', seq: 19, data: { turn: 5, step: 1, message: { source: { callId: 'c-test' } } } },
  { type: 'assistant/chunk', seq: 20, data: { turn: 5, step: 2, chunk: { type: 'text-delta', index: 0, text: 'The suite is green, so the chain is safe to extend.' } } },
  { type: 'turn/end', seq: 21, data: { turn: 5, reason: { kind: 'stop' } } },
]

// Turn 6 — the answer turn: an edit with a result-time diff view (that path
// becomes "files produced"), then the final step's text carrying both a
// syntax-highlighted code fence and an interactive ```diff fence. A declared
// deliverable is folded in just before turn/end, so the turn-tail report card
// renders with both sections.
//
// Every injected code line is kept to <=34 characters (indentation included).
// The code body scrolls horizontally by design, so an over-long line is not an
// error state - it just gets clipped in a static frame, which reads as "the UI
// is broken" in a README GIF. The overflow report at the end of the run is what
// keeps this honest: see the .code-body / .diff-body rows in §overflow.
const EDIT_DIFF = {
  for: 'result',
  view: {
    card: 'diff',
    title: 'src/app.ts',
    diffs: [{
      path: 'src/app.ts',
      oldText: 'export function createApp() {\n  const app = new App()\n  app.use(requestId())\n  app.use(routes())\n  return app\n}\n',
      newText: 'export function createApp() {\n  const app = new App()\n  app.use(requestId())\n  app.use(limit)\n  app.use(routes())\n  return app\n}\n',
    }],
  },
}

const ANSWER_TEXT = [
  'Wired the limiter into the chain and kept it per client key:\n\n',
  '```ts\n',
  '// src/limiter.ts\n',
  'const winMs = 60_000\n',
  'const max = 120\n',
  'const seen = new Map()\n',
  'export const limit = (c) => {\n',
  '  const b = take(c, winMs)\n',
  '  if (b.count > max) {\n',
  '    c.res.status(429).end()\n',
  '    return\n',
  '  }\n',
  '  seen.set(c.key, b)\n',
  '}\n',
  '```\n\n',
  'The middleware change is small:\n\n',
  '```diff\n',
  '--- a/src/app.ts\n',
  '+++ b/src/app.ts\n',
  '@@ -1,6 +1,6 @@\n',
  ' export function createApp() {\n',
  '   const app = new App()\n',
  '   app.use(requestId())\n',
  '+  app.use(limit)\n',
  '   app.use(routes())\n',
  '   return app\n',
  ' }\n',
  '```\n',
].join('')

const TURN6 = [
  { type: 'turn/start', seq: 30, data: { turn: 6 }, __ageMs: 42_000 },
  { type: 'assistant/chunk', seq: 31, data: { turn: 6, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'Adding the limiter module and wiring it in, then I will show the diff.' } } },
  { type: 'assistant/chunk', seq: 32, data: { turn: 6, step: 0, chunk: { type: 'text-delta', index: 0, text: 'Writing the limiter and wiring it into the chain.\n\n' } } },
  { type: 'tool/call', seq: 33, data: { turn: 6, step: 1, callId: 'c-edit', name: 'edit', arguments: '{"path":"src/app.ts"}' } },
  { type: 'tool/result', seq: 34, view: EDIT_DIFF, data: { turn: 6, step: 1, message: { source: { callId: 'c-edit' } } } },
  { type: 'assistant/chunk', seq: 35, data: { turn: 6, step: 2, chunk: { type: 'text-delta', index: 0, text: ANSWER_TEXT } } },
  { type: 'deliverables/presented', seq: 36, data: { turn: 6, callId: 'c-present', files: [{ path: 'src/limiter.ts', description: 'Token-bucket limiter for the public API' }] } },
  { type: 'turn/end', seq: 37, data: { turn: 6, reason: { kind: 'stop' } } },
]

// A host wake message: the phone renders its own collapsed card, titled from
// source.kind (one of the eight kinds the surface knows).
const WAKE = {
  type: 'user/message',
  seq: 50,
  data: {
    id: 'w-1',
    role: 'user',
    source: { kind: 'subagent-settled' },
    content: [{ type: 'text', text: 'Subagent “route-audit” finished: 6 routes inspected, 2 missing the limit.' }],
  },
}

// ── captions (out-of-frame strip, not app UI) ─────────────────────────────
//
// One caption per segment. `from`/`to` are read off the same clock the timeline
// below runs on, so the bar's visibility is derived from the timeline instead of
// being driven by an in-page element that could drift. The ids double as the
// `window.__seg` labels the overflow sampler groups its measurements by.
const CAPTIONS = [
  { id: 'pair', from: 0, to: 4.4, text: 'Pair the phone with a code from the desktop' },
  { id: 'list', from: 4.4, to: 8.0, text: 'The session list paints from the last snapshot' },
  { id: 'process', from: 8.0, to: 20.0, text: 'One process card per turn: thinking and tools in order' },
  { id: 'stream', from: 20.0, to: 27.0, text: 'Streamed answer, diff card, highlighted code' },
  { id: 'report', from: 27.0, to: 33.2, text: 'Turn report: deliverables and files produced' },
  { id: 'wake', from: 33.2, to: 37.2, text: 'Wake messages get their own card' },
  { id: 'theme', from: 37.2, to: DURATION_S, text: 'Settings, then the dark theme' },
]

// Selectors the end-of-run horizontal overflow report measures. `.code-body`
// and `.diff-body` are the deliberate horizontal scrollers, so they are where a
// too-long injected line shows up first; `.chat-scroll` is the whole message
// viewport and going true there means the layout itself broke. A non-zero row
// for any of these means a static frame CLIPS content.
const OVERFLOW_SELECTORS = [
  '.chat-scroll',
  '.chat-flow-answer',
  '.chat-md-body',
  '.code-block',
  '.code-body',
  '.diff-block',
  '.diff-body',
  '.chat-proc',
  '.chat-turn-tail',
  '.chat-trigger',
]

// Single-line labels the stylesheet deliberately truncates with an ellipsis
// (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`). Measured
// and reported too, but separately: these shorten on purpose and are how the
// real phone behaves with a long path, so they are not a clipping defect. They
// are listed rather than left unmeasured because "we did not look" and "it is
// fine" are different claims.
const ELLIPSIS_SELECTORS = [
  '.diff-file',
  '.code-lang',
  '.chat-proc-label',
  '.chat-proc-current-text',
  '.chat-turn-tail-file-name',
  '.chat-turn-tail-file-path',
  '.chat-trigger-title',
  '.mobile-title',
  '.chat-step-title',
  '.chat-step-summary',
  '.chat-step-peek',
  '.chat-artifact-summary',
  '.chat-think-label',
]

// ── mock injection (runs before any document script) ──────────────────────

const MOCK_SOURCE = `(() => {
  // The theme mode is persisted in localStorage, which lives in the Chrome
  // profile and therefore survives between runs: a run that finishes on the
  // dark palette would make the NEXT run boot dark as well. Clearing it here
  // (an init script, so it lands on the real origin before any app module
  // reads it) is what makes the recording start on the light palette every
  // time. Only the theme key is dropped - the pairing flag below must survive
  // the post-accept navigation, which re-runs this script.
  try { localStorage.removeItem('dsh.remote.theme') } catch {}
  // Both web storages are read through guards: the demo also loads throwaway
  // documents (the caption bar) where touching storage throws instead of
  // returning null, and an uncaught throw in an init script would surface as a
  // page failure and pollute the run's diagnostics with a non-defect.
  const readStore = (key) => { try { return sessionStorage.getItem(key) } catch { return null } }
  const writeStore = (key, value) => { try { sessionStorage.setItem(key, value) } catch {} }
  // Paired state survives the post-accept navigation via sessionStorage
  // (addScriptToEvaluateOnNewDocument re-runs on every load).
  let paired = readStore('demo-paired') === '1'
  // Diagnostics survive navigation the same way, so the final dump can still
  // report what the chat screens rendered.
  const load = (key, fallback) => {
    try { return JSON.parse(readStore(key) || 'null') || fallback } catch { return fallback }
  }
  const save = (key, value) => { writeStore(key, JSON.stringify(value)) }
  window.__seen = load('demo-seen', {})
  window.__calls = load('demo-calls', [])
  window.__unknown = load('demo-unknown', [])
  window.__errors = load('demo-errors', [])
  // Which timeline segment is on screen right now; the overflow sampler below
  // groups its measurements by it. Set from the timeline, never guessed.
  window.__seg = 'pair'
  // Worst horizontal overflow seen per segment, per selector. Persisted like
  // the other diagnostics so the sampler keeps appending across the run.
  window.__overflow = load('demo-overflow', {})
  window.__measure = () => {
    const bucket = window.__overflow[window.__seg] ?? (window.__overflow[window.__seg] = { samples: 0, hit: {} })
    bucket.samples += 1
    for (const selector of [...${JSON.stringify(OVERFLOW_SELECTORS)}, ...${JSON.stringify(ELLIPSIS_SELECTORS)}]) {
      for (const el of document.querySelectorAll(selector)) {
        const clientWidth = el.clientWidth
        if (clientWidth === 0) continue
        const over = el.scrollWidth - clientWidth
        const previous = bucket.hit[selector]
        if (previous === undefined || over > previous.over) {
          bucket.hit[selector] = { scrollWidth: el.scrollWidth, clientWidth, over }
        }
      }
    }
    save('demo-overflow', window.__overflow)
  }
  window.addEventListener('error', (event) => {
    window.__errors.push('error: ' + String(event.message))
    save('demo-errors', window.__errors)
  })
  window.addEventListener('unhandledrejection', (event) => {
    window.__errors.push('rejection: ' + String(event.reason && event.reason.message ? event.reason.message : event.reason))
    save('demo-errors', window.__errors)
  })

  // The mobile RPC carrier expects the four-quadrant envelope: echo the
  // request's rpcId inside a server-response frame with a result block.
  const ok = (value, init) => {
    let rpcId = ''
    try { rpcId = JSON.parse(String(init?.body ?? '{}')).rpcId ?? '' } catch {}
    return Promise.resolve(new Response(JSON.stringify({
      type: 'server-response', rpcId, result: { ok: true, value },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
  }
  const err = (status, message) => Promise.resolve(new Response(JSON.stringify({ ok: false, error: { code: 'ERR', message } }), {
    status, headers: { 'content-type': 'application/json' },
  }))
  // Shaped no-op answers for the reads the surface makes on screens this run
  // only glances at. Every shape is copied from the declared return type: a
  // bare {} makes the caller index into undefined (v1.6.0 polls the pending
  // endpoint on a timer and reads .approvals off it immediately).
  const EMPTY = {
    'mobile.observe': {},
    'mobile.pending': { approvals: [], questions: [] },
    'mobile.readChat': { rows: ${JSON.stringify(CHAT_ROWS)}, maxSeq: 3, hasMore: false },
    'mobile.commands': { items: [] },
    'mobile.previews': { items: [] },
    'mobile.runningSessions': { sessionIds: ['s-1'] },
    'mobile.notifyEvents': { items: [] },
    'mobile.latestVersion': { latest: '1.6.0', isNewer: false },
    'mobile.usage': { providers: [], fetchedAt: 0 },
    'mobile.voiceServices': { services: [] },
    'mobile.diagnostics': { checks: [], now: 0 },
    'session.models': { current: { provider: 'demo', model: 'demo-1' }, routable: true, groups: [], failures: [] },
    'subagent.list': { entries: [], parentAvailable: false },
    'pair.devices': { devices: [], maxDevices: 4 },
    'push.config': {
      turnThresholdMs: 60_000,
      turnCooldownMs: 300_000,
      hideDetails: false,
      kinds: { jobs: false, todo: true, turns: true },
      channels: {
        serverchan: { configured: false },
        bark: { configured: false },
        telegram: { configured: false },
        wxpusher: { configured: false },
        pushplus: { configured: false },
      },
    },
    'settings.mutate': {},
  }
  const realFetch = window.fetch
  window.fetch = (input, init) => {
    const url = String(input)
    if (url === '/api/pair/accept') {
      paired = true
      try { sessionStorage.setItem('demo-paired', '1') } catch {}
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    if (url.startsWith('/m/api/')) {
      const method = url.slice('/m/api/'.length)
      if (!window.__calls.includes(method)) {
        window.__calls.push(method)
        save('demo-calls', window.__calls)
      }
      if (method === 'mobile.preferences') {
        if (!paired) return err(403, 'unpaired')
        return ok({ mobileEnterToSend: true }, init)
      }
      switch (method) {
        case 'workspace.list': return ok({ items: ${JSON.stringify(WORKSPACES)} }, init)
        case 'session.list': return ok({ items: ${JSON.stringify(SESSIONS)}, hasMore: false }, init)
        case 'session.history': return ok({ events: ${JSON.stringify(HISTORY)}, hasMore: false }, init)
        case 'agentPreset.list': return ok({ presets: [], authorable: true, hasDocument: true }, init)
        case 'settings.read': return ok({ writable: true, hasDocument: true, namespaces: [] }, init)
        case 'session.create': return ok({ sessionId: 's-new' }, init)
      }
      if (Object.prototype.hasOwnProperty.call(EMPTY, method)) return ok(EMPTY[method], init)
      if (!window.__unknown.includes(method)) {
        window.__unknown.push(method)
        save('demo-unknown', window.__unknown)
      }
      return ok({}, init)
    }
    return realFetch(input, init)
  }
  const RealEventSource = window.EventSource
  window.EventSource = class extends RealEventSource {
    constructor(url) {
      super(url)
      window.__muxSource = this
    }
  }
  // A live host frame carries the host clock, so an event without an explicit
  // time is stamped "now"; __ageMs back-dates the turn anchor instead (the
  // turn/start boundary is excluded from the surface's clock calibration, so a
  // deliberately older anchor survives and the stopwatch reads a real elapsed).
  window.__muxPush = (frame) => {
    const src = window.__muxSource
    if (src === undefined) return false
    const event = frame && frame.event
    if (event && typeof event === 'object') {
      const age = typeof event.__ageMs === 'number' ? event.__ageMs : 0
      if ('__ageMs' in event) delete event.__ageMs
      if (typeof event.time !== 'number') event.time = Date.now() - age
    }
    try {
      // The mux channel carries server-request envelopes whose payload is
      // the frame (same wire shape as the desktop mux channel).
      src.onmessage?.({ data: JSON.stringify({ type: 'server-request', rpcId: 'demo-rpc', method: 'mux', payload: frame }) })
    } catch {}
    return true
  }
  // Record which real surfaces actually painted, for the end-of-run report.
  const WATCH = {
    pairCard: '.mobile-pairCard',
    workspaceList: '.mobile-list',
    chat: '.chat-scroll',
    processCard: '.chat-proc',
    processRunning: '.chat-proc-running',
    processExpanded: '.chat-proc-open',
    reportCard: '.chat-turn-tail',
    wakeCard: '.chat-trigger',
    diffCard: '.diff-block',
    codeBlock: '.code-block',
    settingsPage: '.settings-group',
  }
  window.__markSeen = () => {
    for (const key of Object.keys(WATCH)) {
      if (document.querySelector(WATCH[key]) !== null) window.__seen[key] = true
    }
    window.__seen.theme = document.documentElement.dataset.theme || null
    window.__seen.segments = Object.keys(window.__overflow)
    save('demo-seen', window.__seen)
  }
  // One sampler for both diagnostics: which surfaces painted, and the worst
  // horizontal overflow per segment. Sampling rather than a single reading per
  // segment is what catches a transient (a streaming line that is long for
  // 300ms and then grows the block it lives in).
  const startSampler = () => {
    setInterval(() => {
      try { window.__markSeen() } catch {}
      try { window.__measure() } catch {}
    }, 400)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startSampler)
  else startSampler()
})()`

// ── CDP helpers ────────────────────────────────────────────────────────────

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => resolve(ws)
    ws.onerror = reject
  })
}

// ── main ──────────────────────────────────────────────────────────────────

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--user-data-dir=' + join(process.cwd(), '.chrome-gif-capture'),
  `--window-size=${WIDTH},${HEIGHT}`,
  '--no-first-run',
  '--disable-gpu',
  TARGET,
], { stdio: 'ignore' })

let ws
try {
  // Wait for the DevTools endpoint and grab the page target.
  let targets
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)
      targets = await res.json()
      if (targets.some(t => t.type === 'page')) break
    } catch { /* not up yet */ }
    await sleep(500)
  }
  const page = targets?.find(t => t.type === 'page')
  if (page === undefined) throw new Error('no page target')

  ws = await connect(page.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()
  // Page-side failures are surfaced instead of silently baking a broken frame
  // sequence into the artifact.
  const failures = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const details = msg.params?.exceptionDetails
      failures.push(String(details?.exception?.description ?? details?.text ?? 'unknown exception'))
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      const text = (msg.params.args ?? []).map(arg => String(arg.description ?? arg.value ?? '')).join(' ')
      if (!text.includes('React will try to recreate')) failures.push(`console.error: ${text}`)
    }
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true,
  })
  // Pin the OS scheme to light: "system" mode resolves through
  // prefers-color-scheme, which otherwise reflects the machine the capture
  // runs on, so the first six segments would be dark on a dark desktop.
  // The dark ending must come only from the explicit settings pick.
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  })
  // Idempotence: wipe the pairing cookie, the demo diagnostics and the stored
  // theme, so a re-run starts unpaired on the light palette like the first run.
  await send('Runtime.evaluate', { expression: '(() => { try { localStorage.clear() } catch {} try { sessionStorage.clear() } catch {} return true })()' })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK_SOURCE })
  await send('Page.reload', { ignoreCache: true })
  await sleep(2500)

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true })
    return r.result?.result?.value
  }
  // Diagnostic dump: confirm the mock took effect and the gate state.
  const diag = await evalJs(`(() => ({
    fetchMocked: window.fetch.toString().includes('demo-paired'),
    pairCard: !!document.querySelector('.mobile-pairCard'),
    errorText: document.querySelector('.mobile-error')?.textContent ?? null,
    body: document.body?.innerText?.slice(0, 120) ?? 'NO BODY',
  }))()`)
  console.log('diag:', JSON.stringify(diag))
  const shot = async () => {
    const r = await Promise.race([
      send('Page.captureScreenshot', { format: 'png' }),
      new Promise(resolve => setTimeout(() => resolve(undefined), 3000)),
    ])
    return r?.result?.data
  }
  // The three 1.6.0 cards also ship as standalone README stills. They are
  // captured from the same live session at deviceScaleFactor 1, so the file is
  // a native 390x844 screenshot (not a frame lifted out of the quantized GIF).
  const captureCard = async (name) => {
    if (PROBE) return true
    mkdirSync(SHOT_DIR, { recursive: true })
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: true })
    await sleep(200)
    const r = await send('Page.captureScreenshot', { format: 'png' })
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true })
    if (typeof r?.result?.data !== 'string') {
      console.log('shot', name, 'FAILED')
      return false
    }
    const file = join(SHOT_DIR, `${name}.png`)
    writeFileSync(file, Buffer.from(r.result.data, 'base64'))
    console.log('shot', file, statSync(file).size, 'bytes')
    return true
  }

  mkdirSync(FRAMES_DIR, { recursive: true })
  const frameAt = (t) => Math.min(TOTAL_FRAMES - 1, Math.round(t * FPS))

  // Shared in-page snippets, so the timeline below reads as a scenario.
  const typeCode = (value) => `(() => {
    const input = document.querySelector('#mobile-pair-link')
    if (input === null) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`
  const clickSel = (selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (el === null) return false
    el.click()
    return true
  })()`
  // Marks the timeline segment that is on screen from here on. This drives the
  // overflow report grouping only - the caption bar itself is composited by
  // ffmpeg from CAPTIONS[], never drawn inside the page.
  const setSeg = (id) => `(() => { window.__seg = ${JSON.stringify(id)}; return true })()`
  const pushEvent = (event) => `(() => { window.__muxPush(${JSON.stringify({ type: 'session/event', sessionId: 's-1', event })}); return true })()`
  const pushFrame = (frame) => `(() => { window.__muxPush(${JSON.stringify(frame)}); return true })()`
  const scrollBottom = `(() => {
    const scroller = document.querySelector('.chat-scroll')
    if (scroller === null) return false
    scroller.scrollTop = scroller.scrollHeight
    return true
  })()`
  // Open a collapsed process group without closing one that is already open.
  const expandProcess = `(() => {
    const head = document.querySelector('.chat-proc-head[aria-expanded]')
    if (head === null) return false
    if (head.getAttribute('aria-expanded') === 'false') head.click()
    return true
  })()`
  // The answer's diff card renders after the process group, so take the last.
  const acceptLastDiff = `(() => {
    const buttons = document.querySelectorAll('.diff-accept')
    if (buttons.length === 0) return false
    buttons[buttons.length - 1].click()
    return true
  })()`
  // Label-based lookups: the settings page labels its rows in the DOM, so the
  // scenario reads as intent and survives a class rename better than an index.
  const clickSettingsRow = (title) => `(() => {
    for (const row of document.querySelectorAll('.settings-row')) {
      const text = row.querySelector('.card-titleText')
      if (text !== null && text.textContent === ${JSON.stringify(title)}) { row.click(); return true }
    }
    return false
  })()`
  const clickSheetOption = (label) => `(() => {
    for (const option of document.querySelectorAll('.sheet-option')) {
      const text = option.querySelector('.sheet-option-title')
      if (text !== null && text.textContent === ${JSON.stringify(label)}) { option.click(); return true }
    }
    return false
  })()`

  // Timeline actions (seconds since start).
  const actions = [
    // 1. Pairing gate (0-4s).
    { at: 0, label: 'segment:pair', run: () => evalJs(setSeg('pair')) },
    { at: 1.3, label: 'type pairing code', run: () => evalJs(typeCode('482913')) },
    { at: 3.0, label: 'submit pairing', waitAfter: 2500, run: () => evalJs(clickSel('.mobile-pairSubmit')) },

    // 2. Workspace -> session list (4-8s).
    { at: 4.4, label: 'segment:list', run: () => evalJs(setSeg('list')) },
    { at: 5.2, label: 'open workspace', run: () => evalJs(`(() => {
      const card = document.querySelector('.mobile-list .card-title')
      if (card === null) return false
      card.closest('button')?.click()
      return true
    })()`) },
    { at: 6.4, label: 'confirm session list', run: () => evalJs(`(() => {
      const row = document.querySelector('.mobile-list .mobile-row')
      if (row === null) return false
      row.scrollIntoView({ block: 'start' })
      return true
    })()`) },

    // 3. Process card (8-20s): running, then settled.
    { at: 8.0, label: 'segment:process', run: () => evalJs(setSeg('process')) },
    { at: 8.4, label: 'open session', run: () => evalJs(clickSel('.mobile-list .mobile-row')) },
    { at: 9.0, label: 'turn 5 start', run: () => evalJs(pushEvent(TURN5[0])) },
    { at: 9.4, label: 'turn 5 reasoning', run: () => evalJs(pushEvent(TURN5[1])) },
    { at: 9.9, label: 'turn 5 narration', run: () => evalJs(pushEvent(TURN5[2])) },
    { at: 10.4, label: 'turn 5 search', run: () => evalJs(pushEvent(TURN5[3])) },
    { at: 10.8, label: 'turn 5 search result', run: () => evalJs(pushEvent(TURN5[4])) },
    { at: 11.2, label: 'expand process card', run: () => evalJs(expandProcess) },
    { at: 11.8, label: 'turn 5 reasoning 2', run: () => evalJs(pushEvent(TURN5[5])) },
    { at: 12.4, label: 'turn 5 read', run: () => evalJs(pushEvent(TURN5[6])) },
    { at: 12.9, label: 'turn 5 read result', run: () => evalJs(pushEvent(TURN5[7])) },
    { at: 13.6, label: 'turn 5 test run', run: () => evalJs(pushEvent(TURN5[8])) },
    { at: 14.6, label: 'turn 5 test result', run: () => evalJs(pushEvent(TURN5[9])) },
    { at: 15.2, label: 'shot:process-card', run: () => captureCard('process-card') },
    { at: 15.6, label: 'scroll to live rows', run: () => evalJs(scrollBottom) },
    { at: 17.0, label: 'turn 5 answer', run: () => evalJs(pushEvent(TURN5[10])) },
    { at: 18.2, label: 'expand process card again', run: () => evalJs(expandProcess) },
    { at: 19.0, label: 'turn 5 end', run: () => evalJs(pushEvent(TURN5[11])) },
    { at: 19.5, label: 'scroll to settled card', run: () => evalJs(scrollBottom) },

    // 4. Streamed answer + diff card + code (20-27s).
    { at: 20.0, label: 'segment:stream', run: () => evalJs(setSeg('stream')) },
    { at: 20.3, label: 'turn 6 start', run: () => evalJs(pushEvent(TURN6[0])) },
    { at: 20.7, label: 'turn 6 reasoning', run: () => evalJs(pushEvent(TURN6[1])) },
    { at: 21.1, label: 'turn 6 narration', run: () => evalJs(pushEvent(TURN6[2])) },
    { at: 21.6, label: 'turn 6 edit call', run: () => evalJs(pushEvent(TURN6[3])) },
    { at: 22.2, label: 'turn 6 edit result', run: () => evalJs(pushEvent(TURN6[4])) },
    { at: 22.8, label: 'turn 6 answer text', run: () => evalJs(pushEvent(TURN6[5])) },
    { at: 23.4, label: 'scroll to answer', run: () => evalJs(scrollBottom) },
    { at: 25.6, label: 'accept diff card', run: () => evalJs(acceptLastDiff) },

    // 5. Turn-tail report card (27-33s).
    { at: 26.0, label: 'declare deliverable', run: () => evalJs(pushEvent(TURN6[6])) },
    { at: 26.6, label: 'turn 6 end', run: () => evalJs(pushEvent(TURN6[7])) },
    { at: 27.0, label: 'segment:report', run: () => evalJs(setSeg('report')) },
    { at: 27.4, label: 'scroll to report card', run: () => evalJs(scrollBottom) },
    { at: 30.0, label: 'hold report card', run: () => evalJs(scrollBottom) },
    { at: 30.6, label: 'shot:report-card', run: () => captureCard('report-card') },

    // 6. Wake-message card (33-37s).
    { at: 33.2, label: 'segment:wake', run: () => evalJs(setSeg('wake')) },
    { at: 33.6, label: 'wake message', run: () => evalJs(pushEvent(WAKE)) },
    { at: 34.2, label: 'scroll to wake card', run: () => evalJs(scrollBottom) },
    { at: 35.2, label: 'expand wake card', run: () => evalJs(clickSel('.chat-trigger-head')) },
    { at: 35.8, label: 'shot:wake-card', run: () => captureCard('wake-card') },
    { at: 36.2, label: 'hold wake card', run: () => evalJs(scrollBottom) },

    // 7. Settings page, then dark theme (37-42s). The settings header carries
    // no theme toggle; the surface's own 主题 row opens the option sheet.
    { at: 37.2, label: 'segment:theme', run: () => evalJs(setSeg('theme')) },
    { at: 37.6, label: 'back to sessions', run: () => evalJs(clickSel('.mobile-back')) },
    { at: 38.6, label: 'open settings', run: () => evalJs(clickSel('.mobile-iconbtn[aria-label="设置"]')) },
    { at: 39.4, label: 'scroll to appearance', run: () => evalJs(`(() => {
      for (const group of document.querySelectorAll('.settings-group')) {
        const title = group.querySelector('.settings-groupTitle')
        if (title !== null && title.textContent.startsWith('外观')) {
          group.scrollIntoView({ block: 'start' })
          return true
        }
      }
      return false
    })()`) },
    { at: 40.2, label: 'open theme sheet', run: () => evalJs(clickSettingsRow('主题')) },
    { at: 41.0, label: 'pick dark theme', run: () => evalJs(clickSheetOption('深色')) },
    { at: 41.6, label: 'hold dark theme', run: () => evalJs('(() => { try { window.__markSeen() } catch {} ; return true })()') },
  ].sort((a, b) => a.at - b.at)

  // Record frames: one screenshot per tick, actions fire at their timestamps.
  // A failed/blank screenshot is replaced with the previous frame so the
  // frame sequence stays complete (navigation moments can stall the capture).
  const start = Date.now()
  let lastFrame
  for (let i = 0; i < TOTAL_FRAMES; i += 1) {
    const t = i / FPS
    for (const action of actions) {
      if (t >= action.at && !action.fired) {
        action.fired = true
        try {
          const ok = await action.run()
          if (ok !== true) console.log(`action ${action.at}s (${action.label}) returned`, ok)
        } catch (e) { console.log(`action ${action.at}s (${action.label}) failed:`, e?.message) }
        // The pair-accept action navigates the page; give the reload time to
        // settle before the next frame so the GIF does not linger on a blank.
        if (action.waitAfter !== undefined) await sleep(action.waitAfter)
      }
    }
    const data = PROBE ? undefined : await shot()
    if (typeof data === 'string') {
      lastFrame = data
      writeFileSync(join(FRAMES_DIR, `frame-${String(i).padStart(4, '0')}.png`), Buffer.from(data, 'base64'))
    } else if (!PROBE && lastFrame !== undefined) {
      writeFileSync(join(FRAMES_DIR, `frame-${String(i).padStart(4, '0')}.png`), Buffer.from(lastFrame, 'base64'))
    }
    // Keep the wall clock aligned with the frame clock.
    const elapsed = Date.now() - start
    const target = i * (1000 / FPS)
    if (elapsed < target) await sleep(target - elapsed)
  }
  console.log('captured', TOTAL_FRAMES, 'frames', PROBE ? '(probe: nothing written)' : '')

  // ── what actually painted (evidence for the run report) ─────────────────
  const seen = await evalJs('JSON.stringify(window.__seen ?? {})')
  const calls = await evalJs('JSON.stringify(window.__calls ?? [])')
  const unknown = await evalJs('JSON.stringify(window.__unknown ?? [])')
  const errors = await evalJs('JSON.stringify(window.__errors ?? [])')
  const overflow = await evalJs('JSON.stringify(window.__overflow ?? {})')
  console.log('seen:', seen)
  console.log('rpc methods:', calls)
  console.log('unhandled methods:', unknown)
  console.log('page errors:', errors)

  // ── horizontal overflow report (defect 2's objective evidence) ───────────
  // scrollWidth > clientWidth on a horizontal scroller means content is wider
  // than the box that shows it, i.e. a static frame clips it. Note that
  // `.chat-scroll` alone is NOT enough: `.code-body` scrolls internally, so an
  // over-long code line leaves the outer layout at 0 overflow while the code
  // itself is clipped. Both rows are printed for that reason.
  const report = JSON.parse(overflow ?? '{}')
  const cell = (selector, entry) => `${selector.replace(/^\./, '')} ${entry.scrollWidth}/${entry.clientWidth}`
    + (entry.over > 0 ? ` +${entry.over}` : '')
  console.log('overflow report (worst scrollWidth/clientWidth per segment):')
  let worst = 0
  for (const caption of CAPTIONS) {
    const bucket = report[caption.id] ?? { hit: {}, samples: 0 }
    const parts = []
    for (const selector of OVERFLOW_SELECTORS) {
      const entry = bucket.hit?.[selector]
      if (entry === undefined) continue
      worst = Math.max(worst, entry.over)
      parts.push(`${cell(selector, entry)}${entry.over > 0 ? ' CLIP' : ' ok'}`)
    }
    console.log(`  ${caption.id.padEnd(9)} ${String(bucket.samples).padStart(2)} samples  ${parts.join(' | ') || '(no measured element)'}`)
  }
  console.log('  worst overflow:', worst, worst === 0 ? '(no segment clips horizontally)' : '(CLIPPED - shorten the injected content)')
  console.log('single-line labels the stylesheet truncates with an ellipsis (informational, not clipping):')
  for (const caption of CAPTIONS) {
    const bucket = report[caption.id] ?? { hit: {} }
    const parts = []
    for (const selector of ELLIPSIS_SELECTORS) {
      const entry = bucket.hit?.[selector]
      if (entry === undefined) continue
      parts.push(`${cell(selector, entry)}${entry.over > 0 ? ` shortened by ${entry.over}px` : ' fits'}`)
    }
    if (parts.length > 0) console.log(`  ${caption.id.padEnd(9)} ${parts.join(' | ')}`)
  }

  if (PROBE) {
    console.log('probe: no frames and no GIF written')
  } else {
    // ── caption strips: rendered outside the page, composited outside it ───
    // Each bar is its own document. Replacing the app document outright is what
    // guarantees the strip contains nothing but the caption: no app element can
    // paint into a screenshot of a document the app is not running in.
    const captionFiles = []
    const frameTree = await send('Page.getFrameTree')
    const frameId = frameTree.result?.frameTree?.frame?.id
    if (frameId === undefined) throw new Error('no frame id for the caption strips')
    for (const [index, caption] of CAPTIONS.entries()) {
      const escaped = caption.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const html = '<!doctype html><html><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        + `<body style="margin:0;overflow:hidden"><div style="box-sizing:border-box;height:${CAPTION_H}px;`
        + 'display:flex;align-items:center;justify-content:center;background:#141416;padding:0 14px">'
        + '<span id="txt" style="font:12.5px/1.35 -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;'
        + 'color:#fff;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">'
        + escaped + '</span></div></body></html>'
      await send('Page.setDocumentContent', { frameId, html })
      await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: CAPTION_H, deviceScaleFactor: 2, mobile: true })
      await sleep(200)
      const fit = await evalJs(`(() => {
        const el = document.getElementById('txt')
        return el === null ? null : { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
      })()`)
      const r = await send('Page.captureScreenshot', { format: 'png' })
      if (typeof r?.result?.data !== 'string') throw new Error(`caption ${caption.id} screenshot failed`)
      const file = join(FRAMES_DIR, `cap-${index + 1}.png`)
      writeFileSync(file, Buffer.from(r.result.data, 'base64'))
      captionFiles.push(file)
      const fits = fit !== null && fit.scrollWidth <= fit.clientWidth
      console.log('caption', caption.id, 'strip', statSync(file).size, 'bytes',
        `text ${fit?.scrollWidth ?? '?'}/${fit?.clientWidth ?? '?'}`, fits ? 'fits one line' : 'TRUNCATED')
    }

    // ── ffmpeg: palette-optimized GIF, 390x884 ─────────────────────────────
    const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
    const palette = join(FRAMES_DIR, 'palette.png')
    const run = (args) => new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let err = ''
      child.stderr.on('data', (d) => { err += String(d) })
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`)))
    })
    // Each caption image is looped for the whole run so every filter input has
    // the same length; the per-segment `enable` window is what actually decides
    // when it shows. A single-frame input would rely on overlay's eof handling
    // instead, which is the kind of implicit behaviour worth not depending on.
    const captionArgs = () => CAPTIONS.flatMap((_, index) => [
      '-loop', '1', '-framerate', String(FPS), '-t', String(DURATION_S),
      '-i', join(FRAMES_DIR, `cap-${index + 1}.png`),
    ])
    // [0:v] is the phone frame: scaled to 390x844, then padded to 390x884. The
    // caption overlays at y=844 (i.e. strictly below the phone pixels) and only
    // inside its own segment's window.
    const graph = () => {
      const strips = CAPTIONS.map((_, index) =>
        `[${index + 1}:v]scale=${WIDTH}:${CAPTION_H}:flags=lanczos[c${index + 1}]`).join(';')
      let chain = `[0:v]scale=${WIDTH}:${HEIGHT}:flags=lanczos,pad=${WIDTH}:${CANVAS_H}:0:0:color=0x141416[base]`
      let last = 'base'
      CAPTIONS.forEach((caption, index) => {
        const out = `v${index + 1}`
        chain += `;[${last}][c${index + 1}]overlay=0:${HEIGHT}:enable='between(t,${caption.from},${caption.to})'[${out}]`
        last = out
      })
      return `${strips};${chain};[${last}]`
    }
    const encode = async (colours, dither, gifflags) => {
      const head = graph()
      await run(['-y', '-framerate', String(FPS), '-i', join(FRAMES_DIR, 'frame-%04d.png'),
        ...captionArgs(),
        '-filter_complex', `${head}palettegen=max_colors=${colours}[pal]`, '-map', '[pal]', palette])
      await run(['-y', '-framerate', String(FPS), '-i', join(FRAMES_DIR, 'frame-%04d.png'),
        ...captionArgs(),
        '-i', palette,
        '-filter_complex', `${head}[${CAPTIONS.length + 1}:v]paletteuse=dither=${dither}:diff_mode=rectangle[out]`,
        '-map', '[out]', '-loop', '0', ...gifflags, OUT])
    }
    // The GIF logical screen is read straight out of the header rather than via
    // ffprobe: this is the one property the whole caption design rests on (bar
    // strictly below y=844), so it is checked with the fewest moving parts.
    const gifCanvas = (file) => {
      const header = readFileSync(file)
      return { width: header.readUInt16LE(6), height: header.readUInt16LE(8) }
    }
    // Attempt ladder. The canvas the encoder actually emitted is checked from
    // the GIF header after every attempt, because 390x884 is an acceptance
    // property of this artifact and not something to infer from the filtergraph
    // (the encoder's own frame-offsetting / inter-frame transparency settings do
    // affect it). The later rungs are the size fallbacks: 128 colours and a
    // lighter dither cost little on a UI that is mostly a few flat greys.
    const attempts = [
      { colours: 256, dither: 'sierra2_4a', gifflags: [], note: 'default flags' },
      { colours: 256, dither: 'sierra2_4a', gifflags: ['-gifflags', '-offsetting'], note: 'no frame offsetting' },
      { colours: 256, dither: 'sierra2_4a', gifflags: ['-gifflags', '-offsetting-transdiff'], note: 'no offsetting, no transparency' },
      { colours: 128, dither: 'bayer:bayer_scale=3', gifflags: ['-gifflags', '-offsetting'], note: '128 colours, no offsetting' },
      { colours: 128, dither: 'bayer:bayer_scale=3', gifflags: ['-gifflags', '-offsetting-transdiff'], note: '128 colours, no offsetting, no transparency' },
    ]
    let bytes = 0
    let canvas = { width: 0, height: 0 }
    for (const attempt of attempts) {
      await encode(attempt.colours, attempt.dither, attempt.gifflags)
      bytes = statSync(OUT).size
      canvas = gifCanvas(OUT)
      const shaped = canvas.width === WIDTH && canvas.height === CANVAS_H
      const sized = bytes <= MAX_BYTES
      console.log(`encoded (${attempt.note}): ${canvas.width}x${canvas.height}, ${bytes} bytes`,
        shaped ? 'canvas ok' : `CANVAS MISMATCH (want ${WIDTH}x${CANVAS_H})`,
        sized ? 'within budget' : 'over the 2 MB budget')
      if (shaped && sized) break
    }
    if (failures.length > 0) {
      console.log('page failures while recording:')
      for (const failure of [...new Set(failures)]) console.log('  -', failure)
    }
    if (canvas.width !== WIDTH || canvas.height !== CANVAS_H) {
      // Non-zero exit so a wrapper cannot mistake a mis-shaped artifact for a
      // successful run.
      process.exitCode = 1
      console.log('FAILED: no encoder setting produced the requested canvas - the caption strip is NOT')
      console.log('        guaranteed to sit outside the phone frame, so this artifact must not be shipped.')
    }
    console.log('final size', bytes, 'bytes', bytes <= MAX_BYTES ? '(within 2 MB)' : '(STILL OVER BUDGET)')
  }
} finally {
  ws?.close()
  chrome.kill()
  rmSync(FRAMES_DIR, { recursive: true, force: true })
}
