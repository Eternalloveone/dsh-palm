/**
 * 审批卡片上那行「将要执行什么」。
 *
 * 宿主的 `approval/requested` 帧只带工具名和一句可选的 reason，卡片上于是只有
 * 「bash + 允许一次」两个词 —— 用户其实是在**看不见命令**的情况下点的允许。
 * 工具调用的参数在会话日志里（`tool/call` 事件的 arguments），按 callId 能对上，
 * 这里只负责把那段 JSON 压成「一行、能看懂、不超长」的文字。
 */

/** 预览最多显示多少字符（超出截断，全文在卡片的可展开区）。 */
export const APPROVAL_PREVIEW_LIMIT = 120

/** 从参数里优先取出来的字段（不同工具的关键参数名不同，按顺序找第一个字符串）。 */
const PREFERRED_ARG_KEYS = ['command', 'cmd', 'file_path', 'path', 'pattern', 'url', 'query']

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= APPROVAL_PREVIEW_LIMIT) return oneLine
  return oneLine.slice(0, APPROVAL_PREVIEW_LIMIT - 1) + '…'
}

/**
 * 把一次工具调用的原始参数压成一行预览。
 *
 * - 参数缺失或不是 JSON：原样（去掉换行）返回，至少让用户看到点东西；
 * - 是对象：先找 `command`/`cmd`/`file_path` 这类关键字段，找不到就把对象序列化。
 */
export function approvalPreviewText(rawArguments: string | undefined): string | undefined {
  if (rawArguments === undefined) return undefined
  const trimmed = rawArguments.trim()
  if (trimmed === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return clip(trimmed)
  }
  if (parsed === null || typeof parsed !== 'object') return clip(String(parsed))
  const record = parsed as Record<string, unknown>
  for (const key of PREFERRED_ARG_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return clip(value)
  }
  try {
    return clip(JSON.stringify(record))
  } catch {
    return undefined
  }
}
