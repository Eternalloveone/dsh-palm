// Temporary loopback network probe for the perf-e2e run: measures what the
// phone's transport would see against the LOCAL DSH host (127.0.0.1:3080).
// Real remote numbers need the tunnel; this pins the loopback floor.
const BASE = process.env.PERF_BASE ?? 'http://127.0.0.1:3080'
const out = { base: BASE, sampledAt: new Date().toISOString() }

function ms(start) {
  return Math.round((performance.now() - start) * 1000) / 1000
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[idx]
}

async function warmGet(url) {
  // one warm request to fill any connection state, not measured
  try {
    const w = await fetch(url, { signal: AbortSignal.timeout(5000) })
    await w.arrayBuffer()
  } catch { /* ignore */ }
}

async function timeGets(url, n) {
  const samples = []
  let bytes = 0
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
      const buf = await r.arrayBuffer()
      bytes = buf.byteLength
      samples.push(performance.now() - t0)
    } catch (e) {
      samples.push(Number.NaN)
    }
  }
  const valid = samples.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b)
  return { n: valid.length, bytes, p50: pct(valid, 0.5), p95: pct(valid, 0.95), min: valid[0], max: valid[valid.length - 1] }
}

async function sseProbe() {
  const url = `${BASE}/m/api/events.mux`
  const t0 = performance.now()
  let status = null
  let chunks = 0
  let bytes = 0
  let text = ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('probe-timeout')), 2500)
  try {
    const r = await fetch(url, { signal: controller.signal })
    status = r.status
    const reader = r.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks += 1
      bytes += value.byteLength
      text = new TextDecoder().decode(value) // last chunk only
      if (performance.now() - t0 > 2200) break
    }
  } catch (e) {
    text = String(e.message ?? e)
  } finally {
    clearTimeout(timer)
  }
  return { url, status, bytes, chunks, firstLine: text.split('\n').slice(0, 3).join(' | '), elapsedMs: ms(t0) }
}

const html = await timeGets(`${BASE}/m/`, 8)
const js = await timeGets(`${BASE}/m/mobile.js`, 8)
const sse = await sseProbe()

out.rtt = {
  htmlFetchMs: { p50: html.p50, p95: html.p95, min: html.min, max: html.max, n: html.n, bytes: html.bytes },
  mobileJsFetchMs: { p50: js.p50, p95: js.p95, min: js.min, max: js.max, n: js.n, bytes: js.bytes },
}
out.sse = sse
process.stdout.write(JSON.stringify(out, null, 2) + '\n')
