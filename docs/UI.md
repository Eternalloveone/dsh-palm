# 移动端 UI 架构

> 这份文档只讲**怎么改**：加一个功能时该动哪个文件、什么会被门禁拦下、出问题看哪儿。
> 决策的来龙去脉在 [`docs/adr/`](adr/README.md)，别在这里重复。

## 一、分层（完整目录职责表见 [architecture.md](architecture.md)）

```
views/       页面：props → DOM
components/  可复用组件（dialog / sheets / toast / 队列槽 / 目标条 / 灯箱 / 文件预览）
ui/          浮层与交互 hook（抽屉、焦点陷阱、窗口化、交付噪声判据）
     ↓
kernels/     纯逻辑（帧切片 / 身份合并 / 缓存策略），无 React、无 DOM
data/        取数与缓存门面，按域分（实现在 data/impl/）
stream/      与宿主协议：帧形状、版本握手、mux、会话状态机
     ↓
api/         RPC 白名单 → 宿主
```

**判断一段代码该放哪**：

| 这段代码 | 放哪 |
|---|---|
| 把数字变成 DOM 结构 | `views/` |
| "这一行该不该合并""这条消息属于哪一轮" | `kernels/` 之类 |
| 调一个 RPC 并缓存结果 | `data/impl/<域>.ts` |
| 解析宿主推来的帧 | `stream/` |
| **拿不准** | 先放 `kernels/` 写成纯函数——纯函数放错了也不产生依赖问题 |

## 二、加一个功能的完整路径

以"会话列表显示未读数"为例：

1. **数据**：`data/impl/session.ts` 加取数（或确认已有字段），在 `data/session.ts` 门面里
   具名转出。**不许 `export *`**（会让依赖不可追）。
2. **逻辑**：如果"未读"有判定规则（例如"最后一条不是自己发的且没看过"），写成
   `kernels/presence.ts` 的纯函数 + 测试。**不要写进组件**——写进去就只能靠 e2e 测。
3. **视图**：`views/list/` 里消费。**不许直接 `import` `api.ts` 的取数函数**
   （架构断言会拦；`import type` 允许）。
4. **样式**：跟随现有令牌/变量，不新增裸色值。
5. **跑门禁**：`node tools/health-check.mjs`（或至少 `pnpm typecheck && pnpm build && pnpm test`）。

## 三、门禁清单（被拦了看这里）

| 门禁 | 拦什么 | 在哪儿 |
|---|---|---|
| `pnpm typecheck` | 类型；**也检查测试文件**（vitest 本身不做类型检查） | 包根 |
| `pnpm build` | 打包；`.test.ts` 的类型错只有这一步能发现 | 包根 |
| `pnpm test` | 全量 vitest + **12 条架构断言** | 包根 |
| 架构断言 | 依赖方向、新环、行数预算、单一实现 | `src/mobile/architecture.test.ts` |
| 质量预算 | `viewDataImports` 等计数指标，**只降不升** | `src/mobile/quality-budget.ts` |
| 缓存采纳 | 每个 `*cache*.ts` 要么用内核、要么登记例外 | `src/mobile/cache-adoption.test.ts` |
| 视觉门禁 | 四屏像素差阈值 | `tools/mobile-visual/run.mjs`（需预览服务器） |

**顺序要求（会咬人）**：`typecheck → build → test` 必须**串行**。`build` 与 `test` 并发时，
测试读 chunk 清单会撞上构建的 clean 步骤，`tests/mobile-routes.spec.ts` 偶发 404。
`tools/health-check.mjs` 已经把顺序写死，别自己拼。

## 四、常见改动的落点

| 想改 | 从哪下手 | 容易踩的 |
|---|---|---|
| 加一个 RPC 端点 | `data/impl/<域>.ts` + 门面转出 | 忘了在 `data/*.ts` 转出，视图就只能 import `api.ts`（被拦） |
| 改宿主推来的帧 | `stream/mux.ts` 登记判别式 | 快照会变；`-u` 更新前必须在提交说明里写清为什么安全 |
| 调缓存寿命 | `kernels/cache-policies.ts` | 改数字要同时改旁边的 `why`，否则下一个人不知道为什么 |
| 加一个缓存 | 用 `createCache`；确实不能用的才登记例外 | 例外必须写 `freshnessFrom`，说不清就说明没想清楚 |
| 拆大文件 | 纯函数先走，再动 state/effect | 拆完行数不许上调；import 变多就把同域的合并 |
| 改视觉 | 四屏视觉门禁 + 真机看一眼 | 移动端浮层自动聚焦必须 `focus({ preventScroll: true })`，否则真机整页被顶一下 |

## 五、出问题先看哪儿

