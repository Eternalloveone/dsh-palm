#!/usr/bin/env node
/**
 * dsh-palm release driver.
 *
 * The release convention (one commit per version) written down as a script,
 * so the steps that were done by hand — version consistency, the build-time
 * version inline, the CI mirror, the single release commit, the annotated
 * tag — run in a fixed order and stop before anything irreversible.
 *
 *   node scripts/release.mjs 1.3.3                # dry run: checks + plan
 *   node scripts/release.mjs 1.3.3 --apply        # commit + annotated tag
 *   node scripts/release.mjs 1.3.3 --apply --push # ...and push main + tag
 *   node scripts/release.mjs 1.3.3 --apply --push --gh-release
 *   node scripts/release.mjs --from-head --apply --push   # tag an ALREADY-committed HEAD
 *   node scripts/release.mjs --check 1.3.3        # post-release verification
 *   node scripts/release.mjs --check 1.3.3 --wait # poll the registry (~4 min lag)
 *
 * Options: --summary "a, b" (subject topics), --skip-verify (skip the CI
 * mirror), --push (run the two pushes; the tag push is what triggers the
 * publish workflow), --gh-release (create the GitHub Release from the
 * CHANGELOG section; implies --push).
 *
 * The proxy is passed to git as an option and to gh/npm as an explicit
 * environment, taken from DSH_PALM_GIT_PROXY then HTTPS_PROXY, so nothing
 * depends on a variable exported in the shell.
 *
 * Safety: nothing mutates without --apply, and --apply refuses to run while
 * any check fails. The dry run still prints the plan, so the exact commands
 * are visible before they exist.
 *
 * Zero dependencies (node builtins only), no DSH imports.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
const rootDir = resolve(scriptsDir, '..')
const packageDir = join(rootDir, 'packages', 'dsh-palm')
const PACKAGE_NAME = '@eternalloveone/dsh-palm'
/** The workflows a release actually depends on (see checkRelease). */
const RELEVANT_WORKFLOWS = ['ci', 'publish']

const options = parseArgs(process.argv.slice(2))

if (options.help || (options.version === null && !options.check && !options.fromHead)) {
  process.stdout.write(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#![^\n]*\n/, ''))
  process.exit(options.help ? 0 : 2)
}

if (options.check) {
  process.exit(checkRelease(options.version))
}

const declaredVersion = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version
// --from-head releases whatever HEAD says it is; taking the version from
// package.json removes a whole class of "tagged 1.3.7 but shipped 1.3.6".
const version = options.version ?? (options.fromHead ? declaredVersion : null)
const tag = `v${version}`
// A prerelease must not masquerade as the latest release on the repository page: npm keeps an rc
// off `latest`, and GitHub has to match, or the two channels say different things to the same
// person. Anything after the first hyphen is a prerelease identifier in semver.
const prereleaseFlag = version.includes('-') ? ' --prerelease' : ''
const checks = []

// ---------------------------------------------------------------- preflight
record('version format', /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version), `"${version}" must look like 1.3.3`)

record('package.json version', declaredVersion === version, `packages/dsh-palm/package.json says ${declaredVersion} - bump it before releasing ${version}`)

const section = changelogSection(version)
record('CHANGELOG section', section !== null, `CHANGELOG.md has no "## [${version}]" section`)
// A section that exists but carries no bullets produces an empty commit body
// and an empty tag message, which is how a release ends up undocumented.
record('CHANGELOG has entries', section !== null && /^- /m.test(section.body), `the "## [${version}]" section has no "- " entries yet`)

const previousTag = gitCapture(['describe', '--tags', '--abbrev=0'])
record('tag is free', tag !== previousTag && !tagExists(tag) && remoteTagExists(tag) !== true, `${tag} already exists (${previousTag} is the previous release)`)

const head = gitCapture(['rev-parse', 'HEAD'])
// rev-list rather than `^{commit}`: this goes through no shell, but `^` and
// braces are still best avoided in anything a shell might see.
const previousCommit = previousTag === '' ? '' : gitCapture(['rev-list', '-n', '1', previousTag])
const dirty = gitCapture(['status', '--porcelain'])

