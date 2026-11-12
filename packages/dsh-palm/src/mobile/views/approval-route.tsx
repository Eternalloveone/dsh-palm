/**
 * 审批详情页＝会话账本的投影（W3-2 第二步收口）。
 *
 * 这一屏原来吃的是**导航时抄下来的 `Route.approval` 快照**。它和对话里的审批
 * 面板不是同一份事实：另一台设备答完、或宿主已经收掉这条审批，详情页仍然摆着
 * 「批准 / 拒绝」，点下去只能拿到 not-found。事实的所有者是
 * `runtime/chat/pending-store.ts`（按会话分桶、模块作用域），路由只留
 * `approvalId` 作为**导航身份**，页面按 id 读实时对象。
 *
 * 读不到就等于"这条已经结束了"：直接退回对话，而不是继续展示一条不存在的请求。
 * 这里不另做一屏「已处理」——对话里的面板由同一份账本驱动，回去看到的才是真相。
 *
 * @module dsh-palm/mobile/views/approval-route
 */

import { useEffect } from 'react'
import { ApprovalView } from './ApprovalView.tsx'
import { useSessionPending } from '../runtime/chat/use-pending-store.ts'

export interface ApprovalRouteProps {
  /** 这条审批属于哪条会话（账本按会话分桶）。 */
  sessionId: string
  /** 会话标题：用户要确认"是哪个会话在问我"。 */
  sessionTitle?: string
  /** 导航身份：只记 id，不记审批内容。 */
  approvalId: string
  /** 本次调用的参数摘要（一行，打开页面时由对话侧算好）。 */
  preview?: string
  /** 完整参数（宿主已按 8 KB 截断）。 */
  argsText?: string
  onBack(): void
}

/**
 * 渲染审批详情页。
 *
 * @param props - 会话上下文、审批 id 与返回动作
 * @returns 审批详情页；账本里已无这条时返回空（并在副作用里退回对话）
 */
export function ApprovalRoute(props: ApprovalRouteProps) {
  const { sessionId, approvalId, onBack } = props
  const { approvals } = useSessionPending(sessionId)
  const approval = approvals.find(item => item.approvalId === approvalId)
  const missing = approval === undefined

  // 账本里没有这条：别处答完了（或被宿主收走）。退回对话，不展示不存在的请求。
  // 放在 effect 里而不是渲染期，避免"渲染中触发导航"这类重入问题。
  useEffect(() => {
    if (missing) onBack()
  }, [missing, onBack])

  if (approval === undefined) return null

  return (
    <ApprovalView
      sessionId={sessionId}
      {...(props.sessionTitle === undefined ? {} : { sessionTitle: props.sessionTitle })}
      approval={approval}
      {...(props.preview === undefined ? {} : { preview: props.preview })}
      {...(props.argsText === undefined ? {} : { argsText: props.argsText })}
      onBack={onBack}
      onResolved={() => { onBack() }}
    />
  )
}
