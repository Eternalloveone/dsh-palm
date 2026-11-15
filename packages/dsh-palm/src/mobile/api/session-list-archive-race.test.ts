/**
 * 「枚举途中被删的会话，不许被这次枚举装回来」（2026-11-15 真机根治）。
 *
 * 症状：手机上删掉一个会话，过一会儿它又在列表里出现（还写进落盘快照，重启后
 * 从快照读回来）。
 *
 * 根因：`session.list` 的全量枚举要 6~23 秒。删会话时 `invalidateRosterCaches()`
 * 只清了 TTL 缓存，**已经在飞的那次枚举**照样把结果装回去，而它手里的
 * `archivedSessionIds` 是删之前的 —— 归档集就退回了旧值。
 *
 * 修法：`workspace.archiveSession` 的应答自带全量归档集，删完当场记下
 * （`recordArchivedIds`）；装快照时按时间戳二选一（`preferArchivedIds`）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { ApiProxy } from '../../api-proxy-types.ts'
import {
  preferArchivedIds,
  recordArchivedIds,
  rosterTtlCache,
  setRosterOwnedCache,
  setRosterTtlCache,
} from '../../host/session-roster.ts'
import { sessionList } from './session-list-handler.ts'
import { resetArchivedSessionIdsForTest } from '../session/list-persist.ts'
import { resetRecentHistoryForTest } from '../data/impl/session.ts'
import { processState } from './process-state.ts'
import { workspaceArchiveSession } from './workspace-mutations.ts'

/** 一枚可手动解开的 promise：用来把「枚举在飞」这个时刻钉住。 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

/** 一页宿主应答的外壳（本文件只关心 items 的 sessionId 序列）。 */
function hostPage(ids: readonly string[]): unknown {
  return {
    result: {
      ok: true,
      value: {
        items: ids.map((sessionId, index) => ({ sessionId, updatedAt: ids.length - index })),
      },
    },
  }
}

/** 解开 session.list 的应答外壳，取出这一页的顺序。 */
async function listIds(apiProxy: ApiProxy): Promise<string[]> {
  const frame = await sessionList({ apiProxy, rpcId: 'r1', request: {}, payload: {} }) as {
    result: { ok: boolean; value?: { items?: Array<{ sessionId: string }> } }
  }
  expect(frame.result.ok).toBe(true)
  return (frame.result.value?.items ?? []).map(item => String(item.sessionId))
}

/** 让出一条微任务/宏任务，等枚举走到「workspace.list 已回、sessions.list 还在飞」。 */
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

beforeEach(() => {
  // 这两个是模块级缓存：不清掉的话下一条用例会直接命中别人的快照。
  setRosterTtlCache(undefined)
  setRosterOwnedCache(undefined)
  processState.sessionRosterInFlight = undefined
  // 归档覆盖值也用时间戳 0 清空（没有专门的 reset 出口，用完即弃是它的设计）。
  recordArchivedIds([], 0)
  // 客户端那份「已知归档集」同样是模块级：别的用例删过会话，这里会把它们当已归档，
  // 整目录一起跑就红、单独跑却绿（Vitest 同进程多文件共享模块状态）。
  resetArchivedSessionIdsForTest()
  // 历史页短期缓存（2026-11-15 加的）也是模块级：不清掉，下一条用例会拿到上一条的页。
  resetRecentHistoryForTest()
})

