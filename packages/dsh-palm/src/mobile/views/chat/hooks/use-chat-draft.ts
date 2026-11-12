/**
 * 输入框草稿（按会话持久化到 localStorage）。
 *
 * 从 `ChatView` 搬出来的（S4c）。三条规则都是从真机返工里来的，别"简化"：
 * - 恢复不是只在首次挂载做一次：聊天页常常先以"还没有 session"的形态挂上，
 *   等到真 sessionId 才补一次（否则切走再回来草稿永远空）；
 * - "用户删光了"必须按**非空 → 空**的状态迁移判，不能按"当前是空"判
 *   （恢复草稿那一帧 save effect 还会用旧空值跑一次，会把刚恢复的草稿删掉）；
 * - 卸载 / 切会话要立刻 flush（防抖定时器可能根本没机会跑到）。
 *
 * 2026-11-12（B3）：状态从 `useState` 换成模块级 store。
 * 原因：`useState` 住在 `ChatView` 里，每敲一个字符就把 4000 行的视图函数体重跑
 * 一遍 —— 10× 降频实测 **180 ms/字符**（1.5 s 内敲 10 个字符 = 1854 ms 脚本时间，
 * 而同长度空闲只有 57 ms）。换成 store 之后，只有订阅它的输入区叶子会重渲染，
 * `ChatView` 走 `useChatDraftController` 不订阅、只在真的需要时取值。
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { loadDraft, removeDraft, saveDraft } from '../../../session/list-persist.ts'

/** 草稿落盘的防抖窗口。 */
export const DRAFT_SAVE_DEBOUNCE_MS = 1_500

export interface ChatDraft {
  input: string
  setInput: Dispatch<SetStateAction<string>>
}

/** 不订阅的草稿入口：读当前值 / 写当前值（`ChatView` 用）。 */
export interface DraftControl {
  get: () => string
  set: Dispatch<SetStateAction<string>>
}

interface DraftStore {
  value: string
  listeners: Set<() => void>
}

/**
 * 按会话 id 的草稿 store。
 *
 * 模块级是有意的：`ChatView` 与输入区是两个订阅点，值必须只有一份；
 * 换会话时按 id 各存各的，和原来"每个会话一份 useState"的语义一致。
 */
const stores = new Map<string, DraftStore>()

function storeOf(sessionId: string): DraftStore {
  let store = stores.get(sessionId)
  if (store === undefined) {
    store = { value: loadDraft(sessionId), listeners: new Set() }
    stores.set(sessionId, store)
  }
  return store
}

/** 当前草稿值（可以在渲染期读，但不建立订阅）。 */
export function readDraft(sessionId: string): string {
  return storeOf(sessionId).value
}

function writeDraft(sessionId: string, next: SetStateAction<string>): void {
  const store = storeOf(sessionId)
  const value = typeof next === 'function' ? next(store.value) : next
  if (value === store.value) return
  store.value = value
  for (const listener of [...store.listeners]) listener()
}

/**
 * 订阅草稿变化：**不重渲染**，回调在值变的那一刻同步触发。
 *
 * 给"需要在打字时做点事但绝不能跟着重渲染"的地方用（`ChatView` 里懒拉命令目录
 * 那个 effect）。副作用式的落盘不走这里，见 `useDraftPersistence`。
 */
export function subscribeDraft(sessionId: string, listener: () => void): () => void {
  const store = storeOf(sessionId)
  store.listeners.add(listener)
  return () => {
    store.listeners.delete(listener)
    // 最后一个订阅者走了（换会话 / 视图卸载）：丢掉这份内存值。
    // 下次挂载 `storeOf` 会重新 `loadDraft` —— 等价于原来 useState 的
    // "每次挂载读一次存储"，也避免把上一轮的值当成本轮的草稿。
    if (store.listeners.size === 0) stores.delete(sessionId)
  }
}

/**
 * 纯订阅：只拿值，**不跑**草稿恢复 / 保存副作用（给输入区叶子用）。
 *
 * 副作用只属于 `useChatDraft` / `useChatDraftController`（一个实例、一个 flusher）；
 * 如果输入区也跑一套，恢复与 flush 会各跑两次，真机上表现为"删掉的草稿又回来"那类抖动。
 */
