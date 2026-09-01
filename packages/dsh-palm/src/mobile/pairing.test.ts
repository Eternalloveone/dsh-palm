// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { acceptMobilePair, consumeMobilePairUrl, parseMobilePairInput } from './pairing.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('parseMobilePairInput', () => {
  it('recognizes a bare six-digit pairing code', () => {
    expect(parseMobilePairInput('482913')).toEqual({ code: '482913' })
  })

  it('recognizes a six-digit code with leading zeros', () => {
    expect(parseMobilePairInput('000123')).toEqual({ code: '000123' })
  })

  it('still parses a full pairing link with workspace', () => {
    expect(parseMobilePairInput('https://phone.example/m/?pair=tok-1&workspace=ws-7'))
      .toEqual({ token: 'tok-1', workspaceId: 'ws-7' })
  })

  it('still treats a bare non-numeric value as a raw token', () => {
    expect(parseMobilePairInput('tok-1')).toEqual({ token: 'tok-1' })
  })

  it('rejects empty input', () => {
    expect(parseMobilePairInput('')).toBeUndefined()
    expect(parseMobilePairInput('   ')).toBeUndefined()
  })
})

describe('acceptMobilePair', () => {
  it('sends a six-digit code as { code }', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const result = await acceptMobilePair('482913')
    expect(result).toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/pair/accept')
    expect(JSON.parse(String(init.body))).toEqual({ code: '482913' })
  })

  it('sends a token as { token }', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await acceptMobilePair('tok-1')
    const [, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ token: 'tok-1' })
  })

  it('maps a 404 to the invalid/expired message', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    expect(await acceptMobilePair('000000')).toEqual({ ok: false, message: '配对链接无效或已过期。' })
  })
})

describe('consumeMobilePairUrl', () => {
  it('accepts a ?code= deep link and lands on the mobile root', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const result = await consumeMobilePairUrl('https://server.example/m/?code=482913', fetch)
    expect(result).toEqual({ kind: 'accepted', path: '/m/' })
    const [, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ code: '482913' })
  })

  it('reports a failed ?code= deep link with the accept message', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    const result = await consumeMobilePairUrl('https://server.example/m/?code=000000', fetch)
    expect(result.kind).toBe('failed')
    if (result.kind === 'failed') expect(result.message).toContain('无效或已过期')
  })

  it('ignores URLs without pair or code parameters', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await consumeMobilePairUrl('https://server.example/m/', fetch)).toEqual({ kind: 'none' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
