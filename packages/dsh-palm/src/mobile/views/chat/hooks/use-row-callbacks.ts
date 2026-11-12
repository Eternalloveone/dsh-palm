/**
 * 行级回调的**稳定入口**（从 `ChatView` 搬出）。
 *
 * 两个理由，缺一不可：
 * 1. 引用必须恒定 —— 这些回调原来是 JSX 里现造的闭包 / 每次渲染新建的函数，
 *    传给 `ChatRows` 就等于把列表的 `memo` 撕掉（`chat-rows-memo.test.tsx` 守着这条）；
 * 2. 单独成文件 —— `ChatView.tsx` 有「只许变短」的行数预算（architecture.test.ts），
 *    而这块逻辑本身与视图无关。
 *
 * @module dsh-palm/mobile/views/chat/use-row-callbacks
 */
import { useCallback } from 'react'
import type { RenderMessage } from '../../../render/messages.ts'

/** 依赖。 */
export interface RowCallbackDeps {
  /** 被打断的那一轮（渲染前要给它盖「已中断」标记）。 */
  abandonedTurn: number | undefined
  /** 当前活跃轮次（决定哪些行在跑）。 */
  liveTurn: number | undefined
  /** 行是否已收工（ChatView 的判定链，引用由调用方保证稳定）。 */
  settledOf: (message: RenderMessage) => boolean
  /** 行是否正在跑（模块级纯函数）。 */
  isRowRunning: (row: RenderMessage, liveTurn: number | undefined, settled: boolean) => boolean
  /** 打开文件的接管方（未注入时走内嵌预览）。 */
  onOpenDiff?: (path: string) => void
  /** 内嵌预览的落地函数（`useState` 的 setter，引用恒定）。 */
  setPreviewPath: (path: string) => void
}

/** 交给消息列表的稳定回调。 */
export interface RowCallbacks {
  /** 被打断那一轮的行副本（其余行原样返回）。 */
  rowOfInterrupted: (message: RenderMessage) => RenderMessage
  /** 这一行是否正在跑（ChatRows 与 MessageRow 共用）。 */
  isRowRunningOf: (row: RenderMessage) => boolean
  /** 点开某个产出文件。 */
  openFileOf: (path: string) => void
}

/** @returns 引用稳定的行级回调。 */
export function useRowCallbacks(deps: RowCallbackDeps): RowCallbacks {
  const { abandonedTurn, liveTurn, settledOf, isRowRunning, onOpenDiff, setPreviewPath } = deps
  const rowOfInterrupted = useCallback((message: RenderMessage): RenderMessage => (
    abandonedTurn !== undefined && message.turn === abandonedTurn && message.maxTokens !== true
      ? { ...message, maxTokens: true }
      : message
  ), [abandonedTurn])
  const isRowRunningOf = useCallback(
    (row: RenderMessage): boolean => isRowRunning(row, liveTurn, settledOf(row)),
    [isRowRunning, liveTurn, settledOf],
  )
  const openFileOf = useCallback((path: string): void => {
    if (onOpenDiff === undefined) setPreviewPath(path)
    else onOpenDiff(path)
  }, [onOpenDiff, setPreviewPath])
  return { rowOfInterrupted, isRowRunningOf, openFileOf }
}
