/**
 * 行渲染的一条判定（S8b）：`dedupeRows` —— 同一 id 的行只渲染一次（真机：重进正在跑的
 * 会话每行画两遍）。
 *
 * 交付卡的可见性判定在 2026-11-14 收敛成**一个纯函数**（`session/deliveries.ts` 的
 * `cardVisible`），这里不再有 `shouldRenderCard` 那套"证据链"：它的用例随旧实现一起
 * 迁到 `session/card-visible.test.ts`（相位 × 行数 × 账本的穷举矩阵）。
 */
import { describe, expect, it } from 'vitest'
import type { RenderMessage } from '../../../render/messages.ts'
import { dedupeRows } from './chat-rows.tsx'

const user = (id: string): RenderMessage => ({ kind: 'user', id, text: id } as unknown as RenderMessage)

describe('dedupeRows', () => {
  it('同一行（同 id）只出现一次，顺序保持', () => {
    const rows = dedupeRows([user('a'), user('b'), user('a'), user('c')])
    expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c'])
  })
})
