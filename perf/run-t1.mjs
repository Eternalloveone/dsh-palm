// T1 deterministic end-to-end pipeline bench — self-contained runner.
// Writes a temp vitest spec into the repo, runs it (jsdom, real production
// modules), parses the JSON report, prints a summary, then deletes the spec
// so the repository stays untouched. Usage: node run-t1.mjs
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const REPO = process.env.DSH_PALM_REPO ?? resolve(HERE, '..')
const PKG = join(REPO, 'packages/dsh-palm')
const SPEC = join(PKG, 'src/mobile/perf-t1-bench.test.tsx')
const OUT = join(HERE, 'perf-t1-report.json')

const SPEC_SRC = `// @vitest-environment jsdom
/** TEMPORARY T1 bench (written by perf/run-t1.mjs; deleted after the run). */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname as dir } from 'node:path'
import { performance } from 'node:perf_hooks'
import { muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { EventFolder, coalesceTurnMessages, type WireEvent } from './messages.ts'
import { MessageRow } from './message-row.tsx'
import { parseSegments } from './markdown.ts'
import { highlightCodeSync } from './shiki.ts'

const OUT = ${JSON.stringify(OUT)}
const ENABLED = true
let seqCounter = 0
const nextSeq = () => (seqCounter += 1)
const makeEvent = (type, data) => { const seq = nextSeq(); return { type, seq, time: seq * 1000, data } }
const userMsg = (text) => makeEvent('user/message', { id: 'u-' + seqCounter, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } })
const textChunk = (turn, step, text) => makeEvent('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text } })
const reasoningChunk = (turn, step, text) => makeEvent('assistant/chunk', { turn, step, chunk: { type: 'reasoning-delta', index: 0, text } })
const finalMessage = (id, turn, step, text) => makeEvent('assistant/message', { turn, step, message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } } })
const toolCall = (name, callId, turn, step, view) => { const seq = nextSeq(); const base = { type: 'tool/call', seq, time: seq * 1000, data: { turn, step, callId, name, arguments: '{}' } }; return view ? { ...base, view } : base }
function rng(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296 } }
const TOK = ['实现', '渲染', '管道', '结构', '增量', '折叠', '测量', '回放', '归档', '同步', '流式', '稳定', '边界', '延迟', '帧率', '主线程', '事件', '回退', '水位', '快照']
const pick = (r) => TOK[Math.floor(r() * TOK.length)]
function fence(random, lines) { const body = ['\`\`\`ts']; for (let i = 0; i < lines; i++) { const a = 1 + Math.floor(random() * 90); body.push('export function fn' + i + '(v: number): number { return v * ' + a + ' + ' + (1 + Math.floor(random() * 90)) + ' } // ' + pick(random) + pick(random)) } body.push('\`\`\`'); return body.join('\\n') }
function pct(s, p) { return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))] }
function stat(name, samples) { if (!samples.length) return { name, n: 0, avg: 0, p50: 0, p95: 0, max: 0 }; const s = [...samples].sort((a, b) => a - b); return { name, n: samples.length, avg: Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 1000) / 1000, p50: Math.round(pct(s, 0.5) * 1000) / 1000, p95: Math.round(pct(s, 0.95) * 1000) / 1000, max: Math.round(s[s.length - 1] * 1000) / 1000 } }
const envelope = (frame) => JSON.stringify({ type: 'server-request', rpcId: 't1', method: '', payload: frame })
function runFrame(line, folder, root, T) { const t0 = performance.now(); const t1 = performance.now(); const parsed = JSON.parse(line); const env = serverRequestSchema.safeParse(parsed); if (!env.success) throw new Error('env'); const frame = muxFrameSchema.safeParse(env.data.payload); if (!frame.success) throw new Error('frame'); T.parse.push(performance.now() - t1); const event = frame.data.event; const t2 = performance.now(); const rows = folder.fold([event]); T.fold.push(performance.now() - t2); const t3 = performance.now(); const coal = coalesceTurnMessages(rows); T.coalesce.push(performance.now() - t3); const t4 = performance.now(); flushSync(() => root.render(<div>{coal.map(m => <MessageRow key={m.turn !== undefined && m.step !== undefined ? 't' + m.turn + '.' + m.step : m.id} message={m} showToolCalls showSystemMessages />)}</div>)); T.commit.push(performance.now() - t4); T.total.push(performance.now() - t0) }
describe.skipIf(!ENABLED)('T1', () => {
  it('pipeline: typical + stress + settle attribution', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const report = {}
    // typical turn
    {
      const random = rng(42); let paragraphs = ''; for (let i = 0; i < 6; i++) { if (i % 3 === 0) paragraphs += '### 第 ' + i + ' 节\\n\\n'; paragraphs += Array.from({ length: 10 }, () => pick(random)).join('，') + '。\\n\\n' }
      const finalText = paragraphs + fence(random, 150) + '\\n\\n以上是本次完成的全部改动。'
      const chunks = []; for (let at = 0; at < finalText.length;) { const take = Math.min(finalText.length - at, 90 + Math.floor(random() * 70)); chunks.push(finalText.slice(at, at + take)); at += take }
      const reasoning = Array.from({ length: 48 }, () => pick(random) + pick(random) + pick(random) + pick(random))
      const folder = new EventFolder(); const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container)
      const T = { parse: [], fold: [], coalesce: [], commit: [], total: [] }
      folder.fold([userMsg('跑一轮典型回合')])
      const diff = { for: 'call', view: { card: 'diff', title: '编辑了 2 个文件', diffs: [{ path: 'a.ts', oldText: Array.from({ length: 60 }, (_, i) => 'const v' + i + ' = compute(' + i + ')').join('\\n'), newText: Array.from({ length: 70 }, (_, i) => 'const v' + i + ' = compute(' + i + ') + offset').join('\\n') }, { path: 'b.ts', oldText: 'x', newText: 'y' }] } }
      for (const l of reasoning) runFrame(envelope({ type: 'session/event', sessionId: 's-1', event: reasoningChunk(7, 0, l) }), folder, root, T)
      runFrame(envelope({ type: 'session/event', sessionId: 's-1', event: toolCall('bash', 'c1', 7, 0) }), folder, root, T)
      runFrame(envelope({ type: 'session/event', sessionId: 's-1', event: toolCall('write', 'c2', 7, 0, diff) }), folder, root, T)
      for (const c of chunks) runFrame(envelope({ type: 'session/event', sessionId: 's-1', event: textChunk(7, 0, c) }), folder, root, T)
      runFrame(envelope({ type: 'session/event', sessionId: 's-1', event: finalMessage('a-final', 7, 0, finalText) }), folder, root, T)
      report.typical = { events: T.total.length, perEvent: { parse: stat('parse+zod', T.parse), fold: stat('fold', T.fold), coalesce: stat('coalesce', T.coalesce), commit: stat('commit', T.commit), total: stat('total', T.total) }, estEventToPaintP95Ms: Math.round((stat('total', T.total).p95 + 16.7) * 1000) / 1000 }
      root.unmount(); container.remove()
    }
    // stress: 30k single paragraph over 60 seeded rows
    {
      const random = rng(7); let text = ''; while (text.length < 30000) text += pick(random); const chunks = []; for (let at = 0; at < text.length;) { const take = Math.min(text.length - at, 118); chunks.push(text.slice(at, at + take)); at += take }
      seqCounter = 0; const folder = new EventFolder(); const seed = []; for (let p = 0; p < 30; p++) { seed.push(userMsg('较早的问题 ' + p + '？')); seed.push(finalMessage('old-' + p, -10000 - p, 0, '较早的回复 ' + p + '。')) } folder.fold(seed)
      const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container)
      const T = { parse: [], fold: [], coalesce: [], commit: [], total: [] }; const phases = { first: [], mid: [], last: [] }
      runFrame(envelope({ type: 'session/event', sessionId: 's-1', event: userMsg('写一段很长的论述') }), folder, root, { parse: [], fold: [], coalesce: [], commit: [], total: [] })
      chunks.forEach((c, i) => { const t = { parse: [], fold: [], coalesce: [], commit: [], total: [] }; runFrame(envelope({ type: 'session/event', sessionId: 's-1', event: textChunk(99, 0, c) }), folder, root, t); T.total.push(t.total[0]); T.commit.push(t.commit[0]); T.parse.push(t.parse[0]); T.fold.push(t.fold[0]); T.coalesce.push(t.coalesce[0]); const b = i < chunks.length / 3 ? 'first' : i < (2 * chunks.length) / 3 ? 'mid' : 'last'; phases[b].push(t.total[0]) })
      report.stressParagraph = { events: T.total.length, seededRows: 60, firstThirdAvg: Math.round((phases.first.reduce((a, b) => a + b, 0) / phases.first.length) * 1000) / 1000, lastThirdAvg: Math.round((phases.last.reduce((a, b) => a + b, 0) / phases.last.length) * 1000) / 1000, growthX: Math.round((phases.last.reduce((a, b) => a + b, 0) / Math.max(phases.first.reduce((a, b) => a + b, 0), 0.001)) * 100) / 100, perEvent: stat('total', T.total) }
      root.unmount(); container.remove()
    }
    // settle attribution (pure JS, same shape)
    {
      const random = rng(42); let paragraphs = ''; for (let i = 0; i < 6; i++) { if (i % 3 === 0) paragraphs += '### 第 ' + i + ' 节\\n\\n'; paragraphs += Array.from({ length: 10 }, () => pick(random)).join('，') + '。\\n\\n' }
      const fenceBody = fence(random, 150); const finalText = paragraphs + fenceBody + '\\n\\n以上。'
      parseSegments(finalText); highlightCodeSync(fenceBody, 'ts')
      const time = (fn, n) => { const a = []; for (let i = 0; i < n; i++) { const t = performance.now(); fn(); a.push(performance.now() - t) } return a }
      const med = (s) => { const x = [...s].sort((a, b) => a - b); return x[Math.floor(x.length / 2)] }
      const p = time(() => parseSegments(finalText), 40); const h = time(() => highlightCodeSync(fenceBody, 'ts'), 40)
      report.settleJsSplitMs = { parseP50: med(p), highlightP50: med(h) }
    }
    mkdirSync(dir(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8'); process.stdout.write('\\n[T1] report written to ' + OUT + '\\n')
    expect(report.typical.events).toBeGreaterThan(50)
    errSpy.mockRestore()
  })
})
`

