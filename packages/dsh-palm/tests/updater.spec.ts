/**
 * The updater: target detection, plans for every branch, and the two tracks
 * (npm / source) including rollback and audit. Nothing here touches a real
 * install: every path is a mkdtemp sandbox and every process call is injected.
 */
import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PKG_NAME,
  NPM_FETCH_ARGS,
  UPDATE_AUDIT_FILE_NAME,
  UpdateCoordinator,
  detectInstallTarget,
  locateInstalledPackageDir,
  planUpdate,
  readPackageManifest,
  repoIsDirty,
  runUpdate,
  updateAuditFile,
  verifyInstalled,
  type InstallTarget,
  type UpdatePlan,
  type UpdateRunner,
} from '../src/updater.ts'

const PKG = DEFAULT_PKG_NAME
const PKG_SEGMENTS = PKG.split('/')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-palm-updater-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** Write a minimal package tree (package.json + entry file). */
function makePackage(packageDir: string, version: string, withEntry = true): void {
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: PKG, version, main: 'lib/index.js' }))
  if (withEntry) {
    mkdirSync(join(packageDir, 'lib'), { recursive: true })
    writeFileSync(join(packageDir, 'lib', 'index.js'), '// entry\n')
  }
}

/** The directory target used by the npm-track tests. */
function directoryTarget(packageDir: string): InstallTarget {
  return { shape: 'directory', resolved: packageDir }
}

/** A package dir the way a real profile has it: <profile>/node_modules/<pkg>. */
function installedPath(profileRoot: string): string {
  return join(profileRoot, 'node_modules', ...PKG_SEGMENTS)
}

/** A runner that records every call and answers by the given table. */
function recordingRunner(handler: (command: string, args: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string }> | { code: number; stdout: string; stderr: string }): {
  run: UpdateRunner
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    run: async (command, args) => {
      calls.push([command, ...args].join(' '))
      return await handler(command, args)
    },
  }
}

/** The staging npm install: create the staged package the way npm would. */
function stageRunner(version: string, calls: string[]): UpdateRunner {
  return async (command, args) => {
    calls.push([command, ...args].join(' '))
    if (command === 'npm') {
      const prefix = args[args.indexOf('--prefix') + 1] ?? ''
      makePackage(join(prefix, 'node_modules', ...PKG_SEGMENTS), version)
    }
    return { code: 0, stdout: '', stderr: '' }
  }
}

describe('detectInstallTarget', () => {
  it('reports a real directory with its resolved path', () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    const target = detectInstallTarget(installed)
    expect(target.shape).toBe('directory')
    expect(target.resolved).toBe(installed)
  })

  it('reports a missing path instead of throwing', () => {
    expect(detectInstallTarget(join(dir, 'nope'))).toEqual({ shape: 'missing' })
  })

  it('reports a link, resolves its target, and finds the source repo root', () => {
    const repo = join(dir, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const packageDir = join(repo, 'packages', 'dsh-palm')
    makePackage(packageDir, '1.6.2')
    const linkPath = join(dir, 'profiles', 'web', 'node_modules', ...PKG_SEGMENTS)
    mkdirSync(join(linkPath, '..'), { recursive: true })
    symlinkSync(packageDir, linkPath, 'junction')

    const target = detectInstallTarget(linkPath)
    expect(target.shape).toBe('link')
    expect(fs.realpathSync(packageDir)).toBe(target.resolved)
    expect(target.repoRoot).toBe(fs.realpathSync(repo))
  })
})

