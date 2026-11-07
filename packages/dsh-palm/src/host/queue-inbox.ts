/**
 * **host · 队列与 inbox 投影域**（W5-1：从 `mobile-api.ts` 抽出的第五个域）。
 *
 * 手机上看到的"排队中/可插话"那一列，是宿主 inbox 的**投影**。这块最麻烦的地方是**身份**：
 * 宿主队列行不回显客户端传的 `requestId`（只有 id/placement/text/editable），正文一被改写
 * （带图片变 `[图片] …`、引用块、折行压缩）就只能靠猜——猜错的后果是屏幕上留下两条一模
 * 一样的排队条。所以在插件侧把身份接上：记下投递前后队列的差异，新出现的 id 就是这次投递。
 *
 * 两处模块级状态（`queueRevisions`、`requestIdsByMessageId`）**与它们的唯一修改者同居**，
 * 所以不需要访问器——外部只能通过导出函数读写。
 *
 * @module dsh-palm/host/queue-inbox
 */
import type { ApiProxy } from '../api-proxy-types'
import type { AgentLookup } from './commands-goals.ts'

const queueRevisions = new Map<string, number>()

export function queueRevisionOf(sessionId: string): number {
  return queueRevisions.get(sessionId) ?? 0
}

export function bumpQueueRevision(sessionId: string): void {
  queueRevisions.set(sessionId, queueRevisionOf(sessionId) + 1)
}

/**
 * 队列**内容指纹**：任何来源的改动都会让它变。
 *
 * `queueRevision` 只有手机端自己的写操作会 +1 —— 桌面端排一条消息时它不变，而手机端
 * 按「版本没变 = 队列没变」处理，于是**桌面排的消息手机永远看不到**（2026-10-30 真机，
 * 已用「另一客户端入队 + 手机采样」复现：宿主 queue=1，手机 25 秒无排队条）。
 *
 * 这里再给一个从队列内容算出来的指纹（id + 正文长度），手机端用它判"权威队列变了没"：
 * 谁改的都算。两个数各司其职：
 *   - `queueRevision`：只回答「我那次写操作落地了吗」（乐观项退场用）；
 *   - `queueToken`：只回答「权威队列本身变了没」（任何客户端）。
 */
/**
 * 投递身份桥：`requestId`（客户端生成）→ 宿主队列条目 id。
 *
 * 宿主队列行**不会**回显我们传的 `requestId`（实测：行里只有 id/placement/text/editable），
 * 于是客户端只能靠正文或"有没有新条目"去猜自己那次投递落到哪一行 —— 正文被改写
 * （带图片变 `[图片] …`、引用块、折行压缩）时就会猜错，屏幕上留下两条一模一样的排队条。
 *
 * 这里在插件侧把身份接上：处理 `session.prompt` 时记下投递前后队列的差异，新出现的那个
 * id 就是这次投递的宿主 id。之后 `queueItemsOf` 反过来给每一行标上 `requestId`，
 * 手机端就能按**身份**退场，彻底不依赖正文。
 */
const requestIdsByMessageId = new Map<string, string>()

/** 记一条对应关系（同一 id 重复写无害）。 */
export function rememberRequestBody(pairs: ReadonlyArray<readonly [string, string]>): void {
  for (const [requestId, messageId] of pairs) {
    if (requestId === '' || messageId === '') continue
    requestIdsByMessageId.set(messageId, requestId)
  }
}

/** 宿主条目 id → 客户端 `requestId`（没有就是 undefined）。 */
export function requestIdOfMessage(messageId: string): string | undefined {
  return requestIdsByMessageId.get(messageId)
}

export function queueTokenOf(items: readonly { id: string; text: string }[]): string {
  return items.map(item => `${item.id}:${item.text.length}`).join('|')
}

/**
 * 队列投影读取（`mobile.inbox` 与 `mobile.sessionState` 共用）。
 *
 * 花名册快照是几分钟前枚举的：删除/编辑之后还拿它就会把已经删掉的行又画回来，看起来
 * 就像"删不掉"。所以改完队列的那一次（客户端带 fresh）现开一帧 follow 取当下投影；
 * 平时（回合跑着时每几秒一问）只读快照 —— 每次都读一页 history 会跟同会话的聊天读
 * 抢宿主，弱网下卡片反而更慢。
 */
