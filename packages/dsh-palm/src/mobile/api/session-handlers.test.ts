// @vitest-environment node
/**
 * 读己之写（方案 A，2026-11-10）：写操作的应答里要带上**权威队列**。
 *
 * 背景：宿主不发队列变更事件，手机端过去只能靠乐观项 + TTL + 正文比对猜；
 * 写操作是我们经手的，返回前读一次活 agent 的内存 inbox，客户端就能定论。
 */
import { describe, expect, it, vi } from 'vitest'
import { sessionPrompt, sessionUpdateQueue } from './session-handlers.ts'
import { requestIdOfMessage, resetQueueVersionsForTest } from '../../host/queue-inbox.ts'

const items = [
  { id: 'q1', placement: 'queued', text: '下一条', editable: true, requestId: 'req-1' },
]

/** 宿主应答形状：`{ result: { ok, value } }`，`wrap()` 会包成 server-response。 */
const hostReply = (value: Record<string, unknown> = { accepted: true }) => ({ result: { ok: true, value } })

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    apiProxy: {
      sessions: {
        prompt: vi.fn(async () => hostReply()),
        updateQueue: vi.fn(async () => hostReply()),
      },
    },
    rpcId: 'r1',
    request: {},
    payload: { sessionId: 's1' },
    invalidateRosterCaches: () => {},
    invalidateSessionSearch: () => {},
    ...overrides,
  } as never as Parameters<typeof sessionPrompt>[0]
}

/** 从 server-response 里取 value（客户端 callUnary 拿到的就是这个）。 */
function valueOf(response: unknown): Record<string, unknown> {
  return (response as { result: { value: Record<string, unknown> } }).result.value
}

describe('写操作带回权威队列', () => {
  it('session.prompt：应答 value 里带 queue + queueVersion', async () => {
    const ctx = makeCtx({ readQueue: () => ({ items, version: 7 }) })
    const response = await sessionPrompt(ctx)
    const value = valueOf(response)
    expect(value['accepted']).toBe(true)
    expect(value['queue']).toEqual(items)
    expect(value['queueVersion']).toBe(7)
  })

  it('session.updateQueue：同样带（删除/编辑/插队都走它）', async () => {
    const ctx = makeCtx({ readQueue: () => ({ items: [], version: 9 }) })
    const response = await sessionUpdateQueue(ctx)
    const value = valueOf(response)
    expect(value['queue']).toEqual([])
    expect(value['queueVersion']).toBe(9)
  })

  it('没装 agents 服务（readQueue 缺省）：应答保持原样，不塞空队列', async () => {
    const ctx = makeCtx()
    const value = valueOf(await sessionPrompt(ctx))
    expect(value).toEqual({ accepted: true })
    expect(value['queue']).toBeUndefined()
  })

  it('宿主应答没有 value 对象：原样返回，不硬塞', async () => {
    const ctx = makeCtx({ readQueue: () => ({ items, version: 1 }) })
    ;(ctx.apiProxy.sessions.prompt as unknown as { mockResolvedValue: (v: unknown) => void })
      .mockResolvedValue({ result: { ok: true } })
    const value = (await sessionPrompt(ctx) as { result: unknown }).result
    expect(value).toEqual({ ok: true })
  })
})

describe('投递身份桥（2026-11-11：发送失败误报的根因）', () => {
  /**
   * `rememberRequestBody` 早就写好了却从没被调用 —— 队列行永远带不上客户端 requestId，
   * 而送达核实只认身份，于是"其实排上了"被判成"没送到"（真机：发送失败、内容退回输入框）。
   * 这里钉住：投递前后各读一次队列，新冒出来的那一行要记上这次投递的 requestId。
   */
  it('session.prompt：投递后新出现的队列行记上 requestId', async () => {
    let read = 0
    const ctx = makeCtx({
      payload: { sessionId: 's1', requestId: 'req-abc' },
      readQueue: () => {
        read += 1
        // 第一次（投递前）队列是空的，第二次（投递后）多了一行
        return read === 1 ? { items: [], version: 1 } : { items: [{ id: 'msg-1', text: '排队文本' }], version: 2 }
      },
    })
    await sessionPrompt(ctx)
    expect(requestIdOfMessage('msg-1')).toBe('req-abc')
  })

  it('没有 requestId 的老客户端：不记身份，也不乱报错', async () => {
    const ctx = makeCtx({ readQueue: () => ({ items: [{ id: 'msg-9' }], version: 3 }) })
    const value = valueOf(await sessionPrompt(ctx))
    expect(value['queueVersion']).toBe(3)
    expect(requestIdOfMessage('msg-9')).toBeUndefined()
  })
})