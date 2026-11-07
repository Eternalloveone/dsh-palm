/**
 * `chat.read` 的 include 参数解析（P2 域拆分：chat 域首个自包含簇）。
 *
 * 行为保持不变：只接受白名单里的名字，去重，非字符串直接跳过。
 *
 * @module dsh-palm/mobile/api/chat-include
 */

/** 允许客户端请求的附加内容。 */
export const READ_CHAT_INCLUDE_NAMES = ['models', 'subagents'] as const

export type ReadChatIncludeName = (typeof READ_CHAT_INCLUDE_NAMES)[number]

/** 把客户端传来的 include 数组收敛成白名单内的去重列表。 */
export function readChatInclude(raw: unknown): ReadChatIncludeName[] {
  if (!Array.isArray(raw)) return []
  const picked: ReadChatIncludeName[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const name = READ_CHAT_INCLUDE_NAMES.find(candidate => candidate === value)
    if (name !== undefined && !picked.includes(name)) picked.push(name)
  }
  return picked
}
