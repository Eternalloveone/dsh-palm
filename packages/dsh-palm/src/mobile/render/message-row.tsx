/**
 * MessageRow: one rendered message row — the assistant/user/command card
 * with its reasoning disclosure, tool disclosure, markdown body, diff
 * artifacts, fail tag and footer (time).
 *
 * Memoized: live streaming updates exactly one message object per frame, so
 * unchanged rows skip re-rendering their markdown/sub-components.
 * @module dsh-palm/mobile/message-row
 */

import { memo, type CSSProperties } from 'react'
import { formatTime } from '../shared/time.ts'
import type { RenderMessage } from './messages.ts'
import { triggerEmojiOf, triggerTitleOf } from './messages.ts'
import { CollapsibleText } from './markdown-text.tsx'
import { DeliveryCard, type DeliveryDeliverable, type DeliveryFileChange } from '../ui/delivery-card.tsx'
import type { TaskSteps } from '../session/task-status.ts'
import { Button } from '../ui/primitives.tsx'

/** 打开交付详情所需的一轮事实：交付卡上「看全部改动」把它交给路由。 */
export interface TurnDeliveryFacts {
  readonly turn: number; readonly deliverables: readonly DeliveryDeliverable[]
  readonly changes: readonly DeliveryFileChange[]; readonly durationMs?: number; readonly steps?: number
}

/** / 重生成按钮的三态：待点、已发出、发出失败。 */
import { forgetTurnAnchor, stableTurnAnchor, type RegenerateState } from '../message-row/anchors.ts'
import { MessageFiles, MessageImages } from '../message-row/attachments.tsx'
import { AssistantBody } from '../message-row/artifacts.tsx'
import { ProcessGroup } from '../message-row/process.tsx'

// 兼容旧调用点：锚点逻辑在 message-row/anchors.ts，公开 API 不变。
export { forgetTurnAnchor, resetTurnAnchors, stableTurnAnchor } from '../message-row/anchors.ts'

