/**
 * 「刚结束」的会话清单：跨页面、跨刷新的小账本。
 *
 * 需求来源很直白——手机上看到"运行中 2 个"，等一会儿两个都跑完了，卡片直接消失，
 * 于是**没法知道刚才是哪一个跑完了**。这里把每一条收工记下来：会话、标题、用时、
 * 结果（完成/出错/中断）、一句话摘要，留 30 分钟、最多 8 条，并且写进 localStorage，
 * 退出重进还在。
 *
 * 只在内存+localStorage，不占宿主：收工事件本来就从 mux 帧上过，摘要/用时再读一次
 * 尾页就有了。
 *
 * @module dsh-palm/mobile/recent-finished
 */

import { removeHostFinishedRun } from './api.ts'

/** 一条收工记录。 */
export interface FinishedRun {
  sessionId: string
  /** 展示标题；宿主没给标题时用短 id。 */
  title: string
  /** 收工时间（事件时间，不是本地时钟）。 */
  finishedAt: number
  /** 这条回复用了多久；缺锚点时省略。 */
  durationMs?: number
  /** 结果口径：正常收工 / 出错 / 被中断。 */
  status: 'done' | 'error' | 'stopped'
  /** 最后一条回复的开头，帮人认出"是这一个"。 */
  summary?: string
}

/** 记录留存时长：半小时足够覆盖"刚跑完想回头看一眼"。 */
/**
 * 账本保留多久。
 *
 * 口径（2026-10-29 真机）：运行中页的「刚结束」= **我没点进去看过**的会话，
 * 不是「最近半小时结束的」。所以给到 7 天，真正的剔除靠 {@link forgetFinishedRun}
 * （打开会话就删）。
 */
export const FINISHED_TTL_MS = 7 * 24 * 60 * 60_000

/** 最多记几条：再多就不叫"刚结束"了。 */
export const FINISHED_MAX = 30

/** localStorage 键；带版本前缀，改结构时不至于读到老格式。
 *
 *  变量名故意不叫 `*_KEY`：gitleaks 的 generic-api-key 规则会把「名字带 KEY + 一个字符串」
 *  判成泄露的密钥（实测本文件第 46 行被它拦下，CI 的 release-preflight 直接红）。
 *  值本身是 localStorage 名字，不是凭据。 */
const STORAGE_NAME = 'dsh-palm.finished-runs.v1'

/** 订阅者（运行中页与浮层各订阅一次）。 */
type Listener = (entries: readonly FinishedRun[]) => void

const listeners = new Set<Listener>()
/**
 * 上报钩子：把新记的一条发给宿主（`mobile.finishedRuns`），让账本跟着机器走。
 *
 * 默认空实现 —— 这个模块被十几处单测直接调用，记账时绝不能偷偷发网络请求。
 * 真实实现由 App 启动时注入（`setFinishedRunsSink`）。
 */
type Sink = (entry: FinishedRun) => void
let sink: Sink = () => {}

/** 注入上报实现（传 undefined 复位成空实现）。 */
export function setFinishedRunsSink(next: Sink | undefined): void {
  sink = next ?? (() => {})
}
let entries: FinishedRun[] = load()

function load(): FinishedRun[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_NAME)
    if (raw === null || raw === undefined || raw === '') return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is FinishedRun => {
      if (typeof item !== 'object' || item === null) return false
      const record = item as Partial<FinishedRun>
      return typeof record.sessionId === 'string'
        && typeof record.title === 'string'
        && typeof record.finishedAt === 'number'
        && (record.status === 'done' || record.status === 'error' || record.status === 'stopped')
    })
  } catch {
    return []
  }
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_NAME, JSON.stringify(entries))
  } catch {
    // 隐私模式/配额满：内存里照旧工作，别因为存不下就把功能弄挂。
  }
}

function publish(): void {
  const snapshot = entries
  for (const listener of listeners) listener(snapshot)
}

