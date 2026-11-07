/**
 * **消息菜单的自动收起**（S2-N：从 `ChatView.tsx` 搬出）。
 *
 * 两条退出路径，缺一条都会让人觉得"菜单甩不掉"：
 *
 * 1. **3 秒无操作自动收起** —— 长按菜单是临时操作，留在屏幕上会挡住下面的内容。
 * 2. **Esc 收起** —— 接了实体键盘（iPad、外接键盘）时 Esc 是最顺手的取消；
 *    背景点击在键盘场景下够不到。
 *
 * 菜单没打开时**不挂监听**：否则整个页面都会为一次没发生的长按常驻一个 keydown 处理器。
 *
 * @module dsh-palm/mobile/views/chat/hooks/use-message-menu-dismiss
 */
import { useEffect } from 'react'

/** 依赖。 */
export interface MessageMenuDismissDeps {
  /** 当前菜单是否打开（`undefined` = 未打开）。 */
  open: boolean
  /** 收起菜单。 */
  close: () => void
  /** 多久无操作自动收起，默认 3 秒。 */
  timeoutMs?: number
}

/** 菜单打开时，3 秒无操作或按 Esc 收起。 */
export function useMessageMenuDismiss(deps: MessageMenuDismissDeps): void {
  const { open, close, timeoutMs = 3_000 } = deps
  useEffect(() => {
    if (!open) return undefined
    const timer = window.setTimeout(close, timeoutMs)
    // 接了实体键盘时 Esc 是最顺手的取消；背景点击在键盘场景下够不到。
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close, timeoutMs])
}
