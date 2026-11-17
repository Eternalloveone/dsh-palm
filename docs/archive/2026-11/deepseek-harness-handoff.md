# dsh-palm 重构交接与剩余开发方案

> 用途：交给 DeepSeek Harness 继续执行。本文以 `refactor/v2` 当前工作区为准，描述已经落地的架构/UI、验证证据、剩余工作、执行顺序和回退规则。
>
> 工作区：`~\dsh-source\dsh-palm`  
> 分支：`refactor/v2`  
> 基线提交：`1e117cbe5577804b3f9fe7cedf791dc5523e7514`  
> 包目录：`packages/dsh-palm`

## 1. 交接结论

项目已经完成一轮渐进式架构治理和阅读流 UI 重构，当前可以继续在现有边界上推进。已完成的工作包括：

- `mobile-api.ts` 已按领域拆分到 `src/mobile/api/`，保留兼容导出和方法契约。
- App 侧建立唯一 Mux/HostBridge 订阅点，视图通过 bridge 接收帧，`rpcId` 透传。
- 已建立 chat store、Presence、Clock、Intent 初版、wire/handshake、transport、data façade、Cache 内核和 golden replay。
- Chat 过程组已采用阅读流表达：成功完成的工具步骤默认收起，运行中、失败、中断、工具报错保持可见，答案/审批/错误/产物/队列能力保留。
- 会话历史分页已增加 session epoch、session id、AbortController、排队参数和预取缓存隔离；prepend 锚点恢复已抽到 `src/mobile/history/chat-scroll-anchor.ts`。
- 已完成或部分完成 Chat header、消息正文、过程摘要、composer/dock、SessionDrawer、搜索、设置、审批/提问、文件/diff、产物列表/摘要等 UI 切片。
- 已有 graphite / paper / nocturne 三套内置皮肤，皮肤和明暗模式可叠加；语义 token 和 token golden 已接入。

项目尚未达到最终 DoD。主要缺口是 ChatView 状态所有权继续收敛、P4/P5/P6/P7/P8 的完整验收、真实浏览器/手机场景、视觉矩阵、性能与无障碍实测，以及迁移残留清理。

## 2. 当前可复现验证状态

以下命令在本次交接前已按顺序执行：

```powershell
cd ~\dsh-source\dsh-palm\packages\dsh-palm
pnpm typecheck
pnpm build
pnpm guard
pnpm test
```

结果：

| 检查 | 结果 |
|---|---|
| typecheck | 通过 |
| build | 通过；51 个 CSS 区块；mobile `106.45 kB`，gzip `29.80 kB`；ChatView chunk `122.92 kB`，gzip `39.93 kB` |
| guard | 通过；`files=5`、`dirs=20`；架构/预算/模块图 15 项通过 |
| 全量 Vitest | 257 个文件通过、1 个跳过；2,856 passed、1 expected fail、10 skipped |
| 历史分页/锚点专项 | 2 个文件、15 项通过 |
| 审批/皮肤 token 定向回归 | 3 个文件、58 项通过 |
| 实机/浏览器视觉矩阵 | 未运行，按用户要求暂缓 |

`1 expected fail` 是项目原有的预期失败测试，不能改成通过来掩盖行为。全量运行会输出 ErrorBoundary 测试主动制造的错误日志，这是测试设计的一部分。

当前工作树有大量未提交改动和未跟踪原型文件。不要执行 `git reset --hard`、批量清理或覆盖其他代理的文件。`git diff --check` 仍会报告 ChatView 既有改动中的尾随空格；清理它属于 P8 收尾，不要在功能切片中顺手大范围格式化。

## 3. 已完成边界和关键文件

### 架构与运行时

| 边界 | 主要文件 | 当前状态 |
|---|---|---|
| HostBridge | `src/mobile/kernels/host-bridge.ts` | 单帧派发、代数隔离、rpcId 透传 |
| Chat 状态 | `src/mobile/runtime/chat/store.ts`、`use-chat-store.ts` | `title/loading/error/sending/stopping/regenerateState/queuedCount` 已部分收敛 |
| Presence | `src/mobile/kernels/presence.ts` | App、RunOverview、SessionList 共用规则 |
| Clock | `src/mobile/host-clock.ts` | 单调时间、偏移收敛、计时不回跳 |
| Intent | `src/mobile/kernels/intent.ts` | 提交去重和在途窗口初版；outbox/队列账本未完全接管 |
| Wire | `src/mobile/wire/version.ts`、`frames.ts`、`handshake.ts` | 帧登记、入口守卫、版本握手和降级原因 |
| Data | `src/mobile/data/` | 八域门面；视图不直接调用 `api.ts` 取数 |
| Cache | `src/mobile/kernels/cache.ts`、`cache-policies.ts` | TTL/条数/字节上限、统一信封、采用规则和例外登记 |
| 历史分页 | `src/mobile/views/chat/hooks/use-chat-history.ts`、`src/mobile/history/` | session epoch、取消、队列参数、预取和锚点恢复 |

