# dsh-palm × DSH 版本兼容表

## 兼容矩阵

| dsh-palm 版本 | 兼容的 DSH 版本 | 验证状态 | 运行时契约命名 | 配对设备是否沿用 | 备注 |
|---|---|---|---|---|---|
| v0.4.2 – v1.2.0 | **0.1.1-rc.1**（0.1.1-rc 线） | ✅ 发布时实测 | `remote-web-ui` | 是 | 0.1.5 及以后需升级到 v1.3.0（旧 API 已移除） |
| v1.3.0 – v1.5.2 | **0.1.5-rc.1 – 0.1.7-rc.1**（0.1.5-rc 线与 0.1.7 线） | ✅ 实测：0.1.5-rc.2（typecheck 0 错 + build + 测试 1156/1165）、0.1.5-rc.3 与 0.1.7-rc.1（容器矩阵 PASS：11 契约 + 真配对 + host-rpc + mux-stream；**生产实跑 0.1.7-rc.1**：21 个设置命名空间（含 palm/see-image/subagent-model）、GUI 门禁 5/5 PASS、`/m/`→200、`/api/pair/status`→200、未激活 0 与 disabling 0） | `dsh-palm` | **否** — 升级后需重新扫码配对一次 | 与 dsh-remote-web-ui / dsh-webui 命名与依赖解耦；0.1.7 线仅需放宽 peer 上界（0.1.6 起新增插件版本门，声明窄会被直接跳过）；在 0.1.7-rc.1 上手机端权限面板缺失（见下行 v1.5.3） |
| v1.5.3 | **0.1.5-rc.1 – 0.1.7-rc.1**（同上） | ✅ 实测：0.1.7-rc.1 生产过程（`mobile.readChat` 的 `projections.values.permissions` 已带 `options`、手机端权限胶囊与权限面板恢复；本地门禁 8/8 PASS、1188 测试通过 / 9 跳过） | `dsh-palm` | **否** — 同上一行，升级后需重新扫码配对一次 | 0.1.7-rc.1 起 `permissions` 投影的 wire 收窄为 `{currentValue}`（选项搬到进程级 `permissionPresets.catalog()`）：**v1.5.2 及以前手机端权限胶囊与权限面板整块不渲染**（桌面端正常、两端都不报错），v1.5.3 起在宿主侧补挂进程目录恢复 |
| v1.5.4 | **0.1.5-rc.1 – 0.2.0-rc.2**（0.1.5-rc 线、0.1.7 线与 0.2.0 线） | ✅ 实测：0.2.0-rc.2 容器矩阵（改前 BOOT-FAIL —— 版本门读 peer 把整包跳过；改后 install ok + boot yes + 11 契约全 ok + 真配对，80s PASS）；0.1.7-rc.1 生产实跑沿用 v1.5.3 结论（本地门禁 8/8 PASS、1188 测试通过 / 9 跳过） | `dsh-palm` | **否** — 同上一行，升级后需重新扫码配对一次 | 0.2.0 线仅需放宽 peer 上界（`<0.1.8-0` → `<0.2.1-0`），**运行时零改动**；0.2.0 把自动化任务移到可选插件包，未装时「任务完成/失败」推送不触发（功能层，不是故障）；应急可在 0.2.0 上用 `dsh plugin allow-version` 给旧版本开精确豁免 |
| **v1.6.0**（当前） | **0.1.5-rc.1 – 0.2.1-rc.2**（0.1.5-rc 线、0.1.7 线、0.2.0 线与 0.2.1 线） | ✅ 实测：本地门禁 8/8 PASS（install / build / coverage / typecheck / audit / hygiene / pack / commitlint）、1227 测试通过 / 9 跳过、构建出 618100 B 的 mobile bundle；**0.2.1-rc.2 容器矩阵实测 PASS**（2026-10-18，162s：install ok + boot yes + 11 契约全 ok + 真配对成功）；0.2.1-alpha.2 上放宽上界后探针 PASS | `dsh-palm` | **否** — 同上一行，升级后需重新扫码配对一次 | 本轮新增手机端步骤时间线与回合尾报告；peer 上界 `<0.2.1-0` → `<0.2.2-0`，运行时零改动 |

（本表为权威版本对应，`package.json` 的 `peerDependencies` / `dsh.engines.dsh` 为机器可读声明。**同一版本带内、运行时契约未变的版本合并为一行**——契约命名或兼容版本带发生变化时才新增行。）

## 版本带说明

| 声明 | v1.6.0 值 |
|---|---|
| `dsh.engines.dsh` | `>=0.1.5-rc.1` |
| peer `@deepseek-ai/cordis` | `>=4.0.1 <5` |
| peer `@deepseek-ai/dsh-client-ui-slots` | `>=0.1.5-rc.1 <0.2.2-0`（仅类型） |
| peer `@deepseek-ai/dsh-settings` | `>=0.1.5-rc.1 <0.2.2-0` |
| peer `react` / `react-dom` | `^18.2.0` |
| devDeps（编译期） | 全部 `@deepseek-ai/*` @ `0.1.5-rc.2` |

