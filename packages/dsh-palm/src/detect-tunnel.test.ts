/**
 * Tunnel detection: tailscale status --json parsing, process probes, and
 * frpc.toml entry parsing. execFile is mocked; every probe fails closed
 * (absent) on error.
 */
import { execFile } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectTunnels, parseFrpEntry } from './detect-tunnel.ts'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
// Point the frpc.toml scan at a nonexistent home so the real machine config
// never leaks into the process-probe assertions.
vi.mock('node:os', () => ({ homedir: () => 'C:/nonexistent-home' }))

const execFileMock = vi.mocked(execFile)

/** Drive execFile calls by command name to their given outcomes. */
function answer(map: Record<string, { error?: Error; stdout?: string }>): void {
  execFileMock.mockImplementation(((cmd: string, _args: unknown, _opts: unknown, callback: (error: Error | null, stdout: string) => void) => {
    const outcome = map[cmd]
    if (outcome !== undefined) {
      callback(outcome.error ?? null, outcome.stdout ?? '')
      return undefined as never
    }
    callback(new Error('unexpected command'), '')
    return undefined as never
  }) as never)
}
afterEach(() => {
  vi.clearAllMocks()
})

describe('detectTunnels', () => {
  it('parses the tailnet domain from tailscale status --json', async () => {
    answer({
      tailscale: { stdout: JSON.stringify({ Self: { DNSName: 'alice.tail1234.ts.net.' } }) },
      tasklist: { stdout: '' },
    })
    const result = await detectTunnels()
    expect(result).toEqual({ tailnetDomain: 'alice.tail1234.ts.net', frpc: false, cloudflared: false })
  })

  it('omits the tailnet domain when tailscale is absent or fails', async () => {
    answer({
      tailscale: { error: new Error('ENOENT') },
      tasklist: { stdout: '' },
    })
    const result = await detectTunnels()
    expect(result.tailnetDomain).toBeUndefined()
  })

  it('ignores unparseable tailscale output', async () => {
    answer({
      tailscale: { stdout: 'not json' },
      tasklist: { stdout: '' },
    })
    const result = await detectTunnels()
    expect(result.tailnetDomain).toBeUndefined()
  })

  it('detects a running frpc process', async () => {
    // Both process probes are answered so the test passes on any platform
    // (tasklist on Windows, pgrep elsewhere — CI runs Linux).
    answer({
      tailscale: { error: new Error('ENOENT') },
      tasklist: { stdout: 'frpc.exe  1234 Console 1 12,345 K' },
      pgrep: { stdout: '1234' },
    })
    const result = await detectTunnels()
    expect(result.frpc).toBe(true)
  })

  it('detects a running cloudflared process', async () => {
    answer({
      tailscale: { error: new Error('ENOENT') },
      tasklist: { stdout: 'cloudflared.exe  99 Console 1 8,000 K' },
      pgrep: { stdout: '99' },
    })
    const result = await detectTunnels()
    expect(result.cloudflared).toBe(true)
  })
})

describe('parseFrpEntry', () => {
  it('builds the entry from serverAddr and the dsh-web proxy remotePort', () => {
    const text = [
      'serverAddr = "203.0.113.10"',
      'serverPort = 7000',
      '[[proxies]]',
      'name = "dsh-palm"',
      'type = "tcp"',
      'localIP = "127.0.0.1"',
      'localPort = 3080',
      'remotePort = 7008',
    ].join('\n')
    expect(parseFrpEntry(text)).toBe('http://203.0.113.10:7008')
  })

  it('falls back to any remotePort when no proxy targets 3080', () => {
    const text = [
      'serverAddr = "1.2.3.4"',
      '[[proxies]]',
      'name = "other"',
      'localPort = 8080',
      'remotePort = 9000',
    ].join('\n')
    expect(parseFrpEntry(text)).toBe('http://1.2.3.4:9000')
  })

  it('returns undefined when serverAddr or remotePort is missing', () => {
    expect(parseFrpEntry('serverPort = 7000')).toBeUndefined()
    expect(parseFrpEntry('serverAddr = "1.2.3.4"')).toBeUndefined()
    expect(parseFrpEntry('')).toBeUndefined()
  })
})
