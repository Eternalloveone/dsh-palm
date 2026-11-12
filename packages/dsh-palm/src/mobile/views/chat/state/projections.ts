// @vitest-environment node
/**
 * 会话投影的解析边界（2026-11-10）。
 *
 * 背景：`ChatView` 里有四个地方各自把 `page.projections.values` 强转成
 * `Record<string, unknown>`，再各自 `parsePermissionSelect` / `parseContextPressure` /
 * 直接塞 turnOutline / inbox。四个地方对"键缺失"的处理还不一样（权威页只覆盖**真的
 * 带了**的键，首屏基线整块覆盖）。投影再多一个键，就要在这四处同时记得加 —— 这就是
 * 视图层越过了数据边界在"解释宿主协议"。
 *
 * 这里收成一个边界：一份解析、一个"哪些键真的出现过"的答案。视图只做 `if (present.has(k))`。
 */
import { parsePermissionSelect, type PermissionSelectValue } from '../../../components/sheets.tsx'
import { readChat } from '../../../data/session.ts'
import { parseContextPressure, type ContextPressureData } from './frame-effects.ts'

/** 投影块里目前会被视图消费的四个键。 */
export interface ChatProjectionFacts {
  permissions?: PermissionSelectValue
  contextPressure?: ContextPressureData
  turnOutline?: unknown
  inbox?: unknown
}

/** 投影键名。 */
export type ProjectionKey = keyof ChatProjectionFacts

/**
 * 解析后的投影：值 + "宿主真的给了哪些键"。
 *
 * `present` 存在的理由：权威页只该覆盖它带来的那几个键（没带的键不许把已有基线抹掉），
 * 而首屏基线是整块覆盖。两者都要能区分"没说"与"说了是空"。
 */
export interface ParsedProjections extends ChatProjectionFacts {
  present: ReadonlySet<ProjectionKey>
}

/**
 * 取出一页响应里的投影原始表。
 *
 * @param page - 宿主返回的会话页（可能没有投影块）
 * @returns 原始键值表；没有投影或形状不对时 `undefined`
 */
export function projectionValues(page: { projections?: { values?: unknown } } | undefined): Record<string, unknown> | undefined {
  const values = page?.projections?.values
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return undefined
  return values as Record<string, unknown>
}

/**
 * 把原始投影表解析成视图事实。
 *
 * @param values - `projectionValues` 的结果
 * @returns 解析值 + 出现过的键集合（永不抛错，坏数据当没给）
 */
export function parseProjections(values: Record<string, unknown> | undefined): ParsedProjections {
  const present = new Set<ProjectionKey>()
  const facts: ParsedProjections = { present }
  if (values === undefined) return facts
  if (values['permissions'] !== undefined) {
    present.add('permissions')
    facts.permissions = parsePermissionSelect(values['permissions'])
  }
  if (values['contextPressure'] !== undefined) {
    present.add('contextPressure')
    facts.contextPressure = parseContextPressure(values['contextPressure'])
  }
  if (values['turnOutline'] !== undefined) {
    present.add('turnOutline')
    facts.turnOutline = values['turnOutline']
  }
  if (values['inbox'] !== undefined) {
    present.add('inbox')
    facts.inbox = values['inbox']
  }
  return facts
}

/**
 * 就地补拉一页投影（首屏快速通道/深链进来时宿主还没跑过会话枚举，手机没有基线）。
 *
 * 读失败的语义留给调用方：这里只把失败原样抛回去，不在数据边界里决定"要不要弹错"。
 *
 * @param sessionId - 会话 id
 * @returns 解析后的投影
 */
export async function pullProjections(sessionId: string): Promise<ParsedProjections> {
  const page = await readChat(sessionId)
  return parseProjections(projectionValues(page))
}
