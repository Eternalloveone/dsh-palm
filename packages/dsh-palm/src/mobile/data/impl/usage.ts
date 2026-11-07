/**
 * **data 实现 · usage 域**（W4-4：按域切分 `api.ts`）。
 *
 * 这些函数原来都挤在 `api.ts` 里——73 个端点一个文件，谁也说不清改一处会碰到谁。
 * 现在按域归位；`api.ts` 保留 re-export，所以调用点一行都不用改。
 *
 * @module dsh-palm/mobile/data/impl/usage
 */
import { callUnary } from '../../platform/rpc.ts'
import type { HostFinishedRun, UsageView } from '../../mobile-types.ts'

/** 记一条到宿主账本（fire-and-forget：本地已经先记了，这里只是同步）。 */
export async function appendFinishedRun(entry: HostFinishedRun): Promise<void> {
  await callUnary('mobile.finishedRuns', { op: 'append', entries: [entry] })
}

/**
 * 清空**宿主**那本「刚结束」账本。
 *
 * 只清本地那一本是不够的：进页面时还会 `fetchFinishedRuns()` 与宿主账本合并，
 * 于是「全部清空」之后退出再进来，刚清掉的会话又全都回来了（真机 2026-10-30）。
 */
export async function clearHostFinishedRuns(): Promise<void> {
  await callUnary('mobile.finishedRuns', { op: 'clear' })
}

/** 读宿主账本（跨刷新、跨设备都在）。失败就当没有。 */
export async function fetchFinishedRuns(): Promise<HostFinishedRun[]> {
  const value = await callUnary<{ entries: HostFinishedRun[] }>('mobile.finishedRuns', { op: 'read' })
  return Array.isArray(value.entries) ? value.entries : []
}

/**
 * Fetch the per-provider usage/balance surface (`mobile.usage`, answered by the
 * plugin host-side). The desktop's configured providers drive the rows; a
 * provider with no public balance/usage endpoint is labelled `unsupported`, one
 * the desktop has no key for is `no-key`. Pass `refresh` to bypass the host's
 * short cache.
 */
export async function fetchUsage(refresh?: boolean): Promise<UsageView> {
  return await callUnary<UsageView>('mobile.usage', refresh === true ? { refresh: true } : {})
}

/**
 * 从宿主账本里删掉一个会话的「刚结束」记录（用户已经点进去看过了）。
 *
 * 只删这一条：运行中页的口径是「只保留没打开过的」，所以打开即删。
 */
export async function removeHostFinishedRun(sessionId: string): Promise<void> {
  await callUnary('mobile.finishedRuns', { op: 'remove', sessionIds: [sessionId] })
}
