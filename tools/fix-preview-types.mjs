import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'kernels', 'preview-slice.ts')
let text = readFileSync(P, 'utf8')

text = text.replace(
  `/** 折事件的最小形状（真实实现是 render/messages 的 foldEvents）。 */
type FoldFn = (events: unknown[]) => Array<{ text?: string; reasoning?: string }>

/** 摘要压缩（真实实现是 render/ui-text 的 previewSummary）。 */
type SummarizeFn = (source: string) => string

/** 尾页读取（真实实现是 data/list 的 history）。 */
type HistoryFn = (
  sessionId: string,
  before?: string,
  maxMessages?: number,
  signal?: AbortSignal,
) => Promise<{ events: Array<{ event: unknown }> }>`,
  `import type { WireEvent } from '../render/messages.ts'

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
) => Promise<{ events: ReadonlyArray<{ event: WireEvent }> }>`,
)

text = text.replace(
  `      const source = (message.text ?? '') !== '' ? message.text! : message.reasoning ?? ''`,
  `      const source = message.text !== '' ? message.text : message.reasoning ?? ''`,
)

writeFileSync(P, text)
console.log('types 已对齐真实实现')
