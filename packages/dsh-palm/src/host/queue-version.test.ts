// @vitest-environment node
/**
 * 队列单调版本（2026-11-10 架构修法）。
 *
 * 排队条那一族毛病（消失又出现、已发送的复活、删不掉、一闪一闪）根子是同一条：
 * 「权威队列」其实是投影快照，会慢半拍甚至几分钟。这里给队列一个只增不减的版本，
 * 并且**只在事件发生时推进** —— 读投影不推进，于是「版本没变」就等于「内容没变」，
 * 客户端可以直接丢弃任何版本不大于已应用值的快照。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  bumpQueueVersion,
  queueVersionOf,
  resetQueueVersionsForTest,
  stampQueueVersion,
} from './queue-inbox.ts'

const SESSION = 's-version'

/** 一条 inbox 投影行（宿主 0.2.x：正文在行上）。 */
const row = (id: string, text: string): unknown => ({ id, content: [{ type: 'text', text }] })

beforeEach(() => {
  resetQueueVersionsForTest()
})

describe('stampQueueVersion', () => {
  it('还没有任何事件时版本是 0，且无关帧不打版本', () => {
    expect(queueVersionOf(SESSION)).toBe(0)
    const payload = { type: 'session/jobs', sessionId: SESSION }
    expect(stampQueueVersion(payload)).toBe(payload)
  })

  it('inbox 投影内容变了才 +1（同样内容重复推送不涨）', () => {
    const first = stampQueueVersion({
      type: 'session/projection', key: 'inbox', sessionId: SESSION,
      value: { 'next-turn': [row('q1', '第一条')] },
    }) as { queueVersion?: number }
    expect(first.queueVersion).toBe(1)

    const same = stampQueueVersion({
      type: 'session/projection', key: 'inbox', sessionId: SESSION,
      value: { 'next-turn': [row('q1', '第一条')] },
    }) as { queueVersion?: number }
    expect(same.queueVersion).toBe(1)

    const changed = stampQueueVersion({
      type: 'session/projection', key: 'inbox', sessionId: SESSION,
      value: { 'next-turn': [] },
    }) as { queueVersion?: number }
    expect(changed.queueVersion).toBe(2)
  })

  it('turn/start（队首被认领）也要推进版本，否则陈旧投影能借同一版本画回来', () => {
    const frame = stampQueueVersion({
      type: 'session/event', sessionId: SESSION,
      event: { type: 'turn/start', seq: 10 },
    }) as { queueVersion?: number }
    expect(frame.queueVersion).toBe(1)
    expect(queueVersionOf(SESSION)).toBe(1)
  })

  it('显式 session/queue 帧直接推进', () => {
    const stamped = stampQueueVersion({ type: 'session/queue', sessionId: SESSION, items: [] }) as { queueVersion?: number }
    expect(stamped.queueVersion).toBe(1)
    expect(bumpQueueVersion(SESSION)).toBe(2)
  })
})
