/**
 * 结论卡：每轮对话只出现一次的那张卡（四态一骨架）。
 *
 * 版式来自 `docs/prototype/chat-rework.html`（390×844 对照稿）：
 *
 * ```
 * ┌ 3px 状态色带（卡片顶边，随四态换色）
 * │ ✓ 已完成            ← 标签行（12px，状态色）
 * │ 一句结论             ← 17px 加粗，必须第一句
 * │ 12.4s   2,666   9    ← 一行三个大号数字（22px），下面 12px 灰字说明
 * │ [12 个文件][+214/−86][待真机验证]  ← 底部彩色标签
 * │ [动作…]
 * └
 * ```
 *
 * 三条硬规则（组件层面能守的都守了）：
 * 1. 每轮只出现一次 —— 由调用方保证；
 * 2. **第一句是结论** —— headline 必填、且是第一个可读元素；
 * 3. 数字真实可验证 —— 统计只渲染调用方给的真数字，**不编百分比、不补零**：
 *    拿不到的数字整项不渲染（连占位都不留）。
 *
 * @module dsh-palm/mobile/ui/verdict-card
 */
import { useState, type ReactNode } from 'react'
import { CheckIcon, ClockIcon, CloseIcon, HelpIcon } from '../components/icons.tsx'
import { Button } from './primitives.tsx'

/** 四态。 */
export type VerdictState = 'conclusion' | 'decision' | 'working' | 'failed'

/** 卡片上的一枚动作。 */
export interface VerdictAction {
  /** 按钮文字（尽量两个字的动词）。 */
  label: string
  /** 点击后的行为。 */
  onRun: () => void
  /** 主按钮（一轮最多一个）。 */
  primary?: boolean
}

/** 一行三个大号数字里的一项（数字 + 12px 灰字说明）。 */
export interface VerdictStat {
  /** 数字或短语，如 `12.4s` / `2,666` / `9`。 */
  value: string
  /** 数字下面的说明，如「耗时」「工具」「文件」。 */
  label: string
}

/** 底部彩色标签的色调（对应 chip-ok / chip-info / chip-warn）。 */
export type VerdictChipTone = 'ok' | 'info' | 'warn'

/** 底部一行彩色标签里的一枚。 */
export interface VerdictChip {
  label: string
  tone: VerdictChipTone
}

/** 结论卡的 props。 */
export interface VerdictCardProps {
  /** 当前状态，决定标签与顶边色带。 */
  state: VerdictState
  /** 结论句：第一句就要说清"成了没成"。 */
  headline: string
  /** 补充一句（可省）。 */
  detail?: string
  /** 一行三个大号数字（可省；只放真实数字）。 */
  stats?: readonly VerdictStat[]
  /** 底部彩色标签（可省；只放真实事实）。 */
  chips?: readonly VerdictChip[]
  /** 动作，最多显示 3 个，其余收进 ⋯。 */
  actions?: readonly VerdictAction[]
}

/** 四态对应的标签文案（原型：结论位写「已完成」）。 */
const STATE_LABEL: Record<VerdictState, string> = {
  conclusion: '已完成',
  decision: '要你决定',
  working: '正在做',
  failed: '没做成',
}

/** 标签行前面的 16px 线性图标：形状也分四态，不只靠颜色。 */
const STATE_ICON: Record<VerdictState, ReactNode> = {
  conclusion: <CheckIcon width={16} height={16} />,
  decision: <HelpIcon width={16} height={16} />,
  working: <ClockIcon width={16} height={16} />,
  failed: <CloseIcon width={16} height={16} />,
}

/** 最多直接摆出来的动作数。 */
const MAX_VISIBLE_ACTIONS = 3

/**
 * 渲染一张结论卡。
 *
 * @param props - 状态、结论句与可选的动作/统计/标签
 * @returns 结论卡元素
 */
export function VerdictCard({ state, headline, detail, stats, chips, actions }: VerdictCardProps) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const visible = (actions ?? []).slice(0, MAX_VISIBLE_ACTIONS)
  const overflow = (actions ?? []).slice(MAX_VISIBLE_ACTIONS)
  const hasStats = stats !== undefined && stats.length > 0
  const hasChips = chips !== undefined && chips.length > 0

  return (
    <section className="verdict-card" data-state={state} aria-label={STATE_LABEL[state]}>
      <span className="verdict-tag">
        {STATE_ICON[state]}
        {STATE_LABEL[state]}
      </span>
      <h2 className="verdict-headline">{headline}</h2>
      {detail === undefined ? null : <p className="verdict-detail">{detail}</p>}
      {hasStats ? (
        <div className="verdict-stats">
          {stats.map(stat => (
            <div key={stat.label}>
              <b>{stat.value}</b>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      {hasChips ? (
        <div className="verdict-foot">
          {chips.map(chip => (
            <span className="chip" data-tone={chip.tone} key={chip.label}>{chip.label}</span>
          ))}
        </div>
      ) : null}
      {visible.length === 0 ? null : (
        <div className="verdict-actions">
          {visible.map(action => (
            <Button
              key={action.label}
              className={action.primary === true ? 'mobile-btn mobile-btn-primary' : 'mobile-btn'}
              onClick={action.onRun}
            >
              {action.label}
            </Button>
          ))}
          {overflow.length === 0 ? null : (
            <>
              <Button
                className="mobile-btn"
                aria-expanded={overflowOpen}
                onClick={() => { setOverflowOpen(open => !open) }}
              >
                ⋯
              </Button>
              {overflowOpen
                ? overflow.map(action => (
                    <Button
                      key={action.label}
                      className="mobile-btn"
                      onClick={() => {
                        setOverflowOpen(false)
                        action.onRun()
                      }}
                    >
                      {action.label}
                    </Button>
                  ))
                : null}
            </>
          )}
        </div>
      )}
    </section>
  )
}
