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
import { forgetElapsed, settleElapsed, shownElapsed } from './turn-clock.ts'
import { ProcessGroup } from './process.tsx'

/**
 * The settled message body rendered in event order: text runs and diff
 * artifacts interleaved at their call time points (a write mid-turn shows
 * its diff right where the model called it, not stacked at the end).
 * Consecutive tool parts merge into one artifact card (multi-file edits
 * stay a single card); tool parts without a diff view render nothing.
 */
export function AssistantBody({ message, showToolCalls, forceOpen, focusedQuery, anchorQuery, focusExpand, sessionId, hostNow, hostNowMs, liveTurnStartAt, liveTurn, settled, hydrated, turnGoal, modelName, turnSteps }: {
  message: RenderMessage
  showToolCalls: boolean
  forceOpen: boolean
  focusedQuery?: string
  /** 定位高亮词（可以落在折叠的过程步骤里，并自动展开那一步）。 */
  anchorQuery?: string
  /** 从会话内搜索跳过来：折叠的工具步骤要自动展开，命中正文才看得见。 */
  focusExpand?: boolean
  sessionId?: string
  /** 宿主时间取数函数（引用恒定）；给了就优先于 `hostNowMs`。 */
  hostNow?: () => number
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
  const hasProcessRows = visibleRows > 0 || model.artifactCount > 0
  // 任务头（新「会话正文流」的第一块）：状态/步数/进度/耗时全部从现有回合数据折出来，
  // 不再另造一份「现在到哪一步」。运行中报实时秒表，收工后以 turn/end 的 durationMs 定格。
  //
  // 过程组只在**真有过程行**时出现（2026-11-10 整屏实拍）：纯问答回合以前也会画一个
  // 静态头，卡面只剩一个「—」，等于在正文上方多留一行空壳。计时与状态词本来就在
  // 任务头的状态条里，不靠这一行表达。
  const now = hostNow?.() ?? hostNowMs ?? Date.now()
  const running = authority ? isRowRunning(message, liveTurn, settled) : undefined
  // 过程组只在**有内容或还没收工**时出现（2026-11-10 整屏实拍）：收工后的纯问答回合
  // 以前也会画一个静态头，卡面只剩一个「—」，等于在正文上方多留一行空壳。运行中与
  // 结论未知时保留这一行 —— 它是"这一轮还活着"的落点，也是实机测试认的标记。
  const showGroup = message.processCardOwner !== false
    && (hasProcessRows || (message.turnStartAt !== undefined && running !== false))
  // 锚点**只许变早**（真机 2026-11-02 / 11-03：重载后计时从 5分10秒 跳回 1分20秒，
  // 再从小往大长）。秒表现在只剩状态条一处，锚点一抖就是屏幕上的计时一抖。
  //
  // 反过来也成立：行上的 `turnStartAt` 若**早于**页级锚点（页级已经按"不早于本轮用户消息"
  // 夹过），那它就是上一轮的残留 —— 真机 2026-11-14 新轮首帧显示「43分34秒」（实际 8 分钟）
  // 就是这一条：新轮还没有自己的行，锚点顺着上一轮的值走。
  const rawAnchor = liveTurnStartAt !== undefined
    && (message.turnStartAt === undefined || message.turnStartAt < liveTurnStartAt)
    ? liveTurnStartAt
    : message.turnStartAt
  const anchorKey = `${sessionId ?? ''}:${message.turn ?? message.id}`
  const anchor = running === true
    ? stableTurnAnchor(anchorKey, rawAnchor, liveTurnStartAt)
    : (forgetTurnAnchor(anchorKey), rawAnchor)
  /**
   * 数据层读数 → 屏幕上的读数（`turn-clock.ts`）：锚点修正与时钟收敛都在这里被抹平，
   * 数字只进不退、追涨按倍速。收工时用 settleElapsed 定格，行卸载才清记录。
   */
  const liveElapsed = running === true && anchor !== undefined
    ? shownElapsed(anchorKey, Math.max(0, now - anchor), now, message.turnStartAt !== undefined || liveTurnStartAt !== undefined, anchor)
    : undefined
  // 行卸载时清掉这一轮的显示记录（回合结束的定格还要用它，不能在这里提前清）。
  useEffect(() => () => { forgetElapsed(anchorKey) }, [anchorKey])
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
  // 右端时钟三档：运行中按锚点实时走 → 收工后定格在 durationMs → 状态待定
  // （没有权威数据）时**继续按锚点走**，绝不让计时突然消失。
  const headerDuration = running === true
    ? liveElapsed
    : (message.durationMs === undefined
      // 没有权威时长（老数据/快照没到）：继续按锚点走，但同样走"只进不退"那一层。
      ? (authority === false && anchor !== undefined ? shownElapsed(anchorKey, Math.max(0, now - anchor), now, message.turnStartAt !== undefined || liveTurnStartAt !== undefined, anchor) : undefined)
      // 收工定格：与屏幕上的最后值对齐，差 5 秒以内不往回缩（`settleElapsed`）。
      : settleElapsed(anchorKey, message.durationMs))
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
          {...(status.closedAt === undefined ? {} : { closedAtMs: status.closedAt })}
        />
      )}
      {/* 过程条（工具/推理/中间步骤的正文）**永远不接**搜索/定位高亮。
          用户规则：只有「用户消息 + 正文」参与匹配 —— 思考链、工具参数与结果、
          中间步骤的叙述一律不参与。曾经给它传过定位词，结果首页搜索点进来时
          过程条里的同词被点亮，计数和自动跳转又把它算了进去。 */}
      {showGroup && <ProcessGroup message={message} model={model} showToolCalls={showToolCalls} sessionId={sessionId} authority={authority} />}
      {answer !== undefined && answer !== '' && (model.answerSeq === undefined ? (
        <MarkdownText text={answer} pending={message.pending === true} forceOpen={forceOpen} highlightQuery={focusedQuery || anchorQuery} sessionId={sessionId} />
      ) : (
        <div className="chat-flow-text chat-flow-answer" data-step-seq={model.answerSeq} data-part-id="answer">
          <MarkdownText text={answer} pending={message.pending === true} forceOpen={forceOpen} highlightQuery={focusedQuery || anchorQuery} sessionId={sessionId} />
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
