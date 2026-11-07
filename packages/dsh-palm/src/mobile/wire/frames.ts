/**
 * 帧的**入口守卫**（W4-1）：把线上收到的一坨 JSON 变成「认得的帧」或 `undefined`。
 *
 * 为什么要有这一层：传输层（SSE / 轮询回填）拿到的永远是 `unknown`。现在每个消费点
 * 各自 `as MuxFrame` 硬转，转错了不报错、只是某个字段是 `undefined`，最后表现为
 * 「这个功能在我手机上就是不出现」。这一层只做**能统一做的那部分校验**：
 * discriminant 是不是字符串、认不认识；字段的领域校验仍归各消费点。
 *
 * 不认识 = 静默丢弃。服务端加帧是常态，忽略是唯一的前向兼容做法；把整条连接判成
 * 断流才是真事故。
 *
 * @module dsh-palm/mobile/wire/frames
 */
import type { MuxFrame } from '../../api-proxy-types.ts'
import { isKnownFrame } from './version.ts'

/**
 * 读一帧。
 *
 * @param raw - 传输层解出来的任意值
 * @returns 认出来就是帧对象；不是对象、没有 type、type 不认识都返回 `undefined`
 */
export function readFrame(raw: unknown): MuxFrame | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const type = (raw as { type?: unknown }).type
  if (typeof type !== 'string' || !isKnownFrame(type)) return undefined
  return raw as MuxFrame
}

/** 这一帧属于哪个会话（没有 `sessionId` 的帧返回 `undefined`）。 */
export function frameSessionId(frame: MuxFrame): string | undefined {
  const sessionId = (frame as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
}

/**
 * 帧的**形状指纹**：只取顶层字段名，按字典序。
 *
 * 用途是 golden 快照：字段改名/增删会在快照 diff 里出现，而不是等到某个视图
 * 少显示一行才被发现。
 */
export function frameShape(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) return []
  return Object.keys(raw as Record<string, unknown>).sort()
}
