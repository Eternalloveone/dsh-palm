// @vitest-environment jsdom
/**
 * 壁纸状态：存的、读的、写到 <html> 上的三件事。
 *
 * 图片压缩走 canvas，jsdom 没有实现，所以这里只覆盖「状态 + 落盘 + 应用」这条链路；
 * 压缩本身靠实机验（设置页选一张照片，看能不能留下来）。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_WALLPAPER,
  applyWallpaper,
  getWallpaper,
  setWallpaper,
  subscribeWallpaper,
} from './wallpaper.ts'

const KEY = 'dsh.palm.wallpaper'
const IMG = 'data:image/jpeg;base64,AAAA'

describe('壁纸状态', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.wall
    document.documentElement.removeAttribute('style')
  })

  it('没设过时返回默认值', () => {
    expect(getWallpaper()).toEqual(DEFAULT_WALLPAPER)
  })

  it('坏 JSON 不当成壁纸（回默认，不抛）', () => {
    localStorage.setItem(KEY, '{不是 JSON')
    expect(getWallpaper()).toEqual(DEFAULT_WALLPAPER)
  })

  it('非图片的 image 字段被丢掉', () => {
    localStorage.setItem(KEY, JSON.stringify({ image: 'javascript:alert(1)', mask: 50 }))
    expect(getWallpaper().image).toBeNull()
  })

  it('遮罩与模糊会被夹到合法区间', () => {
    const state = setWallpaper({ image: IMG, mask: 500, blur: -8 })
    expect(state.mask).toBe(100)
    expect(state.blur).toBe(0)
    expect(getWallpaper()).toEqual({ image: IMG, mask: 100, blur: 0 })
  })

  it('局部修改不会丢掉图片', () => {
    setWallpaper({ image: IMG })
    setWallpaper({ mask: 40 })
    expect(getWallpaper()).toMatchObject({ image: IMG, mask: 40 })
  })

  it('应用时写 data-wall 与三个变量；清除时全部撤掉', () => {
    const root = document.documentElement
    applyWallpaper({ image: IMG, mask: 55, blur: 6 })
    expect(root.dataset.wall).toBe('on')
    expect(root.style.getPropertyValue('--palm-wall-mask')).toBe('55')
    expect(root.style.getPropertyValue('--palm-wall-blur')).toBe('6')
    expect(root.style.getPropertyValue('--palm-wall-img')).toContain('data:image/jpeg')

    applyWallpaper({ image: null, mask: 55, blur: 6 })
    expect(root.dataset.wall).toBeUndefined()
    expect(root.style.getPropertyValue('--palm-wall-img')).toBe('')
  })

  it('设了就广播一次（外观页靠它跟着变）', () => {
    let hits = 0
    const off = subscribeWallpaper(() => { hits += 1 })
    setWallpaper({ image: IMG })
    off()
    setWallpaper({ image: null })
    expect(hits).toBe(1)
  })
})