if (options.fromHead) {
  // --from-head: the release commit ALREADY exists (it was soaked on the test
  // lane and fast-forwarded here), so nothing gets committed. The checks
  // therefore invert — the tree must be CLEAN, and HEAD itself must be the
  // release commit, otherwise the tag would not cover what was soaked.
  const headSubject = gitCapture(['log', '-1', '--pretty=%s']).trim()
  record('clean tree', dirty === '', 'uncommitted changes present - the tag would not cover them (commit them on the test lane first)')
  record(
    'HEAD is the release commit',
    headSubject.startsWith(`v${version}:`),
    `HEAD subject is "${headSubject}"; expected it to start with "v${version}:"`,
  )
  // `describe --tags` would return the tag sitting ON HEAD — the very release
  // being published — so ask for the nearest tag *behind* HEAD instead.
  const parentTag = gitCapture(['describe', '--tags', '--abbrev=0', `${head}~1`])
  const parentCommit = parentTag === '' ? '' : gitCapture(['rev-list', '-n', '1', parentTag])
  record(
    'one commit per version',
    parentCommit === '' || gitCapture(['rev-list', '-n', '1', `${head}~1`]).trim() === parentCommit,
    `HEAD~1 is not ${parentTag}: the release commit carries more than this version's work`,
  )
  if (options.expectSha !== null) {
    const expected = gitCapture(['rev-parse', options.expectSha]).trim()
    record(
      'release commit matches the soaked sha',
      expected !== '' && expected === head,
      `--expect-sha ${options.expectSha} does not match HEAD ${head}`,
    )
  }
} else {
  record(
    'one commit per version',
    previousCommit === '' || head === previousCommit,
    `HEAD is not at ${previousTag}: the release commit would also absorb the commits in between (git reset --soft ${previousTag} first)`,
  )
  record('work to release', dirty !== '', 'the working tree is clean - nothing to commit for this version')
}

// ------------------------------------------------------------------- build
if (allPassed()) {
  step(`build ${version} and check the inlined version`)
  if (!run('pnpm build', packageDir)) {
    record('build', false, 'pnpm build failed')
  } else {
    record('version inlined into lib/mobile.js', versionInlined(version), 'the built bundle does not contain the version - the phone would still show the old one')
  }
}

// -------------------------------------------------------------- CI mirror
if (allPassed() && !options.skipVerify) {
  step('local CI mirror (pnpm verify)')
  record('pnpm verify', run('pnpm verify', packageDir), 'the CI mirror failed - fix it before releasing')
}

// -------------------------------------------------------------------- plan
const subject = `v${version}: release dsh-palm${options.summary ? ` (${options.summary})` : ''}`
const body = section?.body ?? ''
const tagMessage = `${tag} — release\n\n${body}`

process.stdout.write('\n[release] plan\n')
process.stdout.write(
  options.fromHead
    ? `  commit : (none - --from-head releases the existing HEAD ${head.slice(0, 8)})\n`
    : `  commit : ${subject}\n`,
)
process.stdout.write(`  tag    : ${tag} (annotated)\n`)
process.stdout.write(`  push   : git -c http.proxy=<proxy> push origin main && git push origin ${tag}\n`)
if (options.ghRelease) process.stdout.write(`  release: gh release create ${tag} (notes = the CHANGELOG section)\n`)

if (!allPassed()) {
  process.stderr.write(`\n[release] BLOCKED by ${checks.filter((c) => !c.ok).length} check(s): ${checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}\n`)
  process.exit(1)
}

if (!options.apply) {
  process.stdout.write('\n[release] dry run - re-run with --apply to commit and tag\n')
  process.exit(0)
}

