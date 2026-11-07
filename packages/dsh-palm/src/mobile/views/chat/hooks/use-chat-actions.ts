/**
 * **重新生成与斜杠命令**（W3：从 \`ChatView.tsx\` 组件体内抽出的第七个 hook）。
 *
 * 两件事，各自的坑都很具体：
 *
 * **重新生成**
 * - 一次只发一条：按钮发出后要等轮次真开跑才消失，中间双击会追加好几条"请忽略上一条回答"，
 *   而那些行**删不掉**。
 * - 兜底看门狗：万一这一轮没起来，按钮不能永远转圈（到点复位成可再点）。
 *
 * **斜杠命令**
 * - 命中宿主命令时**不弹回执**：会话里那张命令卡就是回执，弹出整段文本会盖住它要说明的东西。
 * - 但失败**必须说话**：\`/goal\` 参数错时宿主返回的就是那段说明，静默掉等于让人对着没反应的
 *   输入框发呆。
 * - 慢网才提示"正在执行"：命令大多几十毫秒就回来，立刻弹一个再马上消失是闪屏噪音。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-actions
 */
import { useCallback, type MutableRefObject } from 'react'

import { prompt, sendCommand } from '../../../data/session.ts'
import { textParts } from './use-chat-composer.ts'
import type { RenderMessage } from '../../../messages.ts'

/** 重新生成发出后若这一轮没起来，到点复位按钮（别让它永远转圈）。 */
export const REGENERATE_WATCHDOG_MS = 15_000

/** 慢命令的提示阈值：小于它就不提示（几十毫秒的命令弹提示是噪音）。 */
const SLOW_COMMAND_HINT_MS = 1_200

/** 依赖。 */
export interface ChatActionsDeps {
  sessionId: string
  mux: { poke: () => void } | undefined
  toast: (text: string) => void
  setError: (text: string) => void
  errorText: (reason: unknown) => string
  reloadTail: () => void
  messagesRef: MutableRefObject<readonly RenderMessage[]>
  setRegenerateState: (state: 'idle' | 'busy' | 'failed') => void
  regenerateInFlightRef: MutableRefObject<boolean>
  regenerateHintShownRef: MutableRefObject<boolean>
  regenerateWatchdogRef: MutableRefObject<ReturnType<typeof setTimeout> | undefined>
}

/** @returns 两个动作：重新生成一条回答、跑一行斜杠命令。 */
export function useChatActions(deps: ChatActionsDeps): {
  handleRegenerate: (message: RenderMessage) => void
  runCommand: (line: string) => Promise<void>
} {
  const {
    sessionId, mux, toast, setError, errorText, reloadTail, messagesRef,
    setRegenerateState, regenerateInFlightRef, regenerateHintShownRef, regenerateWatchdogRef,
  } = deps

  const handleRegenerate = useCallback((message: RenderMessage): void => {
    if (regenerateInFlightRef.current) return
    regenerateInFlightRef.current = true
    setRegenerateState('busy')
    if (!regenerateHintShownRef.current) {
      regenerateHintShownRef.current = true
      toast('将新增一条回答，原来的保留')
    }
    const rows = messagesRef.current
    const index = rows.findIndex(row => row.id === message.id)
    let question = ''
    for (let i = index - 1; i >= 0; i -= 1) {
      const row = rows[i]
      if (row !== undefined && row.kind === 'user') {
        question = row.text
        break
      }
    }
    const body = question !== ''
      ? `请忽略上一条回答，针对原始问题重新作答：\n\n${question}`
      : '请忽略上一条回答，重新作答刚才的问题。'
    void prompt(sessionId, textParts(body)).then(
      () => {
        mux?.poke()
        if (regenerateWatchdogRef.current !== undefined) clearTimeout(regenerateWatchdogRef.current)
        regenerateWatchdogRef.current = setTimeout(() => {
          regenerateWatchdogRef.current = undefined
          regenerateInFlightRef.current = false
          setRegenerateState('idle')
        }, REGENERATE_WATCHDOG_MS)
      },
      () => {
        regenerateInFlightRef.current = false
        setRegenerateState('failed')
        toast('重新生成失败，请重试')
      },
    )
  }, [sessionId, mux, messagesRef, regenerateHintShownRef, regenerateInFlightRef, regenerateWatchdogRef, setRegenerateState, toast])

  const runCommand = useCallback((line: string): Promise<void> => {
    const pending = window.setTimeout(() => {
      toast(`正在执行 ${line.trim().split(/\s+/)[0]}…`)
    }, SLOW_COMMAND_HINT_MS)
    return sendCommand(sessionId, line).then(
      (outcome) => {
        window.clearTimeout(pending)
        mux?.poke()
        if (outcome.matched) {
          // 成功不弹回执：命令卡就是回执。但失败必须说话。
          if (outcome.kind === 'error' && outcome.text !== undefined && outcome.text !== '') {
            toast(outcome.text)
          }
          reloadTail()
          return
        }
        return prompt(sessionId, textParts(line)).then(() => { mux?.poke() })
      },
      (reason: unknown) => {
        window.clearTimeout(pending)
        setError(errorText(reason))
      },
    )
  }, [sessionId, mux, reloadTail, setError, errorText, toast])

  return { handleRegenerate, runCommand }
}
