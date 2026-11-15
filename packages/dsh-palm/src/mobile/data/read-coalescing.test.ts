/**
 * 只读调用合并窗口的契约（W4-4）。
 *
 * 这段以前埋在 `api.ts` 里，只能靠"某个视图恰好被 render 两次"来间接验证。
 * 抽出来之后能直接钉住三条最容易出错的行为：
 * - 并发的相同读只发一次；
 * - 窗口内直接复用，窗口外重新发；
 * - 写操作后失效，**在飞的读也不许再写回窗口**（否则"改完又被旧值盖回去"）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { coalescedRead, dedupeRead, invalidateReadCoalescing } from './read-coalescing.ts'
import { resetRpcIO, setRpcIO } from '../platform/rpc.ts'

let calls: string[] = []

/** 假 IO：回一个递增的值，并记下被调了几次。 */
function installFakeIO(): void {
  calls = []
  setRpcIO({
    fetch: async (input, init) => {
      calls.push(input)
      const rpcId = (JSON.parse(String(init.body)) as { rpcId: string }).rpcId
      return {
        ok: true,
        status: 200,
        // rpc 层现在先 text() 再 JSON.parse（读网络与解析分开计时），mock 两个都要给。
        text: async () => JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value: calls.length } }),
        json: async () => ({ type: 'server-response', rpcId, result: { ok: true, value: calls.length } }),
      } as unknown as Response
    },
  })
}

beforeEach(() => {
  installFakeIO()
  invalidateReadCoalescing()
})

afterEach(() => {
  resetRpcIO()
})

describe('coalescedRead', () => {
  it('并发的相同读只发一次（真机里 session.list 曾一次发三遍）', async () => {
    const [a, b, c] = await Promise.all([
      coalescedRead<number>('session.list', { archived: false }),
      coalescedRead<number>('session.list', { archived: false }),
      coalescedRead<number>('session.list', { archived: false }),
    ])
    expect(calls).toHaveLength(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('窗口内复用，窗口外重新发', async () => {
    await coalescedRead<number>('session.list', {}, 20)
    await coalescedRead<number>('session.list', {}, 20)
    expect(calls).toHaveLength(1)
    await new Promise(resolve => setTimeout(resolve, 40))
    await coalescedRead<number>('session.list', {}, 20)
    expect(calls).toHaveLength(2)
  })

  it('payload 不同就是不同的 key（不能拿 A 的答案回答 B）', async () => {
    const first = await coalescedRead<number>('session.list', { archived: false })
    const second = await coalescedRead<number>('session.list', { archived: true })
    expect(calls).toHaveLength(2)
    expect(first).not.toBe(second)
  })

  it('写操作后失效：在飞的读不写回窗口（否则"改完又被旧值盖回去"）', async () => {
    const inFlight = coalescedRead<number>('session.list', { archived: false }, 60_000)
    invalidateReadCoalescing()                        // 相当于中间发生了一次写
    await inFlight
    calls = []
    await coalescedRead<number>('session.list', { archived: false }, 60_000)
    expect(calls).toHaveLength(1)                     // 必须重新去问宿主
  })

  it('失效后新的读不再共享旧的在飞请求', async () => {
    const stale = coalescedRead<number>('session.list', {}, 60_000)
    invalidateReadCoalescing()
    const fresh = coalescedRead<number>('session.list', {}, 60_000)
    await Promise.all([stale, fresh])
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })
})

/**
 * dedupeRead：只合并"同时飞"的调用，**不留结果**。
 *
 * 会话快照这类权威状态不能拿旧值复用（回合在跑没在跑、队列几条，读错就是错的界面），
 * 但同一帧被几个 hook 各要一次是纯浪费 —— 真机实测两个同参 750ms 请求并排飞。
 */
describe('dedupeRead', () => {
  it('并发的相同读只发一次', async () => {
    const [a, b, c] = await Promise.all([
      dedupeRead<number>('mobile.sessionState', { sessionId: 's1' }),
      dedupeRead<number>('mobile.sessionState', { sessionId: 's1' }),
      dedupeRead<number>('mobile.sessionState', { sessionId: 's1' }),
    ])
    expect(calls).toHaveLength(1)
    expect([a, b, c]).toEqual([1, 1, 1])
  })

  it('完成之后不缓存：下一次必须重新问宿主', async () => {
    await dedupeRead<number>('mobile.sessionState', { sessionId: 's1' })
    await dedupeRead<number>('mobile.sessionState', { sessionId: 's1' })
    expect(calls).toHaveLength(2)
  })

  it('payload 不同就是不同的 key', async () => {
    await Promise.all([
      dedupeRead<number>('mobile.sessionState', { sessionId: 's1', rows: false }),
      dedupeRead<number>('mobile.sessionState', { sessionId: 's1', maxRows: 40 }),
    ])
    expect(calls).toHaveLength(2)
  })

  it('失败也把飞行清掉：不会让后续调用永远拿到同一个 rejected promise', async () => {
    setRpcIO({
      fetch: async () => {
        calls.push('boom')
        throw new Error('offline')
      },
    })
    await expect(dedupeRead<number>('mobile.turnState', { sessionId: 's1' })).rejects.toThrow()
    await expect(dedupeRead<number>('mobile.turnState', { sessionId: 's1' })).rejects.toThrow()
    expect(calls).toHaveLength(2)
  })
})
