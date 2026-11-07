/**
 * **host · 刚结束的运行账本**（W5-1：从 `mobile-api.ts` 抽出的第六个域）。
 *
 * 手机首页要显示"刚跑完的几个会话"，这份账本是宿主侧的**落盘清单**：一次运行结束就追加
 * 一条，读的时候按时间倒序取前几条、顺手裁剪。
 *
 * 这里只放**格式与读写**（都接收 `file` 参数、不依赖模块状态）。真正的接线
 * （`noteHostFinishedRun`，要拿全局的账本路径与会话标题）留在 api.ts——**接线与格式分开**，
 * 格式才能单独测、单独搬。
 *
 * @module dsh-palm/host/finished-runs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 账本最多留多少条（够放一两天的工作，按会话去重）。 */
export const FINISHED_RUNS_MAX = 60

/**
 * 一条账本存活多久。
 *
 * 真机口径（2026-10-29）：运行中页的「刚结束」应该是**我没点进去看过**的那些会话，
 * 而不是「最近半小时结束的」。所以存活期给到 7 天，真正的剔除靠「打开过就删」。
 */
export const FINISHED_RUNS_TTL_MS = 7 * 24 * 60 * 60_000

/** 账本里的一条（与客户端 `FinishedRun` 同形，宿主只存不解释）。 */
export interface FinishedRunEntry {
  sessionId: string
  title: string
  finishedAt: number
  status: 'done' | 'error' | 'stopped'
  durationMs?: number
  summary?: string
}

/** 读账本（文件不存在/坏文件都当空）。顺手按 TTL 与条数上限裁剪。 */
export function readFinishedRuns(file: string | undefined, now: number): FinishedRunEntry[] {
  if (file === undefined) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is FinishedRunEntry => {
      if (typeof entry !== 'object' || entry === null) return false
      const row = entry as Partial<FinishedRunEntry>
      return typeof row.sessionId === 'string'
        && typeof row.title === 'string'
        && typeof row.finishedAt === 'number'
        && (row.status === 'done' || row.status === 'error' || row.status === 'stopped')
        && now - row.finishedAt < FINISHED_RUNS_TTL_MS
    }).slice(0, FINISHED_RUNS_MAX)
  } catch {
    return []
  }
}

/**
 * 合并一次上报的账本条目，返回合并后的全量。
 *
 * 合并语义用**会话 + 收工时刻**做键：同一会话只保留最新一条（与客户端一致），
 * 不同客户端先后上报同一条也不会重复。
 */
export function mergeFinishedRuns(
  current: readonly FinishedRunEntry[],
  incoming: readonly FinishedRunEntry[],
  now: number,
): FinishedRunEntry[] {
  const bySession = new Map<string, FinishedRunEntry>()
  for (const entry of [...current, ...incoming]) {
    if (typeof entry.finishedAt !== 'number' || now - entry.finishedAt >= FINISHED_RUNS_TTL_MS) continue
    const previous = bySession.get(entry.sessionId)
    if (previous === undefined || entry.finishedAt >= previous.finishedAt) bySession.set(entry.sessionId, entry)
  }
  return [...bySession.values()].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, FINISHED_RUNS_MAX)
}

/** 写账本（失败静默：账本丢一条不能影响聊天）。 */
export function writeFinishedRuns(file: string | undefined, entries: readonly FinishedRunEntry[]): void {
  if (file === undefined) return
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(entries))
  } catch {
    // 磁盘满/只读：保持内存行为即可
  }
}
