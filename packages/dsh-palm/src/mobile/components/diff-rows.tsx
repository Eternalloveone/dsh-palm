/**
 * 单文件 diff 的只读行视图（P6 ⑩ 屏的正文）。
 *
 * **只做呈现**：diff 的解析仍走 `render/diff.ts` 的 `parseDiff`（生成逻辑一行没改），
 * 这里只把 hunks 摊平成「行号 + 增删符号 + 内容」三列，并按行型上类名：
 *
 * - `diff-page-row-add`：新增行，浅绿底 + 绿色左侧条；
 * - `diff-page-row-del`：删除行，浅红底 + 红色左侧条；
 * - `diff-page-row-ctx`：上下文行，**不设底色**。
 *
 * 行号只有一列（定版图口径），统一按**新文件**计数：上下文行与新增行各占一个
 * 号，删除行显示它在新文件里的位置（不另占号）。所以整列只会向前走，不会出现
 * "旧文件第 40 行" 接在 "新文件第 10 行" 后面那种跳回。
 *
 * 超长行策略（2026-11-10 改）：**软换行**。原先是截断成一行 + 省略号，理由是横向
 * 滚动会滑掉行号；但截断等于把后半行藏起来，只读的 diff 页除了长按选中复制没有
 * 别的办法看全——而这页就是用来"看清改了什么"的。软换行既不横向滚，也不丢内容：
 * 缩进由 `pre-wrap` 保留，长标识符用 `overflow-wrap: anywhere` 断行。块上标
 * `data-overflow="wrap"` 把这条口径写死在结构上，单测据此断言。CSS 侧见
 * `styles/450-diff-page.css` 的 `.diff-page-text`。
 *
 * @module dsh-palm/mobile/components/diff-rows
 */
import { useMemo } from 'react'
import { parseDiff } from '../render/diff.ts'

/** 一行要画什么（hunk 分隔行没有行号/符号）。 */
interface DiffRowView {
  kind: 'add' | 'del' | 'ctx' | 'hunk'
  key: string
  /** 定版图只有一列行号：统一按新文件位置计数（删除行不另占号）。 */
  no?: number
  /** 增删符号（上下文行是空格）；装饰性的，读屏不读。 */
  sign: string
  text: string
}

/** 统一 diff 的 hunk 头：只有带它的文本才按 diff 解析（源码文件不当 diff 猜）。 */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m

/**
 * 这段文本是不是一份 unified diff。
 *
 * 判据只看 hunk 头：普通源码文件里极少出现 `@@ -a,b +c,d @@`。没有 hunk 头
 * （模型偶尔省略）时按普通文件显示——行首的 `+`/`-` 原样保留，不会被误染成增删。
 *
 * @param text - 文件原文或 diff 文本
 * @returns 有 hunk 头时为 true
 */
export function looksLikeDiff(text: string): boolean {
  return HUNK_HEADER.test(text)
}

/**
 * 把 diff（或普通文件）摊成显示行。
 *
 * @param text - unified diff 文本，或普通文件原文
 * @returns 显示行；空文本返回空数组
 */
function rowsOf(text: string): DiffRowView[] {
  if (text === '') return []

  if (!looksLikeDiff(text)) {
    // 不是 diff：逐行显示文件原文，全部算上下文行（无底色），行号就是文件行号。
    const lines = text.replace(/\r\n/g, '\n').split('\n')
    if (text.endsWith('\n')) lines.pop()
    return lines.map((line, index) => ({
      kind: 'ctx' as const,
      key: `line:${index}`,
      no: index + 1,
      sign: ' ',
      text: line,
    }))
  }

  const diff = parseDiff(text)
  const rows: DiffRowView[] = []
  diff.hunks.forEach((hunk, hunkIndex) => {
    // 单 hunk 不画分隔线（定版图里就没有）；多 hunk 才需要知道"跳了一段"。
    if (diff.hunks.length > 1) {
      rows.push({
        kind: 'hunk',
        key: `hunk:${hunkIndex}`,
        sign: ' ',
        text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      })
    }
    // 单列行号的游标：hunk 的新文件起始行，逐行推进。
    let newCursor = hunk.newStart
    hunk.lines.forEach((line, lineIndex) => {
      // 单列行号 = 新文件里的位置。删除行不占新行号，所以它和下一行同号；
      // 这样整列只会向前走（旧文件行号会在 hunk 起点不同时跳回去）。
      const no = newCursor
      if (line.type !== 'del') newCursor += 1
      rows.push({
        kind: line.type,
        key: `${hunkIndex}:${lineIndex}`,
        no,
        sign: line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ',
        text: line.text,
      })
    })
  })
  return rows
}

export interface DiffRowsProps {
  /** unified diff 文本，或普通文件原文（后者按上下文行显示）。 */
  text: string
}

/**
 * 渲染只读 diff 行。
 *
 * @param props - 文本
 * @returns 代码卡（行号列 + 增删符号列 + 内容列）
 */
export function DiffRows({ text }: DiffRowsProps) {
  const rows = useMemo(() => rowsOf(text), [text])

  return (
    <div className="diff-page-block" data-overflow="wrap">
      <div className="diff-page-lines">
        {rows.map(row => (row.kind === 'hunk' ? (
          <div key={row.key} className="diff-page-hunk" aria-hidden="true">{row.text}</div>
        ) : (
          <div
            key={row.key}
            className={`diff-page-row diff-page-row-${row.kind}`}
            data-line-kind={row.kind}
          >
            <span className="diff-page-no" aria-hidden="true">{row.no ?? ''}</span>
            <span className="diff-page-sign" aria-hidden="true">{row.sign}</span>
            <span className="diff-page-text">{row.text === '' ? '\u00A0' : row.text}</span>
          </div>
        )))}
      </div>
    </div>
  )
}
