# M1 实现计划 — dsh-palm 生命周期自动化系统（统一验证层）

- 日期：2026-09-12
- 路径占位符：本文档**不写真实绝对路径**（会触发仓库 hygiene 扫描）。`%USERPROFILE%` = 本机用户目录，`%SCRATCH%` = 本机临时工作区。
- 依据：[`2026-09-12-dsh-palm-lifecycle-design.md`](./2026-09-12-dsh-palm-lifecycle-design.md) v2（已评审）
- 范围：**只做 M1**。M2/M3 只保留 CLI 动词位（报 `not-implemented`，退出码 2）。
- 前置事实（已核实）：`verify.mjs` 的步骤 id 为 `install|build|coverage|tests|typecheck|audit|hygiene|pack|commitlint`；profile 为 `ci`（8 步）与 `push`（3 步）；脚本零依赖、`parseArgs` 在文件内、结果收集在 `results` 数组。

## 0. 总原则

- 仓库侧只改**一件事**：`verify.mjs` 增加可选 `--report <path>`。其余全在用户级目录，不进 npm 包。
- 每个步骤都可独立回滚；每步结束都必须让 `pnpm verify` 与 `scripts/release.mjs` **仍能独立工作**。
- 涉及发布链的改动（步骤 ①）必须先开一次性 PR 跑真实 runner（本地 Node 26 / runner Node 22 的差异已两次咬人）。

---

## 步骤 ① 仓库侧：`verify.mjs --report` + 回归证明

**交付**
- `--report <path>`：门禁结束后写出一份 `dsh-palm.lifecycle/1` 报告（`stage: "verify"`）。
- 报告构造与写入**附加式**：
  - 不传 `--report` 时，stdout、退出码、行为与今天**逐字一致**；
  - **写报告失败只打印警告，绝不改变门禁结论与退出码**（fail-soft）；
  - `checks[].id` 直接取步骤 id；`status` 由现有 `results` 推导（`pass|fail|skip`），不重新判定。
- `context`：`pluginVersion`（包 `package.json`）、`dshVersion`（本地 `@deepseek-ai/dsh-settings` 的版本）、`branch`/`commit`（git）、`bundleHash`（`lib/mobile.js` 的 SHA-256 前 8 位，若已构建）。

**触及文件**：`packages/dsh-palm/scripts/verify.mjs`（唯一仓库代码改动）。

**验证**
- `node scripts/verify.mjs --list` 输出与改动前一致；
- `node scripts/verify.mjs --only commitlint --report <tmp.json>` 产出可 `JSON.parse` 的报告，字段符合 schema（用廉价步骤做端到端冒烟，避免每次跑满 8 步）；
- `node scripts/verify.mjs --only commitlint`（不带 `--report`）的输出与改动前逐字一致；
- 报告路径不可写时：门禁结论与退出码不变；
- `pnpm verify` 全绿（8/8）。

**回滚**：`git checkout -- packages/dsh-palm/scripts/verify.mjs`。

**完成判据**：以上 5 条全过，且**一次性 PR 在真实 runner 上 `check` + `release-preflight` 双绿**（PR 用后即删，不留提交）。

---

## 步骤 ② 用户级骨架 + 六个只读动词

**目录**：`~/.dsh/tools/dsh-palm-lifecycle/`

```
palm.mjs                     # 唯一入口：解析参数、分派动词、统一退出码
lib/repo.mjs                 # 定位仓库/worktree、读 package.json、git HEAD、DSH 版本
lib/run.mjs                  # spawnSync 包装（捕获输出、注入/剥离代理、超时）
lib/report.mjs               # 报告构造、schema 校验、写出（json/md）
lib/state.mjs                # state.json 原子写 + lock 获取/释放
lib/check.mjs                # 四个静态子检查（版本声明/契约快照/peer 一致/包体积门）
lib/contract.mjs             # 契约快照提取与 diff（见下）
```

**动词**（全部支持 `--json`；只读动词无 dry-run 需求）

| 动词 | 行为 | 退出码 |
|---|---|---|
| `palm status` | DSH 版本 · 插件版本 · 最后门禁 · soak 占位 · 基线 sha | 0 / 2 |
| `palm check [--target <ver\|dir>]` | 四子检查，各自 `pass\|fail\|skip` | 1 有 fail / 2 环境错 |
| `palm verify [--source <dir>]` | 调 `verify.mjs --report`，归一化为统一报告 | 同上 |
| `palm perf [--capture <file>]` | 跑 T1 / 入库真机抓取（依赖步骤 ④ 的迁移） | 同上 |
| `palm report [--last N]` | 汇总 state/reports → 一份 Markdown | 0 |
| `palm doctor` | 自检环境与已知陷阱 | 0 / 2 |

**契约快照（M1 只做提取与 diff，不做修复）**
- 优先：从官方包 `.d.ts` 静态提取服务名/事件名/方法名与 mux 帧类型字面量；
- 退路：从本地 DSH 实例运行期采样（`mobile.diagnostics` + mux 帧流）；
- 产物：`contracts/<dsh-version>.json`；diff 出现**改名/删除** → `fail`（作为 M2/M3 的硬停依据）。
- 实现时先写一个最小可行提取器并记录所选路径；若两条路都不稳，允许在 M1 只产出"服务名与事件名字面量"的最小集合（明确标注覆盖不足，不算骗绿）。

**验证**：在临时 worktree 上跑六个动词，`--json` 均可 `JSON.parse` 且通过 schema 校验；`status` 报告的数字与手工核对一致（版本、HEAD、bundle hash）。

**完成判据**：六个动词可用；报告写入 `state/reports/`；不产生任何仓库写操作（`git status` 不变）。

---

## 步骤 ③ 六条机器化缓解 + 不变量测试

严格对应设计文档 §9.10：

