/**
 * 「最近用过」的活动时间：把会话的活动归到工作区，供切换面板排序。
 *
 * 为什么要单独一个 hook：`workspace.updatedAt` 只在建工作区/改名时刷新，**跑会话不动它**
 * （2026-11-11 真机：`某个工作区目录` 今天一直在跑，字段停在 5 天前，于是「最近用过」
 * 里没有它，用户直接问「我一直在跑却不在最近使用里」）。真实活动在会话上，所以这里在
 * 面板**打开时**拉一页会话，按 `sessionIds` / `cwd` 归到工作区，取最大值。
 *
 * 只在需要时拉（面板关着不请求）；失败就当没有活动信息 —— 面板照旧按
 * `workspace.updatedAt` 排序，不会因此打不开。
 *
 * @module dsh-palm/mobile/views/chat/hooks/use-workspace-activity
 */
import { useEffect, useMemo, useState } from 'react'
import { listSessions } from '../../../data/session.ts'
import {
  workspaceActivityOf,
  type SessionLike,
  type WorkspaceLike,
} from '../components/workspace-picker-model.ts'

/**
 * 订阅工作区活动时间。
 *
 * @param workspaces - 全量工作区（用于把会话归属到工作区）
 * @param enabled - 面板是否打开（关上就不请求）
 * @returns 工作区 id → 最新一次会话活动（毫秒）
 */
export function useWorkspaceActivity(
  workspaces: readonly WorkspaceLike[],
  enabled: boolean,
): ReadonlyMap<string, number> {
  const [sessions, setSessions] = useState<readonly SessionLike[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void listSessions(undefined).then(
      (page) => {
        if (cancelled) return
        setSessions((page?.items ?? []) as readonly SessionLike[])
      },
      () => {
        // 读不到会话：保留上一次算出来的活动时间，面板照常按工作区自己的时间排序。
      },
    )
    return () => { cancelled = true }
  }, [enabled, workspaces])

  return useMemo(() => workspaceActivityOf(workspaces, sessions), [workspaces, sessions])
}