// -------------------------------------------------------------------- apply
if (options.fromHead) {
  step(`release already-committed HEAD ${head.slice(0, 8)} (--from-head: no new commit)`)
} else {
  step(`commit ${subject}`)
  if (!run('git add -A', rootDir)) fail('git add failed')
  const commitArgs = ['commit', '-m', subject]
  if (body !== '') commitArgs.push('-m', body)
  if (!git(commitArgs).ok) fail('git commit failed')
}

step(`tag ${tag}`)
if (!git(['tag', '-a', tag, '-m', tagMessage]).ok) fail('git tag failed')

process.stdout.write('\n[release] committed and tagged (not pushed)\n')
process.stdout.write(`  git -c http.proxy=<proxy> push origin main && git push origin ${tag}\n`)

if (options.push) {
  step('push main and the tag')
  if (!git([...gitProxyArgs(), 'push', 'origin', 'main']).ok) fail('push main failed')
  if (!git([...gitProxyArgs(), 'push', 'origin', tag]).ok) fail('push the tag failed')
  process.stdout.write(`\n[release] pushed - the tag push triggers the publish workflow; verify with:\n  node scripts/release.mjs --check ${version} --wait\n`)
}

if (options.ghRelease) {
  if (!options.push) fail('--gh-release needs --push: the release is created for the pushed tag')
  step(`GitHub Release ${tag}`)
  const notes = join(tmpdir(), `dsh-palm-${tag}-notes.md`)
  writeFileSync(notes, `${body}\n`)
  try {
    if (!run(`gh release create ${tag} --title "${tag}" --notes-file "${notes}"${prereleaseFlag}`, rootDir, proxyEnv())) {
      fail('gh release create failed')
    }
  } finally {
    rmSync(notes, { force: true })
  }
}

// ------------------------------------------------------------------ helpers
function record(name, ok, hint) {
  checks.push({ name, ok })
  process.stdout.write(`  ${ok ? 'PASS' : 'FAIL'}  ${name}\n`)
  if (!ok && hint) process.stderr.write(`        ${hint}\n`)
}

function allPassed() {
  return checks.every((c) => c.ok)
}

function step(title) {
  process.stdout.write(`\n[release] ${title}\n`)
}

function fail(message) {
  process.stderr.write(`[release] ${message}\n`)
  process.exit(1)
}

function run(command, cwd, extraEnv = {}) {
  const result = spawnSync(command, { cwd, shell: true, stdio: 'inherit', env: { ...process.env, ...extraEnv } })
  return !result.error && result.status === 0
}

function git(args) {
  const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8' })
  if (result.status !== 0) process.stderr.write((result.stderr ?? '').trim() + '\n')
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim() }
}

function capture(command, cwd, extraEnv = {}) {
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', env: { ...process.env, ...extraEnv } })
  return result.stdout ?? ''
}

/**
 * gh and npm need the proxy explicitly on a network that cannot reach GitHub
 * or the registry directly. DSH_PALM_GIT_PROXY wins, then the standard
 * variables — the same order the pushes use. (The test suite is unaffected:
 * `pnpm verify` strips these before running it.)
 */
function proxyEnv() {
  const proxy = process.env.DSH_PALM_GIT_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy
  if (!proxy) return {}
  return { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy }
}

/** git with captured output, no shell (so `^`, braces and quotes stay literal). */
function gitCapture(args) {
  const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8' })
  return result.status === 0 ? (result.stdout ?? '').trim() : ''
}

/** Pushes carry the proxy as a git option, never as an exported variable. */
function gitProxyArgs() {
  const proxy = process.env.DSH_PALM_GIT_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy
  return proxy ? ['-c', `http.proxy=${proxy}`] : []
}

function tagExists(name) {
  return git(['rev-parse', '--verify', `refs/tags/${name}`]).ok
}

/**
 * Does the tag already exist on origin? `null` means "the question could not be asked" (no
 * network/proxy), which is deliberately not the same as "no". Failing open here cannot do damage:
 * the push is the very next step and a duplicate tag is rejected there, before anything
 * irreversible. Failing closed on a flaky network would be the worse trade.
 */
