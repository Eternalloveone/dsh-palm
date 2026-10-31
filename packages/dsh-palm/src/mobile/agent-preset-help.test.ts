/**
 * 内置模式说明：宿主没写说明时，面板也要讲清每个模式的特点。
 */
import { describe, expect, it } from 'vitest'
import { builtinPresetIds, presetHelpIsBuiltin, presetHelpText } from './agent-preset-help.ts'

describe('Agent 模式内置说明', () => {
  it('宿主给了说明就用宿主的，且不标内置', () => {
    expect(presetHelpText('standard', '宿主写的说明')).toBe('宿主写的说明')
    expect(presetHelpIsBuiltin('standard', '宿主写的说明')).toBe(false)
  })

  it('宿主没写 → 用内置说明，并标出来源', () => {
    const text = presetHelpText('standard')
    expect(text).toBeDefined()
    expect(text).toContain('全量')
    expect(presetHelpIsBuiltin('standard')).toBe(true)
  })

  it('四个已知模式都有说明（standard / ptc / minimal / cordis）', () => {
    for (const id of ['standard', 'ptc', 'minimal', 'cordis']) {
      expect(presetHelpText(id)).toBeDefined()
    }
    expect(builtinPresetIds().length).toBeGreaterThanOrEqual(4)
  })

  it('未知模式不编造：返回 undefined', () => {
    expect(presetHelpText('mystery-mode')).toBeUndefined()
    expect(presetHelpIsBuiltin('mystery-mode')).toBe(false)
  })

  it('空白说明当成没有', () => {
    expect(presetHelpText('standard', '   ')).toContain('全量')
    expect(presetHelpIsBuiltin('standard', '   ')).toBe(true)
  })
})
