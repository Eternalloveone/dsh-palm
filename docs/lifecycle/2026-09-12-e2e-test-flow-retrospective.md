# dsh-palm 端到端测试流程复盘（2026-09-12）

> 本文回答一个问题：**从"改了一行代码"到"手机上真的用上了"这条链，哪些环节已经有真实证据，哪些还差，以及为什么。**
> 所有结论都标注了证据形态（真实运行 / 容器 / fixture），fixture 证据一律显式标记，绝不与生产证据混同。

## 0. 装置清单（东西都在哪）

| 位置 | 内容 |
|---|---|
| `~/.dsh/tools/dsh-palm-lifecycle/` | 生命周期 CLI `palm`（零依赖纯 Node、DSH 版本无关）；测试层 `tests/`；容器装置 `container/canary/`、`container/release/`；定时跟随检查 `follow-check.{mjs,cmd}` |
| `~/.dsh/tools/dsh-upgrade-verify/` | 候选 DSH 版本的**镜像构建器** `upgrade-verify.mjs` |
| `~/.dsh/skills/palm-release/SKILL.md` | 权威用法（何时用、为什么、出事怎么恢复） |
| 仓库 `packages/dsh-palm/scripts/verify.mjs` | 仓库门禁（本地 CI 镜像，8 步） |
| 仓库 `scripts/release.mjs` | 发布驱动（一版一提交；`--from-head` 发已提交的 HEAD） |
| 仓库 `.github/workflows/{ci,publish}.yml` | **真正的 npm 发布发生在这里**（push tag 触发） |

计划任务：`palm-soak-probe`（每 30 分钟探针）、`palm-follow-check`（每天 09:30 上游跟随检查）、`dsh-restart-now`（宿主重启，唯一允许的重启入口）。

## 1. 流程全貌（九段）

```
① 上游监测      palm-follow-check（每日）    → MOVED 时下一步：palm check --target <新版本>
② 升级体检      palm check --target          → 契约快照 diff / 包体积门 / 本机路径扫描 / 门禁漂移
③ 适配（人工）  按报告改源码与测试            → dsh-plugin-adapt 负责分类与路由；这一步刻意不自动
④ 容器回归      compat-matrix / rounds / rollback-branches
                镜像由 upgrade-verify.mjs 构建 → 任何候选 DSH 版本都能造出基座
⑤ 本地门禁      cd packages/dsh-palm && pnpm test && pnpm verify && pnpm build
⑥ 造候选提交    git checkout -b test; node scripts/release.mjs <ver> --summary "…" --apply   # 先不 push
⑦ 浸泡          palm soak start（patch/rc 12h、minor/major 24h）+ 30 分钟定时探针
⑧ 毕业发布      palm release → --apply（推 main+tag）→ GitHub Actions publish
                → release.mjs --check <ver> --wait → dist-tag next → 观察窗 → --promote
⑨ 切换验收      palm cutover --apply（时间窗）→ 核对由独立进程完成 → /m/ 200 + served==disk + 手机点验
```

**铁律：④⑤ 必须排在 ⑥ 之前。** 浸泡记录的是**提交 sha**，而 `release.mjs --from-head` 的检查是反向的（工作树必须干净、HEAD 必须就是被浸泡的那条提交，脚本原话 `commit them on the test lane`）。"先验证再提交"的顺序会让浸泡无处落脚。

## 2. 证据台账（哪些已经是真的）

