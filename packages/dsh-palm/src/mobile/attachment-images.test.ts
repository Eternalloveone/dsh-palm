// @vitest-environment jsdom
/**
 * 聊天图片的字节缓存：内容寻址的去重、并发合并、LRU 淘汰，以及
 * data URL → Blob URL 的转换（真机上截图过大数据 URL 会解码失败显示成黑块）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const readAttachment = vi.fn()
vi.mock('./api.ts', () => ({ readAttachment: (...args: unknown[]) => readAttachment(...args) }))

import { cachedAttachmentUrl, forgetAttachmentUrl, loadAttachmentUrl } from './attachment-images.ts'

/** 一段假的 base64（三个字节的 "PNG"）。 */
const DATA_URL = 'data:image/png;base64,UE5H'

let created: string[]
let revoked: string[]

beforeEach(() => {
  readAttachment.mockReset()
  created = []
  revoked = []
  let seq = 0
  // jsdom 不实现 createObjectURL：给一个可数的替身。
  Object.defineProperty(URL, 'createObjectURL', {
    value: (blob: Blob) => {
      seq += 1
      const url = `blob:mock/${seq}/${blob.type}`
      created.push(url)
      return url
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: (url: string) => { revoked.push(url) },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('attachment image cache', () => {
  it('turns the host data URL into a Blob URL and caches it', async () => {
    readAttachment.mockResolvedValue({ mediaType: 'image/png', dataUrl: DATA_URL })
    const url = await loadAttachmentUrl('s-1', 'sha256:aaa')
    // 真机上的黑块就出在这一步：直接把几兆的 base64 字符串喂给 <img src>。
    expect(url).toBe('blob:mock/1/image/png')
    expect(cachedAttachmentUrl('sha256:aaa')).toBe(url)
    // 第二次走缓存，不再问宿主。
    expect(await loadAttachmentUrl('s-1', 'sha256:aaa')).toBe(url)
    expect(readAttachment).toHaveBeenCalledTimes(1)
  })

  it('merges concurrent reads of the same attachment', async () => {
    readAttachment.mockResolvedValue({ mediaType: 'image/png', dataUrl: DATA_URL })
    const [a, b] = await Promise.all([
      loadAttachmentUrl('s-1', 'sha256:bbb'),
      loadAttachmentUrl('s-1', 'sha256:bbb'),
    ])
    expect(a).toBe(b)
    expect(readAttachment).toHaveBeenCalledTimes(1)
  })

  it('revokes the Blob URL when a read fails and the tile asks to retry', async () => {
    readAttachment.mockResolvedValue({ mediaType: 'image/png', dataUrl: DATA_URL })
    await loadAttachmentUrl('s-1', 'sha256:ccc')
    expect(created).toHaveLength(1)
    forgetAttachmentUrl('sha256:ccc')
    expect(revoked).toEqual(created)
    expect(cachedAttachmentUrl('sha256:ccc')).toBeUndefined()
  })

  it('falls back to the raw data URL where createObjectURL is missing', async () => {
    // 老 WebView / 精简环境：拿不到 Blob URL 就退回 data URL，行为不比以前差。
    Object.defineProperty(URL, 'createObjectURL', { value: undefined, configurable: true, writable: true })
    readAttachment.mockResolvedValue({ mediaType: 'image/png', dataUrl: DATA_URL })
    expect(await loadAttachmentUrl('s-1', 'sha256:ddd')).toBe(DATA_URL)
  })
})