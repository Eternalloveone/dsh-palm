// @vitest-environment jsdom
/**
 * GoalBar：桌面端目标条的复刻。这里锁住四件事 ——
 * 没有目标不占位、相位文案正确、四个动作各自发出哪条 `/goal` 命令、
 * 以及 busy 时不许连点（连点会发出两条命令，宿主管线里第二条一定失败）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GoalBar, type GoalBarProps } from './goal-bar.tsx'
import type { MobileGoal } from './goal-projection.ts'

const goal = (overrides: Partial<MobileGoal> = {}): MobileGoal => ({
  id: 'g-1',
  objective: '把手机端目标条做出来',
  phase: 'active',
  ...overrides,
})

function baseProps(overrides: Partial<GoalBarProps> = {}): GoalBarProps {
  return { goal: goal(), onCommand: vi.fn(), ...overrides }
}

describe('GoalBar', () => {
  beforeEach(() => { cleanup() })
  afterEach(() => { cleanup() })

  it('renders nothing while loading, without a goal, or after the goal completed', () => {
    // undefined = 还没读到；null = 没有目标。两种都不占位（桌面端同一条规则）。
    expect(render(<GoalBar {...baseProps({ goal: undefined })} />).container.firstChild).toBeNull()
    cleanup()
    expect(render(<GoalBar {...baseProps({ goal: null })} />).container.firstChild).toBeNull()
  })

  it('shows the phase label and the objective', () => {
    render(<GoalBar {...baseProps()} />)
    expect(screen.getByText('进行中的目标')).toBeTruthy()
    expect(screen.getByText('把手机端目标条做出来')).toBeTruthy()
  })

  it('sends /goal pause while active and /goal resume while paused', () => {
    const onCommand = vi.fn()
    render(<GoalBar {...baseProps({ onCommand })} />)
    fireEvent.click(screen.getByText('暂停'))
    expect(onCommand).toHaveBeenCalledWith('/goal pause')
    cleanup()

    const resume = vi.fn()
    render(<GoalBar {...baseProps({ goal: goal({ phase: 'paused' }), onCommand: resume })} />)
    expect(screen.getByText('已暂停的目标')).toBeTruthy()
    fireEvent.click(screen.getByText('继续'))
    expect(resume).toHaveBeenCalledWith('/goal resume')
  })

  it('clears through /goal clear', () => {
    const onCommand = vi.fn()
    render(<GoalBar {...baseProps({ onCommand })} />)
    fireEvent.click(screen.getByLabelText('清除目标'))
    expect(onCommand).toHaveBeenCalledWith('/goal clear')
  })

  it('edits through /goal edit with the draft text', () => {
    const onCommand = vi.fn()
    render(<GoalBar {...baseProps({ onCommand })} />)
    fireEvent.click(screen.getByText('编辑'))
    const input = screen.getByLabelText('目标正文') as HTMLInputElement
    expect(input.value).toBe('把手机端目标条做出来')
    fireEvent.change(input, { target: { value: '换成新的目标' } })
    fireEvent.click(screen.getByText('保存'))
    expect(onCommand).toHaveBeenCalledWith('/goal edit 换成新的目标')
  })

  it('does not submit an empty edit', () => {
    const onCommand = vi.fn()
    render(<GoalBar {...baseProps({ onCommand })} />)
    fireEvent.click(screen.getByText('编辑'))
    fireEvent.change(screen.getByLabelText('目标正文'), { target: { value: '   ' } })
    const save = screen.getByText('保存') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    expect(onCommand).not.toHaveBeenCalled()
  })

  it('expands to a readable full text: original line breaks, own block, no narrow button', () => {
    // 真机现场：一段带小标题、空行、编号的目标展开后被挤在按钮里（宽度被右边四个
    // 动作按钮切走一截），12px + 单倍行高，读起来是一条没有段落的文字墙。
    // 展开必须是独立正文块，且保留宿主给的原始换行。
    const longObjective = '## 完成定义\n1. 把候选项收敛到 1 个\n\n2. 冷启动 3 轮不挂\n   - 证据目录 + 根因报告'
    render(<GoalBar {...baseProps({ goal: goal({ objective: longObjective }) })} />)
    const body = screen.queryByRole('region', { name: '目标全文' })
    expect(body).toBeNull()
    fireEvent.click(screen.getByText('进行中的目标'))
    const opened = screen.getByRole('region', { name: '目标全文' })
    expect(opened.textContent).toBe(longObjective)
    expect(opened.textContent).toContain('\n\n')
    // 收起时那一行省略号必须让位，否则同一段文字会在条子里出现两次。
    expect(screen.queryByText(longObjective)).toBeNull()
  })

  it('collapses again from a visible control and from the text itself', () => {
    // 真机反馈：展开后没有出口 —— 展开的正文占满整条，手指落在文字上什么都不做，
    // 只剩点标题那一条缝能收，等于收不回来。
    render(<GoalBar {...baseProps()} />)
    fireEvent.click(screen.getByText('进行中的目标'))
    expect(screen.getByRole('region', { name: '目标全文' })).toBeTruthy()
    fireEvent.click(screen.getByLabelText('收起目标全文'))
    expect(screen.queryByRole('region', { name: '目标全文' })).toBeNull()
    // 再展开一次，这回直接点正文。
    fireEvent.click(screen.getByText('进行中的目标'))
    fireEvent.click(screen.getByRole('region', { name: '目标全文' }))
    expect(screen.queryByRole('region', { name: '目标全文' })).toBeNull()
  })

  it('keeps the text open when the tap ended a text selection', () => {
    // 手指在文字上拖出选区是在复制，不是在折叠：这时不能收。
    render(<GoalBar {...baseProps()} />)
    fireEvent.click(screen.getByText('进行中的目标'))
    const body = screen.getByRole('region', { name: '目标全文' })
    const original = window.getSelection
    window.getSelection = () => ({ toString: () => '## 完成定义' }) as unknown as Selection
    try {
      fireEvent.click(body)
      expect(screen.getByRole('region', { name: '目标全文' })).toBeTruthy()
    } finally {
      window.getSelection = original
    }
  })

  it('surfaces the blocked reason', () => {
    render(<GoalBar {...baseProps({ goal: goal({ phase: 'blocked', blockedReason: '代理不在线' }) })} />)
    expect(screen.getByText('受阻的目标')).toBeTruthy()
    expect(screen.getByText('代理不在线')).toBeTruthy()
  })
  it('shows the blocked reason folded to two lines until asked to expand', () => {
    // 真机：宿主把整段排查记录塞进阻塞理由，一条目标条就吃掉大半个屏幕。默认只露两行，
    // 点「展开理由」才铺开；收起态必须是真折叠（class 上带 collapsed），而不是截断字符串。
    render(<GoalBar {...baseProps({ goal: goal({ phase: 'blocked', blockedReason: '代理不在线' }) })} />)
    const folded = screen.getByLabelText('展开阻塞理由')
    expect(folded.className).toContain('chat-goal-reason-collapsed')
    expect(folded.getAttribute('aria-expanded')).toBe('false')
    // 原文一字不少：折叠只是视觉上的两行高度。
    expect(folded.textContent).toBe('代理不在线')
    fireEvent.click(screen.getByText('展开理由'))
    const open = screen.getByLabelText('收起阻塞理由')
    expect(open.className).not.toContain('chat-goal-reason-collapsed')
    expect(open.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByText('收起理由'))
    expect(screen.getByLabelText('展开阻塞理由')).toBeTruthy()
  })

  it('refuses every command while a previous one is in flight', () => {
    const onCommand = vi.fn()
    render(<GoalBar {...baseProps({ onCommand, busy: true })} />)
    fireEvent.click(screen.getByLabelText('清除目标'))
    fireEvent.click(screen.getByText('暂停'))
    expect(onCommand).not.toHaveBeenCalled()
  })
})
