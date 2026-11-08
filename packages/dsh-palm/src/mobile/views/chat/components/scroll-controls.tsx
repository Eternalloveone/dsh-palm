/**
 * 正文区里的浮动控件：轮次刮擦按钮 + 回到底部。
 *
 * S6f 从 `ChatView` 搬出。手势（按住拖动刮擦）由会话层提供回调，这里只绑 DOM 事件，
 * 所以滚动/锚点逻辑一行没动。
 *
 * 这里原来还有一条「输出中／连接中断」状态行（`TurnStatusLine` + 三个呼吸点）。
 * 2026-11-08 删掉：运行态改由任务头里的状态条（`ui/status-strip.tsx`）、
 * 过程折叠行（`ui/process-line.tsx`）与过程步骤行承担，底部不再重复说一遍。
 * 两个浮动按钮仍留在原来的位置：`.chat-jump-turns` 是 `position: sticky` +
 * `margin-top: auto`（在流里），审批/提问面板插在它前面；DOM 顺序一动，sticky 的
 * 落点跟着位移（实测锚点位移从 0px 变成 44px）。
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDownIcon } from '../../../components/icons.tsx'
import { Button } from '../../../ui/primitives.tsx'

export interface JumpControlsProps {
  /** 是否显示右侧两个浮动按钮（离底时才有）。 */
  show: boolean
  /** 有至少两轮才值得开轮次导航。 */
  hasTurns: boolean
  /** 正在刮擦（按钮高亮）。 */
  scrubbing: boolean
  shownTurn: number
  maxTurn: number
  unreadCount: number
  onScrubDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onScrubMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onScrubUp: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onScrubCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onOpenTurnList: () => void
  onJumpLatest: () => void
}

export function JumpControls(props: JumpControlsProps) {
  const {
    show, hasTurns, scrubbing, shownTurn, maxTurn, unreadCount,
    onScrubDown, onScrubMove, onScrubUp, onScrubCancel, onOpenTurnList, onJumpLatest,
  } = props
  return (
    <>
      {show && hasTurns && (
        <Button
          type="button"
          className={'chat-jump-turns' + (scrubbing ? ' chat-jump-turns-live' : '')}
          aria-label="轮次导航：轻点开清单，按住拖动刮擦"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubCancel}
          onLostPointerCapture={onScrubCancel}
          onClick={(event) => { if (event.detail === 0) onOpenTurnList() }}
        >
          <span className="chat-jump-turns-label">{shownTurn}/{maxTurn}</span>
        </Button>
      )}
      {show && (
        <Button
          type="button"
          className={'chat-jump-latest' + (unreadCount > 0 ? ' chat-jump-latest-hot' : '')}
          aria-label="回到最新消息"
          onClick={onJumpLatest}
        >
          <ChevronDownIcon width={20} height={20} />
          {unreadCount > 0 && <span className="chat-jump-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </Button>
      )}
    </>
  )
}
