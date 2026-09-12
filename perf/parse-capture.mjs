// Closure helper: ingest a captured __dshPalmPerf.stats() blob (or a JSON file
// with the same shape) into a labeled baseline and print a comparison to the
// T1 lab. This is the "hand it back and I close the loop" command.
//
// Usage (browser/phone, DevTools console, WITH dsh.palm.perf=1 armed):
//   copy(JSON.stringify(window.__dshPalmPerf.stats()))
// then save that JSON to a file, e.g. android_lan.json, and run:
//   node parse-capture.mjs --label android-lan --file android_lan.json
// or paste via stdin:
//   Get-Content android_lan.json -Raw | node parse-capture.mjs --label android-lan
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const BASE_DIR = join(HERE, 'baselines')
let label = null
let file = null
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--label') label = process.argv[++i]
  else if (process.argv[i] === '--file') file = process.argv[++i]
}
if (!label) {
  process.stderr.write('missing --label <env> (e.g. android-lan)\n')
  process.exit(1)
}
let raw = ''
if (file) {
  if (!existsSync(file)) { process.stderr.write(`no such file: ${file}\n`); process.exit(1) }
  raw = readFileSync(file, 'utf8')
} else {
  raw = readFileSync(0, 'utf8')
}
let capture
try { capture = JSON.parse(raw) } catch (e) { process.stderr.write(`invalid JSON: ${e.message}\n`); process.exit(1) }

const spans = capture?.spans
if (!spans || (!spans.toState && !spans.toCommit)) {
  process.stderr.write('capture lacks spans.toState/toCommit — was perf armed (dsh.palm.perf=1)? shape: ' + Object.keys(capture ?? {}).join(',') + '\n')
  process.exit(1)
}
const row = {
  label,
  capturedAt: new Date().toISOString(),
  frames: capture.frames ?? { sampled: 0, long: 0 },
  anomalies: (capture.anomalies ?? []).length,
  marks: capture.marks ?? null,
  spans: {
    toState: spans.toState?.avg !== undefined ? spans.toState : { n: 0, avg: 0, p50: 0, p95: 0, max: 0 },
    toCommit: spans.toCommit?.avg !== undefined ? spans.toCommit : { n: 0, avg: 0, p50: 0, p95: 0, max: 0 },
  },
}
mkdirSync(BASE_DIR, { recursive: true })
const outPath = join(BASE_DIR, `${label}.json`)
writeFileSync(outPath, JSON.stringify(row, null, 2), 'utf8')

// Compare to T1 lab totals.
let lab = null
try { lab = JSON.parse(readFileSync(join(HERE, 'perf-t1-report.json'), 'utf8')) } catch { /* ignore */ }
console.log(`\ncaptured sample '${label}' -> ${outPath}`)
if (lab) {
  const labTotal = lab.typical.perEvent.total
  console.log('| metric | T1 lab (after) | captured ' + label + ' |')
  console.log('|---|---|---|')
  const s = row.spans.toCommit
  console.log(`| toCommit p95 (ms) | ${labTotal.p95} | ${s.p95 ?? 'n/a'} |`)
  console.log(`| toCommit avg (ms) | ${labTotal.avg} | ${s.avg ?? 'n/a'} |`)
  console.log(`| long frames / sampled | — | ${row.frames.long}/${row.frames.sampled} |`)
  console.log(`| transport anomalies | — | ${row.anomalies} |`)
}
