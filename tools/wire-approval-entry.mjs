import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')

// 1) 面板组件：加一个可选入口，回调没给就不渲染按钮（老用法零影响）
const P = join(PKG, 'src', 'mobile', 'views', 'chat', 'components', 'chat-attention-panels.tsx')
let p = readFileSync(P, 'utf8')
const eol = p.includes('\r\n') ? '\r\n' : '\n'

if (!p.includes('onOpenApproval')) {
  p = p.replace(
    '  onApprovalResolved: (approvalId: string) => void',
    [
      '  onApprovalResolved: (approvalId: string) => void',
      '  /** 打开「审批详情」独立页；不给就不渲染入口（老调用方式零影响）。 */',
      '  onOpenApproval?: (approval: PendingApproval, preview?: string, argsText?: string) => void',
    ].join(eol),
  )
  p = p.replace(
    '  const { sessionId, approvals, questions, previewOf, argsOf, onApprovalResolved, onQuestionResolved } = props',
    '  const { sessionId, approvals, questions, previewOf, argsOf, onApprovalResolved, onQuestionResolved, onOpenApproval } = props',
  )
  p = p.replace(
    `      {approvals.map(approval => (` + eol + `        <ApprovalPanel`,
    [
      `      {approvals.map(approval => (`,
      `        <div className="chat-approval-block" key={approval.approvalId}>`,
      `          {onOpenApproval !== undefined && (`,
      `            <button`,
      `              type="button"`,
      `              className="chat-approval-detail"`,
      `              onClick={() => { onOpenApproval(approval, previewOf(approval), argsOf(approval)) }}`,
      `            >`,
      `              看完整详情 ›`,
      `            </button>`,
      `          )}`,
      `          <ApprovalPanel`,
    ].join(eol),
  )
  // 闭合：原来的 `/>` + `))}` 需要改成包住 div
  p = p.replace(
    `          onResolved={(id) => { onApprovalResolved(id) }}` + eol + `        />` + eol + `      ))}`,
    `            onResolved={(id) => { onApprovalResolved(id) }}` + eol + `          />` + eol + `        </div>` + eol + `      ))}`,
  )
  writeFileSync(P, p)
}

// 2) ChatView：透传可选回调
const C = join(PKG, 'src', 'mobile', 'views', 'ChatView.tsx')
let c = readFileSync(C, 'utf8')
if (!c.includes('onOpenApproval')) {
  c = c.replace(
    '  /** 收起这条提示。 */\r\n  onDismissFinished?: (() => void) | undefined',
    '  /** 收起这条提示。 */\r\n  onDismissFinished?: (() => void) | undefined\r\n  /** 打开审批详情独立页（P6 ④ 屏）；不给就不显示入口。 */\r\n  onOpenApproval?: ((approval: PendingApproval, preview?: string, argsText?: string) => void) | undefined',
  )
  c = c.replace(
    '          onApprovalResolved={(id) => {',
    '          onOpenApproval={onOpenApproval}\r\n          onApprovalResolved={(id) => {',
  )
  writeFileSync(C, c)
}
console.log('panel:', p.includes('onOpenApproval'), '| chatview:', c.includes('onOpenApproval'))