export function useDraftValue(sessionId: string): ChatDraft {
  const input = useSyncExternalStore(
    useCallback((listener: () => void) => subscribeDraft(sessionId, listener), [sessionId]),
    useCallback(() => readDraft(sessionId), [sessionId]),
    () => '',
  )
  const setInput = useCallback<Dispatch<SetStateAction<string>>>(
    (next) => { writeDraft(sessionId, next) },
    [sessionId],
  )
  return { input, setInput }
}

/** 不订阅：给 `ChatView` 用（打字时它不该重渲染）。 */
export function useDraftControl(sessionId: string): DraftControl {
  return useMemo(() => ({
    get: (): string => readDraft(sessionId),
    set: (next: SetStateAction<string>): void => { writeDraft(sessionId, next) },
  }), [sessionId])
}

/**
 * 恢复 / 防抖落盘 / 卸载 flush —— 一个视图只能有一个实例。
 *
 * 落盘不走 `input` 依赖，而是直接订阅 store：`ChatView` 已经不再因打字重渲染，
 * 靠渲染驱动的 effect 会永远看不到后续字符。
 */
function useDraftPersistence(sessionId: string, control: DraftControl): void {
  const draftRestoredRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (draftRestoredRef.current === sessionId) return
    if (control.get() !== '') { draftRestoredRef.current = sessionId; return }
    const stored = loadDraft(sessionId)
    draftRestoredRef.current = sessionId
    if (stored !== '') control.set(stored)
  }, [sessionId, control])

  /**
   * 上一次**非空**的值（flush 也读它，所以不能只活在 effect 里）。
   *
   * 判"用户删光了"必须看**状态迁移**（非空 → 空），不能看"当前是空"：
   * 恢复草稿的那一帧里，save effect 还会用旧的空值跑一次，按"当前是空"判会
   * 把刚恢复的草稿立刻删掉（实测：写一半切走再回来，草稿没了）。
   *
   * 存的是字符串而不是去 store 里读：切会话时 cleanup 先撤订阅，最后一个订阅者
   * 走掉会把 store 丢掉，此时再 `readDraft` 只会从 storage 重新读回旧值。
   */
  const lastNonEmptyRef = useRef('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    lastNonEmptyRef.current = ''
    const commit = (value: string): void => {
      if (saveTimerRef.current !== undefined) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = undefined
      }
      if (value === '') {
        // 只有"非空 → 空"才算用户删光了，这时必须把草稿一起删掉，
        // 否则删掉的字下次进会话又回来（2026-11-01 真机）。
        if (lastNonEmptyRef.current !== '') {
          removeDraft(sessionId)
          lastNonEmptyRef.current = ''
        }
        return
      }
      lastNonEmptyRef.current = value
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = undefined
        saveDraft(sessionId, value)
      }, DRAFT_SAVE_DEBOUNCE_MS)
    }
    commit(readDraft(sessionId))
    const unsubscribe = subscribeDraft(sessionId, () => { commit(readDraft(sessionId)) })
    return () => {
      unsubscribe()
      if (saveTimerRef.current !== undefined) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = undefined
      }
    }
  }, [sessionId])

  useEffect(() => {
    return () => {
      // Unmount / session switch: flush the CURRENT text immediately (the
      // debounce timer may never fire if the view is torn down first).
      if (lastNonEmptyRef.current !== '') saveDraft(sessionId, lastNonEmptyRef.current)
    }
  }, [sessionId])
}

/** 订阅型入口（测试 / 需要跟着重渲染的地方）。 */
export function useChatDraft(sessionId: string): ChatDraft {
  const draft = useDraftValue(sessionId)
  useDraftPersistence(sessionId, useDraftControl(sessionId))
  return draft
}

/** 不订阅入口：`ChatView` 用这个，打字时它不重渲染。 */
export function useChatDraftController(sessionId: string): DraftControl {
  const control = useDraftControl(sessionId)
  useDraftPersistence(sessionId, control)
  return control
}
