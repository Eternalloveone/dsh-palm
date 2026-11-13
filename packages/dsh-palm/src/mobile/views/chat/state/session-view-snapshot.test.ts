/**
 * 会话视图快照的契约：换会话时"先显示上一场的样子"靠的就是这份缓存。
 *
 * 四条规矩（模块注释里写的就是这四条，这里逐条钉住）：
 * 1. 写了能读到；没写过返回 undefined（调用方退回自己的初值）；
 * 2. `undefined` 不写（它表示"还没拿到"，不该覆盖一份好快照）；
 * 3. `null` 照写（它是有意义的"确认没有"）；
 * 4. 只留最近 8 场，切超过 8 场就丢最早的。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearViewSnapshots,
  forgetViewSnapshots,
  readViewSnapshot,
  viewSnapshotSessionCount,
  writeViewSnapshot,
} from './session-view-snapshot.ts'

beforeEach(() => { clearViewSnapshots() })

describe('session-view-snapshot', () => {
  it('写了能读到，按会话分开存', () => {
    writeViewSnapshot('s-a', 'goal', { objective: '排版' })
    expect(readViewSnapshot('s-a', 'goal')).toEqual({ objective: '排版' })
    expect(readViewSnapshot('s-b', 'goal')).toBeUndefined()
  })

  it('undefined 不写：不会把一份好快照覆盖成"还没拿到"', () => {
    writeViewSnapshot('s-a', 'goal', { objective: '排版' })
    writeViewSnapshot('s-a', 'goal', undefined)
    expect(readViewSnapshot('s-a', 'goal')).toEqual({ objective: '排版' })
  })

  it('null 照写：它是"确认没有目标"，不是"还没拿到"', () => {
    writeViewSnapshot<string | null>('s-a', 'goal', '先把目标条做出来')
    writeViewSnapshot<string | null>('s-a', 'goal', null)
    expect(readViewSnapshot<string | null>('s-a', 'goal')).toBeNull()
  })

  it('空会话 id 不写也不读（它不是一个换会话会话）', () => {
    writeViewSnapshot('', 'goal', 1)
    expect(viewSnapshotSessionCount()).toBe(0)
    expect(readViewSnapshot('', 'goal')).toBeUndefined()
  })

  it('只留最近 8 场：切超过 8 场就丢最早那场', () => {
    for (let i = 0; i < 9; i += 1) writeViewSnapshot(`s-${i}`, 'goal', i)
    expect(viewSnapshotSessionCount()).toBe(8)
    expect(readViewSnapshot('s-0', 'goal')).toBeUndefined()
    expect(readViewSnapshot('s-8', 'goal')).toBe(8)
  })

  it('读过的那场算"最近使用"：不会被紧接着写入的新场挤掉', () => {
    for (let i = 0; i < 8; i += 1) writeViewSnapshot(`s-${i}`, 'goal', i)
    // 摸一下最早那场，它应当逃过下一次淘汰
    expect(readViewSnapshot('s-0', 'goal')).toBe(0)
    writeViewSnapshot('s-new', 'goal', 'new')
    expect(viewSnapshotSessionCount()).toBe(8)
    expect(readViewSnapshot('s-0', 'goal')).toBe(0)
    expect(readViewSnapshot('s-1', 'goal')).toBeUndefined()
  })

  it('forget 只丢一场，别的会话不受影响', () => {
    writeViewSnapshot('s-a', 'goal', 1)
    writeViewSnapshot('s-b', 'goal', 2)
    forgetViewSnapshots('s-a')
    expect(readViewSnapshot('s-a', 'goal')).toBeUndefined()
    expect(readViewSnapshot('s-b', 'goal')).toBe(2)
  })
})
