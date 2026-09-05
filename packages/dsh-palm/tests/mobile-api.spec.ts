/**
 * The /m data channel: every allowlisted unary method must answer with the
 * transport envelope the phone's callUnary requires
 * ({ type: 'server-response', rpcId, result }) — regressions here surface as
 * a dead "加载中…" mobile surface.
 */
import { createServer, request as httpRequest } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { makeMobileApiRoutes } from '../src/mobile-api.ts'
import { ChatWindowService } from '../src/chat-window.ts'
import { PendingTracker } from '../src/mobile-pending.ts'
import { NotifyStore } from '../src/notify/notify-store.ts'
import { NotifyEngine } from '../src/notify/notify-engine.ts'

// The voice-services method reads the host config files; stub the resolver
// so the test never depends on the real machine's dsh-palm.yaml.
vi.mock('../src/voice-transcribe.ts', () => ({
  transcribeWav: vi.fn(),
  resolveTranscribeServices: vi.fn(),
}))
import { resolveTranscribeServices } from '../src/voice-transcribe.ts'

interface TestServer {
  port: number
  close: () => Promise<void>
}

const cookieName = 'dsh_pair'

/** A pairing service stub that recognizes every cookie value. */
const service = {
  config: { cookieName },
  hasDevice: () => true,
  touchDevice: () => true,
} as never

/** The resolved mobile composer preference (tests flip it per case). */
const mobileEnterToSend = () => true

/** An ApiProxy stub answering each method with the internal response shape. */
const apiProxy = {
  workspace: {
    list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [], archivedSessionIds: [] } } }),
    archiveSession: async () => ({ rpcId: 'r', result: { ok: true, value: { archivedSessionIds: ['s-1'] } } }),
  },
  agentPresets: {
    list: async () => ({ rpcId: 'r', result: { ok: true, value: { presets: [], authorable: false, hasDocument: false } } }),
  },
  sessions: {
    list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [] } } }),
    create: async () => ({ rpcId: 'r', result: { ok: true, value: { sessionId: 's-created' } } }),
    history: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [] } } }),
    search: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [] } } }),
    prompt: async () => ({ rpcId: 'r', result: { ok: true, value: { queued: true } } }),
    models: async () => ({ rpcId: 'r', result: { ok: true, value: { current: { provider: 'fx', model: 'fx-1' } } } }),
    selectModel: async () => ({ rpcId: 'r', result: { ok: true, value: { ok: true } } }),
    rename: async () => ({ rpcId: 'r', result: { ok: true, value: { ok: true } } }),
    cancel: async () => ({ rpcId: 'r', result: { ok: true, value: { accepted: true } } }),
    updateQueue: async () => ({ rpcId: 'r', result: { ok: true, value: { accepted: true } } }),
  },
  events: { mux: () => (async function* () {})() },
  settings: {
    describe: async () => ({ rpcId: 'r', result: { ok: true, value: { writable: true, hasDocument: false, namespaces: [] } } }),
    mutate: async () => ({ rpcId: 'r', result: { ok: true, value: { ns: 'ui-theme', schema: {}, value: { preference: 'dark' }, applies: 'live', secrets: [], revision: 2 } } }),
  },
} as unknown as ApiProxy

/** A pending tracker holding one question/requested frame for a session. */
function trackerWithQuestion(rpcId: string, sessionId: string): PendingTracker {
  const tracker = new PendingTracker()
  tracker.onFrame({
    rpcId,
    payload: { type: 'question/requested', sessionId, questions: [{ id: 'q-1', question: '继续？' }] },
  } as never)
  return tracker
}

async function serve(routes: WebRoute[]): Promise<TestServer> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname
    const exact = routes.find(r => r.kind === 'exact' && r.path === pathname)
    const route = exact ?? routes.find(r => r.kind === 'prefix' && pathname.startsWith(r.path))
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

