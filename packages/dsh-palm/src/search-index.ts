/**
 * 手机端搜索索引（期 1：影子模式）。
 *
 * 为什么要有它：宿主自带的会话检索是 SQLite FTS5 `unicode61`，连续中文会被
 * 当成一个 token —— 搜「支付」命中 0，搜「支付专项」也命中 0；而手机端为了
 * 拿到可跳转的 seq，还要把每个候选会话的全部历史读出来重新折叠（上限 4096
 * 页）。结果是又慢又经常搜不到。
 *
 * 这里自建一份**派生索引**（可随时删库重建，与真源无关）：中文预先切成
 * bigram（支付 → "支付"，支付专项 → "支付 付专 专项"），拉丁词小写照原样，
 * 交给 `unicode61` 索引。短语相邻约束保证「子串」语义，于是：
 *
 *   支持          中文 2 字/3 字、英文、数字、混合     （实测 4000 行 5.6ms）
 *   不支持        单个汉字（无 bigram），走 LIKE 兜底
 *
 * 本模块只做「库 + 查询」，不碰宿主内部表：由调用方把会话历史折成
 * `SearchIndexRow` 喂进来（复用手机端已经验证过的 seq 映射），索引只负责存
 * 与查。期 1 只写影子日志，不改变任何现有 API 的返回。
 */

/** Minimal structural view of `node:sqlite` — keeps this module independent of the installed @types/node. */
interface SqliteStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

/** One searchable unit (a folded message row, already seq-mapped for locate). */
export interface SearchIndexRow {
  messageId: string
  seq: number
  partId?: string
  text: string
  user: boolean
}

/** One hit, ordered by the query's ranking. */
export interface SearchIndexHit {
  sessionId: string
  messageId: string
  seq: number
  partId?: string
  user: boolean
  /** Matching window around the first hit, with ellipses. */
  snippet: string
  /** Highlight ranges inside {@link snippet} (start, end), half-open. */
  ranges: Array<[number, number]>
  /** FTS bm25 (negative; more negative = better) adjusted by role/title weights. */
  score: number
  /** 这条消息的时间戳（毫秒）：时间衰减在 JS 里算，SQL 里算会把全表扫贵几十倍。 */
  ts?: number
  /** 只有 withSnippets: false 的内部查询才带（摘要延后到确定要展示的那几行再算）。 */
  text?: string
  /**
   * 命中所在的**整段**（按空行切段，最多 320 字，命中词在中间）。搜索结果直接摆这
   * 一段，用户不用点进去就知道是哪句话命中（方案 C）。
   */
  paragraph?: string
  /**
   * 这是该段里第几处命中（0 起）。定位时按「段落 + 段内第几处」走（方案 A），
   * 不再靠"在整行 DOM 里数第 N 个标记"——那套在折叠卡片上数不准。
   */
  matchIndex?: number
}

/** Per-session bookkeeping so a sync resumes instead of rescanning. */
export interface SearchIndexSessionState {
  sessionId: string
  title?: string
  workspaceId?: string
  updatedAt: number
  indexedThroughSeq: number
  /** Lowest seq already indexed: the resume cursor for an unfinished walk. */
  oldestSeq: number
  complete: boolean
  docs: number
  indexedAt: number
}

const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3400-\u4dbf\u3005\u30fc]+/u
/** FTS5 `unicode61` strips these anyway; keep the pre-tokenizer aware of them. */
const LITERAL_RUN = /[\p{L}\p{N}_]+/gu

/**
 * Pre-tokenize text for the index: contiguous CJK becomes overlapping bigrams,
 * everything else keeps its words (lowercased). A lone CJK character stays as
 * itself so single-character documents remain storable.
 */
export function indexTokens(text: string): string {
  const tokens: string[] = []
  const runs = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3400-\u4dbf\u3005\u30fc]+|[\p{L}\p{N}_]+/gu) ?? []
  for (const run of runs) {
    if (CJK_RUN.test(run)) {
      const chars = [...run]
      if (chars.length === 1) {
        tokens.push(chars[0] ?? '')
        continue
      }
      for (let i = 0; i + 1 < chars.length; i++) tokens.push(`${chars[i]}${chars[i + 1]}`)
      continue
    }
    tokens.push(run.toLowerCase())
  }
  return tokens.filter(token => token !== '').join(' ')
}

