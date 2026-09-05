import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLatestVersion, isNewerVersion } from './latest-version.ts'

const fetchMock = vi.fn<typeof fetch>()

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchLatestVersion', () => {
  it('returns the registry latest dist-tag on a 200', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ version: '0.7.3' }),
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchLatestVersion('@eternalloveone/dsh-palm')).toBe('0.7.3')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://registry.npmjs.org/@eternalloveone%2Fdsh-palm/latest')
    expect((init as { headers: Record<string, string> }).headers.accept).toBe('application/json')
  })

  it('returns undefined on a non-200 or a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchLatestVersion('x')).toBeUndefined()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 } as Response)
    expect(await fetchLatestVersion('x')).toBeUndefined()
  })
})

describe('isNewerVersion', () => {
  it('compares dotted numeric versions', () => {
    expect(isNewerVersion('0.7.3', '0.7.2')).toBe(true)
    expect(isNewerVersion('0.7.2', '0.7.3')).toBe(false)
    expect(isNewerVersion('0.7.2', '0.7.2')).toBe(false)
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true)
    expect(isNewerVersion('0.8', '0.7.3')).toBe(true)
  })
})
