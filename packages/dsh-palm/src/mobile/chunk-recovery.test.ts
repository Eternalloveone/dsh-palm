/** 旧 chunk 404：认出这种失败，并且自动重载只做一次（否则会变成无限刷新）。 */
import { describe, expect, it } from 'vitest'
import { claimChunkAutoReload, isChunkLoadFailure, resetChunkAutoReload } from './chunk-recovery.ts'

/** 一个最小的 sessionStorage 替身。 */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => { map.clear() },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => { map.delete(key) },
    setItem: (key: string, value: string) => { map.set(key, value) },
  }
}

describe('isChunkLoadFailure', () => {
  it('recognises the browser and bundler wordings', () => {
    expect(isChunkLoadFailure('Failed to fetch dynamically imported module: /m/mobile/ChatView-x.js')).toBe(true)
    expect(isChunkLoadFailure('Importing a module script failed.')).toBe(true)
    expect(isChunkLoadFailure('ChunkLoadError: Loading chunk 12 failed.')).toBe(true)
    expect(isChunkLoadFailure('error loading dynamically imported module')).toBe(true)
  })

  it('does not mistake ordinary render errors for a stale chunk', () => {
    // 这类错误重试（重新挂载）可能就好了，不该触发整页刷新。
    expect(isChunkLoadFailure('render boom')).toBe(false)
    expect(isChunkLoadFailure('Cannot read properties of undefined')).toBe(false)
    expect(isChunkLoadFailure('')).toBe(false)
    expect(isChunkLoadFailure(undefined)).toBe(false)
  })
})

describe('claimChunkAutoReload', () => {
  it('grants the first automatic reload only', () => {
    const storage = memoryStorage()
    resetChunkAutoReload(storage)
    expect(claimChunkAutoReload(storage)).toBe(true)
    // 第二次必须拒绝：半部署状态下新壳子配旧 chunk 会无限刷新。
    expect(claimChunkAutoReload(storage)).toBe(false)
    resetChunkAutoReload(storage)
    expect(claimChunkAutoReload(storage)).toBe(true)
  })

  it('refuses to reload when storage is unavailable (private mode)', () => {
    // 没有记账手段就不自动刷新：宁可让用户手动点，也不要冒无限刷新的风险。
    expect(claimChunkAutoReload(undefined)).toBe(false)
  })
})
