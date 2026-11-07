/**
 * **前台子代理列表**（W3：从 \`ChatView.tsx\` 组件体内抽出的第六个 hook）。
 *
 * 只做一件事：拿当前会话的前台子代理（一次扁平 \`subagents.list\`，不做递归树遍历），
 * 并在**回合打开且页面在前台**时轮询。
 *
 * 两个细节都是真机换来的：
 * - 宿主**不转发**子代理的流事件，回合里新起的子代理只能靠轮询看见；
 * - 页面在后台时不轮询（手机上后台标签页会被节流，轮询只是白耗电）。
 *
 * 运行态的即时翻转由宿主 \`session/status\` 覆盖层负责，不靠这里。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-subagents
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'

import { SUBAGENT_POLL_MS, fetchSubagentsFlat, type SubagentFlatNode } from '../../subagent-tree.ts'

/** 依赖。 */
export interface ChatSubagentsDeps {
  sessionId: string
  running: boolean
  foreground: boolean
  setSubagents: (nodes: SubagentFlatNode[]) => void
  startTransition: (run: () => void) => void
  /** 帧回调要"立刻刷一次"：走 ref，免得为它重订阅事件流。 */
  refreshSubagentsRef: MutableRefObject<() => void>
}

/** @returns 手动刷新入口（onFrame 在 turn/start 时调它）。 */
export function useChatSubagents(deps: ChatSubagentsDeps): { refreshSubagents: () => void } {
  const { sessionId, running, foreground, setSubagents, startTransition, refreshSubagentsRef } = deps

  const refreshSubagents = useCallback(() => {
    void fetchSubagentsFlat(sessionId).then(
      (nodes) => { startTransition(() => { setSubagents(nodes) }) },
      () => { /* 瞬时失败；下一次触发会重试 */ },
    )
  }, [sessionId, setSubagents, startTransition])
  refreshSubagentsRef.current = refreshSubagents

  useEffect(() => {
    refreshSubagents()
  }, [refreshSubagents])

  // 回合开着又在前台才轮询：宿主不转发子代理事件，新起的只能靠轮询看见。
  useEffect(() => {
    if (!running || !foreground) return
    const id = setInterval(() => { refreshSubagentsRef.current() }, SUBAGENT_POLL_MS)
    return () => { clearInterval(id) }
  }, [running, foreground, refreshSubagentsRef])

  return { refreshSubagents }
}
