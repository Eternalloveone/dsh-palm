/**
 * 依赖自检收集器：setup 期登记 + 运行期帧计数。
 *
 * 这里锁住两件事：帧计数在重新登记时不被清零（升级后重启插件、或某条依赖被重新
 * 登记，都不该把"收到过多少帧"抹掉），以及摘要行的形状（失败项带原因，够一眼定位）。
 */
import { describe, expect, it } from 'vitest'
import { DependencyDiagnostics } from './api-proxy-diag.ts'

describe('DependencyDiagnostics', () => {
  it('records setup-time checks in registration order', () => {
    const diag = new DependencyDiagnostics()
    diag.register('session.control', 'event', true)
    diag.register('session.follow', 'method', false, '宿主未提供该方法')

    expect(diag.snapshot()).toEqual([
      { name: 'session.control', kind: 'event', ok: true, frames: 0 },
      { name: 'session.follow', kind: 'method', ok: false, reason: '宿主未提供该方法', frames: 0 },
    ])
  })

  it('counts frames and stamps the last arrival', () => {
    const diag = new DependencyDiagnostics()
    diag.register('session/event', 'event', true)
    diag.note('session/event')
    diag.note('session/event')

    const [check] = diag.snapshot()
    expect(check?.frames).toBe(2)
    expect(typeof check?.lastAt).toBe('number')
  })

  it('keeps the frame count when a dependency is re-registered', () => {
    const diag = new DependencyDiagnostics()
    diag.register('session/event', 'event', true)
    diag.note('session/event')
    diag.register('session/event', 'event', false, '订阅被拒绝')

    const [check] = diag.snapshot()
    expect(check?.ok).toBe(false)
    expect(check?.reason).toBe('订阅被拒绝')
    // 计数属于运行期事实，不该被一次重新登记抹掉。
    expect(check?.frames).toBe(1)
  })

  it('counts an unregistered event so a live bus still shows up', () => {
    const diag = new DependencyDiagnostics()
    diag.note('agent/assistant-stream')

    expect(diag.snapshot()).toEqual([
      { name: 'agent/assistant-stream', kind: 'event', ok: true, frames: 1, lastAt: expect.any(Number) },
    ])
  })

  it('summarizes failures with their reason and events with their frame count', () => {
    const diag = new DependencyDiagnostics()
    diag.register('session.control', 'event', true)
    diag.note('session.control')
    diag.register('session.page', 'method', true)
    diag.register('agent/assistant-stream', 'event', false, '订阅被拒绝')

    expect(diag.summary())
      .toBe('session.control=ok/1帧 session.page=ok agent/assistant-stream=FAIL(订阅被拒绝)')
  })

  it('hands out copies, so callers cannot mutate the collector', () => {
    const diag = new DependencyDiagnostics()
    diag.register('session/event', 'event', true)
    const snapshot = diag.snapshot()
    snapshot[0]!.frames = 99
    expect(diag.snapshot()[0]?.frames).toBe(0)
  })
})
