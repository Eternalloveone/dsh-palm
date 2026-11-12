/**
 * 排队卡（2026-11-10 方案 A）：**一块区域说一件事**。
 *
 * 改之前底部同时有三块在说同一件事：`已插入 1 条补充消息` 摘要条、一块四按钮的
 * 排队大卡、以及一条黄色「N 条排队 · 当前任务结束后执行」横条。真机上它们占了
 * 近四分之一屏，信息还重复。
 *
 * 现在只有这一张卡：
 *   ┌ 2 条排队 · 当前任务结束后执行            [立即发送] [⋯]
 *   ├ • 第一条排队的内容…                              ×
 *   ├ • 第二条排队的内容…                              ×
 *   └ ▸ 已插入本轮 · 1 条补充消息
 *
 * 排队行由 `QueueDock` 画（动作表也在它里面），插入行由 `InsertBarView` 画；
 * 两者都为空时整张卡不渲染。
 *
 * @module dsh-palm/mobile/views/chat/components/queue-card
 */
/**
 * 排队项的最小结构：**不从 api.ts 取类型**（views 的 `viewDataImports ≤ 14` 配额）。
 * 结构性兼容 `QueueItemView`，`QueueDock` 照常吃。
 */
export interface QueueCardItem {
  id: string
  placement: 'queued' | 'steering' | 'context'
  text: string
  editable: boolean
}
import { QueueDock } from '../../../components/queue-dock.tsx'
import { withdrawInsert } from '../../../stream/session-store.ts'
import { InsertBarView, useInsertEntries } from './insert-bar.tsx'

export interface QueueCardProps {
  sessionId: string
  items: QueueCardItem[]
  running: boolean
  onEdit(itemId: string, text: string): Promise<void>
  onRemove(itemId: string): Promise<void>
  onSteer(itemId: string): Promise<void>
  onWithdraw(itemId: string): Promise<void>
}

export function QueueCard({ sessionId, items, running, onEdit, onRemove, onSteer, onWithdraw }: QueueCardProps) {
  const entries = useInsertEntries(sessionId)
  const queued = items.filter(item => item.placement === 'queued')
  if (queued.length === 0 && entries.length === 0) return null
  return (
    <div className="queue-dock" data-queue-dock="">
      {queued.length > 0 && (
        <QueueDock
          items={queued}
          running={running}
          onEdit={onEdit}
          onRemove={onRemove}
          onSteer={onSteer}
          onWithdraw={onWithdraw}
        />
      )}
      <InsertBarView
        entries={entries}
        running={running}
        onWithdraw={(id) => {
          // 先落撤回回执：宿主 RPC 慢时界面也不该继续挂着这条；失败由
          // `handleQueueRemove` 调 restoreInsert 放回来。
          withdrawInsert(sessionId, id)
          onWithdraw(id)
        }}
        onRemove={onRemove}
      />
    </div>
  )
}