/**
 * 从**活的 agent** 上直读待发队列（权威来源）。
 *
 * DSH 0.2.x 的权威数据在 `ctx.agents.get(sessionId).inbox`：
 *   - `nextTurn`: 等下一轮开跑的排队消息
 *   - `nextStep`: 已经插进**正在跑的这一轮**、等下一步边界消费的消息
 * 宿主自己处理队列命令时读的就是它（见 @deepseek-ai/dsh-session-controller 的
 * `agent.inbox.nextTurn.find(...)`）。
 *
 * 为什么不能只读投影快照：`inbox` 投影是从**持久 splice** 重建的，而花名册那份快照
 * 只在枚举会话时刷新 —— 消息被认领成这一轮的用户消息之后，快照里那条还会挂一阵子。
 * 实测（2026-10-30）：对话里已经出现该用户气泡，`mobile.sessionState` 仍回 `queue=1`，
 * 于是手机端排队条一直挂着。
 *
 * 活的 agent 上读到的就是当下真值：认领那一刻它就没了。形状按 `queueItemsOf` 吃过的
 * `{ 'next-turn': [...] }` 返回，调用方不需要分支。
 */
export function liveInboxOf(agents: AgentLookup | undefined, sessionId: string): { 'next-turn': readonly unknown[]; 'next-step': readonly unknown[] } | undefined {
  if (agents === undefined) return undefined
  let agent: unknown
  try {
    agent = agents.get(sessionId)
  } catch {
    return undefined
  }
  if (agent === null || agent === undefined || typeof agent !== 'object') return undefined
  const inbox = (agent as { inbox?: unknown }).inbox
  if (inbox === null || inbox === undefined || typeof inbox !== 'object') return undefined
  const source = inbox as { nextTurn?: unknown; 'next-turn'?: unknown; nextStep?: unknown; 'next-step'?: unknown }
  const nextTurn = source.nextTurn ?? source['next-turn']
  const nextStep = source.nextStep ?? source['next-step']
  if (!Array.isArray(nextTurn) && !Array.isArray(nextStep)) return undefined
  // 两条列都给：next-turn 是「等下一轮」，next-step 是「已经插进这一轮、等下一步消费」。
  // 后者必须显示 —— 否则插队的消息在"宿主已收下、对话还没出现"这段时间里**两边都没有**。
  return {
    'next-turn': (Array.isArray(nextTurn) ? nextTurn : []) as readonly unknown[],
    'next-step': (Array.isArray(nextStep) ? nextStep : []) as readonly unknown[],
  }
}

/**
 * inbox 投影 → 手机侧队列行。
 *
 * 两种线上形状都要吃：
 *  ①`session/queue` 帧（桌面插件时代）：`{ id, placement, message: { content } }`；
 *  ②inbox 投影（宿主 0.2.x）：`next-turn` 里就是**裸的 UserMessage**，`content` 在行上，
 *    没有 `message` 这一层。
 *
 * 只认 ① 的时候，投影过来的每一条正文都是空的 —— 手机上就是「2 条排队」加两行空白
 * （真机截图）。所以这里先看行上的 `content`，再退回 `message.content`。
 */
