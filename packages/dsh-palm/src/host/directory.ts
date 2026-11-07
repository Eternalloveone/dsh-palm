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
export async function readCandidates(
  apiProxy: ApiProxy,
  raw: string,
  sessionId: string | undefined,
  chatWindows: ChatWindowService | undefined,
): Promise<string[]> {
  if (isAbsolutePath(raw)) return [resolve(raw)]
  const bases: string[] = []
  /** Exact absolute targets recovered from the chat window (already full paths). */
  const candidatesRaw: string[] = []
  if (sessionId !== undefined) {
    try {
      const response = await apiProxy.sessions.list({ rpcId: RpcId('dsh-palm-readfile'), payload: {} } as never)
      const items = (response as { result?: { ok?: boolean; value?: { items?: Array<{ sessionId: string; cwd?: string }> } } }).result?.value?.items ?? []
      const cwd = items.find(item => item.sessionId === sessionId)?.cwd
      if (typeof cwd === 'string' && cwd !== '') bases.push(cwd)
    } catch {
      // session lookup failed: fall through to the remaining bases
    }
  }
  try {
    bases.push(process.cwd())
    const response = await apiProxy.workspace.list({ rpcId: RpcId('dsh-palm-readfile-ws'), payload: {} } as never)
    const wsItems = (response as { result?: { ok?: boolean; value?: { items?: Array<{ path?: string }> } } }).result?.value?.items ?? []
    for (const item of wsItems) {
      if (typeof item.path === 'string' && item.path !== '') bases.push(item.path)
    }
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
  return candidates
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
