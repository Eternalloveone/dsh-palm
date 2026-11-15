# dsh-palm 渐进式架构治理与 UI 重构执行方案

> 状态：持续实施中；基线 refactor/v2，1e117cb（2026-11-09 核查）。  
> UI 方向：会话是主页面、抽屉承接次级入口；聊天采用已选定的「阅读流」排版。  
> 原则：先立验证门、沿现有可用模块渐进治理、按页面替换、全程保留当前能力。
>
> 配套：[阅读流 UI 规范](./superpowers/specs/2026-11-09-reading-flow-ui.md) · [能力与验收矩阵](./refactor-capability-matrix.md) · [首阶段实施任务](./superpowers/plans/2026-11-09-palm-architecture-foundation.md)

## 目标与边界

本方案覆盖工程门禁、API 与 Host 事件边界、客户端状态、聊天渲染、设计系统、页面装配和发布验证。它是渐进式重写：替换难维护的边界和视图装配，同时继续使用已经验证的协议、数据层、流式状态与业务逻辑。不是重建协议、换框架或一次性移除旧界面。

每个切片完成后仍能构建、运行并回退。新旧界面不会各自长期维护一套业务逻辑；如需实验开关，只能短期控制页面实现选择，并在对应页面通过验收后移除。

## 源码基线与需统一的旧文档

本方案根据 refactor/v2 当前源码、docs/refactor-progress.md、聊天状态实现、App.tsx 和项目内测试/验收脚本整理。

- 进度文档记载 P0 工程门禁、P1 设计 token、P1.5 布局契约已完成；源码中能找到对应实现。P2 API 已按域拆到 src/mobile/api/，mobile-api.ts 仍有装配/兼容职责，不能误认为已消失。本次未重跑产品测试，状态需在阶段 0 重新验证。
- P3 已有单一 App.tsx HostBridge、若干 kernel/model slice 和纯 reducer chat store；后续是收尾状态所有权与视图取数，而非另建状态库或第二条事件管线。
- 消息行、过程分组、附件、产物、队列 dock、diff 和长会话导航已有模块与测试，应复用并明确契约。
- 当前入口在会话页，搜索、设置、审批、diff、产物等按页面栈进入；会话列表、工作区选择等由 drawer 承担。页面迁移按这套实际路由进行，不恢复旧文档中已过期的 18 屏工作区首页流程。
- docs/mobile-design-spec.md、docs/ui-rewrite-plan.md、docs/mobile-redesign-plan.md 中以旧截图/18 屏结论卡为唯一依据的 UI 约定，需按本方案和当前源码复核。它们是历史材料；本文是接下来的执行入口。既有安全、协议兼容、远程配对和发布要求继续有效。

行数和测试总数会随近期提交变化；不要把历史计划中的行数当作新的验收值。每阶段以执行前记录的 git 基线、契约快照、测试和预算脚本输出作对比。

## 目标分层与依赖规则

| 边界 | 责任 | 约束 |
|---|---|---|
| App / shell | 路由、页面栈、错误边界、连接装配 | 不解析每条消息、不集中计算所有页面模型 |
| kernels / runtime / data | 状态归并、请求编排、只读模型与领域 actions | 单一事实所有者；按领域拆，不建立全应用巨型 AppModel |
| views | 页面组合与布局 | 不直接调用 RPC；业务副作用移到领域 hook，DOM 焦点/测量 effect 可保留 |
| components / message-row / render | 正文、过程、产物、审批等展示 | 渲染函数不发命令、不推断服务端运行结果 |
| ui | 按钮、输入、sheet、menu、toast 与滚动机制 | 不依赖业务数据/服务端；沿用现有基础组件 |
| api / stream / platform | 服务端分发、RPC、缓存、SSE、平台能力 | 服务端不依赖手机 React；传输层不决定文案/布局 |
| design / styles | 语义 token、主题、组件/页面样式 | token 唯一真源；生成文件不手改 |

允许的依赖方向：App → kernels/runtime/data；views → read-only models + actions + components/ui；components → ui/design。按需从现有模块抽出职责单一的 view model/action，不为迁移目录结构而机械新建 feature 层。views 不可直接调用 api、host 或写入型 store；渲染与纯状态模块不依赖页面。网络事件只从 App 的 HostBridge 分发一次。跨页面真实状态与局部展示状态分别归属，不为方便渲染复制同一份事实。

不引入 React 升级、状态库、CSS-in-JS、第二个 RPC/事件通道或未经性能数据支持的虚拟列表。协议兼容和现有 /m/api 方法/帧语义不因 UI 重构改变。

