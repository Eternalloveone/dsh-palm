/**
 * Mobile image attach helpers (community-standard pattern, cf. NextChat).
 *
 * - `compressImageFile` resizes/compresses a picked or pasted image to a
 *   base64 data URL whose encoded length stays under a target budget
 *   (default 256 KiB). It first lowers JPEG quality (0.9 -> 0.5 in 0.1
 *   steps), then shrinks the canvas dimensions (0.9x) until the budget is
 *   met — the same strategy popularized by ChatGPT-Next-Web.
 * - `dataUrlToImagePart` converts a data URL into the wire image part shape
 *   consumed by `session.prompt`.
 * - `imageFromClipboard` extracts the first bitmap from a paste event's
 *   clipboard items (Android Chrome exposes `image/png` items; iOS Safari
 *   exposes none — the file chooser remains the fallback).
 *
 * No new runtime dependencies: FileReader / Image / canvas are browser
 * built-ins, so the mobile bundle stays within the platform purity gate.
 */

export interface AttachedImage {
  /** Compressed base64 data URL (e.g. `data:image/jpeg;base64,...`). */
  readonly dataUrl: string
  /** MIME type carried by the data URL (jpeg/png/webp). */
  readonly mediaType: string
  /** Original file name when the image came from a file chooser. */
  readonly name?: string
}

/** A text or image prompt content part, matching `session.prompt` wire shape. */
export type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

/** Whether a MIME type is a decodable raster the mobile client can attach. */
export function isSupportedImageType(mediaType: string): boolean {
  return IMAGE_TYPES.has(mediaType)
}

/** Cap on images attached to one prompt (community default is small). */
export const MAX_ATTACHED_IMAGES = 4

/** Budget (base64 bytes) for one compressed image; NextChat defaults to 256 KiB. */
const DEFAULT_MAX_BYTES = 256 * 1024
/** Largest initial canvas edge (long side) before the budget loop scales. */
const MAX_INITIAL_EDGE = 1600

/**
 * Parse a `data:image/...;base64,...` string into a prompt image part.
 * Returns undefined for non-image or malformed data URLs.
 */
export function dataUrlToImagePart(dataUrl: string, name?: string): { type: 'image'; mediaType: string; data: string; name?: string } | undefined {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(dataUrl)
  if (!match) return undefined
  return { type: 'image', mediaType: match[1], data: match[2], name }
}

/**
 * Build the content array for a prompt from a text draft and attached images
 * (text first, then images — the order the model expects for a caption
 * followed by pictures).
 */
export function buildPromptParts(text: string, images: readonly AttachedImage[]): PromptPart[] {
  const parts: PromptPart[] = []
  if (text.trim() !== '') parts.push({ type: 'text', text })
  for (const image of images) {
    const part = dataUrlToImagePart(image.dataUrl, image.name)
    if (part !== undefined) parts.push(part)
  }
  return parts
}

/**
 * Compress an image File into an AttachedImage whose base64 payload stays
 * under `maxBytes`. Falls back to the original data URL when the browser
 * cannot decode the image (e.g. iOS HEIC) — the caller decides whether to
 * keep or reject it.
 *
 * @returns `{ image, failed }` — `failed: true` means the canvas decode
 * path did not run (unsupported format / decode error) and `image.dataUrl`
 * is the raw file data URL.
 */
export async function compressImageFile(
  file: File,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<{ image: AttachedImage; failed: boolean }> {
  const raw = await readAsDataURL(file)
  if (!isSupportedImageType(file.type)) {
    return { image: { dataUrl: raw, mediaType: file.type, name: file.name }, failed: true }
  }
  try {
    const compressed = await compressDataUrl(raw, file.type, maxBytes)
    return { image: { dataUrl: compressed, mediaType: 'image/jpeg', name: file.name }, failed: false }
  } catch {
    // Undecodable by the browser (HEIC/HEIF etc.): hand the raw bytes over;
    // the host or model will reject unsupported formats explicitly.
    return { image: { dataUrl: raw, mediaType: file.type, name: file.name }, failed: true }
  }
}

/** Read a File into a data URL. */
export function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

/** Decode + re-encode through canvas, shrinking until the budget fits. */
export function compressDataUrl(dataUrl: string, mediaType: string, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (context === null) { reject(new Error('canvas 2d unavailable')); return }
        // High-resolution phone photos would allocate multi-megabyte canvases
        // (8000×6000 ≈ 192MB RGBA; a 12MP shot ≈ 48MB) and OOM low-end
        // devices before the budget loop ever shrinks them. Cap the initial
        // edge (aspect preserved) — the loop only ever scales down further.
        const edge = Math.max(image.width, image.height)
        const scale = Math.min(1, MAX_INITIAL_EDGE / edge)
        let width = Math.max(1, Math.round(image.width * scale))
        let height = Math.max(1, Math.round(image.height * scale))
        let quality = 0.9
        let dataUrlOut = dataUrl
        for (;;) {
          canvas.width = width
          canvas.height = height
          context.clearRect(0, 0, width, height)
          context.drawImage(image, 0, 0, width, height)
          const candidate = canvas.toDataURL('image/jpeg', quality)
          if (candidate.length <= maxBytes || width <= 16 || height <= 16) {
            dataUrlOut = candidate
            break
          }
          if (quality > 0.5) {
            quality -= 0.1
          } else {
            width = Math.max(16, Math.round(width * 0.9))
            height = Math.max(16, Math.round(height * 0.9))
          }
        }
        resolve(dataUrlOut)
      } catch (error) {
        reject(error)
      }
    }
    image.onerror = () => reject(new Error('image decode failed'))
    image.src = dataUrl
  })
}

/**
 * Pull up to `max` image Files out of a paste event (first match wins).
 * Works on browsers that surface clipboard image items in the paste event
 * (Android Chrome); returns [] where the platform does not expose them
 * (iOS Safari).
 */
export function imageFromClipboard(dataTransfer: DataTransfer | null, max = MAX_ATTACHED_IMAGES): File[] {
  const items = dataTransfer?.items
  if (items === undefined) return []
  const files: File[] = []
  for (let index = 0; index < items.length && files.length < max; index++) {
    const item = items[index]
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file !== null) files.push(file)
    }
  }
  return files
}

/** Read an attached image's original dimensions (for the preview alt). */
export function dataUrlDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.width, height: image.height })
    image.onerror = () => resolve({ width: 0, height: 0 })
    image.src = dataUrl
  })
}