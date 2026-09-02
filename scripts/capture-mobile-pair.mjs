/**
 * Capture the mobile pairing gate for the README: headless Chrome at a phone
 * viewport against the live dsh web, screenshot the unpaired PairRequiredView.
 *
 * Desensitization: the gate renders no real data — the server-address field
 * shows the loopback origin (127.0.0.1:3080, a local address with nothing
 * private) and the pairing input is empty. Nothing else is on screen.
 *
 * Usage: node scripts/capture-mobile-pair.mjs [out.png]
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const DEBUG_PORT = 9223
const OUT = process.argv[2] ?? join(process.cwd(), 'docs', 'screenshots', 'pair.png')
const TARGET = 'http://127.0.0.1:3080/m/'

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--user-data-dir=' + join(process.cwd(), '.chrome-capture-mobile'),
  '--window-size=390,844',
  '--no-first-run',
  '--disable-gpu',
  TARGET,
], { stdio: 'ignore' })

let ws
try {
  // Wait for the DevTools endpoint and grab the page target.
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

  // Connect CDP.
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

  // Wait for the pairing gate to render (unpaired client, no cookie).
  let rendered = false
  for (let i = 0; i < 20; i += 1) {
    await sleep(500)
    const check = await send('Runtime.evaluate', {
      expression: `document.querySelector('.mobile-pairCard') !== null`,
      returnByValue: true,
    })
    if (check.result?.result?.value === true) { rendered = true; break }
  }
  if (!rendered) throw new Error('pairing gate not rendered')

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const data = shot.result?.data
  if (typeof data !== 'string') throw new Error('screenshot failed')
  mkdirSync(join(process.cwd(), 'docs', 'screenshots'), { recursive: true })
  writeFileSync(OUT, Buffer.from(data, 'base64'))
  console.log('saved', OUT)
} finally {
  ws?.close()
  chrome.kill()
}
