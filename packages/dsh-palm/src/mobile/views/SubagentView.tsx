/**
 * 子代理详情页（独立页）。
 *
 * 为什么要有这一页（2026-11-11 用户：「子代理要不要做成可以点进去看内容」）：
 * 之前手机上只能看到「子代理 2 个运行中」和一条「子任务状态更新」的卡片 ——
 * 它跑了什么、结论是什么，一概看不到。长任务卡住时，用户没法判断是慢还是死了。
 *
 * 业界的两种极端都有反例：Claude Code 的主线程只给一行 `Done (…)` 且点不开
 * （被用户当 bug 报），而它的 VS Code 面板全铺开、fan-out 时把主对话淹掉。
 * 折中是**列表 → 点开独立页**：主对话保持干净，细节随时可查。
 *
 * 数据来自 `session/subagent-detail.ts`：子代理本身就是一个会话，读它的尾部一页。
 *
 * @module dsh-palm/mobile/views/SubagentView
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SubagentFlatNode } from '../session/subagent-tree.ts'
import { SUBAGENT_POLL_MS } from '../session/subagent-tree.ts'
import { loadSubagentDetail, type SubagentDigest, type SubagentStep } from '../session/subagent-detail.ts'
import { formatRunDuration } from '../session/run-detail.ts'
import { copyText } from '../render/code-actions.ts'
import { errorText } from '../shared/error-text.ts'
import { settingsLayout } from '../layouts/screens.ts'
import { SlotLayout } from '../ui/slot-layout.tsx'
import { Button, IconButton } from '../ui/primitives.tsx'

export interface SubagentViewProps {
  /** 这一行从运行状态面板 / 运行总览带过来（id/label/activity/时间）。 */
  node: SubagentFlatNode
  onBack(): void
}

/** 折叠态下最多先露几条步骤：再多就该由用户自己展开。 */
export const SUBAGENT_PREVIEW_STEPS = 4

