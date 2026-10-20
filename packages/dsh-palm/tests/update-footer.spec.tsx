// @vitest-environment jsdom
/** The updater line at the panel bottom: quiet states, inline confirm, polling, cancel. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UpdateFooter, type UpdateFooterProps } from '../src/client/UpdateFooter.tsx'
import { en } from '../src/client/locales.ts'

// English dictionary translate stub with {param} interpolation.
const t: UpdateFooterProps['t'] = (key, params) => {
  let text = (en as Record<string, string>)[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

/** One JSON Response for the fetch stub. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

interface StubOptions {
  version?: Record<string, unknown> | 'fail'
  update?: Record<string, unknown>
  status?: () => Record<string, unknown>
}

/** Route-aware fetch stub for the four updater endpoints. */
function stubFetch(options: StubOptions): { fetch: ReturnType<typeof vi.fn>; calls: string[] } {
  const calls: string[] = []
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url === '/api/pair/version') {
      if (options.version === 'fail') return json({ ok: false }, 500)
      return json(options.version ?? { ok: true })
    }
    if (url === '/api/pair/update') return json(options.update ?? { ok: true, started: true })
    if (url === '/api/pair/update/status') {
      return json(options.status?.() ?? { phase: 'idle', done: false, ok: false, from: '', to: '', step: '' })
    }
    if (url === '/api/pair/update/restart/cancel') return json({ cancelled: true })
    return json({ ok: true })
  })
  vi.stubGlobal('fetch', fetchStub)
  return { fetch: fetchStub, calls }
}

const AVAILABLE = {
  ok: true,
  installed: '1.6.2',
  latest: '1.6.3',
  isNewer: true,
  target: 'link',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('UpdateFooter', () => {
  it('shows the version jump, confirms inline, then counts down and cancels', async () => {
    const status = (): Record<string, unknown> => ({
      phase: 'restarting',
      done: false,
      ok: true,
      from: '1.6.2',
      to: '1.6.3',
      step: 'done',
      restartAt: Date.now() + 2_000,
    })
    const { calls } = stubFetch({ version: AVAILABLE, update: { ok: true, started: true }, status })
    render(<UpdateFooter t={t} pollMs={20} />)

    await waitFor(() => expect(screen.getByText('dsh-palm 1.6.2 → 1.6.3')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    // Inline confirmation, not a native dialog.
    expect(screen.getByText('Update to 1.6.3? dsh restarts automatically when it is done.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    expect(calls).toContain('POST /api/pair/update')

    await waitFor(() => expect(screen.getByTestId('remote-update-countdown')).toBeTruthy())
    expect(screen.getByTestId('remote-update-countdown').textContent).toMatch(/Restarting in \d+s/)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(calls).toContain('POST /api/pair/update/restart/cancel'))
    await waitFor(() => expect(screen.getByText(/Automatic restart cancelled/)).toBeTruthy())
  })

  it('shows the current step while the host is working', async () => {
    stubFetch({
      version: AVAILABLE,
      update: { ok: true, started: true },
      status: () => ({ phase: 'running', done: false, ok: false, from: '1.6.2', to: '1.6.3', step: '安装依赖' }),
    })
    render(<UpdateFooter t={t} pollMs={20} />)
    await waitFor(() => expect(screen.getByText('dsh-palm 1.6.2 → 1.6.3')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await waitFor(() => expect(screen.getByText('Updating: 安装依赖')).toBeTruthy())
  })

  it('stays quiet and grey when already up to date', async () => {
    stubFetch({ version: { ok: true, installed: '1.6.2', latest: '1.6.2', isNewer: false, target: 'directory' } })
    render(<UpdateFooter t={t} pollMs={20} />)
    await waitFor(() => expect(screen.getByText('dsh-palm 1.6.2 · up to date')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
  })

  // A new version has to read as a to-do, not as another grey footnote: the
  // accent dot and the emphasised label are what do that work, and they must
  // never show up in the up-to-date state (where grey is the point).
  it('lifts the available state out of the grey with a dot and the accent label', async () => {
    stubFetch({ version: AVAILABLE })
    const { unmount } = render(<UpdateFooter t={t} pollMs={20} />)
    await waitFor(() => expect(screen.getByTestId('remote-update-dot')).toBeTruthy())
    const label = screen.getByText('dsh-palm 1.6.2 → 1.6.3')
    expect(label.getAttribute('data-emphasis')).toBe('accent')
    unmount()

    stubFetch({ version: { ok: true, installed: '1.6.2', latest: '1.6.2', isNewer: false, target: 'directory' } })
    render(<UpdateFooter t={t} pollMs={20} />)
    await waitFor(() => expect(screen.getByText('dsh-palm 1.6.2 · up to date')).toBeTruthy())
    expect(screen.queryByTestId('remote-update-dot')).toBeNull()
    expect(document.querySelector('[data-emphasis="accent"]')).toBeNull()
  })

  it('hides the line entirely when the host cannot answer', async () => {
    stubFetch({ version: 'fail' })
    render(<UpdateFooter t={t} pollMs={20} />)
    await waitFor(() => expect(screen.queryByTestId('remote-update')).toBeNull())
  })

  it('shows a refusal as one plain sentence, never a dialog', async () => {
    const refuse = '仓库里有没提交的改动，已停止更新（避免弄乱你手上的活儿）'
    stubFetch({
      version: AVAILABLE,
      update: { ok: true, started: false, plan: { kind: 'noop', installed: '1.6.2', steps: [refuse], refuse } },
    })
    render(<UpdateFooter t={t} pollMs={20} />)
    await waitFor(() => expect(screen.getByText('dsh-palm 1.6.2 → 1.6.3')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await waitFor(() => expect(screen.getByText(refuse)).toBeTruthy())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the failure reason inline when the host reports a failure', async () => {
    stubFetch({
      version: AVAILABLE,
      update: { ok: true, started: true },
      status: () => ({
        phase: 'failed', done: true, ok: false, from: '1.6.2', to: '1.6.3', step: 'failed',
        error: '更新没成功：下载安装包失败（npm 退出码 1）',
      }),
    })
    render(<UpdateFooter t={t} pollMs={20} />)
    await waitFor(() => expect(screen.getByText('dsh-palm 1.6.2 → 1.6.3')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    await waitFor(() => expect(screen.getByText('更新没成功：下载安装包失败（npm 退出码 1）')).toBeTruthy())
  })
})
