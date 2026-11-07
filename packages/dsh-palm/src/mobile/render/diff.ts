/**
 * Unified-diff parsing and word-level diffing for the mobile chat's diff
 * view. Pure and dependency-free (the mobile bundle stays self-contained):
 * `parseDiff` turns the raw text of a ```diff fence into hunks of typed
 * lines with old/new line numbers, and `wordDiff` marks changed words
 * between a deleted and an added line via an LCS walk.
 *
 * The parser accepts the standard unified format:
 *
 *   --- a/src/main.ts
 *   +++ b/src/main.ts
 *   @@ -1,5 +1,6 @@
 *    context
 *   -removed
 *   +added
 *
 * plus the degenerate shapes models actually emit: no file headers, no
 * hunk headers (everything becomes one implicit hunk), and `\ No newline
 * at end of file` markers (skipped). Line numbers are derived from the
 * hunk headers when present, else counted from 1.
 * @module dsh-palm/mobile/diff
 */

/** One line of a diff hunk. */
export interface DiffLine {
  readonly type: 'add' | 'del' | 'ctx'
  /** Old-file line number (undefined for added lines). */
  readonly oldNo?: number
  /** New-file line number (undefined for removed lines). */
  readonly newNo?: number
  /** Line content without the leading + / - / space marker. */
  readonly text: string
  /**
   * Word-level marks for add/del lines, computed against the paired line
   * of the opposite type. Absent for context lines and for add/del lines
   * that were never paired (whole-line change).
   */
  readonly words?: readonly WordToken[]
}

/** One word token of a diffed line. */
export interface WordToken {
  readonly text: string
  /** 'same' = unchanged, 'add' = new word, 'del' = removed word. */
  readonly kind: 'same' | 'add' | 'del'
}

/** One `@@ -a,b +c,d @@` hunk. */
export interface DiffHunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly DiffLine[]
}

/** A parsed diff document. */
export interface ParsedDiff {
  /** `---` header path with the a/ prefix stripped (undefined when absent). */
  readonly oldFile?: string
  /** `+++` header path with the b/ prefix stripped (undefined when absent). */
  readonly newFile?: string
  readonly hunks: readonly DiffHunk[]
}

/** Mutable build shape (the public interfaces are readonly). */
interface MutableLine {
  type: 'add' | 'del' | 'ctx'
  oldNo?: number
  newNo?: number
  text: string
  words?: WordToken[]
}

interface MutableHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: MutableLine[]
}

