/**
 * Lightweight syntax highlighting for the mobile chat — bundled into the
 * plugin, zero dependencies, zero network, single-file build.
 *
 * Why not Shiki: bundling Shiki splits the mobile bundle into 400+ lazy
 * chunks (one file per grammar/theme), and the deployed mobile page ships
 * as ONE self-contained `mobile.js` — missing chunks mean a blank page.
 * A CDN loader (an even earlier design) silently loses to phones whose
 * network cannot reach esm.sh/jsdelivr, so code never highlights there.
 * The compact tokenizer below covers the common surface — comments,
 * strings, numbers, keywords, type names, properties and function calls —
 * with a small keyword table per language family, and degrades to plain
 * text for anything else.
 *
 * API mirrors the old module: {@link languageInfo} resolves a fence
 * language, {@link highlightCode} resolves the highlighted
 * `<pre class="shiki">` HTML (or null when the language renders plain).
 * @module dsh-palm/mobile/highlight
 */

/** One supported language: display label, run capability, file extension. */
export interface LanguageInfo {
  readonly label: string
  /** Whether the block offers the sandbox run button. */
  readonly runnable: boolean
  /** File extension used by the "open in new tab / download" action. */
  readonly ext: string
}

/** Language family for keyword/comment selection. */
type LanguageKind = 'code' | 'python' | 'bash' | 'sql' | 'markup' | 'config'

interface LanguageMeta extends LanguageInfo {
  readonly kind: LanguageKind
}

/**
 * Language registry: the supported set (TypeScript / JavaScript / Python /
 * Bash / JSON / YAML / HTML / CSS / Rust / Go / Java / C++ / C / Markdown /
 * SQL) plus the common aliases models actually write. Anything else is
 * plain text with no highlighting.
 */
const LANG_MAP: Record<string, LanguageMeta> = {
  ts: { label: 'TypeScript', runnable: false, ext: 'ts', kind: 'code' },
  typescript: { label: 'TypeScript', runnable: false, ext: 'ts', kind: 'code' },
  js: { label: 'JavaScript', runnable: false, ext: 'js', kind: 'code' },
  javascript: { label: 'JavaScript', runnable: false, ext: 'js', kind: 'code' },
  jsx: { label: 'JSX', runnable: false, ext: 'jsx', kind: 'code' },
  tsx: { label: 'TSX', runnable: false, ext: 'tsx', kind: 'code' },
  py: { label: 'Python', runnable: true, ext: 'py', kind: 'python' },
  python: { label: 'Python', runnable: true, ext: 'py', kind: 'python' },
  bash: { label: 'Bash', runnable: true, ext: 'sh', kind: 'bash' },
  sh: { label: 'Bash', runnable: true, ext: 'sh', kind: 'bash' },
  shell: { label: 'Bash', runnable: true, ext: 'sh', kind: 'bash' },
  zsh: { label: 'Bash', runnable: true, ext: 'sh', kind: 'bash' },
  json: { label: 'JSON', runnable: false, ext: 'json', kind: 'config' },
  yaml: { label: 'YAML', runnable: false, ext: 'yml', kind: 'config' },
  yml: { label: 'YAML', runnable: false, ext: 'yml', kind: 'config' },
  html: { label: 'HTML', runnable: false, ext: 'html', kind: 'markup' },
  xml: { label: 'XML', runnable: false, ext: 'xml', kind: 'markup' },
  css: { label: 'CSS', runnable: false, ext: 'css', kind: 'code' },
  rust: { label: 'Rust', runnable: false, ext: 'rs', kind: 'code' },
  rs: { label: 'Rust', runnable: false, ext: 'rs', kind: 'code' },
  go: { label: 'Go', runnable: false, ext: 'go', kind: 'code' },
  java: { label: 'Java', runnable: false, ext: 'java', kind: 'code' },
  cpp: { label: 'C++', runnable: false, ext: 'cpp', kind: 'code' },
  'c++': { label: 'C++', runnable: false, ext: 'cpp', kind: 'code' },
  c: { label: 'C', runnable: false, ext: 'c', kind: 'code' },
  md: { label: 'Markdown', runnable: false, ext: 'md', kind: 'markup' },
  markdown: { label: 'Markdown', runnable: false, ext: 'md', kind: 'markup' },
  sql: { label: 'SQL', runnable: false, ext: 'sql', kind: 'sql' },
  text: { label: 'Text', runnable: false, ext: 'txt', kind: 'config' },
}

