/**
 * 二次拆分：artifacts.tsx 里「产物卡片」三个组件单独成文，
 * 目的是**打断循环依赖**：process.tsx 需要 ArtifactCards，artifacts.tsx 需要 ProcessGroup，
 * 两两互相 import 会形成环。把卡片抽到 artifact-cards.tsx 后依赖变单向。
 *
 * 同时把 WHALE_REST_PATH 从 message-row.tsx 挪进 process.tsx（拆分后只有它用）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DIR = 'packages/dsh-palm/src/mobile'
const read = file => readFileSync(`${DIR}/${file}`, 'utf8')
const write = (file, text) => writeFileSync(`${DIR}/${file}`, text)

/* ── 1. artifacts.tsx → artifact-cards.tsx ─────────────────────────── */
const artifactsLines = read('message-row/artifacts.tsx').split('\n')
const cut = artifactsLines.findIndex(line => line.startsWith('function ArtifactCards('))
if (cut === -1) throw new Error('找不到 ArtifactCards')
const cardsBlock = artifactsLines.slice(cut).map(line => {
  if (/^function (ArtifactCards|baseName|parentPath|fileBadgeLabel)\(/.test(line)) return 'export ' + line
  return line
})
write('message-row/artifact-cards.tsx', [
  '/**',
  ' * 产物卡片：一轮里模型写过的文件 / 跑过的命令，折叠成一张可展开的卡片。',
  ' *',
  ' * 从 message-row.tsx → artifacts.tsx → 再拆到这里（W2-3）：process.tsx 与',
  ' * artifacts.tsx 都要用它，放在任一侧都会成环。',
  ' *',
  ' * @module dsh-palm/mobile/message-row/artifact-cards',
  ' */',
  "import { useMemo, useRef, type Ref } from 'react'",
  "import type { ToolCallInfo, ToolDiffView } from '../messages.ts'",
  "import { diffTallyOf, toolDiffLines } from '../process-rows.ts'",
  "import { Button } from '../ui/primitives.tsx'",
  '',
  ...cardsBlock,
].join('\n'))
write('message-row/artifacts.tsx', [
  ...artifactsLines.slice(0, cut),
  "import { ArtifactCards } from './artifact-cards.tsx'",
  '',
].join('\n'))

/* ── 2. WHALE_REST_PATH → process.tsx ──────────────────────────────── */
const rowLines = read('message-row.tsx').split('\n')
const whaleAt = rowLines.findIndex(line => line.startsWith('const WHALE_REST_PATH'))
if (whaleAt === -1) throw new Error('找不到 WHALE_REST_PATH')
const whaleLine = rowLines[whaleAt]
// 连同上面的文档注释一起搬（从最近的 /** 到该行）
let docAt = whaleAt
while (docAt > 0 && !rowLines[docAt].startsWith('/**')) docAt -= 1
const whaleDoc = rowLines.slice(docAt, whaleAt + 1)
write('message-row.tsx', [...rowLines.slice(0, docAt), ...rowLines.slice(whaleAt + 1)].join('\n'))

const processText = read('message-row/process.tsx')
const marker = "import { Button } from '../ui/primitives.tsx'\n"
if (!processText.includes(marker)) throw new Error('process.tsx 找不到插入点')
write('message-row/process.tsx', processText.replace(marker, marker + '\n' + whaleDoc.join('\n') + '\n'))

console.log(`[split2] artifact-cards.tsx: ${cardsBlock.length} 行；artifacts.tsx: ${cut + 2} 行`)
console.log(`[split2] whale 文档 ${whaleDoc.length} 行已挪进 process.tsx`)
