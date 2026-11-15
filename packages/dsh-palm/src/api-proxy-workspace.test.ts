/**
 * `workspace.list` → `workspace.follow` 适配器：归档集要带**版本号**。
 *
 * 为什么需要版本号：这份归档集是活的（follow 增量维护），而手机端的花名册快照只在
 * 下一次全量枚举时才抄一份 —— 没有版本号，读列表的人分不清"活值比快照新"还是
 * "follow 流还没起来（空集不可信）"，只能继续等那一分钟，或者更糟：把空集当真，
 * 于是所有归档会话一起回到列表。
 */
import { describe, expect, it } from 'vitest'
import type { WorkspaceController } from '@deepseek-ai/dsh-api-workspace-controller'
import { WorkspaceListAdapter } from './api-proxy-workspace.ts'

/** 可由测试逐帧推进的假 follow 流。 */
function fakeController(): { controller: WorkspaceController; push: (frame: unknown) => void } {
  const queue: unknown[] = []
  let wake: (() => void) | undefined
  async function* frames(): AsyncGenerator<unknown> {
    for (;;) {
      if (queue.length === 0) await new Promise<void>(resolve => { wake = resolve })
      while (queue.length > 0) yield queue.shift()
    }
  }
  const controller = {
    follow: () => frames(),
  } as unknown as WorkspaceController
  return {
    controller,
    push: (frame) => { queue.push(frame); wake?.(); wake = undefined },
  }
}

/** 让 follow 的 for-await 走完一轮。 */
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

describe('WorkspaceListAdapter：归档集变化时刻', () => {
  it('baseline 之前是 0（不可信），baseline 与每帧 archived 增量都会刷新它', async () => {
    const { controller, push } = fakeController()
    const adapter = new WorkspaceListAdapter(controller)
    try {
      const before = await adapter.list()
      expect(before.archivedChangedAt).toBe(0)
      expect(before.archivedSessionIds).toEqual([])

      push({ type: 'baseline', value: { items: [], archivedSessionIds: ['session-a'] } })
      await settle()
      const afterBaseline = await adapter.list()
      expect(afterBaseline.archivedChangedAt).toBeGreaterThan(0)
      expect(afterBaseline.archivedSessionIds).toEqual(['session-a'])

      const baselineAt = afterBaseline.archivedChangedAt
      push({ type: 'archived', archivedSessionIds: ['session-a', 'session-b'] })
      await settle()
      const afterArchive = await adapter.list()
      // 桌面/另一台手机删了会话：时刻必须往前走，读列表的人才知道"活值比快照新"。
      expect(afterArchive.archivedChangedAt).toBeGreaterThan(baselineAt)
      expect(afterArchive.archivedSessionIds).toEqual(['session-a', 'session-b'])
    } finally {
      adapter.dispose()
    }
  })
})
