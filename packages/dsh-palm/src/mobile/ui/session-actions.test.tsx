// @vitest-environment jsdom
/**
 * 会话动作面板的契约（2026-11-12 用户：「置顶和删除按钮太丑了」）。
 *
 * 钉住四件事：
 * 1. 动作页：预览里要有**标题**（确认操作对象），两项动作各自带说明文字；
 * 2. 确认页：说清「删的是哪条」+ 后果，且不能直接删 —— 必须先经过确认页；
 * 3. 「取消」在确认页是**退回动作页**（不关面板），在动作页才是关面板；
 * 4. 已置顶时第一项写「取消置顶」，别让用户点了才发现方向反了。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionActions, type SessionActionsProps } from './session-actions.tsx'

afterEach(() => { cleanup() })

function renderActions(overrides: Partial<SessionActionsProps> = {}): {
  props: SessionActionsProps
  container: HTMLElement
} {
  const props: SessionActionsProps = {
    title: '梳理 dsh palm 源码问题评估',
    meta: '今天 21:25 · dsh-palm',
    pinned: false,
    confirming: false,
    onTogglePin: vi.fn(),
    onDelete: vi.fn(),
    onCancelConfirm: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  const { container } = render(<SessionActions {...props} />)
  return { props, container }
}

describe('动作页', () => {
  it('预览里同时有标题和时间·工作区（确认动的是哪一条）', () => {
    renderActions()
    expect(screen.getByText('梳理 dsh palm 源码问题评估')).toBeTruthy()
    expect(screen.getByText('今天 21:25 · dsh-palm')).toBeTruthy()
  })

  it('两项动作都带说明文字', () => {
    renderActions()
    const notes = [...document.querySelectorAll('.palm-actions-item-note')].map(node => node.textContent)
    expect(notes).toEqual(['固定在列表最前', '不可恢复'])
  })

  it('未置顶时第一项是「置顶」', () => {
    const { props } = renderActions({ pinned: false })
    fireEvent.click(screen.getByText('置顶'))
    expect(props.onTogglePin).toHaveBeenCalledTimes(1)
  })

  it('已置顶时第一项变成「取消置顶」', () => {
    renderActions({ pinned: true })
    expect(screen.getByText('取消置顶')).toBeTruthy()
    expect(screen.queryByText('置顶')).toBeNull()
  })

  it('点「取消」关掉面板', () => {
    const { props } = renderActions()
    fireEvent.click(screen.getByText('取消'))
    expect(props.onClose).toHaveBeenCalledTimes(1)
    expect(props.onCancelConfirm).not.toHaveBeenCalled()
  })

  it('点「删除」只发出删除请求，不在这一页直接删', () => {
    const { props } = renderActions()
    fireEvent.click(screen.getByText('删除'))
    expect(props.onDelete).toHaveBeenCalledTimes(1)
    // 真删与否由调用方按 confirming 决定；这一页不该自己调 onClose。
    expect(props.onClose).not.toHaveBeenCalled()
  })
})

describe('确认页', () => {
  it('标题写「删除这条会话？」，正文重复会话名与后果', () => {
    renderActions({ confirming: true })
    expect(screen.getByText('删除这条会话？')).toBeTruthy()
    expect(document.querySelector('.palm-actions-confirm-body b')?.textContent).toBe('梳理 dsh palm 源码问题评估')
    expect(screen.getByText(/手机端无法恢复/)).toBeTruthy()
  })

  it('确认页没有「置顶」项（动作不混在一起）', () => {
    renderActions({ confirming: true })
    expect(screen.queryByText('置顶')).toBeNull()
    expect(screen.queryByText('取消置顶')).toBeNull()
  })

  it('「取消」退回动作页而不是关面板', () => {
    const { props } = renderActions({ confirming: true })
    fireEvent.click(screen.getByText('取消'))
    expect(props.onCancelConfirm).toHaveBeenCalledTimes(1)
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('点「删除」才执行删除', () => {
    const { props } = renderActions({ confirming: true })
    fireEvent.click(screen.getByText('删除'))
    expect(props.onDelete).toHaveBeenCalledTimes(1)
  })
})

describe('浮层行为', () => {
  it('点遮罩关闭面板', () => {
    const { props } = renderActions()
    const scrim = document.querySelector('.palm-actions-scrim')
    expect(scrim).not.toBeNull()
    fireEvent.click(scrim as HTMLElement)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('点面板内部不关闭（事件不冒到遮罩）', () => {
    const { props } = renderActions()
    fireEvent.click(document.querySelector('.palm-actions') as HTMLElement)
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('面板挂在 body 上（抽屉带 transform，留在里面只会盖住抽屉）', () => {
    const { container } = renderActions()
    expect(container.contains(document.querySelector('.palm-actions-scrim'))).toBe(false)
    expect(document.body.contains(document.querySelector('.palm-actions-scrim'))).toBe(true)
  })
})