async function call(port: number, method: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'probe-1', method, payload: {} })
    const req = httpRequest({
      host: '127.0.0.1', port, path: `/m/api/${method}`, method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${cookieName}=device-1`, 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

/** Like call(), with an explicit payload (readChat etc. need one). */
async function callWith(port: number, method: string, payload: unknown): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'probe-1', method, payload })
    const req = httpRequest({
      host: '127.0.0.1', port, path: `/m/api/${method}`, method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${cookieName}=device-1`, 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function callNoCookie(port: number, method: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'probe-1', method, payload: {} })
    const req = httpRequest({
      host: '127.0.0.1', port, path: `/m/api/${method}`, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('mobile api envelope', () => {
  it('forwards the full redacted settings surface from settings.read', async () => {
    const themeProxy = {
      ...apiProxy,
      settings: {
        ...apiProxy.settings,
        describe: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              writable: true,
              hasDocument: false,
              namespaces: [
                { ns: 'ui-theme', schema: { uid: 1, refs: {} }, value: { preference: 'dark' }, applies: 'live', secrets: [], revision: 1 },
                { ns: 'llm-pi-ai', schema: { uid: 2, refs: {} }, value: { providers: {} }, applies: 'restart', secrets: [{ path: ['apiKey'], set: true }], revision: 1 },
              ],
            },
          },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: themeProxy, mobileEnterToSend }))
    try {
      const { status, body } = await call(server.port, 'settings.read')
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { namespaces: Array<{ ns: string }> } } }
      expect(envelope.result.ok).toBe(true)
      // The whole redacted surface rides back (schemas + values, secrets
      // stripped by the host seam) so the phone renders desktop-parity cards.
      expect(envelope.result.value.namespaces.map(entry => entry.ns)).toEqual(['ui-theme', 'llm-pi-ai'])
    } finally {
      await server.close()
    }
  })

  it('accepts a whitelisted settings.mutate and forwards expectedRevision', async () => {
    let received: unknown
    const mutatingProxy = {
      ...apiProxy,
      settings: {
        ...apiProxy.settings,
        mutate: async (request: never) => {
          received = request
          return { rpcId: 'r', result: { ok: true, value: { ns: 'ui-theme', value: { preference: 'system' }, revision: 3 } } }
        },
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: mutatingProxy, mobileEnterToSend }))
    try {
      const body = JSON.stringify({
        type: 'client-request', rpcId: 'probe-mut', method: 'settings.mutate',
        payload: { ns: 'ui-theme', ops: [{ op: 'set', path: ['preference'], value: 'system' }], expectedRevision: 1 },
      })
      const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = httpRequest({
          host: '127.0.0.1', port: server.port, path: '/m/api/settings.mutate', method: 'POST',
          headers: { 'content-type': 'application/json', cookie: `${cookieName}=device-1`, 'content-length': Buffer.byteLength(body) },
        }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', chunk => { chunks.push(chunk as Buffer) })
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
        })
        req.on('error', reject)
        req.end(body)
      })
      expect(result.status).toBe(200)
      const envelope = JSON.parse(result.body) as { result: { ok: boolean } }
      expect(envelope.result.ok).toBe(true)
      const forwarded = received as { payload: { ns: string; ops: unknown[]; expectedRevision: number } }
      expect(forwarded.payload.ns).toBe('ui-theme')
      expect(forwarded.payload.ops).toEqual([{ op: 'set', path: ['preference'], value: 'system' }])
      expect(forwarded.payload.expectedRevision).toBe(1)
    } finally {
      await server.close()
    }
  })

  it('refuses settings.mutate outside the whitelist with a stable 404', async () => {
    let forwarded = false
    const guardedProxy = {
      ...apiProxy,
      settings: {
        ...apiProxy.settings,
        mutate: async (request: never) => {
          forwarded = true
          return request
        },
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: guardedProxy, mobileEnterToSend }))
    try {
      const refused = [
        { ns: 'ui-theme', ops: [{ op: 'unset', path: ['preference'] }] },
        { ns: 'ui-theme', ops: [{ op: 'set', path: ['fontSize'], value: 20 }] },
        { ns: 'llm-pi-ai', ops: [{ op: 'set', path: ['apiKey'], value: 'x' }] },
        { ns: 'ui-conversation', ops: [{ op: 'set', path: ['busyEnter', 'extra'], value: 'x' }] },
        { ns: 'shell', ops: [{ op: 'set', path: ['timeoutMs'], value: 1 }] },
        { ns: 'remote-web-ui', ops: [{ op: 'set', path: ['publicBaseUrl'], value: 'https://evil' }] },
        { ns: 'ui-theme', ops: [] },
        { ns: 'ui-theme', ops: [{ op: 'set', path: ['preference', 'extra'], value: 'x' }] },
      ]
      for (const payload of refused) {
        const body = JSON.stringify({ type: 'client-request', rpcId: 'probe-ref', method: 'settings.mutate', payload })
        const result = await new Promise<{ body: string }>((resolve, reject) => {
          const req = httpRequest({
            host: '127.0.0.1', port: server.port, path: '/m/api/settings.mutate', method: 'POST',
            headers: { 'content-type': 'application/json', cookie: `${cookieName}=device-1`, 'content-length': Buffer.byteLength(body) },
          }, (response) => {
            const chunks: Buffer[] = []
            response.on('data', chunk => { chunks.push(chunk as Buffer) })
            response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }))
          })
          req.on('error', reject)
          req.end(body)
        })
        const envelope = JSON.parse(result.body) as { result: { ok: boolean; error: { code: string } } }
        expect(envelope.result.ok).toBe(false)
        expect(envelope.result.error.code).toBe('not-found')
      }
      // The host mutate was never reached.
      expect(forwarded).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('accepts the extended whitelist: conversation, model defaults, UI-only namespaces', async () => {
    const accepted: unknown[] = []
    const openProxy = {
      ...apiProxy,
      settings: {
        ...apiProxy.settings,
        mutate: async (request: never) => {
          accepted.push(request)
          return { rpcId: 'r', result: { ok: true, value: { ns: 'x', value: {}, revision: 1 } } }
        },
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: openProxy, mobileEnterToSend }))
    try {
      const allowed = [
        { ns: 'ui-conversation', ops: [{ op: 'set', path: ['busyEnter'], value: false }] },
        { ns: 'agent-default-model', ops: [{ op: 'set', path: ['model'], value: 'fx-1' }] },
        { ns: 'dsh-better-sidebar', ops: [{ op: 'set', path: ['terminalFontSize'], value: 14 }] },
      ]
      for (const payload of allowed) {
        const body = JSON.stringify({ type: 'client-request', rpcId: 'probe-ok', method: 'settings.mutate', payload })
        const result = await new Promise<{ body: string }>((resolve, reject) => {
          const req = httpRequest({
            host: '127.0.0.1', port: server.port, path: '/m/api/settings.mutate', method: 'POST',
            headers: { 'content-type': 'application/json', cookie: `${cookieName}=device-1`, 'content-length': Buffer.byteLength(body) },
          }, (response) => {
            const chunks: Buffer[] = []
            response.on('data', chunk => { chunks.push(chunk as Buffer) })
            response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }))
          })
          req.on('error', reject)
          req.end(body)
        })
        const envelope = JSON.parse(result.body) as { result: { ok: boolean } }
        expect(envelope.result.ok).toBe(true)
      }
      expect(accepted).toHaveLength(3)
    } finally {
      await server.close()
    }
  })

  it('forwards mobile.respond as a client-response echoing the frame rpcId', async () => {
    let received: unknown
    const respondingProxy = {
      ...apiProxy,
      respond: async (message: never) => {
        received = message
        return { rpcId: 'r', result: { ok: true, value: { accepted: true } } }
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({
      service, apiProxy: respondingProxy, mobileEnterToSend,
      pendingTracker: trackerWithQuestion('q-1', 's-1'),
    }))
    try {
      const body = JSON.stringify({
        type: 'client-request', rpcId: 'probe-resp', method: 'mobile.respond',
        payload: {
          rpcId: 'q-1',
          response: { sessionId: 's-1', answer: { answers: [{ id: 'q-1', selected: ['继续'] }] } },
        },
      })
      const result = await new Promise<{ body: string }>((resolve, reject) => {
        const req = httpRequest({
          host: '127.0.0.1', port: server.port, path: '/m/api/mobile.respond', method: 'POST',
          headers: { 'content-type': 'application/json', cookie: `${cookieName}=device-1`, 'content-length': Buffer.byteLength(body) },
        }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', chunk => { chunks.push(chunk as Buffer) })
          response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }))
        })
        req.on('error', reject)
        req.end(body)
      })
      const envelope = JSON.parse(result.body) as { result: { ok: boolean } }
      expect(envelope.result.ok).toBe(true)
      const forwarded = received as { type: string; rpcId: string; result: { value: unknown } }
      expect(forwarded.type).toBe('client-response')
      expect(forwarded.rpcId).toBe('q-1')
      expect(forwarded.result.value).toEqual({ sessionId: 's-1', answer: { answers: [{ id: 'q-1', selected: ['继续'] }] } })
    } finally {
      await server.close()
    }
  })

  it('refuses mobile.respond when the rpcId is not pending (404, not silent)', async () => {
    const respondingProxy = {
      ...apiProxy,
      respond: vi.fn(async () => ({ rpcId: 'r', result: { ok: true, value: { accepted: true } } })),
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({
      service, apiProxy: respondingProxy, mobileEnterToSend,
      pendingTracker: new PendingTracker(), // nothing pending
    }))
    try {
      const body = JSON.stringify({
        type: 'client-request', rpcId: 'probe-resp', method: 'mobile.respond',
        payload: { rpcId: 'q-unknown', response: { sessionId: 's-1', answer: { answers: [] } } },
      })
      const result = await new Promise<{ body: string }>((resolve, reject) => {
        const req = httpRequest({
          host: '127.0.0.1', port: server.port, path: '/m/api/mobile.respond', method: 'POST',
          headers: { 'content-type': 'application/json', cookie: `${cookieName}=device-1`, 'content-length': Buffer.byteLength(body) },
        }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', chunk => { chunks.push(chunk as Buffer) })
          response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }))
        })
        req.on('error', reject)
        req.end(body)
      })
      const envelope = JSON.parse(result.body) as { result: { ok: boolean; error?: { code: string } } }
      expect(envelope.result.ok).toBe(false)
      expect(envelope.result.error?.code).toBe('not-found')
      // The host respond must never be reached for an unknown rpcId.
      expect(respondingProxy.respond).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('refuses mobile.respond when the claimed session does not own the rpcId (409 conflict)', async () => {
    const respondingProxy = {
      ...apiProxy,
      respond: vi.fn(async () => ({ rpcId: 'r', result: { ok: true, value: { accepted: true } } })),
    } as unknown as ApiProxy
    // The pending question belongs to session s-1; the phone claims s-2.
    const server = await serve(makeMobileApiRoutes({
      service, apiProxy: respondingProxy, mobileEnterToSend,
      pendingTracker: trackerWithQuestion('q-1', 's-1'),
    }))
    try {
      const body = JSON.stringify({
        type: 'client-request', rpcId: 'probe-resp', method: 'mobile.respond',
        payload: { rpcId: 'q-1', response: { sessionId: 's-2', answer: { answers: [] } } },
      })
      const result = await new Promise<{ body: string }>((resolve, reject) => {
        const req = httpRequest({
          host: '127.0.0.1', port: server.port, path: '/m/api/mobile.respond', method: 'POST',
          headers: { 'content-type': 'application/json', cookie: `${cookieName}=device-1`, 'content-length': Buffer.byteLength(body) },
        }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', chunk => { chunks.push(chunk as Buffer) })
          response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }))
        })
        req.on('error', reject)
        req.end(body)
      })
      const envelope = JSON.parse(result.body) as { result: { ok: boolean; error?: { code: string } } }
      expect(envelope.result.ok).toBe(false)
      expect(envelope.result.error?.code).toBe('conflict')
      expect(respondingProxy.respond).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('gzip-compresses large responses when the client accepts it', async () => {
    // A session.list whose payload exceeds the 1 KiB compression threshold.
    const bigItems = Array.from({ length: 60 }, (_, i) => ({
      sessionId: `session-${String(i).padStart(4, '0')}-abcdefabcdefabcdefabcdefabcdefab`,
      updatedAt: 1_700_000_000_000 + i,
      title: `测试会话第 ${i} 号：一个足够长的标题让序列化超过阈值`,
    }))
    const bigProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: bigItems } } }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: bigProxy, mobileEnterToSend }))
    try {
      const result = await new Promise<{ status: number; body: Buffer; encoding: string | undefined }>((resolve, reject) => {
        const body = JSON.stringify({ type: 'client-request', rpcId: 'probe-gz', method: 'session.list', payload: {} })
        const req = httpRequest({
          host: '127.0.0.1', port: server.port, path: '/m/api/session.list', method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `${cookieName}=device-1`,
            'content-length': Buffer.byteLength(body),
            'accept-encoding': 'gzip',
          },
        }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks), encoding: response.headers['content-encoding'] as string | undefined }))
        })
        req.on('error', reject)
        req.end(body)
      })
      expect(result.status).toBe(200)
      expect(result.encoding).toBe('gzip')
      const { gunzipSync } = await import('node:zlib')
      const envelope = JSON.parse(gunzipSync(result.body).toString('utf8')) as { type: string; result: { ok: boolean } }
      expect(envelope.type).toBe('server-response')
      expect(envelope.result.ok).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('writes the unpaired SSE rejection as JSON with family headers', async () => {
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const result = await new Promise<{ status: number; body: string; headers: typeof import('node:http').IncomingHttpHeaders }>((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port: server.port, path: '/m/api/events.mux', method: 'GET' }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', chunk => { chunks.push(chunk as Buffer) })
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: response.headers }))
        })
        req.on('error', reject)
        req.end()
      })
      expect(result.status).toBe(403)
      expect(JSON.parse(result.body)).toEqual({
        ok: false,
        error: { code: 'unpaired', message: 'mobile session is not paired' },
      })
      expect(result.headers['content-type']).toBe('application/json; charset=utf-8')
      expect(result.headers['referrer-policy']).toBe('no-referrer')
    } finally {
      await server.close()
    }
  })

  it('wraps every allowlisted unary method in the server-response envelope', async () => {
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      for (const method of [
        'workspace.list',
        'workspace.archiveSession',
        'agentPreset.list',
        'session.create',
        'session.list',
        'session.history',
        'session.search',
        'session.prompt',
        'session.models',
        'session.selectModel',
        'session.rename',
        'session.cancel',
        'session.updateQueue',
      ]) {
        const { status, body } = await call(server.port, method)
        expect(status).toBe(200)
        const envelope = JSON.parse(body) as { type?: string; rpcId?: string; result?: { ok?: boolean } }
        expect(envelope.type, method).toBe('server-response')
        expect(envelope.rpcId, method).toBe('probe-1')
        expect(envelope.result?.ok, method).toBe(true)
      }
    } finally {
      await server.close()
    }
  })

  it('wraps a session.list error in the server-response envelope, not a bare rpc body', async () => {
    const failingApiProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({ rpcId: 'r', result: { ok: false as const, error: { code: 'forbidden', message: 'nope' } } }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: failingApiProxy, mobileEnterToSend }))
    try {
      const { status, body } = await call(server.port, 'session.list')
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { type?: string; rpcId?: string; result?: { ok?: boolean; error?: unknown } }
      expect(envelope.type).toBe('server-response')
      expect(envelope.rpcId).toBe('probe-1')
      expect(envelope.result?.ok).toBe(false)
      expect(envelope.result?.error).toEqual({ code: 'forbidden', message: 'nope' })
    } finally {
      await server.close()
    }
  })

  it('filters subagent and archived sessions out of session.list pages', async () => {
    const mixedApiProxy = {
      ...apiProxy,
      workspace: {
        ...apiProxy.workspace,
        list: async () => ({ rpcId: 'r', result: { ok: true as const, value: { items: [], archivedSessionIds: ['archived-1'] } } }),
      },
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({
          rpcId: 'r',
          result: {
            ok: true as const,
            value: {
              items: [
                { sessionId: 'main-1', updatedAt: 4000, origin: undefined },
                // Deleted on the desktop (workspace.deleteSession archive set):
                // the host session.list still returns it while the attached
                // live entry survives, the phone must not show it again.
                { sessionId: 'archived-1', updatedAt: 3500, origin: undefined },
                { sessionId: 'sub-1', updatedAt: 2000, origin: 'subagent' as const },
                { sessionId: 'main-2', updatedAt: 1000, origin: undefined },
                { sessionId: 'sub-2', updatedAt: 500, origin: 'subagent' as const },
              ],
            },
          },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: mixedApiProxy, mobileEnterToSend }))
    try {
      const { status, body } = await call(server.port, 'session.list')
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result?: { value?: { items?: Array<{ sessionId: string }>; hasMore?: boolean } } }
      const ids = envelope.result?.value?.items?.map(item => item.sessionId) ?? []
      expect(ids).toEqual(['main-1', 'main-2'])
      expect(envelope.result?.value?.hasMore).toBe(false)
    } finally {
      await server.close()
    }
  })

  it('answers mobile.runningSessions with running main-agent session ids', async () => {
    const mixedApiProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({
          rpcId: 'r',
          result: {
            ok: true as const,
            value: {
              items: [
                // A session mid-turn right now: must be listed.
                { sessionId: 'run-1', updatedAt: 4000, origin: undefined, running: true as const, blank: false as const },
                // Subagent working sessions are internal: excluded like the roster.
                { sessionId: 'sub-run', updatedAt: 3500, origin: 'subagent' as const, running: true as const, blank: false as const },
                // Blank (never conversed) or idle sessions are not "running".
                { sessionId: 'idle-1', updatedAt: 3000, origin: undefined, running: false as const, blank: false as const },
                { sessionId: 'blank-1', updatedAt: 2000, origin: undefined, running: false as const, blank: true as const },
              ],
            },
          },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: mixedApiProxy, mobileEnterToSend }))
    try {
      const { status, body } = await call(server.port, 'mobile.runningSessions')
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result?: { value?: { sessionIds: string[] } } }
      expect(envelope.result?.value?.sessionIds).toEqual(['run-1'])
    } finally {
      await server.close()
    }
  })

  it('answers mobile.preferences locally from the plugin config', async () => {
    let mobileEnterToSend = true
    const server = await serve(makeMobileApiRoutes({
      service,
      apiProxy,
      mobileEnterToSend: () => mobileEnterToSend,
    }))
    try {
      const first = await call(server.port, 'mobile.preferences')
      expect(first.status).toBe(200)
      expect(JSON.parse(first.body)).toEqual({
        type: 'server-response',
        rpcId: 'probe-1',
        result: { ok: true, value: { mobileEnterToSend: true } },
      })

      mobileEnterToSend = false
      const second = await call(server.port, 'mobile.preferences')
      expect(second.status).toBe(200)
      expect(JSON.parse(second.body)).toEqual({
        type: 'server-response',
        rpcId: 'probe-1',
        result: { ok: true, value: { mobileEnterToSend: false } },
      })
    } finally {
      await server.close()
    }
  })

  it('heartbeat keep-alive reuses the single SSE connection (no new socket)', async () => {
    const blockingProxy = {
      ...apiProxy,
      events: { mux: () => (async function* () { while (true) { await new Promise(() => {}) } })() },
    } as unknown as ApiProxy
    const routes = makeMobileApiRoutes({ service, apiProxy: blockingProxy, mobileEnterToSend, eventsHeartbeatMs: 25 })
    let connections = 0
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      const exact = routes.find(r => r.kind === 'exact' && r.path === pathname)
      const route = exact ?? routes.find(r => r.kind === 'prefix' && pathname.startsWith(r.path))
      if (route === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      void route.handler(request, response)
    })
    server.on('connection', () => { connections += 1 })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo

    let sseData = ''
    let resolveDone: (() => void) | undefined
    const done = new Promise<void>(resolve => { resolveDone = resolve })
    const req = httpRequest({
      host: '127.0.0.1', port: address.port, path: '/m/api/events.mux', method: 'GET',
      headers: { cookie: 'dsh_pair=device-1' },
    }, (response) => {
      response.on('data', (chunk) => {
        sseData += (chunk as Buffer).toString('utf8')
        // Two keep-alive pings prove the heartbeat is writing to this stream.
        if ((sseData.match(/: ping/g) ?? []).length >= 2) resolveDone?.()
      })
    })
    req.on('error', () => { resolveDone?.() })
    req.end()

    await done
    // The heartbeat wrote two pings onto the SAME open SSE connection; no
    // additional socket was opened for keep-alive (reuse of the single stream).
    expect((sseData.match(/: ping/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(connections).toBe(1)

    req.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('refreshes device presence on every gated unary request', async () => {
    // The mobile surface has no /api/pair/heartbeat sender, so any gated RPC
    // must count as presence (touchDevice) — otherwise an idle phone ages past
    // offlineAfterMs and the desktop panel reports it as disconnected while it
    // is still actively connected.
    const touchDevice = vi.fn(() => true)
    const spyService = { config: { cookieName }, hasDevice: () => true, touchDevice } as never
    const server = await serve(makeMobileApiRoutes({ service: spyService, apiProxy, mobileEnterToSend }))
    try {
      const { status } = await call(server.port, 'session.list')
      expect(status).toBe(200)
      expect(touchDevice).toHaveBeenCalledWith('device-1')
    } finally {
      await server.close()
    }
  })

  it('refreshes device presence on every SSE keep-alive while the stream stays open', async () => {
    // The core scenario: an idle phone keeps its SSE stream open but sends no
    // RPC traffic. The keep-alive interval must keep calling touchDevice so the
    // device never ages past offlineAfterMs — without this the desktop panel
    // reports "disconnected" while the phone is still connected.
    const touchDevice = vi.fn(() => true)
    const spyService = { config: { cookieName }, hasDevice: () => true, touchDevice } as never
    const blockingProxy = {
      ...apiProxy,
      events: { mux: () => (async function* () { while (true) { await new Promise(() => {}) } })() },
    } as unknown as ApiProxy
    const routes = makeMobileApiRoutes({ service: spyService, apiProxy: blockingProxy, mobileEnterToSend, eventsHeartbeatMs: 20 })
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      const exact = routes.find(r => r.kind === 'exact' && r.path === pathname)
      const route = exact ?? routes.find(r => r.kind === 'prefix' && pathname.startsWith(r.path))
      if (route === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      void route.handler(request, response)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo

    let resolveDone: (() => void) | undefined
    const done = new Promise<void>(resolve => { resolveDone = resolve })
    const req = httpRequest({
      host: '127.0.0.1', port: address.port, path: '/m/api/events.mux', method: 'GET',
      headers: { cookie: 'dsh_pair=device-1' },
    }, () => {})
    req.on('error', () => { resolveDone?.() })
    req.end()

    // Wait until the keep-alive interval has fired enough times (>= 2 touches).
    const deadline = Date.now() + 2000
    while (touchDevice.mock.calls.length < 2 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10))
    }
    resolveDone?.()

    expect(touchDevice.mock.calls.length).toBeGreaterThanOrEqual(2)
    // Each keep-alive refreshes presence for the paired device cookie.
    for (const callArgs of touchDevice.mock.calls) {
      expect(callArgs[0]).toBe('device-1')
    }

    req.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('ends the live SSE stream when the device is revoked', async () => {
    // stop()/revoke() only clear the device table; the open /m/api/events.mux
    // stream must still die — the keepalive re-checks the table and ends it,
    // so a revoked device stops receiving host events without waiting for a
    // reconnect (which would 403 anyway).
    let paired = true
    const revocableService = { config: { cookieName }, hasDevice: () => paired, touchDevice: () => true } as never
    const blockingProxy = {
      ...apiProxy,
      events: { mux: () => (async function* () { while (true) { await new Promise(() => {}) } })() },
    } as unknown as ApiProxy
    const routes = makeMobileApiRoutes({ service: revocableService, apiProxy: blockingProxy, mobileEnterToSend, eventsHeartbeatMs: 20 })
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      const exact = routes.find(r => r.kind === 'exact' && r.path === pathname)
      const route = exact ?? routes.find(r => r.kind === 'prefix' && pathname.startsWith(r.path))
      if (route === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      void route.handler(request, response)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo

    let resolveEnded: (() => void) | undefined
    const ended = new Promise<void>(resolve => { resolveEnded = resolve })
    const req = httpRequest({
      host: '127.0.0.1', port: address.port, path: '/m/api/events.mux', method: 'GET',
      headers: { cookie: 'dsh_pair=device-1' },
    }, (response) => {
      // Consume the stream (paused streams never emit 'end').
      response.resume()
      response.on('end', () => { resolveEnded?.() })
    })
    req.on('error', () => { resolveEnded?.() })
    req.end()

    // Let the stream open and at least one keepalive pass, then revoke.
    await new Promise<void>(resolve => setTimeout(resolve, 60))
    paired = false
    await ended
    req.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('vetoes when touchDevice returns false despite a present cookie', async () => {
    // hasDevice may be true while touchDevice is false (e.g. the service was
    // stopped). The gate must still refuse and must not leak the request.
    const touchDevice = vi.fn(() => false)
    const spyService = { config: { cookieName }, hasDevice: () => true, touchDevice } as never
    const server = await serve(makeMobileApiRoutes({ service: spyService, apiProxy, mobileEnterToSend }))
    try {
      const { status } = await call(server.port, 'session.list')
      expect(status).toBe(403)
      expect(touchDevice).toHaveBeenCalledWith('device-1')
    } finally {
      await server.close()
    }
  })

  it('does not refresh presence when the device cookie is absent', async () => {
    const touchDevice = vi.fn(() => true)
    const spyService = { config: { cookieName }, hasDevice: () => false, touchDevice } as never
    const server = await serve(makeMobileApiRoutes({ service: spyService, apiProxy, mobileEnterToSend }))
    try {
      // A request without the pairing cookie must be vetoed and must not
      // touchDevice (there is no device id to refresh).
      const { status } = await callNoCookie(server.port, 'session.list')
      expect(status).toBe(403)
      expect(touchDevice).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })
})
describe('mobile api body failure contract (shared readBoundedJson)', () => {
  /** Raw POST at /m/api/: raw text payload or no payload at all. */
  async function rawPost(
    port: number,
    path: string,
    payload: string | undefined,
  ): Promise<{ status: number | null; body: string; error: string | null }> {
    return await new Promise((resolve) => {
      const headers: Record<string, string> = {
        cookie: cookieName + '=device-1',
        host: '127.0.0.1:' + String(port),
        // `connection: close` is deliberate: each probe is its own socket, so
        // an unpaired/gate 403 or a 404 that responds with the request body
        // still in flight can never leak into a reused keep-alive connection
        // (the strict reader's overflow path was migrated to drain-first in
        // 6456db4; switching this to keep-alive made the oversized case
        // STABLY time out, so close semantics stay).
        connection: 'close',
      }
      if (payload !== undefined) {
        headers['content-type'] = 'application/json'
        headers['content-length'] = String(Buffer.byteLength(payload))
      }
      const req = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), error: null })
        })
      })
      req.on('error', (error: Error) => resolve({ status: null, body: '', error: error.message }))
      if (payload !== undefined) req.write(payload)
      req.end()
    })
  }

  it('answers 400 for an unparseable, empty or oversized body', async () => {
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      // Unparseable and explicit empty (content-length 0) bodies answer the
      // full envelope; a body-less POST is a client-side transport nuance and
      // is not part of the reader contract.
      for (const payload of ['{not json', '']) {
        const outcome = await rawPost(server.port, '/m/api/mobile.preferences', payload)
        expect(outcome.error).toBeNull()
        expect(outcome.status).toBe(400)
        expect(JSON.parse(outcome.body)).toEqual({
          ok: false,
          error: { code: 'bad-request', message: 'invalid json body' },
        })
      }
      // Oversize: readBoundedJson throws while the body is still in flight,
      // so the strict reader keeps the socket-alive 400 contract (no destroy);
      // the response body may be cut by the connection teardown, only the
      // status is part of the contract.
      const oversize = await rawPost(
        server.port,
        '/m/api/mobile.preferences',
        JSON.stringify({ type: 'client-request', rpcId: 'p', payload: { blob: 'x'.repeat(70 * 1024) } }),
      )
      expect(oversize.error).toBeNull()
      expect(oversize.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('accepts image-sized session.prompt bodies (the 64 KiB cap rejected every upload)', async () => {
    let received: unknown
    const promptProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        prompt: async (request: never) => {
          received = request
          return { rpcId: 'r', result: { ok: true, value: { queued: true } } }
        },
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: promptProxy, mobileEnterToSend }))
    try {
      // One compressed image (256 KiB base64 — the mobile compressor's
      // budget) plus the envelope: the old 64 KiB cap rejected every image
      // upload with the recording-oriented "请缩短录音" message.
      const imagePayload = JSON.stringify({
        type: 'client-request', rpcId: 'probe-img', method: 'session.prompt',
        payload: {
          sessionId: 's-1', mode: 'queue',
          content: [{ type: 'image', mediaType: 'image/jpeg', data: 'A'.repeat(256 * 1024) }],
        },
      })
      const outcome = await rawPost(server.port, '/m/api/session.prompt', imagePayload)
      expect(outcome.error).toBeNull()
      expect(outcome.status).toBe(200)
      const envelope = JSON.parse(outcome.body) as { result: { ok: boolean } }
      expect(envelope.result.ok).toBe(true)
      const forwarded = received as { payload: { content: Array<{ type: string; data: string }> } }
      expect(forwarded.payload.content[0]?.data.length).toBe(256 * 1024)
    } finally {
      await server.close()
    }
  })

  it('still rejects a session.prompt beyond the image budget', async () => {
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const oversize = await rawPost(
        server.port,
        '/m/api/session.prompt',
        JSON.stringify({
          type: 'client-request', rpcId: 'p', method: 'session.prompt',
          payload: { content: [{ type: 'image', mediaType: 'image/jpeg', data: 'A'.repeat(3 * 1024 * 1024) }] },
        }),
      )
      expect(oversize.error).toBeNull()
      expect(oversize.status).toBe(400)
    } finally {
      await server.close()
    }
  })
})

