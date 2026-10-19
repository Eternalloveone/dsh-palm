/**
 * Recapture the README's phone stills against the live `/m/` surface, in one
 * repeatable run: chat, diff, run-status, pair, usage-card, settings, attach,
 * sessions, workspace and tasks.
 *
 * The pipeline is the one `scripts/capture-gif.mjs` already established, minus
 * the frame timeline: drive a headless Chrome over CDP, open the real `/m/`
 * page, inject FICTIONAL demo data (workspaces / sessions / chat rows / live
 * mux frames / usage providers), then screenshot the real UI. Nothing on screen
 * comes from the host this machine happens to be running - the mock answers
 * every `/m/api` call the surface makes, so no real workspace path, session
 * title or chat line can leak into the repository.
 *
 * Why a separate script instead of another mode inside capture-gif.mjs: the GIF
 * is a 42-second recording with a caption strip and an ffmpeg palette pass; the
 * stills are ten independent UI states, each with its own assertions. Sharing
 * the timeline loop would mean either capturing ten unwanted frames or
 * threading a second schedule through it.
 *
 * Viewport: 390x844 at deviceScaleFactor 1, matching the newer card stills
 * (process-card / report-card / wake-card). The theme is pinned to light: the
 * OS scheme is emulated as `light` AND the stored `dsh.remote.theme` key is
 * cleared before the app boots, because the mode is persisted in the Chrome
 * profile and a run that ends dark would make the next run start dark.
 *
 * Usage: node scripts/capture-stills.mjs [outDir]
 *   outDir defaults to docs/screenshots. A temp dir is accepted, so a dry run
 *   never overwrites the committed screenshots.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DEBUG_PORT = 9224
const OUT_DIR = process.argv[2] ?? join(process.cwd(), 'docs', 'screenshots')
const TARGET = 'http://127.0.0.1:3080/m/'
const WIDTH = 390
const HEIGHT = 844
// Raw RGB dumps for the blank/empty check live in the OS temp dir, never in the
// repo: a killed run must not leave an artefact behind for `git status` to show.
const SCRATCH = join(tmpdir(), `dsh-stills-${process.pid}`)

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── fictional demo data ────────────────────────────────────────────────────
//
// The same invented workspace / session / chat set the demo GIF is recorded
// against, so the stills and the GIF tell one story.

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

// The chat reads through the v3 `mobile.readChat` page: HOST-folded rows
// (RenderMessage[]), not raw events. `maxSeq` is the replay floor live frames
// must clear, so it matches the highest row seq.
const CHAT_ROWS = [
  { id: 'u-1', kind: 'user', text: 'The public API has no rate limiting yet. Can you add one?', seq: 1, time: T0 },
  { id: 'a-1', kind: 'assistant', turn: 2, step: 0, text: 'A token bucket per client key fits best here. I would put it in `src/app.ts` so every route inherits it, keep the limit configurable, and return `429` with a `Retry-After` header.', seq: 2, time: T0 + 1000 },
  { id: 'u-2', kind: 'user', text: 'Sounds good. Take a look at the middleware chain first.', seq: 3, time: T0 + 2000 },
]

// Turn 3 — the process-card showcase for chat.png. Two working steps before the
// answer, so the expanded group holds reasoning and tool rows interleaved in
// event order while the final step's text renders outside the group as the
// answer. The answer carries both a syntax-highlighted fence and a ```diff
// fence (diff.png scrolls to that card).
//
// Every injected code line stays <= 34 characters: an over-long line is clipped
// by the code body's own horizontal scroller and reads as "the UI is broken" in
// a still.
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

const TURN_MAIN = [
  { type: 'turn/start', seq: 10, data: { turn: 3 }, __ageMs: 42_000 },
  { type: 'assistant/chunk', seq: 11, data: { turn: 3, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'Rate limiting belongs next to the request-id middleware, before the route table, so every route inherits it.' } } },
  { type: 'assistant/chunk', seq: 12, data: { turn: 3, step: 0, chunk: { type: 'text-delta', index: 0, text: 'Let me look at how the middleware chain is assembled.\n\n' } } },
  { type: 'tool/call', seq: 13, data: { turn: 3, step: 0, callId: 'c-search', name: 'grep', arguments: '{"pattern":"use(","path":"src"}' } },
  { type: 'tool/result', seq: 14, data: { turn: 3, step: 0, message: { source: { callId: 'c-search' } } } },
  { type: 'assistant/chunk', seq: 15, data: { turn: 3, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Only one entry point wires the middleware, so a single insert covers every route.' } } },
  { type: 'tool/call', seq: 16, data: { turn: 3, step: 1, callId: 'c-read', name: 'read', arguments: '{"path":"src/app.ts"}' } },
  { type: 'tool/result', seq: 17, data: { turn: 3, step: 1, message: { source: { callId: 'c-read' } } } },
  { type: 'tool/call', seq: 18, data: { turn: 3, step: 1, callId: 'c-test', name: 'bash', arguments: '{"description":"run the api tests","command":"pnpm test src"}' } },
  { type: 'tool/result', seq: 19, data: { turn: 3, step: 1, message: { source: { callId: 'c-test' } } } },
  { type: 'assistant/chunk', seq: 20, data: { turn: 3, step: 2, chunk: { type: 'text-delta', index: 0, text: ANSWER_TEXT } } },
  { type: 'turn/end', seq: 21, data: { turn: 3, reason: { kind: 'stop' } } },
]

// Turn 4 — left RUNNING on purpose. run-status.png and tasks.png need a live
// turn: the process card's second head line reports what the turn is doing right
// now, the strip above the toolbar reads "任务清单 3/6 · 后台任务 2 个运行中", and
// the run-status sheet renders the plan, the jobs and the subagent list.
const TURN_LIVE = [
  { type: 'turn/start', seq: 40, data: { turn: 4 }, __ageMs: 96_000 },
  { type: 'assistant/chunk', seq: 41, data: { turn: 4, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'Extending the limiter to the admin routes as well, then re-running the suite.' } } },
  { type: 'assistant/chunk', seq: 42, data: { turn: 4, step: 0, chunk: { type: 'text-delta', index: 0, text: 'Extending the limiter to the admin routes.\n\n' } } },
  { type: 'tool/call', seq: 43, data: { turn: 4, step: 1, callId: 'c-run', name: 'bash', arguments: '{"description":"run the api tests","command":"pnpm test src"}' } },
]

// A host `todo/write` snapshot: full-list, last-write-wins.
const TODOS = {
  type: 'todo/write',
  seq: 50,
  data: {
    todos: [
      { content: 'Read the middleware chain', status: 'completed' },
      { content: 'Add the token-bucket limiter', status: 'completed' },
      { content: 'Extend the limit to admin routes', status: 'in_progress' },
      { content: 'Add a 429 retry-after test', status: 'pending' },
    ],
  },
}

// A host `session/jobs` snapshot: two live jobs plus one settled.
const JOBS = {
  type: 'session/jobs',
  sessionId: 's-1',
  jobs: [
    { id: 'j-1', kind: 'subagent', label: 'route-audit', status: 'running', detail: '审核 admin 路由', startedAt: Date.now() - 96_000 },
    { id: 'j-2', kind: 'bash', label: 'pnpm test src', status: 'running', detail: 'run the api tests', startedAt: Date.now() - 40_000 },
    { id: 'j-3', kind: 'bash', label: 'pnpm lint', status: 'completed', startedAt: Date.now() - 200_000, finishedAt: Date.now() - 150_000 },
  ],
}

// Foreground subagents (`subagent.list`). Polled, so the sheet's 子代理 section
// is populated without any frame of its own.
const SUBAGENTS = {
  entries: [
    { id: 'sa-1', kind: 'child', label: 'route-audit', activity: 'running' },
    { id: 'sa-2', kind: 'child', label: 'docs-lint', activity: 'inactive' },
  ],
  parentAvailable: true,
}

// Usage providers: one quota meter (Ollama Cloud, the card added in 1.5.4), one
// account balance, one provider the desktop has no key for. Names and numbers
// are invented.
const USAGE = {
  providers: [
    {
      name: 'Ollama Cloud',
      baseURL: 'https://ollama.example.dev',
      kind: 'usage',
      status: 'ok',
      plan: 'Pro',
      usedPercent: 0.62,
      sessionUsed: 0.31,
      sessionResetsAt: Date.now() + 2 * 3_600_000,
      weeklyResetsAt: Date.now() + 3 * 86_400_000,
      models: [
        { name: 'demo-instruct', requestCount: 1240 },
        { name: 'demo-coder', requestCount: 86 },
      ],
      fetchedAt: Date.now(),
    },
    {
      name: 'Moonshot / Kimi',
      baseURL: 'https://api.example-moonshot.dev',
      kind: 'balance',
      status: 'ok',
      balance: '¥ 23.50',
      fetchedAt: Date.now(),
    },
    {
      // Spent-vs-limit: the third shape a usage row can take (one meter, no
      // account balance), matching the README's 消耗/限额 wording.
      name: 'OpenRouter',
      baseURL: 'https://openrouter.example.dev',
      kind: 'usage',
      status: 'ok',
      plan: 'Free',
      usedPercent: 0.42,
      fetchedAt: Date.now(),
    },
  ],
  fetchedAt: Date.now(),
}

// Host settings namespaces, so the 主机配置 group renders its rows. Values are
// placeholders; this still only needs the page to look complete.
const NAMESPACES = [
  { ns: 'ui-theme', schema: {}, value: { preference: 'system' }, applies: 'live', secrets: [], revision: 1 },
  { ns: 'llm-pi-ai', schema: {}, value: { providers: [] }, applies: 'live', secrets: [], revision: 1 },
  { ns: 'free-search', schema: {}, value: { engine: 'bing' }, applies: 'live', secrets: [], revision: 1 },
  { ns: 'tool-see-image', schema: {}, value: { enabled: true }, applies: 'live', secrets: [], revision: 1 },
  { ns: 'dsh-palm', schema: {}, value: { enabled: true }, applies: 'live', secrets: [], revision: 1 },
]

const DEVICES = {
  devices: [
    { id: 'd-1', createdAt: Date.now() - 3 * 86_400_000, lastSeenAt: Date.now(), online: true, userAgent: 'Demo Phone', name: 'Demo Phone', primary: true, current: true },
    { id: 'd-2', createdAt: Date.now() - 9 * 86_400_000, lastSeenAt: Date.now() - 7_200_000, online: false, userAgent: 'Demo Tablet', name: 'Demo Tablet', current: false },
  ],
  maxDevices: 4,
}

// ── mock injection (runs before any document script) ──────────────────────

const MOCK_SOURCE = `(() => {
  // The theme mode is persisted in localStorage, which lives in the Chrome
  // profile and therefore survives between runs: a run that finishes dark would
  // make the NEXT run boot dark. Clearing it here (an init script, so it lands
  // on the real origin before any app module reads it) is what keeps every still
  // on the light palette. Only the theme key is dropped - the pairing flag below
  // must survive the post-accept navigation, which re-runs this script.
  try { localStorage.removeItem('dsh.remote.theme') } catch {}
  const readStore = (key) => { try { return sessionStorage.getItem(key) } catch { return null } }
  const writeStore = (key, value) => { try { sessionStorage.setItem(key, value) } catch {} }
  // Paired state survives the post-accept navigation via sessionStorage
  // (addScriptToEvaluateOnNewDocument re-runs on every load).
  let paired = readStore('demo-paired') === '1'
  window.__calls = []
  window.__unknown = []
  window.__errors = []
  window.addEventListener('error', (event) => {
    window.__errors.push('error: ' + String(event.message))
  })
  window.addEventListener('unhandledrejection', (event) => {
    window.__errors.push('rejection: ' + String(event.reason && event.reason.message ? event.reason.message : event.reason))
  })

  // The mobile RPC carrier expects the four-quadrant envelope: echo the
  // request's rpcId inside a server-response frame with a result block.
  const json = (body, status) => Promise.resolve(new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  }))
  const ok = (value, init) => {
    let rpcId = ''
    try { rpcId = JSON.parse(String(init?.body ?? '{}')).rpcId ?? '' } catch {}
    return json({ type: 'server-response', rpcId, result: { ok: true, value } }, 200)
  }
  const err = (status, message) => json({ ok: false, error: { code: 'ERR', message } }, status)
  // Shaped no-op answers for the reads the surface makes on screens this run
  // only glances at. A bare {} makes the caller index into undefined.
  const EMPTY = {
    'mobile.observe': {},
    'mobile.pending': { approvals: [], questions: [] },
    'mobile.readChat': { rows: ${JSON.stringify(CHAT_ROWS)}, maxSeq: 3, hasMore: false },
    'mobile.commands': { items: [] },
    'mobile.previews': { items: [] },
    'mobile.runningSessions': { sessionIds: ['s-1'] },
    'mobile.notifyEvents': { items: [] },
    'mobile.latestVersion': { latest: '1.6.1', isNewer: false },
    'mobile.usage': ${JSON.stringify(USAGE)},
    'mobile.voiceServices': { services: [] },
    'mobile.diagnostics': { checks: [], now: 0 },
    'session.models': { current: { provider: 'demo', model: 'demo-1' }, routable: true, groups: [], failures: [] },
    'subagent.list': ${JSON.stringify(SUBAGENTS)},
    'pair.devices': ${JSON.stringify(DEVICES)},
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
      writeStore('demo-paired', '1')
      return json({ ok: true }, 200)
    }
    if (url.startsWith('/m/api/')) {
      const method = url.slice('/m/api/'.length)
      if (!window.__calls.includes(method)) window.__calls.push(method)
      if (method === 'mobile.preferences') {
        if (!paired) return err(403, 'unpaired')
        return ok({ mobileEnterToSend: true }, init)
      }
      switch (method) {
        case 'workspace.list': return ok({ items: ${JSON.stringify(WORKSPACES)} }, init)
        case 'session.list': return ok({ items: ${JSON.stringify(SESSIONS)}, hasMore: false }, init)
        case 'session.history': return ok({ events: ${JSON.stringify(HISTORY)}, hasMore: false }, init)
        case 'agentPreset.list': return ok({ presets: [], authorable: true, hasDocument: true }, init)
        case 'settings.read': return ok({ writable: true, hasDocument: true, namespaces: ${JSON.stringify(NAMESPACES)} }, init)
        case 'session.create': return ok({ sessionId: 's-new' }, init)
      }
      if (Object.prototype.hasOwnProperty.call(EMPTY, method)) return ok(EMPTY[method], init)
      if (!window.__unknown.includes(method)) window.__unknown.push(method)
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
      // The mux channel carries server-request envelopes whose payload is the
      // frame (same wire shape as the desktop mux channel).
      src.onmessage?.({ data: JSON.stringify({ type: 'server-request', rpcId: 'demo-rpc', method: 'mux', payload: frame }) })
    } catch {}
    return true
  }
})()`

// ── CDP helpers ────────────────────────────────────────────────────────────

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => resolve(ws)
    ws.onerror = reject
  })
}

/** Screenshots plus the assertions that stand behind each one. */
const shots = []
const failures = []

