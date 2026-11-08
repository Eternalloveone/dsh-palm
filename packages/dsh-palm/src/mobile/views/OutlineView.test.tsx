// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OutlineView } from './OutlineView.tsx'
import { formatTime } from '../shared/time.ts'
import type { TurnEntry } from '../session/turn-outline.ts'

/** 造一轮（默认已加载、有回复、带一句可读的结论）。 */
function entry(
  turn: number,
  options: { prompt?: string; response?: string; at?: number; loaded?: boolean } = {},
): TurnEntry {
  const {
    prompt = `第 ${turn} 轮的问题`,
    response = `第 ${turn} 轮的结论`,
    at,
    loaded = true,
  } = options
  return { turn, seq: turn * 10, prompt, response, loaded, ...(at === undefined ? {} : { at }) }
}

/** 当前节点里的结论标题文本。 */
function titleOf(node: Element | null): string | null | undefined {
  return node?.querySelector('.outline-node-title')?.textContent
}

afterEach(() => { cleanup() })

describe('回合大纲页（P6 ⑫ 屏）', () => {
  it('标题与总轮数固定，每一轮渲染一个时间轴节点', () => {
    render(
      <OutlineView
        entries={[entry(1), entry(2), entry(3)]}
        currentTurn={3}
        onBack={() => {}}
        onPick={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('回合大纲')
    expect(screen.getByText('共 3 轮')).toBeDefined()
    // 节点数量 = 轮次数量，且按轮次升序排列。
    const nodes = document.querySelectorAll('.outline-node')
    expect(nodes).toHaveLength(3)
    expect([...nodes].map(node => node.querySelector('.outline-node-turn')?.textContent)).toEqual([
      '第 1 轮',
      '第 2 轮',
      '第 3 轮',
    ])
  })

  it('节点标题是这一轮的结论首行（不是提问），没有回复才退回提问', () => {
    render(
      <OutlineView
        entries={[
          entry(1, { prompt: '先看看项目结构', response: '项目是 monorepo，包在 packages 下。' }),
          entry(2, { prompt: '把测试跑通', response: '```\nnpm test\n```\n## 测试全绿\n还有 3 条待补。' }),
          entry(3, { prompt: '这句是提问', response: '' }),
        ]}
        currentTurn={0}
        onBack={() => {}}
        onPick={() => {}}
      />,
    )
    const nodes = document.querySelectorAll('.outline-node')
    expect(titleOf(nodes[0] ?? null)).toBe('项目是 monorepo，包在 packages 下。')
    // markdown 结构行（围栏代码块、标题井号）不当作"一句话"。
    expect(titleOf(nodes[1] ?? null)).toBe('测试全绿')
    expect(titleOf(nodes[2] ?? null)).toBe('这句是提问')
  })

  it('节点显示这一轮开始的时间；宿主独有的未加载轮次没有时间就如实不给', () => {
    const at = new Date(2026, 10, 8, 13, 16, 0).getTime()
    render(
      <OutlineView
        entries={[entry(1, { at }), entry(2, { loaded: false })]}
        currentTurn={0}
        onBack={() => {}}
        onPick={() => {}}
      />,
    )
    const nodes = document.querySelectorAll('.outline-node')
    expect(nodes[0]?.querySelector('.outline-node-time')?.textContent).toBe(formatTime(at))
    expect(nodes[1]?.querySelector('.outline-node-time')).toBeNull()
    expect(nodes[1]?.textContent).toContain('未加载')
  })

  it('当前所在的回合整行高亮，并标「正在看」', () => {
    render(
      <OutlineView
        entries={[entry(1), entry(2), entry(3)]}
        currentTurn={2}
        onBack={() => {}}
        onPick={() => {}}
      />,
    )
    const current = document.querySelector('[aria-current="true"]')
    expect(current).not.toBeNull()
    expect(current?.textContent).toContain('第 2 轮的结论')
    expect(current?.textContent).toContain('正在看')
    // 只有一个当前节点：第 1、3 轮都不许被标成正在看。
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
    expect(document.querySelectorAll('.outline-node-mark')).toHaveLength(1)
  })

  it('点某一轮把整条 entry 交给调用方（跳转逻辑不在这一屏）', () => {
    const onPick = vi.fn()
    const target = entry(7, { response: '第七轮的结论' })
    render(<OutlineView entries={[entry(1), target]} currentTurn={1} onBack={() => {}} onPick={onPick} />)
    screen.getByText('第七轮的结论').closest('button')!.click()
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(target)
  })

  it('返回按钮交回上一页', () => {
    const onBack = vi.fn()
    render(<OutlineView entries={[entry(1)]} currentTurn={1} onBack={onBack} onPick={() => {}} />)
    screen.getByRole('button', { name: '返回' }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('空会话给一句解释，不是空白页', () => {
    render(<OutlineView entries={[]} currentTurn={0} onBack={() => {}} onPick={() => {}} />)
    expect(screen.getByText(/还没有可跳转的轮次/)).toBeDefined()
    expect(document.querySelectorAll('.outline-node')).toHaveLength(0)
    expect(screen.getByText('共 0 轮')).toBeDefined()
  })

  it('超长会话只渲染最近 200 轮，并说明原因', () => {
    const many = Array.from({ length: 260 }, (_, index) => entry(index + 1))
    render(<OutlineView entries={many} currentTurn={260} onBack={() => {}} onPick={() => {}} />)
    expect(document.querySelectorAll('.outline-node')).toHaveLength(200)
    expect(screen.getByText(/只显示最近 200 轮/)).toBeDefined()
    // 最近一轮在列表里，最早的不在（"第 N 轮"在序号与默认提问里都会出现，用 getAll 判存在）。
    expect(screen.getAllByText('第 260 轮').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('第 1 轮')).toHaveLength(0)
  })

  it('过长标题会截断成一行，不会吃掉半屏', () => {
    const long = '这一轮的结论很长很长'.repeat(10)
    render(<OutlineView entries={[entry(1, { response: long })]} currentTurn={1} onBack={() => {}} onPick={() => {}} />)
    const title = document.querySelector('.outline-node-title')
    expect(title?.textContent?.endsWith('…')).toBe(true)
  })
})
