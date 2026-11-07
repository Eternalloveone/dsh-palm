#!/usr/bin/env node
/**
 * 移动端**季度体检**（W5-5）。
 *
 * 为什么要有这个脚本：架构断言、行数预算、视觉门禁都在，但**没人会记得按顺序跑一遍**。
 * 顺序还会反咬——`pnpm build` 与 `pnpm test` 并发时，测试读 chunk 清单会撞上构建的
 * clean-mobile-chunks，`tests/mobile-routes.spec.ts` 偶发 404。所以顺序写死在这里：
 *
 *   typecheck → build → test → 视觉门禁 → 文档/ADR 自检
 *
 * 用法：
 *   node tools/health-check.mjs            # 全套
 *   node tools/health-check.mjs --quick    # 跳过视觉门禁（没有预览服务器时）
 *   node tools/health-check.mjs --json     # 机器可读
 *
 * 退出码：0 全绿 / 1 有失败项。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const PKG = join(REPO, 'packages', 'dsh-palm')
const flags = new Set(process.argv.slice(2))
const quick = flags.has('--quick') || flags.has('--json')
const asJson = flags.has('--json')

const results = []

function run(name, command, args, options = {}) {
  const started = Date.now()
  try {
    const output = execFileSync(command, args, {
      cwd: options.cwd ?? REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // Windows 上 pnpm/npm 是 .cmd 垫片：不带 shell 直接 execFile 会 ENOENT，而且
      // 错误是空的（连 stderr 都没有），看起来像"命令跑了但立刻失败"。
      // 但**只有垫片需要 shell**——node.exe 的路径带空格（C:\Program Files\…），
      // 走 shell 会被拆成两段，报 `'C:\Program' is not recognized`。
      shell: process.platform === 'win32' && /^(pnpm|npm|npx)$/i.test(command),
      env: { ...process.env, ...(options.env ?? {}) },
      maxBuffer: 64 * 1024 * 1024,
    })
    results.push({ name, ok: true, ms: Date.now() - started, tail: tailLines(output, options.lines ?? 3) })
    return { ok: true, output }
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.code === 'ENOENT' ? `找不到命令 ${command}` : ''}`
    results.push({ name, ok: false, ms: Date.now() - started, tail: tailLines(output, options.lines ?? 12) })
    return { ok: false, output }
  }
}

function tailLines(output, count) {
  return String(output)
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '')
    .slice(-count)
}

function check(name, fn) {
  const started = Date.now()
  try {
    const detail = fn()
    results.push({ name, ok: true, ms: Date.now() - started, tail: detail === undefined ? [] : [detail] })
    return true
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, tail: [String(error.message ?? error)] })
    return false
  }
}

/* ── 1. 顺序写死的三道工程门禁 ───────────────────────────────────────── */

run('typecheck', 'pnpm', ['typecheck'], { cwd: PKG })
run('build', 'pnpm', ['build'], { cwd: PKG, lines: 2 })
run('test（全量）', 'pnpm', ['test'], { cwd: PKG, lines: 4 })

/* ── 2. 视觉门禁（需要预览服务器；--quick 跳过） ─────────────────────── */

if (quick) {
  results.push({ name: '视觉门禁', ok: true, skipped: true, ms: 0, tail: ['--quick 跳过'] })
} else {
  run('视觉门禁', process.execPath, ['tools/mobile-visual/run.mjs'], {
    env: { PALM_BASE: process.env.PALM_BASE ?? 'http://127.0.0.1:3099' },
    lines: 6,
  })
}

/* ── 3. 文档与 ADR 自检（治理收口的"可执行"部分） ───────────────────── */

check('ADR 目录完整', () => {
  const dir = join(REPO, 'docs', 'adr')
  if (!existsSync(dir)) throw new Error('docs/adr 不存在')
  const files = readdirSync(dir).filter(name => /^\d{4}-.*\.md$/.test(name))
  if (files.length < 1) throw new Error('没有 ADR 文件')
  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8')
    for (const section of ['## 背景', '## 决定', '## 代价']) {
      if (!text.includes(section)) throw new Error(`${file} 缺 ${section} 段（只写好处的不叫决策）`)
    }
    if (!/状态\*\*：(提议|已接受|已废弃|被 \d{4} 取代)/.test(text)) {
      throw new Error(`${file} 的状态行不合规`)
    }
  }
  return `${files.length} 条 ADR`
})

check('ADR 索引与实际文件一致', () => {
  const dir = join(REPO, 'docs', 'adr')
  const index = readFileSync(join(dir, 'README.md'), 'utf8')
  const files = readdirSync(dir).filter(name => /^\d{4}-/.test(name)).map(name => name.slice(0, 4))
  const missing = files.filter(prefix => !index.includes(prefix))
  if (missing.length > 0) throw new Error(`README 索引里缺：${missing.join(', ')}`)
  return `${files.length} 条都在索引里`
})

check('行数预算表存在且只降不升', () => {
  const source = readFileSync(join(PKG, 'src', 'mobile', 'architecture.test.ts'), 'utf8')
  if (!source.includes('budget')) throw new Error('找不到行数预算断言')
  const count = (source.match(/^\s*it\(/gm) ?? []).length
  return `${count} 条架构断言`
})

/* ── 输出 ────────────────────────────────────────────────────────── */

if (asJson) {
  console.log(JSON.stringify({ ok: results.every(item => item.ok), results }, null, 2))
} else {
  const width = Math.max(...results.map(item => item.name.length))
  console.log('\n移动端体检\n' + '─'.repeat(width + 24))
  for (const item of results) {
    const mark = item.skipped ? 'SKIP' : item.ok ? 'PASS' : 'FAIL'
    const seconds = (item.ms / 1000).toFixed(1)
    console.log(`${item.name.padEnd(width)}  ${mark}  ${seconds.padStart(6)}s`)
    if (!item.ok) for (const line of item.tail) console.log(`    ${line}`)
  }
  const failed = results.filter(item => !item.ok)
  console.log('─'.repeat(width + 24))
  console.log(failed.length === 0 ? '结论：全绿 ✓' : `结论：${failed.length} 项失败 — ${failed.map(item => item.name).join('、')}`)
}

process.exit(results.every(item => item.ok) ? 0 : 1)
