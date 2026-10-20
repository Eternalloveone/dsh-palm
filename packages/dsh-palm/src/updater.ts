/**
 * 版本检查 + 一键更新（桌面配对面板底部的那一行）。
 *
 * 判断"latest 是多少"复用 ./latest-version.ts（手机端「关于」用的同一套），
 * 两条更新轨道按安装形态自动选：
 *
 * - 实体目录（正式安装）：把新版本装进临时目录 → 备份旧目录 → 换入 → 校验，
 *   任何一步失败都把旧目录放回去；
 * - 链接 / junction（源码开发安装）：仓库有未提交改动就拒绝；干净才走
 *   `git pull --ff-only` + `pnpm install` + `pnpm build`，校验失败时把仓库
 *   重置回更新前的提交。
 *
 * 所有会碰磁盘、会起进程的动作都从 deps 注入（run / fsOps / now / tmpDir），
 * 测试里绝不真的装包、也不碰真实安装路径。
 */

import { spawn } from 'node:child_process'
import {
  appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fetchLatestVersion, isNewerVersion } from './latest-version.ts'

/** 本面板所属的包。 */
export const DEFAULT_PKG_NAME = '@eternalloveone/dsh-palm'

/** 审计日志文件名，和设备表放在同一个目录。 */
export const UPDATE_AUDIT_FILE_NAME = 'dsh-palm-update.audit.log'

/** 更新成功后到自动重启之间的倒计时。 */
export const DEFAULT_RESTART_DELAY_MS = 10_000

/**
 * npm 的下载参数：网络不通时快速失败。默认重试会让人对着面板干等七十秒，
 * 最后还只得到一句"退出码 1"。
 *
 * 注意 mintimeout 必须一并给：npm 默认 mintimeout 是 10 秒，只压 maxtimeout
 * 会让 npm 直接报 "minTimeout is greater than maxTimeout"，连健康的源也装不了。
 */
export const NPM_FETCH_ARGS: readonly string[] = [
  '--no-audit',
  '--no-fund',
  '--fetch-retries=1',
  '--fetch-timeout=20000',
  '--fetch-retry-mintimeout=1000',
  '--fetch-retry-maxtimeout=5000',
]

/** 更新器用到的 node:fs 表面（测试可整份注入）。 */
export type UpdateFsOps = Pick<
  typeof import('node:fs'),
  | 'existsSync' | 'lstatSync' | 'realpathSync' | 'readFileSync' | 'writeFileSync'
  | 'appendFileSync' | 'mkdirSync' | 'mkdtempSync' | 'rmSync' | 'renameSync'
  | 'cpSync' | 'readdirSync'
>

/** 真实文件系统。 */
const NODE_FS: UpdateFsOps = {
  existsSync, lstatSync, realpathSync, readFileSync, writeFileSync,
  appendFileSync, mkdirSync, mkdtempSync, rmSync, renameSync, cpSync, readdirSync,
}

/** 一条子进程执行器（注入点；测试里只记录调用）。 */
export type UpdateRunner = (
  command: string,
  args: readonly string[],
  options: { cwd: string },
) => Promise<{ code: number; stdout: string; stderr: string }>

/**
 * 默认执行器：起真进程并收集输出。Windows 上 npm / pnpm 是 .cmd，必须过
 * shell；git 这类 .exe 直接起，不经 shell（也避开新版 node 对 shell+args 的
 * 弃用告警）。
 */
const SHELL_WRAPPED_COMMAND = /^(npm|npx|pnpm|yarn)$/

export const defaultRun: UpdateRunner = async (command, args, options) => {
  return await new Promise((resolve) => {
    try {
      const child = spawn(command, [...args], {
        cwd: options.cwd,
        shell: process.platform === 'win32' && SHELL_WRAPPED_COMMAND.test(command),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer | string) => { stdout += String(chunk) })
      child.stderr?.on('data', (chunk: Buffer | string) => { stderr += String(chunk) })
      child.on('error', () => { resolve({ code: -1, stdout, stderr }) })
      child.on('close', (code) => { resolve({ code: code ?? -1, stdout, stderr }) })
    } catch {
      resolve({ code: -1, stdout: '', stderr: '' })
    }
  })
}

/** 安装形态：真实目录、指向别处的链接，或者根本没装。 */
export interface InstallTarget {
  shape: 'directory' | 'link' | 'missing'
  /** 去掉链接后的真实目录。 */
  resolved?: string
  /** 链接目标往上最近的含 .git 的目录。 */
  repoRoot?: string
}

