/**
 * 连通性总线：横幅的真值只能来自真实请求的结局。
 *
 * 真机故障：安卓上 `navigator.onLine` 会一直停在 false（换基站/锁屏回来/5G 与流量
 * 切换），`online` 事件也可能永远不来，于是「网络已断开，消息将在恢复后发送」的横幅
 * 一直挂着、发出去的话一直进离线队列 —— 网络其实早就好了。
 */
import { describe, expect, it, vi } from 'vitest'
import { callUnary, onConnectivityChange, reportConnectivity } from './rpc.ts'

/** Record the bus's verdicts for one test. */
function watch(): boolean[] {
  const seen: boolean[] = []
  onConnectivityChange(online => { seen.push(online) })
  return seen
}

describe('rpc connectivity bus', () => {
  it('reports online when the host answers, even with an HTTP error', async () => {
    const seen = watch()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: '炸了' } }), { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(callUnary('session.list', {})).rejects.toThrow()
    // 500 说明宿主活着：链路是通的，不能因此认定断网。
    expect(seen).toContain(true)
    expect(seen).not.toContain(false)
    vi.unstubAllGlobals()
  })

  it('reports offline only when the request never left the phone', async () => {
    const seen = watch()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(callUnary('session.list', {})).rejects.toThrow()
    expect(seen).toEqual([false])
    vi.unstubAllGlobals()
  })

  it('treats a link that hangs twice in a row as offline, but one slow call as online', async () => {
    // 弱网"挂着"（地铁、隧道半开）不会立刻报错，只会在超时后才失败。一次超时可能只是
    // 某个调用慢；连续两次都没答话就认定断网，之后每次答话都会把计数清零。
    // 计数是模块级的：先清零，免得吃上前面用例的失败次数。
    reportConnectivity(true)
    const seen = watch()
    // 永远不答，但要认 abort：真实 fetch 在超时后就是这么 reject 的。
    const hang = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')) })
    }))
    vi.stubGlobal('fetch', hang)
    await expect(callUnary('session.list', {}, undefined, 5)).rejects.toThrow()
    expect(seen).toEqual([])
    await expect(callUnary('session.list', {}, undefined, 5)).rejects.toThrow()
    expect(seen).toEqual([false])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ type: 'server-response', rpcId: 'x', result: { ok: true, value: 1 } }), { status: 200 })))
    await expect(callUnary('session.list', {})).rejects.toThrow()
    // 答话（哪怕是包不对）已经说明链路通了：计数清零、上报在线。
    expect(seen).toEqual([false, true])
    vi.unstubAllGlobals()
  })
  it('delivers a report to every subscriber and drops unsubscribed ones', () => {
    const seen: boolean[] = []
    const off = onConnectivityChange(online => { seen.push(online) })
    reportConnectivity(false)
    off()
    reportConnectivity(true)
    expect(seen).toEqual([false])
  })
})
