#!/usr/bin/env node
/**
 * Local CI mirror for dsh-palm.
 *
 * Runs the same gates as .github/workflows/ci.yml (the `check` and
 * `release-preflight` jobs) on this machine, so a red gate is never
 * discovered for the first time on the runner. Two profiles:
 *
 *   --profile ci    (default) install, build, coverage, typecheck, audit,
 *                   hygiene, pack, commitlint — mirrors both CI jobs
 *   --profile push  hygiene, tests, commitlint — the pre-push gate
 *
 * The test steps strip the proxy environment variables: the suite asserts
 * that a proxy is honoured only when the code is told about it, so a proxy
 * exported in the shell must not leak in (that is how a release push was
 * blocked once).
 *
 * Zero dependencies (node builtins only) and no DSH imports, so it survives
 * DSH upgrades and runs on Windows and Linux alike.
 *
 *   pnpm verify                       # full CI mirror
 *   pnpm verify --profile push        # what the pre-push hook runs
 *   pnpm verify --only hygiene,pack   # ad-hoc subset
 *   pnpm verify --skip coverage,audit
 *   pnpm verify --message "v1.3.3: release dsh-palm (...)"
 *   pnpm verify --hygiene-rev HEAD    # scan a commit instead of the work tree
 *   pnpm verify --report <path>       # also write a dsh-palm.lifecycle/1 report
 *   pnpm verify --list
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const rootDir = resolve(packageDir, '..', '..')

/** A proxy exported in the shell must not reach the test suite. */
const PROXY_VARS = [
  'DSH_PALM_PUSH_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
]

/** Same excludes the CI hygiene scan and the pre-push hook use. */
const HYGIENE_EXCLUDES = [
  'pnpm-lock.yaml',
  '.gitleaks.toml',
  '.github/workflows/ci.yml',
  'scripts/hooks/pre-push',
]

const PROFILES = {
  ci: ['install', 'build', 'coverage', 'typecheck', 'audit', 'hygiene', 'pack', 'commitlint'],
  push: ['hygiene', 'tests', 'commitlint'],
}

const STEPS = {
  install: {
    title: 'install (frozen lockfile)',
    run: () => run('pnpm install --frozen-lockfile', rootDir),
  },
  build: {
    title: 'build',
    run: () => run('pnpm build', packageDir),
  },
  coverage: {
    title: 'coverage gate (CI thresholds)',
    run: () => run('pnpm vitest run --coverage', packageDir, { cleanEnv: true }),
  },
  tests: {
    title: 'tests',
    run: () => run('pnpm test', packageDir, { cleanEnv: true }),
  },
  typecheck: {
    title: 'typecheck',
    run: () => run('pnpm typecheck', packageDir),
  },
  audit: {
    title: 'audit (production deps)',
    run: () => run('pnpm audit --prod', rootDir),
  },
  hygiene: {
    title: 'repo hygiene scan',
    run: hygieneScan,
  },
  pack: {
    title: 'package content + entries',
    run: packCheck,
  },
  commitlint: {
    title: 'commitlint',
    run: commitlint,
  },
}

const options = parseArgs(process.argv.slice(2))

if (options.help) {
  process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#![^\n]*\n/, ''))
  process.exit(0)
}

if (options.list) {
  for (const [name, steps] of Object.entries(PROFILES)) {
    process.stdout.write(`profile ${name}: ${steps.join(', ')}\n`)
  }
  process.exit(0)
}

const selected = selectSteps(options)
const started = Date.now()
const results = []

process.stdout.write(`[verify] ${selected.length} steps in ${rootDir}\n`)

for (const id of selected) {
  const step = STEPS[id]
  const stepStarted = Date.now()
  process.stdout.write(`\n[verify] ${step.title}\n`)
  let ok = false
  try {
    ok = step.run() !== false
  } catch (error) {
    process.stderr.write(`[verify] ${step.title} threw: ${error?.message ?? error}\n`)
    ok = false
  }
  results.push({ id, title: step.title, ok, ms: Date.now() - stepStarted })
  if (!ok && options.failFast) break
}

