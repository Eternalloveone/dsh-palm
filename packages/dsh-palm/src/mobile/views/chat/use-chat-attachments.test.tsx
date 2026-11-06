// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_ATTACHED_FILES, MAX_ATTACHMENT_FILE_BYTES, useChatAttachments, type ChatAttachments } from './use-chat-attachments.ts'

vi.mock('../../image.ts', () => ({
  MAX_ATTACHED_IMAGES: 4,
  compressImageFile: vi.fn(),
  readAsDataURL: vi.fn(),
}))
vi.mock('../../api.ts', () => ({ uploadAttachment: vi.fn() }))
vi.mock('../../toast.tsx', () => ({ toast: vi.fn() }))

import { compressImageFile, readAsDataURL } from '../../image.ts'
import { uploadAttachment } from '../../api.ts'
import { toast } from '../../toast.tsx'

const compressMock = vi.mocked(compressImageFile)
const readMock = vi.mocked(readAsDataURL)
const uploadMock = vi.mocked(uploadAttachment)
const toastMock = vi.mocked(toast)

let api: ChatAttachments | undefined

function Harness() {
  api = useChatAttachments({ sessionId: 's-1' })
  const statuses = api.attachFiles.map(item => item.status).join(',')
  return <div data-testid="state">{`${api.attachImages.length}|${api.attachFiles.length}|${api.uploadingFiles}|${statuses}`}</div>
}

const file = (name: string, bytes = 4): File => new File([new Uint8Array(bytes)], name, { type: 'application/octet-stream' })

beforeEach(() => {
  api = undefined
  vi.clearAllMocks()
  compressMock.mockResolvedValue({ image: { dataUrl: 'data:image/png;base64,QQ==', mediaType: 'image/png' } as never, failed: false })
  readMock.mockResolvedValue('data:application/octet-stream;base64,QUJD')
  uploadMock.mockResolvedValue({ receiptId: 'rcpt-1', name: 'a.bin', bytes: 3 })
})

afterEach(() => {
  cleanup()
})

describe('useChatAttachments', () => {
  it('appends a compressed image and refuses past the image cap', async () => {
    render(<Harness />)
    await act(async () => { api?.addImage(file('p.png')) })
    await waitFor(() => { expect(api?.attachImages.length).toBe(1) })
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { api?.addImage(file('p.png')) })
    }
    expect(api?.attachImages.length).toBe(4)
    expect(toastMock).toHaveBeenCalledWith('最多附加 4 张图片')
  })

  it('drops an image that fails to decode, with a toast', async () => {
    compressMock.mockResolvedValue({ image: undefined as never, failed: true })
    render(<Harness />)
    await act(async () => { api?.addImage(file('p.heic')) })
    await waitFor(() => { expect(toastMock).toHaveBeenCalledWith('该图片无法解码，已忽略') })
    expect(api?.attachImages.length).toBe(0)
  })

  it('stages files immediately, then flips them to ready with the host receipt', async () => {
    // 宿主回执先扣住：chip 必须在回执之前就出现在发送框里（真机反馈的那个空窗）。
    const pending: Array<(value: { receiptId: string; name: string; bytes: number }) => void> = []
    uploadMock.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }) as never)
    const view = render(<Harness />)
    await act(async () => { api?.addFiles([file('a.bin'), file('b.bin')]) })
    expect(api?.attachFiles).toHaveLength(2)
    expect(api?.attachFiles.every(item => item.status === 'uploading')).toBe(true)
    await act(async () => {
      for (const resolve of pending) resolve({ receiptId: 'rcpt-1', name: 'a.bin', bytes: 3 })
    })
    await waitFor(() => { expect(view.getByTestId('state').textContent).toBe('0|2|0|ready,ready') })
    expect(api?.attachFiles.map(item => item.receiptId)).toEqual(['rcpt-1', 'rcpt-1'])
    expect(uploadMock).toHaveBeenCalledTimes(2)
  })

  it('caps the file count and skips oversized files', async () => {
    render(<Harness />)
    const many = Array.from({ length: MAX_ATTACHED_FILES + 1 }, (_, index) => file(`f${index}.bin`, 8))
    await act(async () => { api?.addFiles(many) })
    await waitFor(() => { expect(api?.attachFiles.length).toBe(MAX_ATTACHED_FILES) })
    expect(toastMock).toHaveBeenCalledWith(`最多附加 ${MAX_ATTACHED_FILES} 个文件`)
  })

  it('skips a file over the per-attachment byte cap', async () => {
    render(<Harness />)
    const huge = new File([new Uint8Array(8)], 'huge.bin')
    Object.defineProperty(huge, 'size', { value: MAX_ATTACHMENT_FILE_BYTES + 1 })
    await act(async () => { api?.addFiles([huge]) })
    expect(toastMock).toHaveBeenCalledWith('huge.bin 超过 20 MB，已忽略')
    expect(api?.attachFiles).toHaveLength(0)
  })

  it('keeps a failed chip and lets a tap retry it', async () => {
    uploadMock.mockRejectedValueOnce(new Error('tunnel down'))
    const view = render(<Harness />)
    await act(async () => { api?.addFiles([file('a.bin')]) })
    await waitFor(() => { expect(view.getByTestId('state').textContent).toBe('0|1|0|failed') })
    // 上传失败的那条必须留着（用户要知道是哪一条），重传后转 ready。
    await act(async () => { api?.retryStaged(api.attachFiles[0]?.localId ?? '') })
    await waitFor(() => { expect(view.getByTestId('state').textContent).toBe('0|1|0|ready') })
    expect(uploadMock).toHaveBeenCalledTimes(2)
  })
})
