// @vitest-environment jsdom
/** D1 scrubber card tests: it is pure presentation, so the assertions cover the
 *  labels it derives (turn number, prompt, response) and the track geometry. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TurnScrubber } from './turn-scrubber.tsx'
import type { TurnEntry } from './turn-outline.ts'

afterEach(() => {
  cleanup()
})

/** One merged turn entry (the scrub axis). */
function entry(turn: number, prompt: string, response: string, loaded = true): TurnEntry {
  return { turn, seq: turn * 10, prompt, response, loaded }
}

describe('TurnScrubber', () => {
  const entries = [
    entry(1, '第一问', '第一答'),
    entry(2, '第二问', '第二答'),
    entry(3, '第三问', '第三答'),
  ]

  it('shows the pointed turn with its prompt and response preview', () => {
    render(<TurnScrubber entries={entries} index={1} />)
    expect(screen.getByText('第 2 / 3 轮')).toBeDefined()
    expect(screen.getByText('第二问')).toBeDefined()
    expect(screen.getByText('第二答')).toBeDefined()
  })

  it('draws one tick per turn and marks the pointed one', () => {
    const { container } = render(<TurnScrubber entries={entries} index={1} />)
    expect(container.querySelectorAll('.turn-scrub-tick').length).toBe(3)
    expect(container.querySelectorAll('.turn-scrub-tick-at').length).toBe(1)
  })

  it('puts the knob at the ends inclusively', () => {
    const { container } = render(<TurnScrubber entries={entries} index={2} />)
    const knob = container.querySelector('.turn-scrub-knob') as HTMLElement
    expect(knob.style.left).toBe('100%')
  })

  it('shows placeholder copy for empty previews', () => {
    render(<TurnScrubber entries={[entry(1, '', ''), entry(2, 'x', 'y')]} index={0} />)
    expect(screen.getByText('（这一轮没有提问）')).toBeDefined()
    expect(screen.getByText('（没有回复预览）')).toBeDefined()
  })

  it('says when the pointed turn still has to be paged in', () => {
    render(<TurnScrubber entries={[entry(1, 'a', 'b'), entry(2, 'x', 'y', false)]} index={1} />)
    expect(screen.getByText('左右拖动选轮次 · 松手跳转（需先载入历史）')).toBeDefined()
  })

  it('survives an out-of-range index and a single-entry list', () => {
    const { container } = render(<TurnScrubber entries={[entry(7, '只有一轮', '答')]} index={9} />)
    expect(screen.getByText('第 7 / 7 轮')).toBeDefined()
    const knob = container.querySelector('.turn-scrub-knob') as HTMLElement
    expect(knob.style.left).toBe('0%')
  })
})
