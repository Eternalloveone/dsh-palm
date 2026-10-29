/** 重启后验证用量标签：应当只有「累计已用」，不再有「（自开户）」。 */
const BASE = 'http://127.0.0.1:3080'
const PAIR = 'dsh_pair=edb0f18289ef966fa2c1bad84cfed355'

async function call(method, payload = {}) {
  const res = await fetch(`${BASE}/m/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: PAIR },
    body: JSON.stringify({ type: 'client-request', rpcId: 'u1', method, payload }),
  })
  const body = await res.json()
  const result = body?.result
  if (result?.ok !== true) throw new Error(method + ': ' + JSON.stringify(result?.error ?? {}).slice(0, 160))
  return result.value
}

try {
  const usage = await call('mobile.usage', {})
  const providers = usage?.providers ?? usage?.items ?? usage?.rows ?? []
  console.log('提供方数量:', Array.isArray(providers) ? providers.length : '(not an array)')
  const labels = new Set()
  for (const row of (Array.isArray(providers) ? providers : []).slice(0, 12)) {
    const label = String(row.balanceLabel ?? '')
    labels.add(label)
    console.log('  ', String(row.id ?? row.name ?? '?').padEnd(16), 'balanceLabel=' + JSON.stringify(label), 'balance=' + JSON.stringify(row.balance ?? null))
  }
  const text = JSON.stringify(usage)
  console.log('含「自开户」:', text.includes('自开户'))
  console.log('含「累计已用」:', text.includes('累计已用'))
  console.log('结论:', text.includes('自开户') ? 'FAIL 仍然带（自开户）' : 'PASS 已去掉')
} catch (error) {
  console.log('probe failed:', String(error).slice(0, 200))
}
