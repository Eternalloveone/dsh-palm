/**
 * ④ 审批详情（独立页面，P6 第 1 屏迁移）。
 *
 * 以前审批是长在对话正文里的面板：用户要判断"能不能让它动这个文件"，
 * 却只能在一个滚动列表里看一小段 diff。这一屏把同一份信息放进**独立页面**：
 * 风险、工具、完整参数各占一块，返回由页面栈负责（回到对话）。
 *
 * 组件复用：面板主体仍是 `ApprovalPanel`（交互与二次确认逻辑不重写），
 * 这里只负责"页面外壳 + 排布 + 上下文的补充说明"。
 *
 * @module dsh-palm/mobile/views/ApprovalView
 */
import { ApprovalPanel } from '../components/sheets.tsx'
import { approvalLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { IconButton } from '../ui/primitives.tsx'

/** 审批载荷的类型：直接取面板的 props，视图层不碰数据层（`viewDataImports` 棘轮）。 */
type PendingApproval = Parameters<typeof ApprovalPanel>[0]['approval']

/** 风险级别的中文说法（界面上不出现枚举名）。 */
const RISK_LABEL: Record<string, string> = {
  read: '只读',
  write: '会改文件',
  exec: '会执行命令',
  network: '会联网',
}

export interface ApprovalViewProps {
  sessionId: string
  /** 会话标题：用户要确认"是哪个会话在问我"。 */
  sessionTitle?: string
  approval: PendingApproval
  /** 本次调用的参数摘要（一行）。 */
  preview?: string
  /** 完整参数（宿主已按 8 KB 截断）。 */
  argsText?: string
  onBack(): void
  onResolved(approvalId: string): void
}

/**
 * 渲染审批详情页。
 *
 * @param props - 待决审批、会话上下文与返回/解决回调
 * @returns 审批详情页
 */
export function ApprovalView(props: ApprovalViewProps) {
  const { sessionId, sessionTitle, approval, preview, argsText, onBack, onResolved } = props
  const risk = approval.risk ?? 'write'
  const riskLabel = RISK_LABEL[risk] ?? '会改文件'

  return (
    <SlotLayout
      spec={approvalLayout}
      className="approval-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot">
              <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
            </div>
            <h1 className="mobile-title">要你决定</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
            <p className="approval-page-sub" data-risk={risk}>
              {sessionTitle === undefined ? riskLabel : `${sessionTitle} · ${riskLabel}`}
            </p>
          </header>
        ),
        body: (
          <div className="approval-page-body">
            <ApprovalPanel
              approval={approval}
              sessionId={sessionId}
              preview={preview}
              argsText={argsText}
              onResolved={onResolved}
            />
          </div>
        ),
        actions: (
          <p className="approval-page-hint">
            同意后它才会动手；不处理也不会自己往下走。
          </p>
        ),
      }}
    />
  )
}
