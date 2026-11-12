/**
 * 子代理详情的数据层：把一个子会话的渲染行折成「过程 + 输出」。
 *
 * 背景（2026-11-11）：子代理在 DSH 里**本身就是一个会话**——
 * `SubagentListEntry.id` 的类型就是 `SessionId`（api-proxy-types.ts）。所以
 * 「点进去看内容」不需要另造一套执行树，直接打开那个子会话读它的尾部一页即可：
 * 读消息的通道（`loadChatPage`）、折叠、渲染全都是现成的。
 *
 * 这一层只做「把行压成手机屏能看的几步」，不碰 React、不 import render/ui
 * （用结构化的最小输入，保持成环检查干净）。
 *
 * @module dsh-palm/mobile/session/subagent-detail
 */
import { loadChatPage } from '../data/chat-page.ts'

/** 一步：它调了一个工具，或者写了一段话。 */
export interface SubagentStep {
  /** `tool`：一次工具调用；`text`：一段正文/结论。 */
  kind: 'tool' | 'text'
  /** 工具名（`bash` / `web_search` …）；文本步为空串。 */
  name: string
  /** 一行摘要：命令、URL、查询词或正文开头。 */
  detail: string
  /** 事件时间（epoch ms），宿主没给就不画。 */
  at?: number
}

/** 详情页要的全部数据。 */
export interface SubagentDigest {
  /** 按时间正序的步骤（尾部最多 {@link MAX_STEPS} 条）。 */
  steps: SubagentStep[]
  /** 最后一条正文（结论）；还没有输出时为空串。 */
  output: string
  /** 最近一步（折叠态也要显示「它现在在干什么」）。 */
  lastStep?: SubagentStep
  /** 工具调用总数（不受步骤上限影响）。 */
  toolCount: number
}

/** 步骤上限：手机上一次翻不完的长链没有意义，保留最近的。 */
export const MAX_STEPS = 40

/** 一步摘要最多这么长（一行放不下就省略号，别把卡片撑开）。 */
export const STEP_DETAIL_MAX = 96

/**
 * 摘要里最值得看的那一段参数。
 *
 * 不同工具的参数名不一样，按常见优先级取第一个字符串：
 * 命令 → 查询词 → URL → 路径 → 正则 → 提示词 → 描述。取不到就整串截断。
 */
const DETAIL_KEYS = ['command', 'query', 'url', 'path', 'pattern', 'prompt', 'description', 'file_path'] as const

/**
 * 从工具参数 JSON 里挖出一行能读的摘要。
 *
 * @param raw - 原始参数串（可能不是 JSON，也可能是空）
 * @returns 截断后的摘要；没有可用信息时返回空串
 */
export function toolDetail(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === '') return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return clip(raw)
  }
  if (typeof parsed !== 'object' || parsed === null) return clip(String(parsed))
  const record = parsed as Record<string, unknown>
  for (const key of DETAIL_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return clip(value)
  }
  return clip(raw)
}

/** 截到 {@link STEP_DETAIL_MAX}，超出的用省略号收尾。 */
function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length <= STEP_DETAIL_MAX ? oneLine : `${oneLine.slice(0, STEP_DETAIL_MAX - 1)}…`
}

/**
 * 摘要用的最小行结构：只声明这里真正读到的字段。
 *
 * 故意不 import `render/messages.ts` 的类型——那一层是视图侧，session 反向
 * 依赖它会让分层图多出一条边（`architecture-graph.test.ts` 盯着）。
 */
export interface DigestRow {
  kind: string
  text: string
  time?: number
  flow?: readonly { kind: string; text?: string; callId?: string }[]
  tools?: readonly { callId: string; name: string; arguments?: string }[]
}

/**
 * 把一页渲染行压成「过程 + 输出」。
 *
 * 规则（都来自真机观感）：
 * - 工具调用按 `tools[]` 给出，参数摘要用 {@link toolDetail}；
 * - 正文段只留**最后一条**（结论），中间的过程叙述不再重复一遍——过程那一栏已经够长；
 * - 步骤按时间正序，只留尾部 {@link MAX_STEPS} 条。
 *
 * @param rows - 子会话的渲染行（`loadChatPage` 的 `rows`）
 * @returns 详情页数据
 */
export function digestRows(rows: readonly DigestRow[]): SubagentDigest {
  const steps: SubagentStep[] = []
  let toolCount = 0
  let output = ''
  for (const row of rows) {
    for (const tool of row.tools ?? []) {
      toolCount += 1
      steps.push({
        kind: 'tool',
        name: tool.name,
        detail: toolDetail(tool.arguments),
        ...(row.time === undefined ? {} : { at: row.time }),
      })
    }
    if (row.kind === 'assistant' && row.text.trim() !== '') output = row.text.trim()
  }
  const tail = steps.length > MAX_STEPS ? steps.slice(steps.length - MAX_STEPS) : steps
  return {
    steps: tail,
    output,
    ...(tail.length === 0 ? {} : { lastStep: tail[tail.length - 1] }),
    toolCount,
  }
}

/** 尾部取多少行：够覆盖最近几十步，又不至于把大会话整篇读一遍。 */
export const SUBAGENT_TAIL_ROWS = 60

/**
 * 打开一个子会话并摘要。
 *
 * @param sessionId - 子代理的会话 id（`SubagentFlatNode.id`）
 * @param signal - 取消信号（离开页面即中止）
 * @returns 详情页数据
 */
export async function loadSubagentDetail(sessionId: string, signal?: AbortSignal): Promise<SubagentDigest> {
  const page = await loadChatPage(sessionId, undefined, signal, undefined, undefined, SUBAGENT_TAIL_ROWS)
  return digestRows(page.rows)
}
