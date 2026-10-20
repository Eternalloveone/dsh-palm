/**
 * 重启配方 + 延迟重启（配合 ./updater.ts 的一键更新）。
 *
 * 插件加载时把"这次 dsh 是怎么被拉起来的"记下来（execPath / argv / cwd +
 * 一份很窄的环境变量白名单），更新成功后由一个**独立进程**（helper 脚本）
 * 等老进程退出、再照配方重新拉起。取消机制是一个标记文件：helper 每一轮
 * 都看一眼，存在就不重启。
 *
 * 硬规则：绝不把整份 process.env 落盘——里面可能有 token / 密钥。白名单之外
 * 一律不写，名字里带 TOKEN/KEY/SECRET/PASSWORD/CREDENTIAL/COOKIE/AUTH 的
 * 一律不写（即使它长得像 DSH_*）。
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { dshHome } from './dsh-home.ts'

/** 配方文件名，落在 $DSH_HOME 下。 */
export const RESTART_RECIPE_FILE_NAME = 'dsh-palm-restart.json'

/** 明确允许落盘的环境变量名（大小写两种 PATH 都收：Windows 两种写法都见过）。 */
export const LAUNCH_ENV_KEYS: readonly string[] = [
  'PATH', 'Path', 'USERPROFILE', 'HOME', 'SystemRoot', 'windir',
  'TEMP', 'TMP', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL', 'ComSpec',
]

/** 看起来像凭据的变量名，一律不落盘。 */
const SECRET_NAME = /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|COOKIE|AUTH/i

/** 合法的环境变量名（挡住奇怪键名）。 */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 记下来的启动配方。 */
export interface LaunchRecipe {
  execPath: string
  argv: string[]
  cwd: string
  /** 只含白名单里的变量。 */
  env: Record<string, string>
  at: string
  pid: number
}

/** 配方路径。 */
export function restartRecipePath(home: string = dshHome()): string {
  return join(home, RESTART_RECIPE_FILE_NAME)
}

/** helper 把重启结果写到这里（诊断用）。 */
export function restartResultPath(recipePath: string): string {
  return `${recipePath}.result.json`
}

/** 取消标记路径。 */
export function restartCancelPath(recipePath: string): string {
  return `${recipePath}.cancel`
}

/** 错误对象 → 一句话。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 环境变量白名单过滤：只留启动 dsh 必需的路径类变量和 DSH_*。
 * @param env - 待过滤的环境（默认 process.env）。
 * @returns 可以安全落盘的那一份。
 */
export function sanitizeLaunchEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || value === '') continue
    if (!ENV_NAME.test(key)) continue
    const allowed = LAUNCH_ENV_KEYS.includes(key) || key.startsWith('DSH_')
    if (!allowed) continue
    if (SECRET_NAME.test(key)) continue
    out[key] = value
  }
  return out
}

/** captureLaunchRecipe 的注入点（测试用）。 */
export interface CaptureLaunchRecipeDeps {
  env?: NodeJS.ProcessEnv
  argv?: readonly string[]
  execPath?: string
  cwd?: string
  home?: string
  now?: () => number
  pid?: number
}

/**
 * 记下启动配方并落盘。写失败只打日志：记不下来不该让插件起不来。
 * @param deps - 注入点，缺省读当前进程。
 * @returns 配方本身。
 */
export function captureLaunchRecipe(deps: CaptureLaunchRecipeDeps = {}): LaunchRecipe {
  const recipe: LaunchRecipe = {
    execPath: deps.execPath ?? process.execPath,
    argv: [...(deps.argv ?? process.argv)],
    cwd: deps.cwd ?? process.cwd(),
    env: sanitizeLaunchEnv(deps.env ?? process.env),
    at: new Date((deps.now ?? Date.now)()).toISOString(),
    pid: deps.pid ?? process.pid,
  }
  try {
    const path = restartRecipePath(deps.home ?? dshHome())
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(recipe, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error(`dsh-palm: 重启配方保存失败：${messageOf(error)}`)
  }
  return recipe
}

/** 读回配方（诊断 / 测试用）；读不到就是 undefined。 */
export function readLaunchRecipe(path: string): LaunchRecipe | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LaunchRecipe
  } catch {
    return undefined
  }
}

/**
 * helper 脚本本体：零依赖 CommonJS。argv 里依次拿
 * 配方 / 结果 / 取消标记 / 老进程 pid / 倒计时毫秒。
 *
 * 循环：取消标记在 → 退出；老进程已经没了 → 拉起；倒计时到了 → 请老进程
 * 退出（SIGTERM），然后等它真的退出；等太久 → 记 timeout 退出。
 */
