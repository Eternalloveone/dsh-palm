/**
 * Answered-approval bookkeeping: the client half of the ghost-panel fix.
 *
 * The reported bug: an approval the phone had already answered came back as
 * soon as the session was re-entered. The host tracker kept serving it (no
 * `approval/resolved` frame existed anywhere), and the chat had no memory of
 * what this phone had answered — so the poll re-installed the panel.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { adoptPolledApprovals, answeredApprovals, answeredApprovalsFor, noteAnsweredApproval } from './approval-batches.ts'
import type { PendingApproval } from './api.ts'

function approval(approvalId: string): PendingApproval {
  return { rpcId: `rpc-${approvalId}`, approvalId, toolName: 'bash' }
}

beforeEach(() => { answeredApprovals.clear() })

describe('answered-approval memory', () => {
  it('remembers an answered approval outside the component, so a remount cannot forget it', () => {
    expect(answeredApprovalsFor('s-1').size).toBe(0)
    noteAnsweredApproval('s-1', 'ap-1')
    // A freshly mounted ChatView reads this same store: it is module scope, not
    // a component ref — the remount is exactly what reproduced the ghost.
    expect(answeredApprovalsFor('s-1').has('ap-1')).toBe(true)
    // Per session: another chat's memory is untouched.
    expect(answeredApprovalsFor('s-2').size).toBe(0)
  })

  it('caps the per-session memory, dropping the oldest answered id first', () => {
    for (let index = 0; index < 80; index++) noteAnsweredApproval('s-1', `ap-${index}`)
    const answered = answeredApprovalsFor('s-1')
    expect(answered.size).toBe(64)
    expect(answered.has('ap-0')).toBe(false)
    expect(answered.has('ap-79')).toBe(true)
  })
})

describe('adoptPolledApprovals', () => {
  it('adopts a non-empty poll result (the poll is authoritative for what the host holds)', () => {
    const current = [approval('ap-1')]
    const polled = [approval('ap-2')]
    expect(adoptPolledApprovals(current, polled, new Set())).toEqual(polled)
  })

  it('keeps the panel the live stream showed when the poll comes back empty', () => {
    const current = [approval('ap-1')]
    expect(adoptPolledApprovals(current, [], new Set())).toBe(current)
  })

  it('drops an already-answered approval from a late poll result', () => {
    // The poll was in flight when the user tapped; it still carries the
    // approval that was just retired. Without the filter the panel pops back.
    expect(adoptPolledApprovals([], [approval('ap-1')], new Set(['ap-1']))).toEqual([])
    expect(adoptPolledApprovals([approval('ap-1')], [], new Set(['ap-1']))).toEqual([])
  })

  it('returns the same array when an idle poll changes nothing (no re-render)', () => {
    const current = [approval('ap-1')]
    expect(adoptPolledApprovals(current, [], new Set(['ap-9']))).toBe(current)
  })
})
