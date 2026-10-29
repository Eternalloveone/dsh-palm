/**
 * 「运行中」卡片上那几行字的来源。
 *
 * 手机上不额外开 RPC：宿主尾页（`mobile.logTail`）已经把这一轮的折叠行、
 * 真起点（`turnStartAt`）和最新事件时间（`lastEventAt`）一起带回来了，
 * 卡片要的"在干什么 / 第几步 / 已跑多久 / 是不是卡住"全都能从这一页推出来。
 *
 * 之所以不用 `session/jobs`：它只覆盖后台任务，纯对话的回合（最常见的情况）
 * 在它那里是空的 —— 那正是以前卡片只能写"回合运行中"的原因。
 *
 * @module dsh-palm/mobile/run-detail
 */

import type { ChatPage } from './api.ts'
import type { RenderMessage, ToolCallInfo } from './messages.ts'
import { stepModel } from './step-view.ts'

/** 卡片上要显示的那几项。 */
export interface RunDetail {
  /** 正在跑的工具怎么说（"运行命令 pnpm test"），没有就是生成中/等待。 */
  action: string
  /** 动作的补充（命令原文、文件路径），可能为空。 */
  actionHint?: string
  /** 这一轮目前跑到第几步。 */
  step?: number
  /** 这一轮的真起点（宿主从日志里补的锚点）。 */
  turnStartAt?: number
  /** 这一轮最新事件的时间 —— "3 秒前有活动"。 */
  lastEventAt?: number
  /**
   * 宿主对"这一轮还开着吗"的明确回答（来自尾页边界）。
   *
   * `false` 是真凭据：日志最后一条边界就是 turn/end，这一轮确实收工了 —— 卡片该从
   * "正在运行"里退场（真机现场：会话早跑完了，卡片还在数秒，因为花名册那一行
   * 一直说 running=true）。`undefined` 表示不知道，别拿它当收工。
   */
  turnOpen?: boolean
  /** 最后一条回复的开头（收工后「刚结束」那一行的摘要）。 */
  summary?: string
  /** 这一轮用时：收工后由卡片刻定，含量就是它。 */
  durationMs?: number
  /** 成败口径（宿主没给 turn/end 时的兜底）。 */
  status?: 'done' | 'error' | 'stopped'
}

/** 最新事件超过这个岁数就标黄：可能是宿主重启/断流，也可能是真卡住了。 */
export const RUN_STALE_MS = 90_000

/** 最近一条助手行（卡片的所有信息都取自它所在的回合）。 */
function lastAssistant(rows: readonly RenderMessage[]): RenderMessage | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row !== undefined && row.kind === 'assistant') return row
  }
  return undefined
}

/** 这一行里最后一个"还在跑"的工具调用。 */
function runningTool(row: RenderMessage): ToolCallInfo | undefined {
  const tools = row.tools ?? []
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    const tool = tools[index]
    if (tool !== undefined && tool.state === 'running') return tool
  }
  return undefined
}

/** 动作描述：优先正在跑的工具，其次"生成回复中"。 */
function describeAction(row: RenderMessage | undefined): { action: string; actionHint?: string } {
  if (row === undefined) return { action: '等待输出' }
  const tool = runningTool(row)
  if (tool !== undefined) {
    const model = stepModel(tool)
    const hint = model.summary === '' ? undefined : model.summary
    return { action: model.title, ...(hint === undefined ? {} : { actionHint: hint }) }
  }
  if (row.pending === true) return { action: '生成回复中' }
  return { action: '等待下一步' }
}

/**
 * 从一页尾页折叠里推出卡片信息。
 * @param page - `mobile.logTail` / `mobile.readChat` 回来的一页。
 * @returns 卡片行；页面里没有任何助手行时给一份"等待输出"的兜底。
 */
export function runDetailFromPage(page: ChatPage | undefined): RunDetail {
  if (page === undefined) return { action: '等待输出' }
  const row = lastAssistant(page.rows)
  const { action, actionHint } = describeAction(row)
  const turnStartAt = row?.turnStartAt ?? page.turnStartAt
  const lastEventAt = page.lastEventAt ?? row?.time
  const summary = summaryFromPage(page)
  const durationMs = durationFromPage(page)
  return {
    action,
    ...(actionHint === undefined ? {} : { actionHint }),
    ...(row?.step === undefined ? {} : { step: row.step }),
    ...(turnStartAt === undefined ? {} : { turnStartAt }),
    ...(lastEventAt === undefined ? {} : { lastEventAt }),
    ...(page.turnOpen === undefined ? {} : { turnOpen: page.turnOpen }),
    ...(summary === undefined ? {} : { summary }),
    ...(durationMs === undefined ? {} : { durationMs }),
    status: statusFromPage(page),
  }
}

/** 最新一条助手行的正文开头（刚结束清单里的一行摘要）。 */
export function summaryFromPage(page: ChatPage | undefined, limit = 60): string | undefined {
  const row = lastAssistant(page?.rows ?? [])
  const text = row?.text?.trim()
  if (text === undefined || text === '') return undefined
  const firstLine = text.split('\n')[0] ?? text
  const clean = firstLine.replace(/^[#>*\-\s]+/, '').trim()
  if (clean === '') return undefined
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean
}

/** 这一轮用时（收工后定格）；缺锚点时给 undefined，让界面别乱猜。 */
export function durationFromPage(page: ChatPage | undefined): number | undefined {
  const row = lastAssistant(page?.rows ?? [])
  if (row?.durationMs !== undefined) return row.durationMs
  if (row?.turnStartAt !== undefined && row.time !== undefined) return Math.max(0, row.time - row.turnStartAt)
  return undefined
}

/** 收工类型：从同一页尾页推（宿主没给 turn/end 时的兜底口径）。 */
export function statusFromPage(page: ChatPage | undefined): 'done' | 'error' | 'stopped' {
  const row = lastAssistant(page?.rows ?? [])
  if (row === undefined) return 'done'
  if (row.failed === true) return 'error'
  const tools = row.tools ?? []
  if (tools.some(tool => tool.state === 'error')) return 'error'
  if (tools.some(tool => tool.state === 'stopped')) return 'stopped'
  return 'done'
}

/** 时长 → "8分39秒"（和过程条同一套文案，免得两个界面对不上）。 */export function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`
  if (minutes > 0) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}

/** "3 秒前" / "2 分钟前" —— 只用于活动时间与刚结束的时间戳。 */
export function formatAgo(now: number, at: number): string {
  const delta = Math.max(0, now - at)
  if (delta < 5_000) return '刚刚'
  if (delta < 60_000) return `${Math.floor(delta / 1000)} 秒前`
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return `${Math.floor(delta / 86_400_000)} 天前`
}
