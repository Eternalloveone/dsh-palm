/**
 * **host 路 搜索文本提取基**（W5-1：从 `mobile-api.ts` 抽出的第七个基）。
 *
 * 一条消息里**哪些字能被搜到**，只有一个判据：正文可见的部分。思考链（`think`）、
 * 工具调用参数与结果、围栏代码块**都不算**——搜索命中必须是用户在会话里看得见的那句话，
 * 不能埋在折叠的思考或工具载荷里。
 *
 * 2026-11-13：判据本身搬到 `mobile/render/search-corpus.ts`（手机端本地计数也要用同一份，
 * 否则宿主只索引答案、客户端却把过程/思考也算进计数 →「数字在动、画面不跳」）。
 * 这里只保留 `documentRows`（宿主入库用）与转出口，行为不变。
 *
 * @module dsh-palm/host/search-text
 */
import { searchCorpusOf } from '../mobile/render/search-corpus.ts'
import type { RenderMessage } from '../mobile/render/messages.ts'

export { excludedText, rowSearchableText, searchCorpusOf, searchableText, stripHiddenAssistantText } from '../mobile/render/search-corpus.ts'

export interface SearchDocumentRow {
  seq: number
  messageId?: string
  partId?: string
  text: string
  folded: string
  user: boolean
  /**
   * 结构坐标（2026-11-12，图谱寻址）：这条正文属于第几轮、第几步。
   * 手机端拿到它能直接按「轮:步」查行，不必靠 seq 猜。
   * 缺失时为 undefined（未知），调用方不要补 0 冒充已知。
   */
  turn?: number
  step?: number
}

export function documentRows(rows: readonly RenderMessage[]): SearchDocumentRow[] {
  const result: SearchDocumentRow[] = []
  for (const row of rows) {
    const corpus = searchCorpusOf(row)
    if (corpus === undefined) continue
    result.push({
      seq: corpus.seq,
      messageId: row.id,
      ...(corpus.partId === undefined ? {} : { partId: corpus.partId }),
      text: corpus.text,
      folded: corpus.text.toLowerCase(),
      user: row.kind === 'user',
      // 结构坐标原样带上：`RenderMessage` 上就有（projections/types.ts:120,147），
      // 不补默认值——不知道就留空，让调用方知道"这里没有坐标"。
      ...(row.turn === undefined ? {} : { turn: row.turn }),
      ...(row.step === undefined ? {} : { step: row.step }),
    })
  }
  return result
}
