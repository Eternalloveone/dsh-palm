import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const API = join(PKG, 'src', 'mobile-api.ts')
const OUT = join(PKG, 'src', 'mobile', 'api', 'chat-include.ts')

const SOURCE = `/**
 * \`chat.read\` 的 include 参数解析（P2 域拆分：chat 域首个自包含簇）。
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
`

const lines = readFileSync(API, 'utf8').split('\n')
const start = lines.findIndex(line => line.startsWith('const READ_CHAT_INCLUDE_NAMES'))
if (start < 0) {
  console.log('already moved')
  process.exit(0)
}
const end = lines.findIndex((line, index) => index > start && line === '}')
if (end < 0) throw new Error('没找到 readChatInclude 的结束行')

const next = [...lines.slice(0, start), ...lines.slice(end + 1)]
const anchor = next.findIndex(line => line.includes("from './mobile/api/settings.ts'"))
next.splice(anchor + 1, 0, "import { readChatInclude } from './mobile/api/chat-include.ts'")

writeFileSync(OUT, SOURCE)
writeFileSync(API, next.join('\n'))
console.log(`moved READ_CHAT_INCLUDE_NAMES + type + readChatInclude (${end - start + 1} lines)`)
console.log(`mobile-api.ts ${lines.length} → ${next.length}`)
