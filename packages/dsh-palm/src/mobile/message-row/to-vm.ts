/**
 * `RenderMessage` → 块列表（W2-2）。
 *
 * 纯函数、无 React：块的顺序、分组、可见性全在这里算，组件只负责"按 kind 找渲染器"。
 * 这样新增块的路径只剩两条：这里多一种 block（或复用现成 kind）+ 注册表一条登记。
 *
 * 顺序语义（与拆分前逐条一致）：
 * - 思考块独占一行，出现即结算前面的工具组；
 * - 工具行跟着「显示工具调用」开关走，但 **diff 卡不跟** —— 关掉开关是想少看过程噪音，
 *   不是想看不到"改了哪些文件"；
 * - 连续带 diff 视图的工具合成一张产物卡，中间夹一段正文就断开；
 * - 正文段带 `data-step-seq`（老流程没有 part seq 时退回合并步骤的 seq），
 *   让会话内搜索能把屏幕滚到**这一步**而不是整条消息。
 *
 * @module dsh-palm/mobile/message-row/to-vm
 */
import type { ToolCallInfo } from '../render/messages.ts'
import type { ProcessModel } from '../render/process-rows.ts'
import type { MessageBlock } from './types.ts'

export interface ToVmOptions {
  /** 「显示工具调用」开关。 */
  showToolCalls: boolean
  /** 合并步骤的 seq 序列（老流程没有 part seq 时的兜底）。 */
  stepSeqs?: readonly number[]
  /** 这条消息整体还在流式输出（正文渲染会据此显示光标）。 */
  pending: boolean
}

export function toVM(model: ProcessModel, options: ToVmOptions): MessageBlock[] {
  const blocks: MessageBlock[] = []
  let pendingTools: ToolCallInfo[] = []
  let groupIndex = 0
  let textIndex = 0

  const flush = (): void => {
    if (pendingTools.length === 0) return
    blocks.push({ kind: 'tool-group', key: `group-${groupIndex}`, tools: pendingTools })
    groupIndex += 1
    pendingTools = []
  }

  for (const row of model.rows) {
    if (row.kind === 'reasoning') {
      flush()
      blocks.push({ kind: 'reasoning', key: row.key, row })
      continue
    }
    if (row.kind === 'tool') {
      if (options.showToolCalls) blocks.push({ kind: 'tool', key: row.key, tool: row.tool })
      if (row.tool.view !== undefined) pendingTools.push(row.tool)
      else flush()
      continue
    }
    flush()
    const seq = row.seq ?? options.stepSeqs?.[textIndex]
    blocks.push({
      kind: 'text',
      key: row.key,
      text: row.text,
      index: textIndex,
      ...(seq === undefined ? {} : { seq }),
    })
    textIndex += 1
  }
  flush()
  return blocks
}
