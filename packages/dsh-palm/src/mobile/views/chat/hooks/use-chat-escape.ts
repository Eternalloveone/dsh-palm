/**
 * **Esc 关闭浮层**（S2-D：从 `ChatView.tsx` 的 effect 里搬出）。
 *
 * 规则看着简单，实际有三个容易漏的点，都写在测试与注释里：
 *
 * 1. **只在有浮层打开时才挂监听**。没有浮层时按 Esc 不该被这个界面拦下来——
 *    `stopPropagation()` 会挡住外层（输入法、浏览器）的处理。
 * 2. **一次 Esc 关掉所有层**，而不是只关最上面那层。手机上没有"层叠栈"的直觉，
 *    留几层开着只会让人以为没反应。
 * 3. 关闭时**不卸载监听**：同一拍里要连关多层，先卸载会让后续的 Setter 变成空操作。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-escape
 */
import { useEffect } from 'react'

import type { ChatUiState, SliceSetters } from '../state/chat-machine.ts'

/** 依赖：浮层开关状态。 */
export interface ChatEscapeDeps {
  ui: ChatUiState
  setters: SliceSetters<ChatUiState>
}

/** 有浮层打开时，Esc 关掉全部。 */
export function useChatEscape(deps: ChatEscapeDeps): void {
  const { ui, setters } = deps
  const anyOpen = ui.moreOpen || ui.runStatusOpen
    || ui.gitOpen || ui.composerPanelOpen || ui.plusOpen || ui.commandOpen

  useEffect(() => {
    if (!anyOpen) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setters.moreOpen(false)
      setters.runStatusOpen(false)
      setters.gitOpen(false)
      setters.composerPanelOpen(false)
      setters.plusOpen(false)
      setters.commandOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [anyOpen, setters])
}
