// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { RpcTransportError } from '../rpc.ts'

const api = vi.hoisted(() => ({
  fetchMobilePreferences: vi.fn(),
  history: vi.fn(),
  listSessions: vi.fn(),
  listWorkspaces: vi.fn(),
  prompt: vi.fn(),
  readChat: vi.fn(),
  readSettings: vi.fn().mockResolvedValue({}),
  setThemePreference: vi.fn(),
}))

vi.mock('../api.ts', () => api)
vi.mock('../mux.ts', () => ({
  MuxClient: class {
    start(): void {}
    stop(): void {}
    observe(): void {}
  },
}))
vi.mock('./WorkspaceView.tsx', () => ({ WorkspaceView: () => <div>workspace-ready</div> }))
vi.mock('./SessionListView.tsx', () => ({ SessionListView: () => <div>sessions-ready</div> }))
vi.mock('./ChatView.tsx', () => ({ ChatView: () => <div>chat-ready</div> }))
vi.mock('./SettingsView.tsx', () => ({ SettingsView: () => <div>settings-ready</div> }))

import { App, mobilePairStateForError } from './App.tsx'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('mobile paired-device gate', () => {
  it('distinguishes a missing paired cookie from a transport outage', () => {
    expect(mobilePairStateForError(new RpcTransportError('HTTP 403'))).toBe('unpaired')
    expect(mobilePairStateForError(new RpcTransportError('HTTP 503'))).toBe('unavailable')
    expect(mobilePairStateForError(new Error('offline'))).toBe('unavailable')
  })

  it('keeps a valid paired context usable after a failed QR token', async () => {
    api.fetchMobilePreferences.mockResolvedValue({ mobileEnterToSend: true })
    render(<App initialPairError="配对链接已被使用。" />)

    await waitFor(() => expect(screen.getByText('workspace-ready')).toBeDefined())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the pairing screen only when the mobile gateway rejects the device', async () => {
    api.fetchMobilePreferences.mockRejectedValue(new RpcTransportError('HTTP 403'))
    render(<App initialPairError="配对链接已被使用。" />)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('配对链接已被使用。'))
  })

  it('shows a retryable connection failure rather than mounting remote views on outage', async () => {
    api.fetchMobilePreferences.mockRejectedValue(new RpcTransportError('HTTP 503'))
    render(<App />)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法连接到运行中的 DSH host。'))
    expect(screen.queryByText('workspace-ready')).toBeNull()
  })
})

describe('loadChatPage (v3 folded reads + fallback)', () => {
  const wireEntry = (type: string, data: unknown, seq: number): { event: { type: string; seq: number; time: number; data: unknown } } =>
    ({ event: { type, seq, time: seq * 1_000, data } })

  it('serves the folded page straight from readChat (no history call)', async () => {
    const page = {
      rows: [{ id: 'u-1', kind: 'user', text: '你好', seq: 0, time: 0 }],
      maxSeq: 7,
      hasMore: true,
      todo: { seq: 7, items: [{ content: '任务', status: 'pending' as const }] },
      projections: { asOfSeq: 7, values: {} },
    }
    api.readChat.mockResolvedValue(page)
    const { loadChatPage } = await import('./App.tsx')
    const result = await loadChatPage('s-1', undefined, new AbortController().signal)
    expect(result).toEqual(page)
    expect(api.readChat).toHaveBeenCalledWith('s-1', undefined, undefined, expect.any(AbortSignal))
    expect(api.history).not.toHaveBeenCalled()
  })

  it('falls back to session.history + local fold when readChat is unavailable', async () => {
    api.readChat.mockRejectedValue(new RpcTransportError('HTTP 403'))
    api.history.mockResolvedValue({
      events: [
        wireEntry('user/message', { id: 'u-1', role: 'user', content: [{ type: 'text', text: '改一下' }] }, 0),
        wireEntry('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', text: '正在' } }, 1),
        wireEntry('assistant/message', {
          turn: 0,
          step: 0,
          message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '已完成' }] },
        }, 2),
      ],
      hasMore: false,
    })
    const { loadChatPage } = await import('./App.tsx')
    const result = await loadChatPage('s-1')
    // The two paths converge: folded rows + the event watermark.
    expect(result.rows.map(row => row.text)).toEqual(['改一下', '已完成'])
    expect(result.maxSeq).toBe(2)
    expect(result.hasMore).toBe(false)
    expect(api.history).toHaveBeenCalledWith('s-1', undefined, undefined, undefined)
  })

  it('propagates a fallback-path failure (readChat down AND history down)', async () => {
    api.readChat.mockRejectedValue(new RpcTransportError('HTTP 403'))
    api.history.mockRejectedValue(new RpcTransportError('transport failed: network'))
    const { loadChatPage } = await import('./App.tsx')
    await expect(loadChatPage('s-1')).rejects.toThrow('network')
  })
})
