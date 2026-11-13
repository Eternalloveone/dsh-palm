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
import { MAX_ENTRY_WINDOW_BYTES, nextEntryWindowBytes, readChatTailPage, readSessionLogTailPage, resetLogPathCache } from './mobile-log-source.ts'

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

/**
 * 首屏一次取够：折出来的行数不够目标时，宿主把尾窗翻四倍重读。
 *
 * 真实数字（2026-11-13）：客户端要 120 行，保守设备的窗口是 512 KB，长会话里
 * 512 KB 只折得出个位数行 —— 剩下的交给客户端补页，屏幕上就是"先一张交付卡、
 * 正文随后长出来"。扩窗之后一次请求就够，客户端那条补页链退化成老宿主的兜底。
 */
describe('nextEntryWindowBytes（首屏扩窗判据）', () => {
  it('行数够：不重读（多数会话走这一条，不能每次都多解一次文件）', () => {
    expect(nextEntryWindowBytes({ rows: 120, maxRows: 120, windowBytes: 512 * 1024, atFileStart: false })).toBeUndefined()
  })

  it('行数不够且日志还有更早的内容：翻四倍', () => {
    expect(nextEntryWindowBytes({ rows: 4, maxRows: 120, windowBytes: 512 * 1024, atFileStart: false })).toBe(MAX_ENTRY_WINDOW_BYTES)
  })

  it('已经读到文件开头：再宽也不会多出行，不重读', () => {
    expect(nextEntryWindowBytes({ rows: 4, maxRows: 120, windowBytes: 512 * 1024, atFileStart: true })).toBeUndefined()
  })

  it('已到上限：不重读（宁可让客户端补页，也不在一次首屏里解 8 MB）', () => {
    expect(nextEntryWindowBytes({ rows: 4, maxRows: 120, windowBytes: MAX_ENTRY_WINDOW_BYTES, atFileStart: false })).toBeUndefined()
    expect(nextEntryWindowBytes({ rows: 4, maxRows: 120, windowBytes: MAX_ENTRY_WINDOW_BYTES / 2, atFileStart: false })).toBe(MAX_ENTRY_WINDOW_BYTES)
  })
})

/** 写一份"多行"日志：header + 每条一个 zstd 帧（模拟真实写盘格式）。 */
function writeManyRows(name: string, rows: number): void {
  const path = join(sessionDir, name)
  const lines: string[] = [JSON.stringify({ type: 'session', seq: 0, data: { id: 's-1' } })]
  for (let index = 1; index <= rows; index += 1) {
    lines.push(JSON.stringify({
      type: 'user/message',
      seq: index,
      time: index * 1_000,
      data: { text: '第' + index + '条消息：' + '内容'.repeat(8) },
    }))
  }
  const frames = lines.map(line => zstdCompressSync(Buffer.from(`${line}\n`, 'utf8')))
  writeFileSync(path, Buffer.concat(frames))
}

/**
 * 首屏扩窗端到端（2026-11-13）：窗口字节不够时，宿主按"要多少行"自己补。
 *
 * 客户端要 120 行，而它按"先快出内容"只给 512 KB 的窗口；长会话里这点窗口只装得下
 * 个位数行，剩下的交给客户端补页 → 用户看到"先一张交付卡、正文随后长出来"。
 * 修法在宿主：折出来的行数不够就翻四倍重读，一次请求就把行数给够。
 */
describe('首屏扩窗端到端', () => {
  it('窗口只够几行时，仍然按 maxRows 返回足够的行', async () => {
    writeManyRows('session.v1.jsonl.zstd', 80)
    // 4 KB 的窗口只装得下十来帧：这是"客户端保守窗口"的极端形态。
    const narrow = await readChatTailPage('s-1', 60, 4 * 1024)
    expect(narrow).toBeDefined()
    // 扩窗之后必须够（80 行里最多给 60 行，由 maxRows 截断）。
    expect((narrow?.rows.length ?? 0) >= 60).toBe(true)
  })

  it('行数本来就够时不多读：窗口足够大就直接返回', async () => {
    writeManyRows('session.v1.jsonl.zstd', 12)
    const page = await readChatTailPage('s-1', 12, 1024 * 1024)
    expect(page?.rows.length).toBeGreaterThan(0)
    // 整个文件才 12 行，读到底就该停（readFrom = 0，不再扩窗）。
    const raw = await readSessionLogTailPage('s-1', { windowBytes: 1024 * 1024 })
    expect(raw?.readFrom ?? -1).toBe(0)
  })
})
