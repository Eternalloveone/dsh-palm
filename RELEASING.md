# 发布清单（dsh-palm）

一版一提交：一个版本的所有改动收在一个 `release: vX.Y.Z` 提交里，tag 打在这个提交上。
下面按顺序做，任何一关红了就停，不要往下走。

## 0. 开工前确认

| 检查 | 命令 | 期望 |
|---|---|---|
| 工作区干净 | `git status --short` | 空 |
| 分支与远端同步 | `git fetch && git status -sb` | `main...origin/main`，无 ahead/behind |
| 版本号 | `node -p "require('./packages/dsh-palm/package.json').version"` | 与要发的号一致 |
| 上一版 tag | `git tag --list "v*" | tail -3` | 上一版在，便于写 changelog |

## 1. 文档归位

| 文件 | 要动什么 |
|---|---|
| `CHANGELOG.md` | `## [Unreleased]` 全部并入新版小节；标题写 `## [X.Y.Z] - YYYY-MM-DD`；Unreleased 留空并写「暂无」；底部补 `[X.Y.Z]:` 链接 |
| `COMPATIBILITY.md` | 兼容矩阵加一行（含实测证据与退化说明）；「版本带说明」换成新版的值；引擎/peer 与实际一致 |
| `README.md` / `README.zh-CN.md` | 特性列表、验收入口、破坏性变更（若有） |
| `packages/dsh-palm/package.json` | `version`、`dsh.engines.dsh`、`peerDependencies` 一处都不能漏 |
| 工具 README | `tools/mobile-verify/README.md`、`tools/dsh-canary/README.md` 的实测结论与当前版本对齐 |

## 2. 五道硬门禁（全绿才能继续）

```powershell
# ① 类型 + 单测 + 构建
cd packages\dsh-palm
pnpm typecheck
pnpm test
pnpm build

# ② 手机端验收（41 条，真宿主 + 真浏览器）
pnpm verify:mobile

# ③ SDK 适配矩阵（容器里逐版本重装 SDK 再编译+单测）
pnpm verify:adapt

# ④ 金丝雀真跑（独立 HOME + 3099，验证"能跑起来"而不只是"能编译"）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dsh-canary\start.ps1
node tools\dsh-canary\probe-api.mjs
node tools\dsh-canary\probe-session.mjs
# 跑完把金丝雀进程停掉，别长期占端口

# ⑤ 官方门禁（install/build/coverage/typecheck/audit/hygiene/secrets/pack/commitlint）
pnpm verify --ci

# ⑥ 密钥扫描（已并入 ⑤，单独跑一次也是一行）
pnpm verify:secrets
```

## 3. 打包自检

```powershell
cd packages\dsh-palm
npm pack --dry-run
```

要确认的三件事：

1. `lib/**/*.js`、`lib/**/*.d.ts`、`assets/`、`src/`（不含测试）在包里；
2. 测试文件、`tools/`、探针脚本**不在**包里；
3. 包大小与上一版同量级（`lib/mobile.js` 约 600 KB 属正常）。

## 4. 提交与打 tag

```powershell
# 一个版本一个提交
git add -A
git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "dsh-palm X.Y.Z：<一句话概括>"
```

## 5. 发布

```powershell
cd packages\dsh-palm
npm publish            # 先确认已 npm login 且 2FA 可用
git push origin main --follow-tags
```

发布后立刻验：

```powershell
npm view @eternalloveone/dsh-palm version          # 应等于新号
npm view @eternalloveone/dsh-palm peerDependencies # 应是新版声明
```

## 6. 发布后回归（用已发布的包，不是本地链接）

```powershell
# 在正式宿主的 profile 里把依赖从 link 改成版本号，重新安装，重启，再跑一次 sweep
# tools\dsh-canary\start.ps1 也可以指向已发布版本，验证 npm 包本身能加载
```

## 7. 回滚

| 情况 | 动作 |
|---|---|
| 刚 publish 就发现严重问题 | `npm deprecate @eternalloveone/dsh-palm@X.Y.Z "原因，请用 X.Y.(Z-1)"`（npm 不允许删版本，只能弃用） |
| 宿主升级后表现为「插件整块消失」 | 先用 `dsh plugin allow-version` 给精确豁免兜底，再发补丁版 |
| 手机端行为异常 | 让用户看 `设置 → 关于` 里的构建号，比对宿主 `/m/` 里的 `?v=`，先排除「跑的是旧包」 |

## 8. 常见坑（都踩过）

| 坑 | 现象 | 处理 |
|---|---|---|
| PowerShell 5.1 写 UTF-8 带 BOM | 宿主读 profile/JSON 直接 `SyntaxError: Unexpected token '﻿'` | 用 `.NET` 的 `UTF8Encoding($false)`，或本仓 `write`/`edit` 工具 |
| `$HOME` 是只读 | 脚本里 `$Home = ...` 报错，路径算成 `C:\Users\<用户>\profiles\web` | 换变量名 |
| 宿主编译产物不重载 | 改了 host 侧代码但手机行为没变 | 宿主侧改动必须重启 dsh；手机侧改动刷新页面即可 |
| 本地门禁全绿、CI 却红 | `pnpm verify` 原来**不含** gitleaks，而 CI 的 `release-preflight` 会用
它扫密钥；一个「名字带 `_KEY` 的 localStorage 常量」被判成泄露的密钥，本地 8/8 全绿，
push 之后 CI 直接红（2026-10-29 实测） | 现在 `pnpm verify --ci` 第 7 步就是
`secret scan (gitleaks / builtin)`：有 gitleaks 就用它，没有就内置规则兜底
（高置信度凭据判失败；「名字像密钥」只提醒）。误报在该行加 `//gitleaks:allow` |
| 重启脚本会把验证脚本一起杀掉 | `restart-dsh.ps1` 结束整棵进程树，挂在它下面的
「重启后自动复验」脚本会在 `stopping DSH pids: …` 处直接消失（日志只有半截） | 重启与复验**分开**：
先让用户/独立进程触发重启，重启完成后再由当前会话手动跑探针与验收 |
| 手机开着旧包 | 代码已修、手机还是老行为 | `build-refresh` 会自动换一次（可见时 5 分钟/切前台/联网）；也可手动彻底刷新 |
| 验收脚本自己时好时坏 | 同一用例间歇性失败 | 先怀疑用例（滚动位置、cookie 值、Playwright 自动滚动），别急着放宽阈值 |
