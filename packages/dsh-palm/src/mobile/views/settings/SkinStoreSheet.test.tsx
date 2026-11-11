// @vitest-environment jsdom
/**
 * 皮肤商店：试穿不落盘、取消还原、应用落盘、卡片带来源署名。
 *
 * 2026-11-11 用户定的交互：点卡片当场换（试穿），退出前不保存；
 * 「取消」还原进店时那套，「用这一套」才落盘。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkinStoreSheet } from './SkinStoreSheet.tsx'
import { getSkin, setSkin } from '../../platform/skin.ts'

/** 当前 `<html data-skin>`。 */
function appliedSkin(): string | undefined {
  return document.documentElement.dataset.skin
}

beforeEach(() => {
  localStorage.clear()
  setSkin('graphite')
})

afterEach(() => {
  cleanup()
  document.documentElement.dataset.skin = ''
})

describe('皮肤商店', () => {
  it('点卡片当场试穿（整屏立刻换），但还没落盘', () => {
    render(<SkinStoreSheet onClose={() => {}} />)
    fireEvent.click(screen.getByText('纸').closest('button')!)

    // 试穿：全局属性已经变了……
    expect(appliedSkin()).toBe('paper')
    // ……但用户的选择没被写死（取消后还是原来的）。
    expect(getSkin()).toBe('graphite')
  })

  it('「取消」还原进店时那套', () => {
    let closed = 0
    render(<SkinStoreSheet onClose={() => { closed += 1 }} />)
    fireEvent.click(screen.getByText('夜航').closest('button')!)
    expect(appliedSkin()).toBe('nocturne')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(closed).toBe(1)
    expect(getSkin()).toBe('graphite')
    expect(appliedSkin()).toBe('graphite')
  })

  it('「用这一套」才落盘', () => {
    render(<SkinStoreSheet onClose={() => {}} />)
    fireEvent.click(screen.getByText('纸').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: '用这一套' }))

    expect(getSkin()).toBe('paper')
    expect(appliedSkin()).toBe('paper')
  })

  it('卡片上写着名字、说明、来源与许可', () => {
    render(<SkinStoreSheet onClose={() => {}} />)
    expect(screen.getByText('石墨')).toBeTruthy()
    expect(screen.getByText('深灰底 + 靛蓝强调，默认的一套')).toBeTruthy()
    // 来源与许可是硬要求（2026-11-11）：内置的也要写明。
    expect(screen.getAllByText('手机端自带 · MIT').length).toBe(3)
    // 移植作品要标出处：作者/仓库名 + 许可（2026-11-11 用户要求）。
    expect(screen.getByText('来自 2754LM/dsh-theme-newsprint · MIT')).toBeTruthy()
  })

  it('预览块带着自己那套皮肤的标识（颜色走令牌，不在组件里写色值）', () => {
    const { container } = render(<SkinStoreSheet onClose={() => {}} />)
    const shots = [...container.querySelectorAll('.skin-card-shot')]
    expect(shots.map(shot => shot.getAttribute('data-skin'))).toEqual(['graphite', 'paper', 'nocturne', 'newsprint', 'endfield', 'claude'])
  })
})
