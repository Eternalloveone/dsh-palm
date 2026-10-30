/** foldEvents: message-list folding from a session event stream. */
import { describe, expect, it } from 'vitest'
import { coalesceTurnMessages, mergeProcessCardsByTurn, ensureTurnTails, preferRicherRows, expectsTurnReport, keepTurnReports, missingTurnReports, EventFolder, filesFromContent, foldEvents, foldTodoEvent, foldTodoSnapshot, mergeTurnReports, lastOpenTurnStartTime, latestTodoSnapshot, parseTodoList, type RenderMessage, type WireEvent } from './messages.ts'

/** Assemble one event with an auto-incrementing seq / time. */
function makeEvent(
  type: string,
  data: unknown,
  seq: number,
  time = seq * 1_000,
): WireEvent {
  return { type, seq, time, data }
}

/** A DSH-shaped user message payload (content: text blocks). */
function userMessageData(id: string, text: string): unknown {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

describe('文件附件（发送条里要看得见）', () => {
  it('把 prompt 里的 file 引用折成 message.files，纯附件消息也不丢', () => {
    // 宿主落库的形态：{ type:'file', attachment:{ attachmentId, name, bytes } }。
    // 以前只折 images，文件块被整块丢掉 —— 文档明明发出去了，那一行只剩文字。
    const withText = {
      id: 'u-file',
      role: 'user',
      content: [
        { type: 'text', text: '看看这份报告' },
        { type: 'file', attachment: { attachmentId: 'sha256:f1', name: '报告.pdf', bytes: 2048 } },
      ],
      source: { kind: 'user' },
    }
    const fold = foldEvents([makeEvent('user/message', withText, 1)])
    const row = fold.find(message => message.id === 'u-file')
    expect(row?.files).toEqual([{ attachmentId: 'sha256:f1', name: '报告.pdf', bytes: 2048 }])
    expect(row?.text).toBe('看看这份报告')

    // 只有附件、没有文字：行还在，files 在。
    const fileOnly = {
      id: 'u-file-only',
      role: 'user',
      content: [{ type: 'file', attachment: { attachmentId: 'sha256:f2', name: '账单.xlsx', bytes: 999 } }],
      source: { kind: 'user' },
    }
    const only = foldEvents([makeEvent('user/message', fileOnly, 1)]).find(message => message.id === 'u-file-only')
    expect(only?.text).toBe('')
    expect(only?.files?.[0]?.name).toBe('账单.xlsx')
  })

  it('字段平铺 / 只有 receiptId 的中间形态也认，没名字的块跳过', () => {
    const content = [
      { type: 'file', attachmentId: 'sha256:f3', name: 'a.log', bytes: 12 },
      { type: 'file', receiptId: 'receipt-7', name: 'b.docx', bytes: 34 },
      { type: 'file', name: '没有 id 的块', bytes: 1 },
      { type: 'file', attachment: { attachmentId: 'sha256:f4' } },
      { type: 'text', text: '正文' },
    ]
    expect(filesFromContent(content)).toEqual([
      { attachmentId: 'sha256:f3', name: 'a.log', bytes: 12 },
      { attachmentId: 'receipt-7', name: 'b.docx', bytes: 34 },
      { attachmentId: 'file-2', name: '没有 id 的块', bytes: 1 },
    ])
    expect(filesFromContent(undefined)).toEqual([])
  })
})
/** A DSH-shaped assistant message payload for one step. */
function assistantMessageData(
  id: string,
  turn: number,
  step: number,
  text: string,
): unknown {
  return {
    turn,
    step,
    message: {
      id,
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'fx', model: 'fx-1' },
    },
  }
}

