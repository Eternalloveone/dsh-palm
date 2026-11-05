import { describe, expect, it } from 'vitest'
import { DEVICE_HANDLE_LENGTH, deviceHandleOf, resolveDeviceHandle } from './device-handle.ts'

describe('deviceHandleOf', () => {
  it('is stable for one id', () => {
    expect(deviceHandleOf('dev-abc')).toBe(deviceHandleOf('dev-abc'))
  })

  it('never returns the credential itself', () => {
    const id = 'a'.repeat(64)
    const handle = deviceHandleOf(id)
    expect(handle).not.toBe(id)
    expect(handle).toHaveLength(DEVICE_HANDLE_LENGTH)
    expect(id.includes(handle)).toBe(false)
  })

  it('differs between devices', () => {
    expect(deviceHandleOf('dev-a')).not.toBe(deviceHandleOf('dev-b'))
  })
})

describe('resolveDeviceHandle', () => {
  const devices = [{ id: 'dev-a' }, { id: 'dev-b' }]

  it('maps a handle back to its device id', () => {
    expect(resolveDeviceHandle(devices, deviceHandleOf('dev-b'))).toBe('dev-b')
  })

  it('rejects an unknown handle', () => {
    expect(resolveDeviceHandle(devices, 'nope')).toBeUndefined()
  })

  it('rejects an empty handle without scanning', () => {
    expect(resolveDeviceHandle(devices, '')).toBeUndefined()
  })

  it('rejects a raw device id (the thing the roster must never accept)', () => {
    expect(resolveDeviceHandle(devices, 'dev-a')).toBeUndefined()
  })
})
