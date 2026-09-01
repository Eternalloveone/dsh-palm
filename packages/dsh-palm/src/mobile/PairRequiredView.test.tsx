// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PairRequiredView, originOf } from './PairRequiredView.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('originOf', () => {
  it('extracts the origin of a URL', () => {
    expect(originOf('https://a.example.com/m/?pair=x')).toBe('https://a.example.com')
    expect(originOf('http://192.168.1.5:7001')).toBe('http://192.168.1.5:7001')
  })

  it('returns undefined for malformed input', () => {
    expect(originOf('not a url')).toBeUndefined()
    expect(originOf('')).toBeUndefined()
  })
})

describe('PairRequiredView', () => {
  it('accepts a pasted link in the installed app context', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const onPaired = vi.fn()
    render(<PairRequiredView onPaired={onPaired} />)

    fireEvent.change(screen.getByLabelText('配对链接或配对码'), { target: { value: `${window.location.origin}/m/?pair=tok-1&workspace=ws-7` } })
    fireEvent.click(screen.getByRole('button', { name: '配对' }))

    await waitFor(() => expect(onPaired).toHaveBeenCalledWith('/m/?workspace=ws-7'))
  })

  it('accepts a six-digit pairing code', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const onPaired = vi.fn()
    render(<PairRequiredView onPaired={onPaired} />)

    fireEvent.change(screen.getByLabelText('配对链接或配对码'), { target: { value: '482913' } })
    fireEvent.click(screen.getByRole('button', { name: '配对' }))

    await waitFor(() => expect(onPaired).toHaveBeenCalledWith('/m/'))
    const [, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ code: '482913' })
  })

  it('follows a pasted link that points at another origin', () => {
    const navigate = vi.fn()
    render(<PairRequiredView onPaired={vi.fn()} navigate={navigate} />)

    fireEvent.change(screen.getByLabelText('配对链接或配对码'), { target: { value: 'https://other.example.com/m/?pair=tok-9&workspace=ws-1' } })
    fireEvent.click(screen.getByRole('button', { name: '配对' }))

    expect(navigate).toHaveBeenCalledWith('https://other.example.com/m/?pair=tok-9&workspace=ws-1')
  })

  it('deep-links a code to a switched server address', () => {
    const navigate = vi.fn()
    render(<PairRequiredView onPaired={vi.fn()} navigate={navigate} />)

    fireEvent.change(screen.getByLabelText('服务器地址'), { target: { value: 'https://tunnel.example.com' } })
    fireEvent.change(screen.getByLabelText('配对链接或配对码'), { target: { value: '482913' } })
    fireEvent.click(screen.getByRole('button', { name: '配对' }))

    expect(navigate).toHaveBeenCalledWith('https://tunnel.example.com/m/?code=482913')
  })

  it('shows an initial QR failure without starting the mobile data channel', () => {
    render(<PairRequiredView initialError="配对链接已被使用。" onPaired={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('配对链接已被使用。')
  })
})