/** Strip the standard a/ b/ prefixes from a diff header path. */
function stripPrefix(path: string): string {
  const trimmed = path.trim()
  return /^[ab]\//.test(trimmed) ? trimmed.slice(2) : trimmed
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Parse unified-diff text into hunks. Never throws: malformed input
 * degrades to a single implicit hunk of context lines.
 */
export function parseDiff(source: string): ParsedDiff {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  // A source ending with '\n' leaves a phantom trailing empty line (the
  // terminator of the last real line); drop exactly one so the diff view
  // and the result builder never carry a spurious empty context row.
  if (lines.length > 0 && lines[lines.length - 1] === '' && source.endsWith('\n')) {
    lines.pop()
  }
  let oldFile: string | undefined
  let newFile: string | undefined
  let i = 0

  // File headers (--- / +++), in either order, before the first hunk.
  while (i < lines.length) {
    const line = lines[i]!
    const oldHeader = /^---\s+(.*)$/.exec(line)
    if (oldHeader !== null) {
      oldFile = stripPrefix(oldHeader[1]!)
      i += 1
      continue
    }
    const newHeader = /^\+\+\+\s+(.*)$/.exec(line)
    if (newHeader !== null) {
      newFile = stripPrefix(newHeader[1]!)
      i += 1
      continue
    }
    break
  }

  const hunks: MutableHunk[] = []
  let current: MutableHunk | undefined
  let oldNo = 0
  let newNo = 0

  while (i < lines.length) {
    const line = lines[i]!
    const hunkMatch = HUNK_RE.exec(line)
    if (hunkMatch !== null) {
      current = {
        oldStart: Number(hunkMatch[1]),
        oldLines: hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
        newStart: Number(hunkMatch[3]),
        newLines: hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]),
        lines: [],
      }
      hunks.push(current)
      oldNo = current.oldStart
      newNo = current.newStart
      i += 1
      continue
    }
    if (current === undefined) {
      // No hunk header seen: everything from here is one implicit hunk.
      current = { oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines: [] }
      hunks.push(current)
      oldNo = 1
      newNo = 1
    }
    // "\ No newline at end of file" markers carry no diff content.
    if (line.startsWith('\\')) {
      i += 1
      continue
    }
    if (line.startsWith('+')) {
      current.lines.push({ type: 'add', newNo, text: line.slice(1) })
      newNo += 1
    } else if (line.startsWith('-')) {
      current.lines.push({ type: 'del', oldNo, text: line.slice(1) })
      oldNo += 1
    } else {
      current.lines.push({
        type: 'ctx',
        oldNo,
        newNo,
        text: line.startsWith(' ') ? line.slice(1) : line,
      })
      oldNo += 1
      newNo += 1
    }
    i += 1
  }

  pairWords(hunks)
  return {
    ...(oldFile !== undefined ? { oldFile } : {}),
    ...(newFile !== undefined ? { newFile } : {}),
    hunks: hunks.map(hunk => ({
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines: hunk.lines.map(line => ({
        type: line.type,
        ...(line.oldNo !== undefined ? { oldNo: line.oldNo } : {}),
        ...(line.newNo !== undefined ? { newNo: line.newNo } : {}),
        text: line.text,
        ...(line.words !== undefined ? { words: line.words } : {}),
      })),
    })),
  }
}

/**
 * Pair consecutive add/del runs inside each hunk and attach word-level
 * marks to the paired lines. A run of one type followed by a run of the
 * opposite type pairs by index; unpaired lines are whole-line changes.
 */
function pairWords(hunks: readonly MutableHunk[]): void {
  for (const hunk of hunks) {
    const lines = hunk.lines
    let i = 0
    while (i < lines.length) {
      const type = lines[i]!.type
      if (type !== 'add' && type !== 'del') {
        i += 1
        continue
      }
      const first: MutableLine[] = []
      while (i < lines.length && lines[i]!.type === type) {
        first.push(lines[i]!)
        i += 1
      }
      const opposite = type === 'add' ? 'del' : 'add'
      const second: MutableLine[] = []
      while (i < lines.length && lines[i]!.type === opposite) {
        second.push(lines[i]!)
        i += 1
      }
      const pairs = Math.max(first.length, second.length)
      for (let k = 0; k < pairs; k += 1) {
        const a = first[k]
        const b = second[k]
        if (a !== undefined && b !== undefined) {
          const { oldWords, newWords } = wordDiff(a.text, b.text)
          a.words = oldWords
          b.words = newWords
        } else if (a !== undefined) {
          a.words = [{ text: a.text, kind: a.type === 'add' ? 'add' : 'del' }]
        } else if (b !== undefined) {
          b.words = [{ text: b.text, kind: b.type === 'add' ? 'add' : 'del' }]
        }
      }
    }
  }
}

/** Split a line into word tokens, keeping whitespace as separate tokens. */
function tokenize(text: string): string[] {
  return text.match(/\S+|\s+/g) ?? []
}

/** LCS cell budget: beyond this the O(n*m) table would stall the phone. */
const MAX_LCS_CELLS = 20_000

/**
 * Word-level diff between a removed and an added line (LCS over word
 * tokens). Whitespace tokens always come out 'same' so spacing never gets
 * painted; only real words carry add/del marks. Huge token counts take
 * the linear approximation path (common prefix/suffix kept exact, the
 * middle marked all-changed) instead of building the full LCS table.
 */
