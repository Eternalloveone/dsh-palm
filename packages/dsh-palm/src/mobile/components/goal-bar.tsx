/**
 * 目标条：复刻桌面端 composer 上方那条 goal 指示条。
 *
 * 位置（由 ChatView 决定）：排队卡片之下、模型/权限那一行之上 —— 排队消息是
 * "接下来要发出去的东西"，目标条是"这一轮为什么在跑"，两者都在输入框外沿。
 *
 * 行为：
 * - 无目标 / 加载中 / 已完成：整个条不渲染（不占位）；
 * - 目标正文一行省略，点状态行或正文都能展开/收起（手机上正文常常比屏幕长）；
 * - 动作只有四个，全部拼成 `/goal …` 命令交给宿主：暂停、恢复、编辑（就地输入）、
 *   清除；外加一颗展开/收起。
 *
 * ## 排版（2026-11-12 重排）
 *
 * 两列硬对齐，任何宽度都不换行、不重叠：
 *
 * | 行 | 左（同一竖线起） | 右（贴右缘） |
 * |---|---|---|
 * | 1 | ◉ 相位 · 进度摘要 | 图标工具栏（30×30，判定区 44） |
 * | 2 | 目标正文一行省略 | — |
 * | 3 | 展开后的全文（38vh 内滚动） | — |
 *
 * 为什么不用文字按钮：360px 屏上「相位 + 摘要 + 四个文字按钮」要 384px，而内容区
 * 只有 324px —— 摘要（`flex: none` + `nowrap`）会溢出自己的盒子，被后画的按钮压住，
 * 真机看到的就是「第 1 步」被「收起」盖掉一截（实测溢出 18px）。图标按钮把右侧
 * 从 176px 压到 126px，摘要因此完整显示；同时去掉摘要的胶囊底，让相位与摘要落在同
 * 一条基线上（胶囊内边距原先让它比正文左移 6px，正是"没对齐"的观感来源）。
 *
 * @module dsh-palm/mobile/goal-bar
 */
import { useState, type JSX, type ReactNode } from 'react'
import {
  GOAL_CLEAR_COMMAND,
  GOAL_PAUSE_COMMAND,
  GOAL_RESUME_COMMAND,
  goalActions,
  goalEditCommand,
  goalPhaseLabel,
  type MobileGoal,
} from '../session/goal-projection.ts'
import { Button } from '../ui/primitives.tsx'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
} from './icons.tsx'

export interface GoalBarProps {
  /** undefined = 还没拿到；null = 没有目标。两者都不渲染。 */
  goal: MobileGoal | null | undefined
  /** 命令是否在途中：按钮置灰，避免连点发出两条 /goal。 */
  busy?: boolean
  /** 把 `/goal …` 交给宿主的命令通道。 */
  onCommand: (line: string) => void
  /**
   * 一句话进度摘要（`已跑 5分17秒 · 第 3 步`）。
   *
   * 目标条以前只有相位和正文：长目标看不出进展，用户得去过程条上猜（真机反馈）。
   */
  meta?: string
}

/** 目标图标：一个准星环，和桌面端同一个语义（◎）。 */
function GoalGlyph({ width = 14 }: { width?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={width} height={width} aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="1.8" fill="currentColor" />
    </svg>
  )
}

/** 工具栏里的一颗图标按钮：无障碍名走 `aria-label`（图标本身 aria-hidden）。 */
function ToolButton({ label, disabled = false, onClick, children }: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <Button
      type="button"
      className="chat-goal-icon"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >{children}
    </Button>
  )
}