/** A DSH-shaped text-delta chunk for one step. */
function textChunk(turn: number, step: number, text: string, seq: number): WireEvent {
  return makeEvent('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text } }, seq)
}

/** One event with a host presentation envelope riding beside it. */
function makeEventWithView(
  type: string,
  data: unknown,
  seq: number,
  view: unknown,
): WireEvent {
  return { type, seq, time: seq * 1_000, data, view }
}

/** A diff-card presentation envelope (`{ for, view }` host shape). */
function diffEnvelope(title: string, diffs: unknown): unknown {
  return { for: 'call', view: { card: 'diff', title, diffs } }
}

describe('foldEvents', () => {
  it('folds one full turn: user message, streamed chunks, final assistant message', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '查一下天气'), 0),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '今天' } }, 1),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '晴天' } }, 2),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '今天晴天'), 3),
    ]
    const result = foldEvents(events)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ kind: 'user', id: 'u-1', text: '查一下天气', seq: 0 })
    expect(result[1]).toMatchObject({
      kind: 'assistant',
      id: 'a-1',
      text: '今天晴天',
      seq: 3,
      pending: false,
    })
  })

  it('restores diff cards for host-folded rows that arrived without a view', () => {
    // 首屏是宿主折叠好的行，不是事件流：那些行里的工具调用不一定带 diff 视图。
    // 少了它，整段编辑在手机上就只剩一坨参数 JSON。
    const rows: RenderMessage[] = [{
      id: 'a-1',
      kind: 'assistant',
      text: '好了',
      seq: 5,
      time: 1,
      tools: [{
        callId: 'c1',
        name: 'edit',
        arguments: '{"file_path":"a.txt","old_string":"old line","new_string":"new line"}',
        state: 'ok',
      }],
    }]
    const folder = new EventFolder(rows, 5)
    const restored = folder.fold([]).find(message => message.id === 'a-1')
    expect(restored?.tools?.[0]?.view).toEqual({
      card: 'diff',
      title: 'edit',
      diffs: [{ path: 'a.txt', oldText: 'old line', newText: 'new line' }],
    })
  })

  it('keeps the streamed pending assistant alive while chunks arrive, then finalizes', () => {
    const first = foldEvents([
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      textChunk(0, 0, '你', 1),
      textChunk(0, 0, '好', 2),
    ])
    const pending = first.find(message => message.kind === 'assistant')
    expect(pending).toMatchObject({ text: '你好', pending: true, seq: 2 })

    const finalized = foldEvents(
      [makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '你好！'), 3)],
      first,
    )
    const assistant = finalized.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({ id: 'a-1', text: '你好！', pending: false, seq: 3 })
    // No duplicate assistant message appears.
    expect(finalized.filter(message => message.kind === 'assistant')).toHaveLength(1)
  })

  it('message/update replaces text and message/delete removes the row', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '旧文本'), 0),
      makeEvent('user/message', userMessageData('u-2', '要删掉'), 1),
      makeEvent('message/update', { id: 'u-1', text: '新文本' }, 2),
      makeEvent('message/delete', { id: 'u-2' }, 3),
    ]
    const result = foldEvents(events)
    expect(result.map(message => message.id)).toEqual(['u-1'])
    expect(result[0]).toMatchObject({ id: 'u-1', kind: 'user', text: '新文本', seq: 2 })
  })

  it('accumulates toolSummary on the assistant message owning the tool calls', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '改文件'), 0),
      textChunk(0, 0, '正在处理', 1),
      makeEvent('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{}' }, 2),
      makeEvent('tool/call', { turn: 0, step: 0, callId: 'c2', name: 'read', arguments: '{"path":"a.txt"}' }, 3),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '已完成'), 4),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.toolSummary).toBe('使用 bash / read')
    expect(assistant?.tools).toEqual([
      { callId: 'c1', name: 'bash', arguments: '{}', state: 'running' },
      { callId: 'c2', name: 'read', arguments: '{"path":"a.txt"}', state: 'running' },
    ])
  })

  it('keeps reasoning text apart from the message body and folds reasoning-delta chunks', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '复杂问题'), 0),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: '先分析' } }, 1),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: '再行动' } }, 2),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 1, text: '结论' } }, 3),
      makeEvent('assistant/message', {
        turn: 0,
        step: 0,
        message: {
          id: 'a-1',
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '先分析再行动' },
            { type: 'text', text: '结论' },
          ],
          source: { kind: 'model', provider: 'fx', model: 'fx-1' },
        },
      }, 4),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({ text: '结论', reasoning: '先分析再行动', pending: false })
    // The reasoning deltas ALSO land in the flow as one positioned part,
    // ahead of the text they precede: the process group builds its think row
    // from the flow (the merged `reasoning` string is only the fallback for
    // flows that never carried a positioned reasoning part).
    expect(assistant?.flow).toEqual([
      { kind: 'reasoning', text: '先分析再行动' },
      { kind: 'text', text: '结论' },
    ])
  })

  it('keeps streamed reasoning when the final assistant message omits the reasoning block', () => {
    const streamed = foldEvents([
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: '思考过程' } }, 1),
    ])
    const finalized = foldEvents(
      [makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '回答'), 2)],
      streamed,
    )
    const assistant = finalized.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({ text: '回答', reasoning: '思考过程', pending: false })
  })

  it('dedupes repeated tool/call events by callId', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '跑测试'), 0),
      textChunk(0, 0, '开始', 1),
      makeEvent('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"a"}' }, 2),
      makeEvent('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"a"}' }, 3),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, 'done'), 4),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.tools).toEqual([{ callId: 'c1', name: 'bash', arguments: '{"cmd":"a"}', state: 'running' }])
  })

  it('attaches the host diff-card view to the tool call it rides beside', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '改文件'), 0),
      textChunk(0, 0, '正在写', 1),
      makeEventWithView('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'write', arguments: '{"file_path":"a.txt"}' }, 2,
        diffEnvelope('Write a.txt', [{ path: 'a.txt', oldText: null, newText: 'hello\n' }])),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '完成'), 3),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.tools).toEqual([
      {
        callId: 'c1',
        name: 'write',
        arguments: '{"file_path":"a.txt"}',
        state: 'running',
        view: { card: 'diff', title: 'Write a.txt', diffs: [{ path: 'a.txt', oldText: null, newText: 'hello\n' }] },
      },
    ])
  })

  it('replaces the call-time diff view with the result view on tool/result', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '改文件'), 0),
      textChunk(0, 0, '正在写', 1),
      makeEventWithView('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'edit', arguments: '{"file_path":"a.txt"}' }, 2,
        diffEnvelope('Edit a.txt', [{ path: 'a.txt', oldText: 'old', newText: 'new' }])),
      makeEventWithView('tool/result', {
        turn: 0,
        step: 0,
        message: { role: 'tool', content: [{ type: 'text', text: 'ok' }], source: { callId: 'c1' } },
      }, 3, { for: 'result', view: { card: 'diff', title: 'Edit a.txt', diffs: [{ path: 'a.txt', oldText: 'old\nctx', newText: 'new\nctx' }] } }),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '完成'), 4),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.tools?.[0]?.view).toEqual({
      card: 'diff',
      title: 'Edit a.txt',
      diffs: [{ path: 'a.txt', oldText: 'old\nctx', newText: 'new\nctx' }],
    })
    // The result settles the row even though it carried no NEW view here:
    // the timeline's dot must stop spinning.
    expect(assistant?.tools?.[0]?.state).toBe('ok')
  })
  it('derives a diff card from edit arguments when the host sent no view', () => {
    // 宿主对某些 edit 不给 presentation view：只剩原始参数。但参数里本来就是
    // 一对 old_string / new_string，够画红绿了 —— 把整段 JSON 摊在屏幕上才是浪费。
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '改文件'), 0),
      makeEvent('tool/call', {
        turn: 0,
        step: 0,
        callId: 'c1',
        name: 'edit',
        arguments: '{"file_path":"a.txt","old_string":"old line","new_string":"new line"}',
      }, 1),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '好了'), 2),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.tools?.[0]?.view).toEqual({
      card: 'diff',
      title: 'edit',
      diffs: [{ path: 'a.txt', oldText: 'old line', newText: 'new line' }],
    })
  })

  it('appends one turn tail carrying the duration and the produced files', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '写点东西'), 0),
      makeEvent('turn/start', { turn: 1 }, 1),
      makeEventWithView('tool/call', { turn: 1, step: 0, callId: 'c1', name: 'write', arguments: '{"file_path":"draft.md"}' }, 2,
        diffEnvelope('Write draft.md', [{ path: 'draft.md', oldText: null, newText: '草稿\n' }])),
      makeEvent('assistant/message', assistantMessageData('a-1', 1, 0, '好了'), 3),
      makeEvent('turn/end', { turn: 1, reason: { kind: 'done' } }, 4),
    ]
    const result = foldEvents(events)
    const tails = result.filter(message => message.kind === 'turn')
    expect(tails.length).toBe(1)
    expect(typeof tails[0]?.durationMs).toBe('number')
    expect(tails[0]?.durationMs).toBeGreaterThanOrEqual(0)
    expect(tails[0]?.produced).toEqual(['draft.md'])
    // The tail is the last row of the turn.
    expect(result[result.length - 1]?.kind).toBe('turn')
  })

  it('carries the presented deliverables and keeps them out of the produced list', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '写报告'), 0),
      makeEvent('turn/start', { turn: 1 }, 1),
      makeEventWithView('tool/call', { turn: 1, step: 0, callId: 'c1', name: 'write', arguments: '{"file_path":"report.md"}' }, 2,
        diffEnvelope('Write report.md', [{ path: 'report.md', oldText: null, newText: '# 报告\n' }])),
      makeEventWithView('tool/call', { turn: 1, step: 0, callId: 'c2', name: 'edit', arguments: '{"file_path":"draft.md"}' }, 3,
        diffEnvelope('Edit draft.md', [{ path: 'draft.md', oldText: 'x', newText: 'y' }])),
      makeEvent('deliverables/presented', { turn: 1, callId: 'c2', files: [{ path: 'report.md', description: '交付报告' }] }, 4),
      makeEvent('assistant/message', assistantMessageData('a-1', 1, 0, '好了'), 5),
      makeEvent('turn/end', { turn: 1, reason: { kind: 'done' } }, 6),
    ]
    const result = foldEvents(events)
    const tail = result.find(message => message.kind === 'turn')
    expect(tail?.deliverables).toEqual([{ path: 'report.md', description: '交付报告' }])
    // A declared deliverable is not repeated under "本轮产出文件".
    expect(tail?.produced).toEqual(['draft.md'])
  })

  it('replaces the turn tail instead of stacking a second one when the window replays', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '干活'), 0),
      makeEvent('turn/start', { turn: 1 }, 1),
      makeEvent('assistant/message', assistantMessageData('a-1', 1, 0, '做完了'), 2),
      makeEvent('deliverables/presented', { turn: 1, callId: 'c1', files: [{ path: 'a.md' }] }, 3),
      makeEvent('turn/end', { turn: 1, reason: { kind: 'done' } }, 4),
    ]
    const first = foldEvents(events)
    const again = foldEvents(events, first)
    expect(again.filter(message => message.kind === 'turn').length).toBe(1)
    expect(again.find(message => message.kind === 'turn')?.deliverables).toEqual([{ path: 'a.md' }])
  })

  it('rebuilds the turn tail from a page that arrives as rows with no turn/end', () => {
    // 刷新后的复现：宿主折叠页给的是**行**，那一轮的 turn/end 早就不在页面里，
    // 于是 applyTurnEnd 永远不会为它补尾巴 —— 用户刚看到的「本轮产出」卡消失。
    // 产出清单的另一半（工具参数）在行里，可以据此重建。
    const rows: RenderMessage[] = [
      { id: 'u-1', kind: 'user', text: '写报告', seq: 0, time: 0 },
      {
        id: 'a-1',
        kind: 'assistant',
        text: '好了',
        seq: 2,
        time: 2_000,
        turn: 1,
        // No `view`: a history read does not necessarily carry the presenter's
        // diff card. The call's own arguments are the durable half.
        tools: [{ callId: 'c1', name: 'write', arguments: '{"file_path":"report.md"}', state: 'ok' }],
      },
    ]
    const result = ensureTurnTails(rows)
    const tail = result.find(message => message.kind === 'turn')
    expect(tail?.produced).toEqual(['report.md'])
    expect(result[result.length - 1]).toBe(tail)
    // 报告行不能带锚点行的 step：行 key 是 (turn, step)，带上就和那一行撞 key，
    // React 对重复 key 的处理是"可能重复或丢弃子节点"—— 卡片就时有时无。
    expect(tail?.step).toBeUndefined()
  })

  it('recovers the declared deliverables from a present call when rebuilding the tail', () => {
    const rows: RenderMessage[] = [
      { id: 'u-1', kind: 'user', text: '写报告', seq: 0, time: 0 },
      {
        id: 'a-1',
        kind: 'assistant',
        text: '好了',
        seq: 2,
        time: 2_000,
        turn: 1,
        tools: [
          { callId: 'c1', name: 'write', arguments: '{"file_path":"report.md"}', state: 'ok' },
          {
            callId: 'c2',
            name: 'present',
            arguments: '{"files":[{"path":"report.md","description":"交付报告"}]}',
            state: 'ok',
          },
        ],
      },
    ]
    const tail = ensureTurnTails(rows).find(message => message.kind === 'turn')
    expect(tail?.deliverables).toEqual([{ path: 'report.md', description: '交付报告' }])
    // 已声明的交付物不在产出里重报一遍。
    expect(tail?.produced).toBeUndefined()
  })

  it('leaves a turn that already has its tail, and a still-running turn, alone', () => {
    const tailed: RenderMessage[] = [
      { id: 'u-1', kind: 'user', text: '写报告', seq: 0, time: 0 },
      {
        id: 'a-1',
        kind: 'assistant',
        text: '好了',
        seq: 2,
        time: 2_000,
        turn: 1,
        tools: [{ callId: 'c1', name: 'write', arguments: '{"file_path":"report.md"}', state: 'ok' }],
      },
      { id: 'turn-tail:1', kind: 'turn', text: '', seq: 3, time: 3_000, turn: 1, produced: ['report.md'] },
    ]
    expect(ensureTurnTails(tailed)).toHaveLength(3)
    // 正在跑的回合不提前挂卡：它的卡等 turn/end 到了再出。
    const running: RenderMessage[] = [
      { id: 'u-1', kind: 'user', text: '写报告', seq: 0, time: 0 },
      {
        id: 'a-1',
        kind: 'assistant',
        text: '写着',
        seq: 2,
        time: 2_000,
        turn: 1,
        tools: [{ callId: 'c1', name: 'write', arguments: '{"file_path":"report.md"}', state: 'running' }],
      },
    ]
    expect(ensureTurnTails(running).some(message => message.kind === 'turn')).toBe(false)
  })

  it('replaces an empty report row instead of trusting it, and drops it when nothing is left', () => {
    // 老窗口会为"只有时钟"的回合也落一行尾巴（清单为空）：空尾巴渲染成 null，
    // 卡片看起来"消失"，而重建又因为它"已存在"被跳过。空行不算数。
    const rows: RenderMessage[] = [
      { id: 'u-1', kind: 'user', text: '写报告', seq: 0, time: 0 },
      {
        id: 'a-1',
        kind: 'assistant',
        text: '好了',
        seq: 2,
        time: 2_000,
        turn: 1,
        tools: [{ callId: 'c1', name: 'write', arguments: '{"file_path":"report.md"}', state: 'ok' }],
      },
      { id: 'turn-tail:1', kind: 'turn', text: '', seq: 3, time: 3_000, turn: 1, durationMs: 2_000 },
    ]
    const result = ensureTurnTails(rows)
    const tail = result.find(message => message.kind === 'turn')
    expect(tail?.produced).toEqual(['report.md'])
    // 老行的时长留着（它是可信的），清单补上。
    expect(tail?.durationMs).toBe(2_000)
    expect(result).toHaveLength(3)
    // 真的什么都没有的回合：空尾巴不留（否则永远挂着一张渲染成 null 的行）。
    const emptyOnly: RenderMessage[] = [
      { id: 'u-1', kind: 'user', text: '你好', seq: 0, time: 0 },
      { id: 'a-1', kind: 'assistant', text: '你好', seq: 1, time: 1_000, turn: 1 },
      { id: 'turn-tail:1', kind: 'turn', text: '', seq: 2, time: 2_000, turn: 1, durationMs: 1_000 },
    ]
    expect(ensureTurnTails(emptyOnly).some(message => message.kind === 'turn')).toBe(false)
  })

  it('builds the card from the result meta when the arguments were stripped', () => {
    // 真机形态：窗口只留最近的几步，参数被投影剥掉、也没有 diff 视图；
    // 但 tool/result 的 meta 里带着改过的文件（edit 的 diffs）。卡片据此重建。
    const rows = foldEvents([
      makeEvent('turn/start', { turn: 7 }, 100),
      makeEvent('tool/call', { turn: 7, step: 0, callId: 'c1', name: 'edit' }, 101),
      makeEvent('tool/result', {
        turn: 7,
        step: 0,
        message: { source: { callId: 'c1' } },
        meta: { path: 'src/a.ts', diffs: [{ path: 'src/a.ts', oldText: 'a', newText: 'b' }] },
      }, 102),
      makeEvent('turn/end', { turn: 7 }, 200),
    ])
    const tail = rows.find(row => row.kind === 'turn')
    expect(tail?.produced).toEqual(['src/a.ts'])
  })

  it('flags a page whose row lost its edit calls but still shows a shell call', () => {
    // 页里只剩 pwsh（一轮里早先的 edit 被窗口截掉）：判据不能挂在工具名上。
    const page: RenderMessage[] = [
      { id: 'u-2', kind: 'user', text: '改代码', seq: 0, time: 0 },
      {
        id: 'a-2',
        kind: 'assistant',
        text: '好了',
        seq: 2,
        time: 2_000,
        turn: 3,
        tools: [{ callId: 'c9', name: 'pwsh', state: 'ok' }],
      },
    ]
    expect(missingTurnReports(page)).toEqual([3])
  })

  it('flags a page that should have a card but cannot build one, and merges a recovered one', () => {
    // 页里只剩工具名（参数被投影剥掉、也没有 diff 视图）：页自己拼不出卡片。
    const page: RenderMessage[] = [
      { id: 'u-1', kind: 'user', text: '写报告', seq: 0, time: 0 },
      {
        id: 'a-1',
        kind: 'assistant',
        text: '好了',
        seq: 2,
        time: 2_000,
        turn: 1,
        tools: [{ callId: 'c1', name: 'write_file', state: 'ok' }],
      },
    ]
    expect(expectsTurnReport(page)).toBe(true)
    expect(ensureTurnTails(page).some(message => message.kind === 'turn')).toBe(false)
    // 已经挂上卡片的页不需要再读日志。
    const tailed: RenderMessage[] = [
      ...page,
      { id: 'turn-tail:1', kind: 'turn', text: '', seq: 3, time: 3_000, turn: 1, produced: ['report.md'] },
    ]
    expect(expectsTurnReport(tailed)).toBe(false)
    // 纯聊天回合（没写文件）也不该触发补读。
    expect(expectsTurnReport([{ id: 'a-9', kind: 'assistant', text: '好', seq: 1, time: 1_000, turn: 9 }])).toBe(false)

    // 日志里折出来的报告行并回去：落在那一轮最后一行的后面，同 id 的空行被替换。
    const recovered: RenderMessage[] = [
      { id: 'turn-tail:1', kind: 'turn', text: '', seq: 3, time: 3_000, turn: 1, produced: ['report.md'] },
    ]
    const merged = mergeTurnReports(page, recovered)
    expect(merged.map(message => message.id)).toEqual(['u-1', 'a-1', 'turn-tail:1'])
    const mergedOverEmpty = mergeTurnReports(
      [...page, { id: 'turn-tail:1', kind: 'turn', text: '', seq: 3, time: 3_000, turn: 1 }],
      recovered,
    )
    expect(mergedOverEmpty.filter(message => message.id === 'turn-tail:1')).toHaveLength(1)
    expect(mergedOverEmpty[mergedOverEmpty.length - 1]?.produced).toEqual(['report.md'])
    // 空报告行（日志里也没东西）不并入。
    expect(mergeTurnReports(page, [{ id: 'turn-tail:1', kind: 'turn', text: '', seq: 3, time: 3_000, turn: 1 }]))
      .toEqual(page)
  })

  it('marks a call stopped when the turn ends with it still open', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '跑一下'), 0),
      makeEvent('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"command":"sleep 99"}' }, 1),
      makeEvent('turn/end', { turn: 0, reason: { kind: 'error' } }, 2),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.tools?.[0]?.state).toBe('stopped')
  })

  it('keeps the interleaved flow: text runs and tool calls at their event time points', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '改文件'), 0),
      textChunk(0, 0, '先看这个', 1),
      makeEventWithView('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'write', arguments: '{"file_path":"a.txt"}' }, 2,
        diffEnvelope('Write a.txt', [{ path: 'a.txt', oldText: 'old', newText: 'new' }])),
      textChunk(0, 0, '再看那个', 3),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '先看这个再看那个'), 4),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    // The text runs stay split around the call: [text before, tool, text after].
    expect(assistant?.flow).toEqual([
      { kind: 'text', text: '先看这个', seq: 1 },
      { kind: 'tool', callId: 'c1' },
      { kind: 'text', text: '再看那个' }
    ])
  })

  it('collapses the flow to one text run when the final text rewrites the accumulation', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '改文件'), 0),
      textChunk(0, 0, '流式前缀', 1),
      makeEventWithView('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'write', arguments: '{"file_path":"a.txt"}' }, 2,
        diffEnvelope('Write a.txt', [{ path: 'a.txt', oldText: 'old', newText: 'new' }])),
      // The authoritative final text differs from the chunk accumulation.
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '权威终稿'), 3),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    // Every text run collapses into ONE TRAILING run of the authoritative
    // text; the tool part survives at its own (earlier) position — a call is
    // an independent event, never dropped by a rewrite. The answer therefore
    // lands AFTER the step that produced it, never before it.
    expect(assistant?.flow).toEqual([
      { kind: 'tool', callId: 'c1' },
      { kind: 'text', text: '权威终稿', seq: 3 },
    ])
  })

  it('ignores non-diff presentation views and keeps the raw arguments fallback', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '跑命令'), 0),
      textChunk(0, 0, '跑', 1),
      makeEventWithView('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }, 2,
        { for: 'call', view: { card: 'terminal', title: 'Bash', output: 'a.txt' } }),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, 'done'), 3),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.tools).toEqual([{ callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}', state: 'running' }])
  })

  it('marks the assistant message failed when turn/end ends in an error', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', 'hello'), 0),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '部分' } }, 1),
      makeEvent('turn/end', { turn: 0, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } }, 2),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({ failed: true, pending: false, kind: 'assistant' })
  })

  it('does not flag failed for a completed turn', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', 'hello'), 0),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, 'ok'), 1),
      makeEvent('turn/end', { turn: 0, reason: { kind: 'completed' } }, 2),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.failed).toBeFalsy()
    expect(assistant?.pending).toBeFalsy()
  })

  it('keeps same-turn steps in final-event order after turn/end', () => {
    const result = foldEvents([
      makeEvent('user/message', userMessageData('u-1', 'multi-step'), 0),
      makeEvent('assistant/message', assistantMessageData('step-z', 0, 0, 'first'), 2),
      makeEvent('assistant/message', assistantMessageData('step-a', 0, 1, 'second'), 4),
      makeEvent('assistant/message', assistantMessageData('step-m', 0, 2, 'third'), 6),
      makeEvent('turn/end', { turn: 0, reason: { kind: 'completed' } }, 7),
    ])

    const assistants = result.filter(message => message.kind === 'assistant')
    expect(assistants.map(message => message.id)).toEqual(['step-z', 'step-a', 'step-m'])
    expect(assistants.map(message => message.seq)).toEqual([2, 4, 6])
    expect(assistants.every(message => message.pending !== true)).toBe(true)
  })

  it('keeps stable insertion order when legacy rows share a seq', () => {
    const folder = new EventFolder([
      { id: 'z-last-lexically', kind: 'assistant', text: 'first', seq: 5, time: 5_000 },
      { id: 'a-first-lexically', kind: 'assistant', text: 'second', seq: 5, time: 5_000 },
    ])
    expect(folder.snapshot().map(message => message.id)).toEqual(['z-last-lexically', 'a-first-lexically'])
  })

  it('is idempotent: applying the same batch twice yields an identical list', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      textChunk(0, 0, '一', 1),
      textChunk(0, 0, '二', 2),
      makeEvent('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{}' }, 3),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '一二'), 4),
      makeEvent('turn/end', { turn: 0, reason: { kind: 'completed' } }, 5),
    ]
    // 幂等性测的是真实路径：一个 EventFolder 实例被反复折叠（ChatView 就是这么
    // 喂 live 事件的）。`foldEvents(events, rows)` 那个入口是从**行**重建的，
    // 行里没有每轮的起始锚点，重建后 turn/end 只能退回"本轮最早一行"的兜底
    // 时间，于是与首次折叠不再逐字节相同——这是那个入口的固有损失，不是折叠的
    // 重复计算。这里按实例测，重复折叠必须一字节不差。
    const folder = new EventFolder()
    const once = folder.fold(events)
    const twice = folder.fold(events)
    expect(twice).toEqual(once)
    expect(twice.filter(message => message.kind === 'assistant')).toHaveLength(1)
    // Text must not have doubled from re-aggregating the streamed chunks.
    expect(twice.find(message => message.kind === 'assistant')?.text).toBe('一二')
  })

  it('skips unknown / unsupported event types safely', () => {
    const events: WireEvent[] = [
      makeEvent('session/end-seed', {}, 0),
      makeEvent('turn/start', { turn: 0 }, 1),
      makeEvent('user/message', userMessageData('u-1', 'hello'), 2),
      makeEvent('some/future-plugin', { whatever: true }, 3),
      makeEvent('goal/change', { objective: 'x' }, 4),
    ]
    const result = foldEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'u-1', kind: 'user' })
  })

  it('does not mutate the caller-supplied existing list', () => {
    const first = foldEvents([makeEvent('user/message', userMessageData('u-1', 'hello'), 0)])
    const snapshot = JSON.stringify(first)
    foldEvents([makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, 'world'), 1)], first)
    expect(JSON.stringify(first)).toBe(snapshot)
  })

  it('attaches usage from the assistant event', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      makeEvent('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        usage: { inputTokens: 10, outputTokens: 5 },
      }, 1),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({ usage: { inputTokens: 10, outputTokens: 5 } })
  })

  it('assistant/message without usage has no usage field', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      makeEvent('assistant/message', { turn: 0, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }, 1),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.usage).toBeUndefined()
  })

  it('attaches sourceKind from source.kind for a user message', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', {
        id: 'u-plugin',
        role: 'user',
        content: [{ type: 'text', text: '系统注入' }],
        source: { kind: 'plugin', name: 'react-extension' },
      }, 0),
    ]
    const result = foldEvents(events)
    expect(result[0]).toMatchObject({ id: 'u-plugin', kind: 'user', sourceKind: 'plugin' })
  })

  it('keeps sourceKind on a replayed/replaced user/message', () => {
    const first = foldEvents([makeEvent('user/message', {
      id: 'u-1',
      role: 'user',
      content: [{ type: 'text', text: '第一版' }],
      source: { kind: 'plugin' },
    }, 0)])
    const second = foldEvents([makeEvent('user/message', {
      id: 'u-1',
      role: 'user',
      content: [{ type: 'text', text: '第二版' }],
      source: { kind: 'plugin' },
    }, 1)], first)
    expect(second[0]).toMatchObject({ id: 'u-1', text: '第二版', sourceKind: 'plugin' })
  })

  it('folds image attachments off a user message into images', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', {
        id: 'u-img',
        role: 'user',
        content: [
          { type: 'text', text: '测试一下，这是什么东西' },
          {
            type: 'image',
            attachment: {
              attachmentId: 'sha256:abc',
              mediaType: 'image/jpeg',
              width: 810,
              height: 1440,
              bytes: 52627,
              name: '1000244807.jpg',
            },
          },
        ],
        source: { kind: 'user' },
      }, 0),
    ]
    const [message] = foldEvents(events)
    expect(message?.text).toBe('测试一下，这是什么东西')
    expect(message?.images).toEqual([{
      attachmentId: 'sha256:abc',
      mediaType: 'image/jpeg',
      width: 810,
      height: 1440,
      bytes: 52627,
      name: '1000244807.jpg',
    }])
  })

  it('keeps an image-only user message alive with empty text', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', {
        id: 'u-img-only',
        role: 'user',
        content: [{ type: 'image', attachment: { attachmentId: 'sha256:def', mediaType: 'image/png', width: 4, height: 4 } }],
        source: { kind: 'user' },
      }, 0),
    ]
    const [message] = foldEvents(events)
    // 文本为空是正常的：渲染端靠 images 判定"这行有内容"，否则整行会被丢掉。
    expect(message?.text).toBe('')
    expect(message?.images).toHaveLength(1)
    expect(message?.images?.[0]?.attachmentId).toBe('sha256:def')
  })

  it('skips image blocks without an id or media type, and leaves text-only rows without images', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', {
        id: 'u-broken',
        role: 'user',
        content: [{ type: 'image', attachment: { mediaType: 'image/png' } }],
        source: { kind: 'user' },
      }, 0),
      makeEvent('user/message', userMessageData('u-plain', '只有文字'), 1),
    ]
    const result = foldEvents(events)
    expect(result[0]?.images).toBeUndefined()
    expect(result[1]?.images).toBeUndefined()
  })

  it('keeps images on a replayed/replaced user/message', () => {
    const content = [
      { type: 'text', text: '带图' },
      { type: 'image', attachment: { attachmentId: 'sha256:keep', mediaType: 'image/webp', width: 2, height: 2 } },
    ]
    const first = foldEvents([makeEvent('user/message', { id: 'u-1', role: 'user', content, source: { kind: 'user' } }, 0)])
    const second = foldEvents([makeEvent('user/message', { id: 'u-1', role: 'user', content, source: { kind: 'user' } }, 1)], first)
    expect(second[0]?.images?.[0]?.attachmentId).toBe('sha256:keep')
  })

  it('request/context and unknown events are still ignored by the fold', () => {
    const events: WireEvent[] = [
      makeEvent('some/future-event', { nope: true }, 0),
      makeEvent('request/context', { provider: 'fx', model: 'fx-1' }, 1),
      makeEvent('user/message', userMessageData('u-1', '真实消息'), 2),
    ]
    const result = foldEvents(events)
    // request/context with no window and the unknown event render nothing.
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'u-1', kind: 'user' })
  })
})

