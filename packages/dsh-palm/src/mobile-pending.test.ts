import { describe, expect, it } from 'vitest'
import { PendingTracker } from './mobile-pending.ts'

/**
 * The phone's PendingQuestionItem (src/mobile/api.ts) is FLAT:
 *   { rpcId, id, question, detail?, header?, options?, multiSelect? }
 * and the live mux question/requested frame carries the same flat shape
 * (ChatView.tsx maps `{ rpcId: frameRpcId, ...item }`).
 *
 * The polling fallback (mobile.pending → PendingTracker.pending) must return
 * the SAME flat shape: ChatView adopts a non-empty poll result verbatim
 * (setPendingQuestions(state.questions)), so a nested shape would render a
 * panel whose q.question / q.options are undefined — options vanish and only
 * the "自定义回答" textarea remains. Regression test for that bug.
 */

const requestedFrame = {
  rpcId: 'rpc-ask-1',
  payload: {
    type: 'question/requested',
    sessionId: 's1',
    questions: [
      {
        id: 'q1',
        question: '选哪个方案？',
        header: '方案选择',
        detail: '请选择你偏好的方案',
        options: [
          { label: '方案 A', description: '快' },
          { label: '方案 B', description: '稳' },
        ],
        multiSelect: false,
      },
      {
        id: 'q2',
        question: '补充说明？',
      },
    ],
  },
}

describe('PendingTracker question shape (mobile.pending polling fallback)', () => {
  it('returns the same flat question shape as the live mux frame', () => {
    const tracker = new PendingTracker()
    tracker.onFrame(requestedFrame as never)
    const state = tracker.pending('s1')

    expect(state.questions).toHaveLength(2)
    // Flat: rpcId sits next to the question fields, not wrapping them.
    expect(state.questions[0]).toMatchObject({
      rpcId: 'rpc-ask-1',
      id: 'q1',
      question: '选哪个方案？',
      header: '方案选择',
      detail: '请选择你偏好的方案',
      options: [
        { label: '方案 A', description: '快' },
        { label: '方案 B', description: '稳' },
      ],
      multiSelect: false,
    })
    expect(state.questions[1]).toMatchObject({
      rpcId: 'rpc-ask-1',
      id: 'q2',
      question: '补充说明？',
    })
    // The phone renders options from q.options; a nested wrapper would hide them.
    expect(state.questions[0].options).toBeDefined()
    expect(state.questions[0].options?.length).toBe(2)
  })

  it('dedupes a replayed frame by rpcId and resolves by questionRpcId', () => {
    const tracker = new PendingTracker()
    tracker.onFrame(requestedFrame as never)
    tracker.onFrame(requestedFrame as never) // SSE reconnect replay
    // Two flat entries (q1 + q2); the replay must not duplicate them.
    expect(tracker.pending('s1').questions).toHaveLength(2)

    tracker.onFrame({
      rpcId: 'rpc-resolve-1',
      payload: { type: 'question/resolved', sessionId: 's1', questionRpcId: 'rpc-ask-1' },
    } as never)
    expect(tracker.pending('s1').questions).toHaveLength(0)
  })
})