/** Resolve a fence language to its display info (unknown → plain text). */
export function languageInfo(lang: string): LanguageInfo {
  const key = lang.trim().toLowerCase()
  const entry = LANG_MAP[key]
  if (entry !== undefined) return entry
  return { label: lang.trim() === '' ? 'text' : lang.trim(), runnable: false, ext: 'txt' }
}

/** Keyword tables per family (generous union; extra words are harmless). */
const KEYWORDS: Record<LanguageKind, ReadonlySet<string>> = {
  code: new Set([
    'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
    'continue', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
    'finally', 'for', 'from', 'function', 'get', 'if', 'implements', 'import',
    'in', 'instanceof', 'interface', 'let', 'module', 'namespace', 'new', 'of',
    'package', 'private', 'protected', 'public', 'readonly', 'return', 'set',
    'static', 'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof',
    'undefined', 'var', 'void', 'while', 'with', 'yield', 'null', 'true', 'false',
    'fn', 'impl', 'struct', 'match', 'mut', 'move', 'pub', 'ref', 'trait', 'use',
    'where', 'func', 'range', 'defer', 'chan', 'go', 'nil', 'def', 'lambda',
  ]),
  python: new Set([
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def',
    'del', 'elif', 'else', 'except', 'False', 'finally', 'for', 'from', 'global',
    'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass',
    'raise', 'return', 'True', 'try', 'while', 'with', 'yield', 'self', 'print',
  ]),
  bash: new Set([
    'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done',
    'case', 'esac', 'function', 'in', 'select', 'time', 'local', 'export',
    'readonly', 'return', 'break', 'continue', 'shift', 'source', 'alias',
    'echo', 'set', 'unset', 'true', 'false', 'test', 'exit',
  ]),
  sql: new Set([
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
    'DELETE', 'CREATE', 'TABLE', 'ALTER', 'ADD', 'DROP', 'INDEX', 'VIEW',
    'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ON', 'AS',
    'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'LIKE', 'BETWEEN', 'GROUP', 'BY',
    'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'PRIMARY',
    'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'DEFAULT', 'UNIQUE', 'CHECK',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'COUNT', 'SUM', 'AVG',
    'MIN', 'MAX', 'CAST', 'IF', 'WITH', 'RECURSIVE', 'ASC', 'DESC', 'DATABASE',
  ]),
  markup: new Set([
    'html', 'head', 'body', 'title', 'meta', 'link', 'script', 'style', 'div',
    'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table',
    'tr', 'td', 'th', 'thead', 'tbody', 'a', 'img', 'input', 'button', 'form',
    'header', 'footer', 'nav', 'section', 'article', 'aside', 'main', 'select',
    'option', 'textarea', 'label', 'video', 'audio', 'iframe', 'pre', 'code',
    'br', 'hr', 'strong', 'em', 'b', 'i', 'u', 's', 'blockquote', 'q', 'mark',
    'doctype', 'template', 'slot', 'picture', 'source', 'summary', 'details',
    'figure', 'figcaption', 'canvas', 'svg', 'path', 'defs', 'linearGradient',
  ]),
  config: new Set([
    'true', 'false', 'null', 'yes', 'no', 'on', 'off', 'version', 'name',
    'type', 'id', 'env', 'node', 'extends', 'default', 'required',
  ]),
}

/** SQL keywords are conventionally uppercase; accept both cases. */
function normalizeKeyword(word: string, kind: LanguageKind): string {
  return kind === 'sql' ? word.toUpperCase() : word
}

