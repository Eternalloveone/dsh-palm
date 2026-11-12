/**
 * 工作区的三个写操作（新建 / 重命名 / 删除），供「切换工作区」面板调用。
 *
 * 为什么独立成 hook：三个动作的前半段完全一样 —— 调宿主 → **重新拉一次列表** → 需要时落页。
 * 写进 `App.tsx` 会让那个文件再涨二十来行（它本来就有行数预算），而且"删掉当前工作区之后
 * 该落哪一页"这种规则埋在视图里没人找得到。
 *
 * @module dsh-palm/mobile/views/chat/hooks/use-workspace-actions
 */
import { useCallback } from 'react'
import type { WorkspaceView } from '../../../../api-proxy-types'
import { createWorkspace, deleteWorkspace, listWorkspaces, renameWorkspace } from '../../../data/workspace.ts'

/** 面板需要的三个动作。 */
export interface WorkspaceActions {
  /** 登记一个新工作区并切过去。 */
  create(path: string): Promise<void>
  /** 改名（不动磁盘）。 */
  rename(workspaceId: string, title: string): Promise<void>
  /** 从列表删除（不动磁盘）；删的是当前工作区时自动落到剩下的第一个。 */
  remove(workspaceId: string): Promise<void>
}

/** 依赖：列表 setter、落页函数与当前工作区 id（都由 App 提供）。 */
export interface UseWorkspaceActionsOptions {
  setWorkspaces(rows: readonly WorkspaceView[]): void
  pickWorkspace(workspace: WorkspaceView): void
  /** 当前工作区 id：删掉它时要落到别处，删别的不用动页面。 */
  currentWorkspaceId: string
}

/**
 * 造三个写操作。
 *
 * 每次写完都重新拉 `workspace.list`，而不是本地拼一行：宿主的 `workspaceId`/`updatedAt`
 * 由它自己算，本地猜一个 id 会让紧接着的删除/重命名打空（真机上表现为"点了没反应"）。
 *
 * @param options - 列表 setter 与落页函数
 * @returns 三个动作
 */
export function useWorkspaceActions(options: UseWorkspaceActionsOptions): WorkspaceActions {
  const { setWorkspaces, pickWorkspace, currentWorkspaceId } = options

  /**
   * 重新拉列表；给了 `switchTo` 就落到那个工作区。
   *
   * @param switchTo - 目标工作区 id（空串/未给 = 只刷新）
   */
  const reload = useCallback(async (switchTo?: string): Promise<void> => {
    const rows = (await listWorkspaces()) ?? []
    setWorkspaces(rows)
    if (switchTo === undefined || switchTo === '') return
    const target = rows.find(row => String(row.workspaceId) === switchTo)
    if (target !== undefined) pickWorkspace(target)
  }, [pickWorkspace, setWorkspaces])

  const create = useCallback(async (path: string): Promise<void> => {
    const created = await createWorkspace(path)
    await reload(String(created.workspace.workspaceId ?? ''))
  }, [reload])

  const rename = useCallback(async (workspaceId: string, title: string): Promise<void> => {
    await renameWorkspace(workspaceId, title)
    await reload()
  }, [reload])

  const remove = useCallback(async (workspaceId: string): Promise<void> => {
    await deleteWorkspace(workspaceId)
    const rows = (await listWorkspaces()) ?? []
    setWorkspaces(rows)
    // 删的不是当前工作区：页面保持不动（用户只是在整理列表）。
    if (workspaceId !== currentWorkspaceId) return
    // 删的正好是当前工作区：落到剩下的第一个，否则页面会停在一个已经不存在的目录上。
    const next = rows[0]
    if (next !== undefined) pickWorkspace(next)
  }, [currentWorkspaceId, pickWorkspace, setWorkspaces])

  return { create, rename, remove }
}
