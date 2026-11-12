/**
 * **聊天页的原生选区让路**（S2-B 的第二批）。
 *
 * 队列订阅曾经也在这个文件里（`useQueueStoreSubscription`）：它把仓里的
 * `queueView()` 抄进组件状态。W3-6 起队列改成仓的只读投影（`use-session-queue.ts`
 * 订阅仓的变更版本、视图里不留数组），那个"抄一份"的订阅随之删除 —— 同一份事实
 * 不再有两个所有者。
 *
 * 剩下的是**手机端最容易做错的地方**：自定义菜单和系统选区抢同一块区域时，如果不
 * 在 `selectionchange` 上让路，用户会拖不动手柄。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-subscriptions
 */
import { useEffect } from 'react'

import type { MessageCtxMenuState } from '../components/message-menu.tsx'

/** 原生选区让路的依赖。 */
export interface NativeSelectionDeps {
  setCtxMenu: (menu: MessageCtxMenuState | undefined) => void
  cancelLongPress: () => void
}

/** 原生选区优先：让系统选中来的时候，长按与自定义菜单立刻退场。 */
export function useNativeSelection(menu: NativeSelectionDeps): void {
  const { setCtxMenu, cancelLongPress } = menu
  useEffect(() => {
    const onSelectionChange = (): void => {
      if ((window.getSelection()?.toString() ?? '') === '') return
      cancelLongPress()
      setCtxMenu(undefined)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => { document.removeEventListener('selectionchange', onSelectionChange) }
  }, [cancelLongPress, setCtxMenu])
}
