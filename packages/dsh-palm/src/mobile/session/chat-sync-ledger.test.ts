/**
 * 切会话账本的契约（2026-11-14）：**只有"同步过且之后没有新帧"才允许跳过网络重取**。
 *
 * 这条判据很便宜，但错的代价是"看到旧内容"，所以三条保守约束逐条钉住：
 * 帧一来就作废、超时就作废、跨页面生命周期不存在（内存态）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  SYNC_TRUST_MS,
  canSkipEntryRead,
  noteChatFrame,
  noteChatSynced,
  resetChatSyncLedger,
} from './chat-sync-ledger.ts'

afterEach(() => { resetChatSyncLedger() })

describe('chat-sync-ledger', () => {
  it('没同步过就一定要问宿主', () => {
    expect(canSkipEntryRead('s1', 1_000)).toBe(false)
  })

  it('同步过、之后没有帧 → 可以直接用本地那份', () => {
    noteChatSynced('s1', 1_000)
    expect(canSkipEntryRead('s1', 1_500)).toBe(true)
  })

  it('只要来过一帧就作废（内容可能已经变了）', () => {
    noteChatSynced('s1', 1_000)
    noteChatFrame('s1')
    expect(canSkipEntryRead('s1', 1_500)).toBe(false)
  })

  it('别的会话的帧不影响这一场', () => {
    noteChatSynced('s1', 1_000)
    noteChatFrame('s2')
    expect(canSkipEntryRead('s1', 1_500)).toBe(true)
  })

  it('超过信任窗口重新问（不信任"很久以前同步过"）', () => {
    noteChatSynced('s1', 1_000)
    expect(canSkipEntryRead('s1', 1_000 + SYNC_TRUST_MS + 1)).toBe(false)
  })

  it('再次同步会把帧计数清零（新的一份是新的基线）', () => {
    noteChatSynced('s1', 1_000)
    noteChatFrame('s1')
    noteChatSynced('s1', 2_000)
    expect(canSkipEntryRead('s1', 2_100)).toBe(true)
  })

  it('空会话 id 一律不跳过（不能拿错场的行）', () => {
    noteChatSynced('', 1_000)
    expect(canSkipEntryRead('', 1_100)).toBe(false)
  })

  it('满了之后淘汰最旧的一场，不无限增长', () => {
    for (let index = 0; index < 40; index += 1) noteChatSynced(`s${String(index)}`, 1_000)
    expect(canSkipEntryRead('s39', 1_100)).toBe(true)
    expect(canSkipEntryRead('s0', 1_100)).toBe(false)
  })
})