/** 更新计划；refuse 非空时表示"看清楚了，但这次不动"。 */
export interface UpdatePlan {
  kind: 'noop' | 'npm' | 'source'
  installed: string
  latest: string | undefined
  /** 给人看的中文步骤说明。 */
  steps: string[]
  target: InstallTarget
  refuse?: string
}

/** 一条审计记录。 */
export interface UpdateAuditEntry {
  at: string
  from: string
  to: string
  kind: UpdatePlan['kind']
  ok: boolean
  step: string
  error?: string
}

/** runUpdate 的返回值。 */
export interface UpdateOutcome {
  ok: boolean
  kind: UpdatePlan['kind']
  from: string
  to: string
  step: string
  error?: string
}

/** runUpdate 的注入依赖。 */
export interface UpdateRunDeps {
  run: UpdateRunner
  fsOps?: UpdateFsOps
  now?: () => number
  /** 临时区基目录（默认 os.tmpdir()）。 */
  tmpDir?: string
  /** 审计日志绝对路径；缺省则不写。 */
  auditFile?: string
  pkgName?: string
}

/** 错误对象 → 一句可读的话。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 判断一个模块路径是实体目录、链接，还是不存在。
 * @param modulePath - node_modules 下的包目录（可能是 junction / symlink）。
 * @param fsOps - 文件系统（测试注入）。
 * @returns 形态 + 解析后的真实目录 + 链接目标的源码仓库根。
 */
export function detectInstallTarget(modulePath: string, fsOps: UpdateFsOps = NODE_FS): InstallTarget {
  let stats: ReturnType<UpdateFsOps['lstatSync']>
  try {
    stats = fsOps.lstatSync(modulePath)
  } catch {
    return { shape: 'missing' }
  }
  let resolved = modulePath
  try {
    resolved = fsOps.realpathSync(modulePath)
  } catch {
    // 解析失败就退回原路径；形态判断仍然有效。
  }
  if (!stats.isSymbolicLink()) return { shape: 'directory', resolved }
  const repoRoot = findRepoRoot(resolved, fsOps)
  return {
    shape: 'link',
    resolved,
    ...(repoRoot !== undefined ? { repoRoot } : {}),
  }
}

