/**
 * Tunnel detection for the pairing panel's onboarding hints: probe the host
 * for a Tailscale tailnet domain, running frp / Cloudflare Tunnel clients,
 * and the concrete frp public entry derived from frpc.toml — so a first-time
 * user gets a specific suggestion instead of a blank "configure a public
 * address" wall. Best-effort: every probe fails closed (absent) and is
 * bounded by a timeout.
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One detection frame surfaced to the panel. */
export interface TunnelDetection {
  /** The machine's Tailscale tailnet domain (e.g. `user.tail1234.ts.net`). */
  tailnetDomain?: string
  /** Whether an frp client process is running. */
  frpc: boolean
  /** Whether a Cloudflare Tunnel client process is running. */
  cloudflared: boolean
  /** The frp public entry from frpc.toml (`http://serverAddr:remotePort`). */
  frpEntry?: string
}

/** Probe timeout per command; a hung binary must not hold the panel open. */
const PROBE_TIMEOUT_MS = 3_000

/**
 * Detect tunnels on this host.
 * @param timeoutMs - per-command timeout (test seam).
 * @returns the detection frame (all fields present, optional hints absent).
 */
export async function detectTunnels(timeoutMs: number = PROBE_TIMEOUT_MS): Promise<TunnelDetection> {
  const [tailnetDomain, frpc, cloudflared] = await Promise.all([
    detectTailnetDomain(timeoutMs),
    processRunning('frpc', timeoutMs),
    processRunning('cloudflared', timeoutMs),
  ])
  const frpEntry = detectFrpEntry()
  return {
    ...(tailnetDomain !== undefined ? { tailnetDomain } : {}),
    frpc,
    cloudflared,
    ...(frpEntry !== undefined ? { frpEntry } : {}),
  }
}

/** Read the Tailscale tailnet domain from `tailscale status --json`. */
function detectTailnetDomain(timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('tailscale', ['status', '--json'], { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        resolve(undefined)
        return
      }
      try {
        const parsed = JSON.parse(stdout) as { Self?: { DNSName?: string } }
        const name = parsed.Self?.DNSName
        if (typeof name === 'string' && name !== '') {
          resolve(name.endsWith('.') ? name.slice(0, -1) : name)
          return
        }
      } catch {
        // Unparseable output: treat as absent.
      }
      resolve(undefined)
    })
  })
}

/** Whether a process with the given image name is running (tasklist/pgrep). */
function processRunning(name: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', `IMAGENAME eq ${name}.exe`, '/NH'], { timeout: timeoutMs, windowsHide: true }, (error, stdout) => {
        if (error !== null) {
          resolve(false)
          return
        }
        resolve(stdout.toLowerCase().includes(name.toLowerCase()))
      })
    } else {
      execFile('pgrep', ['-x', name], { timeout: timeoutMs }, (error) => {
        resolve(error === null)
      })
    }
  })
}

/** Candidate frpc.toml paths: the dsh home, the user home, and the system default. */
export function frpcConfigCandidates(home: string = homedir()): string[] {
  return [
    join(home, '.dsh', 'frp', 'frpc.toml'),
    join(home, '.dsh', 'frpc.toml'),
    join(home, 'frpc.toml'),
    '/etc/frp/frpc.toml',
  ]
}

/**
 * Parse the frp public entry from an frpc.toml body: `serverAddr` plus the
 * `remotePort` of the proxy whose `localPort` is 3080 (dsh web), falling back
 * to any `remotePort`. Returns `http://serverAddr:remotePort`.
 * @param text - the frpc.toml contents.
 * @returns the entry, or undefined when the file does not name both fields.
 */
export function parseFrpEntry(text: string): string | undefined {
  const server = /serverAddr\s*=\s*"([^"]+)"/.exec(text)?.[1]
  if (server === undefined || server === '') return undefined
  const dshBlock = /\[\[proxies\]\][\s\S]*?localPort\s*=\s*3080[\s\S]*?remotePort\s*=\s*(\d+)/.exec(text)
  const anyPort = /remotePort\s*=\s*(\d+)/.exec(text)
  const port = dshBlock?.[1] ?? anyPort?.[1]
  if (port === undefined) return undefined
  return `http://${server}:${port}`
}

/** Read the first parseable frpc.toml among the candidate paths. */
export function detectFrpEntry(home: string = homedir()): string | undefined {
  for (const path of frpcConfigCandidates(home)) {
    try {
      if (!existsSync(path)) continue
      const entry = parseFrpEntry(readFileSync(path, 'utf8'))
      if (entry !== undefined) return entry
    } catch {
      // Unreadable candidate: try the next one.
    }
  }
  return undefined
}
