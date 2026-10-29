#!/usr/bin/env node
/**
 * Local equivalent of CI's `gitleaks` step.
 *
 * 为什么需要它：`ci.yml` 的 `release-preflight` 用 gitleaks 扫密钥，而本地
 * `pnpm verify --ci` 里**没有**这一步 —— 于是「本地 8/8 全绿、push 上去 CI 红」
 * 是必然的盲区。2026-10-29 就真撞上一次：一个名字以 KEY 结尾的 localStorage 常量
 * （值是 `dsh-palm.finished-runs.v1`）被 gitleaks 的 generic-api-key 规则判成泄露的密钥，
 * 发布前的 dry-run PR 才暴露出来。
 *
 * 注意：本文件开头这类说明也不要写成「标识符 = 字符串字面量」的形状 ——
 * gitleaks 不看注释，照样会判成 finding（这一条自己踩过一次）。
 *
 * 两种模式：
 *   1. 有 gitleaks：直接调它扫工作区（`gitleaks dir` 新语法，旧版本退回 `detect --no-git`）。
 *   2. 没有 gitleaks：用内置规则兜底 —— 高置信度模式（真凭据前缀/私钥/JWT）
 *      直接失败；「名字像密钥但值是普通字符串」只报**警告**（就是上面那个误报类别，
 *      gitleaks 会拦它，所以本地也要提醒，但不该因此挡住无关的提交）。
 *
 * 零依赖、不 import DSH：DSH 升级不会影响它。
 *
 * 用法：
 *   node scripts/secrets-scan.mjs            # 扫工作区
 *   node scripts/secrets-scan.mjs --staged   # 只扫暂存区（pre-commit 用）
 *   node scripts/secrets-scan.mjs --quiet
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const rootDir = resolve(packageDir, '..', '..')

const argv = process.argv.slice(2)
const stagedOnly = argv.includes('--staged')
const quiet = argv.includes('--quiet')

/** 高置信度：命中就是真凭据，必须失败。 */
const HARD_RULES = [
  { name: 'openai/deepseek key', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'opencode/go key', re: /\boc_sk_[A-Za-z0-9_-]{10,}/ },
  { name: 'github token', re: /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { name: 'aws access key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'google api key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'private key block', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
]

/**
 * 软规则：gitleaks 的 generic-api-key 就是这一类（名字带 KEY/TOKEN/SECRET 且赋了字符串）。
 * 报出来是为了不重演那次误报，但**不判失败** —— 绝大多数是 localStorage 名字、常量表 key。
 */
const SOFT_RULE = /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z0-9_]*)\s*[:=]\s*['"`]([^'"`\n]{6,})['"`]/

/**
 * 这个「名字像密钥」的赋值到底要不要提醒？
 *
 * 校准过一次：gitleaks 真拦下来的那个值是 `dsh-palm.finished-runs.v1` ——
 * **带点、带连字符、带数字、26 个字符**；而仓库里 `dsh.palm.fontScale`、
 * `dsh.remote.theme` 这类短名字它没拦（generic-api-key 有长度/熵门槛）。
 * 所以判据不是「有没有点」，而是「够长且混合了分隔符与数字」。
 */
function worthWarning(value) {
  if (/^(true|false|null|undefined)$/i.test(value)) return false
  if (/^[\d.]+$/.test(value)) return false
  if (value.length < 16) return false
  if (!/[0-9]/.test(value)) return false
  return /[-._:/]/.test(value)
}

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.toml', '.txt', '.ps1', '.sh', '.css',
])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'lib', 'coverage', '.turbo'])

function hasGitleaks() {
  const probe = spawnSync('gitleaks', ['version'], { stdio: 'ignore' })
  return probe.status === 0
}

function runGitleaks() {
  const common = ['--no-banner', '--redact', '--exit-code', '1']
  // v8.19+ 用 `dir`，更早只有 `detect --source … --no-git`。
  const modern = spawnSync('gitleaks', ['dir', '.', '-v', ...common], { cwd: rootDir, stdio: 'inherit' })
  if (modern.status === 0 || modern.status === 1) return modern.status === 0
  const legacy = spawnSync('gitleaks', ['detect', '--source', '.', '--no-git', '-v', ...common],
    { cwd: rootDir, stdio: 'inherit' })
  return legacy.status === 0
}

function listFiles() {
  if (stagedOnly) {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
      cwd: rootDir, encoding: 'utf8',
    })
    return out.split('\n').map(line => line.trim()).filter(Boolean).map(file => join(rootDir, file))
  }
  const out = execFileSync('git', ['ls-files'], { cwd: rootDir, encoding: 'utf8' })
  return out.split('\n').map(line => line.trim()).filter(Boolean).map(file => join(rootDir, file))
}

function scanBuiltin() {
  const hard = []
  const soft = []
  const files = listFiles()
  for (const file of files) {
    const lower = file.toLowerCase()
    const dot = lower.lastIndexOf('.')
    if (dot < 0 || !TEXT_EXT.has(lower.slice(dot))) continue
    if (lower.split(/[\\/]/).some(seg => SKIP_DIRS.has(seg))) continue
    let size = 0
    try {
      size = statSync(file).size
    } catch {
      continue
    }
    if (size > 2 * 1024 * 1024) continue
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (const [index, line] of lines.entries()) {
      if (line.includes('gitleaks:allow')) continue
      // 注释里举的例子不算（本条规则就是被自己写的说明先绊了一次）：
      // 命中位置落在 `//` 之后或整行是 `*` 的注释行时跳过。
      const commentAt = line.indexOf('//')
      const isCommentLine = /^\s*(\/\/|\*|\/\*)/.test(line)
      for (const rule of HARD_RULES) {
        if (isCommentLine) break
        const match = rule.re.exec(line)
        if (match !== null && (commentAt < 0 || match.index < commentAt)) hard.push({ file: relative(rootDir, file), line: index + 1, rule: rule.name, hit: match[0].slice(0, 12) + '…' })
      }
      const softMatch = isCommentLine ? null : SOFT_RULE.exec(line)
      if (softMatch !== null && (commentAt < 0 || softMatch.index < commentAt) && worthWarning(softMatch[2])) {
        soft.push({ file: relative(rootDir, file), line: index + 1, rule: 'generic-api-key', hit: `${softMatch[1]} = "${softMatch[2].slice(0, 18)}"` })
      }
    }
  }
  return { hard, soft, files: files.length }
}