## 实施路线

### 阶段 0：基线、清单与门禁盘点

**目标：** 让每个后续变化都有可比对的行为、布局和工程基线。

**检查/修改：**

- docs/refactor-progress.md：核对 P0–P3 真实状态，记录尚未完成的 P3 子项。
- packages/dsh-palm/src/mobile/platform/architecture-graph.test.ts、module-graph.test.ts、budget.test.ts：检查规则是否基于当前依赖图和当前预算。
- tools/mobile-scenarios/、tools/mobile-verify/、tools/mobile-visual/：将已有覆盖映射到能力清单，补缺项，不复制现有案例。
- 在阶段记录中保存当前 commit、git status、单测/类型检查/构建结果、预算报告、视觉截图与真机设备/浏览器信息。

**完成条件：** 关键门禁可在本地重复运行；确认截图基线与当前 UI 一致；能力清单中的每一项至少链接到一条测试、场景或明确的人工验收步骤。

### 阶段 1：完成数据与状态所有权（P3 收尾）

**目标：** 每种事实只有一个写入源，页面读取稳定的只读模型。

**处理边界：**

- src/mobile/kernels/host-bridge.ts 与 views/App.tsx 继续作为唯一 Mux 订阅和帧分发路径。
- src/mobile/stream/session-store.ts 继续持有服务端快照、队列对账、乐观项和流式会话事实；runtime/chat/store.ts 只持有页面/意图生命周期状态。明确二者字段归属，不重复保存 running、队列、消息和 server snapshot。
- 将剩余视图中的订阅、取数、缓存同步按一个领域一个切片迁到 kernels/、runtime/ 或现有 data/；每次只迁一个事实所有者。
- 对被迁移的字段添加 read-only selector / hook；视图动作改由领域命令封装，删除旧写入口后再删过渡代码。
- 用 architecture-graph.test.ts / 专项结构测试约束唯一订阅点和依赖方向；不要只用会匹配注释的字符串断言。

**完成条件：** 没有重复订阅 mux；跨页面会话事实只有一个权威来源；组件卸载/重挂载、切换会话、断线重连和旧快照回填均有测试。

**状态所有权必须落表：**

| 事实 | 当前可复用实现 | 迁移规则 |
|---|---|---|
| 消息/历史/增量归并 | render/messages、use-chat-session/use-chat-stream | 保留稳定 key、增量合并与分页锚点，不在 UI 镜像整份消息 |
| 服务端快照/队列/乐观消息 | stream/session-store、session-status、现有 queue actions | 统一读模型；outbox 与服务端队列区分，不按文本相等消除合法重复发送 |
| 任务运行/结果 | use-turn-state、stream 状态模块、session/task-status | transport offline 不等于 turn failed；缺字段 unknown 不等于 done |
| 发送/停止/重新生成在途 | runtime/chat/store | 命令回执只结束相应意图，不能代替服务端任务结论 |
| 草稿/附件/焦点/展开 | use-chat-draft、attachments 与 UI 局部状态 | 保留原持久化与会话隔离语义；组件重排不丢输入 |

异步回写必须验证会话身份与请求 epoch。现有 reloadTail 已有 epoch 防护，优先推广既有机制；不新建平行的时序框架。HostBridge 的 generation 当前反映 start 生命周期，不可直接当作每次 SSE 网络重连的版本号。重连时用 Mux/会话现有事件核对快照版本、去重标识与水合阶段。任何 schema/缓存迁移采用新增版本键、兼容读取、失败保留原数据，禁止全量清空 outbox/草稿作为“重置”。

### 贯穿阶段 1–4：服务端、桌面入口与发布边界

| 范围 | 源码落点 | 工作与完成证据 |
|---|---|---|
| Host RPC 与接口适配 | mobile-api.ts、mobile/api/dispatch.ts、api/context.ts、remote-methods.ts | 逐域完成剩余装配收口；方法名/导出面 golden 保持兼容；域之间通过 context 注入，避免反向 import 与状态副本 |
| 信任与配对 | pairing.ts、pairing-access.ts、routes.ts、gate.ts | 不改变凭证存储和撤销语义；原 pairing/routes/gate 测试、限流与设备归属测试保持通过 |
| 桌面配对面板 | client/RemotePanel.tsx、PublicUrlConfig.tsx、pair-api.ts、remote.module.css | configure→pair→use 三步行为保留；模型/actions 与展示分离；同步语义颜色/焦点规范，保留宿主桌面主题适配 |
| 通知/更新/PWA | notify/、mobile-routes.ts、平台通知与 service worker | 保留 L1/L2/L3 通道、开关/冷却；明确上游能力退化；验证更新提示、旧 chunk 恢复、离线 outbox 和缓存兼容 |
| 工程与发布 | scripts/verify.mjs、.github/workflows/ci.yml、package.json | 复用现有 CI；补齐架构/预算与隔离场景报告，构建后检验 package 导出/资源和 SDK 适配；发布/推送另行执行 |

