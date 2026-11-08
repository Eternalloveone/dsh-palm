/**
 * 「已插入本轮」补充消息的**纯状态层**（唯一事实源的第一层）。
 *
 * 为什么要有它（2026-11-08 真机）：
 *  - 输入框上方的插入条一会儿出现、一会儿消失。旧实现把「宿主快照里没有这一条」
 *    直接当成「这条没了」，而宿主的 inbox 投影本来就慢半拍（弱网/大日志时更明显），
 *    于是条子凭空消失，过一会儿又被下一份快照画回来；
 *  - 同一件事会画成两行（`Agent …` 与 `Background subagent …`）。两类来源都进了
 *    next-step，旧的渲染按行逐条画，既不合并也没有稳定身份。
 *
 * 这里定的规矩（与桌面端 QueueDock 的教训一致）：
 *  1. **按 id 取并集**。宿主快照里看不到，只说明这一拍没看见，不代表删除；
 *  2. **只有回执能删**：`consumedIds`（已消费成对话里的用户消息）或
 *     `withdrawnIds`（用户撤回）才会让条目退场；
 *  3. **身份是 `(turnNo, source, id)`**：同一条事件重复到达是幂等的；
 *     轮号变大时旧轮整体退场，不会把上一轮的残留带进新轮；
 *  4. **去抖只影响显示，不影响事实**：出现立即显示；消失要连续 2 次确认并跨过
 *     600ms 窗口；任何条目至少显示 800ms。事实仍在，下一次出现会立即回来。
 *
 * 全部纯函数、`now` 可注入，不 import 任何数据层/视图层模块。
 *
 * @module dsh-palm/mobile/session/insert-queue
 */

/** 插入来源：用户自己插的话 / 智能体消息 / 后台任务通知。 */
export type InsertSource = 'user' | 'agent' | 'job'

/** 一条「已插入本轮」的补充消息（不可变投影）。 */
export interface InsertEntry {
  /** 宿主 message id；本地乐观项用 `local-insert-` 前缀。 */
  id: string
  /** 被插入的轮号（同一轮内的条目才能放在一条摘要里）。 */
  turnNo: number
  source: InsertSource
  /** 展示用正文（宿主改写过的正文也照收，身份不靠正文）。 */
  text: string
  /** 首次进入队列的本地时刻（epoch ms）。 */
  at: number
}

/** 去抖用的可见性元数据（与条目分开存，删条目时一起清）。 */
export interface InsertVisibility {
  /** 条目第一次出现的时刻：最短可见窗口从这里算。 */
  readonly shownAt: Readonly<Record<string, number>>
  /** 连续「这一次快照里没有它」的观察次数。 */
  readonly missingCount: Readonly<Record<string, number>>
  /** 这一串缺失观察的起点（去抖窗口从这里算）。 */
  readonly missingSince: Readonly<Record<string, number>>
}

/** `visibleInserts` 的输入：事实（entries） + 去抖元数据。 */
export interface InsertState extends Partial<InsertVisibility> {
  readonly entries: readonly InsertEntry[]
  readonly turnNo: number
}

/** 一次合并的删除回执。**只有这里列出的 id 会被移除。** */
export interface InsertReceipts {
  /** 已经被这一轮消费（对话里出现了对应的用户消息）。 */
  readonly consumedIds?: Iterable<string>
  /** 用户主动撤回（或本地删除）成功。 */
  readonly withdrawnIds?: Iterable<string>
}

/** 消失需要连续确认的次数。 */
export const INSERT_HIDE_CONFIRMATIONS = 2
/** 两次确认之间至少跨过的去抖窗口（毫秒）。 */
export const INSERT_HIDE_CONFIRM_MS = 600
/** 任何条目至少可见的时长（毫秒）。 */
export const INSERT_MIN_VISIBLE_MS = 800

/** 摘要里 source 的固定顺序（用户 → 智能体 → 后台任务）。 */
export const INSERT_SOURCE_ORDER: readonly InsertSource[] = ['user', 'agent', 'job']

/** source 的展示名（卡片/明细共用，避免两处各写一套文案）。 */
export const INSERT_SOURCE_LABELS: Readonly<Record<InsertSource, string>> = {
  user: '你',
  agent: '智能体',
  job: '后台任务',
}

/** 摘要里一组来源的明细数据。 */
export interface InsertSummaryGroup {
  readonly source: InsertSource
  readonly label: string
  readonly count: number
  readonly entries: readonly InsertEntry[]
}

/** 折叠摘要 + 展开明细需要的数据（渲染层不再自己数数）。 */
export interface InsertSummary {
  readonly total: number
  /** 折叠行文案；空队列为空串（界面据此不出摘要）。 */
  readonly title: string
  readonly groups: readonly InsertSummaryGroup[]
  readonly entries: readonly InsertEntry[]
}

const AGENT_KINDS: ReadonlySet<string> = new Set(['agent-message', 'team-message'])
const JOB_KINDS: ReadonlySet<string> = new Set([
  'subagent-settled', 'tool-jobs', 'cordis-host-runner', 'schedule', 'webhook', 'goal',
])

/**
 * 宿主 `source.kind` → 插入来源。
 *
 * 认不出的一律返回 `undefined`：`compact-checkpoint` / `agent-instructions` /
 * `skill-catalog` / `runtime-context` 这些注入是**看不见的噪音**，不该占一条摘要。
 */
export function insertSourceOfKind(kind: string | undefined): InsertSource | undefined {
  if (kind === undefined || kind === '' || kind === 'user') return 'user'
  if (AGENT_KINDS.has(kind)) return 'agent'
  if (JOB_KINDS.has(kind)) return 'job'
  return undefined
}

