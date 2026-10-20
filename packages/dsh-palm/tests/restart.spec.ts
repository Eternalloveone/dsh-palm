/**
 * The launch recipe and the deferred-restart helper: the recorded env must
 * never carry credentials, and the generated helper must relaunch, cancel,
 * and report honestly. Helper runs use a real node in a mkdtemp sandbox.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureLaunchRecipe,
  cancelRestart,
  isRestartCancelled,
  readLaunchRecipe,
  restartCancelPath,
  restartRecipePath,
  restartResultPath,
  sanitizeLaunchEnv,
  scheduleRestart,
} from '../src/restart.ts'

const SECRET_LIKE = /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|COOKIE|AUTH/i

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-palm-restart-'))
})

afterEach(async () => {
  // The relaunched child may still be exiting; give the sandbox a moment.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      break
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  vi.restoreAllMocks()
})

/**
 * Poll for the file the relaunched child writes (it runs detached) until its
 * *content* has landed.
 *
 * Waiting for existence alone is not enough: `writeFileSync` truncates the
 * file before writing, so a poll that only stats it can succeed on a 0-byte
 * file and read '' — exactly how this test failed once during the 1.6.3
 * release run while passing every time before.
 */
async function waitForFileContent(path: string, expected: string, timeoutMs = 10_000): Promise<string | null> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (readFileSync(path, 'utf8') === expected) return expected
    } catch {
      // not yet
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return null
}

describe('sanitizeLaunchEnv', () => {
  it('keeps only the launch whitelist and never a credential', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      Path: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\someone',
      DSH_HOME: 'C:\\Users\\someone\\.dsh',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      // Everything below must be dropped.
      DSH_SESSION_TOKEN: 'secret-value',
      GITHUB_TOKEN: 'secret-value',
      AWS_SECRET_ACCESS_KEY: 'secret-value',
      OPENAI_API_KEY: 'secret-value',
      NODE_OPTIONS: '--require ./hook.js',
      NPM_CONFIG_REGISTRY: 'https://example.com',
      'bad-name': 'x',
      EMPTY: '',
    }

    const sanitized = sanitizeLaunchEnv(env)
    expect(Object.keys(sanitized).sort()).toEqual(['DSH_HOME', 'PATH', 'Path', 'SystemRoot', 'TEMP', 'USERPROFILE'])
    for (const key of Object.keys(sanitized)) {
      expect(key).not.toMatch(SECRET_LIKE)
    }
    expect(JSON.stringify(sanitized)).not.toContain('secret-value')
  })

  it('drops non-string values without throwing', () => {
    const sanitized = sanitizeLaunchEnv({ PATH: '/usr/bin', HOME: undefined } as NodeJS.ProcessEnv)
    expect(sanitized).toEqual({ PATH: '/usr/bin' })
  })
})

describe('captureLaunchRecipe', () => {
  it('writes execPath / argv / cwd and the filtered env, file readable back', () => {
    const home = join(dir, 'home')
    mkdirSync(home, { recursive: true })
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      DSH_HOME: home,
      DSH_API_TOKEN: 'secret-value',
    }

    const recipe = captureLaunchRecipe({
      env,
      argv: ['node', 'cli/lib/bin.js', 'web', '--no-open', '--trusted-host', 'phone.example.com'],
      execPath: '/opt/node/bin/node',
      cwd: join(dir, 'work'),
      home,
      now: () => 1_700_000_000_000,
      pid: 4242,
    })

    expect(recipe).toMatchObject({ execPath: '/opt/node/bin/node', cwd: join(dir, 'work'), pid: 4242 })
    expect(recipe.argv).toContain('--trusted-host')
    expect(Object.keys(recipe.env).sort()).toEqual(['DSH_HOME', 'PATH'])

    const file = restartRecipePath(home)
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('secret-value')
    expect(readLaunchRecipe(file)).toEqual(recipe)
    expect(file).toBe(join(home, 'dsh-palm-restart.json'))
  })

  it('logs and still returns the recipe when the file cannot be written', () => {
    // A regular file standing where the home directory should be.
    const notADir = join(dir, 'not-a-dir')
    writeFileSync(notADir, 'x')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recipe = captureLaunchRecipe({ home: notADir, env: { PATH: '/usr/bin' }, execPath: '/node', argv: ['/node'] })
    expect(recipe.execPath).toBe('/node')
    expect(errorSpy).toHaveBeenCalled()
  })
})