describe('planUpdate', () => {
  it('does nothing when the registry cannot be reached (offline)', () => {
    const plan = planUpdate({ installed: '1.6.2', latest: undefined, target: directoryTarget(join(dir, 'i')) })
    expect(plan.kind).toBe('noop')
    expect(plan.refuse).toBeUndefined()
    expect(plan.steps[0]).toContain('查不到最新版本')
  })

  it('does nothing when the installed version is already the latest', () => {
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.2', target: directoryTarget(join(dir, 'i')) })
    expect(plan.kind).toBe('noop')
    expect(plan.refuse).toBeUndefined()
    expect(plan.steps[0]).toContain('已经是最新')
  })

  it('refuses a link install whose source repo has uncommitted changes', () => {
    const target: InstallTarget = { shape: 'link', resolved: join(dir, 'repo', 'pkg'), repoRoot: join(dir, 'repo') }
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target, repoDirty: true })
    expect(plan.kind).toBe('noop')
    expect(plan.refuse).toContain('没提交的改动')
  })

  it('plans the npm track for an entity directory install', () => {
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target: directoryTarget(join(dir, 'i')) })
    expect(plan.kind).toBe('npm')
    expect(plan.steps[0]).toContain(`${PKG}@1.6.3`)
    expect(plan.refuse).toBeUndefined()
  })

  it('plans the source track for a clean link install', () => {
    const target: InstallTarget = { shape: 'link', resolved: join(dir, 'repo', 'pkg'), repoRoot: join(dir, 'repo') }
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target, repoDirty: false })
    expect(plan.kind).toBe('source')
    expect(plan.steps.join(' ')).toContain('快进合并')
    expect(plan.refuse).toBeUndefined()
  })

  it('refuses a link whose repo root cannot be found, and a missing install', () => {
    const link: InstallTarget = { shape: 'link', resolved: join(dir, 'somewhere') }
    expect(planUpdate({ installed: '1.6.2', latest: '1.6.3', target: link }).refuse).toContain('没找到源码仓库')
    expect(planUpdate({ installed: '1.6.2', latest: '1.6.3', target: { shape: 'missing' } }).refuse).toContain('没找到已安装')
  })
})

describe('npm fetch flags', () => {
  // A maxtimeout below npm's own default mintimeout (10s) makes npm refuse
  // *every* install with "minTimeout is greater than maxTimeout" — even against
  // a healthy registry. That shipped once and broke the whole update path, so
  // the window is asserted here rather than trusted to a comment.
  it('keeps the retry window self-consistent', () => {
    const numberArg = (name: string): number => {
      const hit = NPM_FETCH_ARGS.find((arg) => arg.startsWith(`--${name}=`))
      expect(hit, `missing --${name}`).toBeDefined()
      return Number((hit ?? '').split('=')[1])
    }
    expect(numberArg('fetch-retry-mintimeout')).toBeLessThanOrEqual(numberArg('fetch-retry-maxtimeout'))
    expect(numberArg('fetch-retry-mintimeout')).toBeGreaterThan(0)
    expect(numberArg('fetch-timeout')).toBeGreaterThan(0)
  })

  it('rides along on both installs, not just the scratch one', async () => {
    const base = join(dir, 'base')
    const installed = installedPath(join(base, 'profile'))
    makePackage(installed, '1.6.2')
    const tmpDir = join(base, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const calls: string[] = []
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target: directoryTarget(installed) })

    await runUpdate(plan, { run: stageRunner('1.6.3', calls), tmpDir })
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call).toContain('--fetch-retries=1')
      expect(call).toContain('--fetch-retry-mintimeout=1000')
    }
  })
})

