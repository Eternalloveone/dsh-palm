/**
 * 版本握手的契约（W4-6）：唯一的验收标准是**降级不报错**。
 *
 * 宿主是老的、握手字段缺失、能力位名字不认识——这些都不是错误，只是"这个功能不存在"。
 * 每一处用能力位的地方都得自带 fallback（老路径），所以默认值是**关闭**。
 */
import { describe, expect, it } from 'vitest'
import { hasCapability, planHandshake } from './handshake.ts'
import { WIRE_CAPABILITIES, WIRE_VERSION } from './version.ts'

describe('planHandshake · 老宿主（什么都不发）', () => {
  it('全部能力关闭，但不抛错', () => {
    const plan = planHandshake(undefined)
    expect(plan.enabled.size).toBe(0)
    expect(plan.hostVersion).toBeUndefined()
    expect(plan.hostOlder).toBe(false)
    expect(plan.hostNewer).toBe(false)
    for (const capability of Object.values(WIRE_CAPABILITIES)) {
      expect(hasCapability(plan, capability)).toBe(false)
    }
  })

  it('空对象 / null / 字符串 / 数字都不炸', () => {
    for (const input of [{}, null, 'old-host', 42, []]) {
      expect(() => planHandshake(input)).not.toThrow()
      expect(planHandshake(input).enabled.size).toBe(0)
    }
  })

  it('每个没开的能力位都有"为什么"', () => {
    const plan = planHandshake(undefined)
    const reasons = new Map(plan.degraded.map(item => [item.capability, item.reason]))
    expect(reasons.get('live-session-list' as never) ?? reasons.get(WIRE_CAPABILITIES.liveSessionList)).toBe('unsupported')
    expect(plan.degraded.length).toBeGreaterThanOrEqual(Object.keys(WIRE_CAPABILITIES).length)
  })
})

describe('planHandshake · 同版本宿主', () => {
  it('声明了哪些就开哪些', () => {
    const plan = planHandshake({
      wireVersion: WIRE_VERSION,
      capabilities: [WIRE_CAPABILITIES.liveSessionList, WIRE_CAPABILITIES.toolRisk],
    })
    expect(hasCapability(plan, WIRE_CAPABILITIES.liveSessionList)).toBe(true)
    expect(hasCapability(plan, WIRE_CAPABILITIES.toolRisk)).toBe(true)
    expect(hasCapability(plan, WIRE_CAPABILITIES.goalActivation)).toBe(false)
    expect(plan.hostOlder).toBe(false)
    expect(plan.hostNewer).toBe(false)
  })

  it('能力位数组里混进非字符串也不会带歪判定', () => {
    const plan = planHandshake({
      wireVersion: WIRE_VERSION,
      capabilities: [WIRE_CAPABILITIES.toolRisk, 42, null, { x: 1 }],
    })
    expect(hasCapability(plan, WIRE_CAPABILITIES.toolRisk)).toBe(true)
    expect(plan.enabled.size).toBe(1)
  })
})

describe('planHandshake · 版本不一致', () => {
  it('宿主更老：能力位照开，但额外记一条 version-mismatch（诊断页要能解释）', () => {
    // WIRE_VERSION = 1 时没有"更老的合法版本"，所以这里显式给一个更大的客户端版本。
    const plan = planHandshake({
      wireVersion: 2,
      capabilities: [WIRE_CAPABILITIES.toolRisk],
    }, 3)
    expect(plan.hostOlder).toBe(true)
    expect(hasCapability(plan, WIRE_CAPABILITIES.toolRisk)).toBe(true)
    expect(plan.degraded.some(item => item.capability === WIRE_CAPABILITIES.toolRisk && item.reason === 'version-mismatch')).toBe(true)
  })

  it('宿主更新：不算错误，只标 hostNewer（可能收到未知帧，忽略即可）', () => {
    const plan = planHandshake({ wireVersion: WIRE_VERSION + 1, capabilities: [] })
    expect(plan.hostNewer).toBe(true)
    expect(plan.hostOlder).toBe(false)
  })

  it('宿主声明的能力位名字客户端不认识 → unknown-capability，不影响其它位', () => {
    const plan = planHandshake({
      wireVersion: WIRE_VERSION,
      capabilities: [WIRE_CAPABILITIES.toolRisk, 'from-the-future'],
    })
    expect(hasCapability(plan, WIRE_CAPABILITIES.toolRisk)).toBe(true)
    expect(plan.degraded.some(item => item.reason === 'unknown-capability')).toBe(true)
  })

  it('版本号是 0 / 负数 / NaN / 字符串时当作没声明', () => {
    for (const wireVersion of [0, -1, Number.NaN, '2']) {
      const plan = planHandshake({ wireVersion })
      expect(plan.hostVersion).toBeUndefined()
      expect(plan.hostOlder).toBe(false)
      expect(plan.hostNewer).toBe(false)
    }
  })
})
