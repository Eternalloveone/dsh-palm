// @vitest-environment jsdom
/** ImageLightbox: full-screen viewer, close on backdrop/Escape, dbl-tap zoom. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ImageLightbox } from './image-lightbox.tsx'

describe('ImageLightbox', () => {
  beforeEach(() => { cleanup() })
  afterEach(() => { cleanup() })

  it('renders the image full screen with its alt label', () => {
    render(<ImageLightbox src="https://x.test/a.png" alt="示例图" onClose={() => {}} />)
    const img = screen.getByAltText('示例图') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://x.test/a.png')
  })

  it('closes when the backdrop is tapped', () => {
    const onClose = vi.fn()
    render(<ImageLightbox src="https://x.test/a.png" alt="a" onClose={onClose} />)
    const backdrop = document.querySelector('.lightbox-backdrop')
    expect(backdrop).toBeTruthy()
    if (backdrop !== null) fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<ImageLightbox src="https://x.test/a.png" alt="a" onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('double-taps the image to toggle full-size zoom', () => {
    render(<ImageLightbox src="https://x.test/a.png" alt="a" onClose={() => {}} />)
    const img = screen.getByAltText('a')
    const stage = document.querySelector('.lightbox-stage')
    expect(stage?.className).toContain('lightbox-stage')
    expect(stage?.className).not.toContain('lightbox-stage-full')
    fireEvent.click(img)
    fireEvent.click(img) // double tap (within 300 ms)
    expect(stage?.className).toContain('lightbox-stage-full')
  })
})