服务端以收口和契约测试为主，不在 UI 迁移中同时重写配对、鉴权、持久化协议或上游 SDK。桌面面板在手机聊天试迁稳定后进行组件收敛；其验证是全项目完成条件的一部分。

### 阶段 2：稳固渲染模型，缩小页面职责

**目标：** 让消息内容、工具过程、审批和交付物成为独立且可预测的渲染单元。

**实施方式：**

- 复用 src/mobile/message-row/ 与 src/mobile/components/ 已有模型和组件，逐项定义输入/输出，不另造一套 transcript 渲染树。
- ChatView.tsx 先冻结行为快照，再按一块职责一次迁移：页面 header；message list/scroll anchors；composer 与 dock。仍由一个 controller/feature hook 编排请求、事件、滚动与动作，三个视图区域只接收数据和 actions。
- 过程折叠只压缩已完成的连续工具调用；用户消息、最终回答、审批、错误/取消、改动和产物按既有规则显示。展开状态、列表锚点、消息 key 和流式尾部保持稳定。
- Diff、代码块、图片/文件预览、失败/未知状态继续走各自 renderer；对缺少字段的旧帧按未知/待确认呈现，不能推断成成功。
- 每一块先增加/调整特征测试，再迁装配；避免一次性重写所有事件归并、窗口化、定位和 markdown。

**优先边界：** views/ChatView.tsx、views/chat/、message-row/、render/、components/queue-dock.tsx。  
**完成条件：** 页面入口只装配；视图层不直接访问 RPC/host；既有消息 ID、滚动定位和流式增量行为可保持；长回复、连续工具组、失败/中断、审批和产物均有回归验证。

### 阶段 3：设计系统与聊天屏视觉落地

**目标：** 把选定的阅读流方向固化为可复用规则，在真实聊天屏验证，再向其它页面铺开。

**已选视觉原则：**

1. 正文是首要视觉层级：连续可读的消息流，不把普通段落拆成多张卡片。
2. 用户消息轻量区分；Palm 回答以正文为主。过程摘要使用分隔/折叠行，默认不展开细节。
3. 文件/图片、审批、错误、diff 等需要操作或有边界的内容才使用面板表面；减少重复灰底、重复边框和徽章。
4. 主题使用语义 token，浅色与深色共享结构，状态色只用于状态；文字对比和层级不依赖色相。
5. 正文、标题、辅助文字有清晰字号阶梯；辅助信息保持可读，不用大量 10–11px 文案挤压屏幕。
6. 模型、权限、上下文、附件、停止/发送和待发队列各自保留入口；常用动作集中到 composer，低频动作进入明确的菜单/次级页面。
7. 使用一致的 4px/8px 间距节奏、少数圆角等级、线性 SVG 图标；点击目标满足触屏尺寸，无自定义抢占系统手势。

**先落在会话：**

- 从 src/mobile/design/tokens.ts 和 styles/000-tokens.css 核验现有语义 token，明确 light/dark、文字层级、surface、分隔线、状态色、字号和间距映射。
- 在 styles/005-components.css 与按组件拆分的样式中先定按钮、输入框、chip、列表行、surface、sheet/menu、状态/过程行；避免新增一组只用于 ChatView 的颜色值。
- 改造 ChatView 及 message-row/ 时，用选定“阅读流”样式替换，而非并列保留旧卡片风格。
- 过程组留在对应消息轮次内，便于回溯；仅当前任务/待办/后台任务与待发队列使用 composer 上方的 dock。无内容时不占位；历史过程不再在底部重复展示。完整队列仍支持编辑、删除、撤回和插话。
- 批准/问题请求必须可见且行动明确；输入、附件预览、语音、模型、权限和上下文等入口仍保留。
- 每个视觉切片跑布局断言和截图对比；在 iOS Safari/PWA、Android Chrome 和桌面窄窗检查安全区、IME、键盘、滚动和触控。

**完成条件：** 阅读流结构在浅色/深色、320px 窄宽和系统字号下无横向溢出；空、加载、生成、完成、审批、错误和离线状态均清楚；运行时与构建期 token 一致。

### 阶段 4：按屏迁移剩余 UI

