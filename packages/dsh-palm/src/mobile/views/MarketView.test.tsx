// @vitest-environment jsdom
/** MarketView: registry truncation hint when more than 300 plugins match. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MarketView } from './MarketView.tsx'

function makePlugin(index: number): { name: string; owner: string; url: string; category: string } {
  return { name: `plugin-${index}`, owner: 'owner', url: `https://example.com/${index}`, category: 'x' }
}

function stubFetch(plugins: unknown[]): void {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url === '/dsh-market/registry') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ registry: { count: plugins.length, plugins } }) })
    }
    if (url === '/dsh-market/installed') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ installed: {} }) })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MarketView truncation', () => {
  it('shows a hint when the registry is truncated to 300 plugins', async () => {
    stubFetch(Array.from({ length: 301 }, (_, index) => makePlugin(index)))
    render(<MarketView onBack={() => {}} />)
    expect(await screen.findByText(/仅显示前 300 个插件/)).toBeTruthy()
  })

  it('does not show the truncation hint when 300 or fewer plugins match', async () => {
    stubFetch(Array.from({ length: 3 }, (_, index) => makePlugin(index)))
    render(<MarketView onBack={() => {}} />)
    expect(await screen.findByText('plugin-0')).toBeTruthy()
    expect(screen.queryByText(/仅显示前 300 个插件/)).toBeNull()
  })
})
