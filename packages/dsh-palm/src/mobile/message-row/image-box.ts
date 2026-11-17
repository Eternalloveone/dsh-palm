/**
 * 消息图片的**显示框尺寸**（宽高都由它定死）。
 *
 * 为什么需要（2026-11-17 真机实测）：图片是异步取的（`loadAttachmentUrl`），
 * 加载前只有一块 `min-height:72px` 的占位，加载后按 `max-height:220px` 撑开。
 * 一条 3 张图的消息实测高度 1279 → **1829（+550）**，把下方所有内容整体推下去 ——
 * 用户看到的就是滚动时屏幕「一闪一闪」地跳。给图片和占位用**同一个固定框**，
 * 加载前后高度完全一致，跳动从 550px 变成 0。
 *
 * 三条约束：
 * 1. 保持原始比例（不裁切、不拉伸）；
 * 2. 小图不放大（原图比上限小就按原尺寸）；
 * 3. 宿主没记录宽高（`width/height` 为 0）时返回 `undefined`，调用方退回旧行为。
 *
 * @module dsh-palm/mobile/message-row/image-box
 */

/** 单张图的显示框上限：与 `150-chat.css` 的 `.chat-msg-image` 上限一致。 */
export const IMAGE_BOX_MAX_WIDTH = 260
/** 同上（`max-height`）。 */
export const IMAGE_BOX_MAX_HEIGHT = 220

/** 一个确定的显示框（px，已取整）。 */
export interface ImageBox {
  readonly width: number
  readonly height: number
}

/**
 * 按原图比例算一个落在上限内的显示框。
 *
 * @param width - 原图宽（px，宿主入库时记录）
 * @param height - 原图高（px）
 * @returns 固定宽高；拿不到有效宽高时 `undefined`
 */
export function imageBox(width: number, height: number): ImageBox | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined
  if (width <= 0 || height <= 0) return undefined
  const ratio = height / width
  // 小图不放大：起始宽取「原图宽」与上限的较小者。
  let boxWidth = Math.min(IMAGE_BOX_MAX_WIDTH, width)
  let boxHeight = boxWidth * ratio
  if (boxHeight > IMAGE_BOX_MAX_HEIGHT) {
    boxHeight = IMAGE_BOX_MAX_HEIGHT
    boxWidth = boxHeight / ratio
  }
  return { width: Math.round(boxWidth), height: Math.round(boxHeight) }
}

/** 占位（还没有字节时）用：拿到宽高就同框，拿不到给一个可见的最小框。 */
export const IMAGE_PLACEHOLDER_BOX: ImageBox = { width: 128, height: 72 }
