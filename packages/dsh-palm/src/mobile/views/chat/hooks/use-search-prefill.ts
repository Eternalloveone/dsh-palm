/**
 * **带关键词进来时预填搜索框**（S2-L：从 `ChatView.tsx` 搬出）。
 *
 * 两个来源要分清：
 *
 * | 来源 | 该不该弹搜索框 |
 * |---|---|
 * | 意图表里的 `query`（从搜索命中点进来的） | **要**：用户就是来找这个词的 |
 * | props 的 `initialFocusQuery`（普通「进入并定位」） | **不要**：那条路径本来就不该弹 |
 *
 * 去重键是 `sessionId#query`：同一句查询在同一个会话里只预填一次，否则用户关掉搜索框后
 * 会被反复弹开。
 *
 * @module dsh-palm/mobile/views/chat/hooks/use-search-prefill
 */
import { useEffect, type MutableRefObject } from 'react'

import { locateIntentFor } from '../../../session/locate-intent.ts'

/** 依赖。 */
export interface SearchPrefillDeps {
  sessionId: string
  /** 上次预填的去重键（`sessionId#query`）。 */
  prefillRef: MutableRefObject<string>
  /** 打开搜索条。 */
  setOpen: (open: boolean) => void
  /** 填入搜索词。 */
  setTerm: (term: string) => void
}

/** 带关键词进来时预填搜索框（每个会话每句只预填一次）。 */
export function useSearchPrefill(deps: SearchPrefillDeps): void {
  const { sessionId, prefillRef, setOpen, setTerm } = deps
  useEffect(() => {
    const intent = locateIntentFor(sessionId)
    const query = (intent?.query ?? '').trim()
    if (query === '') return
    const key = `${sessionId}#${query}`
    if (prefillRef.current === key) return
    prefillRef.current = key
    setOpen(true)
    setTerm(query)
  }, [sessionId, prefillRef, setOpen, setTerm])
}
