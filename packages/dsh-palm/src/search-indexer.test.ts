import { describe, expect, it } from 'vitest'
import { SearchIndex, type SearchIndexRow } from './search-index.ts'
import { SearchIndexer, planSync, type SyncPage, type SyncSessionMeta } from './search-indexer.ts'

describe('planSync：什么时候要读历史', () => {
  const meta: SyncSessionMeta = { sessionId: 's1', updatedAt: 500 }

  it('没建过索引 → full', () => {
    expect(planSync(meta, undefined)).toEqual({ mode: 'full', reason: 'not-indexed' })
  })

  it('建过一次但没走完 → full（继续从 oldestSeq 往回走）', () => {
    expect(planSync(meta, { updatedAt: 500, complete: false, indexedThroughSeq: 10, oldestSeq: 4 }))
      .toEqual({ mode: 'full', reason: 'resume' })
  })

  it('会话有新内容 → newer（只补比水位更新的）', () => {
    expect(planSync({ sessionId: 's1', updatedAt: 900 }, { updatedAt: 500, complete: true, indexedThroughSeq: 10 }))
      .toEqual({ mode: 'newer', reason: 'updated' })
  })

  it('没有任何变化 → skip（零历史读取）', () => {
    expect(planSync(meta, { updatedAt: 500, complete: true, indexedThroughSeq: 10 }))
      .toEqual({ mode: 'skip', reason: 'fresh' })
  })
})

interface FakeSession {
  updatedAt: number
  title?: string
  rows: SearchIndexRow[]
}

/** A tiny in-memory history source with newest-first paging, like the host's. */
function makeSource(sessions: Record<string, FakeSession>, options: { pageSize?: number } = {}) {
  const calls: Array<{ sessionId: string; beforeSeq: number | undefined }> = []
  const readRows = async (sessionId: string, beforeSeq: number | undefined, maxMessages: number): Promise<SyncPage> => {
    calls.push({ sessionId, beforeSeq })
    const all = [...(sessions[sessionId]?.rows ?? [])].sort((a, b) => a.seq - b.seq)
    const older = beforeSeq === undefined ? all : all.filter(row => row.seq < beforeSeq)
    const size = options.pageSize ?? maxMessages
    const page = older.slice(-size)
    return { rows: page, hasMore: older.length > page.length }
  }
  const listSessions = async (): Promise<SyncSessionMeta[]> =>
    Object.entries(sessions).map(([sessionId, session]) => ({
      sessionId,
      updatedAt: session.updatedAt,
      ...(session.title !== undefined ? { title: session.title } : {}),
    }))
  return { readRows, listSessions, calls }
}

function rowsFor(count: number, prefix: string): SearchIndexRow[] {
  return Array.from({ length: count }, (_, i) => ({
    messageId: `${prefix}-m${i + 1}`,
    seq: i + 1,
    text: `${prefix} 第 ${i + 1} 条：支付专项记录`,
    user: i % 2 === 0,
  }))
}

const openIndex = async (): Promise<SearchIndex> => {
  const index = await SearchIndex.inMemory()
  if (index === undefined) throw new Error('node:sqlite 不可用')
  return index
}

const describeIndex = (await SearchIndex.inMemory()) === undefined ? describe.skip : describe

