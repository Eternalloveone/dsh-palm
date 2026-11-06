/**
 * 缺口回填：尾部缓冲溢出丢掉了一段 seq 窗口时，按段从新到旧一页页把这段补回来。
 *
 * S7a 的第一块（从 `ChatView` 搬出纯逻辑，不动 JSX）。原来的实现活在 ChatView 的
 * `useCallback` 里，只能靠闭包拿到 `folderRef` / `commitRows` / `applyMessages`；
 * 现在这些都从参数进来，会话层与 hook 都能复用。
 *
 * 两条判据原样保留：
 * - 页码重叠要裁：窗口底部那一页已经活在尾部快照里，直接前插会重复行；
 * - 游标不动就停：`oldestSeq >= beforeSeq` 说明这一页没带来更早的行，再翻就是死循环。
 */
import { loadChatPage } from './chat-page.ts'
import { EventFolder, renderRows, type RenderMessage } from '../messages.ts'

export interface RefillGapOptions {
  sessionId: string
  /** 丢掉的那段 seq 窗口（闭区间）。 */
  gap: { from: number; to: number }
  signal: AbortSignal
  /** 这一批是否已经作废（换会话、又重载了一次……）。 */
  isCancelled: () => boolean
  /** 当前折叠器；undefined 表示还没建立（这时直接往行列表前面插）。 */
  folder: () => EventFolder | undefined
  /** 没有折叠器时用：把行前插进当前行列表。 */
  commitRows: (updater: (previous: readonly RenderMessage[]) => RenderMessage[]) => void
  /** 有折叠器时用：把折叠后的快照整体换上。 */
  applyMessages: (rows: RenderMessage[]) => void
}

export function refillGap(options: RefillGapOptions): void {
  const { sessionId, gap, signal, isCancelled, folder, commitRows, applyMessages } = options
  let beforeSeq = gap.to + 1
  const refill = (): void => {
    void loadChatPage(sessionId, beforeSeq, signal).then(
      (fresh) => {
        if (isCancelled()) return
        const target = folder()
        const older = renderRows(fresh.rows)
        // 丢掉窗口底部及以下的行：它们已经活在尾部快照里，前插会重复。
        const trimmed = older.filter(row => (row.startSeq ?? row.seq) >= gap.from)
        if (trimmed.length > 0) {
          if (target === undefined) {
            commitRows(previous => [...trimmed, ...previous])
          } else {
            target.prepend(trimmed)
            applyMessages(target.snapshot())
          }
        }
        const oldestSeq = trimmed.length > 0 ? (trimmed[0]?.startSeq ?? trimmed[0]?.seq) : undefined
        // 到达窗口底边、历史到头、或游标没前进 → 停。
        if (oldestSeq === undefined || oldestSeq <= gap.from || !fresh.hasMore) return
        if (oldestSeq >= beforeSeq) return
        beforeSeq = oldestSeq
        refill()
      },
      (reason: unknown) => {
        if (!isCancelled()) console.warn('history gap refill failed', reason)
      },
    )
  }
  refill()
}
