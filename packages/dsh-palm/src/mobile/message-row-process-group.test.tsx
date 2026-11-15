// @vitest-environment jsdom
/**
 * 过程卡（工具调用块）的渲染契约 —— 2026-11-08 按对照稿重排后：
 * 1. 独立一张卡：标题行「12 次工具调用 · 2 处报错」（计时与状态词只在任务头状态条）；
 * 2. 已完成的工具行默认随过程摘要收起；运行中、失败和中断步骤仍直接可见；
 *    展开后显示其余步骤，状态只认宿主真报过的（ok / running / error / stopped）；
 * 3. 展开体只放思考、叙述文本与 diff 卡，答案永远在卡外；
 * 4. 关掉"显示工具调用"只藏工具行，不挡思考与 diff 卡；
 * 5. 报错信号是纯文字（「2 处报错」），不用 ⚠ 之类的字形；
 * 6. 步数进展开体（「共 N 步」），卡面只有工具数。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MessageRow, resetTurnAnchors } from './render/message-row.tsx'
import { resetElapsedSamples } from './message-row/turn-clock.ts'
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
beforeEach(() => { resetTurnAnchors(); resetElapsedSamples() })

describe('过程卡：独立一张卡，标题摘要 + 折叠步骤', () => {
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

  it('标题行单行显示工具数；已完成步骤默认收起，答案留在卡外', () => {
    const { container } = renderRow(message)

    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(head.querySelectorAll('.chat-proc-line')).toHaveLength(1)
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('1 次工具调用')
    // 计时只在任务头状态条：过程头不再挂「用时 X」。
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    expect(head.textContent).not.toContain('用时')
    // 卡面没有步数（步数进展开体）。
    expect(head.textContent).not.toContain('步')

    // 首屏只显示摘要，不把已完成步骤挤在答案旁（DOM 仍保留给无障碍和展开）。
    expect(container.querySelector('.chat-proc')!.getAttribute('data-tools')).toBe('summary')

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

    const row = container.querySelector('.chat-step') as HTMLElement
    expect(row).not.toBeNull()
    expect(row.getAttribute('data-state')).toBe('ok')
    expect(row.querySelector('.chat-step-dot')!.getAttribute('data-state')).toBe('ok')
    expect(row.getAttribute('data-step-title')).toBe('写入')
    expect(row.querySelector('.chat-step-summary')!.textContent).toBe('a.txt')
    expect(row.querySelector('.chat-step-state')!.textContent).toBe('完成')

    const body = container.querySelector('.chat-proc-body') as HTMLElement
    expect(body).not.toBeNull()
    // 步数首行进展开体。
    expect(body.querySelector('.chat-proc-steps')!.textContent).toBe('共 1 步')
    // 思考只报行数，正文还没进 DOM。
    expect(container.querySelector('.chat-think-label')!.textContent).toBe('深度思考 · 1 行')
    expect(screen.queryByText('先想一下')).toBeNull()
    fireEvent.click(container.querySelector('.chat-think-head') as HTMLButtonElement)
    expect(screen.getByText('先想一下')).toBeTruthy()

    // 2026-11-10 方案 B1：工具行也在展开体的时间轴里（不再抽到卡面），
    // 与思考/叙述按事件顺序排；整轮的 diff 卡固定在时间轴末尾。
    expect(body.querySelectorAll('.chat-step')).toHaveLength(1)
    expect(container.querySelectorAll('.chat-step')).toHaveLength(1)
    expect(body.querySelector('.chat-artifact')).not.toBeNull()
  })

  it('关掉"显示工具调用"：只藏工具行，思考与 diff 卡都还在（头行不借状态词补位）', () => {
    const { container } = renderRow(message, false)
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    // 工具行藏了 ⇒ 不声称"跑了 N 个工具"，也不拿状态词补位：落「—」。
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('—')
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    expect(container.querySelectorAll('.chat-step')).toHaveLength(0)

    fireEvent.click(head)
    expect(container.querySelector('.chat-think')).not.toBeNull()
    expect(container.querySelector('.chat-artifact-title')!.textContent).toBe('Write a.txt')
    // 工具行不渲染 ⇒ 展开体也不声称步数（沿用旧行为）。
    expect(container.querySelector('.chat-proc-steps')).toBeNull()
  })
})

describe('过程行：默认只露最近 3 条（2026-11-08 实机投诉：12 条工具刷两屏）', () => {
  const toolsOf = (count: number): ToolCallInfo[] => Array.from({ length: count }, (_, index) => ({
    callId: `c${index}`,
    name: 'bash',
    state: 'ok',
    arguments: JSON.stringify({ cmd: `echo ${index}` }),
  }))
  const flowOf = (count: number) => Array.from({ length: count }, (_, index) => ({ kind: 'tool' as const, callId: `c${index}` }))
  const twelve = assistant({
    text: '答案',
    durationMs: 2_523_000,
    flow: flowOf(12),
    tools: toolsOf(12),
  })

  it('12 次工具调用：折叠只报计数（一条命令都不铺），展开就是完整时间轴', () => {
    const { container } = renderRow(twelve)
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('12 次工具调用')
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    expect(container.querySelector('.chat-proc')!.getAttribute('data-tools')).toBe('summary')
    // 折叠态没有工具行（只有一条「当前命令」行，见 LatestCommand）。
    expect(container.querySelectorAll('.chat-step')).toHaveLength(0)
    fireEvent.click(head)

    // 展开 = 全量时间轴：12 步一行一步，没有「还有 N 步」的分页（2026-11-10 方案 B1）。
    expect(container.querySelectorAll('.chat-proc-body .chat-step')).toHaveLength(12)
    expect(container.querySelector(".chat-step[data-state='fold']")).toBeNull()
    expect([...container.querySelectorAll('.chat-step-summary')].map(node => node.textContent))
      .toEqual(Array.from({ length: 12 }, (_, index) => `echo ${index}`))
  })

  it('工具行与思考按事件顺序交错（不再思考一摞、工具一摞）', () => {
    const interleaved = assistant({
      text: '答案',
      flow: [
        { kind: 'reasoning', text: '先想' },
        { kind: 'tool', callId: 'c0' },
        { kind: 'reasoning', text: '再想' },
        { kind: 'tool', callId: 'c1' },
      ],
      tools: toolsOf(2),
    })
    const { container } = renderRow(interleaved)
    fireEvent.click(container.querySelector('.chat-proc-head') as HTMLButtonElement)
    const body = container.querySelector('.chat-proc-body') as HTMLElement
    const order = [...body.querySelectorAll('.chat-think, .chat-step')]
      .map(node => (node.classList.contains('chat-think') ? 'think' : 'tool'))
    expect(order).toEqual(['think', 'tool', 'think', 'tool'])
  })

  it('3 条以内不出现折叠行（不凭空多一行）', () => {
    const { container } = renderRow(assistant({ text: '答案', flow: flowOf(3), tools: toolsOf(3) }))
    fireEvent.click(container.querySelector('.chat-proc-head') as HTMLButtonElement)
    expect(container.querySelector(".chat-step[data-state='fold']")).toBeNull()
    expect(container.querySelectorAll('.chat-step')).toHaveLength(3)
  })

  it('工具行：状态点 + 「工具名 · 目标」+ 状态词 + 右侧 ›（C1 整行可点，2026-11-10）', () => {
    // 2026-11-10 定版（用户拍板 C1）：**整行可点 + 右侧 ›** 打开详情面板。
    // 之前"不要展开箭头"是因为点开只有一段原始参数、不值得暗示可点；
    // 现在点开是参数/输出/耗时/改动文件的完整面板，箭头才有意义。
    const { container } = renderRow(twelve)
    fireEvent.click(container.querySelector('.chat-proc-head') as HTMLButtonElement)
    const row = container.querySelector(".chat-step[data-state='ok']") as HTMLElement
    expect(row.querySelector('.chat-step-caret')?.textContent).toBe('›')
    expect([...row.querySelector('.chat-step-head')!.children]
      .map(node => (node as HTMLElement).className.split(' ')[0]))
      .toEqual(['chat-step-dot', 'chat-step-title', 'chat-step-summary', 'chat-step-state', 'palm-proc-caret'])
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

  it('纯问答回合不再留一行空过程头（卡面只有一个「—」），任务头照常', () => {
    const { container } = renderRow(assistant({ text: '就一句话', durationMs: 19_000 }))

    // 以前这里会画一个静态过程头，`aria-label` 与可见文字都是「—」：正文上方多一行空壳。
    expect(container.querySelector('.chat-proc')).toBeNull()
    expect(container.textContent).not.toContain('—')
    // 任务头（状态条）保留：它是这一轮「完成 · 19s」的唯一出处。
    expect(container.querySelector('.palm-turn-head')).not.toBeNull()
    expect(screen.getByText('就一句话')).toBeTruthy()
  })

  it('运行中的回合即使还没有工具行，也保留任务头（状态条要能报「思考中」）', () => {
    const { container } = renderRow(
      assistant({ text: '正在想…', pending: true, turnStartAt: Date.now() - 5_000 }),
      true,
      1,
    )
    expect(container.querySelector('.palm-turn-head')).not.toBeNull()
  })

  it('有过程行的回合照样画任务头与过程组', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      tools: [
        { callId: 'c0', name: 'read', state: 'ok', arguments: '{"file_path":"a.ts"}' },
        { callId: 'c1', name: 'read', state: 'ok', arguments: '{"file_path":"b.ts"}' },
      ],
    }))
    expect(container.querySelector('.palm-turn-head')).not.toBeNull()
    expect(container.querySelector('.chat-proc')).not.toBeNull()
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
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('1 次工具调用')
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    // 工具本身是完成的：行上照实写"完成"，不因整轮失败而冒充工具失败。
    fireEvent.click(head)
    expect(container.querySelector('.chat-step-state')!.textContent).toBe('完成')
  })

  it('折叠态保留运行中和失败步骤，收起已完成步骤', () => {
    const { container } = renderRow(assistant({
      text: '处理中',
      pending: true,
      flow: [
        { kind: 'tool', callId: 'done' },
        { kind: 'tool', callId: 'error' },
        { kind: 'tool', callId: 'active' },
      ],
      tools: [
        { ...diffTool, callId: 'done', state: 'ok' },
        { ...diffTool, callId: 'error', state: 'error' },
        { ...diffTool, callId: 'active', state: 'running' },
      ],
    }))
    // 2026-11-10：折叠 + 运行中不再铺工具行，改成**固定一行「当前命令」**。
    // 这一改就是为了止住"每条新命令多一行、整块被顶下去"的跳动；报错行与状态词
    // 仍在过程头（`2 处报错`），展开后才是完整清单。
    expect(container.querySelectorAll('.chat-cmdline')).toHaveLength(1)
    expect(container.querySelector('.chat-cmdline')!.getAttribute('aria-label')).toBe('写入 · a.txt')
    expect(container.querySelectorAll('.chat-step')).toHaveLength(0)
    expect(container.querySelector('.chat-proc')!.getAttribute('data-tools')).toBe('active')

    fireEvent.click(container.querySelector('.chat-proc-head') as HTMLButtonElement)
    expect(container.querySelectorAll(".chat-step[data-state='error']")).toHaveLength(1)
    expect(container.querySelectorAll(".chat-step[data-state='running']")).toHaveLength(1)
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
    // 折叠态只有一条「当前命令」；工具行的状态词要展开后才在时间轴里。
    fireEvent.click(stopped.container.querySelector('.chat-proc-head')!)
    expect(stopped.container.querySelector('.chat-step-state')!.textContent).toBe('已中断')
  })

  it('有报错步骤 ⇒ 纯文字报错标记；位置在计数之后，不再有耗时段，不用 ⚠', () => {
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
      // 第三段是 2026-11-10 加入的「改 N 个文件」（diffTool 带 view ⇒ 有改动）。
      .toEqual(['palm-proc-main', 'palm-proc-note', 'palm-proc-files'])
    expect(head.textContent).not.toContain('⚠')
    expect(head.textContent).not.toContain('用时')
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
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    expect(head.textContent).not.toContain('用时')
    expect(head.textContent).not.toContain('步')
    expect(container.querySelector('.chat-step-tally')).toBeNull()
    expect(container.querySelector('.chat-step-tally-add')).toBeNull()

    fireEvent.click(head)
    expect(container.querySelector('.chat-proc-body > .chat-proc-steps')!.textContent).toBe('共 1 步')
    expect(container.querySelector('.chat-artifact-stat-add')!.textContent).toBe('+1')
  })
})

describe('过程卡：运行中（计时已收进任务头状态条）', () => {
  const runningTool: ToolCallInfo = { callId: 'c1', name: 'bash', state: 'running', arguments: '{"cmd":"pytest -q"}' }

  it('运行中：根节点带 chat-proc-running，蓝点 + 运行中，头行仍然不报秒', () => {
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
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('1 次工具调用')
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    // 2026-11-10：折叠 + 运行中只有一行「当前命令」，状态词由命令条自己给；
    // 展开后才是带状态点的工具行。
    const cmd = container.querySelector('.chat-cmdline') as HTMLElement
    expect(cmd.getAttribute('data-state')).toBe('running')
    fireEvent.click(head)
    const dot = container.querySelector('.chat-step-dot') as HTMLElement
    expect(dot.getAttribute('data-state')).toBe('running')
    expect(container.querySelector('.chat-step-state')!.textContent).toBe('运行中')
  })

  it('运行中：过了 3 秒阈值也不在过程头报用时（同一屏只留状态条那一个计时）', () => {
    const { container } = renderRow(assistant({
      text: '',
      pending: true,
      turnStartAt: Date.now() - 213_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [runningTool],
    }))
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('1 次工具调用')
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    expect(head.textContent).not.toMatch(/\d+分\d+秒|\d+(\.\d+)?s/)
  })

  it('宿主按步发消息：pending 已落下但还有工具在跑，仍是运行中', () => {
    const { container } = renderRow(assistant({
      text: '',
      pending: false,
      turnStartAt: Date.now() - 213_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [runningTool],
    }))

    expect(container.querySelector('.chat-proc')!.className).toContain('chat-proc-running')
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    // 折叠态：状态词在命令条上（`data-state`），工具行要展开才有。
    expect(container.querySelector('.chat-cmdline')!.getAttribute('data-state')).toBe('running')
    fireEvent.click(head)
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

  it('① 活跃轮次里的定格行：卡带 chat-proc-running；头行仍只报计数；工具行仍是"完成"', () => {
    const { container } = renderRow(frozenStep({ turnStartAt: Date.now() - 213_000 }), true, 7)

    expect(container.querySelector('.chat-proc')!.className).toContain('chat-proc-running')
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('1 次工具调用')
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    // 折叠态显示的是"最新一条命令"，它不改变工具行自己的状态；展开后仍读「完成」。
    expect(container.querySelector('.chat-cmdline')).not.toBeNull()
    fireEvent.click(head)
    expect(container.querySelector('.chat-step-state')!.textContent).toBe('完成')
  })

  it('② turn/end 到了（活跃轮次翻走）⇒ 卡立刻落定；过程头始终不带耗时', () => {
    const live = renderRow(frozenStep(), true, 7)
    expect(live.container.querySelector('.chat-proc')!.className).toContain('chat-proc-running')
    live.unmount()

    const { container } = renderRow(frozenStep({ durationMs: 105_000 }), true, 8)
    expect(container.querySelector('.chat-proc')!.className).not.toContain('chat-proc-running')
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    expect(head.textContent).not.toContain('用时')
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

/**
 * 2026-11-11 用户：「有时候运行过程中会弹出来这个交付物卡片」。
 * 规则：这张卡是**收工物**，运行中不画（工具行已经表达了"正在改什么"），收工后一次性出现。
 */
