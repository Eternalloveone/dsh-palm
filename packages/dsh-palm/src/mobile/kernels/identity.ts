/**
 * Identity 内核：一行的**逻辑身份**（W2-1）。
 *
 * 一条消息在手机上会从四个入口进来：实时帧、宿主历史页、本地缓存快照、重放/导出。
 * 四个入口给同一行东西的 `id`、`seq` 往往不一样（缓存页与网络页各算各的），
 * 只要身份按 id/seq 算，同一行就会被当成两行——历史上的"每行出现两遍"
 * （16 个 id 各 2 份）、"同一轮两张过程卡"都是这个根因。
 *
 * 这里把身份收敛成一条规则（master plan W2-1 的四条不变量）：
 *
 * 1. 身份只由 `turn`、`step`、`occurrence` 决定，**与数组下标无关**；
 * 2. 四个入口的同一逻辑行 → 同一个 key；
 * 3. 缺轮号的助手行在**入口处**补轮号（{@link normalizeTurnNumbers}），之后才谈身份；
 * 4. 合并入口只有一个（`messages.ts` 的 `preferRicherRows`），组件不得自行去重。
 *
 * @module dsh-palm/mobile/kernels/identity
 */

/**
 * 内核需要的**最小**行形状。
 *
 * 刻意不 import `RenderMessage`：那个类型住在 3,000 行的 messages.ts 里，一旦
 * import（哪怕只是 type），静态分析就会认定 `messages → kernels → messages` 成环，
 * 架构断言直接红。结构化声明反而更严格 —— 内核只认它真正读的字段。
 */
export interface IdentifiableRow {
  readonly kind: string
  readonly id: string
  readonly turn?: number
  readonly step?: number
  readonly seq?: number
  readonly startSeq?: number
  readonly pending?: boolean
}

/**
 * 一行的稳定身份。形如 `t3.2`（第 3 轮第 2 步）、`t3~`（第 3 轮未分步）、
 * `turn3`（轮次交付卡）、`s120` / `ss118`（只有 seq 的极早期行）、`idxxx`（兜底）。
 */
export type RowKey = string

/**
 * 一行的逻辑身份（**不是** id、**不是** seq）。
 *
 * 身份必须"在流式过程中保持不变"：
 *   · 交付卡按轮唯一（它可能和本轮最后一条助手行共享 seq，先认轮号才不会并进正文）；
 *   · 有 (turn, step) 就按它 —— 宿主折叠、实时帧、缓存快照给的都是这个位置；
 *   · 有 turn 但还没分步（流式早期）：按"本轮的未分步行"算一个身份，**不能按 seq**，
 *     否则每个 chunk 都换身份，同一条消息会被当成一串新行（重复的过程条正是这么来的）；
 *   · 连 turn 都没有（极早期）：才退 seq / startSeq，最后退 id。
 */
export function rowKey(row: IdentifiableRow): RowKey {
  if (row.kind === 'turn' && row.turn !== undefined) return `turn${row.turn}`
  if (row.turn !== undefined && row.step !== undefined) return `t${row.turn}.${row.step}`
  if (row.turn !== undefined && row.pending === true) return `t${row.turn}~`
  if (typeof row.seq === 'number' && Number.isFinite(row.seq)) return `s${row.seq}`
  if (typeof row.startSeq === 'number' && Number.isFinite(row.startSeq)) return `ss${row.startSeq}`
  return `id${row.id}`
}

/**
 * 入口补轮号：没有 `turn` 的助手行沿用上一条带轮号的助手行，遇到用户行即清空。
 *
 * 必须在**参与身份判定之前**做：四个入口里只有宿主页带轮号，实时帧早期没有；
 * 不先补齐，同一行在两边算出来的 key 不一致，去重就漏。
 *
 * 没有需要补的行时返回**原数组**（保持引用，避免多余重渲染）。
 */
export function normalizeTurnNumbers<T extends IdentifiableRow>(rows: readonly T[]): readonly T[] {
  let carried: number | undefined
  let out: T[] | undefined
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!
    if (row.kind === 'user') {
      carried = undefined
      continue
    }
    if (row.kind !== 'assistant') continue
    if (row.turn !== undefined) {
      carried = row.turn
      continue
    }
    if (carried === undefined) continue
    if (out === undefined) out = rows.slice()
    out[i] = { ...row, turn: carried }
  }
  return out ?? rows
}
