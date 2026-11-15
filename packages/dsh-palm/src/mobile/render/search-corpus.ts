/**
 * **搜索语料口径的唯一真源**（宿主索引与手机端本地计数共用）。
 *
 * 一条消息里"能搜到的正文"只有两段，和用户眼睛看到的一一对应：
 * - 用户发送内容 → 气泡正文（`.chat-msg-text`，`data-part-id="body"`）；
 * - 助手正文答案 → 答案段（`.chat-flow-answer[data-part-id="answer"]`）。
 *
 * 思考链（`reasoning` / `</think>`）、工具调用参数与结果、过程步骤里的正文
 * （渲染在折叠的「过程」里）、围栏代码块**都不算** —— 否则会出现"数字在动、
 * 画面没跳过去"：计数把过程里的词算进去了，定位却只能落在答案区的 mark 上。
 *
 * 这个文件从 `host/search-text.ts` 搬来，就是为了让手机端也能直接用同一份函数，
 * 而不是各自再写一套"什么算正文"的判断（那正是历史上反复出问题的根源）。
 */
import { stripToolBlocks } from '../../shared/strip-tool-blocks.ts'
import { processModel } from './process-rows.ts'
import type { RenderMessage } from './messages.ts'

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

/** 一段正文里"能搜到"的部分：用户气泡原文，或助手答案（剥掉思考/工具/代码块）。 */
export function searchableText(row: RenderMessage): string {
  if (row.kind === 'user') {
    return row.sourceKind === undefined || row.sourceKind === 'user' ? row.text : ''
  }
  if (row.kind === 'assistant') return stripHiddenAssistantText(row.text)
  return ''
}

/**
 * 行里"能搜到的正文"：readChat/logTail 的行有时把正文放在 flow（工具步骤流）里，
 * text 是空的（实测 25 行里 19 行如此），而索引侧同一段文字在 text 里。取并集才能
 * 让手机端按这段文本把命中落准行。
 *
 * 只给"定位/侧信息"用；**搜索语料**请用 {@link searchCorpusOf}（它还会剥掉过程与思考）。
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
 * 一条消息**手机端最终显示的那段正文**，加上它在屏幕上的坐标（seq + partId）。
 *
 * 其它行（系统行、非用户来源、无答案的助手行、只有过程没有结论的助手行）→ undefined，
 * 也就是**不入索引、不参与计数、不会被跳转**。
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
