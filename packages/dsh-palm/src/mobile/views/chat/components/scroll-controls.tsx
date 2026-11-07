/**
 * 正文区里的两个浮动控件：「输出中／连接中断」状态行、轮次刮擦按钮 + 回到底部。
 *
 * S6f 从 `ChatView` 搬出。手势（按住拖动刮擦）由会话层提供回调，这里只绑 DOM 事件，
 * 所以滚动/锚点逻辑一行没动。
 *
 * **为什么拆成两个组件而不是一个**：`.chat-jump-turns` 是 `position: sticky` +
 * `margin-top: auto`（在流里），而审批/提问面板插在状态行与这两个按钮之间。合成一个
 * 组件就得把按钮挪到面板前面，DOM 顺序一变，sticky 的落点跟着变（实测锚点位移从
 * 0px 变成 44px）。所以两段各自留在原来的位置，只是实现搬了出去。
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDownIcon } from '../../../icons.tsx'
import { Button } from '../../../ui/primitives.tsx'

export interface TurnStatusLineProps {
  /** 当前回合在跑（或刚发出去还没收到 turn/start）。 */
  running: boolean
  /** 连不上宿主：状态行改说"连接中断"，而不是一直"输出中"。 */
  hostLost: boolean
}

export function TurnStatusLine({ running, hostLost }: TurnStatusLineProps) {
  if (!running) return null
  return (
    <div className="chat-turn-status" role="status" aria-label={hostLost ? '连接中断' : '输出中'}>
      {hostLost ? '连接中断' : '输出中'}<span className="chat-turn-dots" aria-hidden><span /><span /><span /></span>
    </div>
  )
}

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
