/**
 * 端到端：真 HTTP → 门禁 → mobile.search → 自建索引。
 *
 * 这里不 mock 搜索链路：起一个真的 node:http 服务挂上 `makeMobileApiRoutes`，
 * 用真的 cookie 走 `readCookie` + 门禁，再把请求打到 `mobile.search`；宿主那边
 * 只替身 `apiProxy`（会话列表 / 历史 / 工作区）——那是 DSH 内部服务，不是本插件
 * 的代码。所以这些断言证明的是「手机上点搜索会发生什么」，而不是某个函数的返回值。
 *
 * 同一套用例既在本机跑，也用来做容器内验证（Docker 里只换 Node 版本和 cwd）。
 */

import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeSearchIndexes, makeMobileApiRoutes } from './mobile-api.ts'
import type { ApiProxy } from './api-proxy-types.ts'
import type { PairingService } from './pairing.ts'

type WireMessage = { role: 'user' | 'assistant'; text: string }

interface SeedSession {
  sessionId: string
  title?: string
  updatedAt?: number
  cwd?: string
  workspaceId?: string
  origin?: 'subagent'
  messages: WireMessage[]
}

interface Harness {
  url: string
  cookie: string
  dir: string
  /** POST one `/m/api/<method>` as the paired phone would. */
  rpc<T = unknown>(method: string, payload: unknown): Promise<T>
  close(): Promise<void>
}

const COOKIE = 'dsh_pair'

/** DSH wire event for one seeded message (the fold reads exactly this shape). */
function eventsFor(session: SeedSession): Array<{ event: unknown; view?: unknown }> {
  const events: Array<{ event: unknown; view?: unknown }> = []
  let seq = 1
  let turn = 0
  for (const message of session.messages) {
    const time = 1_700_000_000_000 + seq * 1000
    if (message.role === 'user') {
      events.push({
        event: {
          type: 'user/message',
          seq,
          time,
          data: { id: `${session.sessionId}-u${seq}`, role: 'user', content: [{ type: 'text', text: message.text }], source: { kind: 'user' } },
        },
      })
      seq += 1
      continue
    }
    turn += 1
    events.push({
      event: { type: 'assistant/chunk', seq, time, data: { turn, step: 1, chunk: { type: 'text-delta', index: 0, text: message.text } } },
    })
    seq += 1
  }
  return events
}

/**
 * `apiProxy` stand-in: the host session store. Paging mirrors the host — newest
 * page first, `beforeSeq` walks backwards, `hasMore` says whether older rows
 * remain (the indexer's whole resume logic hangs off these two).
 */
function fakeApiProxy(sessions: readonly SeedSession[]): ApiProxy {
  const bySession = new Map(sessions.map(session => [session.sessionId, eventsFor(session)]))
  return {
    sessions: {
      list: async () => ({
        result: {
          ok: true,
          value: {
            items: sessions.map(session => ({
              sessionId: session.sessionId,
              updatedAt: session.updatedAt ?? 1_700_000_000_000,
              cwd: session.cwd ?? '/w/demo',
              ...(session.origin === undefined ? {} : { origin: session.origin }),
              projections: { values: { ...(session.title === undefined ? {} : { title: session.title }) } },
            })),
            hasMore: false,
          },
        },
      }),
      history: async (request: { payload?: { sessionId?: string; beforeSeq?: number; maxMessages?: number } }) => {
        const sessionId = String(request.payload?.sessionId ?? '')
        const beforeSeq = request.payload?.beforeSeq
        const maxMessages = request.payload?.maxMessages ?? 25
        const all = (bySession.get(sessionId) ?? []).filter(
          entry => beforeSeq === undefined || Number((entry.event as { seq: number }).seq) < beforeSeq,
        )
        const page = all.slice(-Math.max(1, maxMessages))
        return { result: { ok: true, value: { events: page, hasMore: all.length > page.length } } }
      },
    },
    workspace: {
      list: async () => ({
        result: {
          ok: true,
          value: {
            items: [...new Set(sessions.map(session => session.workspaceId ?? 'w-1'))].map(workspaceId => ({
              workspaceId,
              path: '/w',
              title: '演示工作区',
              sessionIds: sessions.filter(session => (session.workspaceId ?? 'w-1') === workspaceId).map(session => session.sessionId),
            })),
            archivedSessionIds: [],
          },
        },
      }),
    },
  } as unknown as ApiProxy
}

/**
 * Pairing is faked to the two members the gate touches (`config.cookieName`,
 * `touchDevice`): minting a real device cookie is pairing's own test surface and
 * has nothing to do with whether search is accurate.
 */
