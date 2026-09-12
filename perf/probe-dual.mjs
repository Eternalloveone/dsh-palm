// Dual-surface probe: mobile surface (/m) vs desktop GUI (/).
// Measures HTML + every referenced static asset + the SSE endpoints reachable
// from this machine, over loopback against the running DSH host. Saves JSON.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const BASE = process.env.PERF_BASE ?? 'http://127.0.0.1:3080'
const OUT = process.env.PERF_OUT ?? join(HERE, 'dual-probe.json')
const out = { base: BASE, sampledAt: new Date().toISOString(), surfaces: {} }

const ms = (start) => Math.round((performance.now() - start) * 1000) / 1000
const pct = (sorted, p) => { if (!sorted.length) return 0; return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] }

async function fetchOnce(url, timeoutMs = 8000) {
  const t0 = performance.now()
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  const buf = Buffer.from(await r.arrayBuffer())
  return { status: r.status, ms: ms(t0), bytes: buf.byteLength, body: buf.toString('utf8'), headers: Object.fromEntries(r.headers.entries()) }
}

async function timed(url, samples) {
  const times = []
  let bytes = 0
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now()
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
      const b = await r.arrayBuffer()
      bytes = b.byteLength
      times.push(performance.now() - t0)
    } catch (e) {
      times.push(Number.NaN)
    }
  }
  const ok = times.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b)
  return { n: ok.length, bytes, p50: Math.round(pct(ok, 0.5) * 100) / 100, p95: Math.round(pct(ok, 0.95) * 100) / 100, max: ok.length ? Math.round(ok[ok.length - 1] * 100) / 100 : 0 }
}

function assetsFrom(html, baseUrl) {
  const found = new Set()
  const re = /(?:src|href)=["']([^"']+)["']/g
  let m
  while ((m = re.exec(html)) !== null) {
    const raw = m[1]
    if (!/\.(?:js|css)(?:\?|$)/.test(raw)) continue
    const url = raw.startsWith('http') ? raw : new URL(raw, baseUrl).toString()
    found.add(url)
  }
  return [...found]
}

async function surface(name, htmlPath, samples = 4) {
  const htmlUrl = BASE + htmlPath
  const html = await fetchOnce(htmlUrl)
  const assets = assetsFrom(html.body, htmlUrl)
  const assetTimes = []
  const assetRows = []
  for (const url of assets) {
    // warm once (service-worker/cache state), then sample
    try { await fetch(url, { signal: AbortSignal.timeout(8000) }) } catch { /* ignore */ }
    const t = await timed(url, samples)
    assetRows.push({ url: url.replace(BASE, ''), ...t })
    assetTimes.push(t)
  }
  const largest = assetRows.slice().sort((a, b) => b.bytes - a.bytes)
  return {
    html: { status: html.status, ms: html.ms, bytes: html.bytes },
    assets: { count: assetRows.length, totalBytes: assetRows.reduce((a, b) => a + b.bytes, 0) },
    assetRows,
    largest,
  }
}

out.surfaces.mobile = await surface('mobile', '/m/')
out.surfaces.desktop = await surface('desktop', '/')

async function sseProbe(url, waitMs = 2200) {
  const t0 = performance.now()
  let status = null
  let bytes = 0
  let line = ''
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('probe-timeout')), waitMs)
  try {
    const r = await fetch(url, { signal: controller.signal })
    status = r.status
    if (status === 200) {
      const reader = r.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        line = new TextDecoder().decode(value).split('\n')[0] ?? ''
        if (performance.now() - t0 > waitMs - 300) break
      }
    }
  } catch (e) {
    line = String(e.message ?? e)
  } finally {
    clearTimeout(timer)
  }
  return { url: url.replace(BASE, ''), status, bytes, firstLine: line.slice(0, 120), elapsedMs: ms(t0) }
}

out.sse = {
  mobileMux: await sseProbe(BASE + '/m/api/events.mux'),
  desktopMux: await sseProbe(BASE + '/api/events.mux'),
}

writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8')
process.stdout.write('\n=== dual-surface probe ===\n')
for (const key of ['mobile', 'desktop']) {
  const s = out.surfaces[key]
  process.stdout.write(`\n[${key}] html ${s.html.bytes}B ${s.html.ms}ms | assets ${s.assets.count} (${s.assets.totalBytes}B)\n`)
  for (const row of s.largest.slice(0, 4)) {
    process.stdout.write(`    ${row.url} ${row.bytes}B p50=${row.p50}ms p95=${row.p95}ms\n`)
  }
}
process.stdout.write(`\n[sse] ${JSON.stringify(out.sse, null, 2)}\n`)
process.stdout.write(`\nfull JSON: ${OUT}\n`)
