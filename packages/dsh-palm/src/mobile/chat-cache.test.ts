import { beforeEach, describe, expect, it } from 'vitest'
import {
  CHAT_CACHE_MAX_ROWS,
  CHAT_CACHE_TTL_MS,
  dropAllChatCaches,
  dropChatCache,
  loadChatCache,
  saveChatCache,
} from './chat-cache.ts'

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'assistant', text: id, ...extra })

/** 内存版 localStorage：Node 这个测试环境没给真的，自己搭一个更可控。 */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => { map.clear() },
    getItem: key => map.get(key) ?? null,
    key: index => [...map.keys()][index] ?? null,
    removeItem: key => { map.delete(key) },
    setItem: (key, value) => { map.set(key, String(value)) },
  } as Storage
}

describe('聊天页正文缓存（chat-cache）', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true })
  })

  it('存进去能原样读出来', () => {
    saveChatCache('s1', [row('a'), row('b')])
    expect(loadChatCache('s1').map(entry => entry.id)).toEqual(['a', 'b'])
  })

  it('只保留最后一屏（条数上限），丢弃更早的行', () => {
    const many = Array.from({ length: CHAT_CACHE_MAX_ROWS + 20 }, (_, index) => row(`m${index}`))
    saveChatCache('s1', many)
    const rows = loadChatCache('s1')
    expect(rows).toHaveLength(CHAT_CACHE_MAX_ROWS)
    expect(rows[rows.length - 1]!.id).toBe(`m${CHAT_CACHE_MAX_ROWS + 19}`)
  })

  it('猜出来的卡不入缓存（下次会内容对不上）', () => {
    saveChatCache('s1', [row('a'), row('b', { guessed: true })])
    expect(loadChatCache('s1').map(entry => entry.id)).toEqual(['a'])
  })

  it('超过 7 天不再恢复，并把过期键清掉', () => {
    const now = 1_700_000_000_000
    saveChatCache('s1', [row('a')], now)
    expect(loadChatCache('s1', now + CHAT_CACHE_TTL_MS + 1)).toEqual([])
    expect(localStorage.getItem('dsh-palm.chat-cache.v1.s1')).toBeNull()
  })

  it('坏数据不渲染（结构不对整条丢掉，不抛异常）', () => {
    localStorage.setItem('dsh-palm.chat-cache.v1.s1', '{"at":' + Date.now() + ',"rows":[{"id":"ok","kind":"assistant"},{"id":42},{"nope":true}]}')
    expect(loadChatCache('s1').map(entry => entry.id)).toEqual(['ok'])
    localStorage.setItem('dsh-palm.chat-cache.v1.s2', 'not json')
    expect(loadChatCache('s2')).toEqual([])
  })

  it('只保留最近访问的若干个会话（LRU）', () => {
    for (let i = 0; i < 12; i += 1) saveChatCache(`s${i}`, [row(`a${i}`)], 1_700_000_000_000 + i)
    expect(loadChatCache('s0', 1_700_000_000_500)).toEqual([])
    expect(loadChatCache('s11', 1_700_000_000_500).map(entry => entry.id)).toEqual(['a11'])
  })

  it('删会话/清缓存能把键清干净', () => {
    saveChatCache('s1', [row('a')])
    saveChatCache('s2', [row('b')])
    dropChatCache('s1')
    expect(loadChatCache('s1')).toEqual([])
    expect(loadChatCache('s2')).toHaveLength(1)
    dropAllChatCaches()
    expect(loadChatCache('s2')).toEqual([])
  })

  it('没有 localStorage 时安静降级（不抛）', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })
    expect(() => saveChatCache('s1', [row('a')])).not.toThrow()
    expect(loadChatCache('s1')).toEqual([])
  })
})
