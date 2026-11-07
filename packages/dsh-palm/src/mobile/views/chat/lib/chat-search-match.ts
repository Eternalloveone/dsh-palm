/**
 * 会话内搜索的**行匹配**判据（W3-3 从 `ChatView` 拆出来的纯函数层）。
 *
 * 这些函数回答的是同一个问题：索引里的第 N 处命中，在屏幕上到底落在哪一行？
 * 它们以前是 ChatView 里的一串 `useCallback`，谁也不敢动——每一条都对应一次真机
 * "计数器在走、画面不动"。拆成纯函数后至少能单独钉住。
 *
 * @module dsh-palm/mobile/views/chat/chat-search-match
 */
import type { RenderMessage } from '../../../render/messages.ts'

/** 一个命中：索引给的原始信息。 */
export interface SearchHit {
  seq: number
  snippet?: string
  messageId?: string
  partId?: string
}

/** 宿主 `mobile.search` 回来的原始条目（字段几乎都是可选的）。 */
export interface RawSearchItem {
  seq?: number
  snippet?: string
  messageId?: string
  partId?: string
  paragraph?: string
  matchIndex?: number
}

/**
 * 把宿主回来的条目整理成可用的命中列表：丢掉没有 seq 的、去重、按 seq 升序。
 *
 * 去重不是洁癖：旧库里的重复行会让计数器从 4/50 走到 5/50，而目标还是同一行同一处
 * —— 用户看到的就是「数字在变，位置一直不动」。按「消息 + 片段」认同一处。
 */
