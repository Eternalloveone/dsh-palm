/**
 * Regression: two identical-looking question panels on the phone, and a panel
 * that came back right after it was answered.
 *
 * The mobile.pending fallback is served by a tracker that is only fed from a
 * live phone SSE loop, so a batch answered while the page was hidden (or from
 * the desktop) stays in it. The poll then returns that ghost next to the live
 * ask, and the panel — one submit button, one rpcId — could only answer one of
 * the two.
 */
import { describe, expect, it } from 'vitest'
import { adoptPolledQuestions, latestBatchOf } from './question-batches.ts'
import type { PendingQuestionItem } from './api.ts'

const ask = (rpcId: string, id: string, question: string): PendingQuestionItem => ({ rpcId, id, question })

describe('latestBatchOf', () => {
  it('returns every question of the newest ask', () => {
    const questions = [
      ask('r-1', 'q-1', '第一批'),
      ask('r-2', 'q-2', '第二批'),
      ask('r-2', 'q-3', '第二批之二'),
    ]
    expect(latestBatchOf(questions)).toEqual([
      ask('r-2', 'q-2', '第二批'),
      ask('r-2', 'q-3', '第二批之二'),
    ])
  })

  it('returns an empty list for an empty panel', () => {
    expect(latestBatchOf([])).toEqual([])
  })
})

describe('adoptPolledQuestions', () => {
  it('replaces the panel with a non-empty poll result', () => {
    const current = [ask('r-old', 'q-1', '旧的')]
    const polled = [ask('r-new', 'q-2', '新的')]
    expect(adoptPolledQuestions(current, polled, new Set())).toEqual(polled)
  })

  it('keeps the live panel when the poll comes back empty', () => {
    const current = [ask('r-1', 'q-1', '面板')]
    // Same reference: an idle poll must not re-render the panel.
    expect(adoptPolledQuestions(current, [], new Set())).toBe(current)
  })

  it('never hands back a batch this phone already answered', () => {
    // The user answered r-1; its question/resolved frame was missed while the
    // page was hidden, so the tracker still returns it — while r-2 is live.
    const answered = new Set(['r-1'])
    const current = [
      ask('r-1', 'q-old', '已经答过的批次'),
      ask('r-2', 'q-2', '当前的批次'),
    ]
    const polled = [ask('r-1', 'q-old', '已经答过的批次')]

    expect(adoptPolledQuestions(current, polled, answered).map(q => q.rpcId)).toEqual(['r-2'])
  })

  it('clears the panel when every polled batch was already answered', () => {
    const answered = new Set(['r-1'])
    const ghost = [ask('r-1', 'q-1', '已经答过')]
    expect(adoptPolledQuestions(ghost, ghost, answered)).toEqual([])
  })
})
