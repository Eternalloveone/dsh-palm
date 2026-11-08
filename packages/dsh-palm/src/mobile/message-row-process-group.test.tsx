// @vitest-environment jsdom
/**
 * 过程卡（工具调用块）的渲染契约 —— 2026-11-08 按对照稿重排后：
 * 1. 独立一张卡：标题行「跑了 N 个工具」+ 右侧总耗时；
 * 2. 工具行**默认可见**（以前藏在折叠体里）：彩色状态点 + 动作 · 对象 + 状态词，
 *    状态只认宿主真报过的（ok / running / error / stopped），没有就是灰点；
 * 3. 展开体只放思考、叙述文本与 diff 卡，答案永远在卡外；
 * 4. 关掉"显示工具调用"只藏工具行，不挡思考、用时与 diff 卡；
 * 5. 报错信号是纯文字（「2 处报错」），不用 ⚠ 之类的字形；
 * 6. 步数进展开体（「共 N 步」），卡面只有工具数与总耗时。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MessageRow, resetTurnAnchors } from './render/message-row.tsx'
import type { RenderMessage, ToolCallInfo } from './render/messages.ts'

const diffTool: ToolCallInfo = {
  callId: 'c1',
  name: 'write',
  state: 'ok',
  arguments: '{"file_path":"a.txt"}',
  view: { card: 'diff', title: 'Write a.txt', diffs: [{ path: 'a.txt', oldText: 'old line\n', newText: 'new line\n' }] },
}

function assistant(overrides: Partial<RenderMessage> & Pick<RenderMessage, 'text'>): RenderMessage {
  return { id: 'a-1', kind: 'assistant', seq: 9, time: 100_000, pending: false, ...overrides }
}

function renderRow(message: RenderMessage, showToolCalls = true, liveTurn?: number) {
  return render(
    <MessageRow
      message={message}
      showToolCalls={showToolCalls}
      showSystemMessages={false}
      {...(liveTurn !== undefined ? { liveTurn } : {})}
    />,
  )
}

// 秒表锚点记忆落在 sessionStorage：整轮跑时会被别的用例继承，必须在**每条用例**前清掉。
beforeEach(() => { resetTurnAnchors() })

describe('过程卡：独立一张卡，标题行 + 常显工具行', () => {
  const message = assistant({
    text: '第一段\n\n第二段',
    durationMs: 384_000,
    flow: [
      { kind: 'reasoning', text: '先想一下' },
      { kind: 'tool', callId: 'c1' },
      { kind: 'text', text: '第一段', seq: 5 },
      { kind: 'text', text: '第二段' },
    ],
    tools: [diffTool],
  })

  it('标题行单行：跑了几个工具 + 右侧总耗时；工具行默认可见，答案在卡外', () => {
    const { container } = renderRow(message)

    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(head.querySelectorAll('.chat-proc-line')).toHaveLength(1)
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('跑了 1 个工具')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时6分24秒')
    // 卡面没有步数（步数进展开体）。
    expect(head.textContent).not.toContain('步')

    // 工具行常显：绿点 + 动作 · 对象 + 状态词。
    const row = container.querySelector('.chat-step') as HTMLElement
    expect(row).not.toBeNull()
    expect(row.getAttribute('data-state')).toBe('ok')
    expect(row.querySelector('.chat-step-dot')!.getAttribute('data-state')).toBe('ok')
    expect(row.getAttribute('data-step-title')).toBe('写入')
    expect(row.querySelector('.chat-step-summary')!.textContent).toBe('a.txt')
    expect(row.querySelector('.chat-step-state')!.textContent).toBe('完成')

    // 答案（单步整行文本）在卡外，先看到。
    expect(screen.getByText(/第一段/)).toBeTruthy()
    // 展开体默认折叠：思考、diff 卡、步数首行都不在 DOM 里。
    expect(container.querySelector('.chat-proc-body')).toBeNull()
    expect(container.querySelector('.chat-think')).toBeNull()
    expect(container.querySelector('.chat-artifact')).toBeNull()
    expect(container.querySelector('.chat-proc-steps')).toBeNull()
  })

  it('展开后思考/叙述/diff 卡出现，工具行留在卡面', () => {
    const { container } = renderRow(message)
    fireEvent.click(container.querySelector('.chat-proc-head') as HTMLButtonElement)

    const body = container.querySelector('.chat-proc-body') as HTMLElement
    expect(body).not.toBeNull()
    // 步数首行进展开体。
    expect(body.querySelector('.chat-proc-steps')!.textContent).toBe('共 1 步')
    // 思考只报行数，正文还没进 DOM。
    expect(container.querySelector('.chat-think-label')!.textContent).toBe('深度思考 · 1 行')
    expect(screen.queryByText('先想一下')).toBeNull()
    fireEvent.click(container.querySelector('.chat-think-head') as HTMLButtonElement)
    expect(screen.getByText('先想一下')).toBeTruthy()

    // 工具行不在展开体里（它一直在卡面）。
    expect(body.querySelector('.chat-step')).toBeNull()
    expect(container.querySelectorAll('.chat-step')).toHaveLength(1)
    // diff 卡在展开体里。
    expect(body.querySelector('.chat-artifact')).not.toBeNull()
  })

  it('关掉"显示工具调用"：只藏工具行，思考、用时与 diff 卡都还在', () => {
    const { container } = renderRow(message, false)
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    // 工具行藏了 ⇒ 标题退回状态词，不声称"跑了 N 个工具"。
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时6分24秒')
    expect(container.querySelectorAll('.chat-step')).toHaveLength(0)

    fireEvent.click(head)
    expect(container.querySelector('.chat-think')).not.toBeNull()
    expect(container.querySelector('.chat-artifact-title')!.textContent).toBe('Write a.txt')
    // 工具行不渲染 ⇒ 展开体也不声称步数（沿用旧行为）。
    expect(container.querySelector('.chat-proc-steps')).toBeNull()
  })
})

describe('过程卡：答案按步骤切在卡外', () => {
  it('多步：最后一步的文本是卡外答案，之前各步文本留卡内', () => {
    const { container } = renderRow(assistant({
      text: '先看结构\n\n改完了',
      stepSeqs: [5, 12],
      stepTexts: ['先看结构', '改完了'],
      flow: [
        { kind: 'text', text: '先看结构', seq: 5 },
        { kind: 'tool', callId: 'c1' },
        { kind: 'text', text: '改完了', seq: 12 },
      ],
      tools: [diffTool],
    }))

    fireEvent.click(container.querySelector('.chat-proc-head') as HTMLButtonElement)

    // 卡内：第一步的叙述文本还在（带定位锚点）。
    const inGroup = container.querySelector('.chat-proc-body')!
    const anchored = inGroup.querySelector('[data-step-seq]') as HTMLElement
    expect(anchored.getAttribute('data-step-seq')).toBe('5')
    expect(anchored.textContent).toContain('先看结构')
    // 卡外：最后一步的文本是答案，且不在卡内重复。
    const answer = container.querySelector('.chat-flow-answer') as HTMLElement
    expect(answer).not.toBeNull()
    expect(answer.getAttribute('data-step-seq')).toBe('12')
    expect(answer.textContent).toContain('改完了')
    expect(inGroup.textContent).not.toContain('改完了')
  })

  it('纯文本回合没有过程行：头是静态的，照样显示用时', () => {
    const { container } = renderRow(assistant({ text: '就一句话', durationMs: 19_000 }))

    const head = container.querySelector('.chat-proc-head-static') as HTMLElement
    expect(head).not.toBeNull()
    expect(head.getAttribute('role')).toBe('status')
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时19秒')
    expect(head.getAttribute('aria-label')).toBe('已完成，用时19秒')
    expect(head.querySelector('.chat-proc-caret')).toBeNull()
    expect(head.getAttribute('aria-expanded')).toBeNull()
    expect(container.querySelectorAll('button.chat-proc-head')).toHaveLength(0)
    expect(screen.getByText('就一句话')).toBeTruthy()
  })
})

describe('过程卡：四态与报错信号', () => {
  it('failed 回合：头带 data-state=failed，工具行照实报自己的状态', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 5_000,
      failed: true,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [diffTool],
    }))

    const head = container.querySelector('.chat-proc-head') as HTMLElement
    expect(head.getAttribute('data-state')).toBe('failed')
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('跑了 1 个工具')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时5秒')
    // 工具本身是完成的：行上照实写"完成"，不因整轮失败而冒充工具失败。
    expect(container.querySelector('.chat-step-state')!.textContent).toBe('完成')
  })

  it('maxTokens / stopped 回合：头读"已中断"（data-state=stopped）', () => {
    const truncated = renderRow(assistant({
      text: '答案',
      durationMs: 5_000,
      maxTokens: true,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ callId: 'c1', name: 'bash', state: 'ok', arguments: '{"cmd":"ls"}' }],
    }))
    expect(truncated.container.querySelector('.chat-proc-head')!.getAttribute('data-state')).toBe('stopped')
    truncated.unmount()

    const stopped = renderRow(assistant({
      text: '答案',
      durationMs: 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ ...diffTool, state: 'stopped' }],
    }))
    expect(stopped.container.querySelector('.chat-proc-head')!.getAttribute('data-state')).toBe('stopped')
    expect(stopped.container.querySelector('.chat-step-state')!.textContent).toBe('已中断')
  })

  it('有报错步骤 ⇒ 纯文字报错标记；位置在状态词之后、用时之前，不用 ⚠', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'tool', callId: 'c2' }],
      tools: [
        { ...diffTool, state: 'error' },
        { callId: 'c2', name: 'bash', state: 'error', arguments: '{"cmd":"false"}' },
      ],
    }))

    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    const marker = head.querySelector('.chat-proc-errors') as HTMLElement
    expect(marker).not.toBeNull()
    expect(marker.textContent).toBe('2 处报错')
    const line = head.querySelector('.chat-proc-label') as HTMLElement
    expect(Array.from(line.children).map(el => (el as HTMLElement).className.split(' ')[0]))
      .toEqual(['chat-proc-state', 'chat-proc-errors', 'chat-proc-time'])
    expect(head.textContent).not.toContain('⚠')
  })

  it('无报错步骤 ⇒ 完全不出现报错标记（不留空占位）', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [diffTool],
    }))
    const head = container.querySelector('.chat-proc-head') as HTMLElement
    expect(head.querySelector('.chat-proc-errors')).toBeNull()
    expect(head.textContent).not.toContain('报错')
  })

  it('卡面不出现"N 步"；展开后首行报步数，diff 卡统计也在展开体里', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 105_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [diffTool],
    }))

    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时1分45秒')
    expect(head.textContent).not.toContain('步')
    expect(container.querySelector('.chat-step-tally')).toBeNull()
    expect(container.querySelector('.chat-step-tally-add')).toBeNull()

    fireEvent.click(head)
    expect(container.querySelector('.chat-proc-body > .chat-proc-steps')!.textContent).toBe('共 1 步')
    expect(container.querySelector('.chat-artifact-stat-add')!.textContent).toBe('+1')
  })
})

describe('过程卡：运行中与秒表', () => {
  const runningTool: ToolCallInfo = { callId: 'c1', name: 'bash', state: 'running', arguments: '{"cmd":"pytest -q"}' }

  it('运行中：根节点带 chat-proc-running，蓝点 + 运行中，不足 3 秒不报秒数', () => {
    const { container } = renderRow(assistant({
      text: '',
      pending: true,
      turnStartAt: Date.now(),
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [runningTool],
    }))

    const group = container.querySelector('.chat-proc') as HTMLElement
    expect(group.className).toContain('chat-proc-running')
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('跑了 1 个工具')
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    const dot = container.querySelector('.chat-step-dot') as HTMLElement
    expect(dot.getAttribute('data-state')).toBe('running')
    expect(container.querySelector('.chat-step-state')!.textContent).toBe('运行中')
  })

  it('运行中：过了 3 秒阈值才报实时用时', () => {
    const { container } = renderRow(assistant({
      text: '',
      pending: true,
      turnStartAt: Date.now() - 213_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [runningTool],
    }))
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('跑了 1 个工具')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时3分33秒')
  })

  it('宿主按步发消息：pending 已落下但还有工具在跑，仍是运行中（秒表不消失）', () => {
    const { container } = renderRow(assistant({
      text: '',
      pending: false,
      turnStartAt: Date.now() - 213_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [runningTool],
    }))

    expect(container.querySelector('.chat-proc')!.className).toContain('chat-proc-running')
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时3分33秒')
    expect(container.querySelector('.chat-step-state')!.textContent).toBe('运行中')
  })
})

describe('过程卡：按步定格的行靠"活跃轮次"判还在跑（真机 17:52）', () => {
  const bashOk: ToolCallInfo = { callId: 'c1', name: 'bash', state: 'ok', arguments: '{"cmd":"Recompile Debug.c"}' }

  const frozenStep = (overrides: Partial<RenderMessage> = {}): RenderMessage => assistant({
    text: '',
    turn: 7,
    step: 3,
    pending: false,
    flow: [{ kind: 'tool', callId: 'c1' }],
    tools: [bashOk],
    ...overrides,
  })

  it('① 活跃轮次里的定格行：卡带 chat-proc-running、过 3 秒报实时用时；工具行仍是"完成"', () => {
    const { container } = renderRow(frozenStep({ turnStartAt: Date.now() - 213_000 }), true, 7)

    expect(container.querySelector('.chat-proc')!.className).toContain('chat-proc-running')
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('跑了 1 个工具')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时3分33秒')
    expect(container.querySelector('.chat-step-state')!.textContent).toBe('完成')
  })

  it('① 行自己没有 turnStartAt 时，页级锚点兜住秒表', () => {
    const { container } = render(
      <MessageRow
        message={frozenStep()}
        showToolCalls={true}
        showSystemMessages={false}
        liveTurn={7}
        liveTurnStartAt={Date.now() - 95_000}
      />,
    )
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时1分35秒')
  })

  it('① 连页级锚点都没有 ⇒ 不报秒表（锚点只认宿主时间）', () => {
    const { container } = renderRow(frozenStep({ firstSeenAt: Date.now() - 4_000 }), true, 7)
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-time')).toBeNull()
  })

  it('② turn/end 到了（活跃轮次翻走）⇒ 卡立刻落定，秒表定格', () => {
    const live = renderRow(frozenStep(), true, 7)
    expect(live.container.querySelector('.chat-proc')!.className).toContain('chat-proc-running')
    live.unmount()

    const { container } = renderRow(frozenStep({ durationMs: 105_000 }), true, 8)
    expect(container.querySelector('.chat-proc')!.className).not.toContain('chat-proc-running')
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时1分45秒')
  })
})

describe('过程卡：续跑不编造', () => {
  it('答案永远留在卡外、折叠时也可见', () => {
    const { container } = renderRow(assistant({
      text: '接着写完了',
      durationMs: 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'text', text: '接着写完了', seq: 4 }],
      tools: [diffTool],
    }))

    const answer = container.querySelector('.chat-flow-answer') as HTMLElement
    expect(answer).not.toBeNull()
    expect(container.querySelector('.chat-proc')!.contains(answer)).toBe(false)
    expect(container.querySelector('.chat-proc-body')).toBeNull()
    expect(screen.getByText('接着写完了')).toBeTruthy()
  })
})

describe('回合尾报告卡：只报交回了什么', () => {
  it('交付卡默认折叠，点头部才展开清单', () => {
    const { container } = renderRow({
      id: 'turn-tail:0',
      kind: 'turn',
      text: '',
      seq: 19,
      time: 200_000,
      turn: 1,
      durationMs: 384_000,
      deliverables: [{ path: 'report.md', description: '交付报告' }],
      produced: ['src/a.ts'],
    })

    const head = container.querySelector('.chat-turn-tail-head')!
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.chat-turn-tail-count')!.textContent).toBe('2 个文件')
    expect(container.textContent).not.toContain('交付物')
    expect(container.textContent).not.toContain('本轮产出文件')

    fireEvent.click(head)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('交付物')
    expect(container.textContent).toContain('本轮产出文件')
  })

  it('有交付物与产出文件时报数量、列清单、打"已交付"徽标', () => {
    const { container } = renderRow({
      id: 'turn-tail:1',
      kind: 'turn',
      text: '',
      seq: 20,
      time: 200_000,
      turn: 1,
      durationMs: 384_000,
      deliverables: [{ path: 'report.md', description: '交付报告' }],
      produced: ['src/a.ts'],
    })

    expect(container.querySelector('.chat-turn-tail-title')!.textContent).toBe('本轮产出')
    expect(container.querySelector('.chat-turn-tail-count')!.textContent).toBe('2 个文件')
    fireEvent.click(container.querySelector('.chat-turn-tail-head')!)
    expect(container.textContent).toContain('交付物')
    expect(container.textContent).toContain('本轮产出文件')
    expect(container.querySelector('.chat-turn-tail-badge')!.textContent).toBe('已交付')
    expect(container.querySelector('.chat-turn-tail-time')).toBeNull()
    expect(container.textContent).not.toContain('用时')
  })

  it('只有用时的尾巴不再渲染（没有空壳卡）', () => {
    const { container } = renderRow({
      id: 'turn-tail:2',
      kind: 'turn',
      text: '',
      seq: 21,
      time: 200_000,
      turn: 2,
      durationMs: 19_000,
    })
    expect(container.querySelector('.chat-turn-tail')).toBeNull()
  })
})