export function normalizeSearchHits(items: readonly RawSearchItem[]): SearchHit[] {
  const seen = new Set<string>()
  const hits: SearchHit[] = []
  for (const item of items) {
    if (item.seq === undefined) continue
    const hit: SearchHit = {
      seq: item.seq,
      snippet: item.snippet ?? '',
      ...(item.messageId === undefined ? {} : { messageId: item.messageId }),
      ...(item.partId === undefined ? {} : { partId: item.partId }),
      ...(item.paragraph === undefined ? {} : { paragraph: item.paragraph }),
      ...(item.matchIndex === undefined ? {} : { matchIndex: item.matchIndex }),
    }
    const key = `${hit.messageId ?? `seq:${hit.seq}`}#${hit.partId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push(hit)
  }
  return hits.sort((left, right) => left.seq - right.seq)
}

/**
 * 从首页搜索点进来时，该把计数器落在第几处。
 *
 * 不能一律归 0 —— 那等于把用户从他点的那一处拽走。对齐顺序：先按 messageId 精确找，
 * 再按 seq 往后找第一处，都没有才退回 0。
 *
 * @returns 下标；`-1` 表示这次定位意图与当前查询词无关，调用方自己决定归 0
 */
export function alignHitIndex(
  hits: readonly SearchHit[],
  intent: { query?: string; messageId?: string; seq?: number } | undefined,
  term: string,
): number {
  const intentTerm = (intent?.query ?? '').trim()
  if (intent === undefined || intentTerm !== term || hits.length === 0) return -1
  const byId = intent.messageId === undefined ? -1 : hits.findIndex(hit => hit.messageId === intent.messageId)
  if (byId >= 0) return byId
  if (intent.seq !== undefined) {
    const bySeq = hits.findIndex(hit => hit.seq >= (intent.seq ?? 0))
    if (bySeq >= 0) return bySeq
  }
  return 0
}

/** 参与匹配的行视图（只留正文与身份，避免把整个 RenderMessage 传下去）。 */
export interface SearchRow {
  seq: number
  startSeq?: number
  id: string
  stepSeqs?: readonly number[]
  text: string
}

/** 行里真正能搜的文本：assistant 工具步骤行的正文在 flow 里，text 是空的——
 * 只拿 text 比对会把这类命中判成"原文没渲染"，白白翻页。 */
export function searchRowsOf(list: readonly RenderMessage[]): SearchRow[] {
  return list.map(row => {
    const flowText = (row.flow ?? [])
      .filter(part => part.kind === 'text')
      .map(part => (part.kind === 'text' ? part.text : ''))
      .join('\n')
    return {
      seq: row.seq,
      startSeq: row.startSeq,
      id: row.id,
      stepSeqs: row.stepSeqs,
      text: row.searchText !== undefined && row.searchText !== ''
        ? row.searchText
        : (flowText === '' ? row.text : `${row.text}\n${flowText}`),
    }
  })
}

/** 这一行的正文里是否真的有搜索词。
 *
 * 合并行（一轮多步打包成一张卡）的行 id 是卡自己的 id，不等于索引里那条消息的
 * messageId；判断"命中在不在窗口里"只能退到「seq 落在这一行的区间里 + 这一行的
 * 正文真的有这个词」。只按 seq 认行是不够的：游标偏一点就会落到相邻那张不含词
 * 的卡上，用户看到的就是"跳过去了却没有高亮"。
 */
export function rowHasTerm(row: RenderMessage, term: string): boolean {
  if (term === '') return true
  if (row.text.includes(term)) return true
  if ((row.searchText ?? '').includes(term)) return true
  return (row.flow ?? []).some(part => part.kind === 'text' && part.text.includes(term))
}

/** 这一行会不会把 `seq` 这一步的**正文**渲染出来。
 *
 * 合并行的 `seq` 是这一轮的水位（回合尾巴、页尾校准、preferRicherRows 都会把它抬高），
 * 比它自己最后一个渲染步还大；只按 `startSeq..seq` 判区间就会认下一条根本不在这一行
 * 里的命中。真机：命中 seq=1057（turn 11 的答案）被认成 turn 9 那张 `seq` 水位=1057
 * 的卡，卡里只有 766 的正文 —— 两条命中双双落在同一个高亮上，计数在走、画面不动。
 * 所以优先按 `flow` 里**正文段自己的 seq** 认：它才是真正渲染出来的那一步。
 */
export function rowCoversSeq(row: RenderMessage, seq: number): boolean {
  const textSeqs: number[] = []
  for (const part of row.flow ?? []) {
    if (part.kind === 'text' && typeof part.seq === 'number') textSeqs.push(part.seq)
  }
  if (textSeqs.length > 0) return textSeqs.includes(seq)
  const steps = row.stepSeqs ?? []
  if (steps.length > 0) return steps.includes(seq)
  return (row.startSeq ?? row.seq) <= seq && seq <= row.seq
}

/** 这一行在屏幕上会不会画出任何正文（答案体或过程体）。
 *
 * 索引是按宿主折叠出的行建的，手机上这一格可能只剩工具调用和推理：这时候无论
 * 怎么定位都不会有高亮（真机 失败 4/28：焦点行一个标记都没有）。这种行不能当落点用。
 */
export function rowRendersAnyText(row: RenderMessage): boolean {
  if (row.text.trim() !== '') return true
  return (row.flow ?? []).some(part => part.kind === 'text' && part.text.trim() !== '')
}

/** 同一个 seq 在屏幕上可能对应好几行（合并行 + 拆出来的短行），取正文最长的那一行
 * ——短的那行只有几十个字，跳过去等于跳到空白处。返回下标，找不到是 -1。 */
export function richestRowOfSeq(list: readonly RenderMessage[], seq: number): number {
  let best = -1
  let bestLength = -1
  for (let index = 0; index < list.length; index += 1) {
    const row = list[index]
    if (row === undefined) continue
    if (row.seq !== seq && !(row.stepSeqs ?? []).includes(seq)) continue
    const flowText = (row.flow ?? [])
      .filter(part => part.kind === 'text')
      .map(part => (part.kind === 'text' ? part.text : ''))
      .join('\n')
    const length = (row.searchText ?? '').length + flowText.length + row.text.length
    if (length > bestLength) {
      bestLength = length
      best = index
    }
  }
  return best
}

/** 命中在屏幕列表里的下标：先按身份认，再按短锚点认，最后退回"正文最长的那行"。 */
export function rowIndexOfHit(
  list: readonly RenderMessage[],
  hit: SearchHit,
  /** 宿主原始页（可能是另一份行集合），用于跨页映射；没有就不参与。 */
  rawPage: readonly RenderMessage[] = [],
  seqRowIndex?: (rows: readonly SearchRow[], seq: number, messageId?: string, snippet?: string) => number,
): number {
  // 索引直接给出了这一条命中属于哪一行（messageId）：屏幕上已经有这一行就按它落，
  // 不要再用片段去猜——索引与屏幕的行边界不一致时，猜会把落点挪到相邻的短行上。
  if (hit.messageId !== undefined && hit.messageId !== '') {
    const byId = list.findIndex(row => row.id === hit.messageId)
    if (byId >= 0) return byId
  }
  // 索引里的「一行」和屏幕上的一行不是同一个边界：索引按整个会话合并，屏幕按窗口
  // 切开，同一个 seq 可能落在相邻的两行里。片段相似度会被 markdown 剥掉的符号拉低，
  // 于是退一步用「短锚点」直接找：8 个连续字几乎不可能被剥没。
  const probe = (hit.snippet ?? '').replace(/^…+/u, '').replace(/…+$/u, '').replace(/\s+/gu, ' ').trim()
  if (probe.length >= 8) {
    const anchors = [
      probe.slice(0, 8),
      probe.slice(Math.floor((probe.length - 8) / 2), Math.floor((probe.length - 8) / 2) + 8),
      probe.slice(-8),
    ]
    for (const anchor of anchors) {
      const at = list.findIndex(row => {
        const flowText = (row.flow ?? [])
          .filter(part => part.kind === 'text')
          .map(part => (part.kind === 'text' ? part.text : ''))
          .join('\n')
        return `${row.searchText ?? ''}\n${row.text}\n${flowText}`.replace(/\s+/gu, ' ').includes(anchor)
      })
      if (at >= 0) return at
    }
  }
  if (seqRowIndex !== undefined && rawPage.length > 0) {
    const pageIndex = seqRowIndex(searchRowsOf(rawPage), hit.seq, hit.messageId, hit.snippet)
    const row = pageIndex >= 0 ? rawPage[pageIndex] : undefined
    if (row !== undefined) {
      const inList = list.findIndex(item => item.id === row.id)
      if (inList >= 0) return inList
    }
  }
  // 先让屏幕列表自己也按片段认一次：命中所在的长行不一定带着命中的 seq（合并行
  // 记的是它最后一步的 seq），光按 seq 找会落到前面那行短的上面。
  if (seqRowIndex !== undefined) {
    const inListByText = seqRowIndex(searchRowsOf(list), hit.seq, hit.messageId, hit.snippet)
    if (inListByText >= 0) return inListByText
  }
  return richestRowOfSeq(list, hit.seq)
}
