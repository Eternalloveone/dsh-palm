/**
 * 投影层：正文/附件的解析契约（W3-3 从 `messages.ts` 搬出来的一层）。
 *
 * 这些函数是"事件 → 界面能用的形状"的第一步，宿主侧的 `preview-cache.ts` 也调它，
 * 所以两边对同一段 content 必须折出同一份正文 —— 这条测试就是那个契约。
 */
import { describe, expect, it } from 'vitest'
import {
  filesFromContent,
  imagesFromContent,
  reasoningFromContent,
  textFromContent,
} from './content.ts'

describe('textFromContent / reasoningFromContent', () => {
  it('按类型拼接，不掺别的块', () => {
    const content = [
      { type: 'text', text: '甲' },
      { type: 'reasoning', text: '想一下' },
      { type: 'text', text: '乙' },
    ]
    expect(textFromContent(content)).toBe('甲乙')
    expect(reasoningFromContent(content)).toBe('想一下')
  })

  it('非数组/空值给空串（不抛）', () => {
    expect(textFromContent(undefined)).toBe('')
    expect(textFromContent('字符串不是块数组')).toBe('')
    expect(reasoningFromContent(null)).toBe('')
  })

  it('缺 text 或类型不对的块被跳过', () => {
    const content = [{ type: 'text' }, { type: 'text', text: 42 }, { type: 'text', text: '丙' }]
    expect(textFromContent(content)).toBe('丙')
  })
})

describe('imagesFromContent', () => {
  it('认 attachment 嵌层形态', () => {
    const images = imagesFromContent([
      { type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png', width: 10, height: 20, bytes: 99, name: 'x.png' } },
    ])
    expect(images).toEqual([{ attachmentId: 'a1', mediaType: 'image/png', width: 10, height: 20, bytes: 99, name: 'x.png' }])
  })

  it('也认字段平铺的旧形态，缺 id/mediaType 的跳掉', () => {
    const images = imagesFromContent([
      { type: 'image', attachmentId: 'a2', mediaType: 'image/jpeg' },
      { type: 'image', mediaType: 'image/png' },
      { type: 'text', text: '不是图' },
    ])
    expect(images).toEqual([{ attachmentId: 'a2', mediaType: 'image/jpeg', width: 0, height: 0 }])
  })
})

describe('filesFromContent', () => {
  it('取名字与字节数', () => {
    const files = filesFromContent([
      { type: 'file', attachment: { attachmentId: 'f1', name: '报告.pdf', bytes: 2048 } },
    ])
    expect(files).toEqual([{ attachmentId: 'f1', name: '报告.pdf', bytes: 2048 }])
  })

  it('只有 receiptId 的中间形态也能显示（id 用于 key）', () => {
    const files = filesFromContent([{ type: 'file', name: 'a.txt', receiptId: 'r1' }])
    expect(files).toEqual([{ attachmentId: 'r1', name: 'a.txt', bytes: 0 }])
  })

  it('没有名字的块跳过；连 id 都没有时用位置占位', () => {
    const files = filesFromContent([
      { type: 'file', attachmentId: 'f1' },
      { type: 'file', name: 'b.txt' },
    ])
    expect(files).toEqual([{ attachmentId: 'file-0', name: 'b.txt', bytes: 0 }])
  })
})
