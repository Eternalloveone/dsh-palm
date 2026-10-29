/**
 * 会话日志尾部读取的行为测试。
 *
 * 这些用例用真实的 zstd 帧构造文件（zstdCompressSync，与写入端一样开 checksum），
 * 因此覆盖的是格式本身，而不是 mock 出来的帧结构。重点盯三类边界：
 * 窗口起点落在帧中间、末尾有并发写留下的半帧、以及尾部窗口找不到帧时的翻倍重试。
 */

import { mkdtemp, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { constants as zlibConstants, zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { readSessionLogTail } from '../src/session-log-tail.ts'
import { needsReportInjection } from '../src/mobile-log-source.ts'

// 与真实写入端一致：每帧都带 4 字节 checksum，这样 walker 的帧尾计算才会被覆盖到。
const ZSTD_WITH_CHECKSUM = {
  params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 },
}

interface EncodedFrame {
  bytes: Buffer
  text: string
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** 把若干行压成一帧，同时记录逐字节等价的明文，便于直接比较。 */
function encodeFrame(lines: readonly string[]): EncodedFrame {
  const text = lines.map(line => `${line}\n`).join('')
  const bytes = zstdCompressSync(Buffer.from(text, 'utf8'), ZSTD_WITH_CHECKSUM)
  return { bytes, text }
}

/** 不带 checksum 的帧（Node 默认，也是当前 DSH 真实会话日志的写法）。 */
function encodeFrameWithoutChecksum(lines: readonly string[]): EncodedFrame {
  const text = lines.map(line => `${line}\n`).join('')
  const bytes = zstdCompressSync(Buffer.from(text, 'utf8'))
  return { bytes, text }
}

/** 写一个临时日志文件，返回路径与写入的总字节数。 */
async function writeLog(chunks: readonly Buffer[]): Promise<{ path: string; size: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-session-tail-'))
  tempDirs.push(dir)
  const path = join(dir, 'session.v1.jsonl.zstd')
  const file = Buffer.concat(chunks)
  await writeFile(path, file)
  return { path, size: file.length }
}

/** 生成一次 append 的内容：1~3 条 JSONL 行，中文用来确认跨帧 UTF-8 解码安全。 */
function turnLines(turn: number, lineCount: number): string[] {
  return Array.from({ length: lineCount }, (_, line) =>
    JSON.stringify({ seq: turn * 10 + line, kind: 'message', text: `第 ${turn} 轮第 ${line} 行` }))
}

describe('readSessionLogTail', () => {
  it('reads a small 2-frame log back byte for byte', async () => {
    const header = encodeFrame([JSON.stringify({ type: 'session', version: 1, sessionId: 'session-1' })])
    const firstTurn = encodeFrame(turnLines(1, 2))
    const { path, size } = await writeLog([header.bytes, firstTurn.bytes])

    // 确认测试输入真的走了 checksum 分支，否则 walker 的 +4 校验形同虚设。
    expect((header.bytes.readUInt8(4) & 0x04) !== 0).toBe(true)

    const result = await readSessionLogTail(path)
    expect(result.text).toBe(header.text + firstTurn.text)
    expect(result.frames).toBe(2)
    expect(result.from).toBe(0)
    expect(result.to).toBe(size)
    expect(result.size).toBe(size)
    expect(result.tornTail).toBe(false)
  })

  it('walks a chain that mixes checksummed and plain frames', async () => {
    // checksum 是每帧的 descriptor 位，不是文件级约定；walker 必须逐帧看这一位。
    const plain = encodeFrameWithoutChecksum(turnLines(1, 1))
    const checked = encodeFrame(turnLines(2, 1))
    expect((plain.bytes.readUInt8(4) & 0x04) !== 0).toBe(false)
    expect((checked.bytes.readUInt8(4) & 0x04) !== 0).toBe(true)

    const { path, size } = await writeLog([plain.bytes, checked.bytes])
    const result = await readSessionLogTail(path)

    expect(result.text).toBe(plain.text + checked.text)
    expect(result.frames).toBe(2)
    expect(result.to).toBe(size)
    expect(result.tornTail).toBe(false)
  })

  it('returns only the last maxFrames frames in order', async () => {
    const frames = Array.from({ length: 20 }, (_, index) => encodeFrame(turnLines(index, (index % 3) + 1)))
    const offsets: number[] = []
    let offset = 0
    for (const frame of frames) {
      offsets.push(offset)
      offset += frame.bytes.length
    }
    const { path, size } = await writeLog(frames.map(frame => frame.bytes))

    const result = await readSessionLogTail(path, { maxFrames: 5 })
    const expectedText = frames.slice(15).map(frame => frame.text).join('')

    expect(result.text).toBe(expectedText)
    expect(result.frames).toBe(5)
    expect(result.from).toBe(offsets[15])
    expect(result.to).toBe(size)
    expect(result.tornTail).toBe(false)

    // 行不丢不重：解出来的行数等于最后 5 帧写入的行数。
    expect(result.text.split('\n').filter(Boolean)).toHaveLength(
      frames.slice(15).reduce((count, frame) => count + frame.text.split('\n').filter(Boolean).length, 0),
    )
  })

  it('drops the half frame cut by a window that starts mid-frame', async () => {
    const frames = Array.from({ length: 6 }, (_, index) => encodeFrame(turnLines(index, 2)))
    const { path, size } = await writeLog(frames.map(frame => frame.bytes))

    const last = frames[5]
    const previous = frames[4]
    if (last === undefined || previous === undefined) throw new Error('test fixture is incomplete')
    // 窗口 = 最后一帧 + 前一帧的一半：起点必然落在前一帧内部，而不是帧边界上。
    const windowBytes = last.bytes.length + Math.floor(previous.bytes.length / 2)
    const windowStart = size - windowBytes
    const previousStart = size - last.bytes.length - previous.bytes.length
    expect(windowStart).toBeGreaterThan(previousStart)
    expect(windowStart).toBeLessThan(previousStart + previous.bytes.length)

    const result = await readSessionLogTail(path, { windowBytes })
    expect(result.text).toBe(last.text)
    expect(result.frames).toBe(1)
    expect(result.from).toBe(size - last.bytes.length)
    expect(result.to).toBe(size)
    expect(result.tornTail).toBe(false)
  })

  it('discards a torn tail and keeps the complete frames', async () => {
    const complete = [
      encodeFrame(turnLines(1, 1)),
      encodeFrame(turnLines(2, 2)),
      encodeFrame(turnLines(3, 1)),
    ]
    const partial = encodeFrame(turnLines(4, 2))
    const { path } = await writeLog([...complete.map(frame => frame.bytes), partial.bytes])

    // 模拟一次写到一半就被读到的 append：把完整帧写进去后截掉尾部几个字节。
    const truncatedBytes = 5
    const statBefore = await stat(path)
    await truncate(path, statBefore.size - truncatedBytes)

    const result = await readSessionLogTail(path)
    const expectedCompleteBytes = complete.reduce((total, frame) => total + frame.bytes.length, 0)

    expect(result.tornTail).toBe(true)
    expect(result.text).toBe(complete.map(frame => frame.text).join(''))
    expect(result.frames).toBe(3)
    // 半帧的起点在最后一个完整帧之后：to 停在完整内容的末尾。
    expect(result.to).toBe(expectedCompleteBytes)
    expect(result.to).toBeLessThan(result.size)
  })

  it('rejects an empty log', async () => {
    const { path } = await writeLog([])
    await expect(readSessionLogTail(path)).rejects.toThrow()
  })

  it('rejects a missing log', async () => {
    const missing = join(tmpdir(), `dsh-session-tail-missing-${process.pid}-${Date.now()}.zstd`)
    await expect(readSessionLogTail(missing)).rejects.toThrow()
  })

  it('keeps frames / from / to / size self-consistent', async () => {
    const frames = Array.from({ length: 6 }, (_, index) => encodeFrame(turnLines(index, 1)))
    const offsets: number[] = []
    let offset = 0
    for (const frame of frames) {
      offsets.push(offset)
      offset += frame.bytes.length
    }
    const { path, size } = await writeLog(frames.map(frame => frame.bytes))

    const result = await readSessionLogTail(path, { maxFrames: 3 })
    const statAfter = await stat(path)

    expect(result.frames).toBe(3)
    expect(result.from).toBe(offsets[3])
    expect(result.from).toBeLessThanOrEqual(result.to)
    expect(result.to).toBe(size)
    expect(result.size).toBe(statAfter.size)
    expect(result.size).toBe(size)
  })

  it('widens a too-small window until a frame boundary appears', async () => {
    const frames = Array.from({ length: 4 }, (_, index) => encodeFrame(turnLines(index, 1)))
    const { path, size } = await writeLog(frames.map(frame => frame.bytes))
    const last = frames[3]
    if (last === undefined) throw new Error('test fixture is incomplete')

    // 1 字节窗口必然落在最后一帧内部，找不到帧边界；实现必须自己翻倍，
    // 直到窗口能装下末尾这一整帧（不会越界返回空结果）。
    const result = await readSessionLogTail(path, { windowBytes: 1 })
    expect(result.text).toBe(last.text)
    expect(result.frames).toBe(1)
    expect(result.from).toBe(size - last.bytes.length)
    expect(result.from).toBeGreaterThan(0)
    expect(result.to).toBe(size)
    expect(result.tornTail).toBe(false)
  })
})

describe('needsReportInjection：尾页要不要补读交付卡', () => {
  const rows = [{ kind: 'assistant', turn: 7 }]
  const base = { newestTurn: 7, turnOpen: false as boolean | undefined, rows, now: 1_000_000 }

  it('收工了、页里没卡、还没补过 → 要补', () => {
    expect(needsReportInjection(base)).toBe(true)
  })

  it('页里已经有这一轮的卡 → 不补', () => {
    expect(needsReportInjection({ ...base, rows: [...rows, { kind: 'turn', turn: 7 }] })).toBe(false)
  })

  it('这一轮还在跑 → 不补（别给一张过期的卡）', () => {
    expect(needsReportInjection({ ...base, turnOpen: true })).toBe(false)
    // 边界不明（undefined）也当在跑
    expect(needsReportInjection({ ...base, turnOpen: undefined })).toBe(false)
  })

  it('刚补过同一轮 → TTL 内不再补（尾页是轮询的，不能每次都多读 240 帧）', () => {
    expect(needsReportInjection({ ...base, cached: { turn: 7, at: base.now - 1_000 } })).toBe(false)
    // TTL 过了就再试一次
    expect(needsReportInjection({ ...base, cached: { turn: 7, at: base.now - 120_000 } })).toBe(true)
  })

  it('缓存是上一轮的 → 不影响这一轮补卡', () => {
    expect(needsReportInjection({ ...base, cached: { turn: 6, at: base.now } })).toBe(true)
  })
})

describe('needsReportInjection 的口径（补卡/补计划共用一次补读）', () => {
  const rows = [{ kind: 'assistant', turn: 9 }]
  const base = { newestTurn: 9, turnOpen: false as boolean | undefined, rows, now: 2_000_000 }

  it('页里已经有这一轮的卡：不补卡', () => {
    expect(needsReportInjection({ ...base, rows: [...rows, { kind: 'turn', turn: 9 }] })).toBe(false)
  })

  it('还在跑：不补（宁可这一轮收工后再补）', () => {
    expect(needsReportInjection({ ...base, turnOpen: true })).toBe(false)
  })

  it('刚补过同一轮：TTL 内不再补读', () => {
    expect(needsReportInjection({ ...base, cached: { turn: 9, at: base.now - 5_000 } })).toBe(false)
    expect(needsReportInjection({ ...base, cached: { turn: 9, at: base.now - 120_000 } })).toBe(true)
  })
})
