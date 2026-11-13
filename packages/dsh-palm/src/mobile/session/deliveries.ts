/**
 * 交付账本（架构层，2026-11-13）。
 *
 * 病根：交付信息以前是**每次渲染从 rows 临时折**出来的（`changesByTurn`），
 * 行被合并/重排/短暂重建时它就跟着变 —— 于是卡"一闪一闪""有时候又消失"。
 *
 * 这里把它做成桌面端 `workspace/changes` 同构的东西：以 **turn 号为身份**的账本，
 * 纯函数折叠、只追加不回退。渲染层只读账本，不再碰 rows。
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

/** 一轮交给用户的内容；身份 = turn 号（稳定，不随渲染重排变化）。 */
export interface DeliveryRecord {
  turn: number
  presented: PresentedFile[]
  changes: DeliveryChange[]
  /** 增删合计（只累加有行数的那些）。 */
  adds: number
  dels: number
  /** 去掉噪声（日志/缓存/补丁脚本）之后是否还值得给用户看。 */
  meaningful: boolean
}

/**
 * 从消息行折叠出交付账本。
 *
 * 规则与宿主侧的 `workspace/changes` 对齐：**只记真实改动**（有 diff 的写/改），
 * 同一文件被写多次取最大的一次（最终形态），失败/中断的轮次不贡献。
 *
 * @param rows - 消息行（已去重或未去重都可以）
 * @returns 按 turn 号升序的账本
 */
export function collectDeliveries(rows: readonly RenderMessage[]): DeliveryRecord[] {
  const changesByTurn = new Map<number, Map<string, DeliveryChange>>()
  const presentedByTurn = new Map<number, PresentedFile[]>()

  for (const row of dedupeById([...rows])) {
    const turn = row.turn
    if (turn === undefined) continue
    if (row.kind === 'turn') {
      // 收尾行带的产出文件：没有行数，只算"交付物"。
      // `deliverables` 是 present 语义（桌面端的 deliverables/presented 事件折进来的），
      // `produced` 是没有声明的产出 —— 两者都算交付，去重后进账本。
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
    return { turn, presented, changes, adds, dels, meaningful }
  })
}

/**
 * 最后一次"值得看"的交付。
 *
 * 只认 `meaningful` 的记录：全是日志/补丁脚本的那一轮不给卡（判据在数据层，
 * 渲染层不用再判）。
 *
 * @param records - 账本
 * @returns 最后一条可展示的交付；没有时 undefined
 */
export function latestDeliveryOf(records: readonly DeliveryRecord[]): DeliveryRecord | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (record !== undefined && record.meaningful) return record
  }
  return undefined
}

/**
 * 一轮交付里出现过的文件数（交付物 ∪ 改动，同一路径只算一次）。
 *
 * 合并判据要用它、而不是只数 `changes`：日志补读回来的真卡常常**只有交付物**
 * （`produced` 折进 presented，没有 diff 统计），只数 changes 会把"更全的那一份"
 * 判成没更全，于是补读到的文件永远上不了卡（真机：卡片少列文件、补读白读）。
 */
function fileCount(record: DeliveryRecord): number {
  return new Set([
    ...record.presented.map(file => file.path),
    ...record.changes.map(change => change.path),
  ]).size
}

/**
 * 账本合并：**只追加不回退**。
 *
 * 已有轮次保留旧记录（历史不回写），新轮次覆盖同号（同一轮在流式里会多次产出）。
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
  const byTurn = new Map<number, DeliveryRecord>()
  for (const record of previous) byTurn.set(record.turn, record)
  let touched = false
  for (const record of next) {
    const old = byTurn.get(record.turn)
    // 同一轮：只在"新的更全"时替换（文件数更多或行数更多），否则保留旧的。
    if (old === undefined) { byTurn.set(record.turn, record); touched = true; continue }
    const files = fileCount(record)
    const filesOld = fileCount(old)
    const richer = files > filesOld
      || (files === filesOld && record.adds + record.dels > old.adds + old.dels)
    if (richer) { byTurn.set(record.turn, record); touched = true }
  }
  // 没有变化就返回**原引用**：effect 里 setState 同引用会被 React 跳过，
  // 否则"渲染 → effect → setState → 渲染"会无限循环（实测把卡整个熔断）。
  if (!touched) return previous as DeliveryRecord[]
  return [...byTurn.values()].sort((left, right) => left.turn - right.turn)
}
