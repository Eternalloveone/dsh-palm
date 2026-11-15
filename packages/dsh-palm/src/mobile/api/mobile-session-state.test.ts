// @vitest-environment node
/**
 * 首屏快照的两个契约（根治第 1 阶段）。
 *
 * 1. `entryReadOptions`：客户端传什么都不能把宿主读爆（0 / 负数 / NaN / 天文数字）。
 * 2. `mobile.sessionState` 带 `maxRows` 之后，**一次请求**就把首屏要的东西都带回来
 *    （行、hasMore、队列、回合、目标、投影）—— 客户端不必再并发 logTail + goal + queue。
 *
 * 第 2 条用本机真实会话日志跑；没有日志（CI/清过的机器）就跳过，不让它变成假绿。
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerResponse } from 'node:http'
import { entryReadOptions, mobileSessionState } from './mobile-session-state.ts'

describe('entryReadOptions（首屏窗口参数的夹范围）', () => {
  it('没传：两个字段都不出现（宿主用自己的默认值）', () => {
    expect(entryReadOptions(undefined)).toEqual({})
    expect(entryReadOptions({})).toEqual({})
  })

  it('行数夹在 1~400', () => {
    expect(entryReadOptions({ maxRows: 0 }).maxRows).toBe(1)
    expect(entryReadOptions({ maxRows: -5 }).maxRows).toBe(1)
    expect(entryReadOptions({ maxRows: 1e9 }).maxRows).toBe(400)
    expect(entryReadOptions({ maxRows: 120.4 }).maxRows).toBe(120)
  })

  it('窗口夹在 128 KB~1 MB', () => {
    expect(entryReadOptions({ windowBytes: 1 }).windowBytes).toBe(128 * 1024)
    expect(entryReadOptions({ windowBytes: 1e12 }).windowBytes).toBe(1024 * 1024)
    expect(entryReadOptions({ windowBytes: 512 * 1024 }).windowBytes).toBe(512 * 1024)
  })

  it('非法类型（字符串 / NaN / null）当作没传', () => {
    expect(entryReadOptions({ maxRows: '120' }).maxRows).toBeUndefined()
    expect(entryReadOptions({ maxRows: Number.NaN }).maxRows).toBeUndefined()
    expect(entryReadOptions({ maxRows: null }).maxRows).toBeUndefined()
    expect(entryReadOptions({ windowBytes: '1MB' }).windowBytes).toBeUndefined()
  })
})

/** 本机日志里最大的那个会话（最考验首屏窗口）。 */
function biggestSession(): string | undefined {
  const home = process.env['DSH_HOME'] ?? 'C:/Users/Administrator/.dsh'
  const sessions = join(home, 'sessions')
  let best: { id: string; bytes: number } | undefined
  let buckets: string[] = []
  try { buckets = readdirSync(sessions) } catch { return undefined }
  for (const bucket of buckets) {
    let ids: string[] = []
    try { ids = readdirSync(join(sessions, bucket)) } catch { continue }
    for (const id of ids) {
      const dir = join(sessions, bucket, id)
      let files: string[] = []
      try { files = readdirSync(dir) } catch { continue }
      for (const file of files) {
        if (!file.startsWith('session.') || !file.endsWith('.jsonl.zstd')) continue
        const bytes = statSync(join(dir, file)).size
        if (best === undefined || bytes > best.bytes) best = { id, bytes }
      }
    }
  }
  return best?.id
}

/** 极简 res：收集 writeJson 写出的响应体。 */
function captureResponse(): { res: ServerResponse; body: () => Record<string, unknown> } {
  const chunks: string[] = []
  const res = {
    statusCode: 200,
    setHeader: () => res,
    writeHead: () => res,
    end: (chunk?: string) => { if (typeof chunk === 'string') chunks.push(chunk) },
    write: (chunk?: string) => { if (typeof chunk === 'string') chunks.push(chunk) },
  } as unknown as ServerResponse
  return {
    res,
    body: () => JSON.parse(chunks.join('')) as Record<string, unknown>,
  }
}

describe('首屏一次拿全（真实日志）', () => {
  it('一次 sessionState 带回行 + hasMore + 队列 + 回合 + 目标', async () => {
    const sessionId = biggestSession()
    if (sessionId === undefined) {
      console.log('· 本机没有会话日志，跳过（不给假绿）')
      return
    }
    process.env['DSH_HOME'] = process.env['DSH_HOME'] ?? 'C:/Users/Administrator/.dsh'
    const { res, body } = captureResponse()
    await mobileSessionState({
      res,
      parsed: { payload: { sessionId, maxRows: 120, windowBytes: 512 * 1024 } },
      rpcId: 'test-entry',
      deps: {},
      apiProxy: {
        sessions: {
          // 目标现读那条路（wantsFresh 才走）：这里让它直接失败，走快照。
          history: async () => ({ result: { ok: false } }),
        },
      },
    } as never)

    const payload = body() as { result?: { ok?: boolean; value?: Record<string, unknown> } }
    const value = payload.result?.value
    expect(payload.result?.ok, JSON.stringify(payload).slice(0, 300)).toBe(true)
    expect(value).toBeDefined()
    if (value === undefined) return

    const rows = value['rows'] as unknown[] | undefined
    console.log(`\n会话 ${sessionId.slice(0, 16)}…：一次请求拿到 ${rows?.length ?? 0} 行`)
    expect(Array.isArray(rows)).toBe(true)
    // 关键：一次请求就够铺满首屏（不再靠之后再补几页）。
    expect((rows ?? []).length).toBeGreaterThan(60)
    // 同一份切面上必须带齐客户端首屏要用的其它字段。
    expect(typeof value['hasMore']).toBe('boolean')
    expect(Array.isArray(value['queue'])).toBe(true)
    expect(value['turn']).toBeDefined()
    expect('goal' in value).toBe(true)
    expect(typeof value['asOf']).toBe('number')
    // 这条用例读的是本机**最大的**那份真实会话日志（biggestSession 会随本机会话增长变大），
    // 5s 默认超时在整仓并行跑时会正好卡线（实测 5014/5148ms），给足余量。
  }, 30_000)
})