1. **临时文件**：`palm perf` 运行前后检测并清理 `src/mobile/perf-t1-bench*.test.tsx` 残留；`palm check` 增加"白名单外未跟踪文件"检查（发布前拒绝）。
2. **未知门禁步骤**：`verify.mjs` 报告里出现未知步骤 id → `palm verify` 直接 `fail` 并列出未知 id。
3. **锁**：所有写状态动词持 `state/lock`（含 PID/时间戳/超时接管）；拿不到锁 → 退出码 2 并说明持锁者。
4. **doctor 陷阱检测**：shell 里导出了 `HTTPS_PROXY`/`HTTP_PROXY`、3080 被占用、代理不可达、`gh` 未认证、`state/` 或 `perf/` 不可写。
5. **绝对路径扫描**：`palm check` 扫待提交文件中的本机用户目录与临时工作区路径（**正/反斜杠都认**，比仓库 guard 正则更宽）→ `fail`。注意：**文档里不要写字面示例**，否则说明本身就会触发这条检查（实测踩过）。
6. **纯 Node 禁止模式扫描**（不变量测试内）：`lib/**` 出现 `powershell`/`pwsh` 用于内容读写、或直接调用 `vitest`/`tsc`/`eslint` → 测试失败。

**测试**（`node --test`，零依赖，跑在用户级目录）
- `lib/run.mjs` 参数拼接与错误传播；`lib/report.mjs` schema 校验与 fail-soft；`lib/state.mjs` 原子写与并发（两个进程抢锁）。
- **不变量测试（关键）**：mock `spawn` 断言 `palm verify` 确实调用 `verify.mjs`、`palm check` 无写操作、未实现动词报 `not-implemented`、源码无重复实现（禁止模式扫描）。

**完成判据**：六条各有对应测试或检查；`node --test` 全绿。

---

## 步骤 ④ `perf/` 迁入 + 归档 + skill 改指向

**迁入**（20 个文件，已清点）：`bundle-size.mjs`、`css-measure.mjs`、`net-probe.mjs`、`probe-dual.mjs`、`parse-capture.mjs`、`report.mjs`、`run-t1.mjs`、`view-sizes.mjs`、`README.md`、`PERFORMANCE-REPORT.md`、`T3-MATRIX.md`、`e2e-perf-plan.md`、`perf-results-section.md`、`baselines/android-lan.json`、`perf-t1-report.json(+.prev)`、`dual-probe.json`、`perf-e2e-report.json`、`settle-split.json`
→ 目标：仓库 `perf/`（仓库根 `perf/`，不在 npm `files` 白名单内，不会进 tarball）。

**迁移要求**
- 脚本内与文档中的 `%SCRATCH%\dsh-palm\perf` 引用改为相对路径；
- **消除绝对本机路径**（`perf/README.md` 现有一处 `%USERPROFILE%\...`）——key-audit 发布前清单明令禁止；
- 迁移后立刻跑一次 `palm check`（绝对路径扫描）+ 仓库 hygiene 步，确认未引入违规。

**归档**
- `%SCRATCH%\dsh-palm` 下除 `perf/`、`node_modules/` 外的文件与目录 → `archive-20260912/`（**只移动，不删除**）；
- 归档目录放 `README.md`：归档时间、原因、清单、如何取回；已核实无计划任务/工具引用（不会打断自动化）。

**skill 改指向**
- `~/.dsh/skills/palm-release/SKILL.md`：把"四行用法"改为 `palm verify` / `palm check` / `palm report`，保留中断恢复表与铁律；明确"权威仍在仓库"。

**验收（设计文档 §9.11 的 9 条）**
1. `palm verify` 与 `pnpm verify` 结论一致且有报告；
2. `palm check` 四子检查可报（无变化全 `skip`）；
3. `palm perf` 能重跑 T1 并入库真机抓取；
4. `palm doctor` 全绿、`palm report` 出 MD；
5. 不变量测试通过（含无重复实现扫描）；
6. **卸载隔离**：删用户级目录后 `pnpm verify` 与 `release.mjs` 独立可用；
7. §9.10 六条各有测试；
8. 工具目录已纳入 key-audit 扫描范围（`run-key-audit-scan.cmd` 的 `--scan-dirs` 增加 `~/.dsh\tools`）；
9. `--report` 不传参行为逐字回归。

---

## 附：本计划的执行顺序与依赖

```
① verify.mjs --report  ──┬─→ ② palm 骨架 + 6 动词 ──→ ③ 六条缓解 + 不变量测试 ──→ ④ perf 迁入/归档/skill
   （阻塞项，PR 验 runner）        （依赖 ① 的报告接口）
```

- ① 必须先做且先验 runner：它是唯一触及发布链的改动。
- ③ 的"未知步骤 fail"依赖 ① 的报告字段；其余五条相互独立。
- ④ 的 `palm perf` 入库能力依赖 `perf/` 已经迁入，所以 ② 阶段 `palm perf` 先以"未迁移则报 `not-implemented`"过渡。

---

## 实施记录（2026-09-12）

### 步骤① 完成（含 runner 验证）

- `verify.mjs` 新增 `--report <path>`：严格附加式（不传参行为逐字不变）、写报告失败只告警、**不影响门禁结论**。
- 报告在门禁**退出之前**写出，因此 fail-fast 也能拿到部分结果；未运行的步骤记为 `skip / not run (fail-fast)`。
- 报告自描述：`context.{profile, selected, known}` —— 供 `palm` 做**门禁漂移检测**（§9.10 第 2 条）。这比设计文档 §7 多三个字段（附加式，符合"新增字段必须可选"的兼容规则）。
- 证据：本地 `8/8 PASS`（34.3s）；**真实 runner（PR #7）`check` pass + `release-preflight` pass**；PR 已关闭、分支已删，main 未受影响。

### 步骤② / ③ 完成

