/**
 * 定位状态机（纯函数）。
 *
 * ## 它替换的是什么
 *
 * 2026-11-12 之前，ChatView 里用 183 行 effect + 13 个 ref 决定「这次定位走到哪了」：
 * `focusPendingRef` / `focusMessageIdRef` / `focusPartIdRef` / `focusAttemptsRef` /
 * `focusJumpedRef` / `focusTargetRef` / `focusRowFirstRef` / `focusScrolledRef` /
 * `openLocateDoneRef` / `locatingRef` … 没有任何一处能回答这个问题，于是每冒一个
 * 边界就加一个 `if`，而每个 `if` 都可能提前锁死闸门。真机实测到的形态：
 *
 * ```
 * [locate] {rows:0, loading:false, done:false}   ← 首屏数据还没落地
 * [locate] {rows:9, loading:false, done:true }   ← 已经放弃，9 行到了也不跳
 * ```
 *
 * ## 一条不变量
 *
 * **`waiting-data` 只有两条出边：`need-page` / `ready`。没有一条通向 `not-found`。**
 *
 * 「手里一行都没有」不是「找不到」的证据 —— 这句话在代码里由一个状态转移表
 * 保证，而不是靠某个 `if` 拦着。下面的测试单独钉住它。
 *
 * @module dsh-palm/mobile/views/chat/lib/locate-machine
 */
import { findRow, findRowByQuery, buildRowIndex, type IndexableRow, type LocateAnchor } from './locate-anchor.ts'

/** 定位现在处在哪一步。 */
export type LocatePhase =
  /** 没有定位意图（普通打开会话）。 */
  | { kind: 'idle' }
  /** 有意图，但首屏一行都还没到 —— **只能等**。 */
  | { kind: 'waiting-data' }
  /** 目标不在当前窗口，且还有更早历史可翻。 */
  | { kind: 'need-page'; cursor?: number }
  /** 目标已在窗口里，等待落到它上面。 */
  | { kind: 'ready'; rowIndex: number }
  /** 已经滚到并打过焦点。 */
  | { kind: 'landed'; rowIndex: number }
  /** 终态：翻完历史仍没有。 */
  | { kind: 'not-found'; reason: 'exhausted' | 'absent' }

/** 状态机的输入：一次渲染能拿到的全部事实。 */
export interface LocateInput {
  /** 当前窗口里的行。 */
  rows: readonly IndexableRow[]
  /** 解析出来的锚点（`intentToAnchor` 的结果）。 */
  anchor: LocateAnchor | undefined
  /** 还有更早的历史可以翻。 */
  hasOlder: boolean
  /** 是否已有翻页请求在飞（在飞时不要再发，也不要烧预算）。 */
  pending: boolean
  /** 已经翻了几页。 */
  attempts: number
  /** 最多翻几页。 */
  maxAttempts: number
  /** 锚点只有关键词时的兜底词。 */
  query: string
  /**
   * 已知的目标 seq（`message` 锚点也可能带）。给了就**直跳目标那一页**，
   * 不从尾部一页页往回翻 —— 深历史命中否则要几十次串行 RPC。
   */
  jumpSeq?: number
}

/** 状态机给出的下一步动作。 */
export type LocateAction =
  /** 什么都不做（等数据）。 */
  | { type: 'wait' }
  /** 取一页更早的历史；`jump` 给了就直接跳到该 seq 附近。 */
  | { type: 'fetch'; jump?: number }
  /** 落到这一行。 */
  | { type: 'land'; rowIndex: number }
  /** 明确放弃，必须给用户一句话。 */
  | { type: 'give-up'; reason: 'exhausted' | 'absent' }

/** 一次转移的结果。 */
export interface LocateStep {
  state: LocatePhase
  action: LocateAction
}

const MAX_FETCH_PAGES = 6

/**
 * 推进一格。
 *
 * @param state - 当前状态
 * @param input - 这一帧的事实
 * @returns 新状态 + 要执行的动作（都是新对象，不原地改）
 */
export function stepLocate(state: LocatePhase, input: LocateInput): LocateStep {
  switch (state.kind) {
    case 'landed':
    case 'not-found':
      // 终态不再动：定位是一次性意图，之后焦点归会话内搜索/轮次跳转所有。
      return { state, action: { type: 'wait' } }

    case 'idle':
      if (input.anchor === undefined) return { state, action: { type: 'wait' } }
      return { state: { kind: 'waiting-data' }, action: { type: 'wait' } }

    case 'waiting-data':
    case 'need-page':
      return resolve(state, input)

    case 'ready':
      // 已经认到行：交给执行器落点，然后进 landed。
      return { state: { kind: 'landed', rowIndex: state.rowIndex }, action: { type: 'land', rowIndex: state.rowIndex } }
  }
}

