// @vitest-environment jsdom
/**
 * The session list's running-resync cadence.
 *
 * These two constants had their units off by 1000×: the cooldown was `30`
 * (milliseconds, intended "30 s") and the candidate window was
 * `10 * 60_000_000` (6.9 days, intended "10 minutes"). The effect was a page
 * left sitting on the roster asking the host about eight sessions every five
 * seconds — ~108 RPCs a minute, forever.
 */
import { describe, expect, it } from 'vitest'
import { RUNNING_CANDIDATE_AGE_MS, RUNNING_RESYNC_MS } from './SessionListView.tsx'

describe('session list running resync', () => {
  it('asks the host again at most every 30 seconds', () => {
    expect(RUNNING_RESYNC_MS).toBe(30_000)
  })

  it('only verifies rows active within the last 10 minutes', () => {
    expect(RUNNING_CANDIDATE_AGE_MS).toBe(10 * 60_000)
  })
})
