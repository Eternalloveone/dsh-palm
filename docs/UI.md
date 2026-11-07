# 移动端 UI 架构

> 这份文档只讲**怎么改**：加一个功能时该动哪个文件、什么会被门禁拦下、出问题看哪儿。
> 决策的来龙去脉在 [`docs/adr/`](adr/README.md)，别在这里重复。

## 一、四层，依赖只能向下

```
views/          只管画：props → DOM。不取数、不算派生、不碰网络
   ↓
kernels/        六个纯逻辑单元，无 React、无 DOM：Identity / Intent / Presence /
   ↓            Clock / Viewport / Cache
data/           取数与缓存，按域分门面：session / workspace / settings / notify /
   ↓            fs / voice / usage / diag（实现在 data/impl/）
wire/           与宿主的协议：帧形状、版本握手、mux 连接
```

**判断一段代码该放哪**：

| 这段代码 | 放哪 |
|---|---|
| 把数字变成 DOM 结构 | `views/` |
| "这一行该不该合并""这条消息属于哪一轮" | `kernels/identity` 之类 |
| 调一个 RPC 并缓存结果 | `data/impl/<域>.ts` |
| 解析宿主推来的帧 | `wire/` |
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
| 改宿主推来的帧 | `wire/version.ts` 登记判别式 → `wire/frames.ts` | 快照会变；`-u` 更新前必须在提交说明里写清为什么安全 |
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
| `ChatView` ≤800 行 | 仍 5,000+ 行（已拆出搜索匹配、缓存、翻页等） | 改聊天主流程仍要在大文件里找 |
| 桌面令牌同源（W5-4） | 未开始，只有 ADR 提案 | 两端配色各写一套，改一次改两处 |
| host 层拆域（W5-1） | 未开始 | 宿主 `host/api` 仍是单文件，与移动端的分层不对称 |
| `mobile-types.ts` 500 行 | 47 个类型挤一处 | 再加类型该按域再分 |
| 移动端 class 前缀 / `@layer` | 830 个类未加前缀 | 与嵌入式样式表共存时有覆盖风险 |
