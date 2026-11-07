/**
 * **Wire 契约版本与能力位**（W4-1 / W4-6）。
 *
 * 病灶：手机端与宿主之间没有任何版本协商。新增一帧、改一个字段，老客户端收到就是
 * 「不认识的帧 → 静默丢弃」，表现为「这个功能在我手机上就是不出现」，而两端日志都干净。
 *
 * 这里给三样东西：
 * 1. `WIRE_VERSION` —— 协议版本号（帧集合发生**不兼容**变化时才加一）；
 * 2. `WIRE_FRAME_TYPES` —— 全部帧的 discriminant，**编译期穷尽校验**（见文件末尾）；
 * 3. `WIRE_CAPABILITIES` —— 可独立开关的能力位，用于"能降级就别报错"。
 *
 * @module dsh-palm/mobile/wire/version
 */
import type { MuxFrame } from '../../api-proxy-types.ts'

/** 协议版本。帧集合发生不兼容变化（删帧、改字段语义）时加一。 */
export const WIRE_VERSION = 1

/**
 * 能力位：**加帧不必改版本号**，客户端问"支持吗"，不支持就走降级路径。
 *
 * 版本号是"整体兼容性"，能力位是"某个功能有没有"。混用会变成：为了一帧心跳把
 * 版本号加一，于是所有老客户端都被判成不兼容——那是比没有版本更糟的结果。
 */
export const WIRE_CAPABILITIES = {
  /** 会话列表实时帧（session/added、session/removed、session/activity）。 */
  liveSessionList: 'live-session-list',
  /** 轮次边界推断帧（session/turn-boundary，独立于总线判据）。 */
  turnBoundaryFrames: 'turn-boundary-frames',
  /** 工具风险等级（approval/requested 的 risk 字段）。 */
  toolRisk: 'tool-risk',
  /** 目标激活状态帧（goal/activation）。 */
  goalActivation: 'goal-activation',
  /** 传输层保活帧（真帧，不是 SSE 注释行）。 */
  heartbeatFrames: 'heartbeat-frames',
} as const

/** 某一个能力位的名字。 */
export type WireCapability = (typeof WIRE_CAPABILITIES)[keyof typeof WIRE_CAPABILITIES]

/**
 * 全部帧的 discriminant。
 *
 * 这份列表**必须与 `MuxFrame` 完全一致**：文件末尾有编译期穷尽校验，少写或多写都会
 * 让 `pnpm typecheck` / `pnpm build` 失败（不是运行时才炸）。
 */
export const WIRE_FRAME_TYPES = [
  'session/event',
  'session/subscribed',
  'approval/requested',
  'approval/resolved',
  'question/requested',
  'question/resolved',
  'session/queue',
  'session/jobs',
  'session/projection',
  'goal/activation',
  'session/added',
  'session/removed',
  'session/status',
  'session/turn-boundary',
  'session/activity',
  'session/error',
  'mux/ping',
  'stream/error',
] as const

/** 帧的 discriminant 类型。 */
export type WireFrameType = (typeof WIRE_FRAME_TYPES)[number]

/**
 * 这一帧是不是不认识。
 *
 * 老客户端收到新帧必须**静默忽略**（不能抛、不能整条连接作废）：服务端加帧是常态，
 * 忽略是唯一前向兼容的做法。反过来，客户端收到不认识的心跳也不能当成断流。
 */
export function isKnownFrame(type: string): type is WireFrameType {
  return (WIRE_FRAME_TYPES as readonly string[]).includes(type)
}

// ---- 编译期穷尽校验 ----------------------------------------------------------
// 少写一个：MuxFrame 里有、列表里没有 → MissingFromList 不是 never → 类型不成立。
// 多写一个：列表里有、MuxFrame 里没有 → ExtraInList 不是 never → 类型不成立。
type MissingFromList = Exclude<MuxFrame['type'], WireFrameType>
type ExtraInList = Exclude<WireFrameType, MuxFrame['type']>
type Assert<T extends true> = T
/** 契约里有、列表里没写：宿主加一个新帧，手机端必须来登记。 */
export type NoFrameMissingFromList = Assert<MissingFromList extends never ? true : false>
/** 列表里写了、契约里没有：删帧时必须同步删登记。 */
export type NoExtraFrameInList = Assert<ExtraInList extends never ? true : false>
