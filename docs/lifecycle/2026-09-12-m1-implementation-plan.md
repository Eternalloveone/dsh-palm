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
5. **绝对路径扫描**：`palm check` 扫待提交文件中的 `C:\Users\...`、`%SCRATCH%` 等本机路径 → `fail`。
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