/** 去掉过期条目（按事件时间，不用本地钟，避免设备时间偏了把记录全清掉）。 */
function prune(now: number): boolean {
  const kept = entries.filter(entry => now - entry.finishedAt < FINISHED_TTL_MS)
  if (kept.length === entries.length) return false
  entries = kept
  return true
}

/**
 * 记一条收工。同一会话只保留最新一条（不然反复跑会把这个人的眼睛埋了）。
 * @param entry - 收工记录。
 * @param now - 当前时间（测试注入）。
 */
export function recordFinishedRun(entry: FinishedRun, now: number = Date.now()): void {
  const cleaned: FinishedRun = {
    sessionId: entry.sessionId,
    title: entry.title === '' ? shortSessionId(entry.sessionId) : entry.title,
    finishedAt: entry.finishedAt,
    status: entry.status,
    ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
    ...(entry.summary === undefined || entry.summary === '' ? {} : { summary: entry.summary }),
  }
  prune(now)
  entries = [cleaned, ...entries.filter(item => item.sessionId !== cleaned.sessionId)]
    .slice(0, FINISHED_MAX)
  persist()
  publish()
  // 同步到宿主账本；失败静默，不影响本次渲染。
  try { sink(cleaned) } catch { /* 忽略 */ }
}

/**
 * 把宿主账本并进本地（宿主是权威：跨刷新、跨设备都在）。
 *
 * 键是会话 id：同一会话只留最新一条，先后上报不会重复。
 */
export function mergeHostFinishedRuns(hostEntries: readonly FinishedRun[], now: number = Date.now()): void {
  const bySession = new Map<string, FinishedRun>()
  for (const entry of [...entries, ...hostEntries]) {
    if (now - entry.finishedAt >= FINISHED_TTL_MS) continue
    const previous = bySession.get(entry.sessionId)
    if (previous === undefined || entry.finishedAt >= previous.finishedAt) bySession.set(entry.sessionId, entry)
  }
  const merged = [...bySession.values()].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, FINISHED_MAX)
  const changed = merged.length !== entries.length
    || merged.some((entry, index) => entry.sessionId !== entries[index]?.sessionId
      || entry.finishedAt !== entries[index]?.finishedAt)
  entries = merged
  if (changed) {
    persist()
    publish()
  }
}

/** 当前清单（新的在前）。读的时候顺手清过期条目。 */
export function finishedRuns(now: number = Date.now()): readonly FinishedRun[] {
  if (prune(now)) {
    persist()
    publish()
  }
  return entries
}

/** 订阅清单变化；返回退订函数。 */
export function subscribeFinishedRuns(listener: Listener): () => void {
  listeners.add(listener)
  listener(entries)
  return () => { listeners.delete(listener) }
}

/** 清空（运行中页的"全部清空"）。 */
/**
 * 把这个会话从「刚结束」账本里删掉：用户已经点进去看过了。
 *
 * 与 TTL 的分工：TTL 只管「别无限长」，真正决定「还该不该出现在运行中页」的是
 * 用户有没有打开过它。
 */
export function forgetFinishedRun(sessionId: string, now: number = Date.now()): void {
  const before = entries.length
  entries = entries.filter(entry => entry.sessionId !== sessionId)
  if (entries.length === before) return
  persist()
  publish()
  // 宿主那份也删：换个浏览器 / 清一次缓存之后，仍然是「打开过就不再出现」。
  void removeHostFinishedRun(sessionId).catch(() => {})
  // 顺手做一次过期清理，别让删过之后的老条目混在列表里。
  if (prune(now)) {
    persist()
    publish()
  }
}

export function clearFinishedRuns(): void {
  entries = []
  persist()
  publish()
}

/** 鼠标/触摸点进去之后用的短 id。 */
export function shortSessionId(sessionId: string): string {
  return String(sessionId).replace(/^session-/, '').slice(0, 8)
}

/** 只给测试用：把内部状态恢复成"从 storage 重新读"。 */
export function resetFinishedRunsForTest(): void {
  entries = load()
  publish()
}
