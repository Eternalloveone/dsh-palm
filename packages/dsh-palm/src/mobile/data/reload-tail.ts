/**
 * 重载尾页：已收工的命令可能改写历史（`/compact` 会把旧回合折起来），而实时帧无法撤销
 * 已经画出来的行 —— 只能重新拉一次尾页。
 *
 * S7a-2 从 `ChatView` 搬出；S7a-3b 起改为直接操纵 `StreamState`（那 9 个字段收在一个对象里），
 * 不再逐个接收 ref 包装。三条老规矩原样保留：
 *
 * 1. **重载期间到的实时帧先入缓冲**（`tailLoading`），页到齐后再折到新折叠器上；
 *    没有这道闸，帧会折进即将被替换的旧折叠器，然后随它一起被丢掉。
 * 2. **只有最新一次重载算数**（epoch + abort 掉上一次）：两次快速重载时，慢的那次
 *    不能把后一次的行盖掉。
 * 3. **一次都没读成功要明说**：点了一条已删的会话/失效链接，页面不能永远停在"加载中"。
 */
import { loadChatPage } from './chat-page.ts'
import type { StreamState } from '../views/chat/stream-state.ts'
import { EventFolder, foldEvents, type RenderMessage } from '../messages.ts'

export interface ReloadTailDeps {
  sessionId: string
  /** 9 个流式字段（缓冲、折叠器、窗口、标志位）。 */
  state: StreamState
  /** 上一次重载的 abort 句柄（新的开始时先掐掉它）。 */
  controllerRef: { current: AbortController | undefined }
  /** 只认最新一次的代数。 */
  epochRef: { current: number }
  applyMessages: (rows: RenderMessage[]) => void
  setHasOlder: (value: boolean) => void
  setError: (message: string) => void
  refillGap: (gap: { from: number; to: number }, signal: AbortSignal, isCancelled: () => boolean) => void
}

export function reloadTailPage(deps: ReloadTailDeps): void {
  const { sessionId, state, controllerRef, epochRef, applyMessages, setHasOlder, setError, refillGap } = deps

  controllerRef.current?.abort()
  const controller = new AbortController()
  controllerRef.current = controller
  const epoch = epochRef.current + 1
  epochRef.current = epoch
  state.tailLoading = true

  void loadChatPage(sessionId, undefined, controller.signal).then(
    (page) => {
      if (epoch !== epochRef.current) return
      const buffered = state.liveBuffer
      state.liveBuffer = []
      state.tailLoading = false
      const folder = new EventFolder(page.rows, page.maxSeq)
      state.loadedPage = true
      state.folder = folder
      applyMessages(folder.fold(buffered))
      setHasOlder(page.hasMore)
      // 重载窗口也溢出了：和首次加载一样把丢掉的那段补回来。
      const gap = state.dropWindow
      if (gap !== undefined) {
        state.dropWindow = undefined
        state.liveBufferOverflow = false
        refillGap(gap, controller.signal, () => epoch !== epochRef.current)
      }
    },
    () => {
      if (epoch !== epochRef.current) return
      state.tailLoading = false
      // 失败也要把缓冲倒进旧折叠器，否则这些帧永远留在缓冲里看不见。
      const buffered = state.liveBuffer
      state.liveBuffer = []
      if (buffered.length > 0) {
        const folder = state.folder
        applyMessages(folder === undefined ? foldEvents(buffered) : folder.fold(buffered))
      }
      if (!state.loadedPage) {
        setError('打不开这个会话：它可能已被删除，或链接已失效')
      }
    },
  )
}
