/**
 * 正文区里的「等人回话」面板：审批请求与提问面板。
 *
 * S6i 从 `ChatView` 搬出。为什么单独成组件：这两块在 DOM 里的位置很关键 ——
 * 它们插在「输出中」状态行与右下角两个浮动按钮之间（`.chat-jump-turns` 是
 * `position: sticky`，按钮合并到状态行旁边会让锚点位移从 0px 变成 44px）。
 * 位置留在原处，实现搬出去。
 *
 * 回完的条目不立刻从界面上消失——先记一笔 `noteAnswered*`（会话级），再由调用方
 * 从待处理的队列里摘掉，否则宿主重发同一条时会被再问一遍。
 */
import type { PendingApproval, PendingQuestionItem } from '../../../api.ts'
import { ApprovalPanel, QuestionPanel } from '../../../sheets.tsx'

export interface ChatAttentionPanelsProps {
  sessionId: string
  approvals: PendingApproval[]
  questions: PendingQuestionItem[]
  /** 审批的预览（diff/命令）与参数文本，由会话层从负载里取。 */
  previewOf: (approval: PendingApproval) => string | undefined
  argsOf: (approval: PendingApproval) => string | undefined
  onApprovalResolved: (approvalId: string) => void
  onQuestionResolved: (rpcId: string) => void
}

export function ChatAttentionPanels(props: ChatAttentionPanelsProps) {
  const { sessionId, approvals, questions, previewOf, argsOf, onApprovalResolved, onQuestionResolved } = props
  return (
    <>
      {approvals.map(approval => (
        <ApprovalPanel
          key={approval.approvalId}
          approval={approval}
          preview={previewOf(approval)}
          argsText={argsOf(approval)}
          sessionId={sessionId}
          onResolved={(id) => { onApprovalResolved(id) }}
        />
      ))}
      {questions.length > 0 && (
        <QuestionPanel
          questions={questions}
          sessionId={sessionId}
          onResolved={(rpcId) => { onQuestionResolved(rpcId) }}
        />
      )}
    </>
  )
}
