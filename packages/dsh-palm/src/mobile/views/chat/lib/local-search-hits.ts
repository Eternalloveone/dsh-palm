/**
 * 会话内搜索的**本地口径**：在已渲染的行里数命中处，而不是等宿主的条数。
 *
 * 为什么要有它：宿主的索引是按"消息段"建的一条一条正文，而屏幕上一个段落里同一个词
 * 出现 4 次就是 4 个高亮。两套口径永远对不上 —— 手机端「1/2 却有 4 个高亮」就是
 * 计数取条数、高亮取出现次数。索引还会漏（实测一场 1838 个事件的会话只入了 11 条
 * 正文），所以计数只能以"已经画在屏幕上的正文"为准。
 *
 * 语料口径与宿主索引**共用** `searchCorpusOf`（`mobile/render/search-corpus.ts`）：
 * 只数"用户发的消息 + 助手最后的结论正文"。思考链、工具参数/结果、过程步骤里的正文
 * 都不算 —— 否则计数把过程里的词算进去，定位却只能落在答案区的 mark 上，表现就是
 * 「数字在动，画面没跳过去」。
 *
 * 匹配规则和渲染高亮共用 `searchTermPattern`：一处出现对应一个 <mark>，
 * 本模块给出的 occurrence 就是该 part 里第几个 <mark>。
 */
import type { RenderMessage } from '../../../render/messages.ts'
import { searchTermPattern } from '../../../render/markdown-text.tsx'
import { searchCorpusOf } from '../../../render/search-corpus.ts'

/** 已渲染行里的一处命中。 */
export interface LocalSearchHit {
  /** 屏幕上的行 id（`[data-message-id]`）。 */
  rowId: string
  /** 这条正文的 seq（定位用；助手是 answerSeq，用户是气泡 seq）。 */
  rowSeq: number
  /** 行在列表里的下标。 */
  rowIndex: number
  /** 渲染端给正文节点的 part id（`body` / `answer`）；没有对应节点时缺省。 */
  partId?: string
  /** 这个 part 里第几处（0 起）= 焦点行渲染出的第几个 `<mark>`。 */
  occurrence: number
}

/** 一段正文里会标亮几处。 */
export function countTermIn(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0
  let count = 0
  for (const _match of text.matchAll(pattern)) count += 1
  return count
}

/**
 * 列表里所有**已渲染**的命中（按屏幕顺序、part 内顺序）。
 *
 * @param list - 当前渲染出来的行
 * @param query - 搜索词（空词返回空数组）
 */
export function localSearchHits(list: readonly RenderMessage[], query: string): LocalSearchHit[] {
  const pattern = searchTermPattern(query)
  if (pattern === undefined) return []
  const hits: LocalSearchHit[] = []
  list.forEach((row, rowIndex) => {
    // 与宿主索引同一把尺子：只数用户气泡正文 / 助手结论正文。
    const corpus = searchCorpusOf(row)
    if (corpus === undefined) return
    const count = countTermIn(corpus.text, pattern)
    for (let index = 0; index < count; index += 1) {
      hits.push({
        rowId: row.id,
        rowSeq: corpus.seq,
        rowIndex,
        ...(corpus.partId === undefined ? {} : { partId: corpus.partId }),
        occurrence: index,
      })
    }
  })
  return hits
}

/**
 * 自动跳转的落点：**就近**，不再"回到最早一处"。
 *
 * 从上往下找第一处落在视口 35% 线以下的命中（用户正在读的位置之后），
 * 没有就取最后一处（即"上方最近"）。找不到任何已渲染命中时返回 `-1`。
 *
 * @param hits - {@link localSearchHits} 的结果
 * @param options.topOf - 行 id → 视口纵坐标（测试可注入；默认读 DOM）
 * @param options.anchor - 视口 35% 线的绝对坐标；不传则按 0 处理（等价于"取第一处"）
 */
export function nearestLocalHitIndex(
  hits: readonly LocalSearchHit[],
  options: { topOf?: (rowId: string) => number | undefined; anchor?: number } = {},
): number {
  if (hits.length === 0) return -1
  const { topOf, anchor } = options
  if (topOf === undefined || anchor === undefined) return 0
  const tops = hits.map(hit => topOf(hit.rowId))
  // 几何退化（jsdom / 行还没排版）：所有命中都在同一纵坐标上，挑不出"下方最近"，
  // 硬挑只会落到最后一处 —— 交回下标顺序。
  const distinct = new Set(tops.filter((top): top is number => top !== undefined).map(top => Math.round(top)))
  if (distinct.size <= 1) return 0
  for (let i = 0; i < hits.length; i += 1) {
    const top = tops[i]
    if (top !== undefined && top >= anchor) return i
  }
  return hits.length - 1
}

/**
 * 「上一个」翻到窗口外时该去哪一处：比首行更早的命中里 seq 最大的那条。
 *
 * 会话窗口是**尾部**（更早的历史按需往前翻），所以"未加载"只可能在更早的方向。
 * 返回宿主命中数组里的下标；没有更早的命中给 -1。
 */
export function olderHitIndex(
  hits: readonly { seq: number }[],
  rows: readonly RenderMessage[],
): number {
  const first = rows[0]
  const floor = first === undefined ? Number.POSITIVE_INFINITY : (first.startSeq ?? first.seq)
  let best = -1
  let bestSeq = Number.NEGATIVE_INFINITY
  hits.forEach((hit, index) => {
    if (hit.seq < floor && hit.seq > bestSeq) {
      bestSeq = hit.seq
      best = index
    }
  })
  return best
}

/**
 * 从首页搜索点进来时，把计数对齐到用户点的那一处（本地口径）。
 *
 * 对齐顺序与宿主的 `alignHitIndex` 一致：先按 messageId（这里就是行 id）精确找，
 * 再按 seq 找第一处 ≥ 意图 seq 的，都没有退回 0。
 *
 * @returns 下标；`-1` 表示这次定位意图与当前查询词无关
 */
export function alignLocalHitIndex(
  hits: readonly LocalSearchHit[],
  intent: { query?: string; messageId?: string; seq?: number } | undefined,
  term: string,
): number {
  const intentTerm = (intent?.query ?? '').trim()
  if (intent === undefined || intentTerm !== term || hits.length === 0) return -1
  if (intent.messageId !== undefined) {
    const byId = hits.findIndex(hit => hit.rowId === intent.messageId)
    if (byId >= 0) return byId
  }
  if (intent.seq !== undefined) {
    const seq = intent.seq
    const bySeq = hits.findIndex(hit => hit.rowSeq >= seq)
    if (bySeq >= 0) return bySeq
  }
  return 0
}
