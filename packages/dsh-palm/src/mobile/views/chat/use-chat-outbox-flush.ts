/**
 * **网络恢复后自动冲队列**（S2-C：从 `ChatView.tsx` 的 effect 里搬出的第一批副作用）。
 *
 * 规则很短，但错一次就很难查：**连回来就冲一次**。不能反过来写成"离线时不断冲洗"——
 * 那会在断开期间反复失败、把待发条目刷成错误态。
 *
 * 注意这里读的是 `listOutbox()`（真正的待发队列），不是界面上的排队消息：界面上的
 * 「排队」是用户主动排的，和"发失败等重连"不是一回事。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-outbox-flush
 */
import { useEffect } from 'react'

import { listOutbox } from '../../offline.ts'

/**
 * @param offline 当前是否离线（真相源：连通性探测）
 * @param flushQueue 冲队列（来自 composer 的 send 状态机）
 */
export function useChatOutboxFlush(offline: boolean, flushQueue: () => void): void {
  useEffect(() => {
    // Connection restored: drain the outbox automatically.
    if (offline) return
    void listOutbox().then((entries) => {
      if (entries.length === 0) return
      flushQueue()
    })
  }, [offline, flushQueue])
}