describe('scheduleRestart', () => {
  it('writes the helper, clears an old cancel marker, and spawns it detached', () => {
    const home = join(dir, 'home')
    mkdirSync(home, { recursive: true })
    const recipePath = restartRecipePath(home)
    const resultPath = restartResultPath(recipePath)
    const cancelPath = restartCancelPath(recipePath)
    // A stale marker from a previous countdown must not veto this one.
    writeFileSync(cancelPath, '{}')

    const spawned: { command: string; args: readonly string[]; options: unknown }[] = []
    const scheduled = scheduleRestart({
      delayMs: 5_000,
      recipePath,
      resultPath,
      helperDir: join(dir, 'helpers'),
      parentPid: 4242,
      spawnFn: (command, args, options) => {
        spawned.push({ command, args, options })
        return { pid: 99, unref: () => {} }
      },
    })

    expect(scheduled.ok).toBe(true)
    expect(scheduled.cancelPath).toBe(cancelPath)
    expect(scheduled.resultPath).toBe(resultPath)
    const helper = readFileSync(scheduled.helperPath, 'utf8')
    expect(helper).toContain('restart helper')
    expect(helper).toContain('node:child_process')
    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.options).toMatchObject({ detached: true, stdio: 'ignore' })
    expect(spawned[0]!.args).toEqual([
      scheduled.helperPath,
      recipePath,
      resultPath,
      cancelPath,
      '4242',
      '5000',
    ])
    expect(isRestartCancelled(recipePath)).toBe(false)
  })

  it('reports failure instead of throwing when the helper cannot be written', () => {
    const notADir = join(dir, 'not-a-dir')
    writeFileSync(notADir, 'x')
    const scheduled = scheduleRestart({
      delayMs: 10,
      recipePath: join(dir, 'recipe.json'),
      resultPath: join(dir, 'result.json'),
      helperPath: join(notADir, 'sub', 'helper.cjs'),
      spawnFn: () => ({ pid: 1, unref: () => {} }),
    })
    expect(scheduled.ok).toBe(false)
    expect(scheduled.error).toBeDefined()
  })
})

describe('cancelRestart', () => {
  it('writes a marker the helper can see', () => {
    const home = join(dir, 'home')
    mkdirSync(home, { recursive: true })
    const recipePath = restartRecipePath(home)
    const marker = cancelRestart({ recipePath, now: () => 1_700_000_000_000 })
    expect(marker).toBe(restartCancelPath(recipePath))
    expect(isRestartCancelled(recipePath)).toBe(true)
    const body = JSON.parse(readFileSync(marker, 'utf8')) as { at: string }
    expect(body.at).toBe(new Date(1_700_000_000_000).toISOString())
  })
})

describe('restart helper process', () => {
  /** Write the helper (without spawning) into the sandbox. */
  function writeHelper(options: { recipePath: string; resultPath: string; parentPid: string; delayMs: string }): string {
    const helperPath = join(dir, 'helper.cjs')
    const scheduled = scheduleRestart({
      delayMs: Number(options.delayMs),
      recipePath: options.recipePath,
      resultPath: options.resultPath,
      helperPath,
      parentPid: Number(options.parentPid),
      spawnFn: () => ({ pid: 1, unref: () => {} }),
    })
    expect(scheduled.ok).toBe(true)
    return helperPath
  }

  /** Run the generated helper synchronously and return its result file. */
  function runHelper(helperPath: string, options: {
    recipePath: string
    resultPath: string
    cancelPath: string
    parentPid: string
    delayMs: string
  }): { status: number | null; result: Record<string, unknown> | undefined; stderr: string } {
    const child = spawnSync(process.execPath, [
      helperPath,
      options.recipePath,
      options.resultPath,
      options.cancelPath,
      options.parentPid,
      options.delayMs,
    ], { encoding: 'utf8', timeout: 20_000 })
    let result: Record<string, unknown> | undefined
    try {
      result = JSON.parse(readFileSync(options.resultPath, 'utf8')) as Record<string, unknown>
    } catch {
      result = undefined
    }
    return { status: child.status, result, stderr: child.stderr ?? '' }
  }

  it('relaunches once the old process is gone and reports ok', async () => {
    const launched = join(dir, 'launched.txt')
    const recipePath = join(dir, 'recipe.json')
    const script = `require('node:fs').writeFileSync(${JSON.stringify(launched)}, 'launched')`
    writeFileSync(recipePath, JSON.stringify({
      execPath: process.execPath,
      argv: [process.execPath, '-e', script],
      cwd: dir,
      env: {},
      at: new Date().toISOString(),
      pid: 1,
    }))
    const resultPath = join(dir, 'result.json')
    const helperPath = writeHelper({ recipePath, resultPath, parentPid: '2147483646', delayMs: '0' })

    const outcome = runHelper(helperPath, {
      recipePath,
      resultPath,
      cancelPath: restartCancelPath(recipePath),
      // A pid that cannot be alive: the helper launches immediately.
      parentPid: '2147483646',
      delayMs: '0',
    })

    expect(outcome.status).toBe(0)
    expect(outcome.result).toMatchObject({ ok: true })
    // The relaunch is detached, so the child's write lands just after the
    // helper exits: poll for the content, not for the file's existence.
    expect(await waitForFileContent(launched, 'launched')).toBe('launched')
  })

  it('does not relaunch when the cancel marker exists', async () => {
    const launched = join(dir, 'launched-cancelled.txt')
    const recipePath = join(dir, 'recipe.json')
    writeFileSync(recipePath, JSON.stringify({
      execPath: process.execPath,
      argv: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(launched)}, 'launched')`],
      cwd: dir,
      env: {},
      at: new Date().toISOString(),
      pid: 1,
    }))
    const resultPath = join(dir, 'result.json')
    const helperPath = writeHelper({ recipePath, resultPath, parentPid: '2147483646', delayMs: '0' })
    const cancelPath = restartCancelPath(recipePath)
    // Marker written after scheduling (scheduleRestart clears a stale one).
    writeFileSync(cancelPath, '{}')

    const outcome = runHelper(helperPath, {
      recipePath,
      resultPath,
      cancelPath,
      parentPid: '2147483646',
      delayMs: '0',
    })

    expect(outcome.status).toBe(0)
    expect(outcome.result).toMatchObject({ ok: false, cancelled: true })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(() => statSync(launched)).toThrow()
  })
})