- 落地模块：`palm.mjs` + `lib/{run,repo,state,report,contract,check}.mjs`；测试在 `tests/`（`node --test`，**22 例全绿**）。
- 动词：`status` / `check` / `verify` / `report` / `doctor` 可用；`perf` / `probe` / `soak` / `release` / `cutover` 报 `not-implemented`（退出码 2）。
- 检查 id：`version-declaration`、`peer-consistency`、`contract-drift`、`bundle-size`（对应 §9.2 四项）+ `absolute-paths`、`stray-artifacts`（对应 §9.10 第 1、5 条）。
- 契约快照实测：**services 11**（正好等于关于页那 11 条宿主契约）、**frames 15**、events 124；服务名会用 **DSH 源码 checkout** 交叉校验，无源码时明确 `skip` 而非假绿。
- 缓解落地情况：锁（含 10 分钟陈旧接管）✓、未知门禁步骤 fail ✓、漂移判定（纯函数 + 测试）✓、doctor 陷阱检测 ✓、绝对路径扫描（含未跟踪文件，用 `git ls-files --others` 而非 porcelain）✓、临时文件检测 ✓。

### 与计划的偏差（均为收敛，不改变架构）

1. **契约提取覆盖不足**：`slots` 命中 0（槽位 id 的声明形式未覆盖），已在报告里标注"覆盖不足"；`events` 正则偏宽（124 条），未来可能产生"新增"噪声 —— 两者都只影响该单项可信度，且**都不会假绿**。
2. **`missingServices` 需要宿主源码**：服务名由宿主应用注册，不在官方包 `.d.ts` 内 → 增加 DSH checkout 扫描，无源码时 `skip`。
3. **`palm perf` 仍是占位**：临时基准文件清理（§9.10 第 1 条）随步骤④落地；当前由 `check.stray-artifacts` 与 `doctor.stray-artifacts` 负责发现。

### 自查中修掉的缺陷（全部属于本次新增代码）

线上 bundle 比对口径（URL 构建标签 ≠ 文件 SHA-256）、cordis 独立版本线、`report` 动词的失败语义、pnpm 符号链接导致官方包扫描为空、`missingServices` 误报、Windows 下 `process.exit` 触发 libuv 断言（`UV_HANDLE_CLOSING`）、`absolutePathScan` 漏掉未跟踪目录。

### 步骤④ 完成

- `perf/` 迁入仓库根 `perf/`（20 个文件；不在 npm `files` 白名单内，因此不进 tarball）。
- **消除绝对路径**：迁移时共发现 7 处本机路径，其中 4 个 perf 脚本用的是**正斜杠写法**——仓库 guard 正则与工具的第一版扫描都漏了这类。全部改为从 `import.meta.url` 推导仓库根（仍支持 `DSH_PALM_REPO` 覆盖），工具侧内置模式改为**正/反斜杠同时匹配**。
- 归档：根目录 260 个一次性文件 + 6 个临时目录（`chrome-cls-profile`、`preview-run`、`report-shot`、`style-gallery`、`tmp`、`perf` 原始副本）→ `archive-20260912/`（635 个文件），**只移动、不删除**，并附 `README.md` 索引。**未动** `adp/`、`awesome-dsh-plugin/`（核实为独立 git 项目）与 `node_modules/`。
- `palm-release` skill 的用法段改为指向 `palm`，并保留"删掉用户级目录后 `node scripts/...` 依然可用"的硬约束说明。
- `palm perf` 实现：`--capture <file>` 入库真机抓取（标签从文件名推导）；默认重跑 T1 并与上一份报告对照（total p95 / est-to-paint p95 / stress p95 阈值 +20%；`growthX` > 1.3 即 `fail`）；运行前后都清理临时基准文件。
- 证据：`node --test` **23/23**；`palm check` 六项全 PASS（扫描 22 个待提交文件）；仓库 `hygiene` PASS；`palm perf --capture` 正确写入仓库 `perf/baselines/`。

### 经验教训（已写进规范）

1. **文档里不要写字面路径示例**——"禁止本机路径"的说明本身会被该检查拦下（实测踩到，而且是被自己的工具抓出来的）。
2. **正斜杠是盲区**：本机用户目录与临时工作区路径的**正斜杠写法**必须与反斜杠写法同等对待；本机 `~/.dsh/repo-guard.regex` 目前只认反斜杠写法，建议后续同步收紧（注意 CI 侧是独立的 `REAL_IDS_REGEX` secret，改了本地文件不会自动同步）。
3. **归档前先核实目录是否为独立 git 项目**——按原计划"除 perf 与 node_modules 外全搬"会误伤 `adp/` 与 `awesome-dsh-plugin/`。

## M2 实施记录（2026-09-12）

### 设计里那个未决问题，先验证再动手

M2 的唯一停止条件是「探针若必须改插件源码才能拿凭据 → 停下重新设计」。取证结论：**不需要**。

- 真实配对流程可脚本化：`POST /api/pair/issue`（仅回环，且必须有 public/LAN base）→ 拿六位 `code` → `POST /api/pair/accept {code}` → `Set-Cookie: dsh_pair=<deviceId>`；设备落 `$DSH_HOME/dsh-palm-devices.json`。
- 数据通道：`POST /m/api/<method>`，四象限信封 `{type:'client-request', rpcId, method, payload}` → `{type:'server-response', rpcId, result:{ok,value|error}}`；SSE 在 `GET /m/api/events.mux`。
- 权威信号：`mobile.diagnostics` → `{checks:[{name,kind:'event'|'method',ok,reason?,frames,lastAt?}]}`。**订阅成功不算证据**：事件类契约必须 `frames > 0`（11 条：3 总线事件 + 5 `api-session/*` + 3 方法）。

### 交付

