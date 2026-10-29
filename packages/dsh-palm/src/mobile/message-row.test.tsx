// @vitest-environment jsdom
/**
 * MessageRow layout-stability contract: a streaming (pending) message with a
 * non-empty flow renders the SAME collapsed structure as its settled form —
 * ONE `.chat-proc` process group in head position, with the answer OUTSIDE and
 * AFTER it — so the pending→settled switch never re-lays the row (no
 * tail-card→inline-card jump). Also covers the group's expanded body (tool
 * steps plus the merged diff artifact) and the artifact's collapsible diff body.
 *
 * 折叠头本身是两行：第一行状态词＋秒表（运行中不含步数），第二行"此刻进行到
 * 哪一步"（没有可说的一步时整行不渲染）；静态头（纯文本/只有时钟）是同一套
 * 两行，但没有 caret、没有 aria-expanded。秒表走宿主时间（clockOffsetMs）。
 */
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MessageRow } from './message-row.tsx'
import type { RenderMessage, ToolCallInfo } from './messages.ts'

// 图片字节走 attachment-images（内容寻址缓存）：测试里当作已缓存，组件同步渲染。
vi.mock('./attachment-images.ts', () => ({
  cachedAttachmentUrl: (attachmentId: string) => (attachmentId === 'sha256:abc' ? 'data:image/jpeg;base64,QUFB' : undefined),
  loadAttachmentUrl: () => Promise.resolve('data:image/jpeg;base64,QUFB'),
  forgetAttachmentUrl: () => {},
}))

const tool: ToolCallInfo = {
  callId: 'c1',
  name: 'applyPatch',
  view: {
    card: 'diff',
    title: '编辑了 1 个文件',
    diffs: [{ path: 'src/a.ts', oldText: 'old line\n', newText: 'new line\n' }],
  },
}

/** A null flow means "no flow" (the tail layout path); undefined triggers
 *  the default interleaved flow — use null explicitly for the no-flow case.
 *  `durationMs` is the turn clock the collapsed process head reports. */
function baseMessage(
  pending: boolean,
  flow: RenderMessage['flow'] | null = [
    { kind: 'text', text: '第一段' },
    { kind: 'tool', callId: 'c1' },
    { kind: 'text', text: '第二段' },
  ],
  tools: ToolCallInfo[] = [tool],
): RenderMessage {
  return {
    id: 'assistant,1.0#5',
    kind: 'assistant',
    text: '第一段\n\n第二段',
    pending,
    seq: 5,
    time: 1_000,
    durationMs: 80_000,
    tools,
    flow: flow === null ? undefined : flow,
  }
}

/** The row's structural nodes in DOM order, as stable labels. */
function structureOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(
    '.chat-proc, .chat-proc-head, .chat-proc-body, .chat-think, .chat-step, .chat-artifact, .chat-flow-text, .chat-md-body',
  )).map((el) => {
    if (el.classList.contains('chat-proc')) return 'proc'
    if (el.classList.contains('chat-proc-head')) return 'proc-head'
    if (el.classList.contains('chat-proc-body')) return 'proc-body'
    if (el.classList.contains('chat-think')) return 'think'
    if (el.classList.contains('chat-step')) return 'step'
    if (el.classList.contains('chat-artifact')) return 'artifact'
    if (el.classList.contains('chat-flow-text')) {
      return el.getAttribute('data-part-id') === 'answer' ? 'answer' : 'flow-text'
    }
    return 'text'
  })
}

/** The head's lines in DOM order: first = state word + clock, second =
 *  "what step is happening" (the second one may legitimately not render). */
function procLines(head: HTMLElement): HTMLElement[] {
  return Array.from(head.querySelectorAll('.chat-proc-line'))
}

/** The second line's briefing text (empty when the line is not rendered). */
function currentLineOf(head: HTMLElement): string {
  return head.querySelector('.chat-proc-current-text')?.textContent ?? ''
}