const HELPER_SOURCE = `#!/usr/bin/env node
'use strict'
// dsh-palm restart helper: wait for the old dsh process, then relaunch it from
// the recorded recipe. A cancel marker file at any point means "do not restart".
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { spawn } = require('node:child_process')

const [recipePath, resultPath, cancelPath, parentPidRaw, delayRaw] = process.argv.slice(2)
const parentPid = Number(parentPidRaw)
const delayMs = Number(delayRaw)
const startedAt = Date.now()
const MAX_WAIT_MS = 120000

function writeResult(value) {
  try { writeFileSync(resultPath, JSON.stringify({ at: new Date().toISOString(), ...value })) } catch {}
}
function cancelled() { return existsSync(cancelPath) }
function alive(pid) {
  if (!pid || !Number.isFinite(pid)) return false
  try { process.kill(pid, 0); return true } catch { return false }
}
function finish(value) { writeResult(value); process.exit(0) }

function launch() {
  let recipe
  try { recipe = JSON.parse(readFileSync(recipePath, 'utf8')) } catch { return finish({ ok: false, error: 'recipe-unreadable' }) }
  if (cancelled()) return finish({ ok: false, cancelled: true })
  try {
    const child = spawn(recipe.execPath, recipe.argv.slice(1), {
      cwd: recipe.cwd,
      env: { ...process.env, ...recipe.env },
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    finish({ ok: true, pid: child.pid || 0 })
  } catch (error) {
    finish({ ok: false, error: String(error && error.message ? error.message : error) })
  }
}

function tick() {
  if (cancelled()) return finish({ ok: false, cancelled: true })
  if (!alive(parentPid)) return launch()
  if (Date.now() - startedAt >= delayMs) {
    try { process.kill(parentPid, 'SIGTERM') } catch {}
  }
  if (Date.now() - startedAt > delayMs + MAX_WAIT_MS) return finish({ ok: false, error: 'timeout' })
  setTimeout(tick, 250)
}

setTimeout(tick, 250)
`

/** scheduleRestart 的注入点。 */
export interface ScheduleRestartOptions {
  delayMs: number
  recipePath: string
  resultPath: string
  /** helper 落在哪（默认系统临时目录）。 */
  helperPath?: string
  helperDir?: string
  /** 要等的进程（默认本进程）。 */
  parentPid?: number
  spawnFn?: (
    command: string,
    args: readonly string[],
    options: { detached: boolean; stdio: 'ignore'; windowsHide: boolean },
  ) => { pid?: number; unref?(): void }
  fsOps?: Pick<typeof import('node:fs'), 'mkdirSync' | 'writeFileSync' | 'rmSync'>
}

/** scheduleRestart 的结果。 */
export interface ScheduledRestart {
  ok: boolean
  helperPath: string
  cancelPath: string
  resultPath: string
  error?: string
}

/**
 * 写 helper 并把它脱离父进程拉起来；helper 自己负责等待、取消、重启。
 * @param options - 倒计时、配方路径、结果路径与注入点。
 * @returns 是否安排成功，以及三个关键路径。
 */
export function scheduleRestart(options: ScheduleRestartOptions): ScheduledRestart {
  const fsOps = options.fsOps ?? { mkdirSync, writeFileSync, rmSync }
  const helperPath = options.helperPath
    ?? join(options.helperDir ?? tmpdir(), 'dsh-palm-restart-helper.cjs')
  const cancelPath = restartCancelPath(options.recipePath)
  const resultPath = options.resultPath
  try {
    // 上一轮留下的取消标记不能否掉这一次新的倒计时。
    try { fsOps.rmSync(cancelPath, { force: true }) } catch { /* 没有就算了 */ }
    fsOps.mkdirSync(dirname(helperPath), { recursive: true })
    fsOps.writeFileSync(helperPath, HELPER_SOURCE, 'utf8')
    const spawnFn = options.spawnFn ?? ((command, args, spawnOptions) =>
      spawn(command, [...args], spawnOptions))
    const child = spawnFn(process.execPath, [
      helperPath,
      options.recipePath,
      resultPath,
      cancelPath,
      String(options.parentPid ?? process.pid),
      String(options.delayMs),
    ], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref?.()
    return { ok: true, helperPath, cancelPath, resultPath }
  } catch (error) {
    return { ok: false, helperPath, cancelPath, resultPath, error: messageOf(error) }
  }
}

/**
 * 写取消标记。helper 下一轮就会看到并放弃重启。
 * @param options.recipePath - 同一份配方路径（标记按它的名字推导）。
 * @returns 标记文件路径。
 */
export function cancelRestart(options: {
  recipePath: string
  now?: () => number
}): string {
  const path = restartCancelPath(options.recipePath)
  try {
    writeFileSync(path, `${JSON.stringify({ at: new Date((options.now ?? Date.now)()).toISOString() })}\n`, 'utf8')
  } catch (error) {
    console.error(`dsh-palm: 取消标记写入失败：${messageOf(error)}`)
  }
  return path
}

/** 取消标记是否还在（面板/诊断判断"这轮重启是否已被取消"）。 */
export function isRestartCancelled(recipePath: string): boolean {
  return existsSync(restartCancelPath(recipePath))
}
