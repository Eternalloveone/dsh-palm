/**
 * **host · 目录浏览域**（W5-1：从 `mobile-api.ts` 抽出的第三个域）。
 *
 * 手机上的"选一个目录"要跨平台：Windows 盘符根（`C:\`）与 POSIX 的 `/` 规则完全不同，
 * 路径分隔、祖先链、隐藏项判定都得各写一套。这些规则原来埋在 5,000 行分发文件的中段。
 *
 * 语义没变：面包屑**从根到目标**；单层条目超上限就截断（`truncated`）；读目录失败返回
 * 空列表而不是抛错（手机端只想知道"能选什么"）。
 *
 * @module dsh-palm/host/directory
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { opendir as opendirCb, stat as statCb } from 'node:fs'
import { promisify } from 'node:util'
import { basename, dirname, join, resolve } from 'node:path'
import { RpcId } from '../api-proxy-types'
import type { ApiProxy } from '../api-proxy-types'
import { hydrateSessionRoster, isRosterHydrated, rosterTtlCache } from './session-roster.ts'
import type { ChatWindowService } from '../chat-window.ts'
import { READ_CHAT_MAX_ROWS } from '../chat-window.ts'
import { homedir } from 'node:os'

/** 目录遍历全用 promise 版（原来在 mobile-api.ts 里就地 promisify，搬过来一起带过来）。 */
const stat = promisify(statCb)
const opendir = promisify(opendirCb)

/** One directory row the mobile browser can enter (directories + symlinks to dirs). */
export interface MobileDirectoryEntry {
  name: string
  path: string
  hidden: boolean
  /** 带上文件一起列时才有：区分目录与文件（目录浏览老调用方不看这两个字段）。 */
  kind?: 'dir' | 'file'
  /** 文件的字节数（只有 kind === 'file' 时有）。 */
  bytes?: number
}

/** One-level directory listing with ancestor breadcrumbs (host.listDirectory shape). */
export interface MobileDirectoryListing {
  path: string
  home: string
  crumbs: MobileDirectoryEntry[]
  entries: MobileDirectoryEntry[]
  truncated: boolean
}

/** Ancestor chain from the filesystem root to `target` inclusive (breadcrumb rows). */
export function mobileAncestryCrumbs(target: string): MobileDirectoryEntry[] {
  const crumbs: MobileDirectoryEntry[] = []
  let current = target
  for (;;) {
    const parent = dirname(current)
    crumbs.unshift({ name: parent === current ? current : basename(current), path: current, hidden: false })
    if (parent === current) return crumbs
    current = parent
  }
}

/**
 * List one directory level over the host filesystem (directories + symlinks
 * to directories, name-sorted, bounded at 1000 rows with `truncated`).
 * Local patch (2026-08-23): host.listDirectory is gated on the composed
 * directory-picker capability, which resolves to `native` on Windows loopback
 * binds — the mobile workspace browser (#977) therefore failed there. This
 * plugin-side listing replicates the browse backend's shape and works on
 * every platform.
 *
 * Windows drive switching: at a drive root (e.g. `C:\`) the listing prepends a
 * "此电脑" crumb; clicking it lists the available drives (A:-Z:), and clicking
 * a drive enters that drive's root. The upstream browse backend has no drive
 * picker, so only the starting drive was reachable.
 */

/** Sentinel path for the "This PC" drive picker (never a real filesystem path). */
const THIS_PC = 'this-pc'

/** Upper bound for one file-preview read (256 KiB: code/text files preview; huge logs refuse). */
export const MOBILE_READ_FILE_MAX_BYTES = 256 * 1024

/** Upper bound for one image-preview read (8 MiB: photo/screenshot preview). */
export const MOBILE_READ_IMAGE_MAX_BYTES = 8 * 1024 * 1024

/** File extension → image media type (for base64 data URLs in previews). */
export const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
}

/** True when a path names a raster/vector image we can preview as data URL. */
export function isImagePath(value: string): boolean {
  const base = value.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  return IMAGE_MIME[ext] !== undefined
}

/** True for an absolute path on Windows (`C:\…` / `C:/…`) or POSIX (`/…`). */
export function isAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\')
}

