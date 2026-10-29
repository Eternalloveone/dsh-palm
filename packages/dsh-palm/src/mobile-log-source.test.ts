// @vitest-environment node
/**
 * 会话日志定位缓存：日志会换代（session.v1 → v2 → …），旧代文件不会消失、只是不再写入。
 * 只按 sessionId 缓存路径、只检查「文件还在不在」，就会一直读旧代 —— 手机上表现为
 * 「桌面还在跑、手机停在半小时前」。这里钉住两条：缓存有效期内不重复扫目录，
 * 过期后必须重新定位到新的一代。
 *
 * 日志本体是「裸拼接的 zstd 帧序列」（每 append 一行就写一整帧），所以夹具也按帧写。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { readChatTailPage, readSessionLogTailPage, resetLogPathCache } from './mobile-log-source.ts'

let root = ''
let sessionDir = ''

/** 写一代日志（header + 一帧事件），每行一个 zstd 帧。 */
function writeGeneration(name: string, seq: number, secondsAgo: number): void {
  const path = join(sessionDir, name)
  const lines = [
    JSON.stringify({ type: 'session', seq: 0, data: { id: 's-1' } }),
    JSON.stringify({ type: 'user/message', seq, time: seq * 1_000, data: { text: String(seq) } }),
  ]
  const frames = lines.map(line => zstdCompressSync(Buffer.from(`${line}\n`, 'utf8')))
  writeFileSync(path, Buffer.concat(frames))
  // 显式给 mtime：定位按「最近写入」挑代，测试不能靠两个文件创建时间的偶然先后。
  const at = new Date(Date.now() - secondsAgo * 1_000)
  utimesSync(path, at, at)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-palm-log-'))
  sessionDir = join(root, 'sessions', 'bucket-a', 's-1')
  mkdirSync(sessionDir, { recursive: true })
  process.env.DSH_HOME = root
  resetLogPathCache()
})

afterEach(() => {
  delete process.env.DSH_HOME
  rmSync(root, { recursive: true, force: true })
  resetLogPathCache()
})

describe('log path cache', () => {
  it('reads the newest generation and re-locates once the cache expires', async () => {
    writeGeneration('session.v1.jsonl.zstd', 5, 60)
    const first = await readSessionLogTailPage('s-1', { now: 0 })
    expect(first?.maxSeq).toBe(5)

    // 宿主换代：新的一代写得更新，旧代留着当存档（不会消失）。
    writeGeneration('session.v2.jsonl.zstd', 40, 0)

    // 缓存有效期内仍读旧代：这是刻意保留的代价（每 60 秒才扫一次目录）。
    const cached = await readSessionLogTailPage('s-1', { now: 59_000 })
    expect(cached?.maxSeq).toBe(5)

    // 过期后必须重新定位，否则新事件永远看不到。
    const relocated = await readSessionLogTailPage('s-1', { now: 60_001 })
    expect(relocated?.maxSeq).toBe(40)
  })

  it('forgets the cached path when the file disappears', async () => {
    writeGeneration('session.v1.jsonl.zstd', 7, 60)
    expect((await readSessionLogTailPage('s-1', { now: 0 }))?.maxSeq).toBe(7)
    // 会话被清理后又新建：旧路径已经不存在，缓存里的它必须作废。
    rmSync(sessionDir, { recursive: true, force: true })
    mkdirSync(sessionDir, { recursive: true })
    writeGeneration('session.v1.jsonl.zstd', 9, 0)
    expect((await readSessionLogTailPage('s-1', { now: 1_000 }))?.maxSeq).toBe(9)
  })
})

