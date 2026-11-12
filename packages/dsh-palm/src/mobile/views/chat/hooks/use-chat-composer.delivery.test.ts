// @vitest-environment node
/**
 * 送达核实（2026-11-11 用户：「提示排队发送失败、内容退回输入框，但其实已经排队成功」）。
 *
 * 结论三态：delivered / absent / unknown。核心是两条：
 *   ① 宿主写队列比客户端 30 秒超时慢一拍时，核实要**等**（重试到 ~8 秒）；
 *   ② 核实请求本身读不通 = **不知道**，绝不能当成"没送到"去谎报失败。
 */
import { describe, expect, it, vi } from 'vitest'
import { probeQueueForRequest, verifyDelivered } from './use-chat-composer.ts'

const inboxWith = (items: Array<{ text?: string; requestId?: string }>) => async () =>
  ({ inbox: { nextTurn: items } } as never)

const tailWith = (rows: Array<{ kind: string; text?: string }>, hasMore = false) => async () =>
  ({ rows, hasMore } as never)

const noSleep = async (): Promise<void> => {}

describe('发送送达核实', () => {
  it('队列里有这个 requestId：直接算送到', async () => {
    const inbox = vi.fn(inboxWith([{ text: '排队文本', requestId: 'req-1' }]))
    const check = await verifyDelivered('s1', '排队文本', 'req-1', { inbox, tail: vi.fn(), sleep: noSleep })
    expect(check).toBe('delivered')
    expect(inbox).toHaveBeenCalledTimes(1)
  })

  it('宿主晚一拍才写进队列：重试后算送到（不谎报失败）', async () => {
    const inbox = vi.fn()
      .mockResolvedValueOnce({ inbox: { nextTurn: [] } })
      .mockResolvedValueOnce({ inbox: { nextTurn: [] } })
      .mockResolvedValueOnce({ inbox: { nextTurn: [{ text: '排队文本', requestId: 'req-1' }] } })
    const check = await verifyDelivered('s1', '排队文本', 'req-1', { inbox: inbox as never, tail: vi.fn(), sleep: noSleep })
    expect(check).toBe('delivered')
    expect(inbox).toHaveBeenCalledTimes(3)
  })

  it('核实请求全部读不通：返回 unknown（不是 absent）', async () => {
    const inbox = vi.fn().mockRejectedValue(new Error('tunnel down'))
    const tail = vi.fn().mockRejectedValue(new Error('tunnel down'))
    const check = await verifyDelivered('s1', '排队文本', 'req-1', { inbox: inbox as never, tail: tail as never, sleep: noSleep })
    expect(check).toBe('unknown')
  })

  it('读得通且队列/正文都没有：确证没送到（absent）', async () => {
    const inbox = vi.fn(inboxWith([{ text: '别的消息', requestId: 'other' }]))
    const tail = vi.fn(tailWith([{ kind: 'user', text: '别的消息' }]))
    const check = await verifyDelivered('s1', '排队文本', 'req-1', { inbox: inbox as never, tail: tail as never, sleep: noSleep })
    expect(check).toBe('absent')
  })

  it('队列快照还没刷新、但正文尾部已经有这条：算送到', async () => {
    const inbox = vi.fn(inboxWith([]))
    const tail = vi.fn(tailWith([{ kind: 'assistant', text: '回复' }, { kind: 'user', text: '排队文本' }]))
    const check = await verifyDelivered('s1', '排队文本', 'req-1', { inbox: inbox as never, tail: tail as never, sleep: noSleep })
    expect(check).toBe('delivered')
  })

  it('最近 60 行里没有、但历史还没读完：不下"没送到"的结论（unknown，不回撤）', async () => {
    // 2026-11-12 用户：「已经发送完了，排队消息还会撤回到发送框」。
    // 繁忙回合里，发出去的那条 user 消息会被后续几十行工具调用挤出 60 行窗口，
    // 原来这种"没找到"直接判 absent → 正文被放回输入框。hasMore 为真时手里没有反证。
    const inbox = vi.fn(inboxWith([]))
    const tail = vi.fn(tailWith([{ kind: 'assistant', text: '一堆后续输出' }], true))
    const check = await verifyDelivered('s1', '排队文本', 'req-1', { inbox: inbox as never, tail: tail as never, sleep: noSleep })
    expect(check).toBe('unknown')
  })

  it('宿主账本记过这笔：直接算送到，不再读队列和尾部', async () => {
    // 2026-11-12「动」：宿主在处理 session.prompt 成功返回时记账，这是唯一一条
    // 不是推断的证据。队列/尾部都不用看了。
    const inbox = vi.fn(inboxWith([]))
    const tail = vi.fn(tailWith([], true))
    const accepted = vi.fn(async () => true)
    const check = await verifyDelivered('s1', '排队文本', 'req-1', {
      inbox: inbox as never, tail: tail as never, sleep: noSleep, accepted: accepted as never,
    })
    expect(check).toBe('delivered')
    expect(accepted).toHaveBeenCalledWith('s1', 'req-1')
    expect(tail).not.toHaveBeenCalled()
  })

  it('账本没记录时照旧往下核（不会因为账本空就说没送到）', async () => {
    const inbox = vi.fn(inboxWith([]))
    const tail = vi.fn(tailWith([{ kind: 'user', text: '排队文本' }], false))
    const accepted = vi.fn(async () => false)
    const check = await verifyDelivered('s1', '排队文本', 'req-1', {
      inbox: inbox as never, tail: tail as never, sleep: noSleep, accepted: accepted as never,
    })
    expect(check).toBe('delivered')
  })

  it('账本接口自己报错：不影响后续判断，也不误判没送到', async () => {
    const inbox = vi.fn(inboxWith([]))
    const tail = vi.fn(tailWith([{ kind: 'assistant', text: '别的' }], true))
    const accepted = vi.fn(async () => { throw new Error('boom') })
    const check = await verifyDelivered('s1', '排队文本', 'req-1', {
      inbox: inbox as never, tail: tail as never, sleep: noSleep, accepted: accepted as never,
    })
    expect(check).toBe('unknown')
  })

  it('历史读完了仍然没有：这才是确证没送到（absent，可以回撤）', async () => {
    const inbox = vi.fn(inboxWith([]))
    const tail = vi.fn(tailWith([{ kind: 'assistant', text: '别的' }], false))
    const check = await verifyDelivered('s1', '排队文本', 'req-1', { inbox: inbox as never, tail: tail as never, sleep: noSleep })
    expect(check).toBe('absent')
  })

  it('正文被折过行/压过空格也算同一条（不是"没送到"）', async () => {
    const inbox = vi.fn(inboxWith([]))
    const tail = vi.fn(tailWith([{ kind: 'user', text: '第一行\n第二行' }], true))
    const check = await verifyDelivered('s1', '第一行 第二行', 'req-1', { inbox: inbox as never, tail: tail as never, sleep: noSleep })
    expect(check).toBe('delivered')
  })

  it('正文带引用/折行压缩时按前 40 字匹配也算送到', async () => {
    const text = '这是一条很长的排队消息，用来验证前缀匹配在正文被改写时仍然有效，后面还有更多内容。'
    const inbox = vi.fn(inboxWith([]))
    const tail = vi.fn(tailWith([{ kind: 'user', text: `${text.slice(0, 40)}…（已截断）` }]))
    const check = await verifyDelivered('s1', text, 'req-1', { inbox: inbox as never, tail: tail as never, sleep: noSleep })
    expect(check).toBe('delivered')
  })
})
describe('单次队列探针（后台确认用）', () => {
  it('requestId 在队列里 → yes', async () => {
    expect(await probeQueueForRequest('s1', 'req-1', inboxWith([{ requestId: 'req-1' }]) as never)).toBe('yes')
  })

  it('next-step（插队）里也算', async () => {
    const inbox = async () => ({ inbox: { nextStep: [{ requestId: 'req-1' }] } } as never)
    expect(await probeQueueForRequest('s1', 'req-1', inbox as never)).toBe('yes')
  })

  it('队列行没带 requestId、但正文对得上 → yes（身份桥没接上时的旁证）', async () => {
    // 2026-11-11 真机：「经常发送失败，内容又回到输入框」。宿主队列行不回显 requestId，
    // 身份桥一旦没补上，核实就永远是"没有" → 8 秒后判失败，可那条其实已在队列里。
    const inbox = async () => ({ inbox: { nextTurn: [{ text: '排队文本' }] } } as never)
    expect(await probeQueueForRequest('s1', 'req-1', inbox as never, '排队文本')).toBe('yes')
    // 空白差异不影响
    expect(await probeQueueForRequest('s1', 'req-1', inbox as never, '  排队文本 ')).toBe('yes')
  })

  it('正文对不上就不算送到（不能靠"有排队"蒙混）', async () => {
    const inbox = async () => ({ inbox: { nextTurn: [{ text: '别的消息' }] } } as never)
    expect(await probeQueueForRequest('s1', 'req-1', inbox as never, '排队文本')).toBe('no')
  })
  it('读到了但没有这条 → no（与读失败区分开）', async () => {
    expect(await probeQueueForRequest('s1', 'req-1', inboxWith([{ requestId: 'other' }]) as never)).toBe('no')
  })

  it('读失败 → error（调用方据此不下"没送到"的结论）', async () => {
    const inbox = async () => { throw new Error('tunnel down') }
    expect(await probeQueueForRequest('s1', 'req-1', inbox as never)).toBe('error')
  })
})
