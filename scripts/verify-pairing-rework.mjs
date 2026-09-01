/**
 * Live regression check for the pairing-surface rework (v0.3.1 features):
 *   1. /api/pair/issue returns a six-digit code
 *   2. /api/pair/accept accepts the code and sets the device cookie
 *   3. the paired cookie passes /api/pair/status
 *   4. the mobile pairing page serves the server-address form
 * Run against the live dsh web instance (loopback). Exit 0 = all green.
 */
const BASE = 'http://127.0.0.1:3080'
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// Wait for the server to come up (up to 60 s).
let up = false
for (let i = 0; i < 30; i += 1) {
  try {
    const probe = await fetch(BASE, { method: 'HEAD' })
    if (probe.status === 200) { up = true; break }
  } catch { /* not up yet */ }
  await new Promise(resolve => setTimeout(resolve, 2000))
}
check('dsh web is up on 3080', up)

if (!up) {
  console.error('server never came up; aborting')
  process.exit(1)
}

// 1. issue → code
let issue
try {
  const res = await fetch(`${BASE}/api/pair/issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  issue = await res.json()
  check('issue returns ok', issue.ok === true, JSON.stringify({ code: issue.code, url: issue.url?.slice(0, 40) }))
  check('issue returns a six-digit code', /^\d{6}$/.test(issue.code ?? ''), `code=${issue.code}`)
} catch (error) {
  check('issue returns ok', false, String(error))
}

// 2. accept with the code → cookie
let cookie = ''
if (issue?.ok) {
  try {
    const res = await fetch(`${BASE}/api/pair/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: issue.code }),
    })
    const body = await res.json()
    const setCookie = res.headers.get('set-cookie') ?? ''
    cookie = setCookie.split(';')[0] ?? ''
    check('accept with code succeeds', res.status === 200 && body.ok === true, `status=${res.status}`)
    check('accept sets the device cookie', cookie.startsWith('dsh_pair='), cookie.slice(0, 24))
  } catch (error) {
    check('accept with code succeeds', false, String(error))
  }
}

// 3. paired cookie passes status
if (cookie !== '') {
  try {
    const res = await fetch(`${BASE}/api/pair/status`, { headers: { cookie } })
    const body = await res.json()
    check('paired cookie passes status', body.paired === true, `phase=${body.phase}`)
  } catch (error) {
    check('paired cookie passes status', false, String(error))
  }
}

// 4. mobile pairing page serves (SPA shell — the form renders from JS)
try {
  const res = await fetch(`${BASE}/m/`)
  const html = await res.text()
  check('mobile pairing page serves', res.status === 200, `bytes=${html.length}`)
  check('mobile page carries the app shell', html.includes('id="root"') || html.includes('mobile'))
} catch (error) {
  check('mobile pairing page serves', false, String(error))
}

// 5. tunnel detection endpoint answers with a well-formed frame
try {
  const res = await fetch(`${BASE}/api/pair/detect`)
  const body = await res.json()
  check('detect endpoint answers', res.status === 200 && body.ok === true, JSON.stringify(body))
  check('detect frame is well-formed', typeof body.frpc === 'boolean' && typeof body.cloudflared === 'boolean')
} catch (error) {
  check('detect endpoint answers', false, String(error))
}

// 6. probe endpoint answers (unreachable target is a valid answer)
try {
  const res = await fetch(`${BASE}/api/pair/probe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1:1' }),
  })
  const body = await res.json()
  check('probe endpoint answers', res.status === 200 && body.ok === false && body.code === 'unreachable', JSON.stringify(body))
} catch (error) {
  check('probe endpoint answers', false, String(error))
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
