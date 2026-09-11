# dsh-palm × DSH Compatibility Matrix

One authoritative table for which dsh-palm release works with which DSH line.
The single source of truth is `packages/dsh-palm/package.json` (`peerDependencies`,
`dsh.engines.dsh`, `devDependencies`); this file is the human-readable summary and
must be updated in the same release.

| dsh-palm | DSH line | `dsh.engines.dsh` | `@deepseek-ai` peer range | Runtime-contract naming | Paired devices carry over | Status |
|---|---|---|---|---|---|---|
| ≤ 1.2.0 | 0.1.1-rc … 0.1.5-rc.1 | `>=0.1.1-rc.1` | cordis + 5 client/api packages (old set) | `remote-web-ui` | yes (remote-web-ui-* names) | superseded; not verified on 0.1.5-rc.2 |
| **1.3.0** (current) | **0.1.5-rc.2** ✅ verified | `>=0.1.5-rc.1` | `cordis >=4.0.1 <5`, `dsh-client-ui-slots >=0.1.5-rc.1 <0.1.6-0`, `dsh-settings >=0.1.5-rc.1 <0.1.6-0` | `dsh-palm` (ns `dsh-palm`, store `dsh-palm-devices.json`, service `dshPalmPairing`, bridge `/api/dsh-palm-settings`) | **no — re-pair phones once** | current main |

## Peer / devDeps detail (v1.3.0)

- **peerDependencies** (runtime, must be provided by the DSH assembly):
  - `@deepseek-ai/cordis  >=4.0.1 <5`
  - `@deepseek-ai/dsh-client-ui-slots  >=0.1.5-rc.1 <0.1.6-0` (type-only consumer)
  - `@deepseek-ai/dsh-settings  >=0.1.5-rc.1 <0.1.6-0`
  - `react ^18.2.0`, `react-dom ^18.2.0` (client half)
- **client-service providers** (`dsh.client.inject`, resolved at assembly time by the shell):
  `dsh-api-remotes`, `dsh-client-connection`, `dsh-client-locale`, `dsh-client-ui-renderer`, `dsh-client-ui-settings`
- **devDependencies** (build/typecheck/test only, pinned): all `@deepseek-ai/*` at `0.1.5-rc.2`;
  `dsh-user-approval` / `dsh-user-questions` at `0.1.5-rc.2` supply the api-proxy event types
- **Build**: standalone since v1.3.0 (no DSH assembly environment required)

## 中文说明

| dsh-palm 版本 | 适配的 DSH 线 | peer 范围（@deepseek-ai） | 运行时契约命名 | 老设备是否沿用 | 状态 |
|---|---|---|---|---|---|
| ≤ 1.2.0 | 0.1.1-rc … 0.1.5-rc.1 | cordis + 旧 5 包 | `remote-web-ui` | 是（旧文件名/ns） | 已过时，未在 0.1.5-rc.2 上验证 |
| **1.3.0**（当前） | **0.1.5-rc.2** ✅ 已实测验证 | `cordis >=4.0.1 <5`；`dsh-client-ui-slots`、`dsh-settings` 均 `>=0.1.5-rc.1 <0.1.6-0` | `dsh-palm`（ns `dsh-palm`、存储 `dsh-palm-devices.json`、服务 `dshPalmPairing`、桥 `/api/dsh-palm-settings`） | **否——升级后需重新扫码配对一次** | 当前主线 |

**v1.3.0 升级注意**：设备存储文件名、settings namespace、cordis 服务名全部改为 dsh-palm 自有命名，且不再读取 `remote-web-ui` 旧段——已配对设备不沿用，需重新配对；`settings.yaml` 中旧 `remote-web-ui` 段不再生效。

**DSH 后续升级时只需核对 4 处**（本次 0.1.5-rc.1 → rc.2 未触碰）：
1. `src/api-proxy-adapter.ts` —— 5 个 controller 服务名与方法签名（session / workspace / settings / agentPresets / subagents）
2. `src/index.ts` —— `ctx.settings.installSection` 调用签名
3. `src/client/index.ts` —— `SlotMap` merge 的 `sidebar.footer.action` shape + `package.json` 的 `dsh.client.inject` 列表
4. `package.json` —— peer 版本带是否需放宽（另见 `pnpm-workspace.yaml` minimumReleaseAgeExclude）

核对方式：用 `plugin-compat-check.mjs`（Docker 全装配 + HTTP 200）实测；0.1.x 内小迭代大概率直接通过。
