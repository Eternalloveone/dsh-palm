/**
 * 失败态（P6 ⑰）：错误必须**留住**，并且给得起"再试一次"。
 *
 * 迁移过程中失败呈现散成几十处：有的 `toast` 一闪就没（用户还没读完），
 * 有的只有一句红字（不知道能不能重试）。规范只要求两件事：
 *
 * 1. **不消失**：除非用户关掉或重试成功，错误一直看得见；
 * 2. **能重试**：调用方给得起重试函数时，给一个明确的按钮。
 *
 * @module dsh-palm/mobile/ui/error-note
 */
import { Button } from './primitives.tsx'

export interface ErrorNoteProps {
  /** 已经过 `errorText()` 的人话错误。 */
  message: string
  /** 可选：重试函数。不给就不渲染按钮（不放假入口）。 */
  onRetry?: (() => void) | undefined
  /** 可选：重试按钮文案，默认「重试」。 */
  retryLabel?: string
  /** 可选：收起（用户明确不想再看见时）。 */
  onDismiss?: (() => void) | undefined
}

/**
 * 渲染失败态。
 *
 * @param props - 错误文案与可选的行动
 * @returns 失败态块
 */
export function ErrorNote({ message, onRetry, retryLabel = '重试', onDismiss }: ErrorNoteProps) {
  return (
    <div className="error-note" role="alert">
      <p className="error-note-message">{message}</p>
      {onRetry === undefined && onDismiss === undefined ? null : (
        <div className="error-note-actions">
          {onRetry === undefined ? null : (
            <Button type="button" className="error-note-retry" onClick={onRetry}>
              {retryLabel}
            </Button>
          )}
          {onDismiss === undefined ? null : (
            <Button type="button" className="error-note-dismiss" onClick={onDismiss}>
              知道了
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