/**
 * Candidate absolute targets for one file-preview path. An absolute path
 * resolves as-is. A relative path (the form agents usually write) is tried
 * against every plausible base — the owning session's cwd first (the agent
 * worked there), then the host process cwd, then every workspace path, then
 * directories recovered from ABSOLUTE file paths that already appear in the
 * session's chat window (an agent that writes `packages/…/mux.ts` relative
 * to the checkout it edits has almost always also printed the same file as
 * `C:\…\dsh-source\dsh-palm\packages\…` somewhere in the same conversation).
 * The caller stats each candidate and uses the first that exists.
 */
/**
 * 找一个会话的 cwd：宿主的分页接口一页 40 条，只查第一页会漏掉老会话（用户有 3500+
 * 个会话），漏了就退回 process.cwd()，相对路径自然对不上 → "文件不可读"。
 * 这里最多翻 5 页（200 条），仍找不到就返回 undefined（保持原有的兜底顺序）。
 *
 * @param apiProxy - 宿主 API 代理
 * @param sessionId - 目标会话
 * @returns 会话的工作目录；找不到时 undefined
 */
/**
 * 从会话花名册里直接取 cwd（同步、零 RPC）。
 *
 * 花名册还没水合时顺手水合一次（读的是磁盘快照，几毫秒），这样"开机后第一次点文件"
 * 也不必等一次全量会话枚举（实测冷启动 3.2 秒，用户体感就是"点了打不开"）。
 *
 * @param sessionId - 目标会话
 * @param apiProxy - 宿主代理（水合时要用）
 * @returns 会话的 cwd；花名册里没有就 undefined
 */
function cwdFromRoster(sessionId: string, apiProxy: ApiProxy): string | undefined {
  try {
    // 必须把真实代理交给水合：花名册的后台刷新靠它（传 undefined 会让抽屉只剩缓存）。
    if (!isRosterHydrated()) hydrateSessionRoster(apiProxy)
    const cache = rosterTtlCache()
    const item = cache?.rawItems.find(raw => raw.sessionId === sessionId)
    return typeof item?.cwd === 'string' && item.cwd !== '' ? item.cwd : undefined
  } catch {
    return undefined
  }
}

async function findSessionCwd(apiProxy: ApiProxy, sessionId: string): Promise<string | undefined> {
  // 0) 花名册缓存（含落盘快照）：命中就完全不用发 RPC。
  //    抽屉打开过、或本进程启动时水合过，就有这条路径。
  const fromRoster = cwdFromRoster(sessionId, apiProxy)
  if (fromRoster !== undefined) return fromRoster
  let cursor: string | undefined
  for (let page = 0; page < 5; page += 1) {
    const response = await apiProxy.sessions.list({ rpcId: RpcId('dsh-palm-readfile'), payload: cursor === undefined ? {} : { cursor } } as never)
    const value = (response as { result?: { ok?: boolean; value?: { items?: Array<{ sessionId: string; cwd?: string }>; nextCursor?: string; hasMore?: boolean } } }).result?.value
    const items = value?.items ?? []
    const cwd = items.find(item => item.sessionId === sessionId)?.cwd
    if (typeof cwd === 'string' && cwd !== '') return cwd
    if (value?.hasMore !== true || value?.nextCursor === undefined) return undefined
    cursor = value.nextCursor
  }
  return undefined
}

/**
 * 相对路径找基准目录的两个缓存（2026-11-10）。
 *
 * 为什么要有：原来每打开一个文件都要现查一次 `sessions.list`（冷启动实测 6.3 秒）
 * 和 `workspace.list` —— 手机上表现成"点了路径要等很久，很多时候干脆打不开"。
 * 这两份数据在一次会话里几乎不变，缓存后打开文件不再有这两次往返。
 */
const READ_BASE_TTL_MS = 30_000
let readWorkspacePathsCache: { at: number; paths: string[] } | undefined
/** sessionId → 该会话的 cwd（命中就不再发 RPC）。 */
const readSessionCwdCache = new Map<string, string>()

