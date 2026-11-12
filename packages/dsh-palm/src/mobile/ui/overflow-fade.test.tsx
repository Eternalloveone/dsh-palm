// @vitest-environment jsdom
/**
 * 横滚溢出判定（2026-11-10）：审批命令块在 320px 上被容器圆角切掉一截，用户不知道
 * 后面还有内容。这里只测**判定**：真溢出 → `end`；不溢出 / 已滚到最右 → `none`。
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useOverflowFade } from './overflow-fade.ts'

/** 探针：把 hook 的 ref 与 fade 都摊到 DOM 上，方便断言。 */
function Probe(): React.ReactElement {
  const { ref, fade } = useOverflowFade<HTMLPreElement>()
  return <pre ref={ref} data-fade={fade}>pnpm test</pre>
}

/** 把 jsdom 里恒为 0 的尺寸改成可指定值。 */
function stubBox(scrollWidth: number, clientWidth: number, scrollLeft = 0): () => void {
  const width = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth')
  const client = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
  Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth })
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => clientWidth })
  const node = document.querySelector('pre')
  if (node !== null) Object.defineProperty(node, 'scrollLeft', { configurable: true, value: scrollLeft })
  return () => {
    if (width !== undefined) Object.defineProperty(Element.prototype, 'scrollWidth', width)
    if (client !== undefined) Object.defineProperty(Element.prototype, 'clientWidth', client)
  }
}

afterEach(() => { cleanup() })

describe('横滚溢出判定', () => {
  it('内容比容器宽：标记右缘还有内容', () => {
    const restore = stubBox(400, 320)
    const { container } = render(<Probe />)
    expect(container.querySelector('pre')!.getAttribute('data-fade')).toBe('end')
    restore()
  })

  it('内容装得下：不标记（短命令不该有渐隐尾巴）', () => {
    const restore = stubBox(300, 320)
    const { container } = render(<Probe />)
    expect(container.querySelector('pre')!.getAttribute('data-fade')).toBe('none')
    restore()
  })

  it('已经滚到最右：撤掉标记（渐隐不能变成新的困惑）', () => {
    const restore = stubBox(400, 320)
    const { container } = render(<Probe />)
    const node = container.querySelector('pre')!
    expect(node.getAttribute('data-fade')).toBe('end')
    // 真滚到最右：scroll 监听重新量一次，标记撤掉。
    Object.defineProperty(node, 'scrollLeft', { configurable: true, value: 80 })
    act(() => { node.dispatchEvent(new Event('scroll')) })
    expect(node.getAttribute('data-fade')).toBe('none')
    restore()
  })
})
