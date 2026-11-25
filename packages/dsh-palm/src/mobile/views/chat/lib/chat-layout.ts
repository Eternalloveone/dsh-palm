/**
 * **聊天页的行高估算与行键**（W3：从 5,121 行的 `ChatView.tsx` 抽出的第一批纯函数）。
 *
 * 窗口化渲染需要"还没渲染的行大概多高"：估高了滚动条会跳，估低了内容会被提前裁掉。
 * 这里的系数是**按真机行高量的**，不是拍的——改之前先量一遍。
 *
 * 没有闭包状态、不碰 React，所以可以整块搬走而不改行为。组件体里的渲染块与 hook
 * 互相咬合，要单独一轮处理。
 *
 * @module dsh-palm/mobile/views/chat/chat-layout
 */
import { LONG_TEXT_LIMIT, LONG_TEXT_PREVIEW } from '../../../render/markdown-text.tsx'
import type { RenderMessage } from '../../../render/messages.ts'

/** Estimated line height of one rendered message row (px). */
const ESTIMATE_LINE_HEIGHT = 22

/** Approximate CJK-friendly characters per line on a phone-width column. */
const ESTIMATE_CHARS_PER_LINE = 38

/** Rows a collapsed long message clamps to (matches chat-md-collapsed). */
const ESTIMATE_MAX_LINES = 12

/** 一张消息图片的估算高度（缩略图上限 + 间距，见 .chat-msg-image）。 */
const IMAGE_TILE_ESTIMATE = 220

/**
 * Stable row key: (turn, step) when the row carries them, else the id.
 * Streaming rows keep (turn, step) across the pending→settled id swap
 * (synthetic `assistant,<turn>.<step>#<seq>` → host id), while the id
 * itself changes — keying by id would remount the whole message when it
 * settles, replaying the msg-in animation and dropping open states
 * (expanded diff cards, reasoning folds).
 */
export function messageKey(message: RenderMessage): string {
  return message.turn !== undefined && message.step !== undefined
    ? `t${message.turn}.${message.step}`
    : message.id
}

/** Estimate one message row's rendered height in px (spacers use this). */
export function estimateMessageHeight(message: RenderMessage): number {
  if (message.kind === 'user') {
    /*
     * 长文在气泡里也是折叠的（`.chat-md-collapsed` = 45vh ≈ 12 行）；按全文估会把
     * 8,549 字估成 4,978px，账本总高一虚高，"滚到底"就被读成中段（见
     * docs/MOBILE-RENDERING.md「空白屏」）。
     */
    const collapsed = !message.pending && message.text.length > LONG_TEXT_LIMIT
    const chars = collapsed ? LONG_TEXT_PREVIEW : message.text.length
    const lines = Math.max(1, Math.ceil(chars / ESTIMATE_CHARS_PER_LINE))
    // 图片是固定高的缩略图（.chat-msg-image 的 max-height）：按张数补高度，
    // 否则含图的行在窗口化路径里会被低估，滚动位置会跳。
    const imageHeight = (message.images?.length ?? 0) * IMAGE_TILE_ESTIMATE
    const shown = collapsed ? Math.min(lines, ESTIMATE_MAX_LINES) : lines
    return 28 + shown * ESTIMATE_LINE_HEIGHT + imageHeight + (collapsed ? 30 : 0)
  }
  let height = 20
  if (message.reasoning !== undefined && message.reasoning !== '') height += 32
  if (message.tools !== undefined && message.tools.length > 0) height += 28
  const text = message.text
  if (text === '') return height + 24
  const collapsed = !message.pending && text.length > LONG_TEXT_LIMIT
  const shownChars = collapsed ? LONG_TEXT_PREVIEW : text.length
  const lines = Math.max(1, Math.ceil(shownChars / ESTIMATE_CHARS_PER_LINE))
  height += Math.min(lines, ESTIMATE_MAX_LINES) * ESTIMATE_LINE_HEIGHT
  if (collapsed) height += 30
  return height + 16
}
