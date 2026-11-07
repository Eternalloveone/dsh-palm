/**
 * 助手正文与产物卡片：思考/工具之外那段「真正读的东西」。
 *
 * 从 message-row.tsx 拆出来（W2-3）。
 *
 * @module dsh-palm/mobile/message-row/artifacts
 */

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react'
import type { RenderMessage, ToolCallInfo, ToolDiffView } from '../messages.ts'
import { MarkdownText } from '../markdown-text.tsx'
import {
  diffTallyOf,
  formatDuration,
  processModel,
  visibleRowCount,
  type ProcessModel,
} from '../process-rows.ts'
import { Button } from '../ui/primitives.tsx'
import { ProcessGroup } from './process.tsx'

/**
 * The settled message body rendered in event order: text runs and diff
 * artifacts interleaved at their call time points (a write mid-turn shows
 * its diff right where the model called it, not stacked at the end).
 * Consecutive tool parts merge into one artifact card (multi-file edits
 * stay a single card); tool parts without a diff view render nothing.
 */
export function AssistantBody({ message, showToolCalls, forceOpen, focusedQuery, focusExpand, sessionId, hostNowMs, liveTurnStartAt, liveTurn, settled, liveClockTick }: {
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
  /** 父级的 1 Hz 心跳（见 live-clock.ts）：只有正在跑的那一行才收得到。 */
  liveClockTick?: number
}) {
  // 判据的第二行（第二行状态词）与头的状态词必须同源：[liveTurn] 也要进依赖，
  // 否则活跃轮次一变（turn/end 到了、下一轮开了）这一行的第二行不会重算。
  const model = useMemo(() => processModel(message, liveTurn, settled), [message, liveTurn, settled])
  // 有过程行，或者至少有一枚回合时钟（纯文本回复也要显示"本轮用了 X"）。
  // 注意：这个开关只挡工具行，不挡整组 —— 关掉工具调用不该连带丢掉思考与用时。
  const visibleRows = visibleRowCount(model, showToolCalls)
  // 同一轮的「后续段」不再自己画卡：过程卡按回合归属，步骤已经上提到本轮第一段
  // （见 messages.ts 的 mergeProcessCardsByTurn）。这一段只负责它的正文。
  const showGroup = message.processCardOwner !== false
    && (visibleRows > 0 || message.durationMs !== undefined || message.turnStartAt !== undefined)
  const answer = model.answer
  return (
    <>
      {showGroup && <ProcessGroup message={message} model={model} showToolCalls={showToolCalls} focusedQuery={focusedQuery} focusExpand={focusExpand} sessionId={sessionId} hostNowMs={hostNowMs} liveTurnStartAt={liveTurnStartAt} liveTurn={liveTurn} settled={settled} liveClockTick={liveClockTick} />}
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
