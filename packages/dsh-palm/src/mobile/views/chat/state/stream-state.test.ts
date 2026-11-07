import { describe, expect, it } from 'vitest'
import { createStreamState, resetStreamState } from './stream-state.ts'
import type { EventFolder, WireEvent } from '../../../messages.ts'

describe('stream-state', () => {
  it('新建时是干净状态（缓冲空、折叠器未建立、没有待回填窗口）', () => {
    const state = createStreamState()
    expect(state.liveBuffer).toEqual([])
    expect(state.eventBatch).toEqual([])
    expect(state.folder).toBeUndefined()
    expect(state.dropWindow).toBeUndefined()
    expect(state.loadedPage).toBe(false)
    expect(state.tailLoading).toBe(false)
    expect(state.autoExtended).toBe(false)
    expect(state.openChainPages).toBe(0)
    expect(state.liveBufferOverflow).toBe(false)
  })

  it('重置把 9 个字段全清掉——漏一个就是跨会话串帧', () => {
    const state = createStreamState()
    state.liveBuffer = [{ seq: 1 } as unknown as WireEvent]
    state.eventBatch = [{ seq: 2 } as unknown as WireEvent]
    state.liveBufferOverflow = true
    state.dropWindow = { from: 3, to: 9 }
    state.autoExtended = true
    state.openChainPages = 4
    state.folder = {} as unknown as EventFolder
    state.loadedPage = true
    state.tailLoading = true

    resetStreamState(state)

    // 逐字段断言：这里用 toEqual 会被"漏清一个"骗过去（漏的那个如果本来就是 0/false 看不出来），
    // 所以每个字段单独写期望值。
    expect(state.liveBuffer).toHaveLength(0)
    expect(state.eventBatch).toHaveLength(0)
    expect(state.liveBufferOverflow).toBe(false)
    expect(state.dropWindow).toBeUndefined()
    expect(state.autoExtended).toBe(false)
    expect(state.openChainPages).toBe(0)
    expect(state.folder).toBeUndefined()
    expect(state.loadedPage).toBe(false)
    expect(state.tailLoading).toBe(false)
  })

  it('重置是原地改同一个对象（调用方持有引用，不是换新对象）', () => {
    const state = createStreamState()
    state.loadedPage = true
    const same = state
    resetStreamState(state)
    expect(same).toBe(state)
    expect(same.loadedPage).toBe(false)
  })
})
