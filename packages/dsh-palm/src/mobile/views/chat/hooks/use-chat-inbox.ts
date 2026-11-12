/**
 * **队列快照的对账**（W3：从 \`ChatView.tsx\` 组件体内抽出的第三个 hook）。
 *
 * 手机端有个反直觉的事实：**宿主的待发投影帧到不了手机**。所以"排队里有几条"不能靠等帧，
 * 只能主动问 —— 这就是 \`refreshInbox\`。它做三件事：
 *
 * 1. 优先问 \`mobile.sessionState\`（原子快照：行/队列/回合/目标/待办一起对齐）；
 * 2. 老宿主没有这个能力时退回 \`inboxOf\`（队列旧一点，总比整条队列消失好）；
 * 3. 失败重试一次 —— 一次隧道抖动就丢快照，界面上会留一张既不走也删不掉的旧卡片。
 *
 * 队列数据**只有一个权威来源**（状态仓）：乐观项与权威值都在仓里排队，谁也不会覆盖谁。
 *
 * @module dsh-palm/mobile/views/chat/use-chat-inbox
 */
import { useCallback, type MutableRefObject } from 'react'

import { inboxOf, queueItemViewOf, sessionState } from '../../../data/session.ts'
import { applyQueueItems, applySnapshot } from '../../../stream/session-store.ts'

/** hook 依赖。 */
export interface ChatInboxDeps {
  sessionId: string
  mountedRef: MutableRefObject<boolean>
  applyTurnVerdict: (verdict: { running: boolean; startAt?: number; force?: boolean }) => void
  markSnapshotAlive: () => void
  applyGoalRef: MutableRefObject<(value: unknown, activation?: 'armed' | 'disarmed') => void>
  adoptTodoRef: MutableRefObject<(next: never) => void>
  /** \`refreshInbox\` 需要在组件里被别的回调引用（ref 转手）。 */
  refreshInboxRef: MutableRefObject<(options?: { fresh?: boolean }) => void>
}

/** 把宿主 inbox 投影落进状态仓。 */
export function useChatInbox(deps: ChatInboxDeps): {
  applyInbox: (value: unknown, queueVersion?: number) => void
  refreshInbox: (options?: { fresh?: boolean }) => void
} {
  const {
    sessionId, mountedRef, applyTurnVerdict, markSnapshotAlive,
    applyGoalRef, adoptTodoRef, refreshInboxRef,
  } = deps

  /**
   * 宿主的待发投影（\`inbox.next-turn\`）就是"排队等下一轮"的那些消息 —— 桌面端 QueueDock
   * 读的也是它。把它当成一次**队列快照**进仓，界面仍然只有一个来源。
   */
  const applyInbox = useCallback((value: unknown, queueVersion?: number): void => {
    const rows = (value as { 'next-turn'?: unknown } | null | undefined)?.['next-turn']
    if (!Array.isArray(rows)) return
    const items = rows.map((row, index) => queueItemViewOf({
      id: typeof (row as { id?: unknown }).id === 'string' ? (row as { id: string }).id : String(index),
      placement: 'queued',
      message: row as { content?: unknown; source?: { kind?: unknown } },
    }))
    // 队列进仓即可：视图按仓的变更版本自动重算（W3-6），不再抄进组件状态。
    // 带上宿主的单调队列版本（老宿主是 undefined → 退回旧判据）。
    applyQueueItems(sessionId, items, queueVersion)
  }, [sessionId])

  /**
   * 立刻向宿主问一次排队快照（投影帧在手机上到不了，这是唯一可靠来源）。
   *
   * 只有刚改过队列时才要求 \`fresh\`：那一次宿主会现开一帧 follow；平时的轮询走缓存快照，
   * 否则每条排队消息都会拖着一次整日志读。
   */
  const refreshInbox = useCallback((options: { fresh?: boolean } = {}): void => {
    const fallback = (retry: boolean): void => {
      // 老宿主没有 `mobile.sessionState`：退回 inbox 投影。旧一点总比整条队列消失好。
      void inboxOf(sessionId, options).then(
        (value) => { if (mountedRef.current) applyInbox(value.inbox, value.queueVersion) },
        () => { if (retry && mountedRef.current) window.setTimeout(() => { ask(false) }, 400) },
      )
    }
    const ask = (retry: boolean): void => {
      if (typeof sessionState !== 'function') { fallback(retry); return }
      void sessionState(sessionId, options).then(
        (snapshot) => {
          if (!mountedRef.current) return
          applySnapshot(snapshot)
          // 原子快照里的回合结论就是权威：走唯一裁决入口，不再让尾页另判一份。
          const snapshotTurn = (snapshot as { turn?: { running?: boolean; turnStartAt?: number } }).turn
          if (snapshotTurn !== undefined && typeof snapshotTurn.running === 'boolean') {
            markSnapshotAlive()
            applyTurnVerdict({
              running: snapshotTurn.running,
              ...(snapshotTurn.turnStartAt === undefined ? {} : { startAt: snapshotTurn.turnStartAt }),
            })
          }
          // 队列已经随 applySnapshot 进仓并发布（W3-6）：视图按版本号自动重算。
          // 目标与待办跟着同一份快照落地：和回合状态同一切面，不会出现「目标说进行中、
          // 回合已结束」。
          if ('goal' in snapshot) applyGoalRef.current(snapshot.goal, snapshot.goalActivation)
          if (snapshot.todo !== undefined) adoptTodoRef.current(snapshot.todo as never)
        },
        () => { fallback(retry) },
      )
    }
    ask(true)
  }, [sessionId, applyInbox, mountedRef, applyTurnVerdict, markSnapshotAlive, applyGoalRef, adoptTodoRef])

  refreshInboxRef.current = refreshInbox
  return { applyInbox, refreshInbox }
}