export const MessageRow = memo(function MessageRow({ message, sessionId, showToolCalls, showSystemMessages, showTime = true, focused = false, focusedQuery, focusExpand = false, style, onRegenerate, regenerateState = 'idle', onOpenFile, onOpenChanges, hostNowMs, liveTurnStartAt, liveTurn, settled, hydrated, enter, liveClockTick, turnGoal, modelName, turnSteps, turnChanges, turnCompleted }: {
  message: RenderMessage
  /**
   * 会话 id：图片字节按会话授权读取（见 attachment-images.ts）。每个真实调用点
   * （ChatView）都传；缺省时带图片的消息只显示文本——测试里折叠图片需显式传。
   */
  sessionId?: string
  /** 点开交付物/产出文件时的回调（ChatView 传入，打开文件预览面板）。 */
  onOpenFile?: (path: string) => void
  /** 交付卡「看全部改动 ›」：把这一轮的事实交给交付详情页（不传就不画入口）。 */
  onOpenChanges?: (facts: TurnDeliveryFacts) => void
  showToolCalls: boolean
  showSystemMessages: boolean
  /** Timestamp de-dup: hidden when a later row shares this row's minute. */
  showTime?: boolean
  /** Search-hit locate highlight (one-shot CSS animation). */
  focused?: boolean
  focusedQuery?: string
  /** 从会话内搜索跳过来：折叠的工具步骤自动展开，命中正文才看得见。 */
  focusExpand?: boolean
  /** Optional inline style on the row's root element (e.g. content-visibility). */
  style?: CSSProperties
  /**
   * 页级回合锚点（ChatView 从 turn/start、历史尾页或 reconcile 探针恢复的那一个）。
   * 行内秒表拿不到自己的 turnStartAt 时改用它，否则中途重载会从头开始数。
   */
  liveTurnStartAt?: number
  /**
   * 当前活跃轮次的轮号（ChatView 从宿主 turn/start..turn/end 推出来的那一个）。
   * 宿主按步发 assistant/message，一行会在回合中途就被定格（pending 已落、工具
   * 也全返回了），只靠行内字段它会被当成"已结束"；这一行的 turn 等于活跃轮次时
   * 它才是运行中（见 process-rows.ts 的 isRowRunning）。
   */
  liveTurn?: number
  /** 宿主已裁决这一轮停了：残留的 pending / running 工具不算"还在跑"。 */
  settled?: boolean
  /** 会话页水合完成（宿主快照 + 该会话的行都到位，见 `chat-rows.tsx`）：没水合只画 unknown。 */
  hydrated?: boolean
  /**
   * 这条行是不是第一次出现在列表里。
   *
   * 打开会话时会先粗后细提交两轮（第一轮的行还没有 turn/step，key 退化成 id；第二轮
   * 补齐后 key 变成 `t<turn>.<step>`），React 会把整屏行卸了重挂。动画挂在行上时重挂
   * 就重播，肉眼是「一打开会话正文闪一下」。为 false 时挂 `chat-msg-no-enter`，样式层
   * 用一个 :not() 把入场动画让过去。
   */
  enter?: boolean
  /**
   * 父级的 1 Hz 心跳（见 live-clock.ts）。只有正在跑的那一行才收得到；它每秒
   * 变一次，作用是把这一行叫醒 —— 秒表读数在渲染时直接取墙钟，所以"重渲染"
   * 就等于"数字刷新"，不依赖本行自己的定时器还活着。
   */
  liveClockTick?: number
  /**
   * Host clock minus local clock (ms), for the running process head's timer.
   * A plain number: it changes only when a frame re-calibrates the skew, so
   * memoized rows are not re-rendered once per second.
   */
  hostNowMs?: number
  /** Regenerate affordance: shown on the last settled assistant reply. */
  onRegenerate?: () => void
  /** 它自己的状态：待点、已发出（转圈）、发出失败（可再点）。 */
  regenerateState?: RegenerateState
  /** 这一轮的目标（用户请求原文，ChatRows 按轮折出来）：任务头第二行。 */
  turnGoal?: string
  /** 模型名：任务头元信息行（拿不到就不显示）。 */
  modelName?: string
  /** 这一轮的计划步数（计划快照可能只挂在收尾行上，由 ChatRows 回填）。 */
  turnSteps?: TaskSteps
  /** 这一轮的文件改动（含增删行数，ChatRows 按轮折出来）：交付卡的明细与汇总。 */
  turnChanges?: readonly DeliveryFileChange[]
  /** 这一轮是否正常收工；失败/中断传 false —— 交付卡不画（终态交给状态条）。 */
  turnCompleted?: boolean
}) {
  const focusSeqAttr = message.startSeq ?? message.seq
  // 宿主唤醒消息（子代理/任务/定时/团队/外部事件…）在手机端也出卡，与桌面端
  // ui-chat 的 TurnTriggerNodeView 对齐：标题按 source.kind 取（文案与桌面端 locale
  // 的 message.trigger.* 一致），卡面只有标题与时间，正文点开才看 —— 默认折叠，
  // 保持输出界面干净。其余注入行（压缩检查点/指令/skill 目录/运行时上下文）照旧不渲染。
  if (message.kind === 'user'
    && message.sourceKind !== undefined
    && message.sourceKind !== 'user') {
    // 标题表是唯一真源（messages.ts 的 triggerTitleOf）：与"是否透明"共用同一张 kind 表，
    // 不会再出现"这个来源出卡、那个来源却被折掉"的两份清单漂移。
    const triggerTitle = triggerTitleOf(message.sourceKind)
    if (triggerTitle !== undefined) {
      const pad = (value: number): string => String(value).padStart(2, '0')
      const at = new Date(message.time)
      const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`
      return (
        <details
          data-mid={message.id}
          data-message-id={message.id}
          data-row-seq={focusSeqAttr}
          className={'chat-trigger' + (focused ? ' chat-msg-focus' : '')}
          style={style}
        >
          <summary className="chat-trigger-head">
            <span className="chat-trigger-icon" aria-hidden>{triggerEmojiOf(message.sourceKind)}</span>
            <span className="chat-trigger-title">{triggerTitle}</span>
            {showTime && <span className="chat-trigger-time">{clock}</span>}
            <span className="chat-trigger-caret" aria-hidden>▾</span>
          </summary>
          <div className="chat-trigger-body">
            <p className="chat-trigger-note">这条通知触发了本轮回复。</p>
            {message.text.trim() !== '' && <div className="chat-trigger-text">{message.text}</div>}
          </div>
        </details>
      )
    }
    if (!showSystemMessages) return null
  }
  // Command cards render before the empty-text guard: a running card has no
  // result text yet but must stay visible (it is the in-stream feedback).
  if (message.kind === 'command') {
    return (
      <div
        data-mid={message.id}
        data-message-id={message.id}
        data-row-seq={focusSeqAttr}
        className={'chat-command' + (message.commandPhase === 'error' ? ' chat-command-error' : '') + (focused ? ' chat-msg-focus' : '')}
        style={style}
        role="status"
      >
        <span className="chat-command-name">{message.commandLine ?? '命令'}</span>
        <span className="chat-command-result">
          {message.commandPhase === 'running' ? '执行中…' : message.text}
        </span>
      </div>
    )
  }
  // Turn tail（收尾行）：新「会话正文流」里这里只画**交付卡**——全页唯一的一张卡。
  // 失败/中断（turnCompleted=false）不画：终态由任务头的状态条表达，不再叠一张
  // 「交付完成」自相矛盾。计划不再单独出胶囊：步数已经进任务头（ChatRows 按轮回填）。
  if (message.kind === 'turn') {
    if (turnCompleted === false) return null
    const deliverables = message.deliverables ?? []
    // 收尾行自带的「产出文件」没有增删行数；ChatRows 的 diff 统计优先，缺的按路径补上。
    const changes: DeliveryFileChange[] = turnChanges === undefined ? [] : [...turnChanges]
    for (const path of message.produced ?? []) {
      if (!changes.some(change => change.path === path)) changes.push({ path })
    }
    if (deliverables.length === 0 && changes.length === 0) return null
    // 「看全部改动」的入口只在有路由回调时出现：没有回执的路由会变成死按钮。
    const turn = message.turn
    const openChanges = onOpenChanges === undefined || turn === undefined
      ? undefined
      : () => {
        onOpenChanges({
          turn,
          deliverables,
          changes,
          ...(message.durationMs === undefined ? {} : { durationMs: message.durationMs }),
          ...(message.plan === undefined ? {} : { steps: message.plan.items.length }),
        })
      }
    return (
      <div
        data-mid={message.id}
        data-message-id={message.id}
        data-row-seq={focusSeqAttr}
        className="chat-turn-tail-row"
        style={style}
      >
        <DeliveryCard
          completed
          {...(message.durationMs === undefined ? {} : { durationMs: message.durationMs })}
          {...(message.plan === undefined ? {} : { steps: message.plan.items.length })}
          deliverables={deliverables}
          changes={changes}
          {...(onOpenFile === undefined ? {} : { onOpenFile })}
          {...(openChanges === undefined ? {} : { onOpenChanges: openChanges })}
        />
      </div>
    )
  }
  const hasReasoning = message.kind === 'assistant' && message.reasoning !== undefined && message.reasoning !== ''
  const hasTools = showToolCalls && message.kind === 'assistant' && message.tools !== undefined && message.tools.length > 0
  const hasText = message.text !== ''
  const hasFailTag = message.failed === true
  // 图片：纯图片消息文本为空，若不算进"有内容"这一关，整行会被下面的空行守卫丢掉。
  const images = sessionId !== undefined && message.images !== undefined && message.images.length > 0
    ? message.images
    : undefined
  const hasImages = images !== undefined
  const files = message.files !== undefined && message.files.length > 0 ? message.files : undefined
  // Flow rows with at least one non-empty text run carry visible content even
  // when `text` is empty (tool-interleaved turns put their payload in flow).
  const hasFlowText = message.flow !== undefined
    && message.flow.some(part => part.kind === 'text' && part.text !== '')
  if (!hasReasoning && !hasTools && !hasText && !hasFailTag && !hasFlowText && !hasImages && files === undefined) {
    return null
  }
  return (
    <div
      data-mid={message.id}
      data-message-id={message.id}
      data-row-seq={focusSeqAttr}
      className={`chat-msg chat-msg-${message.kind}${enter === false ? ' chat-msg-no-enter' : ''}${message.pending === true ? ' chat-msg-pending' : ''}${message.failed === true ? ' chat-msg-failed' : ''}${focused ? ' chat-msg-focus' : ''}`}
      style={style}
    >
      {message.kind === 'assistant' ? (
        <AssistantBody message={message} showToolCalls={showToolCalls} forceOpen={focused} focusedQuery={focused ? focusedQuery : undefined} focusExpand={focused && focusExpand === true} sessionId={sessionId} hostNowMs={hostNowMs} liveTurnStartAt={liveTurnStartAt} liveTurn={liveTurn} settled={settled} hydrated={hydrated} liveClockTick={liveClockTick} {...(turnGoal === undefined ? {} : { turnGoal })} {...(modelName === undefined ? {} : { modelName })} {...(turnSteps === undefined ? {} : { turnSteps })} />
      ) : (
        <>
          <CollapsibleText text={message.text} forceOpen={focused} highlightQuery={focused ? focusedQuery : undefined} />
          {images !== undefined && sessionId !== undefined && (
            <MessageImages sessionId={sessionId} images={images} />
          )}
          {files !== undefined && <MessageFiles files={files} />}
        </>
      )}
      {message.failed === true && <span className="chat-msg-failtag">本次回复失败</span>}
      {message.maxTokens === true && <div className="chat-msg-maxtokens">已达到输出 token 上限，回答被截断。发送“继续”可让模型接着输出。</div>}
      <span className="chat-msg-footer">
        {showTime && <span className="chat-msg-time">{formatTime(message.time)}</span>}
        {/* 一个图标，落在时间行最右端：不占行、不带动词。
            文字版（↻ 重新生成）在手机上白占 ~48px，而这只是个工具入口；
            说清楚靠 aria-label / title，视觉上只留一个可点的圆。
            发出后原地转圈（禁用），失败变红可再点 —— 反馈都在这里，不弹条。 */}
        {message.kind === 'assistant' && onRegenerate !== undefined && (
          <Button
            type="button"
            className={`chat-msg-regenerate${regenerateState === 'busy' ? ' chat-msg-regenerate-busy' : ''}${regenerateState === 'failed' ? ' chat-msg-regenerate-failed' : ''}`}
            onClick={onRegenerate}
            disabled={regenerateState === 'busy'}
            aria-label={regenerateState === 'busy' ? '正在重新回答' : '重新生成回复'}
            title={regenerateState === 'failed' ? '上次没发出去，再点一次' : '重新生成'}
          >
            <span className="chat-msg-regenerate-icon" aria-hidden>↻</span>
          </Button>
        )}
      </span>
    </div>
  )
})