function remoteTagExists(name) {
  const result = spawnSync('git', [...gitProxyArgs(), 'ls-remote', '--tags', 'origin', name], { cwd: rootDir, encoding: 'utf8' })
  if (result.status !== 0) return null
  return (result.stdout ?? '').trim() !== ''
}

/** The `## [x.y.z] - date` section, whose body becomes the commit and tag text. */
function changelogSection(wanted) {
  if (!existsSync(join(rootDir, 'CHANGELOG.md'))) return null
  const text = readFileSync(join(rootDir, 'CHANGELOG.md'), 'utf8')
  const start = text.indexOf(`## [${wanted}]`)
  if (start < 0) return null
  const rest = text.slice(start)
  const next = rest.indexOf('\n## [', 1)
  const chunk = (next < 0 ? rest : rest.slice(0, next)).trimEnd()
  const lines = chunk.split('\n')
  return { heading: lines[0].trim(), body: lines.slice(1).join('\n').trim() }
}

/** The version is inlined at build time, so a stale build ships a stale number. */
function versionInlined(wanted) {
  const bundle = join(packageDir, 'lib', 'mobile.js')
  return existsSync(bundle) && readFileSync(bundle, 'utf8').includes(wanted)
}

/**
 * Post-release verification: the CI runs for this version, and the registry.
 * The registry lags the publish by minutes, and its packument lags its
 * version document, so ask for the version document itself (--wait polls).
 */
