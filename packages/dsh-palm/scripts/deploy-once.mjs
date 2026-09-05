// Deploy dsh-palm lib + mobile bundle, then restart dsh via schtasks and
// restore the guard. Runs detached-friendly (node fs writes avoid PS Copy-Item
// lock issues). Single self-contained file so it survives agent interruption.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync, spawn } from 'node:child_process'

const SRC = 'C:/Users/Administrator/dsh-source/dsh-palm/packages/dsh-palm/lib'
const DST = 'C:/Users/Administrator/.dsh/profiles/web/node_modules/@eternalloveone/dsh-palm/lib'
const FILES = ['index.js', 'mobile.js']

const run = (cmd, opts = {}) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) }
  catch (err) { return String(err?.stdout ?? err) }
}

// 1. Stop the guard so it does not relaunch dsh mid-deploy.
const pidFile = 'C:/Users/Administrator/.dsh/dsh-guard.pid'
if (existsSync(pidFile)) {
  const pid = readFileSync(pidFile, 'utf8').trim()
  if (pid) { run(`taskkill /PID ${pid} /F`); console.log(`guard pid ${pid} stopped`) }
}

// 2. Kill the dsh process tree (children hold the lib handle).
const out = run(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3080 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique"`)
for (const line of out.split(/\r?\n/)) {
  const pid = line.trim()
  if (/^\d+$/.test(pid)) { run(`taskkill /T /F /PID ${pid}`); console.log(`dsh tree pid ${pid} killed`) }
}

// 3. Copy the rebuilt files.
for (const file of FILES) {
  const src = `${SRC}/${file}`
  const dst = `${DST}/${file}`
  const body = readFileSync(src, 'utf8')
  writeFileSync(dst, body, 'utf8')
  console.log(`copied ${file}: ${body.length} bytes`)
}

// 4. Restart dsh through the standard schtasks task.
run('schtasks /run /tn dsh-restart-now')
console.log('schtasks dsh-restart-now triggered')

// 5. Wait for port 3080.
for (let i = 1; i <= 90; i++) {
  const probe = run(`powershell -NoProfile -Command "Test-NetConnection -ComputerName 127.0.0.1 -Port 3080 -InformationLevel Quiet"`)
  if (/True/i.test(probe)) { console.log('port 3080 ready'); break }
  await new Promise(r => setTimeout(r, 1000))
  if (i === 90) console.log('port 3080 NOT ready after 90s')
}

// 6. Restore the guard.
spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:/Users/Administrator/.dsh/dsh-guard.ps1'], { detached: true, stdio: 'ignore' }).unref()
console.log('dsh-guard relaunch issued')
console.log('=== deploy done ===')
