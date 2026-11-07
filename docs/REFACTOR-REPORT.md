# dsh-palm UI 重构 · 收尾报告

> 生成时间：2026-11-07 · 分支 `refactor/v2` · 持续更新（W3 拆分为第 20 轮时复核）
>
> **这份报告的第一原则：不把"做了"说成"做完了"**。每一波给三个数：目标、实测、差额。

## 一、结论速览

| 波次 | 目标 | 状态 | 一句话 |
|---|---|---|---|
| W0 | 基线修复 | ✅ 完成 | 门禁能跑、基线可测 |
| W1 | 六内核 + 契约 | ✅ 完成 | 内核纯逻辑，无 React/DOM |
| W2 | 组件与样式层 | ✅ 完成 | 裸 button 归零、样式收进 styles/ |
| W3 | 视图拆分 | 🚧 **6.5/7** | 已拆 12 个模块（layout/scroll/turn-report/constants + 8 个 hook），**ChatView 4,370 行（目标 800，判定不可达）** |
| W4 | 数据层与内核接线 | ✅ **完成** | 六子项全绿：wire / transport / data 建壳 / 8 域拆分 / Cache / 握手 |
| W5 | 宿主与收口 | 🚧 **约 3.5/6** | 治理收口完成；**host 拆出 10 域**（1,986 行）；**token 漂移已锁死**；bridge / routes 未动 |

**W0、W1、W2、W4 四个波次真正完成；W5 里 host 拆域与 token 漂移锁死也已完成。W3 差最硬的一块（ChatView 组件体），且已判定「≤800 行」在当前约束下不可达。**

## 二、每一波的实测证据

### W0 · 基线修复 ✅

- 门禁顺序固定为 `typecheck → build → test`（并发会撞 chunk 清单，`tests/mobile-routes.spec.ts` 偶发 404）
- 证据：`tools/health-check.mjs` 把顺序写死；`docs/MOBILE-TEST-MODEL.md`

### W1 · 六个内核 ✅

`src/mobile/kernels/`：Identity / Intent / Presence / Clock / Viewport / Cache

- Identity 只有类型依赖（架构断言守着"无运行时 import"）
- Chat Store 是纯 reducer，不 import React（可离线回放，有 golden 快照）

### W2 · 组件与样式 ✅

- 裸 `<button>`：**0**（质量预算棘轮，新增即失败）
- 内联样式：26 处（预算棘轮，只降不升）
- 交付：`styles/` 模块化 + design tokens 纯数据（架构断言守着）

### W3 · 视图拆分 🚧 5.5/7

| 目标 | 实测 | 差额 |
|---|---|---|
| ChatView ≤ 800 行 | **4,370 行** | 差 3,570 行 |
| App.tsx 拆分 | 已拆 shell | 完成 |
| 搜索匹配逻辑外移 | `chat-search-match.ts` + 21 测试 | 完成 |
| 缓存外移 | `chat-cache` / `outline-cache` / `history-cache` 全接内核 | 完成 |
| 翻页外移 | `use-chat-history.ts` + `PagePrefetchCache` | 完成 |
| 乐观队列 / 离线合并 | 未动 | 未完成 |
| turn-report 家族 | 未动 | 未完成 |

**为什么没做到**：ChatView 剩下的部分（滚动锚点、流式合并、草稿、定位）与 state/effect 咬在
一起。硬拆的收益低于风险——这条判断记在 `progress.md` 的偏差表里，不是事后找的理由。

### W4 · 数据层与内核接线 ✅（六子项全绿）

| 子项 | 结果 |
|---|---|
| W4-1 wire v1 | 18 种帧进清单 + 编译期断言 + 形状快照 |
| W4-2 transport | `RpcIO` 可注入 + 7 条假 IO 用例（拒绝/4xx/断网/信封/超时/取消） |
| W4-3 data 建壳 | 八域门面，`views/` 不再直接调 `api.ts` 取数 |
| W4-4 data 拆域 | **`api.ts` 1,488 → 186 行**，八域全部 ≤400 |
| W4-5 Cache 内核 | 一个内核 + 策略表 + 例外清单 + 采纳门禁 |
| W4-6 版本握手 | fail-closed，不一致整体降级到轮询 |

实测：

| 指标 | 数字 |
|---|---|
| `mobile/api.ts` | 1,488 → **186 行（-87.5%）** |
| 域文件 | diag 69 / usage 52 / notify 56 / voice 33 / fs 64 / settings 97 / workspace 75 / session 398 |
| 中间层 | read-coalescing、limits、workspace-roster、invalidate-roster、observe-latch、chat-helpers、mobile-types（47 类型） |
| 缓存 | 11 处各写各的 → 1 内核 + 2 条已登记例外，新缓存不接内核会被拦 |