- `lib/probe.mjs`：配对 + RPC + SSE 采集 + 断言（`pair` / `host-rpc` / `turn-prompt` / `mux-stream` / `contracts-present` / `contracts-live` / `turn-events`）。
- `lib/canary.mjs`：金丝雀 scaffold/boot/HTTP 就绪判定/端口探测/整树停止，另支持 `--plugin <dir>` 把金丝雀的插件链接指向别的工作树（junction）。
- `lib/soak.mjs`：浸泡时钟（patch/rc 12h、minor/major 24h）、探针记录、毕业门（时长 + 成功率 ≥95% + 最近成功 ≤30min + **提交未变**）。
- `palm probe [--port N] [--url <base>] [--turn] [--keep] [--plugin <dir>]`：默认自建金丝雀；成功即写入进行中的 soak。
- `palm soak start|status|stop [--gate]`；`palm check` 新增 `test-lane`（test 必须是 main 的线性后继，否则毕业后无法 ff-only）。
- 实测：`palm probe` **PASS**（金丝雀 3099 → 真实配对 → 主机 RPC → SSE 4 帧 → 11 条契约全 ok）；`palm probe --turn` **PASS**（67 帧，`session/event=22`、`agent/assistant-stream=7`，回合类 2/2）；soak 联动记录成功。工具测试 25/25。

### 顺带修掉的三个 `dsh-compat canary-setup` 缺陷（都是"金丝雀起不来"的真因）

1. **不镜像 `node_modules`** → 金丝雀报 `cannot resolve profile bundle "@dsh-external/dsh-automation"`。改为复用 `verify` 已有的逐条 junction 镜像（幂等）。
2. **不拷 `settings.yaml`** → 插件没有 public/LAN base，配对直接 `409 lan-required`。改为与 `verify` 对齐，连 `.credentials.yaml` 一起拷。
3. **端口覆盖不更新**：`--port` 只在 patch 里**没有** `id: webserver` 时才追加，于是重跑后金丝雀仍绑 3081，而探针等 3099。改为就地改写端口行。

### 本轮踩到的坑（已进代码注释）

- **端口开 ≠ 应用就绪**：DSH 监听 2s 就开，`/m/` 要 ~9s 才 200。就绪判据必须是 HTTP 200。
- **先订阅、再造活动**：先 `session.create` 后连 SSE 会读到 0 帧，从而在完全健康的实例上"证明"流是坏的。
- **`run()` 走 shell**：`process.execPath` 含空格被截断（`'C:\Program' is not recognized`）——凡执行 node 一律用 `runNode`。
- `repoContext()` 的字段是 `packageVersion` 而非 `pluginVersion`，写错会静默退化成 minor/24h。

## M3 实施记录（2026-09-12）

### 交付

- **`release.mjs --from-head`**（仓库侧，附加式）：发布**已提交的 HEAD**，不再新建提交，校验反向化——工作树必须**干净**、HEAD 主题必须以 `v<version>:` 开头、`HEAD~1` 必须正好是上一个发布 tag、可选 `--expect-sha` 把发布绑死在**被浸泡的那个 sha** 上；`--from-head` 模式下版本号默认取自 `package.json`（消除"tag 了 1.3.7 却发 1.3.6"）。
- **`palm release`**：默认 dry-run，输出毕业门 + 顺序计划 + dist-tag 现状 + **回滚路径可用性**；`--apply` 才驱动 `release.mjs --from-head --apply --push --gh-release`；`--promote` 把 `next` 提升为 `latest`（带观察窗时长展示）。**设计停止条件写进代码**：dist-tags 读不到 → `rollback-path` FAIL → 拒绝自动发布。
- **`palm cutover`**：默认 dry-run；`--apply` 实现设计要求的**四条竞态处理**——① 判定后再查一次并取交集（`cutoverDecision`），② 重启前把活动读数与 HEAD 存档进 `state/cutover-<ts>.json`，③ 由**独立进程**（`lib/cutover-verify.mjs`）在 60s 内核对 served/disk bundle hash，不一致则回滚到上一个 tag → 走门禁的 build 步骤重建 → 再重启 → 再核对，④ 两次判定之间出现活动就放弃窗口（不排队硬切）。重启与核对交给独立进程，是因为 `schtasks /run /tn dsh-restart-now` 会杀死当时正在执行的工具调用。
- `--check-live`：只读核对线上 `mobile.js` served/disk 一致性。

### 验证

- `--from-head`：**隔离克隆集成测试 20/20**（tests/from-head.integration.mjs，非 `node --test` 自动跑）——覆盖 apply 只打附注 tag 且**不产生新提交**、tag 指向候选提交、脏树/错主题/错 sha 全部拒绝、原提交模式不受影响（附加性）。
- `palm release` dry-run：正确拒绝（无 test 灰度线、soak 已停止、0.2h < 12h），并给出 5 步计划与 `latest=1.3.6` 现状。
- `palm cutover` dry-run + `--check-live`：线上 `服务端 59ff6ad8 vs 磁盘 59ff6ad8 · v=b52c6b24` PASS。
- 工具测试 **27/27**；仓库门禁 **8/8**；`palm check` PASS。

### 本轮被自己的守卫抓出来的三个问题

1. **`pnpm build` 直调**（回滚路径里）违反不变量 1 → 改为 `verify.mjs --only build`，同一份门禁步骤，不再自建。
2. **生成式入口白名单缺 `release.mjs`** → 补入并写明理由（它是 M3 要编排的权威入口）。
3. **空闲判定是盲的、且错在危险方向**：`/api/pair/status` 对**未配对**调用者刻意隐藏设备列表（防隐私泄露），所以只看 HTTP 会永远读到"0 台设备 → 空闲"，可能在用户正跑回合时切生产。改为读**本机设备存储**（`$DSH_HOME/dsh-palm-devices.json`，纯只读、不写生产状态）取 `lastSeenAt`，并把它明确定义为 *presence 代理*：保守方向（宁可等下一个窗口）。

### 发布链测试台（registry chain rig）

设计停止条件是"做不到自动回滚 dist-tag 就不放开自动发布"，但在此之前它**只可静态检查**。`tests/registry-chain.integration.mjs` 把整条链真跑一遍（**17/17，退出码 0**）：

