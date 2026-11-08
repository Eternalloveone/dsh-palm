// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SCREEN_LAYOUTS, layoutOf } from './screens.ts'
import { SlotLayout, assertDataOnly, validateLayout } from '../ui/slot-layout.tsx'

const NAMES = Object.keys(SCREEN_LAYOUTS) as Array<keyof typeof SCREEN_LAYOUTS>

describe('P5 屏排布（布局契约）', () => {
  it('9 屏都有排布，且名字与键一致', () => {
    expect(NAMES).toHaveLength(9)
    for (const name of NAMES) {
      expect(layoutOf(name).name).toBe(layoutOf(name).name.trim())
      expect(layoutOf(name).blocks.length).toBeGreaterThan(1)
    }
  })

  it('每份排布都是纯数据（不含函数）', () => {
    for (const name of NAMES) {
      expect(assertDataOnly(layoutOf(name))).toEqual([])
    }
  })

  it('每份排布都能通过契约校验：提供同名插槽即无问题', () => {
    for (const name of NAMES) {
      const spec = layoutOf(name)
      const slots = Object.fromEntries(spec.blocks.map(block => [block.slot, null]))
      expect(validateLayout(spec, slots)).toEqual([])
    }
  })

  it('必填槽缺失时校验报错（契约不是装饰）', () => {
    const spec = layoutOf('chat')
    const slots = { header: null, rows: null, status: null } // 少 composer
    const problems = validateLayout(spec, slots)
    expect(problems.some(problem => problem.includes('composer'))).toBe(true)
  })

  it('每个屏恰好有一个吃剩余空间的区块（滚动区唯一）', () => {
    for (const name of NAMES) {
      const growers = layoutOf(name).blocks.filter(block => block.grow === true)
      expect(growers, `${name} 应恰有一个 grow 区块`).toHaveLength(1)
    }
  })

  it('渲染后按排布顺序输出 data-slot，并标出 grow', () => {
    const spec = layoutOf('chat')
    const slots = Object.fromEntries(spec.blocks.map(block => [block.slot, block.slot]))
    const { container } = render(<SlotLayout spec={spec} slots={slots} />)
    const rendered = [...container.querySelectorAll('[data-slot]')].map(node => node.getAttribute('data-slot'))
    expect(rendered).toEqual(spec.blocks.map(block => block.slot))
    expect(container.querySelector('[data-slot="rows"]')?.getAttribute('data-grow')).toBe('')
    expect(container.querySelector('[data-slot="header"]')?.getAttribute('data-grow')).toBeNull()
  })

  it('插槽提供了但排布没引用时直接报错（写了不渲染是 bug）', () => {
    const spec = layoutOf('search')
    const slots = { input: null, results: null, extra: null }
    expect(validateLayout(spec, slots).join('\n')).toContain('写了不渲染')
  })
})
