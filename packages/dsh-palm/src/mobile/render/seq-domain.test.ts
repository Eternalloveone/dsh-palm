/**
 * `seq-domain` 体检：只判「宿主页的行」和「客户端折线」是不是同一个 seq 域。
 *
 * 这些用例守的是排查入口：冷启动偶发「同一轮两条过程条」时，必须能在磁盘上看到
 * **是域错开（domain-mismatch / watermark-short）还是另有来源**，而不是又只有一条
 * `stream-lag` 让人继续猜。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { noteSeqDomain, resetSeqDomainForTest, seqDomainOf, type SeqDomainInput } from './seq-domain.ts'

/** 假的折线：给水位、跳过帧数与行快照。 */
function folder(lastSeq: number, rows: readonly { seq: number; kind?: string; turn?: number }[] = [], skipped = 0) {
  return { lastSeq, lastFoldSkipped: skipped, snapshot: () => rows }
}

/** 一份落页输入（默认「一切正常」）。 */
function sample(overrides: Partial<SeqDomainInput> = {}): SeqDomainInput {
  return {
    source: 'entry',
    sessionId: 'session-a',
    hostMaxSeq: 120,
    pageRows: [{ seq: 100 }, { seq: 110 }, { seq: 120 }],
    folder: folder(120),
    buffered: [],
    ...overrides,
  }
}

beforeEach(() => resetSeqDomainForTest())

describe('seqDomainOf', () => {
  it('行尾不超过水位、折线水位也到行尾 → ok', () => {
    expect(seqDomainOf(sample(), undefined).verdict).toBe('ok')
  })

  it('页里的行 seq 超过页自己声明的水位 → domain-mismatch（两份数据不同源）', () => {
    const reading = seqDomainOf(sample({ hostMaxSeq: 90 }), undefined)
    expect(reading.verdict).toBe('domain-mismatch')
    expect(reading.detail).toMatchObject({ hostMaxSeq: 90, pageRowsLastSeq: 120 })
  })

  it('折完水位低于行尾 seq → watermark-short（旧帧会被再折一遍）', () => {
    const reading = seqDomainOf(sample({ folder: folder(110) }), undefined)
    expect(reading.verdict).toBe('watermark-short')
    expect(reading.detail).toMatchObject({ folderSeq: 110, pageRowsLastSeq: 120 })
  })

  it('缓冲帧在水位之上却没进折线 → buffered-beyond（该到的行丢了）', () => {
    const reading = seqDomainOf(
      sample({ buffered: [{ seq: 118 }, { seq: 130 }], folder: folder(120) }),
      undefined,
    )
    expect(reading.verdict).toBe('buffered-beyond')
    expect(reading.detail).toMatchObject({ bufferedLastSeq: 130, folderSeq: 120 })
  })

  it('同一轮多条助手行如实记进明细（「同一轮两条过程条」的直接证据）', () => {
    const rows = [
      { seq: 100, kind: 'assistant', turn: 7 },
      { seq: 105, kind: 'assistant', turn: 7 },
      { seq: 110, kind: 'assistant', turn: 8 },
      { seq: 115, kind: 'turn', turn: 7 },
    ]
    const reading = seqDomainOf(sample({ folder: folder(120, rows) }), undefined)
    expect(reading.detail['multiRowTurns']).toEqual([7])
  })

  it('空页也要给出结论，不抛', () => {
    const reading = seqDomainOf(
      sample({ hostMaxSeq: undefined, pageRows: [], folder: folder(0) }),
      undefined,
    )
    expect(reading.verdict).toBe('ok')
    expect(reading.detail).toMatchObject({ pageRowsFirstSeq: null, pageRowsLastSeq: null, hostMaxSeq: null })
  })
})

describe('noteSeqDomain', () => {
  it('正常落页不上报，但留下可读快照', () => {
    const report = vi.fn()
    noteSeqDomain(sample({ report }))
    expect(report).not.toHaveBeenCalled()
    expect((globalThis as unknown as { __palmSeqDomain?: { verdict?: string } }).__palmSeqDomain?.verdict)
      .toBe('ok')
  })

  it('可疑就上报 seq-domain，并带上前一份折线的水位', () => {
    const report = vi.fn()
    noteSeqDomain(sample({ source: 'cache', hostMaxSeq: 80, report }))
    noteSeqDomain(sample({ source: 'entry', hostMaxSeq: 90, report }))
    expect(report).toHaveBeenCalledTimes(2)
    expect(report.mock.calls[0]?.[0]).toBe('seq-domain')
    expect(report.mock.calls[1]?.[1]).toMatchObject({ verdict: 'domain-mismatch', previousSeq: 120 })
  })

  it('同一场同一种异常只报一次（别刷屏）', () => {
    const report = vi.fn()
    noteSeqDomain(sample({ hostMaxSeq: 90, report }))
    noteSeqDomain(sample({ hostMaxSeq: 90, report }))
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('没有探针通道时只留快照，不抛', () => {
    expect(() => noteSeqDomain(sample({ hostMaxSeq: 10 }))).not.toThrow()
    expect((globalThis as unknown as { __palmSeqDomain?: { verdict?: string } }).__palmSeqDomain?.verdict)
      .toBe('domain-mismatch')
  })
})
