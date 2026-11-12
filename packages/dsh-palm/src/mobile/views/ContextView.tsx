/**
 * ⑦ 上下文占用（独立页面，P6 第 7 屏迁移）。
 *
 * 规范里写的是"三段构成 + 压缩"，但宿主目前只给得出三个数：
 * `contextWindow`、`pressureTokens`、`projectedTokens`——**没有**系统/工具/对话的
 * 三段拆分。所以这一屏如实展示三个真数字 + 一条占用条，不编造构成比例。
 * 等宿主补上拆分再加段，比先画一个假饼图强。
 *
 * @module dsh-palm/mobile/views/ContextView
 */
import { settingsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { IconButton } from '../ui/primitives.tsx'
import { EmptyState } from '../ui/empty-state.tsx'
import { ClockIcon } from '../components/icons.tsx'

export interface ContextViewProps {
  /** 上下文窗口总量（token）；宿主没给就不显示这一行。 */
  contextWindow?: number
  /** 当前压力值（token）。 */
  pressureTokens?: number
  /** 预计值（压缩前，token）。 */
  projectedTokens?: number
  onBack(): void
}

/** token 数按 1.2k / 12k 缩写（不换算成百分比结论）。 */
function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

/**
 * 渲染上下文占用页。
 *
 * @param props - 三个真实数字与返回回调
 * @returns 占用页
 */
export function ContextView({ contextWindow, pressureTokens, projectedTokens, onBack }: ContextViewProps) {
  const used = pressureTokens ?? projectedTokens
  const ratio = contextWindow !== undefined && contextWindow > 0 && used !== undefined
    ? Math.min(1, used / contextWindow)
    : undefined

  return (
    <SlotLayout
      spec={settingsLayout}
      className="context-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot">
              <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
            </div>
            <h1 className="mobile-title">上下文占用</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
          </header>
        ),
        groups: (
          <div className="context-page-body">
            {used === undefined && contextWindow === undefined ? (
              <EmptyState
        icon={<ClockIcon />}
        title="宿主还没报上下文用量"
        hint="跑完一轮对话后再看，这里会有真实数字。"
      />
            ) : (
              <>
                {used === undefined ? null : (
                  <p className="context-page-figure">
                    <span className="context-page-figure-value">{formatTokens(used)}</span>
                    <span className="context-page-figure-unit">已占用</span>
                    {/* 百分比直接写出来（2026-11-10 实拍）：数字和窗口总量分两行摆，
                        占用条又没有刻度，用户得自己心算；aria-label 里本来就有这个数，
                        但只有读屏能拿到。aria-hidden 是因为占用条已经报过同一句。 */}
                    {ratio === undefined ? null : (
                      <span className="context-page-figure-pct" aria-hidden="true">
                        {Math.round(ratio * 100)}%
                      </span>
                    )}
                  </p>
                )}
                {ratio === undefined || used === undefined || contextWindow === undefined ? null : (
                  // 2026-11-10 实拍：原来是 4 档宽度的 span（ceil(ratio*4)），26% 会被画成
                  // 半满、74% 画成 75% —— 条子和数字对不上。换原生 <progress>：值就是真值，
                  // 宽度由浏览器按比例算，既不用行内样式，也不用 4 档规则，读屏还自动报数。
                  <progress
                    className="context-bar"
                    value={used}
                    max={contextWindow}
                    data-pressure={ratio >= 0.85 ? 'high' : undefined}
                    aria-label={`上下文已用 ${Math.round(ratio * 100)}%`}
                  />
                )}
                <dl className="context-facts">
                  {contextWindow === undefined ? null : (
                    <>
                      <dt>窗口总量</dt>
                      <dd>{formatTokens(contextWindow)}</dd>
                    </>
                  )}
                  {/* 2026-11-10 实拍：三个数字并列，"还能装多少"却要自己减。
                      剩余由前两个算得出，不引入新数据；缺任何一个就不显示。 */}
                  {contextWindow === undefined || used === undefined ? null : (
                    <>
                      <dt>剩余</dt>
                      <dd>{formatTokens(Math.max(0, contextWindow - used))}</dd>
                    </>
                  )}
                  {projectedTokens === undefined ? null : (
                    <>
                      <dt>压缩前预计</dt>
                      <dd>{formatTokens(projectedTokens)}</dd>
                    </>
                  )}
                </dl>
                <p className="context-page-note">
                  占用越满，模型能记住的越少。接近上限时会自动压缩较早的对话，压缩后这一段会变成摘要。
                </p>
              </>
            )}
          </div>
        ),
      }}
    />
  )
}
