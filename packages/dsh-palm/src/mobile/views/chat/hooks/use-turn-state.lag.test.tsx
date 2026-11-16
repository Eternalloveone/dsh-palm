// @vitest-environment jsdom
/**
 * 水位对账（I2，2026-11-15 真机）：实时帧没进来时（rAF 闸门卡住 / 宿主按设备过滤 /
 * 断流），本地折叠水位会永远停在旧值，而丢掉的帧**不会重放**。对账唯一能做的
 * 事是发现落后并重读尾页 —— 这条用例钉住"发现了就重读"，以及"差得不多不要乱重读"。
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../data/diag.ts', () => ({
  reportProbe: vi.fn(async () => ({ file: '', bytes: 0, pushed: false })),
}))
vi.mock('../../../data/session.ts', () => ({ sessionState: vi.fn() }))

import { reportProbe } from '../../../data/diag.ts'
import { sessionState } from '../../../data/session.ts'
import { EventFolder } from '../../../render/messages.ts'
import type { StreamState, UseTurnStateOptions } from '../state/stream-state.ts'
import { useTurnState } from './use-turn-state.ts'

const sessionStateMock = vi.mocked(sessionState)
const reportProbeMock = vi.mocked(reportProbe)

/** 一个已折到 `localSeq` 的流，宿主快照报 `hostSeq`。 */
function options(localSeq: number, reloadTail: () => void): UseTurnStateOptions {
  const stream: StreamState = {
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
  return {
    sessionId: 's1',
    stream,
    messages: [],
    refreshInboxRef: { current: () => undefined },
    normalizeTurnEndTodo: () => undefined,
    foreground: true,
    reloadTailRef: { current: reloadTail },
  }
}

/** 跑一次对账（原子快照那条路），并把它带回来的 promise 冲干净。 */
async function reconcile(result: { current: ReturnType<typeof useTurnState> }): Promise<void> {
  await act(async () => {
    result.current.reconcileRunning()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

describe('水位对账：落后就重读尾页', () => {
  it('宿主水位领先 100 条 → 重读尾页，并留下一条 stream-lag 现场', async () => {
    const reloadTail = vi.fn()
    sessionStateMock.mockResolvedValue({ turn: { running: true }, maxSeq: 100 } as never)
    const { result } = renderHook(() => useTurnState(options(0, reloadTail)))
    act(() => { result.current.markSnapshotAlive() })
    await reconcile(result)
    expect(reloadTail).toHaveBeenCalledTimes(1)
    // 重读必须让水位越过本地这个旧值，否则 `reload-tail` 会报 tail-reload-stall。
    expect(reloadTail).toHaveBeenCalledWith({ expectSeqAbove: 0 })
    expect(reportProbeMock).toHaveBeenCalledWith(
      'stream-lag',
      expect.objectContaining({ lag: 100, localSeq: 0, hostSeq: 100 }),
    )
  })

  it('只差几条（健康路径的正常抖动）→ 不重读', async () => {
    const reloadTail = vi.fn()
    sessionStateMock.mockResolvedValue({ turn: { running: true }, maxSeq: 5 } as never)
    const { result } = renderHook(() => useTurnState(options(0, reloadTail)))
    act(() => { result.current.markSnapshotAlive() })
    await reconcile(result)
    expect(reloadTail).not.toHaveBeenCalled()
    expect(reportProbeMock).not.toHaveBeenCalled()
  })

  it('宿主水位没有前进时，第二次对账不再重复重读', async () => {
    const reloadTail = vi.fn()
    sessionStateMock.mockResolvedValue({ turn: { running: true }, maxSeq: 100 } as never)
    const { result } = renderHook(() => useTurnState(options(0, reloadTail)))
    act(() => { result.current.markSnapshotAlive() })
    await reconcile(result)
    await reconcile(result)
    expect(reloadTail).toHaveBeenCalledTimes(1)
  })
})