describe('EventFolder incremental folding', () => {
  it('matches a one-shot fold when events arrive one at a time', () => {
    const stream: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      textChunk(0, 0, '你', 1),
      textChunk(0, 0, '好', 2),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '你好'), 3),
      makeEvent('message/update', { id: 'u-1', text: '更新' }, 4),
    ]
    const oneShot = foldEvents(stream)
    const folder = new EventFolder()
    let incremental: ReturnType<typeof foldEvents> = []
    for (const event of stream) incremental = folder.fold([event])
    expect(incremental).toEqual(oneShot)
  })

  it('replays and re-folds are no-ops and reuse the previous snapshot identity', () => {
    const folder = new EventFolder(foldEvents([
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      textChunk(0, 0, '你', 1),
    ]))
    const first = folder.fold([textChunk(0, 0, '好', 2)])
    expect(first[first.length - 1]).toMatchObject({ text: '你好', pending: true })
    // Same event again (wire replay or a double-invoked state updater): no change, same identity.
    const replay = folder.fold([textChunk(0, 0, '好', 2)])
    expect(replay).toBe(first)
    // A no-op batch over an already folded stream also keeps the identity.
    expect(folder.fold([])).toBe(first)
  })

  it('applies every event of one batch even when two share a seq above the watermark', () => {
    const folder = new EventFolder(foldEvents([
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
    ]))
    // A merged frame can legally carry multiple events of one seq: both apply
    // (the old live-maxSeq check skipped the batch's second same-seq event).
    const batch = folder.fold([
      textChunk(0, 0, '你', 1),
      textChunk(0, 0, '好', 1),
    ])
    expect(batch[batch.length - 1]).toMatchObject({ text: '你好', pending: true })
    // Cross-batch replay is still gated by the watermark snapshot.
    const replay = folder.fold([textChunk(0, 0, '好', 1)])
    expect(replay).toBe(batch)
  })

  it('prepends older pages and keeps folding live events on top', () => {
    const folder = new EventFolder(foldEvents([
      makeEvent('user/message', userMessageData('u-2', '第二页'), 10),
    ]))
    folder.prepend(foldEvents([makeEvent('user/message', userMessageData('u-1', '第一页'), 5)]))
    const withLive = folder.fold([textChunk(0, 0, '新', 11)])
    expect(withLive.map(message => message.id)).toEqual(['u-1', 'u-2', 'assistant,0.0#11'])
    // The live fold must not lose the prepended rows on later events.
    const later = folder.fold([textChunk(0, 0, '续', 12)])
    expect(later.map(message => message.id)).toEqual(['u-1', 'u-2', 'assistant,0.0#11'])
    expect(later[2]).toMatchObject({ text: '新续', pending: true })
  })

  it('seed replaces the whole stream', () => {
    const folder = new EventFolder(foldEvents([makeEvent('user/message', userMessageData('u-1', '旧'), 0)]))
    folder.seed(foldEvents([makeEvent('user/message', userMessageData('u-2', '新'), 5)]))
    expect(folder.snapshot().map(message => message.id)).toEqual(['u-2'])
    expect(folder.fold([textChunk(0, 0, '追加', 6)]).map(message => message.id)).toEqual(['u-2', 'assistant,0.0#6'])
  })

  it('carries (turn, step) on streaming rows across the settle id swap', () => {
    const folder = new EventFolder()
    folder.fold([textChunk(0, 0, '你好', 1)])
    const pending = folder.snapshot()[0]
    expect(pending).toMatchObject({ turn: 0, step: 0, pending: true })
    // The final event swaps the synthetic id for the host's authoritative
    // one; (turn, step) must survive so surfaces can key rows stably.
    folder.fold([makeEvent('assistant/message', {
      turn: 0, step: 0,
      message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '你好' }] },
    }, 2)])
    const settled = folder.snapshot()[0]
    expect(settled.id).toBe('a-1')
    expect(settled).toMatchObject({ turn: 0, step: 0, pending: false })
  })

  it('rebuilt folders re-index (turn, step) from row fields — a live chunk appends to the settled row', () => {
    // The chat-window (v3) path restores folders from HOST-FOLDED rows, not
    // events: the row carries the wire id (a-1), from which the synthetic
    // "assistant,0.0#N" format cannot recover the turn/step key. The rebuild
    // must index from the row's own turn/step fields, or the next live chunk
    // for the same (turn, step) would mint a NEW row instead of appending.
    const rows = foldEvents([
      textChunk(0, 0, '你好', 1),
      makeEvent('assistant/message', {
        turn: 0, step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: '你好' }] },
      }, 2),
    ])
    const rebuilt = new EventFolder(rows)
    expect(rebuilt.snapshot()[0]).toMatchObject({ id: 'a-1', text: '你好', turn: 0, step: 0 })
    // A late chunk for the same step appends to the settled row, never a
    // duplicate.
    const after = rebuilt.fold([textChunk(0, 0, '追加', 5)])
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: 'a-1', text: '你好追加', pending: false })
  })

  it('tool-call placeholders carry (turn, step) too', () => {
    const folder = new EventFolder()
    folder.fold([makeEvent('tool/call', { turn: 2, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }, 3)])
    const row = folder.snapshot()[0]
    expect(row).toMatchObject({ turn: 2, step: 1, pending: true })
  })

  it('stamps (turn, step) on a host-uuid assistant row and keeps every tool of that step', () => {
    // D2：真机 turn 3 step1 实际有 3 个工具，卡片只报 1 步。根因是
    // assistant/message 的**新建**分支不带 step：行 id 是宿主 uuid，
    // turnStepKeyOf 反解不出 (turn, step)，于是第一枚 tool/result 换掉行对象后
    // (turn, step) 索引仍指着旧对象，之后的 tool/call 全被静默丢弃。
    const events: WireEvent[] = [
      makeEvent('turn/start', { turn: 3 }, 1),
      makeEvent('assistant/message', assistantMessageData('uuid-step-1', 3, 1, '先看一眼'), 2),
      makeEvent('tool/call', { turn: 3, step: 1, callId: 'c1', name: 'read', arguments: '{}' }, 3),
      makeEvent('tool/result', { turn: 3, step: 1, message: { source: { callId: 'c1' } } }, 4),
      makeEvent('tool/call', { turn: 3, step: 1, callId: 'c2', name: 'bash', arguments: '{}' }, 5),
      makeEvent('tool/result', { turn: 3, step: 1, message: { source: { callId: 'c2' } } }, 6),
      makeEvent('tool/call', { turn: 3, step: 1, callId: 'c3', name: 'edit', arguments: '{}' }, 7),
    ]

    const rows = foldEvents(events)
    const assistant = rows.filter(row => row.kind === 'assistant')
    expect(assistant).toHaveLength(1)
    expect(assistant[0]).toMatchObject({ id: 'uuid-step-1', turn: 3, step: 1 })
    expect(assistant[0]?.tools?.map(tool => tool.callId)).toEqual(['c1', 'c2', 'c3'])
    expect(assistant[0]?.tools?.map(tool => tool.state)).toEqual(['ok', 'ok', 'running'])
  })

  it('keeps the (turn, step) index on the live row after a rewrite (rebuilt folders too)', () => {
    // 同一步里 tool/result 换掉行对象之后，下一枚 tool/call 必须落在**新**对象上；
    // host-folded rows 重建出来的 EventFolder 也一样。
    const rows = foldEvents([
      makeEvent('assistant/message', assistantMessageData('uuid-a', 3, 1, '第一步'), 1),
      makeEvent('tool/call', { turn: 3, step: 1, callId: 'c1', name: 'read', arguments: '{}' }, 2),
      makeEvent('tool/result', { turn: 3, step: 1, message: { source: { callId: 'c1' } } }, 3),
    ])
    const folder = new EventFolder(rows)
    const after = folder.fold([makeEvent('tool/call', { turn: 3, step: 1, callId: 'c2', name: 'bash', arguments: '{}' }, 4)])

    expect(after).toHaveLength(1)
    expect(after[0]?.tools?.map(tool => tool.callId)).toEqual(['c1', 'c2'])
  })

  it('folds a command run+done pair into one card that settles with the result', () => {
    const events: WireEvent[] = [
      makeEvent('command/run', { commandId: 'cmd-1', name: 'compact', args: '', source: { kind: 'user' } }, 0),
      makeEvent('command/done', { commandId: 'cmd-1', kind: 'success', text: 'Compacted 12 history items (~45k tokens).' }, 1),
    ]
    const result = foldEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'command',
      id: 'cmd-1',
      commandLine: '/compact',
      commandPhase: 'success',
      text: 'Compacted 12 history items (~45k tokens).',
    })
  })

  it('keeps the command card running until done lands, even across folds', () => {
    const folder = new EventFolder(foldEvents([
      makeEvent('command/run', { commandId: 'cmd-2', name: 'compact', args: '', source: { kind: 'user' } }, 0),
    ]))
    const running = folder.snapshot()[0]
    expect(running).toMatchObject({ kind: 'command', commandPhase: 'running', commandLine: '/compact', text: '' })
    const settled = folder.fold([
      makeEvent('command/done', { commandId: 'cmd-2', kind: 'error', text: 'Compaction cancelled.' }, 1),
    ])
    expect(settled).toHaveLength(1)
    expect(settled[0]).toMatchObject({ id: 'cmd-2', commandPhase: 'error', text: 'Compaction cancelled.' })
  })

  it('renders a settled command card even when the run event is outside the window', () => {
    const result = foldEvents([
      makeEvent('command/done', { commandId: 'cmd-3', kind: 'success', text: 'No compactable history yet.' }, 4),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'command', id: 'cmd-3', commandPhase: 'success', text: 'No compactable history yet.' })
    expect(result[0]?.commandLine).toBeUndefined()
  })

  it('a late run replay never rolls a settled card back to running', () => {
    const result = foldEvents([
      makeEvent('command/done', { commandId: 'cmd-4', kind: 'success', text: '已完成' }, 0),
      makeEvent('command/run', { commandId: 'cmd-4', name: 'compact', args: '', source: { kind: 'user' } }, 1),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'cmd-4', commandPhase: 'success', text: '已完成' })
  })
})

