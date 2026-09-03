/**
 * The /m data channel: every allowlisted unary method must answer with the
 * transport envelope the phone's callUnary requires
 * ({ type: 'server-response', rpcId, result }) — regressions here surface as
 * a dead "加载中…" mobile surface.
 */
import { createServer, request as httpRequest } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { makeMobileApiRoutes } from '../src/mobile-api.ts'
import { PendingTracker } from '../src/mobile-pending.ts'

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