/** 身份键：`(turnNo, source, id)`；同 id 在不同轮/来源下是不同条目。 */
export function insertKey(entry: InsertEntry): string {
  return `${entry.turnNo}|${entry.source}|${entry.id}`
}

function maxTurn(list: readonly InsertEntry[]): number {
  let max = 0
  for (const entry of list) if (entry.turnNo > max) max = entry.turnNo
  return max
}

function byTimeThenId(left: InsertEntry, right: InsertEntry): number {
  return left.at - right.at || left.id.localeCompare(right.id)
}

/**
 * 按 id 取并集（唯一合并入口）。
 *
 * - `next` 里看不到 `prev` 的条目 → **保留**（宿主快照不是删除回执）；
 * - 只有 `consumedIds` / `withdrawnIds` 里列出的 id 会消失；
 * - 同 `(turnNo, source, id)` 重复出现只保留一条（后到的正文不覆盖先到的，
 *   身份相同就该是同一条，正文差异只是宿主改写）；
 * - 任一侧出现更大的 `turnNo` 时，只保留那一轮（旧轮整体退场）。
 */
export function mergeInserts(
  prev: readonly InsertEntry[],
  next: readonly InsertEntry[],
  receipts: InsertReceipts = {},
): InsertEntry[] {
  const removed = new Set<string>([
    ...(receipts.consumedIds ?? []),
    ...(receipts.withdrawnIds ?? []),
  ])
  const turnNo = Math.max(maxTurn(prev), maxTurn(next))
  const kept = new Map<string, InsertEntry>()
  for (const entry of [...prev, ...next]) {
    if (removed.has(entry.id)) continue
    // 轮号变大只保留新轮；更小的轮号是迟到事件，不许把新轮挤掉。
    if (entry.turnNo !== turnNo) continue
    const key = insertKey(entry)
    if (!kept.has(key)) kept.set(key, entry)
  }
  return [...kept.values()].sort(byTimeThenId)
}

/**
 * 记一次「这一拍宿主快照里有哪些条目」。
 *
 * `presentIds` 是**这一拍**看到的 id 集合；没看到的条目累计 missingCount，
 * 并在下一次观察时把 missingSince 保留为这一串缺失的起点。再次看到即清零
 * （出现立即恢复，不用等去抖）。
 */
export function observeInsertPresence(
  previous: InsertVisibility | undefined,
  entries: readonly InsertEntry[],
  presentIds: Iterable<string>,
  now: number,
): InsertVisibility {
  const present = new Set(presentIds)
  const shownAt: Record<string, number> = {}
  const missingCount: Record<string, number> = {}
  const missingSince: Record<string, number> = {}
  for (const entry of entries) {
    shownAt[entry.id] = previous?.shownAt[entry.id] ?? entry.at ?? now
    if (present.has(entry.id)) continue
    missingCount[entry.id] = (previous?.missingCount[entry.id] ?? 0) + 1
    missingSince[entry.id] = previous?.missingSince[entry.id] ?? now
  }
  return { shownAt, missingCount, missingSince }
}

/** 去抖参数（测试可注入；默认值就是产品参数）。 */
export interface InsertVisibilityOptions {
  readonly hideConfirmMs?: number
  readonly minVisibleMs?: number
}

/**
 * 这一拍该显示哪些条目（**只影响显示，不影响事实**）。
 *
 * 出现立即显示；消失要同时满足：连续 2 次没看到 + 距离第一次没看到已过
 * `hideConfirmMs`（默认 600ms）；且从出现起至少 `minVisibleMs`（默认 800ms）。
 * 任何一条不满足都继续显示 —— 宁可多挂一会儿，也不要闪。
 */
export function visibleInserts(
  state: InsertState,
  now: number,
  options: InsertVisibilityOptions = {},
): readonly InsertEntry[] {
  const hideConfirmMs = options.hideConfirmMs ?? INSERT_HIDE_CONFIRM_MS
  const minVisibleMs = options.minVisibleMs ?? INSERT_MIN_VISIBLE_MS
  const shownAt = state.shownAt ?? {}
  const missingCount = state.missingCount ?? {}
  const missingSince = state.missingSince ?? {}
  return state.entries.filter((entry) => {
    const firstShown = shownAt[entry.id] ?? entry.at
    if (now - firstShown < minVisibleMs) return true
    if ((missingCount[entry.id] ?? 0) < INSERT_HIDE_CONFIRMATIONS) return true
    const absentSince = missingSince[entry.id]
    return absentSince !== undefined && now - absentSince < hideConfirmMs
  })
}

/**
 * 摘要：同一轮内 agent/job 合并成**一条**「已插入 N 条补充消息」。
 *
 * `groups` 仍按 source 分开（展开明细时每一行要知道自己是谁），但 `total` 与
 * `title` 是整个人群共用的 —— 渲染层因此不可能画出两行标题。
 */
export function summarizeInserts(list: readonly InsertEntry[]): InsertSummary {
  const entries = [...list].sort(byTimeThenId)
  const groups: InsertSummaryGroup[] = []
  for (const source of INSERT_SOURCE_ORDER) {
    const items = entries.filter(entry => entry.source === source)
    if (items.length === 0) continue
    groups.push({
      source,
      label: INSERT_SOURCE_LABELS[source],
      count: items.length,
      entries: items,
    })
  }
  const total = entries.length
  return {
    total,
    title: total === 0 ? '' : `已插入 ${total} 条补充消息`,
    groups,
    entries,
  }
}

/** 正文归一：只折叠空白，避免「多一个空格」就认不出同一条本地乐观项。 */
export function normalizeInsertText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
