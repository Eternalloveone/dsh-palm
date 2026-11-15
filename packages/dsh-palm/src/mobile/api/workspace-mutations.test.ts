/**
 * `workspace.archiveSession`：应答里的全量归档集必须当场记下来。
 *
 * 一次全量枚举要 6~23 秒，它可能在删之前就出发了 —— 那份快照的 `archivedSessionIds`
 * 不含刚删的 id，装回去就等于把删掉的会话又发回手机（还会落盘）。所以归档应答里
 * 自带的这份全量归档集，是那次在飞枚举唯一可用的"更新事实"。
 */
import { describe, expect, it } from 'vitest'
import type { ApiProxy } from '../../api-proxy-types.ts'
import { preferArchivedIds, recordArchivedIds } from '../../host/session-roster.ts'
import { workspaceArchiveSession } from './workspace-mutations.ts'

/** 一枚归档应答（宿主外壳照真实形状来：{ rpcId, result: { ok, value } }）。 */
function archiveResponse(archivedSessionIds: string[]): unknown {
  return { rpcId: 'r1', result: { ok: true, value: { archivedSessionIds } } }
}

function contextOf(apiProxy: ApiProxy): Parameters<typeof workspaceArchiveSession>[0] {
  return { apiProxy, rpcId: 'r1', request: { sessionId: 'session-s-1' }, invalidateRosterCaches: () => {} }
}

describe('workspaceArchiveSession', () => {
  it('应答里的全量归档集立刻成为"比枚举新"的那份', async () => {
    recordArchivedIds([], 0) // 清空覆盖值，模拟一个干净的进程
    const apiProxy = {
      workspace: { archiveSession: () => Promise.resolve(archiveResponse(['session-s-1', 'session-old'])) },
    } as unknown as ApiProxy

    const frame = await workspaceArchiveSession(contextOf(apiProxy))
    // 手机端要的应答外壳不变。
    expect(frame).toMatchObject({ type: 'server-response', rpcId: 'r1', result: { ok: true } })
    // 比它更年轻的枚举必须采用它 —— 否则这次枚举会把刚删的会话装回快照。
    const olderEnumeration = preferArchivedIds(Date.now() - 1_000, new Set(['session-old']))
    expect([...olderEnumeration].sort()).toEqual(['session-old', 'session-s-1'])
  })

  it('失败应答不记任何东西（不拿半截数据改归档集）', async () => {
    recordArchivedIds([], 0)
    const apiProxy = {
      workspace: {
        archiveSession: () => Promise.resolve({ rpcId: 'r1', result: { ok: false, error: { code: 'denied', message: 'x' } } }),
      },
    } as unknown as ApiProxy

    await workspaceArchiveSession(contextOf(apiProxy))
    const enumerated = new Set(['session-old'])
    expect(preferArchivedIds(Date.now() - 1_000, enumerated)).toBe(enumerated)
  })
})
