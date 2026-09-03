// @vitest-environment jsdom
/** ChatView composer image attach: paste → preview → send → clear. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatView } from './ChatView.tsx'
import { type SessionView } from './App.tsx'

vi.mock('../api.ts', () => ({
  fetchMobilePreferences: vi.fn(),
  models: vi.fn(),
  selectModel: vi.fn(),
  sendCommand: vi.fn(),
  cancelSession: vi.fn(),
  fetchPending: vi.fn(),
  listCommands: vi.fn(),
}))
vi.mock('./App.tsx', async importOriginal => {
  const actual = await importOriginal<typeof import('./App.tsx')>()
  return {
    ...actual,
    loadChatPage: vi.fn(),
    prompt: vi.fn(async () => {}),
  }
})
// Keep the pure builders real; only the DOM-touching pieces are mocked.
vi.mock('../image.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../image.ts')>()
  return {
    ...actual,
    compressImageFile: vi.fn(async (file: File) => ({
      image: { dataUrl: 'data:image/png;base64,QUFB', mediaType: 'image/png', name: file.name },
      failed: false,
    })),
  }
})
vi.mock('../toast.tsx', () => ({ toast: vi.fn() }))

import { fetchMobilePreferences, models, selectModel, sendCommand, cancelSession, fetchPending } from '../api.ts'
import { loadChatPage, prompt } from './App.tsx'
import { imageFromClipboard, MAX_ATTACHED_IMAGES, type AttachedImage } from '../image.ts'
import { buildPromptParts, compressImageFile } from '../image.ts'
import { toast } from '../toast.tsx'

const session: SessionView = {
  sessionId: 's-1',
  title: 'attach',
  updatedAt: 1_700_000_000_000,
  running: false,
  blank: false,
}

const fetchMobilePreferencesMock = vi.mocked(fetchMobilePreferences)
const modelsMock = vi.mocked(models)
const fetchPendingMock = vi.mocked(fetchPending)
const loadChatPageMock = vi.mocked(loadChatPage)
const promptMock = vi.mocked(prompt)
const compressImageFileMock = vi.mocked(compressImageFile)
const toastMock = vi.mocked(toast)

beforeEach(() => {
  fetchMobilePreferencesMock.mockResolvedValue({ mobileEnterToSend: true })
  promptMock.mockResolvedValue(undefined)
  modelsMock.mockResolvedValue({
    current: { provider: 'fx', model: 'fx-1' },
    routable: true,
    groups: [{ id: 'fx', name: 'FX', models: [{ id: 'fx-1', name: 'FX 标准' }] }],
    failures: [],
  })
  fetchPendingMock.mockResolvedValue({ approvals: [], questions: [] })
  loadChatPageMock.mockResolvedValue({ rows: [], maxSeq: -1, hasMore: false })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ChatView image attach', () => {
  it('adds a pasted image, previews it, and sends text+image parts', async () => {
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    await waitFor(() => expect(promptMock).toBeDefined())

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    // Paste an image (Android Chrome shape: an image/png file item).
    const pasted = new File(['x'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          { kind: 'file', type: 'image/png', getAsFile: () => pasted },
          { kind: 'string', type: 'text/plain', getAsFile: () => null },
        ],
      },
    })

    // Preview appears in the attach bar.
    const thumb = await screen.findByAltText('待发送图片')
    expect(thumb.getAttribute('src')).toContain('data:image/png')

    // Type a caption and send.
    fireEvent.change(textarea, { target: { value: '看图' } })
    fireEvent.click(screen.getByRole('button', { name: /发送/ }))

    await waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1))
    const [sessionId, parts] = promptMock.mock.calls[0]
    expect(sessionId).toBe('s-1')
    expect(parts).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image', mediaType: 'image/png', data: 'QUFB', name: 'shot.png' },
    ])

    // Attach list + input reset after the send settles.
    await waitFor(() => expect(screen.queryByAltText('待发送图片')).toBeNull())
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  })

  it('sends image-only when the draft is empty and clears the attach bar', async () => {
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    const pasted = new File(['x'], 'pic.png', { type: 'image/png' })
    fireEvent.paste(textarea, {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => pasted }] },
    })
    await screen.findByAltText('待发送图片')

    fireEvent.click(screen.getByRole('button', { name: /发送/ }))
    await waitFor(() => expect(promptMock).toHaveBeenCalledTimes(1))
    const [, parts] = promptMock.mock.calls[0]
    expect(parts).toEqual([{ type: 'image', mediaType: 'image/png', data: 'QUFB', name: 'pic.png' }])
    await waitFor(() => expect(screen.queryByAltText('待发送图片')).toBeNull())
  })

  it('removes an attached image via its remove button', async () => {
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    const pasted = new File(['x'], 'pic.png', { type: 'image/png' })
    fireEvent.paste(textarea, {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => pasted }] },
    })
    await screen.findByAltText('待发送图片')

    fireEvent.click(screen.getByRole('button', { name: '移除图片' }))
    await waitFor(() => expect(screen.queryByAltText('待发送图片')).toBeNull())
    expect(promptMock).not.toHaveBeenCalled()
  })

  it('shows a toast instead of silently dropping an image past the cap', async () => {
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    // Fill the attach list to the cap, one at a time (each preview settles first).
    for (let index = 0; index < MAX_ATTACHED_IMAGES; index++) {
      const pasted = new File(['x'], `pic${index}.png`, { type: 'image/png' })
      fireEvent.paste(textarea, {
        clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => pasted }] },
      })
      await waitFor(() => expect(screen.getAllByAltText('待发送图片').length).toBe(index + 1))
    }
    // One more pasted image is refused loudly, not silently dropped.
    const extra = new File(['x'], 'extra.png', { type: 'image/png' })
    fireEvent.paste(textarea, {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => extra }] },
    })
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(`最多附加 ${MAX_ATTACHED_IMAGES} 张图片`))
    expect(screen.getAllByAltText('待发送图片').length).toBe(MAX_ATTACHED_IMAGES)
  })

  it('drops a decode-failed image and shows a toast', async () => {
    compressImageFileMock.mockResolvedValue({
      image: { dataUrl: 'data:image/heic;base64,QUFB', mediaType: 'image/heic', name: 'x.heic' },
      failed: true,
    })
    render(<ChatView session={session} onBack={() => {}} showToolCalls={true} showSystemMessages={false} />)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    const pasted = new File(['x'], 'x.heic', { type: 'image/heic' })
    fireEvent.paste(textarea, {
      clipboardData: { items: [{ kind: 'file', type: 'image/heic', getAsFile: () => pasted }] },
    })
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('该图片无法解码，已忽略'))
    expect(screen.queryByAltText('待发送图片')).toBeNull()
  })
})