/** 从 from 往上找最近一个含 .git 的目录（最多 12 层）。 */
function findRepoRoot(from: string, fsOps: UpdateFsOps): string | undefined {
  let current = from
  for (let depth = 0; depth < 12; depth += 1) {
    if (fsOps.existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

/**
 * 源码仓库有没有未提交的改动。git 本身失败时按"有改动"处理：宁可拒绝更新，
 * 也不在看不清楚的时候动别人的工作树。
 */
export async function repoIsDirty(repoRoot: string, run: UpdateRunner = defaultRun): Promise<boolean> {
  try {
    const result = await run('git', ['status', '--porcelain'], { cwd: repoRoot })
    if (result.code !== 0) return true
    return result.stdout.trim() !== ''
  } catch {
    return true
  }
}

/**
 * 根据版本比较结果和安装形态给出计划。纯函数，不发请求、不碰磁盘。
 * @param input.installed - 当前安装的版本。
 * @param input.latest - registry 的 latest（拿不到就是 undefined）。
 * @param input.target - detectInstallTarget 的结果。
 * @param input.repoDirty - 链接安装时源码仓库是否干净。
 * @returns 计划：noop（不用动）/ npm（实体目录）/ source（源码仓库）。
 */
export function planUpdate(input: {
  installed: string
  latest: string | undefined
  target: InstallTarget
  repoDirty?: boolean
  pkgName?: string
}): UpdatePlan {
  const pkgName = input.pkgName ?? DEFAULT_PKG_NAME
  const base: UpdatePlan = {
    kind: 'noop',
    installed: input.installed,
    latest: input.latest,
    steps: [],
    target: input.target,
  }
  if (input.latest === undefined || input.latest === '') {
    return { ...base, steps: ['暂时查不到最新版本，先不更新'] }
  }
  if (!isNewerVersion(input.latest, input.installed)) {
    return { ...base, steps: [`已经是最新的 ${input.installed}`] }
  }
  if (input.target.shape === 'missing') {
    const reason = '没找到已安装的 dsh-palm，无法自动更新'
    return { ...base, steps: [reason], refuse: reason }
  }
  if (input.target.shape === 'link') {
    if (input.target.repoRoot === undefined) {
      const reason = '这是指向源码的链接安装，但没找到源码仓库，无法自动更新'
      return { ...base, steps: [reason], refuse: reason }
    }
    if (input.repoDirty === true) {
      const reason = '仓库里有没提交的改动，已停止更新（避免弄乱你手上的活儿）'
      return { ...base, steps: [reason], refuse: reason }
    }
    return {
      ...base,
      kind: 'source',
      steps: [
        `拉取 ${input.latest} 的源码（只做快进合并）`,
        '安装依赖',
        '重新构建',
        '验证新版本',
        '任何一步失败都自动回滚',
      ],
    }
  }
  return {
    ...base,
    kind: 'npm',
    steps: [
      `下载 ${pkgName}@${input.latest}`,
      '备份当前安装',
      '替换安装目录',
      '验证新版本',
      '失败时自动回滚',
    ],
  }
}

/** 读一个包目录的 package.json（只取用得到的三个字段）。 */
export function readPackageManifest(
  packageDir: string,
  fsOps: UpdateFsOps = NODE_FS,
): { name?: string; version?: string; main?: string } | undefined {
  try {
    const parsed = JSON.parse(fsOps.readFileSync(join(packageDir, 'package.json'), 'utf8')) as Record<string, unknown>
    return {
      ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
      ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
      ...(typeof parsed.main === 'string' ? { main: parsed.main } : {}),
    }
  } catch {
    return undefined
  }
}

/** 校验：版本号等于期望值，且入口文件真的在。 */
export function verifyInstalled(packageDir: string, expected: string, fsOps: UpdateFsOps = NODE_FS): boolean {
  const manifest = readPackageManifest(packageDir, fsOps)
  if (manifest === undefined || manifest.version !== expected) return false
  return fsOps.existsSync(join(packageDir, manifest.main ?? 'lib/index.js'))
}

/** 包里声明的运行时依赖名。 */
function readDeclaredDependencies(packageDir: string, fsOps: UpdateFsOps = NODE_FS): string[] {
  try {
    const parsed = JSON.parse(fsOps.readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>
    }
    return Object.keys(parsed.dependencies ?? {}).sort()
  } catch {
    return []
  }
}

/**
 * 装完必须检查依赖能不能真的解析到：只校验"版本号 + 入口文件在"会漏掉
 * 新增运行时依赖的情况——那种情况报成功、自动重启，然后插件加载失败。
 * @param packageDir - 新装好的包目录。
 * @param profileRoot - 含 node_modules 的安装根目录。
 * @returns 解析不到的依赖名（空数组表示齐了）。
 */
export function missingDependencies(
  packageDir: string,
  profileRoot: string,
  fsOps: UpdateFsOps = NODE_FS,
): string[] {
  const declared = readDeclaredDependencies(packageDir, fsOps)
  const roots = [packageDir, profileRoot]
  const missing: string[] = []
  for (const name of declared) {
    const segments = name.split('/')
    const found = roots.some((root) => fsOps.existsSync(join(root, 'node_modules', ...segments)))
    if (!found) missing.push(name)
  }
  return missing
}

/** 安装根：包目录往上最近的 node_modules 的父目录就是 profile 根。 */
export function profileRootOf(installedDir: string): string | undefined {
  const marker = `${sep}node_modules${sep}`
  const at = installedDir.lastIndexOf(marker)
  if (at <= 0) return undefined
  const parent = installedDir.slice(0, at)
  return parent === '' ? undefined : parent
}

/** 把子进程 stderr 的第一句拼进面向用户的错误里。 */
function detailOf(stderr: string): string {
  const line = stderr
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part !== '')
  if (line === undefined) return ''
  return `；${line.length > 160 ? `${line.slice(0, 160)}…` : line}`
}

/** 审计日志落在设备表旁边。 */
export function updateAuditFile(devicesFile: string): string {
  return join(dirname(devicesFile), UPDATE_AUDIT_FILE_NAME)
}

/**
 * 写一行审计。写不进去只打日志——审计失败不能让更新本身失败。
 */
function writeUpdateAudit(auditFile: string | undefined, entry: UpdateAuditEntry, fsOps: UpdateFsOps): void {
  if (auditFile === undefined || auditFile === '') return
  try {
    fsOps.appendFileSync(auditFile, `${JSON.stringify(entry)}\n`)
  } catch (error) {
    console.error(`dsh-palm: 更新审计写入失败：${messageOf(error)}`)
  }
}

/**
 * 执行一个更新计划：备份 → 执行 → 校验 → 失败回滚 → 写审计。
 * @param plan - planUpdate 的结果（kind 为 noop 时直接返回）。
 * @param deps - 注入的子进程执行器、文件系统、时钟、临时区、审计路径。
 * @returns 结果。
 * @throws 失败时抛出中文可读的错误（此时旧版本已经恢复，或明确说明没恢复成功）。
 */
export async function runUpdate(plan: UpdatePlan, deps: UpdateRunDeps): Promise<UpdateOutcome> {
  const fsOps = deps.fsOps ?? NODE_FS
  const now = deps.now ?? Date.now
  const to = plan.latest ?? plan.installed
  const audit = (ok: boolean, step: string, error?: string): void => {
    writeUpdateAudit(deps.auditFile, {
      at: new Date(now()).toISOString(),
      from: plan.installed,
      to,
      kind: plan.kind,
      ok,
      step,
      ...(error !== undefined ? { error } : {}),
    }, fsOps)
  }
  if (plan.kind === 'noop') {
    // 拒绝也是一条审计：下次查"为什么没更新"时能看到原因。
    if (plan.refuse !== undefined) audit(false, 'refuse', plan.refuse)
    return { ok: true, kind: 'noop', from: plan.installed, to, step: plan.refuse ?? '无需更新' }
  }
  if (plan.kind === 'npm') {
    return await runNpmTrack(plan, {
      fsOps,
      run: deps.run,
      now,
      tmpDir: deps.tmpDir ?? tmpdir(),
      pkgName: deps.pkgName ?? DEFAULT_PKG_NAME,
      audit,
    })
  }
  return await runSourceTrack(plan, { fsOps, run: deps.run, audit })
}

/** npm 轨道：装到临时目录 → 备份旧目录 → 换入 → 校验 → 失败放回旧目录。 */
async function runNpmTrack(plan: UpdatePlan, ctx: {
  fsOps: UpdateFsOps
  run: UpdateRunner
  now: () => number
  tmpDir: string
  pkgName: string
  audit: (ok: boolean, step: string, error?: string) => void
}): Promise<UpdateOutcome> {
  const { fsOps, run, tmpDir, pkgName, audit } = ctx
  const latest = plan.latest ?? ''
  const installedDir = plan.target.resolved ?? ''
  const finish = (ok: boolean, step: string, error?: string): UpdateOutcome => ({
    ok, kind: 'npm', from: plan.installed, to: latest, step, ...(error !== undefined ? { error } : {}),
  })
  if (installedDir === '') {
    const reason = '找不到已安装的目录，无法替换'
    audit(false, 'preflight', reason)
    throw new Error(`更新没成功：${reason}`)
  }
  const workDir = fsOps.mkdtempSync(join(tmpDir, 'dsh-palm-update-'))
  const stageDir = join(workDir, 'stage')
  const retiredDir = join(workDir, 'retired')
  fsOps.mkdirSync(stageDir, { recursive: true })
  const cleanup = (): void => {
    try { fsOps.rmSync(workDir, { recursive: true, force: true }) } catch { /* 临时区尽力清理 */ }
  }

  const install = await run(
    'npm',
    ['install', '--prefix', stageDir, ...NPM_FETCH_ARGS, '--no-save', `${pkgName}@${latest}`],
    { cwd: workDir },
  )
  if (install.code !== 0) {
    cleanup()
    const reason = `下载安装包失败（npm 退出码 ${String(install.code)}${detailOf(install.stderr)}）`
    audit(false, 'install', reason)
    throw new Error(`更新没成功：${reason}`)
  }
  const stagedDir = join(stageDir, 'node_modules', ...pkgName.split('/'))
  if (!verifyInstalled(stagedDir, latest, fsOps)) {
    cleanup()
    const reason = '新版本校验没通过（版本号或入口文件不对）'
    audit(false, 'verify-staged', reason)
    throw new Error(`更新没成功：${reason}，安装目录没有改动`)
  }

  // 备份：整棵旧目录挪进临时区。同一磁盘上 rename 是原子的，失败时原样不动。
  const profileRoot = profileRootOf(installedDir)
  if (profileRoot === undefined) {
    cleanup()
    const reason = '找不到安装目录所在的 node_modules，无法替换'
    audit(false, 'preflight', reason)
    throw new Error(`更新没成功：${reason}，安装目录没有改动`)
  }
  try {
    fsOps.renameSync(installedDir, retiredDir)
  } catch (error) {
    cleanup()
    const reason = `备份旧安装失败（${messageOf(error)}）`
    audit(false, 'backup', reason)
    throw new Error(`更新没成功：${reason}，安装目录没有改动`)
  }

  try {
    // 依赖必须装进真实安装目录：临时区里的依赖会随临时区一起删掉，只复制
    // 包本体的话，新版本一旦新增运行时依赖就是"报成功、重启后加载失败"。
    const apply = await run(
      'npm',
      ['install', '--prefix', profileRoot, ...NPM_FETCH_ARGS, '--no-save', `${pkgName}@${latest}`],
      { cwd: profileRoot },
    )
    if (apply.code !== 0) {
      throw new Error(`把新版本装进安装目录失败（npm 退出码 ${String(apply.code)}${detailOf(apply.stderr)}）`)
    }
    if (!verifyInstalled(installedDir, latest, fsOps)) {
      throw new Error('新目录校验没通过（版本号或入口文件不对）')
    }
    const missing = missingDependencies(installedDir, profileRoot, fsOps)
    if (missing.length > 0) throw new Error(`新版本的依赖没装上：${missing.join('、')}`)
    cleanup()
    audit(true, 'done')
    return finish(true, 'done')
  } catch (error) {
    const reason = messageOf(error)
    let restored = true
    try {
      fsOps.rmSync(installedDir, { recursive: true, force: true })
      fsOps.renameSync(retiredDir, installedDir)
    } catch {
      restored = false
    }
    if (restored) cleanup()
    const note = restored
      ? '已恢复到更新前的版本'
      : `自动恢复没成功，旧版本还在 ${retiredDir}`
    audit(false, 'rollback', `${reason}；${note}`)
    throw new Error(`更新没成功：${reason}，${note}`)
  }
}

/** 源码轨道：快进合并 → 装依赖 → 构建 → 校验；失败把仓库重置回原提交。 */
async function runSourceTrack(plan: UpdatePlan, ctx: {
  fsOps: UpdateFsOps
  run: UpdateRunner
  audit: (ok: boolean, step: string, error?: string) => void
}): Promise<UpdateOutcome> {
  const { fsOps, run, audit } = ctx
  const repoRoot = plan.target.repoRoot
  const packageDir = plan.target.resolved
  const latest = plan.latest ?? ''
  if (repoRoot === undefined || packageDir === undefined) {
    const reason = '找不到源码仓库根目录，无法更新'
    audit(false, 'preflight', reason)
    throw new Error(`更新没成功：${reason}`)
  }
  const head = await run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })
  const headCommit = head.code === 0 ? head.stdout.trim() : ''

  const rollback = async (reason: string): Promise<never> => {
    if (headCommit === '') {
      audit(false, 'rollback', `${reason}；没有可回滚的提交`)
      throw new Error(`更新没成功：${reason}；没有可回滚的提交`)
    }
    const reset = await run('git', ['reset', '--hard', headCommit], { cwd: repoRoot })
    const note = reset.code === 0
      ? `已恢复到更新前的提交 ${headCommit.slice(0, 7)}`
      : `自动回滚没成功，请手动执行 git reset --hard ${headCommit}`
    audit(false, 'rollback', `${reason}；${note}`)
    throw new Error(`更新没成功：${reason}；${note}`)
  }

  const pull = await run('git', ['pull', '--ff-only'], { cwd: repoRoot })
  if (pull.code !== 0) await rollback(`拉取源码失败（git 退出码 ${String(pull.code)}）`)
  const install = await run('pnpm', ['install'], { cwd: repoRoot })
  if (install.code !== 0) await rollback(`安装依赖失败（pnpm install 退出码 ${String(install.code)}）`)
  const build = await run('pnpm', ['build'], { cwd: repoRoot })
  if (build.code !== 0) await rollback(`重新构建失败（pnpm build 退出码 ${String(build.code)}）`)
  if (!verifyInstalled(packageDir, latest, fsOps)) {
    await rollback('新版本校验没通过（版本号或入口文件不对）')
  }
  audit(true, 'done')
  return { ok: true, kind: 'source', from: plan.installed, to: latest, step: 'done' }
}

