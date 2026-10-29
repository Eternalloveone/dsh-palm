# 起 0.2.2-alpha.2 金丝雀宿主（独立 DSH_HOME + 独立端口 3099），验证 1.7.0 能不能在最新 SDK 上真跑起来。
# 注意（PowerShell 5.1 两个坑，之前踩过）：
#   · $HOME 是只读自动变量 —— 用 $CanaryHome，别用 $Home；
#   · Set-Content -Encoding utf8 会写 BOM，JSON 读不了 —— 用 .NET 写无 BOM UTF-8。
$ErrorActionPreference = 'Continue'
$Canary = 'D:\dsh-canary'
$CanaryHome = Join-Path $Canary 'home'
$ProfileDir = Join-Path $CanaryHome 'profiles\web'
$Log = Join-Path $Canary 'canary.log'
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

function W([string]$m) {
  $line = '[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m
  Write-Output $line
  Add-Content -Path $Log -Value $line -Encoding UTF8
}
function WriteJson([string]$path, [string]$text) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8)
}

$profileJson = '{
  "name": "dsh-profile-canary",
  "private": true,
  "dependencies": {
    "@deepseek-ai/dsh-settings": "0.2.2-alpha.2",
    "@eternalloveone/dsh-palm": "link:C:/Users/Administrator/dsh-source/dsh-palm/packages/dsh-palm"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@eternalloveone/dsh-palm"
      ]
    }
  }
}
'
WriteJson (Join-Path $ProfileDir 'package.json') $profileJson
W "profile: $ProfileDir\package.json"

$deviceId = 'canary0000000000000000000000000000'
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$devices = '{"' + $deviceId + '":{"createdAt":' + $now + ',"lastSeenAt":' + $now + ',"userAgent":"canary-probe","primary":true}}'
WriteJson (Join-Path $CanaryHome 'dsh-palm-devices.json') $devices
W "预置设备: $deviceId"

$env:DSH_HOME = $CanaryHome
$env:NO_COLOR = '1'
$bin = Join-Path $Canary 'node_modules\@deepseek-ai\dsh\lib\bin.js'
W "DSH_HOME=$CanaryHome"

$out = Join-Path $Canary 'canary.out.log'
$err = Join-Path $Canary 'canary.err.log'
Remove-Item $out, $err -ErrorAction SilentlyContinue
$p = Start-Process -FilePath 'node' -ArgumentList @($bin, '--profile', 'web', '--port', '3099', '--no-open') -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
W "pid=$($p.Id)"

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  if ($p.HasExited) { W "进程已退出 code=$($p.ExitCode)"; break }
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3099/m/' -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ready = $true; W "宿主就绪 用时约$($i*2)s"; break }
  } catch { }
}
W ('READY=' + $ready)
W '--- stdout 尾部 ---'
if (Test-Path $out) { Get-Content $out -Tail 25 | ForEach-Object { W $_ } }
W '--- stderr 尾部 ---'
if (Test-Path $err) { Get-Content $err -Tail 15 | ForEach-Object { W $_ } }
