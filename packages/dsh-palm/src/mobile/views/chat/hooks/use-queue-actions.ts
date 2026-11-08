/**
 * **排队消息的四个动作**（W3：从 \`ChatView.tsx\` 组件体内抽出的第二个 hook）。
 *
 * 编辑、删除、撤回、插队。四个动作看着简单，真正的难点都在**失败之后**：
 *
 * - 宿主说 \`queue-item-not-found\` —— 手机手里是旧快照，那条在宿主队列里早没了。
 *   卡片必须摘掉，否则屏幕上会留一张"删不掉的幽灵"。
 * - 网络失败 —— 请求根本没到宿主，队列里可能还留着。界面什么都不该动，
 *   而且错误码要说出来（隧道超时 vs 宿主拒绝，混成一句"没送到"下次还得靠猜）。
 * - 乐观项（\`local-\` 开头）宿主还没收下，拿它去调 RPC 只会拿到 bad-request。
 * - 底稿（queued echo）必须跟着动作走：编辑换成新文本、删除/插话一并清掉，
 *   否则被删掉的消息会在 20 秒后"自己回到输入框"。
 *
 * @module dsh-palm/mobile/views/chat/use-queue-actions
 */
import { useCallback } from 'react'

import { updateQueue } from '../../../data/session.ts'
import {
  dropOptimisticQueueItem,
  hideQueueItem,
  queueView,
  restoreInsert,
  unhideQueueItem,
} from '../../../stream/session-store.ts'
import { RpcCallError } from '../../../platform/rpc.ts'
import { forgetQueuedEcho, rememberQueuedEcho } from '../../../session/queued-echo.ts'
/**
 * 队列项的最小结构。
 *
 * 这里**故意不 import api.ts 的类型**：views 层直接依赖数据层会撞架构预算
 * （`viewDataImports ≤ 20`），而 hook 其实只需要这几个字段。
 */
export interface QueueItemBase {
  id: string
  text: string
}

/** hook 的外部依赖（都是 ChatView 里的状态与回调）。 */
export interface QueueActionDeps<Item extends QueueItemBase = QueueItemBase> {
  sessionId: string
  queueItems: readonly Item[]
  setQueueItems: (update: Item[] | ((rows: Item[]) => Item[])) => void
  refreshInbox: (options?: { fresh?: boolean }) => void
  setInput: (update: (previous: string) => string) => void
  toast: (text: string) => void
  applyTurnVerdict: (verdict: { running: boolean; force?: boolean }) => void
}

/** 排队消息的四个动作。 */
export interface QueueActions {
  handleQueueEdit: (itemId: string, text: string) => Promise<void>
  handleQueueRemove: (itemId: string) => Promise<void>
  handleQueueWithdraw: (itemId: string) => Promise<void>
  handleQueueSteer: (itemId: string) => Promise<void>
}

