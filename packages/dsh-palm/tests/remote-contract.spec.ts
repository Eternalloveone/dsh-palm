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
const apiproxyDist = readFileSync(require.resolve('@deepseek-ai/dsh-host-apiproxy'), 'utf8')

describe('client-connection contract pins (rc line)', () => {
  it('the loopback-only method set is the pinned host-configuration surface', () => {
    // 0.1.5-rc.1 removed the SDK's PRIVILEGED_METHODS export; dsh-palm's
    // adapter keeps the old loopback-only stance for the configuration plane.
    expect([...LOOPBACK_ONLY_METHODS].sort()).toEqual([
      'agentPreset.copy',
      'agentPreset.openDocument',
      'agentPreset.read',
      'agentPreset.remove',
      'credentials.describe',
      'credentials.set',
      'credentials.unset',
      'host.openPath',
      'host.pickDirectory',
      'llm.discoverModels',
      'settings.describe',
      'settings.mutate',
      'settings.openDocument',
      'settings.replace',
      'settings.update',
    ])
  })

  it('the browser event streams still live at /api/events.{mux,host}', () => {
    // The remote channel keeps the legacy /remote/api/events.{mux,host} paths
    // (the adapter mirrors the old apiProxy surface), independent of the
    // 0.1.5-rc.1 SDK's own transport paths.
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
    // The phone-side bridge posts unary calls to the legacy /m/api/<method>
    // surface (see mobile-api.ts), which the adapter serves.
    const bridge = readFileSync(new URL('../src/mobile-api.ts', import.meta.url), 'utf8')
    expect(bridge).toContain('/m/api/')
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