### UI 与页面

| 页面/区域 | 主要落点 | 当前状态 |
|---|---|---|
| Chat shell | `src/mobile/views/ChatView.tsx`、`views/chat/` | 阅读流已落地，但仍是大型装配/状态组件 |
| 过程组/消息行 | `src/mobile/message-row/`、`components/`、`render/` | 已有稳定模型、折叠规则和专项测试 |
| composer/dock | `styles/240-composer-pills.css`、`styles/260-input-bar.css`、相关组件 | 输入、停止、附件、队列、目标条等触控高度已统一 |
| SessionDrawer | drawer 组件和 `styles/515-five-screens.css` | 新建/搜索入口 44px，行为保持 |
| 审批/提问 | `ApprovalView.tsx`、`QuestionPanel`、`styles/230-approval.css` | 语义 token、44px 操作、16px 输入 |
| 文件/diff | `DiffView.tsx`、`components/diff-rows.tsx`、`styles/450-diff-page.css` | 只读文件/图片预览、复制、增删行视觉 |
| 产物 | `ArtifactsView.tsx`、`ArtifactSummaryView.tsx` | 按轮分组、交付物标记、进入 diff |
| 设置/外观/通知/搜索 | `SettingsView.tsx`、`AppearanceView.tsx`、`SearchView.tsx` 等 | 触控和字号已收敛，完整设备验收未做 |

## 4. 剩余事项总表

| 优先级 | 工作包 | 状态 | 完成判定 |
|---|---|---|---|
| P0 | 保持基线绿、锁定当前改动范围 | 进行中 | 每个切片完成 typecheck/build/专项/guard/test |
| P1 | W3-2 Chat Store 剩余字段 | 部分完成 | M 类状态不再由 ChatView 私有 `useState` 持有 |
| P1 | W3-3 投影迁移尾片 | 部分完成 | 回合报告和 history projection 只保留一个事实来源 |
| P1 | W3-6 Intent/outbox/队列账本 | 部分完成 | 发送、队列、离线 outbox 去重和回执对账统一 |
| P1 | ChatView 装配继续拆分 | 未完成 | header/list/composer/controller 边界清楚，行为测试不回退 |
| P2 | P4 结论卡四态 | 未完成 | success/running/failure/unknown 的显示和动作契约统一 |
| P2 | P5 默认 layout 与页面槽位 | 部分完成 | 当前实际路由的必填槽、返回和错误槽全部有契约 |
| P2 | P6 页面迁移清账 | 部分完成 | 次级页面入口、返回栈、深链接和旧实现逐页验收后删除 |
| P2 | 设计系统和自定义皮肤边界 | 部分完成 | 内置皮肤稳定；自定义注册表仍未开放 |
| P3 | P7 转场/骨架/安全区/无障碍 | 未完成 | iOS Safari/PWA、Android Chrome、窄屏和动态字体有证据 |
| P3 | 性能基线 | 未完成 | 首屏、历史加载、流式渲染、页面切换 P50/P95 报告 |
| P3 | P8 清账与发布验收 | 未完成 | 旧 CSS/兼容层移除、文档同步、scenario/mobile/visual/secrets 全部有结果 |

## 5. DeepSeek Harness 执行顺序

### 阶段 A：接管工作区并建立可回退点

1. 确认当前目录、分支和未提交改动；只在 `~\dsh-source\dsh-palm` 工作。
2. 阅读本文、`docs/refactor-progress.md`、`docs/refactor-execution-plan.md`、`docs/refactor-capability-matrix.md`。
3. 运行 `pnpm typecheck`、`pnpm build`、`pnpm guard`、`pnpm test`，记录执行前基线。
4. 不执行清理工作树、重置分支、重写锁文件或删除 `docs/prototype/`。

### 阶段 B：收完 W3 状态所有权

按下面顺序，每次只处理一个小切片：

1. `pendingApprovals/pendingQuestions/offline`：统一放入 Presence 或 session pending store；保证 Chat、Approval、Question 三个入口读同一份状态。
2. `queuedEntries/queueItems`：合并成一个可回放账本，保留编辑、删除、撤回、插话和离线恢复。
3. `bars/modelCatalog/commands/goal/todo/jobs/subagents/turnOutlineRaw/chatSearchHits`：先建立 data/repository 所有者，再迁移视图；禁止把 `useState` 机械替换成另一个 `useState`。
4. 删除 `locateTick/cardSyncTick/chatSearchComposeTick` 一类计数器前，先证明异步结果有稳定的外部事实和订阅通知。
5. 每个字段都写一个失败测试，确认旧路径会失败，再实现最小迁移；专项通过后才进入下一个字段。