> 为什么是 `0.1.5-rc.1` 起？0.1.5 拆掉了 `dsh-client-runtime`、`dsh-host-apiproxy`，重写了 `dsh-settings` 的 `installSection` 模型，且 0.1.5-rc.1 与 rc.2 之间 API 无破坏性变化（已实测），故下界取 `>=0.1.5-rc.1` 以兼容整条 0.1.5-rc 线。
> 为什么上界放到 `<0.2.1-0`？0.1.6 起 DSH 在装载前新增**插件版本门**：读插件的 `peerDependencies`，不覆盖当前运行版本就把**整个包静默跳过**（不崩、不告警）。上界随每条新线**实测后推进**：`<0.1.6-0` 会让插件在 0.1.7 上直接消失（手机面 `/m/` 全死、桌面端毫无提示），故 v1.5.1 放到 `<0.1.8-0`，并实测下界之上的 0.1.5-rc.3 与 0.1.7-rc.1（11 契约 + 真配对 + host-rpc + mux-stream）；0.2.0-rc.2 实测改前被跳过、改后 boot + 11 契约 + 真配对全绿（容器矩阵 80s PASS），故 v1.5.4 放到 `<0.2.1-0`；0.2.1-alpha.2 上探针 PASS（boot ＋ 契约自检 ＋ 真配对），故 v1.6.0 放到 `<0.2.2-0`；0.2.1-rc.2 于 2026-10-18 用 v1.6.0 容器矩阵实测 PASS（162s），该上界已由实测确认。插件对所有官方包都是 `import type`、无运行时耦合，所以每条新线只需动这一行声明。

## 运行环境要求（v1.6.0）

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | `^22.19.0 \|\| >=24.0.0`（`engines`） | 构建/独立运行；DSH 装配环境已满足 |
| 包管理器 | `pnpm@11.7.0`（`packageManager`） | 构建约定 |
| DSH 装配 | web profile（`cordis.patch.yml` 插入插件行） | dsh-palm 宿主半运行在 DSH 进程内 |
| 桌面 GUI | 必须提供 `sidebar.footer.action` seat（dsh-webui 系 UI） | client 半的桌面配对入口挂在该槽位；依赖 GUI 的 `window.__ModuleLoader__` 装载 |
| 手机端浏览器 | 现代浏览器：PWA 需 HTTPS；Web Push 需 Android Chrome/Edge/Firefox 或 iOS Safari 16.4+ installed PWA | `/m/` 端到端要求 |
| 公网/隧道入口 | Tailscale / Cloudflare Tunnel / FRP 任一（可选） | 手机不在同一局域网时的配对与访问 |

## 插件/组件依赖（v1.6.0）

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
WxPusher / Server酱 / Bark / Telegram / PushPlus（降级保留）（L3 通知）、FCM（Web Push 后端）、Tailscale / Cloudflare Tunnel / FRP（入口）

### 备注
- `mobile/` 半：**零** `@deepseek-ai` 依赖，纯自有 `/m/api` + SSE 契约。
- 配对持久化：`$DSH_HOME/dsh-palm-devices.json`；settings 段 `dsh-palm`（`settings.yaml`）。
- 与 dsh-remote-web-ui 的关系：**无**包依赖；仅 README/NOTICE 保留 Apache 衍生署名。

## DSH 升级时核对（每次 DSH 升级只需查这 5 处）

1. `src/api-proxy-adapter.ts` — 5 个 controller 服务名与方法签名（session / workspace / settings / agentPresets / subagents）
2. `src/index.ts` — `ctx.settings.installSection` 调用签名
3. `src/client/index.ts` — `SlotMap` 的 `sidebar.footer.action` shape + `package.json` 的 `dsh.client.inject` 列表
4. `package.json` — peer 版本带是否需放宽（`pnpm-workspace.yaml` 的 minimumReleaseAgeExclude 同步）
5. **投影（session projections）的 wire 形状** — 每个 key 的字段增删都算契约：0.1.7-rc.1 就把 `permissions` 从 `{options, currentValue}` 收窄成 `{currentValue}`（选项搬到进程级 `permissionPresets.catalog()`），插件若仍按旧形状解析，手机端会**静默少一块界面**（桌面端正常、两端都不报错）。判定：用手机配对凭据打 `mobile.readChat`，看 `projections.values` 里各 key 是否仍是客户端解析的形状。

判定方式：`plugin-compat-check.mjs`（Docker 全装配 + HTTP 200 实测）；0.1.x 内小迭代大概率直接通过。
