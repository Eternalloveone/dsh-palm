import { beforeEach, describe, expect, it } from 'vitest'
import { clearChatSnapshots, forgetChatSnapshot, recallChatSnapshot, rememberChatSnapshot } from './chat-snapshot.ts'
import type { RenderMessage } from './messages.ts'

function row(id: string): RenderMessage {
  return { id, kind: 'assistant', text: id, seq: 1, time: 1 } as unknown as RenderMessage
}

describe('chat-snapshot', () => {
  beforeEach(() => {
    clearChatSnapshots()
  })

  it('hands back what was painted last time, flags included', () => {
    const rows = [row('a'), row('b')]
    rememberChatSnapshot('s-1', rows, true)
    const recalled = recallChatSnapshot('s-1')
    expect(recalled?.rows).toHaveLength(2)
    expect(recalled?.hasOlder).toBe(true)
    expect(recallChatSnapshot('s-2')).toBeUndefined()
  })

  it('never remembers an empty list: an empty paint is not a snapshot', () => {
    // 二次挂载（StrictMode/快速返回）会先渲染空表：把它记下来，下一次进会话就会
    // 跳过「加载中」，界面卡在空白。
    rememberChatSnapshot('s-1', [], false)
    expect(recallChatSnapshot('s-1')).toBeUndefined()
  })

  it('keeps only the tail rows so a long chat does not pin memory', () => {
    const rows = Array.from({ length: 400 }, (_unused, index) => row(`r-${index}`))
    rememberChatSnapshot('s-1', rows, false)
    const recalled = recallChatSnapshot('s-1')
    expect(recalled?.rows).toHaveLength(240)
    expect(recalled?.rows.at(-1)?.id).toBe('r-399')
  })

  it('keeps a handful of sessions, dropping the least recently used', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) rememberChatSnapshot(id, [row(id)], false)
    expect(recallChatSnapshot('a')).toBeUndefined()
    expect(recallChatSnapshot('e')).toBeDefined()
    // 再摸一下 b：它变成最近使用的，下一个被挤掉的应是 c。
    rememberChatSnapshot('b', [row('b')], false)
    rememberChatSnapshot('f', [row('f')], false)
    expect(recallChatSnapshot('b')).toBeDefined()
    expect(recallChatSnapshot('c')).toBeUndefined()
  })

  it('forgets a session on request', () => {
    rememberChatSnapshot('s-1', [row('a')], false)
    forgetChatSnapshot('s-1')
    expect(recallChatSnapshot('s-1')).toBeUndefined()
  })
})
