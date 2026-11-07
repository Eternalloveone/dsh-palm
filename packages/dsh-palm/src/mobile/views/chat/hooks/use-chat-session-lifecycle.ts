/**
 * **会话转场的三个一次性动作**（S2-A：从 `ChatView.tsx` 的 37 个 `useEffect` 里搬出的第一批）。
 *
 * 这三个 effect 的共同点：**它们只跟 `sessionId` 有关**，与消息、滚动、输入都无关。
 * 放在组件体里时，它们夹在几十个 effect 中间，读代码的人很难判断"换会话时到底发生了哪些事"。
 *
 * 按发生顺序：
 *
 * 1. **消费定位意图**：从别处（轮次跳转、搜索命中）带进来的"打开后跳到哪一行"只消费一次，
 *    之后只有转场里的第二个实例（2 秒内）能复用它。
 * 2. **清掉"刚结束"标记**：打开过就不该再挂在运行中页的「刚结束」里（真机口径：
 *    只保留没点进去看过的）。
 * 3. **持住定位意图**：卸载后留 2 秒宽限、新实例挂载即取消；真离开则宽限到点清掉，
 *    不会残留到下一次普通打开。
 *
 * 第 3 条早先的 TTL 是 20 秒，结果出现「刚看完命中又点回来」莫名再跳一次——宽限期
 * 只要够跨过一次转场，不能更长。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-session-lifecycle
 */
import { useEffect } from 'react'

import { forgetFinishedRun } from '../../../recent-finished.ts'
import { holdLocateIntent, releaseLocateIntent, takeLocateIntent } from '../../../locate-intent.ts'

/**
 * 会话转场时的一次性动作。
 *
 * @param sessionId 当前会话（换会话即重跑）
 */
export function useChatSessionLifecycle(sessionId: string): void {
  useEffect(() => {
    // 挂载即消费：之后只有转场里的第二个实例（2 秒内）能复用它。
    takeLocateIntent(sessionId)
  }, [sessionId])

  useEffect(() => {
    // 打开过就不该再挂在运行中页的「刚结束」里。
    forgetFinishedRun(sessionId)
  }, [sessionId])

  useEffect(() => {
    holdLocateIntent(sessionId)
    return () => { releaseLocateIntent(sessionId) }
  }, [sessionId])
}
