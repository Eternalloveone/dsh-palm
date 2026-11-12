/**
 * `session.list` 的工作区过滤契约（2026-11-10「切换不了工作区 / 会话列表显示失效」）。
 *
 * 症状是抽屉里会话列表要么一片空白、要么把所有工作区的会话混在一起，切换工作区
 * 看起来没反应。根因在宿主侧这段过滤的三种退化：
 *
 * 1. 归属表里**有**这个工作区 → 只发属于它的行；
 * 2. 归属表里**没有**这个工作区 → 以前会把**全量**发回去（于是每个工作区长得一样，
 *    用户以为"切不动"）→ 现在必须回空页；
 * 3. 归属表里它是空集 → 回空页（一直是这么做的，这里钉住别回退）。
 *
 * 这里直接喂真实的 TTL 缓存形状，不跑枚举：过滤逻辑才是要钉住的东西。
 */
import { describe, expect, it } from 'vitest'
import type { ApiProxy } from '../../api-proxy-types.ts'
import { setRosterOwnedCache, setRosterTtlCache } from '../../host/session-roster.ts'
import { sessionList } from './session-list-handler.ts'

/** 假宿主：这两条用例不该触发枚举，真被调用就说明缓存没生效。 */
const proxy = {
  sessions: {
    list: () => Promise.reject(new Error('不该枚举：TTL 缓存应当命中')),
  },
  workspace: {
    list: () => Promise.reject(new Error('不该枚举：TTL 缓存应当命中')),
  },
} as unknown as ApiProxy

/** 三个会话：s1/s2 属于 ws-a，s3 属于 ws-b。 */
const RAW = [
  { sessionId: 's1', updatedAt: 300 },
  { sessionId: 's2', updatedAt: 200 },
  { sessionId: 's3', updatedAt: 100 },
]

function prime(owned: Map<string, Set<string>>): void {
  setRosterTtlCache({
    at: Date.now(),
    proxy,
    rawItems: RAW.map(item => ({ ...item })),
    archivedIds: new Set<string>(),
  })
  setRosterOwnedCache(owned)
}

/** 归属表构造器：`[工作区, [会话...]]`，省掉嵌套 `new Map/new Set` 的括号汤。 */
function owned(entries: ReadonlyArray<readonly [string, readonly string[]]>): Map<string, Set<string>> {
  return new Map(entries.map(([id, ids]) => [id, new Set(ids)] as const))
}

/** 取回一页的 sessionId 序列（宿主外壳解开）。 */
async function idsOf(payload: { workspaceId?: string }): Promise<string[]> {
  const frame = await sessionList({ apiProxy: proxy, rpcId: 'r1', request: {}, payload }) as {
    result: { ok: boolean; value?: { items?: Array<{ sessionId: string }> } }
  }
  expect(frame.result.ok).toBe(true)
  return (frame.result.value?.items ?? []).map(item => String(item.sessionId))
}

describe('session.list 的工作区过滤', () => {
  it('归属表里有这个工作区：只发属于它的会话，按更新时间倒序', async () => {
    prime(owned([['ws-a', ['s1', 's2']], ['ws-b', ['s3']]]))
    await expect(idsOf({ workspaceId: 'ws-a' })).resolves.toEqual(['s1', 's2'])
    await expect(idsOf({ workspaceId: 'ws-b' })).resolves.toEqual(['s3'])
  })

  it('归属表里没有这个工作区：回空页，不能把别的工作区的会话塞过来', async () => {
    // 这就是"切换不了工作区"的形状：归属表落后一拍（新工作区/刚建的工作区），
    // 旧的实现会回全量，于是切到哪个工作区看到的都是同一份列表。
    prime(owned([['ws-a', ['s1', 's2']], ['ws-b', ['s3']]]))
    await expect(idsOf({ workspaceId: 'ws-new' })).resolves.toEqual([])
  })

  it('归属表里是空集：回空页（不能变成"永远有下一页的空页"）', async () => {
    prime(owned([['ws-empty', []]]))
    await expect(idsOf({ workspaceId: 'ws-empty' })).resolves.toEqual([])
  })

  it('整个归属表都没有（老宿主 / 枚举失败）：不过滤，保持向后兼容', async () => {
    prime(new Map())
    setRosterOwnedCache(undefined)
    await expect(idsOf({ workspaceId: 'ws-a' })).resolves.toEqual(['s1', 's2', 's3'])
  })

  it('不带 workspaceId：发全量（抽屉之外的老调用点不变）', async () => {
    prime(owned([['ws-a', ['s1', 's2']]]))
    await expect(idsOf({})).resolves.toEqual(['s1', 's2', 's3'])
  })
})
