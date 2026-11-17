/**
 * 「发出去了，但宿主还没回执」那条幽灵行的常量与判定。
 *
 * 从 `ChatView` 搬出来（S4-2a）：纯常量 + 纯函数，只认 `RenderMessage` 的形状。
 * 之所以只搬这一半：props 契约要用 `api.ts` / `mux.ts` 的类型，而 `views/` 下
 * 直接碰数据层的文件数有预算（`viewDataImports ≤ 14`），搬它会把预算顶破。
 *
 * @module dsh-palm/mobile/views/chat/lib/outgoing-flight
 */
import type { RenderMessage } from '../../../render/messages.ts'

/** 幽灵行最长挂 8 秒：弱网回执 2~5 秒是常态，再久说明这一拍读不回来（宿主行迟早自己到）。 */
export const OUTGOING_TTL_MS = 8_000
/**
 * 「发出去了却没回音」的判定线：宿主那条用户行 6 秒还没落地 = 实时帧没进来。
 *
 * 幽灵行是本地状态，8 秒到期就撤；如果 `user/message` 帧始终不到（宿主按设备过滤的
 * 登记丢了、断流、闸门），屏幕上会**什么都没有**，而本地折叠永远不会自己长出这条 ——
 * 真机表现就是「发出去不回显、正文也不渲染，重开 PWA 才显示」。
 */
export const SEND_ECHO_GRACE_MS = 6_000
/**
 * 等待态最长挂 10 分钟：这是"已送达但还没有任何输出"的兜底（模型排队/长上下文）。
 * 正常情况下首个过程内容一到就撤（见认领 effect），这个值只是别让占位永久赖着。
 */
export const AWAITING_TTL_MS = 600_000

/**
 * 这一行是否是"模型已经开始输出"的证据（工具/流程/推理/正文任一）。
 *
 * 等待态（`submitted`）只在它出现之前显示 —— 它是"宿主已接单、模型还没开口"的唯一可见信号。
 */
export function hasModelOutput(row: RenderMessage): boolean {
  if (row.kind !== 'assistant') return false
  return (row.tools?.length ?? 0) > 0
    || (row.flow?.length ?? 0) > 0
    || (row.reasoning ?? '') !== ''
    || row.text !== ''
}