describe('交付卡：运行中不弹，收工才出现', () => {
  const running = assistant({
    text: '',
    flow: [{ kind: 'tool', callId: 'c1' }],
    tools: [{ ...diffTool, state: 'running' }],
  })

  it('工具还在跑时不画交付卡（展开过程卡也看不到）', () => {
    const { container } = renderRow(running, true, 1)
    fireEvent.click(container.querySelector('.chat-proc-head')!)
    expect(container.querySelector('.chat-proc-body')).not.toBeNull()
    expect(container.querySelector('.chat-artifact')).toBeNull()
    // 过程行本身仍在：进度不丢。
    expect(container.querySelector('.chat-proc')).not.toBeNull()
  })

  it('同一轮收工后交付卡出现（不需要刷新、不重复）', () => {
    const { container } = renderRow(assistant({ text: '', flow: [{ kind: 'tool', callId: 'c1' }], tools: [diffTool] }), true, 1)
    fireEvent.click(container.querySelector('.chat-proc-head')!)
    expect(container.querySelectorAll('.chat-artifact')).toHaveLength(1)
  })
})
/**
 * 2026-11-14 单一真源：行内不再画交付卡。
 *
 * 这里原有的三条「交付卡：全页唯一的一张卡」断言（卡头/标签/汇总/失败态/空壳卡）随渲染
 * 入口一起迁走，现在由三处分别守：
 * - `session/card-visible.test.ts`：**该不该画**（相位 × 账本 × 行数的穷举矩阵）；
 * - `ui/delivery-card.test.tsx`：**画出来长什么样**（四态、明细、汇总、空壳卡）；
 * - `render/turn-verdict-row.test.tsx`：**尾行不上屏**（卡只在 ChatRows 末尾槽位）。
 */