describe('session.list：枚举与归档的竞态', () => {
  it('枚举途中删掉的会话，不会被这次枚举装回列表（也不进落盘快照）', async () => {
    const full = deferred<unknown>()
    const apiProxy = {
      sessions: { list: () => full.promise },
      // workspace.list 先回，而且带回的是**删之前**的归档集（空）。
      workspace: { list: () => Promise.resolve({ result: { ok: true, value: { items: [], archivedSessionIds: [] } } }) },
    } as unknown as ApiProxy

    const pending = listIds(apiProxy)
    await settle()
    // 此刻枚举还在飞：手机删掉 s-2，应答带回全量归档集。
    recordArchivedIds(['session-s-2'])
    full.resolve(hostPage(['session-s-1', 'session-s-2']))

    await expect(pending).resolves.toEqual(['session-s-1'])
  })

  it('先删再枚举（写应答比枚举旧）：用枚举自己那份归档集，不会错杀', async () => {
    recordArchivedIds(['session-s-2'])
    await settle() // 让归档应答的时刻严格早于下面的枚举
    const apiProxy = {
      sessions: { list: () => Promise.resolve(hostPage(['session-s-1', 'session-s-2'])) },
      workspace: { list: () => Promise.resolve({ result: { ok: true, value: { items: [], archivedSessionIds: ['session-s-2'] } } }) },
    } as unknown as ApiProxy

    await expect(listIds(apiProxy)).resolves.toEqual(['session-s-1'])
  })

  it('没有归档应答时（老宿主 / 写失败）：照旧用枚举的归档集', async () => {
    const apiProxy = {
      sessions: { list: () => Promise.resolve(hostPage(['session-s-1', 'session-s-2'])) },
      workspace: { list: () => Promise.resolve({ result: { ok: true, value: { items: [], archivedSessionIds: ['session-s-2'] } } }) },
    } as unknown as ApiProxy

    await expect(listIds(apiProxy)).resolves.toEqual(['session-s-1'])
  })

  /**
   * 第二条退化路径（2026-11-15 同批根治）：`workspace.list` 这次**没拿到**
   * （超时/失败）时，旧代码把归档集当成空集 —— 于是所有归档过的会话一起回到手机
   * 列表（库里 499 条归档，等于列表炸开）。现在退回"最近一次可信的归档集"。
   */
  it('工作区列表这次没拿到：沿用上一份归档集，不退回空集', async () => {
    const first = {
      sessions: { list: () => Promise.resolve(hostPage(['session-s-1', 'session-s-2'])) },
      workspace: { list: () => Promise.resolve({ result: { ok: true, value: { items: [], archivedSessionIds: ['session-s-2'] } } }) },
    } as unknown as ApiProxy
    await expect(listIds(first)).resolves.toEqual(['session-s-1'])

    // 下一轮枚举：工作区列表失败，会话全量照旧回来。
    setRosterTtlCache(undefined)
    const second = {
      sessions: { list: () => Promise.resolve(hostPage(['session-s-1', 'session-s-2'])) },
      workspace: { list: () => Promise.reject(new Error('workspace.list 超时')) },
    } as unknown as ApiProxy
    await expect(listIds(second)).resolves.toEqual(['session-s-1'])
  })
})

/**
 * 归档应答到达时**就地摘行**（不再整份作废快照）。
 *
 * 原做法：写操作后一律作废花名册 → 下一次读列表等一次冷枚举（实测 6~23 秒），
 * 手机那头就是"删完再开抽屉，先看到旧行、然后转圈十几秒"。归档应答自带全量
 * 归档集，就地摘行就够 —— 这一刻起读列表必须已经正确，且**不许触发枚举**。
 */
describe('归档后的快照（就地摘行）', () => {
  it('删完立刻正确：行被摘掉、归档集换成应答那份，且不触发全量枚举', async () => {
    setRosterTtlCache({
      at: Date.now(),
      proxy: {} as ApiProxy,
      rawItems: [{ sessionId: 'session-s-1', updatedAt: 3 }, { sessionId: 'session-s-2', updatedAt: 2 }],
      archivedIds: new Set(['session-old']),
    })
    const apiProxy = {
      // 归档路径一旦去枚举就说明"就地摘行"没生效。
      sessions: { list: () => Promise.reject(new Error('归档不该触发全量枚举')) },
      workspace: {
        archiveSession: () => Promise.resolve({
          rpcId: 'r1',
          result: { ok: true, value: { archivedSessionIds: ['session-old', 'session-s-2'] } },
        }),
      },
    } as unknown as ApiProxy

    await workspaceArchiveSession({
      apiProxy,
      rpcId: 'r1',
      request: { sessionId: 'session-s-2' },
      // 已经能就地修好，就不该再整份作废（作废 = 下一次读要等冷枚举）。
      invalidateRosterCaches: () => { throw new Error('不该整份作废花名册') },
    })

    const cache = rosterTtlCache()
    expect(cache?.rawItems.map(row => row.sessionId)).toEqual(['session-s-1'])
    expect([...(cache?.archivedIds ?? [])].sort()).toEqual(['session-old', 'session-s-2'])
  })
})