| 环节 | 判定 | 证据形态 |
|---|---|---|
| 单元/集成/演练 | ✓ | `node --test` **65 pass**；`tests/all.mjs` 3/3（from-head 20/20、registry-chain 17/17）；`e2e-rehearsal` 13/13 |
| 仓库门禁 | ✓ | `palm check` PASS；`verify.mjs` 8/8（Windows） |
| 探针（配对 / 主机 RPC / SSE / 11 契约） | ✓ | 容器内 3 镜像 × 3 轮全绿；矩阵含新构建镜像 PASS |
| **真实切换（生产 Windows）** | ✓ **3 次** | 观察到监听 pid 换手（`observed=true`）→ `outcome=verified`；pid 28112→30496；任务自删、launcher 清理；`/m/` 200；served==disk `59ff6ad8` |
| 容器多轮真重启 | ✓ | `rounds.sh` 3/3，pid 链 108→226→368→520 |
| 回滚两分支 | ✓（fixture） | `rollback-branches.sh` 4/4：脏树 → 只告警不改工作树；净树 → `rolled-back`、HEAD 回到 tag |
| 发布链 dist-tag 生命周期 | ✓（verdaccio） | registry-chain 17/17 |
| 毕业门 | ✓（fixture 记录） | 离线发布装置：门 PASS、无 blockers；真委托仓库 `release.mjs` 执行 |
| 离线发布装置 | ✓ | 毕业门 PASS → 真委托 → **被仓库自身 preflight 拒**（fixture 树无版本号/CHANGELOG 变更，属预期） |
| DSH 版本兼容矩阵 | ✓ | 3 个 0.1.5-rc.2 PASS；3 个无 DSH（NO-DSH，按设计）；0.1.0-rc.8 / 0.1.1-rc.2 **真实不兼容**（插件 pending 缺 3 个 controller → DSH 拒绝启动整树，fail-fast） |
| 外部探针 | ✓ 已测量 | 设计上不可行：外部 `/m/`=200、`/`=401、配对返回 403 |
| **镜像供给链** | ✓ | 拉取修复（WinHTTP）→ 构建 28 min 产出镜像 → **矩阵 PASS（105 s，install ok / boot yes / contracts pass / pair pass）** |
| 上游跟随检查 | ✓ | 任务 `palm-follow-check` Last Result 0，产物 `state/follow-check.{log,json}`，判定 `steady` |

## 3. 这一路逼出来的真 bug（13 个）

**工具侧（5）** —— 全都在真实执行时才暴露：

1. `listenerPid` 只 shell Windows `netstat -ano` → 容器里恒返回 0 → 每轮切换都判 `restart-not-observed`
2. `'3080'.toString(16)` 返回 `'3080'`（字符串忽略基数）→ `/proc` inode 匹配恒空、静默返回 0
3. `spawn` 的 ENOENT 只以异步 `'error'` 事件呈现，`try/catch` 抓不到 → 未捕获异常杀死核对进程 → 存档永悬 `prepared`
4. `palm probe` 无仓库上下文时拒跑 → 纯运行时动词不该有这个依赖（已修：只有 `probe` 放行，其余仍 fail-fast）
5. **`palm release --apply` 因 `step is not defined`（调用了不存在的函数）从来没有跑通过** —— 整条路径一执行就 ReferenceError（已修）

**装置侧（我的脚本，5）**：仓库存在 `refs/remotes/origin/test/protection-check` 导致 git 拒绝创建 `origin/test`；npmrc 指向尚未启动的 verdaccio（鸡生蛋）；把 stderr `2>/dev/null` 丢掉导致白跑两轮；`harness.json` 的 `at` 必须是**毫秒**而非 ISO 字符串；verdaccio 未预装导致等待窗口太短。

**builder 侧（3）**：`verify-webchatlike.mjs` 缺失 → L3.5 恒失败 → **永远无法 PASS**；settings.yaml 残留 Windows 路径 MCP 行（`screenshot`）未被消毒；L2 要求 `/` = 200 而实测 404（与本项目无关：矩阵用最小 profile，不依赖镜像自带 profile 首屏）。

**归类教训：其中 6 个属于"默认路径不可能成功"** —— 没有任何人真的执行过一次。凡是写进默认路径的东西，必须至少被真实跑过一次。

## 4. 可复用的教训

1. **默认路径必须被真实执行过一次。** `step is not defined` 和缺失的 `verify-webchatlike.mjs` 是同一类：代码看起来完整，但默认路径一跑就死。
2. **永远不要丢 stderr。** 两次白跑（`2>/dev/null` + 只看 exit code）都是自己造成的。
3. **用工具自己的判定函数校验构造的证据。** 构造浸泡记录时，先拿 `soakVerdict` 自检，而不是自己数探针条数。
4. **读日志要看头部。** 曾把堆栈页脚当证据，误判旧 DSH 的不兼容原因。
5. **环境类结论必须实测。** "Docker Hub auth 失败"实际是 WinHTTP `Direct access`；"改手动代理需要开 Clash Allow LAN" 被证据推翻。
6. **顺序即语义。** 浸泡绑提交 sha，所以验证必须在造候选提交之前。
7. **只读监控的退出码要用数据表达。** `palm-follow-check` 恒退出 0，把"移动/未移动/不可用"写进产物——否则 `Last Result 1` 会被读成"任务坏了"，真正的信号反而没人看。
8. **容器能逼出宿主机测不出来的 bug。** 跨平台 pid、大小写/inode、路径语义，全部只在 Linux 容器里暴露。

## 5. 现状：闭环到哪一步（诚实清单）

