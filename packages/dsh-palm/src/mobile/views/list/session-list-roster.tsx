/**
 * The session roster body for {@link SessionListView}: skeleton, day-grouped
 * rows, the load-more sentinel and the empty state. Rows keep the view's own
 * handlers/key strategy — this file only draws them.
 */

import type { MutableRefObject } from 'react'
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react'
import { formatFullTime } from '../../shared/time.ts'
import type { SessionView } from '../../shared/session-view.ts'
import { ChatBubbleIcon, CheckIcon } from '../../components/icons.tsx'
import type { DayBucket } from './session-list-model.ts'
import { Button } from '../../ui/primitives.tsx'

/** Pointer handlers the view builds per row (long-press / swipe / tap). */
export interface SessionRowHandlers {
  onTouchStart(event: ReactTouchEvent): void
  onTouchMove(event: ReactTouchEvent): void
  onTouchEnd(): void
  onClick(event: ReactMouseEvent): void
  onContextMenu(event: ReactMouseEvent): void
}

export interface SessionListRosterProps {
  /** 正在等用户批准/回答的会话 id：行上会显示「待确认」胶囊。 */
  pendingIds?: ReadonlySet<string> | undefined
  loading: boolean
  rows: readonly SessionView[]
  groups: ReadonlyArray<{ bucket: DayBucket; rows: SessionView[] }>
  hasMore: boolean
  openSwipeId: string | undefined
  previewCache: ReadonlyMap<string, string>
  sentinelRef: MutableRefObject<HTMLDivElement | undefined>
  rowHandlers(row: SessionView): SessionRowHandlers
  /** Rows kept with real layout at the tail (content-visibility). */
  keepBottom: number
  onLoadMore(): void
  onDeleteRow(row: SessionView): void
}

/** The roster list itself. */
export function SessionListRoster({
  loading,
  rows,
  groups,
  hasMore,
  openSwipeId,
  previewCache,
  sentinelRef,
  rowHandlers,
  keepBottom,
  onLoadMore,
  onDeleteRow,
  pendingIds,
}: SessionListRosterProps) {
  return (
      <ul className="mobile-list">
        {loading && rows.length === 0 && (
          <div aria-hidden="true" role="presentation">
            {[0, 1, 2].map(index => (
              <div className="skel-row" key={index}>
                <span className="skel skel-icon" />
                <div className="skel-lines">
                  <div className="skel skel-line-title" />
                  <div className="skel skel-line-sub" />
                </div>
                <span />
              </div>
            ))}
          </div>
        )}
        {(() => {
          // Flat row index across day-group buckets for the content-visibility
          // tail keep (bottom rows must render real so the sentinel stays
          // reachable; rows above skip layout/paint).
          let flatIndex = 0
          const totalRows = groups.reduce((total, group) => total + group.rows.length, 0)
          return groups.map(group => {
          return (
            <li key={group.bucket} style={{ listStyle: 'none' }}>
              <div className="mobile-groupTitle">{group.bucket}<span className="mobile-groupCount"> · {group.rows.length}</span></div>
              {group.rows.map(row => {
                const preview = row.preview ?? previewCache.get(row.sessionId)
                  ?? (row.turns !== undefined ? `${row.turns} 轮对话` : undefined)
                // content-visibility: skip layout/paint for rows far above the
                // viewport; keep the tail real so the sentinel stays reachable.
                const cvTail = flatIndex >= totalRows - keepBottom
                const cvStyle = cvTail || totalRows < 20
                  ? undefined
                  : { contentVisibility: 'auto' as const, containIntrinsicSize: 'auto 72px' }
                flatIndex += 1
                const swiped = openSwipeId === row.sessionId
                return (
                  <div key={row.sessionId} className="mobile-row-swipe" style={cvStyle}>
                    <Button
                      type="button"
                      className="mobile-row-swipe-action"
                      aria-label="删除会话"
                      onClick={() => { onDeleteRow(row) }}
                    >
                      删除
                    </Button>
                    <div className={'mobile-row-swipe-inner' + (swiped ? ' swiped' : '')}>
                      <Button type="button" className="mobile-row mobile-row-sess" {...rowHandlers(row)}>
                        <span className="card-icon">
                          {row.running ? (
                            <span className="sess-dot sess-dot-running" role="img" aria-label="进行中" />
                          ) : (
                            <span className="sess-check" aria-hidden><CheckIcon /></span>
                          )}
                        </span>
                        <span className="card-main">
                          <span className="sess-titleline">
                            <span className="sess-title">{row.title}</span>
                          </span>
                          <span className="sess-meta">
                            {row.blank && <span className="sess-status sess-status-info">新</span>}
                            {row.running && <span className="sess-status sess-status-ok">进行中</span>}
                            {pendingIds?.has(row.sessionId) === true && (
                              <span className="sess-status sess-status-warn">待确认</span>
                            )}
                            {row.error !== undefined && <span className="sess-status sess-status-danger" title={row.error}>出错</span>}
                            <span className="sess-time">{formatFullTime(row.updatedAt)}</span>
                          </span>
                          {preview !== undefined && <span className="card-desc">{preview}</span>}
                        </span>
                        <span className="card-action">
                          <span className="mobile-chevron" aria-hidden>›</span>
                        </span>
                      </Button>
                    </div>
                  </div>
                )
              })}
            </li>
          )
        })})()}
        {hasMore && (
          <li style={{ listStyle: 'none' }}>
            <div className="mobile-pad">
              <div ref={ref => { sentinelRef.current = ref ?? undefined }} aria-hidden="true" />
              <Button
                type="button"
                className="mobile-button mobile-block"
                disabled={loading}
                onClick={() => { onLoadMore() }}
              >
                {loading ? '加载中…' : '加载更多会话'}
              </Button>
            </div>
          </li>
        )}
        {!hasMore && rows.length === 0 && !loading && (
          <div className="mobile-empty">
            <div className="empty-icon"><ChatBubbleIcon /></div>
            <p className="empty-title">还没有会话</p>
            <p className="empty-desc">点上方按钮新建一个，开始这个项目的第一段对话</p>
          </div>
        )}
      </ul>
  )
}
