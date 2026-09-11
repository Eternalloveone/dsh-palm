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

## DSH 升级时核对（每次 DSH 升级只需查这 4 处）

1. `src/api-proxy-adapter.ts` — 5 个 controller 服务名与方法签名（session / workspace / settings / agentPresets / subagents）
2. `src/index.ts` — `ctx.settings.installSection` 调用签名
3. `src/client/index.ts` — `SlotMap` 的 `sidebar.footer.action` shape + `package.json` 的 `dsh.client.inject` 列表
4. `package.json` — peer 版本带是否需放宽（`pnpm-workspace.yaml` 的 minimumReleaseAgeExclude 同步）

判定方式：`plugin-compat-check.mjs`（Docker 全装配 + HTTP 200 实测）；0.1.x 内小迭代大概率直接通过。