export function GoalBar({ goal, busy = false, onCommand, meta }: GoalBarProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  /** 阻塞理由单独一个开关：它常常是一整段排查记录，默认只露两行。 */
  const [reasonOpen, setReasonOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  // 加载中、无目标、已完成/已清除都整条不渲染 —— 与桌面端 GoalBar 同一规则。
  if (goal === undefined || goal === null) return null

  const actions = goalActions(goal)
  const label = goalPhaseLabel(goal)
  const metaText = meta !== undefined && meta !== '' ? meta : undefined
  const run = (line: string): void => {
    if (busy) return
    onCommand(line)
  }
  const toggle = (): void => {
    setExpanded(value => !value)
    setEditing(false)
  }

  return (
    <div className="chat-goal" data-goal-bar="" data-expanded={expanded ? 'true' : 'false'}>
      {/* 状态行：左边只有信息（相位 + 摘要），右边是图标工具栏。两列各自成组，
          中间的空档属于布局、不属于任何元素 —— 所以不可能互相压字。 */}
      <div className="chat-goal-head">
        <span className="chat-goal-glyph"><GoalGlyph /></span>
        <Button
          type="button"
          className="chat-goal-main"
          aria-expanded={expanded}
          title={goal.blockedReason ?? goal.objective}
          onClick={toggle}
        >
          <span className="chat-goal-label">{label}</span>
          {/* 摘要：已跑多久、走到第几步。长目标光看相位看不出还在不在动。
              可缩可省略；相位文字在窄屏让位（见 CSS 的 400px 断点）。 */}
          {metaText !== undefined && <span className="chat-goal-meta">{metaText}</span>}
          {/* 动作刚发出去、回执还没回来：转个圈。只有置灰的话，点了像没反应。 */}
          {busy && <span className="chat-goal-spinner" aria-hidden />}
        </Button>
        <div className="chat-goal-tools">
          {actions.resume && (
            <ToolButton label="继续目标" disabled={busy} onClick={() => { run(GOAL_RESUME_COMMAND) }}>
              <PlayIcon />
            </ToolButton>
          )}
          {actions.pause && (
            <ToolButton label="暂停目标" disabled={busy} onClick={() => { run(GOAL_PAUSE_COMMAND) }}>
              <PauseIcon />
            </ToolButton>
          )}
          <ToolButton label="编辑目标" disabled={busy} onClick={() => { setEditing(true); setDraft(goal.objective) }}>
            <PencilIcon />
          </ToolButton>
          <ToolButton label="清除目标" disabled={busy} onClick={() => { run(GOAL_CLEAR_COMMAND) }}>
            <CloseIcon />
          </ToolButton>
          {expanded
            ? (
              <ToolButton label="收起目标全文" onClick={() => { setExpanded(false) }}>
                <ChevronUpIcon />
              </ToolButton>
            )
            : (
              <ToolButton label="展开目标全文" onClick={toggle}>
                <ChevronDownIcon />
              </ToolButton>
            )}
        </div>
      </div>
      {/* 目标正文：收起态一行省略、单独占一行（点它也能展开）。以前它挤在状态按钮里，
          宽度被右边的动作按钮切掉一截，360px 上常常一个字都不剩。 */}
      {!expanded && (
        <Button
          type="button"
          className="chat-goal-text"
          aria-expanded={expanded}
          title={goal.objective}
          onClick={toggle}
        >{goal.objective}
        </Button>
      )}
      {/* 阻塞理由：宿主会把整段排查记录塞进这里（实测能占掉大半个屏幕），默认只露两行，
          点文字或下面那颗小按钮展开。折叠用 max-height 而不是截断字符串 ——
          展开时原文一字不改，复制出来仍是完整的一段。 */}
      {goal.phase === 'blocked' && goal.blockedReason !== undefined && !editing && (
        <div className="chat-goal-reasonWrap">
          <Button
            type="button"
            className={reasonOpen ? 'chat-goal-reason' : 'chat-goal-reason chat-goal-reason-collapsed'}
            aria-expanded={reasonOpen}
            aria-label={reasonOpen ? '收起阻塞理由' : '展开阻塞理由'}
            onClick={() => { setReasonOpen(value => !value) }}
          >
            <span className="chat-goal-reasonText">{goal.blockedReason}</span>
          </Button>
          <Button
            type="button"
            className="chat-goal-btn chat-goal-btn-reason"
            aria-expanded={reasonOpen}
            onClick={() => { setReasonOpen(value => !value) }}
          >{reasonOpen ? '收起理由' : '展开理由'}
          </Button>
        </div>
      )}
      {/* 展开的全文：保留原始换行与空行（宿主里的目标常是带小标题的多段文本），
          行高放宽到能读，最高 38vh 后自己滚动 —— 既不把输入框挤出屏幕，也不让
          一段长目标变成一条挤在一起的文字墙。
          正文本身也可以点收（手指自然落在文字上），但拖出了选区就不要收 ——
          用户那一刻是在复制，不是在折叠。 */}
      {expanded && !editing && (
        <div
          className="chat-goal-body"
          role="region"
          aria-label="目标全文"
          onClick={() => {
            const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
            if (selection !== null && selection.toString() !== '') return
            setExpanded(false)
          }}
        >{goal.objective}</div>
      )}
      {editing && (
        <div className="chat-goal-edit">
          <input
            className="chat-goal-input"
            value={draft}
            aria-label="目标正文"
            onChange={(event) => { setDraft(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draft.trim() !== '') {
                run(goalEditCommand(draft))
                setEditing(false)
              }
              if (event.key === 'Escape') setEditing(false)
            }}
          />
          <Button
            type="button"
            className="chat-goal-btn chat-goal-btn-save"
            disabled={busy || draft.trim() === ''}
            onClick={() => { run(goalEditCommand(draft)); setEditing(false) }}
          >保存
          </Button>
          <Button type="button" className="chat-goal-btn" onClick={() => { setEditing(false) }}>取消</Button>
        </div>
      )}
    </div>
  )
}
