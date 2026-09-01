/**
 * Capture the desktop pairing panel for the README: launches a headless
 * Chrome against the live dsh web (127.0.0.1:3080), clicks the sidebar
 * remote-access trigger, waits for the panel, and screenshots it.
 *
 * All panel data is desensitized before capture: the issue response is
 * mocked with a fictional tunnel URL / pairing code, the events stream is
 * mocked with a fictional device, and the first-run welcome banner is
 * dismissed — so no real address, token, or device leaks into the repo.
 *
 * Usage: node scripts/capture-panel.mjs [use.png] [pair.png]
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DEBUG_PORT = 9222
const OUT = process.argv[2] ?? join(process.cwd(), 'docs', 'screenshots', 'panel.png')
const PAIR_OUT = process.argv[3] ?? join(process.cwd(), 'docs', 'screenshots', 'panel-pair.png')
const TARGET = 'http://127.0.0.1:3080'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// 1. Launch headless Chrome with the remote debugging port.
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--user-data-dir=' + join(process.cwd(), '.chrome-capture'),
  '--window-size=860,900',
  '--no-first-run',
  '--disable-gpu',
  TARGET,
], { stdio: 'ignore' })

let ws
try {
  // 2. Wait for the DevTools endpoint and grab the page target.
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

  // 3. Connect CDP.
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
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

  // 4. Desensitize before any document script runs: dismiss the welcome
  //    banner, mock the issue response and the events stream with fictional
  //    data — so no real address, token, or device leaks into the repo.
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      try { localStorage.setItem('dsh-palm:welcome-seen', '1') } catch {}
      const realFetch = window.fetch
      window.fetch = (input, init) => {
        const url = String(input)
        if (url === '/api/pair/issue') {
          return Promise.resolve(new Response(JSON.stringify({
            ok: true,
            url: 'https://203.0.113.10:7001/m/?pair=demo-token-123456',
            token: 'demo-token-123456',
            code: '732884',
            expiresAt: Date.now() + 600000,
            lanAddresses: ['192.168.1.5'],
            publicBaseUrl: 'https://203.0.113.10:7001',
          }), { status: 200, headers: { 'content-type': 'application/json' } }))
        }
        return realFetch(input, init)
      }
      const RealEventSource = window.EventSource
      window.EventSource = class extends RealEventSource {
        constructor(url) {
          super(url)
          setTimeout(() => {
            try {
              this.onmessage?.({ data: JSON.stringify({
                type: 'state',
                phase: 'connected',
                lanAvailable: true,
                tokenId: 'demo-token',
                tokenExpiresAt: Date.now() + 600000,
                deviceCount: 1,
                onlineCount: 1,
                devices: [{
                  id: 'demo-device-1',
                  createdAt: Date.now() - 86400000,
                  lastSeenAt: Date.now() - 60000,
                  online: false,
                  userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
                }],
              }) })
            } catch {}
          }, 150)
        }
      }
    })()`,
  })

  // Reload so the injection runs before the GUI boots.
  await send('Page.reload', { ignoreCache: true })
  await sleep(3000)

  // 5. Click the sidebar remote-access trigger (either language label).
  const click = await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('[aria-label="远程访问"], [aria-label="Remote access"]')
      if (btn === null) return { ok: false }
      btn.click()
      return { ok: true }
    })()`,
    returnByValue: true,
  })
  if (click.result?.result?.value?.ok !== true) {
    throw new Error('remote-access trigger not found')
  }
  await sleep(1200) // panel entry animation + mocked events frame

  // 6. Screenshot the use view (paired device, fictional).
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const data = shot.result?.data
  if (typeof data !== 'string') throw new Error('screenshot failed')
  mkdirSync(join(process.cwd(), 'docs', 'screenshots'), { recursive: true })
  writeFileSync(OUT, Buffer.from(data, 'base64'))
  console.log('saved', OUT)

  // 7. Jump to the pair view (step 2) and capture it too.
  const pairClick = await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('重新配对') || b.textContent?.includes('Re-pair'))
      if (btn === undefined) return { ok: false }
      btn.click()
      return { ok: true }
    })()`,
    returnByValue: true,
  })
  if (pairClick.result?.result?.value?.ok === true) {
    await sleep(800)
    const pairShot = await send('Page.captureScreenshot', { format: 'png' })
    if (typeof pairShot.result?.data === 'string') {
      writeFileSync(PAIR_OUT, Buffer.from(pairShot.result.data, 'base64'))
      console.log('saved', PAIR_OUT)
    }
  } else {
    console.log('pair view not reachable')
  }
} finally {
  ws?.close()
  chrome.kill()
}