// Write, run, read, clean.
mkdirSync(dirname(SPEC), { recursive: true })
writeFileSync(SPEC, SPEC_SRC, 'utf8')
const result = spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm vitest run src/mobile/perf-t1-bench.test.tsx'], {
  cwd: PKG,
  encoding: 'utf8',
  timeout: 240_000,
})
if (!existsSync(OUT)) {
  process.stderr.write('\n--- spawn status ---\n')
  process.stderr.write(`status=${result.status} error=${String(result.error ?? '')} signal=${String(result.signal ?? '')}\n`)
  process.stderr.write('\n--- stdout tail ---\n' + String(result.stdout ?? '').slice(-4000) + '\n')
  process.stderr.write('\n--- stderr tail ---\n' + String(result.stderr ?? '').slice(-2000) + '\n')
  process.exitCode = 1
  process.stderr.write(`\n[T1] FAILED: no report produced (spec kept at ${SPEC} for diagnosis)\n`)
} else {
  try { unlinkSync(SPEC) } catch { /* already gone */ }
  const report = JSON.parse(readFileSync(OUT, 'utf8'))
  const t = report.typical.perEvent
  console.log('\n=== T1 pipeline (typical turn) ===')
  console.log(`events=${report.typical.events}  est event→paint p95 = ${report.typical.estEventToPaintP95Ms} ms`)
  for (const key of ['parse', 'fold', 'coalesce', 'commit', 'total']) {
    const s = t[key]
    console.log(`  ${key.padEnd(9)} avg=${s.avg}ms p50=${s.p50}ms p95=${s.p95}ms max=${s.max}ms`)
  }
  console.log('\n=== T1 stress (30k single paragraph, 60 rows) ===')
  const sp = report.stressParagraph
  console.log(`events=${sp.events}  first/3 avg=${sp.firstThirdAvg}ms  last/3 avg=${sp.lastThirdAvg}ms  growth=${sp.growthX}x`)
  console.log('\n=== T1 settle JS split ===')
  console.log(`parseSegments p50=${report.settleJsSplitMs.parseP50}ms  highlight(150L) p50=${report.settleJsSplitMs.highlightP50}ms`)
  console.log(`\nfull JSON: ${OUT}\n`)
}
