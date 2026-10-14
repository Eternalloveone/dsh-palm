// @vitest-environment jsdom
/**
 * 过程组的渲染契约 —— 独立于既有断言更新，专门钉死这次排版改造的规矩：
 * 1. 默认折叠：答案先看到，过程行不在 DOM 里；
 * 2. 展开后思考/工具按事件顺序出现，思考正文要再点一下才读得到；
 * 3. 答案在组外、组后（按步骤判定），前面各步文本留组内；
 * 4. 关掉"显示工具调用"只挡工具行与 diff 卡，不挡思考与用时；
 * 5. P11：卡面第一行只有状态词＋用时（+真有报错步骤时的极小报错信号），步数移出卡面；
 * 6. P11：步数与红/绿步级统计都在展开体里；
 * 7. P11：本回合确定没改动文件时报「未改动文件」，运行中不报（会误报）。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MessageRow } from './message-row.tsx'
import type { RenderMessage, ToolCallInfo } from './messages.ts'

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

describe('过程组：默认折叠，答案优先', () => {
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

  it('折叠时头是两行（状态词＋用时），答案已可见、过程行不在 DOM', () => {
    const { container } = renderRow(message)

    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    expect(head).not.toBeNull()
    expect(head.getAttribute('aria-expanded')).toBe('false')
    // 第一行：状态词 + 时间半句。旧文案「本轮用了 …」已不存在。
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    // 旧期望值 '用时6分24秒 · 1 步' → P11 新口径：卡面第一行不带步数。
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时6分24秒')
    expect(head.textContent).not.toContain('步')
    expect(head.textContent).not.toContain('本轮用了')
    expect(head.textContent).not.toContain('正在处理')
    // 第二行：最后到哪一步 + 改动量的一句人话（灰阶里没有红绿数字）。
    expect(head.querySelectorAll('.chat-proc-line')).toHaveLength(2)
    expect(head.querySelector('.chat-proc-current-text')!.textContent).toBe('写入 · a.txt')
    expect(head.querySelector('.chat-proc-meta')!.textContent).toBe('改了 1 个文件')
    expect(container.querySelector('.chat-proc-tally')).toBeNull()
    // 答案（单步整行文本）在组外，先看到。
    expect(screen.getByText(/第一段/)).toBeTruthy()
    // 折叠状态：思考、工具行、diff 卡、步数首行都不在 DOM 里。
    expect(container.querySelector('.chat-proc-body')).toBeNull()
    expect(container.querySelector('.chat-think')).toBeNull()
    expect(container.querySelector('.chat-artifact')).toBeNull()
    expect(container.querySelector('.chat-proc-steps')).toBeNull()
  })

  it('展开后思考/工具按顺序出现，思考正文要再点一下', () => {
    const { container } = renderRow(message)
    fireEvent.click(container.querySelector('.chat-proc-head') as HTMLButtonElement)

    // 组内首行是步数（P11：步数移出卡面、展开才看），其后按事件顺序。
    const steps = container.querySelector('.chat-proc-body > .chat-proc-steps') as HTMLElement
    expect(steps).not.toBeNull()
    expect(steps.textContent).toBe('共 1 步')
    const kinds = Array.from(container.querySelectorAll('.chat-proc-body > *:not(.chat-proc-steps)'))
      .map(el => el.className.includes('chat-think') ? 'think' : el.className.includes('chat-step') ? 'tool' : el.className.includes('chat-artifact') ? 'artifact' : 'other')
    expect(kinds).toEqual(['think', 'tool', 'artifact'])

    // 思考只报行数，正文还没进 DOM。
    expect(container.querySelector('.chat-think-label')!.textContent).toBe('深度思考 · 1 行')
    expect(screen.queryByText('先想一下')).toBeNull()
    fireEvent.click(container.querySelector('.chat-think-head') as HTMLButtonElement)
    expect(screen.getByText('先想一下')).toBeTruthy()

    // 工具行有中文状态字，没有色点。
    expect(container.querySelector('.chat-step-state')!.textContent).toBe('完成')
    expect(container.querySelectorAll('.chat-step-dot')).toHaveLength(0)
  })

  it('关掉"显示工具调用"：只藏工具行，思考、用时与 diff 卡都还在', () => {
    const { container } = renderRow(message, false)
    const head = container.querySelector('.chat-proc-head') as HTMLButtonElement
    // 工具行都藏了，就不能再声称"· N 步"；状态词与用时照报。
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时6分24秒')
    expect(head.textContent).not.toContain('步')
    // 折叠头里的红绿改动量已删除（灰阶）；改动量改成第二行右侧的一句人话，
    // 而且描述的是仍然可见的 diff 卡。
    expect(container.querySelector('.chat-proc-tally')).toBeNull()
    expect(head.querySelector('.chat-proc-meta')!.textContent).toBe('改了 1 个文件')

    fireEvent.click(head)
    expect(container.querySelector('.chat-think')).not.toBeNull()
    expect(container.querySelectorAll('.chat-step')).toHaveLength(0)
    expect(container.querySelector('.chat-artifact-title')!.textContent).toBe('Write a.txt')
    // 工具行不渲染 ⇒ 展开体也不声称步数（沿用旧行为）。
    expect(container.querySelector('.chat-proc-steps')).toBeNull()
  })
})

describe('过程组：答案按步骤切在组外', () => {
  it('多步：最后一步的文本是组外答案，之前各步文本留组内', () => {
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

    // 组内：第一步的叙述文本还在（带定位锚点）。
    const inGroup = container.querySelector('.chat-proc-body')!
    const anchored = inGroup.querySelector('[data-step-seq]') as HTMLElement
    expect(anchored.getAttribute('data-step-seq')).toBe('5')
    expect(anchored.textContent).toContain('先看结构')
    // 组外：最后一步的文本是答案，且不在组内重复。
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
    // 静态头：同一句话结构，但没有 caret、没有 aria-expanded。
    expect(head.getAttribute('role')).toBe('status')
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时19秒')
    expect(head.getAttribute('aria-label')).toBe('已完成，用时19秒')
    expect(head.textContent).not.toContain('步')
    expect(head.textContent).not.toContain('本轮用了')
    expect(head.querySelector('.chat-proc-caret')).toBeNull()
    expect(head.getAttribute('aria-expanded')).toBeNull()
    expect(container.querySelectorAll('button.chat-proc-head')).toHaveLength(0)
    expect(screen.getByText('就一句话')).toBeTruthy()
  })
})

describe('过程组：灰阶状态词（成败不再冒充成功）', () => {
  it('failed 回合：头第一行读"失败"，改动量仍是第二行右侧的一句人话', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 5_000,
      failed: true,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [diffTool],
    }))

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('失败')
    // 旧期望值 '用时5秒 · 1 步' → 新口径不带步数。
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时5秒')
    expect(head.querySelector('.chat-proc-meta')!.textContent).toBe('改了 1 个文件')
    // 折叠头里没有红绿改动量的位置（灰阶）。
    expect(container.querySelector('.chat-proc-tally')).toBeNull()
  })

  it('maxTokens 回合：头第一行读"已中断"，不是"已完成"', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 5_000,
      maxTokens: true,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [diffTool],
    }))

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已中断')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时5秒')
  })

  it('有 stopped 工具的回合：头第一行读"已中断"', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ ...diffTool, state: 'stopped' }],
    }))

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已中断')
  })

  it('运行中：根节点带 chat-proc-running，第一行只有状态词（不足 3 秒不报秒数）', () => {
    const { container } = renderRow(assistant({
      text: '',
      pending: true,
      // 锚点就在此刻：实时用时不到 RUNNING_CLOCK_THRESHOLD_MS。
      turnStartAt: Date.now(),
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ callId: 'c1', name: 'bash', state: 'running', arguments: '{"cmd":"pytest -q"}' }],
    }))

    const group = container.querySelector('.chat-proc') as HTMLElement
    expect(group.className).toContain('chat-proc-running')
    expect(group.getAttribute('data-proc-rows')).toBe('1')
    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head).not.toBeNull()
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    // 运行中不报步数、不到阈值不报秒数。
    expect(head.querySelector('.chat-proc-time')).toBeNull()
    expect(head.textContent).not.toContain('步')
    // 第二行报此刻在哪一步（工具行首字形 + 标题 · 摘要）。
    expect(head.querySelector('.chat-proc-current-text')!.textContent).toBe('运行命令 · pytest -q')
    expect(head.querySelector('.chat-proc-current .chat-step-icon')).not.toBeNull()
    expect(container.querySelector('.chat-proc-tally')).toBeNull()
  })

  it('运行中：过了 3 秒阈值才在状态词后面报实时用时', () => {
    const { container } = renderRow(assistant({
      text: '',
      pending: true,
      turnStartAt: Date.now() - 213_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ callId: 'c1', name: 'bash', state: 'running', arguments: '{"cmd":"pytest -q"}' }],
    }))

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时3分33秒')
  })

  it('宿主按步发消息：pending 已落下但还有工具在跑，仍是"运行中"（秒表不能被判成已完成而消失）', () => {
    // 真机 bug 根因：宿主按步发 assistant/message，一行会在回合中途就被标成
    // 已结束。只有 pending 一个判据时卡片会读成"已完成"、秒表不出现。
    const { container } = renderRow(assistant({
      text: '',
      pending: false,
      turnStartAt: Date.now() - 213_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ callId: 'c1', name: 'bash', state: 'running', arguments: '{"cmd":"pytest -q"}' }],
    }))

    const group = container.querySelector('.chat-proc') as HTMLElement
    expect(group.className).toContain('chat-proc-running')
    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    // ≥3 秒 ⇒ 实时用时照报，不因为 pending 落下去就消失。
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时3分33秒')
    expect(head.textContent).not.toContain('已完成')
    expect(head.querySelector('.chat-proc-current-text')!.textContent).toBe('运行命令 · pytest -q')
  })
})

describe('过程组：按步定格的行靠"活跃轮次"判还在跑（真机 17:52）', () => {
  /** 已返回的 `运行命令` 工具（真机那一行末尾的工具就是这种 state:'ok'）。 */
  const bashOk: ToolCallInfo = { callId: 'c1', name: 'bash', state: 'ok', arguments: '{"cmd":"Recompile Debug.c"}' }

  /**
   * 真机那一行：宿主按步发 assistant/message ⇒ `pending` 已经落下，最后一个工具
   * 也已经返回结果（`state:'ok'`）—— 行内看不出这一轮还在跑，只有活跃轮次知道。
   */
  const frozenStep = (overrides: Partial<RenderMessage> = {}): RenderMessage => assistant({
    text: '',
    turn: 7,
    step: 3,
    pending: false,
    flow: [{ kind: 'tool', callId: 'c1' }],
    tools: [bashOk],
    ...overrides,
  })

  it('① 活跃轮次里的定格行：第一行"深度求索中"、根节点带 chat-proc-running、过 3 秒报实时用时', () => {
    const { container } = renderRow(frozenStep({ turnStartAt: Date.now() - 213_000 }), true, 7)

    const group = container.querySelector('.chat-proc') as HTMLElement
    expect(group.className).toContain('chat-proc-running')
    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时3分33秒')
    expect(head.textContent).not.toContain('已完成')
    // 第二行也走"进行中"分支：末尾的工具已经返回 ⇒ 模型正在想下一步。
    expect(head.querySelector('.chat-proc-current-text')!.textContent).toBe('思考中')
  })

  it('① 行自己没有被盖 turnStartAt 时，页级锚点兜住秒表（按步定格也不行丢掉计时）', () => {
    const { container } = render(
      <MessageRow
        message={frozenStep()}
        showToolCalls={true}
        showSystemMessages={false}
        liveTurn={7}
        liveTurnStartAt={Date.now() - 95_000}
      />,
    )

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时1分35秒')
  })

  it('① 连页级锚点都没有 ⇒ 不报秒表（锚点只认宿主时间，firstSeenAt 会读数偏小）', () => {
    // 真机：中途打开页面时锚点曾退化到 firstSeenAt＝"手机第一次看到这一行"的本地时间，
    // 于是手机读数比桌面端偏小。现在宁缺勿错：拿不到宿主锚点就只报状态词。
    const { container } = renderRow(frozenStep({ firstSeenAt: Date.now() - 4_000 }), true, 7)

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    expect(head.querySelector('.chat-proc-time')).toBeNull()
  })

  it('② turn/end 到了（活跃轮次翻走）⇒ 同一条行立刻回到"已完成"，不留在运行中', () => {
    // 同一条行、同一个组件：活跃轮次还是它自己那一轮时它是运行中……
    const live = renderRow(frozenStep(), true, 7)
    const liveHead = live.container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(liveHead.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    live.unmount()

    // ……轮号一翻（turn/end 到了，行被盖上定格的 durationMs）立刻回到"已完成"。
    const { container } = renderRow(frozenStep({ durationMs: 105_000 }), true, 8)

    const group = container.querySelector('.chat-proc') as HTMLElement
    expect(group.className).not.toContain('chat-proc-running')
    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    // 旧期望值 '用时1分45秒 · 1 步' → 新口径不带步数。
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时1分45秒')
  })

  it('② 没有任何活跃轮次（回合已结束）⇒ 同样是"已完成"', () => {
    const { container } = renderRow(frozenStep({ durationMs: 19_000 }))

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    // 旧期望值 '用时19秒 · 1 步' → 新口径不带步数。
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时19秒')
  })

  it('③ 定格行的第二行：末尾是思考 ⇒ 思考中，末尾是文本 ⇒ 正在回答', () => {
    const thinking = renderRow(frozenStep({ flow: [{ kind: 'reasoning', text: '再想想' }] }), true, 7)
    const thinkingHead = thinking.container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(thinkingHead.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    expect(thinkingHead.querySelector('.chat-proc-current-text')!.textContent).toBe('思考中')
    thinking.unmount()

    const answering = renderRow(frozenStep({
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'text', text: '正在写', seq: 4 }],
    }), true, 7)
    const answeringHead = answering.container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(answeringHead.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    expect(answeringHead.querySelector('.chat-proc-current-text')!.textContent).toBe('正在回答')
  })
})

