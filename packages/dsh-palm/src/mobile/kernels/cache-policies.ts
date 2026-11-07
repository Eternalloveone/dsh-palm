/**
 * Cache 策略表（W4-5）：所有缓存的寿命/容量写在一处。
 *
 * 为什么要一张表：这些数字原本散在四个模块的常量里（7 天 / 5 分钟 / 10 分钟 / 80 行 /
 * 220 KB / 10 个会话…），谁也说不清"为什么是这个数"，改一个也看不出影响了谁。
 * 集中之后至少能一眼看出：**短命的都是"状态类"（会误导人），长命的都是"正文类"**。
 *
 * @module dsh-palm/mobile/kernels/cache-policies
 */
import type { CachePolicy } from './cache.ts'

/** 一份缓存的完整策略：内核参数 + 落盘版本号。 */
export interface CacheSpec extends CachePolicy {
  /** 落盘版本：不匹配整份作废（见 `wrapCache`/`unwrapCache`）。 */
  readonly version: number
  /** 给人看的说明：这个数字为什么是这个数字。 */
  readonly why: string
}

/**
 * 全部缓存策略。
 *
 * 寿命长短的取舍：
 * - **状态类**（运行中、轮次大纲）短：显示过期的"正在跑"比空着更误导。
 * - **正文类**（聊天正文）长：它只是"上次看到的画面"，旧一点也比白屏强。
 */
export const CACHE_POLICIES = {
  /** 聊天页正文：最后一屏，7 天，80 行 / 220 KB / 10 个会话。 */
  chatBody: {
    version: 1,
    ttlMs: 7 * 24 * 60 * 60_000,
    maxEntries: 10,
    maxBytes: 220_000,
    why: '正文是"上次看到的画面"，旧一点也比白屏强；但条数与字节要压住，否则把 localStorage 塞满会连累草稿等关键键',
  },
  /** 轮次大纲：5 分钟 / 8 个会话。 */
  turnOutline: {
    version: 1,
    ttlMs: 5 * 60_000,
    maxEntries: 8,
    why: '大纲描述的是"宿主当前有哪些轮"，过期了会列出已经不存在的轮；它体积不小（几十 KB/会话）',
  },
  /** 运行总览首屏：10 分钟 / 1 份。 */
  runOverview: {
    version: 1,
    ttlMs: 10 * 60_000,
    maxEntries: 1,
    why: '过期的"正在跑"比空着更误导；它只是一屏快照，留一份就够',
  },
  /** 历史页落盘（IndexedDB）：24 小时 / 50 个会话 / 页形状 v2。 */
  historyArchive: {
    version: 2,
    ttlMs: 24 * 60 * 60_000,
    maxEntries: 50,
    why:
      '落盘页只当启动脚手架，几秒内就被网络刷新替换，过期行不会久留；' +
      'v1→v2 是因为行身份改按 rowIdentity（轮/步）判定，旧页在新折叠口径下会出错行',
  },
  /** 历史页预取：只留最近几页，不按时间过期（翻页本身就有时效性）。 */
  pagePrefetch: {
    version: 1,
    maxEntries: 4,
    why: '预取只为"下一次点击不用等"，留 4 页足够来回切；它不落盘，没必要比时间',
  },
} as const satisfies Record<string, CacheSpec>

/** 策略表里的名字。 */
export type CacheName = keyof typeof CACHE_POLICIES