验收：`ChatView` 不再持有该字段的事实状态；session 切换不会串写；弱网和重连 golden replay 不重复；`pnpm typecheck`、`pnpm build`、专项测试、`pnpm guard`、`pnpm test` 通过。

### 阶段 C：完成 ChatView 装配拆分

按职责拆，不按行数硬切：

1. `ChatHeader`：只接标题、工作区、返回和菜单 actions。
2. `ChatMessageList`：只接投影后的 rows、定位、历史分页 actions 和滚动 handle。
3. `ChatComposerDock`：只接 draft、附件、语音、模型、权限、发送/停止/队列 actions。
4. `ChatController` 或 feature hook：保留事件归并和副作用编排，不能再生成第二条 Mux 订阅。
5. 将 DOM 测量和滚动 effect 留在 UI/历史边界；业务判断留在 controller/kernel。

不要为了达到某个行数删除错误分支、测试或兼容入口。每次拆分都要用 ChatView、stream、history、composer 专项回归证明行为等价。

### 阶段 D：完成 P4/P5/P6 页面收口

1. 为结论卡定义四态：`running`、`success`、`failure`、`unknown`。未知字段不得猜成功；每态明确可见文案、状态色、重试/展开/复制等动作。
2. 逐一核对当前实际路由：SessionDrawer、Chat、Search、Settings、Appearance、Approval、ApprovalMode、Context、Outline、Artifacts、ArtifactSummary、Diff、Delivery、Runs、Pairing/Notify、Usage。
3. 每屏遵循：data/actions → 纯展示 → 路由接线 → 场景测试 → 视觉回归 → 删除旧实现。
4. 页面必须共用 `SlotLayout`、`screen-spec`、语义 token、44px 触控规则；不得恢复旧的 18 屏假设。
5. 深链接、返回栈、错误/空/加载/离线状态必须逐屏验证。

### 阶段 E：皮肤和视觉系统

当前只维护 graphite/paper/nocturne 内置皮肤。若 Harness 要开放自定义皮肤，按以下顺序做：

1. 建立 `SkinTokenRegistry`，只允许白名单 `--palm-*` 语义 token。
2. 校验颜色格式、对比度、必填 token 和版本号；无效配置回退到 graphite。
3. 版本化持久化和迁移，禁止用户配置直接注入组件 CSS。
4. 更新 Appearance 入口、token golden、浅/深模式矩阵和导出文档。

在此之前禁止新增裸色、`--accent`/`--card-bg` 等旧 token，禁止用高优先级覆盖层掩盖组件边界问题。

### 阶段 F：真实场景、性能和发布收口

1. 用 `tools/dsh-canary/README.md` 启动隔离 canary，配置 `PALM_BASE`、`PALM_PAIR`、`PALM_WORKSPACE`、`PALM_SESSION`。
2. 先运行只读 mobile scenarios 和 visual matrix，再运行写入型场景；写入型只能使用独立 `PALM_TEST_SESSION`。
3. 覆盖：配对、会话切换、drawer 往返、搜索定位、长会话分页、审批、提问、diff 复制、文件/图片预览、设置保存、离线/重连、PWA 更新。
4. 记录设备/浏览器/系统字号/网络条件，产出 P50/P95；性能回退超过 10% 必须停在当前波次修复。
5. 最后运行：

```powershell
pnpm --filter @eternalloveone/dsh-palm typecheck
pnpm --filter @eternalloveone/dsh-palm build
pnpm --filter @eternalloveone/dsh-palm test
node tools/check-budget.mjs
pnpm --filter @eternalloveone/dsh-palm guard
pnpm --filter @eternalloveone/dsh-palm verify:scenarios
pnpm --filter @eternalloveone/dsh-palm verify:mobile
node tools/mobile-visual/run.mjs
pnpm --filter @eternalloveone/dsh-palm verify:secrets
```

build 和 test 必须串行。门禁失败时修产品代码或有证据的测试基线，不得静默跳过。

## 6. 每个 Harness 子任务的固定输出

每完成一个切片，必须更新 `docs/refactor-progress.md`，写明：

1. 目标和唯一状态所有者。
2. 改动文件和保留的能力。
3. 新增/调整的失败测试、专项测试和场景。
4. typecheck/build/guard/test 的实际命令和结果。
5. 浏览器/手机/视觉是否执行；未执行必须标记“未测”。
6. 失败、已知风险、回退点和下一步。

禁止写“已完成”来代替命令结果，禁止把局部单测当作设备旅程证据，禁止在真实用户会话中运行发送消息场景。

## 7. 暂不处理的事项

- 实机验证和真实手机视觉矩阵：用户已明确要求暂缓。
- 协议、配对、鉴权、CSP、安全存储和上游 DSH SDK 的重写：本项目只做边界治理和兼容适配。
- 一次性把 ChatView 压到 800 行：当前应按职责拆分，不能为了数字破坏行为稳定性。
- 任意第三方运行时皮肤注册：先完成 token 注册表、校验和迁移设计。