export function queueItemsOf(inbox: unknown): Array<{ id: string; placement: 'queued' | 'steering' | 'context'; text: string; editable: boolean; requestId?: string; receipts?: string[]; keepParts?: unknown[] }> {
  const box = inbox as { 'next-turn'?: unknown; 'next-step'?: unknown } | null | undefined
  // 两条列都要：只读 next-turn 会让「插队」的消息在手机上**完全看不到**——它不在排队条上，
  // 也还没进对话（要等下一步边界消费）。实测 2026-10-30：steer 回执 ok，手机 12 秒既无气泡
  // 也无排队条。next-step 是"已经插进这一轮、等下一步消费"，展示成 steering。
  const lists: Array<{ rows: unknown[]; placement: 'queued' | 'steering' }> = []
  if (Array.isArray(box?.['next-turn'])) lists.push({ rows: box['next-turn'], placement: 'queued' })
  if (Array.isArray(box?.['next-step'])) lists.push({ rows: box['next-step'], placement: 'steering' })
  if (lists.length === 0) return []
  const items: Array<{ id: string; placement: 'queued' | 'steering' | 'context'; text: string; editable: boolean }> = []
  for (const list of lists) list.rows.forEach((row, index) => {
    const listPlacement = list.placement
    const record = (row ?? {}) as {
      id?: unknown
      placement?: unknown
      content?: unknown
      text?: unknown
      requestId?: unknown
      rpcId?: unknown
      source?: { rpcId?: unknown; requestId?: unknown }
      message?: { content?: unknown; text?: unknown; requestId?: unknown; source?: { rpcId?: unknown; requestId?: unknown } }
    }
    // 投递身份：客户端发 prompt 时带的 `requestId`，宿主会在 durable `user/message`
    // 的 source 上以 `rpcId` 回显（见 @deepseek-ai/dsh-session-controller 的契约）。
    // 有它就能按「身份」去重/退场；没有就只能按正文猜 —— 那正是重复条的根源。
    const messageId = typeof record.id === 'string' ? record.id : undefined
    const requestId = [record.requestId, record.rpcId, record.source?.rpcId, record.source?.requestId,
      record.message?.requestId, record.message?.source?.rpcId, record.message?.source?.requestId]
      .find(value => typeof value === 'string' && value !== '') as string
      | undefined
      ?? (messageId === undefined ? undefined : requestIdOfMessage(messageId))
    const blocks = record.content ?? record.message?.content
    const rawText = record.text ?? record.message?.text
    const receipts: string[] = []
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        const part = block as { type?: unknown; receiptId?: unknown }
        if (part.type === 'file' && typeof part.receiptId === 'string' && part.receiptId !== '') receipts.push(part.receiptId)
      }
    }
    const text = typeof rawText === 'string' && rawText !== '' ? rawText.trim() : textOfInboxContent(blocks)
    // 能不能就地编辑：正文必须可改，附件/图片这些**原样保留**（收据和 attachmentId
    // 都还在宿主手里，拼回去不用重传字节）。只有认不出的块类型才判为不可编辑。
    const keepParts: unknown[] = []
    let hasUnknownPart = false
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        const type = (block as { type?: unknown }).type
        if (type === 'text') continue
        if (type === 'file' || type === 'image') { keepParts.push(block); continue }
        hasUnknownPart = true
      }
    }
    const editable = Array.isArray(blocks)
      ? blocks.length > 0 && !hasUnknownPart
      : text !== ''
    items.push({
      id: typeof record.id === 'string' ? record.id : String(index),
      placement: record.placement === 'steering' ? 'steering' : record.placement === 'context' ? 'context' : listPlacement,
      text,
      editable,
      ...(requestId === undefined ? {} : { requestId }),
      // 文件附件只带收据（给界面显示用）；`keepParts` 是编辑时要拼回去的原样块。
      ...(receipts.length === 0 ? {} : { receipts }),
      ...(keepParts.length === 0 ? {} : { keepParts }),
    })
  })
  return items
}

/**
 * 队列项正文（够卡片显示一行）。
 *
 * 非文本块也要出一段占位：只排队了一张图片时，正文是空的 —— 界面上就是「2 条排队」
 * 加两行空白（真机截图）。给个 `[图片]` 至少能看出这条是什么。
 */
export function textOfInboxContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const type = (block as { type?: unknown }).type
    if (type === 'text') {
      const text = (block as { text?: unknown }).text
      if (typeof text === 'string' && text.trim() !== '') parts.push(text.trim())
      continue
    }
    if (typeof type === 'string' && type !== '') {
      parts.push(type === 'image' ? '[图片]' : type === 'file' ? '[附件]' : `[${type}]`)
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
/**
 * 目标条读取：把会话的 goal 投影原样交给手机端（{ current } 由客户端解析）。
 * 队列那条路（mobile.inbox）已经证明同一个快照里能拿到投影，这里复用同一条：
 * 平时读快照，只有刚点过动作（fresh）时才现开一帧 follow 取当下值。
 */