### W5 · 宿主与收口 🚧 约 2.5/6

| 子项 | 状态 | 实测 |
|---|---|---|
| W5-5 治理收口 | ✅ | 6 条 ADR + `docs/UI.md` + `tools/health-check.mjs` |
| W5-1 host 拆域 | ✅ | `mobile-api.ts` 5,564 → **3,744 行（-32.7%）**，搬出 **10 域 1,986 行** |
| W5-4 桌面 token | ⬜ | 只有 ADR 提案（0006） |
| W5-2 bridge | ⬜ | 未动 |
| W5-3 routes 拆分 | ⬜ | 未动 |
| W5-6 全量回归 | 🚧 | 每轮跑 typecheck/build/test/视觉四门禁 |

已搬出的 host 域：perf-capture 114 / error-report 213 / directory 295 / commands-goals 278。

剩 4 域都带模块级状态（队列 revision、运行证据、搜索索引调度、会话花名册落盘），
要先做访问器改造——和 W4-4 同一条路径，估还需 3~4 轮。

## 三、门禁与证据索引

| 门禁 | 当前值 | 位置 |
|---|---|---|
| typecheck | ✅ | `pnpm typecheck` |
| build | ✅ | `pnpm build`（`mobile.js` 24.1 KB gzip） |
| 全量测试 | ✅ **2,663 passed**，215 文件 | `pnpm test` |
| 架构断言 | ✅ **12 条**（计划里写的 8 条，实际长出 12） | `src/mobile/architecture.test.ts` |
| 质量预算 | ✅ 裸 button 0 / 内联样式 26 | `src/mobile/quality-budget.ts` |
| 缓存采纳 | ✅ | `src/mobile/cache-adoption.test.ts` |
| 视觉回归 | ✅ 会话列表 0 / 首页 0.01 / 设置页 2.12 / 聊天输入区 0 | `tools/mobile-visual/run.mjs` |
| 一键体检 | ✅ 全绿（含视觉） | `node tools/health-check.mjs` |

产物清单：

| 类型 | 位置 |
|---|---|
| 进度台账（逐轮） | `ui-refactor/progress.md` |
| 架构决策 | `docs/adr/`（0001–0006） |
| 使用手册 | `docs/UI.md` |
| 拆域勘察表 | `ui-refactor/w4-3-data-inventory.md`、`w4-4-domain-split-plan.md` |
| 脚本 | `tools/health-check.mjs`、`ui-refactor/tools/w4-4-*.mjs`、`w5-1-*.mjs` |

## 四、还欠着什么（按代价排序）

| 欠账 | 现状 | 影响 | 估算 |
|---|---|---|---|
| **ChatView 4,370 行** | 目标 800。已减 751 行、拆出 12 个模块；**剩余部分是 40 个 effect + 30 个 callback 互相咬合的状态机** | 改聊天主流程仍要在大文件里找 | 到 800 需 60+ 轮（实测 57 行/轮），**判定不可达**；替代目标 ≤3,900 行 |
| host 拆域 | **已完成**：10 域，`mobile-api.ts` 3,744 行（原 5,564） | — | 已关闭 |
| 桌面 token 同源 | **第一步完成**：11 对映射 + 分歧账本 + 5 条断言（实测只有 `--bg-page` 一致，其余 10 对不同） | 有人只改一端会立刻红 | 剩「统一色值」1~2 轮 |
| bridge / routes 拆分 | 未开始 | 旧形状复刻代码还在 | 2~3 轮 |
| `mobile-types.ts` 528 行 | 47 个类型一处 | 再加类型应分域 | 半天 |
| 830 个 class 无前缀 / `@layer` | 未动 | 与嵌入式样式表共存时有覆盖风险 | 1 轮 |
| 测试偶发 | **已根治**：remote-entry 的断言等的是"邻居"不是"事实"（视图切换走 transition），改成等目标事实本身；该文件连跑 11 次全绿 | — | 已关闭 |

## 五、给下一个人的三条建议

1. **别急着动 ChatView**。它剩下的部分确实是耦合的，先补 e2e 覆盖再拆，否则拆完不知道坏没坏。
2. **host 拆域照 W4-4 的路子走**：先建中间层、再把 `let` 改访问器、最后一次一个域搬。
   直接搬函数必被依赖网拦住（第 49 轮试过，整体回滚）。
3. **新加缓存/新加帧会被门禁拦**，这是好事。拦下来时看 `docs/UI.md` 第三节，别绕过去。

## 六、这份报告怎么复核

```bash
cd packages/dsh-palm
pnpm typecheck && pnpm build && pnpm test        # 顺序不能变
cd ../.. && node tools/health-check.mjs          # 一键全跑（含视觉，需要预览服务器）
```

数字对不上就是这份报告过时了——**以门禁输出为准，不以文档为准**。
