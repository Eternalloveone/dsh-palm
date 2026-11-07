/**
 * ImageLightbox: full-screen image viewer for images tapped in the chat.
 *
 * Two sources feed it: an in-chat markdown `<img>` (a remote URL already
 * permitted by the CSP, or an attached image's data URL) and a local file
 * path previewed through `mobile.readFile` (which answers a base64 data URL
 * for image extensions). The overlay is a plain fixed backdrop with a close
 * button and backdrop tap; a double-tap toggles a 1:1 / fit zoom for reading
 * detail, and pinch is left to the browser (two-finger zoom on the image).
 *
 * @module dsh-palm/mobile/image-lightbox
 */

import { useRef, useState } from 'react'
import { CloseIcon } from './icons.tsx'
import { Overlay } from './ui/overlay.tsx'

export interface ImageLightboxProps {
  /** Image source: remote URL or data URL. */
  src: string
  /** Accessible / fallback name. */
  alt: string
  onClose(): void
}

/** Render a full-screen image viewer with close + double-tap zoom. */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [zoom, setZoom] = useState<'fit' | 'full'>('fit')
  const lastTapRef = useRef(0)

  /** Double-tap toggles fit ↔ full-size (detail reading). */
  const handleTap = (): void => {
    const now = Date.now()
    if (now - lastTapRef.current < 300) {
      setZoom(value => (value === 'fit' ? 'full' : 'fit'))
      lastTapRef.current = 0
      return
    }
    lastTapRef.current = now
  }

  return (
    // 灯箱没有内层面板：整块就是舞台，所以用 bare（遮罩即 aria 载体）。
    // Esc 与焦点陷阱（关闭后归还给触发它的图片）由 Overlay 负责。
    <Overlay bare title={alt} onClose={onClose} scrimClassName="lightbox-backdrop">
      <button type="button" className="lightbox-close" aria-label="关闭" onClick={onClose}>
        <CloseIcon />
      </button>
      <div className={'lightbox-stage' + (zoom === 'full' ? ' lightbox-stage-full' : '')} onClick={(event) => { event.stopPropagation() }}>
        <img
          className="lightbox-img"
          src={src}
          alt={alt}
          onClick={handleTap}
          draggable={false}
        />
      </div>
      <div className="lightbox-hint" aria-hidden>双击放大/还原 · 点背景关闭</div>
    </Overlay>
  )
}
