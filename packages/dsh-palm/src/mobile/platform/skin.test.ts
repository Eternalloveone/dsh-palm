// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applySkin, getSkin, setSkin, SKIN_HINT, SKIN_LABEL, subscribeSkin } from './skin.ts'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-skin')
})

describe('皮肤（三套 + 落盘 + 广播）', () => {
  it('默认是石墨', () => {
    expect(getSkin()).toBe('graphite')
  })

  it('三套皮肤都有中文名与说明（界面上不出现枚举名）', () => {
    for (const key of ['graphite', 'paper', 'nocturne'] as const) {
      expect(SKIN_LABEL[key]).not.toBe('')
      expect(SKIN_HINT[key]).not.toBe('')
    }
  })

  it('切皮肤会落盘并写到 html[data-skin]', () => {
    setSkin('paper')
    expect(getSkin()).toBe('paper')
    expect(document.documentElement.dataset.skin).toBe('paper')
  })

  it('脏数据回退到默认，不让界面被搞花', () => {
    localStorage.setItem('dsh.palm.skin', 'neon-404')
    expect(getSkin()).toBe('graphite')
  })

  it('applySkin 用当前值（启动时调用一次即可）', () => {
    setSkin('nocturne')
    document.documentElement.removeAttribute('data-skin')
    applySkin()
    expect(document.documentElement.dataset.skin).toBe('nocturne')
  })

  it('订阅者会收到变更，退订后不再收到', () => {
    const spy = vi.fn()
    const off = subscribeSkin(spy)
    setSkin('paper')
    expect(spy).toHaveBeenCalledTimes(1)
    off()
    setSkin('nocturne')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
