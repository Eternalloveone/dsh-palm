/**
 * The updater endpoints over a real HTTP server: loopback-only fences, the
 * dry-run promise (not a single byte changes), background start, status
 * polling, and the restart cancel.
 */
import { createServer, request as httpRequest } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { PairingService } from '../src/pairing.ts'
import { makeRoutes } from '../src/routes.ts'
import { DEFAULT_PKG_NAME, UpdateCoordinator, type UpdateRunner } from '../src/updater.ts'

const PKG_SEGMENTS = DEFAULT_PKG_NAME.split('/')

let dir: string
let installed: string
let tmpDir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-palm-update-routes-'))
  installed = join(dir, 'profile', 'node_modules', ...PKG_SEGMENTS)
  tmpDir = join(dir, 'tmp')
  mkdirSync(join(installed, 'lib'), { recursive: true })
  mkdirSync(tmpDir, { recursive: true })
  writeFileSync(join(installed, 'package.json'), JSON.stringify({
    name: DEFAULT_PKG_NAME, version: '1.6.2', main: 'lib/index.js',
  }))
  writeFileSync(join(installed, 'lib', 'index.js'), '// entry\n')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** The pairing service the route family needs (no persistence here). */
function makeService(): PairingService {
  return new PairingService({
    tokenTtlMs: 60_000,
    offlineAfterMs: 10_000,
    maxDevices: 4,
    cookieName: 'dsh_pair',
  }, {
    now: () => 1_000_000,
    randomToken: () => 'tok-1',
    randomCode: () => '482913',
  })
}

interface TestServer {
  port: number
  close: () => Promise<void>
}

/** Serve the route family from a real server (same shape as routes.spec.ts). */
async function serve(routes: WebRoute[]): Promise<TestServer> {
  const server: Server = createServer((request, response) => {
    const route = routes.find(r => {
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      return r.kind === 'exact' && r.path === pathname
    })
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined || error === null) resolve()
        else reject(error)
      })
    }),
  }
}