describe('runUpdate — npm track', () => {
  it('stages, swaps, verifies, and records success in the audit log', async () => {
    const base = join(dir, 'base')
    const installed = installedPath(join(base, 'profile'))
    makePackage(installed, '1.6.2')
    const tmpDir = join(base, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const auditFile = join(base, 'dsh-palm-update.audit.log')
    const calls: string[] = []
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target: directoryTarget(installed) })

    const outcome = await runUpdate(plan, {
      run: stageRunner('1.6.3', calls),
      tmpDir,
      auditFile,
      now: () => 1_700_000_000_000,
    })

    expect(outcome).toMatchObject({ ok: true, kind: 'npm', from: '1.6.2', to: '1.6.3', step: 'done' })
    // Two installs: one into the scratch dir to validate the tarball, then one
    // into the real profile so the runtime dependencies land where node looks.
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('npm install --prefix')
    expect(calls[1]).toContain('npm install --prefix')
    expect(calls[1]).toContain(join(base, 'profile'))
    expect(calls[1]).toContain(`${PKG}@1.6.3`)
    // The installed tree now holds the new version and its entry file.
    expect(readPackageManifest(installed)?.version).toBe('1.6.3')
    expect(fs.existsSync(join(installed, 'lib', 'index.js'))).toBe(true)
    // Exactly one audit line, machine-readable.
    const lines = readFileSync(auditFile, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(entry).toMatchObject({ from: '1.6.2', to: '1.6.3', kind: 'npm', ok: true, step: 'done' })
    expect(entry.at).toBe(new Date(1_700_000_000_000).toISOString())
  })

  it('rolls back when the swapped-in tree fails verification', async () => {
    const base = join(dir, 'base')
    const installed = installedPath(join(base, 'profile'))
    makePackage(installed, '1.6.2')
    const tmpDir = join(base, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const auditFile = join(base, 'audit.log')
    const calls: string[] = []
    // The install into the real profile lands the right version but loses the
    // entry file — the shape of a half-written tree.
    const brokenRunner: UpdateRunner = async (command, args) => {
      calls.push([command, ...args].join(' '))
      if (command === 'npm') {
        const prefix = args[args.indexOf('--prefix') + 1] ?? ''
        const targetDir = join(prefix, 'node_modules', ...PKG_SEGMENTS)
        makePackage(targetDir, '1.6.3', prefix.includes('stage'))
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target: directoryTarget(installed) })

    await expect(runUpdate(plan, {
      run: brokenRunner,
      tmpDir,
      auditFile,
    })).rejects.toThrow(/已恢复到更新前的版本/)

    // The old tree is back, byte for byte.
    expect(readPackageManifest(installed)?.version).toBe('1.6.2')
    expect(fs.existsSync(join(installed, 'lib', 'index.js'))).toBe(true)
    const entry = JSON.parse(readFileSync(auditFile, 'utf8').trim()) as Record<string, unknown>
    expect(entry).toMatchObject({ from: '1.6.2', to: '1.6.3', kind: 'npm', ok: false, step: 'rollback' })
    expect(String(entry.error)).toContain('已恢复')
  })

  /**
   * A runner that installs a 1.6.3 declaring a runtime dependency, the way npm
   * would report it. `provideDep` decides whether the dependency really lands.
   */
  function depRunner(options: { provideDep: boolean }, calls: string[]): UpdateRunner {
    return async (command, args) => {
      calls.push([command, ...args].join(' '))
      if (command === 'npm') {
        const prefix = args[args.indexOf('--prefix') + 1] ?? ''
        const targetDir = join(prefix, 'node_modules', ...PKG_SEGMENTS)
        makePackage(targetDir, '1.6.3')
        writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
          name: PKG, version: '1.6.3', main: 'lib/index.js', dependencies: { 'dep-x': '^1.0.0' },
        }))
        if (options.provideDep && !prefix.includes('stage')) {
          mkdirSync(join(prefix, 'node_modules', 'dep-x'), { recursive: true })
        }
      }
      return { code: 0, stdout: '', stderr: '' }
    }
  }

  // The bug the container run caught: the scratch install carries the deps but
  // the copy into the profile did not, so the update said "done", the host
  // restarted, and the plugin failed to load with ERR_MODULE_NOT_FOUND.
  it('rolls back instead of reporting success when a dependency never landed', async () => {
    const base = join(dir, 'base')
    const installed = installedPath(join(base, 'profile'))
    makePackage(installed, '1.6.2')
    const tmpDir = join(base, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const auditFile = join(base, 'audit.log')
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target: directoryTarget(installed) })

    await expect(runUpdate(plan, {
      run: depRunner({ provideDep: false }, []),
      tmpDir,
      auditFile,
    })).rejects.toThrow(/依赖没装上：dep-x/)

    expect(readPackageManifest(installed)?.version).toBe('1.6.2')
    const entry = JSON.parse(readFileSync(auditFile, 'utf8').trim()) as Record<string, unknown>
    expect(entry).toMatchObject({ ok: false, step: 'rollback' })
    expect(String(entry.error)).toContain('dep-x')
  })

  it('accepts the update once the dependency is resolvable from the profile', async () => {
    const base = join(dir, 'base')
    const installed = installedPath(join(base, 'profile'))
    makePackage(installed, '1.6.2')
    const tmpDir = join(base, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const auditFile = join(base, 'audit.log')
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target: directoryTarget(installed) })

    const outcome = await runUpdate(plan, {
      run: depRunner({ provideDep: true }, []),
      tmpDir,
      auditFile,
    })
    expect(outcome).toMatchObject({ ok: true, step: 'done' })
    expect(fs.existsSync(join(base, 'profile', 'node_modules', 'dep-x'))).toBe(true)
  })

  it('leaves the install untouched when the package manager fails', async () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    const tmpDir = join(dir, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const auditFile = join(dir, 'audit.log')
    const runner = recordingRunner(() => ({ code: 1, stdout: '', stderr: 'network down' }))
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target: directoryTarget(installed) })

    await expect(runUpdate(plan, { run: runner.run, tmpDir, auditFile })).rejects.toThrow(/下载安装包失败/)
    expect(readPackageManifest(installed)?.version).toBe('1.6.2')
    const entry = JSON.parse(readFileSync(auditFile, 'utf8').trim()) as Record<string, unknown>
    expect(entry).toMatchObject({ ok: false, step: 'install' })
  })

  it('never lets an unwritable audit log break the update', async () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    const tmpDir = join(dir, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    // A directory where the audit file should be: appendFileSync throws.
    const auditFile = join(dir, 'audit-dir')
    mkdirSync(auditFile, { recursive: true })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const calls: string[] = []
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target: directoryTarget(installed) })

    const outcome = await runUpdate(plan, { run: stageRunner('1.6.3', calls), tmpDir, auditFile })
    expect(outcome.ok).toBe(true)
    expect(errorSpy).toHaveBeenCalled()
    expect(readPackageManifest(installed)?.version).toBe('1.6.3')
  })

  it('records a refusal in the audit log and changes nothing', async () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    const auditFile = join(dir, 'audit.log')
    const target: InstallTarget = { shape: 'link', resolved: installed, repoRoot: dir }
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target, repoDirty: true })
    const runner = recordingRunner(() => ({ code: 0, stdout: '', stderr: '' }))

    const outcome = await runUpdate(plan, { run: runner.run, auditFile })
    expect(outcome.kind).toBe('noop')
    expect(runner.calls).toHaveLength(0)
    const entry = JSON.parse(readFileSync(auditFile, 'utf8').trim()) as Record<string, unknown>
    expect(entry).toMatchObject({ ok: false, step: 'refuse' })
    expect(String(entry.error)).toContain('没提交的改动')
  })
})

