/**
 * 缺口回填：尾部缓冲溢出一段 seq 窗口后，从新到旧一页页补回来。
 *
 * 两条判据是这段代码存在的全部理由，必须钉死：
 * 1. **页码重叠要裁**——窗口底部那一页已经活在尾部快照里，直接前插会出现重复行；
 * 2. **游标不动就停**——`oldestSeq >= beforeSeq` 说明这页没带来更早的行，再翻就是死循环。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./chat-page.ts', () => ({ loadChatPage: vi.fn() }))
vi.mock('../render/messages.ts', () => ({ renderRows: vi.fn() }))

import { loadChatPage } from './chat-page.ts'
import { renderRows } from '../render/messages.ts'
import { refillGap } from './refill-gap.ts'

const mockLoad = vi.mocked(loadChatPage)
const mockRender = vi.mocked(renderRows)

const row = (seq: number) => ({ seq, startSeq: seq })

beforeEach(() => {
  mockLoad.mockReset()
  mockRender.mockReset()
  // renderRows 在本测试里只做透传：真实实现是折叠，不参与这两条判据。
  mockRender.mockImplementation(((rows: readonly unknown[]) => rows) as never)
})

function harness(gap = { from: 10, to: 20 }) {
  const commitRows = vi.fn()
  const applyMessages = vi.fn()
  return {
    commitRows,
    applyMessages,
    run: () =>
      refillGap({
        sessionId: 's-1',
        gap,
        signal: new AbortController().signal,
        isCancelled: () => false,
        folder: () => undefined,
        commitRows: commitRows as never,
        applyMessages: applyMessages as never,
      }),
  }
}

describe('缺口回填', () => {
  it('只补窗口内的行：比 gap.from 更早的留给下一轮，不一次全插', async () => {
    const { commitRows, run } = harness({ from: 10, to: 20 })
    // 一页里既有窗口内的 10/15，也有更早的 3/5
    mockLoad.mockResolvedValueOnce({ rows: [row(3), row(5), row(10), row(15)], hasMore: true } as never)

    run()
    await vi.waitFor(() => expect(commitRows).toHaveBeenCalled())

    expect(commitRows).toHaveBeenCalledTimes(1)
    const updater = commitRows.mock.calls[0]![0] as (prev: unknown[]) => unknown[]
    expect(updater([])).toEqual([row(10), row(15)])
  })

  it('到达窗口底边就停，不再翻更早的页', async () => {
    const { commitRows, run } = harness({ from: 10, to: 20 })
    mockLoad.mockResolvedValueOnce({ rows: [row(10), row(15)], hasMore: true } as never)

    run()
    await vi.waitFor(() => expect(commitRows).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))

    // oldestSeq === gap.from → 已经补到丢窗口的底边
    expect(mockLoad).toHaveBeenCalledTimes(1)
  })

  it('还有更早的页时继续翻，游标一路前移', async () => {
    const { commitRows, run } = harness({ from: 5, to: 20 })
    mockLoad
      .mockResolvedValueOnce({ rows: [row(15), row(18)], hasMore: true } as never)
      .mockResolvedValueOnce({ rows: [row(8), row(12)], hasMore: true } as never)
      // 兜底：游标到 8 后还会再翻一次，这里让它自然收尾（没有更早的页）
      .mockResolvedValue({ rows: [], hasMore: false } as never)

    run()
    await vi.waitFor(() => expect(commitRows).toHaveBeenCalledTimes(2))

    // 第一次 beforeSeq=21 读到 15；第二次应以 15 为游标
    expect(mockLoad.mock.calls[1]![1]).toBe(15)
  })

  it('hasMore=false 时立即收工', async () => {
    const { commitRows, run } = harness({ from: 5, to: 20 })
    mockLoad.mockResolvedValueOnce({ rows: [row(15)], hasMore: false } as never)

    run()
    await vi.waitFor(() => expect(commitRows).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(mockLoad).toHaveBeenCalledTimes(1)
  })

  it('有折叠器时走 folder.prepend + applyMessages，不碰 commitRows', async () => {
    const { commitRows, applyMessages } = harness({ from: 10, to: 20 })
    const snapshot = [row(10), row(15)]
    const folder = {
      prepend: vi.fn(),
      snapshot: vi.fn(() => snapshot),
    }
    mockLoad.mockResolvedValueOnce({ rows: [row(10), row(15)], hasMore: false } as never)

    refillGap({
      sessionId: 's-1',
      gap: { from: 10, to: 20 },
      signal: new AbortController().signal,
      isCancelled: () => false,
      folder: () => folder as never,
      commitRows: commitRows as never,
      applyMessages: applyMessages as never,
    })
    await vi.waitFor(() => expect(applyMessages).toHaveBeenCalledWith(snapshot))

    expect(folder.prepend).toHaveBeenCalledWith([row(10), row(15)])
    expect(commitRows).not.toHaveBeenCalled()
  })

  it('这一批已作废时不再提交，也不继续翻页', async () => {
    const commitRows = vi.fn()
    mockLoad.mockResolvedValueOnce({ rows: [row(10), row(15)], hasMore: true } as never)

    refillGap({
      sessionId: 's-1',
      gap: { from: 10, to: 20 },
      signal: new AbortController().signal,
      isCancelled: () => true,
      folder: () => undefined,
      commitRows: commitRows as never,
      applyMessages: vi.fn() as never,
    })
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(commitRows).not.toHaveBeenCalled()
    expect(mockLoad).toHaveBeenCalledTimes(1)
  })
})
