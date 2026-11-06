/**
 * 重载尾页：已收工的命令可能改写历史（`/compact` 会把旧回合折起来），而实时帧无法撤销
 * 已经画出来的行 —— 只能重新拉一次尾页。
 *
 * S7a-2 从 `ChatView` 搬出（纯逻辑 + 显式状态注入）。三条老规矩原样保留：
 *
 * 1. **重载期间到的实时帧先入缓冲**（`tailLoadingRef`），页到齐后再折到新折叠器上；
 *    没有这道闸，帧会折进即将被替换的旧折叠器，然后随它一起被丢掉。
 * 2. **只有最新一次重载算数**（epoch + abort 掉上一次）：两次快速重载时，慢的那次
 *    不能把后一次的行盖掉。
 * 3. **一次都没读成功要明说**：点了一条已删的会话/失效链接，页面不能永远停在"加载中"。
 */
import { loadChatPage } from './chat-page.ts'
import { EventFolder, foldEvents, type RenderMessage, type WireEvent } from '../messages.ts'

export interface ReloadTailDeps {
  sessionId: string
  /** 上一次重载的 abort 句柄（新的开始时先掐掉它）。 */
  controllerRef: { current: AbortController | undefined }
  /** 只认最新一次的代数。 */
  epochRef: { current: number }
  /** 重载途中：实时帧改走缓冲。 */
  tailLoadingRef: { current: boolean }
  liveBufferRef: { current: WireEvent[] }
  folderRef: { current: EventFolder | undefined }
  dropWindowRef: { current: { from: number; to: number } | undefined }
  liveBufferOverflowRef: { current: boolean }
  /** 有没有成功读到过一页（决定失败时要不要报"打不开"）。 */
  loadedPageRef: { current: boolean }
  applyMessages: (rows: RenderMessage[]) => void
  setHasOlder: (value: boolean) => void
  setError: (message: string) => void
  refillGap: (gap: { from: number; to: number }, signal: AbortSignal, isCancelled: () => boolean) => void
}

export function reloadTailPage(deps: ReloadTailDeps): void {
  const {
    sessionId, controllerRef, epochRef, tailLoadingRef, liveBufferRef, folderRef, dropWindowRef,
    liveBufferOverflowRef, loadedPageRef, applyMessages, setHasOlder, setError, refillGap,
  } = deps

  controllerRef.current?.abort()
  const controller = new AbortController()
  controllerRef.current = controller
  const epoch = epochRef.current + 1
  epochRef.current = epoch
  tailLoadingRef.current = true

  void loadChatPage(sessionId, undefined, controller.signal).then(
    (page) => {
      if (epoch !== epochRef.current) return
      const buffered = liveBufferRef.current
      liveBufferRef.current = []
      tailLoadingRef.current = false
      const folder = new EventFolder(page.rows, page.maxSeq)
      loadedPageRef.current = true
      folderRef.current = folder
      applyMessages(folder.fold(buffered))
      setHasOlder(page.hasMore)
      // 重载窗口也溢出了：和首次加载一样把丢掉的那段补回来。
      const gap = dropWindowRef.current
      if (gap !== undefined) {
        dropWindowRef.current = undefined
        liveBufferOverflowRef.current = false
        refillGap(gap, controller.signal, () => epoch !== epochRef.current)
      }
    },
    () => {
      if (epoch !== epochRef.current) return
      tailLoadingRef.current = false
      // 失败也要把缓冲倒进旧折叠器，否则这些帧永远留在缓冲里看不见。
      const buffered = liveBufferRef.current
      liveBufferRef.current = []
      if (buffered.length > 0) {
        const folder = folderRef.current
        applyMessages(folder === undefined ? foldEvents(buffered) : folder.fold(buffered))
      }
      if (!loadedPageRef.current) {
        setError('打不开这个会话：它可能已被删除，或链接已失效')
      }
    },
  )
}
