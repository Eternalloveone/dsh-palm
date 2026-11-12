/**
 * 定位锚点解析：把一次「用户点了搜索结果」变成确定的行下标。
 *
 * ## 为什么单独一层（2026-11-12）
 *
 * 以前这段逻辑散在 ChatView 的一个 183 行 effect 里，判据顺序是「messageId →
 * seq+关键词 → 关键词兜底」三层，每层都可能因为数据没到/跨页合并而落空，落空后
 * 就退到下一层、再落空就静默放弃（视口沉到会话底部）。真机实测：
 *
 * ```
 * [locate] {rows:0, loading:false, done:false}    ← 首屏还没到
 * [locate] {rows:9, loading:false, done:true }    ← 已经放弃
 * ```
 *
 * 这里把「用什么找」和「怎么滚」分开：本模块只回答「这一行是第几行」，
 * 不碰 DOM、不碰 React、不碰滚动。纯函数，可单测。
 *
 * ## 三个锚点，优先级从硬到软
 *
 * 1. `message`：宿主的 wire id，最硬。索引按原始消息 id 建，渲染行按折叠结果建，
 *    跨页合并时两者可能对不上 —— 但对得上时它永远正确。
 * 2. `turn-step`：结构坐标（第几轮第几步）。合并把 id 搅乱之后，坐标系仍然指向
 *    同一行。**这是 2026-11-12 新增的那一格，也是「图谱寻址」的落点**。
 * 3. `seq`：事件序号。它既是排序键又被当锚点用，合并后必然漂移，只作最后兜底。
 *
 * @module dsh-palm/mobile/views/chat/lib/locate-anchor
 */

/** 宿主索引给的命中路径（图谱坐标）。 */
export interface LocatePath {
  /** 第几轮（`RenderMessage.turn`）。 */
  turn?: number
  /** 第几步（`RenderMessage.step`）。 */
  step?: number
  /** 角色：用户气泡还是助手回答。 */
  role?: 'user' | 'assistant'
}

/** 一次定位意图（去掉 at/TTL 等存储细节后的最小面）。 */
export interface LocateIntentFields {
  seq?: number
  messageId?: string
  turn?: number
  step?: number
  query?: string
}

/** 解析出来的锚点：只描述「拿什么去找」，不含结果。 */
export type LocateAnchor =
  | { kind: 'message'; id: string }
  | { kind: 'turn-step'; turn: number; step?: number }
  | { kind: 'seq'; seq: number }
  | { kind: 'query'; term: string }

/** 行索引需要的字段（`RenderMessage` 的子集）。 */
export interface IndexableRow {
  id: string
  turn?: number
  step?: number
  text: string
}

/** 建好的一张查表：id → 下标、`turn:step` → 下标。 */
export interface RowIndex {
  readonly byId: ReadonlyMap<string, number>
  readonly byTurnStep: ReadonlyMap<string, number>
  /** 只有轮、没有步时的降级表：`turn` → 该轮的第一行下标。 */
  readonly byTurn: ReadonlyMap<number, number>
}

/**
 * 意图 → 锚点。返回 `undefined` 表示「这次根本没有可定位的目标」
 * （例如只有关键词、连 seq 都没有），调用方应当按普通打开会话处理。
 *
 * 优先级：messageId > turn/step > seq > query。
 */
export function intentToAnchor(intent: LocateIntentFields): LocateAnchor | undefined {
  if (intent.messageId !== undefined && intent.messageId !== '') {
    return { kind: 'message', id: intent.messageId }
  }
  if (intent.turn !== undefined) {
    return {
      kind: 'turn-step',
      turn: intent.turn,
      ...(intent.step === undefined ? {} : { step: intent.step }),
    }
  }
  if (intent.seq !== undefined) return { kind: 'seq', seq: intent.seq }
  const term = intent.query?.trim() ?? ''
  if (term !== '') return { kind: 'query', term }
  return undefined
}

/**
 * 按锚点的软硬程度排一次序。`findRow` 会依次尝试，但**只有**在更硬的锚点
 * 在当前窗口里完全找不到时才降级 —— 一旦硬锚点命中，软锚点不许否决它。
 */
export function anchorChain(anchor: LocateAnchor): LocateAnchor[] {
  switch (anchor.kind) {
    case 'message':
    case 'turn-step':
    case 'seq':
    case 'query':
      return [anchor]
  }
}

/** 一次 O(n) 建表。行数在千级以内，比每次渲染 `findIndex` 便宜。 */
export function buildRowIndex(rows: readonly IndexableRow[]): RowIndex {
  const byId = new Map<string, number>()
  const byTurnStep = new Map<string, number>()
  const byTurn = new Map<number, number>()
  rows.forEach((row, index) => {
    if (row.id !== '' && !byId.has(row.id)) byId.set(row.id, index)
    if (row.turn === undefined) return
    if (!byTurn.has(row.turn)) byTurn.set(row.turn, index)
    if (row.step === undefined) return
    const key = `${row.turn}\u0000${row.step}`
    if (!byTurnStep.has(key)) byTurnStep.set(key, index)
  })
  return { byId, byTurnStep, byTurn }
}

/**
 * 在已建好的表里查这个锚点落在哪一行。
 *
 * @returns 行下标；找不到返回 `-1`（**调用方必须把 -1 当「还要再找」，不是「失败」**）
 */
export function findRow(index: RowIndex, anchor: LocateAnchor): number {
  switch (anchor.kind) {
    case 'message':
      return index.byId.get(anchor.id) ?? -1
    case 'turn-step': {
      if (anchor.step !== undefined) {
        const exact = index.byTurnStep.get(`${anchor.turn}\u0000${anchor.step}`)
        if (exact !== undefined) return exact
      }
      return index.byTurn.get(anchor.turn) ?? -1
    }
    case 'seq':
      // seq 不是下标，必须由调用方按「第一个 seq >= 目标」的行来解析。
      return -1
    case 'query':
      return -1
  }
}

/**
 * 在一组行里按关键词找——**只给最后兜底用**，且调用方必须先确认「历史已翻完」。
 *
 * 为什么限制这么死：这条退路会把深历史的命中落到窗口里最早的一条同词消息上，
 * 真机表现就是「搜的是最新的，落到了历史中段」。
 */
export function findRowByQuery(rows: readonly IndexableRow[], term: string): number {
  const needle = term.toLowerCase()
  if (needle === '') return -1
  return rows.findIndex(row => row.text.toLowerCase().includes(needle))
}
