/**
 * **seq 域体检**：冷启动落页那一刻，「宿主页的行」和「客户端实时折线」是不是同一个 seq 域。
 *
 * 为什么要它（2026-11-16，冷启动偶发「同一轮两条过程条」）：那一现象只在两套 seq 编号
 * 混进同一张表时才成立 —— 三层去重（同 turn+step / 共享 callId / seq 区间重叠）全部依赖
 * seq 可比，域一旦错开就全都认不出；检测器用的是同一批判据，于是**既重复又不上报**，
 * 磁盘上只剩一条 `stream-lag`，看不出域在哪一环错开。
 *
 * 这里只做一件事：把落页那一刻的几个数（页水位、行首尾 seq、折线水位、被水位跳过的帧）
 * 量出来，**可疑时**上报 `seq-domain`；正常时只写 `window.__palmSeqDomain` 供探针读基线，
 * 不写盘（否则每开一个会话一条报告，真现场会被淹掉）。
 *
 * 判定只看「域」，不看内容（内容层交给 `findDuplicateCards`）：
 * - `domain-mismatch`：页里的行 seq 超过页自己声明的水位（两份数据不同源）；
 * - `watermark-short`：折完的水位低于行尾 seq（旧帧会被再应用一次 → 同一批事件折两遍）；
 * - `buffered-beyond`：缓冲帧在水位之上却没进折线（该到的行丢了）。
 *
 * @module dsh-palm/mobile/render/seq-domain
 */

/** 判定只读这些字段（行只要 seq / 轮号，不依赖完整 RenderMessage）。 */
interface SeqReadable {
  readonly seq: number
  readonly kind?: string
  readonly turn?: number | undefined
}

/** 落页的折线（EventFolder 的结构子集）。 */
interface FoldSnapshotSource {
  readonly lastSeq: number
  readonly lastFoldSkipped: number
  snapshot(): readonly SeqReadable[]
}

/** 一次落页交给体检的全部输入。 */
export interface SeqDomainInput {
  /** `cache` = IndexedDB 缓存页；`entry` = 宿主首屏快照。 */
  source: 'cache' | 'entry'
  sessionId: string
  /** 页自称的事件水位（宿主折叠时给的 maxSeq）。 */
  hostMaxSeq: number | undefined
  /** 页给的原始行（判 seq 首尾）。 */
  pageRows: readonly SeqReadable[]
  /** 刚落好的那份折线。 */
  folder: FoldSnapshotSource
  /** 落页那一刻还没折进去的实时帧。 */
  buffered: readonly { readonly seq: number }[]
  /** 探针通道（缺省时只留内存快照）。 */
  report?: ((probe: string, detail: Record<string, unknown>) => void | Promise<unknown>) | undefined
}

/** 体检结论。 */
export type SeqDomainVerdict = 'ok' | 'domain-mismatch' | 'watermark-short' | 'buffered-beyond'

/** 结论 + 上报明细。 */
export interface SeqDomainReading {
  verdict: SeqDomainVerdict
  detail: Record<string, unknown>
}

/** 上一份折线的水位：冷启动「缓存页 → 网络页」那一步就靠它对照。 */
const lastFolderSeq = new Map<string, number>()
/** 已上报过的「来源 + 结论」：同一场同一种异常只报一次。 */
const reported = new Map<string, Set<string>>()

/** 行 seq 的首尾（空列表给 undefined）。 */
function seqSpan(rows: readonly SeqReadable[]): { first: number | undefined; last: number | undefined } {
  if (rows.length === 0) return { first: undefined, last: undefined }
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    if (row.seq < first) first = row.seq
    if (row.seq > last) last = row.seq
  }
  return { first, last }
}

/** 折线里「同一轮出现多条助手行」的轮号（直接对应「同一轮两条过程条」）。 */
function multiRowTurns(rows: readonly SeqReadable[]): number[] {
  const counts = new Map<number, number>()
  for (const row of rows) {
    if (row.kind !== 'assistant' || row.turn === undefined) continue
    counts.set(row.turn, (counts.get(row.turn) ?? 0) + 1)
  }
  const out: number[] = []
  for (const [turn, count] of counts) {
    if (count > 1) out.push(turn)
  }
  return out.sort((left, right) => left - right)
}

/**
 * 只判「域」。
 * @param input - 落页输入
 * @param previousSeq - 替换前那份折线的水位
 * @returns 结论与上报明细
 */
export function seqDomainOf(input: SeqDomainInput, previousSeq: number | undefined): SeqDomainReading {
  const rows = seqSpan(input.pageRows)
  const buffered = seqSpan(input.buffered)
  const folderSeq = input.folder.lastSeq
  const verdict: SeqDomainVerdict = input.hostMaxSeq !== undefined && rows.last !== undefined
      && rows.last > input.hostMaxSeq
    ? 'domain-mismatch'
    : rows.last !== undefined && folderSeq < rows.last
      ? 'watermark-short'
      : input.hostMaxSeq !== undefined && buffered.last !== undefined
          && buffered.last > input.hostMaxSeq && folderSeq < buffered.last
        ? 'buffered-beyond'
        : 'ok'
  return {
    verdict,
    detail: {
      source: input.source,
      sessionId: input.sessionId,
      hostMaxSeq: input.hostMaxSeq ?? null,
      pageRowsCount: input.pageRows.length,
      pageRowsFirstSeq: rows.first ?? null,
      pageRowsLastSeq: rows.last ?? null,
      previousSeq: previousSeq ?? null,
      folderSeq,
      skipped: input.folder.lastFoldSkipped,
      bufferedCount: input.buffered.length,
      bufferedFirstSeq: buffered.first ?? null,
      bufferedLastSeq: buffered.last ?? null,
      multiRowTurns: multiRowTurns(input.folder.snapshot()),
    },
  }
}

/**
 * 体检一次落页：可疑就上报，正常只留内存快照。
 * @param input - 落页输入
 */
export function noteSeqDomain(input: SeqDomainInput): void {
  const previousSeq = lastFolderSeq.get(input.sessionId)
  lastFolderSeq.set(input.sessionId, input.folder.lastSeq)
  const { verdict, detail } = seqDomainOf(input, previousSeq)
  // 探针读得到、用户看不到，也不进错误目录。
  ;(globalThis as { __palmSeqDomain?: unknown }).__palmSeqDomain = { ...detail, verdict }
  if (verdict === 'ok' || input.report === undefined) return
  const key = `${input.source}:${verdict}`
  const seen = reported.get(input.sessionId) ?? new Set<string>()
  if (seen.has(key)) return
  seen.add(key)
  reported.set(input.sessionId, seen)
  void input.report('seq-domain', { ...detail, verdict })
}

/** 测试用：忘掉已上报记录与上一份水位。 */
export function resetSeqDomainForTest(): void {
  lastFolderSeq.clear()
  reported.clear()
  delete (globalThis as { __palmSeqDomain?: unknown }).__palmSeqDomain
}
