import { Button } from '../../ui/primitives.tsx'
/**
 * 离线/待发条：断网提示、待发条数与逐条移除。
 *
 * S6f 从 `ChatView` 搬出。判据由调用方给（`offline` 来自真实请求的连通性总线，
 * 不是 `navigator.onLine`——安卓上它会一直停在 false）；这里只负责画出来。
 */
export interface OfflineBannerProps {
  /** 是否连不上宿主。 */
  offline: boolean
  /** 离线队列里还有几条。 */
  queuedCount: number
  /** 逐条展示（让用户能单独移除某一条，而不是"整个队列重来"）。 */
  entries: ReadonlyArray<{ id: string; text: string }>
  onFlush: () => void
  onRemove: (id: string) => void
}

export function OfflineBanner({ offline, queuedCount, entries, onFlush, onRemove }: OfflineBannerProps) {
  if (!offline && queuedCount === 0) return null
  return (
    <div
      className="chat-offline-banner"
      role="status"
      style={{ flexDirection: 'column', alignItems: 'stretch', padding: '8px 16px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>
          {offline
            ? '网络已断开，消息将在恢复后发送'
            : queuedCount > 0
              ? `${queuedCount} 条离线消息待发送`
              : ''}
        </span>
        {!offline && queuedCount > 0 && (
          <Button type="button" className="chat-offline-retry" onClick={onFlush}>重试</Button>
        )}
      </div>
      {entries.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map(entry => (
            <li key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.text}</span>
              <Button
                type="button"
                className="chat-offline-retry"
                aria-label="移除待发送消息"
                onClick={() => { onRemove(entry.id) }}
              >
                移除
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
