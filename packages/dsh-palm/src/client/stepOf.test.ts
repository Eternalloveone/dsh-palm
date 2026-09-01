// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stepOf, type PanelState } from './RemotePanel.tsx'

/** A ready state with the given phase. */
function readyState(phase: 'waiting' | 'stopped' | 'connected' | 'disconnected'): PanelState {
  return {
    kind: 'ready',
    url: 'http://192.168.1.5:3080/m/?pair=tok-1',
    code: '200785',
    expiresAt: Date.now() + 60_000,
    expired: false,
    phase,
    deviceCount: 0,
    onlineCount: 0,
    devices: [],
    address: '192.168.1.5',
    lanAddresses: ['192.168.1.5'],
    public: false,
  }
}

describe('stepOf', () => {
  it('highlights configure when no address exists', () => {
    expect(stepOf({ kind: 'lan-required' })).toEqual({ current: 1, done: [false, false, false] })
  })

  it('hides the steps for access and connectivity problems', () => {
    expect(stepOf({ kind: 'loopback-required' })).toBeUndefined()
    expect(stepOf({ kind: 'unreachable' })).toBeUndefined()
  })

  it('highlights pair once a QR exists and no device has paired', () => {
    expect(stepOf(readyState('waiting'))).toEqual({ current: 2, done: [true, false, false] })
    expect(stepOf(readyState('stopped'))).toEqual({ current: 2, done: [true, false, false] })
  })

  it('highlights use once a device has paired', () => {
    expect(stepOf(readyState('connected'))).toEqual({ current: 3, done: [true, true, false] })
    expect(stepOf(readyState('disconnected'))).toEqual({ current: 3, done: [true, true, false] })
  })
})
