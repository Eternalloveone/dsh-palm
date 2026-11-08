/**
 * 结论卡：每轮对话只出现一次的那张卡（四态一骨架）。
 *
 * 骨架（来自 `docs/mobile-design-spec.md` 第四节）：
 *
 * ```
 * ┌ 标签（结论 / 要你决定 / 正在做 / 没做成）
 * │ 结论句（17px 加粗，必须第一句）
 * │ 补充一句（14px，次灰）
 * │ [交付物条]
 * │ [动作 1][动作 2]（最多 3 个，其余进 ⋯）
 * └ 脚注（思考秒数 · 工具次数 · token）
 * ```
 *
 * 四条硬规则（组件层面能守的都守了）：
 * 1. 每轮只出现一次 —— 由调用方保证；
 * 2. **第一句是结论** —— headline 必填、且是第一个可读元素；
 * 3. 数字真实可验证 —— footnote 只渲染调用方给的真数字，**不编百分比**；
 * 4. 动作只放最可能的 2–3 个 —— 超出 3 个的收进 `⋯` 菜单。
 *
 * @module dsh-palm/mobile/ui/verdict-card
 */
import { useState } from 'react'
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

/** 交付物/影响范围条的一项。 */
export interface VerdictArtifact {
  /** 名字，如「3 个文件」。 */
  label: string
  /** 细节，如 `+128 / -24`。 */
  detail?: string
}

/** 脚注里的真实数字（给不出就不给，绝不编）。 */
export interface VerdictFootnote {
  /** 思考耗时（秒）。 */
  seconds?: number
  /** 工具调用次数。 */
  tools?: number
  /** token 数（原值，渲染时按 k 缩写）。 */
  tokens?: number
}

/** 结论卡的 props。 */
export interface VerdictCardProps {
  /** 当前状态，决定标签与左边框颜色。 */
  state: VerdictState
  /** 结论句：第一句就要说清"成了没成"。 */
  headline: string
  /** 补充一句（可省）。 */
  detail?: string
  /** 交付物/影响范围条（可省）。 */
  artifacts?: readonly VerdictArtifact[]
  /** 动作，最多显示 3 个，其余收进 ⋯。 */
  actions?: readonly VerdictAction[]
  /** 脚注（可省；数字必须真实）。 */
  footnote?: VerdictFootnote
}

/** 四态对应的标签文案。 */
const STATE_LABEL: Record<VerdictState, string> = {
  conclusion: '结论',
  decision: '要你决定',
  working: '正在做',
  failed: '没做成',
}

/** 最多直接摆出来的动作数。 */
const MAX_VISIBLE_ACTIONS = 3

/** token 数按需缩写（1.2k）；不四舍五入成百分比或估算值。 */
function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}

/** 拼脚注：只放真给出来的数字，缺的整段省略。 */
function footnoteText(footnote: VerdictFootnote | undefined): string {
  if (footnote === undefined) return ''
  const parts: string[] = []
  if (footnote.seconds !== undefined) parts.push(`${footnote.seconds} 秒`)
  if (footnote.tools !== undefined) parts.push(`${footnote.tools} 次工具`)
  if (footnote.tokens !== undefined) parts.push(`${formatTokens(footnote.tokens)} tokens`)
  return parts.join(' · ')
}

/**
 * 渲染一张结论卡。
 *
 * @param props - 状态、结论句与可选的动作/交付物/脚注
 * @returns 结论卡元素
 */
export function VerdictCard({
  state,
  headline,
  detail,
  artifacts,
  actions,
  footnote,
}: VerdictCardProps) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const visible = (actions ?? []).slice(0, MAX_VISIBLE_ACTIONS)
  const overflow = (actions ?? []).slice(MAX_VISIBLE_ACTIONS)
  const footnoteCaption = footnoteText(footnote)

  return (
    <section className="verdict-card" data-state={state} aria-label={STATE_LABEL[state]}>
      <span className="verdict-tag">{STATE_LABEL[state]}</span>
      <h2 className="verdict-headline">{headline}</h2>
      {detail === undefined ? null : <p className="verdict-detail">{detail}</p>}
      {artifacts === undefined || artifacts.length === 0 ? null : (
        <div className="verdict-artifacts">
          {artifacts.map(artifact => (
            <span className="verdict-artifact" key={artifact.label}>
              <b>{artifact.label}</b>
              {artifact.detail === undefined ? null : ` ${artifact.detail}`}
            </span>
          ))}
        </div>
      )}
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
      {footnoteCaption === '' ? null : <span className="verdict-footnote">{footnoteCaption}</span>}
    </section>
  )
}
