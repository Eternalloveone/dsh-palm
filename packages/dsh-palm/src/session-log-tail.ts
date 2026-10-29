/**
 * 会话日志尾部读取：从 session.v<N>.jsonl.zstd 里只解最后几帧。
 *
 * 该文件是裸拼接的 zstd 帧序列，帧外没有长度前缀也没有分隔符；每次 append 写一整帧
 * （一批以 \n 结尾的 JSONL 行）并 fsync，所以文件天然 append-only。想在手机上读
 * “最近几条”，按行倒着扫不可行，只能先按 zstd 帧结构把尾部窗口切成帧，再逐帧解压。
 *
 * 读取策略与边界：
 * - 先 stat 拿 size，只读末尾 windowBytes 字节，绝不为了取尾部而读整个文件；
 * - 窗口起点常落在某帧中间，那一小段半帧丢弃，从下一个结构可信的帧开始；
 * - 读到尾部时可能正好赶上一次 append 写到一半，walker 走到文件末尾就截断，
 *   丢弃这半帧并置 tornTail；
 * - 窗口里一个帧起点都找不到（窗口比一帧还小，或起点落在超长帧内部）时窗口翻倍
 *   重试，最终退回整文件读取，避免静默返回空结果。
 */

import type { FileHandle } from 'node:fs/promises'
import { open } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'

/** zstd 帧 magic 的小端整数值：字节序列 28 B5 2F FD。 */
const ZSTD_MAGIC = 0xfd2fb528
const DEFAULT_WINDOW_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_FRAMES = 64
/**
 * Block_Size 在规范里不超过 min(Window_Size, 128 KiB)。这里不还原 Window_Size，
 * 只用 128 KiB 这个全局上限：随机字节被误当成帧头时，块长几乎必然超过它。
 */
const MAX_BLOCK_BYTES = 128 * 1024
/** magic(4) + descriptor(1) + 一个 block header(3)。短于它不可能是一整帧。 */
const MIN_FRAME_BYTES = 8

export interface TailFrame {
  start: number
  end: number
}

export interface TailReadResult {
  /** 解出来的明文，按原始顺序拼好，末尾保留原始 `\n`。 */
  text: string
  /** 实际解开的帧数。 */
  frames: number
  /** 这批帧覆盖的字节区间。 */
  from: number
  to: number
  /** 文件大小（读取时的 stat）。 */
  size: number
  /** 尾部有半帧（并发写导致）时为 true，已自动丢弃。 */
  tornTail: boolean
}

export interface TailReadOptions {
  /** 最多往回读多少字节的尾部窗口（默认 4 MiB）。 */
  windowBytes?: number
  /** 最多解多少帧（默认 64）。 */
  maxFrames?: number
}

/** 一次 walk 的结果：end 只在 truncated 为 false 时可信。 */
interface FrameWalk {
  /** 帧尾（不包含），窗口内相对偏移。 */
  end: number
  /** 窗口/文件在帧中间就结束了。 */
  truncated: boolean
}

/** 从某个可信起点一路走到底得到的一串帧（窗口内相对偏移）。 */
interface Chain {
  starts: number[]
  ends: number[]
  tornTail: boolean
}

/**
 * 按 zstd 帧结构走一帧。
 *
 * 返回 null 表示“结构非法”（保留位、保留块类型、块长越界），返回 truncated 表示
 * “字节不够” —— 两者必须分开：前者说明这个起点大概率是假 magic，要换下一个候选；
 * 后者只可能是文件末尾的半帧，此时应丢弃它而不是报错。
 *
 * 所有越界都靠 limit 预判：Buffer.readUInt32LE 越界会直接抛 RangeError，而窗口里
 * 的帧头/块头长度都是变长的，不能假定任何一个可选字段一定存在。
 */
