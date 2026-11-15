// @vitest-environment jsdom
/**
 * 回合尾行的渲染契约（2026-11-14 单一真源版）。
 *
 * 历史：2026-11-08 起「会话正文流」把交付卡挂在回合尾行上；2026-11-10 P4 做了四态；
 * 2026-11-14 重构后**尾行不再画任何卡** —— 卡的可见性只有一个纯函数
 * （`session/deliveries.ts` 的 `cardVisible`）、只有一个渲染点（ChatRows 末尾槽位）。
 *
 * 为什么删掉这条渲染路：两个渲染点 + 两套判定，任何一次分叉都会出现"一张在、一张不在"
 * 或"先画后撤"（真机连着复现四次）。尾行现在只是**数据**（turn/end 折出来的收尾行），
 * 不上屏；卡的数据契约由 `session/card-visible.test.ts` 与 `session/deliveries.test.ts` 守。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MessageRow } from './message-row.tsx'
import type { RenderMessage } from './messages.ts'

/** 造一条回合尾行（只填本用例关心的字段）。 */
function turnRow(overrides: Partial<RenderMessage> = {}): RenderMessage {
  return {
    id: 'tail-1',
    kind: 'turn',
    text: '重构已完成。',
    seq: 5,
    time: 0,
    turn: 1,
    ...overrides,
  } as RenderMessage
}

function renderRow(message: RenderMessage, completed?: boolean): { container: HTMLElement } {
  const { container } = render(
    <MessageRow
      message={message}
      showToolCalls={false}
      showSystemMessages={false}
      {...(completed === undefined ? {} : { turnCompleted: completed })}
    /> as never,
  )
  return { container }
}

afterEach(() => { cleanup() })

describe('回合尾行 → 不上屏（卡只在 ChatRows 末尾槽位）', () => {
  it('有交付物的收尾行：行内不画卡（卡由末尾槽位负责）', () => {
    const { container } = renderRow(turnRow({ deliverables: [{ path: 'docs/report.md', description: '交付报告' }] }))
    expect(container.querySelector('.palm-delivery')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('有产出文件的收尾行：同样不画卡', () => {
    const { container } = renderRow(turnRow({ produced: ['src/a.ts'] }))
    expect(container.querySelector('.palm-delivery')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('失败态也不例外：终态由状态条 + 末尾槽位表达，尾行不再自造一张卡', () => {
    const { container } = renderRow(turnRow({ failed: true }), false)
    expect(container.querySelector('.palm-delivery')).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('中断未标记失败：不猜成功、也不画卡', () => {
    const { container } = renderRow(turnRow({}), false)
    expect(container.querySelector('.palm-delivery')).toBeNull()
  })

  it('收尾行没有任何 DOM 产物（连包装层都不留）', () => {
    const { container } = renderRow(turnRow({ deliverables: [{ path: 'a.ts' }], produced: ['b.ts'] }))
    expect(container.querySelector('.chat-turn-tail-row')).toBeNull()
    expect(container.childElementCount).toBe(0)
  })
})
