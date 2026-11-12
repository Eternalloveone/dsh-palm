/**
 * 抽屉行右侧「什么时候」的文案契约。
 *
 * 这一组原先在 `views/drawer-rows.test.ts` 里；2026-11-11 函数搬到 ui 层后跟着搬，
 * 免得测试还从 views 反向 import ui 的实现。
 */
import { describe, expect, it } from 'vitest'
import { drawerWhenLabel } from './drawer-when.ts'

describe('drawerWhenLabel（行右侧的「什么时候」）', () => {
  it('今天给时刻、昨天给「昨天」、更早给月-日、跨年补年份', () => {
    const now = new Date(2026, 10, 11, 21, 30).getTime()
    expect(drawerWhenLabel(new Date(2026, 10, 11, 9, 5).getTime(), now)).toBe('09:05')
    expect(drawerWhenLabel(new Date(2026, 10, 11, 0, 0).getTime(), now)).toBe('00:00')
    expect(drawerWhenLabel(new Date(2026, 10, 10, 18, 42).getTime(), now)).toBe('昨天')
    expect(drawerWhenLabel(new Date(2026, 10, 3, 18, 42).getTime(), now)).toBe('11-03')
    expect(drawerWhenLabel(new Date(2025, 11, 31, 23, 59).getTime(), now)).toBe('2025-12-31')
  })

  it('拿不到时间戳时不画（返回空串），不显示 1970', () => {
    const now = Date.now()
    expect(drawerWhenLabel(0, now)).toBe('')
    expect(drawerWhenLabel(Number.NaN, now)).toBe('')
  })
})
