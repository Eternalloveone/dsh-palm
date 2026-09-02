// Measure median latency of dsh-palm access paths (Node client).
// URLs are passed as arguments (or env DSH_PALM_PATHS) so no real host,
// IP, or tunnel domain ever lands in the repository.
//
// Usage: node scripts/measure-paths.mjs "name|url" ["name|url" ...]
// Example: node scripts/measure-paths.mjs "local|http://127.0.0.1:3080/m/" "frp|http://<host>:<port>/m/"
import http from 'node:http'
import https from 'node:https'

const args = process.argv.slice(2)
const fromEnv = (process.env.DSH_PALM_PATHS ?? '').split(';').filter(Boolean)
const entries = args.length > 0 ? args : fromEnv
if (entries.length === 0) {
  console.log('usage: node scripts/measure-paths.mjs "name|url" [...]  (or DSH_PALM_PATHS="name|url;name|url")')
  process.exit(1)
}

function once(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http
    const t0 = Date.now()
    const req = mod.get(url, { timeout: 15000 }, (res) => {
      res.resume()
      res.on('end', () => resolve(Date.now() - t0))
    })
    req.on('timeout', () => { req.destroy(); resolve(15000) })
    req.on('error', () => resolve(15000))
  })
}

async function median(url, n = 20) {
  const times = []
  for (let i = 0; i < n; i += 1) {
    times.push(await once(url))
    await new Promise(r => setTimeout(r, 200))
  }
  times.sort((a, b) => a - b)
  const pct = (p) => times[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))]
  return {
    min: times[0],
    p50: pct(0.5),
    p95: pct(0.95),
    max: times[n - 1],
    n,
  }
}

for (const entry of entries) {
  const sep = entry.indexOf('|')
  const name = sep === -1 ? entry : entry.slice(0, sep)
  const url = sep === -1 ? entry : entry.slice(sep + 1)
  const r = await median(url)
  console.log(`${name}: n=${r.n}  min ${r.min}ms  p50 ${r.p50}ms  p95 ${r.p95}ms  max ${r.max}ms`)
}
