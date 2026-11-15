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
import { DeliveryCard, type DeliveryDeliverable, type DeliveryFileChange, type DeliveryState } from '../ui/delivery-card.tsx'
import type { TaskSteps } from '../session/task-status.ts'
import { Button } from '../ui/primitives.tsx'

/** 打开交付详情所需的一轮事实：交付卡上「看全部改动」把它交给路由。 */
export interface TurnDeliveryFacts {
  readonly turn: number; readonly deliverables: readonly DeliveryDeliverable[]
  readonly changes: readonly DeliveryFileChange[]; readonly durationMs?: number; readonly steps?: number
}

/** / 重生成按钮的三态：待点、已发出、发出失败。 */
import { forgetTurnAnchor, stableTurnAnchor } from '../message-row/anchors.ts'
import { MessageFiles, MessageImages } from '../message-row/attachments.tsx'
import { AssistantBody } from '../message-row/artifacts.tsx'
import { ProcessGroup } from '../message-row/process.tsx'
import { useLiveClock } from '../platform/live-clock.ts'

// 兼容旧调用点：锚点逻辑在 message-row/anchors.ts，公开 API 不变。
export { forgetTurnAnchor, resetTurnAnchors, stableTurnAnchor } from '../message-row/anchors.ts'

/**
 * 已经播过入场动画的消息 id（模块级，跨重挂保留）。
 *
 * 真机"输出时老抖一下/闪一下"的根因之一：正在流式落地的行，key 会随着 turn/step
 * 补齐而变（`rowKeyOf` 从 id 变成 t<turn>.<step>），React 重挂 → `.chat-msg` 上的
 * `msg-in` 动画重播。同一个 id 只该有一次入场。上限 800 条，超了整体清空（历史行
 * 本来也不再需要这层记忆）。
 */
const enteredIds = new Set<string>()

/** 测试用：清空"已经播过入场动画"的记忆（模块级状态，跨用例会串）。 */
export function resetEnteredIds(): void {
  enteredIds.clear()
}