function walkFrame(buf: Buffer, start: number, limit: number): FrameWalk | null {
  // 连最短的帧头都放不下，只能是半帧。
  if (start + MIN_FRAME_BYTES > limit) return { end: 0, truncated: true }
  if (buf.readUInt32LE(start) !== ZSTD_MAGIC) return null

  const descriptor = buf.readUInt8(start + 4)
  // bit3(0x08) 与 bit4(0x10) 是规范保留位，写入端必须置 0；非零只可能是误命中。
  if ((descriptor & 0x18) !== 0) return null

  const singleSegment = (descriptor & 0x20) !== 0
  const hasChecksum = (descriptor & 0x04) !== 0
  const dictIdFlag = descriptor & 0x03
  const contentSizeFlag = descriptor >>> 6

  let position = start + 5
  // Window_Descriptor 只在非 Single_Segment 帧里出现。
  if (!singleSegment) {
    if (position + 1 > limit) return { end: 0, truncated: true }
    position += 1
  }
  // Dict_ID_Flag：0/1/2 字节数等于 flag，3 表示 4 字节。
  const dictIdBytes = dictIdFlag === 3 ? 4 : dictIdFlag
  if (position + dictIdBytes > limit) return { end: 0, truncated: true }
  position += dictIdBytes
  // Frame_Content_Size 长度是 1<<flag；flag==0 时只有 Single_Segment 才有 1 字节。
  const contentSizeBytes = contentSizeFlag === 0
    ? (singleSegment ? 1 : 0)
    : 1 << contentSizeFlag
  if (position + contentSizeBytes > limit) return { end: 0, truncated: true }
  position += contentSizeBytes

  for (;;) {
    if (position + 3 > limit) return { end: 0, truncated: true }
    const blockHeader = buf.readUInt8(position)
      | (buf.readUInt8(position + 1) << 8)
      | (buf.readUInt8(position + 2) << 16)
    position += 3
    const lastBlock = (blockHeader & 0x01) === 1
    const blockType = (blockHeader >>> 1) & 0x03
    const blockSize = blockHeader >>> 3

    if (blockType === 3) return null
    // 块长超过 zstd 的硬上限：这个“帧头”是压缩数据里的巧合字节。
    if (blockSize > MAX_BLOCK_BYTES) return null
    // RLE 块解压后是 blockSize 个重复字节，但线上载荷固定 1 字节。
    const payloadBytes = blockType === 1 ? 1 : blockSize
    if (position + payloadBytes > limit) return { end: 0, truncated: true }
    position += payloadBytes
    if (lastBlock) break
  }

  // checksum 是逐帧的 descriptor 位，不是文件级约定：有的写入端开启、有的不开启，
  // 所以只信这一位，绝不硬编码“帧尾固定多 4 字节”。
  if (hasChecksum) {
    if (position + 4 > limit) return { end: 0, truncated: true }
    position += 4
  }
  return { end: position, truncated: false }
}

/** 在 [from, limit) 里找下一个 magic 首字节，找不到返回 -1。 */
function findMagic(buf: Buffer, from: number, limit: number): number {
  const lastStart = limit - 4
  for (let index = from; index <= lastStart; index += 1) {
    // 先比首字节，避免对每个字节位置都做一次 4 字节读取。
    if (buf.readUInt8(index) !== 0x28) continue
    if (buf.readUInt32LE(index) === ZSTD_MAGIC) return index
  }
  return -1
}

/**
 * 解压候选帧，确认它确实是一批完整行。
 *
 * 只靠结构校验不够：压缩数据本身接近随机字节，偶然拼出 magic + 合法帧头并非不可能，
 * 一旦采信就会把垃圾当会话内容返回。会话日志每帧都是完整 JSONL 行，必然以 \n 收尾，
 * 所以“能解压且末字节是换行”才把候选升级为可信起点。空帧正常写入端不会产生，同样
 * 按不可信处理。
 */
function decodesToSessionLines(frame: Buffer): boolean {
  try {
    const decoded = zstdDecompressSync(frame)
    return decoded.length > 0 && decoded[decoded.length - 1] === 0x0a
  } catch {
    return false
  }
}

/**
 * 从可信起点顺序走完全部帧。
 *
 * 走到 truncated 就是文件末尾的半帧：记录 tornTail 并停在这里。走到结构非法则说明
 * 起点有问题（或文件中间损坏），返回 null 让外层换下一个候选，不能在不确定的边界上
 * 继续解压。
 */