describe('mobile.commandExec', () => {
  /** Post one commandExec call with a business payload, unwrapping the envelope. */
  async function callExec(port: number, payload: unknown): Promise<{ status: number; value?: Record<string, unknown>; error?: { code: string; message: string } }> {
    return await new Promise((resolve, reject) => {
      const body = JSON.stringify({ type: 'client-request', rpcId: 'exec-1', method: 'mobile.commandExec', payload })
      const req = httpRequest({
        host: '127.0.0.1', port, path: '/m/api/mobile.commandExec', method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `${cookieName}=device-1`, 'content-length': Buffer.byteLength(body) },
      }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        response.on('end', () => {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { result?: { ok: boolean; value?: Record<string, unknown>; error?: { code: string; message: string } } }
          resolve({ status: response.statusCode ?? 0, value: parsed.result?.ok === true ? parsed.result.value : undefined, error: parsed.result?.ok === false ? parsed.result.error : undefined })
        })
      })
      req.on('error', reject)
      req.end(body)
    })
  }

  /** The agent stub the lookup returns (identity is asserted, not used). */
  const agent = { agent: true }

  it('executes a matched line through the host registry and answers its result', async () => {
    const execute = vi.fn(async () => ({ commandId: 'cmd-1', result: { kind: 'success', text: 'No compactable history yet.' } }))
    const server = await serve(makeMobileApiRoutes({
      service, apiProxy, mobileEnterToSend,
      commands: { list: () => [], execute },
      agents: { get: () => agent },
    }))
    try {
      const outcome = await callExec(server.port, { sessionId: 's-1', line: '/compact' })
      expect(outcome.status).toBe(200)
      expect(outcome.value).toEqual({ matched: true, kind: 'success', text: 'No compactable history yet.' })
      expect(execute).toHaveBeenCalledWith(agent, '/compact', [], expect.any(AbortSignal))
    } finally {
      await server.close()
    }
  })

  it('answers matched:false for an unresolved line and for absent registries', async () => {
    const execute = vi.fn(async () => undefined)
    const server = await serve(makeMobileApiRoutes({
      service, apiProxy, mobileEnterToSend,
      commands: { list: () => [], execute },
      agents: { get: () => agent },
    }))
    try {
      const miss = await callExec(server.port, { sessionId: 's-1', line: '/nope' })
      expect(miss.status).toBe(200)
      expect(miss.value).toEqual({ matched: false })
    } finally {
      await server.close()
    }
    // Neither service composed (or the session has no live agent): the method
    // still answers the envelope so the phone can fall through cleanly.
    const bare = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const absent = await callExec(bare.port, { sessionId: 's-1', line: '/compact' })
      expect(absent.status).toBe(200)
      expect(absent.value).toEqual({ matched: false })
    } finally {
      await bare.close()
    }
  })

  it('does not leak the host command error message to the phone', async () => {
    const execute = vi.fn(async () => {
      throw new Error('/etc/dsh/secret-config.yaml: permission denied')
    })
    const server = await serve(makeMobileApiRoutes({
      service, apiProxy, mobileEnterToSend,
      commands: { list: () => [], execute },
      agents: { get: () => agent },
    }))
    try {
      const outcome = await callExec(server.port, { sessionId: 's-1', line: '/compact' })
      expect(outcome.status).toBe(200)
      // A stable user-facing refusal; the internal path/message never reaches
      // the phone.
      expect(outcome.error?.code).toBe('command-failed')
      expect(outcome.error?.message).toBe('命令执行失败，请稍后重试')
      expect(outcome.error?.message).not.toContain('secret-config')
      expect(outcome.error?.message).not.toContain('/etc')
    } finally {
      await server.close()
    }
  })

  it('returns the host-side fallback transcription services for phone import', async () => {
    vi.mocked(resolveTranscribeServices).mockResolvedValue([
      {
        service: { name: 'SenseVoice', baseURL: 'https://api.siliconflow.cn/v1', apiKeyEnv: 'K', model: 'FunAudioLLM/SenseVoiceSmall' },
        apiKey: 'sk-host',
      },
      {
        service: { name: 'TeleASR', baseURL: 'https://api.siliconflow.cn/v1', apiKeyEnv: 'K', model: 'TeleAI/TeleSpeechASR' },
        apiKey: 'sk-host',
      },
    ])
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const { status, body } = await call(server.port, 'mobile.voiceServices')
      expect(status).toBe(200)
      // The host API key NEVER leaves the host: the phone cannot use these
      // services directly (transcription rides the host channel), so only the
      // display facts are returned — no apiKey.
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { services: Array<{ name: string; baseURL: string; model: string }> } } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.services).toEqual([
        { name: 'SenseVoice', baseURL: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall' },
        { name: 'TeleASR', baseURL: 'https://api.siliconflow.cn/v1', model: 'TeleAI/TeleSpeechASR' },
      ])
    } finally {
      await server.close()
    }
  })

  it('answers an empty service list when the host has no fallback configured', async () => {
    vi.mocked(resolveTranscribeServices).mockResolvedValue(undefined)
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const { status, body } = await call(server.port, 'mobile.voiceServices')
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { services: unknown[] } } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.services).toEqual([])
    } finally {
      await server.close()
    }
  })
})

