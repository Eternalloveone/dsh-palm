/**
 * 一次性改造（W2-2）：把 ProcessRows 的"遍历 + flush"换成 toVM + 块注册表。
 *
 * 用 Node 而不是 pwsh：源码里有中文注释，pwsh 的 Get-Content 会按 ANSI 读坏。
 * 注意：本文件里不要用反引号模板字符串拼 JSX（里面本来就有反引号）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'packages/dsh-palm/src/mobile/message-row/process.tsx'
let text = readFileSync(path, 'utf8')

/* ── 1. 换掉 ProcessRows 的循环体 ────────────────────────────────── */
const bodyStartMarker = '  const nodes: ReactNode[] = []'
const bodyEndMarker = '  return <>{nodes}</>'
const start = text.indexOf(bodyStartMarker)
const endMarkerAt = text.indexOf(bodyEndMarker)
// 文件可能是 CRLF：不假设 `\n}` 紧邻，找到 return 之后再定位函数结尾那个 `}`。
const end = endMarkerAt === -1 ? -1 : text.indexOf('}', endMarkerAt)
if (start === -1 || end === -1) throw new Error('找不到循环体：' + start + ' / ' + end)
const newBody = [
  '  const blocks = useMemo(',
  '    () => toVM(model, { showToolCalls, pending: message.pending === true, stepSeqs: message.stepSeqs }),',
  '    [model, showToolCalls, message.pending, message.stepSeqs],',
  '  )',
  '  const ctx: ProcessBlocksContext = { message, focusedQuery, focusExpand, sessionId }',
  '  return <BlockList blocks={blocks} registry={PROCESS_BLOCK_REGISTRY} ctx={ctx} />',
  '}',
].join('\n')
text = text.slice(0, start) + newBody + text.slice(end + 1)

/* ── 2. 在 ProcessRows 前插入上下文类型 + 注册表 + 正文渲染器 ───────── */
const BT = String.fromCharCode(96)
const insertionPoint = 'function ProcessRows({ message, model, showToolCalls, focusedQuery, focusExpand, sessionId }: {'
const block = [
  '/** 展开体的渲染上下文：正文高亮、定位展开、会话 id 都从这里取。 */',
  'interface ProcessBlocksContext {',
  '  message: RenderMessage',
  '  focusedQuery?: string',
  '  focusExpand?: boolean',
  '  sessionId?: string',
  '}',
  '',
  '/**',
  ' * 块的渲染器表：**新增一种块 = 这里加一行 + 写样式**，不再动遍历逻辑。',
  ' * 表是纯数据（kind → 组件），插件也能用 mergeRegistry 追加自己的块。',
  ' */',
  'const PROCESS_BLOCK_REGISTRY: BlockRegistry<ProcessBlocksContext> = {',
  '  reasoning: ({ block }) => (block.kind === \'reasoning\' ? <ThinkBlock row={block.row} /> : null),',
  '  tool: ({ block }) => (block.kind === \'tool\' ? <ToolStep tool={block.tool} /> : null),',
  '  \'tool-group\': ({ block }) => (block.kind === \'tool-group\' ? <ArtifactCards tools={[...block.tools]} /> : null),',
  '  text: ({ block, ctx }) => (block.kind === \'text\' ? renderTextBlock(block, ctx) : null),',
  '}',
  '',
  '/** 正文块：有步骤号的包一层 data-step-seq，会话内搜索才能滚到这一步。 */',
  'function renderTextBlock(block: Extract<MessageBlock, { kind: \'text\' }>, ctx: ProcessBlocksContext): ReactNode {',
  '  const body = (',
  '    <MarkdownText',
  '      text={block.text}',
  '      pending={ctx.message.pending === true}',
  '      forceOpen={ctx.focusedQuery !== undefined}',
  '      highlightQuery={ctx.focusedQuery}',
  '      sessionId={ctx.sessionId}',
  '    />',
  '  )',
  '  if (block.seq === undefined) return body',
  '  return <div className="chat-flow-text" data-step-seq={block.seq} data-part-id={' + BT + 'text-${block.index}' + BT + '}>{body}</div>',
  '}',
  '',
].join('\n')
text = text.replace(insertionPoint, block + insertionPoint)

/* ── 3. 补 import ───────────────────────────────────────────────── */
const importAnchor = "import { ArtifactCards } from './artifact-cards.tsx'"
if (!text.includes(importAnchor)) throw new Error('找不到 import 锚点')
text = text.replace(
  importAnchor,
  [
    importAnchor,
    "import { BlockList, type BlockRegistry } from './block-registry.tsx'",
    "import { toVM } from './to-vm.ts'",
    "import type { MessageBlock } from './types.ts'",
  ].join('\n'),
)
text = text.replace(
  "import { Fragment, useEffect, useState, type ReactNode } from 'react'",
  "import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'",
)

writeFileSync(path, text)
console.log('[w2-2] ProcessRows → toVM + BlockList')