function walkChain(window: Buffer, start: number, limit: number): Chain | null {
  const starts: number[] = []
  const ends: number[] = []
  let position = start
  let tornTail = false
  while (position < limit) {
    const walked = walkFrame(window, position, limit)
    if (walked === null) return null
    if (walked.truncated) {
      tornTail = true
      break
    }
    starts.push(position)
    ends.push(walked.end)
    position = walked.end
  }
  if (starts.length === 0) return null
  return { starts, ends, tornTail }
}

/** 在窗口里正向找第一个“结构合法且解压结果像会话日志”的帧，再从它顺序走到底。 */
function findChain(window: Buffer): Chain | null {
  const limit = window.length
  let scan = 0
  while (scan + 4 <= limit) {
    const candidate = findMagic(window, scan, limit)
    if (candidate < 0) return null
    const first = walkFrame(window, candidate, limit)
    if (
      first !== null
      && !first.truncated
      && decodesToSessionLines(window.subarray(candidate, first.end))
    ) {
      const chain = walkChain(window, candidate, limit)
      if (chain !== null) return chain
    }
    // 这个候选不成立，从它的下一个字节继续找；窗口起点落在帧中间时正是靠这一步跳过半帧。
    scan = candidate + 1
  }
  return null
}

/** 读满一个窗口；文件在读取期间缩短就视为读失败。 */
async function readWindow(handle: FileHandle, start: number, length: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)
  let filled = 0
  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, start + filled)
    if (bytesRead === 0) throw new Error('session log shrank while reading the tail window')
    filled += bytesRead
  }
  return buffer
}

/**
 * 读取会话日志尾部并解出最后几帧。
 *
 * 文件不存在、为空、读取失败时抛错：调用方需要区分“没有日志”和“日志里没有内容”，
 * 静默返回空结果会把这两种情况混在一起。
 */
export async function readSessionLogTail(
  path: string,
  options: TailReadOptions = {},
): Promise<TailReadResult> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    if (size === 0) throw new Error(`session log is empty: ${path}`)

    const windowOption = options.windowBytes
    const maxFramesOption = options.maxFrames
    let windowBytes = windowOption !== undefined && Number.isFinite(windowOption) && windowOption >= 1
      ? Math.floor(windowOption)
      : DEFAULT_WINDOW_BYTES
    const maxFrames = maxFramesOption !== undefined && Number.isFinite(maxFramesOption) && maxFramesOption >= 1
      ? Math.floor(maxFramesOption)
      : DEFAULT_MAX_FRAMES

    for (;;) {
      const windowSize = Math.min(windowBytes, size)
      const windowStart = size - windowSize
      const window = await readWindow(handle, windowStart, windowSize)
      const chain = findChain(window)

      if (chain !== null) {
        // 只解最后 maxFrames 帧：先按帧边界切片，再逐帧解压。帧边界一定是行边界，
        // 所以逐帧 toString('utf8') 不会把多字节字符切断。
        const firstKept = Math.max(0, chain.starts.length - maxFrames)
        const keptStarts = chain.starts.slice(firstKept)
        const keptEnds = chain.ends.slice(firstKept)
        const firstRel = keptStarts[0]
        const lastRel = keptEnds[keptEnds.length - 1]
        if (firstRel === undefined || lastRel === undefined) {
          throw new Error(`session log has no readable frame: ${path}`)
        }

        const parts: string[] = []
        for (let index = 0; index < keptStarts.length; index += 1) {
          const frameStart = keptStarts[index]
          const frameEnd = keptEnds[index]
          if (frameStart === undefined || frameEnd === undefined) {
            throw new Error(`session log frame boundary is inconsistent: ${path}`)
          }
          parts.push(zstdDecompressSync(window.subarray(frameStart, frameEnd)).toString('utf8'))
        }

        return {
          text: parts.join(''),
          frames: keptStarts.length,
          from: windowStart + firstRel,
          to: windowStart + lastRel,
          size,
          tornTail: chain.tornTail,
        }
      }

      // 窗口里连一个可信帧起点都没有：窗口起点落在超长帧内部，或窗口比一帧还小。
      // 翻倍重试；整文件都试过仍无解才算失败，绝不返回空结果。
      if (windowStart === 0) throw new Error(`no complete zstd frame found in session log: ${path}`)
      windowBytes = Math.min(size, windowBytes * 2)
    }
  } finally {
    await handle.close()
  }
}
