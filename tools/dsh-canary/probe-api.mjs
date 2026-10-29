/** 对着金丝雀（3099 / DSH 0.2.2-alpha.2）打手机端接口，确认插件真的在工作。 */
const BASE = 'http://127.0.0.1:3099'
const DEVICE = 'canary0000000000000000000000000000'

let rpcId = 0
async function call(method, payload = {}) {
  rpcId += 1
  const res = await fetch(`${BASE}/m/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `dsh_pair=${DEVICE}` },
    body: JSON.stringify({ type: 'client-request', rpcId: `c-${rpcId}`, method, payload }),
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 120) } }
  return { status: res.status, body }
}

const results = []
for (const [method, payload] of [
  ['mobile.preferences', {}],
  ['mobile.runningSessions', {}],
  ['mobile.finishedRuns', { op: 'read' }],
  ['workspace.list', {}],
  ['session.list', {}],
]) {
  const out = await call(method, payload)
  const ok = out.body?.result?.ok === true
  results.push({ method, status: out.status, ok, error: ok ? undefined : (out.body?.result?.error ?? out.body?.error ?? out.body) })
}

for (const r of results) {
  console.log(String(r.status).padEnd(4), r.method.padEnd(24), r.ok ? 'OK' : 'FAIL ' + JSON.stringify(r.error).slice(0, 160))
}
const failures = results.filter(r => !r.ok)
console.log(`\n结果: ${results.length - failures.length}/${results.length} 通过`)