describe('过程组：第二行与头共用同一个"还在跑"判据', () => {
  it('pending 落下但工具在跑时，第二行也走"进行中"分支（末尾是思考 → 思考中）', () => {
    // C：头读"深度求索中"，第二行也必须按运行中判定。只认 pending 时它会落到
    // "已结束"分支：末尾是思考就报"深度思考 1 行"，末尾是文本还会报最后一个工具行。
    const { container } = renderRow(assistant({
      text: '',
      pending: false,
      flow: [{ kind: 'reasoning', text: '再想想' }],
      tools: [{ callId: 'c1', name: 'bash', state: 'running', arguments: '{"cmd":"pytest -q"}' }],
    }))

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    expect(head.querySelector('.chat-proc-current-text')!.textContent).toBe('思考中')
  })
})

describe('P11：卡面的报错信号 / 步数入展开体 / 未改动文件 / 续跑', () => {
  it('① 有报错步骤 ⇒ 第一行状态词右侧出现很小的一枚报错标记（数量=state:error 的步数）', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'tool', callId: 'c2' }],
      tools: [
        { ...diffTool, state: 'error' },
        { callId: 'c2', name: 'bash', state: 'error', arguments: '{"cmd":"false"}' },
      ],
    }))

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    const marker = head.querySelector('.chat-proc-errors') as HTMLElement
    expect(marker).not.toBeNull()
    expect(marker.textContent).toBe('⚠ 2 处报错')
    // 位置：第一行里，状态词之后（用时之前）。
    const line = head.querySelector('.chat-proc-label') as HTMLElement
    expect(Array.from(line.children).map(el => (el as HTMLElement).className.split(' ')[0]))
      .toEqual(['chat-proc-lead', 'chat-proc-state', 'chat-proc-errors', 'chat-proc-time'])
    // 标记用的是与用时同档的第三档灰（比状态词弱一档），不是重色。
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
  })

  it('① 无报错步骤 ⇒ 卡面完全不出现报错标记（不留空占位）', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [diffTool],
    }))

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-errors')).toBeNull()
    expect(head.textContent).not.toContain('报错')
    expect(head.textContent).not.toContain('⚠')
  })

  it('① stopped（turn/end 翻掉的在跑工具）不算报错：头读"已中断"但不出标记', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ ...diffTool, state: 'stopped' }],
    }))

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已中断')
    expect(head.querySelector('.chat-proc-errors')).toBeNull()
  })

  it('② 卡面不再出现"N 步"；展开后首行报步数，红/绿步级统计也在展开体里', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 105_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [diffTool],
    }))

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    // 折叠时：卡面没有任何步数字样，红绿统计也不在卡面。
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时1分45秒')
    expect(head.textContent).not.toContain('步')
    expect(container.querySelector('.chat-step-tally')).toBeNull()
    expect(container.querySelector('.chat-step-tally-add')).toBeNull()

    fireEvent.click(head)

    // 展开后：首行「共 1 步」，步行自己的 +/− 统计与 diff 卡的统计都在组内。
    expect(container.querySelector('.chat-proc-body > .chat-proc-steps')!.textContent).toBe('共 1 步')
    const stepTallyAdd = container.querySelector('.chat-step-tally-add') as HTMLElement
    const stepTallyDel = container.querySelector('.chat-step-tally-del') as HTMLElement
    expect(stepTallyAdd.textContent).toBe('+1')
    expect(stepTallyDel.textContent).toBe('−1')
    expect(container.querySelector('.chat-proc-body')!.contains(stepTallyAdd)).toBe(true)
    expect(container.querySelector('.chat-artifact-stat-add')!.textContent).toBe('+1')
  })

  it('③ 已结束且本回合没改动任何文件 ⇒ 第二行右侧「未改动文件」', () => {
    const { container } = renderRow(assistant({
      text: '答案',
      durationMs: 19_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ callId: 'c1', name: 'bash', state: 'ok', arguments: '{"cmd":"pytest -q"}' }],
    }))

    const head = container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(head.querySelector('.chat-proc-current-text')!.textContent).toBe('运行命令 · pytest -q')
    expect(head.querySelector('.chat-proc-meta')!.textContent).toBe('未改动文件')
  })

  it('③ 运行中 ⇒ 绝不显示「未改动文件」（会误报"没改"）；有改动时照旧报数量', () => {
    const untouched = renderRow(assistant({
      text: '',
      pending: true,
      turnStartAt: Date.now() - 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ callId: 'c1', name: 'bash', state: 'running', arguments: '{"cmd":"pytest -q"}' }],
    }))
    const runningHead = untouched.container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(untouched.container.querySelector('.chat-proc')!.className).toContain('chat-proc-running')
    expect(runningHead.querySelector('.chat-proc-meta')).toBeNull()
    expect(runningHead.textContent).not.toContain('未改动文件')
    untouched.unmount()

    const changed = renderRow(assistant({
      text: '',
      pending: true,
      turnStartAt: Date.now() - 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [diffTool],
    }))
    const changedHead = changed.container.querySelector('button.chat-proc-head') as HTMLButtonElement
    expect(changedHead.querySelector('.chat-proc-meta')!.textContent).toBe('改了 1 个文件')
  })

  it('④ 续跑文本折进卡片：本轮未采用（客户端没有可区分的"继续"信号）—— 答案仍留在组外', () => {
    // 证据见报告：客户端没有「继续」控件；手打「继续」与「重新生成」都走普通
    // session.prompt（新一轮 turn，user/message 只带 source.kind，无 continue 标记），
    // 只有 QueueDock「插话」= agent.steer 能在结构上区分。没有宿主信号就不硬编造，
    // 因此这一条钉住现状：任何 assistant 行的答案都在过程组之外、折叠时也可见。
    const { container } = renderRow(assistant({
      text: '接着写完了',
      durationMs: 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'text', text: '接着写完了', seq: 4 }],
      tools: [diffTool],
    }))

    const answer = container.querySelector('.chat-flow-answer') as HTMLElement
    expect(answer).not.toBeNull()
    expect(container.querySelector('.chat-proc')!.contains(answer)).toBe(false)
    // 折叠时答案直接可见（不是"点开卡片才可见"）。
    expect(container.querySelector('.chat-proc-body')).toBeNull()
    expect(screen.getByText('接着写完了')).toBeTruthy()
  })
})

describe('回合尾报告卡：只报交回了什么', () => {
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
    expect(screen.getByText('交付物')).toBeTruthy()
    expect(screen.getByText('本轮产出文件')).toBeTruthy()
    expect(container.querySelector('.chat-turn-tail-badge')!.textContent).toBe('已交付')
    // 用时不在尾巴里重复报（组头报一次）。
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