describe('尾页折叠：turn/start 被挤出窗口时，收工用时按日志里的真起点算', () => {
  /** 写一整段事件（每行一个 zstd 帧）。 */
  function writeEvents(events: Array<Record<string, unknown>>): void {
    const lines = [
      JSON.stringify({ type: 'session', seq: 0, data: { id: 's-1' } }),
      ...events.map(event => JSON.stringify(event)),
    ]
    const frames = lines.map(line => zstdCompressSync(Buffer.from(`${line}\n`, 'utf8')))
    writeFileSync(join(sessionDir, 'session.v1.jsonl.zstd'), Buffer.concat(frames))
  }

  const T0 = 1_700_000_000_000
  /** 一轮跑了 300 秒、中途 60 条 chunk：尾页 48 帧只装得下后半段。 */
  function longTurnEvents(options: { keepStart: boolean }): Array<Record<string, unknown>> {
    const events: Array<Record<string, unknown>> = []
    let seq = 1
    if (options.keepStart) events.push({ type: 'turn/start', seq: seq++, time: T0, data: { turn: 2 } })
    for (let step = 0; step < 60; step += 1) {
      events.push({
        type: 'assistant/chunk',
        seq: seq++,
        time: T0 + step * 5_000,
        data: { turn: 2, step: 0, chunk: { type: 'text-delta', index: 0, text: `第${step}段` } },
      })
    }
    events.push({ type: 'turn/end', seq: seq++, time: T0 + 300_000, data: { turn: 2, reason: { kind: 'completed' } } })
    return events
  }

  it('真起点在日志里：用时等于 turn/end 减 turn/start，不是减窗口最早一行', async () => {
    writeEvents(longTurnEvents({ keepStart: true }))
    const page = await readChatTailPage('s-1')
    const row = page?.rows.filter(candidate => candidate.kind === 'assistant').at(-1)
    expect(row?.durationMs).toBe(300_000)
    expect(row?.turnStartAt).toBe(T0)
  })

  it('日志里根本没有 turn/start 时退回窗口最早一行（兜底，不是 0/空）', async () => {
    writeEvents(longTurnEvents({ keepStart: false }))
    const page = await readChatTailPage('s-1')
    const row = page?.rows.filter(candidate => candidate.kind === 'assistant').at(-1)
    // 48 帧窗口里最早的一行：第 12 段左右（300s − 60s 上下），只要求"有值且比真值短"。
    expect(row?.durationMs).toBeGreaterThan(0)
    expect(row?.durationMs).toBeLessThan(300_000)
  })

  it('补回来的起点也当边界用：不然卡片没有"已跑"，过程框还以为收工了', async () => {
    // 一轮还在跑（turn/end 没来），turn/start 已经被 48 帧窗口切在外面。
    writeEvents(longTurnEvents({ keepStart: true }).filter(event => event['type'] !== 'turn/end'))
    const page = await readChatTailPage('s-1')
    expect(page?.turnOpen).toBe(true)
    expect(page?.turnStartAt).toBe(T0)
  })

  it('窗口里最后一条边界是上一轮的 turn/end、但它之后还有事件：判成新一轮在跑', async () => {
    // 真机现场：新一轮跑了三十多步，turn/start 被切出去，窗口里只剩上一轮的 turn/end。
    // 以前只认那条 end → "没在跑" → 命令还在跑，过程框写着已完成。
    const events: Array<Record<string, unknown>> = [
      { type: 'turn/start', seq: 1, time: T0, data: { turn: 1 } },
      { type: 'user/message', seq: 2, time: T0 + 1_000, data: { text: '第一条' } },
      { type: 'turn/end', seq: 3, time: T0 + 60_000, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    // 第二轮：turn/start 故意不写（等价于被窗口切掉），只有 60 条工具事件。
    for (let step = 0; step < 60; step += 1) {
      events.push({
        type: 'tool/call',
        seq: 4 + step,
        time: T0 + 70_000 + step * 1_000,
        data: { turn: 2, step: 0, callId: `c${step}`, name: 'pwsh', arguments: '{"command":"pnpm test"}' },
      })
    }
    writeEvents(events)
    const page = await readChatTailPage('s-1')
    expect(page?.turnOpen).toBe(true)
    expect(page?.lastEventAt).toBe(T0 + 70_000 + 59_000)
  })

  it('收工后只有记账事件（job/settled 之类）时不算新一轮在跑', async () => {
    // 否则"刚跑完"的会话会被自己收尾写的记账事件点亮成"还在跑"。
    const events: Array<Record<string, unknown>> = [
      { type: 'turn/start', seq: 1, time: T0, data: { turn: 1 } },
      { type: 'user/message', seq: 2, time: T0 + 1_000, data: { text: '跑一下' } },
      { type: 'turn/end', seq: 3, time: T0 + 60_000, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'job/registered', seq: 4, time: T0 + 61_000, data: { jobId: 'j1' } },
      { type: 'job/settled', seq: 5, time: T0 + 62_000, data: { jobId: 'j1' } },
      { type: 'agent/inbox/spliced', seq: 6, time: T0 + 63_000, data: {} },
    ]
    writeEvents(events)
    const page = await readChatTailPage('s-1')
    expect(page?.turnOpen).toBe(false)
  })
})
