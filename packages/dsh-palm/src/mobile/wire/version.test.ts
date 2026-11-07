/**
 * Wire 契约的运行时护栏（W4-1）。
 *
 * 文件里另有一层**编译期**校验（`NoFrameMissingFromList` / `NoExtraFrameInList`）：
 * 宿主加一帧而不在手机端登记，`pnpm typecheck` 直接失败。这里补的是运行期那半——
 * 真正收到一个不认识的帧时该怎么做。
 */
import { describe, expect, it } from 'vitest'
import { WIRE_CAPABILITIES, WIRE_FRAME_TYPES, WIRE_VERSION, isKnownFrame } from './version.ts'

describe('WIRE_FRAME_TYPES', () => {
  it('没有重复项（重复会让类型收窄到无意义）', () => {
    expect(new Set(WIRE_FRAME_TYPES).size).toBe(WIRE_FRAME_TYPES.length)
  })

  it('覆盖客户端必须处理的几个关键帧', () => {
    for (const type of ['session/event', 'approval/requested', 'session/queue', 'session/turn-boundary', 'mux/ping', 'stream/error']) {
      expect(WIRE_FRAME_TYPES).toContain(type)
    }
  })

  it('数量与契约一致（加帧时这个数字会逼你来看一眼）', () => {
    expect(WIRE_FRAME_TYPES.length).toBe(18)
  })
})

describe('isKnownFrame', () => {
  it('认识的帧返回 true', () => {
    expect(isKnownFrame('session/event')).toBe(true)
  })

  it('不认识的帧返回 false —— 老客户端要静默忽略，而不是把连接作废', () => {
    expect(isKnownFrame('session/brand-new-thing')).toBe(false)
    expect(isKnownFrame('')).toBe(false)
  })
})

describe('WIRE_CAPABILITIES', () => {
  it('能力位的值互不相同（撞车等于一个开关控制两个功能）', () => {
    const values = Object.values(WIRE_CAPABILITIES)
    expect(new Set(values).size).toBe(values.length)
  })

  it('全部是 kebab-case（要出现在 URL/query 里，别用驼峰）', () => {
    for (const value of Object.values(WIRE_CAPABILITIES)) {
      expect(value).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })
})

describe('WIRE_VERSION', () => {
  it('是正整数：0 与负数都没法当作"我支持哪一版"来比较', () => {
    expect(Number.isInteger(WIRE_VERSION)).toBe(true)
    expect(WIRE_VERSION).toBeGreaterThan(0)
  })
})