describe('mobile.readChat folded chat (v3)', () => {
  it('serves a folded page from the injected window service with the phone envelope', async () => {
    const page = {
      rows: [{ id: 'u-1', kind: 'user', text: '你好', seq: 0, time: 0 }],
      maxSeq: 7,
      hasMore: true,
      todo: { seq: 7, items: [{ content: '任务', status: 'pending' as const }] },
      projections: { asOfSeq: 7, values: { permissions: { currentValue: 'readonly' } } },
    }
    const windows = {
      tail: vi.fn(async () => page),
      before: vi.fn(),
    } as never
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend, chatWindows: windows }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.readChat', { sessionId: 's-1', maxRows: 25 })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { rpcId: string; result: { ok: boolean; value: unknown } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value).toEqual(page)
      expect(windows.tail).toHaveBeenCalledWith('s-1', 25)
      expect(windows.before).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('routes a beforeSeq read to the older-page path and clamps maxRows', async () => {
    const windows = {
      tail: vi.fn(async () => ({ rows: [], maxSeq: -1, hasMore: false })),
      before: vi.fn(async () => ({ rows: [], maxSeq: 10, hasMore: false })),
    } as never
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend, chatWindows: windows }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.readChat', { sessionId: 's-1', beforeSeq: 101, maxRows: 9999 })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { maxSeq: number } } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.maxSeq).toBe(10)
      expect(windows.before).toHaveBeenCalledWith('s-1', 101, 200)
      expect(windows.tail).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('answers unavailable when the window service is not wired (the phone falls back)', async () => {
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.readChat', { sessionId: 's-1' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; error: { code: string } } }
      expect(envelope.result.ok).toBe(false)
      expect(envelope.result.error.code).toBe('unavailable')
    } finally {
      await server.close()
    }
  })

  it('wraps a window-service failure as a stable internal error (no host detail leaks)', async () => {
    const windows = {
      tail: vi.fn(async () => { throw new Error('C:\\secret\\log path parse error') }),
      before: vi.fn(),
    } as never
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend, chatWindows: windows }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.readChat', { sessionId: 's-1' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; error: { code: string; message: string } } }
      expect(envelope.result.ok).toBe(false)
      expect(envelope.result.error.code).toBe('internal')
      expect(envelope.result.error.message).not.toContain('secret')
    } finally {
      await server.close()
    }
  })

  it('rejects a missing session id without touching the window service', async () => {
    const windows = {
      tail: vi.fn(),
      before: vi.fn(),
    } as never
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend, chatWindows: windows }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.readChat', {})
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; error: { code: string } } }
      expect(envelope.result.ok).toBe(false)
      expect(envelope.result.error.code).toBe('bad-request')
      expect(windows.tail).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('serves the open turn/start anchor (turn-clock, desktop parity) and keeps it live', async () => {
    const fetcher = vi.fn(async () => ({
      events: [
        { event: { type: 'turn/start', seq: 40, time: 400_000, data: {} } },
        { event: { type: 'user/message', seq: 41, time: 401_000, data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: 'hi' }] } } },
        { event: { type: 'assistant/message', seq: 42, time: 402_000, data: { turn: 0, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] } } } },
      ],
      hasMore: false,
    }))
    const windows = new ChatWindowService(fetcher as never)
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend, chatWindows: windows }))
    try {
      // Installed from the tail page: the open turn/start rides the page.
      const first = await callWith(server.port, 'mobile.readChat', { sessionId: 's-1', maxRows: 25 })
      const firstView = JSON.parse(first.body) as { result: { ok: boolean; value: { turnStartAt?: number } } }
      expect(firstView.result.ok).toBe(true)
      expect(firstView.result.value.turnStartAt).toBe(400_000)

      // A live turn/end clears the anchor; the next tail read omits it.
      windows.handleEvent('s-1', { type: 'turn/end', seq: 43, time: 403_000, data: {} })
      const second = await callWith(server.port, 'mobile.readChat', { sessionId: 's-1', maxRows: 25 })
      const secondView = JSON.parse(second.body) as { result: { ok: boolean; value: { turnStartAt?: number } } }
      expect(secondView.result.ok).toBe(true)
      expect('turnStartAt' in (secondView.result.value ?? {})).toBe(false)

      // A new turn/start re-anchors it at its own logged time.
      windows.handleEvent('s-1', { type: 'turn/start', seq: 44, time: 500_000, data: {} })
      const third = await callWith(server.port, 'mobile.readChat', { sessionId: 's-1', maxRows: 25 })
      const thirdView = JSON.parse(third.body) as { result: { ok: boolean; value: { turnStartAt?: number } } }
      expect(thirdView.result.value.turnStartAt).toBe(500_000)
    } finally {
      await server.close()
    }
  })
})

