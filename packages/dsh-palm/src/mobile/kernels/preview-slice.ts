/**
 * 会话行摘要切片（P3：从 SessionListView 里抽出的取数逻辑）。
 *
 * 列表每一行要显示「最后一条消息」的短摘要。做法是折 **history 尾页的最后一条**
 * 消息（`maxMessages=1`）——一条消息的事件组只有几 KB，而整页 25 条在弱网下是
 * 列表页最大的传输开销；折完取正文（没有正文就用推理）压成一句摘要。
 *
 * 任何失败都返回 `undefined`：那一行回落到统计行，列表不会因为一个会话读失败而空。
 *
 * @module dsh-palm/mobile/kernels/preview-slice
 */

import type { WireEvent } from '../render/messages.ts'

/** 折事件（真实实现是 render/messages 的 foldEvents）。 */
type FoldFn = (events: readonly WireEvent[]) => ReadonlyArray<{ text: string; reasoning?: string }>

/** 摘要压缩（真实实现是 render/ui-text 的 previewSummary）。 */
type SummarizeFn = (source: string) => string

/** 尾页读取（真实实现是 data/list 的 history）。 */
type HistoryFn = (
  sessionId: string,
  before?: number,
  maxMessages?: number,
  signal?: AbortSignal,
  timeoutMs?: number,
) => Promise<{ events: ReadonlyArray<{ event: WireEvent }> }>

/** 摘要切片的依赖。 */
export interface PreviewSliceDeps {
  history: HistoryFn
  foldEvents: FoldFn
  previewSummary: SummarizeFn
}

/**
 * 取一个会话的最后一条消息摘要（尽力而为）。
 *
 * @param deps - 注入的读取/折叠/压缩实现，便于单测
 * @returns 摘要文本；读不到或折出来是空的都返回 `undefined`
 */
export async function fetchSessionPreview(
  deps: PreviewSliceDeps,
  sessionId: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const page = await deps.history(sessionId, undefined, 1, signal)
    const rendered = deps.foldEvents(page.events.map(entry => entry.event))
    for (let i = rendered.length - 1; i >= 0; i--) {
      const message = rendered[i]
      if (message === undefined) continue
      const source = message.text !== '' ? message.text : message.reasoning ?? ''
      const summary = deps.previewSummary(source)
      if (summary !== '') return summary
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 以固定并发度跑一组异步任务（顺序无关，全部跑完才返回）。
 *
 * 用来给预览取数限流：一次首屏可能几十个会话，无脑并发会把隧道打满。
 */
export async function mapLimited<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      await run(item)
    }
  })
  await Promise.all(workers)
}