- 自起自停一个本机 `verdaccio`（`npx`，非容器——registry 的职责只是"一次性 npm"，容器化无收益），发布一个一次性包名（`PALM_PACKAGE_NAME` 接缝），跑 `publish → next → palm release --promote → palm release --rollback --to`，并用**独立于工具的 `npm view`** 断言 dist-tag 的真实落点。
- 覆盖 `--apply` 之前的 dry-run 不动指针、promote 记录回退目标、rollback 真的把 `latest` 移回去。
- 覆盖停止条件本身：registry 不可达 → `rollback-path` FAIL → `--apply` 被拒绝；非法 registry URL 立即拒绝。
- 每次运行都断言**真 npm 上 `@eternalloveone/dsh-palm` 的 `latest` 未被改动**。

新增 CLI 面：`--registry <url>`（覆盖 npm registry，非法即拒）、`--rollback --to <ver>`（自动回滚入口）。

**它当场抓到一个真回归**：`lib/release.mjs` 有一处语法错误（一次编辑把两条 `steps.push` 并成一行），导致 `palm release` 连模块都加载不了。`node --test` 里的 cli 测试本可抓到，但当时没重跑——所以这条测试台的价值不只是"跑通"，而是"持续跑"。

踩到的坑（已固化进测试台）：npm 客户端对目标 registry 无 token 时**先报 `ENEEDAUTH`**（根本不到 registry），而 `npm adduser` 无 TTY 无法完成 → 用 `publish: $all` + 独立 userconfig 里的占位 `_authToken`（`npm_config_userconfig` 给 harness、`NPM_CONFIG_USERCONFIG` 给工具），不污染真 `~/.npmrc`；verdaccio 默认 `--listen <port>` 在这台机器上只绑 IPv6 localhost，必须写 `0.0.0.0:<port>`；`npm publish` 不给 `--tag` 就会动 `latest`。

### Linux 容器金丝雀：**已能启动并激活插件**（外部探针仍待配）

目标：用 Docker 起一台**独立于本机生产环境**的 DSH，插件的 HTTP 探针（`palm probe --url`，只走 HTTP）直接打它。结论：**可行，已打通到"插件在 Linux 上激活 + 11 条契约自检全 ok"**。取证过程中逐层排除了五道栅栏：

1. **挂载 Windows checkout 进 Linux 不可行**：pnpm 符号链接依赖树不跨平台，boot app 时报 `Cannot find package '@deepseek-ai/dsh-client-locale'`。陷阱：`bin.js --help` 能跑通，看起来像成功。→ 必须用容器内自己安装的 DSH。
2. **本机已有可用底座**：`dsh-upgrade-verify:*` / `dsh-plugin-compat` / `dsh-pc-diag` 等镜像都是"容器内装好的 DSH"（`/app` 完整安装、CMD `node /app/apps/cli/lib/bin.js web --patch /port-overlay.yml --no-open --port 3080`、5 秒启动）。**不需要新建镜像**。
3. **Docker Desktop 的 Windows 挂载带不了 POSIX 权限** → DSH 的凭据栅栏（正确行为）拒绝 mode 777 的 `.credentials.yaml`。解法：把 home **拷进容器本地文件系统**再 `chmod`（挂载上 chmod 是空操作）；不发模型调用的探针**直接删掉该文件**更省事。
4. **`pnpm add` 会重链整个 node_modules**（换 store），在镜像自带 profile 上装包会破坏它（`StorageError: json backend is closed`、以及触发插件与 DSH 版本漂移 `installSettingsSection 不存在`）。解法：在**自己的最小 profile** 上从零安装（pnpm 12 全量装 43 包约 20s）。
5. **镜像的 DSH 版本必须对得上**——这是最后一道、也是真正致命的一道：镜像 `dsh-upgrade-verify:141eb6fef8` 是 **DSH `0.1.0-rc.8`**，其 `packages/api` 只有 `gateway`/`remotes`，**没有** palm 需要的三个服务提供者；报 `@eternalloveone/dsh-palm: pending (waiting for services: sessionController, workspaceController, settingsController)`。这三个服务由官方包 `@deepseek-ai/dsh-api-session-controller` / `-settings-controller` / `-workspace-controller` 提供（palm 的 `engines.dsh` 是 `>=0.1.5-rc.1`）。换成 **`0.1.5-rc.2` 的镜像**（本机有 `dsh-plugin-compat:latest`、`dsh-pc-diag:latest`、`dsh-upgrade-verify:…c291e7961a-src`）后一次通过。

**实测证据**（最小 profile = `dsh-base` + `dsh-web-app` + `dsh-palm`，插件从 registry 装）：

```
[canary] 准备 home: /dsh-home -> /root/ch
[canary] --- install --- + @eternalloveone/dsh-palm 1.3.6  (pnpm, 20.6s)
[canary] --- booting --- dsh web: http://127.0.0.1:3080/?token=…
[dsh-palm] 依赖自检（启动 3s）session.control=ok/1帧 session.follow=ok session.page=ok
           session.list=ok session/event=ok/0帧 api-session/added=ok/0帧 … agent/assistant-stream=ok/0帧
```

**已打通（第三套独立环境）**：per-boot token 只挡桌面 `/`，`/m/` 与 `/api/pair/*` 不受影响（实测 `/m/` 6 秒就绪）；配对栅栏只认 **loopback**，宿主经发布端口访问时源地址是网桥（172.17.0.1）会被按设计拒绝 → **把探针放进容器里跑**（工具是零依赖纯 Node，挂载后拷进容器，顺便让 state/ 不落宿主）。探针还需要仓库（契约基线），挂 `--repo` / `PALM_REPO` 即可。最终证据：

