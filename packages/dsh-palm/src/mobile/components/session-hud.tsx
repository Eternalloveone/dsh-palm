import { type JSX, type ReactNode } from 'react'

/**
 * 会话 HUD：顶部那一组状态条的**唯一渲染点**。
 *
 * ## 为什么要有这层
 *
 * 「目标条 / 排队条 / 运行状态条」以前是三个并列 JSX，谁写在前面谁在上、各自判断
 * 显不显示。于是同一类毛病反复出现：两条同时在位、顺序随代码改动漂移、某条忘了
 * 加条件就一直挂着。这里把「顺序」和「出现」两件事收成一处：
 *
 *   goal（为什么在跑）→ queue（接下来发什么）→ status（跑到哪了）
 *
 * 判据仍然在 `session-status.ts` 的 `describeBars` 里；本组件只负责**怎么摆**。
 *
 * ## 为什么用 `display: contents`
 *
 * 纯结构容器：不产生新的布局盒，三条的外观/间距与之前完全一致，也不会因为多一层
 * `div` 而破掉 composer 上方的 flex 关系。
 */
export function SessionHud({
  goal,
  queue,
  status,
}: {
  /** 目标条（为什么在跑）。没有目标时为 undefined。 */
  goal?: ReactNode
  /** 排队条（接下来要发出去的消息）。队列为空时为 undefined。 */
  queue?: ReactNode
  /** 运行状态条（任务/后台任务进度）。没有信息量时为 undefined。 */
  status?: ReactNode
}): JSX.Element | null {
  const parts: ReactNode[] = []
  if (goal !== undefined && goal !== null && goal !== false) parts.push(goal)
  if (queue !== undefined && queue !== null && queue !== false) parts.push(queue)
  if (status !== undefined && status !== null && status !== false) parts.push(status)
  if (parts.length === 0) return null
  return <div className="chat-hud" data-hud-count={parts.length}>{parts}</div>
}