describe('coalesceTurnMessages', () => {
  const step = (id: string, turn: number, text: string, seq: number, extra: Partial<RenderMessage> = {}): RenderMessage => ({
    id,
    kind: 'assistant',
    text,
    seq,
    time: seq * 1_000,
    turn,
    ...extra,
  })

  it('merges consecutive same-turn assistant rows into one turn message', () => {
    const merged = coalesceTurnMessages([
      step('u-1', undefined as never, '用户消息', 0, { kind: 'user' } as never),
      step('a-1', 7, '第一步', 1),
      step('a-2', 7, '第二步', 2),
      step('a-3', 7, '第三步', 3),
      step('a-4', 8, '别的 turn', 4),
    ])
    expect(merged).toHaveLength(3)
    expect(merged[1]).toMatchObject({ id: 'a-1', turn: 7, text: '第一步\n\n第二步\n\n第三步', seq: 3, startSeq: 1 })
    expect(merged[2]).toMatchObject({ id: 'a-4', turn: 8, text: '别的 turn' })
    expect(merged[2]?.startSeq).toBeUndefined()
  })

  it('concatenates reasoning and tools, keeps pending/failed flags', () => {
    const merged = coalesceTurnMessages([
      step('a-1', 7, 'A', 1, { reasoning: '想1', tools: [{ callId: 'c1', name: 'bash' }], pending: true }),
      step('a-2', 7, 'B', 2, { reasoning: '想2', tools: [{ callId: 'c2', name: 'read' }], failed: true }),
      step('a-3', 7, 'C', 3),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.text).toBe('A\n\nB\n\nC')
    expect(merged[0]?.reasoning).toBe('想1\n\n想2')
    expect(merged[0]?.tools?.map(t => t.callId)).toEqual(['c1', 'c2'])
    // The last row finalized (no pending flag), so the merged row must NOT
    // stay streaming-shaped — otherwise a finished turn renders as a plain
    // text preview forever (MarkdownText skips markdown while pending).
    expect(merged[0]?.pending).toBe(false)
    expect(merged[0]?.failed).toBe(true)
    expect(merged[0]?.seq).toBe(3)
  })

  it('merges flows across steps, keeping text runs at their call time points', () => {
    const merged = coalesceTurnMessages([
      step('a-1', 7, '先说', 1, { flow: [{ kind: 'text', text: '先说' }, { kind: 'tool', callId: 'c1' }] }),
      step('a-2', 7, '后说', 2, { flow: [{ kind: 'text', text: '后说' }] }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.flow).toEqual([
      { kind: 'text', text: '先说', seq: 1 },
      { kind: 'tool', callId: 'c1' },
      { kind: 'text', text: '后说', seq: 2 },
    ])
  })

  it('keeps adjacent text runs separate when they represent different searchable steps', () => {
    const merged = coalesceTurnMessages([
      step('a-1', 7, 'A', 1, { flow: [{ kind: 'text', text: 'A' }] }),
      step('a-2', 7, 'B', 2, { flow: [{ kind: 'text', text: 'B' }] }),
    ])
    expect(merged[0]?.flow).toEqual([
      { kind: 'text', text: 'A', seq: 1 },
      { kind: 'text', text: 'B', seq: 2 },
    ])
  })

  it('keeps a merged row pending when every step is still streaming (interrupted turn)', () => {
    const merged = coalesceTurnMessages([
      step('a-1', 7, '第一段', 1, { pending: true }),
      step('a-2', 7, '第二段', 2, { pending: true }),
    ])
    expect(merged).toHaveLength(1)
    // Steps join on a blank line so the streaming preview can close finished
    // steps as real <p> blocks while the last step is still open.
    expect(merged[0]?.text).toBe('第一段\n\n第二段')
    expect(merged[0]?.pending).toBe(true)
  })

  it('does not merge across a user message boundary', () => {
    const merged = coalesceTurnMessages([
      step('a-1', 7, '回复', 1),
      step('u-1', undefined as never, '打断', 2, { kind: 'user' } as never),
      step('a-2', 7, '继续', 3),
    ])
    expect(merged).toHaveLength(3)
    expect(merged.map(m => m.text)).toEqual(['回复', '打断', '继续'])
  })

  it('merges one turn across the hidden injected rows the host emits between steps', () => {
    // 真机 turn 3 的形状：宿主按步发 assistant/message，并在这两步之间注入
    // user/message（compact-checkpoint / agent-instructions / skill-catalog /
    // runtime-context）。它们的 source.kind ≠ 'user' —— message-row 把这类行整个
    // 隐藏，看不见却曾经是合并屏障 ⇒ 一轮断成三张过程卡（用时同为 1分45秒）。
    // 修复后它们对被拆开的同轮是透明的：仍然合成一行。
    const injected = (kind: string, seq: number): RenderMessage => step(`inject-${kind}`, undefined as never, kind, seq, { kind: 'user', sourceKind: kind } as never)
    const merged = coalesceTurnMessages([
      step('a-1', 7, '第一步', 1),
      injected('compact-checkpoint', 2),
      step('a-2', 7, '第二步', 3),
      injected('agent-instructions', 4),
      step('a-3', 7, '第三步', 5),
      injected('skill-catalog', 6),
      injected('runtime-context', 7),
      step('a-4', 7, '第四步', 8),
      injected('runtime-context', 9),
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: 'a-1', turn: 7, seq: 8, text: '第一步\n\n第二步\n\n第三步\n\n第四步' })
    // 每个真实步骤都还在 stepSeqs 里（一步都没丢），注入行不在其中。
    expect(merged[0]?.stepSeqs).toEqual([1, 3, 5, 8])
  })

  it('does not merge across a REAL user row that carries source.kind = user', () => {
    const merged = coalesceTurnMessages([
      step('a-1', 7, '回复', 1),
      step('u-1', undefined as never, '打断', 2, { kind: 'user', sourceKind: 'user' } as never),
      step('a-2', 7, '继续', 3),
    ])

    expect(merged).toHaveLength(3)
    expect(merged.map(m => m.text)).toEqual(['回复', '打断', '继续'])
  })

  it('keeps an injected row that is NOT inside a turn step chain', () => {
    // 只有夹在 assistant 链中间才是透明的；独立出现的注入行留在原处（本来就渲染成
    // 空），它的位置语义不被悄悄改掉。
    const injected = step('inject-x', undefined as never, '系统注入消息', 1, { kind: 'user', sourceKind: 'plugin' } as never)
    const merged = coalesceTurnMessages([injected, step('a-1', 7, '回复', 2)])

    expect(merged.map(m => m.id)).toEqual(['inject-x', 'a-1'])
  })

  it('leaves the turn tail untouched and in place', () => {
    // The tail is its own kind, so the same-turn guard cannot swallow it: the
    // P2 report card must survive the surface's coalescing step.
    const tail: RenderMessage = {
      id: 'turn-tail:7',
      kind: 'turn',
      text: '',
      turn: 7,
      seq: 5,
      time: 5_000,
      durationMs: 12_000,
      produced: ['a.md'],
    }
    const merged = coalesceTurnMessages([step('a-1', 7, '第一步', 1), step('a-2', 7, '第二步', 2), tail])
    expect(merged).toHaveLength(2)
    expect(merged[1]).toMatchObject({ kind: 'turn', id: 'turn-tail:7', durationMs: 12_000 })
    expect(merged[1]?.produced).toEqual(['a.md'])
  })

  it('keeps the FIRST row step on the merged row (stable streaming key)', () => {
    // ChatView keys rows by (turn, step); the merged row must keep the first
    // step so the key does not change when a new step opens mid-stream —
    // otherwise the whole turn message remounts at every step boundary.
    const merged = coalesceTurnMessages([
      step('a-1', 7, '第一步', 1, { step: 0 }),
      step('a-2', 7, '第二步', 2, { step: 1 }),
      step('a-3', 7, '第三步', 3, { step: 2 }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: 'a-1', turn: 7, step: 0 })
  })

  it('leaves a single message and turn-less rows untouched', () => {
    expect(coalesceTurnMessages([step('a-1', 7, '单一', 1)])).toHaveLength(1)
    // 两条**不同**的无轮号消息：无法判断是不是同一轮，保持分开。
    const first = step('a-1', undefined as never, '无 turn 一', 1) as RenderMessage
    const second = step('a-2', undefined as never, '无 turn 二', 2) as RenderMessage
    expect(coalesceTurnMessages([first, second])).toHaveLength(2)
  })

  it('一段有轮号、一段还没轮到 turn/start：同一消息合成一张过程卡（真机双卡）', () => {
    // 进一个正在跑的会话时：尾页折叠出来的那段带 turn 42，mux 实时折出来的那段还
    // 没经历 turn/start，turn 是 undefined —— 但两者是**同一条消息**（id 相同）。
    // 旧判据要求两边都有轮号且相等，于是同一轮被画成两张卡，过一会儿一次整页重折
    // 才合成一张（用户看到「多个过程条 → 一会儿变一条」）。
    const merged = coalesceTurnMessages([
      step('a-1', 42, '第一段', 1),
      step('a-1', undefined as never, '第二段', 2),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.turn).toBe(42)
    expect(merged[0]!.text).toContain('第一段')
    expect(merged[0]!.text).toContain('第二段')
  })

  it('缺轮号且不是同一条消息：不合并（两条独立的助手消息）', () => {
    const merged = coalesceTurnMessages([
      step('a-1', 42, '第一段', 1),
      step('a-9', undefined as never, '另一条', 2),
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('todo plan snapshots (todo/write)', () => {
  it('parses a valid todo/write payload', () => {
    const parsed = parseTodoList({
      todos: [
        { content: '写代码', status: 'in_progress' },
        { content: '跑测试', status: 'pending' },
        { content: '发版', status: 'completed' },
      ],
    })
    expect(parsed).toEqual([
      { content: '写代码', status: 'in_progress' },
      { content: '跑测试', status: 'pending' },
      { content: '发版', status: 'completed' },
    ])
  })

  it('rejects malformed snapshots (root, array, item, status)', () => {
    expect(parseTodoList(null)).toBeUndefined()
    expect(parseTodoList({})).toBeUndefined()
    expect(parseTodoList({ todos: 'nope' })).toBeUndefined()
    expect(parseTodoList({ todos: [null] })).toBeUndefined()
    expect(parseTodoList({ todos: [{ content: 'x', status: 'done' }] })).toBeUndefined()
    expect(parseTodoList({ todos: [{ status: 'pending' }] })).toBeUndefined()
    expect(parseTodoList({ todos: [{ content: 'x' }] })).toBeUndefined()
  })

  it('returns the newest valid snapshot across events (last-write-wins, malformed newer falls through)', () => {
    const events: WireEvent[] = [
      makeEvent('todo/write', { todos: [{ content: '旧', status: 'pending' }] }, 10),
      makeEvent('assistant/message', assistantMessageData('a-1', 1, 0, 'hi'), 11),
      makeEvent('todo/write', { todos: [{ content: '新', status: 'completed' }] }, 12),
    ]
    expect(latestTodoSnapshot(events)).toEqual({ seq: 12, items: [{ content: '新', status: 'completed' }] })
    const malformed: WireEvent[] = [
      ...events,
      makeEvent('todo/write', { todos: 'bad' }, 13),
    ]
    expect(latestTodoSnapshot(malformed)).toEqual({ seq: 12, items: [{ content: '新', status: 'completed' }] })
  })

  it('returns undefined when no valid todo/write exists', () => {
    expect(latestTodoSnapshot([])).toBeUndefined()
    expect(latestTodoSnapshot([makeEvent('turn/start', {}, 1)])).toBeUndefined()
  })

  it('foldTodoEvent replaces on todo/write and keeps a malformed one', () => {
    const first = foldTodoEvent(undefined, makeEvent('todo/write', { todos: [{ content: 'A', status: 'pending' }] }, 10))
    expect(first).toEqual({ seq: 10, items: [{ content: 'A', status: 'pending' }] })
    const second = foldTodoEvent(first, makeEvent('todo/write', { todos: [{ content: 'B', status: 'in_progress' }] }, 11))
    expect(second).toEqual({ seq: 11, items: [{ content: 'B', status: 'in_progress' }] })
    const bad = foldTodoEvent(second, makeEvent('todo/write', { todos: 'bad' }, 12))
    expect(bad).toEqual(second)
  })

  it('foldTodoEvent clears on turn/start (host projection mirror)', () => {
    const seeded = foldTodoEvent(undefined, makeEvent('todo/write', { todos: [{ content: '旧轮', status: 'completed' }] }, 10))
    expect(foldTodoEvent(seeded, makeEvent('turn/start', {}, 11))).toBeUndefined()
  })

  it('foldTodoEvent normalizes in_progress to completed on turn/end (pending untouched)', () => {
    const seeded = foldTodoEvent(undefined, makeEvent('todo/write', {
      todos: [
        { content: '做完了', status: 'in_progress' },
        { content: '没开始', status: 'pending' },
        { content: '早已完成', status: 'completed' },
      ],
    }, 10))
    const ended = foldTodoEvent(seeded, makeEvent('turn/end', { turn: 0, reason: { kind: 'completed' } }, 11))
    expect(ended?.items).toEqual([
      { content: '做完了', status: 'completed' },
      { content: '没开始', status: 'pending' },
      { content: '早已完成', status: 'completed' },
    ])
    expect(ended?.seq).toBe(10)
    // A second turn/end must be idempotent.
    expect(foldTodoEvent(ended, makeEvent('turn/end', { turn: 0, reason: { kind: 'completed' } }, 12))?.items).toEqual(ended?.items)
  })

  it('foldTodoSnapshot folds a whole window in seq order (no stale intermediate state survives a turn/end)', () => {
    const events: WireEvent[] = [
      makeEvent('todo/write', {
        todos: [
          { content: '文档批次', status: 'in_progress' },
          { content: '其余完成', status: 'completed' },
        ],
      }, 20),
      makeEvent('assistant/message', assistantMessageData('a-9', 1, 0, '提交完成'), 21),
      makeEvent('turn/end', { turn: 0, reason: { kind: 'completed' } }, 22),
    ]
    expect(foldTodoSnapshot(events)).toEqual({
      seq: 20,
      items: [
        { content: '文档批次', status: 'completed' },
        { content: '其余完成', status: 'completed' },
      ],
    })
  })

  it('foldTodoSnapshot clears everything when the window opened with a later turn/start and no new write', () => {
    const events: WireEvent[] = [
      makeEvent('todo/write', { todos: [{ content: '上一轮', status: 'in_progress' }] }, 20),
      makeEvent('turn/end', { turn: 0, reason: { kind: 'completed' } }, 21),
      makeEvent('turn/start', {}, 22),
    ]
    expect(foldTodoSnapshot(events)).toBeUndefined()
  })
})

describe('lastOpenTurnStartTime (turn-clock anchor from a raw window)', () => {
  it('returns the open turn/start time when the last boundary is a turn/start', () => {
    const events = [
      makeEvent('user/message', {}, 1, 10_000),
      makeEvent('turn/start', {}, 2, 20_000),
      makeEvent('assistant/chunk', {}, 3, 25_000),
    ]
    expect(lastOpenTurnStartTime(events)).toBe(20_000)
  })

  it('scans backward past a closed turn to the open one before it', () => {
    const events = [
      makeEvent('turn/start', {}, 1, 5_000),
      makeEvent('turn/end', {}, 2, 6_000),
      makeEvent('turn/start', {}, 3, 7_000),
    ]
    expect(lastOpenTurnStartTime(events)).toBe(7_000)
  })

  it('returns undefined when the last boundary is a turn/end', () => {
    const events = [
      makeEvent('turn/start', {}, 1, 10_000),
      makeEvent('turn/end', {}, 2, 20_000),
      makeEvent('user/message', {}, 3, 25_000),
    ]
    expect(lastOpenTurnStartTime(events)).toBeUndefined()
  })

  it('returns undefined for a window with no turn boundary', () => {
    expect(lastOpenTurnStartTime([makeEvent('assistant/chunk', {}, 1, 5_000)])).toBeUndefined()
    expect(lastOpenTurnStartTime([])).toBeUndefined()
  })
})

describe('search-locate id alignment', () => {
  it('EventFolder.snapshot() and coalesceTurnMessages(rows) yield identical row ids', () => {
    // The search index (documentRows) coalesces chatWindows.tail rows with
    // coalesceTurnMessages; ChatView renders coalesceTurnMessages(EventFolder
    // snapshot). If these two paths produced different row ids, a search hit's
    // messageId would not match any rendered row and the locate would fall
    // back to a query match (often the newest row) — "highlighted but wrong".
    const events = [
      makeEvent('user/message', userMessageData('u-1', '问题'), 1),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '第一步'), 2),
      makeEvent('assistant/message', assistantMessageData('a-2', 0, 1, '第二步'), 3),
      makeEvent('user/message', userMessageData('u-2', '追问'), 4),
      makeEvent('assistant/message', assistantMessageData('a-3', 1, 0, '回复'), 5),
    ]
    const rows = foldEvents(events)
    const coalesced = coalesceTurnMessages(rows)
    const folderSnap = new EventFolder(rows).snapshot()
    const coalescedFromFolder = coalesceTurnMessages(folderSnap)
    expect(coalesced.map(r => r.id)).toEqual(coalescedFromFolder.map(r => r.id))
    // The merged assistant turn keeps the FIRST step's id (stable identity).
    expect(coalesced[1]?.id).toBe('a-1')
  })

  it('keeps a streaming assistant id stable across pending→final when the chunk carries a real id', () => {
    // The host streams chunks WITH a stable message id. The search index sees
    // the newest assistant message while it is still pending and records that
    // id as the messageId. If finalizing swapped to a different event id, a
    // locate by messageId would miss and fall back to an older row — the
    // reported "searched the newest message but landed mid-history" bug.
    const chunk = makeEvent('assistant/chunk', { messageId: 'uuid-A', turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '你好' } }, 1)
    const final = makeEvent('assistant/message', assistantMessageData('uuid-B', 0, 0, '你好'), 2)
    const pending = foldEvents([chunk])
    expect(pending[0]).toMatchObject({ id: 'uuid-A', pending: true })
    const finalized = foldEvents([final], pending)
    expect(finalized[0]).toMatchObject({ id: 'uuid-A', text: '你好', pending: false })
  })
})

describe('EventFolder 保住每轮的起始锚点（时长只能由 turn/end 减锚点算出）', () => {
  /** One finished turn: start at 1000ms, message at 2000ms. */
  function openedTurn(): EventFolder {
    const folder = new EventFolder()
    folder.fold([
      makeEvent('turn/start', { turn: 4 }, 1, 1_000),
      makeEvent('assistant/message', assistantMessageData('a-4', 4, 0, '完成'), 2, 2_000),
    ])
    return folder
  }
  const endEvent = (seq = 3, time = 5_000) =>
    makeEvent('turn/end', { turn: 4, reason: { kind: 'completed' } }, seq, time)
  const assistant = (folder: EventFolder) => folder.snapshot().find(row => row.kind === 'assistant')

  it('seed（行上限裁剪走这条路）之后 turn/end 仍算得出时长', () => {
    const folder = openedTurn()
    folder.seed(folder.snapshot())
    folder.fold([endEvent()])
    expect(assistant(folder)?.durationMs).toBe(4_000)
  })

  it('prepend（往上翻历史）之后同样不丢', () => {
    const folder = openedTurn()
    folder.prepend([])
    folder.fold([endEvent()])
    expect(assistant(folder)?.durationMs).toBe(4_000)
  })

  it('窗口重建时新文件夹继承旧锚点', () => {
    const old = openedTurn()
    const rebuilt = new EventFolder()
    rebuilt.fold([makeEvent('assistant/message', assistantMessageData('a-4', 4, 0, '完成'), 2, 2_000)])
    rebuilt.adoptAnchors(old)
    rebuilt.fold([endEvent(3, 5_000)])
    expect(assistant(rebuilt)?.durationMs).toBe(4_000)
  })
})

describe('窗口里看不到 turn/start 时，收工定格用宿主给的真起点（别在收工时往回跳）', () => {
  // 真机：一轮跑了 8分39秒，秒表一路数到 8分37秒，收工瞬间定格成 6分48秒 ——
  // 因为 turn/start 被挤出窗口，收工只能拿"窗口最早一行"当锚点，短了 109 秒。
  const T0 = 1_700_000_000_000
  /** 只有中途那一条回答、没有 turn/start 的窗口（长回合被切掉开头时的形状）。 */
  const midTurn = (): EventFolder => {
    const folder = new EventFolder()
    folder.fold([makeEvent('assistant/message', assistantMessageData('a-9', 9, 0, '在跑编译'), 2, T0 + 130_000)])
    return folder
  }
  const end = (time: number, turn = 9) =>
    makeEvent('turn/end', { turn, reason: { kind: 'completed' } }, 4, time)

  it('没有外部锚点时退回窗口最早一行：用时被缩短（旧行为，兜底而非正确值）', () => {
    const folder = midTurn()
    folder.fold([end(T0 + 300_000)])
    expect(folder.snapshot().find(row => row.kind === 'assistant')?.durationMs).toBe(170_000)
  })

  it('noteOpenTurnStart 之后按真起点定格，并且行上带着这个锚点', () => {
    const folder = midTurn()
    folder.noteOpenTurnStart(T0)
    folder.fold([end(T0 + 300_000)])
    const row = folder.snapshot().find(candidate => candidate.kind === 'assistant')
    expect(row?.durationMs).toBe(300_000)
    expect(row?.turnStartAt).toBe(T0)
  })

  it('seed/prepend 之后外部锚点仍然在（行上限裁剪发生在回合中途）', () => {
    for (const rebuild of ['seed', 'prepend'] as const) {
      const folder = midTurn()
      folder.noteOpenTurnStart(T0)
      if (rebuild === 'seed') folder.seed(folder.snapshot())
      else folder.prepend([])
      folder.fold([end(T0 + 300_000)])
      expect(folder.snapshot().find(row => row.kind === 'assistant')?.durationMs).toBe(300_000)
    }
  })

  it('旧回合的 turn/end 不吃外部锚点（否则旧一轮的用时会被算成天文数字）', () => {
    const folder = new EventFolder()
    folder.fold([
      makeEvent('turn/start', { turn: 8 }, 1, T0 - 900_000),
      makeEvent('assistant/message', assistantMessageData('a-8', 8, 0, '旧一轮'), 2, T0 - 800_000),
      makeEvent('assistant/message', assistantMessageData('a-9', 9, 0, '新一轮'), 3, T0 + 10_000),
    ])
    folder.noteOpenTurnStart(T0)
    folder.fold([end(T0 - 700_000, 8)])
    const old = folder.snapshot().find(row => row.text.includes('旧一轮'))
    expect(old?.durationMs).toBe(200_000)
  })
})

describe('turn/end 收尾：只有真的异常才把未回结果的工具记成中断', () => {
  /** 一次工具调用，但它的 tool/result 没进这个 fold（丢帧／窗口中途重建）。 */
  const openToolThenEnd = (reason: Record<string, unknown>): RenderMessage[] => foldEvents([
    makeEvent('turn/start', { turn: 0 }, 1),
    makeEvent('user/message', userMessageData('u-1', '跑一下'), 2),
    makeEvent('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{}' }, 3),
    makeEvent('turn/end', { turn: 0, reason }, 4),
  ])

  it('正常结束把未回结果的工具记成 ok，卡头读「已完成」而不是「已中断」', () => {
    // 真机现象：看着是「已完成」，突然变「已中断」，重进会话又变回「已完成」。
    // 服务端那一折有 tool/result，所以头部算成功；手机这一折丢了结果帧，旧逻辑
    // 把工具记成 stopped，头部于是读出「已中断」。正常结束不该把干完的活说成中断。
    const rows = openToolThenEnd({ kind: 'completed' })
    const assistant = rows.find(row => row.kind === 'assistant')
    expect(assistant?.tools?.map(tool => tool.state)).toEqual(['ok'])
  })

  it('异常结束（错误）仍记成中断，别把被放弃的调用伪装成成功', () => {
    const rows = openToolThenEnd({ kind: 'error', message: 'boom' })
    const assistant = rows.find(row => row.kind === 'assistant')
    expect(assistant?.tools?.map(tool => tool.state)).toEqual(['stopped'])
    expect(assistant?.failed).toBe(true)
  })
})
describe('keepTurnReports', () => {
  const tail = (turn: number, paths: string[]): RenderMessage => ({
    id: `turn-tail:${turn}`, kind: 'turn', text: '', turn, seq: turn * 10, time: 0,
    deliverables: paths.map(path => ({ path, exists: true })),
  })
  const row = (turn: number, step: number): RenderMessage => ({
    id: `t${turn}.${step}`, kind: 'assistant', text: `第 ${turn} 轮`, turn, step, seq: turn * 10 + step, time: 0,
  })

  it('carries the card across a list that was replaced wholesale', () => {
    // 进会话时列表会被整份换掉（缓存页 → 网络页 → 实时基线）：页不带报告行，
    // 不带走的话卡片就闪没了 —— 真机「点进会话，卡片突然又消失」。
    const previous = [row(3, 0), tail(3, ['a.ts'])]
    const next = [row(3, 0), row(4, 0)]
    const kept = keepTurnReports(previous, next)
    const tails = kept.filter(entry => entry.kind === 'turn')
    expect(tails).toHaveLength(1)
    expect(tails[0]?.turn).toBe(3)
    expect(tails[0]?.deliverables?.map(file => file.path)).toEqual(['a.ts'])
  })

  it('keeps the just-finished card when the page moved one turn on (尾页换尾页不闪)', () => {
    // 真机：交付结果卡片「闪一下才出现」。换列表时新页已经进到下一轮，上一轮的行全在
    // 窗口外，卡被丢掉，几秒后 cardRecovery 读到 turn/end 再补回来 —— 中间那一下就是
    // 空白。尾部相邻（差 1~2 轮）时应该把卡留住。
    const previous = [row(11, 0), tail(11, ['report.pdf'])]
    const next = [row(12, 0)]
    const kept = keepTurnReports(previous, next)
    expect(kept.some(entry => entry.kind === 'turn' && entry.turn === 11)).toBe(true)
  })

  it('drops a card whose turn is gone from the new list', () => {
    const previous = [row(2, 0), tail(2, ['old.ts'])]
    const next = [row(5, 0)]
    expect(keepTurnReports(previous, next).some(entry => entry.kind === 'turn')).toBe(false)
  })

  it('does not carry an empty card and keeps the new list as it is', () => {
    const previous = [row(3, 0), { id: 'turn-tail:3', kind: 'turn', text: '', turn: 3, seq: 30, time: 0 } as RenderMessage]
    const next = [row(3, 0)]
    expect(keepTurnReports(previous, next)).toHaveLength(1)
  })
})
describe('preferRicherRows', () => {
  const row = (id: string, extra: Record<string, unknown> = {}): RenderMessage => (
    { id, kind: 'assistant', text: id, seq: 1, time: 1, ...extra } as unknown as RenderMessage
  )

  it('reuses the painted object when the page says the same thing', () => {
    const before = [row('a', { tools: [{ callId: 'c1', name: 'edit', state: 'ok', arguments: '{"p":"x"}' }] })]
    const after = [row('a', { tools: [{ callId: 'c1', name: 'edit', state: 'ok', arguments: '{"p":"x"}' }] })]
    const merged = preferRicherRows(before, after)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toBe(before[0])
  })

  it('keeps the arguments and the diff view the page stripped', () => {
    const before = [row('a', { tools: [{ callId: 'c1', name: 'edit', state: 'running', arguments: '{"p":"x"}' }] })]
    const after = [row('a', { tools: [{ callId: 'c1', name: 'edit', state: 'ok' }] })]
    const merged = preferRicherRows(before, after)
    expect(merged[0]?.tools?.[0]?.state).toBe('ok')
    expect(merged[0]?.tools?.[0]?.arguments).toBe('{"p":"x"}')
  })

  it('keeps rows older than the page window instead of collapsing the list', () => {
    // 页是一段窗口：屏幕上 3 行、页只给最后 1 行，塌成 1 行就是真机那一闪。
    const before = [row('r1', { seq: 1 }), row('r2', { seq: 2 }), row('r3', { seq: 3 })]
    const after = [row('r3', { seq: 3 })]
    const merged = preferRicherRows(before, after)
    expect(merged.map(entry => entry.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('appends genuinely new rows and takes the newer text', () => {
    const before = [row('r1', { seq: 1, text: '旧' })]
    const after = [row('r1', { seq: 1, text: '新' }), row('r2', { seq: 2 })]
    const merged = preferRicherRows(before, after)
    expect(merged.map(entry => entry.id)).toEqual(['r1', 'r2'])
    expect(merged[0]?.text).toBe('新')
  })

  it('keeps one row per message id and takes the whole turn over its first half', () => {
    // 页切落在一轮中间时，同一个 message id 会以两种形状到达：只有第一步的「半截行」
    // 和整回合行。两版都留下就是两张同 id 的卡；半截行胜出，这一轮后面几步的正文就
    // 再也画不出来 —— 索引收过那些正文，搜索于是指到一段屏幕上不存在的文字（真机：
    // 命中 seq=1165 落在只画到 1136 的卡上，一个高亮都没有）。
    const half = row('a', { seq: 1136, text: '第一步' })
    const whole = row('a', { startSeq: 1137, seq: 1165, text: '第一步\n\n整段的正文 编译', stepSeqs: [1137, 1142, 1165] })
    const merged = preferRicherRows([half], [whole])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.text).toContain('编译')
    expect(merged[0]?.stepSeqs).toEqual([1137, 1142, 1165])
    expect(merged[0]?.startSeq).toBe(1136)
    expect(merged[0]?.seq).toBe(1165)
  })
})

describe('计划挂到交付卡上（状态条收起后的入口）', () => {
  const ev = (type: string, seq: number, data: Record<string, unknown> = {}): WireEvent => (
    { type, seq, time: 1_700_000_000_000 + seq * 1000, data } as unknown as WireEvent
  )

  it('收工时把这一轮的计划挂到 turn 行，并把 in_progress 归一成 completed', () => {
    const rows = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('todo/write', 2, { todos: [
        { content: '写代码', status: 'in_progress' },
        { content: '跑测试', status: 'pending' },
      ] }),
      ev('assistant/message', 3, { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '做完了' }] }),
      ev('turn/end', 4, { turn: 1 }),
    ])
    const tail = rows.find(row => row.kind === 'turn')
    expect(tail?.plan?.items.map(item => item.content)).toEqual(['写代码', '跑测试'])
    // 这一轮结束了：in_progress 归一成 completed；pending 保持 pending（宿主同语义，
    // 没做完的项不该被说成做完了 —— 胶囊上的 1/2 就是实话）。
    expect(tail?.plan?.items.map(item => item.status)).toEqual(['completed', 'pending'])
  })

  it('没有写过计划的回合不挂空胶囊', () => {
    const rows = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('assistant/message', 2, { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '随便聊聊' }] }),
      ev('turn/end', 3, { turn: 1 }),
    ])
    expect(rows.find(row => row.kind === 'turn')?.plan).toBeUndefined()
  })

  it('新一轮开始后，上一轮的计划不再跟着新回合', () => {
    const rows = foldEvents([
      ev('turn/start', 1, { turn: 1 }),
      ev('todo/write', 2, { todos: [{ content: '旧计划', status: 'pending' }] }),
      ev('turn/end', 3, { turn: 1 }),
      ev('turn/start', 4, { turn: 2 }),
      ev('assistant/message', 5, { id: 'a2', role: 'assistant', content: [{ type: 'text', text: '新的一轮' }] }),
      ev('turn/end', 6, { turn: 2 }),
    ])
    const tails = rows.filter(row => row.kind === 'turn')
    expect(tails[0]?.plan?.items[0]?.content).toBe('旧计划')
    expect(tails[1]?.plan).toBeUndefined()
  })
})

describe('换页合并：交付卡与计划不许丢、不许重复', () => {
  const assistant = (id: string, seq: number, extra: Record<string, unknown> = {}): RenderMessage => (
    { id, kind: 'assistant', text: id, seq, time: 1, ...extra } as unknown as RenderMessage
  )
  const card = (turn: number, seq: number, extra: Record<string, unknown> = {}): RenderMessage => (
    { id: `turn-tail:${turn}`, kind: 'turn', text: '', turn, seq, time: 1, ...extra } as unknown as RenderMessage
  )

  it('页里也带这张卡时只留一份（以前 turn 行不走合并 → 同一张卡两份）', () => {
    const previous = [assistant('a', 10, { turn: 1 }), card(1, 11, { produced: ['x.ts'], plan: { items: [{ content: '写代码', status: 'completed' }] } })]
    // 页窗口覆盖到同一张卡，但那份是瘦版（没有 plan、没有 produced）
    const next = [assistant('a', 10, { turn: 1 }), card(1, 11)]
    const merged = preferRicherRows(previous, next)
    const cards = merged.filter(row => row.kind === 'turn')
    expect(cards).toHaveLength(1)
    // 内容取全的那份：计划和产出都还在
    expect(cards[0]?.produced).toEqual(['x.ts'])
    expect(cards[0]?.plan?.items?.[0]?.content).toBe('写代码')
  })

  it('页窗口完全不含这张卡时，卡靠「更早那段」保留下来', () => {
    const previous = [assistant('a', 10, { turn: 1 }), card(1, 11, { produced: ['x.ts'] })]
    const next = [assistant('b', 40, { turn: 3 })]
    const merged = preferRicherRows(previous, next)
    expect(merged.some(row => row.kind === 'turn' && row.turn === 1)).toBe(true)
  })

  it('同一行不会被推两次（过程条变多条的那个来源）', () => {
    const previous = [assistant('a', 10, { turn: 1 }), assistant('b', 20, { turn: 2 })]
    const next = [assistant('b', 20, { turn: 2 }), assistant('c', 30, { turn: 3 })]
    const merged = preferRicherRows(previous, next)
    const ids = merged.map(row => row.id)
    expect(ids.filter(id => id === 'b')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('缺轮号的实时分片跟着当前这一轮（多条过程条的根）', () => {
  const ev = (type: string, seq: number, data: Record<string, unknown> = {}): WireEvent => (
    { type, seq, time: 1_700_000_000_000 + seq, data } as unknown as WireEvent
  )

  it('turn/start 之后的分片即使不带 turn，也算这一轮', () => {
    const rows = foldEvents([
      ev('turn/start', 1, { turn: 7 }),
      ev('assistant/message', 2, { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '一' }] }),
      ev('assistant/message', 3, { id: 'a2', role: 'assistant', content: [{ type: 'text', text: '二' }] }),
    ])
    const assistants = rows.filter(row => row.kind === 'assistant')
    expect(assistants.every(row => row.turn === 7)).toBe(true)
    // 于是合并成一条过程卡（不然就是两条，等尾页补齐轮号后才合并）
    expect(coalesceTurnMessages(rows).filter(row => row.kind === 'assistant')).toHaveLength(1)
  })

  it('turn/end 之后清掉：下一轮之前的助手行不会被套上旧轮号', () => {
    const rows = foldEvents([
      ev('turn/start', 1, { turn: 7 }),
      ev('assistant/message', 2, { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '一' }] }),
      ev('turn/end', 3, { turn: 7 }),
      ev('assistant/message', 4, { id: 'a9', role: 'assistant', content: [{ type: 'text', text: '游离' }] }),
    ])
    const stray = rows.find(row => row.id === 'a9')
    expect(stray?.turn).toBeUndefined()
  })
})

describe('合并时正文只增不减（重叠窗口的截断版不许覆盖完整版）', () => {
  const row = (id: string, text: string, seq = 10): RenderMessage => (
    { id, kind: 'assistant', text, seq, time: 1 } as unknown as RenderMessage
  )

  it('页给的是这一页边界截断的前缀 → 保留屏幕上那份完整正文', () => {
    const merged = preferRicherRows([row('a', '完整的回答，很长很长')], [row('a', '完整的回答')])
    expect(merged[0]?.text).toBe('完整的回答，很长很长')
  })

  it('页给的是更长的正文 → 用页的（正常增长）', () => {
    const merged = preferRicherRows([row('a', '开头')], [row('a', '开头 + 后面补上的内容')])
    expect(merged[0]?.text).toBe('开头 + 后面补上的内容')
  })

  it('两份内容不同（不是前缀关系）→ 仍以页为准', () => {
    const merged = preferRicherRows([row('a', '旧内容')], [row('a', '新内容')])
    expect(merged[0]?.text).toBe('新内容')
  })
})

describe('同一轮被切成两张过程卡（2026-10-29 真机复现）', () => {
  const row = (patch: Record<string, unknown>): RenderMessage => ({
    kind: 'assistant',
    seq: 10,
    time: 1,
    text: '',
    ...patch,
  }) as unknown as RenderMessage

  it('页面行带轮号、实时行没轮号但 step 相同 → 合成一条', () => {
    // 真机形状：宿主尾页每步一行（turn 98 step 3），实时流那段还没经历 turn/start，
    // 轮号是 undefined，id 又是另一套 —— 只按 id 认会把同一 step 画两次。
    const merged = coalesceTurnMessages([
      row({ id: 'page-row-1', turn: 98, step: 3 }),
      row({ id: 'live-row-1', step: 3 }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.turn).toBe(98)
  })

  it('step 不同 → 仍然分开（不同消息不许误合并）', () => {
    const merged = coalesceTurnMessages([
      row({ id: 'a', turn: 98, step: 3 }),
      row({ id: 'b', step: 4 }),
    ])
    expect(merged).toHaveLength(2)
  })

  it('两边都没轮号也没 step → 不合并（否则一堆独立助手消息会并成一张卡）', () => {
    const merged = coalesceTurnMessages([row({ id: 'a' }), row({ id: 'b' })])
    expect(merged).toHaveLength(2)
  })

  it('两边都有轮号且不同 → 不合并（真的是两轮）', () => {
    const merged = coalesceTurnMessages([
      row({ id: 'a', turn: 98, step: 1 }),
      row({ id: 'b', turn: 99, step: 1 }),
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('身份判据：缺轮号但有 step 的行算同一行（过程卡不再重复）', () => {
  const row = (patch: Record<string, unknown>): RenderMessage => ({
    kind: 'assistant',
    seq: 10,
    time: 1,
    text: '',
    ...patch,
  }) as unknown as RenderMessage

  it('页面行（turn 98 step 3）与实时行（无轮号 step 3）合并成一行，不叠加', () => {
    const previous = [row({ id: 'page-1', turn: 98, step: 3, tools: [{ callId: 'c1', name: 'bash', state: 'ok' }] })]
    const next = [row({ id: 'live-1', step: 3, tools: [{ callId: 'c1', name: 'bash', state: 'ok' }] })]
    const merged = preferRicherRows(previous, next)
    expect(merged).toHaveLength(1)
    // 轮号由页面那份补进来，下游（状态判据）才认得出这是正在跑的一轮
    expect(merged[0]?.turn).toBe(98)
  })

  it('step 不同不会被当成同一行（不串行合并）', () => {
    const merged = preferRicherRows(
      [row({ id: 'a', turn: 98, step: 3, text: '第三步' })],
      [row({ id: 'b', step: 4, text: '第四步' })],
    )
    // 新一页只有第四步：旧的第一步不该被塞进它里面（合并会让正文变成两段）
    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe('b')
    expect(merged[0]?.text).toBe('第四步')
  })

  it('来行带轮号时不做 step 兜底（跨轮的同一 step 不许误配）', () => {
    const merged = preferRicherRows(
      [row({ id: 'a', turn: 98, step: 3, text: '第 98 轮第三步' })],
      [row({ id: 'b', turn: 99, step: 3, text: '第 99 轮第三步' })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe('b')
    expect(merged[0]?.text).toBe('第 99 轮第三步')
  })
})

describe('同轮同文的两段只画一份（2026-10-29 真机：过程卡+回答整组出现两次）', () => {
  const answer = '一次跑完却发现问题没抓全，是因为验证脚本是临时拼出来的，覆盖范围靠我每次现想。'
  const row = (patch: Record<string, unknown>): RenderMessage => ({
    kind: 'assistant',
    seq: 10,
    time: 1,
    text: '',
    ...patch,
  }) as unknown as RenderMessage

  it('同一轮、正文一样的 pending 行与最终行（id 不同）收敛成一条', () => {
    const merged = coalesceTurnMessages([
      row({ id: 'pending-1', turn: 114, step: 3, text: answer, tools: [{ callId: 'c1', name: 'bash', state: 'ok' }] }),
      row({ id: 'page-1', turn: 114, step: 3, text: answer, tools: [{ callId: 'c1', name: 'bash', state: 'ok' }] }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.text).toBe(answer)
  })

  it('缺 step 也不影响收敛（页面行与实时行是两套 id，步号可能缺）', () => {
    const merged = coalesceTurnMessages([
      row({ id: 'a', turn: 114, text: answer }),
      row({ id: 'b', turn: 114, text: answer }),
    ])
    expect(merged).toHaveLength(1)
  })

  it('不同轮说同样的话不许合并（那是正常内容）', () => {
    const merged = coalesceTurnMessages([
      row({ id: 'a', turn: 114, step: 1, text: answer }),
      row({ id: 'b', turn: 115, step: 1, text: answer }),
    ])
    expect(merged).toHaveLength(2)
  })

  it('太短的正文（「好」）不参与收敛：同一张卡里保留两段，不吞内容', () => {
    const merged = coalesceTurnMessages([
      row({ id: 'a', turn: 114, step: 1, text: '好的' }),
      row({ id: 'b', turn: 114, step: 2, text: '好的' }),
    ])
    // 同一轮仍然合成一张卡（这是设计），但正文里两段都在
    expect(merged).toHaveLength(1)
    expect(merged[0]?.text).toBe('好的\n\n好的')
  })
})

describe('流式分片缺 step：同一轮不能一行一片（2026-10-29 真机：同轮两张过程卡）', () => {
  const chunk = (seq: number, text: string, data: Record<string, unknown>) => ({
    type: 'assistant/chunk' as const,
    seq,
    time: 1_000 + seq,
    data: { chunk: { type: 'text-delta', text }, ...data },
  })

  it('两片都不带 step、只带 turn：落进同一行', () => {
    const rows = foldEvents([
      { type: 'turn/start', seq: 1, time: 1_000, data: { turn: 9 } },
      chunk(2, '第一段', { turn: 9 }),
      chunk(3, '第二段', { turn: 9 }),
    ] as never)
    const assist = rows.filter(row => row.kind === 'assistant')
    expect(assist).toHaveLength(1)
    expect(assist[0]?.text).toBe('第一段第二段')
    expect(assist[0]?.turn).toBe(9)
  })

  it('分片完全不带 turn：跟着当前这一轮，仍然只有一行', () => {
    const rows = foldEvents([
      { type: 'turn/start', seq: 1, time: 1_000, data: { turn: 11 } },
      chunk(2, '甲', {}),
      chunk(3, '乙', {}),
    ] as never)
    const assist = rows.filter(row => row.kind === 'assistant')
    expect(assist).toHaveLength(1)
    expect(assist[0]?.text).toBe('甲乙')
  })

  it('流式在「未知步」桶里，最终消息带 step 也能收编同一行', () => {
    const rows = foldEvents([
      { type: 'turn/start', seq: 1, time: 1_000, data: { turn: 12 } },
      chunk(2, '流式中', { turn: 12 }),
      {
        type: 'assistant/message',
        seq: 3,
        time: 1_003,
        data: { turn: 12, step: 4, message: { id: 'final-1', role: 'assistant', content: [{ type: 'text', text: '流式中，完成' }] } },
      },
    ] as never)
    const assist = rows.filter(row => row.kind === 'assistant')
    expect(assist).toHaveLength(1)
    expect(assist[0]?.text).toBe('流式中，完成')
    expect(assist[0]?.pending).toBe(false)
    expect(assist[0]?.step).toBe(4)
  })
})

describe('同一轮只画一张过程卡（2026-10-30 真机）', () => {
  // 现场：turn 147 的第一段只有工具（正文空），宿主在回合中途插了一条用户消息
  // （text=251），之后同一轮继续产出第二段（step=40，正文 1489 字）—— 两段挂的是
  // **同一批 39 个工具**。屏幕上就是两张卡、列同一堆步骤。
  const tool = (callId: string) => ({ callId, name: 'bash', arguments: '{}' })
  const sharedTools = [tool('c1'), tool('c2'), tool('c3')]

  const row = (overrides: Partial<RenderMessage>): RenderMessage => ({
    id: 'x',
    kind: 'assistant',
    text: '',
    ...overrides,
  } as RenderMessage)

  it('后段不再画卡：步骤全部归本轮第一段，正文留在原位', () => {
    const rows: RenderMessage[] = [
      row({ id: 'a1', turn: 147, step: 1, text: '', tools: sharedTools, flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'tool', callId: 'c2' }] }),
      row({ id: 'u1', kind: 'user', text: '插一句' }),
      row({ id: 'a2', turn: 147, step: 40, text: '最终回答', tools: [...sharedTools, tool('c9')], flow: [{ kind: 'tool', callId: 'c1' }, { kind: 'text', text: '最终回答' }] }),
    ]

    const out = mergeProcessCardsByTurn(rows)
    const [, , second] = out
    // 后段：没有工具了（卡不画），正文一个字都不少
    expect(second?.tools).toEqual([])
    expect(second?.flow?.every(part => part.kind !== 'tool')).toBe(true)
    expect(second?.text).toBe('最终回答')
    // 第一段：拥有本轮的**全部**步骤（含后段新增的 c9），且不重复
    expect(out[0]?.tools?.map(t => t.callId)).toEqual(['c1', 'c2', 'c3', 'c9'])
  })

  it('不同轮各自独立：上一轮的工具不会跑到下一轮的卡里', () => {
    const rows: RenderMessage[] = [
      row({ id: 'a1', turn: 1, step: 1, tools: sharedTools }),
      row({ id: 'a2', turn: 2, step: 1, tools: [tool('z1')] }),
    ]
    const out = mergeProcessCardsByTurn(rows)
    expect(out[0]?.tools?.map(t => t.callId)).toEqual(['c1', 'c2', 'c3'])
    expect(out[1]?.tools?.map(t => t.callId)).toEqual(['z1'])
  })

  it('没有重复段时原样返回（不制造多余重渲染）', () => {
    const rows: RenderMessage[] = [row({ id: 'a1', turn: 5, step: 1, tools: [tool('c1')] })]
    const out = mergeProcessCardsByTurn(rows)
    expect(out[0]).toBe(rows[0])
  })
})
