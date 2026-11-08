// @vitest-environment node
/**
 * 插入 slice 的仓级契约：纯层测合并/去抖，这里测「谁写仓、谁删、轮次怎么推进」。
 * 不测 UI；渲染见 views/chat/components/insert-bar.test.tsx。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyQueueItems,
  consumeInsertMessage,
  insertView,
  noteInsertTurnStart,
  resetSessionStoreForTest,
  withdrawInsert,
} from './session-store.ts'

const steering = (id: string, text: string, sourceKind?: string) => ({
  id,
  placement: 'steering' as const,
  text,
  editable: true,
  ...(sourceKind === undefined ? {} : { sourceKind }),
})

beforeEach(() => { resetSessionStoreForTest() })

describe('session-store 插入 slice', () => {
  it('steering 行进插入队列；同一 id 重复到达只算一条', () => {
    applyQueueItems('s', [steering('q1', '插一句')])
    applyQueueItems('s', [steering('q1', '插一句')])
    expect(insertView('s').map(entry => entry.id)).toEqual(['q1'])
  })

  it('快照里没有它不删：连续两次缺失且过窗口才从显示里退场，事实仍可回来', () => {
    const start = Date.now()
    applyQueueItems('s', [steering('q1', '插一句')])
    expect(insertView('s', start + 810)).toHaveLength(1)
    applyQueueItems('s', [])
    // 第一次缺失：只记一笔，不消失。
    expect(insertView('s', start + 820)).toHaveLength(1)
    applyQueueItems('s', [])
    // 第二次缺失 + 已过 600ms 窗口：显示退场（不是从事实里删除）。
    expect(insertView('s', start + 1400)).toHaveLength(0)
    // 再看到同一 id：立即回来，不用等去抖。
    applyQueueItems('s', [steering('q1', '插一句')])
    expect(insertView('s', start + 1400)).toHaveLength(1)
  })

  it('回执才删：撤回后陈旧快照再带同一 id 也不能复活', () => {
    applyQueueItems('s', [steering('q1', '插一句')])
    withdrawInsert('s', 'q1')
    expect(insertView('s')).toHaveLength(0)
    applyQueueItems('s', [steering('q1', '插一句')])
    expect(insertView('s')).toHaveLength(0)
  })

  it('user/message 消费回执按宿主 id 退场', () => {
    applyQueueItems('s', [steering('q1', '插一句')])
    consumeInsertMessage('s', {
      data: { id: 'q1', role: 'user', content: [{ type: 'text', text: '插一句' }], source: { kind: 'user' } },
    })
    expect(insertView('s')).toHaveLength(0)
  })

  it('轮次只进不退：更晚的 turnStartAt 清旧轮，更早的陈旧值不能把当前轮清掉', () => {
    applyQueueItems('s', [steering('q1', '上一轮插的')])
    noteInsertTurnStart('s', 2_000)
    expect(insertView('s')).toHaveLength(0)
    applyQueueItems('s', [steering('q2', '这一轮插的')])
    expect(insertView('s').map(entry => entry.id)).toEqual(['q2'])
    // 乱序/陈旧快照带来的更早起点：忽略，当前轮条目必须保留。
    noteInsertTurnStart('s', 1_000)
    expect(insertView('s').map(entry => entry.id)).toEqual(['q2'])
  })
})