describe('mobile.previews batch previews (v3.1)', () => {
  it('serves the batch from the injected preview service with the phone envelope', async () => {
    const previewService = {
      previews: vi.fn(async (ids: readonly string[]) => ids.map(sessionId => ({ sessionId, summary: '摘要', updatedAt: 5 }))),
    } as never
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend, previews: previewService }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.previews', { sessionIds: ['s-1', 's-2'] })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { items: unknown[] } } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.items).toEqual([
        { sessionId: 's-1', summary: '摘要', updatedAt: 5 },
        { sessionId: 's-2', summary: '摘要', updatedAt: 5 },
      ])
      expect(previewService.previews).toHaveBeenCalledWith(['s-1', 's-2'])
    } finally {
      await server.close()
    }
  })

  it('answers an empty batch without touching the service', async () => {
    const previewService = { previews: vi.fn() } as never
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend, previews: previewService }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.previews', {})
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { items: unknown[] } } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.items).toEqual([])
      expect(previewService.previews).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('answers unavailable when the preview service is not wired (the phone falls back)', async () => {
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.previews', { sessionIds: ['s-1'] })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; error: { code: string } } }
      expect(envelope.result.ok).toBe(false)
      expect(envelope.result.error.code).toBe('unavailable')
    } finally {
      await server.close()
    }
  })

  it('wraps a service failure as a stable internal error (no host detail leaks)', async () => {
    const previewService = {
      previews: vi.fn(async () => { throw new Error('C:\\secret\\log path parse error') }),
    } as never
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend, previews: previewService }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.previews', { sessionIds: ['s-1'] })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; error: { code: string; message: string } } }
      expect(envelope.result.ok).toBe(false)
      expect(envelope.result.error.code).toBe('internal')
      expect(envelope.result.error.message).not.toContain('secret')
    } finally {
      await server.close()
    }
  })
})

