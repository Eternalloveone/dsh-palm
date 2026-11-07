/**
 * 帧入口守卫的契约 + **golden 形状快照**（W4-1）。
 *
 * 快照记的是「每一帧的顶层字段集合」，不是值：字段改名/增删会在 diff 里出现，
 * 而不是等到某个视图少显示一行才被发现。
 *
 * 快照变更规则：**改了就要能说出为什么**（宿主加了字段 / 客户端不再用某个字段）。
 * 只为让测试变绿而 `-u` 是不允许的。
 */
import { describe, expect, it } from 'vitest'
import type { MuxFrame } from '../../api-proxy-types.ts'
import { frameSessionId, frameShape, readFrame } from './frames.ts'

/** 每种帧一份有代表性的样本（形状取自宿主实际发送的结构）。 */
const SAMPLES: Record<string, unknown> = {
  'session/event': { type: 'session/event', sessionId: 's1', event: { type: 'turn/start', seq: 1, time: 0, data: {} } },
  'session/subscribed': { type: 'session/subscribed', sessionId: 's1', lastSeq: 12 },
  'approval/requested': { type: 'approval/requested', sessionId: 's1', approvalId: 'a1', toolName: 'bash', callId: 'c1', reason: '写文件', risk: 'write' },
  'approval/resolved': { type: 'approval/resolved', sessionId: 's1', approvalId: 'a1', outcome: 'allowed-once' },
  'question/requested': { type: 'question/requested', sessionId: 's1', questions: [{ id: 'q1', question: '选哪个？', options: [] }] },
  'question/resolved': { type: 'question/resolved', sessionId: 's1', questionRpcId: 'r1', outcome: 'answered' },
  'session/queue': { type: 'session/queue', sessionId: 's1', items: [] },
  'session/jobs': { type: 'session/jobs', sessionId: 's1', jobs: [] },
  'session/projection': { type: 'session/projection', sessionId: 's1', key: 'todo', value: [], seq: 3 },
  'goal/activation': { type: 'goal/activation', sessionId: 's1', activation: 'armed' },
  'session/added': { type: 'session/added', summary: { sessionId: 's1', title: '新会话' } },
  'session/removed': { type: 'session/removed', sessionId: 's1' },
  'session/status': { type: 'session/status', sessionId: 's1', running: true },
  'session/turn-boundary': { type: 'session/turn-boundary', sessionId: 's1', running: false, source: 'inferred', seq: 9 },
  'session/activity': { type: 'session/activity', sessionId: 's1', updatedAt: 1 },
  'session/error': { type: 'session/error', sessionId: 's1', message: 'boom' },
  'mux/ping': { type: 'mux/ping' },
  'stream/error': { type: 'stream/error', error: { code: 'internal', message: 'x' } },
}

describe('readFrame', () => {
  it('每一种帧都认得出来', () => {
    for (const [type, sample] of Object.entries(SAMPLES)) {
      const frame = readFrame(sample)
      expect(frame, type).toBeDefined()
      expect(frame!.type).toBe(type)
    }
  })

  it('不是对象 / 没有 type / type 不是字符串 → undefined', () => {
    expect(readFrame(null)).toBeUndefined()
    expect(readFrame('session/event')).toBeUndefined()
    expect(readFrame(42)).toBeUndefined()
    expect(readFrame({})).toBeUndefined()
    expect(readFrame({ type: 123 })).toBeUndefined()
  })

  it('不认识的帧静默丢弃（老客户端遇到新帧不能把连接判成断流）', () => {
    expect(readFrame({ type: 'session/brand-new' })).toBeUndefined()
  })
})

describe('frameSessionId', () => {
  it('会话内的帧给出 id', () => {
    expect(frameSessionId(SAMPLES['session/status'] as MuxFrame)).toBe('s1')
  })

  it('全局帧没有 sessionId', () => {
    expect(frameSessionId(SAMPLES['mux/ping'] as MuxFrame)).toBeUndefined()
  })

  it('空串当成没有', () => {
    expect(frameSessionId({ type: 'session/status', sessionId: '', running: true } as MuxFrame)).toBeUndefined()
  })
})

describe('golden：每一帧的顶层形状', () => {
  it('形状与快照一致', () => {
    const shapes: Record<string, string[]> = {}
    for (const [type, sample] of Object.entries(SAMPLES)) shapes[type] = frameShape(sample)
    expect(shapes).toMatchSnapshot()
  })
})
