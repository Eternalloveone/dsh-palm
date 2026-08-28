import { describe, expect, it } from 'vitest'
import { PendingTracker } from '../src/mobile-pending.ts'
import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'

function makeFrame(payload: MuxFrame): RpcRequest<MuxFrame> {
  return {
    rpcId: RpcId('test-rpc'),
    payload,
  }
}

describe('PendingTracker', () => {
  it('approval/requested adds to pending', () => {
    const tracker = new PendingTracker()
    tracker.onFrame(makeFrame({
      type: 'approval/requested',
      sessionId: 'sess-1' as any,
      approvalId: 'app-1' as any,
      toolName: 'my-tool',
    }))
    
    expect(tracker.pending('sess-1')).toEqual({
      approvals: [{
        rpcId: 'test-rpc',
        approvalId: 'app-1',
        toolName: 'my-tool',
        callId: undefined,
        reason: undefined,
      }],
      questions: [],
    })
  })

  it('approval/resolved removes from pending', () => {
    const tracker = new PendingTracker()
    tracker.onFrame(makeFrame({
      type: 'approval/requested',
      sessionId: 'sess-1' as any,
      approvalId: 'app-1' as any,
      toolName: 'my-tool',
    }))
    
    tracker.onFrame(makeFrame({
      type: 'approval/resolved',
      sessionId: 'sess-1' as any,
      approvalId: 'app-1' as any,
      outcome: 'allowed-once',
    }))
    
    expect(tracker.pending('sess-1')).toEqual({
      approvals: [],
      questions: [],
    })
  })

  it('question/requested adds to pending', () => {
    const tracker = new PendingTracker()
    tracker.onFrame(makeFrame({
      type: 'question/requested',
      sessionId: 'sess-1' as any,
      questions: [{ id: 'q-1', question: 'Are you sure?' } as any],
    }))
    
    // FLAT shape: rpcId sits alongside the question fields — the exact shape
    // the phone's PendingQuestionItem expects (a nested wrapper made the
    // mobile panel lose its options and keep only the custom-answer box).
    expect(tracker.pending('sess-1')).toEqual({
      approvals: [],
      questions: [{
        rpcId: 'test-rpc',
        id: 'q-1',
        question: 'Are you sure?',
      }],
    })
  })

  it('question/resolved removes from pending', () => {
    const tracker = new PendingTracker()
    tracker.onFrame(makeFrame({
      type: 'question/requested',
      sessionId: 'sess-1' as any,
      questions: [{ id: 'q-1', question: 'Are you sure?' } as any],
    }))
    
    tracker.onFrame(makeFrame({
      type: 'question/resolved',
      sessionId: 'sess-1' as any,
      questionRpcId: RpcId('test-rpc'),
      outcome: 'answered',
    }))
    
    expect(tracker.pending('sess-1')).toEqual({
      approvals: [],
      questions: [],
    })
  })

  it('Multiple sessions are isolated', () => {
    const tracker = new PendingTracker()
    tracker.onFrame(makeFrame({
      type: 'approval/requested',
      sessionId: 'sess-1' as any,
      approvalId: 'app-1' as any,
      toolName: 'tool-1',
    }))
    
    tracker.onFrame(makeFrame({
      type: 'approval/requested',
      sessionId: 'sess-2' as any,
      approvalId: 'app-2' as any,
      toolName: 'tool-2',
    }))
    
    expect(tracker.pending('sess-1').approvals).toHaveLength(1)
    expect(tracker.pending('sess-1').approvals[0].toolName).toBe('tool-1')
    
    expect(tracker.pending('sess-2').approvals).toHaveLength(1)
    expect(tracker.pending('sess-2').approvals[0].toolName).toBe('tool-2')
  })

  it('clear() removes all pending for a session', () => {
    const tracker = new PendingTracker()
    tracker.onFrame(makeFrame({
      type: 'approval/requested',
      sessionId: 'sess-1' as any,
      approvalId: 'app-1' as any,
      toolName: 'tool-1',
    }))
    
    tracker.clear('sess-1')
    
    expect(tracker.pending('sess-1')).toEqual({
      approvals: [],
      questions: [],
    })
  })

  it('Unknown frame types are ignored', () => {
    const tracker = new PendingTracker()
    tracker.onFrame(makeFrame({
      type: 'session/event',
      sessionId: 'sess-1' as any,
      event: {} as any,
    }))
    
    expect(tracker.pending('sess-1')).toEqual({
      approvals: [],
      questions: [],
    })
  })

  it('malformed frames are dropped without throwing (the SSE stream survives)', () => {
    const tracker = new PendingTracker()
    // Every branch with missing/non-string ids or non-array questions must be
    // a no-op, never an exception: an uncaught error in onFrame would tear
    // down the host mux loop and with it the whole SSE stream.
    expect(() => tracker.onFrame(makeFrame({ type: 'approval/requested', sessionId: 'sess-1' as any, approvalId: undefined as any, toolName: 'x' }))).not.toThrow()
    expect(() => tracker.onFrame(makeFrame({ type: 'approval/requested', sessionId: undefined as any, approvalId: 'a-1' as any, toolName: 'x' }))).not.toThrow()
    expect(() => tracker.onFrame(makeFrame({ type: 'approval/requested', sessionId: 7 as any, approvalId: 'a-1' as any, toolName: 'x' }))).not.toThrow()
    expect(() => tracker.onFrame(makeFrame({ type: 'approval/resolved', sessionId: 'sess-1' as any, approvalId: undefined as any }))).not.toThrow()
    expect(() => tracker.onFrame(makeFrame({ type: 'question/requested', sessionId: 'sess-1' as any, questions: 'nope' as any }))).not.toThrow()
    expect(() => tracker.onFrame(makeFrame({ type: 'question/resolved', sessionId: 'sess-1' as any, questionRpcId: undefined as any }))).not.toThrow()
    expect(tracker.pending('sess-1')).toEqual({ approvals: [], questions: [] })
  })

  it('replayed question/requested frames do not enqueue duplicates', () => {
    const tracker = new PendingTracker()
    const frame = makeFrame({
      type: 'question/requested',
      sessionId: 'sess-1' as any,
      questions: [{ id: 'q-1', question: '继续？' }] as any,
    })
    tracker.onFrame(frame)
    // An SSE reconnect window replays the same frame (same originating rpcId):
    // it must not stack a second identical question card.
    tracker.onFrame(frame)

    const pending = tracker.pending('sess-1')
    expect(pending.questions).toHaveLength(1)
    expect(pending.questions[0]?.rpcId).toBe('test-rpc')
  })
})