describe('push.config (L3 channel credentials)', () => {
  it('round-trips a PushPlus token and redacts credentials on reads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-push-config-'))
    const store = new NotifyStore(join(dir, 'notify.json'))
    const engine = new NotifyEngine({
      events: { mux: () => (async function* () {})() },
      sessions: { list: async () => ({ result: { ok: true, value: { items: [] } } }) },
      workspace: { list: async () => ({ result: { ok: true, value: { items: [] } } }) },
    } as never, store)
    const server = await serve(makeMobileApiRoutes({
      service, apiProxy, mobileEnterToSend, notify: { store, engine },
    }))
    try {
      // Write a PushPlus token alongside empty legacy channels.
      const set = await callWith(server.port, 'push.config', {
        set: {
          channels: {
            serverchan: { sendKey: '' },
            bark: { key: '' },
            telegram: { botToken: '', chatId: '' },
            pushplus: { token: 'pp-spec-token' },
          },
        },
      })
      expect(set.status).toBe(200)

      // Read back: pushplus reports configured; credentials never ride the wire.
      const get = await callWith(server.port, 'push.config', { get: true })
      expect(get.status).toBe(200)
      const envelope = JSON.parse(get.body) as {
        result: { ok: boolean; value: { channels: Record<string, { configured: boolean }>; kinds: { jobs: boolean; todo: boolean; turns: boolean } } }
      }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.channels.pushplus).toEqual({ configured: true })
      expect(envelope.result.value.channels.serverchan).toEqual({ configured: false })
      expect(JSON.stringify(get.body)).not.toContain('pp-spec-token')
      // Kind gates default to the quiet stance (jobs/turns off, todo on).
      expect(envelope.result.value.kinds).toEqual({ jobs: false, todo: true, turns: false })

      // Kind gates persist through a write.
      await callWith(server.port, 'push.config', {
        set: { kinds: { jobs: true, turns: true } },
      })
      const afterKinds = await callWith(server.port, 'push.config', { get: true })
      const kindsView = JSON.parse(afterKinds.body) as {
        result: { ok: boolean; value: { kinds: { jobs: boolean; todo: boolean; turns: boolean } } }
      }
      expect(kindsView.result.value.kinds).toEqual({ jobs: true, todo: true, turns: true })

      // Clearing the token removes the channel.
      await callWith(server.port, 'push.config', {
        set: { channels: { pushplus: { token: '' } } },
      })
      const afterClear = await callWith(server.port, 'push.config', { get: true })
      const cleared = JSON.parse(afterClear.body) as {
        result: { ok: boolean; value: { channels: Record<string, { configured: boolean }> } }
      }
      expect(cleared.result.value.channels.pushplus).toEqual({ configured: false })
    } finally {
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('mobile.readFile (in-chat file preview)', () => {
  it('reads a real UTF-8 text file back with its resolved path and name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-readfile-'))
    const file = join(dir, 'demo.ts')
    writeFileSync(file, 'const answer = 42\n', 'utf8')
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.readFile', { path: file })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as {
        type: string; result: { ok: boolean; value?: { path: string; name: string; text: string }; error?: { code: string } }
      }
      expect(envelope.type).toBe('server-response')
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value?.name).toBe('demo.ts')
      expect(envelope.result.value?.text).toBe('const answer = 42\n')
      // The host echoes the requested file (resolved to an absolute path).
      expect(envelope.result.value?.path).toContain('demo.ts')
      expect(envelope.result.value?.path.startsWith(dir)).toBe(true)
    } finally {
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a directory and a missing path without leaking host details', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-readfile-'))
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const dirCall = await callWith(server.port, 'mobile.readFile', { path: dir })
      const dirEnvelope = JSON.parse(dirCall.body) as { result: { ok: boolean; error: { code: string } } }
      // A directory is not a readable file: the multi-base resolver only
      // accepts regular files, so it reports unreadable (not a path leak).
      expect(dirEnvelope.result.ok).toBe(false)
      expect(dirEnvelope.result.error.code).toBe('file-unreadable')

      const missingCall = await callWith(server.port, 'mobile.readFile', { path: join(dir, 'nope.txt') })
      const missingEnvelope = JSON.parse(missingCall.body) as { result: { ok: boolean; error: { code: string; message: string } } }
      expect(missingEnvelope.result.ok).toBe(false)
      expect(missingEnvelope.result.error.code).toBe('file-unreadable')
      expect(missingEnvelope.result.error.message).not.toContain(dir)
    } finally {
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses binary content (NUL byte) and an empty path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-readfile-'))
    const bin = join(dir, 'blob.bin')
    writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02]))
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const binCall = await callWith(server.port, 'mobile.readFile', { path: bin })
      const binEnvelope = JSON.parse(binCall.body) as { result: { ok: boolean; error: { code: string } } }
      expect(binEnvelope.result.ok).toBe(false)
      expect(binEnvelope.result.error.code).toBe('not-text')

      const empty = await callWith(server.port, 'mobile.readFile', { path: '' })
      const emptyEnvelope = JSON.parse(empty.body) as { result: { ok: boolean; error: { code: string } } }
      expect(emptyEnvelope.result.ok).toBe(false)
      expect(emptyEnvelope.result.error.code).toBe('bad-request')
    } finally {
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses oversized files (>256 KiB)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-readfile-'))
    const big = join(dir, 'big.log')
    writeFileSync(big, 'x'.repeat(256 * 1024 + 1), 'utf8')
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const { body } = await callWith(server.port, 'mobile.readFile', { path: big })
      const envelope = JSON.parse(body) as { result: { ok: boolean; error: { code: string } } }
      expect(envelope.result.ok).toBe(false)
      expect(envelope.result.error.code).toBe('file-too-large')
    } finally {
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves a relative path against the owning session cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-readfile-'))
    const file = join(dir, 'demo.ts')
    writeFileSync(file, 'const x = 1\n', 'utf8')
    const withCwd = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({
          rpcId: 'r', result: { ok: true, value: { items: [{ sessionId: 's-cwd-1', cwd: dir }], hasMore: false } },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: withCwd, mobileEnterToSend }))
    try {
      // Absolute paths still work without a session lookup.
      const absolute = await callWith(server.port, 'mobile.readFile', { path: file })
      const absEnvelope = JSON.parse(absolute.body) as { result: { ok: boolean; value?: { name: string; text: string } } }
      expect(absEnvelope.result.ok).toBe(true)
      expect(absEnvelope.result.value?.name).toBe('demo.ts')

      // A relative path + sessionId resolves under that session's cwd.
      const relative = await callWith(server.port, 'mobile.readFile', { path: 'demo.ts', sessionId: 's-cwd-1' })
      const relEnvelope = JSON.parse(relative.body) as { result: { ok: boolean; value?: { path: string; text: string } } }
      expect(relEnvelope.result.ok).toBe(true)
      expect(relEnvelope.result.value?.text).toBe('const x = 1\n')
      expect(relEnvelope.result.value?.path.startsWith(dir)).toBe(true)
    } finally {
      await server.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves a relative path from an absolute mention in the chat window', async () => {
    // The session's cwd does NOT contain the file; the chat window's rows
    // mention it absolutely (as an agent editing a checkout would).
    const other = mkdtempSync(join(tmpdir(), 'dsh-palm-readfile-empty-'))
    const repo = mkdtempSync(join(tmpdir(), 'dsh-palm-readfile-repo-'))
    const sub = join(repo, 'packages', 'dsh-palm')
    const src = join(sub, 'src')
    const { mkdirSync } = require('node:fs') as typeof import('node:fs')
    mkdirSync(src, { recursive: true })
    const file = join(src, 'mux.ts')
    writeFileSync(file, 'export const mux = true\n', 'utf8')
    const withEmptyCwd = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({
          rpcId: 'r', result: { ok: true, value: { items: [{ sessionId: 's-ws-1', cwd: other }], hasMore: false } },
        }),
      },
    } as unknown as ApiProxy
    // A fake chat window whose assistant row prints the file's absolute path.
    const windowRows = {
      tail: async () => ({
        rows: [{ kind: 'assistant', text: `改动在 ${file}` }],
        maxSeq: 1, hasMore: false,
      }),
    } as unknown as ChatWindowService
    const server = await serve(makeMobileApiRoutes({
      service, apiProxy: withEmptyCwd, mobileEnterToSend, chatWindows: windowRows,
    }))
    try {
      const relative = await callWith(server.port, 'mobile.readFile', { path: 'packages/dsh-palm/src/mux.ts', sessionId: 's-ws-1' })
      const envelope = JSON.parse(relative.body) as { result: { ok: boolean; value?: { path: string; text: string }; error?: { code: string } } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value?.text).toBe('export const mux = true\n')
      expect(envelope.result.value?.path).toBe(file)
    } finally {
      await server.close()
      rmSync(other, { recursive: true, force: true })
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

describe('mobile.usage (per-provider usage/balance)', () => {
  /** Stub global fetch so the balance adapter never leaves the machine. */
  function stubBalanceFetch(): typeof globalThis.fetch {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '12.00', granted_balance: '0.00', topped_up_balance: '12.00' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })) as never
    return original
  }

  it('resolves the llm-deepseek credential ref (default DEEPSEEK_API_KEY) into a balance row', async () => {
    const originalFetch = stubBalanceFetch()
    const resolved: string[] = []
    const usageProxy = {
      ...apiProxy,
      settings: {
        ...apiProxy.settings,
        describe: async () => ({
          rpcId: 'r',
          result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [
            { ns: 'llm-deepseek', value: { baseURL: 'https://api.deepseek.com' } },
          ] } },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({
      service, apiProxy: usageProxy, mobileEnterToSend,
      resolveKey: async (refName: string) => { resolved.push(refName); return 'sk-test' },
    }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.usage', { refresh: true })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as {
        result: { ok: boolean; value: { providers: Array<Record<string, unknown>> } }
      }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.providers).toEqual([
        {
          name: 'DeepSeek 官方',
          baseURL: 'https://api.deepseek.com',
          kind: 'balance',
          status: 'ok',
          balance: '12.00 CNY',
          fetchedAt: expect.any(Number),
        },
      ])
      // The phone's key resolution went through the host credentials service
      // under the dedicated gateway's documented default ref.
      expect(resolved).toEqual(['DEEPSEEK_API_KEY'])
    } finally {
      globalThis.fetch = originalFetch
      await server.close()
    }
  })

  it('honours a custom llm-deepseek apiKeyEnv ref', async () => {
    const originalFetch = stubBalanceFetch()
    const resolved: string[] = []
    const usageProxy = {
      ...apiProxy,
      settings: {
        ...apiProxy.settings,
        describe: async () => ({
          rpcId: 'r',
          result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [
            { ns: 'llm-deepseek', value: { models: [{ id: 'deepseek-v4-flash:0731' }], apiKeyEnv: 'MY_DEEPSEEK_KEY' } },
          ] } },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({
      service, apiProxy: usageProxy, mobileEnterToSend,
      resolveKey: async (refName: string) => { resolved.push(refName); return 'sk-test' },
    }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.usage', { refresh: true })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as {
        result: { ok: boolean; value: { providers: Array<Record<string, unknown>> } }
      }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.providers[0]?.status).toBe('ok')
      expect(resolved).toEqual(['MY_DEEPSEEK_KEY'])
    } finally {
      globalThis.fetch = originalFetch
      await server.close()
    }
  })
})

describe('mobile.searchMessages (lazy message-level locate)', () => {
  it('locates visible message hits inside one ordinary session', async () => {
    const fetcher = vi.fn(async () => ({
      events: [
        { event: { type: 'user/message', seq: 10, time: 10_000, data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: '帮我修好 支付专项 的 bug' }] } } },
        { event: { type: 'assistant/message', seq: 11, time: 11_000, data: { turn: 0, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '正在处理 支付专项 问题' }] } } } },
      ],
      hasMore: false,
    }))
    const ordinaryProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [{ sessionId: 's-1', updatedAt: 1 }], hasMore: false } } }),
        history: async () => ({ rpcId: 'r', result: { ok: true, value: await fetcher() } }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: ordinaryProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.searchMessages', { sessionId: 's-1', query: '支付专项' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { items: Array<{ seq: number; snippet: string }> } } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.items.map(item => item.seq)).toEqual([10, 11])
      expect(envelope.result.value.items[0]?.snippet).toContain('支付专项')
      expect(envelope.result.value.items[1]?.snippet).toContain('支付专项')
    } finally {
      await server.close()
    }
  })

  it('rejects an empty session id or query', async () => {
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      for (const payload of [{ sessionId: '', query: 'x' }, { sessionId: 's-1', query: '  ' }, {}]) {
        const { status, body } = await callWith(server.port, 'mobile.searchMessages', payload)
        expect(status).toBe(200)
        const envelope = JSON.parse(body) as { result: { ok: boolean; error: { code: string } } }
        expect(envelope.result.ok).toBe(false)
        expect(envelope.result.error.code).toBe('bad-request')
      }
    } finally {
      await server.close()
    }
  })
})

