/**
 * 图片显示框：比例保持、上限内、小图不放大。
 *
 * 这些断言背后是一次真机跳动：占位 72px 高、加载后 220px 高的图，3 张就是
 * +550px，滚到那一行时下方内容整体被推走（用户报「一闪一闪」）。
 */
import { describe, expect, it } from 'vitest'
import { IMAGE_BOX_MAX_HEIGHT, IMAGE_BOX_MAX_WIDTH, IMAGE_PLACEHOLDER_BOX, imageBox } from './image-box.ts'

describe('imageBox', () => {
  it('横图按上限宽等比缩，不超 260×220', () => {
    expect(imageBox(1200, 600)).toEqual({ width: IMAGE_BOX_MAX_WIDTH, height: 130 })
  })

  it('竖图按上限高等比缩，宽度随之收窄（不会被裁成方块）', () => {
    const box = imageBox(600, 1200)
    expect(box?.height).toBe(IMAGE_BOX_MAX_HEIGHT)
    expect(box?.width).toBe(110)
  })

  it('小图不放大：原图比上限小就保持原尺寸', () => {
    expect(imageBox(100, 80)).toEqual({ width: 100, height: 80 })
  })

  it('正好压线时不变形', () => {
    expect(imageBox(260, 220)).toEqual({ width: 260, height: 220 })
  })

  it('宿主没记录宽高时返回 undefined（调用方退回旧行为）', () => {
    expect(imageBox(0, 0)).toBeUndefined()
    expect(imageBox(0, 800)).toBeUndefined()
    expect(imageBox(800, Number.NaN)).toBeUndefined()
  })

  it('占位框是一个可点的最小框', () => {
    expect(IMAGE_PLACEHOLDER_BOX.width).toBeGreaterThan(0)
    expect(IMAGE_PLACEHOLDER_BOX.height).toBeGreaterThan(0)
  })
})
