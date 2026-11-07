/**
 * Tool-step row model for the phone's process timeline.
 *
 * The mobile mirror of the desktop row model (ui-tool
 * `models/tool-call-model.ts`): the same variant classification, the same
 * args-derived one-line summary and the same openable-path slot, carrying the
 * phone's own Chinese titles. Pure, value-import-free and side-effect-free,
 * like every module the standalone mobile bundle pulls in.
 * @module dsh-palm/mobile/step-view
 */

/** Row family the phone paints: leading icon + title + one-line summary. */
export type StepVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'others'

/**
 * Known tool name -> variant. Mirrors the desktop table for the tools the
 * phone actually meets; an unknown name keeps the generic row.
 */
const TOOL_VARIANTS: Record<string, StepVariant> = {
  bash: 'bash',
  pwsh: 'bash',
  read: 'read',
  read_image: 'read',
  web_fetch: 'read',
  web_search: 'search',
  grep: 'search',
  glob: 'search',
  write: 'write',
  edit: 'edit',
  run_code: 'code',
}

/** Family titles; a tool whose own name reads better than its family overrides it. */
const VARIANT_TITLES: Record<StepVariant, string> = {
  search: '搜索',
  read: '读取',
  bash: '运行命令',
  write: '写入',
  edit: '编辑',
  code: '运行代码',
  others: '工具',
}

/** Per-tool title overrides (desktop parity: pwsh, read_image kept distinct). */
const TOOL_TITLES: Record<string, string> = {
  pwsh: '运行命令',
  read_image: '查看图片',
  web_fetch: '抓取网页',
  web_search: '联网搜索',
  grep: '搜索内容',
  glob: '查找文件',
}

/** Summary key preference per variant (args-derived; desktop parity). */
const SUMMARY_KEYS: Record<StepVariant, readonly string[]> = {
  bash: ['description', 'command'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  others: [],
}

/** Path keys only — never `url` (a URL read is not an openable workspace file). */
const FILE_PATH_KEYS = ['path', 'file_path'] as const

/** File-tool variants whose summary may be an openable workspace path. */
const FILE_PATH_VARIANTS: ReadonlySet<StepVariant> = new Set(['read', 'write', 'edit'])

/** One step row: family, title, summary line and the openable-path slot. */
export interface StepModel {
  readonly variant: StepVariant
  readonly title: string
  readonly summary: string
  /** Filesystem path from args (`path` / `file_path`) for a file tool. */
  readonly filePath?: string
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

/** Parse an argument payload; a non-object or malformed payload yields undefined. */
function parseArgs(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/**
 * Classify a wire tool name into its row family.
 * @param toolName - wire tool name.
 * @returns the matching family, `others` when unknown.
 */
export function classifyStep(toolName: string): StepVariant {
  return TOOL_VARIANTS[toolName] ?? 'others'
}

/**
 * Derive one step row from a tool call. A non-JSON argument (mid-stream
 * truncation) degrades to its raw first line, exactly like the desktop, so a
 * half-streamed call still reads as something instead of an empty row.
 * @param tool - the folded tool call (name plus raw arguments).
 * @returns the row model.
 */
export function stepModel(tool: { readonly name: string; readonly arguments?: string }): StepModel {
  const variant = classifyStep(tool.name)
  const raw = tool.arguments ?? ''
  const args = raw === '' ? undefined : parseArgs(raw)
  let summary = ''
  if (args !== undefined) {
    // A search call may carry several queries; the desktop joins them on one
    // line rather than showing only the first.
    const queries = variant === 'search' && Array.isArray(args['queries']) ? args['queries'] : undefined
    if (queries !== undefined) {
      const values = queries.filter((query): query is string => typeof query === 'string' && query !== '')
      if (values.length > 0) summary = values.map(firstLine).join('，')
    }
    if (summary === '') summary = pickString(args, SUMMARY_KEYS[variant]) ?? ''
    if (summary === '') {
      for (const value of Object.values(args)) {
        if (typeof value === 'string' && value !== '') { summary = value; break }
      }
    }
  }
  if (summary === '') summary = raw === '' ? tool.name : raw
  summary = firstLine(summary)
  const filePath = FILE_PATH_VARIANTS.has(variant) && args !== undefined
    ? pickString(args, FILE_PATH_KEYS)
    : undefined
  const toolTitle = TOOL_TITLES[tool.name]
  return {
    variant,
    title: toolTitle ?? VARIANT_TITLES[variant],
    // An unclassified call keeps the generic title, so its real name rides the
    // summary slot instead (desktop `others` behaviour).
    summary: variant === 'others' && toolTitle === undefined && raw !== ''
      ? `${tool.name} · ${summary}`
      : summary,
    ...(filePath !== undefined ? { filePath: firstLine(filePath) } : {}),
  }
}
