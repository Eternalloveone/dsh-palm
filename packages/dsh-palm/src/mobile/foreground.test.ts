// @vitest-environment jsdom
/**
 * foreground: the page-visibility gate every polling effect on the mobile
 * surface reads. A frozen background PWA must schedule nothing.
 */

import { describe, expect, it, vi } from 'vitest'
import { onVisibilityChange, pageVisible } from './foreground.ts'

/** Drive one visibility transition with an explicit target state. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('foreground', () => {
  it('reports the document visibility state', () => {
    setVisibility('hidden')
    expect(pageVisible()).toBe(false)
    setVisibility('visible')
    expect(pageVisible()).toBe(true)
  })

  it('notifies subscribers until they unsubscribe', () => {
    const listener = vi.fn()
    const off = onVisibilityChange(listener)
    setVisibility('hidden')
    expect(listener).toHaveBeenLastCalledWith(false)
    setVisibility('visible')
    expect(listener).toHaveBeenLastCalledWith(true)
    expect(listener).toHaveBeenCalledTimes(2)

    off()
    setVisibility('hidden')
    expect(listener).toHaveBeenCalledTimes(2)
    setVisibility('visible')
  })
})