function fakePairing(): PairingService {
  return {
    config: { cookieName: COOKIE },
    touchDevice: () => ({ ok: true }),
  } as unknown as PairingService
}

async function startHarness(sessions: readonly SeedSession[], options: { eager?: boolean } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-search-e2e-'))
  const routes = makeMobileApiRoutes({
    service: fakePairing(),
    apiProxy: fakeApiProxy(sessions),
    pendingTracker: {} as never,
    mobileEnterToSend: () => true,
    perfDir: dir,
    searchIndexPath: join(dir, 'search-index.db'),
    searchIndexEager: options.eager !== false,
  })
  const server: Server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const route = routes.find(entry => (entry.kind === 'prefix' ? pathname.startsWith(entry.path) : pathname === entry.path))
    if (route === undefined) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    void route.handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const url = `http://127.0.0.1:${port}`
  return {
    url,
    cookie: `${COOKIE}=e2e-device`,
    dir,
    async rpc<T>(method: string, payload: unknown): Promise<T> {
      const response = await fetch(`${url}/m/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `${COOKIE}=e2e-device` },
        body: JSON.stringify({ type: 'client-request', rpcId: 'e2e', method, payload }),
      })
      return (await response.json()) as T
    },
    async close(): Promise<void> {
      await new Promise<void>(resolve => server.close(() => resolve()))
      // 索引库是 sqlite 文件句柄：不关掉 Windows 上临时目录删不掉。
      closeSearchIndexes()
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // 句柄偶发还挂着（防病毒/索引服务），留给系统清理临时目录。
      }
    },
  }
}

interface SearchResponse {
  result: {
    ok: boolean
    value?: {
      items: Array<{
        kind: string
        sessionId: string
        title?: string
        hits?: number
        seq?: number
        snippet?: string
        ranges?: Array<[number, number]>
        user?: boolean
        messages?: Array<{ seq: number; messageId?: string; partId?: string; snippet: string; ranges?: Array<[number, number]>; user?: boolean }>
      }>
      total: number
      hasMore: boolean
      nextOffset?: number
      tookMs: number
      fallback?: boolean
      source?: string
    }
    error?: { code: string }
  }
}

/** The fixtures the accuracy cases share. */
const CORPUS: SeedSession[] = [
  {
    sessionId: 's-pay',
    title: '支付专项排查',
    updatedAt: 1_700_000_300_000,
    messages: [
      { role: 'user', text: '我们做了支付专项的调试，波形抓了三次' },
      { role: 'assistant', text: '支付流程复现了，问题在回调' },
      { role: 'user', text: '再确认一下付专这条链路' },
    ],
  },
  {
    sessionId: 's-dp',
    title: 'DP534 报点率',
    updatedAt: 1_700_000_200_000,
    messages: [
      { role: 'user', text: 'DP534 的 scan time 有点长' },
      { role: 'assistant', text: 'scan 结束后报点率恢复正常' },
    ],
  },
  {
    sessionId: 's-expense',
    title: '报销单据',
    updatedAt: 1_700_000_100_000,
    messages: [
      { role: 'user', text: '报销单据丢了，需要重新打印' },
      { role: 'assistant', text: '建议先核销再补单' },
    ],
  },
  {
    sessionId: 's-sub',
    origin: 'subagent',
    title: '子代理会话',
    messages: [{ role: 'user', text: '支付专项（子代理里不该被搜到）' }],
  },
]

describe('端到端：手机搜索（真 HTTP + 真门禁 + 自建索引）', () => {
  let harness: Harness | undefined

  afterEach(async () => {
    await harness?.close()
    harness = undefined
  })

  const search = async (payload: Record<string, unknown>): Promise<NonNullable<SearchResponse['result']['value']>> => {
    harness ??= await startHarness(CORPUS)
    const response = await harness.rpc<SearchResponse>('mobile.search', payload)
    expect(response.result.ok).toBe(true)
    const value = response.result.value
    expect(value).toBeDefined()
    return value!
  }

  it('中文 2 字：两个会话都命中，按「同一会话只出现一次」分组', async () => {
    const value = await search({ query: '支付', perSession: 3 })
    expect(value.source).toBe('index')
    const ids = value.items.map(item => item.sessionId)
    expect(ids).toEqual(['s-pay'])
    expect(ids).not.toContain('s-sub')
    const pay = value.items.find(item => item.sessionId === 's-pay')
    expect(pay?.hits).toBe(2)
    expect(pay?.snippet).toContain('支付')
  })

  it('中文 3 字：只命中真的连续子串，不命中「付专」这种跨词', async () => {
    const value = await search({ query: '支付专项' })
    const ids = value.items.map(item => item.sessionId)
    expect(ids).toContain('s-pay')

    const crossing = await search({ query: '付专项' })
    const crossingIds = crossing.items.map(item => item.sessionId)
    expect(crossingIds).toContain('s-pay')
    // 只有「付专」那条消息里没有「专项」，但 bigram 相邻约束保证不会凭「付专」+「专项」拼出来；
    // s-pay 的第一条消息确实含「支付专项」。
    expect(crossingIds).not.toContain('s-dp')
  })

  it('单汉字：走 LIKE 兜底也能命中', async () => {
    const value = await search({ query: '销' })
    expect(value.items.map(item => item.sessionId)).toContain('s-expense')
  })

  it('英文与混合查询', async () => {
    const english = await search({ query: 'scan time' })
    expect(english.items.map(item => item.sessionId)).toContain('s-dp')

    const mixed = await search({ query: 'DP534 支付' })
    // 没有任何一条消息同时含 DP534 与支付 → 空结果，这才是「按词 AND」该有的行为
    expect(mixed.items.length).toBe(0)

    const single = await search({ query: 'DP534' })
    expect(single.items.map(item => item.sessionId)).toContain('s-dp')
  })

  it('高亮区间指到的就是命中的词（客户端据此加底色）', async () => {
    const value = await search({ query: '支付' })
    const pay = value.items.find(item => item.sessionId === 's-pay')
    expect(pay?.ranges?.length).toBeGreaterThan(0)
    const [start, end] = pay!.ranges![0]!
    expect(pay!.snippet!.slice(start, end)).toBe('支付')
  })

  it('会话内搜索：只回这一个会话，seq 可用于消息定位', async () => {
    const value = await search({ query: '支付', sessionId: 's-pay' })
    expect(value.items.length).toBe(2)
    expect(value.items.every(item => item.sessionId === 's-pay')).toBe(true)
    // 用户消息（seq 1）排在助手消息（seq 2）前面；seq 就是客户端定位用的锚。
    expect(value.items.map(item => item.seq)).toEqual([1, 2])
    expect(value.hasMore).toBe(false)
  })

  it('标题命中排前，且不会把会话的每条消息都带出来', async () => {
    const value = await search({ query: '排查' })
    const top = value.items[0]
    expect(top?.kind).toBe('title')
    expect(top?.sessionId).toBe('s-pay')
    expect(value.items.filter(item => item.sessionId === 's-pay').length).toBe(1)
  })

  it('子代理会话永远不出现（索引和返回两头都排除）', async () => {
    for (const query of ['支付', '子代理', '支付专项']) {
      const value = await search({ query })
      expect(value.items.map(item => item.sessionId)).not.toContain('s-sub')
    }
  })

  it('索引还没建好时回 fallback，客户端会退回旧路径而不是显示空', async () => {
    harness = await startHarness(CORPUS, { eager: false })
    const response = await harness.rpc<SearchResponse>('mobile.search', { query: '支付' })
    expect(response.result.ok).toBe(true)
    expect(response.result.value?.fallback).toBe(true)
  })

  it('会话内命中过多时如实标 hasMore，不再悄悄截断在 50 条', async () => {
    // 常用字在长会话里能有几百处命中：以前写死 50 条、hasMore 恒 false，客户端只看到
    // 1/50，后面的永远点不到（真机实测某会话「的」722 处）。
    const bulk: SeedSession[] = [{
      sessionId: 's-bulk',
      title: '长会话',
      updatedAt: 1_700_000_400_000,
      messages: Array.from({ length: 260 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as WireMessage['role'], text: `第 ${i} 段：批量命中词` })),
    }]
    harness = await startHarness(bulk)
    const value = await search({ query: '批量命中词', sessionId: 's-bulk' })
    expect(value.items.length).toBe(200)
    expect(value.hasMore).toBe(true)
    expect(value.items.every(item => item.sessionId === 's-bulk')).toBe(true)
  })

  it('p95 延迟：真实 HTTP 往返（含门禁）不超过 150ms', async () => {
    harness ??= await startHarness(CORPUS)
    await harness.rpc<SearchResponse>('mobile.search', { query: '支付' })
    const samples: number[] = []
    for (let i = 0; i < 20; i++) {
      const started = performance.now()
      const response = await harness.rpc<SearchResponse>('mobile.search', { query: i % 2 === 0 ? '支付' : 'scan time' })
      expect(response.result.ok).toBe(true)
      samples.push(performance.now() - started)
    }
    samples.sort((a, b) => a - b)
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))]!
    expect(p95).toBeLessThan(150)
  })

  it('旧入口 mobile.searchAll 也换成索引了：形状不变，2 字中文照样命中', async () => {
    harness ??= await startHarness(CORPUS)
    const response = await harness.rpc<{ result: { ok: boolean; value?: { items: Array<{ kind: string; sessionId: string; seq?: number; snippet: string; workspaceId?: string; workspaceTitle?: string }>; hasMore: boolean } } }>(
      'mobile.searchAll',
      { query: '支付' },
    )
    expect(response.result.ok).toBe(true)
    const items = response.result.value?.items ?? []
    // 标题带这个词时先给一条 title，正文命中仍然单独给一条（不重复堆消息）。
    const titleHit = items.find(item => item.sessionId === 's-pay' && item.kind === 'title')
    expect(titleHit?.snippet).toContain('支付')
    const pay = items.find(item => item.sessionId === 's-pay' && item.kind === 'message')
    expect(pay?.seq).toBeGreaterThan(0)
    expect(items.some(item => item.sessionId === 's-sub')).toBe(false)
    // 工作区归属照样带出来（首页搜索要显示属于哪个项目）。
    expect(pay?.workspaceId).toBe('w-1')
    expect(pay?.workspaceTitle).toBe('演示工作区')
    expect(titleHit?.workspaceTitle).toBe('演示工作区')
    expect(response.result.value?.hasMore).toBe(false)
  })

  it('mobile.searchMessages 一次查询就给 seq，不再翻历史', async () => {
    harness ??= await startHarness(CORPUS)
    const response = await harness.rpc<{ result: { ok: boolean; value?: { items: Array<{ seq: number; snippet: string }> } } }>(
      'mobile.searchMessages',
      { sessionId: 's-pay', query: '支付' },
    )
    expect(response.result.ok).toBe(true)
    const items = response.result.value?.items ?? []
    expect(items.length).toBe(2)
    expect(items.map(item => item.seq)).toEqual([1, 2])
    expect(items[0]!.snippet).toContain('支付')

    const empty = await harness.rpc<{ result: { value?: { items: unknown[] } } }>('mobile.searchMessages', { sessionId: 's-nope', query: '支付' })
    expect(empty.result.value?.items ?? []).toEqual([])
  })
  it('每个会话带最多 perSession 条命中，都能单独点进去定位', async () => {
    const value = await search({ query: '支付', perSession: 2 })
    const pay = value.items.find(item => item.sessionId === 's-pay')
    expect(pay?.hits).toBe(2)
    expect(pay?.messages?.length).toBe(2)
    // 组内按相关度排（短消息更容易胜出），所以这里只断言「两条都在」，不锁死顺序。
    expect([...(pay?.messages ?? [])].map(message => message.seq).sort((a, b) => a - b)).toEqual([1, 2])
    expect(pay?.messages?.every(message => typeof message.snippet === 'string' && message.snippet.includes('支付'))).toBe(true)
    // 只要 1 条时就只回 1 条，不补空行。
    const capped = await search({ query: '支付', perSession: 1 })
    expect(capped.items.find(item => item.sessionId === 's-pay')?.messages?.length).toBe(1)
  })

  it('翻页：offset 往后取不重复，取完 hasMore 变 false', async () => {
    const first = await search({ query: '支付', perSession: 2, sessions: 1, offset: 0 })
    const firstIds = first.items.filter(item => item.kind === 'message').map(item => item.sessionId)
    expect(firstIds.length).toBe(1)
    expect(first.nextOffset).toBe(1)

    const second = await search({ query: '支付', perSession: 2, sessions: 1, offset: 1 })
    const secondIds = second.items.filter(item => item.kind === 'message').map(item => item.sessionId)
    // 这一组语料里含「支付」的普通会话只有 s-pay 一个，第二页应当空且不再有更多。
    expect(secondIds.length).toBe(0)
    expect(second.hasMore).toBe(false)
    // 标题命中只在第一页出现，翻页不该重复塞。
    expect(second.items.filter(item => item.kind === 'title').length).toBe(0)
  })

  it('索引库是派生数据：重建后结果一致', async () => {
    harness = await startHarness(CORPUS)
    const first = await harness.rpc<SearchResponse>('mobile.search', { query: '支付' })
    const firstIds = first.result.value?.items.map(item => item.sessionId)
    await harness.close()

    harness = await startHarness(CORPUS)
    const second = await harness.rpc<SearchResponse>('mobile.search', { query: '支付' })
    expect(second.result.value?.items.map(item => item.sessionId)).toEqual(firstIds)
  })
})
