import type { MuxFrame } from '@deepseek-ai/dsh-host-apiproxy/api/events'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'

export interface PendingApproval {
  rpcId: string
  approvalId: string
  toolName: string
  callId?: string
  reason?: string
}

/**
 * One pending question, FLAT — the exact shape the live mux
 * question/requested frame carries and the phone's PendingQuestionItem
 * (src/mobile/api.ts) expects. The polling fallback (mobile.pending) must
 * return this same shape: ChatView adopts a non-empty poll result verbatim
 * (setPendingQuestions(state.questions)), so a nested wrapper would render a
 * panel whose q.question / q.options are undefined — options vanish and only
 * the "自定义回答" textarea remains.
 */
export interface PendingQuestion {
  rpcId: string
  id: string
  question: string
  detail?: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
}

export interface PendingState {
  approvals: PendingApproval[]
  questions: PendingQuestion[]
}

/** Guard helpers: a malformed frame is dropped, never trusted. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

export class PendingTracker {
  private readonly sessions = new Map<string, { approvals: Map<string, PendingApproval>; questions: PendingQuestion[] }>()

  /**
   * Process one mux frame and update the pending state. Every branch is
   * shape-guarded and never throws: the host mux loop calls this per frame
   * inside a broad try/catch, so an uncaught error here would tear down the
   * whole SSE stream (EventSource then reconnects and replays — the failure
   * mode the guards exist to avoid).
   */
  onFrame(frame: RpcRequest<MuxFrame>): void {
    try {
      this._onFrame(frame)
    } catch {
      // Malformed frame: ignore it, keep the stream and its state intact.
    }
  }

  private _onFrame(frame: RpcRequest<MuxFrame>): void {
    const payload = frame.payload
    if (payload.type === 'approval/requested') {
      const sessionId = asString(payload.sessionId)
      const approvalId = asString(payload.approvalId)
      if (sessionId === undefined || approvalId === undefined) return
      const toolName = typeof payload.toolName === 'string' ? payload.toolName : ''
      const state = this._getOrInit(sessionId)
      state.approvals.set(approvalId, {
        rpcId: frame.rpcId,
        approvalId,
        toolName,
        ...(typeof payload.callId === 'string' ? { callId: payload.callId } : {}),
        ...(typeof payload.reason === 'string' ? { reason: payload.reason } : {}),
      })
    } else if (payload.type === 'approval/resolved') {
      const sessionId = asString(payload.sessionId)
      const approvalId = asString(payload.approvalId)
      if (sessionId === undefined || approvalId === undefined) return
      const state = this.sessions.get(sessionId)
      if (state) {
        state.approvals.delete(approvalId)
        this._pruneIfEmpty(sessionId, state)
      }
    } else if (payload.type === 'question/requested') {
      const sessionId = asString(payload.sessionId)
      if (sessionId === undefined) return
      if (!Array.isArray(payload.questions)) return
      const state = this._getOrInit(sessionId)
      // A replayed/duplicate frame (SSE reconnect window) must not enqueue
      // the same question twice: key by the originating rpcId.
      if (state.questions.some(question => question.rpcId === frame.rpcId)) return
      // Flatten to the frame's own shape: one entry per question, rpcId
      // alongside the question fields (see PendingQuestion above).
      for (const item of payload.questions) {
        state.questions.push({
          rpcId: frame.rpcId,
          id: item.id,
          question: item.question,
          ...(item.detail !== undefined ? { detail: item.detail } : {}),
          ...(item.header !== undefined ? { header: item.header } : {}),
          ...(item.options !== undefined ? { options: item.options } : {}),
          ...(item.multiSelect !== undefined ? { multiSelect: item.multiSelect } : {}),
        })
      }
    } else if (payload.type === 'question/resolved') {
      const sessionId = asString(payload.sessionId)
      const questionRpcId = asString(payload.questionRpcId)
      if (sessionId === undefined || questionRpcId === undefined) return
      const state = this.sessions.get(sessionId)
      if (state) {
        state.questions = state.questions.filter(q => q.rpcId !== questionRpcId)
        this._pruneIfEmpty(sessionId, state)
      }
    }
  }

  private _getOrInit(sessionId: string) {
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = { approvals: new Map(), questions: [] }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  /**
   * Drop a session's entry once nothing is pending for it, so sessions that
   * only ever produced resolved items do not accumulate empty shells for the
   * plugin lifetime.
   */
  private _pruneIfEmpty(sessionId: string, state: { approvals: Map<string, PendingApproval>; questions: PendingQuestion[] }): void {
    if (state.approvals.size === 0 && state.questions.length === 0) {
      this.sessions.delete(sessionId)
    }
  }

  /** Query pending items for a session. */
  pending(sessionId: string): PendingState {
    const state = this.sessions.get(sessionId)
    if (!state) {
      return { approvals: [], questions: [] }
    }
    return {
      approvals: Array.from(state.approvals.values()),
      questions: state.questions,
    }
  }

  /** Clear all pending state for a session. */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /**
   * The session that owns a pending rpcId (an approval or question awaiting
   * a response), or undefined when the rpcId is not pending. The mobile
   * respond channel uses this to bind an answer to the session that actually
   * owns the pending item: a phone must not be able to answer an approval or
   * question that belongs to another session (or that another device already
   * resolved). An rpcId can only ever be pending under one session — the
   * tracker keys approvals and questions by session, and each frame's rpcId is
   * recorded under the session it was requested for.
   */
  ownerOfRpcId(rpcId: string): string | undefined {
    for (const [sessionId, state] of this.sessions) {
      for (const approval of state.approvals.values()) {
        if (approval.rpcId === rpcId) return sessionId
      }
      if (state.questions.some(question => question.rpcId === rpcId)) return sessionId
    }
    return undefined
  }
}
