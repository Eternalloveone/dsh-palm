import { describe, expect, it } from 'vitest'
import { projectReading } from './reading-projection.ts'
import type { RenderMessage } from '../../../render/messages.ts'

const user = (id: string, time: number): RenderMessage => ({ id, kind: 'user', text: id, time } as RenderMessage)
const assistant = (id: string, turn: number, time = 0): RenderMessage =>
  ({ id, kind: 'assistant', text: id, turn, time } as RenderMessage)

describe('阅读投影', () => {
  it('本轮 = 最后一条用户消息之后出现的轮号', () => {
    const messages = [user('u1', 10), assistant('a1', 1), user('u2', 20), assistant('a2', 2), assistant('a3', 3)]
    const reading = projectReading({ messages, turnOutlineRaw: undefined, currentTurn: 0 })
    expect(reading.activeTurn).toBe(3)
    expect(reading.lastUserAt).toBe(20)
  })

  it('一条用户行都没有时：本轮退回全表最大轮（与历史行为一致，别改成 undefined）', () => {
    const reading = projectReading({ messages: [assistant('a1', 7)], turnOutlineRaw: undefined, currentTurn: 0 })
    expect(reading.activeTurn).toBe(7)
    expect(reading.newestCardTurn).toBe(7)
    expect(reading.lastUserAt).toBeUndefined()
  })

  it('最新卡轮 = 全表最大轮号（实时帧丢了时的保守兜底）', () => {
    const messages = [assistant('a1', 2), user('u1', 5), assistant('a2', 5), assistant('a3', 4)]
    const reading = projectReading({ messages, turnOutlineRaw: undefined, currentTurn: 0 })
    expect(reading.newestCardTurn).toBe(5)
  })

  it('滑条读数：停在哪一轮就显示哪一轮，没停过用最新一轮', () => {
    const messages = [user('u1', 1), assistant('a1', 1), user('u2', 2), assistant('a2', 2)]
    expect(projectReading({ messages, turnOutlineRaw: undefined, currentTurn: 1 }).shownTurn).toBe(1)
    expect(projectReading({ messages, turnOutlineRaw: undefined, currentTurn: 0 }).shownTurn).toBe(2)
  })

  it('空输入不炸：各项都是空值', () => {
    const reading = projectReading({ messages: [], turnOutlineRaw: undefined, currentTurn: 0 })
    expect(reading.maxTurn).toBe(0)
    expect(reading.hostNewestTurn).toBe(0)
    expect(reading.shownTurn).toBe(0)
    expect(reading.turnEntries).toEqual([])
    expect(reading.activeTurn).toBeUndefined()
    expect(reading.newestCardTurn).toBeUndefined()
  })
})
