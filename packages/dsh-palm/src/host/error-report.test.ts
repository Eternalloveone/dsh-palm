/**
 * 错误上报入口的形状闸门：**只收 `kind ∈ {error, rejection, resource}` + 非空 message**。
 *
 * 这条用例是给 2026-11-15 那个教训钉的钉子：三处现场探针（proc-vanish / flush-stall /
 * stream-lag）以前直接送自定义 kind，被这里整条拒掉，落盘目录里一条都没有 ——
 * 「看起来没发生」其实是「报了但被吃掉」，白丢两轮真机复现证据。
 * 探针必须走 `reportProbe`（把探针名折进 message），不能自己造 kind。
 */
import { describe, expect, it } from 'vitest'
import { validateErrorReport } from './error-report.ts'

describe('validateErrorReport：探针与真错误都要走同一个形状', () => {
  it('合法形状：kind=error + message + count，附带字段原样放行（探针就是这么送的）', () => {
    expect(validateErrorReport({
      kind: 'error',
      message: 'stream-lag lag=100 localSeq=0 hostSeq=100 sseLive=true',
      count: 1,
      probe: 'stream-lag',
      at: 1,
      lag: 100,
    })).toBeUndefined()
  })

  it('缺 count（或 count=0）也被拒 —— 探针必须显式带 1', () => {
    expect(validateErrorReport({ kind: 'error', message: 'x' })).toBe('错误报告 count 非法')
    expect(validateErrorReport({ kind: 'error', message: 'x', count: 0 })).toBe('错误报告 count 非法')
  })

  it('自定义 kind 会被整条拒掉（探针不能自己造 kind）', () => {
    expect(validateErrorReport({ kind: 'stream-lag', message: 'x' })).toBe('错误报告 kind 非法')
  })

  it('缺 message 也会被拒', () => {
    expect(validateErrorReport({ kind: 'error', lag: 1 })).toBe('错误报告缺少 message')
  })

  it('message 超过 240 字被拒（探针必须自己截断）', () => {
    expect(validateErrorReport({ kind: 'error', message: 'x'.repeat(241) })).toBe('错误报告 message 超过 240 字')
  })
})