**目标：** 使用同一设计系统迁移当前实际路由和抽屉入口，不改变导航语义。

**顺序：**

1. Chat 核心状态和 composer/dock（阶段 3）。
2. SessionDrawer：最近会话、运行中会话/全局运行概览、工作区切换、搜索、设置和产物入口。
3. 当前会话的高频子页：审批、搜索结果定位、上下文、回合大纲、diff/文件预览、交付与产物。
4. 设置、外观、通知/设备配对、使用量和低频管理入口。
5. 空、同步中、离线、连接失败、无权限和 PWA 返回等跨屏状态。

每屏按“数据模型/actions → 纯展示组件 → 导航接线 → 场景测试 → 视觉/设备验收 → 移除旧实现”的顺序完成。基于当前 App 路由逐项追踪入口和返回路径；不机械按旧 18 屏编号。新界面失败时应能回退到上一稳定版本；已迁页面通过后删除对应旧 DOM/CSS 与临时开关，防止双实现长期漂移。

### 阶段 5：交互、性能与无障碍收口

- 以当前实测为基准优化：聊天首屏、历史加载、长消息流式渲染、页面切换、弱网重连和 composer 输入。先记录 P50/P95 和设备/网络条件，再设回归阈值。
- 保留 IME composition 防误发送、离线 outbox、消息队列对账、返回与焦点恢复、通知、系统安全区和动态 viewport。
- 尊重 prefers-reduced-motion；仅在导航或真实状态变化处使用短转场，不增加与系统返回冲突的手势。
- 检查键盘焦点顺序、可访问名称、状态播报、文本缩放、对比度和 44px 级触控目标。
- 性能优化不得移除长会话能力、窗口化前缀渲染或滚动锚定；以现有 tools/mobile-perf/ 与真实设备记录验证。

### 阶段 6：移除迁移期残留并更新文档

- 删除已无调用方的旧页面组件、旧 CSS 与兼容适配；先用 import/route 搜索和构建产物确认无消费者。
- 更新 docs/refactor-progress.md、架构文档、UI 规范、截图基线、README 的架构介绍和发布说明。
- 把当前计划里的完成状态、预算和性能 SLO 用实际结果更新；禁止为让门禁通过而放宽依赖规则或行数预算。
- 全量跑类型检查、构建、单测、架构/预算门禁、浏览器场景、手机验收、视觉矩阵与 secrets scan；build/test 按项目约定串行。逐屏旧实现通过后即删除；本阶段清理的是全局兼容层、过渡标志和遗留文档。

## 能力保留验收清单

逐项记录“入口 → 行为 → 测试/场景 → 设备验收”：

- **配对与访问：** QR/配对码、设备信任、撤销、会话归属、RPC allowlist、主机错误不泄露。
- **会话：** 工作区与会话切换/创建/重命名/归档、drawer、运行总览、刚结束提示、深链接和返回栈。
- **聊天输入：** IME 安全发送、停止/继续、重新生成、斜杠命令、文本/图片附件、语音、模型/思考、权限、上下文。
- **运行过程：** SSE mux、轮询回补、断网/重连、快照水合、队列发送/编辑/撤回/插话、todo/goal/jobs/subagents、审批和用户问题。
- **内容与产物：** 增量生成、markdown/代码、复制/选区、diff 操作、图片/文件预览、产物列表/摘要、交付、长会话分页/定位/回合导航。
- **系统体验：** 设置/主题、通知、PWA 安装与更新、后台返回、弱网、移动端安全区、无障碍和错误重试。

“界面已渲染”不能单独作为能力保留的证据；要求端到端操作或数据契约测试覆盖对应行为。

## 每个切片的工作模板

1. 写清本切片的输入状态、动作、事件和可见结果；标出唯一状态所有者。
2. 添加最小失败测试或场景断言，证明旧行为和错误边界。
3. 新建/修改一个明确职责的模块；不要在一次提交里同时改状态、样式和多个无关页面。
4. 运行对应专项测试、类型检查与依赖/预算守卫。
5. 视觉切片生成新旧截图并对比；交互切片跑相应 tools/mobile-scenarios/scenarios/ 场景。
6. 检查 git diff、预算和测试报告；保留一个可独立审阅/回退的提交。

## 总体验收命令

