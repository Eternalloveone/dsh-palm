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
    render(<TurnScrubber entries={entries} index={1} total={3} />)
    expect(screen.getByText('第 2 / 3 轮')).toBeDefined()
    expect(screen.getByText('第二问')).toBeDefined()
    expect(screen.getByText('第二答')).toBeDefined()
  })

  it('draws one tick per turn and marks the pointed one', () => {
    const { container } = render(<TurnScrubber entries={entries} index={1} total={3} />)
    expect(container.querySelectorAll('.turn-scrub-tick').length).toBe(3)
    expect(container.querySelectorAll('.turn-scrub-tick-at').length).toBe(1)
  })

  it('puts the knob at the ends inclusively', () => {
    const { container } = render(<TurnScrubber entries={entries} index={2} total={3} />)
    const knob = container.querySelector('.turn-scrub-knob') as HTMLElement
    expect(knob.style.getPropertyValue('--knob-pct')).toBe('100%')
  })

  it('shows placeholder copy for empty previews', () => {
    render(<TurnScrubber entries={[entry(1, '', ''), entry(2, 'x', 'y')]} index={0} total={2} />)
    expect(screen.getByText('（这一轮没有提问）')).toBeDefined()
    expect(screen.getByText('（没有回复预览）')).toBeDefined()
  })

  it('says when the pointed turn still has to be paged in', () => {
    render(<TurnScrubber entries={[entry(1, 'a', 'b'), entry(2, 'x', 'y', false)]} index={1} total={3} />)
    expect(screen.getByText('左右拖动选轮次 · 松手跳转（需先载入历史）')).toBeDefined()
  })

  it('clamps an out-of-range index to the far end of the axis', () => {
    const { container } = render(<TurnScrubber entries={[entry(7, '只有一轮', '答')]} index={9} total={7} />)
    expect(screen.getByText('第 7 / 7 轮')).toBeDefined()
    const knob = container.querySelector('.turn-scrub-knob') as HTMLElement
    expect(knob.style.getPropertyValue('--knob-pct')).toBe('100%')
  })

    it('reaches the very first turn even when only the tail is paged in', () => {
      // 宿主的轮次大纲只回溯十几轮，所以 entries 往往从第 44 轮才开始。轴长必须
      // 按宿主的最高轮次算：按 entries.length 算的话，滑块最左只能停在第 44 轮
      // （真机截图「第 44 / 57 轮」卡在最左边，怎么都滑不到开头）。
      const tail = [entry(44, 'a', 'b'), entry(45, 'c', 'd'), entry(57, 'e', 'f')]
      const { container } = render(<TurnScrubber entries={tail} index={0} total={57} />)
      expect(screen.getByText('第 1 / 57 轮')).toBeDefined()
      // 松手就翻过去（以前这里只教用户往上滑，滑条等于滑不动）。
      expect(screen.getByText('（松手会往回翻到这一轮）')).toBeDefined()
      expect((container.querySelector('.turn-scrub-knob') as HTMLElement).style.getPropertyValue('--knob-pct')).toBe('0%')
    })
})