/** @param deps - 会话 id、当前队列、以及几个刷新回调。 */
export function useQueueActions<Item extends QueueItemBase = QueueItemBase>(deps: QueueActionDeps<Item>): QueueActions {
  const { sessionId, queueItems, setQueueItems, refreshInbox, setInput, toast, applyTurnVerdict } = deps

  const handleQueueEdit = useCallback(async (itemId: string, text: string): Promise<void> => {
    const item = queueItems.find(entry => entry.id === itemId)
    const previous = item?.text
    // 附件/图片原样带回去：只改正文，不能把排队项里的文件丢掉（宿主那边收据还在）。
    // keepParts 不在最小结构里（各调用方的形状不同），这里只取需要的两个变体。
    const rawKeep = (item as { keepParts?: unknown } | undefined)?.keepParts
    const keep = Array.isArray(rawKeep) ? rawKeep : []
    const content = [
      ...(text.trim() === '' ? [] : [{ type: 'text' as const, text }]),
      ...(keep as Array<{ type: 'file'; receiptId: string } | { type: 'image'; attachmentId: string }>),
    ]
    try {
      await updateQueue(sessionId, itemId, { kind: 'edit', content })
      if (previous !== undefined) forgetQueuedEcho(sessionId, previous)
      rememberQueuedEcho({ sessionId, text, at: Date.now() })
      refreshInbox({ fresh: true })
    } catch (reason: unknown) {
      // 宿主拒绝了这次改动。和删除一样要分清两种原因：id 在宿主队列里已经找不到
      // （手机那份是旧快照），还是请求根本没送到（隧道抖动）。队列以宿主为准，
      // 所以不凭空删行 —— 但要**立刻现查一次**。
      refreshInbox({ fresh: true })
      const code = reason instanceof RpcCallError ? reason.error.code : undefined
      if (code === 'queue-item-not-found') {
        setQueueItems(rows => rows.filter(item => item.id !== itemId))
        toast('这条已经不在队列里了，已从列表移除')
        return
      }
      toast('编辑没送到宿主，检查一下网络再试')
    }
  }, [sessionId, refreshInbox, queueItems, setQueueItems, toast])

  /** 删除排队消息（宿主侧真删）。 */
  const handleQueueRemove = useCallback(async (itemId: string): Promise<void> => {
    const previous = queueItems.find(item => item.id === itemId)?.text
    // 还没被宿主认下来的乐观项：宿主要么不认这个 id，要么报 bad-request。
    // （真机：点了删除、队列条还在，只多一条报错。）本地删掉即可。
    if (itemId.startsWith('local-')) {
      dropOptimisticQueueItem(sessionId, itemId)
      // queueView 返回的是权威队列（数据层类型），本 hook 只约束 id/text 两个字段。
      setQueueItems(queueView(sessionId) as unknown as Item[])
      if (previous !== undefined) forgetQueuedEcho(sessionId, previous)
      refreshInbox({ fresh: true })
      return
    }
    // 本地先摘掉（状态仓的隐藏表），宿主快照回来之前卡片就消失；失败再放回去。
    hideQueueItem(sessionId, itemId)
    try {
      await updateQueue(sessionId, itemId, { kind: 'remove' })
      setQueueItems(rows => rows.filter(item => item.id !== itemId))
      // 删掉的就是不会发送了：底稿一起清，否则对账会把它「救」回输入框。
      if (previous !== undefined) forgetQueuedEcho(sessionId, previous)
      refreshInbox({ fresh: true })
    } catch (reason: unknown) {
      const code = reason instanceof RpcCallError ? reason.error.code : undefined
      refreshInbox({ fresh: true })
      if (code === 'queue-item-not-found') {
        setQueueItems(rows => rows.filter(item => item.id !== itemId))
        toast('这条已经不在队列里了，已从列表移除')
        return
      }
      // 真失败：撤掉本地隐藏，让权威队列重新显示这一条。
      unhideQueueItem(sessionId, itemId)
      // 插入条的乐观撤回落在这里回滚：宿主还留着它，下一次快照应该重新出现。
      restoreInsert(sessionId, itemId)
      toast(`删除没成功（${code ?? 'network'}），请再试一次`)
    }
  }, [sessionId, refreshInbox, queueItems, setQueueItems, toast])

  /**
   * 撤回 ≠ 删除：删除是扔掉，撤回是**放回输入框**让用户改完再发。
   * 复用删除 RPC（宿主没有 withdraw 动词），然后把原文放回去，并清掉底稿——
   * 否则丢队列对账会把它"救"进输入框第二次。
   */
  const handleQueueWithdraw = useCallback(async (itemId: string): Promise<void> => {
    const text = queueItems.find(item => item.id === itemId)?.text ?? ''
    await handleQueueRemove(itemId)
    if (text === '') return
    forgetQueuedEcho(sessionId, text)
    setInput(previous => previous.trim() === '' ? text : `${previous}\n${text}`)
    toast('已放回输入框')
  }, [queueItems, handleQueueRemove, sessionId, setInput, toast])

  /** 插队：把排队消息塞进当前回合（只有运行中才有意义）。 */
  const handleQueueSteer = useCallback(async (itemId: string): Promise<void> => {
    const previous = queueItems.find(item => item.id === itemId)?.text
    if (itemId.startsWith('local-')) {
      toast('这条还在发送中，稍等一下再插队')
      return
    }
    // 点下去就让它从队列里消失：插队的语义是"进当前回合"。
    hideQueueItem(sessionId, itemId)
    try {
      await updateQueue(sessionId, itemId, { kind: 'steer' })
      setQueueItems(rows => rows.filter(item => item.id !== itemId))
      if (previous !== undefined) forgetQueuedEcho(sessionId, previous)
      refreshInbox({ fresh: true })
      toast('已插入当前回合')
    } catch (reason: unknown) {
      const code = reason instanceof RpcCallError ? reason.error.code : undefined
      if (code === 'steer-unavailable') {
        // 宿主说这一轮不再接受插话——它结束了，但 turn/end 帧可能丢掉（信道降级）。
        // 把宿主的运行态镜像过来，界面别再对已结束的回合提供插话。
        unhideQueueItem(sessionId, itemId)
        toast('当前轮次已结束，无法插话')
        applyTurnVerdict({ running: false, force: true })
        return
      }
      if (code === 'queue-item-not-found') {
        refreshInbox({ fresh: true })
      } else {
        // 真失败（请求没到宿主）：把这一条放回排队条。
        unhideQueueItem(sessionId, itemId)
      }
      toast(code === 'queue-item-not-found' ? '消息已开始发送，无法插话' : '插话失败')
    }
  }, [sessionId, refreshInbox, queueItems, setQueueItems, toast, applyTurnVerdict])

  return { handleQueueEdit, handleQueueRemove, handleQueueWithdraw, handleQueueSteer }
}
