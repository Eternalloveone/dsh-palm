/**
 * 状态码要说人话（2026-11-12 实测余额不足返回 402）。
 */
import { describe, expect, it } from 'vitest'
import { describeStatus } from './voice-transcribe.ts'

describe('describeStatus', () => {
  it('402 说明是余额问题（实测硅基流动没钱就是这个码）', () => {
    expect(describeStatus(402)).toBe('HTTP 402：账户余额不足，需要充值')
  })

  it('401 / 403 指向密钥或权限', () => {
    expect(describeStatus(401)).toContain('密钥无效')
    expect(describeStatus(403)).toContain('密钥无效')
  })

  it('404 指向地址或模型名（最常见的配置错误）', () => {
    expect(describeStatus(404)).toContain('模型名')
  })

  it('429 是限流、5xx 是服务商故障，两者要分开说', () => {
    expect(describeStatus(429)).toContain('限流')
    expect(describeStatus(503)).toContain('服务商')
  })

  it('400 指向录音本身', () => {
    expect(describeStatus(400)).toContain('录音')
  })

  it('状态码本身始终保留，方便贴给服务商', () => {
    for (const status of [400, 401, 402, 403, 404, 413, 429, 500, 503]) {
      expect(describeStatus(status)).toContain(`HTTP ${status}`)
    }
  })

  it('没见过的码也有话说，不会返回空串', () => {
    expect(describeStatus(418)).toBe('HTTP 418：请求被拒绝')
  })
})
