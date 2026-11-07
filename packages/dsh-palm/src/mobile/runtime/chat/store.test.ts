/**
 * Chat Store 的行为契约（W3-2）。
 *
 * 迁移期最难查的一类 bug 是"状态被悄悄重置"：所以这里既测转移，也测**幂等**
 * ——同一个 action 重复到达不能再造对象（订阅者被无意义唤醒就是多余渲染的来源）。
 */
import { describe, expect, it, vi } from 'vitest'
import { INITIAL_CHAT_STATE, chatReducer, createChatStore } from './store.ts'

describe('chatReducer', () => {
  it('装载阶段：loading → ready 清掉旧错误', () => {
    const failed = chatReducer(INITIAL_CHAT_STATE, { type: 'session/failed', error: 'boom' })
    expect(failed.phase).toBe('error')
    const retrying = chatReducer(failed, { type: 'session/loading' })
    expect(retrying.phase).toBe('loading')
    expect(retrying.error).toBeUndefined()
  })

  it('重复的 loading 不再产生新对象（订阅者不被唤醒）', () => {
    const loading = chatReducer(INITIAL_CHAT_STATE, { type: 'session/loading' })
    expect(chatReducer(loading, { type: 'session/loading' })).toBe(loading)
  })

  it('发送：开始记时间，结算清掉；重复开始幂等', () => {
    const started = chatReducer(INITIAL_CHAT_STATE, { type: 'intent/send-start', at: 1000 })
    expect(started.sending).toBe(true)
    expect(started.lastSentAt).toBe(1000)
    expect(chatReducer(started, { type: 'intent/send-start', at: 2000 })).toBe(started)

    const settled = chatReducer(started, { type: 'intent/send-settled' })
    expect(settled.sending).toBe(false)
    expect(chatReducer(settled, { type: 'intent/send-settled' })).toBe(settled)
  })

  it('停止请求的在途状态独立于发送状态', () => {
    const stopping = chatReducer(INITIAL_CHAT_STATE, { type: 'intent/stop-start' })
    expect(stopping.stopping).toBe(true)
    expect(stopping.sending).toBe(false)
  })

  it('标题只在真的变化时才换对象', () => {
    const titled = chatReducer(INITIAL_CHAT_STATE, { type: 'session/titled', title: '新名字' })
    expect(titled.title).toBe('新名字')
    expect(chatReducer(titled, { type: 'session/titled', title: '新名字' })).toBe(titled)
  })

  it('瞬时提示与装载错误分开：发送失败不该把整页切成错误页', () => {
    const notice = chatReducer(INITIAL_CHAT_STATE, { type: 'notice/set', notice: '发送失败' })
    expect(notice.notice).toBe('发送失败')
    expect(notice.phase).toBe('idle')

    const failed = chatReducer(INITIAL_CHAT_STATE, { type: 'session/failed', error: '加载失败' })
    expect(failed.phase).toBe('error')
    expect(failed.notice).toBeUndefined()
  })

  it('清除提示是幂等的（重复 clear 不换对象）', () => {
    const withNotice = chatReducer(INITIAL_CHAT_STATE, { type: 'notice/set', notice: 'x' })
    const cleared = chatReducer(withNotice, { type: 'notice/clear' })
    expect(cleared.notice).toBeUndefined()
    expect(chatReducer(cleared, { type: 'notice/clear' })).toBe(cleared)
  })

  it('未知 action 原样返回（升级期新旧代码混跑）', () => {
    const weird = { type: 'future/action' } as unknown as Parameters<typeof chatReducer>[1]
    expect(chatReducer(INITIAL_CHAT_STATE, weird)).toBe(INITIAL_CHAT_STATE)
  })
})

describe('createChatStore', () => {
  it('dispatch 后订阅者拿到新状态，退订后不再收到', () => {
    const store = createChatStore()
    const seen: string[] = []
    const off = store.subscribe((state) => seen.push(state.phase))

    store.dispatch({ type: 'session/loading' })
    store.dispatch({ type: 'session/ready' })
    off()
    store.dispatch({ type: 'session/failed', error: 'x' })

    expect(seen).toEqual(['loading', 'ready'])
    expect(store.getState().phase).toBe('error')
  })

  it('无变化的 action 不唤醒订阅者', () => {
    const store = createChatStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.dispatch({ type: 'intent/send-settled' })
    expect(listener).not.toHaveBeenCalled()
  })

  it('多个订阅者都收到：一个抛错不影响其他，但错误仍抛给调用方', () => {
    const store = createChatStore()
    const good = vi.fn()
    store.subscribe(() => { throw new Error('boom') })
    store.subscribe(good)
    // 不静默吞错：错误最终仍抛给 dispatch 调用方，只是排在通知完所有订阅者之后。
    expect(() => store.dispatch({ type: 'session/ready' })).toThrow('boom')
    expect(good).toHaveBeenCalledTimes(1)
    expect(good.mock.calls[0]?.[0]).toMatchObject({ phase: 'ready' })
  })

  it('初始状态是冻不住的单例（迁移期双轨：旧 state 仍在组件里）', () => {
    const store = createChatStore()
    expect(store.getState()).toBe(INITIAL_CHAT_STATE)
  })
})
