/**
 * **卸载时清掉两个计时器**（S2-H：把 `ChatView.tsx` 里两处 unmount 清理合并）。
 *
 * 两处清理原本各写一个 `useEffect(() => () => {...}, [])`，相隔 2,000 行，谁也看不出
 * 它们是一类东西。合并的理由有两个：
 *
 * 1. **漏一个的后果相同**：计时器在卸载后仍会触发，回调里访问已卸载组件的状态
 *    （React 只在开发期警告，线上表现为"切走再回来数字乱跳"）。
 * 2. 卸载清理应当是**一次读完**的清单，而不是散落在文件各处。
 *
 * 两个计时器分别是什么：
 *
 * | ref | 计时器 | 不清的后果 |
 * |---|---|---|
 * | `readingTimerRef` | 阅读位置的防抖落盘 | 已卸载还去写快照 |
 * | `regenerateWatchdogRef` | 「重新生成」的看门狗（超时后放开按钮） | 已卸载还在等一个不会回来的回复 |
 *
 * @module dsh-palm/mobile/views/chat/use-chat-timer-cleanup
 */
import { useEffect, type MutableRefObject } from 'react'

/** 依赖：两个计时器 ref（ref 对象本身稳定，可安全放进依赖）。 */
export interface ChatTimerCleanupDeps {
  /** 阅读位置防抖计时器。 */
  readingTimerRef: MutableRefObject<number | undefined>
  /** 「重新生成」看门狗计时器。 */
  regenerateWatchdogRef: MutableRefObject<ReturnType<typeof setTimeout> | number | undefined>
}

/** 卸载时清掉两个计时器。 */
export function useChatTimerCleanup(deps: ChatTimerCleanupDeps): void {
  const { readingTimerRef, regenerateWatchdogRef } = deps
  useEffect(() => () => {
    if (readingTimerRef.current !== undefined) {
      window.clearTimeout(readingTimerRef.current)
      readingTimerRef.current = undefined
    }
    if (regenerateWatchdogRef.current !== undefined) {
      clearTimeout(regenerateWatchdogRef.current)
      regenerateWatchdogRef.current = undefined
    }
  }, [readingTimerRef, regenerateWatchdogRef])
}
