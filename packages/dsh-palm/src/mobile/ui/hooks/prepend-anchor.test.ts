// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { restorePrependScrollTop, type PrependAnchor } from './use-stick-to-bottom.ts'

function scroller({
  scrollTop = 200,
  scrollHeight = 1_000,
  clientHeight = 500,
  rows = [],
}: {
  scrollTop?: number
  scrollHeight?: number
  clientHeight?: number
  rows?: Array<{ id?: string; seq?: number; top: number }>
} = {}): HTMLElement {
  const element = document.createElement('div')
  Object.defineProperties(element, {
    scrollTop: { value: scrollTop, configurable: true },
    scrollHeight: { value: scrollHeight, configurable: true },
    clientHeight: { value: clientHeight, configurable: true },
  })
  for (const row of rows) {
    const child = document.createElement('div')
    if (row.id !== undefined) child.setAttribute('data-message-id', row.id)
    if (row.seq !== undefined) child.setAttribute('data-row-seq', String(row.seq))
    child.getBoundingClientRect = () => ({ top: row.top } as DOMRect)
    element.append(child)
  }
  return element
}

describe('prepend scroll anchor', () => {
  it('restores by content height when no stable row was captured', () => {
    const element = scroller({ scrollTop: 200, scrollHeight: 1_300 })
    const anchor: PrependAnchor = { top: 240, height: 1_000 }
    expect(restorePrependScrollTop(element, anchor)).toBe(540)
  })

  it('uses the captured row screen position instead of windowed content height', () => {
    const element = scroller({ scrollTop: 200, scrollHeight: 20_000, rows: [{ id: 'row-a', seq: 10, top: 180 }] })
    const anchor: PrependAnchor = { top: 200, height: 1_000, rowId: 'row-a', rowTop: 100, rowSeq: 10 }
    expect(restorePrependScrollTop(element, anchor)).toBe(280)
  })

  it('accepts a row reidentified by the same sequence', () => {
    const element = scroller({ scrollTop: 300, rows: [{ id: 'replacement', seq: 40, top: 150 }] })
    const anchor: PrependAnchor = { top: 300, rowId: 'old-id', rowTop: 100, rowSeq: 40 }
    expect(restorePrependScrollTop(element, anchor)).toBe(350)
  })

  it('does not anchor to a nearby row with a different sequence', () => {
    const element = scroller({ scrollTop: 300, rows: [{ id: 'replacement', seq: 41, top: 150 }] })
    const anchor: PrependAnchor = { top: 300, rowId: 'old-id', rowTop: 100, rowSeq: 40 }
    expect(restorePrependScrollTop(element, anchor)).toBeUndefined()
  })

  it('ignores a correction when the matching row moved by more than two viewports', () => {
    const element = scroller({ clientHeight: 500, rows: [{ id: 'row-a', seq: 10, top: 1_200 }] })
    const anchor: PrependAnchor = { top: 200, rowId: 'row-a', rowTop: 100, rowSeq: 10 }
    expect(restorePrependScrollTop(element, anchor)).toBeUndefined()
  })
})