/** 一行步骤的时间：只给时分，跨天的由「多久之前」兜住。 */
function stepTime(at: number | undefined, now: number): string {
  if (at === undefined || !Number.isFinite(at) || at <= 0) return ''
  const diff = now - at
  if (diff >= 0 && diff < 60_000) return '刚刚'
  const date = new Date(at)
  const hh = `${date.getHours()}`.padStart(2, '0')
  const mm = `${date.getMinutes()}`.padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * 渲染子代理详情。
 *
 * @param props - 见 {@link SubagentViewProps}
 * @returns 详情页
 */
export function SubagentView({ node, onBack }: SubagentViewProps) {
  const [digest, setDigest] = useState<SubagentDigest | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const aliveRef = useRef(true)

  const running = node.activity === 'running'

  const load = useCallback(async (signal: AbortSignal): Promise<void> => {
    try {
      const next = await loadSubagentDetail(node.id, signal)
      if (!aliveRef.current || signal.aborted) return
      setDigest(next)
      setError(undefined)
    } catch (reason) {
      if (!aliveRef.current || signal.aborted) return
      setError(errorText(reason))
    }
  }, [node.id])

  useEffect(() => {
    aliveRef.current = true
    const controller = new AbortController()
    void load(controller.signal)
    // 运行中才轮询：结束的子会话内容不会再变，没必要一直读。
    const timer = running ? window.setInterval(() => { void load(controller.signal) }, SUBAGENT_POLL_MS) : undefined
    const clock = running ? window.setInterval(() => { setNow(Date.now()) }, 1_000) : undefined
    return () => {
      aliveRef.current = false
      controller.abort()
      if (timer !== undefined) window.clearInterval(timer)
      if (clock !== undefined) window.clearInterval(clock)
    }
  }, [load, running])

  const steps = digest?.steps ?? []
  const visible = expanded ? steps : steps.slice(Math.max(0, steps.length - SUBAGENT_PREVIEW_STEPS))
  const hidden = steps.length - visible.length
  const output = digest?.output ?? ''
  const started = node.turnStartAt
  const duration = started === undefined ? '' : formatRunDuration(Math.max(0, now - started))
  const quiet = node.lastEventAt === undefined ? '' : formatRunDuration(Math.max(0, now - node.lastEventAt))

  return (
    <SlotLayout
      spec={settingsLayout}
      className="subagent-page"
      slots={{
        header: (
          <header className="mobile-header">
            <div className="mobile-headerSlot">
              <IconButton label="返回" className="mobile-back" onClick={onBack}>‹</IconButton>
            </div>
            <h1 className="mobile-title">子代理</h1>
            <div className="mobile-headerSlot mobile-headerSlot-right" />
          </header>
        ),
        groups: (
          <div className="subagent-page-shell">
          <div className="subagent-page-body">
            <section className="subagent-hero" aria-label="子代理概况">
              <h2 className="subagent-name">{node.label}</h2>
              <div className="subagent-meta">
                <span className={'subagent-state' + (running ? ' subagent-state-live' : '')}>
                  {running ? '运行中' : '已结束'}
                </span>
                {duration === '' ? null : <span>{duration}</span>}
                {digest === undefined ? null : <span>· {digest.toolCount} 个工具</span>}
                {quiet === '' ? null : <span>· {quiet}前有活动</span>}
              </div>
            </section>

            {error !== undefined && <p className="settings-note">读取子代理失败：{error}</p>}

            {digest === undefined && error === undefined && (
              <p className="settings-note" aria-busy="true">
                <span className="settings-skeleton" aria-hidden />
                正在读取它做了什么…
              </p>
            )}

            {digest !== undefined && steps.length === 0 && (
              <p className="settings-note">它还没有调用过工具（可能刚开始，或只做了思考）。</p>
            )}

            {digest !== undefined && digest.lastStep !== undefined && (
              <section className="subagent-last" aria-label="最近一步">
                <span className="subagent-last-dot" aria-hidden />
                <span className="subagent-last-copy">
                  <span className="subagent-last-head">最近一步</span>
                  <span className="subagent-last-detail">{digest.lastStep.detail === '' ? digest.lastStep.name : digest.lastStep.detail}</span>
                </span>
              </section>
            )}

            {/* 折叠按钮的显示条件用「步骤总数」，不是「还有多少没显示」——
                否则一展开 hidden 就变 0、按钮跟着消失，用户就再也收不回去了。 */}
            {steps.length > SUBAGENT_PREVIEW_STEPS && (
              <Button
                type="button"
                className="subagent-fold"
                onClick={() => { setExpanded(value => !value) }}
              >
                {expanded ? '收起过程' : `… 前面还有 ${hidden} 步`}
              </Button>
            )}

            {visible.length > 0 && (
              <ol className="subagent-steps" aria-label="过程">
                {visible.map((step, index) => (
                  <li className="subagent-step" key={`${step.kind}-${index}-${step.detail}`}>
                    <span className={'subagent-step-dot' + (step.kind === 'tool' ? '' : ' subagent-step-dot-text')} aria-hidden />
                    <span className="subagent-step-body">
                      <span className="subagent-step-name">{step.name === '' ? '输出' : step.name}</span>
                      <span className="subagent-step-detail">{step.detail === '' ? '（无参数）' : step.detail}</span>
                      <span className="subagent-step-time">{stepTime(step.at, now)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <section className="subagent-output" aria-label="当前输出">
              <div className="subagent-output-head">当前输出</div>
              <p className="subagent-output-body">
                {output === '' ? (running ? '还没写出结论，等它跑完。' : '这一轮没有留下正文。') : output}
              </p>
            </section>

            {running && <p className="settings-note">它还在跑：这一页每 8 秒自己刷新，不用手动下拉。</p>}
          </div>
          {/* 动作条在滚动区**外面**（2026-11-12 用户：「要定在屏幕底部（像效果图那样）」）：
              跟着正文滚的话，长过程要划到底才看得见返回。
              settingsLayout 只有 header/groups 两个槽、加不了 footer 槽，所以在这里分两层：
              shell 吃满高度 → body 自己滚 → 动作条钉在 shell 底部。 */}
          <div className="subagent-actions">
            <Button
              type="button"
              className="mobile-button"
              disabled={output === ''}
              onClick={() => { void copyText(output, '已复制结论') }}
            >复制结论</Button>
            <Button type="button" className="mobile-button mobile-button-primary" onClick={onBack}>返回</Button>
          </div>
        </div>
        ),
      }}
    />
  )
}