/** One JSON call with an explicit Host header. */
async function call(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  opts: { host?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body)
    const headers: Record<string, string> = { host: opts.host ?? `127.0.0.1:${String(port)}` }
    if (payload !== undefined) headers['content-type'] = 'application/json'
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let body: Record<string, unknown> = {}
        try { body = JSON.parse(raw) as Record<string, unknown> } catch { /* empty body */ }
        resolve({ status: response.statusCode ?? 0, body })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/** A runner that stages the new version the way npm would. */
function stagingRunner(version: string, calls: string[]): UpdateRunner {
  return async (command, args) => {
    calls.push([command, ...args].join(' '))
    if (command === 'npm') {
      const prefix = args[args.indexOf('--prefix') + 1] ?? ''
      const staged = join(prefix, 'node_modules', ...PKG_SEGMENTS)
      mkdirSync(join(staged, 'lib'), { recursive: true })
      writeFileSync(join(staged, 'package.json'), JSON.stringify({
        name: DEFAULT_PKG_NAME, version, main: 'lib/index.js',
      }))
      writeFileSync(join(staged, 'lib', 'index.js'), '// entry\n')
    }
    return { code: 0, stdout: '', stderr: '' }
  }
}

/** Routes with a real coordinator in front of a sandbox install. */
function makeTestRoutes(options: {
  fetchLatest?: () => Promise<string | undefined>
  run?: UpdateRunner
  scheduleRestart?: () => { ok: boolean }
  cancelRestart?: () => void
  withUpdate?: boolean
} = {}): WebRoute[] {
  const update = new UpdateCoordinator({
    modulePath: installed,
    fetchLatest: options.fetchLatest ?? (async () => '1.6.3'),
    run: options.run ?? (async () => ({ code: 0, stdout: '', stderr: '' })),
    tmpDir,
    ...(options.scheduleRestart !== undefined ? { scheduleRestart: options.scheduleRestart } : {}),
    ...(options.cancelRestart !== undefined ? { cancelRestart: options.cancelRestart } : {}),
  })
  return makeRoutes({
    service: makeService(),
    lanAddresses: ['192.168.1.5'],
    ...(options.withUpdate === false ? {} : { update }),
  })
}

describe('/api/pair/version', () => {
  it('answers the loopback panel with the installed/latest picture', async () => {
    const { port, close } = await serve(makeTestRoutes())
    try {
      const result = await call(port, 'GET', '/api/pair/version')
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({
        ok: true,
        installed: '1.6.2',
        latest: '1.6.3',
        isNewer: true,
        target: 'directory',
      })
    } finally {
      await close()
    }
  })

  it('reports latest:null when the registry cannot be reached', async () => {
    const { port, close } = await serve(makeTestRoutes({ fetchLatest: async () => undefined }))
    try {
      const result = await call(port, 'GET', '/api/pair/version')
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({ latest: null, isNewer: false })
    } finally {
      await close()
    }
  })

  it('refuses non-loopback callers', async () => {
    const { port, close } = await serve(makeTestRoutes())
    try {
      const result = await call(port, 'GET', '/api/pair/version', { host: '192.168.1.5:3080' })
      expect(result.status).toBe(403)
      expect(result.body).toEqual({ ok: false, code: 'forbidden' })
    } finally {
      await close()
    }
  })
})

describe('/api/pair/update', () => {
  /** Fingerprint every file under a directory (path + size + mtime + bytes). */
  function snapshot(root: string): string[] {
    const out: string[] = []
    const walk = (current: string): void => {
      for (const name of readdirSync(current)) {
        const path = join(current, name)
        const info = statSync(path)
        if (info.isDirectory()) walk(path)
        else out.push(`${path}|${String(info.size)}|${String(info.mtimeMs)}|${readFileSync(path, 'utf8')}`)
      }
    }
    walk(root)
    return out.sort()
  }

  it('refuses non-loopback callers with 403', async () => {
    const calls: string[] = []
    const { port, close } = await serve(makeTestRoutes({ run: stagingRunner('1.6.3', calls) }))
    try {
      const result = await call(port, 'POST', '/api/pair/update', { host: '192.168.1.5:3080', body: {} })
      expect(result.status).toBe(403)
      expect(result.body).toEqual({ ok: false, code: 'forbidden' })
      expect(calls).toHaveLength(0)
    } finally {
      await close()
    }
  })

  it('dryRun answers the plan and changes nothing on disk', async () => {
    const calls: string[] = []
    const before = snapshot(installed)
    const tmpBefore = snapshot(tmpDir)
    const { port, close } = await serve(makeTestRoutes({ run: stagingRunner('1.6.3', calls) }))
    try {
      const result = await call(port, 'POST', '/api/pair/update', { body: { dryRun: true } })
      expect(result.status).toBe(200)
      expect(result.body.ok).toBe(true)
      expect(result.body.started).toBe(false)
      const plan = result.body.plan as Record<string, unknown>
      expect(plan.kind).toBe('npm')
      expect(plan.installed).toBe('1.6.2')
      expect(plan.latest).toBe('1.6.3')
      expect(Array.isArray(plan.steps)).toBe(true)
      // Not one byte, mtime, or temp file changed.
      expect(snapshot(installed)).toEqual(before)
      expect(snapshot(tmpDir)).toEqual(tmpBefore)
      expect(calls).toHaveLength(0)
      const status = await call(port, 'GET', '/api/pair/update/status')
      expect(status.body).toMatchObject({ phase: 'idle', done: false })
    } finally {
      await close()
    }
  })

  it('starts in the background, reports progress, and cancels the restart', async () => {
    const calls: string[] = []
    const scheduleRestart = vi.fn(() => ({ ok: true }))
    const cancelRestart = vi.fn()
    const { port, close } = await serve(makeTestRoutes({
      run: stagingRunner('1.6.3', calls),
      scheduleRestart,
      cancelRestart,
    }))
    try {
      const started = await call(port, 'POST', '/api/pair/update', { body: {} })
      expect(started.status).toBe(200)
      expect(started.body).toMatchObject({ ok: true, started: true })

      let status = await call(port, 'GET', '/api/pair/update/status')
      for (let attempt = 0; attempt < 100 && status.body.phase !== 'restarting'; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 10))
        status = await call(port, 'GET', '/api/pair/update/status')
      }
      expect(status.body).toMatchObject({ phase: 'restarting', ok: true, from: '1.6.2', to: '1.6.3' })
      expect(typeof status.body.restartAt).toBe('number')
      expect(scheduleRestart).toHaveBeenCalled()

      const cancelled = await call(port, 'POST', '/api/pair/update/restart/cancel', { body: {} })
      expect(cancelled.status).toBe(200)
      expect(cancelled.body).toEqual({ cancelled: true })
      expect(cancelRestart).toHaveBeenCalledTimes(1)
      const after = await call(port, 'GET', '/api/pair/update/status')
      expect(after.body).toMatchObject({ phase: 'done', done: true })
    } finally {
      await close()
    }
  })

  it('answers cancelled:false when there is no countdown to cancel', async () => {
    const { port, close } = await serve(makeTestRoutes())
    try {
      const cancelled = await call(port, 'POST', '/api/pair/update/restart/cancel', { body: {} })
      expect(cancelled.status).toBe(200)
      expect(cancelled.body).toEqual({ cancelled: false })
    } finally {
      await close()
    }
  })

  it('rejects a malformed payload and the wrong method', async () => {
    const { port, close } = await serve(makeTestRoutes())
    try {
      const bad = await call(port, 'POST', '/api/pair/update', { body: { dryRun: 'yes' } })
      expect(bad.status).toBe(400)
      expect(bad.body).toEqual({ ok: false, code: 'bad-payload' })
      const wrongMethod = await call(port, 'GET', '/api/pair/update')
      expect(wrongMethod.status).toBe(405)
    } finally {
      await close()
    }
  })
})

describe('update routes without a coordinator', () => {
  it('answers 503 instead of pretending the feature exists', async () => {
    const { port, close } = await serve(makeTestRoutes({ withUpdate: false }))
    try {
      const version = await call(port, 'GET', '/api/pair/version')
      expect(version.status).toBe(503)
      expect(version.body).toEqual({ ok: false, code: 'unavailable' })
      const update = await call(port, 'POST', '/api/pair/update', { body: {} })
      expect(update.status).toBe(503)
      const status = await call(port, 'GET', '/api/pair/update/status')
      expect(status.status).toBe(503)
      const cancel = await call(port, 'POST', '/api/pair/update/restart/cancel', { body: {} })
      expect(cancel.status).toBe(503)
    } finally {
      await close()
    }
  })
})