describe('MessageRow flow body (layout stability)', () => {
  it('renders pending and settled rows with the identical collapsed process group and trailing answer', () => {
    const pending = render(
      <MessageRow message={baseMessage(true)} showToolCalls showSystemMessages={false} />,
    )
    const settled = render(
      <MessageRow message={baseMessage(false)} showToolCalls showSystemMessages={false} />,
    )

    // Both states: ONE process group (collapsed head only), then the answer
    // OUTSIDE it — the pending→settled switch never re-lays the row.
    expect(structureOf(pending.container)).toEqual(['proc', 'proc-head', 'text'])
    expect(structureOf(settled.container)).toEqual(['proc', 'proc-head', 'text'])
    for (const { container } of [pending, settled]) {
      const group = container.querySelector('.chat-proc') as HTMLElement
      expect(group.getAttribute('data-proc-rows')).toBe('1')
      // Collapsed by default: no body, no step row, no diff card in the DOM.
      expect(group.querySelector('.chat-proc-body')).toBeNull()
      expect(container.querySelector('.chat-step')).toBeNull()
      expect(container.querySelectorAll('.chat-artifact')).toHaveLength(0)
      expect(container.querySelector('.chat-proc-head')!.getAttribute('aria-expanded')).toBe('false')
      expect(container.querySelector('.chat-proc-caret')).not.toBeNull()
      // The answer keeps the whole message text and is not inside the group.
      const answer = container.querySelector('.chat-md-body') as HTMLElement
      expect(group.contains(answer)).toBe(false)
      expect(answer.textContent).toContain('第一段')
      expect(answer.textContent).toContain('第二段')
    }
    // The head is TWO lines: line one reports the turn's state and clock, line
    // two says what step is happening right now. A running row names the
    // wording only — no clock before the 3s threshold, and no step count…
    const pendingHead = pending.container.querySelector('.chat-proc-head') as HTMLElement
    expect(procLines(pendingHead)).toHaveLength(2)
    expect(pendingHead.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    expect(pendingHead.querySelector('.chat-proc-time')).toBeNull()
    expect(procLines(pendingHead)[0]!.textContent).not.toContain('步')
    expect(currentLineOf(pendingHead)).toBe('正在回答')
    // …and a settled row reports the state word plus what the turn cost. The
    // ` · N 步` suffix is GONE (P11: the step count moved into the expanded body,
    // see the `.chat-proc-steps` assertions below).
    const settledHead = settled.container.querySelector('.chat-proc-head') as HTMLElement
    expect(procLines(settledHead)).toHaveLength(2)
    expect(settledHead.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    // 旧期望值 '用时1分20秒 · 1 步' → 新口径：卡面第一行只有用时。
    expect(settledHead.querySelector('.chat-proc-time')!.textContent).toBe('用时1分20秒')
    expect(procLines(settledHead)[0]!.textContent).not.toContain('步')
    expect(settledHead.getAttribute('aria-expanded')).toBe('false')
    expect(currentLineOf(settledHead)).toBe('工具 · applyPatch')
  })

  it('merges consecutive tool parts into one artifact card inside the expanded group', () => {
    const message = baseMessage(
      true,
      [
        { kind: 'text', text: '开始' },
        { kind: 'tool', callId: 'c1' },
        { kind: 'tool', callId: 'c2' },
        { kind: 'text', text: '结束' },
      ],
      [
        tool,
        { ...tool, callId: 'c2', view: { ...tool.view!, diffs: [{ path: 'src/b.ts', oldText: '', newText: 'b\n' }] } },
      ],
    )
    const { container } = render(
      <MessageRow message={message} showToolCalls showSystemMessages={false} />,
    )
    expect(container.querySelector('.chat-proc')!.getAttribute('data-proc-rows')).toBe('2')
    // Nothing of the process is in the DOM while the group stays collapsed.
    expect(container.querySelector('.chat-artifact')).toBeNull()

    fireEvent.click(container.querySelector('.chat-proc-head')!)
    // Two step rows, then ONE merged card, all inside the group body; the
    // answer stays outside it.
    expect(structureOf(container)).toEqual(['proc', 'proc-head', 'proc-body', 'step', 'step', 'artifact', 'text'])
    expect(container.querySelectorAll('.chat-artifact')).toHaveLength(1)
    // Two files merged into one card: the head reads "编辑了 2 个文件".
    expect(container.querySelector('.chat-artifact-title')!.textContent).toBe('编辑了 2 个文件')
  })

  it('without a flow, the diff card still rides inside the process group (revealed on tap)', () => {
    const message = baseMessage(false, null)
    // The card is NOT visible without expanding the group, so the no-flow row
    // matches the flow row: group head first, answer outside, card inside.
    const shown = render(
      <MessageRow message={message} showToolCalls showSystemMessages={false} />,
    )
    expect(structureOf(shown.container)).toEqual(['proc', 'proc-head', 'text'])
    expect(shown.container.querySelector('.chat-artifact')).toBeNull()
    expect(shown.container.querySelector('.chat-md-body')).not.toBeNull()
    fireEvent.click(shown.container.querySelector('.chat-proc-head')!)
    const body = shown.container.querySelector('.chat-proc-body') as HTMLElement
    expect(body.querySelectorAll('.chat-step')).toHaveLength(1)
    expect(body.querySelector('.chat-artifact-title')!.textContent).toBe('编辑了 1 个文件')

    // showToolCalls=false drops the tool STEPS but keeps the diff cards (a card
    // is the turn's output, not process noise) — so the group stays expandable
    // and the head must NOT advertise a step count it no longer shows.
    const hidden = render(
      <MessageRow message={message} showToolCalls={false} showSystemMessages={false} />,
    )
    expect(structureOf(hidden.container)).toEqual(['proc', 'proc-head', 'text'])
    expect(hidden.container.querySelector('.chat-proc-body')).toBeNull()
    expect(hidden.container.querySelector('.chat-artifact')).toBeNull()
    const hiddenHead = hidden.container.querySelector('.chat-proc-head') as HTMLElement
    expect(hiddenHead.tagName).toBe('BUTTON')
    expect(hiddenHead.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    // 工具行不渲染 ⇒ 不再声称"· N 步"，但用时照报。
    expect(hiddenHead.querySelector('.chat-proc-time')!.textContent).toBe('用时1分20秒')
    // 改动量从灰阶里的 "+N −M" 改成一句人话，挂在第二行右侧。
    expect(currentLineOf(hiddenHead)).toBe('工具 · applyPatch')
    expect(hiddenHead.querySelector('.chat-proc-meta')!.textContent).toBe('改了 1 个文件')

    fireEvent.click(hiddenHead)
    expect(hidden.container.querySelectorAll('.chat-step')).toHaveLength(0)
    expect(hidden.container.querySelector('.chat-artifact-title')!.textContent).toBe('编辑了 1 个文件')
  })

  it('renders a static, non-interactive head when only the turn clock exists', () => {
    const message: RenderMessage = {
      id: 'a-static',
      kind: 'assistant',
      text: '纯文本回答',
      pending: false,
      seq: 3,
      time: 1_000,
      durationMs: 5_000,
    }
    const { container } = render(
      <MessageRow message={message} showToolCalls showSystemMessages={false} />,
    )
    // Zero process rows but a turn clock: the head is a plain status line —
    // no button, no aria-expanded, no caret, no body.
    const head = container.querySelector('.chat-proc-head') as HTMLElement
    expect(head.tagName).toBe('DIV')
    expect(head.className).toContain('chat-proc-head-static')
    expect(head.getAttribute('aria-expanded')).toBeNull()
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时5秒')
    // 纯文本回合没有过程行 ⇒ 第二行不渲染，静态头就只有一行。
    expect(procLines(head)).toHaveLength(1)
    expect(head.querySelector('.chat-proc-current')).toBeNull()
    // 静态头把同一句话挂在 aria-label 上（读屏器读到的和看到的一致）。
    expect(head.getAttribute('aria-label')).toBe('已完成，用时5秒')
    expect(container.querySelector('.chat-proc-caret')).toBeNull()
    expect(container.querySelector('.chat-proc-body')).toBeNull()
    expect(structureOf(container)).toEqual(['proc', 'proc-head', 'text'])
  })

  it('静态头同样两行：第一行只有用时，第二行报最后一步做了什么', () => {
    // 关掉"显示工具调用"且没有 diff 卡时，工具行不渲染 ⇒ 头是静态的，
    // 但"最后一步做了什么"仍然说得出来。
    const message: RenderMessage = {
      id: 'a-static-two',
      kind: 'assistant',
      text: '答案',
      pending: false,
      seq: 4,
      time: 3_000,
      durationMs: 5_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: [{ callId: 'c1', name: 'bash', state: 'ok', arguments: '{"cmd":"pytest -q"}' }],
    }
    const { container } = render(
      <MessageRow message={message} showToolCalls={false} showSystemMessages={false} />,
    )

    const head = container.querySelector('.chat-proc-head-static') as HTMLElement
    expect(head).not.toBeNull()
    expect(procLines(head)).toHaveLength(2)
    expect(head.querySelector('.chat-proc-state')!.textContent).toBe('已完成')
    expect(head.querySelector('.chat-proc-time')!.textContent).toBe('用时5秒')
    expect(currentLineOf(head)).toBe('运行命令 · pytest -q')
    expect(container.querySelector('.chat-proc-caret')).toBeNull()
    expect(container.querySelector('.chat-proc-body')).toBeNull()
  })

  it('运行中第二行随状态下变化：running 工具 → 标题 · 摘要，跑完 → 思考中，纯文本 → 正在回答', () => {
    const toolsOf = (state: ToolCallInfo['state']): ToolCallInfo[] =>
      [{ callId: 'c1', name: 'bash', state, arguments: '{"cmd":"pytest -q"}' }]
    const runningRow: RenderMessage = {
      id: 'a-run-tool',
      kind: 'assistant',
      text: '',
      pending: true,
      seq: 6,
      time: 2_000,
      flow: [{ kind: 'tool', callId: 'c1' }],
      tools: toolsOf('running'),
    }

    // running 的工具：第一行只有措辞，第二行是「标题 · 摘要」＋工具族字形。
    const running = render(<MessageRow message={runningRow} showToolCalls showSystemMessages={false} />)
    const runningHead = running.container.querySelector('.chat-proc-head') as HTMLElement
    expect(runningHead.querySelector('.chat-proc-state')!.textContent).toBe('深度求索中')
    expect(runningHead.querySelector('.chat-proc-time')).toBeNull()
    expect(currentLineOf(runningHead)).toBe('运行命令 · pytest -q')
    // 行首字形是 emoji（bash 族 = 齿轮 ⚙️，运行中还会转）。
    expect(runningHead.querySelector('.chat-proc-current .chat-step-icon')!.textContent).toBe('⚙️')

    // 工具跑完、下一句还没来：模型正在想下一步。
    const finished = render(
      <MessageRow message={{ ...runningRow, id: 'a-run-done', tools: toolsOf('ok') }} showToolCalls showSystemMessages={false} />,
    )
    const finishedHead = finished.container.querySelector('.chat-proc-head') as HTMLElement
    expect(currentLineOf(finishedHead)).toBe('思考中')
    // 思考行没有工具族，用 💭 顶上（轻微呼吸）：展开后每一行都有行首符号，
    // 折叠卡第二行不该是唯一空着的那行。
    expect(finishedHead.querySelector('.chat-step-icon')!.textContent).toBe('💭')

    // 最新部件是文本：正在回答。
    const answering = render(
      <MessageRow
        message={{ ...runningRow, id: 'a-ans', flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'text', text: '正在写答案', seq: 7 }] }}
        showToolCalls
        showSystemMessages={false}
      />,
    )
    expect(currentLineOf(answering.container.querySelector('.chat-proc-head') as HTMLElement)).toBe('正在回答')
  })

  it('行内秒表走宿主时间：锚点优先 turnStartAt，clockOffsetMs 把用时整体平移', () => {
    vi.useFakeTimers()
    try {
      const t0 = 1_700_000_000_000
      vi.setSystemTime(t0)
      const message: RenderMessage = {
        ...baseMessage(true),
        // 行的第一次事件晚于回合起点：秒表必须认 turnStartAt，不是 firstSeenAt。
        turnStartAt: t0 - 10_000,
        firstSeenAt: t0 - 9_000,
      }
      const view = render(
        <MessageRow message={message} showToolCalls showSystemMessages={false} clockOffsetMs={2_000} />,
      )
      // 宿主时间比手机快 2 秒 ⇒ 10 秒的回合显示 12 秒。
      expect(view.container.querySelector('.chat-proc-time')!.textContent).toBe('用时12秒')

      act(() => { vi.advanceTimersByTime(3_000) })
      expect(view.container.querySelector('.chat-proc-time')!.textContent).toBe('用时15秒')

      // 偏移被重新校准（这里变小）：读数跟着真值回落。以前这里有一层"只增不减"
      // 的棘轮把它冻在 15 秒，代价是偏大的样本永久留在屏幕上 —— 秒表从此比桌面快，
      // 下一帧真值追上来时一口气跨两秒（真机"突然跳 2 秒"）。抖动的源头
      // （每帧覆盖的原始偏移）已经在 ChatView 改成取窗口内最大值，显示值不必再兜。
      view.rerender(<MessageRow message={message} showToolCalls showSystemMessages={false} clockOffsetMs={0} />)
      expect(view.container.querySelector('.chat-proc-time')!.textContent).toBe('用时13秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('读数按整秒向下取整，与桌面 formatRunDuration 一致', () => {
    vi.useFakeTimers()
    try {
      const t0 = 1_700_000_000_000
      vi.setSystemTime(t0)
      const message: RenderMessage = { ...baseMessage(true), turnStartAt: t0 - 3_500 }
      const view = render(<MessageRow message={message} showToolCalls showSystemMessages={false} />)
      // 3.5 秒（已过 3 秒阈值）：四舍五入会显示 4 秒 —— 比桌面多一秒；向下取整是 3 秒。
      expect(view.container.querySelector('.chat-proc-time')!.textContent).toBe('用时3秒')
    } finally {
      vi.useRealTimers()
    }
  })

  it('父级心跳能把秒表叫醒：本行定时器一次都没触发也不影响读数', () => {
    vi.useFakeTimers()
    try {
      const t0 = 1_700_000_000_000
      vi.setSystemTime(t0)
      const message: RenderMessage = { ...baseMessage(true), turnStartAt: t0 }
      const view = render(
        <MessageRow message={message} showToolCalls showSystemMessages={false} liveClockTick={0} />,
      )
      // 后台：本行的定时器被冻住（一次都没触发），系统时间却照走。
      vi.setSystemTime(t0 + 65_000)
      // 父级心跳每回到一次前台都会变：props 一变，memo 就挡不住这一行重渲染。
      view.rerender(
        <MessageRow message={message} showToolCalls showSystemMessages={false} liveClockTick={1} />,
      )
      expect(view.container.querySelector('.chat-proc-time')!.textContent).toBe('用时1分5秒')
      // 再一拍，读数继续跟上。
      vi.setSystemTime(t0 + 71_000)
      view.rerender(
        <MessageRow message={message} showToolCalls showSystemMessages={false} liveClockTick={2} />,
      )
      expect(view.container.querySelector('.chat-proc-time')!.textContent).toBe('用时1分11秒')
    } finally {
      vi.useRealTimers()
    }
  })
  it('renders streaming rows without any typewriter cursor (clean output)', () => {
    const message = baseMessage(
      true,
      [
        { kind: 'text', text: '第一段' },
        { kind: 'tool', callId: 'c1' },
        { kind: 'text', text: '第二段' },
      ],
    )
    const { container } = render(
      <MessageRow message={message} showToolCalls showSystemMessages={false} />,
    )
    // No typewriter cursor anywhere: the streaming state is conveyed by the
    // turn status bar, not by a ▍ after the text.
    expect(container.querySelectorAll('.chat-msg-cursor')).toHaveLength(0)
    const settled = render(
      <MessageRow message={baseMessage(false)} showToolCalls showSystemMessages={false} />,
    )
    expect(settled.container.querySelectorAll('.chat-msg-cursor')).toHaveLength(0)
  })

  it('the artifact diff body opens and closes on the head tap', () => {
    const { container } = render(
      <MessageRow message={baseMessage(false)} showToolCalls showSystemMessages={false} />,
    )
    // The diff card only exists once the process group is expanded.
    expect(container.querySelector('.chat-artifact')).toBeNull()
    fireEvent.click(container.querySelector('.chat-proc-head')!)
    const head = container.querySelector('.chat-artifact-head') as HTMLButtonElement
    expect(head.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('old line')).toBeNull()
    fireEvent.click(head)
    expect(screen.getByText('old line')).toBeDefined()
    expect(screen.getByText('new line')).toBeDefined()
    // The diff body is clamped for the max-height transition even when open.
    const body = container.querySelector('.chat-tool-diff') as HTMLDivElement
    expect(body.style.maxHeight).toBe('0px') // jsdom has no layout; still set
    fireEvent.click(head)
    expect(screen.queryByText('old line')).toBeNull()
  })

  it('发送条里画出这条消息带的文档附件（名字 + 扩展名·大小）', () => {
    // 真机："文档已经上传、也发出去了，发送条里还是没有这个附件文档的索引"。
    // 文件引用以前整块被丢（只折了 image 块），行里只剩文字。
    const fileOnly: RenderMessage = {
      id: 'u-doc',
      kind: 'user',
      text: '',
      files: [{ attachmentId: 'sha256:f1', name: '季度报告.pdf', bytes: 2048 }],
      seq: 1,
      time: 1_000,
    }
    const { container } = render(
      <MessageRow message={fileOnly} sessionId="s-1" showToolCalls showSystemMessages={false} />,
    )
    // 纯附件消息（文本为空）以前整行 return null，现在必须画出文件卡片。
    expect(container.querySelector('.chat-msg-file')).not.toBeNull()
    expect(screen.getByText('季度报告.pdf')).toBeTruthy()
    expect(screen.getByText('PDF · 2 KB')).toBeTruthy()

    // 文字 + 附件：两者都在。
    const withText: RenderMessage = { ...fileOnly, id: 'u-doc-text', text: '看这份报告' }
    const both = render(
      <MessageRow message={withText} sessionId="s-1" showToolCalls showSystemMessages={false} />,
    )
    expect(both.container.textContent).toContain('看这份报告')
    expect(both.container.querySelector('.chat-msg-file')).not.toBeNull()

    // 有字节但没扩展名：只显示大小，不显示半截"文件"字样。
    const noExtension = render(
      <MessageRow
        message={{ ...fileOnly, id: 'u-doc-2', files: [{ attachmentId: 'sha256:f2', name: 'Makefile', bytes: 12 }] }}
        sessionId="s-1"
        showToolCalls
        showSystemMessages={false}
      />,
    )
    expect(noExtension.container.querySelector('.chat-msg-file-meta')?.textContent).toBe('12 B')
  })
  it('renders message images for a user row and keeps an image-only row alive', () => {
    // 事件里只有 attachmentId 引用；字节由 attachment-images 取（这里给缓存命中，
    // 组件同步拿到 data URL，测试不碰网络）。
    const image = { attachmentId: 'sha256:abc', mediaType: 'image/jpeg', width: 810, height: 1440, name: 'a.jpg' }
    const imageOnly: RenderMessage = { id: 'u-img', kind: 'user', text: '', images: [image], seq: 1, time: 1_000 }
    const { container } = render(
      <MessageRow message={imageOnly} sessionId="s-1" showToolCalls showSystemMessages={false} />,
    )
    const tile = container.querySelector('.chat-msg-image') as HTMLImageElement | null
    // 纯图片消息文本为空：以前整行 return null，现在必须渲染出图片。
    expect(tile).not.toBeNull()
    expect(tile?.getAttribute('src')).toBe('data:image/jpeg;base64,QUFB')
    expect(tile?.getAttribute('alt')).toBe('a.jpg')
    expect(tile?.getAttribute('width')).toBe('810')

    // 文字 + 图片：两者都在。
    const withText: RenderMessage = { ...imageOnly, id: 'u-both', text: '看看这张' }
    const both = render(
      <MessageRow message={withText} sessionId="s-1" showToolCalls showSystemMessages={false} />,
    )
    expect(both.container.querySelector('.chat-msg-image')).not.toBeNull()
    expect(both.container.textContent).toContain('看看这张')

    // 没有 sessionId（非真实调用点）：拿不到授权会话就不渲染图片。
    const anonymous = render(
      <MessageRow message={imageOnly} showToolCalls showSystemMessages={false} />,
    )
    expect(anonymous.container.querySelector('.chat-msg-image')).toBeNull()
  })

  it('falls back to the retry tile when the image bytes fail to decode', async () => {
    // 解码失败（格式不支持 / data URL 被截断 / 图太大 OOM）时浏览器只给一块空白，
    // 深色主题下就是用户说的「黑图」。没有 onError 就永远黑着 —— 既没有提示，也点不了重试。
    const image = { attachmentId: 'sha256:abc', mediaType: 'image/jpeg', width: 810, height: 1440, name: 'a.jpg' }
    const row: RenderMessage = { id: 'u-bad', kind: 'user', text: '', images: [image], seq: 1, time: 1_000 }
    const { container } = render(
      <MessageRow message={row} sessionId="s-1" showToolCalls showSystemMessages={false} />,
    )
    const img = container.querySelector('.chat-msg-image') as HTMLImageElement
    expect(img.tagName).toBe('IMG')
    fireEvent.error(img)
    const retry = await screen.findByRole('listitem', { name: 'a.jpg，加载失败，点击重试' })
    expect(retry.textContent).toContain('图片加载失败，点击重试')
  })

  it('treats a zero-sized decode as broken and offers retry', async () => {
    // 结构损坏的 JPEG：load 事件照常来，但一个像素都没解出来（naturalWidth = 0），
    // onError 不响、浏览器也不画东西 —— 屏幕上就是一块纯黑，连"加载中"都看不到。
    const image = { attachmentId: 'sha256:abc', mediaType: 'image/jpeg', width: 1260, height: 940, name: 'IMG.jpg' }
    const row: RenderMessage = { id: 'u-zero', kind: 'user', text: '', images: [image], seq: 1, time: 1_000 }
    const { container } = render(
      <MessageRow message={row} sessionId="s-1" showToolCalls showSystemMessages={false} />,
    )
    const img = container.querySelector('.chat-msg-image') as HTMLImageElement
    // jsdom 从不真正解码，naturalWidth 恒为 0 —— 正好是这张坏图在真机上的样子。
    fireEvent.load(img)
    const retry = await screen.findByRole('listitem', { name: 'IMG.jpg，加载失败，点击重试' })
    expect(retry.textContent).toContain('图片加载失败，点击重试')
  })
})