describe('runUpdate — source track', () => {
  /** Build a sandbox repo + link install. */
  function makeLinkSandbox(): { repo: string; packageDir: string; linkPath: string } {
    const repo = join(dir, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const packageDir = join(repo, 'packages', 'dsh-palm')
    makePackage(packageDir, '1.6.2')
    const linkPath = join(dir, 'modules', ...PKG_SEGMENTS)
    mkdirSync(join(linkPath, '..'), { recursive: true })
    symlinkSync(packageDir, linkPath, 'junction')
    return { repo, packageDir, linkPath }
  }

  it('pulls, installs, builds, verifies in order', async () => {
    const sandbox = makeLinkSandbox()
    const target = detectInstallTarget(sandbox.linkPath)
    const auditFile = join(dir, 'audit.log')
    const calls: string[] = []
    const run: UpdateRunner = async (command, args) => {
      calls.push([command, ...args].join(' '))
      if (command === 'git' && args[0] === 'rev-parse') return { code: 0, stdout: 'abc1234\n', stderr: '' }
      if (command === 'git' && args[0] === 'pull') {
        // The pulled release bumps the version in the package manifest.
        makePackage(sandbox.packageDir, '1.6.3')
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target, repoDirty: false })

    const outcome = await runUpdate(plan, { run, auditFile })
    expect(outcome).toMatchObject({ ok: true, kind: 'source', to: '1.6.3', step: 'done' })
    expect(calls).toEqual([
      'git rev-parse HEAD',
      'git pull --ff-only',
      'pnpm install',
      'pnpm build',
    ])
    const entry = JSON.parse(readFileSync(auditFile, 'utf8').trim()) as Record<string, unknown>
    expect(entry).toMatchObject({ kind: 'source', ok: true, step: 'done' })
  })

  it('resets the repository to the pre-update commit when the build fails', async () => {
    const sandbox = makeLinkSandbox()
    const target = detectInstallTarget(sandbox.linkPath)
    const auditFile = join(dir, 'audit.log')
    const calls: string[] = []
    const run: UpdateRunner = async (command, args) => {
      calls.push([command, ...args].join(' '))
      if (command === 'git' && args[0] === 'rev-parse') return { code: 0, stdout: 'abc1234\n', stderr: '' }
      if (command === 'pnpm' && args[0] === 'build') return { code: 2, stdout: '', stderr: 'tsc failed' }
      return { code: 0, stdout: '', stderr: '' }
    }
    const plan = planUpdate({ installed: '1.6.2', latest: '1.6.3', target, repoDirty: false })

    await expect(runUpdate(plan, { run, auditFile })).rejects.toThrow(/重新构建失败/)
    expect(calls).toContain('git reset --hard abc1234')
    const entry = JSON.parse(readFileSync(auditFile, 'utf8').trim()) as Record<string, unknown>
    expect(entry).toMatchObject({ kind: 'source', ok: false, step: 'rollback' })
    expect(String(entry.error)).toContain('已恢复到更新前的提交')
  })

  it('refuses to run without a repo root', async () => {
    const auditFile = join(dir, 'audit.log')
    const runner = recordingRunner(() => ({ code: 0, stdout: '', stderr: '' }))
    const plan: UpdatePlan = {
      kind: 'source', installed: '1.6.2', latest: '1.6.3', steps: [],
      target: { shape: 'link', resolved: join(dir, 'x') },
    }
    await expect(runUpdate(plan, { run: runner.run, auditFile })).rejects.toThrow(/找不到源码仓库根目录/)
  })
})

describe('helpers', () => {
  it('reads a manifest, verifies entry points, and derives the audit path', () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    expect(readPackageManifest(installed)).toMatchObject({ name: PKG, version: '1.6.2', main: 'lib/index.js' })
    expect(verifyInstalled(installed, '1.6.2')).toBe(true)
    expect(verifyInstalled(installed, '1.6.3')).toBe(false)

    const noEntry = join(dir, 'no-entry')
    makePackage(noEntry, '1.6.2', false)
    expect(verifyInstalled(noEntry, '1.6.2')).toBe(false)
    expect(readPackageManifest(join(dir, 'missing'))).toBeUndefined()

    expect(updateAuditFile(join(dir, 'dsh-palm-devices.json'))).toBe(join(dir, UPDATE_AUDIT_FILE_NAME))
  })

  it('detects a dirty repository conservatively', async () => {
    expect(await repoIsDirty(dir, async () => ({ code: 0, stdout: '', stderr: '' }))).toBe(false)
    expect(await repoIsDirty(dir, async () => ({ code: 0, stdout: ' M src/index.ts\n', stderr: '' }))).toBe(true)
    expect(await repoIsDirty(dir, async () => ({ code: 128, stdout: '', stderr: 'not a repo' }))).toBe(true)
    expect(await repoIsDirty(dir, async () => { throw new Error('git missing') })).toBe(true)
  })

  it('locates the profile install path, falling back to the self directory', () => {
    const home = join(dir, 'home')
    const candidate = join(home, 'profiles', 'web', 'node_modules', ...PKG_SEGMENTS)
    mkdirSync(candidate, { recursive: true })
    expect(locateInstalledPackageDir({ selfDir: join(dir, 'self'), home })).toBe(candidate)

    const emptyHome = join(dir, 'empty-home')
    mkdirSync(emptyHome, { recursive: true })
    expect(locateInstalledPackageDir({ selfDir: join(dir, 'self'), home: emptyHome })).toBe(join(dir, 'self'))
  })
})

