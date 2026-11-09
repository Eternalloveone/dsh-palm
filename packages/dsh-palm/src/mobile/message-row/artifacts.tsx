/**
 * 助手正文与产物卡片：思考/工具之外那段「真正读的东西」。
 *
 * 从 message-row.tsx 拆出来（W2-3）。
 *
 * @module dsh-palm/mobile/message-row/artifacts
 */

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import type { RenderMessage, ToolCallInfo, ToolDiffView } from '../render/messages.ts'
import { MarkdownText } from '../render/markdown-text.tsx'
import {
  diffTallyOf,
  formatDuration,
  processModel,
  visibleRowCount,
  type ProcessModel,
} from '../render/process-rows.ts'
import { Button } from '../ui/primitives.tsx'
import { TurnHeader } from '../ui/turn-header.tsx'
import { deriveTaskStatus, planStepsOf, taskActivityOf, type TaskSteps } from '../session/task-status.ts'
import { isRowRunning } from '../render/process-rows.ts'
import { forgetTurnAnchor, stableTurnAnchor } from './anchors.ts'
import { ProcessGroup } from './process.tsx'

/**
 * The settled message body rendered in event order: text runs and diff
 * artifacts interleaved at their call time points (a write mid-turn shows
 * its diff right where the model called it, not stacked at the end).
 * Consecutive tool parts merge into one artifact card (multi-file edits
 * stay a single card); tool parts without a diff view render nothing.
 */
