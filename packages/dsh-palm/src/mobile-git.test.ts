/**
 * mobile-git 的三条用户可见契约：中文/空格路径要能读出来、目录没了不能把请求炸掉、
 * 同一个目录几秒内只枚举一次（手机来回点工作区时不再反复等 5 条 git 命令）。
 * 命令来源被替换成计数桩，用例不建真实仓库、不碰用户目录。
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GIT_CACHE_TTL_MS,
  readGitSummary,
  resetGitCache,
  setGitRunnerForTests,
  type GitRunner,
} from './mobile-git.ts'

const dirs: string[] = []

/** A real (empty) directory so the path check passes before the fake git runs. */
function makeWorktree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-mobile-git-'))
  dirs.push(dir)
  return dir
}

/** Fake git that records every invocation and returns the given status stdout. */
function countingRunner(status: string): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  const runner: GitRunner = async (_cwd, args) => {
    calls.push(args)
    if (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree') return 'true\n'
    if (args[0] === 'rev-parse') return 'main\n'
    if (args[0] === 'status') return status
    if (args[0] === 'log') return ''
    throw new Error('no upstream')
  }
  return { runner, calls }
}

beforeEach(() => {
  resetGitCache()
  setGitRunnerForTests()
})

afterEach(() => {
  setGitRunnerForTests()
  resetGitCache()
  vi.useRealTimers()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('readGitSummary', () => {
  it('status 用 -z 解码中文与空格路径，重命名只留新名字', async () => {
    const dir = makeWorktree()
    const { runner, calls } = countingRunner(
      'M  中文 文件.txt\0R  新 名字.txt\0旧 名字.txt\0?? 未 跟踪.md\0',
    )
    setGitRunnerForTests(runner)

    const summary = await readGitSummary(dir)

    // -z 是解码的前提：没有它，git 会把非 ASCII 路径转义成 "\344\270\255…"。
    expect(calls.find(args => args[0] === 'status')).toContain('-z')
    expect(summary.files).toEqual([
      { path: '中文 文件.txt', status: 'M', staged: true },
      { path: '新 名字.txt', status: 'R', staged: true },
      { path: '未 跟踪.md', status: '??', staged: false },
    ])
  })

  it('目录不存在时返回降级结果而不是抛出', async () => {
    const missing = join(tmpdir(), `dsh-palm-mobile-git-missing-${randomUUID()}`)
    const { runner, calls } = countingRunner('')
    setGitRunnerForTests(runner)

    // 原实现把 statSync 放在 try 外面：路径不存在时这里抛的是异常，不是摘要。
    const summary = await readGitSummary(missing)

    expect(summary.repo).toBe(false)
    expect(summary.files).toEqual([])
    expect(summary.commits).toEqual([])
    expect(summary.warning).toBe('目录不存在')
    expect(calls).toHaveLength(0)
  })

  it('同一目录的并发请求只跑一遍命令', async () => {
    const dir = makeWorktree()
    const { runner, calls } = countingRunner('')
    setGitRunnerForTests(runner)

    await Promise.all([readGitSummary(dir), readGitSummary(dir)])

    // 一次摘要 5 条命令；并发共享在飞 promise，所以不是 10。
    expect(calls).toHaveLength(5)
    // 窗口内的第三次读连命令都不发。
    await readGitSummary(dir)
    expect(calls).toHaveLength(5)
  })

  it('缓存窗口过期后重新读一次', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const dir = makeWorktree()
    const { runner, calls } = countingRunner('')
    setGitRunnerForTests(runner)

    await readGitSummary(dir)
    expect(calls).toHaveLength(5)

    vi.setSystemTime(GIT_CACHE_TTL_MS + 1)
    await readGitSummary(dir)
    expect(calls).toHaveLength(10)
  })
})