describe('UpdateCoordinator', () => {
  /** A mutable clock. */
  function clock(start = 1_700_000_000_000): { now: () => number; advance: (ms: number) => void } {
    let time = start
    return { now: () => time, advance: (ms) => { time += ms } }
  }

  it('reports installed / latest / target and a plan', async () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    const coordinator = new UpdateCoordinator({
      modulePath: installed,
      fetchLatest: async () => '1.6.3',
    })
    const frame = await coordinator.version()
    expect(frame).toMatchObject({ installed: '1.6.2', latest: '1.6.3', isNewer: true, target: 'directory' })
    expect(frame.plan.kind).toBe('npm')
  })

  it('reports latest:null (not an error) when the registry is unreachable', async () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    const coordinator = new UpdateCoordinator({
      modulePath: installed,
      fetchLatest: async () => { throw new Error('offline') },
    })
    const frame = await coordinator.version()
    expect(frame.latest).toBeNull()
    expect(frame.isNewer).toBe(false)
    expect(frame.plan.kind).toBe('noop')
  })

  // Double-clicking used to let both calls through the guard, because the
  // guard sat behind an await. One update at a time, always.
  it('turns the second click away instead of running two updates at once', async () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    let open: () => void = () => {}
    const gate = new Promise<void>((resolve) => { open = resolve })
    const coordinator = new UpdateCoordinator({
      modulePath: installed,
      fetchLatest: async () => { await gate; return '1.6.3' },
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
      tmpDir: dir,
    })

    const first = coordinator.start(false)
    const second = await coordinator.start(false)
    expect(second.started).toBe(false)
    expect(second.plan.refuse).toContain('还在跑')
    open()
    await expect(first).resolves.toMatchObject({ started: true })
  })

  it('marks a link install dirty through git and refuses in the plan', async () => {
    const repo = join(dir, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const packageDir = join(repo, 'packages', 'dsh-palm')
    makePackage(packageDir, '1.6.2')
    const linkPath = join(dir, 'modules', ...PKG_SEGMENTS)
    mkdirSync(join(linkPath, '..'), { recursive: true })
    symlinkSync(packageDir, linkPath, 'junction')
    const coordinator = new UpdateCoordinator({
      modulePath: linkPath,
      fetchLatest: async () => '1.6.3',
      run: async () => ({ code: 0, stdout: ' M src/index.ts\n', stderr: '' }),
    })
    const frame = await coordinator.version()
    expect(frame).toMatchObject({ target: 'link', repoDirty: true, isNewer: true })
    expect(frame.plan.refuse).toContain('没提交的改动')
  })

  it('dry run returns the plan without touching a single file', async () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    const manifestBefore = readFileSync(join(installed, 'package.json'))
    const entryBefore = readFileSync(join(installed, 'lib', 'index.js'))
    const tmpDir = join(dir, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const runner = recordingRunner(() => ({ code: 0, stdout: '', stderr: '' }))
    const coordinator = new UpdateCoordinator({
      modulePath: installed,
      fetchLatest: async () => '1.6.3',
      run: runner.run,
      tmpDir,
    })

    const result = await coordinator.start(true)
    expect(result.started).toBe(false)
    expect(result.plan.kind).toBe('npm')
    expect(runner.calls).toHaveLength(0)
    expect(readFileSync(join(installed, 'package.json'))).toEqual(manifestBefore)
    expect(readFileSync(join(installed, 'lib', 'index.js'))).toEqual(entryBefore)
    expect(fs.readdirSync(tmpDir)).toEqual([])
    expect(coordinator.status().phase).toBe('idle')
  })

  it('runs in the background, schedules the restart, and can cancel it', async () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    const tmpDir = join(dir, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const calls: string[] = []
    const scheduleRestart = vi.fn(() => ({ ok: true }))
    const cancelRestart = vi.fn()
    const time = clock()
    const coordinator = new UpdateCoordinator({
      modulePath: installed,
      fetchLatest: async () => '1.6.3',
      run: stageRunner('1.6.3', calls),
      tmpDir,
      now: time.now,
      restartDelayMs: 5_000,
      scheduleRestart,
      cancelRestart,
    })

    const result = await coordinator.start(false)
    expect(result.started).toBe(true)
    await vi.waitFor(() => {
      expect(coordinator.status().phase).toBe('restarting')
    })
    const status = coordinator.status()
    expect(status).toMatchObject({ ok: true, from: '1.6.2', to: '1.6.3', restartAt: 1_700_000_000_000 + 5_000 })
    expect(scheduleRestart).toHaveBeenCalledWith(5_000)

    expect(coordinator.cancelRestart()).toBe(true)
    expect(cancelRestart).toHaveBeenCalledTimes(1)
    expect(coordinator.status()).toMatchObject({ phase: 'done', done: true, step: 'cancelled' })
    // A second cancel has nothing to cancel.
    expect(coordinator.cancelRestart()).toBe(false)
  })

  it('flips the countdown to done once the restart time has passed', async () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    const tmpDir = join(dir, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const time = clock()
    const coordinator = new UpdateCoordinator({
      modulePath: installed,
      fetchLatest: async () => '1.6.3',
      run: stageRunner('1.6.3', []),
      tmpDir,
      now: time.now,
      restartDelayMs: 1_000,
      scheduleRestart: () => ({ ok: true }),
    })
    await coordinator.start(false)
    await vi.waitFor(() => {
      expect(coordinator.status().phase).toBe('restarting')
    })
    time.advance(1_500)
    expect(coordinator.status()).toMatchObject({ phase: 'done', done: true })
  })

  it('reports a failed update with a readable reason', async () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    const tmpDir = join(dir, 'tmp')
    mkdirSync(tmpDir, { recursive: true })
    const coordinator = new UpdateCoordinator({
      modulePath: installed,
      fetchLatest: async () => '1.6.3',
      run: async () => ({ code: 1, stdout: '', stderr: 'network down' }),
      tmpDir,
    })
    await coordinator.start(false)
    await vi.waitFor(() => {
      expect(coordinator.status().phase).toBe('failed')
    })
    expect(coordinator.status().error).toContain('下载安装包失败')
  })

  it('answers "already latest" immediately without starting anything', async () => {
    const installed = installedPath(join(dir, 'profile'))
    makePackage(installed, '1.6.2')
    const runner = recordingRunner(() => ({ code: 0, stdout: '', stderr: '' }))
    const coordinator = new UpdateCoordinator({
      modulePath: installed,
      fetchLatest: async () => '1.6.2',
      run: runner.run,
    })
    const result = await coordinator.start(false)
    expect(result.started).toBe(false)
    expect(coordinator.status()).toMatchObject({ phase: 'done', done: true, ok: true })
    expect(runner.calls).toHaveLength(0)
  })

  it('reports a refusal from the plan without touching the install', async () => {
    const repo = join(dir, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const packageDir = join(repo, 'packages', 'dsh-palm')
    makePackage(packageDir, '1.6.2')
    const linkPath = join(dir, 'modules', ...PKG_SEGMENTS)
    mkdirSync(join(linkPath, '..'), { recursive: true })
    symlinkSync(packageDir, linkPath, 'junction')
    const calls: string[] = []
    const coordinator = new UpdateCoordinator({
      modulePath: linkPath,
      fetchLatest: async () => '1.6.3',
      run: async (command, args) => {
        calls.push([command, ...args].join(' '))
        return { code: 0, stdout: ' M src/index.ts\n', stderr: '' }
      },
    })
    const result = await coordinator.start(false)
    expect(result.started).toBe(false)
    expect(result.plan.refuse).toContain('没提交的改动')
    expect(coordinator.status()).toMatchObject({ phase: 'failed', ok: false })
    expect(coordinator.status().error).toContain('没提交的改动')
    // Only the dirty probe ran; no pull / install / build.
    expect(calls).toEqual(['git status --porcelain'])
  })
})