/**
 * Turn a user query into an FTS5 MATCH expression.
 *
 * - CJK run of 2+ characters → one bigram phrase (substring semantics)
 * - Latin/number words → their tokens
 * - mixed query → every group ANDed (each stays a phrase, so order is respected)
 *
 * Returns undefined when nothing indexable is left (a single CJK character, or
 * punctuation only) — the caller then falls back to a LIKE scan.
 */
/**
 * 查询词的宽度归一化：全角 ASCII（ＲＲＡＭ、ＤＰ５３４）与全角空格折成半角。
 *
 * 索引里存的正文基本都是半角（代码、日志、路径都是半角），手机输入法切到全角后
 * 搜「ＲＲＡＭ」一条都搜不到、换成半角才有 —— 这不是用户的问题。只在查询侧归一化，
 * 不动已索引的正文（否则摘要会跟着变形）。
 */
export function normalizeQueryText(query: string): string {
  return query.replace(/[\uff01-\uff5e]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ')
}

export function matchExpression(query: string): string | undefined {
  const phrases: string[] = []
  const runs = normalizeQueryText(query).match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3400-\u4dbf\u3005\u30fc]+|[\p{L}\p{N}_]+/gu) ?? []
  for (const run of runs) {
    if (CJK_RUN.test(run)) {
      const chars = [...run]
      if (chars.length < 2) continue
      const bigrams: string[] = []
      for (let i = 0; i + 1 < chars.length; i++) bigrams.push(`${chars[i]}${chars[i + 1]}`)
      phrases.push(`"${bigrams.join(' ')}"`)
      continue
    }
    const word = run.toLowerCase()
    if (word !== '') phrases.push(`"${word.replace(/"/g, '""')}"`)
  }
  return phrases.length === 0 ? undefined : phrases.join(' AND ')
}

/** Everything a query may match literally, for snippet windows and highlight ranges. */
function literalNeedles(query: string): string[] {
  const needles: string[] = []
  const trimmed = query.trim()
  if (trimmed !== '') needles.push(trimmed)
  for (const token of query.toLowerCase().match(LITERAL_RUN) ?? []) needles.push(token)
  return [...new Set(needles)].sort((a, b) => b.length - a.length)
}

const SNIPPET_LEAD = 24
const SNIPPET_TAIL = 64

/** 一段正文最多带这么多字（手机上三行左右），超出就围绕命中词截断。 */
export const PARAGRAPH_MAX_CHARS = 320

/**
 * 方案 A/C 的锚点：命中**所在的整段** + 这一段里是第几处命中。
 *
 * 为什么要它：搜索结果是消息级的坐标，而手机端会把一轮折叠成一张卡片、只渲染
 * 一个高亮标记，靠"在 DOM 里数第 N 个 mark"必然数不准（这就是「数字在变、位置
 * 不动」）。段落是稳定的：同一段文字在索引里和在屏幕上都是同一块内容，前端直接
 * 摆出这段（C），点开时按「段落 + 段内第几处」跳（A）。
 */
export function buildParagraphAnchor(text: string, query: string): { paragraph: string; matchIndex: number } {
  const folded = text.toLowerCase()
  let at = -1
  let length = 0
  for (const needle of literalNeedles(query)) {
    const found = folded.indexOf(needle.toLowerCase())
    if (found >= 0) {
      at = found
      length = needle.length
      break
    }
  }
  if (at < 0) {
    const head = text.slice(0, PARAGRAPH_MAX_CHARS)
    return { paragraph: text.length > head.length ? `${head}…` : head, matchIndex: 0 }
  }
  // 段内第几处：命中位置之前出现过几次同一个词。
  let matchIndex = 0
  const needle = folded.slice(at, at + length)
  if (needle !== '') {
    let cursor = folded.indexOf(needle)
    while (cursor >= 0 && cursor < at) {
      matchIndex += 1
      cursor = folded.indexOf(needle, cursor + needle.length)
    }
  }
  // 段落 = 空行切出来的块。
  const blocks: Array<[number, number]> = []
  const breaks = /\n\s*\n/g
  let cursor = 0
  let found: RegExpExecArray | null
  while ((found = breaks.exec(text)) !== null) {
    blocks.push([cursor, found.index])
    cursor = found.index + found[0].length
  }
  blocks.push([cursor, text.length])
  const block = blocks.find(([start, end]) => at >= start && at < end) ?? [0, text.length]
  const blockStart = block[0] ?? 0
  const blockEnd = block[1] ?? text.length
  let start = blockStart
  let end = blockEnd
  if (end - start > PARAGRAPH_MAX_CHARS) {
    const pad = Math.max(0, Math.floor((PARAGRAPH_MAX_CHARS - length) / 2))
    start = Math.max(blockStart, at - pad)
    end = Math.min(blockEnd, start + PARAGRAPH_MAX_CHARS)
    if (end - start < PARAGRAPH_MAX_CHARS) start = Math.max(blockStart, end - PARAGRAPH_MAX_CHARS)
  }
  const prefix = start > blockStart ? '…' : ''
  const suffix = end < blockEnd ? '…' : ''
  return {
    paragraph: `${prefix}${text.slice(start, end).trim()}${suffix}`,
    matchIndex,
  }
}

