#!/usr/bin/env node
/**
 * SDK 适配矩阵：在容器里按目标 DSH 版本重装 `@deepseek-ai/dsh-*`，再跑 `tsc` + 全量单测。
 *
 * 为什么需要它：插件是对着**某个版本的 SDK 类型**编译的，宿主升级后「运行时能跑」不代表
 * 「源码还能编」。这个脚本把「换 SDK → 编译 → 单测」固化成一条命令，宿主每次发版跑一遍，
 * 就知道要改哪几处。
 *
 * 用法：
 *   node scripts/adapt-matrix.mjs                 # 默认跑推荐矩阵
 *   node scripts/adapt-matrix.mjs 0.2.2-alpha.2   # 只跑一个版本
 *   node scripts/adapt-matrix.mjs --no-docker     # 只打印要执行的命令
 *
 * 依赖 docker（远程仓库脚本 `docker-adapt-check.sh` 与本文件同仓根目录）。
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../..')
const image = process.env.DSH_ADAPT_IMAGE ?? 'node:22-bookworm'
const DEFAULT_MATRIX = ['0.2.2-alpha.2', '0.2.1-rc.4', '0.2.1-rc.2', '0.1.5-rc.2']

const argv = process.argv.slice(2)
const dryRun = argv.includes('--no-docker')
const versions = argv.filter(arg => !arg.startsWith('-'))
const matrix = versions.length > 0 ? versions : DEFAULT_MATRIX

if (!dryRun) {
  const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' })
  if (probe.status !== 0) {
    console.error('[adapt] docker 不可用。先启动 Docker Desktop，或用 --no-docker 只看命令。')
    console.error(probe.stderr?.trim().split('\n').slice(-2).join(' '))
    process.exit(1)
  }
  console.log(`[adapt] docker ${probe.stdout.trim()} · 镜像 ${image} · 仓库 ${repoRoot}`)
}

let failed = 0
for (const version of matrix) {
  const command = [
    'docker', 'run', '--rm',
    '-v', `${repoRoot}:/repo:ro`,
    '-v', 'dsh-palm-npm:/root/.npm',
    image,
    'bash', '/repo/docker-adapt-check.sh', version,
  ]
  if (dryRun) {
    console.log(command.join(' '))
    continue
  }
  console.log(`\n########## ${version} ##########`)
  const run = spawnSync(command[0], command.slice(1), { stdio: 'inherit' })
  if (run.status !== 0) {
    failed += 1
    console.log(`[adapt] ${version} 失败（退出码 ${run.status}）`)
  }
}

if (!dryRun) {
  console.log(failed === 0
    ? `\n[adapt] 全部通过：${matrix.join(' / ')}`
    : `\n[adapt] ${failed}/${matrix.length} 个版本失败`)
}
process.exit(failed === 0 ? 0 : 1)