function assert(condition, label, detail) {
  const verdict = condition === true ? 'PASS' : 'FAIL'
  console.log(`  [${verdict}] ${label}${detail === undefined ? '' : ` -> ${detail}`}`)
  if (condition !== true) failures.push(`${label}${detail === undefined ? '' : ` -> ${detail}`}`)
  return condition
}

// ── main ──────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(SCRATCH, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--user-data-dir=' + join(process.cwd(), '.chrome-stills-capture'),
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
  // into an artifact.
  const pageFailures = []
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const details = msg.params?.exceptionDetails
      pageFailures.push(String(details?.exception?.description ?? details?.text ?? 'unknown exception'))
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      const text = (msg.params.args ?? []).map(arg => String(arg.description ?? arg.value ?? '')).join(' ')
      if (!text.includes('React will try to recreate')) pageFailures.push(`console.error: ${text}`)
    }
  }
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

  await send('Page.enable')
  await send('Runtime.enable')
  // Device metrics are set ONCE at deviceScaleFactor 1: every still is a native
  // 390x844 screenshot, the same shape as the newer card stills.
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: true,
  })
  // Pin the OS scheme to light: the surface's default mode is "system", which
  // resolves through prefers-color-scheme and would otherwise reflect the
  // machine this capture runs on.
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  })
  // Idempotence: wipe the pairing cookie and the stored theme, so a re-run
  // starts unpaired on the light palette like the first run.
  await send('Runtime.evaluate', { expression: '(() => { try { localStorage.clear() } catch {} try { sessionStorage.clear() } catch {} return true })()' })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK_SOURCE })
  await send('Page.reload', { ignoreCache: true })
  await sleep(2500)

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.result?.exceptionDetails !== undefined) {
      console.log('  eval threw:', JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text))
      return undefined
    }
    return r.result?.result?.value
  }
  // Poll a predicate until it holds (or the budget runs out). Everything that
  // waits on React is waited on this way rather than with a fixed sleep.
  const waitFor = async (expression, label, budgetMs = 8000) => {
    const deadline = Date.now() + budgetMs
    while (Date.now() < deadline) {
      const value = await evalJs(expression)
      if (value === true || (typeof value === 'number' && value > 0)) return value
      await sleep(150)
    }
    console.log(`  wait timed out: ${label}`)
    return false
  }
  const waitSel = (selector, budgetMs) => waitFor(`document.querySelector(${JSON.stringify(selector)}) !== null`, selector, budgetMs)

  // ── capture ─────────────────────────────────────────────────────────────
  const capture = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    const data = r?.result?.data
    if (typeof data !== 'string') throw new Error(`screenshot ${name} failed`)
    const file = join(OUT_DIR, `${name}.png`)
    const buffer = Buffer.from(data, 'base64')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, buffer)
    const bytes = statSync(file).size
    shots.push({ name, file, bytes, at: new Date() })
    console.log(`shot ${name}.png ${bytes} bytes`)
    return true
  }

  // ── in-page snippets, so the scene below reads as intent ────────────────
  const clickSel = (selector) => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (el === null) return false
    el.click()
    return true
  })()`
  const typeInto = (selector, value) => `(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (input === null) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`
  const pushEvent = (event) => `(() => { window.__muxPush(${JSON.stringify({ type: 'session/event', sessionId: 's-1', event })}); return true })()`
  const pushFrame = (frame) => `(() => { window.__muxPush(${JSON.stringify(frame)}); return true })()`
  // Scroll the chat viewport so `selector` lands `offset` px below its top edge.
  const scrollChatTo = (selector, offset = 0) => `(() => {
    const scroller = document.querySelector('.chat-scroll')
    const el = document.querySelector(${JSON.stringify(selector)})
    if (scroller === null || el === null) return false
    scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + ${offset}
    return true
  })()`
  const scrollChatBottom = `(() => {
    const scroller = document.querySelector('.chat-scroll')
    if (scroller === null) return false
    scroller.scrollTop = scroller.scrollHeight
    return true
  })()`
  // Open the collapsed process group (clicking an already-open head would close it).
  const expandProcess = `(() => {
    const heads = document.querySelectorAll('.chat-proc-head[aria-expanded]')
    for (const head of heads) {
      if (head.getAttribute('aria-expanded') === 'false') head.click()
    }
    return heads.length
  })()`
  const scrollSettingsTo = (title, offset = -8) => `(() => {
    const scroller = document.querySelector('.mobile-scroll')
    if (scroller === null) return false
    for (const group of document.querySelectorAll('.settings-group')) {
      const heading = group.querySelector('.settings-groupTitle')
      if (heading !== null && heading.textContent.startsWith(${JSON.stringify(title)})) {
        scroller.scrollTop += group.getBoundingClientRect().top - scroller.getBoundingClientRect().top + ${offset}
        return true
      }
    }
    return false
  })()`
  // Attach one synthetic image through the composer's hidden file chooser, so
  // attach.png shows the real preview bar without any file on disk.
  const attachDemoImage = `(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = 300
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, 480, 300)
    gradient.addColorStop(0, '#eef1fb')
    gradient.addColorStop(1, '#dfe6ff')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 480, 300)
    ctx.fillStyle = '#8f9bff'
    ctx.fillRect(28, 28, 160, 18)
    ctx.fillRect(28, 62, 240, 10)
    ctx.fillRect(28, 84, 200, 10)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(28, 116, 424, 156)
    ctx.strokeStyle = '#c9d1f5'
    ctx.lineWidth = 2
    ctx.strokeRect(28, 116, 424, 156)
    ctx.fillStyle = '#b9c2ee'
    ctx.fillRect(48, 140, 120, 12)
    ctx.fillRect(48, 168, 300, 8)
    ctx.fillRect(48, 188, 260, 8)
    ctx.fillRect(48, 208, 320, 8)
    const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/png') })
    const file = new File([blob], 'rate-limit-mock.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"][accept="image/*"]')
    if (input === null) return 'no input'
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`

  // ── scene 1: pairing gate ───────────────────────────────────────────────
  console.log('\n[1/10] pair')
  await waitSel('.mobile-pairCard', 15000)
  const pairText = await evalJs(`(() => document.querySelector('.mobile-pairCard')?.innerText ?? '')()`)
  await evalJs(typeInto('#mobile-pair-link', '482913'))
  await sleep(300)
  await capture('pair')
  assert(pairText.includes('设备配对') && pairText.includes('配对码'),
    'pair gate renders the 设备配对 form', JSON.stringify(pairText.slice(0, 60)))
  const themeName = await evalJs(`document.documentElement.dataset.theme ?? ''`)
  const prefersDark = await evalJs(`window.matchMedia('(prefers-color-scheme: dark)').matches`)
  const bodyBg = await evalJs(`getComputedStyle(document.body).backgroundColor`)
  assert(prefersDark === false, 'prefers-color-scheme is pinned to light', String(prefersDark))
  assert(themeName !== 'dark', 'stored theme is not dark', String(themeName))
  assert(bodyBg !== undefined && /^rgb\(2[0-9]{2}, 2[0-9]{2}, 2[0-9]{2}\)$/.test(String(bodyBg).replace(/\s+/g, ' ')),
    'body background is the light palette', String(bodyBg))

  // ── scene 2: workspace list ─────────────────────────────────────────────
  console.log('\n[2/10] workspace')
  await evalJs(clickSel('.mobile-pairSubmit'))
  const paired = await waitFor(`document.querySelector('.mobile-list') !== null ? true : false`, 'workspace list', 15000)
  assert(paired === true, 'pairing navigates to the workspace list')
  // The first-run welcome banner is real UI, but it covers the list this still
  // is about; dismiss it the way a user would.
  await waitFor(`document.querySelector('.mobile-welcomeClose') !== null`, 'welcome banner', 4000)
  await evalJs(clickSel('.mobile-welcomeClose'))
  await sleep(600)
  const home = await evalJs(`(() => ({
    title: document.querySelector('.mobile-title')?.textContent ?? null,
    workspaces: [...document.querySelectorAll('.mobile-list .card-titleText')].map(el => el.textContent),
    quick: [...document.querySelectorAll('.mobile-quickchip')].map(el => el.textContent),
  }))()`)
  await capture('workspace')
  assert(home?.title === '工作区', 'workspace view header is 工作区', String(home?.title))
  assert((home?.workspaces ?? []).length >= 3, 'fictional workspaces listed', JSON.stringify(home?.workspaces))

  // ── scene 3: session list ───────────────────────────────────────────────
  console.log('\n[3/10] sessions')
  await evalJs(`(() => {
    const card = document.querySelector('.mobile-list .card-title')
    if (card === null) return false
    card.closest('button')?.click()
    return true
  })()`)
  await waitSel('.mobile-row', 8000)
  await sleep(500)
  const list = await evalJs(`(() => ({
    title: document.querySelector('.mobile-title')?.textContent ?? null,
    rows: [...document.querySelectorAll('.mobile-list .sess-title')].map(el => el.textContent),
  }))()`)
  await capture('sessions')
  assert(list?.title === 'acme-api', 'session list is scoped to the opened workspace', String(list?.title))
  assert((list?.rows ?? []).length >= 3, 'session rows listed', JSON.stringify(list?.rows))

  // ── scene 4: chat with the 1.6 process card ─────────────────────────────
  console.log('\n[4/10] chat')
  await evalJs(clickSel('.mobile-list .mobile-row'))
  await waitSel('.chat-scroll', 10000)
  await sleep(800)
  for (const event of TURN_MAIN) {
    await evalJs(pushEvent(event))
    await sleep(220)
  }
  await sleep(900)
  const opened = await evalJs(expandProcess)
  assert(opened !== undefined && opened !== false, 'process card head found and clicked')
  await sleep(700)
  await evalJs(scrollChatTo('.chat-proc', -16))
  await sleep(500)
  const proc = await evalJs(`(() => {
    const card = document.querySelector('.chat-proc')
    if (card === null) return null
    const head = card.querySelector('.chat-proc-head')
    const lines = head === null ? [] : [...head.querySelectorAll('.chat-proc-line')].map(el => ({
      cls: el.className,
      text: (el.textContent ?? '').trim(),
    }))
    const body = card.querySelector('.chat-proc-body')
    const order = body === null ? [] : [...body.children].map((el) => {
      if (el.classList.contains('chat-think')) return 'think'
      if (el.classList.contains('chat-step')) return 'tool'
      if (el.classList.contains('chat-artifact')) return 'artifact'
      if (el.classList.contains('chat-proc-steps')) return 'steps'
      if (el.classList.contains('chat-flow-text')) return 'text'
      return 'markdown'
    })
    return {
      open: card.classList.contains('chat-proc-open'),
      running: card.classList.contains('chat-proc-running'),
      headLines: lines,
      state: card.querySelector('.chat-proc-state')?.textContent ?? null,
      time: card.querySelector('.chat-proc-time')?.textContent ?? null,
      current: card.querySelector('.chat-proc-current-text')?.textContent ?? null,
      order,
      thinkCount: card.querySelectorAll('.chat-think').length,
      toolCount: card.querySelectorAll('.chat-step').length,
      codeBlocks: document.querySelectorAll('.code-block').length,
      diffBlocks: document.querySelectorAll('.diff-block').length,
    }
  })()`)
  await capture('chat')
  assert(proc?.open === true, 'process card is expanded', String(proc?.open))
  assert(proc?.headLines?.length === 2, 'process card head has two lines (1.6.0 layout)',
    JSON.stringify(proc?.headLines))
  assert((proc?.thinkCount ?? 0) >= 1 && (proc?.toolCount ?? 0) >= 2,
    'expanded body holds thinking rows and tool rows',
    `think=${proc?.thinkCount} tool=${proc?.toolCount} order=${JSON.stringify(proc?.order)}`)
  assert(JSON.stringify(proc?.order).includes('"think","tool"'),
    'thinking and tools are interleaved in event order', JSON.stringify(proc?.order))
  assert((proc?.codeBlocks ?? 0) >= 1, 'answer carries a syntax-highlighted code block', String(proc?.codeBlocks))
  assert((proc?.diffBlocks ?? 0) >= 1, 'answer carries an inline diff card', String(proc?.diffBlocks))

  // ── scene 5: diff card ──────────────────────────────────────────────────
  console.log('\n[5/10] diff')
  await evalJs(scrollChatTo('.diff-block', -80))
  await sleep(500)
  const diff = await evalJs(`(() => {
    const block = document.querySelector('.diff-block')
    if (block === null) return null
    return {
      title: block.querySelector('.diff-file')?.textContent ?? null,
      actions: [...block.querySelectorAll('.diff-actions .diff-btn')].map(el => el.textContent),
      hunkLines: block.querySelectorAll('.diff-line, .diff-row, .diff-text').length,
    }
  })()`)
  await capture('diff')
  assert((diff?.actions ?? []).length >= 2 && diff.actions.includes('接受') && diff.actions.includes('拒绝'),
    'diff card exposes accept / reject actions', JSON.stringify(diff?.actions))

  // ── scene 6: image attach preview ───────────────────────────────────────
  console.log('\n[6/10] attach')
  await evalJs(scrollChatBottom)
  await sleep(300)
  const attached = await evalJs(attachDemoImage)
  await sleep(900)
  const attach = await evalJs(`(() => {
    const bar = document.querySelector('.chat-attach-bar')
    if (bar === null) return null
    const img = bar.querySelector('.chat-attach-img')
    return {
      items: bar.querySelectorAll('.chat-attach-item').length,
      decoded: img === null ? 0 : (img.complete && img.naturalWidth > 0 ? img.naturalWidth : 0),
      remove: bar.querySelectorAll('.chat-attach-remove').length,
    }
  })()`)
  await capture('attach')
  assert(attached === true, 'demo image injected through the composer file chooser', String(attached))
  assert(attach?.items === 1 && (attach?.decoded ?? 0) > 0,
    'attach bar shows one decoded image with its remove button',
    JSON.stringify(attach))

  // ── scene 7: run-status strip ───────────────────────────────────────────
  console.log('\n[7/10] run-status')
  // Clear the attachment so the strip (not the preview bar) is what the still
  // is about.
  await evalJs(clickSel('.chat-attach-remove'))
  await sleep(400)
  // Turn 4 stays running: the strip and the card's live second line both need it.
  for (const event of TURN_LIVE) {
    await evalJs(pushEvent(event))
    await sleep(220)
  }
  await evalJs(pushEvent(TODOS))
  await sleep(200)
  await evalJs(pushFrame(JOBS))
  await sleep(900)
  const strip = await evalJs(`(() => {
    const el = document.querySelector('.chat-status-strip')
    return el === null ? null : {
      text: el.innerText.replace(/\\s+/g, ' ').trim(),
      live: el.querySelector('.chat-status-dot-live') !== null,
    }
  })()`)
  await capture('run-status')
  const liveCard = await evalJs(`(() => {
    // The live turn's card is the LAST process card on the page; the first one
    // belongs to the settled turn above it.
    const cards = document.querySelectorAll('.chat-proc')
    const card = cards[cards.length - 1]
    if (card === undefined) return null
    return {
      running: card.classList.contains('chat-proc-running'),
      state: card.querySelector('.chat-proc-state')?.textContent ?? null,
      current: card.querySelector('.chat-proc-current-text')?.textContent ?? null,
      time: card.querySelector('.chat-proc-time')?.textContent ?? null,
    }
  })()`)
  assert(strip !== null, 'run-status strip rendered', JSON.stringify(strip))
  assert(liveCard?.running === true && String(liveCard?.state ?? '') === '深度求索中',
    'the last process card is live (running) while the strip reports it',
    JSON.stringify(liveCard))
  assert(String(strip?.text ?? '').includes('任务') && String(strip?.text ?? '').includes('后台任务'),
    'strip reports the plan and the background jobs', JSON.stringify(strip?.text))
  assert(strip?.live === true, 'strip shows the live dot', String(strip?.live))

  // ── scene 8: run-status sheet (tasks.png) ───────────────────────────────
  console.log('\n[8/10] tasks')
  await evalJs(clickSel('.chat-status-strip'))
  const sheetOpen = await waitFor(`document.querySelector('.chat-run-sheet, .sheet, [role="dialog"]') !== null ? true : false`, 'run-status sheet', 6000)
  await sleep(700)
  const sheet = await evalJs(`(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog === null) return null
    return {
      title: dialog.getAttribute('aria-label'),
      todos: [...dialog.querySelectorAll('.chat-run-todo-content')].map(el => el.textContent),
      sections: [...dialog.querySelectorAll('.chat-run-section-title')].map(el => el.textContent),
      jobRows: dialog.querySelectorAll('.chat-task-row').length,
      subagentRows: dialog.querySelectorAll('.chat-subagent-row').length,
    }
  })()`)
  await capture('tasks')
  assert(sheetOpen !== false, 'run-status sheet opened from the strip')
  assert(sheet?.title === '运行状态', 'sheet title is 运行状态', String(sheet?.title))
  assert((sheet?.todos ?? []).length >= 4, 'sheet lists the todo plan', JSON.stringify(sheet?.todos))
  assert(JSON.stringify(sheet?.sections).includes('后台任务') && (sheet?.jobRows ?? 0) >= 3,
    'sheet lists the background jobs', `rows=${sheet?.jobRows} sections=${JSON.stringify(sheet?.sections)}`)
  assert((sheet?.subagentRows ?? 0) >= 2, 'sheet lists the foreground subagents', String(sheet?.subagentRows))

  // ── scene 9: settings ──────────────────────────────────────────────────
  console.log('\n[9/10] settings')
  // Close the sheet by clicking its backdrop (the sheet chrome has no close
  // button: backdrop / Escape are the two dismiss paths).
  await evalJs(`(() => {
    const backdrop = document.querySelector('.sheet-backdrop')
    if (backdrop === null) return false
    backdrop.click()
    return true
  })()`)
  await sleep(500)
  await evalJs(clickSel('.mobile-back'))
  await waitSel('.mobile-iconbtn[aria-label="设置"]', 6000)
  await sleep(400)
  await evalJs(clickSel('.mobile-iconbtn[aria-label="设置"]'))
  await waitSel('.settings-group', 8000)
  await sleep(900)
  await evalJs(`(() => {
    const scroller = document.querySelector('.mobile-scroll')
    if (scroller !== null) scroller.scrollTop = 0
    return true
  })()`)
  await sleep(400)
  const settings = await evalJs(`(() => {
    const page = document.querySelector('.mobile')
    const text = page === null ? '' : page.innerText
    return {
      title: document.querySelector('.mobile-title')?.textContent ?? null,
      groups: [...document.querySelectorAll('.settings-groupTitle')].map(el => (el.textContent ?? '').trim()),
      rows: [...document.querySelectorAll('.settings-row .card-titleText')].map(el => el.textContent),
      switches: [...document.querySelectorAll('.settings-row [role="switch"]')].map(el => el.getAttribute('aria-label')),
      hasToolCallsToggle: text.includes('工具调用'),
      hasSystemPromptToggle: text.includes('系统提示词'),
      textLength: text.length,
    }
  })()`)
  await capture('settings')
  assert(settings?.title === '设置', 'settings page header is 设置', String(settings?.title))
  assert(settings?.hasToolCallsToggle === false, 'settings page has NO 工具调用 row/toggle', String(settings?.hasToolCallsToggle))
  assert(settings?.hasSystemPromptToggle === false, 'settings page has NO 系统提示词 row/toggle', String(settings?.hasSystemPromptToggle))
  assert((settings?.groups ?? []).length >= 5, 'settings groups rendered', JSON.stringify(settings?.groups))
  assert((settings?.rows ?? []).includes('主题') && (settings?.rows ?? []).includes('字体大小'),
    'appearance rows rendered', JSON.stringify(settings?.rows))

  // ── scene 10: usage card ───────────────────────────────────────────────
  console.log('\n[10/10] usage-card')
  const clickedUsage = await evalJs(`(() => {
    for (const row of document.querySelectorAll('.settings-row')) {
      const text = row.querySelector('.card-titleText')
      if (text !== null && text.textContent === '用量') { row.click(); return true }
    }
    return false
  })()`)
  await waitSel('.usage-card', 6000)
  await sleep(700)
  await evalJs(scrollSettingsTo('用量'))
  await sleep(500)
  const usage = await evalJs(`(() => {
    const card = document.querySelector('.usage-card')
    if (card === null) return null
    return {
      providers: [...card.querySelectorAll('.usage-providerName')].map(el => (el.textContent ?? '').trim()),
      badges: [...card.querySelectorAll('.usage-badge')].map(el => el.textContent),
      meters: card.querySelectorAll('.usage-meter').length,
      models: [...card.querySelectorAll('.usage-model')].map(el => (el.textContent ?? '').trim()),
      actions: [...card.querySelectorAll('.usage-actions button')].map(el => el.textContent),
    }
  })()`)
  await capture('usage-card')
  assert(clickedUsage === true, 'usage row opened the provider card')
  assert((usage?.providers ?? []).length >= 3, 'one card per configured provider', JSON.stringify(usage?.providers))
  assert(JSON.stringify(usage?.providers).includes('Ollama Cloud') && (usage?.meters ?? 0) >= 3,
    'quota meters rendered (Ollama 5.4 usage card + OpenRouter spent-vs-limit)', `meters=${usage?.meters}`)
  assert((usage?.actions ?? []).includes('刷新'), 'refresh action present', JSON.stringify(usage?.actions))

  // ── diagnostics ────────────────────────────────────────────────────────
  const calls = await evalJs('JSON.stringify(window.__calls ?? [])')
  const unknown = await evalJs('JSON.stringify(window.__unknown ?? [])')
  const errors = await evalJs('JSON.stringify(window.__errors ?? [])')
  console.log('\ndiagnostics')
  console.log('  rpc methods:', calls)
  console.log('  unhandled methods:', unknown)
  console.log('  page errors:', errors)
  assert(JSON.parse(errors ?? '[]').length === 0, 'no page errors during the run', errors)
  if (pageFailures.length > 0) {
    console.log('  page failures while capturing:')
    for (const failure of [...new Set(pageFailures)]) console.log('    -', failure)
  }
  console.log('  page failures:', pageFailures.length === 0 ? 'none' : `${pageFailures.length}`)
} finally {
  ws?.close()
  chrome.kill()
}

// ── blank / empty self-check ──────────────────────────────────────────────
//
// Decoding a PNG without dependencies is not worth it, so each still is
// converted to raw RGB24 by ffmpeg and analysed here (the approach the GIF
// frame check already uses): mean luma, the share of pixels that differ from the
// image's dominant (background) colour, and the count of distinct colours. A
// blank or black still scores a near-zero non-background share.

const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
const ffprobe = process.env.FFPROBE ?? 'ffprobe'
const dims = (file) => {
  const out = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim()
  const [w, h] = out.split(',').map(Number)
  return { w, h }
}
const analyse = (file) => {
  const { w, h } = dims(file)
  const raw = join(SCRATCH, 'dump.raw')
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw])
  const buf = readFileSync(raw)
  if (buf.length !== w * h * 3) return { w, h, error: `unexpected buffer ${buf.length}` }
  const counts = new Map()
  let lumaSum = 0
  for (let i = 0; i < buf.length; i += 3) {
    const r = buf[i]
    const g = buf[i + 1]
    const b = buf[i + 2]
    lumaSum += 0.2126 * r + 0.7152 * g + 0.0722 * b
    // Quantise to 5 bits per channel so anti-aliased text does not explode the map.
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const total = buf.length / 3
  let dominant = 0
  for (const n of counts.values()) if (n > dominant) dominant = n
  return {
    w,
    h,
    meanLuma: lumaSum / total,
    nonBg: 100 * (total - dominant) / total,
    colors: counts.size,
  }
}

console.log('\nstill report (mean luma / non-background share / distinct colours):')
console.log('  ' + 'file'.padEnd(16) + 'size'.padStart(10) + 'bytes'.padStart(10)
  + 'meanLuma'.padStart(10) + 'nonBg%'.padStart(9) + 'colors'.padStart(8) + '  verdict')
for (const shot of shots) {
  let stats
  try {
    stats = analyse(shot.file)
  } catch (error) {
    console.log(`  ${shot.name.padEnd(16)} analysis failed: ${String(error?.message ?? error)}`)
    failures.push(`${shot.name}.png could not be analysed`)
    continue
  }
  const shaped = stats.w === WIDTH && stats.h === HEIGHT
  const notBlank = stats.nonBg > 5 && stats.meanLuma > 8
  console.log('  ' + `${shot.name}.png`.padEnd(16)
    + `${stats.w}x${stats.h}`.padStart(10)
    + String(shot.bytes).padStart(10)
    + stats.meanLuma.toFixed(1).padStart(10)
    + stats.nonBg.toFixed(1).padStart(9)
    + String(stats.colors).padStart(8)
    + '  ' + (shaped ? '390x844 ok' : `SIZE MISMATCH (want ${WIDTH}x${HEIGHT})`)
    + ' · ' + (notBlank ? 'not blank' : 'SUSPECT BLANK'))
  if (!shaped) failures.push(`${shot.name}.png is ${stats.w}x${stats.h}, not ${WIDTH}x${HEIGHT}`)
  if (!notBlank) failures.push(`${shot.name}.png looks blank (nonBg ${stats.nonBg.toFixed(1)}%, luma ${stats.meanLuma.toFixed(1)})`)
}
rmSync(SCRATCH, { recursive: true, force: true })

console.log(`\n${shots.length} stills written to ${OUT_DIR}`)
if (failures.length > 0) {
  process.exitCode = 1
  console.log(`\nFAILED (${failures.length}):`)
  for (const failure of failures) console.log('  -', failure)
} else {
  console.log('all assertions passed')
}
