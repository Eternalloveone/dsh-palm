/**
 * 帧台账：把「最近到底收到了哪些实时帧」留在内存里，出问题时一次 dump 出因果链。
 *
 * 为什么要有它（2026-11-15，用户当面指出）：前两轮我拿「能造成这个现象」当成了
 * 「就是这个原因」，加了三层防守，但没有一条证据能回答**这一次**到底断在哪一环。
 * 台账不猜任何原因，只记事实：这一段时间里这台手机收到了哪些帧、属于哪个会话、
 * 折叠到哪条 seq。dump 出来以后判据只有两条：
 *
 * - 台账里**有**那条 `user/message` / `assistant/*`（说明帧到了）→ 问题在渲染层；
 * - 台账里**没有**（说明帧没到）→ 问题在链路层（宿主过滤/断流/闸门），与渲染无关。
 *
 * 环长 {@link LEDGER_MAX}：够覆盖一次发送 + 一整轮回复的帧量，又小到能塞进一次上报。
 *
 * @module dsh-palm/mobile/views/chat/state/frame-ledger
 */

/** 台账里一条帧：只留能解释"内容为什么没出现"的字段。 */
export interface LedgerFrame {
  /** 收到时刻（本机毫秒）。 */
  t: number
  /** 帧类型（`session/event`、`session/projection`…）。 */
  type: string
  /** 帧所属会话（控制帧没有）。 */
  sessionId?: string
  /** `session/event` 的事件类型（`user/message`、`assistant/chunk`…）。 */
  eventType?: string
  /** 事件序号：判"缺口"用的就是它。 */
  seq?: number
}

/** 环长：一次发送 + 一轮回复的帧量（约 20~80 条），取 160 留余量。 */
export const LEDGER_MAX = 160

const frames: LedgerFrame[] = []
/** 环满后被挤掉的条数（说明这一段比环还长，读数要打折）。 */
let rotated = 0
let since = 0

/**
 * 记一条帧（帧分发器每帧调一次，只做一次数组 push/shift）。
 * @param frame - 原始 mux 帧（只读 type/sessionId/event 里的三样东西）
 */
export function recordFrame(frame: unknown): void {
  const typed = frame as {
    type?: unknown
    sessionId?: unknown
    event?: { type?: unknown; seq?: unknown }
  }
  const type = typeof typed.type === 'string' ? typed.type : ''
  if (type === '') return
  if (since === 0) since = Date.now()
  const entry: LedgerFrame = { t: Date.now(), type }
  if (typeof typed.sessionId === 'string') entry.sessionId = typed.sessionId
  const eventType = typed.event?.type
  if (typeof eventType === 'string') entry.eventType = eventType
  const seq = typed.event?.seq
  if (typeof seq === 'number') entry.seq = seq
  frames.push(entry)
  if (frames.length > LEDGER_MAX) {
    frames.shift()
    rotated += 1
  }
}

/** 当前台账（快照，调用方随便序列化）。 */
export function ledgerSnapshot(): {
  since: number
  rotated: number
  frames: readonly LedgerFrame[]
} {
  return { since, rotated, frames: [...frames] }
}

/** 换会话/重进时清空（否则上一次会话的帧会混进这一场的因果链）。 */
export function resetFrameLedger(): void {
  frames.length = 0
  rotated = 0
  since = 0
}