/**
 * 有人把 Windows 绝对路径写成了 `/C:/Users/x.png`（前导斜杠 + 盘符）。
 *
 * 2026-11-11 真机：正文里的图片一张都显示不出来，界面上写着
 * 「方案 A未找到 · /C:/Users/Administrator/dsh-source/.../workspace-picker-a.png」——
 * 文件其实**就在那里**。原因是 `/C:/…` 在 Windows 上也是"绝对路径"，`resolve` 会把它
 * 解成 `C:\C:\Users\…`，于是 stat 落空。
 *
 * 只剥「斜杠 + 盘符」这一种形态（`/C:/`、`\C:\`、`/c:/`），别的一律原样返回：
 * 正常的 POSIX 绝对路径 `/home/me/a.png` 不能被改写。
 *
 * @param raw - 用户/模型写出来的路径
 * @returns 归一化后的路径
 */
export function normalizeAuthoredPath(raw: string): string {
  return raw.replace(/^[/\\]([A-Za-z]:[/\\])/, '$1')
}

export async function readCandidates(
  apiProxy: ApiProxy,
  raw: string,
  sessionId: string | undefined,
  chatWindows: ChatWindowService | undefined,
): Promise<string[]> {
  // 先归一化：`/C:/x.png` 这种写法在 Windows 上会被 resolve 成 `C:\C:\x.png`。
  raw = normalizeAuthoredPath(raw)
  if (isAbsolutePath(raw)) return [resolve(raw)]
  const bases: string[] = []
  /** Exact absolute targets recovered from the chat window (already full paths). */
  const candidatesRaw: string[] = []
  if (sessionId !== undefined) {
    const cached = readSessionCwdCache.get(sessionId)
    if (cached !== undefined) {
      bases.push(cached)
    } else {
      try {
        const cwd = await findSessionCwd(apiProxy, sessionId)
        if (cwd !== undefined && cwd !== '') {
          readSessionCwdCache.set(sessionId, cwd)
          bases.push(cwd)
        }
      } catch {
        // session lookup failed: fall through to the remaining bases
      }
    }
  }
  bases.push(process.cwd())
  try {
    const now = Date.now()
    if (readWorkspacePathsCache === undefined || now - readWorkspacePathsCache.at > READ_BASE_TTL_MS) {
      const response = await apiProxy.workspace.list({ rpcId: RpcId('dsh-palm-readfile-ws'), payload: {} } as never)
      const wsItems = (response as { result?: { ok?: boolean; value?: { items?: Array<{ path?: string }> } } }).result?.value?.items ?? []
      readWorkspacePathsCache = {
        at: now,
        paths: wsItems
          .map(item => (typeof item.path === 'string' ? item.path : ''))
          .filter(path => path !== ''),
      }
    }
    for (const path of readWorkspacePathsCache.paths) bases.push(path)
  } catch {
    // workspace enumeration failed: process.cwd() is already in the list
  }
  // Directories that already contain this path as an absolute mention in the
  // same conversation are the most precise base for an agent-relative path.
  if (sessionId !== undefined && chatWindows !== undefined) {
    try {
      const page = await chatWindows.tail(sessionId, READ_CHAT_MAX_ROWS)
      const absPaths = new Set<string>()
      for (const row of page.rows) {
        const text = row.text ?? ''
        // Match absolute Windows/POSIX paths inside the row text.
        for (const match of text.matchAll(/(?:[A-Za-z]:[\\/]|\/)[^\s`"'<>|]+/g)) {
          const token = match[0].trimEnd()
          // Keep tokens that look like file paths (a separator and a
          // dot-extension); strip trailing punctuation that the regex may
          // have swallowed is handled by trimEnd above (paths rarely end in
          // CJK punctuation, so a `.`/`,` boundary is not stripped here).
          if (/[\\/]/.test(token) && /\.[A-Za-z0-9]{1,8}$/.test(token)) absPaths.add(token)
        }
      }
      const rawNorm = raw.replaceAll('\\', '/')
      // 1) An absolute path that ENDS with the raw relative path is the exact
      //    target (agent printed it; resolve straight to it).
      for (const abs of absPaths) {
        if (abs.replaceAll('\\', '/').endsWith(rawNorm)) candidatesRaw.push(abs)
      }
      // 2) Otherwise offer each absolute path's directory as a base.
      for (const abs of absPaths) {
        const dir = dirname(abs)
        if (dir !== abs && dir !== '.') bases.push(dir)
      }
    } catch {
      // window unavailable: rely on the bases already collected
    }
  }
  const seen = new Set<string>()
  const candidates: string[] = []
  // Exact absolute paths recovered from the window come first (they are the
  // very file the agent meant when it printed the relative form).
  for (const exact of candidatesRaw) {
    if (exact === '') continue
    const target = resolve(exact)
    if (seen.has(target)) continue
    seen.add(target)
    candidates.push(target)
  }
  for (const base of bases) {
    if (base === '') continue
    const target = resolve(base, raw)
    if (seen.has(target)) continue
    seen.add(target)
    candidates.push(target)
  }
  // 2026-11-11 用户：「交付卡里有的文件点开显示找不到这个文件」。
  //
  // 现场是工具把路径写成**相对它自己的工作目录**（例如 `ui/sheet.tsx`，真实位置是
  // `packages/dsh-palm/src/mobile/ui/sheet.tsx`）。上面那几条基准目录都拼不出来，
  // 聊天记录里也未必留过它的绝对形式。这里补最后一条：按路径后缀在工作区里找**唯一**
  // 同名文件。只在「按基准目录确实都不存在」时启用，避免每次预览都去扫盘。
  if (/[\\/]/u.test(raw) && ![...seen].some(path => existsSync(path))) {
    // 按**路径段**比后缀（不是按字符串）：ui/sheet.tsx 不能配到 xui/sheet.tsx。
    const tailSegments = pathSegmentsOf(raw)
    for (const base of bases.slice(0, SUFFIX_SEARCH_MAX_ROOTS)) {
      if (base === '') continue
      // 歧义（两个同名文件）时**不猜**：宁可报"找不到"，也不要打开另一个文件。
      let hit: string | undefined
      let ambiguous = false
      for (const file of await indexedFilesUnder(base)) {
        if (!endsWithSegments(file, tailSegments)) continue
        if (hit === undefined) hit = file
        else if (hit !== file) { ambiguous = true; break }
      }
      if (hit !== undefined && !ambiguous) {
        const target = resolve(hit)
        if (!seen.has(target)) { seen.add(target); candidates.push(target) }
      }
    }
  }
  return candidates
}

/** 路径 → 归一化的小写段数组（去空段、认两种分隔符）。 */
function pathSegmentsOf(path: string): string[] {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '').toLowerCase().split('/').filter(segment => segment !== '')
}

/** `path` 的路径段是否以 `tail` 结尾（按段比，避免 `xui` 命中 `ui`）。 */
function endsWithSegments(path: string, tail: readonly string[]): boolean {
  if (tail.length === 0) return false
  const full = pathSegmentsOf(path)
  if (full.length < tail.length) return false
  const start = full.length - tail.length
  return tail.every((segment, index) => full[start + index] === segment)
}

/** 后缀兜底最多查几个基准目录（工作区多开时别扫一遍整台机器）。 */
const SUFFIX_SEARCH_MAX_ROOTS = 3
/** 一次索引最多记多少个文件：够覆盖常规仓库，超了宁可放弃兜底。 */
const SUFFIX_INDEX_MAX_FILES = 20_000
/** 索引深度上限：`node_modules/a/b/c/...` 那种没必要走到底。 */
const SUFFIX_INDEX_MAX_DEPTH = 8
/** 索引缓存时长：文件增删不必秒级准确，60 秒足够。 */
const SUFFIX_INDEX_TTL_MS = 60_000
/** 这些目录里的文件不需要进索引（体积大、且不是会话改动的目标）。 */
const SUFFIX_SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.turbo', 'target', '.venv', 'venv', '__pycache__',
])

/** root → 索引结果（含生成时间）。 */
const fileIndexCache = new Map<string, { at: number; files: string[] }>()

/**
 * `root` 下的文件清单（懒建索引，缓存 60 秒）。
 *
 * @param root - 基准目录（工作区根 / 会话 cwd）
 * @returns 绝对文件路径；读不动就返回空表（调用方按"没找到"处理）
 */
async function indexedFilesUnder(root: string): Promise<string[]> {
  const cached = fileIndexCache.get(root)
  const now = Date.now()
  if (cached !== undefined && now - cached.at < SUFFIX_INDEX_TTL_MS) return cached.files
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > SUFFIX_INDEX_MAX_DEPTH || files.length >= SUFFIX_INDEX_MAX_FILES) return
    let handle
    try {
      handle = await opendir(dir)
    } catch {
      return
    }
    for await (const entry of handle) {
      if (files.length >= SUFFIX_INDEX_MAX_FILES) return
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SUFFIX_SKIP_DIRS.has(entry.name)) continue
        await walk(full, depth + 1)
      } else if (entry.isFile()) {
        files.push(full)
      }
    }
  }
  await walk(root, 0)
  fileIndexCache.set(root, { at: now, files })
  return files
}

/** Windows drive letters that exist (A:-Z:), rendered as the This-PC drive picker. */
export async function windowsDrives(): Promise<MobileDirectoryEntry[]> {
  const drives: MobileDirectoryEntry[] = []
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code)
    const root = `${letter}:\\`
    try {
      await stat(root)
      drives.push({ name: root, path: root, hidden: false })
    } catch {
      // drive absent
    }
  }
  return drives
}

/** True when the resolved path is a Windows drive root (e.g. `C:\`). */
export function isWindowsDriveRoot(target: string): boolean {
  return /^[A-Za-z]:[\\/]$/.test(target)
}

export async function mobileListDirectory(path: string | undefined, files = false): Promise<MobileDirectoryListing> {
  const home = homedir()
  // This-PC drive picker (Windows): list available drives instead of a level.
  if (path === THIS_PC) {
    return {
      path: THIS_PC,
      home,
      crumbs: [{ name: '此电脑', path: THIS_PC, hidden: false }],
      entries: await windowsDrives(),
      truncated: false,
    }
  }
  const target = resolve(path ?? home)
  const maxEntries = 1000
  const keep = maxEntries + 1
  const collected: Array<{ name: string; isDirectory: boolean; isSymbolicLink: boolean }> = []
  let evicted = false
  try {
    const dir = await opendir(target)
    try {
      for (;;) {
        const dirent = await dir.read()
        if (dirent === null) break
        if (!dirent.isDirectory() && !dirent.isSymbolicLink() && !files) continue
        collected.push({ name: dirent.name, isDirectory: dirent.isDirectory(), isSymbolicLink: dirent.isSymbolicLink() })
      }
    } finally {
      await dir.close()
    }
  } catch (error: unknown) {
    throw new Error(`cannot list ${target}: ${error instanceof Error ? error.message : String(error)}`)
  }
  // One sort instead of the previous per-insert binary splice (O(n^2) on big
  // directories); the window keeps the first `keep` rows by name.
  collected.sort((left, right) => left.name.localeCompare(right.name))
  const window = collected.length > keep ? collected.slice(0, keep) : collected
  evicted = collected.length > keep
  const entries: MobileDirectoryEntry[] = []
  let truncated = evicted
  for (const candidate of window) {
    const entryPath = join(target, candidate.name)
    let enterable = candidate.isDirectory
    if (!enterable && candidate.isSymbolicLink) {
      try {
        enterable = (await stat(entryPath)).isDirectory()
      } catch {
        continue // broken/cyclic symlink: not enterable
      }
    }
    if (!enterable) {
      // 文件行：只有调用方要文件（files=true）时才会走到这里，带上字节数给手机显示。
      if (!files) continue
      let bytes: number | undefined
      try {
        bytes = (await stat(entryPath)).size
      } catch {
        continue // 读不到大小的（权限/竞态删掉）就别列了
      }
      if (entries.length === maxEntries) {
        truncated = true
        break
      }
      entries.push({ name: candidate.name, path: entryPath, hidden: candidate.name.startsWith('.'), kind: 'file', bytes })
      continue
    }
    if (entries.length === maxEntries) {
      truncated = true
      break
    }
    entries.push({ name: candidate.name, path: entryPath, hidden: candidate.name.startsWith('.'), kind: 'dir' })
  }
  const crumbs = mobileAncestryCrumbs(target)
  // Windows: at a drive root, prepend a "此电脑" crumb so the user can switch drives.
  if (isWindowsDriveRoot(target)) {
    crumbs.unshift({ name: '此电脑', path: THIS_PC, hidden: false })
  }
  return { path: target, home, crumbs, entries, truncated }
}