/**
 * 找到"实际被 node_modules 看到的"包目录：优先 $DSH_HOME/profiles 下各 profile
 * 的 node_modules 条目（那才是链接/junction 的形态），找不到就退回本模块自己的
 * 目录。
 */
export function locateInstalledPackageDir(options: {
  selfDir: string
  home: string
  pkgName?: string
  fsOps?: UpdateFsOps
}): string {
  const fsOps = options.fsOps ?? NODE_FS
  const pkgName = options.pkgName ?? DEFAULT_PKG_NAME
  const profiles = join(options.home, 'profiles')
  try {
    for (const profile of fsOps.readdirSync(profiles)) {
      const candidate = join(profiles, profile, 'node_modules', ...pkgName.split('/'))
      if (fsOps.existsSync(candidate)) return candidate
    }
  } catch {
    // 没有 profiles 目录：说明不是按 profile 安装的，用自身目录。
  }
  return options.selfDir
}

/** 面板轮询到的更新状态。 */
export interface UpdateStatus {
  phase: 'idle' | 'running' | 'restarting' | 'done' | 'failed'
  done: boolean
  ok: boolean
  from: string
  to: string
  step: string
  error?: string
  restartAt?: number
}

/** /api/pair/version 的内容。 */
export interface UpdateVersionFrame {
  installed: string
  latest: string | null
  isNewer: boolean
  target: InstallTarget['shape']
  repoDirty?: boolean
  plan: UpdatePlan
}

