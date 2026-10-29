/**
 * Read-only git summary for the phone.
 *
 * On a phone the question is almost never "let me edit this file" — it is
 * "what changed, and did it land?" A diff list, the current branch, how far
 * it is from its upstream, and the last few commits answer that in one
 * screen, which is more than a full editor would.
 *
 * Strictly read-only: the command set is fixed here and never takes
 * user-supplied arguments, so nothing on the phone can stage, commit, push or
 * check out. A directory that is not a git work tree is a normal answer (not
 * an error) — most folders on a workstation are not.
 */

import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** One changed path from `git status`. */
export interface GitFileChange {
  path: string
  /** The porcelain code as git reports it (M, A, D, R, ?? …). */
  status: string
  /** Whether the change is already staged (index vs HEAD). */
  staged: boolean
}

/** One entry from `git log`. */
export interface GitCommit {
  shortHash: string
  subject: string
  author: string
  /** Committer epoch (seconds → ms). */
  at: number
}

/** Everything the phone renders, or the reason it cannot. */
export interface GitSummary {
  /** False when the directory is not inside a work tree. */
  repo: boolean
  branch?: string
  /** Commits ahead of / behind the upstream, when one is configured. */
  ahead?: number
  behind?: number
  files: GitFileChange[]
  commits: GitCommit[]
  /** Present when the summary is partial (e.g. a git command timed out). */
  warning?: string
}

/** A hard cap on how long one git command may take. */
const GIT_TIMEOUT_MS = 5_000
/** Cap on command output (a huge status in a monorepo must not exhaust memory). */
const GIT_MAX_BUFFER = 1024 * 1024
/** How many commits the phone shows. */
const COMMIT_LIMIT = 12
/**
 * 结果复用窗口。手机从会话列表点进工作区、再返回、再点进同一个目录，
 * 几秒内会重复问同一份摘要；原来每次都串行跑 5 条 git 命令、单条最长 5 秒，
 * 最坏就是 25 秒转圈。5 秒内复用上一次的结果（工作区页本来也就这个刷新节奏）。
 */
export const GIT_CACHE_TTL_MS = 5_000

/** One git invocation: the seam tests replace to count calls and fake output. */
export type GitRunner = (cwd: string, args: string[]) => Promise<string>

/** Run one fixed git command in `cwd`; resolves to its stdout. */
async function execGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', cwd, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
  })
  return stdout
}

/**
 * 真实的 git 命令来源。测试通过 {@link setGitRunnerForTests} 换成计数的桩，
 * 避免每个用例都去真的建仓库；生产代码永远走 execGit。
 */
let gitRunner: GitRunner = execGit

/** 仅供测试：替换 git 命令来源；不传参数则恢复真实命令。 */
export function setGitRunnerForTests(runner?: GitRunner): void {
  gitRunner = runner ?? execGit
}

/** 一次摘要缓存（按解析后的目录路径归档）。 */
interface CachedSummary {
  at: number
  value: GitSummary
}

const cache = new Map<string, CachedSummary>()
/** 同一目录的并发请求共享这一条在飞 promise，只跑一次命令。 */
const inflight = new Map<string, Promise<GitSummary>>()

/**
 * Drop the summary cache (test hook, and the cheap way to force a re-read).
 *
 * 连在飞的请求一起丢掉：否则清完缓存后，先前那次读回来还会写进新窗口。
 */
export function resetGitCache(): void {
  cache.clear()
  inflight.clear()
}

/** A directory that is gone (or unreadable) is a normal "nothing to show". */
function missingDirectory(): GitSummary {
  return { repo: false, files: [], commits: [], warning: '目录不存在' }
}

/**
 * 路径检查（解析 + 是否目录）。statSync 在路径不存在、无权限、中途被删时
 * 都会同步抛出；调用方如果把它放在 try 外面，「永不抛」的承诺就是假的——
 * 手机端拿到的是 500，不是一句「目录不存在」。所以这里整个包进 try。
 */
function resolveDirectory(cwd: string): string | undefined {
  try {
    const key = resolve(cwd)
    return statSync(key).isDirectory() ? key : undefined
  } catch {
    return undefined
  }
}

/** Parse `git status --porcelain` (v1) into change rows. */
export function parseGitStatus(stdout: string): GitFileChange[] {
  const files: GitFileChange[] = []
  for (const line of stdout.split('\n')) {
    if (line.length < 4) continue
    const index = line[0] ?? ' '
    const worktree = line[1] ?? ' '
    const path = line.slice(3)
    // A rename/copy shows both sides ("old -> new"); the new name is what the
    // user is looking for.
    const arrow = path.indexOf(' -> ')
    const shown = arrow === -1 ? path : path.slice(arrow + 4)
    const status = worktree !== ' ' && worktree !== '?' ? worktree : index
    files.push({
      path: shown,
      status: status === '?' ? '??' : status,
      staged: index !== ' ' && index !== '?',
    })
  }
  return files
}

