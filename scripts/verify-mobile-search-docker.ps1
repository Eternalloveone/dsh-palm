#!/usr/bin/env pwsh
# 在 Docker 里跑手机搜索的端到端用例：真 HTTP 服务 + 真配对门禁 + 真 node:sqlite 索引。
# 用途是"换一个 Node 版本再验一遍"：容器里只用 pnpm 装 vitest + zod，源码挂只读进去，
# 不依赖宿主已装的 node_modules（那是 Windows 上的二进制，Linux 里跑不了）。
#
#   pwsh -File scripts/verify-mobile-search-docker.ps1
#
# 通过时最后一段是 `Tests  N passed`；退出码沿用 vitest 的。

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root 'packages/dsh-palm/src'
if (-not (Test-Path (Join-Path $srcDir 'mobile-search-e2e.test.ts'))) {
  throw '找不到 packages/dsh-palm/src/mobile-search-e2e.test.ts：这个脚本要在仓库里跑'
}

$tmpRoot = [IO.Path]::GetTempPath()
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$cfgDir = Join-Path $tmpRoot ('dsh-palm-search-e2e-' + $suffix)
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null

$config = @'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: '/app',
  test: {
    include: ['src/mobile-search-e2e.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ['default'],
  },
})
'@
$runner = @'
set -e
mkdir -p /app/src /tools
cp -a /src/. /app/src/
printf '{"name":"dsh-palm-e2e","version":"0.0.0","private":true,"type":"module"}\n' > /app/package.json
cd /tools
printf '{"name":"tools","private":true,"type":"module"}\n' > package.json
corepack enable >/dev/null 2>&1 || true
pnpm add vitest@4.1.8 zod 2>&1 | tail -1
ln -sfn /tools/node_modules /app/node_modules
cp /cfg/vitest.e2e.config.mjs /tools/vitest.e2e.config.mjs
node -e "const s=require('node:sqlite');const db=new s.DatabaseSync(':memory:');console.log('node', process.version, '| sqlite', db.prepare('select sqlite_version() v').get().v)"
cd /app
/tools/node_modules/.bin/vitest run --config /tools/vitest.e2e.config.mjs 2>&1 | tail -25
'@

[IO.File]::WriteAllText((Join-Path $cfgDir 'vitest.e2e.config.mjs'), ($config -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))
[IO.File]::WriteAllText((Join-Path $cfgDir 'run.sh'), ($runner -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))

$status = 1
try {
  docker run --rm -v "${srcDir}:/src:ro" -v "${cfgDir}:/cfg:ro" node:22-bookworm bash /cfg/run.sh
  $status = $LASTEXITCODE
} finally {
  Remove-Item -Recurse -Force $cfgDir -ErrorAction SilentlyContinue
}
exit $status