const failed = results.filter((r) => !r.ok)
const total = ((Date.now() - started) / 1000).toFixed(1)

// Strictly additive: without --report nothing below runs, and a report write
// failure is a warning only — it must never change the gate's verdict.
if (options.report) writeReport(options.report)

process.stdout.write('\n[verify] summary\n')
for (const r of results) {
  process.stdout.write(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.title.padEnd(32)} ${(r.ms / 1000).toFixed(1)}s\n`)
}
if (failed.length > 0) {
  process.stderr.write(`[verify] FAIL - ${results.length - failed.length}/${results.length} steps in ${total}s; failed: ${failed.map((f) => f.title).join(', ')}\n`)
  process.exit(1)
}
process.stdout.write(`[verify] PASS - ${results.length}/${results.length} steps in ${total}s\n`)

/**
 * Write the lifecycle report consumed by the user-level `palm` orchestrator
 * (docs/lifecycle/2026-09-12-dsh-palm-lifecycle-design.md §7). The report is
 * self-describing (`context.known` / `context.selected`) so the consumer can
 * detect gate drift instead of silently trusting an outdated mapping.
 *
 * Fail-soft by contract: any error here is a warning, never a verdict change.
 */
function writeReport(path) {
  const checks = results.map((r) => ({ id: r.id, status: r.ok ? 'pass' : 'fail', ms: r.ms, detail: '' }))
  for (const id of selected) {
    if (!results.some((r) => r.id === id)) {
      checks.push({ id, status: 'skip', ms: 0, detail: 'not run (fail-fast)' })
    }
  }
  const dshSettings = readJson(join(packageDir, 'node_modules', '@deepseek-ai', 'dsh-settings', 'package.json'))
    ?? readJson(join(rootDir, 'node_modules', '@deepseek-ai', 'dsh-settings', 'package.json'))
  const report = {
    schema: 'dsh-palm.lifecycle/1',
    stage: 'verify',
    ok: failed.length === 0,
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    context: {
      pluginVersion: readJson(join(packageDir, 'package.json'))?.version ?? null,
      dshVersion: dshSettings?.version ?? null,
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout || null,
      commit: git(['rev-parse', '--short', 'HEAD']).stdout || null,
      bundleHash: hashFile(join(packageDir, 'lib', 'mobile.js')),
      profile: options.profile,
      selected,
      known: Object.keys(STEPS),
    },
    checks,
    artifacts: [{ kind: 'json', path }],
    next: failed.length === 0 ? [] : [`failed: ${failed.map((f) => f.title).join(', ')}`],
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    process.stdout.write(`[verify] report: ${path}\n`)
  } catch (error) {
    process.stderr.write(`[verify] could not write --report to ${path}: ${error?.message ?? error}\n`)
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function hashFile(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 8)
  } catch {
    return null
  }
}

function parseArgs(argv) {
  const parsed = { profile: 'ci', only: null, skip: [], message: null, hygieneRev: null, allowMissingRegex: false, failFast: true, help: false, list: false, report: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null]
    const value = inline ?? argv[i + 1]
    switch (flag) {
      case '--profile': parsed.profile = value; if (inline === null) i += 1; break
      case '--only':
      case '--skip': {
        // Collect every following non-flag argument as well as the inline
        // value: `--only a,b` and `--only a b` both work, which matters
        // because PowerShell turns an unquoted `a,b` into two arguments.
        const values = inline !== null ? [inline] : []
        if (inline === null) {
          while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
            values.push(argv[i + 1])
            i += 1
          }
        }
        const list = values.flatMap(split)
        if (flag === '--only') parsed.only = list
        else parsed.skip = list
        break
      }
      case '--message': parsed.message = value; if (inline === null) i += 1; break
      case '--hygiene-rev': parsed.hygieneRev = value; if (inline === null) i += 1; break
      case '--report': parsed.report = value; if (inline === null) i += 1; break
      case '--allow-missing-regex': parsed.allowMissingRegex = true; break
      case '--no-fail-fast': parsed.failFast = false; break
      case '--list': parsed.list = true; break
      case '--help': case '-h': parsed.help = true; break
      default: break
    }
  }
  return parsed
}

function split(value) {
  return String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

function selectSteps({ profile, only, skip }) {
  if (!PROFILES[profile]) {
    process.stderr.write(`[verify] unknown profile "${profile}" (known: ${Object.keys(PROFILES).join(', ')})\n`)
    process.exit(2)
  }
  let ids = only ?? PROFILES[profile]
  const unknown = ids.filter((id) => !STEPS[id])
  if (unknown.length > 0) {
    process.stderr.write(`[verify] unknown step(s): ${unknown.join(', ')} (known: ${Object.keys(STEPS).join(', ')})\n`)
    process.exit(2)
  }
  ids = ids.filter((id) => !skip.includes(id))
  if (ids.length === 0) {
    process.stderr.write('[verify] nothing to run\n')
    process.exit(2)
  }
  return ids
}

function run(command, cwd, { cleanEnv = false } = {}) {
  const env = { ...process.env }
  if (cleanEnv) for (const name of PROXY_VARS) delete env[name]
  const result = spawnSync(command, { cwd, shell: true, stdio: 'inherit', env })
  if (result.error) {
    process.stderr.write(`[verify] could not run "${command}": ${result.error.message}\n`)
    return false
  }
  return result.status === 0
}

/** git with captured output; never throws. */
function git(args, { cwd = rootDir } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { status: result.status, stdout: (result.stdout ?? '').trim() }
}

/**
 * Repo hygiene scan — the same pattern list CI injects as REAL_IDS_REGEX,
 * read from ~/.dsh/repo-guard.regex (or DSH_PALM_GUARD_REGEX) so the real
 * identifiers never enter the tree. Default target is the working tree
 * (release gate: catches files that are not committed yet); --hygiene-rev
 * scans a commit instead, which is what a pre-push gate wants. Unlike the
 * pre-push hook this is strict by default: a missing pattern list is a
 * release-blocking gap, not a warning.
 */
function hygieneScan() {
  const pattern = guardPattern()
  if (pattern === null) {
    process.stderr.write('[verify] no hygiene pattern list: set DSH_PALM_GUARD_REGEX or create ~/.dsh/repo-guard.regex\n')
    if (options.allowMissingRegex) {
      process.stderr.write('[verify] --allow-missing-regex: continuing without the hygiene scan\n')
      return true
    }
    process.stderr.write('[verify] CI scans with the REAL_IDS_REGEX secret; refusing to pass silently\n')
    return false
  }
  // `-e` and options before the pattern: without it git consumes the first
  // non-option argument as the pattern and then reads anything after it as a
  // revision ("fatal: unable to resolve revision: --untracked").
  const args = ['grep']
  if (!options.hygieneRev) args.push('--untracked')
  args.push('-n', '-i', '-E', '-e', pattern)
  if (options.hygieneRev) args.push(options.hygieneRev)
  args.push('--', '.')
  for (const exclude of HYGIENE_EXCLUDES) args.push(`:(exclude)${exclude}`)
  const result = spawnSync('git', args, { cwd: rootDir, stdio: 'inherit' })
  if (result.status === 0) {
    process.stderr.write('[verify] hygiene scan found leaked local paths or IPs (above)\n')
    return false
  }
  if (result.status === 1) return true
  process.stderr.write(`[verify] hygiene scan could not run (git grep exit ${result.status})\n`)
  return false
}

function guardPattern() {
  const fromEnv = process.env.DSH_PALM_GUARD_REGEX
  if (fromEnv && fromEnv.trim() !== '') return fromEnv.trim()
  const file = join(homedir(), '.dsh', 'repo-guard.regex')
  if (!existsSync(file)) return null
  const pattern = readFileSync(file, 'utf8').trim()
  return pattern === '' ? null : pattern
}

/**
 * `npm pack --dry-run --json` plus the two checks the release convention
 * adds on top of CI's bare dry run: no test files in the tarball, and every
 * main/types/exports target actually present in the file list.
 */
function packCheck() {
  const result = spawnSync('npm pack --dry-run --json', { cwd: packageDir, shell: true, encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '[verify] npm pack --dry-run failed\n')
    return false
  }
  let info
  try {
    info = JSON.parse(result.stdout)[0]
  } catch {
    process.stderr.write('[verify] could not parse `npm pack --dry-run --json` output\n')
    return false
  }
  const files = (info.files ?? []).map((f) => f.path)
  const tests = files.filter((p) => /\.(test|spec)\.(ts|tsx|js|mjs|cjs|d\.ts)$/.test(p))
  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const targets = entryTargets(pkg)
  const missing = targets.filter((t) => !files.includes(t))
  // Entry targets are only meaningful once something was built. A job that
  // packs the source tree alone (no install, no build) has no lib/ to resolve
  // against, and demanding one there fails for the wrong reason.
  const built = existsSync(join(packageDir, 'lib', 'mobile.js'))
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`
  process.stdout.write(`[verify] ${info.filename}: ${files.length} files, ${kb(info.size)} packed, ${kb(info.unpackedSize)} unpacked\n`)
  process.stdout.write(`[verify] entries: ${targets.length} targets, ${missing.length} missing${built ? '' : ' (not built here)'}\n`)
  if (tests.length > 0) {
    process.stderr.write(`[verify] test files leaked into the package: ${tests.slice(0, 5).join(', ')}\n`)
    return false
  }
  if (missing.length > 0 && !built) {
    process.stdout.write('[verify] lib/ is not built here - skipping the entry-target check (the local gate builds first)\n')
    return true
  }
  if (missing.length > 0) {
    process.stderr.write(`[verify] entry targets missing from the package: ${missing.join(', ')}\n`)
    return false
  }
  return true
}

