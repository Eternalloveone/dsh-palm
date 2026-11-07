/**
 * **host · 搜索文本提取域**（W5-1：从 `mobile-api.ts` 抽出的第七个域）。
 *
 * 一条消息里**哪些字能被搜到**，只有一个判据：正文可见的部分。思考链（`<think>`）、
 * 工具调用参数与结果、围栏代码块**都不算**——搜索命中必须是用户在会话里看得见的那句话，
 * 不能埋在折叠的思考或工具载荷里。
 *
 * 全是纯函数（输入行、输出文本），没有模块状态，所以能整块搬走而不改动行为。
 *
 * @module dsh-palm/host/search-text
 */
import { stripToolBlocks } from '../search-index.ts'
import { processModel } from '../mobile/render/process-rows.ts'
import type { RenderMessage } from '../mobile/render/messages.ts'

export interface SearchDocumentRow {
  seq: number
  messageId?: string
  partId?: string
  text: string
  folded: string
  user: boolean
}

/**
 * Strip fenced code blocks (```lang … ```) from a message body so a search
 * term inside a code fence does not match — code is not conversational text.
 */
export function stripHiddenAssistantText(text: string): string {
  return stripToolBlocks(text)
    // Both closed and interrupted fences are non-conversational surfaces.
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    // Inline model thinking is rendered as a disclosure, not reply prose.
    // Treat an interrupted tag as hidden through the end as well.
    .replace(/<think(?:\s[^>]*)?>[\s\S]*?(?:<\/think>|$)/gi, '')
}

/**
 * The text a search may match for one folded message row: the user's sent
 * message and the assistant's reply BODY only. Reasoning (the thinking
 * chain), tool-call arguments/results, and fenced code blocks are excluded —
 * a search hit must be visible in the conversation, not buried in a tool
 * payload or a collapsed disclosure.
 */
/**
 * 行里"能搜到的正文"：readChat/logTail 的行有时把正文放在 flow（工具步骤流）里，
 * text 是空的（实测 25 行里 19 行如此），而索引侧同一段文字在 text 里。取并集才能
 * 让手机端按这段文本把命中落准行。
 */
export function rowSearchableText(row: RenderMessage): string {
  const body = searchableText(row)
  const parts: string[] = []
  if (body !== '') parts.push(body)
  for (const part of row.flow ?? []) {
    if (part.kind === 'text' && part.text !== '') parts.push(part.text)
  }
  return parts.join('\n')
}

export function searchableText(row: RenderMessage): string {
  if (row.kind === 'user') {
    return row.sourceKind === undefined || row.sourceKind === 'user' ? row.text : ''
  }
  if (row.kind === 'assistant') return stripHiddenAssistantText(row.text)
  return ''
}

/**
 * The NON-searchable text of one row (reasoning chain + tool-call arguments).
 * Used to tell a hit that matched only excluded content apart from a hit that
 * simply sits deeper than the bounded scan: the former is dropped, the latter
 * is kept best-effort so a correct session is not lost.
 */
export function excludedText(row: RenderMessage): string {
  if (row.kind !== 'assistant') return ''
  const parts: string[] = []
  if (row.reasoning !== undefined && row.reasoning !== '') parts.push(row.reasoning)
  for (const tool of row.tools ?? []) {
    if (tool.arguments !== undefined && tool.arguments !== '') parts.push(tool.arguments)
  }
  return parts.join('\n')
}

/**
 * 索引口径的唯一真源（A）：一条消息**手机端最终显示的那段正文**，加上它在屏幕上
 * 的坐标（seq + partId）。
 *
 * 规则只有两条，和用户看到的一一对应：
 * - 用户发送内容 → 气泡正文（`.chat-msg-text`，`data-part-id="body"`）；
 * - 助手正文答案 → 答案段（`.chat-flow-answer[data-part-id="answer"]`），代码块、
 *   ` thinking`、工具块都剥掉；
 * - 其它（系统行、非用户来源、无答案的助手行）→ 不入库。
 *
 * 为什么要它单独成一个函数：索引端和渲染端各写一份判断，就是之前反复出问题的
 * 根源（搜得到、点进去没高亮 / 搜到推理链）。渲染端认的 part-id 就由这里给出。
 */
export function searchCorpusOf(row: RenderMessage): { seq: number; partId?: string; text: string } | undefined {
  if (row.kind === 'assistant') {
    // settled=true 是刻意的：索引要可复现，不能让「这一轮还在跑」改变入库内容。
    const model = processModel(row, undefined, true)
    const answer = model.answer === undefined ? '' : stripHiddenAssistantText(model.answer)
    if (answer.trim() === '') return undefined
    // 渲染端只在 answerSeq 存在时把它包进 data-part-id="answer" 的节点；否则是裸
    // MarkdownText，此时给 partId 反而指不到元素。
    return {
      seq: model.answerSeq ?? row.startSeq ?? row.seq,
      ...(model.answerSeq === undefined ? {} : { partId: 'answer' }),
      text: answer,
    }
  }
  if (row.kind !== 'user') return undefined
  const text = searchableText(row)
  if (text === '') return undefined
  // 用户消息画成气泡正文，给它一个 part-id，定位就能按坐标落，不用在整行里找词。
  return { seq: row.startSeq ?? row.seq, partId: 'body', text }
}

export function documentRows(rows: readonly RenderMessage[]): SearchDocumentRow[] {
  const result: SearchDocumentRow[] = []
  for (const row of rows) {
    const corpus = searchCorpusOf(row)
    if (corpus === undefined) continue
    result.push({
      seq: corpus.seq,
      messageId: row.id,
      ...(corpus.partId === undefined ? {} : { partId: corpus.partId }),
      text: corpus.text,
      folded: corpus.text.toLowerCase(),
      user: row.kind === 'user',
    })
  }
  return result
}
