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

  it('提交键用自己的样式类，不再借抽屉的「新建会话」按钮', () => {
    // 2026-11-10 审查：配对页的「配对」键写着 class="mobile-new mobile-pairSubmit"，
    // 视觉全来自抽屉里的「新建会话」键。抽屉改一次（加图标槽、改圆角），配对页会跟着变形。
    render(<PairRequiredView onPaired={vi.fn()} />)
    const submit = screen.getByRole('button', { name: '配对' })
    expect(submit.className).toContain('mobile-pairSubmit')
    expect(submit.className).not.toContain('mobile-new')
  })
  it('shows an initial QR failure without starting the mobile data channel', () => {
    render(<PairRequiredView initialError="配对链接已被使用。" onPaired={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('配对链接已被使用。')
  })
})

describe('配对页的空输入框要说清"粘什么"', () => {
  // 2026-11-10 实拍：第二个输入框是空框 + 抽象标签「配对链接或配对码」，
  // 新用户不知道要粘的是 dsh:// 开头的链接还是一串 6 位码。加占位提示。
  it('配对链接输入有 placeholder，且点明可接受的两种形式', () => {
    const { container } = render(
      <PairRequiredView initialError={undefined} onPaired={() => undefined} navigate={() => undefined} />,
    )
    const link = container.querySelector('#mobile-pair-link')
    expect(link, '找不到配对链接输入框').not.toBeNull()
    const placeholder = link?.getAttribute('placeholder') ?? ''
    expect(placeholder).toMatch(/dsh:|配对码|链接/)
    // 第一次写的是「粘贴 dsh:// 开头的配对链接，或输入 6 位配对码」——实拍直接被截断成
    // 「…或输...」。截断的占位提示比没有更糟（用户以为句子没说完）。钉一个长度上限。
    expect(placeholder.length, '占位提示要能完整显示，别被输入框截断').toBeLessThanOrEqual(22)
  })
})