/** 协调器的注入依赖。 */
export interface UpdateCoordinatorDeps {
  /** node_modules 下的包目录（链接或实体）。 */
  modulePath: string
  pkgName?: string
  devicesFile?: string | (() => string | undefined)
  fetchLatest?: (pkgName: string) => Promise<string | undefined>
  run?: UpdateRunner
  fsOps?: UpdateFsOps
  now?: () => number
  tmpDir?: string
  restartDelayMs?: number
  /** 安排重启（restart.ts）；缺省则更新完不提供自动重启。 */
  scheduleRestart?: (delayMs: number) => { ok: boolean; error?: string }
  cancelRestart?: () => void
}

/** 初始状态。 */
const IDLE_STATUS: UpdateStatus = { phase: 'idle', done: false, ok: false, from: '', to: '', step: '' }

/** 上一次还没跑完时，第二次点击拿到的计划：一句话说清楚，什么都不做。 */
function busyPlan(state: UpdateStatus): UpdatePlan {
  return {
    kind: 'noop',
    installed: state.from,
    latest: state.to === '' ? undefined : state.to,
    steps: ['上一次更新还在进行中'],
    target: { shape: 'missing' },
    refuse: '上一次更新还在跑，等它结束再点',
  }
}

/**
 * 串起"查版本 → 计划 → 后台执行 → 倒计时重启"的协调器。路由只和它打交道，
 * 面板因此不需要知道更新是怎么做的。
 */
