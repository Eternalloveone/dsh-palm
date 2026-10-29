# DSH 金丝雀（验证 dsh-palm 能在「最新 SDK」上真跑起来）

编译通过 ≠ 能跑起来。这里起一个**独立 DSH_HOME + 独立端口 3099**的宿主，装的是目标版本的
DSH（不是本机 checkout 的那份），专门用来验插件在新 SDK 上的启动与接口。

## 一条命令

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dsh-canary\start.ps1
```

脚本做四件事：写金丝雀 profile（只挂 base + web-app + dsh-palm）、预置一台已配对设备、
`dsh plugin --profile web install`、起宿主并等 `/m/` 返回 200。

前置（只需一次）：

```powershell
New-Item -ItemType Directory -Force D:\dsh-canary
cd D:\dsh-canary
'{"name":"dsh-canary","private":true}' | Set-Content -Encoding ascii package.json
npm install --no-audit --no-fund @deepseek-ai/dsh@<目标版本>
```

## 验收（宿主起着的时候跑）

```powershell
node tools\dsh-canary\probe-api.mjs       # 5 个手机端接口
node tools\dsh-canary\probe-session.mjs   # 建会话 + 读聊天/回合/收件箱
```

## 2026-10-29 实测（DSH 0.2.2-alpha.2 + dsh-palm 1.7.0）

| 检查 | 结果 |
|---|---|
| 宿主启动 | ✅ `dsh web: http://127.0.0.1:3099` |
| 插件加载 | ✅ `[dsh-palm] device store: 1 device(s)`、`依赖自检 … all ok` |
| `mobile.preferences` / `runningSessions` / `finishedRuns` / `workspace.list` / `session.list` | ✅ 5/5 |
| 新建会话后 `readChat` / `turnOutline` / `turnState` / `inbox` / `pending` | ✅ 5/5 |
| `mobile.sessionState` | ⚠️ 空会话返回 `unavailable` —— 与版本无关：新会话还没有日志，宿主侧 `readChatTailPage` 本来就返回 undefined |
| 日志里的 settings / mux 报错 | 无 |

## 两个 PowerShell 5.1 的坑（都踩过）

- `$HOME` 是只读自动变量：脚本里别用 `$Home`，否则路径会算成 `C:\Users\<用户>\profiles\web`；
- `Set-Content -Encoding utf8` 会写 BOM，宿主读 profile JSON 直接报错：用 `.NET` 的
  `UTF8Encoding($false)` 写无 BOM。
