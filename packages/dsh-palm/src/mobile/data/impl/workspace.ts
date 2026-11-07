/**
 * **data 实现 · workspace 域**（W4-4：按域切分 `api.ts`）。
 *
 * 这些函数原来都挤在 `api.ts` 里——73 个端点一个文件，谁也说不清改一处会碰到谁。
 * 现在按域归位；`api.ts` 保留 re-export，所以调用点一行都不用改。
 *
 * @module dsh-palm/mobile/data/impl/workspace
 */
import { callUnary } from '../../rpc.ts'
import { WORKSPACE_ROSTER_TTL_MS } from '../limits.ts'
import { rosterCached, rosterInFlight, setRosterCached, setRosterInFlight } from '../workspace-roster.ts'
// 花名册失效的唯一出口在数据层（api.ts 只是转出），域实现直接用它。
import { invalidateWorkspaceRoster } from '../invalidate-roster.ts'
import type { AgentPresetRoster, UploadedAttachment, WorkspaceCreateResult } from '../../mobile-types.ts'
import type { WorkspaceView } from '../../../api-proxy-types'

/** The workspace roster (session ids come back per workspace). */
export async function listWorkspaces(): Promise<WorkspaceView[]> {
  const cached = rosterCached()
  if (cached !== undefined && Date.now() - cached.at < WORKSPACE_ROSTER_TTL_MS) return cached.items
  const inFlight = rosterInFlight()
  if (inFlight !== undefined) return inFlight
  const run = callUnary<{ items: WorkspaceView[] }>('workspace.list', {})
    .then(({ items }) => {
      setRosterCached({ at: Date.now(), items })
      return items
    })
    .finally(() => { setRosterInFlight(undefined) })
  setRosterInFlight(run)
  return run
}

/** Create a workspace from an existing host directory (does not mkdir). */
export async function createWorkspace(path: string): Promise<WorkspaceCreateResult> {
  const created = await callUnary<WorkspaceCreateResult>('workspace.create', { path })
  // 刚建好的工作区必须立刻出现在花名册里，不能被 5 秒窗口挡住。
  invalidateWorkspaceRoster()
  return created
}

/** Remove a workspace registration (the directory and session logs stay). */
export async function deleteWorkspace(workspaceId: string): Promise<{ deleted: true }> {
  const deleted = await callUnary<{ deleted: true }>('workspace.delete', { workspaceId })
  // 删掉的行不能再从复用窗口里画回来。
  invalidateWorkspaceRoster()
  return deleted
}

/** Rename a workspace's display title (host validates trim/conflict). */
export async function renameWorkspace(workspaceId: string, title: string): Promise<{ workspace: WorkspaceView }> {
  const renamedWs = await callUnary<{ workspace: WorkspaceView }>('workspace.rename', { workspaceId, title })
  // 改完名字回列表要看到新名字。
  invalidateWorkspaceRoster()
  return renamedWs
}

/** Read the available agent compositions for a new session. */
export async function listAgentPresets(): Promise<AgentPresetRoster> {
  return await callUnary<AgentPresetRoster>('agentPreset.list', {})
}

/**
 * 把一份附件交给宿主暂存。
 *
 * `signal` 是**用户取消**用的（弱网传 20 MB 卡住时，chip 上要能点掉重来）。
 * 超时另有 120 秒的兜底，两者互相独立：取消是主动的，超时是兜底。
 */
export async function uploadAttachment(
  sessionId: string,
  file: { name: string; data: string },
  signal?: AbortSignal,
): Promise<UploadedAttachment> {
  return await callUnary<UploadedAttachment>('mobile.uploadAttachment', { sessionId, ...file }, signal, 120_000)
}