if (hasGitleaks()) {
  if (!quiet) process.stdout.write('[secrets] 用本机 gitleaks 扫描工作区\n')
  const ok = runGitleaks()
  if (!ok) {
    process.stderr.write('[secrets] FAIL - gitleaks 认为有泄露（见上面的 finding）\n')
    process.stderr.write('[secrets] 误报可在该行加注释 `//gitleaks:allow`，或给常量换个不叫 *_KEY 的名字\n')
    process.exit(1)
  }
  process.stdout.write('[secrets] PASS - gitleaks 无 finding\n')
  process.exit(0)
}

const { hard, soft, files } = scanBuiltin()
if (!quiet) process.stdout.write(`[secrets] 本机没有 gitleaks，用内置规则扫了 ${files} 个文件\n`)

if (soft.length > 0) {
  process.stderr.write(`[secrets] 警告：${soft.length} 处「名字像密钥 + 字符串字面量」——CI 的 gitleaks 很可能拦这些：\n`)
  for (const item of soft.slice(0, 20)) {
    process.stderr.write(`  ${item.file}:${item.line}  ${item.hit}\n`)
  }
  process.stderr.write('[secrets] 处理方式：把常量改成不叫 *_KEY 的名字，或在该行加 `//gitleaks:allow`\n')
}

if (hard.length > 0) {
  process.stderr.write(`[secrets] FAIL - ${hard.length} 处高置信度凭据：\n`)
  for (const item of hard.slice(0, 30)) {
    process.stderr.write(`  ${item.file}:${item.line}  ${item.rule}  ${item.hit}\n`)
  }
  process.exit(1)
}

process.stdout.write(`[secrets] PASS - 无高置信度凭据${soft.length > 0 ? `（但有 ${soft.length} 处待确认警告）` : ''}\n`)
