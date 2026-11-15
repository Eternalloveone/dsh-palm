/**
 * 交付账本（架构层，2026-11-13）：纯函数折叠、只追加不回退；渲染层只读账本、不碰 rows
 * （每次渲染从 rows 现折，行一重排卡就"一闪一闪"）。
 *
 * 身份 = `sessionId#turn`（见 {@link turnKeyOf}）：turn 号每场都从 1 起，光有 turn 号
 * 证明不了"这是这一场的第 N 轮"—— 2026-11-14 的幽灵交付卡就串在这个弱身份上。
 *
 * @module dsh-palm/mobile/session/deliveries
 */
import { dedupeById, type RenderMessage } from '../render/messages.ts'
import { toolDiffLines } from '../render/process-rows.ts'
import { isNoiseArtifact } from '../ui/delivery-noise.ts'

/** 一份交付里被显式声明的文件（`present` 语义）。 */
export interface PresentedFile {
  path: string
  description?: string
}

/** 一轮里被改动的文件（行数拿不到时留 undefined，不补 0）。 */
export interface DeliveryChange {
  path: string
  adds?: number
  dels?: number
}

/** 一轮交给用户的内容；身份 = `sessionId#turn`（强身份，跨会话不会串）。 */
export interface DeliveryRecord {
  /** 归属会话：账本按会话分槽，这条记录是"这一场"的证据。 */
  sessionId: string
  turn: number
  presented: PresentedFile[]
  changes: DeliveryChange[]
  /** 增删合计（只累加有行数的那些）。 */
  adds: number
  dels: number
  /** 去掉噪声（日志/缓存/补丁脚本）之后是否还值得给用户看。 */
  meaningful: boolean
}

/** 交付/轮次的强身份：`sessionId#turn`（turn 号**只在本场内有意义**，单用会串场）。 */
export function turnKeyOf(sessionId: string, turn: number): string {
  return `${sessionId}#${turn}`
}

/**
 * 从消息行折叠出交付账本：只记真实改动（有 diff 的写/改），同一文件取最大的一次；
 * 失败/中断的轮次不贡献。
 *
 * @param sessionId - 这一场的会话 id（每条记录都带上，读的时候按它过滤）
 * @param rows - 消息行（已去重或未去重都可以）
 * @returns 按 turn 号升序的账本
 */
export function collectDeliveries(sessionId: string, rows: readonly RenderMessage[]): DeliveryRecord[] {
  const changesByTurn = new Map<number, Map<string, DeliveryChange>>()
  const presentedByTurn = new Map<number, PresentedFile[]>()

  for (const row of dedupeById([...rows])) {
    const turn = row.turn
    if (turn === undefined) continue
    if (row.kind === 'turn') {
      // 收尾行带的产出文件：没有行数，只算"交付物"（`deliverables` = present 语义，
      // `produced` = 没声明的产出，两者都算交付，去重后进账本）。
      const presented = presentedByTurn.get(turn) ?? []
      for (const file of row.deliverables ?? []) {
        if (!presented.some(hit => hit.path === file.path)) presented.push({ path: file.path, ...(file.description === undefined ? {} : { description: file.description }) })
      }
      for (const path of row.produced ?? []) {
        if (!presented.some(file => file.path === path)) presented.push({ path })
      }
      presentedByTurn.set(turn, presented)
      continue
    }
    if (row.kind !== 'assistant') continue
    const changes = changesByTurn.get(turn) ?? new Map<string, DeliveryChange>()
    for (const tool of row.tools ?? []) {
      for (const diff of tool.view?.diffs ?? []) {
        const adds = toolDiffLines(diff.newText).length
        const dels = diff.oldText === null || diff.oldText === undefined ? 0 : toolDiffLines(diff.oldText).length
        const hit = changes.get(diff.path)
        // 同一文件可能被写好几次：取最大的一次（最终形态），不累加中间态。
        if (hit === undefined) changes.set(diff.path, { path: diff.path, adds, dels })
        else {
          hit.adds = Math.max(hit.adds ?? 0, adds)
          hit.dels = Math.max(hit.dels ?? 0, dels)
        }
      }
    }
    changesByTurn.set(turn, changes)
  }

  const turns = [...new Set([...changesByTurn.keys(), ...presentedByTurn.keys()])].sort((left, right) => left - right)
  return turns.map((turn) => {
    const changes = [...(changesByTurn.get(turn)?.values() ?? [])]
    const presented = presentedByTurn.get(turn) ?? []
    const adds = changes.reduce((sum, change) => sum + (change.adds ?? 0), 0)
    const dels = changes.reduce((sum, change) => sum + (change.dels ?? 0), 0)
    const meaningful = [...presented.map(file => file.path), ...changes.map(change => change.path)]
      .some(path => !isNoiseArtifact(path))
    return { sessionId, turn, presented, changes, adds, dels, meaningful }
  })
}