describeIndex('SearchIndexer：回填 / 增量 / 续跑 / 清理', () => {
  it('首次全量回填，第二次零读取（skip）', async () => {
    const index = await openIndex()
    const source = makeSource({ s1: { updatedAt: 500, title: '支付专项排查', rows: rowsFor(5, 's1') } })
    const indexer = new SearchIndexer({ index, ...source, throttleMs: 0, log: () => {} })

    const first = await indexer.runOnce()
    expect(first.indexed).toBe(1)
    expect(first.docs).toBe(5)
    expect(index.query('支付').length).toBe(5)
    expect(index.sessionState('s1')).toMatchObject({ complete: true, indexedThroughSeq: 5, oldestSeq: 1, docs: 5 })

    const callsAfterFirst = source.calls.length
    const second = await indexer.runOnce()
    expect(second.indexed).toBe(0)
    expect(second.skipped).toBe(1)
    expect(source.calls.length).toBe(callsAfterFirst)
    expect(indexer.status().ready).toBe(true)
    index.close()
  })

  it('会话追加新消息后只补新的，不重扫全量', async () => {
    const index = await openIndex()
    const sessions: Record<string, FakeSession> = { s1: { updatedAt: 500, rows: rowsFor(4, 's1') } }
    const source = makeSource(sessions)
    const indexer = new SearchIndexer({ index, ...source, throttleMs: 0, log: () => {} })
    await indexer.runOnce()

    sessions['s1'] = { updatedAt: 900, rows: [...rowsFor(4, 's1'), { messageId: 's1-new', seq: 5, text: '新增：支付专项回归', user: true }] }
    const callsBefore = source.calls.length
    const run = await indexer.runOnce()
    expect(run.indexed).toBe(1)
    // 一页就够：最新的那页已经越过了水位 4
    expect(source.calls.length - callsBefore).toBe(1)
    expect(source.calls[source.calls.length - 1]).toEqual({ sessionId: 's1', beforeSeq: undefined })
    expect(index.query('支付').length).toBe(5)
    expect(index.sessionState('s1')).toMatchObject({ complete: true, indexedThroughSeq: 5 })
    index.close()
  })

  it('一次跑不完的长会话会记住游标，下次接着往回走', async () => {
    const index = await openIndex()
    const source = makeSource({ s1: { updatedAt: 500, rows: rowsFor(9, 's1') } })
    const indexer = new SearchIndexer({ index, ...source, throttleMs: 0, maxPagesPerSession: 1, pageSize: 3, log: () => {} })

    const first = await indexer.runOnce()
    expect(first.indexed).toBe(1)
    expect(index.sessionState('s1')).toMatchObject({ complete: false, indexedThroughSeq: 9, oldestSeq: 7 })
    expect(index.query('支付').length).toBe(3)

    const second = await indexer.runOnce()
    expect(second.indexed).toBe(1)
    // 第二趟从 oldestSeq=7 继续，而不是又从头读最新页
    expect(source.calls[1]).toEqual({ sessionId: 's1', beforeSeq: 7 })
    expect(index.query('支付').length).toBe(6)
    index.close()
  })

  it('会话从花名册消失后，索引里的旧文档被清掉', async () => {
    const index = await openIndex()
    const sessions: Record<string, FakeSession> = {
      s1: { updatedAt: 500, rows: rowsFor(2, 's1') },
      s2: { updatedAt: 500, rows: rowsFor(2, 's2') },
    }
    const source = makeSource(sessions)
    const indexer = new SearchIndexer({ index, ...source, throttleMs: 0, log: () => {} })
    await indexer.runOnce()
    expect(index.stats().sessions).toBe(2)

    delete sessions['s2']
    const run = await indexer.runOnce()
    expect(run.dropped).toBe(1)
    expect(index.stats()).toMatchObject({ sessions: 1, docs: 2 })
    expect(index.sessionState('s2')).toBeUndefined()
    index.close()
  })

  it('单个会话读失败不影响其他会话（errors 计数，不抛出）', async () => {
    const index = await openIndex()
    const source = makeSource({ s1: { updatedAt: 500, rows: rowsFor(2, 's1') }, bad: { updatedAt: 500, rows: rowsFor(2, 'bad') } })
    const readRows = async (sessionId: string, beforeSeq: number | undefined, maxMessages: number): Promise<SyncPage> => {
      if (sessionId === 'bad') throw new Error('history unavailable')
      return await source.readRows(sessionId, beforeSeq, maxMessages)
    }
    const indexer = new SearchIndexer({ index, listSessions: source.listSessions, readRows, throttleMs: 0, log: () => {} })
    const run = await indexer.runOnce()
    expect(run.errors).toBe(1)
    expect(run.indexed).toBe(1)
    expect(index.query('支付').length).toBe(2)
    index.close()
  })
})
  it('整页都是不进索引的事件时，按页游标继续往更早走（不卡在同一页）', async () => {
    // 真机上 59/317 个会话永远建不完：它们的历史里有一整页工具/推理事件，
    // 折叠后 0 条文档，旧逻辑直接 break —— 于是每趟都停在同一页，永远补不到更早的内容。
    const index = await openIndex()
    const calls: Array<number | undefined> = []
    const readRows = async (_sessionId: string, beforeSeq: number | undefined): Promise<SyncPage> => {
      calls.push(beforeSeq)
      if (beforeSeq === undefined) {
        return {
          rows: [
            { messageId: 'm10', seq: 10, text: '支付专项结论', user: true },
            { messageId: 'm9', seq: 9, text: '支付专项补充', user: false },
          ],
          hasMore: true,
          nextBeforeSeq: 9,
        }
      }
      if (beforeSeq === 9) return { rows: [], hasMore: true, nextBeforeSeq: 4 }
      return { rows: [{ messageId: 'm1', seq: 1, text: '支付专项最早的记录', user: true }], hasMore: false, nextBeforeSeq: 1 }
    }
    const indexer = new SearchIndexer({
      index,
      listSessions: async () => [{ sessionId: 's1', updatedAt: 500 }],
      readRows,
      throttleMs: 0,
      log: () => {},
    })
    const run = await indexer.runOnce()
    expect(calls).toEqual([undefined, 9, 4])
    expect(run.docs).toBe(3)
    expect(index.sessionState('s1')).toMatchObject({ complete: true })
    expect(index.query('支付').length).toBe(3)
    index.close()
  })
  it('连续整页空事件达到上限就收手，并标记 complete（不再每趟重走）', async () => {
    // 实测：59 个会话的历史尾部是一长串工具事件，每次 history 读取约 10s，
    // 不加上限的话每 5 分钟一趟全部耗在重读同一段上，索引永远建不完。
    const index = await openIndex()
    const calls: Array<number | undefined> = []
    const readRows = async (_sessionId: string, beforeSeq: number | undefined): Promise<SyncPage> => {
      calls.push(beforeSeq)
      if (beforeSeq === undefined) return { rows: [{ messageId: 'm10', seq: 10, text: '支付专项结论', user: true }], hasMore: true, nextBeforeSeq: 10 }
      return { rows: [], hasMore: true, nextBeforeSeq: beforeSeq - 1 }
    }
    const indexer = new SearchIndexer({
      index,
      listSessions: async () => [{ sessionId: 's1', updatedAt: 500 }],
      readRows,
      maxEmptyPagesPerSession: 2,
      throttleMs: 0,
      log: () => {},
    })
    const run = await indexer.runOnce()
    expect(calls).toEqual([undefined, 10, 9])
    expect(run.truncated).toBe(1)
    expect(index.sessionState('s1')).toMatchObject({ complete: true, indexedThroughSeq: 10 })
    // 第二趟直接跳过：不再白读
    const callsAfter = calls.length
    await indexer.runOnce()
    expect(calls.length).toBe(callsAfter)
    index.close()
  })
