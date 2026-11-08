/**
 * 「刚结束」清单里一行字（摘要 / 用时 / 时长文案）的来源。
 *
 * 手机上不额外开 RPC：宿主尾页（`mobile.logTail`）已经把这一轮的折叠行、
 * 真起点（`turnStartAt`）和最新事件时间（`lastEventAt`）一起带回来了。
 *
 * @module dsh-palm/mobile/run-detail
 */

import type { ChatPage } from '../api.ts'
import type { RenderMessage } from '../render/messages.ts'

/** 最近一条助手行（卡片的所有信息都取自它所在的回合）。 */
function lastAssistant(rows: readonly RenderMessage[]): RenderMessage | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row !== undefined && row.kind === 'assistant') return row
  }
  return undefined
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

/** 时长 → "8分39秒"（和过程条同一套文案，免得两个界面对不上）。 */export function formatRunDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`
  if (minutes > 0) return `${minutes}分${seconds}秒`
  return `${seconds}秒`
}