/**
 * 最后一次"值得看"的交付。
 *
 * 只认 `meaningful` 的记录：全是日志/补丁脚本的那一轮不给卡（判据在数据层，
 * 渲染层不用再判）。
 *
 * @param records - 账本
 * @param sessionId - 只认这一场的记录（串过来的别的会话一律不进卡面）
 * @returns 最后一条可展示的交付；没有时 undefined
 */
export function latestDeliveryOf(records: readonly DeliveryRecord[], sessionId: string): DeliveryRecord | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (record !== undefined && record.sessionId === sessionId && record.meaningful) return record
  }
  return undefined
}

/**
 * 卡面相位：`unknown` = 这一场"在不在跑"还没有结论（默认值，不是"没在跑"）。
 */
export type CardPhase = 'unknown' | 'running' | 'ended'

/**
 * 交付卡该不该显示（**唯一判定**，2026-11-14 重构）。
 *
 * 以前是 6 道门的与：证据链 / running / inFlight / 空列表 / 结论资格 / 行内屏蔽。
 * 每道门各在**不同时刻**为真或为假，组合态爆炸 —— 这就是"卡有时候冒、有时候闪一下"
 * 的结构原因（每发现一种坏组合就再加一道门）。
 *
 * 现在只剩一个三值相位：
 * - `unknown`（还没拿到宿主结论）→ **不画**：默认值不是"没在跑"；
 * - `running` → **不画**：跑着的时候一律不挂卡；
 * - `ended` → **画**：账本里最新一条"值得看"的交付（调用方保证已按会话过滤）。
 *
 * 空列表也不画：卡不能是屏幕上唯一有内容的东西。
 *
 * @param input - 相位、账本里最新那条交付、屏上的行数
 * @returns 是否画卡
 */
export function cardVisible(input: {
  phase: CardPhase
  delivery: DeliveryRecord | undefined
  rowCount: number
}): boolean {
  if (input.delivery === undefined) return false
  if (input.rowCount === 0) return false
  return input.phase === 'ended'
}

/**
 * 一轮交付里出现过的文件数（交付物 ∪ 改动，同一路径只算一次）。
 *
 * 合并判据要用它、而不是只数 `changes`：补读回来的真卡常常**只有交付物**（`produced`
 * 折进 presented、没有 diff 统计），只数 changes 会把"更全的那一份"判成没更全。
 */
function fileCount(record: DeliveryRecord): number {
  return new Set([
    ...record.presented.map(file => file.path),
    ...record.changes.map(change => change.path),
  ]).size
}

/**
 * 账本合并：**只追加不回退**（键 = `sessionId#turn`）。
 *
 * 已有轮次保留旧记录（历史不回写），新轮次覆盖同键（同一轮在流式里会多次产出）。
 * 这样补页/重排/缓存替换都不会让某一轮的卡"回到旧值再变新"。
 *
 * @param previous - 已持有的账本
 * @param next - 新折叠出来的账本
 * @returns 合并后的账本（升序）
 */
export function mergeDeliveries(
  previous: readonly DeliveryRecord[],
  next: readonly DeliveryRecord[],
): DeliveryRecord[] {
  const byKey = new Map<string, DeliveryRecord>()
  for (const record of previous) byKey.set(turnKeyOf(record.sessionId, record.turn), record)
  let touched = false
  for (const record of next) {
    const key = turnKeyOf(record.sessionId, record.turn)
    const old = byKey.get(key)
    // 同一轮：只在"新的更全"时替换（文件数更多或行数更多），否则保留旧的。
    if (old === undefined) { byKey.set(key, record); touched = true; continue }
    const files = fileCount(record)
    const filesOld = fileCount(old)
    const richer = files > filesOld
      || (files === filesOld && record.adds + record.dels > old.adds + old.dels)
    if (richer) { byKey.set(key, record); touched = true }
  }
  // 没有变化就返回**原引用**：effect 里 setState 同引用会被 React 跳过，
  // 否则"渲染 → effect → setState → 渲染"会无限循环（实测把卡整个熔断）。
  if (!touched) return previous as DeliveryRecord[]
  return [...byKey.values()].sort((left, right) => left.turn - right.turn)
}
