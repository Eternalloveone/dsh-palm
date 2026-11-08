// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OutlineView } from './OutlineView.tsx'
import type { TurnEntry } from '../session/turn-outline.ts'

/** 造一轮。 */
function entry(turn: number, prompt: string, loaded = true): TurnEntry {
  return { turn, seq: turn * 10, prompt, response: '', loaded }
}

afterEach(() => { cleanup() })

describe('回合大纲页（P6 ⑫ 屏）', () => {
  it('标题给出总轮数，逐轮列出提问摘要', () => {
    render(
      <OutlineView
        entries={[entry(1, '先看看项目结构'), entry(2, '把测试跑通')]}
        currentTurn={2}
        onBack={() => {}}
        onPick={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('共 2 轮')
    expect(screen.getByText('先看看项目结构')).toBeDefined()
    expect(screen.getByText('把测试跑通')).toBeDefined()
  })

  it('当前轮标「正在看」', () => {
    render(
      <OutlineView entries={[entry(1, 'A'), entry(2, 'B')]} currentTurn={2} onBack={() => {}} onPick={() => {}} />,
    )
    const current = document.querySelector('[aria-current="true"]')
    expect(current?.textContent).toContain('B')
    expect(current?.textContent).toContain('正在看')
  })

  it('还没加载的轮次要标出来（点了会去拉那一页）', () => {
    render(
      <OutlineView entries={[entry(1, '老的一轮', false)]} currentTurn={1} onBack={() => {}} onPick={() => {}} />,
    )
    expect(screen.getByText('未加载')).toBeDefined()
  })

  it('点某轮会把整条 entry 交给调用方', () => {
    const onPick = vi.fn()
    render(<OutlineView entries={[entry(7, '第七轮')]} currentTurn={1} onBack={() => {}} onPick={onPick} />)
    screen.getByText('第七轮').closest('button')!.click()
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ turn: 7 }))
  })

  it('空会话给一句解释，不是空白页', () => {
    render(<OutlineView entries={[]} currentTurn={0} onBack={() => {}} onPick={() => {}} />)
    expect(screen.getByText(/还没有可跳转的轮次/)).toBeDefined()
  })

  it('超长会话只渲染最近 200 轮，并说明原因', () => {
    const many = Array.from({ length: 260 }, (_, index) => entry(index + 1, `第 ${index + 1} 轮`))
    render(<OutlineView entries={many} currentTurn={260} onBack={() => {}} onPick={() => {}} />)
    expect(document.querySelectorAll('.outline-row')).toHaveLength(200)
    expect(screen.getByText(/只显示最近 200 轮/)).toBeDefined()
    // 最近一轮在列表里，最早的不在（"第 N 轮"这串在轮次标签与提问里都会出现，用 getAll 判存在）
    expect(screen.getAllByText('第 260 轮').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('第 1 轮')).toHaveLength(0)
  })

  it('过长提问会截断，不会一行吃掉半屏', () => {
    const long = '这是一句很长很长的提问'.repeat(10)
    render(<OutlineView entries={[entry(1, long)]} currentTurn={1} onBack={() => {}} onPick={() => {}} />)
    const row = document.querySelector('.outline-row-main')
    expect(row?.textContent?.endsWith('…')).toBe(true)
  })
})
