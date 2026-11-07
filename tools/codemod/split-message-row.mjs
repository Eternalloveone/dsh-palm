/**
 * 一次性拆分 script（W2-3）：把 message-row.tsx 拆成
 *   message-row/anchors.ts      轮次锚点（已单独存在，这里只删源文件里的副本）
 *   message-row/attachments.tsx 附件与图片（已单独存在）
 *   message-row/process.tsx     过程组（思考+工具折叠）
 *   message-row/artifacts.tsx   助手正文与产物卡片
 * message-row.tsx 只留 MessageRow 本身。
 *
 * 用 Node 而不是 PowerShell：pwsh 的 Get-Content 默认按 ANSI 读，中文会写坏
 * （这次已经踩过一次，靠 git checkout 还原）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DIR = 'packages/dsh-palm/src/mobile'
const FILE = `${DIR}/message-row.tsx`
const lines = readFileSync(FILE, 'utf8').split('\n')

/** 从 from 开始找第一行满足 pred 的下标。 */
function find(pred, from = 0) {
  for (let index = from; index < lines.length; index += 1) if (pred(lines[index])) return index
  return -1
}
/** 找 `/**` 开头、下一行含 marker 的文档注释。 */
function docStart(marker) {
  const anchor = find(line => line.includes(marker))
  if (anchor === -1) throw new Error(`找不到标记：${marker}`)
  let index = anchor
  while (index > 0 && lines[index].trim().startsWith('*')) index -= 1
  if (lines[index].trim() !== '/**') throw new Error(`标记 ${marker} 前没有 /**`)
  return index
}

const iType = find(line => line.startsWith('export type RegenerateState'))
if (iType === -1) throw new Error('找不到 RegenerateState')
const iForget = find(line => line.startsWith('export function forgetTurnAnchor'), iType)
const iEndA = find(line => line.trim() === '}', iForget)
const iAttachDoc = docStart('一条消息里的文件附件')
const iProcessDoc = docStart('Per-step body of a coalesced turn')
const iArtifactsDoc = docStart('Consecutive tool parts merge into one artifact card')

if (!(iType < iEndA && iEndA < iAttachDoc && iAttachDoc < iProcessDoc && iProcessDoc < iArtifactsDoc)) {
  throw new Error(`边界异常：${[iType, iEndA, iAttachDoc, iProcessDoc, iArtifactsDoc].join(',')}`)
}

const head = lines.slice(0, iType)
const between = lines.slice(iEndA + 1, iAttachDoc)
const processBlock = lines.slice(iProcessDoc, iArtifactsDoc)
const artifactsBlock = lines.slice(iArtifactsDoc)

const imports = [
  "import { forgetTurnAnchor, stableTurnAnchor, type RegenerateState } from './message-row/anchors.ts'",
  "import { MessageFiles, MessageImages } from './message-row/attachments.tsx'",
  "import { AssistantBody } from './message-row/artifacts.tsx'",
  "import { ProcessGroup } from './message-row/process.tsx'",
  '',
  '// 兼容旧调用点：锚点逻辑在 message-row/anchors.ts，公开 API 不变。',
  "export { forgetTurnAnchor, resetTurnAnchors, stableTurnAnchor } from './message-row/anchors.ts'",
  '',
]

writeFileSync(FILE, [...head, ...imports, ...between].join('\n'))
writeFileSync(`${DIR}/message-row/process.tsx`, [
  '/**',
  ' * 一轮的「过程组」：思考与工具调用折叠成一行。',
  ' *',
  ' * 从 message-row.tsx 拆出来（W2-3）：过程组自带折叠/展开、计时、步骤高亮，',
  ' * 与消息卡片的排版无关；拆开后 message-row.tsx 只回答「一行消息长什么样」。',
  ' *',
  ' * @module dsh-palm/mobile/message-row/process',
  ' */',
  "import { Fragment, useEffect, useState, type ReactNode } from 'react'",
  "import type { RenderMessage, ToolCallInfo } from '../messages.ts'",
  "import { MarkdownText } from '../markdown-text.tsx'",
  'import {',
  '  diffTallyOf,',
  '  formatDuration,',
  '  isRowRunning,',
  '  processErrorsText,',
  '  processFilesText,',
  '  processHeadText,',
  '  processModel,',
  '  processStateText,',
  '  processStepsText,',
  '  processTimeText,',
  '  visibleRowCount,',
  '  type ProcessModel,',
  '  type ProcessOutcome,',
  '  type ProcessReasoningRow,',
  "} from '../process-rows.ts'",
  "import { stepModel, type StepVariant } from '../step-view.ts'",
  "import { Button } from '../ui/primitives.tsx'",
  '',
  ...processBlock.map(line => line.replace(/^function ProcessGroup\(/, 'export function ProcessGroup(')),
].join('\n'))
writeFileSync(`${DIR}/message-row/artifacts.tsx`, [
  '/**',
  ' * 助手正文与产物卡片：思考/工具之外那段「真正读的东西」。',
  ' *',
  ' * 从 message-row.tsx 拆出来（W2-3）。',
  ' *',
  ' * @module dsh-palm/mobile/message-row/artifacts',
  ' */',
  ...artifactsBlock.map(line => line.replace(/^function AssistantBody\(/, 'export function AssistantBody(')),
].join('\n'))

console.log(`[split] message-row.tsx: ${lines.length} → ${head.length + imports.length + between.length} 行`)
console.log(`[split] process.tsx: ${processBlock.length} 行；artifacts.tsx: ${artifactsBlock.length} 行`)
