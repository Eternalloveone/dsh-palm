/**
 * 探针日志（`dsh-palm-probes/`）：**按天追加**的一行一条 JSONL。
 *
 * 探针说「这条路径跑过」，不是「出错了」。它们以前和真错误挤在
 * `dsh-palm-errors/` 里，一文件一条、没有时间线，排障要先 `ls` 再逐个打开，
 * 而且会因为带上现场读数被当成「新错误」反复弹通知（2026-11-16 用户反馈）。
 *
 * 现在：探针写这里（可按天 grep），错误目录只收真错误。
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** 保留多少天的探针日志（一天一个文件）。 */
export const PROBE_LOG_KEEP_DAYS = 14

/** 一天一个文件，用宿主本地日期：`probe-YYYY-MM-DD.jsonl`。 */
export function probeLogFile(dir: string, now: number): string {
  const at = new Date(now)
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return join(dir, `probe-${at.getFullYear()}-${month}-${day}.jsonl`)
}

/**
 * 追加一条探针记录，返回文件绝对路径（写不进去时 undefined）。
 *
 * best effort：日志不是关键路径，任何一种落盘失败都不能把上报本身变成错误。
 */
export function appendProbeLog(dir: string, report: unknown, now: number): string | undefined {
  try {
    mkdirSync(dir, { recursive: true })
    const file = probeLogFile(dir, now)
    appendFileSync(file, `${JSON.stringify(report)}\n`, { encoding: 'utf8', mode: 0o600 })
    pruneProbeLogs(dir, PROBE_LOG_KEEP_DAYS)
    return file
  } catch {
    return undefined
  }
}

/** 按文件名日期只留最近 `keepDays` 个（best effort，永不抛）。 */
export function pruneProbeLogs(dir: string, keepDays: number): void {
  try {
    const files = readdirSync(dir)
      .filter(name => name.startsWith('probe-') && name.endsWith('.jsonl'))
      .sort()
    for (const stale of files.slice(0, Math.max(0, files.length - keepDays))) {
      try {
        rmSync(join(dir, stale), { force: true })
      } catch {
        // 下一轮再试
      }
    }
  } catch {
    // 目录读不到也不能失败
  }
}
