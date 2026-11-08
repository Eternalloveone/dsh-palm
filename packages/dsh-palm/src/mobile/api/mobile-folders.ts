/**
 * `mobile.folders` 的实现（P2：整方法外移）。
 *
 * 会话分组（F1）：一个方法、按 action 分派（list/create/rename/remove/assign）。
 * 接口面很小，而且**每个动作都回完整快照**——这样手机永远不用自己合并部分状态。
 *
 * @module dsh-palm/mobile/api/mobile-folders
 */
import type { ServerResponse } from 'node:http'
import { writeJson } from '../../http.ts'

/** 分组服务里本域用到的最小面。 */
interface FoldersView {
  list: () => unknown
  create: (name: unknown) => unknown
  rename: (folderId: string, name: unknown) => boolean
  remove: (folderId: string) => unknown
  assign: (sessionId: string, folderId: string | null) => boolean
}

/** 处理器上下文。 */
export interface FoldersContext {
  res: ServerResponse
  parsed: { payload?: unknown }
  rpcId: string
  deps: { folders?: FoldersView }
}

/** 分组的新增/改名/删除/指派，每个动作都回完整快照。 */
export function mobileFolders(ctx: FoldersContext): void {
  const { res, parsed, rpcId } = ctx
  const folders = ctx.deps.folders
  if (folders === undefined) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code: 'unavailable', message: '会话分组不可用' } },
    })
    return
  }
  const body = parsed.payload as {
    action?: unknown
    name?: unknown
    folderId?: unknown
    sessionId?: unknown
  } | undefined
  const action = typeof body?.action === 'string' ? body.action : 'list'

  if (action === 'list') {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: folders.list() },
    })
    return
  }
  if (action === 'create') {
    const created = folders.create(body?.name)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: created === undefined
        ? { ok: false, error: { code: 'bad-request', message: '分组名不可用或已存在' } }
        : { ok: true, value: { ...(folders.list() as object), created } },
    })
    return
  }
  if (action === 'rename') {
    const folderId = typeof body?.folderId === 'string' ? body.folderId : ''
    const renamed = folders.rename(folderId, body?.name)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: renamed
        ? { ok: true, value: folders.list() }
        : { ok: false, error: { code: 'bad-request', message: '分组不存在或改名失败' } },
    })
    return
  }
  if (action === 'remove') {
    const folderId = typeof body?.folderId === 'string' ? body.folderId : ''
    const removed = folders.remove(folderId)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: { ok: true, value: { ...(folders.list() as object), removed } },
    })
    return
  }
  if (action === 'assign') {
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    const folderId = typeof body?.folderId === 'string' ? body.folderId : null
    const assigned = folders.assign(sessionId, folderId)
    writeJson(res, 200, {
      type: 'server-response',
      rpcId,
      result: assigned
        ? { ok: true, value: folders.list() }
        : { ok: false, error: { code: 'bad-request', message: '分组不存在' } },
    })
    return
  }
  writeJson(res, 200, {
    type: 'server-response',
    rpcId,
    result: { ok: false, error: { code: 'bad-request', message: '未知的分组操作' } },
  })
}
