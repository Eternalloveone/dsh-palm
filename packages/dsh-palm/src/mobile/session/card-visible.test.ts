// @vitest-environment node
/**
 * 交付卡可见性：**唯一判定的穷举矩阵**（2026-11-14 重构）。
 *
 * 以前这块是 6 道门的与（证据链 / running / inFlight / 空列表 / 结论资格 / 行内屏蔽），
 * 每道门各在**不同时刻**为真或为假 —— 于是每发现一种坏组合就得再加一道门，历史上连续
 * 补了四次（跑着冒卡、收工前冒卡、空会话挂上一场的卡、切会话闪一下）。
 *
 * 现在判定是 `cardVisible({ phase, delivery, rowCount })` 一个纯函数，所以这里**穷举**
 * 三值相位 × 有/无卡 × 空/非空屏，而不是一条条追 bug 入口。
 */
import { describe, expect, it } from 'vitest'
import { cardVisible, type CardPhase, type DeliveryRecord } from './deliveries.ts'

const delivery = (turn = 1): DeliveryRecord => ({
  sessionId: 's1',
  turn,
  presented: [{ path: 'a.ts', description: '交付' }],
  changes: [{ path: 'a.ts', adds: 1, dels: 0 }],
  adds: 1,
  dels: 0,
  meaningful: true,
})

const PHASES: readonly CardPhase[] = ['unknown', 'running', 'ended']

describe('cardVisible（相位 × 账本 × 行数）', () => {
  it('三值相位的唯一结论：只有 ended 才画', () => {
    const table = PHASES.map(phase => ({
      phase,
      visible: cardVisible({ phase, delivery: delivery(), rowCount: 3 }),
    }))
    expect(table).toEqual([
      { phase: 'unknown', visible: false },
      { phase: 'running', visible: false },
      { phase: 'ended', visible: true },
    ])
  })

  it('没有账本记录：任何相位都不画（空壳卡）', () => {
    for (const phase of PHASES) {
      expect(cardVisible({ phase, delivery: undefined, rowCount: 3 })).toBe(false)
    }
  })

  it('屏上一行都没有：任何相位都不画（卡不能是唯一有内容的东西）', () => {
    for (const phase of PHASES) {
      expect(cardVisible({ phase, delivery: delivery(), rowCount: 0 })).toBe(false)
    }
  })

  it('unknown 的语义是"还没结论"，不是"没在跑"（切会话/刚打开时的默认值）', () => {
    // 这条单独钉住语义：否则将来有人把 default 改成 ended，两类闪现会一起回来。
    expect(cardVisible({ phase: 'unknown', delivery: delivery(), rowCount: 9 })).toBe(false)
  })

  it('矩阵里的四种输入组合都只由这一个函数回答（调用方不再有旁路判定）', () => {
    // 组合：相位 3 × 卡 2 × 行 2 = 12，逐条写明期望，防止"再加一道门"。
    const expected: Array<[CardPhase, boolean, number, boolean]> = []
    for (const phase of PHASES) {
      for (const hasDelivery of [false, true]) {
        for (const rowCount of [0, 5]) {
          expected.push([phase, hasDelivery, rowCount, phase === 'ended' && hasDelivery && rowCount > 0])
        }
      }
    }
    for (const [phase, hasDelivery, rowCount, want] of expected) {
      expect(cardVisible({ phase, delivery: hasDelivery ? delivery() : undefined, rowCount })).toBe(want)
    }
  })
})
