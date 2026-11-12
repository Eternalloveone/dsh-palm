// @vitest-environment node
/**
 * 会话投影解析边界（2026-11-10）：四个调用点收成一份解析。
 *
 * 重点是"没说"与"说了是空"的区分 —— 权威页只覆盖宿主真的带来的键，首屏基线整块覆盖。
 */
import { describe, expect, it } from 'vitest'
import { parseProjections, projectionValues } from './projections.ts'

describe('projectionValues', () => {
  it('取出原始键值表', () => {
    const page = { projections: { values: { permissions: { currentValue: 'default' } } } }
    expect(projectionValues(page)).toEqual({ permissions: { currentValue: 'default' } })
  })

  it('没有投影块 / 形状不对：undefined（不许当成"空投影"覆盖基线）', () => {
    expect(projectionValues(undefined)).toBeUndefined()
    expect(projectionValues({})).toBeUndefined()
    expect(projectionValues({ projections: {} })).toBeUndefined()
    expect(projectionValues({ projections: { values: null } })).toBeUndefined()
    expect(projectionValues({ projections: { values: [1, 2] } })).toBeUndefined()
  })
})

describe('parseProjections', () => {
  it('空表：什么键都没出现，值是空的', () => {
    const parsed = parseProjections(undefined)
    expect(parsed.present.size).toBe(0)
    expect(parsed.permissions).toBeUndefined()
    expect(parsed.contextPressure).toBeUndefined()
  })

  it('只带 permissions：只有这一个键算"出现"（权威页不许抹掉别的键）', () => {
    const parsed = parseProjections({ permissions: { currentValue: 'accept-edits', options: [] } })
    expect([...parsed.present]).toEqual(['permissions'])
    expect(parsed.permissions?.currentValue).toBe('accept-edits')
    expect(parsed.present.has('contextPressure')).toBe(false)
  })

  it('四个键齐了：全部出现并各自解析', () => {
    const parsed = parseProjections({
      permissions: { currentValue: 'default' },
      contextPressure: { contextWindow: 200000, pressureTokens: 1200 },
      turnOutline: { turns: [] },
      inbox: { items: 2 },
    })
    expect([...parsed.present]).toEqual(['permissions', 'contextPressure', 'turnOutline', 'inbox'])
    expect(parsed.contextPressure?.contextWindow).toBe(200000)
    expect(parsed.turnOutline).toEqual({ turns: [] })
    expect(parsed.inbox).toEqual({ items: 2 })
  })

  it('坏数据不抛：上下文压力给个字符串就当没给', () => {
    const parsed = parseProjections({ contextPressure: 'nope' })
    expect(parsed.present.has('contextPressure')).toBe(true)
    expect(parsed.contextPressure).toBeUndefined()
  })
})
