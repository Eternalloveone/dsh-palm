/**
 * 消息块的视图模型（W2-2）。
 *
 * 之前"一条助手消息里有哪些块、按什么顺序画"这件事散在两处：
 * `process-rows.ts` 算出 `model.rows`，`ProcessRows` 再一边遍历一边 flush
 * （把连续的工具调用攒成一张产物卡）。新增一种块要同时动遍历逻辑、渲染分支和样式，
 * 计划里量出的是 5–6 处。
 *
 * 现在拆成三层：
 *   1. {@link toVM}（纯函数，无 React）—— 把 `model.rows` 变成有序的块列表；
 *   2. `block-registry.tsx` —— kind → 渲染组件的注册表；
 *   3. 样式。
 * 新增一种块 = **注册 + 样式** 两处。
 *
 * @module dsh-palm/mobile/message-row/types
 */
import type { ToolCallInfo } from '../render/messages.ts'
import type { ProcessReasoningRow } from '../render/process-rows.ts'

/** 块的种类；字符串留开，插件/实验块可以自定。 */
export type BlockKind = 'reasoning' | 'tool' | 'tool-group' | 'text' | (string & {})

interface BlockBase {
  /** 稳定 key（用于 React 列表；与 Identity 内核的 rowKey 无关）。 */
  key: string
}

/** 一段思考（折叠）。 */
export interface ReasoningBlock extends BlockBase {
  kind: 'reasoning'
  row: ProcessReasoningRow
}

/** 单个工具步骤（展开后的一行）。 */
export interface ToolBlock extends BlockBase {
  kind: 'tool'
  tool: ToolCallInfo
}

/** 连续的工具调用合并成的一张产物卡（多文件编辑仍然只有一张）。 */
export interface ToolGroupBlock extends BlockBase {
  kind: 'tool-group'
  tools: readonly ToolCallInfo[]
}

/** 一段正文（答案段）。 */
export interface TextBlock extends BlockBase {
  kind: 'text'
  text: string
  /** 定位用的步骤序号；undefined 表示老数据没有。 */
  seq?: number
  /** 这一条消息里的第几段正文（`data-part-id` 用）。 */
  index: number
}

export type MessageBlock = ReasoningBlock | ToolBlock | ToolGroupBlock | TextBlock
