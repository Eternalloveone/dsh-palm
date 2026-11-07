import { describe, expect, it } from 'vitest'
import { READ_CHAT_INCLUDE_NAMES, readChatInclude } from './chat-include.ts'

describe('readChatInclude', () => {
  it('只保留白名单内的名字', () => {
    expect(readChatInclude(['models', 'nope', 'subagents'])).toEqual(['models', 'subagents'])
  })

  it('去重且保持首次出现顺序', () => {
    expect(readChatInclude(['subagents', 'models', 'subagents'])).toEqual(['subagents', 'models'])
  })

  it('非数组 / 非字符串一律忽略', () => {
    expect(readChatInclude(undefined)).toEqual([])
    expect(readChatInclude('models')).toEqual([])
    expect(readChatInclude([1, null, {}, 'models'])).toEqual(['models'])
  })

  it('白名单本身只有 models / subagents', () => {
    expect([...READ_CHAT_INCLUDE_NAMES]).toEqual(['models', 'subagents'])
  })
})
