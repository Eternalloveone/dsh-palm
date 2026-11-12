/**
 * 两段文本 → 行级 diff（hunk 视图的真源）。
 *
 * 为什么手机端自己算：宿主给的 diff 卡只有 `{ path, oldText, newText }`（整份新旧文本），
 * 而桌面端看到的是**按 hunk 裁剪过**的差异。以前手机把"旧文件全文涂红 + 新文件全文涂绿"
 * 一起摊出来，改一行要滑过整份文件 —— 用户 2026-11-10 反馈"只能只读、看不出改了什么"。
 *
 * 口径：
 * - 先剥掉公共前后缀（真实改动通常很小，剥完只剩几十行）；
 * - 中段用 LCS 求最小编辑（上限 `maxCells`，超了退回"全删 + 全增"的粗粒度结果，
 *   宁可糙也不在手机上算到卡死）；
 * - 每段改动前后留 `context` 行上下文，段与段之间插一行 `…`；
 * - 行数超 `maxRows` 就截断并在末尾补一行 `…`（避免一次渲染上万行）。
 *
 * 纯函数、无 React、无 IO：渲染层只负责把行的三种 kind 画成颜色。
 *
 * @module dsh-palm/mobile/render/line-diff
 */

/** 一行差异：上下文 / 新增 / 删除；`skip` 是两段之间的省略号（不是真实文本）。 */
export interface LineDiffRow {
  readonly kind: 'ctx' | 'add' | 'del' | 'skip'
  readonly text: string
}

/** 计算选项。 */
export interface LineDiffOptions {
  /** 每段改动前后保留的上下文行数（缺省 3）。 */
  readonly context?: number
  /** 最多返回多少行（缺省 300，超出截断）。 */
  readonly maxRows?: number
  /** 单侧文本超过多少行就放弃精确比对（缺省 1500）。 */
  readonly maxLines?: number
  /** LCS 单元上限（缺省 250_000 ≈ 500×500，超了走粗粒度）。 */
  readonly maxCells?: number
}

/** 按行切分；尾部换行不算一行。 */
function linesOf(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 粗粒度兜底：旧全文删、新全文增（不猜哪里没变）。 */
function coarse(oldLines: readonly string[], newLines: readonly string[]): LineDiffRow[] {
  return [
    ...oldLines.map(text => ({ kind: 'del' as const, text })),
    ...newLines.map(text => ({ kind: 'add' as const, text })),
  ]
}

/** LCS 表 → 编辑序列（只在中段用，且受 `maxCells` 约束）。 */
function lcsRows(before: readonly string[], after: readonly string[]): LineDiffRow[] {
  const n = before.length
  const m = after.length
  const table: Uint32Array = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number): number => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[at(i, j)] = before[i] === after[j]
        ? table[at(i + 1, j + 1)]! + 1
        : Math.max(table[at(i + 1, j)]!, table[at(i, j + 1)]!)
    }
  }
  const rows: LineDiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      rows.push({ kind: 'ctx', text: before[i]! })
      i++
      j++
    } else if (table[at(i + 1, j)]! >= table[at(i, j + 1)]!) {
      rows.push({ kind: 'del', text: before[i]! })
      i++
    } else {
      rows.push({ kind: 'add', text: after[j]! })
      j++
    }
  }
  while (i < n) { rows.push({ kind: 'del', text: before[i]! }); i++ }
  while (j < m) { rows.push({ kind: 'add', text: after[j]! }); j++ }
  return rows
}

/**
 * 计算两段文本的行级差异。
 *
 * @param oldText - 旧文本（新建文件传空串）
 * @param newText - 新文本（删除文件传空串）
 * @param options - 上下文行数、行数与计算量上限
 * @returns 按出现顺序排好的差异行（可能含 `skip` 省略行）
 */
export function lineDiffRows(oldText: string, newText: string, options: LineDiffOptions = {}): LineDiffRow[] {
  const context = Math.max(0, Math.round(options.context ?? 3))
  const maxRows = Math.max(1, Math.round(options.maxRows ?? 300))
  const maxLines = Math.max(1, Math.round(options.maxLines ?? 1500))
  const maxCells = Math.max(1, Math.round(options.maxCells ?? 250_000))

  const before = linesOf(oldText)
  const after = linesOf(newText)
  if (before.length > maxLines || after.length > maxLines) {
    return coarse(before, after).slice(0, maxRows)
  }

  // 剥公共前后缀：真实改动通常只占几行，剥完 LCS 的规模才有意义。
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (
    tail < before.length - head
    && tail < after.length - head
    && before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) tail++

  const midBefore = before.slice(head, before.length - tail)
  const midAfter = after.slice(head, after.length - tail)
  const mid = midBefore.length === 0 && midAfter.length === 0
    ? []
    : midBefore.length * midAfter.length > maxCells
      ? coarse(midBefore, midAfter)
      : lcsRows(midBefore, midAfter)

  const all: LineDiffRow[] = [
    ...before.slice(0, head).map(text => ({ kind: 'ctx' as const, text })),
    ...mid,
    ...before.slice(before.length - tail).map(text => ({ kind: 'ctx' as const, text })),
  ]

  // 只保留改动附近的上下文：先按「改动块」折叠（连续的 del/add 算一块），再各留 context 行。
  // 逐行扩窗会把 del 与它后面的 add 当成两处改动，窗口多扩一份 —— 上下文就从 2 行变 3 行了。
  const keep = new Array<boolean>(all.length).fill(false)
  let changed = 0
  for (let start = 0; start < all.length;) {
    if (all[start]!.kind === 'ctx') { start++; continue }
    changed++
    let end = start
    while (end + 1 < all.length && all[end + 1]!.kind !== 'ctx') end++
    for (let k = Math.max(0, start - context); k <= Math.min(all.length - 1, end + context); k++) keep[k] = true
    start = end + 1
  }
  // 整份文件没变：不画 diff（调用方据此整块跳过，而不是显示一行省略号）。
  if (changed === 0) return []
  const rows: LineDiffRow[] = []
  let skipped = false
  for (let index = 0; index < all.length; index++) {
    if (keep[index] === true) {
      rows.push(all[index]!)
      skipped = false
    } else if (!skipped) {
      rows.push({ kind: 'skip', text: '…' })
      skipped = true
    }
  }
  if (rows.length <= maxRows) return rows
  return [...rows.slice(0, maxRows - 1), { kind: 'skip', text: '…' }]
}
