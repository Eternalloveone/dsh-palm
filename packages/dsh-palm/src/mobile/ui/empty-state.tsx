/**
 * 空态（P6 ⑯）：一种形状，三种语气。
 *
 * 迁移过程中各页自己写 `<p className="…">`：有的只有一句话，有的直接空白，
 * 用户看不出"是该等、该点，还是这功能没做"。这里统一成一条规则：
 *
 * **先说清发生了什么 → 再给一个能做的动作（如果有）。**
 *
 * @module dsh-palm/mobile/ui/empty-state
 */
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  /** 一句人话：发生了什么（"这次会话还没有产出文件"）。 */
  title: string
  /** 可选补充：为什么会这样 / 接下来会怎样。 */
  hint?: string
  /** 可选动作：真的能点的一步（没动作就别给按钮）。 */
  action?: ReactNode
}

/**
 * 渲染空态。
 *
 * @param props - 标题、可选说明、可选动作
 * @returns 空态块
 */
export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      <p className="empty-state-title">{title}</p>
      {hint === undefined ? null : <p className="empty-state-hint">{hint}</p>}
      {action === undefined ? null : <div className="empty-state-action">{action}</div>}
    </div>
  )
}