| 现象 | 先查 |
|---|---|
| 界面显示旧值 | 写操作后有没有清缓存窗（`invalidateReadCoalescing` / `invalidateWorkspaceRoster`） |
| 进页面先空壳再长出来 | 有没有走缓存/占位；`run-overview-cache` 这类首屏快照是否命中 |
| 内容跳一下又回来 | `focus({ preventScroll })`；`body` 行内样式改动 |
| 某个页面白屏 | wire 版本握手是不是降级了（`planHandshake` 的返回） |
| 偶发测试失败 | 是不是 build/test 并发跑了；确认用 `tools/health-check.mjs` |

## 六、还欠着什么（诚实列表）

| 欠账 | 现状 | 影响 |
|---|---|---|
| `ChatView` ≤800 行 | **4,818 行**。已拆出 62 个模块、按 4 个子目录分区（`components` / `hooks` / `state` / `lib`）：`chat-layout` / `chat-scroll` / `chat-turn-report` / `use-chat-export` / `use-queue-actions` / `use-chat-inbox` / `use-chat-goal` / `use-chat-connectivity` / `use-chat-subagents` / `use-chat-actions` / `use-chat-scroll-follow` | 距 800 行**仍很远**。组件体内还有 40 个 `useEffect` + 30 个 `useCallback`，剩余部分是**互相咬合的状态机**，不是"搬走就完"的代码 |
| 桌面令牌同源（W5-4） | **该文件已删**（`design/desktop-parity.ts` 在 2.0 收尾时清掉）：11 对映射里只有 `--bg-page` 一致，其余 10 对写入账本、每条带原因 | 有人只改一端会立刻红。**色值统一本身未做**——要逐屏过视觉门禁 |
| host 层拆域（W5-1） | **已完成**：10 个域（perf-capture / error-report / directory / commands-goals / queue-inbox / finished-runs / search-text / running-evidence / session-list / session-roster），`mobile-api.ts` 5,564 → 1,704 | 每域 87~517 行，全部 ≤600；剩下的是 RPC 分发（装配，按 ADR 0003 不该搬） |
| `mobile-types.ts` 500 行 | 47 个类型挤一处 | 再加类型该按域再分 |
| 移动端 class 前缀 / `@layer` | 类名未统一前缀（`components/` 走语义化类名，没有 `p-` 体系） | 与嵌入式样式表共存时有覆盖风险 |

### 关于「ChatView ≤800」这条的诚实结论

**在"每轮门禁全绿 + 行数预算只降不升"的约束下，做不到。** 已投入 20 轮，减了 781 行
（平均 57 行/轮）。按这个速度到 800 还要 60+ 轮。

要真正到 800，必须改做法：**把组件体内的 40 个 effect 重组为若干状态机模块**，而不是继续
按块搬。那需要重新设计边界、可能改动渲染结构，属于"另一个项目"级别的改动，且中间态会
不可避免地出现"门禁不绿"。

替代目标（可达）：**≤3,900 行 + 关键 hook 全部独立成文件**——对维护性的收益与 800 行接近，
因为"改聊天主流程要在大文件里找"这个问题，主要是**找不到逻辑在哪**，而不是文件行数本身。

### 接手 `ChatView` 的三个候选动作（按性价比排序）

现状量化：**4,340 行 = 渲染体 392 行 + 组件体内 37 个 effect / 32 个 callback**。

| 动作 | 预计收益 | 代价与风险 |
|---|---|---|
| ① 继续抽「依赖 ≤6」的 hook（`handleScrollClick`、`timeFlags`、导出面板开关等） | 每轮 −40~80 行 | 低。已有 243 条 ChatView 用例兜底 |
| ② 把渲染体拆成 3 个子组件（头部 / 消息区 / 底部输入区），props 用 `Parameters<typeof X>[0]` 复用类型 | 一轮 −200~300 行 | 中。要一次传 20+ props；建议先加一条"渲染结构快照"用例 |
| ③ 把 37 个 effect 按职责重组为 4~5 个状态机模块 | 一次性 −1,500 行以上 | **高**。等于重新设计 ChatView 的边界，中间态会不绿；需要独立分支与逐屏视觉确认 |

**不要做的事**：不要为了行数把逻辑塞进 `useMemo`/内联函数——那只是把行数搬了个地方，
反而更难读。行数预算是**结果指标**，不是目标。

### 这套约束下"什么算做完"

- 每条 hook 有独立文件 + 模块头写清"这里的坑是什么"
- 门禁全绿（typecheck → build → 全量 test → 架构断言 → 视觉）
- 行数预算**只降不升**，改完同步下调
- 拿不下的块**回滚并记录**（第 19 轮 `locateSeq` 就是这么处理的），不留半成品

