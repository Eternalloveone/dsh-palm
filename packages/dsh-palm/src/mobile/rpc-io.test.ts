/**
 * 传输层 IO 注入的契约（W4-2）：**假 IO 全绿**。
 *
 * 这些用例以前只能靠 mock 全局 `fetch` 来写，每条都得记得还原；现在给一个假 IO
 * 对象就够了。三条最容易出错的路径（宿主拒绝 / 超时 / 断网）在这里逐条钉住。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpcCallError, RpcTransportError, callUnary, resetRpcIO, setRpcIO } from './platform/rpc.ts'

afterEach(() => {
  resetRpcIO()
  vi.useRealTimers()
})

/** 从请求体里读 rpcId —— 回包必须带上同一个，否则会被判成信封不匹配。 */
function rpcIdOf(init: RequestInit): string {
  return (JSON.parse(String(init.body)) as { rpcId: string }).rpcId
}

/** 造一个合法的 host 回包。 */
function hostReply(init: RequestInit, result: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ type: 'server-response', rpcId: rpcIdOf(init), result }),
      json: async () => ({ type: 'server-response', rpcId: rpcIdOf(init), result }),
  } as unknown as Response)
}

describe('callUnary · 假 IO', () => {
  it('成功：把 host 的 result.value 原样交回，并把请求体拼对', async () => {
    const calls: Array<{ input: string; init: RequestInit }> = []
    setRpcIO({
      fetch: (input, init) => {
        calls.push({ input, init })
        return hostReply(init, { ok: true, value: { hello: 'world' } })
      },
    })
    await expect(callUnary<{ hello: string }>('mobile.ping', { n: 1 })).resolves.toEqual({ hello: 'world' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.input).toBe('/m/api/mobile.ping')
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>
    expect(body.method).toBe('mobile.ping')
    expect(body.type).toBe('client-request')
    expect(body.payload).toEqual({ n: 1 })
  })

  it('宿主明确拒绝（result.ok=false）：抛 RpcCallError，带上机器码', async () => {
    setRpcIO({
      fetch: (_input, init) => hostReply(init, { ok: false, error: { code: 'session/not-found', message: '没有这个会话' } }),
    })
    await expect(callUnary('mobile.readChat', {})).rejects.toBeInstanceOf(RpcCallError)
    // 机器码挂在 error 对象上（RpcCallError 的形状）：`error.code`，
    // 且会被 normalizeRpcCode 归一（`session/not-found` → `not-found`）
    await expect(callUnary('mobile.readChat', {})).rejects.toMatchObject({ error: { code: 'not-found' } })
  })

  it('HTTP 4xx：把宿主给的说明带出来（不是光秃秃的状态码）', async () => {
    setRpcIO({
      fetch: async () => ({
        ok: false,
        status: 413,
        text: async () => JSON.stringify({ error: { message: 'payload exceeds 64 KiB' } }),
          json: async () => ({ error: { message: 'payload exceeds 64 KiB' } }),
      } as unknown as Response),
    })
    await expect(callUnary('mobile.prompt', {})).rejects.toThrow('payload exceeds 64 KiB')
  })

  it('传输层抛错（断网）：抛 RpcTransportError，不把原始错误直接透给界面', async () => {
    setRpcIO({ fetch: async () => { throw new Error('network down') } })
    await expect(callUnary('mobile.listSessions', {})).rejects.toBeInstanceOf(RpcTransportError)
  })

  it('信封不匹配（回包缺 type / rpcId 对不上）：也算传输层错误', async () => {
    setRpcIO({
      fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ type: 'server-response', rpcId: 'nope', result: { ok: true, value: 1 } }), json: async () => ({ type: 'server-response', rpcId: 'nope', result: { ok: true, value: 1 } }) } as unknown as Response),
    })
    await expect(callUnary('mobile.listSessions', {})).rejects.toBeInstanceOf(RpcTransportError)
  })

  it('超时：也抛 RpcTransportError（不是静默挂死）', async () => {
    vi.useFakeTimers()
    setRpcIO({
      fetch: (_input, init) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      }),
    })
    const pending = callUnary('mobile.listSessions', {}, undefined, 5)
    const assertion = expect(pending).rejects.toBeInstanceOf(RpcTransportError)
    await vi.advanceTimersByTimeAsync(10)
    await assertion
  })

  it('调用方主动取消：同样收敛成 RpcTransportError（可预测的错误面）', async () => {
    const controller = new AbortController()
    setRpcIO({
      fetch: (_input, init) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }),
    })
    const pending = callUnary('mobile.listSessions', {}, controller.signal, 0)
    const assertion = expect(pending).rejects.toBeInstanceOf(RpcTransportError)
    controller.abort()
    await assertion
  })
})
