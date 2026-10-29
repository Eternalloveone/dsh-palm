/**
 * 目标条：复刻桌面端 composer 上方那条 goal 指示条。
 *
 * 位置（由 ChatView 决定）：排队卡片之下、模型/权限那一行之上 —— 排队消息是
 * "接下来要发出去的东西"，目标条是"这一轮为什么在跑"，两者都在输入框外沿。
 *
 * 行为：
 * - 无目标 / 加载中 / 已完成：整个条不渲染（不占位）；
 * - 目标正文一行省略，点条子本身展开/收起（手机上正文常常比屏幕长）；
 * - 动作只有四个，全部拼成 `/goal …` 命令交给宿主：暂停、恢复、编辑（就地输入）、
 *   清除。桌面端的 `remote.goals.*` 手机端没有通道，也不该为了它再开一条。
 *
 * @module dsh-palm/mobile/goal-bar
 */
import { useState, type JSX } from 'react'
import {
  GOAL_CLEAR_COMMAND,
  GOAL_PAUSE_COMMAND,
  GOAL_RESUME_COMMAND,
  goalActions,
  goalEditCommand,
  goalPhaseLabel,
  type MobileGoal,
} from './goal-projection.ts'

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
  const run = (line: string): void => {
    if (busy) return
    onCommand(line)
  }

  return (
    <div className="chat-goal" data-goal-bar="">
      <div className="chat-goal-row">
        <span className="chat-goal-glyph"><GoalGlyph /></span>
        <button
          type="button"
          className="chat-goal-main"
          aria-expanded={expanded}
          title={goal.blockedReason ?? goal.objective}
          onClick={() => { setExpanded(value => !value); setEditing(false) }}
        >
          <span className="chat-goal-label">{label}</span>
          {/* 动作刚发出去、回执还没回来：转个圈。只有置灰的话，点了像没反应。 */}
          {busy && <span className="chat-goal-spinner" aria-hidden />}
          {/* 进度摘要：已跑多久、走到第几步。长目标光看相位看不出还在不在动。 */}
          {meta !== undefined && meta !== '' && <span className="chat-goal-meta">{meta}</span>}
          {/* 收起时只留一行省略号；展开的全文放在下面的 .chat-goal-body 里 ——
              塞在这颗按钮里的话，宽度被右边的四个动作按钮切掉一截，长句会被挤成
              窄条，读起来比收起还累。 */}
          {!expanded && <span className="chat-goal-text">{goal.objective}</span>}
        </button>
        {/* 展开后必须有一个看得见的「收起」：展开的正文占满整条，只靠点标题收回
            在真机上等于没有出口（手指落在正文上，那里原先什么都不做）。 */}
        {expanded && (
          <button
            type="button"
            className="chat-goal-btn chat-goal-btn-collapse"
            aria-label="收起目标全文"
            onClick={() => { setExpanded(false) }}
          >收起
          </button>
        )}
        {actions.resume && (
          <button
            type="button"
            className="chat-goal-btn"
            disabled={busy}
            onClick={() => { run(GOAL_RESUME_COMMAND) }}
          >继续
          </button>
        )}
        {actions.pause && (
          <button
            type="button"
            className="chat-goal-btn"
            disabled={busy}
            onClick={() => { run(GOAL_PAUSE_COMMAND) }}
          >暂停
          </button>
        )}
        <button
          type="button"
          className="chat-goal-btn"
          disabled={busy}
          onClick={() => { setEditing(true); setDraft(goal.objective) }}
        >编辑
        </button>
        <button
          type="button"
          className="chat-goal-btn chat-goal-btn-clear"
          aria-label="清除目标"
          disabled={busy}
          onClick={() => { run(GOAL_CLEAR_COMMAND) }}
        >×
        </button>
      </div>
      {/* 阻塞理由：宿主会把整段排查记录塞进这里（实测能占掉大半个屏幕），默认只露两行，
          点文字或右下角那颗小按钮展开。折叠用 max-height 而不是截断字符串 ——
          展开时原文一字不改，复制出来仍是完整的一段。 */}
      {goal.phase === 'blocked' && goal.blockedReason !== undefined && !editing && (
        <div className="chat-goal-reasonWrap">
          <button
            type="button"
            className={reasonOpen ? 'chat-goal-reason' : 'chat-goal-reason chat-goal-reason-collapsed'}
            aria-expanded={reasonOpen}
            aria-label={reasonOpen ? '收起阻塞理由' : '展开阻塞理由'}
            onClick={() => { setReasonOpen(value => !value) }}
          >
            <span className="chat-goal-reasonText">{goal.blockedReason}</span>
          </button>
          <button
            type="button"
            className="chat-goal-btn chat-goal-btn-reason"
            aria-expanded={reasonOpen}
            onClick={() => { setReasonOpen(value => !value) }}
          >{reasonOpen ? '收起理由' : '展开理由'}
          </button>
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
          <button
            type="button"
            className="chat-goal-btn chat-goal-btn-save"
            disabled={busy || draft.trim() === ''}
            onClick={() => { run(goalEditCommand(draft)); setEditing(false) }}
          >保存
          </button>
          <button type="button" className="chat-goal-btn" onClick={() => { setEditing(false) }}>取消</button>
        </div>
      )}
    </div>
  )
}
