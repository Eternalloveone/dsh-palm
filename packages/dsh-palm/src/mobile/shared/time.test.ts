import { describe, expect, it } from 'vitest'
import { formatDuration, formatFullTime, formatTime } from './time.ts'

describe('formatDuration (desktop parity)', () => {
  it('floors whole seconds', () => {
    expect(formatDuration(19_999)).toBe('19秒')
    expect(formatDuration(0)).toBe('0秒')
  })

  it('keeps seconds when hours are involved', () => {
    expect(formatDuration(3_720_000)).toBe('1小时2分0秒')
    expect(formatDuration(569_000)).toBe('9分29秒')
  })

  it('never goes negative', () => {
    expect(formatDuration(-5_000)).toBe('0秒')
  })
})

describe('formatTime', () => {
  it('prints a bare clock for today', () => {
    const now = new Date()
    now.setHours(9, 5, 0, 0)
    expect(formatTime(now.getTime())).toBe('09:05')
  })

  it('prefixes yesterday', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(20, 31, 0, 0)
    expect(formatTime(yesterday.getTime())).toBe('昨天 20:31')
  })

  it('prints month and day for older timestamps', () => {
    const date = new Date()
    date.setDate(date.getDate() - 40)
    date.setHours(7, 3, 0, 0)
    expect(formatTime(date.getTime())).toBe(`${date.getMonth() + 1}月${date.getDate()}日 07:03`)
  })
})

describe('formatFullTime', () => {
  it('uses MM-DD HH:mm within the current year', () => {
    const date = new Date()
    date.setMonth(7, 29)
    date.setHours(14, 5, 0, 0)
    expect(formatFullTime(date.getTime())).toBe('08-29 14:05')
  })

  it('adds the year for older timestamps', () => {
    const date = new Date()
    date.setFullYear(date.getFullYear() - 2, 0, 3)
    date.setHours(1, 2, 0, 0)
    expect(formatFullTime(date.getTime())).toBe(`${date.getFullYear()}-01-03 01:02`)
  })
})