```
[canary] 等待 6s 后 /m/ 就绪
[palm] probe — PASS
  SKIP  canary-boot        使用外部实例 http://127.0.0.1:3080
  PASS  pair               真实配对流程成功（deviceId aaaee18c…）
  PASS  host-rpc           session.create → session-…；session.list → 1 项
  PASS  mux-stream         4 帧（窗口 5000ms）
  PASS  contracts-present  11 条契约全部 ok
[dsh-palm] 依赖自检（启动 3s）session.control=ok … agent/assistant-stream=ok
```

一条命令复现：`container/canary/probe-inside.sh` +
`docker run --rm --entrypoint sh -v <tool>:/tool:ro -v <repo>:/repo:ro -v <canary-home>:/dsh-home -e PALM_SOURCE_HOME=/dsh-home -e PALM_REPO=/repo dsh-plugin-compat:latest -c "sh /canary.sh"`。

### DSH 跟随触发器（`palm follow`）

设计 §10 只把它定位为"接入同一条流水线的触发器"，实现也保持这个边界：**只发现移动，不重写任何检查**。

- 三个独立观测量：本地 checkout 的 `package.json` 版本、本地提交、官方包 `@deepseek-ai/dsh-client-connection` 的 dist-tags（`next`/`latest`）。
- 退出码即契约：**0 = DSH 未移动；1 = 移动了且没人接手** —— 定时任务/CI 可直接据此动作。
- `--apply` 记录新基线（`state/follow.json`，schema `dsh-palm.lifecycle.follow/1`）＝"已接手升级"。
- 移动时指出下一步 `palm check --target <新版本>`（契约漂移门在 `palm check` 里，不在这里重复实现）。
- 纯比较逻辑 `followPlan` 有单测（版本/提交/官方 next 三个方向各自的移动都能识别；官方 `latest` 单独变化不算移动）。

实测：首次 `follow` exit 0 并提示记基线；`--apply` 记录基线；复跑输出 `DSH 未移动` exit 0；当前观测 `0.1.5-rc.2 @ 6cb0d6c2fb；官方 next=0.1.5-rc.2`。

### 生产切换演练（cutover 全链，重启以 no-op 替代）

为让演练**不碰生产**，把重启做成可注入（`--restart-cmd`），于是整条状态机可以在真实生产配置上跑：

```
PASS  window      未指定时间窗（全天可切）
PASS  decision    --force-idle 覆盖了活动判定
PASS  archive     已存档 state/cutover-1789197665929.json
PASS  verifier    独立核对进程 pid 23340
PASS  restart     演练：重启已替换为 ...（未触碰生产）
```

独立进程 1 秒后写回存档：`outcome: verified`、`detail: 服务端 59ff6ad8 vs 磁盘 59ff6ad8`；演练后生产 `/m/` 仍 HTTP 200。

顺带两处改进：

1. **回滚安全闸**：自动回滚前先查工作树，**脏则拒绝 checkout 并只告警**（`outcome: needs-manual-rollback` + 前 12 行 `git status`）——宁可告警，也不把本地未提交改动带上生产。
2. **诚实性**：注入了 `--restart-cmd` 时，报告不再声称"已触发 dsh-restart-now"，而是明确写"演练：重启已替换为 …（未触碰生产）"。

演练中四条竞态处理**真的拦了一次**：首次演练时手机 1 分钟前刚活跃，`decision` 直接 FAIL 并放弃窗口（不排队硬切）——这是设计要的行为，不是缺陷。

**仍未演练**：真实的 `schtasks /run /tn dsh-restart-now` 与回滚分支（前者会杀掉当时正在执行的工具调用，必须由人在窗口内发起）。

脚本：`container/canary/dsh-image-canary.sh`（最小 profile 路线，当前可用）、`container/canary/image-profile-canary.sh`（镜像自带 profile 路线，被栅栏 4/5 挡住）、`container/canary/linux-canary.sh`、`container/canary/which-provides.sh`（记录失败路线，供以后避坑）。

### 测试流程：一个入口

`node tests/all.mjs`（`--quick` 只跑 `node --test`）把三套件收敛成一个入口和一个退出码：`node --test`（单元/不变量/CLI）+ `from-head.integration.mjs` + `registry-chain.integration.mjs`。两个集成测试台故意命名 `*.integration.mjs`（不被 `node --test` 自动发现，因为它们会起容器/registry），所以必须有东西显式点名它们——否则"发布前跑一遍"会悄悄停止发生。

### 测试框架自查（2026-09-12）

用机械手段查而不是凭印象：模块↔测试覆盖映射、只读动词是否写盘、超时保护、宿主路径扫描、状态增长速率、残留物。

查出并修掉的问题：

| 问题 | 结论 | 处置 |
|---|---|---|
| 集成测试台**无超时保护** | verdaccio/DSH 一旦挂住，harness 永远拿不到结论 | 每套件 20 分钟上限 + `SIGKILL` + 明确写出超时 |
| 环境不可用**误报 FAIL** | 离线/无 Docker 时 exit 2 被算作失败，会训练人忽略红字 | exit 2 → SKIP 并打印原因；摘要区分「--quick 跳过」与「环境不可用」 |
| reports 轮转 | **原判断有误**：轮转早已存在（`persist(keep=50)`）；真实缺口是 `prune` 只清 `.json`，`.md` 永不清理 | 已改为与 `listReports` 同过滤器 + 单测（旧 `.md` 必被剪掉） |
| **没有任何自动门** | "发布前跑一遍"纯靠自觉 | `tests/all.mjs` 落 `state/harness.json`（schema `dsh-palm.lifecycle.harness/1`）；`palm release` 的毕业门拒绝**缺失 / 非全绿 / 仅 `--quick` / 超 24h** 四种情形，报告新增 `harness` 检查项 |
| 测试/演练写真实 state | 只读动词实测不写盘（58→58），但 probe/演练会落真实目录 | `stateDir()` 支持 `PALM_STATE_DIR` 覆盖（`reportsDir`/`loadState`/`withLock` 自动继承）+ 单测 |
| `probe.mjs`(257 行) 等无直接测试 | 覆盖空洞 | 新增 `tests/probe.test.mjs`：**假插件**跑通整条探针（SSE 跨 chunk 重组、无 data 块不计帧、坏 JSON 仍成帧、非 200 流如实报错、信封 rpcId 不符即拒、present-but-silent 与 broken 分开判定）＋ `canaryPaths`/`canaryReady`/`PALM_STATE_DIR`/`persist` 轮转单测 |
| `cli.test.mjs` 真连 npm | 网络依赖 | 改为各动词适用的离线断言（release 用"非法 registry 立即拒绝"，其真实 dry-run 由 registry 测试台证明） |
| 宿主路径 | 全目录仅 1 处，且是帮助文本里的默认值说明 | 无需改动 |

