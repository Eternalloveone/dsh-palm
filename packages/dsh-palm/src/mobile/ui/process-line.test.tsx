// @vitest-environment jsdom
/**
 * 过程折叠行的渲染契约（版式真源 overview.html「2 · 会话正文」）：
 * 1. 「▸ 31 次工具调用」：只报计数；步数归状态条，头行不再报「N 步过程」；
 * 2. 计数拿不到时退回调用方给的占位（`—`），不编数字、不借状态词补位；
 * 3. 展开状态与回调都由既有过程组传入（本组件不持有状态）：点整行走 onToggle；
 * 4. 运行中才显示「最近 3 步」，超出只留最后 3 条；
 * 5. 不给 onToggle 时是不可点的静态行（role=status，没有 aria-expanded）；
 * 6. **没有计时元素**：耗时只出现在任务头状态条（`data-role="strip-time"`）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProcessLine } from './process-line.tsx'

afterEach(() => { cleanup() })

/** 计时口径（与真机复核一致）：分秒 / 秒 / mm:ss。 */
const TIMER = /\d+分\d+秒|\d+(\.\d+)?s|\d{2}:\d{2}/

describe('ProcessLine（过程折叠行）', () => {
  it('主文案：只报工具调用数（步数归状态条，头行不再重复）', () => {
    const { container, unmount } = render(<ProcessLine toolCalls={31} />)
    expect(container.querySelector('.palm-proc-main')!.textContent).toBe('31 次工具调用')
    expect(container.textContent).not.toContain('步过程')
    unmount()
    const withNote = render(<ProcessLine toolCalls={12} note="2 处报错" />)
    expect(withNote.container.querySelector('.palm-proc-main')!.textContent).toBe('12 次工具调用')
    expect(withNote.container.querySelector('.palm-proc-note')!.textContent).toBe('2 处报错')
    withNote.unmount()
  })

  it('计数拿不到时退回调用方给的占位（「—」），不编数字', () => {
    const { container } = render(<ProcessLine label="—" />)
    expect(container.querySelector('.palm-proc-main')!.textContent).toBe('—')
    expect(container.textContent).not.toContain('工具调用')
    expect(container.textContent).not.toContain('步过程')
    // 这一行永远不出现计时元素（计时只在状态条）。
    expect(container.querySelector('.palm-proc-time')).toBeNull()
    expect(container.querySelector('.chat-proc-time')).toBeNull()
    expect(container.textContent).not.toMatch(TIMER)
  })

  it('点击整行走既有 onToggle；展开状态是受控的（▸ / ▾）', () => {
    const onToggle = vi.fn()
    const { container, rerender } = render(<ProcessLine toolCalls={3} expanded={false} onToggle={onToggle} />)
    const line = container.querySelector('button.palm-proc') as HTMLButtonElement
    expect(line.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.palm-proc-caret')!.textContent).toBe('▸')
    fireEvent.click(line)
    expect(onToggle).toHaveBeenCalledTimes(1)
    rerender(<ProcessLine toolCalls={3} expanded onToggle={onToggle} />)
    expect(container.querySelector('button.palm-proc')!.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.palm-proc-caret')!.textContent).toBe('▾')
  })
  it('过程行本身不再带「最近 N 步」：那行搬到折叠态的命令条里', () => {
    // 2026-11-10：recent 这条路径在真实聊天页从来没被传过（ProcessGroup 不传），
    // 已删除；最新命令改由 ui/latest-command.tsx 在折叠态渲染。
    const { container } = render(<ProcessLine toolCalls={9} running />)
    expect(container.querySelector('.palm-proc-recent')).toBeNull()
  })

  it('不给 onToggle 时是静态行；计数按千分位格式化', () => {
    const { container } = render(<ProcessLine toolCalls={1234} note="2 处报错" />)
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[role="status"]')).not.toBeNull()
    expect(container.querySelector('.palm-proc-main')!.textContent).toBe('1,234 次工具调用')
    expect(container.querySelector('.palm-proc-note')!.textContent).toBe('2 处报错')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

/**
 * 2026-11-10 用户：「过程条右侧的这个圆环，可以删掉，没有任何作用」。
 * 环形进度整体下线 —— 头行右侧只留展开箭头，步数只在展开体首行「共 N 步」报。
 */
describe('ProcessLine 不再有环形进度', () => {
  it('右侧只有展开箭头：没有环、没有轨道、没有进度点阵', () => {
    const { container } = render(<ProcessLine toolCalls={8} running state="running" expanded={false} onToggle={() => {}} />)
    expect(container.querySelector('.palm-proc-ring')).toBeNull()
    for (const gone of [
      '.palm-proc-ring-track',
      '.palm-proc-ring-fill',
      '.palm-proc-dots',
      '.palm-proc-step',
      '.palm-proc-track',
      '.palm-proc-fill',
      '.palm-proc-spark',
      '.palm-proc-more',
    ]) {
      expect(container.querySelector(gone), gone).toBeNull()
    }
    expect(container.querySelector('.palm-proc-caret')!.textContent).toBe('▸')
  })

  it('组件不再接受 steps：传了也不画（API 已下线）', () => {
    const { container } = render(<ProcessLine toolCalls={4} />)
    expect(container.querySelector('.palm-proc-ring')).toBeNull()
  })
})
describe('「改 N 个文件」并入过程条头（2026-11-10 用户要求）', () => {
  it('有改动时在过程条头报文件数（千分位），读屏也读得到', () => {
    const { container } = render(<ProcessLine toolCalls={12} note="1 处报错" files={1234} />)
    const chip = container.querySelector('.palm-proc-files')!
    expect(chip.textContent).toBe('改 1,234 个文件')
    // 与计数、报错同一行，同一套排版（不再出现在任务头状态条）。
    expect(container.querySelector('.palm-proc-main')!.textContent).toBe('12 次工具调用')
    expect(container.querySelector('.palm-proc')!.getAttribute('aria-label') ?? container.textContent).toContain('改 1,234 个文件')
  })

  it('没有改动就不占位（0 / 不传都不画）', () => {
    const zero = render(<ProcessLine toolCalls={3} files={0} />)
    expect(zero.container.querySelector('.palm-proc-files')).toBeNull()
    zero.unmount()
    const none = render(<ProcessLine toolCalls={3} />)
    expect(none.container.querySelector('.palm-proc-files')).toBeNull()
  })

  /** 2026-11-11 用户：报错里的那个数字也要同款滚动（`2 处报错` 的 2）。 */
  it('报错信号里的数字走滚动，文案与读屏文本一字不变', () => {
    const { container } = render(<ProcessLine toolCalls={12} note="2 处报错" />)
    const note = container.querySelector('.palm-proc-note')!
    expect(note.querySelectorAll('.palm-roll')).toHaveLength(1)
    expect(note.textContent).toBe('2 处报错')
    expect(container.querySelector('.palm-proc')!.getAttribute('aria-label') ?? '').toContain('2 处报错')
  })

  it('报错文案不是「数字 + 后缀」时原样输出（不猜格式、不丢字）', () => {
    const { container } = render(<ProcessLine toolCalls={12} note="模型调用失败" />)
    const note = container.querySelector('.palm-proc-note')!
    expect(note.querySelectorAll('.palm-roll')).toHaveLength(0)
    expect(note.textContent).toBe('模型调用失败')
  })
})