describe('mobile.searchAll (global search with attribution)', () => {
  it('attributes hits to the owning workspace from workspace.list', async () => {
    const locateProxy = {
      ...apiProxy,
      workspace: {
        ...apiProxy.workspace,
        list: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: { items: [{ workspaceId: 'w-1', sessionIds: ['s-hit', 's-other'] }] },
          },
        }),
      },
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              items: [
                { sessionId: 's-hit', updatedAt: 0, running: false, blank: false, projections: { values: { title: '支付专项' } } },
              ],
            },
          },
        }),
        search: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: { items: [{ sessionId: 's-hit', snippet: '支付片段' }], hasMore: false },
          },
        }),
        // The FTS hit must also be present in the session's SEARCHABLE text
        // (a user message here) or the searchable-text filter drops it.
        history: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              events: [{ event: { type: 'user/message', seq: 10, time: 10_000, data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: '支付专项 的回调' }] } } }],
              hasMore: false,
            },
          },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: locateProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.searchAll', { query: '支付' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as {
        result: { ok: boolean; value: { items: Array<{ sessionId: string; snippet: string; title?: string; workspaceId?: string }> } }
      }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.items).toEqual([
        { kind: 'title', sessionId: 's-hit', snippet: '支付专项', title: '支付专项', workspaceId: 'w-1' },
        { kind: 'message', sessionId: 's-hit', snippet: '支付专项 的回调', seq: 10, messageId: 'u-1', title: '支付专项', workspaceId: 'w-1' },
      ])
    } finally {
      await server.close()
    }
  })

  it('answers bad-request for an empty query', async () => {
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.searchAll', { query: '  ' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; error: { code: string } } }
      expect(envelope.result.ok).toBe(false)
      expect(envelope.result.error.code).toBe('bad-request')
    } finally {
      await server.close()
    }
  })

  it('attributes hits by cwd prefix when the session is not explicitly attached', async () => {
    // A session created under a workspace directory but not in its
    // sessionIds: longest-prefix cwd attribution recovers the owner and its
    // title, so the phone never labels it 未分组.
    const cwdProxy = {
      ...apiProxy,
      workspace: {
        ...apiProxy.workspace,
        list: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              items: [
                { workspaceId: 'w-1', path: '/home/alice/work/dsh-palm', title: 'dsh-palm', sessionIds: [] },
                { workspaceId: 'w-2', path: '/home/alice/work/other', title: 'other', sessionIds: [] },
              ],
            },
          },
        }),
      },
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              items: [
                { sessionId: 's-1', updatedAt: 0, running: false, blank: false, cwd: '/home/alice/work/dsh-palm/packages/dsh-palm' },
              ],
            },
          },
        }),
        search: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: { items: [{ sessionId: 's-1', snippet: '支付片段' }], hasMore: false },
          },
        }),
        // The FTS hit must also be present in the session's SEARCHABLE text
        // (a user message here) or the searchable-text filter drops it.
        history: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              events: [{ event: { type: 'user/message', seq: 10, time: 10_000, data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: '支付回调 的片段' }] } } }],
              hasMore: false,
            },
          },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: cwdProxy, mobileEnterToSend }))
    // A distinct query: the module-level searchAll cache is keyed by query.
    // The module-level locateSessionMeta cache is also keyed by time (60s),
    // so advance the clock past it to force a fresh attribution build.
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 61_000)
    try {
      const { status, body } = await callWith(server.port, 'mobile.searchAll', { query: '支付回调' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as {
        result: { ok: boolean; value: { items: Array<{ sessionId: string; workspaceId?: string; workspaceTitle?: string }> } }
      }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.items[0]).toMatchObject({
        sessionId: 's-1',
        workspaceId: 'w-1',
        workspaceTitle: 'dsh-palm',
      })
    } finally {
      vi.useRealTimers()
      await server.close()
    }
  })

  it('verifies FTS token hits against history and returns a locatable seq', async () => {
    // FTS is only a candidate source. The list must return a hit only after
    // the same visible-text document used by searchMessages confirms it.
    const history = vi.fn(async () => ({
      rpcId: 'r',
      result: { ok: true, value: { events: [{ event: { type: 'user/message', seq: 10, time: 10_000, data: { id: 'u-t', role: 'user', content: [{ type: 'text', text: 'token命中片段' }] } } }], hasMore: false } },
    }))
    const fastProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [{ sessionId: 's-t', updatedAt: 1 }] } } }),
        search: async () => ({
          rpcId: 'r',
          result: { ok: true, value: { items: [{ sessionId: 's-t', snippet: 'token命中片段' }], hasMore: false } },
        }),
        history,
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: fastProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.searchAll', { query: 'token命中' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { items: Array<{ sessionId: string; seq?: number; snippet: string }> } } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.items[0]).toMatchObject({
        kind: 'message',
        sessionId: 's-t',
        seq: 10,
        snippet: 'token命中片段',
      })
      expect(history).toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('drops FTS hits whose term is only in a tool call, reasoning, or code block', async () => {
    // The host FTS index also matches tool-call arguments, tool results, and
    // code fences. A hit whose term is NOT in the session's SEARCHABLE text
    // (user message / assistant reply body) must not surface — it would open
    // a chat where the term is not visible.
    const toolOnlyProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [] } } }),
        search: async () => ({
          rpcId: 'r',
          result: { ok: true, value: { items: [{ sessionId: 's-tool', snippet: 'toolonly 在工具参数里' }], hasMore: false } },
        }),
        history: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              events: [
                // Term only in a tool-call argument.
                { event: { type: 'tool/call', seq: 5, time: 10_000, data: { turn: 1, step: 1, callId: 'c-1', name: 'bash', arguments: '{"cmd":"echo toolonly"}' } } },
                // Term only in a reasoning (thinking) block.
                { event: { type: 'assistant/message', seq: 6, time: 11_000, data: { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'toolonly 思考链' }] } } } },
                // Term only inside a fenced code block.
                { event: { type: 'assistant/message', seq: 7, time: 12_000, data: { turn: 1, step: 3, message: { role: 'assistant', content: [{ type: 'text', text: '```\ntoolonly\n```' }] } } } },
              ],
              hasMore: false,
            },
          },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: toolOnlyProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.searchAll', { query: 'toolonly' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { items: Array<{ sessionId: string }> } } }
      expect(envelope.result.ok).toBe(true)
      // None of the three excluded surfaces is searchable, so the hit is
      // filtered out entirely.
      expect(envelope.result.value.items).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('carries stable messageId/partId on an assistant flow message hit', async () => {
    // A workspace-search hit must forward the stable folded-message identity
    // (messageId + partId) so ChatView can locate by identity instead of the
    // coalescing-shifted seq. Dropping these re-introduces the "sometimes
    // lands on the wrong message" failure.
    const flowProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [{ sessionId: 's-flow', updatedAt: 2 }], hasMore: false } } }),
        search: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [{ sessionId: 's-flow', snippet: '支付专项 的回调' }], hasMore: false } } }),
        history: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              events: [
                { event: { type: 'assistant/message', seq: 10, time: 10_000, data: { turn: 1, step: 1, message: { id: 'a-flow', role: 'assistant', content: [{ type: 'text', text: '支付专项 的回调结果如下' }] } } } },
              ],
              hasMore: false,
            },
          },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: flowProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.searchAll', { query: '支付专项' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { items: Array<Record<string, unknown>> } } }
      expect(envelope.result.ok).toBe(true)
      const messageHit = envelope.result.value.items.find(item => item.kind === 'message')
      expect(messageHit).toMatchObject({ sessionId: 's-flow', messageId: expect.any(String) })
      // Part id is present only when the folded part carries one; both are
      // optional, but the ROW identity must survive to the hit.
      expect(messageHit?.partId === undefined || typeof messageHit.partId === 'string').toBe(true)
    } finally {
      await server.close()
    }
  })

  it('drops an FTS hit that cannot be verified and located in visible text', async () => {
    // Raw FTS snippets may come from tools, hidden reasoning, code, or stale
    // index content. A result without a canonical visible-text match and seq
    // must not be shown because tapping it cannot reveal the searched word.
    const deepProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [] } } }),
        search: async () => ({
          rpcId: 'r',
          result: { ok: true, value: { items: [{ sessionId: 's-deep', snippet: 'deepterm 在更早的正文里' }], hasMore: false } },
        }),
        history: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              // The scanned pages carry no trace of the term (neither in
              // searchable text nor in excluded content) — it is deeper.
              events: [
                { event: { type: 'user/message', seq: 5, time: 10_000, data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: '无关内容' }] } } },
                { event: { type: 'assistant/message', seq: 6, time: 11_000, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '无关回复' }] } } } },
              ],
              hasMore: false,
            },
          },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: deepProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.searchAll', { query: 'deepterm' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { items: Array<{ sessionId: string; seq?: number }> } } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.items).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('fails closed when the ordinary-session roster cannot be classified', async () => {
    const unavailableProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({ rpcId: 'r', result: { ok: false as const, error: { code: 'unavailable', message: 'offline' } } }),
        search: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [{ sessionId: 's-sub', snippet: '不应泄漏' }], hasMore: false } } }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: unavailableProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.searchAll', { query: '不应泄漏' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; error?: { code: string } } }
      expect(envelope.result.ok).toBe(false)
      expect(envelope.result.error?.code).toBe('internal')
    } finally {
      await server.close()
    }
  })

  it('finds a normal session by title without reading its history', async () => {
    const titleProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({
          rpcId: 'r',
          result: { ok: true, value: { items: [{ sessionId: 's-title', updatedAt: 7, projections: { values: { title: '支付专项复盘' } } }], hasMore: false } },
        }),
        search: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [], hasMore: false } } }),
        history: vi.fn(async () => ({ rpcId: 'r', result: { ok: true, value: { events: [], hasMore: false } } })),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: titleProxy, mobileEnterToSend }))
    try {
      const { body } = await callWith(server.port, 'mobile.searchAll', { query: '专项复盘' })
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { items: Array<Record<string, unknown>> } } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.items).toEqual([
        expect.objectContaining({ kind: 'title', sessionId: 's-title', title: '支付专项复盘' }),
      ])
      expect(titleProxy.sessions.history).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })

  it('does not locate command cards, injected messages, inline think, or incomplete code fences', async () => {
    const hiddenProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [{ sessionId: 's-hidden', updatedAt: 8 }], hasMore: false } } }),
        search: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [{ sessionId: 's-hidden', snippet: 'hiddenneedle' }], hasMore: false } } }),
        history: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              events: [
                { event: { type: 'command/run', seq: 1, time: 1, data: { id: 'cmd', name: 'hiddenneedle', args: '' } } },
                { event: { type: 'user/message', seq: 2, time: 2, data: { id: 'injected', role: 'user', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'hiddenneedle' }] } } },
                { event: { type: 'assistant/message', seq: 3, time: 3, data: { turn: 0, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '<think>hiddenneedle</think>公开回答' }] } } } },
                { event: { type: 'assistant/message', seq: 4, time: 4, data: { turn: 0, step: 1, message: { id: 'a-2', role: 'assistant', content: [{ type: 'text', text: '```ts\nhiddenneedle' }] } } } },
              ],
              hasMore: false,
            },
          },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: hiddenProxy, mobileEnterToSend }))
    try {
      const locate = await callWith(server.port, 'mobile.searchMessages', { sessionId: 's-hidden', query: 'hiddenneedle' })
      const envelope = JSON.parse(locate.body) as { result: { value: { items: unknown[] } } }
      expect(envelope.result.value.items).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('excludes subagent sessions from search results', async () => {
    // Subagent sessions (origin: 'subagent') are internal working sessions,
    // not user conversations — they must not surface in search, matching the
    // roster filter. A normal session with the term still shows.
    const subagentProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              items: [
                { sessionId: 's-sub', origin: 'subagent' },
                { sessionId: 's-main', origin: 'main' },
              ],
            },
          },
        }),
        search: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              items: [
                { sessionId: 's-sub', snippet: 'subterm 在子代理会话里' },
                { sessionId: 's-main', snippet: 'subterm 在主会话里' },
              ],
              hasMore: false,
            },
          },
        }),
        history: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              events: [
                { event: { type: 'user/message', seq: 5, time: 10_000, data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: 'subterm 正文' }] } } },
              ],
              hasMore: false,
            },
          },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: subagentProxy, mobileEnterToSend }))
    try {
      const { status, body } = await callWith(server.port, 'mobile.searchAll', { query: 'subterm' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as { result: { ok: boolean; value: { items: Array<{ sessionId: string }> } } }
      expect(envelope.result.ok).toBe(true)
      expect(envelope.result.value.items.map(item => item.sessionId)).toEqual(['s-main'])
    } finally {
      await server.close()
    }
  })

  it('backfills CJK substring hits when the token search answers nothing', async () => {
    // The FTS token index cannot match 支付 inside 支付专项 (contiguous CJK
    // is one token), so the token search returns zero — the substring
    // backfill must find the session in its history tail.
    const backfillProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        search: async () => ({
          rpcId: 'r',
          result: { ok: true, value: { items: [], hasMore: false } },
        }),
        list: async () => ({
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              items: [
                { sessionId: 's-1', updatedAt: 3, running: false, blank: false },
                { sessionId: 's-2', updatedAt: 2, running: false, blank: false },
              ],
            },
          },
        }),
        history: vi.fn(async (request: unknown) => {
          const id = (request as { payload?: { sessionId?: string } }).payload?.sessionId
          return {
            rpcId: 'r',
            result: {
              ok: true,
              value: {
                events: id === 's-1'
                  ? [{ event: { type: 'user/message', seq: 10, time: 10_000, data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: '修一下 支付专项 的回调' }] } } }]
                  : [],
                hasMore: false,
              },
            },
          }
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: backfillProxy, mobileEnterToSend }))
    try {
      // A distinct query: the module-level searchAll cache is keyed by query
      // and earlier cases already searched 支付.
      const { status, body } = await callWith(server.port, 'mobile.searchAll', { query: '支付专项' })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as {
        result: { ok: boolean; value: { items: Array<{ sessionId: string; snippet: string }> } }
      }
      expect(envelope.result.ok).toBe(true)
      // s-1 matches the substring in its tail (with its first message seq,
      // so tapping can open scrolled to it with zero extra RPC); s-2 does not.
      expect(envelope.result.value.items).toEqual([
        expect.objectContaining({ sessionId: 's-1', snippet: expect.stringContaining('支付专项'), seq: 10 }),
      ])

      // The backfill pre-warmed the message-locate cache: a follow-up
      // mobile.searchMessages for the same session+query answers instantly
      // from the cache (no extra history read).
      const historyMock = backfillProxy.sessions.history as ReturnType<typeof vi.fn>
      const historyCalls = historyMock.mock.calls.length
      const locate = await callWith(server.port, 'mobile.searchMessages', { sessionId: 's-1', query: '支付专项' })
      const locateView = JSON.parse(locate.body) as { result: { ok: boolean; value: { items: Array<{ seq: number }> } } }
      expect(locateView.result.ok).toBe(true)
      expect(locateView.result.value.items[0]?.seq).toBe(10)
      expect(historyMock.mock.calls.length).toBe(historyCalls)
    } finally {
      await server.close()
    }
  })

  it('reuses one folded search document across different queries for the same session', async () => {
    const history = vi.fn(async () => ({
      rpcId: 'r',
      result: {
        ok: true,
        value: {
          events: [{ event: { type: 'user/message', seq: 10, time: 10_000, data: { id: 'u-1', role: 'user', content: [{ type: 'text', text: '支付专项回调' }] } } }],
          hasMore: false,
        },
      },
    }))
    const cacheProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [{ sessionId: 's-cache', updatedAt: 99, running: false, blank: false }] } } }),
        search: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [], hasMore: false } } }),
        history,
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: cacheProxy, mobileEnterToSend }))
    try {
      const first = await callWith(server.port, 'mobile.searchAll', { query: '支付' })
      const second = await callWith(server.port, 'mobile.searchAll', { query: '回调' })
      expect(JSON.parse(first.body).result.value.items[0]).toMatchObject({ sessionId: 's-cache', seq: 10 })
      expect(JSON.parse(second.body).result.value.items[0]).toMatchObject({ sessionId: 's-cache', seq: 10 })
      expect(history).toHaveBeenCalledTimes(1)
    } finally {
      await server.close()
    }
  })

  it('flags a partial scan when the roster has more pages than the backfill window', async () => {
    // The substring backfill only scans the first page of the roster. When
    // the roster has more pages (hasMore) the scan is partial even if FTS
    // hits excluded some candidates — the phone must be told so an empty
    // result is not read as "not on host".
    const roster = Array.from({ length: 24 }, (_, i) => ({
      sessionId: `s-${i}`, updatedAt: 24 - i, running: false, blank: false,
    }))
    const partialProxy = {
      ...apiProxy,
      sessions: {
        ...apiProxy.sessions,
        search: async () => ({
          rpcId: 'r',
          result: { ok: true, value: { items: [{ sessionId: 's-0', snippet: '命中' }], hasMore: false } },
        }),
        list: async () => ({
          rpcId: 'r',
          result: { ok: true, value: { items: roster, hasMore: true } },
        }),
        history: async () => ({
          rpcId: 'r',
          result: { ok: true, value: { events: [], hasMore: false } },
        }),
      },
    } as unknown as ApiProxy
    const server = await serve(makeMobileApiRoutes({ service, apiProxy: partialProxy, mobileEnterToSend }))
    try {
      const query = '部分扫描'
      const { status, body } = await callWith(server.port, 'mobile.searchAll', { query })
      expect(status).toBe(200)
      const envelope = JSON.parse(body) as {
        result: { ok: boolean; value: { items: Array<{ sessionId: string }>; partial?: boolean } }
      }
      expect(envelope.result.ok).toBe(true)
      // The FTS hit (s-0) is excluded from the backfill, so only 23 of the 24
      // first-page sessions are scanned, and hasMore means more pages exist —
      // the scan is partial.
      expect(envelope.result.value.partial).toBe(true)
      // The 60s whole-search cache must preserve the partial flag: a repeat
      // search (cache hit) still tells the phone the scan was partial.
      const cached = await callWith(server.port, 'mobile.searchAll', { query })
      const cachedView = JSON.parse(cached.body) as {
        result: { ok: boolean; value: { items: Array<{ sessionId: string }>; partial?: boolean } }
      }
      expect(cachedView.result.value.partial).toBe(true)
    } finally {
      await server.close()
    }
  })
})