自查过程中自己踩的坑（都已修）：**重复 import** 会让整个测试文件加载失败（`node --test` 静默只跑 11 项）；把 `--registry` 指向**死端口会让 npm 重试约 2 分钟**（套件 6s→227s，改用非法 URL 瞬时拒绝）；在 `persist` 建目录**之前**写文件 → ENOENT。

最终：`node --test` **60 项**、`from-head` 20 项、`registry-chain` 17 项，`[all] 3/3`，`harness.json ok=true`，毕业门据此由"拒绝"转为 PASS（只剩真实原因：无灰度线、未浸泡）。

### 容器多轮端到端闭环（Docker）

Windows 侧的切换每次都会打断会话，因此**多轮**只能放到容器里做：容器里的 DSH 被杀不影响宿主工具调用，可以连续跑、无人值守。

一条命令（`container/canary/rounds.sh`，`ROUNDS=N`）：每轮**真重启容器内 DSH → `palm cutover --apply` → `palm probe`（真配对/RPC/SSE/11 契约）**。实测 3 轮：

```
第 1 轮  切换 verified observed=true pid=108→226   探针 contracts-present ok  PASS
第 2 轮  切换 verified observed=true pid=226→368   探针 contracts-present ok  PASS
第 3 轮  切换 verified observed=true pid=368→520   探针 contracts-present ok  PASS
[rounds] 3/3 轮通过
```

它逼出了两个**只在非 Windows 环境才现形**的真 bug，都是"静默返回 0"这类最难查的：

1. `listenerPid` 只 shell **Windows 的 `netstat -ano`** → Linux 恒 0 → pid 永不"换手" → **每次切换都被判 `restart-not-observed`**。修法：补 `ss -ltnp` / `netstat -ltnp` 解析，并加**纯 `/proc/net/tcp` inode 回溯**（精简镜像里 `ss`/`netstat`/`lsof`/`fuser` 全都没有）。
2. 即便加了 `/proc`，`'3080'.toString(16)` 返回 **`'3080'`**（字符串不转进制）→ 端口十六进制恒错 → inode 匹配恒空。修法：`Number(port)`。这一处没有任何报错，只表现为"重启观测失灵"。

另一个设计层面的发现：**全新 DSH home 没有设备表** → 活动判定"无法判定 → 放弃窗口" → 新装环境永远切不了。`rounds.sh` 因此加了**引导探针**（先配对一台设备——真实升级流程本来就会先跑探针）。

边界：容器能做插件侧全部（安装/启动/探针/契约/切换/重启观测/失败分支），**不能**替代 Windows 专有的 `schtasks` 重启（已在真机验过 3 次）、仓库门禁 `palm verify`（pnpm 符号链接树无法挂载）、`release --apply`（推 GitHub + npm）与 12h 浸泡。

### 回滚分支（fixture 仓库，绝不拿生产试探）

`container/canary/rollback-branches.sh` 用受控 fixture 仓库覆盖回滚路径：tagged 提交的 `lib/mobile.js` **等于该 DSH 实际提供的字节**，HEAD 故意不同 → 一致性核对必然失败 → 进入回滚分支。两个分支各自断言：

- **工作树脏** → 必须只告警（`needs-manual-rollback`）、**不得记录为已尝试回滚**、且**不得改动工作树**（HEAD 仍是候选提交）。
- **工作树干净** → 必须 `git checkout --detach <上一发布 tag>`、跑仓库自己的构建步骤、再复检，最终 `rolled-back`。

之所以必须用 fixture：真实回滚会 `checkout` + 重建 + 重启，**在真机上试错等于拿线上服务赌博**；fixture 里每个输入都是构造的，两个分支都能断言到具体字节。

演练本身也暴露了一处顺序语义：核对进程**先要求观察到重启**，再判一致性——这是对的（不能对着待替换的服务做核对），但意味着**任何绕过真实重启的回滚测试都必须显式声明 `restartInjected`**，否则会停在 `restart-not-observed` 而根本走不到回滚逻辑。

实测（`rollback-branches.sh`，4/4 断言）：

```
分支 A（脏树）  needs-manual-rollback attempted=no   HEAD 未动            PASS
分支 B（净树）  rolled-back attempted=yes ok=yes     HEAD 切到 v0.0.1     PASS
```

回滚演练还逼出了**第三个真 bug**，与 bug C（存档悬空）同源但更隐蔽：回滚成功后要触发重启，而 `spawn` 失败（Linux 无 `schtasks`）是**异步 `'error'` 事件**——`try/catch` 抓不到，**没有监听者就是未捕获异常** → 核对进程当场死亡、存档永远停在 `prepared`。修法：三处 `spawn`（核对进程的回滚重启 + `triggerRestart` 的两条路径）都挂上 `child.on('error')`，失败降级为一条日志（"触发重启失败：ENOENT——回滚可能未生效"）而不是静默猝死。

### DSH 版本兼容矩阵（容器）

`container/canary/compat-matrix.mjs` 把同一套容器金丝雀跑遍本地每个 DSH 镜像，输出对照表并落 `state/compat-matrix.json`。实测（8 个镜像）：

