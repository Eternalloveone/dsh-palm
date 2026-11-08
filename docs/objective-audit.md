# 目标对账：18 项交付 vs 当前证据

> 用法：每次声称"某项完成"前，先在这里找到它的**可复核证据**。
> 数字由 `node tools/sync-budgets.mjs --check`、`pnpm test`、`node tools/dead-css.mjs` 复核。

## 一、工程基座

| 断言 | 位置 | 证据 |
|---|---|---|
| 模块边界：`ui`/`design` 只向下依赖 | `src/mobile/architecture.test.ts`（14 条） | 含"ui 内核与 design 不 import 数据层/视图"、“design/tokens.ts 是纯数据” |
| 无新增循环依赖 | 同上：`does not add new import cycles` | `node tools/dep-cycles.mjs` |
| 单一定义：共享 helper 只有一个出处 | 同上：`has exactly one definition of each shared helper` | — |
| 视图不许新增 App 导入 | 同上：白名单只减不增 | — |
| 行数/结构性棘轮 | `tools/budget.json` + `platform/budget.test.ts` + `architecture.test.ts` | `node tools/check-budget.mjs` |

## 二、设计系统

| 断言 | 现状 | 证据 |
|---|---|---|
| `000-tokens.css` | 41 个 `--palm-*` 令牌 | `tests/golden/tokens.json`（本轮新增基线）|
| 三皮肤（graphite/paper/nocturne） | 三套键集一致、只换值 | 同上 + `platform/skin.ts`（6 条测试）|
| `005-components.css` | **从 241 行降到 69 行**：`.palm-btn/.palm-input/.palm-chip/…` 全部无人引用，已删 | `node tools/dead-css.mjs` = 2 个残留 |
| 组件层实际使用 | 组件用 `mobile-*` 类，`palm-*` 只剩 `.palm-card` | 同上 |

> ⚠️ 结论：**P1 的组件层从未接上组件**，本轮按"删空壳"处理。若要真的用上，需要另立切片把 `mobile-*` 迁到 `palm-*`（不建议在 P8 做）。

## 三、数据层拆分

| 指标 | 数值 |
|---|---|
| `src/mobile-api.ts` | 1,628 行（原 ~3,000+），**59/59 个方法**已外置 |
| `src/mobile/api/*.ts` | 41 个模块 |
| 分发快照 | `tests/golden/dispatch-methods.json` |

## 四、订阅与模型切片

| 项 | 证据 |
|---|---|
| `host-bridge` 单一订阅点 | `kernels/host-bridge.ts` 96 行 + 8 条测试 |
| 模型切片 | `app-frame-slice` / `preview-slice` / `list-cache-slice`，共 21 条测试 |

## 五、结论卡与布局

| 项 | 证据 |
|---|---|
| 结论卡四态 | `ui/verdict-card.tsx`（7 条）+ `chat/lib/turn-verdict.ts`（14 条）+ 渲染接入 4 条 |
| 布局契约 | `layouts/screens.ts` 127 行，9 个 LayoutSpec + 7 条测试 |

## 六、路由与 18 屏

**已完成 8 屏**：④ 审批详情、⑩ 单文件 diff、⑤ 模型与思考、⑭ 外观、⑫ 回合大纲、⑧ 产物列表、⑦ 上下文占用、⑥ 批准方式。
**原本就是独立页 5 屏**：① 会话列表、③ 对话、⑬ 设置、⑱ 工作区、⑪ 完成态（状态条）。

| 屏 | 判定 | 理由 |
|---|---|---|
| ② 搜索 | 不新增 | 内联搜索已覆盖，命中渲染在 `SessionListView`；独立页会复制一份 |
| ⑨ 产物摘要 | 不做 | 已被 ⑧ + 结论卡覆盖；`grep 产物摘要` = 0 |
| ⑮ 归档 | 不做 | 无实体：归档语义是"列表里不显示"，没有归档动作页 |
| ⑯ 空态 / ⑰ 失败态 | **待做** | 属横切体验，见下 |

**路由守卫**：`architecture-routes.test.ts` 6 条（返回分支 / 深度 / 栈 key / **入口存在**）。

## 七、转场与反馈内核

| 项 | 证据 |
|---|---|
| 转场判定 | `kernels/transition.ts` 56 行 + 9 条测试 |
| 双缓冲 | `App.tsx` 的 `TransitionState`（原有） |
| 触感 | `platform/display-prefs.ts` 的 `buzz()` + 用户开关（通知路径在用） |
| 减少动效 | `360-reduced-motion.css` |

## 八、清账

| 项 | 数值 |
|---|---|
| 死代码 | `TurnListSheet` 45 行 |
| 死样式 | 68 个规则块 / 498 行；`cssClasses` 911 → 860，`cssPx` 1,736 → 1,677 |
| 预算下调 | `api` 6,500 → 3,564；`App.tsx` 1,462 → 1,457 |

## 九、回归门禁

| 门禁 | 状态 | 说明 |
|---|---|---|
| 单测 | ✅ 2,859 passed / 248 文件 | `pnpm test` |
| 类型/构建 | ✅ | `pnpm typecheck` / `pnpm build` |
| 行数预算 | ✅ | `node tools/check-budget.mjs` |
| 质量预算 | ✅ | `platform/quality-budget.test.ts` |
| golden | ✅ | `tests/golden/*.json`（api-exports / dispatch-methods / chat-trace / **tokens**）|
| 视觉基线（令牌层） | ✅ | `design/tokens-golden.test.ts` |
| 视觉基线（像素层） | ⛔ 需环境 | `tools/mobile-visual/run.mjs`，需已配对宿主（`/m/api/mobile.info` 当前 403）|
| 真机冒烟 | ⛔ 需环境 | `tools/mobile-scenarios/*`，同上 |

## 十、剩余工作（按优先级）

1. **⑯ 空态 / ⑰ 失败态统一**：现在各页文案与结构不一，属用户能直接感知的体验项。
2. **像素基线跑通**：需要一次有效配对（桌面端出 6 位码）；跑通后把 4 张基线图纳入门禁说明。
3. **P8 收尾**：`backTargetOf` 兜底表保留（深链启动时栈只有一层，仍在使用，已取证）。
