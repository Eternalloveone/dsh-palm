/** foldEvents: message-list folding from a session event stream. */
import { describe, expect, it } from 'vitest'
import { coalesceTurnMessages, EventFolder, foldEvents, type RenderMessage, type WireEvent } from './messages.ts'

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
      { callId: 'c1', name: 'bash', arguments: '{}' },
      { callId: 'c2', name: 'read', arguments: '{"path":"a.txt"}' },
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
    expect(assistant?.tools).toEqual([{ callId: 'c1', name: 'bash', arguments: '{"cmd":"a"}' }])
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
      { kind: 'text', text: '先看这个' },
      { kind: 'tool', callId: 'c1' },
      { kind: 'text', text: '再看那个' },
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
    // The text run collapses to the authoritative text; the tool part
    // survives (a call is an independent event, never dropped by a rewrite).
    expect(assistant?.flow).toEqual([
      { kind: 'text', text: '权威终稿' },
      { kind: 'tool', callId: 'c1' },
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
    expect(assistant?.tools).toEqual([{ callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }])
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
    const once = foldEvents(events)
    const twice = foldEvents(events, once)
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

  it('tool-call placeholders carry (turn, step) too', () => {
    const folder = new EventFolder()
    folder.fold([makeEvent('tool/call', { turn: 2, step: 1, callId: 'c1', name: 'bash', arguments: '{}' }, 3)])
    const row = folder.snapshot()[0]
    expect(row).toMatchObject({ turn: 2, step: 1, pending: true })
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
      { kind: 'text', text: '先说' },
      { kind: 'tool', callId: 'c1' },
      { kind: 'text', text: '后说' },
    ])
  })

  it('merges adjacent text runs of two flows on a blank line', () => {
    const merged = coalesceTurnMessages([
      step('a-1', 7, 'A', 1, { flow: [{ kind: 'text', text: 'A' }] }),
      step('a-2', 7, 'B', 2, { flow: [{ kind: 'text', text: 'B' }] }),
    ])
    expect(merged[0]?.flow).toEqual([{ kind: 'text', text: 'A\n\nB' }])
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

  it('leaves a single message and turn-less rows untouched', () => {
    expect(coalesceTurnMessages([step('a-1', 7, '单一', 1)])).toHaveLength(1)
    const unturned = step('a-1', undefined as never, '无 turn', 1) as RenderMessage
    const without = coalesceTurnMessages([unturned, unturned])
    expect(without).toHaveLength(2)
  })
})