function checkRelease(wanted) {
  if (!wanted) {
    process.stderr.write('[release] --check needs a version\n')
    return false
  }
  // Local, not the module-level const: --check runs before that one is
  // initialized, so reaching for it here is a reference error.
  const tag = `v${wanted}`
  // Three outcomes, three exit codes: published (0), failed (1), not finished yet (2). Reporting
  // "not finished" as a failure is how a check gets ignored — this one exited 1 while the publish
  // it was watching went green a minute later, because the registry already had the version.
  let sawFailure = false
  let sawPending = false
  let ghReadable = true

  step(`CI runs for v${wanted}`)
  const runs = capture(`gh run list --limit 20 --json workflowName,headBranch,conclusion,status,displayTitle`, rootDir, proxyEnv())
  try {
    const parsed = JSON.parse(runs)
    // Only the two workflows this release depends on: Dependabot's scheduled
    // runs live in the same list and fail for reasons that have nothing to do
    // with a release.
    const relevant = parsed.filter((r) => RELEVANT_WORKFLOWS.includes(r.workflowName))
    const ignored = parsed.length - relevant.length
    // gh lists newest first. Report the tag's own run per workflow, plus the
    // newest run of every workflow (the current state of main), keyed by
    // workflow+branch so a historical failure for this version cannot mask the
    // run that came after it.
    const latestOfWorkflow = new Map()
    for (const run of relevant) {
      if (!latestOfWorkflow.has(run.workflowName)) latestOfWorkflow.set(run.workflowName, run)
    }
    const reported = new Map()
    for (const run of relevant) {
      const key = `${run.workflowName}@${run.headBranch}`
      const isTagRun = run.headBranch === tag || (run.displayTitle ?? '').includes(wanted)
      if (reported.has(key) || !(isTagRun || latestOfWorkflow.get(run.workflowName) === run)) continue
      reported.set(key, run)
    }
    if (reported.size === 0) {
      process.stdout.write('  no runs found yet (CI may still be queuing)\n')
      sawPending = true
    }
    for (const run of reported.values()) {
      const settled = run.status === 'completed'
      const state = settled ? run.conclusion : run.status
      // A run that has not settled is not a failure: remember it separately and decide at the end
      // by asking whether the artifact exists. The registry is the authority on "published".
      if (state !== 'success') {
        if (settled) sawFailure = true
        else sawPending = true
      }
      const label = state === 'success' ? 'PASS' : settled ? 'FAIL' : 'WAIT'
      process.stdout.write(`  ${label}  ${run.workflowName} (${run.headBranch}) -> ${state}\n`)
    }
    if (ignored > 0) process.stdout.write(`  (${ignored} unrelated workflow run(s) ignored)\n`)
  } catch (error) {
    process.stderr.write(`  could not read gh run list: ${error?.message ?? error}\n`)
    process.stderr.write('  (is gh installed, authenticated, and given a proxy?)\n')
    ghReadable = false
  }

  step(`registry ${PACKAGE_NAME}@${wanted}`)
  const deadline = Date.now() + (options.wait ? 8 * 60_000 : 0)
  let versionDoc = ''
  let tarball = ''
  for (;;) {
    // --json, not the default `key = value` rendering: the value must be
    // compared exactly, and dist.tarball rides along in the same call.
    const view = capture(`npm view ${PACKAGE_NAME}@${wanted} version dist.tarball --json`, rootDir, proxyEnv()).trim()
    try {
      const parsed = JSON.parse(view)
      versionDoc = parsed.version ?? ''
      tarball = parsed['dist.tarball'] ?? ''
    } catch {
      versionDoc = ''
      tarball = ''
    }
    if (versionDoc === wanted) break
    if (Date.now() >= deadline) break
    process.stdout.write(`  not visible yet (the registry lags the publish ~4 min) - retrying in 30s\n`)
    sleep(30_000)
  }
  if (versionDoc === wanted) {
    process.stdout.write(`  PASS  version document resolves (${tarball || 'tarball url not reported'})\n`)
  } else {
    process.stderr.write(`  WAIT  version document does not resolve yet; if the publish job was green, wait a few minutes and re-run\n`)
  }
  const latest = capture(`npm view ${PACKAGE_NAME} dist-tags.latest`, rootDir, proxyEnv()).trim()
  process.stdout.write(`  ${latest === wanted ? 'PASS' : 'WARN'}  dist-tags.latest = ${latest || '(unknown)'}\n`)
  // The registry decides. A version document that resolves *is* a published release, whatever the
  // workflow list said a moment earlier; a failed workflow plus a missing document is a failure;
  // anything else is simply not finished yet, and says so with its own exit code.
  if (versionDoc === wanted) {
    if (sawPending) process.stdout.write('  (a publish run was still going, but the version is on the registry - that settles it)\n')
    return 0
  }
  if (sawFailure) {
    process.stderr.write('[release] 发布失败：有工作流失败，且注册表上没有该版本\n')
    return 1
  }
  process.stderr.write(
    ghReadable
      ? '[release] 未完成：注册表还没这个版本，也没有失败的任务 —— 几分钟后重跑同一命令\n'
      : '[release] 未完成：读不到 gh 的运行状态，注册表也还没有该版本 —— 无法判定，稍后重跑\n',
  )
  return 2
}

function sleep(ms) {
  // Synchronous on purpose: the check is a short, sequential CLI flow.
  const shared = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(shared), 0, 0, ms)
}

function parseArgs(argv) {
  const parsed = { version: null, apply: false, push: false, ghRelease: false, skipVerify: false, summary: null, check: false, wait: false, help: false, fromHead: false, expectSha: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null]
    const value = inline ?? argv[i + 1]
    switch (flag) {
      case '--apply': parsed.apply = true; break
      case '--push': parsed.push = true; break
      case '--from-head': parsed.fromHead = true; break
      case '--expect-sha': parsed.expectSha = value; if (inline === null) i += 1; break
      case '--gh-release': parsed.ghRelease = true; break
      case '--skip-verify': parsed.skipVerify = true; break
      case '--summary': parsed.summary = value; if (inline === null) i += 1; break
      case '--check': parsed.check = true; if (inline === null && value && !value.startsWith('--')) { parsed.version = value; i += 1 } break
      case '--wait': parsed.wait = true; break
      case '--help': case '-h': parsed.help = true; break
      default: if (!arg.startsWith('--')) parsed.version = arg; break
    }
  }
  return parsed
}
