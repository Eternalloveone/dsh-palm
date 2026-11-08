import { describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

describe('renameWithRetry', () => {
  it('首次成功时不重试', async () => {
    const fs = await import('node:fs')
    const spy = vi.mocked(fs.renameSync)
    spy.mockClear()
    spy.mockImplementationOnce(() => {})
    const { renameWithRetry } = await import('./atomic-write.ts')
    renameWithRetry('/tmp/a', '/tmp/b')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('EPERM 会重试并最终成功', async () => {
    const fs = await import('node:fs')
    const spy = vi.mocked(fs.renameSync)
    spy.mockClear()
    const eperm = Object.assign(new Error('EPERM'), { code: 'EPERM' })
    spy.mockImplementationOnce(() => { throw eperm })
    spy.mockImplementationOnce(() => { throw eperm })
    spy.mockImplementationOnce(() => {})
    const { renameWithRetry } = await import('./atomic-write.ts')
    expect(() => renameWithRetry('/tmp/a', '/tmp/b')).not.toThrow()
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('非占用类错误直接抛，不做无意义重试', async () => {
    const fs = await import('node:fs')
    const spy = vi.mocked(fs.renameSync)
    spy.mockClear()
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    spy.mockImplementationOnce(() => { throw enoent })
    const { renameWithRetry } = await import('./atomic-write.ts')
    expect(() => renameWithRetry('/tmp/a', '/tmp/b')).toThrow(/ENOENT/)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('重试用尽后抛最后一次错误（不伪装成功）', async () => {
    const fs = await import('node:fs')
    const spy = vi.mocked(fs.renameSync)
    spy.mockClear()
    spy.mockImplementation(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) })
    const { renameWithRetry } = await import('./atomic-write.ts')
    expect(() => renameWithRetry('/tmp/a', '/tmp/b')).toThrow(/EPERM/)
    expect(spy).toHaveBeenCalledTimes(6)
  })
})