/**
 * 归档集取**活值**：`workspace.follow` 维护的那份，比快照新就用它。
 *
 * 治的是"桌面删掉的会话，手机上还要挂一分钟"（TTL 30s + 刷新节流 60s）。活值一帧
 * 就到，读列表时顺手取一次即可 —— 但必须只在版本号明确更新时才换：还没 baseline
 * 的空集不可信，照单全收会让 499 条归档会话一起回到列表。
 */
describe('归档集活值', () => {
  /** 一枚快照（`at` 越新越不容易触发刷新；见各用例自己的时刻）。 */
  function primeRoster(proxy: ApiProxy, archivedIds: string[], at: number): void {
    setRosterTtlCache({
      at,
      proxy,
      rawItems: [{ sessionId: 'session-s-1', updatedAt: 2 }, { sessionId: 'session-s-2', updatedAt: 1 }],
      archivedIds: new Set(archivedIds),
    })
  }

  it('活值比快照新：立刻按活值过滤，且不触发枚举', async () => {
    let enumerations = 0
    const apiProxy = {
      sessions: { list: () => { enumerations += 1; return Promise.reject(new Error('不该枚举')) } },
      workspace: {
        list: () => Promise.resolve({
          result: { ok: true, value: { items: [], archivedSessionIds: ['session-s-2'], archivedChangedAt: Date.now() } },
        }),
      },
    } as unknown as ApiProxy
    // 快照 5 秒前抄的（还没到 TTL），活值刚刚变过 ⇒ 必须用活值。
    primeRoster(apiProxy, [], Date.now() - 5_000)

    await expect(listIds(apiProxy)).resolves.toEqual(['session-s-1'])
    await settle()
    expect(enumerations).toBe(0)
  })

  it('活值不比快照新：用快照自己的归档集', async () => {
    const apiProxy = {
      sessions: { list: () => Promise.reject(new Error('不该枚举')) },
      workspace: {
        list: () => Promise.resolve({
          result: { ok: true, value: { items: [], archivedSessionIds: [], archivedChangedAt: Date.now() - 60_000 } },
        }),
      },
    } as unknown as ApiProxy
    // 快照是 5 秒前抄的，活值停在 60 秒前 ⇒ 快照更新，按快照把 s-2 藏起来。
    primeRoster(apiProxy, ['session-s-2'], Date.now() - 5_000)

    await expect(listIds(apiProxy)).resolves.toEqual(['session-s-1'])
  })

  it('还没 baseline（变化时刻 0）：不把空集当真，继续用快照', async () => {
    const apiProxy = {
      sessions: { list: () => Promise.reject(new Error('不该枚举')) },
      workspace: {
        list: () => Promise.resolve({
          result: { ok: true, value: { items: [], archivedSessionIds: [], archivedChangedAt: 0 } },
        }),
      },
    } as unknown as ApiProxy
    // 快照里 499 条归档、活值还是空 —— 按活值过滤会把它们全放回来。
    primeRoster(apiProxy, ['session-s-2'], Date.now())

    await expect(listIds(apiProxy)).resolves.toEqual(['session-s-1'])
  })
})

describe('preferArchivedIds', () => {  it('写应答比枚举新：采用应答的那份', () => {
    recordArchivedIds(['a', 'b'])
    expect([...preferArchivedIds(Date.now() - 1_000, new Set(['a']))].sort()).toEqual(['a', 'b'])
  })

  it('写应答比枚举旧：用枚举的，并把过期覆盖丢掉（不留在进程里）', () => {
    recordArchivedIds(['a', 'b'])
    const older = new Set(['a'])
    expect(preferArchivedIds(Date.now() + 1_000, older)).toBe(older)
    // 丢过一次之后，再新的枚举也不会被它干扰。
    expect([...preferArchivedIds(0, new Set(['a']))]).toEqual(['a'])
  })
})
