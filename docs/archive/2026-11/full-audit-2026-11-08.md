# 全量审核 · dsh-palm（2026-11-08）

审核范围：`~\dsh-source\dsh-palm`，分支 `refactor/v2`，HEAD `001696b`。
方法：读代码 + 跑门禁 + 真机探针（带配对 cookie 的浏览器）。**只信工具输出，不引用上一轮的自我描述。**

## 一、结论

1. **门禁是真的全绿**，但绿不等于对：现有断言覆盖「代码写对了」，覆盖不到「代码有没有被生产调用」「点下去去了哪一页」。
2. 本次靠「导入图 + 真机点击」抓出 **5 个这类缺陷**，其中 **3 个已修**（⑥ 批准方式 / ⑦ 上下文 / ⑭ 外观此前都点不进去），2 个记录待处理（345 行未接线内核、文档漂移）。
3. 项目整体健康：audit 0 漏洞、死样式 0、预算净降 276 行、覆盖率 79.7%、CI 有 `pnpm verify` 镜像。

## 二、实测数字

| 项 | 数值 |
|---|---|
| 单测 | **2,880 passed / 253 文件**（1 expected fail、11 skipped）|
| 覆盖率（`vitest --coverage`）| stmts **79.68%** / branch 72.53% / funcs 77.16% / lines 82.76%（CI 阈值 68/62/63/70）|
| 覆盖最弱 | `src/mobile/api` **60.06% stmts**、`mobile-api.ts` 53.4% |
| 覆盖最强 | `src/mobile/wire` **97.43%** —— 但生产零引用（见四）|
| 依赖漏洞 | `pnpm audit --prod` → No known vulnerabilities |
| 死样式 | 可删 **0** 个（测试仍引用 2 个类，故意保留）|
| 行数预算 | 通过；本次净 **−276 行**（`src/mobile` 63,168 → 62,892）|
| 源码规模 | 380 个生产文件 / 5.4 MB；最大文件 `ChatView.tsx` **4,198 行**（预算 4,198，无余量）|
| 类型债 | `any` 4、`@ts-ignore` 0、TODO 0、空 catch 2、非空断言 3 |
| a11y 债 | `div/span` 上 `onClick` **10 处**（键盘不可达）；内联 `style={{` **26 处**（正好卡在预算上限）|
| CI | `.github/workflows/ci.yml` → `pnpm verify`（install/build/coverage/typecheck/audit/hygiene/pack/commitlint）|
| 提交 | 506 个；本轮新增 `001696b` |

## 三、本轮修掉的（都有真机证据）

| 缺陷 | 表现 | 修法 | 证据 |
|---|---|---|---|
| ⑥ 批准方式页 | 点权限胶囊弹的是**旧选择面板**（`.chat-picker-panel`），页面打不开 | `openPermissionPicker` 接入 `permissionEntryTarget()` | 探针：`.approval-mode-page`=1、sheet=0、标题「批准方式」|
| ⑦ 上下文页 | 点上下文条弹的是**旧气泡**，页面打不开 | `toggleContextPop` 接入 `contextEntryTarget()` | 探针：`.context-page`=1、popover=0、标题「上下文占用」|
| ⑫ 大纲页 | 怀疑不可达 | 探针实测**可达**（滚动后滑杆出现→轻点）| `.outline-page`=1、标题「大纲 · 共 667 轮」|
| 生产日志噪声 | `ChatView` 里 8 处无条件 `console.debug` | 删除（顺带把行数拉回预算内）| 4206 → 4198 行 |
| 入口归属无断言 | 上述两个缺陷全绿也发现不了 | 新增 `chat/state/entry-routing.ts` + **5 条单测** | `pnpm test` 2880 passed |

> 说明：⑫ 之所以先前怀疑，是我用 JS 改 `scrollTop` 却没派发 `scroll` 事件，滑杆不渲染——**是探针错，不是代码错**。

## 四、没修但必须知道（按优先级）

