// @vitest-environment jsdom
/**
 * 认领的**接线**测试：证明「程序化滚动不会被记成读者手势」这条在 hook 里真的成立。
 *
 * 为什么不只测 `scroll-claim.ts`：纯函数测的是判据，这里测的是判据有没有接到调用点上。
 * 2026-11-17 的真机现场就是"判据对、接线漏" —— 搜索定位直接写 scrollTop，
 * 一次手势判定把 `userMoved` 置真，本轮补钉从此不工作。
 */
import { render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { createScrollState, type ScrollEvent } from '../../../stream/scroll-machine.ts'
import { useScrollFollow } from './use-chat-scroll-follow.ts'

interface HarnessProps {
  events: ScrollEvent[]
  touchingRecently: boolean
  claim: { armed: boolean; value: number; at: number; until: number }
  scrollTop: number
}

function Harness({ events, touchingRecently, claim, scrollTop }: HarnessProps): null {
  const scrollRef = useRef<HTMLDivElement | null>({
    scrollTop,
    scrollHeight: 2_000,
    clientHeight: 800,
  } as unknown as HTMLDivElement)
  const scrollTopRef = useRef(0)
  const programmaticScrollRef = useRef(claim.armed)
  const programmaticValueRef = useRef(claim.value)
  const programmaticAtRef = useRef(claim.at)
  const programmaticUntilRef = useRef(claim.until)
  const lastTouchAtRef = useRef(touchingRecently ? Date.now() : 0)
  const scrollStateRef = useRef(createScrollState())
  const pendingRef = useRef(false)
  const loadOlderRef = useRef(() => {})
  const { handleScroll } = useScrollFollow({
    scrollRef,
    scrollTopRef,
    programmaticScrollRef,
    programmaticValueRef,
    programmaticAtRef,
    programmaticUntilRef,
    lastTouchAtRef,
    scrollStateRef,
    pendingRef,
    loadOlderRef,
    scrollEvent: event => { events.push(event) },
    setShowJumpToLatest: () => {},
    setCurrentTurn: () => {},
    deriveCurrentTurn: () => 0,
    markSeen: () => {},
    hasOlder: false,
  })
  handleScroll()
  return null
}

describe('scroll claim 接线', () => {
  it('刚点过屏幕 + 区间认领内（平滑定位中途）：不算手势', () => {
    const events: ScrollEvent[] = []
    render(<Harness
      events={events}
      touchingRecently
      claim={{ armed: false, value: -1, at: 0, until: Date.now() + 200 }}
      scrollTop={1_200}
    />)
    expect(events.some(event => event.type === 'gesture')).toBe(false)
  })

  it('刚点过屏幕 + 点认领对上：同样不算手势', () => {
    const events: ScrollEvent[] = []
    render(<Harness
      events={events}
      touchingRecently
      claim={{ armed: true, value: 1_200, at: Date.now(), until: 0 }}
      scrollTop={1_200}
    />)
    expect(events.some(event => event.type === 'gesture')).toBe(false)
  })

  it('没有任何认领 + 刚点过屏幕：必须算手势（否则连读者上滑都识别不了）', () => {
    const events: ScrollEvent[] = []
    render(<Harness
      events={events}
      touchingRecently
      claim={{ armed: false, value: -1, at: 0, until: 0 }}
      scrollTop={1_200}
    />)
    expect(events.some(event => event.type === 'gesture')).toBe(true)
  })
})
