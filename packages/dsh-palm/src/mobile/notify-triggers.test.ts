/** 通知触发条件的输入解析：空值不能变成 0（那会让每条回复都通知）。 */
import { describe, expect, it } from 'vitest'
import { parseNotifyTriggerInputs } from './notify-triggers.ts'

describe('parseNotifyTriggerInputs', () => {
  it('converts seconds and minutes into milliseconds', () => {
    expect(parseNotifyTriggerInputs('30', '5')).toEqual({ turnThresholdMs: 30_000, turnCooldownMs: 300_000 })
  })

  it('treats an empty field as invalid, not as zero', () => {
    // Number('') === 0：旧实现把清空的输入框存成「阈值为 0」，于是每条回复都通知。
    expect(parseNotifyTriggerInputs('', '5')).toBeUndefined()
    expect(parseNotifyTriggerInputs('30', '')).toBeUndefined()
    expect(parseNotifyTriggerInputs('   ', '5')).toBeUndefined()
  })

  it('rejects anything that is not a plain non-negative integer', () => {
    expect(parseNotifyTriggerInputs('1.5', '5')).toBeUndefined()
    expect(parseNotifyTriggerInputs('-3', '5')).toBeUndefined()
    expect(parseNotifyTriggerInputs('abc', '5')).toBeUndefined()
    expect(parseNotifyTriggerInputs('30', '5m')).toBeUndefined()
    expect(parseNotifyTriggerInputs('1e3', '5')).toBeUndefined()
  })

  it('rejects values so large they would mean "never notify"', () => {
    expect(parseNotifyTriggerInputs('86401', '5')).toBeUndefined()
    expect(parseNotifyTriggerInputs('30', '1441')).toBeUndefined()
    expect(parseNotifyTriggerInputs('86400', '1440')).toEqual({
      turnThresholdMs: 86_400_000,
      turnCooldownMs: 86_400_000,
    })
  })

  it('accepts zero, which is a deliberate "always notify"', () => {
    expect(parseNotifyTriggerInputs('0', '0')).toEqual({ turnThresholdMs: 0, turnCooldownMs: 0 })
  })
})
