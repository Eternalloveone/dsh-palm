/**
 * 消息正文投影：把 `content` 块数组压成界面直接能用的形状（W3-3）。
 *
 * 从 `messages.ts` 搬出来的一层——它只依赖 JSON 守卫，不依赖消息模型里任何东西，
 * 因此可以独立测试、也可以给宿主侧预览缓存复用（`preview-cache.ts` 就靠它保证
 * "手机折出来的正文"与"宿主折出来的正文"一模一样）。
 *
 * @module dsh-palm/mobile/projections/content
 */
import { isRecord, pickNumber, pickString } from './json.ts'

/** 一条消息里的图片引用（字节不在事件里，见 `RenderMessage.images`）。 */
export interface MessageImage {
  /** 内容寻址的持久附件 id（同一张图永远同一个 id，取一次即可长期缓存）。 */
  attachmentId: string
  /** 图片 MIME 类型。 */
  mediaType: string
  /** 原图宽（宿主入库时记录的像素宽）。 */
  width: number
  /** 原图高。 */
  height: number
  /** 字节数（宿主入库时记录）。 */
  bytes?: number
  /** 原始文件名。 */
  name?: string
}

/** 一条消息里的文件附件引用（内容寻址，字节另行读取）。 */
export interface MessageFile {
  /** 内容寻址的持久附件 id（sha256）。 */
  attachmentId: string
  /** 宿主清洗过的展示文件名。 */
  name: string
  /** 字节数。 */
  bytes: number
}

/** Concatenate the plain text of every `text` content block.
 *  Exported for host-side consumers (the preview cache) that must parse
 *  message content identically to the fold. */
export function textFromContent(content: unknown): string {
  return blocksOfType(content, 'text')
}

/** Concatenate the plain text of every `reasoning` content block (host-side
 *  consumers share this parse with the fold). */
export function reasoningFromContent(content: unknown): string {
  return blocksOfType(content, 'reasoning')
}

/**
 * 从 content 里取文件附件引用。
 *
 * 正式形态是 `{ type: 'file', attachment: { attachmentId, name, bytes } }`（宿主把
 * receipt 换成这份引用之后落库）；也兼容字段平铺在同一层的形态，缺 id 的块跳过。
 *
 * 以前只折 images，文件块被整块丢掉：文档上传成功、prompt 里也带着 receipt，发出去
 * 的那一行却只剩文字 —— 用户在"发送条"里看不到自己附了什么（真机反馈）。
 */
export function filesFromContent(content: unknown): MessageFile[] {
  if (!Array.isArray(content)) return []
  const files: MessageFile[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record['type'] !== 'file') continue
    const attachment = isRecord(record['attachment']) ? record['attachment'] : record
    // 没有名字的块画不出东西（名字是唯一认得出的信息），直接跳。
    const name = pickString(attachment['name']) ?? pickString(record['name'])
    if (name === undefined) continue
    // id 用于 key/去重：正式形态有 attachmentId；兼容只有 receiptId 的中间形态，
    // 两者都没有时用位置占位（宁可显示一张没 id 的卡片，也不要整块消失）。
    const attachmentId = pickString(attachment['attachmentId'])
      ?? pickString(record['attachmentId'])
      ?? pickString(record['receiptId'])
      ?? `file-${files.length}`
    files.push({
      attachmentId,
      name,
      bytes: pickNumber(attachment['bytes']) ?? pickNumber(record['bytes']) ?? 0,
    })
  }
  return files
}

/**
 * 从 content 里取图片引用。宿主把引用嵌在 `attachment` 下
 * （`{ type: 'image', attachment: { attachmentId, mediaType, … } }`）；也兼容
 * 字段直接平铺在同一层的旧形态，缺 id 或 mediaType 的块跳过。
 */
export function imagesFromContent(content: unknown): MessageImage[] {
  if (!Array.isArray(content)) return []
  const images: MessageImage[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = block as Record<string, unknown>
    if (record['type'] !== 'image') continue
    const attachment = isRecord(record['attachment']) ? record['attachment'] : record
    const attachmentId = pickString(attachment['attachmentId'])
    const mediaType = pickString(attachment['mediaType'])
    if (attachmentId === undefined || mediaType === undefined) continue
    const bytes = pickNumber(attachment['bytes'])
    const name = pickString(attachment['name'])
    images.push({
      attachmentId,
      mediaType,
      width: pickNumber(attachment['width']) ?? 0,
      height: pickNumber(attachment['height']) ?? 0,
      ...(bytes === undefined ? {} : { bytes }),
      ...(name === undefined ? {} : { name }),
    })
  }
  return images
}

/** Concatenate the plain text of every content block of one type. */
function blocksOfType(content: unknown, type: string): string {
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block['type'] !== type) continue
    const text = pickString(block['text'])
    if (text !== undefined) out += text
  }
  return out
}