export function wordDiff(oldText: string, newText: string): { oldWords: WordToken[]; newWords: WordToken[] } {
  const oldTokens = tokenize(oldText)
  const newTokens = tokenize(newText)
  const n = oldTokens.length
  const m = newTokens.length

  if (n * m > MAX_LCS_CELLS) {
    // Linear approximation: exact common prefix and suffix, everything in
    // between marked changed. Coarse for a huge rewrite, but the phone
    // never stalls on a pathological line.
    let prefix = 0
    while (prefix < n && prefix < m && oldTokens[prefix] === newTokens[prefix]) prefix += 1
    let suffix = 0
    while (suffix < n - prefix && suffix < m - prefix
      && oldTokens[n - 1 - suffix] === newTokens[m - 1 - suffix]) suffix += 1
    const oldWords: WordToken[] = []
    const newWords: WordToken[] = []
    for (let k = 0; k < prefix; k += 1) {
      oldWords.push({ text: oldTokens[k]!, kind: 'same' })
      newWords.push({ text: newTokens[k]!, kind: 'same' })
    }
    for (let k = prefix; k < n - suffix; k += 1) {
      oldWords.push({ text: oldTokens[k]!, kind: /^\s+$/.test(oldTokens[k]!) ? 'same' : 'del' })
    }
    for (let k = prefix; k < m - suffix; k += 1) {
      newWords.push({ text: newTokens[k]!, kind: /^\s+$/.test(newTokens[k]!) ? 'same' : 'add' })
    }
    for (let k = n - suffix; k < n; k += 1) {
      oldWords.push({ text: oldTokens[k]!, kind: 'same' })
    }
    for (let k = m - suffix; k < m; k += 1) {
      newWords.push({ text: newTokens[k]!, kind: 'same' })
    }
    return { oldWords, newWords }
  }

  // LCS table (bottom-up).
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = oldTokens[i] === newTokens[j]
        ? dp[i + 1]![j + 1]! + 1
        : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  // Walk the table to mark changed tokens.
  const oldWords: WordToken[] = []
  const newWords: WordToken[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) {
      oldWords.push({ text: oldTokens[i]!, kind: 'same' })
      newWords.push({ text: newTokens[j]!, kind: 'same' })
      i += 1
      j += 1
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      oldWords.push({ text: oldTokens[i]!, kind: /^\s+$/.test(oldTokens[i]!) ? 'same' : 'del' })
      i += 1
    } else {
      newWords.push({ text: newTokens[j]!, kind: /^\s+$/.test(newTokens[j]!) ? 'same' : 'add' })
      j += 1
    }
  }
  while (i < n) {
    oldWords.push({ text: oldTokens[i]!, kind: /^\s+$/.test(oldTokens[i]!) ? 'same' : 'del' })
    i += 1
  }
  while (j < m) {
    newWords.push({ text: newTokens[j]!, kind: /^\s+$/.test(newTokens[j]!) ? 'same' : 'add' })
    j += 1
  }
  return { oldWords, newWords }
}

/**
 * Build the resulting file text after a diff decision: context lines stay,
 * added lines are kept when `acceptAdds` says so, removed lines are kept
 * (the deletion stands) when `rejectDels` says so. Line keys are
 * `${hunkIndex}:${lineIndex}`.
 */
export function applyDiffDecision(
  diff: ParsedDiff,
  acceptAdds: ReadonlySet<string>,
  rejectDels: ReadonlySet<string>,
): string {
  const out: string[] = []
  diff.hunks.forEach((hunk, hunkIndex) => {
    hunk.lines.forEach((line, lineIndex) => {
      const key = `${hunkIndex}:${lineIndex}`
      if (line.type === 'ctx') out.push(line.text)
      else if (line.type === 'add' && acceptAdds.has(key)) out.push(line.text)
      else if (line.type === 'del' && rejectDels.has(key)) out.push(line.text)
    })
  })
  return out.join('\n')
}
