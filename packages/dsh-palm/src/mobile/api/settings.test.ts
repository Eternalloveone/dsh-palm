import { describe, expect, it } from 'vitest'
import { isAllowedSettingsOp } from './settings.ts'

const ALLOWED = [['mobile', 'enterToSend'], ['theme', 'skin'], ['*']] as const
const EXACT = [['mobile', 'enterToSend'], ['theme', 'skin']] as const

describe('isAllowedSettingsOp', () => {
  it('命中白名单返回 true', () => {
    expect(isAllowedSettingsOp({ op: 'set', path: ['mobile', 'enterToSend'] }, EXACT)).toBe(true)
  })

  it('非 set 操作一律拒绝', () => {
    expect(isAllowedSettingsOp({ op: 'delete', path: ['mobile', 'enterToSend'] }, EXACT)).toBe(false)
  })

  it('路径长度不一致时拒绝（不做前缀匹配）', () => {
    expect(isAllowedSettingsOp({ op: 'set', path: ['mobile'] }, EXACT)).toBe(false)
    expect(isAllowedSettingsOp({ op: 'set', path: ['theme', 'skin', 'extra'] }, EXACT)).toBe(false)
  })

  it('通配符只允许单段路径', () => {
    expect(isAllowedSettingsOp({ op: 'set', path: ['anything'] }, ALLOWED)).toBe(true)
    expect(isAllowedSettingsOp({ op: 'set', path: ['a', 'b'] }, ALLOWED)).toBe(false)
  })

  it('非字符串 path 段被当作空串（不会被意外放行）', () => {
    expect(isAllowedSettingsOp({ op: 'set', path: [1, 2] }, [['', '']])).toBe(true)
    expect(isAllowedSettingsOp({ op: 'set', path: [1, 2] }, EXACT)).toBe(false)
  })

  it('非法输入返回 false 而不是抛错', () => {
    expect(isAllowedSettingsOp(null, EXACT)).toBe(false)
    expect(isAllowedSettingsOp('nope', EXACT)).toBe(false)
    expect(isAllowedSettingsOp({ op: 'set', path: 'mobile.enterToSend' }, EXACT)).toBe(false)
  })
})