/** main, types and every non-wildcard exports target, normalised to pack paths. */
function entryTargets(pkg) {
  const values = [pkg.main, pkg.types]
  for (const value of Object.values(pkg.exports ?? {})) {
    if (typeof value === 'string') values.push(value)
    else if (value && typeof value === 'object') values.push(...Object.values(value))
  }
  return [...new Set(values.filter((v) => typeof v === 'string' && v !== '' && !v.includes('*')).map((v) => v.replace(/^\.\//, '')))]
}

/**
 * Lint an explicit message (--message) or, like CI and the hook, every commit
 * this push would carry. A release commit is exempt via commitlint.config.mjs.
 */
function commitlint() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-palm-lint-'))
  try {
    if (options.message !== null) {
      const file = join(dir, 'message.txt')
      // LF only, no BOM: commitlint reads the header verbatim.
      writeFileSync(file, `${options.message}\n`)
      process.stdout.write(`[verify] linting the supplied message\n`)
      return run(`npx --prefix "${rootDir}" commitlint --edit "${file}"`, rootDir)
    }
    const hasOriginMain = git(['rev-parse', '--verify', 'origin/main']).status === 0
    const base = hasOriginMain ? 'origin/main' : 'HEAD~1'
    const range = git(['rev-list', '--count', `${base}..HEAD`])
    if (range.status === 0 && range.stdout === '0') {
      process.stdout.write(`[verify] no commits in ${base}..HEAD - nothing to lint\n`)
      return true
    }
    process.stdout.write(`[verify] linting ${base}..HEAD\n`)
    return run(`npx --prefix "${rootDir}" commitlint --from ${base} --to HEAD`, rootDir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