### P1 · 345 行「生产未接线」的内核 + 它们的测试与 ADR

按导入图求入度，生产入度为 0 的文件：

| 文件 | 行数 | 谁在用 | 建议 |
|---|---|---|---|
| `mobile/wire/frames.ts` | 46 | 仅测试 | **删**：生产已由 `shared/mux-frames.ts` + `mux.ts:parseMuxEnvelope` 做同样的守卫，属重复实现 |
| `mobile/wire/handshake.ts` | 109 | 仅测试 | **删**：前后端同包发版，没有版本漂移场景 |
| `mobile/wire/version.ts` | — | 仅被上面两个用 | 随上面一起删 |
| `mobile/design/desktop-parity.ts` | 120 | 仅测试 | 接线（设置页对比桌面端缺口）或删 |
| `mobile/kernels/cache-exceptions.ts` | 54 | 仅测试 | 接线（缓存豁免）或删 |
| `mobile/data/fs.ts` | 16 | 仅测试 | 直接删（视图仍从 `api.ts` 取，barrel 没人用）|
| `remote-methods.ts` | 42 | **无任何引用** | 删（常量在别处以字面量重复）|
| `css-modules.d.ts` | 7 | 无 | 删 |

⚠️ 这批文件对应 ADR 0002 / 0004 / 0006（状态「已接受」）。**ADR 说已落地，代码说没接线**——文档与现实的偏差比代码债更难发现。
保留例外：`platform/module-graph.ts`、`platform/quality-budget.ts` 是**门禁模块**，只被测试引用是设计本意。

### P2 · ChatView 4,198 行，预算正好卡死

预算 `files["views/ChatView.tsx"]=4198`，实测 4,198：任何新增都会红，但没有下降的空间。建议下一轮把它按「历史分页 / 搜索 / 滚动锚点 / 输入区」再切 2–3 个文件，目标 −800 行。

### P3 · `src/mobile/api` 覆盖率 60%

41 个拆分模块只测了主路径。`mobile-api.ts` 仍有 **4 个内联处理器**（含 `mobile.goalAction`），且 `docs/refactor-progress.md` 写的「59/59 方法外置」不准确：实为 **55 外置 + 4 内联**。

### P4 · 文档漂移

`docs/refactor-progress.md`（08:38 最后改）仍写 **P6 ⬜ 未开始、P7/P8 ⬜**，与实际的 P6 8 屏 + P7 内核 + P8 收账矛盾。以 `docs/objective-audit.md` 为准，但那两份文档需要合并或明确主从。

### P5 · 预算上调理由模板化

`tools/budget.json` 的 `dirsRaised` 有 9 条，其中 5 条理由是同一句「P6 18 屏迁移：逐屏新增页面/数据层与测试；P8 删旧浮层后统一回滚」。模板化理由等于没有理由。

### P6 · 可访问性

10 处 `div/span` 上 `onClick`（`chat-context`、`goal-bar`、`image-lightbox`、`run-status`、`overlay`、`sheet`、`message-menu` 等）。手机端触屏可用，但键盘/读屏用户到不了。修法：换成 `Button` 或补 `role="button" tabIndex={0} onKeyDown`。

## 五、复核命令

```powershell
# 门禁
pnpm typecheck; pnpm build; pnpm test          # 必须串行，build/test 并行会 404
node tools/check-budget.mjs; node tools/sync-budgets.mjs --check
node tools/dead-css.mjs
# 真机（需宿主 3080 + 配对 cookie）
node tools/mobile-visual/run.mjs               # 7 屏像素基线
node tools/mobile-scenarios/run.mjs            # 326 条判据
# 本次审核新增
node tools/audit-import-graph.mjs              # 生产入度 0 的模块
node tools/audit-scan-by-dir.mjs               # 按目录的技术债计数
node tools/audit-probe-entries3.mjs            # ⑥⑫ 入口真机可达性
node tools/audit-probe-reachability2.mjs       # ⑦ 上下文入口真机可达性
```