从仓库根目录在包依赖已安装的环境串行执行：

    pnpm --filter @eternalloveone/dsh-palm typecheck
    pnpm --filter @eternalloveone/dsh-palm build
    pnpm --filter @eternalloveone/dsh-palm test
    node tools/check-budget.mjs
    pnpm --filter @eternalloveone/dsh-palm guard
    pnpm --filter @eternalloveone/dsh-palm verify:scenarios
    pnpm --filter @eternalloveone/dsh-palm verify:mobile
    node tools/mobile-visual/run.mjs
    pnpm --filter @eternalloveone/dsh-palm verify:secrets

先按 tools/dsh-canary/README.md 启动隔离的 canary host，并配置它的 PALM_BASE、PALM_PAIR、PALM_WORKSPACE、PALM_SESSION；再运行只读场景、node tools/health-check.mjs 和真实浏览器/手机冒烟。任何会发消息的 mobile-scenarios 场景只允许使用单独的 PALM_TEST_SESSION，不得对用户正在使用的会话运行。门禁失败要修产品代码或修正已证实错误的测试基线，不能静默跳过。build 与 test 不并行，避免共享 chunk 清单冲突。

## 粗略排期和决策点

这是跨状态、渲染和所有主要屏幕的工作。粗估为 **5–8 周单人全职开发**，含真机/视觉验收；不含新功能开发、上游 DSH 兼容变化和硬件借测等待。真实进度按阶段 0 基线、阶段 2 Chat 试迁和阶段 4 第一屏完成情况滚动校准。

| 阶段 | 估算人日 | 可交付结果 |
|---|---:|---|
| 0 基线 | 1–2 | 可复现实验环境、能力/测试映射、既有失败清单 |
| 1 状态治理 | 4–6 | 一条会话的切换/回写/状态所有权闭环 |
| 2 渲染与 Chat 装配 | 4–6 | 相同业务行为下可独立修改 header、消息区与 composer |
| 3 阅读流设计系统/聊天 | 3–5 | 真实聊天页轻/深色、各状态、设备验收 |
| 4 全屏与桌面入口 | 7–10 | 实际导航入口全覆盖、次级页面主题一致 |
| 5 性能/设备/可访问性 | 3–5 | 同设备基线对比、键盘/后台/弱网验证 |
| 6 清理/发布验证 | 2–4 | 移除过渡实现、全项目验收报告 |

合计 24–38 人日，阶段 0 与首个状态切片后重新估算；阶段 3 的组件视觉校准可在不触碰状态代码的情况下提前开展。

## 阶段风险和回退

| 风险 | 提前发现 | 回退界限 |
|---|---|---|
| 将旧逻辑搬成巨型 controller | 按会话、运行态、队列、导航分别审阅依赖；入口不出现数据解析/DOM 大段实现 | 每次迁一个所有者；不合并未完成半套状态迁移 |
| 双 UI 同时发命令/订阅 | 测试统计 Mux 与 send 调用次数、同一 rpcId 对账 | 新旧只挂载一个；shadow 仅允许纯计算比较，不执行副作用 |
| CSS 影响未迁页面 | 使用现有 layer/组件作用域和固定 fixture 截图矩阵 | 原子回退单屏组件+CSS；禁止全局追加高优先级覆盖来补救 |
| 新页面减少能力 | 对照能力矩阵逐项验证入口与操作 | 本页未完整验收时保留旧版本回退，不以隐藏功能算通过 |
| PWA 旧版本与新资源混用 | service worker/旧 chunk 恢复/缓存版本兼容测试 | 保留上一可用构建及资源；不为样式问题清空业务存储 |
| 测试全部绿却真机不可用 | iOS Safari/PWA 与 Android 键盘、复制、返回、弱网人工证据 | 无设备证据标记未验收，不声称全项目完成 |

结构目标：ChatView 与 App 逐步变成约 200–400 行的装配层；这是审阅提示，不是靠缩行满足的硬指标。现有预算继续执行，新模块超过约 400 行需解释职责；不为满足总行数而删测试/错误路径，也不创建大量转发文件。性能提案：同设备同 fixture 的关键 P95/首包 gzip 不回退超过 10%；若既有门禁更严，遵循既有值。阶段 0 实测后冻结为报告中的确切数值。

- 阶段 0–2 证明依赖边界与状态模型可逐项迁移；若 Chat 试迁导致事件/滚动语义不稳定，暂停铺屏，先补契约与回归场景。
- 阶段 3 在真实 /m/ 会话页验证阅读流；设计方向延续用户已经选定的排版，而非再次从 18 屏稿推断。
- 阶段 4 每完成一组页面即运行能力清单，不等到所有 UI 完成后再发现功能入口丢失。
- 每屏验收后删除该屏旧实现；阶段 6 清除共享兼容层与迁移开关。在这之前，以可回退和行为一致为最高优先级。
