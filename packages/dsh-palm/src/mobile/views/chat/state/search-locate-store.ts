/**
 * 搜索 / 定位 / 翻页共用的那块状态（S5-1：给一批无名的 ref 一个家）。
 *
 * 为什么需要它：这三件事在 `ChatView` 里是**同一个闭包** —— 定位要用搜索的
 * `markOfHit` / `gotoRenderedMatch`，搜索要用定位的翻页 ref，翻页要用两者的落点记忆。
 * 单独把任何一半搬出去，都只能得到一个 30~40 个参数的 seam（2026-11-17 实测两次）。
 *
 * 所以先立一个普通对象：按会话创建一次，谁都可以拿着它读写。等它们都读这块状态了，
 * 再谈"谁负责算"—— 顺序反了就是白搬。
 *
 * @module dsh-palm/mobile/views/chat/state/search-locate-store
 */

import type { RenderMessage } from '../../../render/messages.ts'

/*

/** 一局会话的搜索/定位/翻页状态。字段名保持与搬出前一致，便于对照。 */
export interface SearchLocateStore {
  pendingTurnOccurrenceRef: { current: number }
  pendingTurnPagesRef: { current: number }
  locateVerifyTokenRef: { current: number }
  pendingTurnStallsRef: { current: number }
  pendingTurnRowCountRef: { current: number }
  chatSearchComposingRef: { current: boolean }
  chatSearchTermRef: { current: string }
  indexPollCountRef: { current: number }
  indexPollTermRef: { current: string }
  focusOccurrenceRef: { current: number }
  focusAttemptsRef: { current: number }
  focusJumpedRef: { current: boolean }
  focusRowFirstRef: { current: boolean }
  focusScrolledRef: { current: boolean }
  locateSettleRef: { current: number }
  openLocateDoneRef: { current: boolean }
  titleOnlyToastRef: { current: boolean }
  locatingRef: { current: boolean }
  searchPrefillRef: { current: string }
  rawPageRef: { current: RenderMessage[] }
  pendingTurnSeqRef: { current: number | undefined }
  pendingTurnNumberRef: { current: number | undefined }
  pendingTurnPartIdRef: { current: string | undefined }
  pendingTurnMessageIdRef: { current: string | undefined }
  pendingTurnSnippetRef: { current: string | undefined }
  pendingTurnAtRef: { current: number | undefined }
  chatSearchAbortRef: { current: AbortController | undefined }
  lastChatLandingRef: { current: { rowId: string; occurrence: number } | undefined }
  forcedPageKeysRef: { current: Set<string> }
  focusTargetRef: { current: number | undefined }
}

/**
 * 创建一局会话的状态。
 *
 * @returns 全新的 {@link SearchLocateStore}（换会话就换一份）
 */
export function createSearchLocateStore(): SearchLocateStore {
  return {
    rawPageRef: { current: [] },
    pendingTurnSeqRef: { current: undefined },
    pendingTurnNumberRef: { current: undefined },
    pendingTurnPartIdRef: { current: undefined },
    pendingTurnMessageIdRef: { current: undefined },
    pendingTurnSnippetRef: { current: undefined },
    pendingTurnAtRef: { current: undefined },
    chatSearchAbortRef: { current: undefined },
    lastChatLandingRef: { current: undefined },
    forcedPageKeysRef: { current: (() => new Set())() },
    focusTargetRef: { current: undefined },
    pendingTurnOccurrenceRef: { current: 0 },
    pendingTurnPagesRef: { current: 0 },
    locateVerifyTokenRef: { current: 0 },
    pendingTurnStallsRef: { current: 0 },
    pendingTurnRowCountRef: { current: -1 },
    chatSearchComposingRef: { current: false },
    chatSearchTermRef: { current: '' },
    indexPollCountRef: { current: 0 },
    indexPollTermRef: { current: '' },
    focusOccurrenceRef: { current: 0 },
    focusAttemptsRef: { current: 0 },
    focusJumpedRef: { current: false },
    focusRowFirstRef: { current: false },
    focusScrolledRef: { current: false },
    locateSettleRef: { current: 0 },
    openLocateDoneRef: { current: false },
    titleOnlyToastRef: { current: false },
    locatingRef: { current: false },
    searchPrefillRef: { current: '' },
  }
}