export class UpdateCoordinator {
  private state: UpdateStatus = { ...IDLE_STATUS }
  private currentPlan: UpdatePlan | undefined
  /** 有一次更新正在进行（含"刚点下、还在查版本"的窗口）。 */
  private busy = false
  private readonly deps: UpdateCoordinatorDeps

  constructor(deps: UpdateCoordinatorDeps) {
    this.deps = deps
  }

  /** 当前状态快照（倒计时到点后自动收尾为 done）。 */
  status(): UpdateStatus {
    const now = (this.deps.now ?? Date.now)()
    if (this.state.phase === 'restarting' && this.state.restartAt !== undefined && now >= this.state.restartAt) {
      return { ...this.state, phase: 'done', done: true, step: 'done' }
    }
    return { ...this.state }
  }

  /** 查一次版本并给出计划；latest 拿不到就是 null，不报错。 */
  async version(): Promise<UpdateVersionFrame> {
    const fsOps = this.deps.fsOps ?? NODE_FS
    const pkgName = this.deps.pkgName ?? DEFAULT_PKG_NAME
    const target = detectInstallTarget(this.deps.modulePath, fsOps)
    const manifest = readPackageManifest(this.deps.modulePath, fsOps)
    const installed = manifest?.version ?? ''
    let latest: string | undefined
    try {
      latest = await (this.deps.fetchLatest ?? fetchLatestVersion)(pkgName)
    } catch {
      latest = undefined
    }
    let repoDirty: boolean | undefined
    if (target.shape === 'link' && target.repoRoot !== undefined) {
      repoDirty = await repoIsDirty(target.repoRoot, this.deps.run ?? defaultRun)
    }
    const plan = planUpdate({
      installed,
      latest,
      target,
      ...(repoDirty !== undefined ? { repoDirty } : {}),
      pkgName,
    })
    return {
      installed,
      latest: latest ?? null,
      isNewer: latest !== undefined && isNewerVersion(latest, installed),
      target: target.shape,
      ...(repoDirty !== undefined ? { repoDirty } : {}),
      plan,
    }
  }

