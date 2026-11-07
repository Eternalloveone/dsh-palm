/**
 * **聊天页的两个订阅**（S2-B：从 `ChatView.tsx` 的 effect 里搬出的第二批）。
 *
 * 两个订阅性质不同，放在一个文件是因为它们都是"外部世界变了，通知这个界面"：
 *
 * ### 1. 会话状态仓（队列）
 * 别的入口（发送 / 插队 / 删除的乐观项、快照落地）改了队列，这里同步一次。
 * 订阅按 `sessionId` 过滤——同一时刻只有当前会话会重渲染。
 *
 * ### 2. 原生选区
 * 一旦浏览器真的开始选字（哪怕我们 500ms 的长按定时器已经排上队），立刻撤掉长按与
 * 自定义菜单，让用户能拖手柄、用系统菜单复制片段。
 *
 * 这条是**手机端最容易做错的地方**：自定义菜单和系统选区抢同一块区域时，如果不在
 * `selectionchange` 上让路，用户会拖不动手柄。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-subscriptions
 */
import { useEffect, type MutableRefObject } from 'react'

import { queueView, subscribeSessionStore } from '../../../stream/session-store.ts'
import type { MessageCtxMenuState } from '../components/message-menu.tsx'

/** 队列订阅的依赖。 */
export interface QueueStoreDeps {
  sessionId: string
  mountedRef: MutableRefObject<boolean>
  /** 队列视图的类型取自 queueView 的返回值——**不 import api.ts**，否则会撞 views→api 的配额。 */
  setQueueItems: (items: ReturnType<typeof queueView>) => void
}

/** 原生选区让路的依赖（与队列无关，所以分开声明）。 */
export interface NativeSelectionDeps {
  setCtxMenu: (menu: MessageCtxMenuState | undefined) => void
  cancelLongPress: () => void
}

/** 会话状态仓（队列）订阅。 */
export function useQueueStoreSubscription(deps: QueueStoreDeps): void {
  const { sessionId, mountedRef, setQueueItems } = deps
  useEffect(() => {
    const unsubscribe = subscribeSessionStore((changed) => {
      if (changed !== sessionId || !mountedRef.current) return
      setQueueItems(queueView(sessionId))
    })
    return unsubscribe
  }, [sessionId, mountedRef, setQueueItems])
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
