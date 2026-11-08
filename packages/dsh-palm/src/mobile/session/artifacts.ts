/**
 * 产物聚合（P6 ⑧ 屏的数据层）。
 *
 * 交付物散在两处：`deliverables`（宿主明确 `present` 的文件）与
 * `produced`（工具改动过、没声明为交付物的文件）。界面上要按**轮**看，
 * 所以这里把两份合成一份，并处理三种真实情况：
 *
 * 1. **重复**：同一个文件既被 present 又被工具改过 —— 只算一次，且按交付物算；
 * 2. **乱序**：行是按事件顺序来的，turn 可能交错 —— 按轮号分组后排序；
 * 3. **没有轮号**：早期事件缺 turn，用 `undefined` 组收纳，界面照常给。
 *
 * @module dsh-palm/mobile/session/artifacts
 */
import type { RenderMessage } from '../projections/types.ts'

/** 一个产物文件。 */
export interface ArtifactFile {
  path: string
  /** 宿主声明的说明（只有交付物有）。 */
  description?: string
  /** `deliverable` = 明确交付；`produced` = 工具改过但没声明。 */
  kind: 'deliverable' | 'produced'
}

/** 一轮的产物。 */
export interface ArtifactTurn {
  /** 轮号；缺轮号的早期事件为 undefined。 */
  turn: number | undefined
  files: readonly ArtifactFile[]
}

/** 这一行算不算"有产物"。 */
function filesOf(message: RenderMessage): ArtifactFile[] {
  const out: ArtifactFile[] = []
  for (const file of message.deliverables ?? []) {
    out.push({
      path: file.path,
      kind: 'deliverable',
      ...(file.description === undefined ? {} : { description: file.description }),
    })
  }
  return out
}

/**
 * 把整页消息压成"按轮分组的产物清单"。
 *
 * @param messages - 折叠后的消息行（任意顺序）
 * @returns 按轮号**降序**（最近的在前）的产物组；没有任何产物时返回空数组
 */
export function collectArtifacts(messages: readonly RenderMessage[]): ArtifactTurn[] {
  const byTurn = new Map<number | undefined, Map<string, ArtifactFile>>()

  for (const message of messages) {
    const turn = message.turn
    const bucket = byTurn.get(turn) ?? new Map<string, ArtifactFile>()
    byTurn.set(turn, bucket)

    // 交付物优先：先写进去，后面 produced 同名时不再覆盖
    for (const file of filesOf(message)) {
      if (!bucket.has(file.path)) bucket.set(file.path, file)
    }
    for (const path of message.produced ?? []) {
      if (bucket.has(path)) continue
      bucket.set(path, { path, kind: 'produced' })
    }
  }

  const turns: ArtifactTurn[] = []
  for (const [turn, bucket] of byTurn) {
    if (bucket.size === 0) continue
    turns.push({ turn, files: [...bucket.values()] })
  }

  // 最近的一轮在前；缺轮号的排最后（它们是老事件）
  turns.sort((left, right) => {
    if (left.turn === undefined) return 1
    if (right.turn === undefined) return -1
    return right.turn - left.turn
  })
  return turns
}

/**
 * 统计：**跨轮去重**的文件总数与交付物数量。
 *
 * 同一个文件可能在第 3 轮被改、第 4 轮被声明为交付物；按轮分组时它会出现两次，
 * 但"这次会话动了几个文件"对用户来说只有一个答案——所以这里跨轮去重。
 */
export function artifactTally(turns: readonly ArtifactTurn[]): { files: number; delivered: number } {
  const all = new Set<string>()
  const delivered = new Set<string>()
  for (const turn of turns) {
    for (const file of turn.files) {
      all.add(file.path)
      if (file.kind === 'deliverable') delivered.add(file.path)
    }
  }
  return { files: all.size, delivered: delivered.size }
}
