// @vitest-environment jsdom
/**
 * queued-echo: the phone keeps a copy of what it queued so a message lost in
 * the claim/restart window can be handed back — without ever handing back a
 * message that actually went through (that reads as "send failed" for a message
 * the host already accepted).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  forgetQueuedEcho,
  lostQueuedEchoes,
  markQueuedEchoSeen,
  normalizeEchoText,
  readQueuedEchoes,
  rememberQueuedEcho,
} from './queued-echo.ts'

const SESSION = 's-1'
/** The reconciliation window used by the chat view. */
const QUIET_MS = 20_000
const NOW = 1_000_000

describe('queued echo storage', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { localStorage.clear() })

  it('remembers one copy per session and text', () => {
    rememberQueuedEcho({ sessionId: SESSION, text: '第一句', at: 1 })
    rememberQueuedEcho({ sessionId: SESSION, text: '  第一句  ', at: 2 })
    const echoes = readQueuedEchoes()
    expect(echoes).toHaveLength(1)
    // 重新排队不重置排队时刻，但记下的见队时间要能带上。
    expect(echoes[0]?.at).toBe(1)
  })

  it('records the last time the copy was seen in the host queue', () => {
    rememberQueuedEcho({ sessionId: SESSION, text: '第一句', at: 1 })
    markQueuedEchoSeen(SESSION, '第一句', 500)
    expect(readQueuedEchoes()[0]?.seenAt).toBe(500)
  })

  it('forgets a copy once the message is delivered', () => {
    rememberQueuedEcho({ sessionId: SESSION, text: '第一句', at: 1 })
    forgetQueuedEcho(SESSION, '第一句')
    expect(readQueuedEchoes()).toHaveLength(0)
  })

  it('survives a corrupt payload instead of throwing', () => {
    localStorage.setItem('dsh.palm.queuedEcho', '{"not":"a list"}')
    expect(readQueuedEchoes()).toEqual([])
  })
})

describe('lostQueuedEchoes', () => {
  it('treats only a copy missing from BOTH the queue and the transcript as lost', () => {
    const echoes = [
      { sessionId: SESSION, text: '还在队列里', at: 1 },
      { sessionId: SESSION, text: '已经送达', at: 2 },
      { sessionId: SESSION, text: '宿主重启吃掉了', at: 3 },
      { sessionId: 'other', text: '别的会话', at: 4 },
    ]
    const lost = lostQueuedEchoes(echoes, SESSION, ['还在队列里'], ['已经送达'], { now: NOW, quietMs: QUIET_MS })
    expect(lost.map(entry => entry.text)).toEqual(['宿主重启吃掉了'])
  })

  it('never calls a copy lost while it is still inside the quiet window', () => {
    // 刚离开队列几秒 = 宿主正把它认领成下一轮，对话帧还没到，绝不能回填。
    const echoes = [{ sessionId: SESSION, text: '刚被认领', at: NOW - 60_000, seenAt: NOW - 5_000 }]
    expect(lostQueuedEchoes(echoes, SESSION, [], [], { now: NOW, quietMs: QUIET_MS })).toEqual([])
    // 同样的底稿，过了窗口还不见踪影，才交还给用户。
    expect(lostQueuedEchoes(echoes, SESSION, [], [], { now: NOW + QUIET_MS, quietMs: QUIET_MS })).toHaveLength(1)
  })

  it('counts the quiet window from the last sighting, not from the queue time', () => {
    const echoes = [{ sessionId: SESSION, text: '排了很久', at: NOW - 600_000, seenAt: NOW - 1_000 }]
    expect(lostQueuedEchoes(echoes, SESSION, [], [], { now: NOW, quietMs: QUIET_MS })).toEqual([])
  })

  it('compares text with collapsed whitespace', () => {
    expect(normalizeEchoText('   a\n\nb  ')).toBe('a b')
    const lost = lostQueuedEchoes(
      [{ sessionId: SESSION, text: 'a  b', at: 1 }],
      SESSION,
      ['a b'],
      [],
      { now: NOW, quietMs: QUIET_MS },
    )
    expect(lost).toEqual([])
  })
})