/**
 * Build a display snippet for one stored text plus the highlight ranges inside
 * it. The window is anchored on the longest literal needle found; when the FTS
 * match came from token adjacency that the raw text spells differently (rare),
 * the head of the text is shown without ranges instead of a broken window.
 */
export function buildSnippet(text: string, query: string): { snippet: string; ranges: Array<[number, number]> } {
  const folded = text.toLowerCase()
  let at = -1
  let length = 0
  for (const needle of literalNeedles(query)) {
    const found = folded.indexOf(needle.toLowerCase())
    if (found >= 0) {
      at = found
      length = needle.length
      break
    }
  }
  if (at < 0) {
    const head = text.slice(0, SNIPPET_LEAD + SNIPPET_TAIL)
    return { snippet: text.length > head.length ? `${head}…` : head, ranges: [] }
  }
  const start = Math.max(0, at - SNIPPET_LEAD)
  const end = Math.min(text.length, at + length + SNIPPET_TAIL)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  const snippet = `${prefix}${text.slice(start, end)}${suffix}`
  const hitStart = prefix.length + (at - start)
  const ranges: Array<[number, number]> = []
  // Highlight every occurrence of every needle inside the window (not only the
  // anchor), so a snippet with the term twice reads correctly.
  for (const needle of literalNeedles(query)) {
    const lowered = needle.toLowerCase()
    if (lowered === '') continue
    let from = 0
    while (ranges.length < 8) {
      const found = snippet.toLowerCase().indexOf(lowered, from)
      if (found < 0) break
      ranges.push([found, found + needle.length])
      from = found + needle.length
    }
  }
  if (ranges.length === 0) ranges.push([hitStart, hitStart + length])
  ranges.sort((a, b) => a[0] - b[0])
  return { snippet, ranges }
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  title TEXT,
  workspace_id TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0,
  indexed_through_seq INTEGER NOT NULL DEFAULT -1,
  oldest_seq INTEGER NOT NULL DEFAULT -1,
  complete INTEGER NOT NULL DEFAULT 0,
  docs INTEGER NOT NULL DEFAULT 0,
  indexed_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  part_id TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS docs_key ON docs(session_id, message_id, seq, part_id);
CREATE INDEX IF NOT EXISTS docs_session ON docs(session_id, seq);
-- 单字查询走 LIKE（没有 bigram 可用），SQLite 的 LIKE '%字%' 用不上索引；但按 ts 倒序
-- 走索引、凑够 LIMIT 就停，可以把「扫全库 1.4 万条正文」变成「扫到够为止」——
-- 常用字从 320ms 掉到几十毫秒，真机手感差别明显。
CREATE INDEX IF NOT EXISTS docs_ts ON docs(ts DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(tokens, tokenize = 'unicode61');
`

/**
 * 索引内容契约的版本。documentRows 决定"什么算正文"，这个取舍一变（比如不再索引
 * 折叠组里的过程叙述），旧库里的文档就成了脏数据：搜得到、点进去没有高亮。
 * 版本不符时 open() 直接清库，索引器下一趟自然全量重建 —— 宁可后台重扫一遍，
 * 也不要让新旧两套口径混在一个库里。
 *
 * v4：翻页的切点改成回合边界（chat-window / 索引器都往前补读到 turn/start），
 * v3 库里那些"按半截回合建出来的文档"必须清掉，否则它们永远点不到高亮。
 */
export const SEARCH_INDEX_VERSION = 4

/**
 * bm25 is negative and smaller is better, so amplifying the user score pushes
 * user-authored rows ahead of assistant rows at the same raw relevance.
 */
const USER_PRIORITY_FACTOR = 1.8
const DEFAULT_LIMIT = 20

/**
 * 索引文本里夹带的工具/技能原始块。渲染端把它们折进「工具」「思考」里，手机
 * 正文区一个字都看不到；留在索引里就会变成「搜得到、点进去没有」，甚至把整段
 * 工具输出当成正文命中（实测有一条 149 KB 的 `<tool_result><skill_content>` 原文
 * 被当成答案入库，搜 archify 直接命中它）。
 *
 * 两个地方都要用：入库时剥一次（`stripHiddenAssistantText`），查询时再兜一层
 * ——旧库里已经写进去的脏文档不会因为改了代码自动变干净。
 */
const TOOL_BLOCK_PATTERNS: readonly RegExp[] = [
  /<tool_result(?:\s[^>]*)?>[\s\S]*?(?:<\/tool_result>|$)/gi,
  /<tool_use(?:\s[^>]*)?>[\s\S]*?(?:<\/tool_use>|$)/gi,
  /<tool_calls(?:\s[^>]*)?>[\s\S]*?(?:<\/tool_calls>|$)/gi,
  /<skill_content(?:\s[^>]*)?>[\s\S]*?(?:<\/skill_content>|$)/gi,
  /<skill_resources(?:\s[^>]*)?>[\s\S]*?(?:<\/skill_resources>|$)/gi,
  /<available_skills(?:\s[^>]*)?>[\s\S]*?(?:<\/available_skills>|$)/gi,
  /<system-reminder(?:\s[^>]*)?>[\s\S]*?(?:<\/system-reminder>|$)/gi,
]

/** 把工具/技能原始块从要索引、要展示的文本里剥掉（未闭合的按到结尾处理）。 */
export function stripToolBlocks(text: string): string {
  let out = text
  for (const pattern of TOOL_BLOCK_PATTERNS) out = out.replace(pattern, ' ')
  return out
}
const MAX_LIMIT = 60
/** 分页分组的候选池（条命中）。必须和页偏移无关，页与页才是同一份排序的连续切片：
 *  取 400 条对 bm25 单次查询是毫秒级，而手机端翻到 10 页以后本来也没人用。 */
const SEARCH_POOL_HITS = 400
/** 会话内命中的硬上限（querySessionHits）：防止极端常用字把一次查询拉成几十毫秒。 */
const SESSION_HIT_LIMIT = 500
/** 相关度的时间衰减尺度（天）：180 天前的会话，权重按 1/(1+age/180) 打折。 */
const RECENCY_HALF_LIFE_DAYS = 180

/** 一个会话的命中详情（分页查询用）：`messages` 已按相关度排好，最多 limits 条。 */
export interface SearchGroupDetail {
  sessionId: string
  /** 这个会话一共命中多少条消息（可能远多于 messages.length）。 */
  hits: number
  best: SearchIndexHit
  messages: SearchIndexHit[]
}

/**
 * The derived FTS index itself. Open is async because `node:sqlite` is imported
 * dynamically (older Node builds do not ship it; the feature then stays off and
 * every caller sees `undefined`).
 */
export class SearchIndex {
  private readonly db: SqliteDatabase

  private constructor(db: SqliteDatabase) {
    this.db = db
  }

  static async open(path: string): Promise<SearchIndex | undefined> {
    let ctor: (new (path: string) => SqliteDatabase) | undefined
    try {
      const sqlite = await import('node:sqlite')
      ctor = (sqlite as unknown as { DatabaseSync?: new (path: string) => SqliteDatabase }).DatabaseSync
    } catch {
      return undefined
    }
    if (ctor === undefined) return undefined
    try {
      const db = new ctor(path)
      const index = new SearchIndex(db)
      index.db.exec(SCHEMA)
      index.ensureVersion()
      return index
    } catch {
      return undefined
    }
  }

  /** Open an anonymous in-memory index (tests, and the fallback when no path is configured). */
  static async inMemory(): Promise<SearchIndex | undefined> {
    return await SearchIndex.open(':memory:')
  }

  /**
   * 口径变了就整库作废：清 docs/docs_fts/sessions，写回新版本号。返回是否清过，
   * 方便调用方日志里说明"为什么突然全量重扫"。
   */
  private ensureVersion(): boolean {
    const stored = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('index_version') as { value?: unknown } | undefined
    if (stored !== undefined && String(stored.value) === String(SEARCH_INDEX_VERSION)) return false
    this.db.exec('DELETE FROM docs_fts; DELETE FROM docs; DELETE FROM sessions;')
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('index_version', String(SEARCH_INDEX_VERSION))
    return true
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      // Closing a already-closed handle is not an error worth surfacing.
    }
  }

  /** Replace one session's docs for the given rows (idempotent upsert by message/seq/part). */
  upsertSession(
    session: { sessionId: string; title?: string; workspaceId?: string; updatedAt: number; complete: boolean; indexedThroughSeq: number; oldestSeq?: number },
    rows: readonly SearchIndexRow[],
    ts: number,
  ): number {
    let written = 0
    const findId = this.db.prepare('SELECT id FROM docs WHERE session_id = ? AND message_id = ? AND seq = ? AND part_id = ?')
    const insertDoc = this.db.prepare('INSERT INTO docs (session_id, message_id, seq, part_id, role, text, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const updateDoc = this.db.prepare('UPDATE docs SET role = ?, text = ?, ts = ? WHERE id = ?')
    const deleteFts = this.db.prepare('DELETE FROM docs_fts WHERE rowid = ?')
    const insertFts = this.db.prepare('INSERT INTO docs_fts (rowid, tokens) VALUES (?, ?)')
    this.db.exec('BEGIN')
    try {
      for (const row of rows) {
        const partId = row.partId ?? ''
        const text = row.text
        if (text.trim() === '') continue
        const existing = findId.get(session.sessionId, row.messageId, row.seq, partId) as { id?: unknown } | undefined
        const role = row.user ? 'user' : 'assistant'
        let id: number
        if (existing !== undefined && typeof existing.id === 'number') {
          id = existing.id
          updateDoc.run(role, text, ts, id)
          deleteFts.run(id)
        } else {
          const result = insertDoc.run(session.sessionId, row.messageId, row.seq, partId, role, text, ts)
          id = Number(result.lastInsertRowid)
        }
        insertFts.run(id, indexTokens(text))
        written += 1
      }
      const docsCount = this.db.prepare('SELECT count(*) AS c FROM docs WHERE session_id = ?').get(session.sessionId) as { c?: unknown } | undefined
      const total = typeof docsCount?.c === 'number' ? docsCount.c : written
      this.db.prepare(`
        INSERT INTO sessions (session_id, title, workspace_id, updated_at, indexed_through_seq, oldest_seq, complete, docs, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          title = excluded.title,
          workspace_id = excluded.workspace_id,
          updated_at = excluded.updated_at,
          indexed_through_seq = excluded.indexed_through_seq,
          oldest_seq = excluded.oldest_seq,
          complete = excluded.complete,
          docs = excluded.docs,
          indexed_at = excluded.indexed_at
      `).run(
        session.sessionId,
        session.title ?? null,
        session.workspaceId ?? null,
        session.updatedAt,
        session.indexedThroughSeq,
        session.oldestSeq ?? -1,
        session.complete ? 1 : 0,
        total,
        ts,
      )
      this.db.exec('COMMIT')
      // 批量灌库后让 FTS5 自己合并段；否则第一批查询要替建库收尾（实测慢一个量级）。
      if (written >= 100) this.optimize()
      return written
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // A failed rollback means the transaction was never open; ignore.
      }
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  /** Merge FTS5 segments after a bulk load (no-op when the index is tiny). */
  optimize(): void {
    try {
      this.db.exec("INSERT INTO docs_fts(docs_fts) VALUES('optimize')")
    } catch {
      // Optimization is best-effort: a failed merge only costs query speed.
    }
  }
  /** Drop one session's docs (session archived/deleted, or its log was rewritten). */
  dropSession(sessionId: string): void {
    const ids = this.db.prepare('SELECT id FROM docs WHERE session_id = ?').all(sessionId) as Array<{ id?: unknown }>
    const deleteFts = this.db.prepare('DELETE FROM docs_fts WHERE rowid = ?')
    this.db.exec('BEGIN')
    try {
      for (const row of ids) if (typeof row.id === 'number') deleteFts.run(row.id)
      this.db.prepare('DELETE FROM docs WHERE session_id = ?').run(sessionId)
      this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId)
      this.db.exec('COMMIT')
    } catch {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // Ignore: nothing was written.
      }
    }
  }

  sessionState(sessionId: string): SearchIndexSessionState | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as Record<string, unknown> | undefined
    if (row === undefined) return undefined
    return {
      sessionId,
      ...(typeof row['title'] === 'string' ? { title: row['title'] } : {}),
      ...(typeof row['workspace_id'] === 'string' ? { workspaceId: row['workspace_id'] } : {}),
      updatedAt: typeof row['updated_at'] === 'number' ? row['updated_at'] : 0,
      indexedThroughSeq: typeof row['indexed_through_seq'] === 'number' ? row['indexed_through_seq'] : -1,
      oldestSeq: typeof row['oldest_seq'] === 'number' ? row['oldest_seq'] : -1,
      complete: row['complete'] === 1,
      docs: typeof row['docs'] === 'number' ? row['docs'] : 0,
      indexedAt: typeof row['indexed_at'] === 'number' ? row['indexed_at'] : 0,
    }
  }

  /** Sessions already in the index (used to skip unchanged ones without touching history). */
  indexedSessionIds(): Set<string> {
    const rows = this.db.prepare('SELECT session_id FROM sessions').all() as Array<{ session_id?: unknown }>
    const ids = new Set<string>()
    for (const row of rows) if (typeof row.session_id === 'string') ids.add(row.session_id)
    return ids
  }

  stats(): { docs: number; sessions: number; bytes: number } {
    const docs = this.db.prepare('SELECT count(*) AS c FROM docs').get() as { c?: unknown } | undefined
    const sessions = this.db.prepare('SELECT count(*) AS c FROM sessions').get() as { c?: unknown } | undefined
    const pages = this.db.prepare('PRAGMA page_count').get() as { page_count?: unknown } | undefined
    const pageSize = this.db.prepare('PRAGMA page_size').get() as { page_size?: unknown } | undefined
    const pageCount = typeof pages?.page_count === 'number' ? pages.page_count : 0
    const pageBytes = typeof pageSize?.page_size === 'number' ? pageSize.page_size : 0
    return {
      docs: typeof docs?.c === 'number' ? docs.c : 0,
      sessions: typeof sessions?.c === 'number' ? sessions.c : 0,
      bytes: pageCount * pageBytes,
    }
  }

  /**
   * Query the index. Returns hits ranked by bm25 with role/title weighting; the
   * caller groups them per session. A single-CJK-character query (no bigram)
   * degrades to a bounded LIKE scan so it still answers.
   */
  query(query: string, options: { limit?: number; sessionId?: string } = {}): SearchIndexHit[] {
    return this.runQuery(query, { limit: Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT), ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }) })
  }

  /**
   * 会话内命中（「上一处 / 下一处」的水位表）。
   *
   * 和 query() 分开：会话内不分页、要的是**这个会话里所有的命中**，而 query() 封顶
   * 60 条是给分组展示用的。常用字（「的」）在一个长会话里能有几百处，按 60 条截断
   * 就是「计数器停在 50/50、后面还有几百处永远点不到」——真机实测某会话「的」有 722 处。
   * 上限 500 条是给极端情况兜底，调用方拿到「够数」就自己标 hasMore。
   */
  querySessionHits(query: string, sessionId: string, limit: number): SearchIndexHit[] {
    return this.runQuery(query, { limit: Math.min(Math.max(limit, 1), SESSION_HIT_LIMIT), sessionId })
  }

  /**
   * 真正的查询实现。`limit` 的上限由调用方决定：对外 query() 封顶 60 条（够分组展示），
   * 分页用的 queryGroupsDetailed() 需要按「页偏移」多取候选，必须能超过 60。
   *
   * `withSnippets: false` 时只取排序所需的列，摘要留到确定要展示那几行再算 ——
   * 分页要超取上百条候选，逐条算摘要会把一次查询拖到 100ms 量级，而真正展示的
   * 只有一两屏。
   */
  private runQuery(query: string, options: { limit: number; sessionId?: string; withSnippets?: boolean }): SearchIndexHit[] {
    const trimmed = normalizeQueryText(query).trim()
    if (trimmed === '') return []
    const limit = Math.max(options.limit, 1)
    const withSnippets = options.withSnippets !== false
    const expression = matchExpression(trimmed)
    const sessionId = options.sessionId
    let rows: Array<Record<string, unknown>>
    if (expression === undefined) {
      const like = `%${trimmed.replace(/[%_]/g, match => `\\${match}`)}%`
      // 按 ts 倒序走索引、凑够 limit 就停（角色优先级在 JS 里补：SQL 里写表达式排序
      // 会让 SQLite 为了排序把整表 LIKE 扫完，实测单字查询 320ms）。
      rows = this.db.prepare(`
        SELECT session_id, message_id, seq, part_id, role, text, ts, 0.0 AS score
        FROM docs
        WHERE text LIKE ? ESCAPE '\\' ${sessionId === undefined ? '' : 'AND session_id = ?'}
        ORDER BY ts DESC
        LIMIT ?
      `).all(...(sessionId === undefined ? [like, limit] : [like, sessionId, limit])) as Array<Record<string, unknown>>
      // 用户消息排在助手前面（与 FTS 路径的角色权重同一个意图），同角色内保持 ts 倒序。
      rows = rows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
          const leftUser = left.row['role'] === 'user'
          const rightUser = right.row['role'] === 'user'
          if (leftUser !== rightUser) return leftUser ? -1 : 1
          return left.index - right.index
        })
        .map(entry => entry.row)
    } else {
      const params: unknown[] = [expression]
      let filter = ''
      if (sessionId !== undefined) {
        filter = 'AND d.session_id = ?'
        params.push(sessionId)
      }
      params.push(limit)
      // 排序只用 bm25 × 角色权重（SQL 里不碰日期函数：julianday 逐行算会把一次查询从
      // 6ms 拖到 100ms 量级）。时间衰减在 queryGroupsDetailed 里对候选集重排。
      rows = this.db.prepare(`
        SELECT d.session_id, d.message_id, d.seq, d.part_id, d.role, d.text, d.ts,
               bm25(docs_fts) AS score
        FROM docs_fts
        JOIN docs d ON d.id = docs_fts.rowid
        WHERE docs_fts MATCH ? ${filter}
        ORDER BY bm25(docs_fts) * (CASE d.role WHEN 'user' THEN ${USER_PRIORITY_FACTOR} ELSE 1.0 END) ASC, d.ts DESC
        LIMIT ?
      `).all(...params) as Array<Record<string, unknown>>
    }
    const hits: SearchIndexHit[] = []
    for (const row of rows) {
      const raw = typeof row['text'] === 'string' ? row['text'] : ''
      // 兜旧库的脏文档：命中的字全在被剥掉的工具块里，就没什么可展示、可定位的，
      // 直接丢掉 —— 留着只会把用户送到一条正文里没有这个词的消息上。
      const text = stripToolBlocks(raw)
      if (text !== raw && !text.toLowerCase().includes(trimmed.toLowerCase())) continue
      const { snippet, ranges } = withSnippets ? buildSnippet(text, trimmed) : { snippet: '', ranges: [] as Array<[number, number]> }
      const anchor = withSnippets ? buildParagraphAnchor(text, trimmed) : undefined
      hits.push({
        sessionId: typeof row['session_id'] === 'string' ? row['session_id'] : '',
        messageId: typeof row['message_id'] === 'string' ? row['message_id'] : '',
        seq: typeof row['seq'] === 'number' ? row['seq'] : 0,
        ...(typeof row['part_id'] === 'string' && row['part_id'] !== '' ? { partId: row['part_id'] } : {}),
        user: row['role'] === 'user',
        snippet,
        ranges,
        score: typeof row['score'] === 'number' ? row['score'] : 0,
        ...(typeof row['ts'] === 'number' ? { ts: row['ts'] } : {}),
        ...(withSnippets ? {} : { text }),
        ...(anchor === undefined ? {} : { paragraph: anchor.paragraph, matchIndex: anchor.matchIndex }),
      })
    }
    return hits
  }

  /** Hits per session, best first — the shape the grouped phone UI will consume. */
  queryGroups(query: string, options: { limits?: number; sessions?: number } = {}): Array<{ sessionId: string; hits: number; best: SearchIndexHit }> {
    const perSession = Math.min(Math.max(options.limits ?? 3, 1), 10)
    const sessionCap = Math.min(Math.max(options.sessions ?? 30, 1), 60)
    const all = this.query(query, { limit: perSession * sessionCap })
    const grouped = new Map<string, { sessionId: string; hits: number; best: SearchIndexHit }>()
    for (const hit of all) {
      const current = grouped.get(hit.sessionId)
      if (current === undefined) grouped.set(hit.sessionId, { sessionId: hit.sessionId, hits: 1, best: hit })
      else current.hits += 1
    }
    return [...grouped.values()].slice(0, sessionCap)
  }

  /**
   * 分页用的分组查询：一个会话一行，行内带最多 `limits` 条命中（用于「还有 N 条」）。
   *
   * 为什么要多取候选：分组后按会话切片，如果只取 `perSession × (offset + sessions)` 条，
   * 命中稀疏的会话会把后面的会话挤出去，翻页就会漏。这里按 3 倍超取再切，宁可多读
   * 几行也不要漏会话；上限 200 条是为了不让极端关键词（上千命中）把一次查询拖长。
   *
   * 时间衰减在这里做（不是 SQL）：bm25 是负数，越好越负；乘一个 <1 的正系数会把它"放松"
   * 从而排后，所以按 `score × decay` 升序重排是对的，别改成绝对值或加法。
   */
  queryGroupsDetailed(
    query: string,
    options: { limits?: number; sessions?: number; offset?: number } = {},
  ): { groups: SearchGroupDetail[]; hasMore: boolean; totalGroups: number } {
    const perSession = Math.min(Math.max(options.limits ?? 2, 1), 5)
    const sessionCap = Math.min(Math.max(options.sessions ?? 12, 1), 40)
    const offset = Math.max(Math.floor(options.offset ?? 0), 0)
    const trimmed = query.trim()
    // 候选池必须**和页偏移无关**，否则第 2 页的分组是在一个更大的池子里重排出来的：
    // 第 1 页出现过的会话会再出现一次，用户点「加载更多」看到重复行（实测第 2 页
    // 5 条里有 3 条和第 1 页重复）。这里固定取 SEARCH_POOL_HITS 条再分组切片，
    // 只要关键词的命中数在池内，任意一页都是同一份排序的连续切片。
    const all = this.runQuery(query, { limit: SEARCH_POOL_HITS, withSnippets: false })
    const now = Date.now()
    const decayed = all
      .map(hit => {
        const ageDays = Math.max(0, (now - (hit.ts ?? now)) / 86_400_000)
        return { hit, rank: hit.score * (1 / (1 + ageDays / RECENCY_HALF_LIFE_DAYS)) }
      })
      .sort((left, right) => left.rank - right.rank)
    const grouped = new Map<string, SearchGroupDetail>()
    for (const entry of decayed) {
      const hit = entry.hit
      const current = grouped.get(hit.sessionId)
      if (current === undefined) {
        grouped.set(hit.sessionId, { sessionId: hit.sessionId, hits: 1, best: hit, messages: [hit] })
        continue
      }
      current.hits += 1
      if (current.messages.length < perSession) current.messages.push(hit)
    }
    const page = [...grouped.values()].slice(offset, offset + sessionCap)
    // 只有真正要展示的这一页算摘要（超取的候选不算），这是 100ms→10ms 的差别。
    for (const group of page) {
      group.messages = group.messages.map(hit => {
        if (hit.snippet !== '' || hit.text === undefined) return hit
        const { snippet, ranges } = buildSnippet(hit.text, trimmed)
        return { ...hit, snippet, ranges }
      })
      const best = group.messages[0]
      if (best !== undefined) group.best = best
    }
    return { groups: page, hasMore: grouped.size > offset + sessionCap, totalGroups: grouped.size }
  }

  /**
   * Sessions whose TITLE matches the query literally. Titles live in the
   * `sessions` table (a few hundred rows), so a LIKE scan answers in
   * microseconds — and it keeps the FTS index per-message, which is what makes
   * hit counts per session honest.
   */
  titleHits(query: string, limit = 20): Array<{ sessionId: string; title: string }> {
    const trimmed = normalizeQueryText(query).trim()
    if (trimmed === '') return []
    const like = `%${trimmed.replace(/[%_]/g, match => `\\${match}`)}%`
    const rows = this.db.prepare(`
      SELECT session_id, title FROM sessions
      WHERE title IS NOT NULL AND lower(title) LIKE lower(?) ESCAPE '\\'
      ORDER BY indexed_at DESC
      LIMIT ?
    `).all(like, Math.min(Math.max(limit, 1), MAX_LIMIT)) as Array<Record<string, unknown>>
    const hits: Array<{ sessionId: string; title: string }> = []
    for (const row of rows) {
      if (typeof row['session_id'] !== 'string' || typeof row['title'] !== 'string') continue
      hits.push({ sessionId: row['session_id'], title: row['title'] })
    }
    return hits
  }
}
