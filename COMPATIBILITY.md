# dsh-palm × DSH 版本兼容表

## 兼容矩阵

| dsh-palm 版本 | 兼容的 DSH 版本 | 验证状态 | 运行时契约命名 | 配对设备是否沿用 | 备注 |
|---|---|---|---|---|---|
| v0.4.2 – v1.2.0 | **0.1.1-rc.1**（0.1.1-rc 线） | ✅ 发布时实测 | `remote-web-ui` | 是 | 0.1.5 及以后需升级到 v1.3.0（旧 API 已移除） |
| **v1.3.0**（当前） | **0.1.5-rc.1 – 0.1.5-rc.2**（0.1.5-rc 线） | ✅ 在 rc.2 上实测（typecheck 0 错 + build + 测试 940/950） | `dsh-palm` | **否** — 升级后需重新扫码配对一次 | 与 dsh-remote-web-ui / dsh-webui 命名与依赖解耦 |

（未来每个新版本往下加一行；本表为权威版本对应，`package.json` 的 `peerDependencies` / `dsh.engines.dsh` 为机器可读声明。）

## 版本带说明

| 声明 | v1.3.0 值 |
|---|---|
| `dsh.engines.dsh` | `>=0.1.5-rc.1` |
| peer `@deepseek-ai/cordis` | `>=4.0.1 <5` |
| peer `@deepseek-ai/dsh-client-ui-slots` | `>=0.1.5-rc.1 <0.1.6-0`（仅类型） |
| peer `@deepseek-ai/dsh-settings` | `>=0.1.5-rc.1 <0.1.6-0` |
| peer `react` / `react-dom` | `^18.2.0` |
| devDeps（编译期） | 全部 `@deepseek-ai/*` @ `0.1.5-rc.2` |

> 为什么是 `0.1.5-rc.1` 起？0.1.5 拆掉了 `dsh-client-runtime`、`dsh-host-apiproxy`，重写了 `dsh-settings` 的 `installSection` 模型，且 0.1.5-rc.1 与 rc.2 之间 API 无破坏性变化（已实测），故取 `>=0.1.5-rc.1 <0.1.6-0` 兼容整个 0.1.5-rc 线。

## 运行环境要求（v1.3.0）

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | `^22.19.0 \|\| >=24.0.0`（`engines`） | 构建/独立运行；DSH 装配环境已满足 |
| 包管理器 | `pnpm@11.7.0`（`packageManager`） | 构建约定 |
| DSH 装配 | web profile（`cordis.patch.yml` 插入插件行） | dsh-palm 宿主半运行在 DSH 进程内 |
| 桌面 GUI | 必须提供 `sidebar.footer.action` seat（dsh-webui 系 UI） | client 半的桌面配对入口挂在该槽位；依赖 GUI 的 `window.__ModuleLoader__` 装载 |
| 手机端浏览器 | 现代浏览器：PWA 需 HTTPS；Web Push 需 Android Chrome/Edge/Firefox 或 iOS Safari 16.4+ installed PWA | `/m/` 端到端要求 |
| 公网/隧道入口 | Tailscale / Cloudflare Tunnel / FRP 任一（可选） | 手机不在同一局域网时的配对与访问 |

## 插件/组件依赖（v1.3.0）

### host 半（DSH 进程内，注入的服务）
| 服务（`ctx` inject） | 提供包 |
|---|---|
| `webServer` | `@deepseek-ai/dsh-host-webserver`（peer 仅类型） |
| `sessionController` / `workspaceController` / `settingsController` | `@deepseek-ai/dsh-api-session-controller` / `dsh-api-workspace-controller` / `dsh-api-settings-controller` |
| `agentPresets` | `@deepseek-ai/dsh-agent-presets` |
| `subagents` | `@deepseek-ai/dsh-subagent` |

### client 半（浏览器半，`dsh.client.inject` 服务提供者）
`dsh-api-remotes`、`dsh-client-connection`、`dsh-client-locale`、`dsh-client-ui-renderer`、`dsh-client-ui-settings`
（运行时由 DSH shell 装配注入；dsh-palm 代码仅以结构化类型访问，不静态依赖）

### 官方 peer 依赖
`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-ui-slots`（类型）、`@deepseek-ai/dsh-settings`、`react`、`react-dom`

### 自有运行时依赖（与 DSH 无关）
`clsx`、`qrcode.react`（配对二维码）、`schemastery`（配置 schema）、`web-push`（L2 通知）、`zod`

### 可选外部通道（通知/入口，非依赖）
Bark / Telegram / Server酱（L3 通知）、FCM（Web Push 后端）、Tailscale / Cloudflare Tunnel / FRP（入口）

### 备注
- `mobile/` 半：**零** `@deepseek-ai` 依赖，纯自有 `/m/api` + SSE 契约。
- 配对持久化：`$DSH_HOME/dsh-palm-devices.json`；settings 段 `dsh-palm`（`settings.yaml`）。
- 与 dsh-remote-web-ui 的关系：**无**包依赖；仅 README/NOTICE 保留 Apache 衍生署名。

## DSH 升级时核对（每次 DSH 升级只需查这 4 处）

1. `src/api-proxy-adapter.ts` — 5 个 controller 服务名与方法签名（session / workspace / settings / agentPresets / subagents）
2. `src/index.ts` — `ctx.settings.installSection` 调用签名
3. `src/client/index.ts` — `SlotMap` 的 `sidebar.footer.action` shape + `package.json` 的 `dsh.client.inject` 列表
4. `package.json` — peer 版本带是否需放宽（`pnpm-workspace.yaml` 的 minimumReleaseAgeExclude 同步）

判定方式：`plugin-compat-check.mjs`（Docker 全装配 + HTTP 200 实测）；0.1.x 内小迭代大概率直接通过。