**已闭环（有真实或高保真证据）**：监测 → 体检 → 容器回归 → 门禁 → 毕业判定 → 发布链机制 → 切换/核对/回滚逻辑 → 部署验收。

**未闭环（三条，原因明确）**：

| 缺口 | 为什么没做 |
|---|---|
| **真实发布** | npm 发布发生在 **GitHub Actions**（push tag 触发 `publish.yml`）；本机最多走到 tag push。要做需要：`test` 灰度线 + 满 12/24h 浸泡 + 你的授权 |
| **12/24h 浸泡** | 钟不可压缩。只用构造记录（显式 `fixture: true`）验过**判定逻辑**，不是真实浸泡 |
| **手机浏览器侧** | PWA/SW 缓存、拍照、IndexedDB 历史缓存：无自动化，只能人工点验（发布前清单里的"手机端实际点验关键界面"） |

另：**生产环境的真实回滚故意不做** —— 策略是"已发布就发补丁版"；回滚分支逻辑已用 fixture 验过 4/4。

## 6. 要真发布时的操作序列

```powershell
# 0) 决定版本号与变更摘要（素材由你给）；决定 perf/ 是否入库（建议排除）
cd <dsh-palm 检出目录>\packages\dsh-palm
pnpm test && pnpm verify && pnpm build      # 版本号构建期内联，必须重建
cd ..\..

# 1) 建灰度线，造"那一版一提交"（先不 push）
git checkout -b test
node scripts/release.mjs <ver> --summary "<摘要>" --apply
git push -u origin test
palm check                                   # test 必须是 main 的线性后继

# 2) 浸泡（patch/rc 12h、minor/major 24h）
palm soak start
palm soak status --gate                      # 必须 exit 0

# 3) 毕业发布（不可逆，需要授权）
palm release                                 # dry-run 先看
palm release --apply                         # 推 main + tag → 触发 publish.yml
node scripts/release.mjs --check <ver> --wait
npm dist-tag add @eternalloveone/dsh-palm@<ver> next
palm release --promote --version <ver>       # 观察窗后 next → latest

# 4) 切换与验收（会重启宿主、打断当前会话）
palm cutover --apply --window 22:00-06:00
palm cutover --check-live                    # served == disk
#   手机打开 /m/ → 关于 应显示「版本 <ver> · 构建 <hash>」
```

**中断恢复**：push main 成功但 tag 失败 → `git -c http.proxy=<本机代理>:7897 push origin v<ver>`；CI publish 失败 → 去 Actions 页 **Re-run**（workflow 幂等），**绝不在本地 `npm publish` 抢发**；注册表查不到 → 正常，有 ~4 分钟延迟。**已推送的 tag 不可删重建，只能往前发补丁版。**

## 7. 日常运维命令

```powershell
# 上游动了吗（只读监控）
Get-Content ~\.dsh\tools\dsh-palm-lifecycle\state\follow-check.log -Encoding UTF8 -Tail 5
schtasks /run /tn palm-follow-check

# 全套测试（--quick 只跑单元）
node ~\.dsh\tools\dsh-palm-lifecycle\tests\all.mjs

# 兼容矩阵：单跑某个镜像（清单自动发现，无需登记）
cd ~\.dsh\tools\dsh-palm-lifecycle\container\canary
node compat-matrix.mjs --only <镜像名子串>

# 为候选 DSH 构建容器基座（本地目录目标；tag 目标会撞补丁冲突）
node ~\.dsh\tools\dsh-upgrade-verify\upgrade-verify.mjs <checkout 绝对路径> --proxy --port 3199 --no-webchat

# 门禁记录（注意 at 是毫秒时间戳）
node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.USERPROFILE+'/.dsh/tools/dsh-palm-lifecycle/state/harness.json','utf8')))"
```

## 8. 已知未修项（不影响闭环，但要记着）

- `upgrade-verify.mjs` 自身判定永远无法 PASS（缺 `verify-webchatlike.mjs`）→ 用镜像即可，或接线时固定 `--no-webchat`
- builder 的 settings.yaml 消毒未覆盖非 POSIX 路径的 MCP 行
- 构建默认不走代理 → 建议固定 `--proxy`（这次直连 npm 出现大量 `ECONNRESET`，28 分钟里绝大部分耗在这）
- 仓库工作树有未提交改动（`packages/dsh-palm/scripts/verify.mjs`、`scripts/release.mjs`、`docs/lifecycle/`、`perf/`），**本轮未复核**；它们会随下一个发布进入那条唯一提交，动手前先决定 `perf/` 去留