export const MessageRow = memo(function MessageRow({ message, sessionId, showToolCalls, showSystemMessages, showTime = true, focused = false, focusedQuery, anchorQuery, focusExpand = false, style, onRegenerate, onOpenFile, onOpenChanges, hostNow, hostNowMs, liveTurnStartAt, liveTurn, settled, hydrated, enter, turnGoal, modelName, turnSteps, turnChanges, turnCompleted, rowRunning }: {
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
  /** 搜索高亮词（只作用于**答案正文**与用户气泡；过程/思考不标）。 */
  focusedQuery?: string
  /**
   * 定位高亮词（旧式"定位到这一处"，允许落在折叠的过程步骤里并自动展开）。
   * 与 `focusedQuery` 分开：搜索命中只认结论正文，定位可以落在任意一步。
   */
  anchorQuery?: string
  /** 从会话内搜索跳过来：折叠的工具步骤自动展开，命中正文才看得见。 */
  focusExpand?: boolean
  /** Optional inline style on the row's root element (e.g. content-visibility). */
  style?: CSSProperties
  /**
   * 页级回合锚点（ChatView 从 turn/start、历史尾页或 reconcile 探针恢复的那一个）。
   * 任务头状态条的计时拿不到自己的 turnStartAt 时改用它，否则中途重载会从头开始数。
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
   * 变一次，作用是把这一行叫醒 —— 状态条的计时读数在渲染时直接取墙钟，所以
   * "重渲染"就等于"数字刷新"。
   *
   * 本组件**不读它的值**：它是 `memo` 的失效键（props 变 = 重渲染）。读数与
   * 时钟数据都在 `AssistantBody` → 状态条里，过程头已经不报时了。
   */
  liveClockTick?: number
  /**
   * 这一行是否正在跑：**秒表心跳在这里自己起搏**（A2）。心跳原来在 `ChatView` 里，
   * 每秒把 4000 行的视图函数体重跑一遍；下沉后只有这一行重渲染，布尔值稳定。
   */
  rowRunning?: boolean
  /**
   * Host clock minus local clock (ms), for the running turn header's timer.
   * A plain number: it changes only when a frame re-calibrates the skew, so
   * memoized rows are not re-rendered once per second.
   */
  /** 宿主时间（毫秒，10 秒桶）：只用来算「几分钟前 / 快照是否新鲜」。 */
  hostNowMs?: number
  /** 宿主时间取数函数（引用恒定；传数值会让每行 memo 失效）。 */
  hostNow?: () => number
  /**
   * 失败回合的「重试」（交付卡上的按钮，2026-11-10 接入）。
   *
   * **曾经也用于右下角的 ↻「重新生成」图标** —— 那个入口 2026-11-12 按用户要求删了
   * （`chat-msg-regenerate`）：一个只有圆点、没有文字的工具，手机上认不出来是干什么的。
   * 现在只剩交付卡这一处用途，但参数名沿用旧的有兼容价值（测试与 ChatView 都按它接）。
   */
  onRegenerate?: () => void
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
  /**
   * 运行行的秒表心跳：**在这一行自己起搏**。
   *
   * 以前是 `ChatView` 里的 `useLiveClock`，每秒把 4000 行的视图函数体整个重跑一遍，
   * 只为给一行换个数字。下沉到这里后只有这一行每秒重渲染；`rowRunning` 是布尔值，
   * 引用稳定，别的行照旧被 `memo` 挡住。
   */
  useLiveClock(rowRunning === true)
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
  // Turn tail（收尾行）：**行内不再画卡**（2026-11-14 单一真源）。
  //
  // 以前这里和 ChatRows 的末尾槽位各画一张：两套判定、两个渲染点，任何一次判定分叉
  // 都会出现"一张卡在、另一张卡不在"或"先画后撤"。现在卡的可见性只有一个纯函数
  // （`session/deliveries.ts` 的 `cardVisible`）、只有一个渲染点（ChatRows 末尾槽位），
  // 收尾行只作为数据存在，不上屏。
  if (message.kind === 'turn') return null
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
  // 同一个 id 只播一次入场：重挂（key 变）不重播 —— 否则流式期间每补齐一次 turn/step
  // 就闪一下。
  const alreadyEntered = enteredIds.has(message.id)
  if (!alreadyEntered) {
    if (enteredIds.size > 800) enteredIds.clear()
    enteredIds.add(message.id)
  }
  const showEnter = enter !== false && !alreadyEntered
  return (
    <div
      data-mid={message.id}
      data-message-id={message.id}
      data-row-seq={focusSeqAttr}
      className={`chat-msg chat-msg-${message.kind}${showEnter ? '' : ' chat-msg-no-enter'}${message.pending === true ? ' chat-msg-pending' : ''}${message.failed === true ? ' chat-msg-failed' : ''}${focused ? ' chat-msg-focus' : ''}`}
      style={style}
    >
      {message.kind === 'assistant' ? (
        <AssistantBody message={message} showToolCalls={showToolCalls} forceOpen={focused} focusedQuery={focusedQuery} anchorQuery={anchorQuery} focusExpand={focused && focusExpand === true} sessionId={sessionId} hostNow={hostNow} hostNowMs={hostNowMs} liveTurnStartAt={liveTurnStartAt} liveTurn={liveTurn} settled={settled} hydrated={hydrated} {...(turnGoal === undefined ? {} : { turnGoal })} {...(modelName === undefined ? {} : { modelName })} {...(turnSteps === undefined ? {} : { turnSteps })} />
      ) : (
        <>
          <CollapsibleText text={message.text} forceOpen={focused} highlightQuery={focusedQuery} />
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
        {/* 「重新生成」图标已删（2026-11-12 用户要求）。它落在时间行最右端、
            只有一个 ↻ 圆点，用户看不出那是干什么的 —— 想去掉就整条链路一起去掉，
            不要留一个没有入口的状态机。 */}
      </span>
    </div>
  )
})
