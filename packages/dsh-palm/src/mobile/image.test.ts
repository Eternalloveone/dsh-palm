// @vitest-environment jsdom
/** image.ts pure helpers: part building, data-url parsing, clipboard pick. */
import { describe, expect, it } from 'vitest'
import {
  buildPromptParts,
  dataUrlToImagePart,
  imageFromClipboard,
  isSupportedImageType,
  MAX_ATTACHED_IMAGES,
  type AttachedImage,
} from './image.ts'

describe('image attach helpers', () => {
  it('recognizes decodable raster MIME types only', () => {
    expect(isSupportedImageType('image/jpeg')).toBe(true)
    expect(isSupportedImageType('image/png')).toBe(true)
    expect(isSupportedImageType('image/webp')).toBe(true)
    expect(isSupportedImageType('image/gif')).toBe(true)
    expect(isSupportedImageType('image/heic')).toBe(false)
    expect(isSupportedImageType('application/pdf')).toBe(false)
  })

  it('parses an image data URL into a prompt part', () => {
    const part = dataUrlToImagePart('data:image/jpeg;base64,AAAA', 'photo.jpg')
    expect(part).toEqual({ type: 'image', mediaType: 'image/jpeg', data: 'AAAA', name: 'photo.jpg' })
    expect(dataUrlToImagePart('data:text/plain;base64,AAAA')).toBeUndefined()
    expect(dataUrlToImagePart('not-a-data-url')).toBeUndefined()
  })

  it('builds text-first, images-after content parts', () => {
    const image: AttachedImage = { dataUrl: 'data:image/png;base64,BBBB', mediaType: 'image/png' }
    const parts = buildPromptParts('看图说话', [image])
    expect(parts).toEqual([
      { type: 'text', text: '看图说话' },
      { type: 'image', mediaType: 'image/png', data: 'BBBB' },
    ])
    // Empty text draft still sends the images.
    expect(buildPromptParts('   ', [image])).toEqual([
      { type: 'image', mediaType: 'image/png', data: 'BBBB' },
    ])
    // No text and no images: empty part list (caller gates the send).
    expect(buildPromptParts('', [])).toEqual([])
  })

  it('extracts image files from clipboard items (Android Chrome shape)', () => {
    const png = new File(['x'], 'shot.png', { type: 'image/png' })
    const text = new File(['hi'], 'note.txt', { type: 'text/plain' })
    const dataTransfer = {
      items: [
        { kind: 'file', type: 'text/plain', getAsFile: () => text },
        { kind: 'file', type: 'image/png', getAsFile: () => png },
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
      ],
    } as unknown as DataTransfer
    const files = imageFromClipboard(dataTransfer)
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('shot.png')
  })

  it('returns no files when the clipboard exposes none (iOS Safari shape)', () => {
    const dataTransfer = { items: [] } as unknown as DataTransfer
    expect(imageFromClipboard(dataTransfer)).toEqual([])
    expect(imageFromClipboard(null)).toEqual([])
  })

  it('caps the picked images at the configured maximum', () => {
    const items = Array.from({ length: MAX_ATTACHED_IMAGES + 2 }, (_, i) => ({
      kind: 'file',
      type: 'image/jpeg',
      getAsFile: () => new File(['x'], `img${i}.jpg`, { type: 'image/jpeg' }),
    }))
    const files = imageFromClipboard({ items } as unknown as DataTransfer, MAX_ATTACHED_IMAGES)
    expect(files).toHaveLength(MAX_ATTACHED_IMAGES)
  })
})