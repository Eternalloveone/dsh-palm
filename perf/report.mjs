// Minimal report aggregator: merges the T1/dual-probe/net-probe JSONs into a
// markdown section used by PERFORMANCE-REPORT.md. node report.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const files = {
  t1: `${HERE}/perf-t1-report.json`,
  dual: `${HERE}/dual-probe.json`,
  before: `${HERE}/perf-e2e-report.json`,
}
const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const t1 = read(files.t1)
const dual = read(files.dual)
const before = read(files.before)
const out = []
out.push('### 手机端 /m —— T1 管线（当前代码，优化后）')
if (t1) {
  const t = t1.typical.perEvent
  out.push('| 阶段 | avg | p50 | p95 | max |')
  out.push('|---|---|---|---|---|')
  for (const k of ['parse', 'fold', 'coalesce', 'commit', 'total']) out.push(`| ${k} | ${t[k].avg}ms | ${t[k].p50}ms | ${t[k].p95}ms | ${t[k].max}ms |`)
  out.push(`\n- 事件数 ${t1.typical.events}；估算 event→paint p95 = ${t1.typical.estEventToPaintP95Ms}ms（约 1 帧）`)
  out.push(`- 压力（30k 单段落，60 行历史）：首 1/3 avg ${t1.stressParagraph.firstThirdAvg}ms → 末 1/3 ${t1.stressParagraph.lastThirdAvg}ms，增长 ${t1.stressParagraph.growthX}x`)
  out.push(`- 收尾纯 JS：parseSegments p50 ${t1.settleJsSplitMs.parseP50}ms，150 行高亮 p50 ${t1.settleJsSplitMs.highlightP50}ms`)
}
out.push('')
out.push('### 优化前基线（09-07 首轮实测，旧 spec）')
if (before) {
  const t = before.typical
  out.push('| 阶段 | avg | p50 | p95 | max |')
  out.push('|---|---|---|---|---|')
  for (const k of ['parse', 'fold', 'coalesce', 'commit', 'total']) out.push(`| ${k} | ${t[k].avg}ms | ${t[k].p50}ms | ${t[k].p95}ms | ${t[k].max}ms |`)
  out.push(`\n- 事件数 ${t.events}；估算 event→paint p95 = ${t.estEventToPaintMs}ms；收尾帧（jsdom 全量跑，含 DOM 构建）${t.settleCommitMs}ms`)
  out.push(`- 压力（40k 单段落）：增长 ${before.stressParagraph.perChunkMs.growthAvg}x`)
}
out.push('')
out.push('### 双端传输（loopback，本机直连 DSH host）')
if (dual) {
  out.push('| 表面 | HTML | 资源数 | 资源总字节 | 最大资源 p50/p95 |')
  out.push('|---|---|---|---|---|')
  const m = dual.surfaces.mobile
  const d = dual.surfaces.desktop
  out.push(`| 手机端 /m | ${m.html.bytes}B ${m.html.ms}ms | ${m.assets.count} | ${m.assets.totalBytes}B | ${m.largest[0]?.url} ${m.largest[0]?.bytes}B ${m.largest[0]?.p50}/${m.largest[0]?.p95}ms |`)
  out.push(`| 桌面端 / | ${d.html.bytes}B ${d.html.ms}ms | ${d.assets.count} | ${d.assets.totalBytes}B | ${d.largest[0]?.url} ${d.largest[0]?.bytes}B ${d.largest[0]?.p50}/${d.largest[0]?.p95}ms |`)
  out.push('\nSSE 端点：')
  out.push(`- /m/api/events.mux → ${dual.sse.mobileMux.status} (${dual.sse.mobileMux.elapsedMs}ms)`)
  out.push(`- /api/events.mux  → ${dual.sse.desktopMux.status} (${dual.sse.desktopMux.elapsedMs}ms)`)
}
writeFileSync(`${HERE}/perf-results-section.md`, out.join('\n') + '\n', 'utf8')
process.stdout.write(out.join('\n') + '\n')
process.stdout.write(`\n[report] written ${HERE}/perf-results-section.md\n`)