  /**
   * 开始（或预演）一次更新。
   * @param dryRun - true 时只做检测与计划，不落任何改动。
   * @returns started（后台是否已经跑起来）与计划本身。
   */
  async start(dryRun: boolean): Promise<{ started: boolean; plan: UpdatePlan }> {
    // 守卫必须在第一个 await 之前：连点两下时，两次调用都会在 await 里
    // 同时通过状态检查，结果是两个更新并行去改同一份安装。
    if (this.busy || (this.state.phase === 'running' && this.currentPlan !== undefined)) {
      return { started: false, plan: this.currentPlan ?? busyPlan(this.state) }
    }
    this.busy = true
    let handedOff = false
    try {
      const frame = await this.version()
      const plan = frame.plan
      this.currentPlan = plan
      if (dryRun) return { started: false, plan }
      if (plan.kind === 'noop') {
        const refused = plan.refuse !== undefined
        this.state = {
          phase: refused ? 'failed' : 'done',
          done: true,
          ok: !refused,
          from: frame.installed,
          to: frame.latest ?? '',
          step: refused ? 'refuse' : 'done',
          ...(refused ? { error: plan.refuse } : {}),
        }
        return { started: false, plan }
      }
      this.state = {
        phase: 'running',
        done: false,
        ok: false,
        from: frame.installed,
        to: frame.latest ?? '',
        step: plan.steps[0] ?? '',
      }
      handedOff = true
      void this.execute(plan)
      return { started: true, plan }
    } finally {
      // 交棒给 execute 之后由它收尾；其余路径（预演、无需更新、抛错）在这里清。
      if (!handedOff) this.busy = false
    }
  }

  /** 取消倒计时里的自动重启。 */
  cancelRestart(): boolean {
    const state = this.status()
    if (state.phase !== 'restarting') return false
    try {
      this.deps.cancelRestart?.()
    } catch (error) {
      console.error(`dsh-palm: 取消自动重启失败：${messageOf(error)}`)
      return false
    }
    this.state = {
      phase: 'done', done: true, ok: true,
      from: state.from, to: state.to, step: 'cancelled',
    }
    return true
  }

  /** 后台执行：结束后要么进入重启倒计时，要么给出失败原因。 */
  private async execute(plan: UpdatePlan): Promise<void> {
    const fsOps = this.deps.fsOps ?? NODE_FS
    const devicesFile = typeof this.deps.devicesFile === 'function'
      ? this.deps.devicesFile()
      : this.deps.devicesFile
    try {
      const outcome = await runUpdate(plan, {
        run: this.deps.run ?? defaultRun,
        fsOps,
        ...(this.deps.now !== undefined ? { now: this.deps.now } : {}),
        ...(this.deps.tmpDir !== undefined ? { tmpDir: this.deps.tmpDir } : {}),
        ...(devicesFile !== undefined && devicesFile !== '' ? { auditFile: updateAuditFile(devicesFile) } : {}),
        ...(this.deps.pkgName !== undefined ? { pkgName: this.deps.pkgName } : {}),
      })
      const delayMs = this.deps.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS
      const now = (this.deps.now ?? Date.now)()
      const scheduled = this.deps.scheduleRestart?.(delayMs)
      const restartAt = scheduled !== undefined && scheduled.ok ? now + delayMs : undefined
      this.state = {
        phase: restartAt !== undefined ? 'restarting' : 'done',
        done: restartAt === undefined,
        ok: true,
        from: outcome.from,
        to: outcome.to,
        step: outcome.step,
        ...(restartAt !== undefined ? { restartAt } : {}),
      }
    } catch (error) {
      this.state = {
        phase: 'failed',
        done: true,
        ok: false,
        from: plan.installed,
        to: plan.latest ?? '',
        step: 'failed',
        error: messageOf(error),
      }
    } finally {
      this.busy = false
    }
  }
}