/** Escape HTML special characters. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => (
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;'
      : char === '"' ? '&quot;' : '&#39;'
  ))
}

/**
 * One-line token matcher: strings, comments, numbers, identifiers.
 * Identifiers are classified afterwards (keyword / type / property / call).
 */
const LINE_TOKEN_RE = /("[^"\n]*")|('(?:[^'\n\\]|\\.)*')|(`[^`\n]*`)|(\/\/[^\n]*)|(\/\*.*?\*\/|\s#[^\n]*)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g

/** Highlight one line; hash-prefixed words count as comments for # languages. */
function highlightLine(line: string, kind: LanguageKind, hashIsComment: boolean): string {
  // Line-leading # comment (python/bash/sql/yaml): the whole line is one comment.
  if (hashIsComment && /^\s*#/.test(line)) {
    return `<span class="tok tok-comment">${escapeHtml(line)}</span>`
  }
  const keywords = KEYWORDS[kind]
  let out = ''
  let last = 0
  LINE_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = LINE_TOKEN_RE.exec(line)) !== null) {
    const start = match.index
    const [full, str, sq, bt, lineComment, blockOrHash, number, identifier] = match
    out += escapeHtml(line.slice(last, start))
    let token = full
    let cls = ''
    if (str !== undefined || sq !== undefined || bt !== undefined) {
      cls = ' tok-string'
    } else if (lineComment !== undefined
      || (blockOrHash !== undefined && (blockOrHash.trimStart().startsWith('/*')
        || (hashIsComment && blockOrHash.trimStart().startsWith('#'))))) {
      cls = ' tok-comment'
    } else if (number !== undefined) {
      cls = ' tok-number'
    } else if (identifier !== undefined) {
      token = identifier
      if (keywords.has(normalizeKeyword(identifier, kind))) {
        cls = ' tok-keyword'
      } else if (/^[A-Z]/.test(identifier)) {
        cls = ' tok-type'
      } else {
        // Property key (identifier followed by ':') or call (followed by '(').
        const rest = line.slice(start + identifier.length)
        const before = line.slice(Math.max(0, start - 1), start)
        if (kind === 'markup' && (before === '<' || before === ' ')) cls = ' tok-prop'
        else if (rest.startsWith(':') && (before === ' ' || before === '' || before === '"' || before === "'")) cls = ' tok-prop'
        else if (rest.startsWith('(')) cls = ' tok-func'
      }
    }
    out += cls === '' ? escapeHtml(token) : `<span class="tok${cls}">${escapeHtml(token)}</span>`
    last = start + full.length
  }
  out += escapeHtml(line.slice(last))
  return out === '' ? ' ' : out
}

/**
 * Highlight one code block synchronously. The tokenizer is pure string
 * work with no I/O, so CodeBlock can paint the highlighted HTML on the
 * very first frame (no plain-text flash) while the async wrapper below
 * keeps the pre-existing API.
 */
export function highlightCodeSync(code: string, lang: string): string | null {
  const info = LANG_MAP[lang.trim().toLowerCase()]
  if (info === undefined || info.kind === 'config') return null
  const hashIsComment = info.kind === 'python' || info.kind === 'bash' || info.kind === 'sql'
  const lines = code.split('\n')
  const inner = lines.map(line => {
    const content = highlightLine(line, info.kind, hashIsComment)
    return `<span class="line">${content}</span>`
  }).join('\n')
  return `<pre class="shiki" tabindex="0"><code>${inner}</code></pre>`
}

/**
 * Highlight one code block. Resolves to a `<pre class="shiki">` HTML string
 * (theme-adaptive token classes) or null for plain-text languages.
 */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  return highlightCodeSync(code, lang)
}

/** Test hook: kept for API parity with the old shiki loader. */
export function resetHighlighterForTest(): void {
  /* no-op: the lightweight highlighter has no cache */
}
