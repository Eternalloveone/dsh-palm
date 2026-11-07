/**
 * 输入框草稿（按会话持久化到 localStorage）。
 *
 * 从 `ChatView` 搬出来的（S4c）。三条规则都是从真机返工里来的，别"简化"：
 * - 恢复不是只在首次挂载做一次：聊天页常常先以"还没有 session"的形态挂上，
 *   等到真 sessionId 才补一次（否则切走再回来草稿永远空）；
 * - "用户删光了"必须按**非空 → 空**的状态迁移判，不能按"当前是空"判
 *   （恢复草稿那一帧 save effect 还会用旧空值跑一次，会把刚恢复的草稿删掉）；
 * - 卸载 / 切会话要立刻 flush（防抖定时器可能根本没机会跑到）。
 */
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { loadDraft, removeDraft, saveDraft } from '../../../list-persist.ts'

/** 草稿落盘的防抖窗口。 */
export const DRAFT_SAVE_DEBOUNCE_MS = 1_500

export interface ChatDraft {
  input: string
  setInput: Dispatch<SetStateAction<string>>
}

export function useChatDraft(sessionId: string): ChatDraft {
  const [input, setInput] = useState(() => loadDraft(sessionId))
  /** Live mirror of `input` for the unmount draft flush (the cleanup closure
   *  would otherwise see the value from the render it was created in). */
  const inputRef = useRef(input)
  inputRef.current = input

  /**
   * 进会话时把草稿恢复回来（2026-10-31 修）：只在该会话**还没恢复过**、且输入框
   * 仍为空时填。
   */
  const draftRestoredRef = useRef<string | undefined>(undefined)
  /**
   * 这个会话的草稿**已经处理过一次**（恢复过、或确认本来就没有）。
   *
   * 有了它，"输入框被清空"才能安全地解释成"用户删光了"而不是"还没恢复"——
   * 2026-11-01 真机：删干净后退出会话再进来，删掉的文字又冒出来（草稿没清）。
   */
  const draftReadyRef = useRef(false)
  useEffect(() => {
    if (draftRestoredRef.current === sessionId) return
    if (inputRef.current !== '') { draftRestoredRef.current = sessionId; draftReadyRef.current = true; return }
    const stored = loadDraft(sessionId)
    draftRestoredRef.current = sessionId
    draftReadyRef.current = true
    if (stored !== '') setInput(stored)
  }, [sessionId])

  /**
   * 上一次**非空**的输入内容，以及它属于哪个会话。
   *
   * 判"用户删光了"必须看**状态迁移**（非空 → 空），不能看"当前是空"：
   * 恢复草稿的那一帧里，save effect 还会用旧的空值跑一次，按"当前是空"判会
   * 把刚恢复的草稿立刻删掉（实测：写一半切走再回来，草稿没了）。
   */
  const lastNonEmptyInputRef = useRef('')
  const draftCacheSessionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (draftCacheSessionRef.current !== sessionId) {
      // 换会话：清掉"上一个会话的输入"，否则会用别的会话的内容做迁移判断。
      draftCacheSessionRef.current = sessionId
      lastNonEmptyInputRef.current = ''
    }
    if (input === '') {
      // 只有"非空 → 空"才算用户删光了，这时必须把草稿一起删掉，
      // 否则删掉的字下次进会话又回来（2026-11-01 真机）。
      if (lastNonEmptyInputRef.current !== '') {
        removeDraft(sessionId)
        lastNonEmptyInputRef.current = ''
      }
      return
    }
    lastNonEmptyInputRef.current = input
    const id = setTimeout(() => { saveDraft(sessionId, input) }, DRAFT_SAVE_DEBOUNCE_MS)
    return () => { clearTimeout(id) }
  }, [input, sessionId])

  useEffect(() => {
    return () => {
      // Unmount / session switch: flush the CURRENT text immediately (the
      // debounce timer may never fire if the view is torn down first).
      if (inputRef.current !== '') saveDraft(sessionId, inputRef.current)
    }
  }, [sessionId])

  return { input, setInput }
}
