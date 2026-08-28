/**
 * SDK contract pins: the remote desktop channel mirrors two client-connection
 * internals (the loopback-only method set, the /api transport paths and
 * envelope type strings). If a future SDK release changes either, this test
 * fails before the channel silently drifts open or breaks.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { LOOPBACK_ONLY_METHODS, REMOTE_API_PATHS } from '../src/remote-methods.ts'

const require = createRequire(import.meta.url)
const dist = readFileSync(require.resolve('@deepseek-ai/dsh-client-connection'), 'utf8')
const clientDist = readFileSync(require.resolve('@deepseek-ai/dsh-client-connection/client'), 'utf8')
const apiproxyDist = readFileSync(require.resolve('@deepseek-ai/dsh-host-apiproxy'), 'utf8')

/** The privileged set exactly as the installed SDK spells it. */
function installedPrivilegedMethods(): string[] {
  const match = dist.match(/PRIVILEGED_METHODS = new Set\(\[([\s\S]*?)\]\)/)
  if (match === null) throw new Error('PRIVILEGED_METHODS not found in the installed client-connection dist')
  return [...match[1].matchAll(/"([^"]+)"/g)].map(hit => hit[1])
}

describe('client-connection contract pins (rc line)', () => {
  it('the loopback-only method set matches the installed SDK exactly', () => {
    expect([...LOOPBACK_ONLY_METHODS].sort()).toEqual(installedPrivilegedMethods().sort())
  })

  it('the browser event streams still live at /api/events.{mux,host}', () => {
    // The connection dist composes the paths from API_PATH; the client half
    // mounts the same two downlink paths against the page origin.
    expect(dist).toContain('API_PATH = "/api"')
    expect(dist).toContain('${API_PATH}/events.mux')
    expect(dist).toContain('${API_PATH}/events.host')
    expect(clientDist).toContain('${API_PATH}/events')
    expect(REMOTE_API_PATHS.mux).toBe('/remote/api/events.mux')
    expect(REMOTE_API_PATHS.host).toBe('/remote/api/events.host')
  })

  it('the unary envelope still uses the client-request/server-response pair', () => {
    // The envelope schema lives in the apiproxy package (the carrier both
    // halves share); the literals pin the wire vocabulary.
    expect(apiproxyDist).toContain('"client-request"')
    expect(apiproxyDist).toContain('"server-response"')
  })

  it('the browser client still issues unary calls as POST /api/<method>', () => {
    expect(clientDist).toContain('`/api/${method}`')
    // The browser carrier resolves the WebSocket downlinks against the page
    // origin with the two fixed /api paths (the rewrite surface).
    expect(clientDist).toContain('new WebSocket(url)')
  })
})

describe('mux SSE frame contract pins (rc line)', () => {
  const eventsDist = readFileSync(require.resolve('@deepseek-ai/dsh-host-apiproxy/api/events.schema'), 'utf8')
  const rpcDist = readFileSync(require.resolve('@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'), 'utf8')
  const sessionsDist = readFileSync(require.resolve('@deepseek-ai/dsh-host-apiproxy/api/sessions.schema'), 'utf8')

  it('the mux frame union still discriminates on session/queue and session/event', () => {
    // The /m/api/events.mux stream carries these two frame kinds; a renamed
    // discriminator would silently desynchronize the mobile client's parse.
    expect(eventsDist).toContain("z.literal('session/queue')")
    expect(eventsDist).toContain("z.literal('session/event')")
    expect(eventsDist).toContain("discriminatedUnion('type')")
  })

  it('a session/event frame still carries a wide SessionEvent payload', () => {
    // Session events are a strict envelope with wide data — event types are
    // runtime values (user/message, assistant/chunk, assistant/message), not
    // schema enums, so the pin is the passthrough shape, not a type list.
    expect(eventsDist).toContain('sessionEventSchema')
    expect(sessionsDist).toContain('type: z.string()')
    expect(sessionsDist).toContain('data: z.unknown()')
  })

  it('the server-request envelope still carries rpcId + method + payload', () => {
    expect(rpcDist).toContain("z.literal('server-request')")
    expect(rpcDist).toContain('rpcId: rpcIdSchema')
    expect(rpcDist).toContain('method: z.string()')
    expect(rpcDist).toContain('payload: z.unknown()')
  })

  it('the mobile bridge still wraps mux frames in the server-request envelope', () => {
    // c3fd4cd: the bridge must emit the full envelope, or the client's
    // serverRequestSchema gate drops every frame and the phone falls back to
    // polling. Pin the exact wire literal so a refactor cannot regress it.
    const bridge = readFileSync(new URL('../src/mobile-api.ts', import.meta.url), 'utf8')
    expect(bridge).toContain("type: 'server-request' as const, rpcId: frame.rpcId, method: 'events.mux', payload: frame.payload")
  })

  it('the mobile client still validates the envelope, then the frame', () => {
    // A delivered frame proves the SSE channel is live; dropping either gate
    // would silently kill the stream (the pre-c3fd4cd bug: bare frames were
    // rejected by the envelope schema and the phone fell back to polling).
    const client = readFileSync(new URL('../src/mobile/mux.ts', import.meta.url), 'utf8')
    expect(client).toContain('serverRequestSchema.safeParse(parsed)')
    expect(client).toContain('muxFrameSchema.safeParse(envelope.data.payload)')
  })
})
