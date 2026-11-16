// @vitest-environment node
/**
 * 水位自愈的重读路径（2026-11-16 真机：`localSeq` 卡在 2220，宿主已到 3193 / 3424，
 * 连续两次"重读尾页"水位纹丝不动，磁盘上却只剩一条 lag —— 读失败/读到旧页都是静默的）。
 *
 * 这组用例钉住三件事：
 * 1. 重读**固定绕过**"刚同步过就用本地那份"的直通（否则自愈读自己）；
 * 2. 重读回来水位没越过调用方给的期望值 → 上报 `tail-reload-stall`；
 * 3. 重读**失败**且带期望值 → 上报 `tail-reload-failed`（以前这条完全无声）。
 */
import { describe, expect, it, vi } from 'vitest'
import type { StreamState } from '../views/chat/state/stream-state.ts'

vi.mock('./chat-page.ts', () => ({ loadChatPage: vi.fn() }))

const { loadChatPage } = await import('./chat-page.ts')
const { reloadTailPage } = await import('./reload-tail.ts')
const { EventFolder } = await import('../render/messages.ts')
const loadChatPageMock = vi.mocked(loadChatPage)

/** 一个已折到 `localSeq` 的流（和 ChatView 里那份同形）。 */
function stateAt(localSeq: number): StreamState {
  return {
    liveBuffer: [],
    liveBufferOverflow: false,
    dropWindow: undefined,
    autoExtended: false,
    openChainPages: 0,
    folder: new EventFolder([], localSeq),
    loadedPage: true,
    tailLoading: false,
    eventBatch: [],
  }
}

/** 一次重读的全部注入点（只断言与水位有关的那几个）。 */
function deps(state: StreamState, reportProbe?: (probe: string, detail: Record<string, unknown>) => void) {
  return {
    sessionId: 's1',
    state,
    controllerRef: { current: undefined as AbortController | undefined },
    epochRef: { current: 0 },
    applyMessages: vi.fn(),
    setHasOlder: vi.fn(),
    setError: vi.fn(),
    refillGap: vi.fn(),
    ...(reportProbe === undefined ? {} : { reportProbe }),
  }
}

/** 把重读带回来的 promise 冲干净（这条路径是 fire-and-forget）。 */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('重读尾页：自愈不许读自己', () => {
  it('固定带 bypassEntryCache，走到宿主那份新的', async () => {
    loadChatPageMock.mockResolvedValue({ rows: [], maxSeq: 500, hasMore: true } as never)
    const state = stateAt(100)
    reloadTailPage(deps(state), { expectSeqAbove: 100 })
    await settle()
    expect(loadChatPageMock).toHaveBeenCalledTimes(1)
    expect(loadChatPageMock.mock.calls[0]?.[6]).toEqual({ bypassEntryCache: true })
    // 水位真的前进了：没有"白读"可报。
    expect(state.folder?.lastSeq).toBe(500)
  })

  it('重读回来还是旧水位 → 报 tail-reload-stall（带上前后两个水位）', async () => {
    loadChatPageMock.mockResolvedValue({ rows: [], maxSeq: 100, hasMore: true } as never)
    const state = stateAt(100)
    const reportProbe = vi.fn()
    reloadTailPage(deps(state, reportProbe), { expectSeqAbove: 100 })
    await settle()
    expect(reportProbe).toHaveBeenCalledWith(
      'tail-reload-stall',
      expect.objectContaining({ sessionId: 's1', expectedAbove: 100, got: 100, previous: 100 }),
    )
  })

  it('普通重载（命令改写历史）不传期望值：水位没变也不报', async () => {
    loadChatPageMock.mockResolvedValue({ rows: [], maxSeq: 100, hasMore: true } as never)
    const state = stateAt(100)
    const reportProbe = vi.fn()
    reloadTailPage(deps(state, reportProbe))
    await settle()
    expect(reportProbe).not.toHaveBeenCalled()
  })

  it('重读失败且带期望值 → 报 tail-reload-failed，并保留旧折叠器', async () => {
    loadChatPageMock.mockRejectedValue(new Error('aborted') as never)
    const state = stateAt(100)
    const reportProbe = vi.fn()
    const applyMessages = vi.fn()
    reloadTailPage({ ...deps(state, reportProbe), applyMessages }, { expectSeqAbove: 100 })
    await settle()
    expect(reportProbe).toHaveBeenCalledWith(
      'tail-reload-failed',
      expect.objectContaining({ sessionId: 's1', expectedAbove: 100, stillAt: 100, reason: 'aborted' }),
    )
    // 失败不能把画面清空：旧水位还在原地。
    expect(state.folder?.lastSeq).toBe(100)
    expect(state.tailLoading).toBe(false)
  })
})
