/**
 * workspace.list → workspace.follow 适配。
 *
 * 0.1.5-rc.1 里 `workspace.list` 已删除，改为 `workspace.follow` 流：首帧
 * `{ type: 'baseline', value: WorkspaceBaseline = { items; archivedSessionIds } }`，
 * 随后是 `upsert/remove/order/archived` 增量帧。
 *
 * 本模块维护一个 follow 订阅缓存：首次 `list` 打开 follow 流，消费首帧 baseline
 * 作为快照返回，并持续消费增量更新缓存；后续 `list` 直接返回缓存快照。缓存随插件
 * 生命周期维护。
 */

import type { WorkspaceController } from '@deepseek-ai/dsh-api-workspace-controller'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { WorkspaceView as OldWorkspaceView, SessionId } from './api-proxy-types.ts'

/** workspace.list 的返回（旧形状）。 */
export interface WorkspaceListValue {
  items: OldWorkspaceView[]
  archivedSessionIds: SessionId[]
  /**
   * 归档集**最后一次变化**的时刻（0 = 还没收到 baseline，此刻的值不可信）。
   *
   * 存在的理由：这份归档集是**活的**（`workspace.follow` 一路增量维护），而手机端
   * 的花名册快照只在下一次全量枚举时才抄一份。带上变化时刻，读列表的人就能判断
   * "活值比快照新"，不必再等那一分钟（见 `host/session-roster.ts` 的
   * `readLiveArchivedIds`）。
   */
  archivedChangedAt: number
}

/**
 * workspace.list → workspace.follow 适配器。缓存随插件生命周期维护。
 */
export class WorkspaceListAdapter {
  private items: OldWorkspaceView[] = []
  private archivedSessionIds: SessionId[] = []
  /** 归档集最后一次变化的时刻（0 = 还没 baseline）。 */
  private archivedChangedAt = 0
  private started = false
  private controller: AbortController | undefined

  constructor(private readonly workspace: WorkspaceController) {}

  /** 返回当前 workspace 快照（首次调用开 follow 流并消费 baseline）。 */
  async list(signal?: AbortSignal): Promise<WorkspaceListValue> {
    if (!this.started) {
      this.started = true
      this.controller = new AbortController()
      void this.watch(this.controller.signal)
    }
    signal?.throwIfAborted()
    return {
      items: this.items,
      archivedSessionIds: this.archivedSessionIds,
      archivedChangedAt: this.archivedChangedAt,
    }
  }

  /** 后台消费 follow 流，更新缓存。 */
  private async watch(signal: AbortSignal): Promise<void> {
    try {
      const frames = this.workspace.follow(signal)
      for await (const frame of frames) {
        if (frame.type === 'baseline') {
          this.items = frame.value.items.map(toOldWorkspaceView)
          this.archivedSessionIds = [...frame.value.archivedSessionIds]
          // 严格递增：同一毫秒内又来一帧，时间戳若相等，读方会以为「活值没比快照新」而继续用旧快照。
          this.archivedChangedAt = Math.max(Date.now(), this.archivedChangedAt + 1)
        } else if (frame.type === 'upsert') {
          const view = toOldWorkspaceView(frame.workspace)
          const index = this.items.findIndex(item => item.workspaceId === view.workspaceId)
          if (index >= 0) this.items[index] = view
          else this.items.push(view)
        } else if (frame.type === 'remove') {
          this.items = this.items.filter(item => item.workspaceId !== frame.workspaceId)
        } else if (frame.type === 'order') {
          const byId = new Map(this.items.map(item => [item.workspaceId, item]))
          this.items = frame.workspaceIds
            .map(id => byId.get(id))
            .filter((item): item is OldWorkspaceView => item !== undefined)
        } else if (frame.type === 'archived') {
          this.archivedSessionIds = [...frame.archivedSessionIds]
          this.archivedChangedAt = Math.max(Date.now(), this.archivedChangedAt + 1)
        }
      }
    } catch {
      // 流结束或中止；缓存保持最后一次快照，best-effort。
    }
  }

  /** 停止 follow 流（插件 dispose）。 */
  dispose(): void {
    this.controller?.abort()
    this.controller = undefined
    this.started = false
  }
}

/** 把新 WorkspaceView 映射回旧形状（字段同形）。 */
function toOldWorkspaceView(view: WorkspaceView): OldWorkspaceView {
  return {
    workspaceId: view.workspaceId as string,
    path: view.path,
    title: view.title,
    sessionIds: [...view.sessionIds],
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  }
}
