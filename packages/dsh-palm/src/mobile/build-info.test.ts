// @vitest-environment jsdom
/**
 * The running build's hash is read from the tag that loaded this bundle — the
 * shell names every bundle by its content hash (`mobile.js?v=93819a18`), which is
 * what makes "the phone still shows the old version" answerable without a
 * remote-debugger session.
 */
import { describe, expect, it } from 'vitest'
import { buildHash } from './build-info.ts'

/** Replace the document's mobile.js script tag (or remove it). */
function tag(src?: string): void {
  document.querySelectorAll('script[data-test-mobile]').forEach((node) => { node.remove() })
  if (src === undefined) return
  const script = document.createElement('script')
  script.dataset.testMobile = '1'
  script.src = src
  document.head.appendChild(script)
}

describe('build info', () => {
  it('reads the content hash out of the running bundle tag', () => {
    tag('/m/mobile.js?v=93819a18')
    expect(buildHash()).toBe('93819a18')
  })

  it('is undefined when the shell does not name a hash', () => {
    tag('/m/mobile.js')
    expect(buildHash()).toBeUndefined()
  })

  it('is undefined when no bundle tag is present at all', () => {
    tag(undefined)
    expect(buildHash()).toBeUndefined()
  })

  it('finds the hash even when it is not the first query parameter', () => {
    tag('/m/mobile.js?x=1&v=abc123_XY')
    expect(buildHash()).toBe('abc123_XY')
  })
})