export function AssistantBody({ message, showToolCalls, forceOpen, focusedQuery, focusExpand, sessionId, hostNowMs, liveTurnStartAt, liveTurn, settled, hydrated, turnGoal, modelName, turnSteps }: {
  message: RenderMessage
  showToolCalls: boolean
  forceOpen: boolean
  focusedQuery?: string
  /** 从会话内搜索跳过来：折叠的工具步骤要自动展开，命中正文才看得见。 */
  focusExpand?: boolean
  sessionId?: string
  hostNowMs?: number
  liveTurnStartAt?: number
  liveTurn?: number
  /** 宿主已裁决这一轮停了：残留的 pending / running 工具不算"还在跑"。 */
  settled?: boolean
  /**
   * 会话页水合完成（宿主快照 + 该会话的行都到位，见 `chat-rows.tsx`）。
   * **缺省 = 已水合**：只有会话页知道水合进度，它显式传 false 时门才关上。
   */
  hydrated?: boolean
  /** 这一轮的目标（用户请求原文，由 ChatRows 按轮折出来）：任务头第二行。 */
  turnGoal?: string
  /** 模型名：任务头元信息行（拿不到就不显示）。 */
  modelName?: string
  /** 这一轮的计划步数（计划快照可能只挂在收尾行上，由 ChatRows 回填）。 */
  turnSteps?: TaskSteps
}) {
  /**
   * 结论资格（水合门的落点）：宿主快照到齐才许下**任何**结论 —— 在跑、停、完成都算。
   * 以前这里无条件 `deriveTaskStatus(undefined, …)`：「不在跑 + 行上没有失败标记」被
   * `processOutcome` 兜成 `ok` → 首帧画「已完成」，等宿主的「在跑」一到又改口「运行中」。
   * 没资格时连 `running` 都不给（不给 = 状态机判 `unknown`），否则首帧先写「思考中」
   * 再被改写成「已完成」，同样是把结论画两遍。过程条的行模型吃同一个资格。
   */
  const authority = hydrated !== false
  // 判据的第二行（第二行状态词）与头的状态词必须同源：[liveTurn] 也要进依赖，
  // 否则活跃轮次一变（turn/end 到了、下一轮开了）这一行的第二行不会重算。
  const model = useMemo(() => processModel(message, liveTurn, settled, authority), [message, liveTurn, settled, authority])
  // 有过程行，或者至少有一枚回合时钟（纯文本回复也要显示"本轮用了 X"）。
  // 注意：这个开关只挡工具行，不挡整组 —— 关掉工具调用不该连带丢掉思考与用时。
  const visibleRows = visibleRowCount(model, showToolCalls)
  // 同一轮的「后续段」不再自己画卡：过程卡按回合归属，步骤已经上提到本轮第一段
  // （见 messages.ts 的 mergeProcessCardsByTurn）。这一段只负责它的正文。
  const showGroup = message.processCardOwner !== false
    && (visibleRows > 0 || message.durationMs !== undefined || message.turnStartAt !== undefined)
  // 任务头（新「会话正文流」的第一块）：状态/步数/进度/耗时全部从现有回合数据折出来，
  // 不再另造一份「现在到哪一步」。运行中报实时秒表，收工后以 turn/end 的 durationMs 定格。
  const now = hostNowMs ?? Date.now()
  const running = authority ? isRowRunning(message, liveTurn, settled) : undefined
  // 锚点**只许变早**（真机 2026-11-02 / 11-03：重载后计时从 5分10秒 跳回 1分20秒，
  // 再从小往大长）。秒表现在只剩状态条一处，锚点一抖就是屏幕上的计时一抖。
  const rawAnchor = message.turnStartAt ?? liveTurnStartAt
  const anchorKey = `${sessionId ?? ''}:${message.turn ?? message.id}`
  const anchor = running === true
    ? stableTurnAnchor(anchorKey, rawAnchor)
    : (forgetTurnAnchor(anchorKey), rawAnchor)
  const liveElapsed = running === true && anchor !== undefined ? Math.max(0, now - anchor) : undefined
  // 终态只在有权威时下：宿主说失败 / turn/end 说中断 / 宿主说这一轮没在跑（= 完成）。
  const outcome = !authority ? undefined
    : model.outcome === 'failed' ? 'failed' as const
    : model.outcome === 'stopped' ? 'cancelled' as const
    : running === false ? 'completed' as const
    : undefined
  const status = deriveTaskStatus({
    now,
    turn: {
      ...(running === undefined ? {} : { running }),
      ...(message.turn === undefined ? {} : { turnNo: message.turn }),
      ...(anchor === undefined ? {} : { startedAt: anchor }),
      ...(message.time === undefined ? {} : { lastActivityAt: message.time }),
    },
    ...(message.plan === undefined ? {} : { plan: message.plan }),
    activity: taskActivityOf([message]),
    ...(outcome === undefined ? {} : { outcome }),
  })
  const headerSteps = status.steps ?? turnSteps ?? planStepsOf(message.plan)
  const headerDuration = running === true ? liveElapsed : message.durationMs
  const answer = model.answer
  return (
    <>
      {message.processCardOwner !== false && (
        <TurnHeader
          kind={status.kind}
          {...(headerSteps === undefined ? {} : { steps: headerSteps })}
          {...(status.progress === undefined ? {} : { progress: status.progress })}
          {...(headerDuration === undefined ? {} : { durationMs: headerDuration })}
          {...(turnGoal === undefined ? {} : { goal: turnGoal })}
          {...(model.changedFiles > 0 ? { changedFiles: model.changedFiles } : {})}
          {...(modelName === undefined || modelName === '' ? {} : { model: modelName })}
        />
      )}
      {showGroup && <ProcessGroup message={message} model={model} showToolCalls={showToolCalls} focusedQuery={focusedQuery} focusExpand={focusExpand} sessionId={sessionId} authority={authority} />}
      {answer !== undefined && answer !== '' && (model.answerSeq === undefined ? (
        <MarkdownText text={answer} pending={message.pending === true} forceOpen={forceOpen} highlightQuery={focusedQuery} sessionId={sessionId} />
      ) : (
        <div className="chat-flow-text chat-flow-answer" data-step-seq={model.answerSeq} data-part-id="answer">
          <MarkdownText text={answer} pending={message.pending === true} forceOpen={forceOpen} highlightQuery={focusedQuery} sessionId={sessionId} />
        </div>
      ))}
    </>
  )
}

/**
 * Diff artifacts (write/edit) rendered directly in the message body — the
 * phone's take on the desktop diff card, visible without expanding the
 * tool disclosure. The tool disclosure keeps the call name only.
 *
 * Every diff view of the turn merges into ONE card: a single head with the
 * file tally, per-file diffs below (each file keeps its path header). A
 * multi-file edit no longer stacks one folded card per write call.
 */
import { ArtifactCards } from './artifact-cards.tsx'
