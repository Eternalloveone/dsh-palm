/**
 * 会话内搜索的**落点机制**：屏幕上有哪些高亮、跳到哪一格、计数怎么算。
 *
 * 从 `ChatView` 搬出来的（S4 第一刀）：这一组逻辑只跟"DOM 里的 `.chat-search-mark`"
 * 打交道，与消息折叠、回合判定无关，是 ChatView 里最独立的一块。
 *
 * 三条口径，历次错位都出在这三处：
 *
 * | 概念 | 身份 | 谁提供 |
 * |---|---|---|
 * | 一处命中 | `(messageId, partId, offsetInPart)` | 这里扫 DOM 得到 |
 * | 索引的一处 | `(messageId, partId, matchIndex)` | 宿主/本地索引 |
 * | 滚动落点 | 直接滚那一格（不整行第 N 处） | `gotoRenderedMatch` |
 *
 * @module dsh-palm/mobile/views/chat/hooks/use-search-marks
 */
import { useCallback, useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { RenderMessage } from '../../../render/messages.ts'
import { locateIntentFor } from '../../../session/locate-intent.ts'
import type { SearchHit } from '../lib/chat-search-match.ts'

/** 屏幕上的一处高亮。 */
export interface RenderedMatch {
  mark: HTMLElement
  messageId: string
  partId: string
  offset: number
}

export interface SearchMarksDeps {
  /** 滚动容器（`.chat-scroll`）。 */
  scrollerRef: MutableRefObject<HTMLElement | undefined>
  /** 滚动层的唯一入口（见 K4）。 */
  scrollToTarget: (target: number, options?: { smooth?: boolean }) => void
  messages: readonly RenderMessage[]
  /** 一行覆盖某个 seq 吗（合并行之后仍然能按 seq 找回这一行）。 */
  rowCoversSeq: (row: RenderMessage, seq: number) => boolean
  sessionId: string
  chatHitQuery: string
  chatSearchAt: number
  setChatSearchAt: Dispatch<SetStateAction<number>>
  chatMarkTotal: number
  setChatMarkTotal: Dispatch<SetStateAction<number>>
  chatSearchHits: readonly SearchHit[]
  /** 宿主/索引给的全历史命中总数（可能大于屏幕上渲染出来的）。 */
  chatSearchMatched: number | undefined
  chatSearchComplete: boolean
  /** 「上一个」在边界触发的那次翻页是否刚落地。 */
  pendingPrevPageRef: MutableRefObject<boolean>
}

export interface SearchMarks {
  renderedMatches: () => RenderedMatch[]
  gotoRenderedMatch: (match: RenderedMatch | undefined, index: number) => boolean
  markOfHit: (hit: { seq?: number; messageId?: string; matchIndex?: number } | undefined) => RenderedMatch | undefined
  jumpToRenderedMark: () => boolean
  stepRenderedMark: (direction: 'next' | 'prev') => boolean
  searchView: { hits: number; at: number; more: boolean }
}

/** @returns 落点机制的全部入口；同时把计数与自动落点的副作用跑起来。 */
export function useSearchMarks(deps: SearchMarksDeps): SearchMarks {
  const {
    scrollerRef, scrollToTarget, messages, rowCoversSeq, sessionId,
    chatHitQuery, chatSearchAt, setChatSearchAt, chatMarkTotal, setChatMarkTotal,
    chatSearchHits, chatSearchMatched, chatSearchComplete, pendingPrevPageRef,
  } = deps

  // 会话内搜索的**唯一坐标系**：屏幕上的高亮节点。
  //
  // 每一处命中的身份 = (messageId, partId, offsetInPart)，与宿主索引返回的
  // (messageId, partId, matchIndex) **同构**；本地匹配、索引、DOM 定位三处说的是
  // 同一件事，不再有"整行第 N 处"这种二次推算（历次错位都来自它）。
  // 计数 = matches.length；跳转 = 直接滚那一格；过程/思考不产生 mark，所以也不会被算计。
  /** 这一屏渲染出来的全部高亮，按文档顺序（part 内按出现顺序编号）。 */
  const renderedMatches = useCallback((): RenderedMatch[] => {
    if (typeof document === 'undefined') return []
    const scroller = scrollerRef.current
    if (scroller === undefined) return []
    const out: RenderedMatch[] = []
    const seen = new Map<Element, number>()
    for (const mark of scroller.querySelectorAll<HTMLElement>('.chat-search-mark')) {
      const row = mark.closest<HTMLElement>('[data-message-id]')
      const messageId = row?.getAttribute('data-message-id') ?? ''
      if (messageId === '' || row === null) continue
      const part = mark.closest<HTMLElement>('[data-part-id]')
      // B（2026-11-14）：与索引的 partId 严格同构 —— 索引里用户消息是 'body'、
      // 助手答案是 'answer'。用户气泡没有 data-part-id 节点，这里默认成 'body'，
      // 两端口径就完全一致，定位不再靠"同序号夹取"猜。
      const partId = part?.getAttribute('data-part-id') ?? 'body'
      const scope: Element = part ?? row
      const offset = seen.get(scope) ?? 0
      seen.set(scope, offset + 1)
      out.push({ mark, messageId, partId, offset })
    }
    return out
  }, [scrollerRef])

  /** 落到某一处：只给这一格加"当前"描边并滚过去。
   *
   * **不再 setFocusMsgId**：那会给整行加焦点态 → 长文自动展开/收起、交付卡重排，
   * 布局一变，刚滚过去的位置又被弹回去（真机「点上一个不动」就是这个）。
   * 搜索落点和"进入并定位"的焦点是两件事：后者才需要展开。 */
  const gotoRenderedMatch = useCallback((match: RenderedMatch | undefined, index: number): boolean => {
    if (match === undefined) return false
    setChatSearchAt(index)
    const scroll = (): void => {
      // setChatSearchAt 会重渲染（计数随状态更新），旧节点可能已被替换：这里按
      // 坐标重新找一次，再滚。找不到才退回传入的那个节点。
      const box = scrollerRef.current
      if (box === undefined) return
      const again = renderedMatches().find(item =>
        item.messageId === match.messageId && item.partId === match.partId && item.offset === match.offset)
      const node = again?.mark ?? match.mark
      for (const stale of box.querySelectorAll<HTMLElement>('.chat-search-mark-active')) {
        stale.classList.remove('chat-search-mark-active')
      }
      // 同一节点连续两次命中时动画不会重播：强制回流一次再挂 class。
      // 目标本来就在视口内时没有位移，脉冲是「确实跳到了」的唯一反馈。
      void node.offsetWidth
      node.classList.add('chat-search-mark-active')
      // 不用 element.scrollIntoView：真机上它经常滚的是**外层文档**（或 smooth 被忽略），
      // 容器纹丝不动 —— 实测「点下一个高亮坐标一个像素都没变」。直接写容器的 scrollTop。
      const delta = node.getBoundingClientRect().top - box.getBoundingClientRect().top
        - box.clientHeight / 2 + node.offsetHeight / 2
      const target = Math.max(0, box.scrollTop + delta)
      scrollToTarget(target, { smooth: true })   // K4 唯一入口：平滑回声由它认领
    }
    // 双 rAF：翻页 prepend 后布局要下一帧才稳定；只等一帧会拿旧坐标算 delta，
    // 结果是"往回点却向下滚了几千像素"（真机 prev-scrolls 实测过）。
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(scroll))
    else scroll()
    return true
  }, [renderedMatches, scrollerRef, scrollToTarget, setChatSearchAt])

  /**
   * 把一条命中（索引口径：messageId + 该处的 matchIndex）对到屏幕上的那一格。
   * 对不上返回 undefined —— 说明它还在未加载的历史里，交给翻页定位。
   *
   * 同一行有多处时**按序号对**：索引的 matchIndex 与渲染的 offset 口径不完全一致
   * （一个按文本段、一个按 part），完全相等匹配不到就夹到范围内取第 N 处，
   * 而不是一律退到该行第一处（那样连续按「下一个」会停在同一处不动）。
   *
   * C（2026-11-14）：合并行（一轮多步打包成一张卡）或 pending→final 换了 id 时，
   * messageId 对不上任何渲染行 —— 这时用 **seq 覆盖**回退找行，再把序号夹到行内范围。
   * 这是最后一道身份兜底：seq 在合并前后是稳定的。
   */
  const markOfHit = useCallback((hit: { seq?: number; messageId?: string; matchIndex?: number } | undefined): RenderedMatch | undefined => {
    if (hit === undefined) return undefined
    const wanted = hit.matchIndex ?? 0
    const fromRow = (rowId: string): RenderedMatch | undefined => {
      const inRow = renderedMatches().filter(item => item.messageId === rowId)
      if (inRow.length === 0) return undefined
      return inRow.find(item => item.offset === wanted) ?? inRow[Math.min(wanted, inRow.length - 1)]
    }
    if (hit.messageId !== undefined && hit.messageId !== '') {
      const byId = fromRow(hit.messageId)
      if (byId !== undefined) return byId
    }
    if (hit.seq !== undefined) {
      const cover = messages.find(row => rowCoversSeq(row, hit.seq!))
      if (cover !== undefined) return fromRow(cover.id)
    }
    return undefined
  }, [messages, renderedMatches, rowCoversSeq])

  /**
   * 自动落点：在**屏幕上已经渲染**的命中里就近选一条，index 取它在 hits 里的下标。
   *
   * 以前是"先挑屏幕上的 mark，再反查它是 hits 第几条"。matchIndex（索引口径）与
   * offset（渲染口径）一旦对不上，反查就失败、退成屏幕序号 —— 于是计数显示 9/39，
   * 按「上一个」却去翻全历史第 8 处（在很早的历史里），真机就是"点了没反应"。
   * 反过来查（hits → mark）就不会错位：index 与 hits 永远同一套。
   */
  const jumpToRenderedMark = useCallback((): boolean => {
    const hits = chatSearchHits
    const scroller = scrollerRef.current
    const anchor = scroller !== undefined && scroller.clientHeight > 0
      ? scroller.getBoundingClientRect().top + scroller.clientHeight * 0.35
      : undefined
    if (hits.length > 0) {
      const candidates = hits
        .map((hit, index) => ({ index, mark: markOfHit(hit) }))
        .filter((item): item is { index: number; mark: RenderedMatch } => item.mark !== undefined)
      // 一条都对不上（索引没给 messageId/seq 覆盖不到）：退回屏幕序，至少能落在一处。
      let pick = candidates[0]
      if (pick !== undefined && anchor !== undefined) {
        const tops = candidates.map(item => Math.round(item.mark.mark.getBoundingClientRect().top))
        // 几何退化（jsdom / 还没排版）：所有高亮同一纵坐标，硬挑只会落到最后一处。
        if (new Set(tops).size > 1) {
          const found = candidates.find(item => item.mark.mark.getBoundingClientRect().top >= anchor)
          pick = found ?? candidates[candidates.length - 1]!
        }
      }
      if (pick !== undefined) return gotoRenderedMatch(pick.mark, pick.index)
    }
    // 旧宿主没有逐处数据：退回屏幕序。
    const matches = renderedMatches()
    if (matches.length === 0) return false
    let index = 0
    if (anchor !== undefined) {
      const tops = matches.map(match => Math.round(match.mark.getBoundingClientRect().top))
      if (new Set(tops).size > 1) {
        const first = tops.findIndex(top => top >= anchor)
        index = first >= 0 ? first : matches.length - 1
      }
    }
    return gotoRenderedMatch(matches[index], index)
  }, [chatSearchHits, gotoRenderedMatch, markOfHit, renderedMatches, scrollerRef])

  /** 「上一个/下一个」：在屏幕上真实存在的高亮之间走一格（同一行内也逐格走）。 */
  const stepRenderedMark = useCallback((direction: 'next' | 'prev'): boolean => {
    const matches = renderedMatches()
    if (matches.length === 0) return false
    const current = Math.min(Math.max(chatSearchAt, 0), matches.length - 1)
    const index = direction === 'next'
      ? (current + 1) % matches.length
      : (current - 1 + matches.length) % matches.length
    return gotoRenderedMatch(matches[index], index)
  }, [chatSearchAt, gotoRenderedMatch, renderedMatches])

  /**
   * 搜索条上的计数：**屏幕上渲染出来的高亮**当分子主体。
   * - 分母：宿主给了全历史总数（C 版）就用它，否则用屏幕高亮数；
   * - `+`：索引覆盖不完整（数不全）时才有，表示"还有没数到的"。
   */
  const searchView = useMemo(() => {
    const rendered = chatMarkTotal
    // 计数口径 = **屏幕上的高亮**（分母也是它）：屏幕上有几处就显示几处，
    // 与画面一一对应、绝不含过程/思考/工具（那些不产生 mark）。
    // 屏幕之外还有命中（索引总数更大）时，分母带 `+` 说明"还有没显示出来的"。
    const external = Math.max(
      typeof chatSearchMatched === 'number' ? chatSearchMatched : 0,
      chatSearchHits.length,
    )
    if (rendered === 0) {
      return { hits: external, at: -1, more: external > 0 && chatSearchComplete !== true }
    }
    return {
      hits: rendered,
      at: Math.min(Math.max(chatSearchAt, 0), rendered - 1),
      more: external > rendered || chatSearchComplete !== true,
    }
  }, [chatMarkTotal, chatSearchAt, chatSearchMatched, chatSearchComplete, chatSearchHits.length])

  /** 首页点进来时，把落点对齐到用户点的那一处（按渲染出来的坐标找）。 */
  const markIndexForIntent = useCallback((matches: readonly RenderedMatch[], intent: { messageId?: string; seq?: number }): number => {
    if (intent.messageId !== undefined && intent.messageId !== '') {
      const byId = matches.findIndex(match => match.messageId === intent.messageId)
      if (byId >= 0) return byId
    }
    if (intent.seq !== undefined) {
      const bySeq = matches.findIndex(match => {
        const row = match.mark.closest<HTMLElement>('[data-message-id]')
        const seq = Number(row?.getAttribute('data-row-seq') ?? Number.NaN)
        return Number.isFinite(seq) && seq >= (intent.seq ?? 0)
      })
      if (bySeq >= 0) return bySeq
    }
    return 0
  }, [])

  /** 高亮渲染出来之后：同步计数，并按意图对齐或就近自动跳一次（每个词只跳一次）。 */
  const autoJumpedTermRef = useRef('')
  useEffect(() => {
    const term = chatHitQuery
    if (term === '') {
      autoJumpedTermRef.current = ''
      setChatMarkTotal(0)
      return
    }
    const matches = renderedMatches()
    setChatMarkTotal(matches.length)
    if (matches.length === 0) return
    if (autoJumpedTermRef.current === term) {
      // 翻页/展开让总数变了：只修正越界下标，不再抢焦点。
      // 上界必须是**索引处数**（hits），不是屏幕 mark 数：窗口只渲染了部分消息时
      // （屏幕 10 处、索引 14 处），拿 matches.length 夹会把 index 从 10 压到 9，
      // 点一次「上一个」看起来退了两格（真机 12/14 → 10/14）。
      const total = Math.max(chatSearchHits.length, matches.length)
      if (chatSearchAt > total - 1) setChatSearchAt(total - 1)
      return
    }
    autoJumpedTermRef.current = term
    const intent = locateIntentFor(sessionId)
    if (intent !== undefined && (intent.query ?? '').trim() === term) {
      const aligned = markIndexForIntent(matches, intent)
      gotoRenderedMatch(matches[aligned], aligned)
      return
    }
    jumpToRenderedMark()
  }, [chatHitQuery, chatSearchAt, chatSearchHits.length, messages, renderedMatches, gotoRenderedMatch, jumpToRenderedMark, markIndexForIntent, sessionId, setChatMarkTotal, setChatSearchAt])

  /**
   * 计数跟着 DOM 变：渲染是分批的（先一行、再整段、再展开），只靠"词变了"那一次
   * effect 记总数会停在中间某个数（真机 4 处却被显示成 1 处）。这里直接盯
   * `.chat-search-mark` 的增删，DOM 里几个就记几个 —— 与屏幕永远同源。
   */
  useEffect(() => {
    if (chatHitQuery === '') {
      setChatMarkTotal(0)
      return
    }
    const sync = (): void => {
      setChatMarkTotal(previous => {
        const next = renderedMatches().length
        return previous === next ? previous : next
      })
    }
    sync()
    const scroller = scrollerRef.current
    if (scroller === undefined || typeof MutationObserver === 'undefined') return
    // 性能：不要监听 characterData（流式输出时每个 delta 都会触发），
    // 也不要每次变化都 setState —— 用一帧合并一次，且数值没变就不写状态。
    // 之前是「任何 DOM 变化 → 重算 + setState → ChatView 重渲染」，
    // 搜索面板开着滑动时就是满屏重渲染（真机「上下滑动很卡」）。
    let scheduled = false
    const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        sync()
      })
    }
    const observer = new MutationObserver(schedule)
    observer.observe(scroller, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [chatHitQuery, renderedMatches, scrollerRef, setChatMarkTotal])

  /**
   * 「上一个」在边界触发的那次翻页落地了：落到**新增区域的最早一处**。
   * （翻页把更早的行 prepend 进来，matches[0] 就是那条更早的命中 —— 15/29 点上一个
   * 应该是 14/29 这一侧，而不是绕回 29/29。）
   */
  useEffect(() => {
    if (!pendingPrevPageRef.current) return
    const matches = renderedMatches()
    if (matches.length === 0) return
    pendingPrevPageRef.current = false
    // 让"每个词自动跳一次"的记账保持，避免自动落点再抢一次焦点。
    autoJumpedTermRef.current = chatHitQuery
    gotoRenderedMatch(matches[0], 0)
  }, [messages, chatHitQuery, renderedMatches, gotoRenderedMatch, pendingPrevPageRef])

  return { renderedMatches, gotoRenderedMatch, markOfHit, jumpToRenderedMark, stepRenderedMark, searchView }
}
