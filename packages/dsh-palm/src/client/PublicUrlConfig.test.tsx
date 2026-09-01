// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PublicUrlConfig, isHttpUrl } from './PublicUrlConfig.tsx'
import { zh } from './locales.ts'

/** Bound translator backed by the zh dictionary with {param} interpolation. */
const t = ((key: string, params?: Record<string, string | number>) => {
  let text = zh[key as keyof typeof zh] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}) as never

/** Stub the probe endpoint: reachable by default. */
function stubProbe(probe: { ok: boolean; status?: number } = { ok: true, status: 200 }): ReturnType<typeof vi.fn> {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(probe), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isHttpUrl', () => {
  it('accepts http(s) URLs with a host', () => {
    expect(isHttpUrl('https://foo.trycloudflare.com')).toBe(true)
    expect(isHttpUrl('http://192.168.1.5:7001')).toBe(true)
  })

  it('rejects malformed and non-http values', () => {
    expect(isHttpUrl('')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
    expect(isHttpUrl('ftp://example.com')).toBe(false)
    expect(isHttpUrl('https://')).toBe(false)
  })
})

describe('PublicUrlConfig', () => {
  it('shows the editor with edit and clear actions', () => {
    stubProbe()
    render(<PublicUrlConfig t={t} onSave={vi.fn()} onClear={vi.fn()} />)
    expect(screen.getByLabelText('公网地址（内网穿透）')).toBeTruthy()
    expect(screen.getByRole('button', { name: '修改' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '清除' })).toBeTruthy()
  })

  it('prefills the input with the configured address', () => {
    stubProbe()
    render(<PublicUrlConfig t={t} current="https://existing.example.com" onSave={vi.fn()} onClear={vi.fn()} />)
    expect((screen.getByLabelText('公网地址（内网穿透）') as HTMLInputElement).value)
      .toBe('https://existing.example.com')
  })

  it('rejects an invalid address without calling onSave', async () => {
    stubProbe()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<PublicUrlConfig t={t} onSave={onSave} onClear={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('公网地址（内网穿透）'), { target: { value: 'not a url' } })
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('请输入有效的 http(s) 地址'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('probes the address before saving and saves when reachable', async () => {
    const fetch = stubProbe({ ok: true, status: 200 })
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<PublicUrlConfig t={t} onSave={onSave} onClear={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('公网地址（内网穿透）'), { target: { value: 'https://my-tunnel.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('https://my-tunnel.example.com'))
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/pair/probe')
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://my-tunnel.example.com' })
  })

  it('blocks saving when the probe reports the address unreachable', async () => {
    stubProbe({ ok: false })
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<PublicUrlConfig t={t} onSave={onSave} onClear={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('公网地址（内网穿透）'), { target: { value: 'https://dead-tunnel.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('这个地址连不上'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('clears the configured address and empties the input', async () => {
    stubProbe()
    const onClear = vi.fn().mockResolvedValue(undefined)
    render(<PublicUrlConfig t={t} current="https://existing.example.com" onSave={vi.fn()} onClear={onClear} />)
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    await waitFor(() => expect(onClear).toHaveBeenCalled())
    expect((screen.getByLabelText('公网地址（内网穿透）') as HTMLInputElement).value).toBe('')
  })

  it('surfaces a save failure', async () => {
    stubProbe()
    const onSave = vi.fn().mockRejectedValue(new Error('settings write failed'))
    render(<PublicUrlConfig t={t} onSave={onSave} onClear={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('公网地址（内网穿透）'), { target: { value: 'https://my-tunnel.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('保存失败，请重试'))
  })

  it('shows a detected Tailscale domain and applies it to the input', () => {
    stubProbe()
    render(
      <PublicUrlConfig
        t={t}
        detection={{ tailnetDomain: 'alice.tail1234.ts.net', frpc: false, cloudflared: false }}
        onSave={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(screen.getByText('检测到 Tailscale：alice.tail1234.ts.net')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '填入' }))
    expect((screen.getByLabelText('公网地址（内网穿透）') as HTMLInputElement).value)
      .toBe('https://alice.tail1234.ts.net')
  })

  it('shows frp and Cloudflare hints when those clients are detected', () => {
    stubProbe()
    render(
      <PublicUrlConfig
        t={t}
        detection={{ frpc: true, cloudflared: true }}
        onSave={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(screen.getByText('检测到 frp 客户端，填你的公网入口地址')).toBeTruthy()
    expect(screen.getByText('检测到 Cloudflare Tunnel，填你的隧道 URL')).toBeTruthy()
  })

  it('shows the concrete frp entry with an apply button and TLS hint', () => {
    stubProbe()
    render(
      <PublicUrlConfig
        t={t}
        detection={{ frpc: true, cloudflared: false, frpEntry: 'http://203.0.113.10:7008' }}
        onSave={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(screen.getByText('检测到 frp：入口 http://203.0.113.10:7008（明文）')).toBeTruthy()
    expect(screen.getByText('如服务器配置了 TLS 入口（https://域名:端口），请填 https 地址')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '填入' }))
    expect((screen.getByLabelText('公网地址（内网穿透）') as HTMLInputElement).value)
      .toBe('http://203.0.113.10:7008')
  })

  it('shows the no-tunnel fork with LAN and tunnel options when nothing is detected', () => {
    stubProbe()
    render(
      <PublicUrlConfig
        t={t}
        detection={{ frpc: false, cloudflared: false }}
        onSave={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(screen.getByText('还没有隧道？')).toBeTruthy()
    expect(screen.getByText('手机和电脑在同一个网络')).toBeTruthy()
    expect(screen.getByText('创建一条公网隧道')).toBeTruthy()
    const link = screen.getByRole('link', { name: /查看完整教程/ })
    expect(link.getAttribute('href')).toContain('docs/remote-access-guide.md')
  })

  it('hides the no-tunnel fork when a tunnel is detected', () => {
    stubProbe()
    render(
      <PublicUrlConfig
        t={t}
        detection={{ tailnetDomain: 'alice.tail1234.ts.net', frpc: false, cloudflared: false }}
        onSave={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(screen.queryByText('还没有隧道？')).toBeNull()
  })
})