/** `waiting-data` / `need-page` 共用的一次「重新看一遍窗口里的行」。 */
function resolve(state: LocatePhase, input: LocateInput): LocateStep {
  const anchor = input.anchor
  if (anchor === undefined) {
    return { state: { kind: 'idle' }, action: { type: 'wait' } }
  }

  /*
   * **一行都没有：这是「数据还没到」，不是「找不到」。**
   *
   * 唯一允许的出口是继续待在 waiting-data 里等下一次渲染。绝不产生 give-up ——
   * 这条保证就是整个文件存在的理由。
   */
  if (input.rows.length === 0) {
    return { state: { kind: 'waiting-data' }, action: { type: 'wait' } }
  }

  const index = buildRowIndex(input.rows)
  const direct = findRow(index, anchor)
  if (direct >= 0) {
    return { state: { kind: 'ready', rowIndex: direct }, action: { type: 'wait' } }
  }

  // 锚点是 seq/query 时 findRow 必然 -1：seq 不是下标，得在窗口里比大小。
  const bySeq = anchor.kind === 'seq' ? findRowBySeq(input.rows, anchor.seq) : -1
  if (bySeq >= 0) {
    return { state: { kind: 'ready', rowIndex: bySeq }, action: { type: 'wait' } }
  }

  /*
   * 关键词兜底**只允许在历史翻完之后**：否则会把深历史的命中落到窗口里最早的
   * 一条同词消息上（真机：「搜最新的一条，落到了历史中段」）。
   */
  const exhausted = !input.hasOlder || input.attempts >= Math.min(input.maxAttempts, MAX_FETCH_PAGES)
  if (exhausted) {
    if (anchor.kind === 'query' && input.query !== '') {
      const byQuery = findRowByQuery(input.rows, input.query)
      if (byQuery >= 0) return { state: { kind: 'ready', rowIndex: byQuery }, action: { type: 'wait' } }
    }
    return { state: { kind: 'not-found', reason: 'exhausted' }, action: { type: 'give-up', reason: 'exhausted' } }
  }

  // 还有更早的历史：在飞就别再发（那一页回来会再触发一次），也别烧预算。
  if (input.pending) return { state: { kind: 'need-page', cursor: stateCursor(state) }, action: { type: 'wait' } }

  /*
   * 已知 seq 就直跳目标那一页。注意**不看锚点种类**：`message` 锚点往往也带着
   * 搜索索引给的 seq，原来只有 `seq` 锚点才 jump，于是「按 messageId 找不到」
   * 的深历史命中退化成从尾部一页页翻（真机测试直接抓到 beforeSeq 错成当前最早行）。
   */
  const jumpSeq = input.jumpSeq ?? (anchor.kind === 'seq' ? anchor.seq : undefined)
  const cursor = jumpSeq === undefined ? undefined : jumpSeq + 1
  return {
    state: { kind: 'need-page', cursor },
    action: cursor === undefined ? { type: 'fetch' } : { type: 'fetch', jump: cursor },
  }
}

function stateCursor(state: LocatePhase): number | undefined {
  return state.kind === 'need-page' ? state.cursor : undefined
}

/** 第一个 `seq >= target` 的行的下标（-1 表示这一页都更早）。 */
export function findRowBySeq(rows: readonly IndexableRow[], target: number): number {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] as IndexableRow & { seq?: number; startSeq?: number }
    const seq = row.startSeq ?? row.seq
    if (seq !== undefined && seq >= target) return i
  }
  return -1
}

/**
 * **无状态版本**：目标不在当前窗口时该怎么走（2026-11-12 补）。
 *
 * `stepLocate` 需要调用方持有 `LocatePhase`，而那个状态在 ChatView 里活不过一次
 * 重挂载 —— 实测 53 次进状态机，每次读到的都是 `idle`（试过 `useSessionRef`、
 * 普通 `useRef`、渲染期幂等三种存法，全部无效）。
 *
 * 结论是：**决定「下一步做什么」本来就不需要一个存活的状态对象**。翻到第几页
 * 记在 `attempts`、跳没跳过记在 `jumped`、是否已落点记在 `landed` —— 这些都在
 * 调用方已有的 ref 里。把它们喂进来，纯函数直接给动作，组件重挂载多少次都不影响。
 *
 * 和原来那段 if 链**逐条等价**，但它现在有测试（`locate-machine.test.ts`）。
 */
export interface MissInput {
  /** 当前窗口里的行数。0 表示数据还没到 —— **只等，不判失败**。 */
  rows: number
  hasOlder: boolean
  /** 已经翻了几页。 */
  attempts: number
  maxAttempts: number
  /** 有翻页请求在飞。 */
  pending: boolean
  /** 已知的目标 seq（给了就直跳那一页）。 */
  jumpSeq?: number
  /** 是否已经直跳过（只跳一次，之后一页页往前翻）。 */
  jumped: boolean
}

/** 目标不在窗口时该做什么。 */
export function decideMiss(input: MissInput): LocateAction {
  // 一行都没有 ≠ 找不到：等首屏。这条不变量由下面的测试穷举钉住。
  if (input.rows === 0) return { type: 'wait' }
  if (input.hasOlder && input.attempts < Math.min(input.maxAttempts, MAX_FETCH_PAGES)) {
    // 在飞的那一页落地后会再触发一次，别重复发、也别烧预算。
    if (input.pending) return { type: 'wait' }
    if (!input.jumped && input.jumpSeq !== undefined) return { type: 'fetch', jump: input.jumpSeq + 1 }
    return { type: 'fetch' }
  }
  return { type: 'give-up', reason: 'exhausted' }
}