/**
 * Parse `git status --porcelain=v1 -z` into change rows.
 *
 * 路径按原始字符返回（中文、空格都不再被转义成 "\344\270\255" 这种 C 风格串）；
 * 重命名/复制在 -z 下把原名放在紧随其后的那条记录里，那条记录没有状态列，
 * 不跳过就会在列表里多出一行「半个改动」。
 */
export function parseGitStatusZ(stdout: string): GitFileChange[] {
  const files: GitFileChange[] = []
  const records = stdout.split('\0')
  for (let at = 0; at < records.length; at += 1) {
    const record = records[at]
    if (record === undefined || record.length < 4) continue
    const index = record[0] ?? ' '
    const worktree = record[1] ?? ' '
    if (index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C') at += 1
    const status = worktree !== ' ' && worktree !== '?' ? worktree : index
    files.push({
      path: record.slice(3),
      status: status === '?' ? '??' : status,
      staged: index !== ' ' && index !== '?',
    })
  }
  return files
}

/** Parse the `%h%x1f%s%x1f%an%x1f%at` log format. */
export function parseGitLog(stdout: string): GitCommit[] {
  const commits: GitCommit[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const [shortHash, subject, author, at] = line.split('\x1f')
    if (shortHash === undefined || subject === undefined) continue
    const seconds = Number(at)
    commits.push({
      shortHash,
      subject,
      author: author ?? '',
      at: Number.isFinite(seconds) ? seconds * 1000 : 0,
    })
  }
  return commits
}

/** Parse the `--left-right --count` output ("<behind>\t<ahead>"). */
export function parseAheadBehind(stdout: string): { ahead: number; behind: number } | undefined {
  const parts = stdout.trim().split(/\s+/)
  if (parts.length !== 2) return undefined
  const behind = Number(parts[0])
  const ahead = Number(parts[1])
  if (!Number.isFinite(ahead) || !Number.isFinite(behind)) return undefined
  return { ahead, behind }
}

/**
 * Build the summary for one directory. Never throws: a failure is reported as
 * a partial summary with a warning, because a git page that crashes is worse
 * than one that says "could not read the log".
 *
 * 同一目录 5 秒内的重复打开复用上一次结果，并发请求共享同一条在飞 promise
 * （与 history 游标缓存、手机端读合并同一套写法）。
 */
export async function readGitSummary(cwd: string): Promise<GitSummary> {
  const key = resolveDirectory(cwd)
  if (key === undefined) return missingDirectory()
  const cached = cache.get(key)
  if (cached !== undefined && Date.now() - cached.at < GIT_CACHE_TTL_MS) return cached.value
  const pending = inflight.get(key)
  if (pending !== undefined) return pending
  const promise = collectGitSummary(key)
    .catch((): GitSummary => ({
      repo: true,
      files: [],
      commits: [],
      warning: '读取仓库信息失败',
    }))
    .then((summary) => {
      cache.set(key, { at: Date.now(), value: summary })
      return summary
    })
    .finally(() => { inflight.delete(key) })
  inflight.set(key, promise)
  return promise
}

/** Run every read for one directory; each failure degrades only its own field. */
async function collectGitSummary(cwd: string): Promise<GitSummary> {
  try {
    const inside = await gitRunner(cwd, ['rev-parse', '--is-inside-work-tree'])
    if (inside.trim() !== 'true') return { repo: false, files: [], commits: [] }
  } catch {
    return { repo: false, files: [], commits: [] }
  }
  const summary: GitSummary = { repo: true, files: [], commits: [] }
  try {
    summary.branch = (await gitRunner(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  } catch {
    summary.branch = undefined
  }
  try {
    const status = await gitRunner(cwd, ['status', '--porcelain=v1', '-z'])
    // 老输出（没有 NUL）退回按行解析：命令形状万一被上游改回非 -z，列表也不该整页空掉。
    summary.files = status.includes('\0') ? parseGitStatusZ(status) : parseGitStatus(status)
  } catch {
    summary.warning = '读取改动失败'
  }
  try {
    summary.commits = parseGitLog(await gitRunner(cwd, ['log', `-n`, String(COMMIT_LIMIT), '--pretty=format:%h%x1f%s%x1f%an%x1f%at']))
  } catch {
    // A repository with no commits yet has nothing to log; that is not a
    // failure worth surfacing.
  }
  try {
    const counts = parseAheadBehind(await gitRunner(cwd, ['rev-list', '--count', '--left-right', '@{upstream}...HEAD']))
    if (counts !== undefined) {
      summary.ahead = counts.ahead
      summary.behind = counts.behind
    }
  } catch {
    // No upstream configured: ahead/behind simply do not apply.
  }
  return summary
}
