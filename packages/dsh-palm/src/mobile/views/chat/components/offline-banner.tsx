/**
 * 连接提示：会话页顶部的一行（断线 / 已重连）。
 *
 * 三条硬规则：
 * 1. **一行、展开 ≤28px**（`--palm-offline-h`）：只说连接状态，不做 toast、
 *    不盖内容区、不和插入条/队列条抢空间；
 * 2. **无图标块、无按钮**：断线「连接中断，正在重连…」，恢复「已重连」；
 * 3. **节点常驻 DOM**：收起走 `data-state`（0 高 + 透明过渡），不条件卸载 ——
 *    卸载再挂载会让下面的正文跳一下。
 *
 * 与状态条的 `unknown` 是两件事：断线只说明「手里没有权威数据」，
 * 状态条仍保持 unknown，但不在这里把它染成红色（不碰任何状态条样式）。
 *
 * @module dsh-palm/mobile/views/chat/components/offline-banner
 */
import { useEffect, useState } from 'react'

/** 「已重连」停留多久再淡出：够看清一句话，又不占着版面。 */
export const RECONNECT_FLASH_MS = 800

/** gone = 已收起（0 高）；off = 断着；back = 刚恢复。 */
type OfflineState = 'gone' | 'off' | 'back'

export interface OfflineBannerProps {
  /** 是否连不上宿主（真相源：真实请求的连通性总线，不是 navigator.onLine）。 */
  offline: boolean
}

export function OfflineBanner({ offline }: OfflineBannerProps) {
  // 进页面就断着时首帧直接是断线态，不先画一帧空行。
  const [state, setState] = useState<OfflineState>(offline ? 'off' : 'gone')

  useEffect(() => {
    if (offline) { setState('off'); return }
    setState(prev => (prev === 'off' ? 'back' : prev))
  }, [offline])

  useEffect(() => {
    if (state !== 'back') return
    const timer = setTimeout(() => { setState('gone') }, RECONNECT_FLASH_MS)
    return () => { clearTimeout(timer) }
  }, [state])

  return (
    <div className="chat-offline-banner" data-state={state} role="status">
      {state === 'off' ? '连接中断，正在重连…' : state === 'back' ? '已重连' : ''}
    </div>
  )
}
