/**
 * Capture a README demo GIF for dsh-palm: drives the real /m/ phone UI in
 * headless Chrome against the live dsh web (127.0.0.1:3080), injects
 * fictional data (workspaces, sessions, chat history, live SSE frames), walks
 * a 30-second timeline (pair -> browse -> stream -> tasks -> dark theme), and
 * renders the frames into docs/screenshots/demo.gif via ffmpeg.
 *
 * All data is fictional: workspace names, session titles, chat content,
 * pairing code and device info are made up, so nothing private leaks into
 * the repository (same policy as capture-panel.mjs).
 *
 * Usage: node scripts/capture-gif.mjs [out.gif]
 * Requires: ffmpeg on PATH (or FFMPEG env var pointing at the binary).
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DEBUG_PORT = 9223
const OUT = process.argv[2] ?? join(process.cwd(), 'docs', 'screenshots', 'demo.gif')
const FRAMES_DIR = join(process.cwd(), '.gif-frames')
const TARGET = 'http://127.0.0.1:3080/m/'
const FPS = 10
const DURATION_S = 30
const TOTAL_FRAMES = FPS * DURATION_S
const WIDTH = 390
const HEIGHT = 844

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// ── fictional demo data ────────────────────────────────────────────────────

const WORKSPACES = [
  { workspaceId: 'ws-1', title: 'dsh-palm', path: '/home/dev/dsh-palm', kind: 'project', pinned: true, sessionIds: ['s-1', 's-2', 's-3'] },
  { workspaceId: 'ws-2', title: 'my-app', path: '/home/dev/my-app', kind: 'project', pinned: false, sessionIds: [] },
  { workspaceId: 'ws-3', title: 'notes', path: '/home/dev/notes', kind: 'project', pinned: false, sessionIds: [] },
]

const SESSIONS = [
  { sessionId: 's-1', title: '优化配对流程', updatedAt: Date.now() - 3_600_000, running: true, blank: false, preview: '正在分析配对面板的步骤指示器…', projections: { values: { title: '优化配对流程' } } },
  { sessionId: 's-2', title: '修复手机端未读计数', updatedAt: Date.now() - 86_400_000, running: false, blank: false, preview: '滚动回底部即清除徽标', projections: { values: { title: '修复手机端未读计数' } } },
  { sessionId: 's-3', title: '配置 frp 公网入口', updatedAt: Date.now() - 172_800_000, running: false, blank: false, preview: '解析 frpc.toml 得到具体入口', projections: { values: { title: '配置 frp 公网入口' } } },
]

const T0 = Date.now() - 3_600_000

const TODOS = [
  { content: '梳理配对流程问题', status: 'completed' },
  { content: '设计三步向导', status: 'completed' },
  { content: '实现步骤即视图', status: 'in_progress' },
  { content: '补充探测与分叉引导', status: 'pending' },
  { content: '更新文档与截图', status: 'pending' },
]

const JOBS = [
  { id: 'subagent-1', kind: 'subagent', label: '整理记忆', status: 'running', startedAt: Date.now() - 30_000 },
]

const HISTORY = [
  { event: { type: 'user/message', seq: 1, time: T0, data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: '帮我看看配对流程还有什么可以优化的' }] } } },
  { event: { type: 'assistant/message', seq: 2, time: T0 + 1000, data: { turn: 2, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '好的，我梳理了当前配对流程的体验问题：\n\n1. **步骤不清晰** — 新用户不知道先做什么\n2. **公网地址难配** — 要翻设置页\n3. **反馈缺失** — 保存死地址没有提示\n\n我建议改成「配置 → 配对 → 使用」三步向导。' }] } } } },
  { event: { type: 'user/message', seq: 3, time: T0 + 2000, data: { id: 'u-2', role: 'user', content: [{ type: 'text', text: '好，开始改吧' }] } } },
]

const STREAM_CHUNKS = [
  { type: 'turn/start', seq: 4, time: T0 + 3000, data: { turn: 4 } },
  { type: 'assistant/chunk', seq: 5, time: T0 + 3500, data: { turn: 4, step: 0, chunk: { type: 'text-delta', index: 0, text: '开始改造。先看当前面板结构：\n\n' } } },
  { type: 'tool/call', seq: 6, time: T0 + 4000, data: { turn: 4, step: 0, callId: 'c-1', name: 'bash', arguments: '{"cmd":"ls src/client"}' } },
  { type: 'assistant/chunk', seq: 7, time: T0 + 4500, data: { turn: 4, step: 0, chunk: { type: 'text-delta', index: 0, text: '```ts\n// 步骤指示器：可点击导航\nconst steps = [\n  { id: "config", label: "配置" },\n  { id: "pair", label: "配对" },\n  { id: "use", label: "使用" },\n]\n```\n\n' } } },
  { type: 'assistant/chunk', seq: 8, time: T0 + 5000, data: { turn: 4, step: 0, chunk: { type: 'text-delta', index: 0, text: '**改动要点**：\n\n- 步骤即视图，已配对用户直接看到使用页\n- 探测按钮在保存前验证地址可达性\n- 无隧道时给出分叉引导\n\n' } } },
  { type: 'assistant/message', seq: 9, time: T0 + 5500, data: { turn: 4, step: 0, message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '改造完成，610 个测试全绿。' }] } } },
  { type: 'todo/write', seq: 10, time: T0 + 6000, data: { todos: TODOS } },
]

// ── mock injection (runs before any document script) ──────────────────────

const MOCK_SOURCE = `(() => {
  // Paired state survives the post-accept navigation via sessionStorage
  // (addScriptToEvaluateOnNewDocument re-runs on every load).
  let paired = sessionStorage.getItem('demo-paired') === '1'
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
  const realFetch = window.fetch
  window.__calls = []
  window.fetch = (input, init) => {
    const url = String(input)
    if (url === '/api/pair/accept') {
      paired = true
      try { sessionStorage.setItem('demo-paired', '1') } catch {}
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    if (url.startsWith('/m/api/')) {
      const method = url.slice('/m/api/'.length)
      window.__calls.push(method)
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
        default: return err(404, 'no such method')
      }
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
  window.__muxPush = (frame) => {
    const src = window.__muxSource
    if (src === undefined) return false
    try {
      // The mux channel carries server-request envelopes whose payload is
      // the frame (same wire shape as the desktop mux channel).
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
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
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

  mkdirSync(FRAMES_DIR, { recursive: true })
  const frameAt = (t) => Math.min(TOTAL_FRAMES - 1, Math.round(t * FPS))

  // Timeline actions (seconds since start).
  const actions = [
    { at: 3.0, run: () => evalJs(`(() => {
      const input = document.querySelector('#mobile-pair-link')
      if (input === null) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, '732884')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`) },
    // The accept navigates the page; wait for the reload before recording.
    { at: 4.0, waitAfter: 2500, run: () => evalJs(`(() => {
      const btn = document.querySelector('.mobile-pairSubmit')
      if (btn === null) return false
      btn.click()
      return true
    })()`) },
    { at: 6.5, run: () => evalJs(`(() => {
      const card = document.querySelector('.mobile-list .card-title')
      if (card === null) return false
      card.closest('button')?.click()
      return true
    })()`) },
    { at: 9.5, run: () => evalJs(`(() => {
      const row = document.querySelector('.mobile-list .mobile-row')
      if (row === null) return false
      row.click()
      return true
    })()`) },
    { at: 11.0, run: () => evalJs(`(() => {
      window.__muxPush(${JSON.stringify({ type: 'session/event', sessionId: 's-1', event: STREAM_CHUNKS[0] })})
      return true
    })()`) },
    { at: 12.0, run: () => evalJs(`(() => {
      window.__muxPush(${JSON.stringify({ type: 'session/event', sessionId: 's-1', event: STREAM_CHUNKS[1] })})
      return true
    })()`) },
    { at: 13.0, run: () => evalJs(`(() => {
      window.__muxPush(${JSON.stringify({ type: 'session/event', sessionId: 's-1', event: STREAM_CHUNKS[2] })})
      return true
    })()`) },
    { at: 14.0, run: () => evalJs(`(() => {
      window.__muxPush(${JSON.stringify({ type: 'session/event', sessionId: 's-1', event: STREAM_CHUNKS[3] })})
      return true
    })()`) },
    { at: 16.0, run: () => evalJs(`(() => {
      window.__muxPush(${JSON.stringify({ type: 'session/event', sessionId: 's-1', event: STREAM_CHUNKS[4] })})
      return true
    })()`) },
    { at: 18.0, run: () => evalJs(`(() => {
      window.__muxPush(${JSON.stringify({ type: 'session/event', sessionId: 's-1', event: STREAM_CHUNKS[5] })})
      window.__muxPush(${JSON.stringify({ type: 'session/event', sessionId: 's-1', event: STREAM_CHUNKS[6] })})
      window.__muxPush(${JSON.stringify({ type: 'session/jobs', sessionId: 's-1', jobs: JOBS })})
      return true
    })()`) },
    { at: 20.5, run: () => evalJs(`(() => {
      const strip = document.querySelector('.chat-status-strip')
      if (strip === null) return false
      strip.click()
      return true
    })()`) },
    { at: 23.5, run: () => evalJs(`(() => {
      const backdrop = document.querySelector('.sheet-backdrop')
      if (backdrop === null) return false
      backdrop.click()
      return true
    })()`) },
    { at: 25.5, run: () => evalJs(`(() => {
      const toggle = document.querySelector('.mobile-theme-toggle')
      if (toggle === null) return false
      toggle.click()
      return true
    })()`) },
    { at: 27.5, run: () => evalJs(`(() => {
      const scroller = document.querySelector('.chat-scroll')
      if (scroller === null) return false
      scroller.scrollTop = scroller.scrollHeight
      return true
    })()`) },
  ]

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
          if (ok !== true) console.log('action at', action.at, 'returned', ok)
        } catch (e) { console.log('action at', action.at, 'failed:', e?.message) }
        // The pair-accept action navigates the page; give the reload time to
        // settle before the next frame so the GIF does not linger on a blank.
        if (action.waitAfter !== undefined) await sleep(action.waitAfter)
      }
    }
    const data = await shot()
    if (typeof data === 'string') {
      lastFrame = data
      writeFileSync(join(FRAMES_DIR, `frame-${String(i).padStart(4, '0')}.png`), Buffer.from(data, 'base64'))
    } else if (lastFrame !== undefined) {
      writeFileSync(join(FRAMES_DIR, `frame-${String(i).padStart(4, '0')}.png`), Buffer.from(lastFrame, 'base64'))
    }
    // Keep the wall clock aligned with the frame clock.
    const elapsed = Date.now() - start
    const target = i * (1000 / FPS)
    if (elapsed < target) await sleep(target - elapsed)
  }
  console.log('captured', TOTAL_FRAMES, 'frames')

  // ── ffmpeg: palette-optimized GIF ────────────────────────────────────────
  const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'
  const palette = join(FRAMES_DIR, 'palette.png')
  const run = (args) => new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => { err += String(d) })
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`)))
  })
  await run(['-y', '-framerate', String(FPS), '-i', join(FRAMES_DIR, 'frame-%04d.png'),
    '-vf', `scale=${WIDTH}:-1:flags=lanczos,palettegen`, palette])
  await run(['-y', '-framerate', String(FPS), '-i', join(FRAMES_DIR, 'frame-%04d.png'),
    '-i', palette, '-lavfi', `scale=${WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse`, '-loop', '0', OUT])
  console.log('saved', OUT)
} finally {
  ws?.close()
  chrome.kill()
  rmSync(FRAMES_DIR, { recursive: true, force: true })
}
