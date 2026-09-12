# dsh-palm 生命周期自动化系统 — 设计文档

- 日期：2026-09-12
- 状态：**待用户评审**（评审通过后进入实现计划）
- 路径占位符：本文档**不写真实绝对路径**（会触发仓库 hygiene 扫描）。`%USERPROFILE%` = 本机用户目录，`%SCRATCH%` = 本机临时工作区。
- 决策记录：v1 只做 **M1 统一验证层**；架构与 CLI/报告契约**一次定死**，M2/M3 只加动词不动骨架。用户已确认：① 用户级目录 `~/.dsh/tools/dsh-palm-lifecycle/` + CLI 名 `palm`；② `perf/` 迁入仓库并把 `%SCRATCH%\dsh-palm` 其余一次性文件整体归档（**不删除**）；③ `verify.mjs` 新增 `--report` 作为两层唯一硬接口。

## 1. 背景与问题

dsh-palm 的"测试 / 验证 / 预发布 / 发布"目前散落在四处，且互不知晓：

| 位置 | 内容 | 问题 |
|---|---|---|
| 仓库 `scripts/`（8 个）+ `packages/dsh-palm/scripts/`（3 个） | `verify.mjs`（8 步门禁）、`release.mjs`、`windows-write-preflight`、`deploy-once`、`capture-gif/panel/mobile-pair`、`check-pwa`、`measure-paths/tunnel`、`verify-pairing-rework` | 无统一入口、无统一报告，职责重叠 |
| `.github/workflows/` | `ci.yml`（含 `release-preflight` + Gitleaks）、`publish.yml` | 唯一已单源化的部分（与本地共用 `verify.mjs`） |
| `%SCRATCH%\dsh-palm\perf\` | T1/T3 性能 harness、报告、基线、5 个探针 | 在仓库之外，与 `scripts/measure-*` 职责重叠，CI 无法使用 |
| `%SCRATCH%\dsh-palm\` 根 | 约 200 个一次性脚本/日志/截图（`verify-delete3.mjs`、`repro-scroll3.mjs`、`tc10.txt`、`build9.txt`、30 个 `commit-msg-*.txt` …） | 无归档策略；无法判断哪个仍有效 |
| `~/.dsh/tools/` | `dsh-compat`、`dsh-upgrade-verify`、`dsh-plugin-compat`、`plugin-audit`、`dsh-plugin-bridge` | 能力齐全，但与 dsh-palm 的发布链**没有接线** |
| `~/.dsh/skills/palm-release` | 发布 skill（自己声明"权威在仓库"）+ `SOP.md` | 形态正确，但需改为指向本系统 |

**触发本次设计的证据（2026-09-12 v1.3.5 事故）**：本地 `pnpm verify` 连续两次 8/8 全绿，CI 却双红——① `vi.spyOn(localStorage,'setItem')` 在 runner 上静默不拦截，使断言变成真空/误红；② 新增常量名命中 Gitleaks 规则，而本地门禁不查此项。两者都属于"同一件事存在两个版本"，而当时唯一的补救手段是我临时拼的 PR 验证流程。这不是运气问题，是流程散落的必然结果。

## 2. 目标与非目标

**目标**

1. 把"测试 / 验证 / 预发布 / 发布"收敛成**一个入口、一份报告**：本地、CI、skill 读同一份结论。
2. 让"发现 DSH 新版本 → 适配 → 验证 → 灰度 → 发布 → 生产切换"成为**一条流水线**，DSH 跟随只是其中一个触发器。
3. 为 M2（预发布/soak）与 M3（自动发布/回滚）**预留骨架**，使它们只增加动词与目录，不重构。

**非目标（本轮 M1 明确不做）**

- 不做无人值守的自动发布、不做生产切换（M3）。
- 不做金丝雀实例与端到端探针（M2）。
- 不重写 `verify.mjs` / `release.mjs` / `dsh-compat` 的任何检查逻辑。
- 不删除 `%SCRATCH%\dsh-palm` 的任何文件（只归档）。
- 不改 dsh-palm 的运行时行为（本系统是工具链，不进 npm 包）。

## 3. 术语

| 术语 | 含义 |
|---|---|
| 门禁（gate） | `packages/dsh-palm/scripts/verify.mjs` 的 8 个步骤 |
| 报告（report） | 本系统定义的统一 JSON（`dsh-palm.lifecycle/1`），所有动词产出同形状 |
| 状态（state） | 生命周期事实，存 `state/state.json`：最后门禁、soak 时钟、基线 sha、探针历史 |
| 契约快照 | 从某个 DSH 版本提取的服务名/事件名/方法/mux 帧类型集合 |
| 金丝雀 | 独立 `DSH_HOME` + 独立端口 + junction 指向测试克隆的第二实例（M2） |
| 毕业 | 把被 soak 的提交合并进 `main` 并发布（M3） |

## 4. 方案总览与评估

| 里程碑 | 交付 | 收益 | 主要风险 | 依赖 | 预估 |
|---|---|---|---|---|---|
| **M1 统一验证层** | `palm` CLI（status/check/verify/perf/report/doctor）+ 统一报告 schema + `perf/` 迁入仓库 | 散落当场消失；本地/CI/skill 同源；后两层的地基 | 变成"第二事实源"（若复写检查） | 无 | 2~3 场 |
| **M2 预发布与 soak** | `palm probe` + `palm soak` + test 灰度线 | 把"真机坏"挡在发布前 | 探针凭据路径未验证 | M1 的 schema | 2~3 场 |
| **M3 发布与回滚 + 跟随** | `release.mjs --from-head`、自动毕业/发布、dist-tag 灰度与自动回滚、`palm cutover`、DSH 跟随触发器 | 用户最初要的全自动 C′ | 不可逆动作 + 自动切生产 | M2 探针必须够强 | 2~4 场 |

## 5. 架构与分层

**判断依据**：一个资产是"跟着项目走"还是"跟着 DSH 走"。

| 层 | 位置 | 放什么 | 理由 |
|---|---|---|---|
| 权威门禁 | 仓库 `packages/dsh-palm/scripts/`、`scripts/`、`.github/workflows/` | `verify.mjs`、`release.mjs`、CI workflow | CI 必须能跑；随代码版本化；单一事实源 |
| 编排与运维 | 用户级 `~/.dsh/tools/dsh-palm-lifecycle/`（**零依赖**，仅 node 内置模块） | `palm` CLI、状态机、探针、发现、canary、soak、cutover | 面向 DSH 实例的运维资产，遵守"DSH 版本无关"铁律；DSH 本身坏了也能运行 |
| 项目工具 | **迁入仓库** `perf/` | T1/T3 harness、基线、报告、探针 | 属于项目的测试资产，迁入后才可被 CI 使用 |
| 指针 | `~/.dsh/skills/palm-release` | 何时用 / 怎么恢复，指向 `palm` 与仓库 | 保持"权威在仓库"的既有立场 |

**五条不变量（架构级约束，实现必须满足）**

1. **只编排，不复写**：`palm` 的每个动词要么调用既有入口（`pnpm verify`、`release.mjs`、`dsh-compat`、探针脚本），要么做聚合/渲染；**不得重新实现任何检查**。
2. **既有路径独立可用**：`pnpm verify`、`scripts/release.mjs`、`palm-release` skill 均不依赖 `palm`；删掉用户级目录即回到今天的状态。
3. **默认安全**：有副作用的动词默认 dry-run；无变化即 no-op；幂等；失败绝不半发布。
4. **门禁漂移即失败**：门禁（`verify.mjs`）的步骤集合与本工具的映射不一致时——出现未知步骤 id、或缺失已知 id——一律 `fail`，**绝不静默给出"全绿"**。这条防的是"工具报绿、结论已过期"。
5. **纯 Node，文件内容不经 PowerShell**：本机 PS 是 5.1，会把无 BOM 的 UTF-8 按 GBK 解读并静默损坏内容（本项目已实战踩过）。工具内部一律用 `node:fs` 读写，禁止用 PowerShell 往返文件内容；需要 shell 时只用于无内容传递的动作。

## 6. CLI 契约（一次固定 M1~M3，后续只实现不改造）

```
palm status                  # DSH 版本 · 插件版本 · 最后门禁 · soak 状态 · 基线 sha
palm check [--target <v>]    # 静态：版本声明 / 契约快照 diff / peer 范围 / 包体积门
palm verify [--source <dir>] # 动态：调用 pnpm verify(8 步) → 归一化报告
palm perf [--capture <file>] # 性能：T1 实验室重跑 + 真机抓取入库 + 阈值判定
palm report [--last N]       # 汇总 state/reports → 一份 Markdown
palm doctor                  # 工具自检：node/pnpm/gh/路径/权限/代理/端口
--- M2（本轮仅保留动词位，不实现）---
palm probe --env canary      # 端到端：真实配对 → 11 条帧计数>0 → 真回合
palm soak start|status|stop  # soak 状态机（毕业门）
--- M3（本轮仅保留动词位，不实现）---
palm release --version X     # 毕业 + 发布（内部调 release.mjs --from-head）
palm cutover                 # 生产切换（时间窗 + 无活动会话）
```

**通用语义**

- `--json`：stdout 只输出报告 JSON（便于 CI/脚本消费）。
- `--dry-run`：默认开启于 `release`/`cutover`/`soak start`；`check`/`verify`/`perf`/`report`/`doctor` 是只读的，无需 dry-run。
- **退出码**：`0` 全部通过（或 skip）；`1` 有 fail；`2` 用法/环境错误（如找不到仓库、pnpm 缺失）。
- 未实现的动词（M2/M3）必须显式报 `not-implemented` 并以退出码 `2` 结束，不得静默 no-op。

## 7. 报告与状态 schema

**报告**（每个动词产出一份；CI 与本地同形状）

```jsonc
{
  "schema": "dsh-palm.lifecycle/1",
  "stage": "status|check|verify|perf|report|doctor|probe|release|cutover",
  "ok": true,
  "startedAt": "2026-09-12T11:00:00.000Z",
  "finishedAt": "2026-09-12T11:00:34.000Z",
  "context": {
    "pluginVersion": "1.3.6",
    "dshVersion": "0.1.5-rc.2",
    "branch": "main",
    "commit": "1ecd4ef",
    "bundleHash": "b52c6b24"
  },
  "checks": [ { "id": "build", "status": "pass", "ms": 1500, "detail": "" } ],
  "artifacts": [ { "kind": "json", "path": "state/reports/20260912T110000-verify.json" } ],
  "next": [ "可以直接进入 M2 的探针阶段" ]
}
```

- `status` ∈ `pass|fail|skip`；`skip` 用于"无变化"（如契约快照无 diff、包体积门未超阈值）。
- `checks[].id` 与门禁步骤 id 保持一致（`build`/`coverage`/`typecheck`/`audit`/`hygiene`/`pack`/`commitlint`/`install`）。
- `context.dshVersion` 取本地已安装官方包的版本（`node_modules/@deepseek-ai/dsh-settings/package.json` 的 `version`）。
- 新增字段必须可选；删除/改语义必须升 `schema` 版本。

**状态**

```jsonc
{
  "schema": "dsh-palm.lifecycle.state/1",
  "lastVerify": { "ok": true, "at": "…", "commit": "…", "report": "…" },
  "lastCheck":  { "ok": true, "at": "…", "target": "0.1.5-rc.2" },
  "baselines":  { "t1": "…", "bundleSize": 561000, "captures": { "android-lan": "…" } },
  "soak":       { "sha": null, "startedAt": null, "probes": [], "verdict": null },
  "history":    [ { "stage": "verify", "at": "…", "ok": true } ]
}
```

状态文件**原子写入**（临时文件 + rename），只记录生命周期事实，**不是代码的事实源**。

## 8. 目录布局

```
~/.dsh/tools/dsh-palm-lifecycle/          # 用户级编排（零依赖）
  palm.mjs                                # 唯一入口
  lib/{repo,run,report,state,perf,probe}.mjs
  state/state.json
  state/lock                              # 并发保护：人与定时任务同时跑时互斥
  state/reports/*.{json,md}
  contracts/<dsh-version>.json            # M2/M3 使用
  docs/                                   # 本设计文档的副本（便于随工具一起备份）
仓库（保持未提交，随下一版发布提交落地）：
  packages/dsh-palm/scripts/verify.mjs    # + --report <path>
  scripts/release.mjs                     # M3 新增 --from-head
  perf/                                   # 由 %SCRATCH%\dsh-palm\perf 迁入
  docs/lifecycle/2026-09-12-dsh-palm-lifecycle-design.md   # 本文档（权威副本）
%SCRATCH%\dsh-palm\archive-20260912\        # 一次性文件整体归档（保留，不删除）
```

**密钥扫描覆盖**：`~/.dsh/tools/dsh-palm-lifecycle/` 目前**不在** `key-audit-scan` 计划任务的扫描范围内（该任务只扫 `%USERPROFILE%\dsh-source` 与 `%SCRATCH%`）。M1 交付时同步把工具目录纳入扫描范围，否则新工具里的凭据/本机路径不会被审。同时迁移 `perf/` 时必须消除绝对本机路径（`perf/README.md` 现有一处 `%USERPROFILE%\...`），因为 key-audit 的发布前清单明确禁止"仓库内硬编码本机路径"。

## 9. M1 详细设计

### 9.1 `palm status`

- 读取：`packages/dsh-palm/package.json` 的版本、`git rev-parse HEAD`、`state.json`、线上 `/m/` 的 bundle hash（若 3080 可达）。
- 输出：一屏摘要 + `--json` 报告（`stage: "status"` 复用报告 schema，`checks` 为各项事实）。
- 失败：仓库不存在 → 退出码 2。

### 9.2 `palm check`

四个子检查，各自 `pass|fail|skip`：

1. **版本声明**：`dsh.engines.dsh`、`peerDependencies` 的上下限是否覆盖目标版本。`--target` 接受**版本号**或**新 checkout 目录**（与 `dsh-compat check <target>` 同义）；缺省时以本地已安装官方包的版本为目标（用于"当前状态自检"）。
2. **契约快照 diff**：与 `contracts/<dsh-version>.json` 对比服务名/事件名/方法/mux 帧类型的增删改；M1 只做**提取与 diff**（不含自动修复），并把"改名/删除"标为 `fail`（这是 M2/M3 的硬停依据）。
3. **peer/devDeps 一致性**：20 个官方 devDeps 是否统一在同一版本。
4. **包体积门**：`lib/mobile.js` 原始与 gzip 体积、与 `state.baselines.bundleSize` 的增量是否超阈值（默认 +5%）。

契约快照的提取方式（M1 实现时确定其一，并在实现计划中记录）：优先从官方包的 `.d.ts` 静态提取（零运行时依赖）；退路是从本地 DSH 实例的 `mobile.diagnostics` 与 mux 帧流运行期采样。

### 9.3 `palm verify`

- 调用 `pnpm verify`（经 `verify.mjs`，带 `--report <state/reports/...json>`）。
- 归一化：把门禁报告的 8 步映射进统一 schema；`--source <dir>` 支持指定仓库/worktree。
- 副作用：写 `state.json` 的 `lastVerify` 与 `history`。
- 失败语义：门禁红 → `ok: false`、退出码 1，并原样保留门禁日志路径在 `artifacts`。

### 9.4 `palm perf`

- `--capture <file>`：把真机抓取（`mobile.perf` 落盘的 `capture-*.json`）经 `perf/parse-capture.mjs` 入库到 `perf/baselines/<env>.json`。
- 无参数：重跑 T1 实验室 harness（`perf/run-t1.mjs`）并与基线对照。
- 阈值：T1 `toCommit.p95` 或真机 `frames.long` 超基线一定幅度 → `fail`（具体幅度在实现计划中定，默认 20%）。

### 9.5 `palm report`

- 读 `state/reports/` 最近 N 份（默认 10）+ `state.json`，渲染一份 Markdown 到 `state/reports/<timestamp>-summary.md`。
- 结构：本次结论 / 各阶段时间线 / 关键指标表 / 失败项与建议。

### 9.6 `palm doctor`

自检：node 版本、pnpm 可用性、仓库路径与 git、`gh` 认证与代理、3080 端口可达性、`state/` 可写、`perf/` 存在且可运行、M2/M3 依赖（`dsh-compat` 路径）存在性。任一硬依赖缺失 → 退出码 2，并给出修复建议。

### 9.7 `verify.mjs --report`（两层唯一硬接口）

- 新增参数：`--report <path>`；写入本文档 §7 的 schema（`stage: "verify"`）。
- 不改动既有行为与既有 stdout 格式；不传参数时行为与今天完全一致。
- CI：`ci.yml` 的 check job 与 `publish.yml` 的 quality gate 可选用它上传 artifact（本轮仅在本地链路启用，CI 接入留到实现计划的最后一步，避免影响发布链）。

### 9.8 `perf/` 迁入与归档

- 迁入清单：`perf/*.mjs`、`perf/PERFORMANCE-REPORT.md`、`perf/T3-MATRIX.md`、`perf/baselines/`、`perf/perf-t1-report.json`（含 `.prev` 备份）、`perf/*.md` 计划文档。
- 迁入后修正脚本内的相对路径与文档中的路径引用（`%SCRATCH%\dsh-palm\perf` → 仓库 `perf/`）。
- 归档：`%SCRATCH%\dsh-palm` 根下除 `perf/`、`node_modules/`、正在使用的目录外，全部移入 `archive-20260912/`（**只移动，不删除**），并在归档目录放一份 `README.md` 说明"什么被归档、何时、如何取回"。
- 规范：今后一次性探针放 `perf/probes/<topic>/`，完成后归档；禁止再往仓库根或 `%SCRATCH%` 根堆文件。

### 9.9 测试策略

1. **单元测试**（node 内置 `node:test`，零依赖）：`lib/run.mjs` 的参数拼接与错误传播、`report.mjs` 的 schema 校验、`state.mjs` 的原子写与并发安全。
   > 这些测试跑在**用户级目录**（`node --test`），不进仓库 CI——本系统是用户级工具；仓库侧只新增并测试 `verify.mjs --report` 这一个可选参数（在仓库既有的 vitest 套件内）。
2. **不变量测试（关键）**：mock `spawn` 后断言 `palm verify` 确实调用 `pnpm verify`/`verify.mjs`，`palm check` 不产生写操作，`palm release`（未实现）报 `not-implemented`；**并断言源码里不存在重复实现的检查**（对 `lib/*.mjs` 做禁止模式扫描：如出现 `vitest`/`tsc`/`eslint` 的直接调用即失败）。
3. **端到端**：在临时 worktree 上跑 `palm status/check/verify/report/doctor` 全绿；`--json` 输出可被 `JSON.parse` 且通过 schema 校验。

### 9.10 风险缓解（机器化，随 M1 交付）

评审阶段识别出的风险，凡能机器化的都在 M1 落地，不留"靠人记得"：

1. **临时文件不得进入发布提交**：`perf/run-t1.mjs` 会向包源码写入临时 spec（`src/mobile/perf-t1-bench.test.tsx`）再删除，进程被杀即残留，而 `release.mjs` 提交**整个工作树**。要求：
   - `palm perf` 运行前后都做一次清理与检测（发现残留即清理并记录到报告的 `checks`）；
   - **发布预检新增一条**：工作树中出现白名单外的未跟踪文件即拒绝发布（`palm check` 里作为 `fail`，`release.mjs` 的预检同步加）。
2. **未知门禁步骤即失败**（不变量 4 的落地）：`verify.mjs --report` 的报告里若出现本工具不认识的步骤 id，`palm verify` 直接 `fail` 并在报告里列出未知 id，而不是忽略。
3. **并发互斥**：所有写状态的动词必须持有 `state/lock`（含 PID 与时间戳，超时可强制接管）；拿不到锁时以退出码 2 结束并说明持锁者。
4. **已知陷阱自检**（`palm doctor`）：检测并报警——shell 里导出了 `HTTPS_PROXY`（本项目发布链的已知陷阱）、`perf/` 或 `state/` 不可写、3080 端口被占用、代理不可达、`gh` 未认证、绝对本机路径出现在待提交文件里。
5. **绝对路径零容忍**：`palm check` 增加一条静态扫描——待提交文件里出现 `%USERPROFILE%\...`、`%SCRATCH%` 等本机路径即 `fail`（与 key-audit 的发布前清单对齐）。
6. **纯 Node 约束的机器校验**：不变量测试里增加禁止模式扫描——`lib/**` 出现 `powershell`/`pwsh` 调用于内容读写、或直接调用 `vitest`/`tsc` 等检查工具，即测试失败。

### 9.11 M1 验收清单（"做完"的定义）

1. `palm verify` 与直接 `pnpm verify` 的 8 步结论**完全一致**，并写出同 schema 报告；
2. `palm check` 能报出 peer 范围、契约快照 diff、包体积门（无变化时全部 `skip`）；
3. `perf/` 迁入仓库后 `palm perf` 能重跑 T1 并入库真机抓取；
4. `palm doctor` 全绿；`palm report` 生成一份可读 MD；
5. 不变量测试通过（含"无重复实现"扫描）；
6. **卸载隔离**：移除 `~/.dsh/tools/dsh-palm-lifecycle/` 后，`pnpm verify` 与 `scripts/release.mjs` 依然独立可用；
7. §9.10 的六条机器化缓解各有对应测试或检查（临时文件残留检测、未知步骤 fail、锁互斥、doctor 陷阱、绝对路径扫描、纯 Node 禁止模式扫描）；
8. `~/.dsh/tools/dsh-palm-lifecycle/` 已被纳入 `key-audit-scan` 的扫描范围；
9. **回归证明**：`verify.mjs` 在不传 `--report` 时的输出与行为，与改动前逐字一致（用仓库既有的 vitest 套件覆盖）。

## 10. M2 / M3 预留（本轮不实现）

**M2（预发布与 soak）**

- `palm probe --env canary`：在独立 `DSH_HOME` 与端口上启动（复用 `dsh-compat canary-setup` 能力），junction 指向测试克隆；随后走**真实配对流程**取得设备凭据 → 访问 `/m/` → 调 `mobile.diagnostics` 断言 11 条契约的**运行期帧计数 > 0** → 驱动一轮真回合（工具调用 / 图片附件 / 审批面板 / 问题面板）→ 断言帧序完整、日志无 error。探针**不得**为拿凭据而修改插件源码。
- `palm soak start|status|stop`：soak 时钟以 `sha` 为键，任何 rebase/提交变化即归零；毕业门 = 连续 N 小时（patch/rc 12h、minor 24h）+ 探针成功率 ≥95% + error 日志 0 + 最后一次探针 ≤30 分钟。
- test 灰度线：长驻分支只承载"待毕业提交"，且**必须是 main 的线性延长**（`merge --ff-only` 毕业）；禁止从 test 再开功能分支；`main` 在 soak 窗口内冻结。

**M3（发布与回滚 + DSH 跟随）**

- `release.mjs --from-head`：发布**已提交的 HEAD**（不加此模式，被 soak 的树无法原样发版，`reset --soft` 会改变 sha 使 soak 失效）。
- 毕业流程：`merge --ff-only` → 打附注 tag → GitHub Release → npm（先 `next` 观察窗，再自动提升 `latest`；同版本可用 `npm dist-tag add` 提升，不必重发）。
- 自动回滚：毕业后 **24 小时内**探针转红 → 自动回退 `dist-tag`、金丝雀切回旧 sha、开 issue。
- `palm cutover`：默认 dry-run；开启后按"时间窗 + 无活动会话"执行（快进 live 树 → build → 重启 → 线上 hash 核对）。**竞态处理（必须实现）**：`schtasks /run /tn dsh-restart-now` 会中断当时正在执行的工具调用/正在跑的回合，因此——① 判定"无活动会话"后，**重启前再查一次**并取两者交集；② 重启前把当时的活动会话列表与 HEAD 存档进 `state.json`；③ 重启后 60 秒内核对 3080 可用与 `mobile.js` 的 served/disk SHA 一致，不一致即回滚到上一个 tag 并报警；④ 若两次判定之间出现活动会话，则本窗口放弃、留待下一窗口，**不排队硬切**。
- DSH 跟随：仅作为一个**触发器**接入（发现官方包新版本/本地 checkout 移动），复用同一条流水线。

## 11. 风险登记与停止条件

**🔴 高——会伤到正在运行的东西**

| 风险 | 说明 | 缓解 | 落地 |
|---|---|---|---|
| 自动切生产杀掉进行中的会话 | 重启会中断当时的工具调用/回合；"无活动会话"判定存在竞态 | §10 M3 的四条竞态处理（重启前复查、存档、重启后核对、宁可放弃窗口） | M3 |
| 发布链被顺手改坏 | `verify.mjs` 是本地与 CI `release-preflight` 共用的唯一发布门 | 严格附加式 + 报告写失败不影响门禁 + 仓库 vitest 覆盖 + 先过 PR runner | M1 |
| 未跟踪文件被卷进发布提交 | `release.mjs` 提交整个工作树；`perf/run-t1.mjs` 会残留临时 spec | §9.10 第 1 条：`palm perf` 前后清理检测 + 发布预检拒绝白名单外未跟踪文件 | M1 |

**🟠 中——会慢慢腐化**

| 风险 | 缓解 | 落地 |
|---|---|---|
| 系统与门禁漂移（门禁变、工具仍报绿） | 不变量 4 + §9.10 第 2 条：未知步骤 id 直接 fail | M1 |
| 人机并发互踩状态 | `state/lock` + 超时接管 | M1 |
| 新工具目录缺密钥扫描 | 纳入 key-audit 扫描范围 + `palm check` 的绝对路径扫描 | M1 |
| 无人值守的凭据暴露面 | 机器人只调 `release.mjs`，发布仍由 CI 完成；本地不直接 `npm publish` | M3 |
| PowerShell 编码损坏 | 不变量 5 + §9.10 第 6 条的禁止模式扫描 | M1 |
| 契约快照提取不准 | 静态提取优先、运行期采样兜底；diff 只作硬停依据，**不自动改码** | M2 |

**🟡 低——知情即可**

| 风险 | 缓解 |
|---|---|
| 归档误伤有效脚本 | 已核实：无计划任务、无 `~/.dsh/tools` 引用；且**只移动不删除** + 归档 README 索引 |
| 设计文档两处副本分叉 | 仓库为权威副本，用户级 `docs/` 只读冗余 |
| 采纳失败导致散落回归 | `palm-release` skill 只指向 `palm`；发布记录以 `palm report` 产物为准 |
| 过度工程化（M2/M3 尤甚） | 每个动词必须能回答"没有它时手动怎么做"；做不到更省事就不加 |

**停止条件**：M2 探针若必须改插件源码才能拿凭据 → 停下来重新设计；M3 若做不到"自动回滚 dist-tag" → 不放开自动发布。

## 12. 回滚与卸载

- **卸载**：删除 `~/.dsh/tools/dsh-palm-lifecycle/` 即可；仓库侧只新增一个可选参数（`--report`）与 `perf/` 目录，不影响构建与发布。
- **本设计引入的仓库改动**（保持未提交，随下一版发布）：`verify.mjs` 的 `--report`、`perf/` 迁入、本文档。若需撤销：`git checkout -- packages/dsh-palm/scripts/verify.mjs`、把 `perf/` 移回、删除文档。
- **归档回退**：把 `archive-20260912/` 内文件移回原位即可。

## 13. 未决问题

1. 契约快照的提取方式（静态 `.d.ts` 解析 vs 运行期采样）——M1 实现时以最小可行方式确定，并记录在实现计划中。
2. 包体积门与性能门的**具体阈值**（默认 +5% / +20%）——实现时先用当前基线跑一周再收紧。
3. M2 探针获取设备凭据的具体接口——设计阶段已确认走"真实配对流程"，具体端点需在实现前验证。

## 14. 变更记录

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-09-12 | v1 | 初稿；确定 v1 = M1，架构/CLI/schema 一次定死 |
| 2026-09-12 | v2 | 风险复盘：不变量 3→5（新增"门禁漂移即失败""纯 Node 无 PowerShell 内容往返"）；新增 §9.10 机器化缓解（临时文件、未知步骤、锁、doctor 陷阱、绝对路径、纯 Node 扫描）；§9.11 验收清单扩至 9 条；§10 补 cutover 四条竞态处理；§11 升级为分级台账；新增 §15 附录 A |

## 15. 附录 A：顺带发现（不在本设计范围，独立小修）

`~/.dsh/skills/key-audit/run-key-audit-scan.cmd` 的 `--npm "@eternalloveone/dsh-palm@0.1.0"` 把"扫线上 tarball"钉死在 **0.1.0**（当前 1.3.6），该检查实际已失效。建议改为动态取 `dist-tags.latest`（或每次发布后手动更新）。**本设计不修改它**，仅记录，避免与安全工具链的其他改动混在一起。