| 镜像 | DSH 版本 | install | boot | 契约 | 配对 | 判定 |
|---|---|---|---|---|---|---|
| `dsh-plugin-compat` / `dsh-pc-diag` / `dsh-upgrade-verify:…c291e7961a` | 0.1.5-rc.2 | ok | yes | pass | pass | **PASS ×3** |
| `dsh-all-verify` / `dsh-palm-verify` / `dsh-verify-base` | 无 | – | – | – | – | NO-DSH（非 DSH 运行镜像） |
| `dsh-upgrade-verify:…v0.1.1-rc.2-src` | 0.1.1-rc.2 | ok | no | – | – | BOOT-FAIL |
| `dsh-upgrade-verify:141eb6fef8` | 0.1.0-rc.8 | ok | no | – | – | BOOT-FAIL |

**诚实解读（已修正一次）**：三个 0.1.5-rc.2 镜像是**相互独立**的，都 PASS——结论不依赖某一个镜像的偶然状态。两个旧版本镜像最初被我判为"模板 profile 不匹配，结论未定"，**这个判断是错的**：把启动日志完整打出来后，两个版本的失败原因**逐字相同**——

```
Error: dsh: plugin tree failed to load: dsh: 1 entry did not activate
@eternalloveone/dsh-palm: pending (waiting for services: sessionController, workspaceController, settingsController)
```

DSH 本身启动正常、插件也被加载，但插件**永远 pending**：它在等 `session/workspace/settingsController` 三个服务，而 0.1.0-rc.8 / 0.1.1-rc.2 不提供这些包（`engines.dsh >= 0.1.5-rc.1` 正是这条边界）。随后 DSH 因为"有 entry 未激活"**拒绝启动整棵树**。

⇒ 这是**真实不兼容**，且关键在失败模式：**fail-fast——整机起不来**，而不是静默跳过插件。用户在旧 DSH 上装这个插件不会得到"插件未启用"，而是**整个 DSH 无法启动**，这是需要正面告知的升级风险。

教训（关于我自己的诊断）：第一次看到 `} Node.js v22.23.2` 这样的堆栈页脚，就"合理地"推断成模板依赖不匹配，还据此写了结论和改进方案——**推断被当成了证据**。真正解决它的是把日志的**头部**打出来（错误在页脚之前）。判定口径现在写死在矩阵脚本里：BOOT-FAIL 必须连原因一起报，且区分"插件 pending（真实不兼容）"与"测试框架问题"。

### 外部（非 loopback）探针：已测量，结论是"设计上不可行"

此前的诚实清单里写着"外部探针受 token 闸门 + 非 loopback 配对限制"，状态是**待配**。现在把它变成了测量结果（`container/canary/external-probe.mjs`：同一 Docker 网络两个容器，A 跑 DSH+插件并自跑 loopback 探针，B 从 bridge 地址探）：

| 视角 | 契约 | 配对 | 直连 `/` | 直连 `/m/` |
|---|---|---|---|---|
| A 内部（loopback） | pass | pass | – | 200 |
| B 外部（bridge） | absent | **fail** | **401** | 200 |

外部失败原因：`pair: pair issue failed: HTTP 403 {"ok":false,"code":"forbidden"}`。

⇒ `/m/` 从外部**可达**（200，手机界面正是这么用的），但**配对/RPC 被 403 拒绝**（非 loopback 铁律），根路径还需 per-boot token（401）。所以**外部探针不是"还没配"，而是在当前设计下不该有**：受支持的远程路径是"受信隧道 + 公开基址"，而不是让外部进程直接调配对接口。

矩阵首轮还暴露一个工具可用性瑕疵：`palm probe` 也要求仓库上下文（缺 `PALM_REPO` 时直接拒跑），而 probe 是**运行时**动词、与仓库无关——首轮因此把三个本来可用的镜像误报成 `契约=?`。另有 DS H 版本不在 `/app/apps/cli/lib/package.json`（需多候选路径）等框架问题，均已修。

### 尚未验证 / 尚未实现（诚实清单）

- **未在真实生产上执行过 `cutover --apply`**：它会重启宿主并杀死本会话正在进行的工具调用，必须在时间窗 + 无活动会话时由人发起。因此"重启 → 60s 核对 → 自动回滚"这条链**只有静态与只读验证**，没有实战证据。
- **未执行 `palm release --apply`**（会推 GitHub + 触发 npm 发布）：当前没有 test 灰度线、没有完成浸泡的候选提交，且需要明确授权。
- **DSH 跟随触发器未实现**：设计 §10 只把它定位为"接入同一条流水线的触发器"；目前 `palm check --target <新版本>` 提供升级前体检，但**没有**"发现官方包新版本/本地 checkout 移动 → 自动起流水线"的发现器。

**M2 的定时触发已安装**：计划任务 `palm-soak-probe` 每 30 分钟跑一次 `probe-soak.cmd → palm probe`（不带 `--turn`，不花模型调用；实测单次 ~16s）。任务设置：`MultipleInstances=IgnoreNew`（防重入，否则端口冲突会把失败样本写进 soak）、`ExecutionTimeLimit=PT15M`（防挂起后永久跳过）、交互态身份。日志 `state\probe-soak.log`（1MB 轮转，**按 UTF-8 读**：包装脚本里 `chcp 65001`，否则 node 的 UTF-8 与 cmd 的 GBK 混写变乱码）。无活动 soak 时它只作金丝雀健康心跳。正式浸泡仍须在 `test` 分支的候选提交上 `palm soak start`。

**M2 遗留（非阻塞）**：探针每轮会在金丝雀 home 里建一个会话（`session.create`，用于产生 roster 活动）；12h 浸泡约 24 个，量级可忽略，但长期运行前可考虑在探针尾部用 `workspace.archiveSession` 收尾。
