# 重构进度（滚动更新）

> 对应 `docs/refactor-master-plan.md` 的 P0–P8。本文记录渐进实施证据；未运行的检查明确标“未测”。
> 面向 DeepSeek Harness 的当前状态、顺序和风险见 [`deepseek-harness-handoff.md`](./deepseek-harness-handoff.md)。

## 总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** | 工程基座（TS 模块图断言、导入环检测、行数预算双曲线） | ✅ |
| **P1** | 设计系统（tokens.css + components.css + 三皮肤） | ✅ |
| **P1.5** | 布局契约（SlotLayout：排布即数据、必填槽恰好一次） | ✅ |
| **P2** | `mobile-api.ts` 拆分为 `api/*.ts` | ✅ **59/59 方法，3,849 → 1,628 行** |
| **P3** | HostBridge、运行态与视图装配 | 🟡 订阅点、Presence、Clock、wire、transport、data、Cache 已落地；Chat Store/Intent 与 ChatView 拆分进行中 |
| P4 | 结论卡四态渲染层 | 🟡 有局部状态展示；统一四态契约和跨组件回归未完成 |
| P5 | 页面布局契约 | 🟡 SlotLayout/screen-spec 已用；当前实际路由契约仍需补齐 |
| P6 | 页面栈与按屏迁移 | 🟡 Chat、抽屉和多项次级页已改；全路由/返回/设备验收未完成 |
| P7 | 转场、触感、骨架、安全区与无障碍 | 🟡 部分 44px 触控/字号已改；设备、键盘和无障碍验收未完成 |
| P8 | 清账与发布回归 | ⬜ 迁移残留、全场景、视觉矩阵、secrets 和文档收口未完成 |

## P2 明细

- `mobile-api.ts`：**3,849 → 1,628 行**（当前实测）
- 41 个 `api/*.ts` 模块
- 七个域全部搬完：workspace(5) / settings(2) / pair(4) / push(3) / session(10) / agentPreset+subagent(2) / mobile(33)
- 安全网：方法名快照（59）、导出面快照（25）、模块图环检测、行数预算

## P3 明细

### 单一订阅点 ✅

以前 5 处各自 `new MuxClient` + `onFrame`（App / ChatView ×2 / SessionListView / RunOverviewView），
现在只留一条：**App 建 mux → `createHostBridge` → 各视图/切片**。

守则由 `src/mobile/platform/subscription-guard.test.ts` 钉住：

1. 只有 `App.tsx` 能 `new MuxClient`；
2. 只有 `App.tsx` 能 `createHostBridge`；
3. bridge 必须透传 `rpcId`（应答关联依赖它）；
4. 视图层不得自造帧 schema（运行时校验只在 mux 解析边界 `isMuxFrame`）。

> 注意：守则匹配前**必须剥注释**——`host-bridge.ts` 的文档注释里就写着 `new MuxClient(...)`，
> 直接搜字符串会把说明书当成违规代码。

### 模型切片（4 个，均带单测）

| 切片 | 职责 | 测试 |
|---|---|---|
| `kernels/host-bridge.ts` | 一帧一次派发、重连代数、隔离抛错、rpcId 透传 | 9 |
| `kernels/app-frame-slice.ts` | App 帧规则（运行集/结束账本） | — |
| `kernels/preview-slice.ts` | 会话行摘要取数 + 限流并发 | 10 |
| `kernels/list-cache-slice.ts` | 名册页写穿 + 摘要表持久化 + 冷启动播种 | 3 |

### 视图层去取数（进行中）

`SessionListView`：**1,134 → 1,083 行**（摘要取数与缓存写穿已抽出）。

## 已知坑（踩过的）

| 坑 | 对策 |
|---|---|
| 数组展开进分发表 → RPC 契约测试红（9 例） | 一律**原位调用** |
| api/*.ts 反向 import mobile-api.ts → 成环 | 闭包能力经 ctx 传入 |
| 凭注释猜常量值（15,000 vs 实际 3,000） | 有测试兜住，改回真值 |
| 导出位置变化 | 重签导出面快照，数量对账（25 项） |
| CRLF 文件里用 `'\r'` 拼多行块 | 拼块必须用 `'\r\n'`；或整文件归一化后重建 |
| 脚本正则误伤（把 import 行改成实参形式） | 替换必须限定范围；改完立刻 typecheck |
| 守则正则匹配到**注释里的**代码 | 先剥注释再匹配 |
| Windows 下 notify 状态落盘偶发 EPERM | 既有测试隔离问题，留 P8 修 |

## 历史验证基线（不代表当前计数）

```
pnpm typecheck        # exit 0
pnpm build            # exit 0（chunk 清单产出）
pnpm --filter @eternalloveone/dsh-palm test  # 历史结果；当前结果见文末交接状态
node tools/check-budget.mjs   # 预算通过
```

**build 与 test 必须串行**（并发时 chunk 清单竞争会让 `mobile-routes.spec.ts` 偶发 404）。

## 2026-11-09 交接状态（暂停继续实现）

本次先停止扩展功能，整理交给 DeepSeek Harness 的执行材料：
`docs/deepseek-harness-handoff.md`。该文件包含当前源码边界、验证证据、剩余事项、执行顺序、场景矩阵和回退规则。

### 当前核查结果

- `pnpm typecheck`：通过。
- `pnpm build`：通过；51 个样式区块；mobile `106.45 kB`（gzip `29.80 kB`）；ChatView chunk `122.92 kB`（gzip `39.93 kB`）。
- `pnpm guard`：通过；预算 `files=5`、`dirs=20`，架构/预算/模块图 15 项通过。
- `pnpm test`：257 个文件通过、1 个跳过；2,856 passed、1 expected fail、10 skipped。
- 历史分页/锚点专项：2 个文件、15 项通过；审批/皮肤 token 定向回归：3 个文件、58 项通过。
- 实机、浏览器场景和视觉矩阵：未测，按用户要求暂缓。

### 当前工作判断

- 已完成：P0/P1/P1.5/P2；P3 的单一订阅点、Presence、Clock、wire、transport、data façade、Cache、golden replay 和部分 Intent。
- 已落地 UI：阅读流过程组、Chat header、正文基准字阶、composer/dock、SessionDrawer 入口、搜索、设置、审批/提问、文件/diff、产物列表/摘要等切片。
- 仍未完成：W3-2/W3-3/W3-6 状态收口、ChatView 装配拆分、P4 结论卡、P5 全路由布局契约、P6 全页面场景与旧实现清账、P7 设备/无障碍/性能、P8 发布清账。
- `git diff --check` 仍会报告 ChatView 既有改动中的尾随空格；这属于 P8 清账项，不能据此回滚当前功能切片。

后续开发以 `docs/deepseek-harness-handoff.md` 为唯一交接入口；本文继续记录每个切片的真实证据，不把未测项目标为通过。


## 2026-11-09 首轮实现进度

### 执行基线

- 分支：refactor/v2；基线提交：1e117cbe5577804b3f9fe7cedf791dc5523e7514。
- 工具：Node v26.4.0，pnpm 11.21.0（packageManager 字段为 pnpm@11.7.0）。
- 工作区已有未跟踪原型 HTML、截图和脚本；本轮保留原样。

### 已完成切片

- HostBridge 的 onType 现在把 rpcId 透传给 typed listener；新增运行时契约测试覆盖有/无 rpcId。
- App 创建 HostBridge<MuxFrame> 并传给 ChatView；ChatView 优先使用它，mux 注入仍作为旧宿主/测试兼容入口。
- 会话过程组完成首个阅读流 UI 切片：成功结束的工具步骤默认收起；运行中、失败、中断与工具报错保留可见步骤；展开摘要可看最近步骤并继续展开完整列表。答案、审批、错误提示、交付物和队列能力保持原路径。

### 本轮验证

- typecheck：通过。
- build：通过；生成 51 个样式区块，手机包 106.45 kB（gzip 29.80 kB），ChatView chunk 123.05 kB（gzip 40.00 kB）。
- 专项回归：样式结构、过程组、MessageRow 共 56 项通过；ChatView 242 项通过。
- 全量 test：256 个文件通过、1 个跳过；2,826 passed、1 expected fail、10 skipped。
- guard：预算通过（files=5、dirs=20）；架构/预算/模块图 15 项通过。
- verify:secrets：未通过，扫描器报告 1 项缓存键命名警告及 12 项现存测试/脱敏 fixture 凭据样例；这些文件不在本轮改动范围。
- 真机/浏览器视觉矩阵：未测。隔离 canary 的 127.0.0.1:3099 当前未监听，PALM_BASE / PALM_PAIR / PALM_WORKSPACE / PALM_SESSION 未配置；不对实际用户会话运行场景。

### 下一步

- P3 分页异步边界与队列重放参数已完成；实时帧、历史页和折叠模型最终统一经 commitRows 去重，没有新增第二条写入层。
- 审批/错误与文件/diff surface、composer/dock 和 SessionDrawer 首批触控收敛已完成；接下来继续按屏迁移次级页面，并复核设计 token 与视图数据边界。
- 隔离 canary 的 `/m/` 已在局域网可达，但仍停在配对页；需要 canary 配对会话后运行 mobile-verify、只读场景和截图矩阵。不对实际用户会话运行发消息场景。

### P3 状态所有权切片：会话分页异步边界（2026-11-09）

- useChatHistory 以 session epoch + session id 作为异步结果的所有权边界；会话切换和卸载在 layout effect 中同步失效旧请求。
- 切换会话时取消旧 controller、清理 timeout/队列/滚动锚点/链式计数/预取缓存，并把 hasOlder 复位；旧页在 preparePage 等待期间返回也不能清理或写入新会话。
- 搜索“下一条”的预取捕获会话 guard、缓存实例和 AbortController；会话切换后旧预取结果不能写入新会话缓存。
- 请求在“网络返回 → 页面准备 → adoptPage”完成前保持 pending，避免同一 pager 的旧准备结果与新分页交错；准备失败沿用现有错误通道。
- 排队请求现在保存 silent、游标、chain、maxRows 四个参数；搜索定位的带行数限制请求不会在重放时退化成普通历史页。
- 回归覆盖：旧页成功、旧页准备延迟、旧页失败、缓存清理、新会话请求状态和排队请求参数。
- 验证：分页 hook 10/10 通过；ChatView + 分页专项 252 项通过；隔离 DSH_PALM_PUSH_PROXY 后全量 256 个文件通过、1 个跳过，2,830 passed、1 expected fail、10 skipped；pnpm typecheck、pnpm build、guard 通过；目标文件 git diff --check 通过。

### 阅读流 UI 切片：Chat header 工作区上下文（2026-11-09）

- 页头左右操作列固定等宽，避免中间标题组随右侧内容宽度偏移。
- 工作区名与会话标题共用中轴；字号提升到现有 12px 次级字阶，颜色沿用主题语义 token，所有皮肤共用同一结构。
- 入口与交互保持原样；仅更新 styles/030-header.css 真源和对应样式契约测试。
- TDD：新契约先因右侧列使用 auto 失败；样式更新并重新生成后，样式结构与 ChatHeader 专项 14/14 通过。
- 浏览器/真机截图矩阵尚未运行；隔离 canary 尚未配置。

### 阅读流 UI 切片：过程摘要触控区（2026-11-09）

- 过程摘要仍保持 24px 视觉行与 11px 辅助字阶；透明伪元素将可点击行的命中高度扩至 44px，不增加消息流占高。
- 静态状态行不扩展命中区，也不改变版面。
- TDD：触控区契约先因缺少扩展命中层失败；实现后样式结构、过程组和 MessageRow 专项 58/58 通过。
- 全量验证：typecheck 通过；build 通过（51 个样式区块，mobile 106.46 kB / gzip 29.81 kB）；guard 通过（files=5、dirs=20）；全量测试 256 个文件通过、2,832 passed、1 expected fail、10 skipped；golden token 基线已显式更新；diff check 通过。
- 浏览器/真机截图矩阵仍需隔离 canary。

### 皮肤框架现状（2026-11-09）

- 当前已有内置皮肤框架：platform/skin.ts 管理 graphite / paper / nocturne，通过 html[data-skin] 切换、持久化并广播；000-tokens.css 以同一组件结构覆盖表面、强调色、圆角和阴影。
- 明暗模式由 mobile-theme.ts 的 data-theme 独立控制，皮肤与明暗可以叠加；外观页已保留皮肤、字号、密度和主题入口。
- 当前仍是编译期内置皮肤，不开放任意用户 JSON 导入或第三方运行时注册；新增皮肤需要同步类型、标签、CSS token、外观入口和 golden 测试。
- 下一阶段若开放自定义，应先把 --palm-* 与 --bg-* / --text-* 收敛到语义 token 注册表，再加入白名单校验、对比度检查和版本化持久化，避免用户配置直接污染组件 CSS。

### 阅读流 UI 切片：聊天正文基准字阶（2026-11-09）

- 标准会话消息正文从继承的 14px 提升到 15px，达到阅读流规范的正文字号目标。
- 新增组件语义 token palm-chat-body-size；仅用于聊天消息，不放大全局中号文字。小/大字号偏好仍分别覆盖到 13px/18px。
- 样式契约、MarkdownText、MessageRow 专项 49/49 通过；完整构建、全量测试和预算门禁待本切片最终验证。
- 浏览器/真机截图矩阵尚未运行；隔离 canary 尚未配置。

### 阅读流 UI 切片：composer / dock 触控与移动预览（2026-11-09）

- 输入外壳最小高度提升到 48px，内层输入和 textarea 保持 44px，字体仍为 16px；统一焦点环不变。
- 目标条主操作、运行状态条、插入摘要/撤回行以及附件移除/取消/重试均使用独立 44px 级触控单元；撤回和图片移除不再用跨行扩展的命中层。
- 插入摘要与明细行 token 调整为 44px；运行状态、目标条和附件控件专项契约覆盖相邻操作误触边界。
- TDD：输入框与触控契约先按旧尺寸失败；更新样式真源并生成 mobile-styles 后，样式结构、插入条、目标条、composer、过程组等专项 86/86 通过，token golden 3/3 通过。
- 回归：typecheck、build、全量 test（256 个文件通过、1 个跳过；2,844 passed、1 expected fail、10 skipped）、guard（预算 files=5 / dirs=20，架构 15 项）通过。
- canary 启动脚本已补齐 profile install，并支持显式绑定本机 IPv4；当前隔离 host 绑定 `192.168.4.200:3099`，`/m/` 返回 200。手机页目前停在配对入口，尚未生成 canary 配对码，也未运行真实手机场景。
- host 会按构建产物的 mtime/size 自动刷新 bundle 和 CSS 缓存；源码改动后重新 build 并刷新手机页即可，无需重启 host。当前没有 Vite HMR。
- 全量 `git diff --check` 仍报告既有 ChatView 改动中的尾随空格；本切片文件需单独检查。iOS/Android 真机与完整视觉矩阵仍待完成。

### 阅读流 UI 切片：SessionDrawer 入口触控收敛（2026-11-09）

- 新建会话按钮和搜索入口 token 从 40px / 34px 调整为 44px；会话行、底部入口和工作区切换行为保持不变。
- TDD：新结构契约先因新建按钮仍为 40px 失败；更新 token 真源后重新生成 mobile-styles，结构测试、SessionDrawer 行为/布局专项共 43 项通过，token golden 3 项通过。
- typecheck 通过；guard 预算 files=5 / dirs=20，架构/预算/模块图测试 15 项通过；本切片文件 `git diff --check` 通过。
- 手机 canary `192.168.4.200:3099/m/` 当前仍返回 200，但尚未配对；本切片未完成真机视觉验收。

### 次级页面切片：设置表单触控与字号（2026-11-09）

- 设置开关采用 44×44 按钮热区，轨道保持 44×32，滑钮与开关状态颜色不变。
- 设置文本输入、数组文本域最小高度为 44px、字号为 16px；主题选项和枚举 chip 最小高度为 44px，避免 iOS 输入缩放与低热区误触。
- TDD：新契约先在旧 32px 开关/无输入最小高度/小字号下失败；实现并生成 mobile-styles 后，设置结构与 SettingsView / SettingsForm / appearance / notify 专项共 77 项通过，token golden 3 项通过。
- 回归：typecheck、build、guard 通过；全量测试 256 个文件通过、1 个跳过；2,847 passed、1 expected fail、10 skipped。构建 mobile bundle 106.46 kB / gzip 29.81 kB，app.css 156.32 kB。
- 实际手机视觉仍待 canary 配对；没有在真实会话中触发设置写操作。

### 次级页面切片：搜索输入触控与构建预览（2026-11-09）

- 搜索框和清除按钮使用独立的 44×44 实体尺寸；清除按钮不再借助溢出伪元素扩展热区，避免触控范围侵入输入区域。
- 搜索输入字号提高到 16px，保留 SearchView 的防抖、IME 与结果定位行为。
- TDD：结构契约先因 token 仍为 32px 失败；更新样式真源并重新生成 mobile-styles 后，样式结构与 SearchView 专项共 38 项通过，token golden 3 项通过。
- 回归：typecheck、build、guard 通过；全量测试 256 个文件通过、1 个跳过；2,848 passed、1 expected fail、10 skipped。mobile bundle 106.46 kB / gzip 29.81 kB，app.css 156.16 kB。
- canary `http://192.168.4.200:3099/m/` 与 CSS/JS 资源均返回 200；当前 app.css hash 为 `cf1188be`，已确认新搜索 token 与清除热区规则。手机页面仍需配对才能进入会话界面；没有 Vite HMR，构建后刷新即可加载新资源。

### 次级页面切片：审批与提问控件触控（2026-11-09）

- 批准/拒绝、问题选项与提交按钮统一使用 `--palm-hit` 最小高度；自由回答文本域使用同一触控 token 与 16px 字号，避免 iOS 输入聚焦缩放。
- 按下态不再用 `transform: scale()` 缩小审批/提问操作的实际命中盒，改以透明度或表面色表达反馈。
- TDD：新增结构契约先因批准按钮仍用固定 `height: 44px` 而失败；切换触控 token 后，样式结构、QuestionPanel 与 ApprovalView 专项共 57 项通过。
- 回归：typecheck、build、全量测试、guard 通过；256 个文件通过、1 个跳过，2,849 passed、1 expected fail、10 skipped；预算 files=5 / dirs=20，架构/预算/模块图 15 项通过。
- 公网手机入口 `https://123-56-228-146.nip.io:7001/m/` 与 CSS 资源返回 200；页面引用 `app.css?v=60f55ff7`，远端 CSS 的 SHA-256 与 `packages/dsh-palm/lib/mobile/app.css` 一致。已验证公网 CSS 包含审批 44px 规则、16px 问题输入和新的按下态。未运行真机/截图场景（按当前任务要求先跳过）。
- 当前 canary 进程绑定 `127.0.0.1:3099`，由 Windows portproxy 只从 `192.168.4.200:3099` 转发到回环监听；`iphlpsvc` 因该转发处于运行态。DSH 启动器拒绝 `0.0.0.0` 通配绑定，没有开放所有网卡。

## 2026-11-10 W3-2 第二步：待批/待答事实搬进会话账本

### 目标与唯一所有者

「宿主还没答完的审批 / 问题」原本是 `ChatView` 的两个 `useState`，写入方却有三处（SSE 帧 `approval/requested`·`question/requested`、弱网轮询 `use-pending-poll`、面板答完后本地摘除），换会话只能靠"进会话把两张表清空"挡住串写。现在**唯一所有者**是 `src/mobile/runtime/chat/pending-store.ts`：按 `sessionId` 分桶的模块级账本（纯对象 + 订阅，不 import React）。React 绑定只有 `use-pending-store.ts` 一处，返回的 setter 与 `useState` 同签名（`Dispatch<SetStateAction<T>>`），所以帧分发器与轮询的既有去重/采纳逻辑原样复用，**没有第二套判断**：重放去重、答过不再显示、空轮询不回滚仍留在 `frame-effects.ts` / `approval-batches.ts` / `question-batches.ts`。

行为差异（用户能感觉到的）：换会话不再清空；切回 A 时 A 的待批卡片还在（以前要靠宿主重订阅重放）；A 的卡片不会画进 B。

### 改动文件

- 新增 `src/mobile/runtime/chat/pending-store.ts`（账本，145 行）、`use-pending-store.ts`（React 绑定，62 行）。
- 新增测试 `pending-store.test.ts`（8 例）、`use-pending-store.test.tsx`（3 例）。
- `views/ChatView.tsx`：删两个 `useState` 与"换会话清空"补丁，改为 `useSessionPending(session.sessionId)`；`useState` 24 → 22。
- `architecture.test.ts`：修掉一条**恒真的护栏**，新增"待处理事实不许在视图里另存一份"断言。
- `views/ChatView.test.tsx`、`views/ChatView.stream.test.tsx`：`beforeEach` 复位账本（模块级状态的测试隔离）。
- `tools/budget.json`：`src/mobile/runtime` 225 → 406、`src/mobile` 59691 → 59821，`dirsRaised` 写明理由与 `expires 2027-03-31`。

### 先红后绿（TDD 证据）

1. 账本测试先以 `Cannot find module './pending-store.ts'` 失败（8 例全不收集），实现后 8/8 通过。
2. 护栏修正：旧断言是 `match(/useState\(/g)`，而本仓所有调用都带泛型（`useState<T>(`）。实测 `git show HEAD:packages/dsh-palm/src/mobile/views/ChatView.tsx`：`useState(` = **0**、`useState<` = **24** —— 这条"只减不增"的护栏**永远不会红**。现在先剥注释再统计 `useState[<(]`，预算定在 22：对 HEAD 那份文件必然红（24 > 22），对迁移后的文件为绿。
3. 跑 ChatView 专项时 `chat-trace` golden 一度红（"加载 → 打开更多 → 打开导出"）：模块级账本跨用例泄漏，同文件多条用例共用 sessionId。单跑该用例通过、整文件跑红，`beforeEach` 复位后 242/242 通过。这条失败是真发现——模块级所有者必须显式做测试隔离。

### 验证（按序串行，2026-11-10 00:12 本机实测）

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm build` | exit 0；ChatView chunk 122.96 kB（gzip 39.94 kB）；app.css 156.29 kB（hash `c7a89adf`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20；架构/预算/模块图 15 项通过 |
| `pnpm test` | exit 0；259 文件通过 + 1 跳过；**2,868 passed**、1 expected fail、10 skipped（切片前基线 2,856） |
| 专项 | 账本 8 + 绑定 3 + ChatView 三件套 255 + `runtime/chat` 27 全绿 |
| 公网入口 | `https://123-56-228-146.nip.io:7001/m/` 的 `mobile.js?v=0782922d`、`app.css?v=c7a89adf` 与本地构建 sha1 前 8 位一致；拉到的 `mobile.js` 106,458 B（sha256 `35bdef06`）与本地逐字节相同；shell 引用新 chunk `ChatView-CBAF3KYl.js`，该 chunk 公网返回 200（122,956 B）。**结论：公网入口已经是本切片构建产物，刷新手机页即可** |

`git diff --check` 仍对 ChatView 既有 CRLF 行报尾随空格（仓库存的是 CRLF，属 P8 清账项，不在功能切片里顺手大范围格式化）；本切片新增的 3 个文件无尾随空格。

### 未测

- iOS Safari / Android Chrome 真机视觉、手势、键盘与安全区矩阵：未测（用户已要求暂缓）。
- 写入型场景（真答一次审批/提问）：未跑；按约定只能用独立 `PALM_TEST_SESSION`。
- 视觉截图对比：未生成（本切片无样式改动）。

### 风险、回退点与下一步

- 风险 ①：账本无容量上限，一次运行内访问过的会话各留一个桶（每桶只装几条待处理项）。P8 再评估 LRU 或登出清空。
- 风险 ②：审批详情页仍吃导航时的快照（`Route.approval`），与账本**不是同一份事实**；详情页开着时别处答完，页面仍显示旧内容。下一片修。
- 回退点：`git checkout -- packages/dsh-palm/src/mobile/views/ChatView.tsx`，删除 `runtime/chat/pending-store.ts` / `use-pending-store.ts` 及其测试，行为退回"换会话清空 + 靠重放恢复"；`tools/budget.json` 两处上限一并回退。
- 下一步 ①：App 审批路由改存 `approvalId`，详情页按 id 读同一账本（关掉第二条事实）；② 之后进 W3-6：`queuedEntries/queueItems` 合并成可回放账本（编辑/删除/撤回/插话/离线恢复）。

## 2026-11-10 W3-2 收口：审批详情页接会话账本（去掉第二条事实）

### 目标与唯一所有者

审批详情页原来吃的是**导航时抄下来的 `Route.approval` 快照**。它与对话里的审批面板不是同一份事实：另一台设备答完、或宿主已经收掉这条审批，详情页仍然摆着「批准 / 拒绝」，点下去只能拿到 not-found。现在：

- **事实所有者**：`runtime/chat/pending-store.ts`（上一切片已建立，按会话分桶）。
- **路由只留导航身份**：`Route.approval` → `Route.approvalId`；`routeKeyOf` 仍按 id 去重。
- **页面是投影**：新增 `views/approval-route.tsx`，按 `(sessionId, approvalId)` 从账本读实时对象；账本里没有这条 = 已经结束，effect 里退回对话（不另做一屏"已处理"，对话里的面板由同一份账本驱动）。

### 改动文件

- 新增 `src/mobile/views/approval-route.tsx`（57 行）+ `approval-route.test.tsx`（4 例）。
- `views/App.tsx`：路由类型/`routeKeyOf`/`case 'approval'`/`onOpenApproval` 改走 `approvalId`；删掉 `ApprovalPayload` 类型与 `ApprovalView` 直接引用（-15 行）。
- `views/App.page-stack.test.ts`：样本改成 `approvalId`。
- `architecture.test.ts`：新增"审批路由只存 approvalId（内容归会话账本）"断言。
- `tools/budget.json`：`src/mobile/views` 17775 → 17817、`src/mobile` 59821 → 59887，理由写进 `dirsRaised`。

### 先红后绿

新页面测试先以 `Failed to resolve import "./approval-route.tsx"` 失败（4 例不收集）；实现后 4/4 通过：页面内容来自账本、别处答完即收起并返回、账本没有这条直接返回、别的会话同名审批不会被借用。

### 验证（按序串行，2026-11-10 本机实测）

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm build` | exit 0；`lib/mobile.js` 106.86 kB（gzip 29.91 kB）；ChatView chunk 122.97 kB；app.css 156.29 kB（hash `c7a89adf`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20；架构/预算/模块图 15 项通过 |
| `pnpm test` | exit 0；260 文件通过 + 1 跳过；**2,873 passed**、1 expected fail、10 skipped（上一片 2,868） |
| 专项 | 审批路由 4、App 页面栈 5、ApprovalView 10、架构 16 全绿 |
| 公网入口 | `https://123-56-228-146.nip.io:7001/m/` 的 `mobile.js?v=d18e09a2` 与本地构建 sha1 前 8 位一致（`d18e09a2`）；新 chunk `ChatView-Cqp4gW60.js` 公网 200 且 sha256 与本地逐字节相同 |

### 未测

- 真机视觉与手势矩阵：未测（按要求暂缓）。
- 审批详情页在真机上"别处答完→自动返回"的体感：未测（只有 jsdom 单测证据）。

### 风险与回退

- 风险：账本里没有这条时页面会在 effect 里 `onBack()`；如果宿主重放延迟到页面已经打开之后，用户会看到"闪一下又退回对话"。真机若出现，改为停留 + 显示一行"这条审批已经结束"。
- 回退点：`git checkout -- packages/dsh-palm/src/mobile/views/App.tsx packages/dsh-palm/src/mobile/views/App.page-stack.test.ts`，删除 `views/approval-route.*`，恢复 `Route.approval` 快照与 `ApprovalPayload` 类型；`tools/budget.json` 两处上限回退。
- 下一步：W3-6 待发队列账本（`queueItems` / 乐观项 / 离群 outbox 合成一份可回放账本，保留编辑/删除/撤回/插话/离线恢复）。

## 2026-11-10 W3-6 第一步：待发队列改成会话仓的只读投影

### 目标与唯一所有者

队列原来有**两个所有者**：`stream/session-store.ts` 的权威队列（`queueView()`），以及 `ChatView.tsx` 里的 `useState<QueueItemView[]>`。后者靠一个订阅 hook、两条快照回写（`setQueueItems(queueView(...))`）、四个动作里的本地 `filter` 手动同步 —— 漏抄一次就是真机上的老毛病（"删了还在 / 已发送还挂在排队条"）。

现在：

- **事实所有者**：会话仓。视图只订阅仓的**变更版本**（`sessionStoreVersion`，稳定数字），版本变了才重算 `queueView()`，组件里没有队列数组。
- 为什么不直接把 `queueView()` 塞进 `useSyncExternalStore` 的 getSnapshot：它每次调用都新建数组、判据里带 `Date.now()`（乐观项 TTL、空队列观察窗），React 会判定快照永远在变。
- **写入仍然全部走仓里已有的动作**：`applyQueueItems` / `hideQueueItem` / `unhideQueueItem` / `claimQueueHead` / `dropOptimisticQueueItem` / 新增的 `rebaselineQueueView`。动作里原本"再抄一份"的 `setQueueItems(rows => filter(...))` 全部删掉（隐藏表本身已经发布变化）。
- **重订阅基线**：`session/subscribed` 原本清的是组件镜像（`setQueueItems([])`）。镜像不存在了，清空只能由仓表达 —— `rebaselineQueueView` 记下当时的 `queueRevision`，之后同 revision 的重放不算新数据、更高 revision 或队列帧到达即自动失效。语义与桌面"新连接清空队列镜像"一致。

### 改动文件

- `stream/session-store.ts`：`sessionStoreVersion`（publish 时自增，reset 清零）、`Entry.queueRebaselineAt` + `rebaselineQueueView`、`queueView` 的基线短路、`applyQueueItems` / `applySnapshot(queueNewer)` 清除基线。
- 新增 `stream/session-store-version.test.ts`（6 例）、`stream/session-store-rebaseline.test.ts`（4 例）。
- 新增 `views/chat/hooks/use-session-queue.ts` + `use-session-queue.test.tsx`（5 例）。类型取自 `ReturnType<typeof queueView>`，**不 import api.ts**（views→数据层配额）。
- `views/ChatView.tsx`：删掉队列 `useState` 与镜像写回、删掉 `useQueueStoreSubscription`；改用 `useSessionQueue(sessionId, queueFallback)`（mux 缓存作为冷启动回退）；`useState` 21（ratchet 22 → 21）。
- `views/chat/hooks/use-chat-subscriptions.ts`：删掉队列订阅（只留原生选区让路）。
- `views/chat/hooks/use-chat-inbox.ts`：删掉 `setQueueItems` 依赖与两处回写（快照/队列帧进仓即发布）。
- `views/chat/hooks/use-queue-actions.ts`：删掉 `setQueueItems` 依赖；四处本地 `filter` 改成仓动作（隐藏/撤销隐藏），行为不变。
- `views/chat/state/frame-effects.ts`：`setQueueItems`/`queueView` 从 `FrameContext` 移除，`onSubscribed` 改调 `rebaselineQueueView`，`onQueue`/`onTurnStart` 不再回写视图。
- `tools/budget.json`：`src/mobile` 59887→59964、`stream` 2576→2626、`views` 17817→17849，理由写进 `dirsRaised`。

### 先红后绿

- 版本契约：先 `TypeError: sessionStoreVersion is not a function`（6 例全红），实现后 6/6。
- 基线契约：先 `TypeError: rebaselineQueueView is not a function`（4 例全红），实现后 4/4。
- 投影 hook：先 `Failed to resolve import "./use-session-queue.ts"`，实现后 5/5（跟仓变、会话隔离、冷启动回退、重订阅清空）。
- 回归：`ChatView.test.tsx` 242 例全绿（含 `drops the queue dock on session/subscribed` 两条），`frame-effects` 5 例（写入顺序断言去掉了已删除的一步）。

### 验证（按序串行，2026-11-10 本机实测）

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm build` | exit 0；ChatView chunk `ChatView-BNpxoDtW.js` 122.67 kB（gzip 39.95 kB）；`app.css` 156.29 kB（hash `c7a89adf`，样式未动） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20；架构/预算/模块图全过 |
| `pnpm test` | exit 0；**2,888 passed**、1 expected fail、10 skipped（上一片 2,873，+15） |
| 串行总耗时 | 89 s（typecheck → build → guard → test 按序） |
| 专项 | 队列投影 5、版本 6、基线 4、ChatView 242、frame-effects 5、架构 16 |

### 未测

- 真机视觉/手势：未测（按要求暂缓）。本切片**视觉零变化**（同一份数据、同一套渲染）。
- 弱网下"宿主不重发队列帧"时基线是否会让排队条长时间为空：未测（只在 jsdom 里验证了同 revision 不重放）。

### 风险与回退

- 风险：`rebaselineQueueView` 让"重订阅后没有队列帧"的宿主上排队条为空，直到下一次快照。若真机出现，改为"基线只隐藏超过 1 个轮询周期的条目"。
- 回退点：恢复 `ChatView` 的 `useState<QueueItemView[]>` 与 `useQueueStoreSubscription`，删 `use-session-queue.*` 与两个 stream 契约测试，`tools/budget.json` 三处上限回退；`sessionStoreVersion`/`rebaselineQueueView` 可保留（无外部依赖）。
- 下一步：UI 切片 P0——**结论卡四态**（见 `docs/ui-audit-2026-11-10.md` 的执行顺序第 1 项）。

## 2026-11-10 UI 切片 1：结论卡四态（P4）

### 目标与可见变化

以前一个回合只有两种结局被画出来：**正常收工**（一张「✓ 交付完成」卡）和**什么都不画**。失败、中断、以及"拿不到结论"这三种情况在界面上没有任何痕迹 —— 用户看到的是一轮突然结束，不知道发生了什么，也没有下一步动作。

现在同一张骨架四种状态，文案与状态色都不同：

| 状态 | 卡头 | 状态色 | 额外内容 |
|---|---|---|---|
| `success` | ✓ 交付完成 | 默认绿勾 + 绿边 | 文件/改动/汇总/提交/看全部改动（原样） |
| `running` | ◐ 进行中 | 强调色 | 步数 + 已产生的改动；不写「交付完成」 |
| `failure` | ! 没做成 | 红边 + 红字形 | 原因行（拿得到才画）+「重试」按钮（有回调才画）+ 改动文件 |
| `unknown` | — 结局未知 | 中性灰 | 一句原因；**不猜成功** |

渲染接入：`render/message-row.tsx` 的回合尾行按 `turnCompleted` / `failed` 判定 —— 正常收工 = success，失败 = failure，中断但没标失败 = unknown。失败/未知即使没有任何文件也画卡（那是这一轮的结论），只有"成功且什么都没交回"才不画空壳。

### 截图矩阵里发现的两个真 bug（都已修）

用构建后的 `app.css` + 真实标记做组件预览（石墨深色 / paper 浅色 / nocturne 三套）：

1. **paper（浅色）皮肤下整张卡是深色渐变**：`--palm-flow-card-bg` / `--palm-flow-rule` / `--palm-flow-card-line` / `--palm-flow-tag-ok` 只在基础令牌里定义了深色值，皮肤块没有覆盖。白底上一块深色卡、分隔线消失。已在 `html[data-skin='paper']` 里补四个语义 token（纸感暖白的等价物），并加了结构契约测试防止再漏。
2. **卡里的文字按钮是一块灰方块**：「看全部改动 ›」与新的「重试」用的是 `.palm-delivery-more`，只写了颜色，没重置 UA 的 `background`/`border`/`font`。已补齐并加契约测试（含 `:focus-visible` 焦点环）。

### 改动文件

- `ui/delivery-card.tsx`：`completed: boolean` → `state?: DeliveryState`（默认 success）+ `reason?` + `onRetry?`；四态文案/字形/`data-state`；只有 success 且无产物才返回 null。
- `render/message-row.tsx`：回合尾行判定 success/failure/unknown 并把 `state` 传给卡片。
- `styles/370-v21.css`：四态状态修饰 + 原因行 + 文字按钮重置（全部用既有语义 token，无裸色、无高优先级覆盖）。
- `styles/000-tokens.css`：paper 皮肤补四个 `--palm-flow-*` 表面色。
- 测试：`ui/delivery-card.test.tsx`（四态 + 原因 + 重试 + 空壳）、`render/turn-verdict-row.test.tsx`（失败/未知不再静默）、`message-row-process-group.test.tsx`（原"失败不画卡"用例改判 failure）、`mobile-styles.structure.test.ts`（四态 token 契约 / 按钮重置 / paper 表面色）。
- `tools/budget.json`：`src/mobile` 上限 +37（四态与契约测试）。

### 先红后绿

- 卡片四态用例先因 `state` prop 不存在全红（`delivery-card` 9 例中 5 例红、`turn-verdict-row` 2 例红），实现后 9/9、6/6。
- 按钮重置：先红（`background: none` 缺失），补 CSS 后绿。
- paper 表面色：先红（皮肤块无 `--palm-flow-*`），补 token 后绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `delivery-card` 9、`turn-verdict-row` 6、`message-row-process-group` 24、`render`+`ui` 全量 495、样式三件套 55 |
| 视觉（组件级，非整屏） | 石墨深色 / paper 浅色 / nocturne 三张截图：`~/.dsh/screenshots/p4-graphite-dark.png`、`p4-paper-light.png`、`p4-nocturne.png`（430px 宽，构建后的真实 `app.css`） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 157.38 kB（hash `0736e216`），ChatView chunk 122.67 kB |
| `pnpm guard` | exit 0；预算 files=5 dirs=20（`src/mobile` 上限 60090） |
| `pnpm test` | exit 0；**2,896 passed**、1 expected fail、10 skipped（上一片 2,888） |
| 串行总耗时 | 89 s |
| 令牌基线 | `tests/golden/tokens.json` 已用 `PALM_UPDATE_TOKENS=1` 显式更新（paper 补四个 `--palm-flow-*`），golden 测试 3/3 |

### 未测

- **整屏**视觉与真机：未测。聊天页需要配对 cookie，本轮没有打通；组件预览只验证了卡片本身，不能替代整屏。
- `running` 态目前没有渲染入口（回合尾行只在收工时出现），先按契约实现，等"进行中的结论条"切片再接。
- `onRetry` 只有组件能力、没有接线：聊天页还没有"重跑这一轮"的回调，失败卡暂时只显示原因与改动文件。

### 风险与回退

- 风险：失败/中断的回合现在会多出一张卡；如果某处仍假设"失败回合尾行为空"（例如滚动锚点或导出），会出现高度变化。已知的导出逻辑只遍历 assistant/user 行，不受影响。
- 回退点：`git checkout -- packages/dsh-palm/src/mobile/ui/delivery-card.tsx packages/dsh-palm/src/mobile/render/message-row.tsx`，把 `state` 改回 `completed`；样式回退 `370-v21.css` 与 `000-tokens.css` 的两段；`mobile-styles.ts` 用 `node scripts/gen-mobile-css.mjs` 重新生成。
- 下一步：聊天正文流层级（过程组降级 + 纯问答轮不画回合头），随后 composer/dock 窄屏。

## 2026-11-10 UI 切片 2：纯问答回合不再留一行「—」

### 目标与可见变化

用**真实 `MessageRow` 渲染出的 DOM + 构建后的 `app.css`** 拍了一张 390px 宽的对话流（用户气泡 / 带工具的一轮 / 纯问答一轮 / 运行中一轮），截图里一眼看到的问题：纯问答回合在正文上方多出一行只写着「—」的过程头。

现在这条规则改成：**过程组只在"有过程行"或"这一轮还没收工（有回合时钟且在跑）"时出现**。收工后的纯问答回合直接进正文；状态与耗时仍由任务头状态条承担（`完成 · 12s`），信息没有丢，只是不再画第二遍空壳。

保留：运行中的回合仍保留那一行（它是"这一轮还活着"的落点，也是实机测试认的标记）；有工具行/产物/思考的回合不变；关闭"显示工具调用"后没有可展开内容时整组不渲染（以前留一个「—」）。

### 改动文件

- `message-row/artifacts.tsx`：`showGroup` 判据从「过程行 ∨ 有 durationMs ∨ 有 turnStartAt」改为「过程行 ∨（有回合时钟 ∧ 未收工）」。
- 测试同步（这是有意的行为变更，逐条保留原意）：
  - `message-row-process-group.test.tsx`：原「纯文本回合只剩 `—`」用例改为「不再留空过程头、任务头照常」；新增「运行中无工具行仍保留任务头」「有过程行的回合两层都在」。
  - `render/message-row.test.tsx`：两条静态头用例改为断言过程组不渲染；`structureOf` 由 `['proc','proc-head','text']` 变为 `['text']`。
  - `views/ChatView.test.tsx`：4 处「收工后过程头落定为 ok/已完成」改为「收工后不再有过程组」，落定结论改由状态条断言（`stripLabelOf()` / `stripTimeOf()`）。

### 先红后绿

- 三条新契约先红（`.chat-proc` 仍存在、`—` 仍在、任务头断言冲突），实现后 26/26 绿。
- 全受影响面（`views/ChatView` + `render` + `ui` + 过程组）739/739 绿；`pnpm typecheck` exit 0。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `message-row-process-group` 26、`render`+`ui`+`views/chat` 合计 739 全绿 |
| 视觉（组件级，非整屏） | `~/.dsh/screenshots/chat-flow-graphite.png`（390px，真实 DOM + 真实 `app.css`；改前同目录旧图里能看到那行「—」） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 157.38 kB（hash `0736e216`，与上一片相同：本片只改渲染分支） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20 |
| `pnpm test` | exit 0；**2,898 passed**、1 expected fail、10 skipped（上一片 2,896） |
| 串行总耗时 | 101 s |

### 未测 / 风险

- 整屏与真机仍未测：聊天页要配对 cookie，截图是"真实组件 + 真实样式"的组件级预览，不能替代整屏视觉验收。
- 风险：若有脚本/测试把「收工后必有过程头」当成锚点，会受影响（本次已同步 7 处测试断言）。
- 回退点：`showGroup` 恢复旧表达式即可，测试一并回退。

### 下一步

纯问答回合的任务头（目标 + 状态条 + 元信息）仍会在正文前占两行；这是下一片的目标（需连带更新约 8 处把状态条当锚点的测试），随后 composer/dock 窄屏。

## 2026-11-10 UI 切片 3：收工的状态条退回表面色（让回答成为最亮的东西）

### 问题（整屏实拍）

对话流里最抢眼的元素不是回答，而是**回合状态条**：`done` 档的填充是满格绿色渐变，一条 100% 的亮条横在正文上方。已完成的回合没有"进度"可读，它的存在感却比正文强——这正是"元素互相抢重点"的典型。

### 改了什么（可见体验）

- **收工**（`data-kind='done'`，主条尺寸）：填充从满格渐变改为表面色 `--palm-sur-2`，保留描边、对勾字形与「完成 · N 步 / 6分24秒」文案；一屏里最亮的变成回答本身。
- **运行中 / 失败 / 等审批**：渐变完全不动——那时候进度与结论就是最要紧的事。
- **抽屉里的迷你条**（18px 高）：不动。它靠颜色在小尺寸上认状态，缩成灰条反而难辨。

### 改动文件

- `styles/370-v21.css`：新增一条 `.palm-strip[data-size='main'][data-kind='done']` 的语义 token 覆盖（`--palm-strip-current: var(--palm-sur-2)`），无裸色、无 `!important`、不动组件类名。
- 同一条规则里把**字色与描影**一起换掉（`--palm-strip-fg` / `--palm-strip-detail-fg` / `--palm-strip-right-fg` / `--palm-strip-text-shadow: none` / `--palm-strip-ink-done: var(--palm-ok)`）：这套字原本是给"白色文字压深色渐变"设计的，填充换成浅色表面后，paper 皮肤上整条直接看不见（**截图矩阵抓到的第二个真 bug**）。
- `mobile-styles.structure.test.ts`：新增「状态条主次」契约三条——收工退回表面色；**同一规则必须换字色与描影**；运行/失败仍保留渐变、迷你条不受影响。
- `mobile-styles.ts` 由 `node scripts/gen-mobile-css.mjs` 重新生成（生成产物，勿手改）。

### 先红后绿

- 契约先红（`--palm-strip-current: var(--palm-sur-2)` 不存在），补规则后 38/38 绿。
- 期间踩到一个真实约束：CSS 注释里写反引号包裹的 `done` 会**打断 `mobile-styles.ts` 的模板字符串**，`tsc` 报 `TS1005`。已改为普通文字（这条值得记住：注释也是被拼进 TS 模板里的）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 39/39、`mobile-styles` 全绿 |
| 视觉（组件级，非整屏） | 石墨深色：`chat-flow-graphite.png`（收工条变中性、运行条仍渐变）；paper 浅色：`chat-flow-paper.png`（修完字色后「完成 · 7 步 / 6分24秒」清晰可读）；窄屏 320px：`chat-flow-320.png`（无溢出、无截断） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 157.66 kB（hash `78fc1212`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20 |
| `pnpm test` | exit 0；**2,901 passed**、1 expected fail、10 skipped（上一片 2,898） |
| 串行总耗时 | 83 s |

### 未测 / 风险

- 整屏与真机仍未测（配对 cookie 未打通）；浅色与 nocturne 的收工条沿用同一 token（`--palm-sur-2` 三套皮肤都有定义），但**没有逐皮肤截图**。
- 风险：若有地方靠"绿色满条"表达完成（例如截图基线或对外文档配图），观感会变；token 基线与结构契约已同步。

### 下一步

composer/dock 窄屏折叠（入口收进「⋯」、dock 最大高度 + 内部滚动），随后 SessionDrawer 分组与次级页面。

## 2026-11-10 UI 切片 4：回合头的主次（目标行降为次级标签、元信息回到可读层）

### 问题（整屏实拍）

对话流里"标题"出现两次：回合目标行是 **15px + 近白 + 600 字重**，和回答正文同字号、比正文更亮，读起来像第二个标题；元信息行「改 1 个文件」是 **10px + 三级灰**，属于典型的低对比辅助文字——想看清得眯眼，正好落在目标里"避免低对比辅助文字"的反面。

### 改了什么（可见体验）

| | 改前 | 改后 |
|---|---|---|
| 回合目标 `把结论卡做成四态` | 15px / 600 / `--palm-fg` | 13px（`--palm-flow-title-size`）/ 400 / `--palm-fg-2` |
| 元信息 `改 1 个文件` | 10px / `--palm-fg-3` | 10.5px（`--palm-flow-meta-size`）/ `--palm-fg-2` |
| 目标行高度 | `--palm-turn-goal-h` | **不变**（骨架与真实头同高的契约不动） |

一行文字、四个 token，没有新增组件、没有裸色、没有 `!important`。

### 改动文件

- `styles/370-v21.css`：`.palm-turn-goal` 与 `.palm-turn-meta` 两条规则的层级调整。
- `mobile-styles.structure.test.ts`：新增「回合头主次」契约两条（目标行是次级标签且高度契约不变；元信息回到可读层级）。
- `ui/turn-header.test.tsx`：原「目标行 15px 不动」的尺寸契约改为「次级标签 + 高度契约」。
- `mobile-styles.ts` 重新生成。

### 先红后绿

- 两条新契约先红（目标行仍是 `--palm-fg` / 15px、元信息仍是三级灰），改完 41/41 绿；回合头相关三个套件 57/57 绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 41/41、`turn-header` + `turn-header-unknown` 全绿 |
| 视觉（组件级，非整屏） | `~/.dsh/screenshots/chat-flow-graphite.png`：目标行变灰色小字，回答重新成为唯一的主标题层；元信息可读 |
| 附带审查 | composer 真实 DOM 在 390 / 320 两个宽度截图（`composer-390.png`、`composer-320.png`）：`+ / 输入 / 发送` 一行不挤、`field-sizing: content` 长草稿会撑高；320px 下无溢出。**未改动**（没有发现真问题，不做无依据的"美化"） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 157.66 kB（hash `46580291`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20（`src/mobile` 上限 60110，为本片新增契约 +7 行） |
| `pnpm test` | exit 0；**2,903 passed**、1 expected fail、10 skipped（上一片 2,901） |
| 串行总耗时 | 86 s |

### 未测 / 风险

- 整屏与真机仍未测；深/浅主题只验证了石墨深色，paper 与 nocturne 未逐皮肤截图。
- 风险：`--palm-turn-meta-size` 令牌仍存在但已不被 `.palm-turn-meta` 使用（10px 档保留给别处？确认无人引用后再清理，本片不动以免牵连骨架占位）。

### 下一步

纯问答回合的任务头去留（需连带更新约 10 处把状态条当锚点的测试），随后 SessionDrawer 分组与次级页面。

## 2026-11-10 UI 切片 5：外观页的皮肤卡（色板要能认出是哪套皮肤）

### 问题（外观页实拍，深色 + 浅色两张）

皮肤卡的色板是「底色 → 强调色」的 140° 对角渐变：**石墨（中性灰）被画成一块蓝紫**，纸是一块米黄到棕，夜航是一块深蓝到青——三张卡看着都是"蓝色皮肤"，用户没法据此选皮肤。深色皮肤（石墨 / 夜航）的底色又和深色页面几乎同色，卡片没有边界。

### 改了什么（可见体验）

| | 改前 | 改后 |
|---|---|---|
| 色板 | 140° 对角：底色 ↔ 强调色各占一半 | **底色占 82%**，强调色只在底边留一条 8px 带 |
| 石墨 | 蓝紫渐变 | 炭黑底 + 靛蓝底线（一眼是"石墨"） |
| 纸 / 夜航 | 米黄↔棕、深蓝↔青 | 米白底 + 棕线、深蓝底 + 青线 |
| 深色皮肤边界 | 无 | 内描边（`inset 0 0 0 var(--palm-hair) var(--palm-line)`） |

只改映射，不动色值：三套皮肤的颜色仍在 `000-tokens.css` 的 `--palm-skin-*-bg/-ink`，本片只是在 515 层把"底色 + 强调线"重新组合。

![外观页（石墨深色）：三张皮肤卡可以分辨](C:\Users\Administrator\.dsh\screenshots\appearance-graphite.png)

### 改动文件

- `styles/515-five-screens.css`：`.palm-spec-skin-sw` 加内描边；三条 `[data-skin]` 色板改成分层背景（底色 + 底带）。
- `mobile-styles.structure.test.ts`：新增「外观页皮肤卡」契约两条（三张卡底色为主 + 强调线；色板自带内描边）。
- `mobile-styles.ts` 重新生成。

### 先红后绿

- 两条契约先红（仍是 `linear-gradient(140deg, …)`、无 `box-shadow`），改完 43/43 绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 43/43 |
| 视觉（组件级，非整屏） | `appearance-graphite.png` / `appearance-paper.png`（390px，真实 `AppearanceView` DOM + 构建后的 `app.css`）：三张卡可分辨，深色皮肤有边界 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 157.78 kB（hash `d75dc9cf`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20 |
| `pnpm test` | exit 0；**2,905 passed**、1 expected fail、10 skipped（上一片 2,903） |
| 串行总耗时 | 86 s |

### 未测 / 风险

- 整屏与真机未测；外观页的"改完立刻生效"（切皮肤后整页重绘）没有在本片验证——改的是静态色板，切换路径未触碰。
- 风险：`--palm-spec-swatch` 44px 高度下 18% ≈ 8px 的底带，在低 DPI 设备上可能只有 1–2 个物理像素；真机需要确认这条强调线是否还看得见。
- 回退点：把三条 `[data-skin]` 规则恢复成 140° 渐变、删掉 `.palm-spec-skin-sw` 的 `box-shadow`，重新生成 `mobile-styles.ts`。

### 下一步

SessionDrawer 分组细化（今天/昨天/更早 + 计数），随后纯问答回合的任务头去留、审批与提问页。

## 2026-11-10 UI 切片 6：会话抽屉的定位感（分组条数 + 当前会话强调轨）

### 问题（抽屉实拍）

抽屉是**唯一导航**（会话页、工作区页都已并入这里），但它给不出两个最基本的定位信息：

- 分组标题「今天 / 昨天 / 更早」是 `--palm-t-s` + **三级灰**，在深色皮肤上几乎读不出来；也没有条数，长列表里不知道每段有多少会话。
- 当前会话只有 `background: var(--palm-sur-2)` 一层底色差；行里还挂着迷你状态条，这层差几乎看不出来。

### 改了什么（可见体验）

| | 改前 | 改后 |
|---|---|---|
| 分组标题 | 12px / `--palm-fg-3` / 无条数 | 12px / `--palm-fg-2` / 右侧条数（三级色 + 等宽数字） |
| 当前会话行 | 只有底色差 | 底色差 **+ 左侧 2px 强调轨**（`inset 2px 0 0 var(--palm-accent)`） |

条数用 `aria-hidden`（读屏仍只读「今天」这一句），不影响可用性语义；会话标题、迷你状态条（运行中/完成/等审批）、行高、单行省略契约全部不动。

![会话抽屉：分组带条数，当前会话有强调轨](C:\Users\Administrator\.dsh\screenshots\drawer-graphite.png)

### 改动文件

- `ui/session-drawer.tsx`：分组标题里加一个 `palm-drawer-bucket-count`（`aria-hidden`）。
- `styles/280-sheets.css`：`.palm-drawer-bucket` 改二级色 + flex/gap；新增 `.palm-drawer-bucket-count`；`.palm-drawer-row-current` 加内阴影强调轨。
- `mobile-styles.structure.test.ts`：新增「抽屉定位感」契约两条。
- `ui/session-drawer.test.tsx`：分组用例补条数断言；新增当前会话高亮类用例。
- `mobile-styles.ts` 重新生成。

### 先红后绿

- 组件用例先红（`.palm-drawer-bucket` 文本是「今天」而非「今天1」），样式契约先红（三级色、无内阴影）；改完抽屉 + 样式 + 布局三件套 **60/60** 绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `session-drawer` + `session-drawer-layout` + `mobile-styles.structure` 合计 60/60 |
| 视觉（组件级，非整屏） | `~/.dsh/screenshots/drawer-graphite.png`：今天 3 / 昨天 2 / 更早 2 清晰可读，当前会话有左侧强调轨 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 157.96 kB（hash `640088df`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20（`src/mobile` 上限 60140，为条数契约 +30 行） |
| `pnpm test` | exit 0；**2,908 passed**、1 expected fail、10 skipped（上一片 2,905） |
| 串行总耗时 | 89 s |

### 未测 / 风险

- 整屏与真机未测；浅色与 nocturne 未逐皮肤截图（两者都用同一组语义 token）。
- 风险：条数是 `aria-hidden` 的视觉补充，若将来读屏用户需要"本组 N 条"，得改成可见文案 + 独立 aria-label，而不是把数字塞进 `<h2>` 文本。
- 回退点：删掉条数 span 与两条 CSS 规则，测试同步回退。

### 下一步

纯问答回合的任务头去留（需连带更新约 10 处把状态条当锚点的测试），随后审批与提问页。

## 2026-11-10 UI 切片 7：审批详情页审查（一个真改动 + 一条假 bug 的记录）

### 审查方式

把真实 `ApprovalView`（`bash` + `risk='exec'` + 一段很长且带 `&&` 的命令）渲染成 HTML，套上构建后的 `app.css` 截图，深色 + paper 浅色两套。

### 结论一：页面本身是好的（不改）

工具/风险 pill、待执行命令块、黄色风险条、按住 1.5 秒批准 + 拒绝、页脚说明 —— 层级清楚，触控区到位，1.5 秒长按这种防误触设计也在。**这一屏没有需要重排的东西**，所以本片不动布局。

### 结论二：差点误报的"长命令撑破卡片"

第一次截图里卡片明显比屏幕宽、「原始参数」按钮被挤出视口，看起来是个真 bug。于是加了 `min-inline-size: 0` 等三条约束 —— 但**换成真实页壳（块级 `#root` → `.palm-spec-page`）后，同一份 markup 完全正常**：溢出是我为了截图自己套的 `display:flex` 外壳造成的（flex 项默认 `min-width:auto`）。

处理方式：约束保留，但把测试与注释改写成**防御性约束**（写明"这不是已复现的真 bug"），避免用一条假 bug 冒充修复。这条经验已记进本切片：**审查外壳本身可能就是 bug 的来源**。

### 结论三：一个真改动——页脚那句是决策信息

「批准后它才会动手；不处理也不会自己往下走。」原来用三级灰：它解释的是"批准之后会发生什么"，属于决策信息，却按脚注处理；在长屏上离按钮两百多像素，基本没人会读。改成二级前景色（`--palm-fg-2`），字号与分隔线不变。

### 改动文件

- `styles/440-approval-page.css`：`.approval-page-hint` 前景色 `--palm-fg-3` → `--palm-fg-2`；另加三处防御性宽度约束（`.approval-page-body` / `.approval-detail` / `.approval-detail-code`）。
- `mobile-styles.structure.test.ts`：新增「审批页宽度约束（防御性）」与「页脚是决策信息」契约。
- `mobile-styles.ts` 重新生成。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 48/48 |
| 视觉（组件级，非整屏） | `approval-graphite.png` / `approval-paper.png`（390px，真实 DOM + 构建后的 `app.css`）；另有 `approval-block.png` 作为"真实页壳"对照，证明第一次的溢出是外壳造成的 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 158.09 kB（hash `d49d6226`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20 |
| `pnpm test` | exit 0；**2,911 passed**、1 expected fail、10 skipped（上一片 2,908） |
| 串行总耗时 | 85 s |

### 未测 / 风险

- 整屏与真机未测；**1.5 秒长按**的手感、错误态（`busy` / 命令未注册）都没有在真机上验证。
- 防御性约束目前只对"将来嵌进 flex 容器"有意义；若判断收益不足，可整段回退而不影响任何现有页面。
- 页脚提到二级色后，与正文的对比差变小；若后续觉得抢眼，可回退为三级色并把说明移进正文卡片。

### 下一步

纯问答回合的任务头去留 → 提问（question）页 → 状态矩阵（空/加载/离线/失败/无权限/窄屏/深浅主题）。

## 2026-11-10 UI 切片 8：diff 详情页 —— 超长行从「截断」改成「软换行」

### 审查（真实 `DiffView` + 构建后的 `app.css`，390px，深浅两套）

文件标题 + 父路径、行号列、增删底色与左侧色条、hunk 头、底部"只读"说明 —— 结构清楚，行号对齐也对。

但**超长行是硬截断**：`white-space: pre` + `overflow: hidden` + `text-overflow: ellipsis`。实拍里 `/** 这一轮怎么结局：进行中 / 完成 / 没做成 …`、`if (state === 'success' && files === 0 && …` 都被切掉后半段。只读页面除了长按选中复制，没有别的办法看全 —— 而这一页的用途就是"看清改了什么"。

原设计是刻意的（"横向滚动会把行号滑出视野"），但那个理由只否定**横向滚动**，不否定**换行**。

### 改了什么（可见体验）

| | 改前 | 改后 |
|---|---|---|
| 超长行 | 单行截断 + 省略号（内容看不见） | `white-space: pre-wrap` + `overflow-wrap: anywhere` 软换行 |
| 行首缩进 | 保留 | 保留（`pre-wrap`） |
| 行号 | 首行 | 仍对齐首行（`align-items: baseline`），续行不重复行号 |
| 横向滚动 | 无 | 仍无（正文容器只有纵向滚动） |
| 结构标记 | `data-overflow="truncate"` | `data-overflow="wrap"` |

![diff 页（石墨深色）：长行折行显示完整内容](C:\Users\Administrator\.dsh\screenshots\diff-graphite.png)

![diff 页（paper 浅色）：浅色底上增删底色与折行都正常](C:\Users\Administrator\.dsh\screenshots\diff-paper.png)

### 保留的能力

返回、复制原文（标题右侧按钮）、图片预览分支、加载/错误态、行号单列口径、增删/上下文配色、hunk 分组、只读（不编辑）、页面缓存（`usePage`）—— 全部未动；`parseDiff` 一行未改，只改呈现。

### 改动文件

- `components/diff-rows.tsx`：`data-overflow` 改为 `wrap`，更新模块注释里的策略说明。
- `styles/450-diff-page.css`：`.diff-page-text` 换成 `pre-wrap` + `overflow-wrap: anywhere`，去掉 `overflow/text-overflow`。
- `components/diff-rows.test.tsx`：契约改为「软换行、不截断、无横向滚动」。
- `mobile-styles.ts` 重新生成。

### 先红后绿

- 契约先红（仍是 `text-overflow: ellipsis`、`data-overflow="truncate"`）；改完 `diff-rows` + `DiffView` + `mobile-styles.structure` 合计 **63/63**。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | 63/63 |
| 视觉（组件级，非整屏） | `diff-graphite.png` / `diff-paper.png`：长行完整可读，行号不重复、无横向滚动 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 158.08 kB（hash `16466a38`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20（`src/mobile` 60150、`src/mobile/components` 2790，本片 +12 / +2 行） |
| `pnpm test` | exit 0；**2,911 passed**、1 expected fail、10 skipped |
| 串行总耗时 | 86 s |

### 未测 / 风险

- 整屏与真机未测；**折行后行高变化**对手势滚动、长按选中范围的影响没有真机验证。
- 风险：极长的单行（例如压缩过的 JSON）会折成很多行，一屏能看到的改动变少；若觉得过密，可加"折行 / 截断"开关而不是回退。
- 风险：`overflow-wrap: anywhere` 会在词中间断行，代码缩进的"视觉列"对不齐；这对按列对齐的代码（表格、对齐注释）是可读性损失。
- 回退点：`.diff-page-text` 恢复三行截断规则、`data-overflow` 改回 `truncate`，测试同步回退。

### 下一步

纯问答回合的任务头去留 → 提问（question）页 → 状态矩阵（空/加载/离线/失败/无权限/窄屏/深浅主题）。

## 2026-11-10 UI 切片 9：空会话首屏 —— composer 回到底部，空态整体居中

### 审查（真实 `ChatEmptyView` + 构建后的 `app.css`，390px，A/B 对照）

第一张实拍就露了两个问题：

1. **composer 停在屏幕中间**：`.chat` 是 flex 列，`.empty-state` 没有 flex 权重，高度只有内容那么高，于是输入框紧跟在 chips 下面，下方留 450px 空白。
2. **图标块被顶到左边**：同一块里标题/说明是 `text-align: center`，但图标是个定宽 38px 的 flex 项，默认 `align-items: stretch` 让它贴左 —— 一屏里两种对齐。

这次先做了 **A/B 对照**（同一套 markup + 真实页壳 `#root{display:flex;flex-direction:column;height:100dvh}`，一份保留修复、一份把规则改回去），确认不是审查外壳造成的：

| | 改前（`flex:0`） | 改后 |
|---|---|---|
| 空态位置 | 贴顶，下方大片空 | 垂直居中 |
| 图标 | 贴左（和居中标题错位） | 居中 |
| composer | 屏幕中部（y≈300） | 屏幕底部 |

### 改了什么

只加一条规则（`styles/055-empty-state.css`）：

```css
.chat > .empty-state { flex: 1 1 auto; align-items: center; justify-content: center; }
```

范围限定在会话首屏（`.chat >`），不影响设置页、产物页里用的同一个 `EmptyState` 组件。

![空会话（石墨深色）：空态居中，composer 贴底](C:\Users\Administrator\.dsh\screenshots\empty-real-after.png)

![同一份 markup 把规则改回去：composer 浮在中间、图标贴左](C:\Users\Administrator\.dsh\screenshots\empty-real-before.png)

### 保留的能力

标题/说明/三条快捷 chip 填充草稿、输入框（IME、回车发送、Shift+回车换行）、发送按钮禁用逻辑、错误提示、更多菜单 —— 全部未动；只是把这几个块放进剩余的纵向空间里。

### 改动文件

- `styles/055-empty-state.css`：新增 `.chat > .empty-state` 一条规则。
- `mobile-styles.structure.test.ts`：新增「空会话首屏」契约两条。
- `mobile-styles.ts` 重新生成。

### 先红后绿

- 契约先红（找不到 `.chat > .empty-state` 规则）；改完 `mobile-styles.structure` **50/50**，`views/chat/components` 一起跑 **30/30**。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | 50/50 + 30/30 |
| 视觉（组件级，非整屏） | A/B 两张：`empty-real-before.png`（问题复现）/ `empty-real-after.png`（修复后）；深色皮肤 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 158.15 kB（hash `63c3ce85`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20（`src/mobile` 60160，本片 +10 行契约） → 60160 |
| `pnpm test` | exit 0；**2,913 passed**、1 expected fail、10 skipped |
| 串行总耗时 | 80 s |

### 未测 / 风险

- 整屏与真机未测；**键盘弹出**时 composer 被键盘顶起后的居中高度没有验证（`100dvh` + 键盘缩放行为只能真机看）。
- 浅色 / nocturne 只有早先的 harness 截图（`empty-paper.png` 那次外壳不对，仅作配色参考，不作布局证据）。
- 风险：极矮的横屏窗口里，"占满 + 居中"会把内容压到 composer 上方并可能需要滚动；`.empty-state` 没有滚动容器，真机横屏需要复验。
- 回退点：删掉 `.chat > .empty-state` 这条规则即可（无其它引用）。

### 下一步

纯问答回合的任务头去留 → 提问（question）内联卡的选择态 → 状态矩阵（加载/离线/失败/无权限/窄屏/深浅主题）。

## 2026-11-10 UI 切片 10：回合大纲 —— 标题不再漏出 markdown 标记

### 审查（真实 `OutlineView`，390px；顺带把产物页在大/窄两档拍了一遍）

大纲页结构是对的：时间轴导轨 + 节点圆点、「第 N 轮 + 时钟」、「未加载」徽章、当前轮的强调框 +「正在看」，点任意一轮回到原位。

但**标题里直接漏着 markdown 标记**：

- 「空态没有 flex 权重，\`.chat\` 是 flex 列…」—— 反引号原样显示；
- 「\*\*改 pre-wrap + anywhere\*\*…」—— 星号原样显示。

`conclusionOf` 原本只剥了行首的 `#`/`>`/`-` 和成对的 `**`，行内代码、链接、删除线、`__粗体__` 都漏过去了。同一批截图里产物页（390px / 320px 两档）没有溢出也没有错位，未改。

### 改了什么

`views/OutlineView.tsx` 的 `conclusionOf` 增加一轮行内标记剥离：

| 输入 | 输出 |
|---|---|
| ``空态没有 flex 权重，`.chat` 是…`` | 空态没有 flex 权重，.chat 是… |
| `**改 pre-wrap + anywhere**，…` | 改 pre-wrap + anywhere，… |
| `看 [这份文档](https://…) 的第三节。` | 看 这份文档 的第三节。 |
| `~~旧方案~~ 保留四态卡片。` | 旧方案 保留四态卡片。 |
| `变量 changed_files 和 snake_case 保持原样。` | 原样（只认成对的 `__`，不碰标识符里的 `_`） |

只改标题的"压成一句"，不动解析、不动时间轴、不动跳转。

![回合大纲（石墨深色）：标题已是纯文本，不再带反引号与星号](C:\Users\Administrator\.dsh\screenshots\outline-graphite.png)

### 保留的能力

点节点跳回原轮、当前轮标记（`aria-current` + 「正在看」）、未加载轮的「未加载」徽章且不编时间、「只显示最近 N 轮」的截断说明、时间格式化、`snippet()` 44 字截断 —— 全部未动。

### 改动文件

- `views/OutlineView.tsx`：`conclusionOf` 增加 5 条 `replace`（链接/图片、反引号、成对粗体、删除线、残余 `**`）。
- `views/OutlineView.test.tsx`：新增「行内 markdown 标记要剥掉」用例（含 snake_case 反例）。
- 预算：`src/mobile/views` 17849 → 17865（+16 行，本切片代码与用例）。

### 先红后绿

- 用例先红（标题里仍是 `` `.chat` ``）；改完 `OutlineView` **10/10**。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `OutlineView` 10/10 |
| 视觉（组件级，非整屏） | `outline-graphite.png`：四条节点标题全是纯文本；产物页 `artifacts-graphite.png`（390px）/ `artifacts-320.png`（320px）无溢出 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 158.15 kB（hash `63c3ce85`，纯 TS 改动，CSS 未变） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20（`src/mobile/views` 17865、单文件 `views/OutlineView.tsx` 160） |
| `pnpm test` | exit 0；**2,914 passed**、1 expected fail、10 skipped |
| 串行总耗时 | 83 s |

### 未测 / 风险

- 整屏与真机未测；浅色/夜航未单独截图（同一套 token）。
- 风险：只剥"标记"不剥语义 —— 单星号 `*强调*` 与单个 `_` 仍保留（避免误伤 `changed_files` 与行首列表符号），所以极少数写法仍会露出一个星号；这是有意的取舍。
- 说明：这一屏的标题取的是**回复首行**（定版图口径"结论标题"），不是用户提问 —— 本片没有改这条口径；若以后觉得"按提问找轮次"更顺手，那是产品决策，需要先改测试。
- 回退点：删掉那 5 条 `replace`，用例同步回退。

## 2026-11-10 UI 切片 11：上下文页 —— 百分比从"只有读屏能听到"变成"看得见"

### 审查（真实 `ContextView`，390px）

大数字 + 占用条 + 两个事实（窗口总量 / 压缩前预计）+ 一段说明，层级是清楚的。但**占用比例只存在于 `aria-label` 里**：

- 148.0k 与 200.0k 分两行摆，用户得自己心算 148/200；
- 占用条没有刻度，也没有端点标签；
- `aria-label="上下文已用 74%"` 只有读屏能拿到。

这一屏要回答的核心问题就是"还剩多少余量"，比例是答案本身。

### 改了什么

数字旁直接写百分比：

```
148.0k  已占用  74%
```

- 百分比 13px、二级前景色（`--palm-fg-2`），比单位「已占用」（12px 三级色）更醒目 —— 它是这一屏真正要回答的数；
- `aria-hidden`：占用条自己的 `aria-label` 已经报过同一句，避免读屏念两遍；
- 不引入行内样式、不新造组件，只加一个 span 和一条 token 规则。

![上下文页（石墨深色）：74% 直接写在数字旁](C:\Users\Administrator\.dsh\screenshots\context-graphite.png)

### 保留的能力

大数字与 k 缩写、占用条四档 `data-level` / `data-pressure="high"`、`aria-label`、窗口总量与压缩前预计两个事实、"宿主还没报上"空态、返回 —— 全部未动。

### 改动文件

- `views/ContextView.tsx`：数字行加 `<span class="context-page-figure-pct" aria-hidden>`。
- `styles/500-context-page.css`：新增 `.context-page-figure-pct` 一条规则（两个令牌，无裸色）。
- `views/ContextView.test.tsx`：新增「比例写在数字旁边且 aria-label 仍是同一个数」用例。
- `mobile-styles.structure.test.ts`：新增「百分比用二级色、字号 t-m、不出现裸色」契约。
- `mobile-styles.ts` 重新生成。

### 先红后绿

- 用例先红（`querySelector('.context-page-figure-pct')` 是 null）；改完 `ContextView` **7/7**，样式契约 **51/51**。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `ContextView` 7/7、`mobile-styles.structure` 51/51 |
| 视觉（组件级，非整屏） | `context-graphite.png`：148.0k / 已占用 / 74% 一条基线，占用条在同一块里 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 158.25 kB（hash `e4ebb5bc`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20（`src/mobile` 60190、单文件 `views/ContextView.tsx` 122） |
| `pnpm test` | exit 0；**2,916 passed**、1 expected fail、10 skipped |
| 串行总耗时 | 82 s |

### 未测 / 风险

- 整屏与真机未测；浅色/夜航未单独截图（同一套 token）。
- 风险：比例是 `Math.min(1, used/window)`，**超过 100% 时也显示 100%**（与占用条一致）；若宿主上报的已用量可能超出窗口，需要另外决定是否显示 `>100%`。
- 风险：百分比与「已占用」同在一条 flex 行，320px 极窄屏上三个元素（值 + 单位 + 百分比）会换行；本片未在 320px 复验。
- 回退点：删掉 span 与 CSS 规则，用例同步回退。

### 下一步

纯问答回合的任务头去留 → 提问（question）内联卡的选择态 → 状态矩阵（加载/离线/失败/无权限/窄屏/深浅主题）。

### 下一步

纯问答回合的任务头去留 → 提问（question）页 → 状态矩阵（空/加载/离线/失败/无权限/窄屏/深浅主题）。

## 2026-11-10 UI 切片 12：设置页的分组标题可读性（外观 / 对话 / 其他）

### 审查（真实 `SettingsView` + 构建后的 `app.css`，390px）

设置页本体是好的：搜索框、三组卡片、每行「图标方块 + 标题 + 说明 + 右侧值/开关 + 箭头」、用量骨架条、页脚说明。**没有需要重排的地方。**

唯一的问题是**分组标题**：「外观 / 对话 / 其他」是 11px 三级灰，在深色皮肤上几乎读不出来；而它们是这一页唯一的分区线索（三张卡连在一起，没有别的分隔）。这与切片 6 里抽屉分组标题的结论完全一致。

同批顺带审查了**提问内联卡**（点选一项后）：选中项有描边 + 实心圆点 + 加亮的标签，未选中项只有细描边 —— 选择态清楚，未改。

### 改了什么

| | 改前 | 改后 |
|---|---|---|
| 分组标题（`.palm-spec-group-head`） | 11px / `--palm-fg-3` | 11px / **`--palm-fg-2`** |
| 右侧说明（`.palm-spec-group-note`） | `--palm-fg-3` | 不变（辅助信息） |

这条规则是共享的：设置、外观、产物、上下文等页的分组标题一起变亮，口径与抽屉一致。

![设置页（石墨深色）：外观 / 对话 / 其他 三组标题可读，行标题仍是最亮的一级](C:\Users\Administrator\.dsh\screenshots\settings-graphite.png)

### 保留的能力

搜索（含空结果）、三组设置项、开关与右侧值、用量骨架、主机配置分组、清缓存/反馈/关于、页脚说明 —— 全部未动；只改一个颜色令牌引用。

### 改动文件

- `styles/515-five-screens.css`：`.palm-spec-group-head` 的 `color` 改为 `--palm-fg-2`（附原因注释）。
- `mobile-styles.structure.test.ts`：新增「分组标题可读性」契约两条（标题二级色、右侧说明仍三级色）。
- `mobile-styles.ts` 重新生成。

### 先红后绿

- 契约先红（仍是 `--palm-fg-3`）；改完 `mobile-styles.structure` **53/53**。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 53/53 |
| 视觉（组件级，非整屏） | `settings-graphite.png`：三组标题可读、行标题仍最亮；`question-picked.png` 记录提问卡选中态审查（未改） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 158.25 kB（hash `0f1ccf9a`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20 |
| `pnpm test` | exit 0；**2,918 passed**、1 expected fail、10 skipped |
| 串行总耗时 | 86 s |

### 未测 / 风险

- 整屏与真机未测；浅色/夜航未单独截图（同一套 token）。
- 风险：分组标题与行标题（15px `--palm-fg`）在同一屏里只差字号与色阶，远看可能觉得"头重"；若出现这种反馈，回退这条规则即可（只影响颜色）。
- 回退点：`color` 改回 `--palm-fg-3`，契约同步回退。

### 下一步

纯问答回合的任务头去留 → 状态矩阵（加载/离线/失败/无权限/窄屏/深浅主题）。

## 2026-11-10 UI 切片 13：加载骨架 —— 状态条占位不再像「坏掉的控件」

### 审查（真实 `TurnHeadSkeleton` + `Skeleton`，390px，深浅各一张）

进入一个从没打开过的会话时，首帧画的是与真实任务头同构的骨架。但骨架里的状态条放的是**真 `StatusStrip`**（`kind="unknown"`、`label="—"`）：

- 屏幕上出现一条全宽的**空药丸**，左边一个小圆点 + 一个破折号「—」；
- 它看起来像一个渲染失败的控件，而不是"内容正在来的路上"；
- 与旁边灰条的骨架语言完全不统一。

### 改了什么

| | 改前 | 改后 |
|---|---|---|
| 骨架状态条 | 真 `StatusStrip`（空药丸 + 「—」） | `div.palm-strip[data-skeleton]`（纯占位面） |
| 文字内容 | 「—」 | 无（`aria-hidden`，外层已有 `aria-busy` + `aria-label="正在读取会话"`） |
| 高度 | `--palm-strip-h` | 不变（类名与行序仍与真实头同构） |
| 填充 | 状态条自己的 track | 骨骼色 `--fill`、描边透明 |

![加载态（石墨深色）：目标行、状态条、正文行都是同一套占位条](C:\Users\Administrator\.dsh\screenshots\skeleton-graphite.png)

![加载态（paper 浅色）：同一结构，占位块与底色区分得开](C:\Users\Administrator\.dsh\screenshots\skeleton-paper.png)

### 保留的能力

- 骨架与真实任务头**同高同序**（`.palm-turn-goal` / `.palm-strip-wrap` / `.palm-strip` 类名不变，吃同一套 `--palm-turn-*` 与 `--palm-strip-h`）；
- 首帧不写「加载中…」、不先下结论的既有口径；
- `aria-busy` + `aria-label="正在读取会话"` 仍在（读屏知道在加载）。

### 改动文件

- `ui/turn-header.tsx`：`TurnHeadSkeleton` 里用 `div.palm-strip[data-skeleton]` 取代 `StatusStrip`。
- `styles/130-skeleton.css`：新增 `.palm-strip[data-skeleton='true']` 两条（`--fill` + 透明描边）。
- `ui/turn-header-unknown.test.tsx`：新增「骨架状态条是占位块、没有文字」用例。
- `views/ChatView.test.tsx`：原来断言「骨架状态条写着 —」的那条改成断言占位块（这是被本切片**有意改变**的行为）。
- `mobile-styles.ts` 重新生成；预算 `src/mobile/ui` 2178 → 2186。

### 先红后绿

- 用例先红（`data-skeleton` 为 null、状态条里有「—」）；改完 `turn-header-unknown` + `turn-header` + `message-row-process-group` **43/43**，`ChatView`（含改过的那条）全绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | 43/43 + `ChatView` 单测（`same-height skeleton` 用例单独验过） |
| 视觉（组件级，非整屏） | `skeleton-graphite.png` / `skeleton-paper.png`：只有占位条，没有空药丸与破折号 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 158.32 kB（hash `20aafbb3`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20（`src/mobile/ui` 2186） |
| `pnpm test` | exit 0；**2,919 passed**、1 expected fail、10 skipped |
| 串行总耗时 | 98 s |

### 未测 / 风险

- 整屏与真机未测；**骨架停留时长**（弱网/首屏）没在真机量过。
- 风险：状态条原来的 `StatusStrip` 会自带 `role`/`aria` 语义，现在整块 `aria-hidden`，只剩外层 `aria-busy` + 标签；若读屏体验需要更细的"第几条"提示，需要在骨架层补，而不是恢复假控件。
- 回退点：`TurnHeadSkeleton` 恢复 `<StatusStrip kind="unknown" label="—" />`、删掉 CSS 两条、两条测试回退。

### 下一步

纯问答回合的任务头去留 → 无权限/失败态 → 键盘弹出与窄屏的系统化截图。

## 2026-11-10 切片 14：批准方式页 —— 最放开那一档补回「先确认」

### 审查（真实 `ApprovalModeView`，390px，深浅各一张）

四档卡片（只读 / 建议模式 / 自动 / 完全权限）排版是干净的，当前档有描边 + 「当前」。但**这一轮查出的是行为不一致，不只是视觉**：

| 路径 | 点「完全权限」之后 |
|---|---|
| 对话页内联选择器（`composer-meta` → `applyPermission`） | 走 `PermissionConfirmSheet`：先说清后果，取消/确认 |
| 独立页 `ApprovalModeView`（本屏） | 直接 `onApply` → 发 `/permission danger-full-access` |

同一个动作两条路径、两种安全等级 —— 是页面迁移时漏掉的。对"权限放开"这种不可撤销的语义，第一次点击就生效不合适。

### 改了什么

- 新增 `views/chat/lib/permission-confirm.ts`：`CONFIRM_PERMISSION_VALUE` + `needsPermissionConfirm(value)` —— **"哪一档必须先确认"这个事实的唯一所有者**（对话页与独立页都从这里取，不再各写一个字面量）。
- `ApprovalModeView`：点击需要确认的档位先展开一段**内联确认**（警示色描边 + 后果说明 + 取消/确认放开）；确认后才调 `onApply`，提交路径仍然只有一条。
- 样式复用语义色：`--palm-warn` / `--palm-tint-warn`，取消按钮保持安静，确认按钮用警示色描边 + 加粗。

![批准方式页（石墨深色）：点「完全权限」后展开确认，取消保持安静](C:\Users\Administrator\.dsh\screenshots\approval-mode-graphite.png)

![批准方式页（paper 浅色）：同一结构，警示块与底色区分得开](C:\Users\Administrator\.dsh\screenshots\approval-mode-paper.png)

### 保留的能力

四档列表、当前档标记、`aria-pressed`、宿主没给选项时的说明、应用失败错误、底部放宽提醒、返回 —— 全未动；普通档位（以及"当前档"本身）**仍然点一下就切**，没有给日常操作加摩擦。

### 改动文件

- `views/chat/lib/permission-confirm.ts`（新增，约 20 行）。
- `views/ApprovalModeView.tsx`：`useState` + `apply()` 分流 + 内联确认块（94 → 128 行）。
- `styles/510-approval-mode-page.css`：新增 4 条规则（确认块 / 文案 / 按钮行 / 确认按钮）。
- `views/ApprovalModeView.test.tsx`：新增 2 条用例（危险档要二次确认、当前档/普通档仍直接切）。
- 预算：`src/mobile` 60190 → 60305、`src/mobile/views` 17865 → 17945、单文件 `ApprovalModeView.tsx` 94 → 128、`cssClasses` 774 → 778。

### 先红后绿

- 用例先红（`onApply` 在第一次点击就被调用）；改完 `ApprovalModeView` **8/8**。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `ApprovalModeView` 8/8、`mobile-styles.structure` 53/53 |
| 视觉（组件级，非整屏） | `approval-mode-graphite.png` / `approval-mode-paper.png`：确认块在四档之下、按钮右对齐 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 158.86 kB（hash `fc3e61c4`） |
| `pnpm guard` | exit 0；预算 files=5 dirs=20 |
| `pnpm test` | exit 0；**2,921 passed**、1 expected fail、10 skipped |
| 串行总耗时 | 80 s |

### 未测 / 风险

- 整屏与真机未测。
- 风险：危险档的字面量目前只有一个（`danger-full-access`），宿主若新增别的高危档位，需要同步 `needsPermissionConfirm`；这是**显式白名单**，宁可漏问也不要误问。
- 风险：确认块是"再点一次"的轻确认，不是独立对话框；若以后要求"必须滚到底才能确认"之类的强约束，需要在 sheet 层做。
- 回退点：`ApprovalModeView` 去掉 `apply()` 分流与确认块、删掉新模块与 4 条 CSS、两条用例回退。

### 下一步

纯问答回合的任务头去留 → 失败/错误态与键盘弹出、窄屏的系统化截图。

## 2026-11-10 切片 15：失败回合卡补上「重试」—— 失败态必须给下一步

### 审查（真实 `MessageRow` + 交付卡，390px，深浅各一张）

失败回合的卡面是完整的：红边、「! 没做成」、文件行带「修改」徽章、「2 个文件」。**唯独没有下一步动作。**

追下去发现是两处各差一点：

1. `DeliveryCard` 早就支持 `onRetry`（失败态右上角出一颗「重试」），但 `MessageRow` 从来没把重生成回调接进去（`onRetry` 一直是 `undefined`）；
2. 即使接进去也没用 —— `offersRegenerate()` 的判据要求 `isAssistant`，而回合尾行的 `kind` 是 `turn`，所以失败回合永远拿不到重生成回调。

### 改了什么

| 位置 | 改动 |
|---|---|
| `chat-scroll.ts` `offersRegenerate()` | 新增 `retryableTurn`：失败回合（且没有在跑）也给回调；`pending`/`turnLive` 仍然一票否决 |
| `ChatView.tsx` `regenerateFor()` | 传 `retryableTurn: message.kind === 'turn' && message.failed === true` |
| `render/message-row.tsx` | 失败态把 `onRegenerate` 作为 `onRetry` 交给交付卡；**没给回调就不画按钮** |

重试本身复用既有 `handleRegenerate`：它会从这一行往回找最近一条提问再重发，不新增发送路径。`unknown`（中断未标记失败）**不给**重试 —— 那是"拿不到结论"，不是"确定失败"。

![失败回合卡（石墨深色）：右上角出现「重试」，与「没做成」同一行](C:\Users\Administrator\.dsh\screenshots\fail-card-graphite.png)

![失败回合卡（paper 浅色）：重试用强调色，不与红色失败语义抢](C:\Users\Administrator\.dsh\screenshots\fail-card-paper.png)

### 保留的能力

- 「没做成」标题 + 失败描边 + 文件行 + 修改徽章 + 计数，未动；
- 成功态/运行态交付卡不受影响（只有 `state === 'failure'` 才接 `onRetry`）；
- 重新生成的既有纪律不变：`pending`/`turnLive` 时不给按钮、第一次点提示"原来的保留"。

### 先红后绿

- 用例先红（失败卡上找不到「重试」）；改完 `turn-verdict-row` **10/10**、`message-row` + `delivery-card` + `process-group` 共 55 条全绿；`ChatView` 的 `offersRegenerate` 三个用例全绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `turn-verdict-row` 10/10、`render/*` 55/55、`ChatView -t offersRegenerate` 全绿 |
| 视觉（组件级，非整屏） | `fail-card-graphite.png` / `fail-card-paper.png`：失败卡右上角「重试」 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 158.86 kB（hash `fc3e61c4`，本轮无 CSS 改动） |
| `pnpm guard` | exit 0；`src/mobile` 60315 |
| `pnpm test` | exit 0；**2,924 passed**、1 expected fail、10 skipped |
| 串行总耗时 | 83 s |

### 未测 / 风险

- 整屏与真机未测：**失败态的真实触发**（宿主报错/断流）没有在真机复现过，重试后宿主的实际行为未验证。
- 风险：`handleRegenerate` 会往回找最近的提问；如果失败回合前面没有用户行（例如系统注入的一轮），会退化成"请忽略上一条回答，重新作答刚才的问题"，语义偏弱 —— 已有行为，本片未改。
- 回退点：`offersRegenerate` 去掉 `retryableTurn` 分支、`MessageRow` 去掉 `onRetry` 传递、两条用例回退。

### 下一步

纯问答回合的任务头去留 → 键盘弹出与窄屏的系统化截图。

## 2026-11-10 切片 16：窄屏复核 + 状态矩阵落盘

### 做了什么（验证切片，无源码改动）

1. **320px 窄屏复核**两张最挤的页：
   - 上下文占用（切片 11 记下的未测风险"值 + 单位 + 百分比可能换行"）：**没有换行**，`148.0k 已占用 74%` 仍在一行，占用条与两个事实行对齐 —— 风险关闭。
   - 设置页：行标题/说明/右侧值/开关全部对齐，说明单行省略（设计如此），无横向溢出。
2. 新增 `docs/ui-state-matrix.md`：逐屏记录**实际看过的状态**（深/浅、390/320）、对应截图、以及**明确没验的项**（键盘弹出、真机热区、弱网真实时序、无权限首屏）和已知未做的设计项（纯问答回合任务头，代价是 8 条用例）。

![上下文页 320px：数字行不换行，切片 11 的风险关闭](C:\Users\Administrator\.dsh\screenshots\context-320.png)

![设置页 320px：行布局不塌，说明单行省略](C:\Users\Administrator\.dsh\screenshots\settings-320.png)

### 未测 / 风险

- **键盘弹出**仍未验：jsdom 没有软键盘与视口缩放；`dvh` 与 `env(safe-area-inset-*)` 已在样式里（`.mobile-header` / `.chat-input` / `.composer`），但真实顶起行为需要真机。
- 320px 只覆盖了上下文、设置、产物、diff 四页；聊天 composer、审批、搜索、大纲未在 320 复验。
- 本切片无源码改动，因此没有重跑全量门禁；上一次全量门禁（切片 15）为 typecheck 0 / build 0 / guard 0 / test 2,924 passed，之后只新增了 `docs/ui-state-matrix.md`。
- 收尾时重跑了一次全量门禁（切片 17 回退之后）：typecheck 0 / build 0（`app.css` 158.86 kB，hash `fc3e61c4`）/ guard 0 / test **2,924 passed**、1 expected fail、10 skipped，84 s。

### 下一步

纯问答回合的任务头去留（需要先改判据 + 8 条用例）→ 聊天 composer 与审批页的 320px 复验。

## 2026-11-10 切片 17（**回退**）：一次被证据否掉的「空 token」判断

### 我以为什么问题

在 320px 复核时顺手扫了 `styles/*.css`：`--text-primary / secondary / tertiary / quaternary / muted`
被引用 **199 次**，但在这批 CSS 里**一个都没定义**。看上去是一大批 `color` 声明在计算时失效、
回退到继承色 —— 正好能解释"为什么配对页的说明文字与字段名同色"。

### 证据怎么否掉的

1. 我把这 5 个名字按 `--palm-fg` 三档补成 `:root` 别名，重新构建、重拍配对页 —— **截图逐像素不变**（sha256 与改前完全一致）。如果真的从"继承色"变成 `#70707f`，不可能一模一样。
2. 于是去找真正定义它们的地方：`design/tokens.ts` 里两套主题都写全了这 5 个名字（`light` 第 26–33 行、`dark` 第 93–97 行），并且 `design/tokens.test.ts` 有对比度用例（第 107–129 行）钉着它们。
3. 我的扫描只覆盖了 `styles/*.css`，没算运行时注入的调色板 —— **假设本身就是错的**，不是代码的问题。

### 结论

- 已完整回退：`styles/000-tokens.css` 的别名块、`mobile-styles.structure.test.ts` 的守卫用例都删掉；重新生成后 `app.css` 哈希回到 `fc3e61c4`（与切片 15 完全一致），`mobile-styles.structure` 回到 53/53。
- 学到的一条（已写进 `docs/ui-state-matrix.md` 的复现说明里）：**`--text-*` 这些旧名来自 `design/tokens.ts` 的运行时注入，不在 `styles/*.css` 里**，任何"未定义 token"的扫描必须把调色板算进去，否则必然误报。

### 未测 / 风险

- 无源码净改动（改→验证→回退），工作树里没有留下这一片的痕迹。
- 风险：这类误判会白花时间；以后凡是要断言"X 没定义"，先在**构建产物** `lib/mobile/app.css` 里 grep，而不是只 grep 源 CSS。

### 下一步

纯问答回合的任务头去留（需要先改判据 + 8 条用例）→ 聊天 composer 与审批页的 320px 复验。

## 2026-11-10 切片 18：320px 空会话首屏（含 composer）复验

### 审查（真实 `ChatEmptyView`，320px，空态与长草稿两态）

先纠正切片 16 里那条记账：**任务头的目标行不是回答首行**，它是会话级 `goal` 投影（`ChatView` 的 `goal` → `ChatRows` 的 `turnGoal`）。所以"任务头重复了回答"不成立，纯问答回合的头只剩状态条（「完成 · X 秒」）—— 去掉它会连状态与耗时一起丢掉，**不值得**做。这条从"待办"里划掉。

320px 下空首屏本体是好的：图标块、标题、说明、三枚建议胶囊（两行居中）、composer 贴底，都不塌。长草稿（五六行）时输入框按 `max-height: 104px` 自己滚 —— 最后一行被框内滚动裁半行，这是滚动视口的正常表现。

### 改了什么（防御性）

`styles/055-empty-state.css` 给 `.chat > .empty-state` 补 `min-block-size: 0` 与 `overflow-y: auto`：flex 子项默认最小高度是内容高度，草稿变高时它不肯让位，composer 就有被顶出视口的机会。这一条**没有复现出确定的溢出**（见下），按"防御性约束"记账，不当成已修 bug。

![空会话首屏 320px：图标、标题、三枚胶囊两行居中、composer 贴底](C:\Users\Administrator\.dsh\screenshots\empty-320.png)

![320px 长草稿：输入框自滚，发送键仍在](C:\Users\Administrator\.dsh\screenshots\empty-320-draft.png)

### 为什么标"防御性"而不是"修复"

想用「`#host` 底部画一条红线，看 composer 有没有越线」来判定是否真的溢出，同一条 URL 下换了 CSS 文件名、加了 `box-shadow` 红线、甚至把视口拉到 700px 都没有产生可区分的渲染结果 —— 只有"改视口高度"这一项生效了。也就是说：**这一轮的截图通道没法把"底部几像素"这件事判定清楚**，我不拿它当证据。真机看一次即可定论。

### 保留的能力

空态居中、建议胶囊、composer 贴底、`rows=1` 自适应、输入框 4 行封顶自滚、`aria-label`、发送回调 —— 全部未动；只加两条防御性 CSS。

### 改动文件

- `styles/055-empty-state.css`：`.chat > .empty-state` 增加 `min-block-size: 0` / `overflow-y: auto`（注释里写明是 320px 实拍后的防御性约束）。
- `mobile-styles.structure.test.ts`：新增契约「空态可以被压缩，composer 不许被顶出视口」。
- `mobile-styles.ts` 重新生成。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 54/54、`chat-empty` 全绿 |
| 视觉（组件级，非整屏） | `empty-320.png`（空态）、`empty-320-draft.png`（长草稿） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 158.90 kB（hash `1c0eae37`） |
| `pnpm guard` | exit 0；预算不变 |
| `pnpm test` | exit 0；**2,925 passed**、1 expected fail、10 skipped |
| 串行总耗时 | 86 s |

### 未测 / 风险

- 整屏与真机未测；**320px 下 composer 是否真的会越出视口仍未定论**（截图通道判定不了几像素的差别）。
- 风险：`min-block-size: 0` 让空态在极矮视口上可能压缩到只剩半屏内容（会自己滚），若某天觉得"空态被压扁"，回退这两条即可。
- 回退点：删掉 `min-block-size`/`overflow-y` 两条与对应契约。

### 下一步

聊天 composer（真实会话内、含队列条）与审批页的 320px 复验；键盘弹出继续等真机。

## 2026-11-10 切片 19：320px 审批详情复核 —— 横滚是有意的，圆角切口先记账

### 审查（真实 `ApprovalView` + 长命令 + 长参数，320px）

版面本身经得住：工具/风险两枚芯片一行、会话标题一行、命令块封顶、警示条、按住 1.5 秒批准 + 拒绝两颗按钮并排，页脚那句「批准后它才会动手」贴在底部。

唯一刺眼的是**命令正文被容器圆角切掉最后几个字符**，看着像渲染坏了。追下去这不是布局塌陷：

- `.approval-detail-command` 有 `overflow: hidden` + 圆角，`.approval-detail-code` 在里面横滚（`overflow-x: auto` + `white-space: pre`）——**横滚是切片 7 有意钉的**：命令再长也不许把「批准/拒绝」顶出屏幕。这条取舍我不推翻。
- 横滚容器里的 `padding-inline-end` 只在**滚到底**时出现（trailing padding 不属于可视窗口），所以"加右侧内边距把字挪开圆角"这个想法**实测无效**：加完重拍，像素一点没变。已回退。

### 结论

本轮**无源码净改动**（改→验证→回退，构建哈希回到 1c0eae37）。要把切口彻底处理掉，只有两条路：给父容器加内边距（会缩窄命令可视宽度），或给右侧加渐变遮罩（要按是否溢出条件渲染，需 JS 量宽）。两者都超出"一个可审切片"，先记账。

![审批详情 320px：命令块横滚、两颗按钮常驻](C:\Users\Administrator\.dsh\screenshots\approval-320.png)

### 未测 / 风险

- 整屏与真机未测；横滚时的可视提示（有没有滚动条/能否滑动）在真机才看得准。
- 风险：命令尾部被圆角切掉，用户可能以为命令就这么多 —— 这是"审批前应当读全"的隐患，建议下一轮优先做**右侧渐变遮罩**（父容器不缩宽）。

### 下一步

给审批命令块加"还有内容"的右侧渐变（条件渲染，需量宽）→ 真实会话内 composer（含队列条）320px。

## 2026-11-10 切片 20：审批命令块的「右缘渐隐」—— 让用户知道后面还有

### 问题（切片 19 记下的账）

审批命令块按切片 7 的取舍在块内横滚（保证「批准/拒绝」永远在屏幕上），代价是正文被容器圆角硬切，**用户分不清"命令就这么多"还是"后面还有一半没读到"**。审批前读全是硬要求。

上一轮试过"加右侧内边距"——无效（横滚容器的 trailing padding 只在滚到底时出现），已回退。

### 改了什么

1. 新增 `ui/overflow-fade.ts`：`useOverflowFade<T>()` —— 绑定横滚元素，量 `scrollWidth - clientWidth`，真溢出才给 `fade = 'end'`；**滚到最右自动撤掉**（渐隐不能变成新的困惑）。订阅 `scroll` + `ResizeObserver`（jsdom 没有就跳过，不让测试环境炸）。
2. `ApprovalPanel` 的命令块接上它：`ref` + `data-fade`。
3. 样式：`.approval-detail-code[data-fade='end']` 用 `mask-image` 在右缘画渐隐，遮罩取 `currentColor`（**不引入任何新颜色值**）；带 `-webkit-` 前缀。

![审批面板 320px：命令右缘渐隐，看得出后面还有内容](C:\Users\Administrator\.dsh\screenshots\approval-fade-320.png)

### 保留的能力

- 横滚本身不动：`overflow-x: auto` + `white-space: pre`，按钮仍常驻屏幕；
- 短命令没有尾巴（只在真溢出时标记）；滚到最右自动撤掉；
- 「原始参数」展开、按住 1.5 秒批准、拒绝、风险芯片、警示条，全未动。

### 先红后绿

- 先写 3 条判定用例（溢出 → `end`、装得下 → `none`、滚到最右 → `none`）。第三条先红，原因是测试把 `scrollLeft` 打在了**尚未存在**的节点上；改成"渲染后派发 scroll 事件"再断言，**3/3** 绿（顺带把 scroll 监听也测到了）。
- 样式契约：新增「溢出时右缘渐隐、遮罩不含裸色」，`mobile-styles.structure` **55/55**。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `overflow-fade` 3/3、`sheets` 全绿、`mobile-styles.structure` 55/55 |
| 视觉（组件级，非整屏） | `approval-fade-320.png`：命令右缘渐隐可见，与切片 19 的硬切对照 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.24 kB（hash `f8cd20c4`） |
| `pnpm guard` | exit 0；预算 `src/mobile` 60395、`src/mobile/ui` 2250 |
| `pnpm test` | exit 0；**2,929 passed**、1 expected fail、10 skipped |
| 串行总耗时 | 83 s |

### 未测 / 风险

- 整屏与真机未测；**真实浏览器里的 `scrollWidth/clientWidth` 量取**没有在真机核对（单测是 stub 的），渐隐的宽度与颜色也没有肉眼在真机上比过。
- 风险：`mask-image` 在个别老 WebKit 上会让文本边缘发虚；已带 `-webkit-` 前缀，若真机看到发虚就回退这条规则（其余不动）。
- 风险：`ResizeObserver` 缺失的环境（老 Safari）只在挂载与滚动时量一次，旋转屏幕后可能短暂不准。
- 回退点：删 `useOverflowFade` 与 `data-fade` 绑定、删 CSS 一条，用例同步回退。

### 下一步

真实会话内 composer（含队列条）320px 复验；键盘弹出继续等真机。

## 2026-11-10 切片 21：待发队列行在 320px 不再把正文压成两个字

### 审查（真实 `ComposerSection` + `QueueDock`，320px）

队列条本身没问题：一行「2 条排队 · 当前任务结束后执行」用琥珀色压在输入框上方，读得清。但**展开的队列行塌了**：

| | 现象 |
|---|---|
| 改前 | 一行里塞「编辑 / 删除 / 撤回 / 立即发送」四个按钮，文本格被压到约两个字宽，排队的那句话变成「把…」 |
| 为什么糟 | 队列存在的意义就是"让人知道排了什么、顺序对不对"；这一压把意义压没了，只剩一排按钮 |

原因是 `.queue-dockRow` 不换行、`.queue-dockText` 是 `flex: 1 1 auto` + `min-width: 0`：四个按钮固定宽度先占住，剩下的零头给了正文。

### 改了什么

- `.queue-dockRow` 加 `flex-wrap: wrap`：宽度不够时**动作行整体落到下一行**，正文先占满第一行。
- `.queue-dockText` 改成 `flex: 1 1 12ch` + `min-inline-size: 9ch`：给正文一个下限，宁可换行也不压成两个字。

![待发队列行 320px：正文占满第一行，四个动作换到第二行右对齐](C:\Users\Administrator\.dsh\screenshots\composer-320.png)

### 保留的能力

编辑 / 删除 / 撤回 / 立即发送四个动作全在（只是换行），条目顺序、`role`、每条一次的 in-flight 互斥、撤销/插话的 RPC 路径都没动；只是排版层换行。

### 先红后绿

- 两条结构契约先红（行不换行、文本格没有下限）；改完 `mobile-styles.structure` **57/57**，`queue-dock` 全绿（合计 69 条专项）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 57/57 + `queue-dock` 全绿 |
| 视觉（组件级，非整屏） | `composer-320.png` 前后对照：正文从「把…」变成整行可读 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.27 kB（hash `f61e1df7`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,931 passed**、1 expected fail、10 skipped；串行 80 s |

### 未测 / 风险

- 整屏与真机未测：**键盘弹出时队列条与输入框一起上移**的真实表现仍未看。
- 风险：换行让每条队列项变高（两行），`.queue-dockList` **没有高度上限**；排到 3 条以上时 dock 会明显吃掉正文可视区。下一步应给它一个 `max-block-size` + 内部滚动，但要先在真机上确认 3 条以上的观感。
- 回退点：删 `flex-wrap` 与文本格两条，契约同步回退。

### 下一步

队列 dock 的高度上限（3 条以上时内部滚动）→ 键盘弹出与真机触控验收。

## 2026-11-10 切片 22：待发队列列表封顶（32vh 内部滚动）

### 为什么接着做

上一片让队列行换行（正文不再被压成两个字），代价是每条变两行 —— `.queue-dockList` 本来没有高度上限，排到三四条时 dock 会一路往上吃掉正文可视区。

### 改了什么

`.queue-dockList` 加 `max-block-size: 32vh` + `overflow-y: auto`：条目多时**列表内部滚动**，「N 条排队 / 收起」表头与输入行都不动。

![4 条排队的 dock 320px：表头固定、列表在 32vh 内滚动](C:\Users\Administrator\.dsh\screenshots\queue-dock-320.png)

### 保留的能力

编辑 / 删除 / 撤回 / 立即发送、表头「N 条排队」与「收起/展开」、每条一次的 in-flight 互斥、撤回/插话路径 —— 全未动；只是给列表加了高度上限。

### 先红后绿

- 契约先红（列表没有 `max-block-size` / `overflow-y`）；改完 `mobile-styles.structure` **58/58**，与 `queue-dock` 合计 **70 条**专项全绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | 结构契约 58/58 + `queue-dock` 全绿 |
| 视觉（组件级，非整屏） | `queue-dock-320.png`：4 条时表头在、第 2 条被列表边界切住 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.31 kB（hash `ece74991`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,932 passed**、1 expected fail、10 skipped；串行 85 s |

### 未测 / 风险

- **滚动本身没在真机验过**：截图通道里的 420px 画布也会切住第 2 条，分不清是"列表封顶"还是"画布到头"。契约（`max-block-size` + `overflow-y: auto`）是确定的，滚动体感不确定。
- 风险：`32vh` 是按"dock 不吃掉正文"估的，没在真机上量过键盘弹出后的可视区；若太小/太大，改一个数即可。
- 回退点：删这两条，契约同步回退。

### 下一步

键盘弹出与真机触控验收（唯一还没做的状态）；之后回到架构面：复核队列/outbox 账本的状态所有权。

## 2026-11-10 切片 23：会话投影的解析边界 —— 四处各自强转收成一份

### 问题（架构面，视图越过了数据边界）

`ChatView` 里有**四个**地方各自把 `page.projections.values` 强转成 `Record<string, unknown>`，再各自 `parsePermissionSelect` / `parseContextPressure` / 直接塞 `turnOutline` / `inbox`：

| 位置 | 语义 |
|---|---|
| 权威页姗姗来迟（L~1000） | 只覆盖**真的带了**的键，不许抹掉已有基线 |
| 首屏基线（L~1132） | 有投影块就**整块**覆盖 |
| 点开面板时就地补拉（L~3485） | 有值才写 |
| 权限切换后回读宿主（L~3529） | 只认 permissions 一个键 |

四处对"键缺失"的处理各不相同，而且都是**手写**的。投影再多一个键，就得四处同时记得加 —— 这是视图层在解释宿主协议。

### 改了什么

1. 新增 `views/chat/state/projections.ts`（76 行）：
   - `projectionValues(page)` —— 唯一一处强转，形状不对返回 `undefined`（"没有投影块"不许被当成"空投影"去覆盖基线）；
   - `parseProjections(values)` —— 一次解析四个键，并回答**"哪些键真的出现过"**（`present`），把"没说"和"说了是空"分开；
   - `pullProjections(sessionId)` —— 补拉一页并把失败原样抛回，不在数据边界里决定弹不弹错。
2. `ChatView` 四个调用点改成 `if (present.has(k))` / 整块 seed，删掉三处重复强转与两处重复解析；`ChatView.tsx` 从 3975 行降到 **3972 行**，`parsePermissionSelect`/`parseContextPressure` 不再被视图直接调用（改由边界调用）。

### 保留的能力

- 权限药丸的"权威页只覆盖带来的键"、首屏整块基线、切换后回读宿主覆盖乐观值 —— 三条语义逐条保留（`present` 就是为了区分它们）；
- 上下文压力、回合大纲、inbox 的写入时机不变；RPC 仍只经 `data/session.ts`。

### 先红后绿

- 先写 `projections.test.ts` 6 条（有/无投影块、形状不对、只带一个键、四键齐、坏数据不抛）。**先绿**是正常的：这是新模块的首版，红的是旧结构（四处重复）而不是行为。行为回归靠 `ChatView.test.tsx` **249 条**兜住。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `projections` 6/6、`ChatView` 249/249 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.31 kB（hash `ece74991`，本轮未动样式） |
| `pnpm guard` | exit 0；预算 `src/mobile` 60490、`src/mobile/views` 18045（新模块 76 行 + 用例） |
| `pnpm test` | exit 0；**2,938 passed**、1 expected fail、10 skipped；串行 82 s |
| 串行总耗时 | 82 s |

### 未测 / 风险

- 纯重构，**无视觉变化**，本轮不出截图为证（也不该拿截图证明没变）。
- 风险：`present` 的语义是"键在宿主投影里出现过"，但"出现且为 null"与"没出现"在线上数据里是否真的并存，我只在类型层面做了区分；真机上若宿主用 `null` 表示"没有权限信息"，`present.has('permissions')` 会让药丸被写成空 —— 需要一次真机/真会话观察确认。
- 回退点：删 `projections.ts` 与用例，四处调用点恢复原写法（原代码在切片 23 的 diff 里）。

### 下一步

队列/outbox 账本的状态所有权复核（是否有一份事实被两处持有）；键盘弹出继续等真机。

## 2026-11-10 切片 24：三套皮肤的辅助文字对比度都不达标 —— 一起抬到 AA

### 审查（先量，不靠眼判断）

`design/tokens.test.ts` 只管注入的两套主题（light / dark）。三套皮肤（graphite / paper / nocturne）的调色板写在 `styles/000-tokens.css` 里，**从来没人量过**。新写的 `styles/skin-contrast.test.ts` 把三块选择器解析出来按 WCAG 算了一遍，结果是三套**全部不及格**：

| 皮肤 | `--palm-fg-3`（三级辅助文字） | 对底色 | 结论 |
|---|---|---|---|
| graphite | `#70707f` on `#101015` | **3.90:1** | 低于 AA 4.5 |
| paper | `#8b857e` on `#faf8f4` | **3.44:1** | 最差的一套 |
| nocturne | `#64789a` on `#080c14` | **4.38:1** | 差一点 |

这正是需求里点名要避免的「低对比辅助文字」：时间戳、计数、说明行都用这一档。

### 改了什么

只动三套皮肤的 `--palm-fg-3`，各自抬到 AA 之上，并保持与 `--palm-fg-2` 的层级差：

| 皮肤 | 新值 | 新对比度 | fg-2 对比度（对照） |
|---|---|---|---|
| graphite | `#7e7e8f` | 4.68:1 | 7.8:1 |
| paper | `#746e67` | 4.76:1 | 6.6:1 |
| nocturne | `#6d82a5` | 5.03:1 | 9.1:1 |

![paper 皮肤新会话首屏：说明行明显更实，标题仍是最重的一档](C:\Users\Administrator\.dsh\screenshots\empty-paper-contrast.png)

![nocturne 皮肤（此前从未截过图）：说明行在深蓝底上读得清](C:\Users\Administrator\.dsh\screenshots\empty-nocturne.png)

### 保留的能力

三套皮肤、换肤开关、token 体系都不动；只改一个档位的取值。强调色/正文/语义色未改（`on-accent` 对 `accent` 的对比度用例本来就过）。

### 先红后绿

- `skin-contrast.test.ts` 先跑出三条红（3.90 / 3.44 / 4.38），改色后 **6/6** 绿；`design/tokens.test.ts` 13 条一起绿。
- 令牌基线按项目既定流程显式更新：`PALM_UPDATE_TOKENS=1 npx vitest run src/mobile/design/tokens-golden.test.ts`（`tests/golden/tokens.json` 随之更新，这是**有意的改色**，不是偷偷改基线）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `skin-contrast` 6/6、`tokens` 13/13、`tokens-golden` 3/3 |
| 视觉（组件级，非整屏） | `empty-paper-contrast.png` / `empty-nocturne.png`：辅助文字变实，主次没被抹平 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.31 kB（hash `8fd0e18e`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,944 passed**、1 expected fail、10 skipped；串行 81 s |

### 未测 / 风险

- **nocturne 全站没审过**：本轮只截了空会话首屏。消息流、审批、diff 在夜航皮肤下的观感仍是空白（下一轮补）。
- 风险：`fg-3` 抬亮后，某些"刻意的极弱提示"（如占位符）会显得比设计意图重一些；目前只有首屏目测，聊天正文里的时间戳还没在真机上看。
- 回退点：三行 hex + `tests/golden/tokens.json` 一起回退。

### 下一步

nocturne 皮肤在聊天正文/审批/diff 的复核；键盘弹出继续等真机。

## 2026-11-10 切片 25：语义色写在「自己的淡底」上不达标（纸色皮肤三连）

### 审查：先把三套皮肤的密集页跑一遍

上一轮的对比度只量了"纯色对页面底色"。这一轮补两类：

1. **nocturne 的密集页**（此前从未截过图）：消息流、diff、审批页各出一张，与 graphite 同屏对照。
   结论：夜航是**成体系的**，正文、时间戳、diff 行、审批警示条都读得清；那排亮色过程段在
   graphite 下同样亮，不是夜航专有的问题（也就不该只给夜航打补丁）。
2. **语义色写在自己的半透明淡底上**：警告条、错误卡、完成条都是"`--palm-warn` 文字 + 12% 的
   `--palm-tint-warn` 底色"。新加的用例把淡底叠到页面底色上算出实际渲染色，再量对比度 ——
   纸色皮肤**三条全崩**：

| 组合 | 实测 | 谁在用 |
|---|---|---|
| paper `--palm-warn` on `tint-warn` | **3.35:1** | 审批页「批准后它会真实执行这条命令…」 |
| paper `--palm-danger` on `tint-danger` | **4.28:1** | 拒绝 / 删除按钮的文字 |
| paper `--palm-ok` on `tint-ok` | **3.41:1** | 完成条、成功提示 |

### 改了什么（只动纸色皮肤的语义色，色相不变）

| 变量 | 旧 | 新 | 新对比度 |
|---|---|---|---|
| `--palm-warn` | `#a97617` | `#8a5f10` | 4.8:1 |
| `--palm-danger` | `#b8455a` | `#a63b4f` | 5.1:1 |
| `--palm-ok` | `#2f8f5b` | `#1f6f45` | 4.6:1 |

graphite / nocturne 三条本来就过（≥4.5），未动。

![纸色审批页：警示条、拒绝、批准三处文字都变实](C:\Users\Administrator\.dsh\screenshots\approval-paper-contrast.png)

![nocturne 消息流（新皮肤首次复验）：正文与时间戳读得清](C:\Users\Administrator\.dsh\screenshots\chat-nocturne.png)

![nocturne diff 页：增删行的底色与行号都读得出](C:\Users\Administrator\.dsh\screenshots\diff-nocturne.png)

### 保留的能力

三套皮肤、换肤、语义色的**用途**不变（还是那三档，还是同一批组件）；只调纸色皮肤三个取值。
令牌基线按既定流程显式更新（`PALM_UPDATE_TOKENS=1`）。

### 先红后绿

先写「语义色写在自己的淡底上」用例 → paper 三条红（3.35 / 4.28 / 3.41），逐条改完 **9/9** 绿。
nocturne 的四张截图是**审查**，不是改动 —— 结论是"没有缺陷"，如实记下。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `skin-contrast` 9/9、`tokens` 13/13、`tokens-golden` 3/3 |
| 视觉（组件级，非整屏） | paper 审批页前后对照；nocturne 消息流/diff/审批三张 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.31 kB（hash `919495d4`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,947 passed**、1 expected fail、10 skipped；串行 80 s |

### 未测 / 风险

- **真机未测**：所有对比度是算式与组件级截图，屏幕亮度/户外可读性没验。
- 风险：纸色皮肤的红/绿/琥珀都压深了一档，与其他品牌的"纸感"可能会显得更沉；目前只在审批页看过。
- 风险：`--palm-warn` 也用于普通正文里的警示（非淡底），压深后在白底上对比更高，无副作用。
- 回退点：三行 hex + `tests/golden/tokens.json`。

### 下一步

键盘弹出与真机触控验收（唯一还没做的状态）；随后复核队列/outbox 账本的状态所有权。

## 2026-11-10 切片 26：最拥挤的 composer（引用 + 图片 + 三种附件状态）—— 附件条被硬切

### 审查（真实 `ComposerSection`，390px，一次把所有输入区分支同时点亮）

引用条、两张待发图片、三件附件（就绪 / 上传中 / 上传失败）、草稿两行 —— 这是输入区的极限形态。结果是**附件横排被硬切**：

- `.chat-file-bar` 是 `display:flex` + `overflow-x:auto` 的横排，第二件附件正好切在屏幕右缘，第三件（上传失败那件）完全在屏幕外；
- 没有滚动条、没有渐隐，用户看到的是"我的附件没了"，而不是"可以往左滑"。

（同一屏里图片九宫格、引用条、输入行都正常。）

### 改了什么

复用切片 20 的 `useOverflowFade`：

1. `ComposerSection` 给附件条挂 `ref` 与 `data-fade`，真溢出时才标 `end`，滚到最右自动撤；
2. `.chat-file-bar[data-fade='end']` 用 `mask-image` 画右缘渐隐，遮罩取 `currentColor`（不引入颜色值），带 `-webkit-` 前缀。

![附件条溢出：右缘渐隐，看得出后面还有一件](C:\Users\Administrator\.dsh\screenshots\composer-crowded.png)

### 保留的能力

三件附件的三种状态（就绪带大小、上传中带「取消」、失败带「点按重试」）、移除按钮、图片九宫格、引用条、发送/停止键 —— 全未动；横滚仍然是横滚，只是现在**看得出来能滑**。

### 先红后绿

- 组件用例先红（附件条没有 `data-fade`）→ 接上 hook 后 **8/8** 绿；
- 结构契约 58 条一起绿（本轮新增的 CSS 规则由组件用例覆盖，未再加重复断言）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `composer-section` 8/8、`mobile-styles.structure` 58/58、`overflow-fade` 3/3 |
| 视觉（组件级，非整屏） | `composer-crowded.png` 前后对照：第二件附件从"硬切"变成"渐隐" |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.64 kB（hash `e6b51579`） |
| `pnpm guard` / `pnpm test` | exit 0；预算 `src/mobile` 60510；**2,948 passed**、1 expected fail、10 skipped；串行 80 s |

### 未测 / 风险

- **整屏与真机未测**：附件条在真实浏览器里的 `scrollWidth` 未核对（单测 stub），滑动手感也没验。
- 风险：`mask-image` 在老 WebKit 上可能让附件名发虚（与审批命令块同一风险，真机若如此一并回退）。
- 风险：附件条在"刚好不溢出"时不该有渐隐 —— 判定阈值是 `>1px`，四舍五入不会误报。
- 回退点：删 hook 绑定 + CSS 一条，用例同步回退。

### 下一步

队列/outbox 账本的状态所有权复核（本轮已顺手看过：队列走 `session-store` 单一订阅，outbox 走 `platform/offline.ts` 单一存储，没有第二份副本 —— 待写成一节结论）；键盘弹出继续等真机。

## 2026-11-10 切片 27：队列 / outbox 账本复核 —— 结论落成两条护栏

### 复核结论（不是猜，逐条查了写入方）

「排队」与「待发」是**两件事**，各有一份账本，而且都没有第二份副本：

| 账本 | 存放 | 谁能写 | 视图怎么读 |
|---|---|---|---|
| 宿主侧排队消息 | `stream/session-store.ts` | 帧处理器（`applyQueueItems` 等） | `useSessionQueue` 订阅版本号，**不抄数组**（`ChatView` 里已无 `useState<QueueItemView[]>`） |
| 离线待发 | `platform/offline.ts`（IndexedDB `outbox`） | 只此一处（`enqueuePrompt` / `removeFromOutbox` / `flushOutbox` / `dropOutbox`） | 两个钩子：`use-chat-composer`（失败入队）、`use-chat-outbox-flush`（恢复后冲队列） |

两者在代码注释里也明确分开："界面上的『排队』是用户主动排的，和'发失败等重连'不是一回事"。

### 改了什么（把结论变成会失败的护栏）

在 `architecture.test.ts` 加了 2 条，`pnpm guard` 会跑：

1. **视图不许再抄队列数组**：`views/**` 里出现 `useState<QueueItemView[]>` 即失败（第二份事实 = 界面与宿主对不上）。
2. **outbox 只有一个写入口**：除 `platform/offline.ts`（账本）与 `session/history-cache.ts`（建表 schema）外，任何文件出现 `'outbox'` 字面量即失败；`views/**` 里 import `platform/offline.ts` 的只许是那两个钩子，第三处直接摸存储即失败。

### 护栏不是摆设（做了证伪实验）

临时在 `views/chat/` 放一个 `__guardrail-probe.ts` 去 import `offline.ts`：

```
× outbox 存储只有 platform/offline.ts 写，视图只能经两个钩子触达
  AssertionError: 绕过钩子直接摸 outbox: views/chat/__guardrail-probe.ts
```

报出的正是文件名。删掉探针后立即恢复绿 —— 说明这条护栏**真的会失败**，不是恒真断言（本仓以前吃过一次"恒 0 断言"的亏，这次先自证）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `architecture` 17 passed + 1 expected fail（原有用例一条不红） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.64 kB（hash `e6b51579`，本轮未动样式） |
| `pnpm guard` / `pnpm test` | exit 0；**2,950 passed**、1 expected fail、10 skipped；串行 84 s |
| 工作树 | 0 删除、探针文件已删、无遗留监听端口 |

### 未测 / 风险

- 这两条是**静态**护栏：它们保证"没有第二份数组/没有绕过钩子的 import"，但不保证运行期顺序（比如冲队列与重连事件的先后）——那部分仍靠 `use-chat-outbox-flush` 的"只在连回来时冲"约束与用例。
- 风险：若将来有人确实需要在视图里持有队列快照（例如离线草稿回放），护栏会挡路；届时应把它扩成"允许的只读投影"，而不是直接删护栏。
- 回退点：删掉这两条 `it`。

### 下一步

键盘弹出与真机触控验收（唯一还没做的状态）；UI 侧回到次级页 —— 通知/使用量/配对页尚未在 390px 出图。

## 2026-11-10 切片 28：使用量首屏首拍 —— 顺手抓到一个「单位没有注释」的坑

### 审查（真实 `UsageSection`，390px，首次出图）

四种 provider 状态一次点亮：正常用量（本周 62%）、余额（kimi ¥12.00）、未配置（openrouter）、查询失败（zhipu）。版面是清楚的：卡头「名字 + 状态徽章」、进度条 + 百分比、重置时刻用弱一档的字、模型明细两行、失败/未配置各有一句说明。

**第一次出图时数字是错的**：页面写着「近 5 小时 1800%」「本周 6200.0% · 余 -6100.0%」。原因不是渲染 bug，是我造样例时把 `usedPercent` / `sessionUsed` 当成了百分数（62 / 18），而契约定的是 **0..1 的分数**（`SettingsView.test.tsx` 用 `0.459 → 余量 54%` 钉着）。

这条值得记：**单位只活在一处测试里，类型上没有一句话**。任何人（包括我）第一次造样例都会踩。

![使用量 390px：用量 / 余额 / 未配置 / 失败 四种状态](C:\Users\Administrator\.dsh\screenshots\usage-graphite.png)

### 改了什么（只补契约，不动渲染）

1. `mobile-types.ts`：给 `usedPercent` / `sessionUsed` 补单位注释 —— **0..1 的分数**，并写明"拿整数 62 造样例会画出 6200.0%"这个真实翻车记录与钉住它的用例位置。
2. `usage-section.tsx`：在百分比块上加一条单位铁律注释（×100 是唯一换算点）。

渲染代码**一行没动** —— 页面本身是对的，错的是样例。

### 保留的能力

四种 provider 状态、进度条、重置时刻、模型明细、余额、骨架/失败提示全部不变。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `SettingsView` 36/36（含 0.459 → 余量 54% 的单位断言） |
| 视觉（组件级，非整屏） | `usage-graphite.png`：修正样例后数字为 18% / 62.0% · 余 38.0% |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.64 kB（hash `e6b51579`，未动样式） |
| `pnpm guard` / `pnpm test` | exit 0；预算 `src/mobile` 60525；**2,950 passed**、1 expected fail、10 skipped；串行 79 s |

### 未测 / 风险

- **宿主侧真的按分数发吗？** 本仓没有 usage 的生产端（部署侧增强），我只能证明"手机端按分数解释、且有用例钉住"。若宿主发百分数，页面就会像本轮第一张图那样飞出 6200%。
- 风险：这条契约在真机上没验过（需要一次真实使用量返回）。
- 回退点：注释可删，无行为变化。

### 下一步

通知页 390px 出图（本轮造样例时 `NotifyPage` 因缺字段抛错，下轮先摸清 props）；键盘弹出继续等真机。

## 2026-11-10 切片 29：通知页首拍 —— 审批通知被标成「回复」

### 审查（真实 `NotifyPage`，390px，四种通知一次点亮）

版面是清楚的：顶部「该开哪个？」三条通道的选择建议、`送达情况`（尝试/成功/失败/已过滤 + 渠道分布 + 最近一次失败原因）、`最近通知`（类别徽章 + 标题 + 时间 + 正文）、`浏览器通知`/`通知内容` 开关组、`通道配置`。

**发现一处会误导用户的错标**：

| 通知类别 | 徽章（改前） | 读起来 |
|---|---|---|
| `approval` | **回复** | 「回复 需要你批准：run_command」 |
| `question` | **回复** | 「回复 需要你回答：部署到哪台机器」 |
| `turn-done` | 回复 | 「回复 会话…完成」（这个是对的） |

原因是一条三元链只认得 `task-done / task-failed / todo-done`，其余全落到「回复」。徽章是"这条通知属于哪一类"的唯一线索 —— 审批被说成"回复"，用户会以为是早就答过的消息。

（另外：第一次造样例时 `at`/`kind: 'turns'` 写错，页面画出 `NaN-NaN Invalid Date`、徽章全变「回复」；真实字段是 `ts` 与 `turn-done | approval | question | …`，已按类型改正后再拍。）

### 改了什么

`views/settings/notify-page.tsx`：把三元链换成直表 `INBOX_KIND_LABEL`（完成 / 失败 / 规划 / 回复 / **审批** / **提问**），认不出来的才退回「回复」。

![通知页 390px：审批、提问、回复、失败四种徽章各归各位](C:\Users\Administrator\.dsh\screenshots\notify-graphite.png)

### 保留的能力

四类通知的点击跳转（按 session/workspace 拼深链）、时间格式化、正文截断、开关组、通道配置、送达明细 —— 全未动，只换徽章取值。

### 先红后绿

新建 `views/settings/notify-page.test.tsx` 三条：审批说「审批」/ 提问说「提问」/ 回合完成仍说「回复」。前两条先红（`'回复…'` 不含「审批」），换成直表后 **3/3** 绿；`SettingsView` 36 条不受影响。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `notify-page` 3/3、`SettingsView` 36/36 |
| 视觉（组件级，非整屏） | `notify-graphite.png`：四种徽章齐全 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.64 kB（hash `e6b51579`，未动样式） |
| `pnpm guard` / `pnpm test` | exit 0；预算 `src/mobile` 60540、`views` 18060；**2,953 passed**、1 expected fail、10 skipped；串行 83 s |

### 未测 / 风险

- **整屏与真机未测**：深链接跳转、系统通知权限弹窗、Web Push 的真实行为都没验（本轮只验静态排版与徽章）。
- 风险：新增两个徽章值（审批/提问）在样式上没有专属配色（继承 `settings-inboxKind-<kind>`），夜航/纸色下是否与其他徽章区分得开，未出图。
- 回退点：还原三元链，删用例。

### 下一步

通知页在 paper / nocturne 下的徽章配色复核；键盘弹出继续等真机。

## 2026-11-10 切片 30：通知页换肤复核 —— 徽章没配色、开关不跟随皮肤

### 审查（同一份真实 DOM 在 paper / nocturne 下各拍一张）

**两处与皮肤不一致**：

1. **审批 / 提问的徽章没有专属配色**：`.settings-inboxKind-approval` / `-question` 根本不存在样式，落回灰底 —— 在四种通知里最不起眼，而它们恰恰是「卡住等你」的。
2. **开关的「开」态写死成旧蓝**：`.settings-switch-on::before { background: var(--accent) }`。`--accent` 来自 `design/tokens.ts`，**两套主题都是同一个蓝**、换肤不变 —— 于是纸色（棕）与夜航（青）下开关仍然是蓝的，等于在皮肤里插了第二套配色。

### 改了什么

| 位置 | 改动 |
|---|---|
| `100-settings.css` | 新增 `.settings-inboxKind-approval` / `-question`：警示色（`--tone-warning-soft` / `--tone-warning-ink`），与绿（完成）/ 红（失败）/ 蓝（规划）/ 靛（回复）区分 |
| `100-settings.css` | `.settings-switch-on::before` 改走 `var(--palm-accent)`，开关跟随皮肤 |

![纸色通知页：审批/提问琥珀徽章、开关变棕](C:\Users\Administrator\.dsh\screenshots\notify-paper.png)

![夜航通知页：开关变青，徽章同上](C:\Users\Administrator\.dsh\screenshots\notify-nocturne.png)

### 保留的能力

通知的四类徽章取值（上一片改的直表）、点击深链、开关的可点区域（44×44）、`aria` 语义、通道配置 —— 全未动；只改配色与一个 token。

### 先红后绿

- 开关那条**先红**（`.settings-switch-on::before` 里是 `var(--accent)`）→ 换 token 后绿。
- 徽章那条我写成用例时样式已经落地，**没红**；补了一次**变异验证**：把 `approval` 的底色临时换成 `--tone-positive-soft`，用例立刻报红，再改回 —— 证明它不是恒真断言。
- 踩坑记录：注释里写了裸色 `#5b5cf0`，`quality-budget` 的 `cssHex ≤ 39` 直接红 —— 这个计数器把注释里的 hex 也算进去。去掉注释里的色值即绿（CSS 里没有真的新增裸色）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 60/60、`quality-budget` 全绿、`SettingsView` 36/36 |
| 视觉（组件级，非整屏） | paper / nocturne 两张：开关颜色与徽章层级都对 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.77 kB（hash `ca1644e5`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,955 passed**、1 expected fail、10 skipped；串行 85 s |

### 未测 / 风险

- **整屏与真机未测**：真机上开关的点击手感、琥珀徽章在室外强光下的可读性没验。
- 风险：`--accent` 这类旧名在本仓还有大量引用（桥接段兜着），本次只修了一处**肉眼可见**的；其余若也在换肤后露馅，需要一次系统性的 `--accent → --palm-accent` 排查（建议单开一刀，按页面出图核对）。
- 回退点：删两条徽章规则、把开关改回 `var(--accent)`，用例同步回退。

### 下一步

旧名 `--accent*` 的全局排查（换肤后是否还有别的蓝）；键盘弹出继续等真机。

## 2026-11-10 切片 31：纸色皮肤的过程条 —— 一排荧光绿

### 审查（同一份聊天 DOM，paper 皮肤，900px 放大出图）

纸色下「完成 · 7 步」的胶囊本身是对的（浅底深字，切片 25 修过），但**它底下那排轨道段还是荧光绿**：`--palm-strip-rail-done` 的基础值是给深色底写的 `linear-gradient(90deg, #2fbf74, #3ddc84)`，`-now` 是 `#4b4ae0 → #7c8cff` 的靛。暖白纸面上横一排发光绿条，像荧光笔。

（顺带确认：我一开始把那颗胶囊读成"白字压白底"，放大 1.6 倍后确认是**深字浅底、正常** —— 小图误判，记在这里免得下次又当成 bug 改。）

### 改了什么

`styles/000-tokens.css` 的 `html[data-skin='paper']` 块里加两条轨道覆盖，取本皮肤的语义色而不是自造色：

```css
--palm-strip-rail-done: linear-gradient(90deg, var(--palm-ok), #2f8f5b);
--palm-strip-rail-now:  linear-gradient(90deg, var(--palm-accent), var(--palm-accent-2));
```

「完成」= 墨绿（`--palm-ok` 已是 4.6:1 的那档），「进行中」= 纸色的棕强调色。基础值（深色皮肤）不动。

![纸色聊天：过程条轨道改成墨绿，不再荧光](C:\Users\Administrator\.dsh\screenshots\strip-paper-zoom.png)

### 保留的能力

过程条的段数、比例、点击进过程抽屉、`aria-label`、7 段的分段逻辑全未动；只换两条渐变的取色来源。

### 先红后绿

样式先落地，随后补契约（`skin-contrast.test.ts` 新增「纸色皮肤的过程条轨道」）并做**变异验证**：把这两行临时删掉，用例立刻报红（`paper 未覆盖 --palm-strip-rail-done`），恢复后 10/10 绿。

另：令牌基线（`tests/golden/tokens.json`）也跟着变了 —— 该文件收录三套皮肤的全部令牌，按仓规用 `PALM_UPDATE_TOKENS=1` 显式更新，未手改。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `skin-contrast` 10/10、`mobile-styles.structure` 60/60、`tokens-golden` 3/3 |
| 视觉（组件级，非整屏） | `strip-paper-zoom.png`：轨道由荧光绿变墨绿 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.92 kB（hash `9db7a024`） |
| `pnpm guard` / `pnpm test` | exit 0；预算 `src/mobile` 60560；**2,956 passed**、1 expected fail、10 skipped；串行 84 s |

### 未测 / 风险

- **整屏与真机未测**：`-now`（进行中）那条靛→棕的替换本轮**没有实拍到**（dump 里只有完成态），只有「完成」有前后对比。
- 风险：`--palm-strip-rail-*` 若还有别处引用（抽屉里的迷你条 18px），纸色下也会跟着变；迷你条没出图核对。
- 回退点：删这两行 + 回退 `tests/golden/tokens.json`，契约同步回退。

### 下一步

抽屉迷你条在纸色下的核对；旧名 `--accent*` 的全局排查；键盘弹出继续等真机。

## 2026-11-10 切片 32：抽屉迷你条（无缺陷）+ 用量页的蓝进度条

### 审查一：纸色抽屉 —— 没问题

同一份抽屉 DOM 在 `data-skin="paper"` 下出图：迷你过程条（运行中 / 完成 / 等审批）是**深色小胶囊**（深靛、绿→靛、深琥珀）配浅字。它们和暖白纸面反差大，但：

- 小（18px 高）、只在行尾、承载"这一条会话现在什么状态"；
- 上一片改的 `--palm-strip-rail-*` **只作用于主过程条**，迷你条走的是另一组 kind 渐变（`370-v21.css` 里已注明"抽屉里的迷你条不受影响"）。

结论：**不是缺陷，不改**。记在这里，免得下次又当成"深色在浅色皮肤里不协调"重开。

### 审查二：纸色用量页 —— 进度条还在发蓝

纸色下整页已经换成暖白 + 棕（上一片修了开关），但：

| 元素 | 改前 | 改后 |
|---|---|---|
| 62% 进度条 | `linear-gradient(90deg, var(--accent), #8b5cf6)` —— 旧蓝→紫 | `var(--palm-accent) → var(--palm-accent-2)`（棕→浅棕） |
| 「pro / 余额」小徽章 | 旧蓝字 + 淡蓝底 | `--palm-accent` 字 + `--palm-tint-accent` 底 |

`--accent` 与 `--accent-soft` 都来自 `design/tokens.ts`，两套主题同一个值、换肤不变 —— 与开关那次同源。

![纸色用量页：进度条与徽章变棕](C:\Users\Administrator\.dsh\screenshots\usage-paper.png)

### 保留的能力

进度条宽度按百分比走（`data`/计算未动）、四档徽章（pro/余额/未配置/失败）语义不变、重置时刻与模型明细不变。

### 先红后绿

契约先红（`.usage-meterFill` 仍是 `var(--accent)`、`.usage-badge-ok` 仍是 `--accent-soft`）→ 换令牌后 61/61 绿；`quality-budget` 同轮全绿（未新增裸色）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 61/61、`quality-budget` 全绿 |
| 视觉（组件级，非整屏） | `usage-paper.png` 前后对照：蓝条→棕条、蓝徽章→琥珀徽章 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.95 kB（hash `40aa513f`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,957 passed**、1 expected fail、10 skipped；串行 82 s |

### 未测 / 风险

- **整屏与真机未测**；夜航下的棕→青替换没出图（同一令牌，风险低但没拍到）。
- 遗留（本片未改，已出图为证）：设置页底部的「保存」主按钮在纸色下**仍是蓝色** —— 它是 `.settings-*` 里的另一处旧名，下一片处理。
- 风险：`--palm-accent-2` 只在三套皮肤里定义（基础主题没有），若有朝一日允许"无皮肤"启动，这些属性会落空；当前 `DEFAULT_SKIN = graphite` 且启动即写 `data-skin`，故安全。
- 回退点：两行改回旧名，契约同步回退。

### 下一步

设置页主按钮（纸色下仍蓝）；旧名 `--accent*` 的剩余 60 余处按页面清点；键盘弹出继续等真机。

## 2026-11-10 切片 33：全站主按钮 —— 纸色下唯一的一颗蓝

### 审查（纸色设置页 + 用量页底部按钮）

`.mobile-button-primary`（保存 / 刷新 / 确认，全站主操作）写的是旧名：

```css
background: var(--accent);          /* design/tokens.ts：两套主题同一个 #5b5cf0 */
color: var(--accent-contrast);
```

于是纸色皮肤里，整页暖白 + 棕，唯独主按钮是亮蓝 —— 与开关、用量进度条**同源的三连漏**。

### 改了什么

```css
background: var(--palm-accent);
color: var(--palm-on-accent);
```

`:active` 那条也跟着换（否则按下瞬间又变蓝）。

![纸色主按钮：改后棕（上）vs 旧值蓝（下）](C:\Users\Administrator\.dsh\screenshots\button-paper.png)

### 保留的能力

按钮的可点区域、`filter: brightness(1.08)` 的按下反馈、`disabled` 样式、`aria` 语义、以及 `.mobile-button`（次要按钮）全部不变 —— 只换两个色值来源。

### 先红后绿

契约先红（`.mobile-button-primary` 里是 `var(--accent)`）→ 换令牌后 62/62 绿；`quality-budget` 全绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 62/62、`quality-budget` 全绿 |
| 视觉（组件级） | `button-paper.png` 并排对照；`settings-paper.png` 整页纸色复核 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.96 kB（hash `134a1c66`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,958 passed**、1 expected fail、10 skipped；串行 90 s |

### 未测 / 风险

- **整屏与真机未测**：主按钮在夜航下的青、按下反馈的手感没验。
- 旧名还剩 **102 处** `var(--accent*)`（`styles/` 目录统计），本轮只清了**肉眼可见的三处**（开关、用量条/徽章、主按钮）。剩下的需要一次按页面出图的清点，不能盲改 —— 有些是"深色专用"的装饰。
- 回退点：两行改回旧名 + `:active` 一行，契约同步回退。

### 下一步

剩余 `--accent*` 按页面清点（先出一张"哪些规则用到它"的清单，再按页面拍图决定改不改）；键盘弹出继续等真机。

## 2026-11-10 切片 34：白字压在亮靛/青上 —— 发送键与新建键的前景色

### 审查（先出清单，再按清单查）

把 `styles/*.css` 里 102 处 `var(--accent*)` 按文件统计：`100-settings` 12、`370-v21` 13、`420-goal-bar` 9、`150-chat` 8、`390-think-blocks` 7、`410-turn-scrubber` 7、`300-lightbox` 7……

**发现一个比"换肤不跟随"更严重的问题**：`--accent-contrast` 在 `design/tokens.ts` 里**两套主题都恒为 `#ffffff`**，而三套皮肤的强调色是：

| 皮肤 | `--palm-accent` | 白字对比度 | 皮肤给的前景色 |
|---|---|---|---|
| graphite | `#7c8cff` 亮靛 | ≈ 2.6:1 | `#101015` |
| paper | `#8a5a2b` 棕 | ≈ 5:1 | `#ffffff` |
| nocturne | `#22d3ee` 青 | ≈ 1.8:1 | `#0a0a0f` |

也就是说：**石墨和夜航下的发送键箭头、抽屉「新建会话」文字，现在就是白字压在亮底上**，不是换肤问题，是当下就在的对比度问题。

### 改了什么

`.chat-send`（发送键图标）与 `.mobile-new`（新建会话）的 `color` 从 `--accent-contrast` 换成皮肤给的 `--palm-on-accent`：

![夜航 composer：发送键是青底深箭头](C:\Users\Administrator\.dsh\screenshots\composer-nocturne-send.png)

### 保留的能力

发送/停止的切换、`::after` 扩展触控区、`:active` 缩放、`disabled` 的灰态、抽屉「新建会话」的图标与文案、按钮尺寸 —— 全未动。

### 先红后绿

契约先红（两条规则里仍是 `--accent-contrast`）→ 换令牌后 63/63 绿；`quality-budget` 全绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 63/63、`quality-budget` 全绿 |
| 视觉（组件级） | `composer-nocturne-send.png`：夜航发送键为青底近黑箭头 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 159.96 kB（hash `a27dbae5`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,959 passed**、1 expected fail、10 skipped；串行 88 s |

### 未测 / 风险

- **整屏与真机未测**：纸色（白字压在棕上）与石墨（近黑压在亮靛上）两张没单独出图 —— 它们是同一令牌，但没实拍。
- 风险：`--palm-on-accent` 只在三套皮肤里定义；`DEFAULT_SKIN = graphite` 且启动即写 `data-skin`，故安全。
- 清单里还有 100 处旧名（`420-goal-bar` 9、`370-v21` 13、`390-think-blocks` 7……），**未逐一判断** —— 其中不少是"深色专用"的装饰，盲改会出错，需要按页面拍图决定。
- 回退点：两处 `color` 改回 `--accent-contrast`。

### 下一步

按清单逐文件过：先 `420-goal-bar` 与 `390-think-blocks`（聊天里最常见的两块），出图后再定改不改。

## 2026-11-10 切片 35：根因治理 —— 把强调色旧名整批桥接到皮肤令牌

### 审查（清单先摆出来，问题不在"哪一处忘了改"）

把 `styles/*.css` 里 102 处 `var(--accent*)` 按文件统计后看清楚：**这不是 102 个 bug，是一根线头**。

`design/tokens.ts` 注入的 `--accent` / `--accent-soft` / `--accent-contrast` 是"两套主题各一套值"的旧体系，**没有皮肤维度**；而 `styles/000-tokens.css` 末尾本来就有"旧名桥接（一次性）"段 —— 但它只桥接了字号、间距、圆角，**没桥接颜色**。

于是换肤之后：字号/间距跟着皮肤走，颜色却是旧蓝。前四片（开关、用量进度条、主按钮、发送键前景）逐个修掉的，全是这一根线的分叉。

### 改了什么

在桥接段补四条颜色映射（历史 100 余处引用不必逐个改）：

```css
--accent: var(--palm-accent);
--accent-soft: var(--palm-tint-accent);
--accent-contrast: var(--palm-on-accent);
--accent-glow: color-mix(in srgb, var(--palm-accent) 45%, transparent);
```

**先量后桥**：桥接 `--accent-soft` 之前，先给三套皮肤各量一次"强调色写在淡底上"的对比度（`skin-contrast.test.ts` 新增 3 条，实测全部 ≥4.5:1），确认不会把 100 余处引用一起拖进不可读。

![纸色聊天：行内代码、链接、按钮全部跟随皮肤](C:\Users\Administrator\.dsh\screenshots\chat-paper-bridged.png)

![纸色设置页：无蓝色残留](C:\Users\Administrator\.dsh\screenshots\settings-paper-bridged.png)

### 保留的能力（这次最容易出事的地方）

- 深色皮肤（graphite / nocturne）的**过程条渐变**没被这四条影响 —— 它们走 `--palm-strip-grad-*`，与本片无关，仍是原来的深色仪表；
- 纸色的过程条轨道仍是上一片修的墨绿；
- 所有语义色（danger / warn / ok）走的是 `--danger-soft` / `--tone-*` 那一批，**未动**；
- 深色专用装饰（如 `chat-search-mark` 的 `color-mix` 里的 `--bg-elevated`）只换了强调色分量。

### 先红后绿

- 对比度三条：先写测试（三套皮肤 × accent on tint-accent）→ 全绿（现有令牌本来就够，说明桥接安全）；
- 桥接契约：`--accent` / `--accent-soft` / `--accent-contrast` 三条映射写成断言。
- 踩坑：注释里用了反引号，`gen-mobile-css.mjs` 生成的模板字符串直接 `TS1005 / Unterminated template literal` —— 这个坑本仓踩过第二次，注释一律不用反引号。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `skin-contrast` 13/13（含新增 3 条）、`mobile-styles.structure` 64/64、`quality-budget` 全绿 |
| 视觉（组件级） | 纸色聊天 + 纸色设置页两张：蓝色残留清零，行内代码/按钮改跟随皮肤 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 160.13 kB（hash `0e3b887a`） |
| `pnpm guard` / `pnpm test` | exit 0；预算 `src/mobile` 60580；**2,963 passed**、1 expected fail、10 skipped；串行 86 s |

### 未测 / 风险

- **整屏与真机未测**：夜航（青）下的这 100 余处没有逐屏出图；石墨本来就接近旧蓝，肉眼难分。
- 风险：旧名被桥接后，**任何"深色专用"的旧蓝假设都会跟着皮肤变**。目前只查到过程条渐变这一处是刻意的深色，其余没有证据；若哪天真机发现某处必须在所有皮肤上保持蓝，应把该处改成显式的语义 token，而不是回退桥接。
- 风险：`color-mix` 在旧 WebKit 上需要 16.2+；`--accent-glow` 只用于一处外发光，不支持时会退化成无阴影（可接受）。
- 回退点：删掉桥接段这四行即可，前面四片的单点修改仍然独立有效。

### 下一步

夜航逐屏复核（聊天/抽屉/设置/审批/通知/用量各一张），确认桥接没有把深色屏的层次搞乱；键盘弹出继续等真机。

## 2026-11-10 切片 36：夜航逐屏复核 —— 桥接在深色皮肤上没有塌

### 审查（三屏实拍，重点看"层次还在不在"）

上一片把 100 余处旧强调色一次性桥到皮肤令牌，风险在深色屏：夜里那几屏本来就靠"冷色强调 + 暗面分层"立住，强调色从靛换青，可能把层次压平。

| 屏幕 | 结论 |
|---|---|
| 聊天（夜航） | 行内代码/链接由靛转青，与青色强调一致；用户气泡、过程条、正文层次未变 |
| 抽屉（夜航） | 「新建会话」变青底**深字**（上一片的前景色修复），比原来的蓝底白字清楚；迷你过程条仍是深色小胶囊 |
| 审批（夜航） | 「按 1.5 秒批准」仍是绿、「拒绝」红、警示条琥珀 —— **都没被强调色桥接影响**；「原始参数」链接转青 |

![夜航聊天：强调色转青，层次未塌](C:\Users\Administrator\.dsh\screenshots\chat-nocturne-bridged.png)

![夜航抽屉：青底深字的新建键](C:\Users\Administrator\.dsh\screenshots\drawer-nocturne-bridged.png)

![夜航审批：绿批准 / 红拒绝 / 琥珀警示都不动](C:\Users\Administrator\.dsh\screenshots\approval-nocturne-bridged.png)

### 记一笔"不是缺陷"

过程条里「思考」那一段的填充仍是**靛紫**（`--palm-strip-grad-think`），在青色皮肤下显得像另一个色系。这是**按 kind 分色**的设计（think 靛、read/test 青、approve 琥珀、done 绿），不是强调色漏改；石墨下同一段也是靛紫。**不改**——一旦为夜航单独调，就变成"为皮肤改语义"，与"过程条三屏一致"的既有结论冲突。

### 改了什么

本轮**没有改代码**。产出一组深色皮肤复核截图 + 上面两条判定。

### 验证

| 检查 | 结果 |
|---|---|
| 视觉（组件级，非整屏） | 夜航聊天 / 抽屉 / 审批三张，逐项对照 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 160.13 kB（hash `0e3b887a`，与上一片一致，说明本轮无代码改动） |
| `pnpm guard` / `pnpm test` | exit 0；**2,963 passed**、1 expected fail、10 skipped；串行 83 s |

### 未测 / 风险

- **整屏与真机未测**：设置、通知、用量三屏的夜航版没拍（用量页的棕→青替换只在纸色拍过）。
- 风险：桥接把"旧蓝"整体换掉后，**石墨**皮肤里原本接近旧蓝的那些元素（`#7c8cff` vs `#5b5cf0`）会略微变亮变紫，肉眼几乎无差，但没有逐屏对照图。
- 回退点：无（本轮无代码改动）。

### 下一步

夜航剩余三屏（设置/通知/用量）补拍；回到功能面找下一处"信息层级"问题（而不是继续扫颜色）；键盘弹出继续等真机。

## 2026-11-10 切片 37：四个次级屏审查 —— 只有上下文页缺一块

### 审查（四屏一起看，先判断"哪一处真的缺信息"）

| 屏幕 | 结论 |
|---|---|
| 上下文占用 | **缺一块**：「已占用 148.0k / 74%」「窗口总量 200.0k」「压缩前预计 161.5k」三个数字并列，"还能装多少"要自己减 |
| 回合大纲 | 无缺陷。时间轴的竖线其实在（放大 1.6 倍可见，`--outline-axis` 是 `fg-3` 的 48%），390px 下克制是刻意的；当前轮有实心圆点 + 强调描边 + 「正在看」 |
| 产物 | 无缺陷。按轮分组（`第 6 轮 · 2 个文件 ›`）、交付物绿 / 改动靛、路径截断正常 |
| 搜索 | 无缺陷。命中词用强调色标出（放大可见），空态提示「更早的会话可能没覆盖」 |

### 改了什么（只改上下文页）

`ContextView` 在「窗口总量」后插一行 **剩余**（`contextWindow - used`）：

- 由已有两个数字算出，**不引入新数据、不编造构成**；
- 缺任一个（宿主没报窗口或没报用量）就整行不画 —— "算不出来就不猜"。

![上下文页：窗口总量 / 剩余 / 压缩前预计 三个数字自洽](C:\Users\Administrator\.dsh\screenshots\context-graphite.png)

### 保留的能力

占用条的档位与警示色（`data-level` / `data-pressure`）、百分比、`aria-label`、空态、以及"不编造三段构成"的既有约定 —— 全未动。

### 先红后绿

- 新增「给出剩余一行」先红（`screen.getByText('剩余')` 拿不到）→ 加 4 行后 9/9 绿；
- 同时补了反向用例：宿主没报窗口总量时**不许**出现「剩余」。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `ContextView` 9/9（原 7 条未动） |
| 视觉（组件级） | `context-graphite.png`：148.0k / 200.0k / **52.0k** / 161.5k |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 160.13 kB（hash `0e3b887a`，本轮未动样式） |
| `pnpm guard` / `pnpm test` | exit 0；预算 `src/mobile/views` 18080、`ContextView.tsx` 132；**2,965 passed**、1 expected fail、10 skipped；串行 83 s |

### 未测 / 风险

- **整屏与真机未测**：这一行在窄屏 320 下与「压缩前预计」并排是否换行，没出图（`context-facts` 是两列 `dl`，320 下会挤）。
- 风险：`剩余` 用的是 `Math.max(0, …)` —— 用量超过窗口时显示 `0` 而不是负数，这是刻意的，但宿主真报超限时可能需要一句"已超限"的提示（本轮没做）。
- 回退点：删掉那 4 行 + 用例；预算回退。

### 下一步

`context-facts` 在 320px 下的换行核对；然后继续功能面（下一站：审批页的长命令与提问页选项）。

## 2026-11-10 切片 38：提问卡两行一样重 —— 卡头退成标签，问句升为标题

### 审查一：上下文页 320px（上一片的遗留核对）

三行事实（窗口总量 / 剩余 / 压缩前预计）在 320px 下仍是"左标签右数值"，没有折行、没有溢出。**无缺陷**，上一片的隐患排除。

### 审查二：提问卡（390px + 1.7 倍放大）

审批卡与提问卡叠在一起时：

- 「交付卡怎么收尾」（卡头）与「这两个方案你要哪个？」（真正的问句）**同字号同级**，两行粗体连着排 —— 打开卡片分不清哪句是要你回答的；
- 两行的配色都走旧名 `--text-primary`（换皮肤不跟随，虽然本轮已由桥接兜住前景色，但这两个规则本身还是旧名）。

顺带排除一个误判：390px 缩略图里「允许一次」像是白字压靛底，放大后确认是**近黑字**（`--palm-on-accent`，切片 34 的效果），不是缺陷 —— 这已经是第三次"小图误判"，记一笔。

### 改了什么

| 规则 | 改前 | 改后 |
|---|---|---|
| `.chat-question-header` | 14px / 500 / `--text-primary` | `--palm-t-s`（小一号）/ 500 / **`--palm-fg-2`** |
| `.chat-question-text` | `--text-md` / 400 / `--text-primary` | **`--palm-t-l`**（大一号）/ 500 / **`--palm-fg`** |

卡片读起来变成：小字灰标签 → 大号亮问句 → 灰色补充说明 → 选项。

![提问卡：卡头退成标签，问句成为唯一重点](C:\Users\Administrator\.dsh\screenshots\question-graphite.png)

### 保留的能力

选项的单选语义（`role="group"`、`aria-label` 带问句）、「自定义回答」文本域、「提交回答」按钮、以及审批卡的「允许一次 / 拒绝」两键 —— 全未动，只改了两处字号与前景色。

### 先红后绿

契约先红（卡头仍是 `--text-primary`、问句仍是 `--text-md`/400）→ 改完 **65/65** 绿；`quality-budget` 全绿（没有新增裸色，反而把两处 `14px` 硬值换成了令牌）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 65/65、`quality-budget` 全绿 |
| 视觉（组件级） | `question-graphite.png` 前后对照；另有一张 1.7 倍放大图用于排除误判 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 160.13 kB（hash `84f886fd`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,966 passed**、1 expected fail、10 skipped；串行 80 s |

### 未测 / 风险

- **整屏与真机未测**：纸色 / 夜航下的这张卡没出图（用的是同一套令牌，风险低）。
- 风险：问句从 15px 升到 18px 后，**长问句**（两三行）会把卡片顶得更高；本轮样例只有一行，长问句没验。
- 回退点：两处规则改回旧值，契约同步回退。

### 下一步

长问句（3 行以上）+ 五个选项的极限提问卡；然后回到聊天正文的"过程折叠"。

## 2026-11-10 切片 39：极限提问卡 —— 四行问句 + 五个选项撑住了

### 审查（真实样式表 + 极限内容，390px）

用真实类名拼出极限形态：四行问句（含括号说明）、一句灰色补充、**五个**选项（各带一行描述）、自定义回答框、提交键。

结果：卡片长到约 640px，**内容全部完整**——问句没有截断、五个选项都在、描述行都读得清、提交键在卡片底部。卡片本身不滚动，交给聊天流滚（这是对的：卡片内部再套一层滚动区，拇指会在两个滚动容器之间打架）。

![极限提问卡：四行问句 + 五个选项，无截断](C:\Users\Administrator\.dsh\screenshots\question-long.png)

### 改了什么

只加了一条**护栏**（无渲染改动）：`mobile-styles.structure.test.ts` 新增「长问句不许被截断」——`.chat-question-text` 与 `.chat-question-option-label` 里出现 `line-clamp` / `overflow: hidden` / `text-overflow` 即失败。

理由：这张卡最容易在"为了清爽"的改动里被加 clamp，而截断后用户看不到完整问句，等于逼人凭半句做决定。

### 先红后绿

护栏写好后立即绿（当前没有 clamp）。为证明它不是恒真断言，做了**变异验证**：临时给 `.chat-question-text` 加 `-webkit-line-clamp: 3`，用例立刻报红，撤回后恢复。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 66/66 |
| 视觉（组件级） | `question-long.png`：四行问句 + 五选项完整呈现 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 160.13 kB（hash `84f886fd`，未动样式） |
| `pnpm guard` / `pnpm test` | exit 0；**2,967 passed**、1 expected fail、10 skipped；串行 82 s |

### 未测 / 风险

- **整屏与真机未测**：这张卡在真机上会把正文推到一屏之外，滑动手感与"提交后回滚位置"没验。
- 风险：五选项时卡片高 640px，在 320×568 的小屏上首屏只能看到问句和两三个选项 —— 需要真机确认用户不会以为"只有两个选项"。
- 回退点：删掉这条护栏即可（无渲染改动）。

### 下一步

聊天正文的「过程折叠」展开态（4 次工具调用 → 逐条步骤）；键盘弹出继续等真机。

## 2026-11-10 切片 40：过程折叠展开态 —— 四枚绿「完成」把异常淹了

### 审查（真实 dump 的展开态，390px）

把聊天 dump 的 `data-tools="summary"` 改成 `full`、展开过程头，得到真实展开态：

```
▾ 4 次工具调用
● 读取  packages/dsh-palm/src/mobile/ui/delivery-c…  完成
● 读取  packages/dsh-palm/src/mobile/styles/370-v…    完成
● 编辑  packages/dsh-palm/src/mobile/ui/delivery-c…  完成
● 运行命令  pnpm test                                  完成
```

问题：**四行尾巴各挂一枚绿色「完成」**，整块看着像四枚徽章。绿色圆点已经说明"这一步过了"，文字再染一次绿，就把真正的异常（失败/中断/运行中）压下去了 —— 正是需求里点名的"重复徽章"。

### 改了什么

`.chat-step-state-ok` 由 `--palm-ok`（绿）改为 `--palm-fg-3`（辅助灰）：

- 成功步骤只靠绿点表达，文字退成静音；
- 失败（红）/ 中断（琥珀）/ 运行中（强调色）**继续用语义色**，反而更显眼。

![展开态：成功步骤的「完成」退成灰，异常态仍抢眼](C:\Users\Administrator\.dsh\screenshots\proc-expanded.png)

### 保留的能力

- 每步的结论文字**仍在 DOM 里**（`message-row.test.tsx` 那 4 条断言照样过，读屏也能读到）；
- 点开/收起、每步的 `aria-label`、路径截断、分隔线、活跃回合隐藏已完成步骤的规则 —— 全未动。

### 先红后绿

契约先红（`.chat-step-state-ok` 仍是 `var(--palm-ok)`）→ 改后 **67/67** 绿；`message-row` 88 条同轮全绿（证明只改颜色、没动语义）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 67/67、`render/message-row` 88/88 |
| 视觉（组件级） | `proc-expanded.png` 前后对照 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 160.13 kB（hash `57c23f11`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,968 passed**、1 expected fail、10 skipped；串行 78 s |

### 未测 / 风险

- **整屏与真机未测**：混合状态（一行失败、三行成功）的对比没拍 —— 逻辑上红色仍会用语义色，但没实拍。
- 风险：辅助灰在强光下的可读性（4.68:1）刚好过线；若真机觉得太淡，应调 `--palm-fg-3` 而不是回退成绿。
- 回退点：一行改回 `var(--palm-ok)`，契约同步回退。

### 下一步

混合状态的展开态实拍；然后进入"错误卡 / 失败重试"这一档。

## 2026-11-10 切片 41：三态复核 —— 混合过程 / 失败卡 / 离线条

本轮**没有改代码**，把上一片的三处"说得到但没拍到"的状态一次补齐，确认都成立：

### 1. 混合状态的过程折叠

三行成功 + 一行失败：成功的三行只留绿点与灰字「完成」，失败那行是**红点 + 红字「失败」**，一眼就能定位。上一片"把成功的绿字退成灰"的改动在混合形态下达到了目的 —— 异常反而更跳。

![混合状态：只有失败那行是红的](C:\Users\Administrator\.dsh\screenshots\proc-mixed.png)

### 2. 失败卡带原因

原 dump 只造了「没做成」+ 文件行，没有原因。补上真实原因后：

- 标题「没做成」+ 右上「重试」；
- **原因占一行灰字**，长句自动折行，不挤压文件行；
- 下面是改动文件清单 + 「2 个文件」页脚。

能力本来就有（`ui/delivery-card.tsx` 的 `reason` 字段，`delivery-card.test.tsx:61` 早有用例钉住），本轮确认的是**排版**：原因在标题与文件清单之间，层级正确。

![失败卡：原因压在标题下、文件清单之上](C:\Users\Administrator\.dsh\screenshots\fail-reason.png)

### 3. 离线条的三个状态

| 状态 | 样子 |
|---|---|
| `off` | 琥珀底 + 琥珀字「连接已断开，正在自动重试…」 |
| `back` | 无底色 + 三级灰「已重新连上」（成功不抢眼） |
| `gone` | 高度收成 0（节点常驻 DOM，所以恢复时不会把内容顶一下） |

![离线条：断开 / 已重连 / 收起](C:\Users\Administrator\.dsh\screenshots\offline-states.png)

### 验证

| 检查 | 结果 |
|---|---|
| 视觉（组件级，非整屏） | 三张截图，逐项对照 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 160.13 kB（hash `57c23f11`，与上一片一致 → 本轮无代码改动） |
| `pnpm guard` / `pnpm test` | exit 0；**2,968 passed**、1 expected fail、10 skipped；串行 78 s |

### 未测 / 风险

- **整屏与真机未测**：离线条的滑入/淡出动画（`--palm-offline-dur`）在真机上的观感没验；`prefers-reduced-motion` 下有降级规则但没实拍。
- 风险：失败卡的原因是**宿主给的原文**，可能是多行堆栈；本轮只验了一句长句子，多行堆栈会不会撑爆卡片没验（样式上没有 `max-height`，理论上会一直长）。
- 回退点：无（本轮无代码改动）。

### 下一步

多行堆栈的失败卡（宿主原文 5 行以上）是否能撑住；然后回到设置里的"设备配对"页。

## 2026-11-10 切片 42：失败卡的多行报错被折成一堵字墙

### 审查（宿主原文 = 4 条错误、带换行）

把原因换成真实的 typecheck 输出（首行结论 + 四条 `文件(行,列): TSxxxx —— 说明`），390px 实拍：

**改前**：`.palm-delivery-reason` 是普通 `<p>`，默认 `white-space: normal` —— 宿主给的换行被折成空格，四条错误前后相连，糊成一堵九行的字墙，扫不出"到底几个错、错在哪"。

### 改了什么

```css
.palm-delivery-reason { white-space: pre-line; }
```

保留宿主换行、折叠多余空白；文本长度与结构完全不变（DOM 里仍是同一个 `<p>`）。

![失败卡：四条错误各起一行](C:\Users\Administrator\.dsh\screenshots\fail-stack.png)

### 保留的能力

「重试」入口、文件清单、「N 个文件」页脚、失败态的红框与 `!` 标记全未动；原因仍是宿主原文，不做任何改写或截断（上上片那条"不许 clamp"的精神在这里同样适用）。

### 先红后绿

契约先红（规则里没有 `pre-line`）→ 改后 **68/68** 绿；`quality-budget` 全绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 68/68、`quality-budget` 全绿 |
| 视觉（组件级） | `fail-stack.png` 前后对照：字墙 → 四条分行 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 160.16 kB（hash `53396423`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,969 passed**、1 expected fail、10 skipped；串行 83 s |

### 未测 / 风险

- **整屏与真机未测**：超长堆栈（20 行以上）会把卡片拉到一屏之外 —— 这是刻意的（原因不能藏），但真机上要不要给"展开/收起"需要用户反馈再定。
- 风险：若某天宿主改用 `<br>` 而不是 `\n` 拼原因，`pre-line` 不会起作用（那时换行仍在，不会更差）。
- 回退点：删掉 `white-space` 一行，契约同步回退。

### 下一步

设置 → 设备配对页（列表 / 改备注 / 撤销）在 390px 下的排版与危险操作确认。

## 2026-11-10 切片 43：配对页的「配对」键借了抽屉的「新建会话」样式

### 审查（真实组件 dump，390px；错误态另造）

- 正常态：居中卡片、两个输入、一个整宽主键 —— 排版没问题；
- 错误态（`role="alert"` 的红字，压在输入框与主键之间）：位置与对比度都对；
- **问题在类名**：`<Button className="mobile-new mobile-pairSubmit">` —— 「配对」键的视觉**全部**来自 `.mobile-new`（App 里"重试"那颗大主键），`.mobile-pairSubmit` 只覆盖了 `width` 和 `margin`。

后果：App 那边调一次（改圆角、换字重、加禁用色），配对页会**跟着变形**；这也是"第二套组件样式"的另一种长法 —— 不是新写一套，而是把别人的样式借过来用。

> 订正（同日晚）：上一版这里写成"借了抽屉的「新建会话」样式"，清点后是错的 —— 抽屉用的是 `.palm-drawer-new`，`.mobile-new` 只属于 `views/App.tsx` 的重试键。结论不变（跨界面借用），但归属写准。

### 改了什么

1. 组件：`className="mobile-new mobile-pairSubmit"` → `className="mobile-pairSubmit"`；
2. CSS：`.mobile-pairSubmit` 补齐自己的一整套（`--palm-hit` 高度、`--palm-r-m` 圆角、`--palm-accent` 底、`--palm-on-accent` 字、`--palm-t-l` 字号、粗体、`:active` / `:disabled`），**配色全走皮肤令牌，没有新增裸色**。

刻意没抄 `.mobile-new` 的 `box-shadow: 0 2px 8px var(--accent-glow)`：主按钮现在的做法是扁平的（`.chat-send`、`.mobile-button-primary` 都不带光晕），配对键跟齐，不再单独发光。

### 保留的能力

配对两种入口（粘贴链接 / 6 位码）、`disabled` 时的「正在配对」文案与禁用态、`role="alert"` 错误行、回车提交、跳转 seam（`navigate`）全未动。

### 先红后绿

组件用例先红（`expect(submit.className).not.toContain('mobile-new')` 失败）→ 改完 8/8 绿；同轮 `structure` + `quality-budget` 共 92 条全绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `PairRequiredView` 8/8、`structure` 68/68、`quality-budget` 全绿 |
| 视觉（组件级） | `pair-graphite.png` 与改前对照：按钮尺寸、颜色、圆角一致，说明抽取是忠实的 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 160.52 kB（hash `11a34345`） |
| `pnpm guard` / `pnpm test` | exit 0（预算 `src/mobile` 60580 → **60620**，因这段规则从别处搬来、行数变多）；**2,970 passed**、1 expected fail、10 skipped；串行 87 s + 82 s |

### 未测 / 风险

- **整屏与真机未测**：键盘弹出时这张居中卡片的表现（能不能滚到底、标题会不会被顶出屏幕）没验 —— 这是本轮唯一碰到的"真机才有"的问题，仍未解。
- 风险：去掉光晕后，主键在深色底上的"可按"感略降；若真机反馈不明显，应在令牌层加统一的按压反馈，而不是给这一个键加回阴影。
- 回退点：组件类名改回 `mobile-new mobile-pairSubmit`、CSS 退回两条属性；预算回退 60620 → 60580。

### 下一步

键盘弹出态的居中卡片（`place-items: center` + `100dvh` 在软键盘下会裁掉顶部）；然后回头扫一遍还有哪些页面在跨界面借类名（同类问题可能不止一处）。

## 2026-11-10 切片 44：键盘裁切是假警报；主键清点 + 一条新护栏

### 审查一：窄视口下配对卡片会不会被裁

把视口一路压到 **340×260**、**340×180**（比卡片还矮）：

- 卡片顶边始终完整、从内边距处开始，下面溢出部分由页面滚动带走；
- 原因：`.mobile-pair` 用的是 `min-height: 100dvh`（不是 `height`），容器会随内容变高，`place-items: center` 不会产生"负偏移"。

**结论：上一轮担心的"软键盘把卡片顶出屏幕顶部"不成立**，不需要 `safe center` 之类的补丁。软键盘只剩"输入框是否被遮"这一条，那属于真机滚动行为，继续等实机。

### 审查二：跨界面借类名的范围有多大

全量清点组件里的主按钮类名（`className="…"` 命中，排除测试）：

| 类名 | 归属 |
|---|---|
| `.mobile-new` | `views/App.tsx`（重试） |
| `.palm-drawer-new` | `ui/session-drawer.tsx`（新建会话） |
| `.chat-send` | `views/chat/components/composer-section.tsx`、`chat-empty.tsx` |
| `.chat-question-submit` | `components/sheets.tsx` |
| `.chat-approval-allow` | 审批卡 |
| `.mobile-pairSubmit` | `components/PairRequiredView.tsx`（本轮才有自己的样式） |

也就是说 **6 套"大主键"并存**。合并成一套组件是后面要做的架构收敛；本轮先把**最危险的那部分**钉住：它们都不许各写一份裸色。

### 改了什么

只加护栏（无渲染改动）：`mobile-styles.structure.test.ts` 新增 6 条参数化用例，逐个断言六个主键的 `background` 走 `var(--palm-accent)`（或桥接后的 `var(--accent)`）、`color` 走 `var(--palm-on-accent)` / `var(--accent-contrast)`。

### 先红后绿

六条**一次全绿** —— 因为切片 34/35 已经把这几处都换成了令牌。为了证明断言不是恒真，做了变异验证：把 `.chat-send` 的 `color` 临时改成 `#fff`，对应用例立刻报红，撤回后恢复。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `mobile-styles.structure` 74/74（新增 6 条） |
| 视觉（组件级） | `pair-short-before.png`（340×260）、`pair-tiny-before.png`（340×180）：卡片顶部完整 |
| `pnpm typecheck` / `pnpm build` | exit 0（本轮无样式改动，产物不变） |
| `pnpm guard` / `pnpm test` | exit 0；**2,976 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：软键盘是否遮住输入框仍未验（只能在真机上做）。
- 风险：6 套主键各自维护 `:active`/`:disabled`，合并前若有人只改其中一套，行为会不一致；这条护栏只保配色，保不了尺寸与动效。
- 回退点：删掉这 6 条用例。

### 下一步

把 6 套主键收敛成一套（先在 token 层定 `--palm-btn-h` / 按下与禁用态，再逐个替换），这是"第二套组件样式"的真正收尾。

## 2026-11-10 切片 45：六套主键的按下反馈分成两派，抽屉那颗连反馈都没有

### 审查（逐条读六处规则）

| 主键 | 改前的按下态 | 改前的禁用态 |
|---|---|---|
| `.mobile-new`（App 重试） | `scale(0.98)` + 提亮 1.1 | 透明度 0.6 |
| `.mobile-pairSubmit`（配对） | `scale(0.98)` + 提亮 1.1 | 透明度 0.6 |
| `.chat-approval-allow`（审批允许） | 只降透明度 0.88 | 透明度 0.6 |
| `.chat-question-submit`（提问提交） | 只降透明度 0.88 | 透明度 0.6 |
| `.chat-send`（聊天发送） | **只有 hover 放大**（触屏上永远不触发 = 没反馈） | 换底色 |
| `.palm-drawer-new`（新建会话） | **没有** | **没有** |

同一个"主键按下"动作，三种反馈 + 两处根本没有。用户会以为有的键没反应。

### 改了什么

1. 令牌层（`000-tokens.css` 基础段）新增：
   - `--palm-btn-press-scale: 0.98`
   - `--palm-btn-press-dim: 1.1`
   - `--palm-btn-press-flat: 0.88`
   - `--palm-btn-disabled-opacity: 0.6`
2. 按"这颗键按下去会发生什么"分成两派，**不是**强行统一：
   - **瞬按型**（重试 / 抽屉新建 / 发送 / 配对）：`scale(var(--palm-btn-press-scale))` + `brightness(var(--palm-btn-press-dim))`；
   - **长按/卡片型**（审批允许 / 提问提交）：`opacity: var(--palm-btn-press-flat)`，**不许** scale —— 审批键是"按 1.5 秒"的确认键，按下去缩一圈再保持 1.5 秒是错的；它的进度靠 `--holding` 的 filter 表达，`:active` 也不能改 filter 把它抢走。
3. 补齐两处缺失：`.chat-send:active`（原来只有 `@media (hover:hover)` 的放大）、`.palm-drawer-new` 的 `:active`/`:disabled`。

### 保留的能力

所有按钮的尺寸、圆角、字号、配色、"正在配对/正在发送"等禁用文案、审批的长按进度、发送键的禁用换底色 —— 全未动；只把"按下/灰掉"这两个**反馈**统一到令牌。

### 先红后绿

7 条契约先红（令牌不存在 + 六处 `:active` 里全是写死的 `0.98`/`1.1`/`0.88`）→ 实现后全绿。中途踩了一次自己立的旧约：`mobile-styles.structure.test.ts` 里早在审批卡那一段写过"`.chat-approval-allow:active` 不许出现 `transform:`"——正好证明这条老约是对的，于是改成两派方案，把旧约原样保留。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 110/110（含新增 7 条）、`quality-budget`、`skin-contrast` 全绿 |
| 基线 | `tests/golden/tokens.json` 用 `PALM_UPDATE_TOKENS=1` 正式更新（不手改）；重跑 3/3 绿 |
| 视觉（组件级） | `drawer-nocturne-bridged.png`：抽屉「新建会话」静止态未变（`:active`/`:disabled` 不影响静止态） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 161.17 kB（hash `9db1e0de`） |
| `pnpm guard` / `pnpm test` | exit 0（预算 `src/mobile` 60620 → **60660**）；**2,983 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：按下态的手感（scale 0.98 是否够、亮度 1.1 是否过头）只有真机手指能给结论；本轮只证明"代码层面一致了"。
- 风险：`filter: brightness()` 会创建新的合成层，六个键同时出现时对老机型可能有性能影响（未测）。
- 回退点：四行令牌删掉、六处 `:active` 恢复原值、golden 用 `PALM_UPDATE_TOKENS=1` 重生成；预算回退 60660 → 60620。

### 下一步

把"尺寸/圆角/字号"也收进同一套主键令牌（下一片）；再看一次真机无法覆盖的：`prefers-reduced-motion` 下这些按下态是否需要降级。

## 2026-11-10 切片 46：减弱动效漏了三颗主键；主键几何其实分三档

### 审查一：`prefers-reduced-motion` 的覆盖

`360-reduced-motion.css` 的 `animation: none; transition: none` 列表里只写了六颗主键中的两颗（`.mobile-new`、`.chat-send`）。四颗漏网：

| 漏掉的 | 后果 |
|---|---|
| `.palm-drawer-new` | 开"减弱动效"后，抽屉主键按下仍会缩一下 |
| `.mobile-pairSubmit` | 同上（配对页） |
| `.chat-question-submit` | 同上（提问卡） |
| `.chat-approval-allow` | 同上（审批卡） |

上一片刚给这四颗加上 `transition: transform .1s`，正好把漏洞放大了 —— 这也说明"加动效"和"登记到减弱动效列表"必须同时做。

### 改了什么

四颗补进 `@media (prefers-reduced-motion: reduce)` 的列表（一行一条，无新增文件、无新类）。

### 审查二：六颗主键的几何到底该不该统一

| 主键 | 高 | 圆角 | 字号 | 定位 |
|---|---|---|---|---|
| `.mobile-new` | `--palm-hit` 44 | `--palm-r-m` 12 | `--palm-t-l` 17 | 页面级 CTA |
| `.mobile-pairSubmit` | `--palm-hit` 44 | `--palm-r-m` 12 | `--palm-t-l` 17 | 页面级 CTA |
| `.palm-drawer-new` | `--palm-drawer-new-h` 44 | `--palm-r-m` 12 | `--palm-t-m` 14 | 抽屉 CTA（高可单独调） |
| `.chat-question-submit` | `--palm-hit` 44 | `--palm-r-s` 8 | `--palm-t-m` 14 | 卡片内 CTA |
| `.chat-approval-allow` | `--palm-hit` 44 | `--palm-r-s` 8 | `--palm-t-m` 14 | 卡片内 CTA |
| `.chat-send` | `--palm-dock-circle` 36 | `--palm-r-full` | 图标 | 圆形图标键 |

结论：**不是六个各写各的，而是三档**（页面级 / 卡片内 / 图标）。统一成一套反而是错的 —— 圆形发送键不可能跟整宽 CTA 同圆角。所以本轮**不改几何**，只把它钉住。

### 先红后绿

- 减弱动效契约 6 条：4 条先红 → 补列表后 90/90 全绿；
- 几何三档契约：一次全绿（现状已经就是这么分的），用于防止以后"顺手统一"把三档压成一档。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 90/90（新增 9 条）、`quality-budget` 全绿 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 161.25 kB（hash `3a4336a7`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,992 passed**、1 expected fail、10 skipped；串行 74 s |

### 未测 / 风险

- **整屏与真机未测**：减弱动效的实际观感只能在真机（系统开关）上验；本轮验的是"选择器登记齐全"。
- 风险：`transition: none` 会让按下态从"120ms 过渡"变成"瞬时"，观感差异在真机上可能偏硬 —— 但这是减弱动效的本意。
- 回退点：四行选择器删掉；几何契约删掉（无渲染改动）。

### 下一步

把"登记减弱动效"变成自动检查（凡是新写 `transition: transform` 的规则必须在减弱动效列表里），避免下一颗主键再漏；然后回到聊天正文的剩余场景。

## 2026-11-10 切片 47：把"登记减弱动效"变成自动对账，一次揪出 13 个漏网

### 审查（不再靠人工清单）

上一片手工补了四颗主键，但那种做法靠人记。这轮改成**扫样式表**：凡规则体里 `transition` 带 `transform` 的选择器，都必须在 `@media (prefers-reduced-motion: reduce)` 里登记。

第一次跑就出问题：正则把上一条规则的**注释**也当成选择器文本，30 个选择器全报"未登记"。剃掉注释再跑，真相是 **13 个漏网**：

| 漏网 | 用户开"减弱动效"后还会看到的位移 |
|---|---|
| `.chat-jump-latest` / `.chat-jump-turns` | 跳到最新 / 轮次清单悬浮键的按下 |
| `.diff-btn` / `.diff-confirm` | diff 视图两个键 |
| `.chat-approval-reject` | 「拒绝」键 |
| `.chat-question-option` | 提问卡片整行选项 |
| `.chat-stop-mini` | 运行中那把停止小方块 |
| `.voice-service-btn` / `.device-btn` / `.dialog-btn` / `.market-install` | 四处次级页主键 |
| `.code-block pre` | 代码块双指缩放的过渡 |
| `.voice-wave[data-live='1'] span` | **语音波形动画**（这条最要紧：它不是"反馈"，是持续的动画） |

### 改了什么

1. `360-reduced-motion.css` 的列表末尾补上这 13 个（一组带注释，说明来由）；
2. `mobile-styles.structure.test.ts` 新增一条**结构性对账**用例：剃注释 → 抓所有规则 → 找 `transition:` 带 `transform` → 逐个检查是否出现在减弱动效块里，缺谁报谁。

这条用例是本轮的主要产出：以后任何新写的位移动效忘了登记，`pnpm guard` 直接红。

### 保留的能力

所有动效在**正常模式**下原样保留 —— 改的只是"减弱动效"这一条分支；`.page-exit-*` 的 `display: none` 补丁、以及原有的 30 多个选择器都没动。

### 先红后绿

对账用例先红（报出 13 个）→ 补齐后 91/91 全绿。这条用例本身也被"变异验证"过：把 `.diff-confirm` 从列表里删掉，用例立刻点名它。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 91/91（新增 1 条全量对账） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 161.47 kB（hash `10e2afe6`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,993 passed**、1 expected fail、10 skipped；串行 84 s |

### 未测 / 风险

- **整屏与真机未测**：减弱动效下的实际观感（尤其语音波形被完全停掉、代码块缩放变瞬时）仍只能在真机上判断。
- 风险：这条对账只认 `transition` 里的 `transform`；用 `animation` 或 `left/top` 做位移的规则它看不见（现有代码里没有，但这是个已知盲区）。
- 回退点：删掉 13 个选择器与那条用例。

### 下一步

把盲区补上（`animation` 驱动的位移也纳入对账）；然后回聊天正文收剩余场景。

## 2026-11-10 切片 48：animation 的盲区补上了，并且分成"装饰"与"状态"两类

### 审查（扫全表 `animation` 规则）

上一片的对账只认 `transition: … transform`。这轮扫 `animation`：**82 个选择器**带动画，其中 28 个既没登记减弱动效、也不在名单里。

人工逐个看下来，它们不是一类东西：

| 类别 | 例子 | 该怎么处理 |
|---|---|---|
| **装饰性**（进/出场、淡入淡出、滑入、闪烁、高亮一下） | 骨架屏闪烁、消息入场、抽屉/对话框/语音遮罩、`toast-out`、`voice-sheet`、`chat-msg-focus`、`[data-locate-id][data-focus]`、`turn-scrub`、`chat-status-strip-leaving` | 开减弱动效时**应当停掉** |
| **状态性**（转圈 = 还在跑、呼吸点 = 运行中、不确定进度条 = 不知道进度） | `.chat-goal-spinner`、`.chat-status-dot-live`、`.chat-task-dot-running`、`.chat-subagent-dot-running`、`.chat-msg-regenerate-icon`、未知态进度条 | 停掉反而**害事**：用户分不清"还在跑"和"卡死" |

一刀切会犯第二个错，所以这轮把它变成**显式二选一**。

### 改了什么

1. `360-reduced-motion.css`：把 20 个装饰性动画选择器登记进减弱动效块（含 `voice-wave span`、`chat-jump-latest-hot`、`code-fade`、`chat-quote-bar`、`chat-reasoning-more`、`chat-offline-banner` 等）。
2. `mobile-styles.structure.test.ts`：新增「animation 对账（二）」——凡是 `animation` 的选择器，**要么**在减弱动效块里，**要么**在测试里明写的 8 条白名单里（每条都有"它是状态"的理由注释）。

于是"哪些动画在减弱动效下保留"从口头约定变成代码里可审查的清单。

### 保留的能力

所有动画在正常模式下原样；状态性动画（spinner / 呼吸点 / 不确定进度）在减弱动效下**继续跑**，避免"看起来卡死"。

### 先红后绿

对账（二）先红，一次点名 **20 个**（另有 8 个白名单命中）→ 补齐后 **108/108** 绿。变异验证：把 `.voice-sheet` 从列表删掉，用例立刻点名它。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 108/108（新增 1 条）、`quality-budget` 全绿 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 161.83 kB（hash `b8f9b06e`） |
| `pnpm guard` / `pnpm test` | exit 0（预算 `src/mobile` 60660 → **60700**）；**2,994 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：减弱动效下的观感仍只能真机判断；尤其"骨架屏不再闪"是否让人以为页面卡住，需要真实用户反馈。
- 风险：白名单是**手写**的，新加一个 spinner 不会自动进白名单 —— 但它会让对账（二）变红，等于强制作者做一次决定，这正是想要的效果。
- 回退点：删掉 20 个选择器与该条用例；预算回退 60700 → 60660。

### 下一步

回到聊天正文：消息入场与"定位高亮"在减弱动效下已停，但**定位高亮本身还需不需要一个静态可视提示**（现在等于没提示）—— 这是功能缺口，不是动画问题。

## 2026-11-10 切片 49：定位高亮原来只有一段动画，动画一停就"看不出跳到哪"

### 审查（顺藤摸到功能缺口）

上一片把 `.chat-msg-focus` 与 `[data-locate-id][data-focus]` 登记进减弱动效（`animation: none`）。回头读这两条规则的**全部内容**才发现：

```css
.chat-msg-focus { animation: dshPalmFocusPulse 3.2s ease-out forwards; }
[data-locate-id][data-focus] { animation: dshPalmFocusPulse 2.2s ease-out forwards; }
```

它们的视觉**100% 来自那段脉冲**。动画一停 → 搜索/大纲跳过去之后，屏幕上**什么都没有变**。用户会以为"没跳"或者"跳错了"。

这不是动画取舍，是功能缺口：跳转本身必须留下静态的落点标记。

### 改了什么

`360-reduced-motion.css` 的减弱动效块里，给两个选择器加静态标记：

```css
.chat-msg-focus,
[data-locate-id][data-focus] {
  background: var(--palm-tint-accent);
  box-shadow: inset 0 0 0 var(--palm-focus) var(--palm-accent);
}
```

用 **2px 焦点环**（`--palm-focus`）而不是 1px 发丝：深色屏上一根发丝几乎看不见，而这里是要顶替动画的。

![夜航下被定位到的消息：淡底 + 青色内描边](C:\Users\Administrator\.dsh\screenshots\chat-focus-marker.png)

### 保留的能力

正常模式下脉冲动画原样（`forwards` 结束态、3.2s / 2.2s 时长都不动）；减弱动效下仍有"落点"，只是不再闪。

### 先红后绿

契约先红（减弱动效块里两个选择器只有 `animation: none`）→ 加静态规则后 110/110 绿。中途修正了两次**测试自身的 bug**（把选择器表当成单选择器、`find` 取到第一条 `animation: none` 规则），都用"报错信息读清楚再改"收口。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 110/110（新增 2 条）、`quality-budget` 全绿 |
| 视觉（组件级） | `chat-focus-marker.png`：夜航下气泡有一圈青色描边；设置页同款标记因为行本身就有描边，**看不出差别**（已记入风险） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 161.97 kB（hash `c6718361`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,996 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：减弱动效开关下跳转的实际观感没验（本轮靠"手动注入同一声明"预览，不是真开关）。
- 风险：**设置页的静态标记与行本身描边重合**，淡底在深色屏上很弱 —— 那里真正起作用的是"这一行被滚到了屏幕中间"这件事本身。若真机反馈"还是看不出"，需要在设置页加一条左侧强调竖条，而不是继续加底色。
- 回退点：删掉那条静态规则与 2 条用例。

### 下一步

设置页定位改左侧强调竖条（与行描边区分开）；然后再回聊天正文收剩余场景。

## 2026-11-10 切片 50：同一枚静态标记，聊天里管用、设置里看不出

### 审查（同一份样式，两个宿主）

上一片给 `.chat-msg-focus` 与 `[data-locate-id][data-focus]` 共用了"淡底 + 2px 整圈描边"。这一轮分别实拍：

- **聊天**（夜航）：气泡本身没有边框，一圈青色描边 + 淡底**一眼就看见**，"刚跳到这一条"成立；
- **设置**：每一行本来就有 1px 描边（`--palm-line`），再套一圈同色的环**等于没标记** —— 截图上四行看着都一样。

同一份声明，在"有边框的宿主"里失效。这正是"一处样式两种宿主"的典型陷阱。

### 改了什么

把一条合并规则拆成两条，各按宿主选形状：

```css
.chat-msg-focus            { background: var(--palm-tint-accent);
                             box-shadow: inset 0 0 0 var(--palm-focus) var(--palm-accent); }
[data-locate-id][data-focus] { background: var(--palm-tint-accent);
                             box-shadow: inset var(--palm-focus) 0 0 var(--palm-accent); }  /* 左侧竖条 */
```

竖条只有横向偏移，压在行自身的左边框上，形成一条更粗的强调边，不再和整圈描边混淆。

![设置页：被定位到的那一行左侧是一条强调竖条](C:\Users\Administrator\.dsh\screenshots\locate-static-marker.png)

### 保留的能力

正常模式的脉冲动画一动不动；聊天侧的整圈描边保持原样（那边是有效的）。

### 先红后绿

两条契约先红（合并规则里两个选择器形状相同）→ 拆开后 96/96 绿。测试自身又踩了一次"同一选择器在块里出现两次、`find` 取到 `animation: none` 那条"的坑，改成"先按 `box-shadow` 过滤再取"。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 96/96（新增 2 条）、`quality-budget` 全绿 |
| 视觉（组件级） | `locate-static-marker.png`（设置页竖条）、`chat-focus-marker.png`（聊天整圈） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.06 kB（hash `0b60cfac`） |
| `pnpm guard` / `pnpm test` | exit 0；**2,998 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：设置页那条竖条在 390px 缩略图上仍偏弱（截图就是证据），真机上是否够清楚要实机确认。
- 风险：竖条只有 2px 宽，压在 1px 边框上等于"3px 里的 2px 是强调色"；高 DPI 屏上会显得更细。
- 回退点：两条规则合回一条，契约同步回退。

### 下一步

若真机仍看不清，改在设置页做"整行左侧 4px 渐变轨 + 标题加粗一档"（而不是继续加深描边）；其余时间回聊天正文收剩余场景。

## 2026-11-10 切片 51：语音面板第一次"真渲染"上屏 —— 无缺陷，记下两处待真机

### 审查（补一个从没截过图的面）

前 50 个切片里，语音面板一次都没被截图过（`palm-voice` 目录都不存在）。原因很实在：它由 `Overlay` 包着，手搓 HTML 拼不出遮罩与面板定位 —— 第一次手搓的结果就是"面板贴在页面顶端、没有圆角没有底色"，纯属**假图**，不能当证据。

这轮改成把真组件渲染进 jsdom 再落盘（`VoiceSheet` + `createRef`），拿到的是**真 DOM**：

![语音面板：波形 + 状态行 + 取消/完成](C:\Users\Administrator\.dsh\screenshots\voice-sheet.png)

逐项看：

| 元素 | 结论 |
|---|---|
| 面板 | 底部弹出、上圆角、深底、贴底对齐 —— 正确 |
| 波形 | 5 根强调色柱，`data-live` 有响度时才动（jsdom 拿不到响度，静止符合预期） |
| 状态行 | 「正在录音 · 00:42」用强调色；最后 10 秒会换警示色（`warn`），本轮样例不是那一档 |
| 取消 / 完成 | 取消是描边次级键，完成是强调色实心键 —— 主次清楚 |
| 标题 | `Overlay` 的 `title="语音输入"` **不出现在视觉上**，只做 aria 标签 |

### 改了什么

**没有改代码**。本轮产出是"这个面板长什么样"的第一手证据，以及下面两条待真机的判断依据。

### 保留的能力

面板的全部行为（Esc/遮罩关闭、焦点送进「完成」、转写中禁用、响度只写 CSS 变量不重渲染）都在既有用例里，本轮没有触碰。

### 验证

| 检查 | 结果 |
|---|---|
| 视觉（组件级，真 DOM） | `voice-sheet.png` |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.06 kB（hash `0b60cfac`，与上一片一致 → 无代码改动） |
| `pnpm guard` / `pnpm test` | exit 0；**2,998 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：①响度驱动下的波形是否真的像"在听你说话"；②转写中态（「请稍候」+ 按钮禁用）没出图。
- 风险：面板没有视觉标题，全靠波形与状态行自解释。第一次用的用户可能不知道"点完成会把这句转成文字发出去"——这是**文案缺口**，不是样式缺口，留待产品确认。
- 回退点：无（本轮无代码改动）。

### 下一步

补"转写中"态与最后 10 秒的警示色；然后回到聊天正文，把 `docs/ui-state-matrix.md` 里空着的那几行补上（截图已经攒够）。

## 2026-11-10 切片 52：语音面板两个边界态各揪出一个真缺陷

### 审查（转写中 / 最后 10 秒）

| 状态 | 改前 | 问题 |
|---|---|---|
| 转写中 | 「请稍候」是**实心强调色、完全可点**的样子 | 按钮其实 `disabled`，点了没反应；`.voice-done` 根本没有 `:disabled` 规则 |
| 最后 10 秒 | 「还剩 8 秒」和「正在录音」**同为强调色**，只多一档字重 | 实拍几乎看不出区别，"最后 10 秒"这个提醒等于没有 |

### 改了什么

1. `.voice-done:disabled`：`opacity: var(--palm-btn-disabled-opacity)` + `cursor: default` + 清掉按下态；同时把它的 `:active` 也换成主键令牌（原来写死 `scale(0.97)` / `brightness(1.08)`）。
2. `.voice-text.voice-text-warn`：`color: var(--palm-warn)`（**复合选择器**，理由见下）。

![转写中：请稍候明显变灰](C:\Users\Administrator\.dsh\screenshots\voice-transcribing.png)

![最后 10 秒：倒计时转成琥珀色](C:\Users\Administrator\.dsh\screenshots\voice-warn.png)

### 踩到的两个坑（都记进注释与用例了）

1. **`.voice-text-warn` 单写无效**：`.voice-text` 在文件里排在后面、同特异性，颜色被静默盖掉。第一次改完截图**逐字节一样**才发现没生效 —— 复合选择器才压得住。
2. **CSS 注释里写反引号把整份样式变成数字**：注释里给 `.voice-text` 加了反引号，生成器的模板字符串提前结束，`mobileCss` 从字符串变成数字，`tsc` 立刻报出 89 条"number 不能当 string"。这是本仓库的老坑，又在注释里踩了一次；已在注释里写明禁令。

### 保留的能力

转写中「取消」仍可用（用户不该被锁住）、`disabled` 的判定逻辑、状态文案来源、响度写 CSS 变量的机制 —— 全未动。

### 先红后绿

3 条契约先红（缺 `:disabled`、`:active` 未令牌化、警示色与常态同色）→ 改完 **99/99** 绿；`skin-contrast`、`quality-budget` 同轮全绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 99/99、`skin-contrast`、`quality-budget` |
| 视觉（组件级，真 DOM） | 两张：转写中（灰）+ 最后 10 秒（琥珀） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.22 kB（hash `9a6f43a2`） |
| `pnpm guard` / `pnpm test` | exit 0（预算 `src/mobile` 60700 → **60740**）；**3,001 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：响度驱动波形、60 秒上限到点自动结束的过渡、以及"琥珀色在夜航皮肤下是否足够刺眼"都要真机。
- 风险：`.voice-done` 仍是 44px 高 + `padding: 0 24px` 的硬值（未令牌化），与主键三档方案还没对齐。
- 回退点：两处规则回退，契约同步回退；预算回退 60740 → 60700。

### 下一步

把 `.voice-done` / `.voice-cancel` 的几何并入主键三档；再补 `ui-state-matrix.md` 的空白行。

## 2026-11-10 切片 53：语音面板两颗键的几何与旧名收口

### 审查（两颗键逐条读）

| 属性 | 改前 | 问题 |
|---|---|---|
| `.voice-cancel` 高 | `44px` 写死 | 触控下限一旦调整，这颗键不跟随 |
| `.voice-cancel` 圆角 | `999px` 写死 | 同值令牌 `--palm-r-full` 已存在，没理由写死 |
| `.voice-cancel` 描边/底色/字色 | `--border-default` / `--bg-elevated` / `--text-secondary`（旧名） | 换皮肤靠桥接兜着，不是第一手令牌 |
| `.voice-cancel` 字号 | `15px` 写死 | 字号阶梯里没有 15 这一档（`--palm-t-l` 是 17、`--palm-t-m` 是 14） |
| `.voice-done` 高 | `44px` 写死 | 同上 |
| `.voice-done` 圆角 | `var(--radius-capsule)` | 与 `--palm-r-full` 重复定义同一个胶囊形 |
| `.voice-done` 字号 | `14px` 写死 | 应该是 `--palm-t-m` |

### 改了什么

- `.voice-cancel`：`height: var(--palm-hit)`、`border-radius: var(--palm-r-full)`、`border: var(--palm-hair) solid var(--palm-line)`、`background: var(--palm-sur-2)`、`color: var(--palm-fg-2)`、`font-size: var(--palm-t-l)`；
- `.voice-done`：`height: var(--palm-hit)`、`border-radius: var(--palm-r-full)`、`font-size: var(--palm-t-m)`。

![语音面板：几何换令牌后观感一致](C:\Users\Administrator\.dsh\screenshots\voice-sheet.png)

### 保留的能力

两颗键的位置、主次关系（取消描边 / 完成实心）、`disabled` 表现、胶囊形手感 —— 全未动；只是把"写死的数字"换成"有名字的档位"。

### 先红后绿

3 条契约先红（写死 44px/999px、旧名仍在）→ 改完 **131/131** 绿。同时**修了一条老用例**：`mobile-styles.test.ts` 里原来断言 `.voice-done` 的字面 `height: 44px`，现在改成断言令牌 —— 并在注释里写明"写死数字正是上次换触控下限时漏掉这颗键的原因"。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 131/131（含新增 3 条）、`mobile-styles`、`skin-contrast`、`quality-budget` |
| 视觉（组件级，真 DOM） | `voice-sheet.png` 与改前对照：尺寸与形状一致 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.28 kB（hash `775f0150`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,004 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：`--palm-t-l`（17px）比原来的 15px 大两号，"取消"两颗键在小屏上是否还并排得住没验（320px 下按钮组可能换行）。
- 风险：`--radius-capsule` 与 `--palm-r-full` 现在是两个名字一个形状，旧名仍有别处引用，没做删除（等一轮全量清点再合并）。
- 回退点：两处规则退回写死值，契约与老用例同步回退。

### 下一步

320px 下语音面板两颗键的并排检查；然后补 `ui-state-matrix.md` 的空白行并回头做一次"全站旧名清点"。

## 2026-11-10 切片 54：320px 两键并排没塌；旧令牌名上棘轮

### 审查一：320px 下语音面板的两颗键

上一片把「取消」的字号从写死的 15px 换成 `--palm-t-l`（17px），风险是窄屏并排不下。

实拍 320px：两颗键仍并排、各自留白充足、没有换行也没有被裁。**风险解除**。

![320px：取消 / 完成 仍并排](C:\Users\Administrator\.dsh\screenshots\voice-320.png)

### 审查二：全站旧令牌名还有多少

逐个数（只数 `var(--…)"` 形式）：

| 旧名 | 处数 | 旧名 | 处数 |
|---|---|---|---|
| `--accent` | 68 | `--border-default` | 38 |
| `--accent-soft` | 14 | `--border-focus` | 11 |
| `--accent-contrast` | 4 | `--bg-elevated` | 27 |
| `--accent-glow` | 1 | `--bg-surface` / `--bg-page` | 7 / 4 |
| `--text-primary` / `-secondary` / `-tertiary` | 55 / 56 / 58 | `--card-bg` | 15 |
| `--radius-card` / `--shadow-lg` | 6 / 6 | **合计** | **370** |

370 处逐个改名是机械活，风险大于收益（每处都可能改错语义）。所以改成**棘轮**。

### 改了什么

只加护栏：`mobile-styles.structure.test.ts` 新增一组"旧名棘轮"用例 —— 15 个旧名各自封顶（当前处数）+ 总量封顶 370，**只能降不能升**。

以后每改一个文件顺手换掉几处，总量自然往下走；谁想新写 `var(--text-primary)` 立刻红。

### 先红后绿

这组用例写完即绿（现状即基线）。变异验证：在 `.voice-text` 里临时加一处 `var(--text-primary)`，总量用例与 `--text-primary` 单名用例同时报红；撤回恢复。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 118/118（新增 16 条：1 条总量 + 15 条单名） |
| 视觉（组件级） | `voice-320.png` |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.28 kB（hash `775f0150`，本轮无样式改动） |
| `pnpm guard` / `pnpm test` | exit 0；**3,020 passed**、1 expected fail、10 skipped；串行 93 s |

### 未测 / 风险

- **整屏与真机未测**：语音面板 320px 只是静态宽，真机横竖切换、以及键盘/安全区叠加没验。
- 风险：棘轮是"冻结现状"，不是"治理完成"——370 处旧名仍在，桥接段是它们唯一的换肤途径；若有人删掉桥接段里的某一行，这批旧名会静默退回写死色（棘轮拦不住这种删除）。
- 回退点：删掉这 16 条用例。

### 下一步

给桥接段本身加一条"每一行旧名都必须有对应映射"的完整性用例（补上棘轮拦不住的那类删除）；然后补 `ui-state-matrix.md`。

## 2026-11-10 切片 55：皮肤边界只覆盖了一半 —— 这是加自定义皮肤前必须补的洞

### 审查（把 `000-tokens.css` 的桥接段逐行读完，再回头比色值）

桥接段接的四族：**字号 / 间距 / 圆角 / 强调色**。也就是说——

> 颜色里**只有强调色**跟着皮肤走；文字、页面底、表面、卡片底、描边、阴影这六族，
> 仍然是 `designTokensCss()` 按**明暗主题**注入的字面值，换皮肤不变。

实测色值（同一份构建产物）：

| 旧名（主题注入） | 值 | 对应皮肤令牌 | 值 |
|---|---|---|---|
| `--bg-page`（深） | `#0a0a0f` | `--palm-bg` 石墨 / 夜航 | `#101015` / `#080c14` |
| `--bg-surface` | `#13131a` | `--palm-sur-1` 石墨 / 纸色 | `#15151c` / `#fff` |
| `--text-primary` | `#f0f0f5` | `--palm-fg` 石墨 | `#f4f4f8` |
| `--border-default` | `#2a2a3a` | `--palm-line` 石墨 | `#ffffff12`（带透明度） |

**现在看着没问题，是因为三套皮肤各自配了一个主题**（纸色=浅、石墨/夜航=深）。但只要加第四套皮肤（目标里明确要求"可扩展"），这六族就会留在旧主题上 —— 皮肤只上一半，出现"新底 + 旧字"。

### 改了什么

**没有改渲染**。加了一条**边界契约**（34 条用例）：

- 22 个旧名**必须**已接皮肤令牌（字号/间距/圆角/强调四族，`--accent-glow` 允许 `color-mix` 写法）；
- 12 个旧名**此刻不许**接皮肤令牌（`--bg-*` / `--card-*` / `--text-*` / `--border-*`）—— 谁要接，必须连同截图一起改这条用例，不允许"顺手接一下"。

### 为什么不这轮就接

色值不完全相等（上表），尤其是 `--border-default`（实色）与 `--palm-line`（带 alpha）。一次性把 250 余处换成皮肤令牌 = 全站色值整体位移，必须配一轮完整截图矩阵（浅/深/纸色/夜航 × 主要屏）才敢动。这属于**独立切片**，不该混在"读桥接段"的审查里顺手做。

### 先红后绿

22+12 条写完只红了一条（`--accent-glow` 是 `color-mix(...)` 包裹，不是裸 `var(--palm-*)`）→ 放宽正则后 **153/153** 全绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 153/153（新增 35 条） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.28 kB（hash `775f0150`，本轮无样式改动） |
| `pnpm guard` / `pnpm test` | exit 0；**3,055 passed**、1 expected fail、10 skipped；串行 87 s |

### 未测 / 风险

- **整屏与真机未测**：本轮纯契约，没有视觉验证点。
- 风险：**这条契约冻结的是"半套皮肤"的现状**。若有人按它去实现自定义皮肤，会得到"只换强调色"的皮肤 —— 文档里必须写清这一点（已写在用例注释里）。
- 回退点：删掉这 35 条用例。

### 下一步

真正的活儿：把六族颜色接进皮肤（先做 `--bg-page` / `--bg-surface` / `--bg-elevated` / `--card-bg` 四族，因为它们是"大面积"，改了要出四张皮肤 × 三屏的对照图），再接文字与描边。接完把上面那 12 条从"不许"翻成"必须"。

## 2026-11-10 切片 56：把"大面积底色"接进皮肤 —— 换肤终于等于换整套表面

### 审查

上一片量出：颜色里只有强调色跟皮肤走，页面底/表面/抬高面/卡片底四族还锁在明暗主题上。这四族恰好是**占屏面积最大**的，所以"换肤只换一半"在这四族上最刺眼。

### 改了什么

桥接段新增四行：

```css
--bg-page:     var(--palm-bg);
--bg-surface:  var(--palm-sur-1);
--bg-elevated: var(--palm-sur-2);
--card-bg:     var(--palm-sur-1);
```

文字与描边**刻意先不接**：它们与底色的对比要逐屏量，放进下一个切片，避免"一次改两件事、出问题没法归因"。

### 三套皮肤实拍（同一次构建）

| 皮肤 | 页面底 | 卡片/表面 | 观感 |
|---|---|---|---|
| 纸色 | `#faf8f4` 暖米 | `#fff` | 比之前更暖，卡片浮在暖底上，不再"冷灰底 + 暖字" |
| 石墨 | `#101015` | `#15151c` | 层次仍在（卡片比页面亮一档），比之前更柔 |
| 夜航 | `#080c14` | `#0f1520` | 偏蓝的深底，卡片带蓝调，与强调色同一色温 |

![纸色：底面变暖，卡片仍是白的](C:\Users\Administrator\.dsh\screenshots\surf-chat-paper.png)

![夜航：深蓝底 + 蓝调卡片](C:\Users\Administrator\.dsh\screenshots\surf-chat-nocturne.png)

![石墨：设置页的卡片与页面底仍有层次](C:\Users\Administrator\.dsh\screenshots\surf-settings-graphite.png)

### 保留的能力

所有既有布局、层级、交互一行未动；改的只是这四个旧名指向谁。三套皮肤的主色、语义色、阴影、圆角、字号全部照旧。

### 先红后绿

先把边界契约里这四族从"不许接"挪到"必须接"（此时应红）→ 加桥接四行 → **182/182** 绿（structure + skin-contrast + quality-budget）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 182/182、`skin-contrast`、`quality-budget` |
| 视觉（组件级） | 三张：纸色聊天 / 夜航聊天 / 石墨设置 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.39 kB（hash `2f97ef42`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,055 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：三张都是组件级（jsdom 落盘 + 浏览器渲染），没有真机色准与 OLED 暗场表现。
- 风险一：文字色仍是主题值（`#f0f0f5` 对石墨 `#f4f4f8`、夜航 `#e8f1ff` 都够亮），但**纸色皮肤下深字对暖底的对比没有重新量过**（原先是冷白底）。
- 风险二：`--card-border` / `--shadow-*` 仍是主题值，于是"卡片底是皮肤的、卡片描边是主题的"——细微但存在；下一片一起接。
- 回退点：删掉这四行桥接，边界契约四族挪回"不许接"。

### 下一步

接文字与描边两族，并在接之前先用脚本量一遍"每套皮肤下 正文/次要/三级 对 底/表面"的对比度，把数字写进 `skin-contrast.test.ts`，再接。

## 2026-11-10 切片 57：文字 / 描边 / 阴影也接进皮肤 —— 六族颜色全部收口

### 审查

上一片接完底色后，还有三族锁在主题上：

| 族 | 主题值（深） | 换肤不变 → 症状 |
|---|---|---|
| `--text-primary/-secondary/-tertiary/-quaternary` | `#f0f0f5` 等 | 纸色皮肤下仍是冷灰字（对暖底对比**没量过**）；夜航皮肤下丢掉蓝调 |
| `--border-default` / `--border-focus` / `--card-border` | `#2a2a3a` | 底色换成蓝黑后，描边仍是中性灰紫 |
| `--card-shadow` | 主题阴影 | 夜航的"冷光边"出不来 |

### 敢一次接完的理由

`skin-contrast.test.ts` 早就逐皮肤量过 `--palm-fg*` 与 `--palm-sur-*` 的对比度（≥4.5），**接过来等于继承那组已验证的数字**；反过来，原来那批主题值才是"没人量过"的一组——纸色皮肤上线以来，深字对暖底的对比一直没验过，这次顺带解决了。

### 改了什么

桥接段新增八行：

```css
--text-primary:    var(--palm-fg);
--text-secondary:  var(--palm-fg-2);
--text-tertiary:   var(--palm-fg-3);
--text-quaternary: var(--palm-fg-3);
--border-default:  var(--palm-line);
--border-focus:    var(--palm-accent);
--card-border:     var(--palm-line);
--card-shadow:     var(--palm-shadow);
```

### 三套皮肤实拍

| 皮肤 | 结果 |
|---|---|
| 纸色 | 正文变暖棕（`#1c1a17`），与暖米底同色温，元信息也偏棕而不是冷灰 |
| 夜航 | 正文带蓝调（`#e8f1ff`），卡片描边是 14% 蓝色透明线，与底色同色温 |
| 石墨 | 与改前**逐字节一致**——石墨的令牌本来就取自深色主题，这正好是一次"无回归"的旁证 |

![纸色：暖棕正文](C:\Users\Administrator\.dsh\screenshots\txt-chat-paper.png)

![夜航：蓝调正文与描边](C:\Users\Administrator\.dsh\screenshots\txt-chat-nocturne.png)

### 保留的能力

布局、层级、交互零改动；三套皮肤的语义色（成功/警告/危险）、强调色、圆角、字号全部照旧。

### 先红后绿

边界契约里八族先挪到"必须接"（应红）→ 加桥接 → 绿。中途 `themeOnly` 变成空数组触发 `noImplicitAny`（`const themeOnly = []` 推成 `any[]`），改成显式 `string[]` 并保留注释说明"留给下一个还锁在主题上的家族"。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 153/153、`skin-contrast`（含逐皮肤对比度）、`quality-budget` |
| 视觉（组件级） | 纸色 / 夜航 / 石墨 三张 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.65 kB（hash `da482e74`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,055 passed**、1 expected fail、10 skipped；串行 78 s |

### 未测 / 风险

- **整屏与真机未测**：只有组件级三张；抽屉、审批、产物、配对等屏尚未在换肤后重拍。
- 风险一：`--border-default` 从实色 `#2a2a3a` 变成 7% 白透明线，**深色下描边明显更淡**；聊天/设置里看着还行，但输入框、分隔线这类依赖描边的控件要逐屏复看。
- 风险二：`--card-shadow` 接了 `--palm-shadow`（含 0 0 0 1px 内描边），个别卡片可能因此出现"双描边"。
- 回退点：删掉这八行桥接，契约八族挪回 `themeOnly`。

### 下一步

按"换肤后复拍清单"重拍抽屉 / 审批 / 产物 / 配对四屏；重点看描边变淡后的输入框与分隔线是否还分得清。

## 2026-11-10 切片 58：换肤后复拍抽屉与产物 —— 描边变淡了，但还分得清

### 审查（用"双屏并排"把复拍成本压到一次截图）

把两套皮肤并排塞进一次截图（iframe 各 390×780），一次看清对照差异。

![左：石墨抽屉 右：纸色抽屉](C:\Users\Administrator\.dsh\screenshots\matrix-drawer.png)

| 观察点 | 结论 |
|---|---|
| 新建会话按钮 | 石墨靛蓝 / 纸色棕 —— 强调色跟着皮肤走，正确 |
| 当前会话行 | 两种皮肤各自有一圈强调色描边，选中态清楚 |
| 搜索框 | 底色是抬高面，两种皮肤下都与行区分得开 |
| 状态胶囊（运行中 / 完成 / 等待审批） | **两种皮肤下颜色一致**（蓝 / 绿 / 琥珀） |

最后一条是**有意的**：状态色是语义信号，不该随皮肤改色（"绿=完成"在纸色皮肤上也必须是绿的）。所以这里不改，记进设计约定。

### 产物页（夜航）

![夜航产物页：卡片描边变淡但仍可辨](C:\Users\Administrator\.dsh\screenshots\matrix-approval-artifacts.png)

上一片担心的"描边变淡会不会分不清"在这里得到答案：卡片外框、行分隔线、行内图标都还在，只是从"实色灰线"变成"低透明蓝线"，与底色同色温，观感更整。徽章（交付物绿 / 改动蓝）用的是语义色，不受皮肤影响。

### 改了什么

**本轮无代码改动**。产出是两组合并截图与一条设计约定（状态色不随皮肤变）。

### 未测 / 风险

- **整屏与真机未测**：都是组件级 iframe 渲染；真机色准、OLED 暗场未验。
- 漏拍：审批页的 iframe 抓取失败（页面留白），配对页从未截图 —— 已记入待办。
- 风险：状态胶囊在纸色皮肤上偏"外来色"，虽然语义正确，但观感上仍是纸色页面上最跳的元素；若后续真机反馈刺眼，解决办法是给状态色加一层"皮肤化外壳"（底用肤色淡染、字保留语义色），而不是直接改语义色。
- 回退点：无。

### 下一步

补拍审批与配对；然后做一次"状态色外壳"试验（纸色皮肤下的胶囊是否更融）——先出对照图再决定改不改。

## 2026-11-10 切片 59：配对页第一次上屏 —— 结构清楚，记两条文案级待办

### 审查（又一个从没截过图的面）

配对页（`PairRequiredView`）在整条重构里从未被截图。它还是"没配对就进不来"的第一屏 —— 用户第一次打开 App 看到的就是它，最该先看清。

用真组件落盘（`render(<PairRequiredView initialError="…" …/>)`）拿到真 DOM，再套上 `data-skin="graphite"` 的样式：

![配对页：标题、说明、两个输入、错误行、配对键](C:\Users\Administrator\.dsh\screenshots\pairing-graphite.png)

逐项看：

| 元素 | 结论 |
|---|---|
| 卡片 | 居中、圆角、比页面亮一档；与整站表面层级一致 |
| 标题「设备配对」 | 居中，字号与次级页标题同档 |
| 说明文字 | 左对齐，与居中标题并置略有不齐（见待办一） |
| 服务器地址输入 | 预填 `http://localhost:3000`，可改；有标签 |
| 配对链接输入 | 有标签、无占位提示（见待办二） |
| 错误行 | 红色、左对齐、紧贴主键上方 —— 位置正确（用户看完错误就能按） |
| 配对键 | 通栏强调色，唯一主操作 |

### 两条待办（都是文案/轻微对齐，不改结构）

1. 标题居中、说明左对齐 —— 两种对齐并置。要么标题也左对齐（更"文档感"），要么说明居中（更"引导页感"）。需产品定调，暂不动。
2. 配对链接输入没有 placeholder（比如"粘贴 dsh://pair 开头的链接"）。空框 + 抽象标签，新用户不知道粘什么格式。

### 改了什么

**本轮无代码改动**。产出是第一手证据 + 两条待办。

### 验证

| 检查 | 结果 |
|---|---|
| 视觉（组件级，真 DOM） | `pairing-graphite.png` |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.65 kB（hash `da482e74`，无样式改动） |
| `pnpm guard` / `pnpm test` | exit 0；**3,055 passed**、1 expected fail、10 skipped；串行 77 s |

### 未测 / 风险

- **整屏与真机未测**：真机上键盘弹出的表现（两个输入框会不会被遮）、iOS 自动填充会不会把配对码当密码、粘贴板权限被拒时的提示 —— 都没验。
- 风险：这一屏在弱网/离线时也会出现（拿不到配对），但本轮只拍了"错误文案"这一态，网络态未拍。
- 回退点：无。

### 下一步

给配对链接输入加 placeholder（纯文案，先写测试再改）；随后补"网络错误"与"配对中"两态截图。

## 2026-11-10 切片 60：配对页加占位提示 —— 第一版直接把自己截断了

### 审查后的改动

上一片记的待办二：配对链接是空框 + 抽象标签，新用户不知道粘什么。

先写用例（要求 `placeholder` 同时点明"链接"和"配对码"两种形式）→ 红 → 加 `placeholder`。

第一版写的是**「粘贴 dsh:// 开头的配对链接，或输入 6 位配对码」**，实拍：

> 输入框里显示「粘贴 dsh:// 开头的配对链接，或输**...**」——**被截断了**。

截断的占位提示比没有更糟：用户会以为句子没写完，或者以为输入框坏了。

### 改了什么

1. 文案缩短为 **「dsh:// 链接，或 6 位配对码」**（20 字以内，两种形式都在）；
2. 用例里加了**长度上限**（≤ 22 字符），把这个教训钉住 —— 以后谁想写长句，先红。

![配对页：占位提示完整可读](C:\Users\Administrator\.dsh\screenshots\pairing-graphite.png)

### 保留的能力

输入框的 `id`/`autoComplete`/`spellCheck`、标签关联、提交逻辑、错误行位置全部未动 —— 只加了一个 `placeholder` 属性。

### 先红后绿

- 第一轮：无 `placeholder` → 红；加上长文案 → 绿（但实拍截断，**用例没抓住**）；
- 第二轮：把"长度上限"也写进用例 → 红；缩短文案 → 绿，实拍完整显示。

这正是"单测绿了不等于屏上对"的实例：第一版用例通过了，屏幕上是断句。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `PairRequiredView.test.tsx` 9/9（新增 1 条含长度断言） |
| 视觉（组件级，真 DOM，两轮） | 截断版 → 完整版 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.65 kB（hash `da482e74`，无 CSS 改动） |
| `pnpm guard` / `pnpm test` | exit 0；**3,056 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：占位文字在真实字宽（不同系统字体）下是否仍完整 —— 22 字符上限是按本机字体量的，真机字体更宽时仍可能断。
- 风险：占位提示只说格式，没说"从桌面端复制"。桌面端在哪、怎么生成配对码，仍靠上面那段说明文字。
- 回退点：删掉 `placeholder` 属性与用例。

### 下一步

配对页的"网络错误 / 配对中"两态截图；占位文案在真机字体下的实测。

## 2026-11-10 切片 61：「正在配对」态上屏 —— 顺带确认了 15 秒兜底

### 审查（构造一个真实卡住的提交）

要拍到「配对中」，不能靠手搓 HTML —— 得让提交真的挂住。做法是把 `acceptMobilePair` mock 成一个永不 resolve 的 Promise，点「配对」，等按钮文案变化后落盘。

![配对中：按钮变灰、文案变「正在配对」](C:\Users\Administrator\.dsh\screenshots\pairing-submitting.png)

| 观察点 | 结论 |
|---|---|
| 按钮文案 | 「配对」→「正在配对」，用户知道在做什么 |
| 按钮外观 | 变灰（禁用态令牌生效），和语音面板的「请稍候」同一套规则 |
| 输入框 | 仍可编辑 —— **这是个小疑点**：正在提交时改内容，提交的仍是旧值 |
| 无取消入口 | 这屏是配对前的第一屏，没有返回键 |
| 卡死风险 | **查了代码：`PAIR_ACCEPT_TIMEOUT_MS = 15_000`，超时会 abort 并落到错误态** —— 不会永久卡住 |

### 改了什么

**无代码改动**。产出是一张态图和一条结论：卡死风险被 15 秒超时兜住（这点在本轮之前没有人写下来过）。

### 未测 / 风险

- **整屏与真机未测**：15 秒超时到点后的错误文案没截（`acceptMobilePair` 的 error 分支文案未拍）。
- 风险一：15 秒对"第一屏"来说偏长，且这 15 秒里没有任何进度指示（只有文案变灰）。真机上用户很可能以为坏了去刷新。
- 风险二：提交中仍可编辑地址与链接，提交的是点击那一刻的值 —— 用户改完以为生效其实没有。
- 回退点：无。

### 下一步

两条候选改法（都需要先出对照再定）：
1. 提交中把两个输入框也置为只读（`readOnly`），避免"改了却没生效"；
2. 15 秒太长 —— 提交 5 秒后追加一行"网络较慢，仍在尝试…"，或直接缩短超时。

我倾向先做第 1 条（纯行为、可用单测锁），第 2 条等真机反馈。

## 2026-11-10 切片 62：提交中把输入框锁住，并且让人看得出来

### 审查

上一片发现的疑点：点「配对」后两个输入框仍可编辑，提交的却是点击那一刻的值 —— 用户改完以为生效，其实没有。

### 改了什么

1. 两个 `<input>` 加 `readOnly={submitting}`（提交中只读）；
2. **只读在浏览器里没有外观变化**，所以另加一条样式：

```css
.mobile-pairInput:read-only { opacity: var(--palm-btn-disabled-opacity); }
```

与禁用按钮共用同一档透明度令牌 —— "忙、别动"这件事在两处用同一个数值表达。

![提交中：两个输入框与主键一起降级](C:\Users\Administrator\.dsh\screenshots\pairing-submitting.png)

### 保留的能力

配对逻辑、15 秒超时、错误文案、Esc/遮罩、标签关联、粘贴都能用（只读只挡"编辑"，不挡选择与复制）。

### 先红后绿

- 行为契约（`PairRequiredView.submitting.test.tsx`，把 `acceptMobilePair` mock 成永不 resolve）：两框 `readOnly === true` —— 先红（`expected false to be true`）后绿；
- 样式契约（只读态要用禁用透明度令牌）—— 先红后绿；
- 两次 PowerShell 字面替换都没匹配上（缩进不同），改用 `edit` + 唯一锚点才成功 —— 又一次印证"批量字符串替换不如读一遍再改"。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `PairRequiredView` 9/9、`PairRequiredView.submitting` 1/1、`structure` 154/154 |
| 视觉（组件级，真 DOM） | 提交中两框变暗、主键「正在配对」 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.71 kB（hash `d8d307a5`） |
| `pnpm guard` / `pnpm test` | exit 0（预算 `src/mobile` 60740 → **60760**、`src/mobile/components` 2790 → **2800**）；**3,058 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：只读态的 60% 透明度在浅色主题（纸色皮肤）下是否显得"坏掉了"，没拍；真机上只读输入框仍会被点出软键盘（`readOnly` 在某些 WebView 上仍聚焦），需实机确认。
- 风险：提交中两个框一起变暗 + 按钮变暗，页面整体偏低对比；如果超时 15 秒才恢复，这段时间页面看起来"死了"。
- 回退点：去掉 `readOnly` 与 `:read-only` 规则，预算回退 60760 → 60740、2800 → 2790。

### 下一步

拍纸色皮肤下的提交中态（浅底 + 60% 是否会显得脏）；然后回到"超时后的错误文案"这一态。

## 2026-11-10 切片 63：纸色皮肤下的"提交中"没有显得脏，但内容变难读了

### 审查

上一片的风险点：只读态用 60% 透明度，在浅色（纸色）下会不会显得"坏掉了"。

![纸色皮肤：提交中，两框与主键一起降级](C:\Users\Administrator\.dsh\screenshots\pairing-submitting-paper.png)

| 观察点 | 结论 |
|---|---|
| 整体观感 | 白卡 + 暖米底，两框与主键一起"退到后面"，不像坏了，像**忙** |
| 主键 | 棕底 60%，仍能读出「正在配对」 |
| 已填内容 | 也一起变淡 —— **这是本轮的取舍点** |

### 取舍：整框变淡 vs 只淡化边框

整框变淡的好处是"整片区域都在忙"，语义一致；代价是**用户想核对粘进去的码时，字也变淡了**。

另一条路是只换底与描边（`background: var(--palm-sur-2)` + `color: var(--palm-fg-2)`），文字保持可读。但它会让"只读"看起来像"另一种输入框"，而不是"暂时锁住"。

**这轮维持整框变淡**：15 秒的等待里，用户更需要知道"别动"，而不是"再确认一遍"。若真机反馈核对困难，再换成只淡化边框。

### 改了什么

**无代码改动**（纯验证 + 决策记录）。

### 验证

| 检查 | 结果 |
|---|---|
| 视觉（组件级，真 DOM） | 纸色皮肤提交中态 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.71 kB（hash `d8d307a5`，无改动） |
| `pnpm guard` / `pnpm test` | exit 0；**3,058 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：真机软键盘弹出时，纸色皮肤的只读框是否会被系统自动填充"高亮"覆盖；真机字体下 60% 透明度的对比是否仍够。
- 风险：这条"整框变淡"的取舍只在截图上看过一次，没有真实用户视角。
- 回退点：无（未改代码）。

### 下一步

"超时后的错误文案"态：把 `acceptMobilePair` mock 成 reject，落盘错误态，确认错误行与主键的相对位置在**纸色 + 深色**两种皮肤下都成立。

## 2026-11-10 切片 64：配对失败态在两种皮肤下都站得住

### 审查（先纠正自己一个假设）

第一次写 dump 时我把 `acceptMobilePair` mock 成 **reject**，结果错误行根本没出现。读源码才知道：它**不抛异常**，而是返回 `{ ok: false, message }`，由组件 `setError(result.message)` —— 我把"失败"和"异常"当成了一回事。

改成 `Promise.resolve({ ok: false, message })` 才拍到。这条也顺带说明了：错误文案的**唯一来源**是平台层返回的 message，组件不自己编。

![左：石墨 右：纸色，同一条失败文案](C:\Users\Administrator\.dsh\screenshots\pairing-error-matrix.png)

| 观察点 | 结论 |
|---|---|
| 位置 | 紧贴主键上方、表单级（不绑定某个输入框）—— 正确，因为失败可能是网络、链接过期或桌面端没响应 |
| 换行 | 两行，把主键往下推，布局不塌 |
| 深色 | 红字在深底上清楚 |
| 纸色 | 红字在白卡上清楚 |
| 重试 | 主键仍是「配对」，直接再按一次即可 —— 不用重填 |

### 改了什么

**无代码改动**。产出是两皮肤对照图 + 一条平台契约的确认（失败走返回值，不走异常）。

### 验证

| 检查 | 结果 |
|---|---|
| 视觉（组件级，真 DOM，两皮肤并排） | `pairing-error-matrix.png` |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.71 kB（hash `d8d307a5`，无改动） |
| `pnpm guard` / `pnpm test` | exit 0；**3,058 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：真机上错误出现时是否会触发读屏播报（`role="alert"` 有，但 WebView 表现未验）；键盘开着时错误行会不会被顶出屏幕外。
- 风险：错误文案长（本例两行），若平台返回更长文案（比如带 HTTP 状态码），会把主键推得更低，小屏 + 键盘下可能看不全主键。
- 回退点：无。

### 下一步

配对三态（空闲 / 提交中 / 失败）已齐。回到聊天主路径：把"离线横幅 + 待发队列"这一组在**同一屏**里的层叠关系再确认一次（这两者同时出现时最容易互相压住）。

## 2026-11-10 切片 65：离线横幅 + 待发队列同屏 —— 揪出「立即发送」绕开皮肤令牌

### 审查（两个最容易互相压住的元素放一屏）

![左：石墨 右：纸色，离线横幅 + 两条待发](C:\Users\Administrator\.dsh\screenshots\offline-queue-matrix.png)

| 观察点 | 结论 |
|---|---|
| 层叠 | 横幅在顶、队列条在底，中间完全留空 —— **互不遮挡**，两者都在"自己的轨道"上 |
| 队列行 | 文本列 + 四个动作（编辑/删除/撤回/立即发送），320px 下会自动换行（既有规则） |
| 离线横幅 | 有底线：`background: var(--palm-tint-warn)`，但 12% 透明度在两种皮肤下**几乎看不出是一条带子**（下一轮的活） |
| 「立即发送」 | 深色＝靛蓝、纸色＝棕 —— 看着对，但**实现绕开了皮肤令牌** |

### 改了什么（代码）

`370-v21.css`：

```css
/* 改前 */
border: 1px solid var(--border-default);
border-radius: 8px;
color: var(--text-tertiary);
background: var(--accent, #4f7cff);
color: #fff;
opacity: 0.4;

/* 改后 */
border: var(--palm-hair) solid var(--palm-line);
border-radius: var(--palm-r-s);
color: var(--palm-fg-3);
background: var(--palm-accent);
color: var(--palm-on-accent);
opacity: var(--palm-btn-disabled-opacity);
```

`var(--accent, #4f7cff)` 的两个毛病：①兜底字面色本身就是裸色；②`#fff` 正好绕开 `skin-contrast.test.ts` 量过的 `--palm-on-accent` —— 纸色皮肤上线时这颗按钮其实**没被校验过**。

### 保留的能力

队列的四类动作、换行规则、40px 最小宽度、44px 最小高度、主操作实心强调、禁用态 —— 全部保持；只换了颜色与圆角的**来源**。

### 先红后绿

2 条契约先红 → 改完绿。中途撞了一个自己挖的坑：新写的注释里**就写着**被替换掉的旧色值，而 `body()` 不剥注释，于是"裸色"断言把注释也算进去了 → 给这个 describe 的 `compact()` 加注释剥离，绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 156/156（新增 2 条）、`quality-budget` |
| 视觉（组件级，双皮肤并排） | `offline-queue-matrix.png` |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.77 kB（hash `a34ceb6c`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,060 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：队列条展开状态下（点「收起」的反向）会把聊天挤掉多少，未拍；离线横幅在真机安全区（刘海）下是否被遮。
- 风险一：离线横幅的 12% 琥珀底几乎看不见带子边界，用户可能只看到一行黄字飘在顶上。
- 风险二：`--palm-btn-disabled-opacity`（0.6）用在 11px 的队列按钮上，禁用态可能降到"看不清"。
- 回退点：把这几行换回旧值（契约同步）。

### 下一步

离线横幅的视觉：要么加深琥珀底，要么加一条 2px 左侧竖条（与设置页定位同一手法），先出对照图再定。

## 2026-11-10 切片 66：离线横幅从"一行黄字"变成"一条状态带"

### 审查（先出三个方案再动手）

上一片发现：离线横幅有底色，但 `--palm-tint-warn` 只有 10~12% 透明度，截图上分不出"带子到哪儿为止"。

三个方案并排出图（同一份构建，只看深色皮肤）：

![左：现状 12% 中：加深到 24% 右：16% + 左侧竖条](C:\Users\Administrator\.dsh\screenshots\offline-banner-variants.png)

| 方案 | 观感 |
|---|---|
| A 现状 12% | 几乎看不出边界，像一行黄字飘在顶上 |
| B 加深到 24% | 一眼看出"整宽状态带"，正文与带子分界清楚 |
| C 16% + 3px 左侧竖条 | 边界靠竖条撑，但竖条这套手法已经给了**定位**与**插话**，再用会混淆 |

**选 B**：断线是全屏状态，本来就该整宽，而不是角落标记。

### 改了什么

```css
/* 370-v21.css */
.chat-offline-banner {
  background: color-mix(in srgb, var(--palm-warn) 24%, transparent);
  color: var(--palm-warn);
}
```

用 `color-mix` 从语义色 `--palm-warn` 派生，**不新增令牌**：三套皮肤各自给 warn 色，带子自动跟着变，深浅两套都对。

![深色：琥珀带；纸色：沙色带](C:\Users\Administrator\.dsh\screenshots\offline-banner-final.png)

### 保留的能力

"一行、≤28px、无图标块、无按钮、常驻 DOM、收起走 `data-state`" 五条硬规则一条没破；"已重连"退成无底灰字的分支也保留（用例锁着）。

### 先红后绿

2 条契约先红（底色仍是薄雾令牌、`[data-state='back']` 断言写法不对）→ 改完 **158/158** 绿。第二条红是**测试自己写错**（把两个选择器拼成一条去查），改成单一选择器后通过。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 158/158（新增 2 条） |
| 视觉（组件级） | 三方案对照 + 深浅两皮肤终稿 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.80 kB（hash `8bb2b9f9`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,062 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：`color-mix` 在旧 WebKit（iOS 15 以下）不支持 —— 那时带子会变成**没有底色**（比现在更糟）。真机矩阵里要专门看这一条。
- 风险：24% 琥珀底 + 琥珀字，在夜航（蓝调深底）上会不会显脏，没有拍。
- 回退点：一行改回 `var(--palm-tint-warn)`，契约同步。

### 下一步

给 `color-mix` 加一条回退底色（`background: var(--palm-tint-warn); background: color-mix(...)`），保证旧 WebKit 至少还有薄雾而不是透明；再拍夜航的带子。

## 2026-11-10 切片 67：`color-mix` 的兜底不能用"写两遍 background"

### 审查（兜底踩到自己的一条护栏上）

最直觉的写法是同一个块里写两遍：

```css
background: var(--palm-tint-warn);
background: color-mix(in srgb, var(--palm-warn) 24%, transparent);
```

写完立刻被 `structure` 的**「同一个块里没有重复声明」**用例拦住 —— 那条规则本来是抓复制粘贴事故的。

两条路：①给规则开个例外；②换写法。**选 ②**：那条护栏拦下过真事故，为一次兜底就放松它不划算。

### 改了什么

```css
.chat-offline-banner { background: var(--palm-tint-warn); }   /* 兜底 */

@supports (background: color-mix(in srgb, red 20%, transparent)) {
  .chat-offline-banner { background: color-mix(in srgb, var(--palm-warn) 24%, transparent); }
}
```

- 老浏览器（iOS 15 以下）拿薄雾，**不会是全透明**；
- 支持的浏览器走 24% 状态带；
- 一个块一条声明，护栏不用改。

### 夜航 + 纸色的终稿

![左：夜航 右：纸色](C:\Users\Administrator\.dsh\screenshots\offline-banner-nocturne.png)

夜航下暖琥珀带压在冷蓝底上 —— 冷暖对比强，警告意味清楚，但确实是这一屏最"跳"的元素；纸色下是自然的沙色带。

### 保留的能力

五条硬规则（一行 / ≤28px / 无图标块 / 无按钮 / 常驻 DOM）与 `[data-state='back']` 退成无底灰字的分支全部保留。

### 先红后绿

- 兜底契约先红（没有 `@supports` 分支）；
- 改完发现**旧契约还要求基块里有 `color-mix`**，与新写法冲突 → 把旧契约改成"基块不许直接写 `color-mix`"，两条一起绿（159/159）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 159/159（净新增 1 条） |
| 视觉（组件级） | 夜航 + 纸色终稿 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.92 kB（hash `3f8e30c5`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,063 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：`@supports` 只在 Chromium 里验过，iOS Safari 的实际取值（尤其 15.x）没验。
- 风险：夜航下这条暖带与整页冷色不协调；若真机觉得刺眼，可给夜航单独设 `--palm-warn` 的偏暖值（皮肤令牌本来就允许）。
- 回退点：删掉 `@supports` 块，基块保持薄雾。

### 下一步

把 `@supports` 这种"渐进增强"写法在别处也统一（现在还有几处 `color-mix` 直写），先数一遍再定；或转去补 `docs/ui-state-matrix.md` 的空白行。

## 2026-11-10 切片 68：27 处 `color-mix` 清点 —— 12 处没有兜底，先冻结清单

### 审查（先数，再决定改不改）

| 项目 | 数量 |
|---|---|
| 全仓 `color-mix` 出现 | **27**（14 个文件） |
| 其中 `background` | 13 |
| 其中 `border*` | 5 |
| 其中 `box-shadow` / 令牌派生 | 9 |
| **没有兜底、且靠它单独出底色** | **12** |

为什么这 12 处要紧：iOS 15.x / 16.0 不认识 `color-mix`，**整条声明被丢弃**。若某个块只有这一条 `background`，那个元素就变透明 —— chip、徽章、「激活中」的淡底全没了，文字直接压在白/黑底上。

12 处清单（都是小面积淡底，不是整屏表面）：

` .mobile-row:active`、`.chat-msg-maxtokens`、`.device-badge-primary`、`.chat-command-chip`、`.mobile .chat-search-mark`、`.turn-scrub-loaded`、`.mobile-offline-bar`、`.chat-stop-mini-armed`、`.approval-detail-approve`、`.palm-dd-badge`、`.palm-spec-tag[data-kind='ok']`、`.palm-spec-tag[data-kind='edit']`

### 为什么不这轮全改

每处都要写成"基块一条普通底色 + `@supports` 里一条 color-mix"，12 处 = 12 个 `@supports` 块，CSS 体积与可读性都会变差；而这 12 处的降级后果只是"淡底没了"，不是读不了字。

所以这轮**冻结清单**：新写一处没兜底的 `color-mix` 背景立刻红；修掉一处也要改清单（强制一次有意识的决定）。

### 改了什么

只加护栏：`structure` 新增一条用例，用同样的解析（跳过 `@supports` 区间）算出"无兜底的 color-mix 背景"选择器集合，与冻结的 12 条**完全相等**才算过。

### 先红后绿

- 首次跑：红 —— 我冻结清单里两条属性选择器少了引号（CSS 里是 `[data-kind='ok']`），解析结果对不上 → 按实际输出改正 → 绿（160/160）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 160/160（新增 1 条） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.92 kB（hash `3f8e30c5`，无样式改动） |
| `pnpm guard` / `pnpm test` | exit 0；**3,064 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：没有 iOS 15 设备，这 12 处在旧系统上的实际降级（淡底消失）没有截图证据。
- 风险：清单是"债务名册"而不是"问题已解"。若产品要求支持 iOS 15，这 12 处必须逐个补 `@supports`。
- 回退点：删掉这条用例。

### 下一步

优先补三处**最影响可读性**的：`.palm-spec-tag[data-kind=*]`（设置页标签）、`.chat-msg-maxtokens`（超限提示）、`.mobile-offline-bar`（离线条）；其余留册。

## 2026-11-10 切片 69：四处无兜底淡底改成皮肤淡染令牌，裸色预算跟着降

### 审查

四处的共同毛病：**既要淡底、又用 `color-mix` 现算**，而皮肤里其实早就有普通 rgba 的淡染令牌。

| 选择器 | 改前 | 问题 |
|---|---|---|
| `.palm-spec-tag[data-kind='ok']` | `color-mix(ok 18%, transparent)` | iOS 15 上标签变透明 |
| `.palm-spec-tag[data-kind='edit']` | `color-mix(accent 18%, transparent)` | 同上 |
| `.chat-msg-maxtokens` | `border/底/字` 三处 `var(--warning, #e69641)` + `color-mix` | **裸色兜底** ×3，且淡底在旧系统消失 |
| `.mobile-offline-bar` | `color-mix(warning 18%, bg-elevated)`，带 `#f5a524` / `#1a1a1a` 兜底 | 同上 |

### 改了什么

```css
.palm-spec-tag[data-kind='ok']   { background: var(--palm-tint-ok); }
.palm-spec-tag[data-kind='edit'] { background: var(--palm-tint-accent); }
.chat-msg-maxtokens  { border: var(--palm-hair) solid var(--palm-warn);
                       background: var(--palm-tint-warn); color: var(--palm-warn); }
.mobile-offline-bar  { background: var(--palm-tint-warn);
                       border-bottom: var(--palm-hair) solid var(--border-focus); }
```

全是皮肤里**已存在**的普通 rgba 令牌，不新增任何东西。

![左：石墨 右：纸色，四个元素都有淡底](C:\Users\Administrator\.dsh\screenshots\tints-matrix.png)

### 保留的能力

标签语义（交付物/改动）、超限提示的边框与字号、离线横条的 sticky 定位与层级、`data-kind` 分支 —— 全未动。

### 先红后绿

- 4 条"必须用淡染令牌、不许 color-mix、不许裸色"的契约先红 → 改完绿；
- 棘轮清单同步减 4 条（12 → 8），**清单变短也必须改**，这正是那条护栏的设计意图；
- 连带：`cssHex` 实测从 39 掉到 **34**，而预算"不虚高"用例要求预算贴近实测 → 预算从 39 收到 **34**，并把原因写进 `why`。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 164/164（+4 条、清单 −4）、`quality-budget`（cssHex 39 → 34） |
| 视觉（组件级，双皮肤） | `tints-matrix.png` |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.78 kB（hash `9900a68c`） |
| `pnpm guard` / `pnpm test` | exit 0（预算 `src/mobile` 60760 → **60790**）；**3,068 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：`--palm-tint-*` 是 alpha 叠在**背后元素**上；`.mobile-offline-bar` 原来是"掺进 bg-elevated 的实色"，现在是"半透明叠在页面底上"，真机上若它下方是图片/内容会透出来 —— 没验。
- 风险：`--palm-tint-warn` 只有 10~12%，作横条底色比聊天页那条 24% 的状态带更淡，两处断线提示现在**深浅不一致**（一处浓一处淡）。是否统一，需要一次视觉决策。
- 回退点：四处改回原写法，清单加回 4 条，cssHex 预算回 39。

### 下一步

决定"离线两处提示的浓淡是否统一"（聊天页 24% 带 vs 通用横条 12%）；统一就抽一个 `--palm-warn-band` 令牌，不统一就在文档里写明为什么不一样。

## 2026-11-10 切片 70：断线提示统一成 `--palm-warn-band`，`@supports` 那段可以删了

### 审查

同一个语义（"连不上，正在重连"）在两处用了两种浓淡：

| 位置 | 改前 |
|---|---|
| 聊天页顶部 `.chat-offline-banner` | 基块薄雾 12% + `@supports` 里 24% 的 `color-mix` |
| 全站离线条 `.mobile-offline-bar` | 10~12% 淡染 |

用户看到的是"同一件事、两种颜色深浅"，会当成两件不同的事。

### 改了什么

三套皮肤各加一个**普通 rgba** 令牌：

```css
--palm-warn-band: rgba(224, 165, 44, 0.24);   /* 石墨 */
--palm-warn-band: rgba(169, 118, 23, 0.24);   /* 纸色 */
--palm-warn-band: rgba(251, 191, 36, 0.24);   /* 夜航 */
```

两处都用它，`@supports (background: color-mix(...))` 整段删除 —— 普通 rgba 在 iOS 15 上同样有效，不再需要渐进增强分支。

![左：石墨 右：纸色，两条断线带深浅一致](C:\Users\Administrator\.dsh\screenshots\offline-band-unified.png)

### 保留的能力

横幅的五条硬规则（一行 / ≤28px / 无图标块 / 无按钮 / 常驻 DOM）、`[data-state='back']` 退灰字、离线条的 sticky 与层级 —— 全保留。

### 先红后绿

- 改契约（横幅必须有 `--palm-warn-band`、不许 `color-mix`；离线条同令牌）——
  两条先红，改完 **164/164** 绿；
- 新增令牌 → `tokens-golden` 需要更新：用 `PALM_UPDATE_TOKENS=1` 跑一次（不手改），再跑一次确认 3/3 绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 164/164、`tokens-golden` 3/3 |
| 视觉（组件级，双皮肤） | 两条带子同深浅，超限提示同步变淡染 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.71 kB（hash `2ff69171`，比上片**小了** 0.07 kB，因为删掉整段 `@supports`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,068 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：24% 琥珀底在真机（尤其 OLED 暗场 + 自动亮度）会不会显得脏，没验。
- 风险：两处**文字颜色仍不同** —— 横幅是 `--palm-warn`（琥珀字），离线条是 `--text-primary`（正文色）。深浅统一了，字色没统一；下一片决定是否也统一。
- 回退点：删三处令牌、两处用回各自旧值、恢复 `@supports` 段，契约与 golden 同步。

### 下一步

统一两处的文字颜色（要么都用 `--palm-warn`，要么都用正文色）——先用一张并排图确认哪个更读得清；随后回 `docs/ui-state-matrix.md` 补空白行。

## 2026-11-10 切片 71：带子加深以后，琥珀字反而不达标了 —— 用数字定的

### 审查（先算，再看图）

上一片把带子从 12% 加深到 24%。直觉上"更深 = 更清楚"，但**文字色没跟着变**，于是：

| 皮肤 | `--palm-warn` 字在 24% 带上 | `--palm-fg` 字在 24% 带上 |
|---|---|---|
| 石墨 | 5.53 | **11.04** |
| 纸色 | **4.04（低于 AA 4.5）** | **12.43** |
| 夜航 | 7.02 | **10.30** |

纸色皮肤下"琥珀字压琥珀带"只有 4.04 —— 比改前（12% 薄雾）还差。

### 改了什么

- `.chat-offline-banner` 的文字色：`var(--palm-warn)` → **`var(--palm-fg)`**；
- 警示语义由**带子**承担（整宽 24% 琥珀），不再靠字色；
- 全站离线条本来就是正文色 → 两处现在**带子与字色都一致**。

![左：石墨 右：纸色 —— 带子说明"警告"，字回到正文色](C:\Users\Administrator\.dsh\screenshots\offline-band-text.png)

### 保留的能力

五条硬规则、`[data-state='back']` 退灰字、离线条 sticky —— 未动；"不把断线染成错误红"这条老约定也保持（用例仍在）。

### 先红后绿

- `.chat-offline-banner` 必须 `color: var(--palm-fg)` 且不许 `color: var(--palm-warn)` —— 先红后绿；
- `skin-contrast.test.ts` 新增三皮肤"正文色在带子上 ≥ 7:1"—— 直接通过（10.3~12.4），把它变成往后改令牌时的护栏；
- **一条老用例红了**：`offline-banner.test.tsx` 断言规则里含 `var(--palm-warn)`（当时的字色）。改成断言带子令牌 + 正文字色，并写明 4.04 这个数字的来源。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 165/165、`skin-contrast` 19/19、`offline-banner` 全绿 |
| 视觉（组件级，双皮肤） | 两条带子同深浅、同字色 |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.71 kB（hash `8b2b38ed`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,072 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：正文色 `#f4f4f8` 压 24% 琥珀，在真机（尤其强光下自动亮度拉满）会不会"发白到失去警告感"，没验 —— 数值够，观感未证。
- 风险：警示感现在全靠底色，若用户把系统"降低透明度/增强对比度"打开，24% 带子可能被冲淡，届时没有字色兜底。
- 回退点：横幅字色改回 `var(--palm-warn)`，用例同步（并把对比度用例改成断言 4.04 的例外）。

### 下一步

回到 `docs/ui-state-matrix.md`：把这十几片攒下来的截图按屏归档，标出仍空着的状态（键盘弹出、横屏、无权限）。

## 2026-11-10 切片 72：把 23 片攒下的证据归档进状态矩阵

### 为什么这轮只动文档

`docs/ui-state-matrix.md` 停在切片 48 之前：后面 23 片产出的截图（语音三态、配对三态、定位标记、抽屉双皮肤、待发队列同屏、离线两处带子、三皮肤表面收口、淡染令牌）**一张都没登记**。状态矩阵是这套工作的"验收台账"，不补就等于做过的事没有名字。

### 补了什么

1. **新证据表**（13 行）：每行写明屏、皮肤、状态、证据文件名；
2. **仍然空着的状态表**（6 行）：每行写明"为什么仍然空"和"需要什么条件"，而不是含糊写"未测"。

其中三条值得单独说：

| 空着的项 | 真实原因 |
|---|---|
| 键盘弹出 | jsdom 没有软键盘；浏览器截图也不模拟 `visualViewport` 收缩 —— 只有真机或 Playwright 设备仿真能验 |
| iOS 15 的 `color-mix` 降级 | 没有旧系统设备（这条在切片 68/70 已经变成"债务清单 + 令牌化"两条护栏） |
| 配对超时到点 | 有错误态图，但"15 秒真的到点"这条时序没拍，需要可控假时钟 |

### 验证

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` / `pnpm guard` / `pnpm test` | exit 0；**3,072 passed**、1 expected fail、10 skipped（本轮无代码改动，确认没碰坏东西） |

### 未测 / 风险

- **整屏与真机未测**：文档补的是"已有证据的索引"，不是新证据。
- 风险：矩阵里 13 行证据大多在 `C:\Users\Administrator\.dsh\screenshots\`，与仓库分离；换机器或清临时目录后会失效。若要长期留档，应把关键几张拷进 `docs/prototype/`。
- 回退点：删掉新增两节。

### 下一步

把最关键的 6 张（聊天主屏双皮肤、抽屉双皮肤、配对三态之一、离线带）拷进 `docs/prototype/`，让证据随仓库走。

## 2026-11-10 切片 73：八张关键截图随仓库归档

### 问题

状态矩阵里 13 行证据几乎全在 `C:\Users\Administrator\.dsh\screenshots\`（临时目录，与仓库分离）。换机器、清临时目录、"换个会话继续干"—— 证据就没了，矩阵变成一串指向空路径的文件名。

### 改了什么

拷了八张进 `docs/screenshots/`（与既有的 59 张同目录），并写进 `docs/ui-state-matrix.md` 的"随仓库归档"表：

| 文件 | 内容 |
|---|---|
| `v2-chat-paper.png` | 聊天主屏 · 纸色 |
| `v2-chat-nocturne.png` | 聊天主屏 · 夜航 |
| `v2-drawer-graphite-paper.png` | 抽屉 · 石墨 vs 纸色并排 |
| `v2-pairing-graphite.png` | 配对页 · 空态（含占位提示） |
| `v2-offline-band.png` | 断线带 · 双皮肤同档 |
| `v2-voice-transcribing.png` | 语音面板 · 转写中 |
| `v2-tinted-tags.png` | 淡染标签 / 超限提示 / 离线条 |
| `v2-artifacts-nocturne.png` | 产物列表 · 夜航 |

### 保留的能力

只是新增文件，没有移动、改名或删除任何既有截图；`docs/screenshots/` 原有 59 张原样。

### 验证

| 检查 | 结果 |
|---|---|
| 文件落地 | 8/8 拷入，`docs/screenshots` 从 59 → 67 张 |
| `git status` | 8 张为未跟踪新文件（与既有未提交工作一致，不提交、不推送） |
| `pnpm typecheck` / `pnpm guard` / `pnpm test` | exit 0；**3,072 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- 风险：八张里有两张是"并排 iframe"的合成图（抽屉、离线带），边框是外壳页的灰底，不是产品的一部分 —— 长期看容易误导。真正的产品单屏图应各出一张。
- 风险：截图是 2026-11-10 的构建产物；若后续样式再改，这八张会与代码不一致，需要在矩阵里标注"对应 hash"。**本轮没标 hash**，下一轮补。
- 回退点：删掉这八个文件与表。

### 下一步

给八张补上"对应 `app.css` hash"（当前 `8b2b38ed`），并给合成图加注"外壳灰底非产品"；然后继续找还没截过的屏（上下文页、回合大纲在换肤后的样子）。

## 2026-11-10 切片 74：上下文占用条在撒谎 —— 26% 被画成半满

### 审查（截图先暴露了数字对不上）

![上下文占用 + 回合大纲，换肤后](C:\Users\Administrator\.dsh\screenshots\v2-context-outline-dark.png)

占用页写着 `148.0k · 已占用 · 74%`，条子却几乎满格 —— 因为宽度是**四档量化**：

```css
.context-bar-fill { width: 25% }
[data-level='2'] { width: 50% }  [data-level='3'] { width: 75% }  [data-level='4'] { width: 100% }
```

`level = ceil(ratio * 4)` 于是 26% → 50%、51% → 75%、76% → 100%。**用户看到的长度和旁边的百分比不是一回事**，而这页的全部意义就是"我现在占了多少"。

### 改了什么

换成原生 `<progress>`：

```tsx
<progress className="context-bar" value={used} max={contextWindow}
          data-pressure={ratio >= 0.85 ? 'high' : undefined}
          aria-label={`上下文已用 ${Math.round(ratio * 100)}%`} />
```

- 宽度由浏览器按 `value/max` 算比例，**不需要行内样式**（`inlineStyles` 棘轮不动），也不需要 4 档规则；
- 读屏自动报 `progressbar` 角色与当前值，比原来 `role="img"` + 手写 aria-label 更准；
- CSS 补三条：`appearance: none`、`::-webkit-progress-bar`、`::-webkit-progress-value`/`::-moz-progress-bar`（缺一条就露系统蓝）。

### 顺带发现的第二个问题：纸色皮肤里"警示档"看不出来

高水位原来用 `--palm-warn`。纸色皮肤 `--palm-warn` 是橄榄棕、`--palm-accent` 是棕 —— **几乎同色**，90% 与 74% 的条子长得一样。

改成 `--palm-danger`：三套皮肤都与强调色拉得开，且"上下文快满"本来就更接近"要出事"。

![左：石墨 右：纸色 —— 26% 只画 26%，90% 变红](C:\Users\Administrator\.dsh\screenshots\v2-context-progress.png)

### 保留的能力

- 百分比文字、`窗口总量`/`压缩前预估` 两行、空态与"只给部分字段"的处理全部不变；
- `data-pressure` 仍在（阈值仍是 85%）；
- 无行内样式（用例断言 `style` 为 null）。

### 先红后绿

- 两条用例改成断言 `progress.context-bar` 的 `value`/`max` 与"不再有 `.context-bar-fill`"——先红后绿；
- 中途 `cssHex` 从 34 涨到 **36** 被预算拦住：原因是我在注释里写了两个十六进制色值（`cssHex` 连注释一起数）。把注释改成"橄榄棕 vs 棕"后回到 34。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `ContextView` 9/9、`quality-budget` 25/25 |
| 视觉（组件级，双皮肤，三档） | `v2-context-progress.png`（已归档为 `docs/screenshots/v2-context-bars.png`） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 162.93 kB（hash `c2e4af50`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,072 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：`<progress>` 的两种伪元素在 iOS Safari / Firefox 上的实际观感没验；只保证 Chromium 截图正确。
- 风险：`progress` 在部分 WebView 上有 1px 默认内边距，可能让条子比设计稿矮一点点（12px 上不易察觉）。
- 回退点：还原成 div + 四档宽度（用例同步），并把高水位颜色改回 `--palm-warn`。

### 下一步

回合大纲页同样有"量化 vs 真实"的问题吗？—— 那一页只有圆点与文字，没有条子；改为检查**当前轮高亮**在纸色皮肤上是否够明显（截图里是靛蓝淡底 + 描边，纸色未拍）。

## 2026-11-10 切片 75：整屏复核三页 + 修「待发送图片的 ×」

### 审查（一次扫三屏，只改发现真问题的那处）

| 屏 | 双皮肤结论 |
|---|---|
| 回合大纲 | 当前轮有"实心点 + 淡底 + 描边 + 正在看"三重标记，纸色皮肤下靠点与文字色撑住，**够用**，不改 |
| 设置 | 卡片/分区/开关层级清楚；纸色下卡片白于页面，层次正确；加载骨架不抢眼，**不改** |
| composer（拥挤态） | 缩略图角上的「×」有问题 —— 见下 |

![左：石墨 右：纸色 —— 大纲页当前轮标记](C:\Users\Administrator\.dsh\screenshots\v2-outline-skins.png)

### 发现的问题：44px 热区、18px 的叉、还挤在角上

`.chat-attach-remove` 的热区是 44×44（合规），但「×」只有 18px，**贴在最角上**，用 `align-items: flex-start; justify-content: flex-end` 顶到边。后果：

- 用户看不出删除区从哪儿开始 —— 整个热区里 3/4 是空白；
- 圆点用的是 `rgba(0,0,0,.55)` + `#fff`（裸色），纸色皮肤下是"深色圆点压在白卡上"，很脏。

### 改了什么

```css
.chat-attach-remove { align-items: center; justify-content: center; }  /* 叉居中 */
.chat-attach-remove::before {
  width: 22px; height: 22px;                    /* 18 → 22 */
  background: var(--palm-sur-2);                 /* 原 rgba(0,0,0,.55) */
  color: var(--palm-fg);                         /* 原 #fff */
  box-shadow: 0 0 0 var(--palm-hair) var(--palm-line);
}
.chat-attach-remove:active::before { background: var(--palm-sur-1); }
```

热区仍是 44px（不缩小触控），只是把可见的叉放到热区正中，让"点到哪儿会删"看得出来。

### 保留的能力

移除图片、`aria-label="移除图片"`、按钮语义、热区尺寸、缩略图 56px 与圆角 —— 全部不变。

### 先红后绿

两条契约（热区 44px 且叉居中；叉的底色/字色走令牌、不许裸色）先红 → 改完 **183/183** 绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 168/168、`quality-budget` 15/15 |
| 视觉（组件级，双皮肤） | 叉居中后一眼可见（截图顶部被裁，只看得到下半） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 163.02 kB（hash `3874009d`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,074 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：44px 热区里叉居中后，右上角仍有 11px 的空白可点删 —— 是否仍会误删，真机才知道。
- 风险：`--palm-sur-2` 做的圆点在"深色图片"上可能与图融在一起（有 hairline 圈边兜底，但浅色照片上圈边不明显）。
- 回退点：三行改回原值（裸色与 18px 的叉）。

### 下一步

给「×」的圆点加一层与图片内容无关的稳定对比（例如半透明遮罩 + 描边双保险），或直接改到缩略图外侧。
## 2026-11-10 切片 76：角标的对比不能跟着皮肤走 —— 底下是照片

### 审查（上一片自己埋的坑）

上一片把「×」圆点的底色从 rgba 黑换成了 `--palm-sur-2`（皮肤表面色）。理由写的是"纸色皮肤下深圆点压白卡很脏"——但角标**压在照片上**，不是压在卡片上：

- 深色皮肤的 `--palm-sur-2` 是深灰 → 深照片上直接消失；
- 纸色皮肤的 `--palm-sur-2` 是浅米 → 浅照片上直接消失。

"跟着皮肤走"这条规则对**皮肤表面**成立，对**照片**不成立。

### 改了什么

加两个**不随皮肤变**的令牌（放在 `:root` 基础层，不进三套皮肤）：

```css
--palm-scrim: rgba(0, 0, 0, 0.55);
--palm-on-scrim: rgba(255, 255, 255, 0.96);
```

角标改成 `background: var(--palm-scrim); color: var(--palm-on-scrim); box-shadow: 0 0 0 1px var(--palm-on-scrim)` —— 压暗层保证任何底图上都有对比，白亮边防止"压在深色照片上只剩一个黑块"。

![三种底图（浅 / 深 / 中灰）下角标都立得住](C:\Users\Administrator\.dsh\screenshots\v2-scrim-badge.png)

### 保留的能力

44px 热区、叉居中、`aria-label`、"移除图片"的语义 —— 全不变。

### 先红后绿

- 契约改成"必须用 `--palm-scrim` / `--palm-on-scrim`，且 `--palm-scrim` 是 rgba 黑"——先红后绿；
- 新增令牌 → `tokens-golden` 需要更新。**这里发现一件必须记账的事**：这次 `PALM_UPDATE_TOKENS=1` 一次同步了 **63 增 36 改**，远超本次两行 —— 说明 golden 基线从更早的切片起就没跟上（例如 `--palm-dock-field-h` 40→48、`--palm-chat-body-size` 等）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 170/170、`quality-budget` 15/15、`tokens-golden` 3/3 |
| 视觉（组件级，三底图 × 双皮肤） | `v2-scrim-badge.png`（已归档 `docs/screenshots/v2-scrim-badge.png`） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 163.07 kB（hash `a83dbd9f`） |
| `pnpm guard` / `pnpm test` | exit 0（预算 `src/mobile` 60790 → **60820**）；**3,074 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：角标落在真实照片上（高光、雪景、夜景）的观感没验，只验了三种纯色。
- 风险（要盯）：**`tokens.json` 基线一次性同步了 99 行**，大多数不是本次改动带来的。若当时某个令牌是被误改的，这次会把误改"追认"成基线。下一轮应做一次"基线逐条核对"。
- 回退点：角标改回 `--palm-sur-2` / `--palm-fg`（会重现"半数百底消失"），或彻底回退到裸色。

### 下一步

**基线核对**优先：把这次 99 行 golden 变更逐条对照令牌定义，确认没有"误改被追认"；然后再继续 UI 切片。
## 2026-11-10 切片 77：核对 99 行 golden 基线 + 通知页「失败」看不出来

### 一、基线核对（上片欠的账）

把 `tokens.json` 那 99 行变更逐条解析出来：**18 个改值、9 个新增、0 个删除**。18 个改值全部能对上已有切片：

| 变更 | 归属 |
|---|---|
| `--palm-dock-field-h` 40→48、`--palm-dock-input-h` 32→44、`--palm-drawer-new-h` 40→44、`--palm-drawer-search-h` 34→44、`--palm-insert-h` 30→44、`--palm-insert-row-h` 36→44、`--palm-spec-search-h` 32→44 | 44px 触控扫除（切片 5x） |
| `--palm-ok` / `--palm-danger` / `--palm-fg-3`（纸色）| 纸色对比度校正（切片 24/25） |
| `--palm-flow-*`（纸色渐变与描边）| 纸色皮肤覆盖 |
| `--palm-strip-rail-done/now`（改为引用 `--palm-ok` / `--palm-accent`）| 令牌卫生（去掉裸渐变） |

**结论：没有无法解释的条目**，"误改被追认"的风险降级为"未见异常"。这一轮也确认了 9 个新增键（`--palm-scrim` / `--palm-on-scrim` / `--palm-warn-band` / `--palm-btn-*` 等）都是有意加的。

### 二、通知页：「失败」和中性统计长得一样

![送达情况：失败行与上面两行灰字同款](C:\Users\Administrator\.dsh\screenshots\v2-notify-skins.png)

`03:37:12 · bark · 失败 · HTTP 400 设备 token 已失效` 和 `共 24 次推送尝试 · 成功 22 · 失败 1` 用的都是 `.settings-note`。用户扫这一屏，看不出"这里出过错"。

### 改了什么

```tsx
// notify-page.tsx
className={`settings-note ${record.status === 'dropped' ? 'notify-delivery-drop' : 'notify-delivery-fail'}`}
```

```css
/* 复合选择器是必须的：后面 .settings-note 的 color 同权重，单写一个类会被盖掉。 */
.settings-note.notify-delivery-fail { color: var(--palm-danger); }
.settings-note.notify-delivery-drop { color: var(--palm-warn); }
```

![失败行变红，已过滤行变琥珀](C:\Users\Administrator\.dsh\screenshots\v2-notify-fail.png)

### 保留的能力

送达统计、按渠道汇总、最多 8 条、`已过滤` 与 `失败` 的区分、清空与刷新 —— 全不变；只是给两行加了类名。

### 先红后绿

- 两条契约先红：①失败行/已过滤行分别带类名（要真的渲染出日志，得同时给 `inboxStats`，否则整块不画）；②样式表用**复合选择器**上色。
- 中途两次红是测试自己写错：先匹配了含「失败」的**统计行**（`成功 22 · 失败 1`），改成匹配 `HTTP 400`；`inboxStats` 没给导致整块不渲染。

### 顺手核对的两屏（无改动）

| 屏 | 结论 |
|---|---|
| 用量 | 三态（正常/余额/未配置/失败）徽章、双进度条、底部「收起 + 刷新」层级都清楚；**不改** |
| 通知（整体） | 三张卡片结构清楚；只有上面那一处失败行需要标记 |

![用量页双皮肤](C:\Users\Administrator\.dsh\screenshots\v2-usage-skins.png)

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `notify-page` 5/5（新增 2 条） |
| 视觉（组件级，双皮肤） | `v2-notify-fail.png`、`v2-usage-skins.png`、`v2-notify-skins.png`（三张已归档 `docs/screenshots/`） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 163.19 kB（hash `f52b46e8`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,076 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：红字在纸色皮肤下与"已过滤"的琥珀相邻时会不会像两档错误，没在真机上看。
- 风险：`--palm-danger` 直接上文字；深浅两套的对比度过 `skin-contrast` 的语义色用例，但那是针对"淡底上的字"，这里是无底裸字，未单独量。
- 回退点：两行去掉类名，样式两条删掉。

### 下一步

给这两行的颜色补一条对比度用例（无底裸字 vs 卡片表面），并考虑给失败行加一个 12px 的「失败」前缀图标位，避免纯靠颜色区分（色盲用户）。
## 2026-11-10 切片 78：补上"裸字对比度"护栏 + 320 窄屏 × 纸色三屏复核

### 一、上一片欠的对比度用例

上一片给送达日志的失败行上了 `--palm-danger` 裸字（**没有淡底**），而 `skin-contrast` 里所有语义色用例都是"语义色压同色淡底"。补一条裸字的：

```ts
it.each(['graphite', 'paper', 'nocturne'])('%s：danger / warn 裸字压在卡片表面 ≥ 4.5', (skin) => {
  for (const ink of ['--palm-danger', '--palm-warn'] as const) {
    expect(contrast(palette[ink], palette['--palm-sur-1'])).toBeGreaterThanOrEqual(4.5)
  }
})
```

三套皮肤**直接通过**（不需要改色）——这条用例的价值不在"发现 bug"，而在把这次的选择钉成契约：以后谁调 `--palm-sur-1` 或语义色，都要先看这两行的可读性。

另外确认了一件上一片担心的事：**失败行不是纯靠颜色区分** —— 行内本来就写着「失败」两个字，红色只是加强，色盲用户读字也懂。

### 二、320 窄屏 × 纸色：三屏并排

之前的窄屏证据都是石墨皮肤，纸色 × 320 这个组合没拍过。

![320 宽 + 纸色：用量 / 通知 / 设置](C:\Users\Administrator\.dsh\screenshots\v2-320-paper.png)

| 屏 | 320 + 纸色下的表现 |
|---|---|
| 用量 | 模型行「deepseek-v4.1-flash … 8,120 次」不换行不挤压；四态徽章（pro / 余额 / 未配置 / 失败）都放得下 |
| 通知 | 失败行在 320 下折成两行（`HTTP 400` 与 `设备 token 已失效`），红色仍清楚 |
| 设置 | 每行右侧值（`跟随系统` / `标准` / `舒适`）不被标题挤掉；说明文字按一行省略号收尾 |

**三屏都不用改** —— 这一轮没有代码改动（除了新增用例）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `skin-contrast` 22/22（新增 3 条） |
| 视觉（320 × 纸色） | `v2-320-paper.png`（已归档） |
| `pnpm typecheck` / `pnpm build` | exit 0 |
| `pnpm guard` / `pnpm test` | exit 0；**3,079 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：320 是缩出来的，真机 320 宽的机型（SE 一代）字体渲染不同，换行点会变。
- 风险：`skin-contrast` 现在有 22 条，都是"两两组合"的散点；没有覆盖"语义色压在 `--palm-sur-2`（浮层）上"这一档。
- 回退点：删掉新增的 describe。

### 下一步

把语义色 × 表面层（sur-1 / sur-2 / elevated）做成一张矩阵用例，而不是继续一条条补；这样以后新增表面层会自动被覆盖。
## 2026-11-10 切片 79：语义色 × 表面层矩阵 —— 顺带发现夜航的"半透明表面"

### 改了什么（先写测试，结果测试先炸了**

把散点用例收成一张矩阵：**4 个语义色 × 3 个表面 × 3 套皮肤 = 36 组**，全部要 ≥ 4.5；再加一条正文/次级/辅助文字的 4.5 / 4.5 / 3 分档检查。

```ts
const SURFACES = ['--palm-bg', '--palm-sur-1', '--palm-sur-2'] as const
const INKS = ['--palm-accent', '--palm-ok', '--palm-warn', '--palm-danger'] as const
```

石墨与纸色一次通过；**夜航三条全炸**。

### 炸出来的两件事

1. `skinPalette()` 的解析只认 6 位十六进制，而夜航的 `--palm-sur-2: #16203010` 是**八位（带 alpha）** —— 于是这个令牌根本没被解析出来，`palette['--palm-sur-2']` 是 `undefined`，`channels(undefined)` 直接抛错。
2. 更要紧的是第 2 点：**夜航浮层表面是"6% 半透明"**，不是实色。凡是量它上面的对比度，都必须先把它叠到页面底色上，否则数出来的全是错的。

两处都在测试辅助函数里修：解析器接受 8 位十六进制；表面色统一走 `over(solid(值, bg), bg)` 合成。

修完 **25/25 全绿**，且矩阵把"以后新增表面层会自动被覆盖"这件事落实了。

### 保留的能力

- 所有既有散点用例一条没删（淡底 4.5、断线带 7、裸字 4.5 都还在）；
- 没有改任何 CSS：这轮是**把已有的正确性钉住**，不是改设计。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `skin-contrast` 25/25（新增 6 条：3 皮肤 × 2 组） |
| `pnpm typecheck` / `pnpm build` | exit 0（无 CSS 改动） |
| `pnpm guard` / `pnpm test` | exit 0；**3,085 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **真机未测**：夜航的半透明表面在真机上会与「背景里的图片/动画」混色（比如开着的语音波形），此时对比度会低于矩阵算出的值。
- 风险：矩阵只覆盖 `bg / sur-1 / sur-2`，没有 `elevated`（浮层）与"卡片套卡片"的组合；夜航叠两层半透明表面时颜色会明显偏亮，还没量过。
- 回退点：删掉这 6 条用例，辅助函数里的 8 位解析保留也无害。

### 下一步

给夜航的"两层半透明表面叠加"补一条用例（卡片里的卡片），并量一次真实的叠加色；若叠出来的底色发灰，考虑把 `--palm-sur-2` 改成不透明。
## 2026-11-10 切片 80：夜航的"卡片里的卡片"是看不见的

### 审查（量出来的，不是看出来的）

上一片发现夜航的表面是半透明的，于是把"两层叠起来到底什么样"算了一遍：

| 皮肤 | 页面底 | 第 1 层 | 第 2 层 | 层间距 |
|---|---|---|---|---|
| 石墨 | `#101015` | `#15151c` | `#1c1c25` | **1.075** |
| 纸色 | `#faf8f4` | `#ffffff` | `#f2eee7` | **1.156** |
| 夜航 | `#080c14` | `#0f1520` | `#0f1621` | **1.006** |

夜航的第二层与第一层只差 **1.006:1** —— 卡片里再套一层（浮层、引用条、内嵌面板）**肉眼看不出来**，界面直接"糊成一片"。原因不只是 6% 的 alpha：`--palm-sur-2` 的基色 `#162030` 本身就与页面底色太近，把 alpha 提到 25% 也只到 1.025。

### 改了什么

```css
/* 夜航 */
--palm-sur-2: #16203010;   /* 6% 半透明，层间距 1.006 */
--palm-sur-2: #161f2e;      /* 不透明，层间距 1.105 */
```

取不透明而非"加大 alpha"，理由有二：

1. 半透明表面的实际颜色取决于**底下是什么**（底色、图片、动画），层间距无法保证；
2. 卡片套卡片时，两层透明度会相互叠加，颜色越叠越偏。

![左：夜航（改后）右：石墨 —— 内层浮层现在看得出来](C:\Users\Administrator\.dsh\screenshots\v2-surface-stack.png)

### 保留的能力

夜航整体仍是"深蓝黑 + 冷调"，只把第二层的明度提了一档；`--palm-sur-1`、页面底色、语义色一个没动。

### 先红后绿

新增契约"任何皮肤的第二层表面与第一层至少差 **1.07:1**"——石墨 1.075、纸色 1.156 通过，**夜航 1.006 红**；改完 28/28 全绿。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `skin-contrast` 28/28（新增 3 条）、`tokens-golden` 3/3（更新基线） |
| 视觉（组件级，夜航 vs 石墨） | `v2-surface-stack.png`（已归档） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 163.19 kB（hash `58884a50`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,088 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **整屏与真机未测**：夜航所有用到第二层表面的屏（抽屉、浮层、引用条）都受这次改色影响，只拍了一张"卡片套卡片"的构造图，**没有逐屏复看**。
- 风险：不透明表面会盖住底下的图片（若某处用第二层表面压在图片上做毛玻璃效果，这次改动会让它变成实色）—— 需要下一轮把夜航的主要屏扫一遍。
- 回退点：`--palm-sur-2` 改回 `#16203010`，契约改成"夜航允许 1.006"（不建议）。

### 下一步

夜航全屏扫一遍（聊天 / 抽屉 / 审批 / 产物），确认没有哪处依赖"半透明浮层压在图片上"的效果。
## 2026-11-10 切片 81：夜航扫屏扫出两处"看得见但没用"的样式

### 一、输入区挂着一个永远看不见的模糊

```css
.chat-composer {
  background: var(--palm-bg);        /* 不透明 */
  -webkit-backdrop-filter: blur(20px);   /* ← 模糊的是它自己 */
  backdrop-filter: blur(20px);
}
```

`backdrop-filter` 模糊的是**背后**的内容；底色完全不透明，背后什么都没有，所以这 20px 只换来真机上的 GPU 开销。删掉。输入区本来也不该透出后面的聊天内容 —— 打字时背景在动会干扰。

### 二、灯箱遮罩在组件里写死裸色

`.lightbox-backdrop` 写的是 `rgba(0, 0, 0, 0.86)`，而角标那档已经有 `--palm-scrim`（55%）。同一族的两档，应该都在令牌里：

```css
--palm-scrim: rgba(0, 0, 0, 0.55);          /* 压在照片上的小控件 */
--palm-scrim-strong: rgba(0, 0, 0, 0.86);   /* 整屏压暗：灯箱、预览 */
```

![夜航 / 纸色：灯箱遮罩观感不变](C:\Users\Administrator\.dsh\screenshots\v2-lightbox-scrim.png)

遮罩值没变，所以截图与改前**本应一致** —— 这正是"纯重构"该有的样子。

### 保留的能力

灯箱的层级、点遮罩关闭、图片自适应、角标对比 —— 都不动；只是把颜色从组件搬进令牌。

### 先红后绿

两条契约先红：①`.chat-composer` 不许出现 `backdrop-filter`（全表也不许，防止别处再挂）；②`.lightbox-backdrop` 必须用 `--palm-scrim-strong` 且不写裸 `rgba`。改完 **169/169** 绿，`tokens-golden` 更新后 3/3。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 169/169（新增 2 条）、`tokens-golden` 3/3 |
| 视觉（夜航 / 纸色） | `v2-lightbox-scrim.png`（已归档） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 163.17 kB（hash `b0184250`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,090 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **真机未测**：删掉 blur 后输入区滚动的"跟手感"没有变化是**推断**（不透明底本来就看不到模糊），没在真机上对比帧率。
- 风险：若将来有人把输入区改成"半透明玻璃"，这条契约会拦住他 —— 那是**故意的**：得先决定要不要透出内容。
- 回退点：两行 blur 加回去、遮罩改回裸 rgba。

### 下一步

夜航其余屏（聊天 / 抽屉 / 审批 / 产物）还没在"第二层表面改成不透明"之后逐屏复看，下一轮补。
## 2026-11-10 切片 82：夜航逐屏复看（改表面之后没坏，而且更清楚了）

上一片把夜航的 `--palm-sur-2` 从 6% 半透明改成不透明 `#161f2e`，会影响所有用第二层表面的屏。这轮逐屏复看：

![左：聊天消息流 右：会话抽屉（夜航）](C:\Users\Administrator\.dsh\screenshots\v2-nocturne-sweep.png)

![左：产物列表 右：聊天消息流（夜航）](C:\Users\Administrator\.dsh\screenshots\v2-nocturne-artifacts.png)

| 屏 | 结论 |
|---|---|
| 聊天消息流 | 工具块、完成条、思考条的层次都对；正文淡蓝压深底，读起来不累 |
| 会话抽屉 | 新建会话按钮（青）、搜索框、会话行、底部三项入口，层级清楚；**选中行**的青色描边在改后更显眼 |
| 产物列表 | **最受益的一屏**：文件行原来几乎是"贴"在页面底上，现在有明显的面板色，行与行之间的分隔也终于看得出来 |

没有发现"毛玻璃变成实色"这类副作用 —— 全仓只有输入区用过 `backdrop-filter`，而它上一片已经被删掉（本来就无效）。

### 保留的能力

三屏的功能、分组、徽章、描边、滚动行为都没动；这轮**零代码改动**。

### 验证

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` / `pnpm guard` / `pnpm test` | exit 0；**3,090 passed**、1 expected fail、10 skipped |
| 视觉（夜航三屏） | 两张并排图已归档 `docs/screenshots/` |

### 未测 / 风险

- **真机未测**：夜航在 OLED 上"近黑分层"的实际观感（会不会因为不透明表面反而显得发灰）没验；截图是在 LCD 模拟色域里取的。
- 风险：`#161f2e` 是手调的中间值；若以后夜航换主色，第二层需要跟着重算 —— 目前只有一条 1.07 的下限护栏，没有"跟随主色"的机制。
- 回退点：`--palm-sur-2` 改回 `#16203010`。

### 下一步

给夜航的"第二层表面"加一条派生关系（从 `--palm-sur-1` 用 `color-mix` 提亮 X%），而不是继续手调常量；同时确认这与"不许高优先级覆盖"的规则不冲突。
## 2026-11-10 切片 83：审批页的命令，得横着拖才看得全

### 审查（先看真页面，再说问题）

![审批页双皮肤（改前）](C:\Users\Administrator\.dsh\screenshots\v2-approval-skins.png)

`cd packages/dsh-palm && pnpm test && pnpm build && p…` —— 命令在「&& p」处被**右边缘切掉**。查样式：

```css
.approval-detail-code {
  white-space: pre;
  overflow-x: auto;      /* 块内横向滚动 */
}
```

内容确实"可达"（能横拖），但两个问题：

1. **手机上横向拖一张卡片里的代码**是反直觉的：用户会以为命令就这么长，直接按「按住 1.5 秒批准」；
2. **同一个应用里两种读法** —— 聊天卡片里的同一条命令是换行读的（`.chat-approval-preview`），审批页却要求横拖。

### 改了什么

```css
.approval-detail-code, .approval-detail-args {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-block-size: calc(var(--palm-t-s) * 1.4 * 10);   /* 十行封顶 */
  overflow-y: auto;                                   /* 超出就在块内竖滚 */
  overscroll-behavior: contain;
}
```

顺手把聊天卡片里那个"两行硬切"（`-webkit-line-clamp: 2`）也改成同样的"限高 + 竖滚"，两处终于一种读法。

![审批页：命令两行读完，不再被切](C:\Users\Administrator\.dsh\screenshots\v2-approval-wrap.png)

### 保留的能力

「原始参数」切换按钮、`data-fade` 渐隐提示、宽度上限（切换按钮永远看得见）、`按住 1.5 秒` 与键盘可达性 —— 都没动。

### 先红后绿

- 新契约（换行 + 限高 + 竖向滚动）先红 → 改完绿；
- **一条老用例红了**：`命令块有 100% 宽度上限并在块内横滚…` 是切片 7 定下的取舍。这次是**有意改判**，把用例改成新口径并写明原因，而不是删掉它。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 171/171（新增 2 条、改判 1 条） |
| 视觉（组件级，双皮肤） | `v2-approval-skins.png`（改前）、`v2-approval-wrap.png`（改后） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 163.28 kB（hash `1e72175f`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,092 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **真机未测**：命令块里的竖向滚动会不会在弹层里"滚动穿透"到外页，没验（已加 `overscroll-behavior: contain`，但 iOS 上不总是生效）。
- 风险：`max-block-size` 用的是 `calc(var(--palm-t-s) * 1.4 * 10)`，字号若被系统放大，块高会跟着长 —— 这是有意的，但极端字号下仍可能顶出屏幕。
- 回退点：两处改回 `white-space: pre` + `overflow-x: auto` / `-webkit-line-clamp: 2`，用例同步。

### 下一步

把「原始参数」这个按钮名改掉 —— 它切换的是**工具参数**，但用户看到的是一行被截断的命令，很容易以为按它能看全命令；真正的"看全命令"现在是自动的，按钮名应说明它是参数。
## 2026-11-10 切片 84：「原始参数」这个名字会骗人

### 审查

上一片把命令改成自动换行读全之后，命令块右边那颗按钮就只剩一个职责：**展开工具参数（args JSON）**。可它叫「原始参数」——

- 用户看到的是一行刚被截断过的命令（上一片之前）；
- 按钮挨着命令块，名字里又有"参数"两个字；
- 于是一定有人以为按它能看全命令。

同一个位置在另一处（审批页的另一个渲染分支）还叫「展开完整参数」，**更像"看全命令"**。

### 改了什么

两处统一成：

```tsx
{expanded ? '收起参数' : '查看参数'}
```

三个字说清"看的是参数"，不再暗示"看全命令"。

![双皮肤：「查看参数」按钮 + 命令两行读全](C:\Users\Administrator\.dsh\screenshots\v2-approval-label.png)

### 保留的能力

展开/收起、`aria-expanded`、参数 8 KB 截断、键盘可达 —— 都没动。

### 先红后绿

- 新契约（按钮叫「查看参数」、不许再出现「原始参数」）先红后绿；
- 两条既有用例同步改：`ApprovalView.test.tsx` 与 `sheets.test.tsx` 里按名字点按钮的地方；
- 中途踩了个坑：`argsText` 是 `ApprovalView` 的**顶层 prop**，不是 `approval` 里的字段，写在 `approval({...})` 里按钮根本不出现 —— 断言失败才发现。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `ApprovalView` + `sheets` 28/28 |
| 视觉（双皮肤） | `v2-approval-label.png` —— **注意**：这张是静态落盘页面把按钮文字替换后截的（DOM 结构与真组件一致，只是文案），不是新渲染 |
| `pnpm typecheck` / `pnpm build` | exit 0（仅文案改动，`app.css` 未变） |
| `pnpm guard` / `pnpm test` | exit 0；**3,093 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **未做真渲染截图**：文案改动应该无布局影响，但严格说这张图不是组件新渲染出来的。
- 风险：三字按钮在 320px 下会不会挤到「待批准」那一行（该行是 flex，可能换行），没拍 320。
- 回退点：两个三元表达式改回旧文案，两处用例同步。

### 下一步

补一张 320px 的审批页（`待批准` 行 + 查看参数 + 命令块），确认窄屏下这一行不塌。
## 2026-11-10 切片 85：审批页真渲染 + 320 窄屏（补上上一片欠的验证）

上一片那张图是"静态落盘 + 替换文案"，严格说不算渲染验证。这轮用**真组件**重新落盘：临时写一个 dump 用例（跑完即删），`render(<ApprovalView … argsText=… />)` 后把 `container.innerHTML` 写出来，再套三种尺寸。

![真渲染：390 深色 / 390 纸色 / 320 深色](C:\Users\Administrator\.dsh\screenshots\v2-approval-real320.png)

| 位置 | 320 下的表现 |
|---|---|
| 「待批准 … 查看参数」行 | 两段不挤，按钮不换行掉下去 |
| 命令块 | 折成两行读完：`cd packages/dsh-palm && pnpm test &&` / `pnpm build && pnpm guard` |
| 警示条 | 折两行，黄框完整包住 |
| 两个按钮 | 并排放下，不用横滚 |
| 脚注 | 一行放得下 |

**没有发现需要改的地方** —— 上一片改的两处（换行读、按钮改名）在 320 下都成立。

### 保留的能力

无代码改动。这轮只是**换了一种更硬的证据**：从"文案替换后的静态页面"升级为"组件真实渲染"。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | 临时 dump 用例执行通过后**已删除**（`src/mobile/dev/approval-dump.test.tsx` 不存在于工作树） |
| 视觉（真渲染 × 3 尺寸） | `v2-approval-real320.png`（已归档） |
| `pnpm typecheck` / `pnpm build` / `pnpm guard` / `pnpm test` | 全 exit 0；**3,093 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **仍然不是真机**：浏览器里 320 是"窗口宽度 320"，不是真机 320pt 的字体渲染；iOS 会给中文正文字号下限做微调，换行点可能不同。
- 风险：三栏并排图里第三栏被裁到 640 高，长命令 + 展开参数后的滚动区在 320 下没拍。
- 回退点：无需回退（无代码改动）。

### 下一步

把这次的做法固化成工具：`scripts/dump-screen.mjs` 接受"组件名 + props 场景"，直接产出可截图的 HTML，省掉每次手写临时用例再删的步骤（注意：它不能进测试套件的默认运行）。
## 2026-11-10 切片 86：搜索命中的高亮，在 iOS 15 上是**没有底色**的

### 顺带补的证据：配对页三配置

![配对页：纸色 / 石墨 / 320 宽](C:\Users\Administrator\.dsh\screenshots\v2-pair-320.png)

配对页（无权限入口）在纸色、石墨、320 三种配置下都成立：卡片居中、两行标签 + 输入框、错误行变红、按钮 44px 高。**不用改**。

### 审查：`color-mix()` 的全仓盘点

```
$ grep -c 'color-mix(' src/mobile/styles/*.css   → 21 处
$ grep -c '@supports'                            → 0 处
```

`color-mix()` 要 **Safari 16.2**。iOS 15 上这些声明**整条失效**，属性回退到上一条或初始值。最要命的一处：

```css
.mobile .chat-search-mark {
  background: color-mix(in srgb, var(--accent) 26%, var(--bg-elevated));
}
```

这是**搜索命中的高亮**。iOS 15 上它没有底色 —— 用户搜到会话、跳到命中位置，却看不见命中在哪。而"搜索结果定位"是这次改造要保留的能力之一。

### 改了什么

把"混色"从运行时挪到**令牌里预混**：

```css
/* 石墨 / 纸色 / 夜航 各一份 */
--palm-search-mark: #303457;   /* accent 26% 混在浮层底上 */
--palm-search-mark: #e1d4c8;
--palm-search-mark: #144656;
```

```css
.mobile .chat-search-mark { background: var(--palm-search-mark); }
```

![三皮肤：命中词都有底色](C:\Users\Administrator\.dsh\screenshots\v2-search-mark.png)

### 保留的能力

底色深浅、圆角、`mark` 的加粗、用户气泡里的反相规则、代码块里的压色规则 —— 全不变；只是把"算颜色"从浏览器挪到构建期。

### 先红后绿

- 三条令牌用例 + 一条"不许写 color-mix"用例先红后绿；
- **冻结清单**（12 处 color-mix 的技术债棘轮）同步把 `.mobile .chat-search-mark` 删掉 —— 那条用例的规矩就是"修掉一个就从清单里删掉"；
- 期间 `pnpm test` 报 `src/mobile: 60829 > 60820`：新增 3 条令牌把行数顶过预算。**没有立刻去改预算**，先确认生成物已重建；重建后回到预算内，预算未动（保持 60820 的压力）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 175/175（新增 4 条）、`tokens-golden` 3/3 |
| 视觉（三皮肤） | `v2-search-mark.png`、`v2-pair-320.png`（已归档） |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 163.33 kB（hash `3ca460f0`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,097 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **iOS 15 真机未测**：这是"按 CSS 支持表推断"的修复；本轮只证明"不再依赖 color-mix"，没有在 iOS 15 上跑过。
- 风险：剩下 **20 处** color-mix 仍在冻结清单里。其中 `070-card.css` 的按压底色、`390-think-blocks.css` 的思考块描边，在 iOS 15 上会**退化成没有按压反馈 / 没有描边**（不会白屏，但会"少一点"）。下一轮按"是否会掉功能"排序继续清。
- 回退点：令牌删掉，`.chat-search-mark` 改回 color-mix，冻结清单加回那一条。

### 下一步

按"掉功能 vs 掉装饰"给剩余 20 处排序：先清掉会让交互反馈消失的（按压态、焦点环），装饰性的（渐变描边）留到后面或包 `@supports`。
## 2026-11-10 切片 87：把"会变透明"的 7 处 color-mix 全部清空

上一片把"命中高亮"从 color-mix 换成令牌后，冻结清单里还剩 7 处同类问题：**这些块的 background 只有 color-mix 一条**，iOS 15 上整块变透明。

| 选择器 | 丢了会怎样 |
|---|---|
| `.chat-stop-mini-armed` | 「再点一次就停」的**红底消失** —— 停止按钮看不出已经上膛 |
| `.chat-risk-exec` | 执行命令的**风险描边消失** |
| `.approval-detail-approve` | 已批准态的绿底消失 |
| `.palm-dd-badge` / `.device-badge-primary` / `.chat-command-chip` | 徽章/chip 变成透明片，看不出边界 |
| `.turn-scrub-loaded` | 回合进度条上看不出哪几段已读过 |
| `.mobile-row:active` | 按压没有任何反馈 |
| `.outline-node-row[aria-current]` | 大纲里"我在哪一行"没有标记 |

### 改了什么

新增 6 个**预混令牌**（每皮肤一份，值在构建期算好）：

```
--palm-press-bg      fg 5% 叠在卡片上        （按压）
--palm-danger-band   danger 22%               （上膛的停止键）
--palm-danger-line   danger 55%               （风险描边）
--palm-ok-band       ok 17%                   （批准态 / 徽章）
--palm-accent-line   accent 48%               （当前行 / 加载环）
--palm-accent-16     accent 16%               （chip / 设备徽章）
```

`.turn-scrub-loaded` 直接复用已有的 `--palm-search-mark`（同为 accent 26% 预混）。

改完把冻结清单**清空**：

```ts
// 2026-11-10 清空：7 处全部改成预混令牌，不再依赖 color-mix。
const KNOWN: string[] = []
```

清单为空之后，这条用例的意义从"棘轮"变成"**再出现就红**"——新增任何"只有 color-mix 的 background"都会被拦住。

![大纲当前行：深/浅两套都有标记](C:\Users\Administrator\.dsh\screenshots\v2-outline-current.png)

### 保留的能力

- 所有颜色观感不变（预混值与运行时混色同值，误差 ≤ 1/255）；
- 按压、上膛、风险、已批准、当前行、已读段 —— 这些**状态语义**从"依赖新语法"变成"依赖令牌"；
- `@supports` 一处没加（不需要了）。

### 先红后绿

- 先清空清单 → 用例红（7 个选择器）；
- 写令牌 + 替换 → 绿（175/175）；
- 中途踩坑：改完 CSS 直接跑测试**还是红** —— 因为测试读的是 `mobile-styles.ts`（生成物），必须先 `gen-mobile-css.mjs`。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `structure` 175/175、`tokens-golden` 3/3、`skin-contrast` 28/28 |
| 视觉（双皮肤） | `v2-outline-current.png` |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 163.41 kB（hash `ef63464f`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,097 passed**、1 expected fail、10 skipped |

### 未测 / 风险

- **iOS 15 真机仍未测**：全部结论来自"不再依赖 color-mix"这一事实。
- 风险：**剩下 8 处**是 box-shadow 焦点环 / 虚线 / 轴线 / 光晕 —— 掉了只是"少一圈光"，不改变功能；但它们仍然是"新语法依赖"。`--accent-glow` 是令牌层，影响面最广，下一轮单独处理。
- 风险 2：预混令牌把"表面色"与"语义色"耦合了。若某处把 `--palm-danger-band` 放在非 `sur-1` 的底上，色值就不再精确（例如浮层 `sur-2`）。目前 7 处都在卡片/行上，成立。
- 回退点：`git diff` 里 6 个令牌 + 10 处声明；冻结清单恢复 7 条即可回到旧状态。

### 下一步

处理 `--accent-glow`（令牌层，被多处引用）：要么给每皮肤预混一份，要么把它降级成 `--palm-accent` 的低透明度 8 位十六进制（Safari 10 就支持），后者成本更低。
## 2026-11-10 切片 89：原语层落地 —— 四个组合件 + 只许用令牌的样式

用户要求「重新设计整个 UI 界面和相关组件」，效果图已出（`v2-redesign-chat-dark.png` / `-paper.png`）。这一片是**动手的第一刀**：先把"每个页面自己拼一套"的地方收成组件。

### 之前是什么样

`ui/primitives.tsx` 里只有零件（Button / Chip / Badge / StatusDot / Card / ListRow / Skeleton / EmptyState）。于是"区块标题行 + 卡片 + 结果行 + 两个按钮"这四种结构，在通知、产物、审批、设置里**各写了一遍**，圆角与间距自然对不齐。

### 新增四个组合件

| 组件 | 收掉的重复 |
|---|---|
| `SectionHeader` | 标题 + 右侧提示/动作（原来每页自己 `div + span`） |
| `SectionCard` | 卡片外壳（`data-level='surface' \| 'raised'` 两级表面），标题栏自动带上 |
| `ResultRow` | 文件名 + `+42` / `−8` + 右侧动作，把三个 chip 收成一行 |
| `ActionBar` | 主操作（1.4 份宽、实心强调色）+ 次操作（1 份、描边） |

组合件**不接受 style、不接受颜色参数** —— 要换外观先改令牌。这条写进了注释和用例。

![四个组合件 × 三套皮肤（石墨 / 纸色 / 夜航）](C:\Users\Administrator\.dsh\screenshots\v2-primitives.png)

### 样式：`styles/560-system.css`，只许令牌

- 颜色只有 `--palm-*`；`border-radius` 只许 `--palm-r-*`；`border` 宽度只许 `--palm-hair`；
- 触控高度统一 `--palm-hit`（44px）；
- 主操作实心 `--palm-accent` + `--palm-on-accent`，禁用态 `--palm-btn-disabled-opacity`。

### 先红后绿

- 7 条组件契约先红（组件还不存在，`Element type is invalid`）→ 实现后绿；
- 13 条 CSS 契约先红 → 修两处后绿（`--palm-t-xs` 这个令牌**不存在**，改成 `--palm-t-s`；`border: 0` 被"不许字面量边框"的规则误伤，规则改成只拦非 0 的数字）；
- 顺手补了"主操作必须是实心强调色 + on-accent"的断言 —— 这条是效果图里最关键的层级差别，不能只靠人看。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `primitives.system` 7/7、`structure` 190/190 |
| 视觉（三皮肤） | `v2-primitives.png` |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 165.18 kB（hash `75f164e3`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,119 passed**、1 expected fail、10 skipped |

预算变动（都写明了原因）：`src/mobile` 60860 → **61120**、`src/mobile/ui` 2250 → **2420**、`cssClasses` 778 → **800**。第一次跑是**三处一起红**，没有只调一个掩盖。

### 未测 / 风险

- **还没有任何真实屏用它**：这一片只证明"组件可用 + 样式合规"，聊天页/通知页仍是旧写法。下一片才换。
- **真机未测**：44px 命中区、1.4:1 的按钮宽度比在 320 下的表现只在浏览器里看过。
- 风险：四个组合件与旧的 `.settings-card` / `.chat-approval-panel` 并存，短期内会有两套外观同时出现 —— 必须在接下来 2~3 片内把旧屏换完，否则就是"第二套组件样式"。
- 回退点：删 `560-system.css` + 四个组件 + 两个用例；三个预算改回原值。

### 下一步

拿**通知页**当第一个真实消费者（结构最简单、已有专项测试）：三张卡换成 `SectionCard`，标题行换 `SectionHeader`，并把 `.settings-card` 的旧规则删掉 —— 只留一套。
## 2026-11-10 切片 90–91：过程条重新设计（用户点名要改的那一条）

### 改前

「▸ 4 次工具调用」是一行裸灰字，既不像能点、也没有状态——和下面的正文糊在一起。

### 改成什么

一条**窄条**：左边状态点、中间文字、右边箭头；可点与静态两种外观一致。

```
[●] 4 次工具调用  [2 处报错]                    ▸
[●] 12 次工具调用
     最近：改 b.ts · 跑测试 · 改 c.ts          ▾
```

![过程条 · 纸色](C:\Users\Administrator\.dsh\screenshots\v2-proc-strip-paper.png)

![过程条 · 石墨](C:\Users\Administrator\.dsh\screenshots\v2-proc-strip-dark.png)

| 元素 | 规则 |
|---|---|
| 状态点 | 7px，颜色由 `data-state`：ok 绿 / running 强调 / failed 红 / stopped 琥珀 / 未知灰。**只做强化**，含义由文字与 `aria-label` 给 |
| 报错 | 「2 处报错」从裸黄字改成**黄底小胶囊**（`--palm-tint-warn`）—— 这是要人注意的信息，得有自己的底 |
| 箭头 | 从最左挪到**最右**（`margin-inline-start: auto`）。左边放箭头会和列表符号混 |
| 外壳 | `--palm-sur-1` + hairline + `--palm-r-s`，可点高度仍 `--palm-hit`（44px） |
| 运行中 | 「最近 3 步」占满第二行（`flex-basis: 100%`），不挤占点击区 |

### 顺带：回合目标行重新立起来

上一版把目标行降成灰字次级，结果**整屏看不出这段属于哪一轮**。现在给它左侧强调竖条 + 正文色 + 加粗；**字号不动**（仍 13px），所以不会变回"第二个标题"。

### 保留的能力

展开/收起（受控 `aria-expanded`）、静态行不假装可点、只报计数不报状态词与耗时、44px 触控、读屏文案，全不变。

### 先红后绿

- 组件测试先跑：过程行的 5 条断言（`▸/▾`、`.palm-proc-main`、`.palm-proc-note`、`.palm-proc-recent`、静态行无 button）全部保留并绿；
- **两条按旧外观写的契约红了**（`mobile-styles.structure` 与 `turn-header` 里的"目标行是灰字次级"），改成新口径并写明改判原因；
- **行为指纹 golden 红了**：`chat-trace.json` 的 DOM 变了（多了一个点、箭头换位），确认是有意改动后 `UPDATE_TRACE=1` 重建（3 行变更）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `ui` + `structure` 326/326、`ChatView` 243/243 |
| 视觉（双皮肤） | `v2-proc-strip-paper.png`、`v2-proc-strip-dark.png` |
| `pnpm typecheck` / `pnpm build` | exit 0；`app.css` 165.89 kB（hash `58f6359a`） |
| `pnpm guard` / `pnpm test` | exit 0；**3,119 passed**、1 expected fail、10 skipped |
| 真机 | 服务端已发 `app.css?v=58f6359a`；手机刷新即见 |

### 未测 / 风险

- **真机未测**：44px 触控带 + 7px 点在小屏上的观感没在手机上验；箭头在最右时若文字很长会不会挤掉箭头，没测。
- 风险：状态点用颜色区分 running/ok —— 色盲用户在**这一条**上只能靠"有没有报错胶囊"判断；好在状态词本来就在任务头状态条里。
- 风险：`data-state='unknown'` 的静态行现在也有了卡片外壳，若某处用它当占位（骨架）会多出一个框。
- 回退点：`process-line.tsx` 的 content 顺序 + `.palm-proc` 三条声明；golden 用 `UPDATE_TRACE=1` 重建回旧指纹。

### 下一步

把「报错胶囊」扩成**可点跳转**（跳到第一个报错步骤），并把 `.palm-proc` 的窄条做法用到工具调用列表头部，保持同一套"段头"语言。
## 2026-11-10 切片 92：过程条动效 A+B+D（用户从四个方案里选的）

### 做了什么

| 方案 | 落地 |
|---|---|
| A 呼吸点 + 流光进度线 | 运行中状态点 `palm-proc-breathe`（1.6s，只动 opacity 与 box-shadow）；底边 2px 进度线按步数增长，`data-live` 时叠一道 2.4s 扫过的高光 |
| B 步骤点阵 | 一格 = 一次工具调用：走完 `--palm-ok`、当前 `--palm-accent` 脉冲、未走 `--palm-line`；超过 12 格收成「+N」 |
| D 展开逐行滑入 | `.chat-proc-open .chat-step` 每 60ms 一档 `translateY(4px)+opacity` 入场 |

![过程条动效 · 石墨](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v8-proc-abd-dark.png)

![过程条动效 · 纸色](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v8-proc-abd-paper.png)

### 数据从哪来（不许编）

- `total` = 这一轮的工具调用数（`model.toolCount`）；
- `done` = 这些工具行里 **state 不再是 running** 的条数；
- 两者都拿不到（关掉"显示工具调用"、或本轮没有工具）→ **点阵与进度线整块不渲染**，退回原来的一行文字。

### 三条自我约束（写进注释，也有用例兜）

1. 只动 `transform` / `opacity` / `box-shadow`，不动宽高 —— 不触发重排；
2. 动效**只在 running 出现**：完成时进度线定格、扫光消失（`data-live` 只在 running 时给，有用例）；
3. 减弱动效：**装饰**（扫光、点阵脉冲、展开滑入、进度过渡）登记进 `360-reduced-motion.css`；**状态表达**（运行中呼吸点）进白名单 —— 停掉它，用户就分不清"还在跑"和"卡住"。

### 先红后绿

- 4 条新契约（8 格/5 格走完、>12 收 +N、不传 steps 不渲染、跑完不扫光）先红后绿；
- 结构门红了三次，都是真问题：① 组件私有变量 `--palm-proc-progress` 没定义 → 在 `.palm-proc` 给默认值；② 新 animation 没登记 → 补进 360 的减弱动效列表 + 白名单；③ CSS 注释里写了反引号，把生成的模板串打断 → 去掉反引号。
- 预算：`src/mobile` 61120 → **61340**、`src/mobile/ui` 2420 → **2560**（动效 CSS 与点阵渲染）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `process-line` 9/9、`structure` 195/195 |
| 视觉 | 石墨 / 纸色双皮肤截图（本轮） |
| typecheck / build | exit 0；`app.css` 167.94 kB（hash `585a85f8`） |
| guard / test | exit 0；**3,123 passed**、1 expected fail、10 skipped |
| 公网路径 | `https://123-56-228-146.nip.io:7001/m/` 已发 `app.css?v=585a85f8` |

### 未测 / 风险

- **真机未测**：呼吸节奏（1.6s）与扫光（2.4s）在 60Hz 手机上的观感、以及"12 格 + 文字"在 320 宽下会不会换行，都没验；
- 风险：点阵按"工具调用"计数，用户可能读成"计划步骤数"，两者在本轮里可能不等（例如一步里跑了两个命令）；
- 风险：`box-shadow` 呼吸在低端机上比纯 opacity 贵一点，若真机掉帧就只留 opacity；
- 回退点：`process-line.tsx` 的 dots/track 两段 JSX + `370-v21.css` 末尾动效块 + `360-reduced-motion.css` 的四行登记。

### 下一步

把报错胶囊做成可点跳转；再按 D 的思路给工具行加"进入时高亮一次"，让"刚跑完的那一步"有落点。
## 2026-11-10 切片 93：状态条重做 —— 鲸尾 + 「深度求索中」

用户给的参照是 DSH 桌面端的鲸尾标识。这一片把状态条从「11 张宠物脸 + 整条深色渐变」换成「一枚鲸尾 + 底边潮汐线」。

![状态条 · 石墨](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v11-whale-strip-dark.png)

![状态条 · 纸色](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v11-whale-strip-paper.png)

### 改了什么

| | 改前 | 改后 |
|---|---|---|
| 标识 | 11 张手绘表情脸（18px，小尺寸下糊成一团） | **一枚鲸尾**（内联 SVG）+ 24×24 圆角方标，底色按状态分派 |
| 填色 | 整条深色渐变（一屏最亮的东西是状态条） | **底边 3px 潮汐线**（accent→ok），保留 5% 档位宽度 |
| 文字 | 白字压在渐变上（纸色皮肤上也是黑条） | 跟皮肤走：`--palm-strip-fg` = `--palm-fg` |
| 动效 | 游走块 | 运行态鲸尾 2.2s 轻摆（状态表达，进减弱动效白名单） |

### 一处真 bug（截图抓到的）

纸色皮肤下整条是**黑底黑字** —— `--palm-strip-track` 只在 `:root` 定义过一次深色值，纸色/夜航从来没覆盖。以前整条被渐变填满所以看不出来，我把填充改成底边线之后它就露出来了。修法：在 `000-tokens.css` 的 paper / nocturne 块里各补一行 track 与 border。

### 先红后绿

- 「每种状态的表情形状不同」这条契约**有意改判**：现在形状只有一种，识别交给底色，改成「11 种状态各有一档底色 + `data-mark="whale"`」；
- 鲸尾摆动是 animation，按项目约定登记进减弱动效白名单（和 spinner 同类）；
- 令牌基线（tokens-golden）因新增两行皮肤令牌而更新，`PALM_UPDATE_TOKENS=1` 显式重建。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `status-strip` 全绿、`structure` 195/195、`tokens-golden` 3/3 |
| 视觉 | 石墨 / 纸色双皮肤（本轮截图） |
| typecheck / build / guard / test | 全 exit 0；`app.css` 169.75 kB（hash `54f1d42b`）；**3,123 passed** |

### 未测 / 风险

- **鲸尾是手绘简化版**，不是 DeepSeek 官方素材；上线前应换成官方 SVG（只改一个 `d` 常量）。
- **「深度求索中」目前只出现在 mock 与文案建议里**：真实主文案仍由各调用方传入（「运行中」「读文件」…），要不要全改叫「深度求索中」还没拍板。
- 真机未测：24px 方标在 28px 条里的上下留白、纸色下鲸尾的对比度（偏淡）。
- 回退点：`status-strip.tsx` 的 `WHALE_TAIL`/`WhaleMark` 两个常量 + `370-v21.css` 末尾状态条块 + `000-tokens.css` 两行皮肤令牌。
## 2026-11-10 切片 94：状态栏改「平铺一行」（用户口径第三版）

用户原话：「做成桌面端 DSH 那种，**不要状态条和滑动条，只有一个状态栏，平铺显示**。」

![平铺状态栏 · 石墨](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v12-flat-dark.png)

![平铺状态栏 · 纸色](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v12-flat-paper.png)

### 从"胶囊"到"一行"

| 元素 | 上一版 | 这一版 |
|---|---|---|
| 外框 | 28px 胶囊（底色 + 描边 + 圆角） | **无外框**：平铺一行，靠留白与正文分开 |
| 进度 | 底边 3px 潮汐线 + 20 档宽度 | **没有**（进度只由过程条的点阵表达） |
| 刻度轨 | 条下方一格一步 | **没有** |
| 内容 | 鲸尾 + 文案 + 副文案 + 时间 | 同上（信息不减，只是不再包在一个盒子里） |
| 抽屉迷你条 | 132×22 小胶囊 | 保持不变 |

### 连带删除（都是真死代码）

`--palm-strip-grad-*`(11)、`--palm-strip-ink-*`(11)、`--palm-strip-rail-*`(10)、`--palm-strip-track/border/gloss/pet-body/pet-shadow` 共 **40 个令牌**，以及 `.palm-strip-fill`（含 20 档宽度规则）、`.palm-strip-rail` 全部规则。`app.css` 从 169.75 kB 回落到 **163.19 kB**。

### 截图抓到的两个真问题

1. **纸色皮肤上一片灰糊** —— 平铺后没有深色底衬，原来的「白字 + 暗描影」失去依据。修法：`.palm-strip` 里把三档字色改挂皮肤前景令牌、描影置 `none`。
2. **`.palm-strip` 规则曾整段丢失** —— 我用行号切片删填充/刻度轨时把主规则一起切掉了，`structure` 用例立刻报「找不到规则」。这类行号手术以后一律先用测试兜住再删。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `status-strip` 9/9、`structure` 198/198、`skin-contrast` 9/9、`tokens-golden` 3/3 |
| 视觉 | 石墨 / 纸色双皮肤（本轮截图） |
| typecheck / build / guard / test | 全 exit 0；`app.css` 163.19 kB（hash `9a500358`）；**3,119 passed**、1 expected fail、10 skipped |
| 公网路径 | `https://123-56-228-146.nip.io:7001/m/` 已发 `app.css?v=9a500358` |

### 未测 / 风险

- **真机未测**：平铺行在 320 宽下"鲸尾 + 主文案 + 副文案 + 时间"会不会挤成两行；44px 触控区在纯文字行上是否还成立（外层仍是 `ListRow`，理论上撑到 `--palm-hit`）。
- 风险：进度完全由过程条表达，若某屏只有状态栏没有过程条（例如工具调用被关掉），用户就看不到"走到哪了"——这是这次取舍的代价。
- 回退点：`status-strip.tsx` 整个文件（已重写）、`370-v21.css` 的 `.palm-strip` 段、`000-tokens.css` 的 40 个令牌需从 git 历史恢复。
## 2026-11-10 切片 95：交付卡收窄 + 版面/字体盘点

用户反馈：「交付结果卡片太宽了，视觉上很占地方，改相对窄一点，检查一下各个版面，排版/字体也要对齐。」

![交付卡 · 改前（通栏 + 绿色渐变）](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v13-delivery-before.png)

![交付卡 · 改后（336px + 中性底）](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v13-delivery-after.png)

![交付卡 · 纸色](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v13-delivery-after-paper.png)

### 交付卡改了什么

| | 改前 | 改后 |
|---|---|---|
| 宽度 | 通栏（358px） | **min(100%, 336px)**：右边留白，320 屏自动退化成通栏 |
| 底色 | 绿色渐变（`--palm-flow-card-bg`） | 普通表面色 `--palm-sur-1` |
| 描边 | 绿色 22%（`--palm-flow-card-line`） | 中性 `--palm-line` |
| 圆角 | 14px | **12px**（与 `--palm-r-m`、其他卡片一致） |
| 卡头内边距 | 12/12/8 | **8/12**（与 `[data-section-card]` 同一档） |
| 分隔线 | `--palm-flow-rule`（5% 白） | `--palm-line`（与其他卡片同一条线） |

绿色只保留在勾（✓）与「交付物」标签上 —— 它是回执，不该和正文抢地盘。

### 版面/字体盘点（未改，留给下一片）

`styles/` 里还有 **91 处字面量 `font-size`**（没有走令牌），其中聊天相关 16 处：

| 文件 | 行 | 值 | 建议 |
|---|---|---|---|
| 230-approval.css | 30 / 133 | 12px（等宽命令块） | → `--palm-flow-row-size`(12.5) 或新增 `--palm-code-size` |
| 230-approval.css | 75 | 12.5px | → `--palm-flow-row-size` |
| 230-approval.css | 90 | 11.5px（标签） | → `--palm-flow-meta-size`(10.5) 或 `--palm-t-s` |
| 230-approval.css | 121 | 12px（按钮） | → `--palm-t-s` |
| 150-chat.css | 108 / 280 / 557 | 11px / 12px / 12px | → `--palm-t-s` 系列 |
| 390-think-blocks.css | 81 | 12px | → `--palm-t-s` |

**没有直接改**：这些值散落在五六个屏里，逐个替换会牵动未截图验证的版面；按项目规矩，一次只改一个可复查的切片，下一片专门做"字面量字号清零 + 每屏截图"。

### 验证

| 检查 | 结果 |
|---|---|
| typecheck / build / guard / test | 全 exit 0；`app.css` 163.30 kB（hash `93ceb4d6`）；**3,119 passed** |
| 视觉 | 改前/改后 + 纸色，三张截图（本轮） |

### 未测 / 风险

- **真机未测**：336px 在 320 宽屏上会退化成通栏（`min()` 生效），没有真机确认右边留白观感；
- 风险：卡变窄后，长文件名截断更早（`text-overflow: ellipsis` 已有），但"改 3 个文件"这种汇总行没测过换行；
- 回退点：`.palm-delivery` 一条规则（max-inline-size / background / border / radius）+ 卡头与分隔线两处颜色。
## 2026-11-10 切片 96：鲸尾换回 1.7.1 的逐帧动画 + 最新命令改成渐变

用户两句：「用 dsh palm 1.7.1 版本的鲸鱼尾动效」「过程条下方时不时冒出最新的一条处理命令，感觉跳来跳去，改成渐变渲染」。

![鲸尾 + 最新一步（石墨）](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v14-whale-proc-dark.png)

![鲸尾 + 最新一步（纸色）](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v14-whale-proc-paper.png)

### 一、鲸尾：手绘 SVG → 1.7.1 的动画 PNG

| | 上一版（我手绘） | 这一版（1.7.1 原样） |
|---|---|---|
| 形态 | 一条静态 `path`，靠 CSS 摆动 2.2s | **`/m/running-whale.png` 逐帧动画**，用 `currentColor` 做 alpha 蒙版染色 |
| 兜底 | 无 | 不支持 `mask-mode` 或开了「减弱动态效果」时，显示同轮廓的静态 SVG（`WHALE_REST_PATH`，1.7.1 原路径） |
| 代码来源 | 我画的简化尾鳍 | `git show v1.7.1:packages/dsh-palm/src/mobile/message-row.tsx`（路径与蒙版写法一并搬回） |

关键事实：1.7.1 里那句注释说得很清楚 —— 手写路径动画"试过整体旋转、拆成两片叶子、乃至用 SMIL 改路径数据，都还是两片叶在转"。这正是我上一版又踩的坑，所以这次直接搬实现，不再自己画。

顺带删掉了我加的 `@keyframes palm-strip-whale` 与白名单里的四条登记（动画交给 PNG 的帧，CSS 不再有 `animation:`）。

### 二、最新命令：第二行 → 单行固定槽位 + 交叉淡入淡出

| | 改前 | 改后 |
|---|---|---|
| 位置 | `flex-basis: 100%` 的**第二行**，条下方 | 行内右侧的**固定 15px 槽位** |
| 内容 | `最近：A · B · C`（三条拼接） | 只显示**最新一条** |
| 换文案 | 行高变化 → 整条过程条上下抖 | 高度锁死，旧文案淡出（−3px）+ 新文案淡入（+3px），320ms |
| 超长 | 撑宽换行 | `text-overflow: ellipsis` + 右侧 18% 渐隐蒙版 |

实现：`ProcessLine` 里用 `shownStep` / `leavingStep` 两个状态做交叉淡化，`setTimeout(320)` 清掉离场层；淡入淡出登记进 `360-reduced-motion.css`（减弱动效时直接切换，不位移）。

### 验证

| 检查 | 结果 |
|---|---|
| 专项 | `status-strip` 9/9、`process-line` 全绿、`structure` 189/189 |
| 视觉 | 石墨 / 纸色双皮肤（本轮截图，鲸尾是 PNG 蒙版渲染出来的真实形状） |
| typecheck / build / guard / test | 全 exit 0；`app.css` 164.16 kB（hash `f64084d3`）；**3,119 passed** |

### 未测 / 风险

- **PNG 动画只在真机上才看得出帧**：截图是静帧，只能确认形状与染色正确；帧率与流畅度需真机复核（1.7.1 已在真机跑过，风险低）。
- 风险：`mask-mode: alpha` 在旧版 iOS Safari 不支持 → 会退回静态 SVG（有意为之，不是 bug）。
- 风险：最新一条在窄屏（320）下与点阵挤在一起时可能只剩 3–4 个字；没做"太窄就省略"的真机验证。
- 回退点：`status-strip.tsx` 的 `WhaleMark` + `370-v21.css` 的 `.palm-strip-whale-*` 段；`process-line.tsx` 的交叉淡入淡出状态与 `.palm-proc-recent*` 规则。
## 2026-11-10 切片 97：交付卡再收窄（336 → 300）+ 卡尾不再拉满

用户第二次反馈：「交付物卡片还是依然太宽，尤其是最后『看全部改动』那部分，很宽。」

![卡尾 · 改前（按钮被推到最右）](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v15-dc-foot-before.png)

![卡尾 · 改后（连排 + 卡片 300px）](C:\Users\Administrator\dsh-source\dsh-palm\docs\screenshots\v15-dc-foot-after.png)

上一刀只收到 336px，问题没解决，因为**宽度感不只来自卡片本身**：

| 问题 | 上一版 | 这一版 |
|---|---|---|
| 卡片宽度 | `min(100%, 336px)` | **`min(100%, 300px)`** |
| 「看全部改动 ›」 | `margin-inline-start: auto` 推到最右 —— 等于用一条链接强调"卡有多宽" | 跟"提交 · 已推送"**连排**，允许换行 |
| 卡尾分隔线 | 有（全卡第三道横线） | **去掉**，只留内边距 |
| 卡尾排版 | 单行不换行 | `flex-wrap: wrap` + 行间 4px |

### 为什么上一刀不够

我看的是"卡片外框"，用户看的是**最后一行里那个被推到最右的蓝字**：它把视线拉到卡片的右边缘，卡片的宽度就被"看"出来了。所以这一刀改的是**视线落点**（链接回到文字流里），而不是再画一个更小的框。

### 验证

| 检查 | 结果 |
|---|---|
| typecheck / build / guard / test | 全 exit 0；`app.css` 164.12 kB（hash `810b10fd`）；**3,119 passed** |
| 视觉 | 卡尾改前/改后 + 纸色三张 |

### 未测 / 风险

- **真机未测**：300px 在 320 宽屏上仍是通栏（`min()` 生效）；卡尾连排后在 320 下会换行成两行，没实拍。
- 风险：`看全部改动` 不再靠右，可能弱化它的可点性（它仍是 44px 触控高度的按钮）。
- 回退点：`.palm-delivery`（max-inline-size）、`.palm-delivery-foot`（flex-wrap / border / padding）、`.palm-delivery-more`（margin-inline-start）三条规则。

---

## 切片 58：主题色与皮肤冲突（一个调色板原则）+ 硬编码颜色清零 + 路径链接两处修复

### 根因（两条独立的结构性缺陷）

1. **两套调色板并存**：`--palm-*`（三套皮肤）与 `design/tokens.ts` 注入的旧名（`--accent` / `--danger` /
   `--fill` …，按明暗主题切换）。旧名 58 个里只有 34 个接回皮肤，剩下 42 个没接、样式里还引用 150+ 次
   （`--border-subtle` 38、`--danger` 34、`--fill` 30…）→ 纸色皮肤上蹦出靛蓝、夜航皮肤上出现石墨绿。
2. **两条独立控制轴**：`data-skin`（皮肤）与 `data-theme`（跟随系统深浅）互不知道对方，
   "纸色皮肤 + 系统深色"会拿到深色的语法高亮与代码底。

还有一层让它更难修：桥接段写在 `:root`（特异性 0,1,0），而 `design/tokens.ts` 用
`:root[data-theme=dark]`（0,1,1）与 `@media(prefers-color-scheme:dark)`（0,2,0）注入 —— 深色模式下
桥接永远输。实测：石墨皮肤下 `--accent` 取到 `#5b5cf0`（旧靛蓝）而不是 `#7c8cff`（皮肤紫）。

### 改法

- 剩下 42 个旧名一次性桥接回皮肤令牌；桥接选择器改 `:root:root`（0,2,0）压过主题注入。
- `applySkin()` 同时把 `data-theme` 钉成皮肤极性（纸=light，石墨/夜航=dark），`mobile-theme.ts` 在皮肤在场时让位。
- 补齐皮肤色板：纸色缺 11 个、夜航缺 13 个颜色令牌（`--palm-scrim*` / `--palm-dock-chip*` / `--palm-strip-*` /
  `--palm-flow-tag-*`），原先落回基础深色值。
- 新增两个令牌（三套皮肤各自定义）：`--palm-scrim-soft`、`--palm-on-scrim-soft`。

### 硬编码颜色清零（16 文件 / 43 处 → 0）

- 删掉 8 处死兜底（`var(--accent, #4f7cff)` 之类，兜底永远不会生效却绕过皮肤）。
- 白字 / 投影 / 遮罩 / 开关旋钮 / 琥珀标签等换成令牌（见提交差异）。
- 蒙版渐变里的 `#000` 保留：那是 alpha 通道不是颜色，测试里有显式豁免。

### 路径链接两处

- **虚线跑位**：`a.file-link` 原来是 `inline-block` + `padding:8px` + `margin:-8px` + `border-bottom`，
  盒子底边被负 margin 提到行间，虚线压在下一行文字上（用户截图）。改回 `inline` + `text-decoration:
  underline dashed` + `text-underline-offset: 3px`，虚线与字形基线绑定，padding 再多也不跑位，触控热区不变。
- **点了打不开**：宿主的 `readCandidates` 每次开文件都现查 `sessions.list`（冷启动实测 3.2 s）与
  `workspace.list`；且会话 cwd 只查第一页 40 条，3500+ 会话里大多数查不到 → 相对路径退回 `process.cwd()`。
  改为：先查花名册缓存（零 RPC，必要时用落盘快照水合）→ 未命中再翻页（最多 5 页）→ 工作区路径缓存 30 s；
  错误信息带上用户点的那个路径（`宿主上找不到这个文件：<path>`）。

### 门禁

| 检查 | 结果 |
|---|---|
| typecheck / build | 全 exit 0；`app.css` 167.29 kB（hash `1f203ea9`） |
| 测试 | `design/*` + 样式结构契约 + host/api **296 passed**（含新的皮肤契约与无硬编码颜色门禁） |
| 视觉 | 三套皮肤同屏对比 + 文件链接虚线放大图 |

### 未测 / 风险

- **宿主侧改动要重启 DSH 才生效**（`directory.ts` / `mobile-file-handlers.ts`）；CSS 与前端改动刷新即生效。
- 外观页的主题开关现在不产生视觉效果（明暗由皮肤决定），待定：改成说明文字、或删掉。
- 真机未测：路径链接在系统深色设置下的观感。
- 回退点：`000-tokens.css` 桥接段 + 两个新令牌；`180-file-links.css` 的 `a.file-link` 规则；
  `host/directory.ts` 的三个缓存与 `findSessionCwd`；`mobile/api/mobile-file-handlers.ts` 的两条错误文案。

---

## 切片 59：把第二个调色板请出运行时（主题只负责语法高亮）

### 为什么上一轮还不够

切片 58 靠「桥接 + `:root:root` 提权重」压住了 `design/tokens.ts` 注入的旧调色板。
但那是**两套色板抢同一个属性**，只是这次皮肤赢了：谁往 `LIGHT_PALETTE` 里加一个颜色，
它又会从 `:root` 里冒出来；谁写一条特异性更高的规则，又能翻盘。用户的口径是对的 ——
"感觉很容易冲突"。

### 根本解法：单一出处

1. `designTokensCss()` 不再输出**任何界面颜色**，只输出两样：结构令牌（间距/字号/圆角/层级）
   与 `--tok-*`（语法高亮，唯一真正需要按明暗分两套的东西）。
2. 界面颜色从此只有 `styles/000-tokens.css` 一个出处：`--palm-*` 皮肤令牌 + 旧名桥接段。
   构建产物实测：`--accent:` / `--danger:` / `--bg-page:` / `--tone-positive-ink:` 各 **1 次**。
3. `LIGHT_PALETTE` / `DARK_PALETTE` 降级为"桌面同源的参考值"（`desktop-parity` / 对比度测试仍用它），
   不再参与运行；`SYNTAX_LIGHT` / `SYNTAX_DARK` 才是运行时色板。

效果：两套色板不再有交叉点，也就不存在"谁压谁"。主题只剩一个职责 —— 代码块明暗，
而它由 `applySkin()` 把 `data-theme` 钉成皮肤极性来保证配套。

### 门禁（三条）

| 断言 | 防什么 |
|---|---|
| `tokens.test.ts`：生成器只输出语法色板 | 有人把界面颜色重新铺回 `:root` |
| `skin-contract.test.ts`：样式引用的每个属性都有人定义 | 写错名字/从别处抄来的变量静默失效，换肤时不跟着变 |
| `mobile-styles.structure.test.ts`：tone 令牌只定义一次且指向 `--palm-*` | 又按三套主题铺三份 |

### 实测（三套皮肤同页）

| 皮肤 | `data-theme` | `--accent` | `--danger` | `--bg-page` | `--tok-keyword` |
|---|---|---|---|---|---|
| 石墨 | dark | `#7c8cff` | `#ff6b81` | `#101015` | `#c678dd`（深色语法） |
| 纸 | light | `#8a5a2b` | `#a63b4f` | `#faf8f4` | `#a626a4`（浅色语法） |
| 夜航 | dark | `#22d3ee` | `#fb7185` | `#080c14` | `#c678dd` |

| 检查 | 结果 |
|---|---|
| typecheck / build | exit 0；`app.css` **163.85 kB**（hash `ab88cf78`，比上一轮小 3.4 kB） |
| 测试 | design + 样式结构 + skin-contrast + host/api **298 passed** |

### 未测 / 风险

- 外观页的「跟随系统 / 浅色 / 深色」开关现在只改**代码块语法色**，语义容易误解 —— 待定：删除或改文案。
- 旧名（`--accent` 等）仍在桥接段里活着，调用点 700+ 处未改名；桥接是唯一的定义处，改名属于纯清理。
- 真机未测：iOS 15 上 `var()` 链（旧名 → 皮肤令牌）没有已知问题，但本轮没在新系统外的机器上验证。
- 回退点：`design/tokens.ts` 的 `SYNTAX_*` 与生成器；`000-tokens.css` 桥接段；三条门禁用例。

---

## 切片 60：移除「明暗」设置，只留皮肤（外观只有一个开关）

### 决策依据

切片 58/59 之后，皮肤已经决定表面材质 + 强调色 + 明暗极性，`data-theme` 由 `applySkin()` 写入。
于是原来那个「跟随系统 / 浅色 / 深色」只剩一个可见效果：代码块的语法配色 —— 而它也自动跟着皮肤走。
也就是说它是个**零有效选择**的开关，却仍带着两套入口、一份宿主设置写入、和一条会与皮肤抢 `data-theme` 的代码路径。
结论：删掉，外观只留皮肤 + 字号 + 密度。

### 删掉的东西（4 个入口 + 1 条宿主写入）

| 入口 | 位置 |
|---|---|
| 「明暗」分组 | 外观页（`AppearanceView`） |
| 「主题」行 + 主题选择浮层 | 设置页（`SettingsView` / `settings-overlays`） |
| 「切换主题」菜单项 | 会话 ⋯ 菜单（`session-sheets`） |
| 头部主题按钮 | `components/theme-toggle.tsx`（整个文件删除） |
| 宿主 `ui-theme` 偏好写入 | 设置浮层的 `mutateSettings('ui-theme')` |
| 宿主偏好回灌 | `App.tsx` / `SettingsForm.tsx` 的两块 effect |

同时删除：`mobile-theme.ts` + `mobile-theme.test.ts`（主题存储与 system 监听）、
`.mobile-theme-toggle` / `.settings-themeOption(s)` 的死样式（含焦点环与 reduced-motion 名单里的条目）。
浏览器 chrome 色（`meta[name=theme-color]`）改由 `applySkin()` 按皮肤写：石墨 `#101015` / 纸 `#faf8f4` / 夜航 `#080c14`。

### 语义变化（用户可见）

- 外观页现在只有：皮肤（3 张预览卡）、字号、密度，外加一句「明暗由皮肤决定」。
- 会话 ⋯ 菜单从五项变四项；设置页「外观」组里不再有「主题」行。
- 宿主设置里的 `ui-theme.preference` 仍可被桌面端使用，但手机端不再读它、也不再写它。

### 门禁

| 检查 | 结果 |
|---|---|
| typecheck / build | exit 0；`app.css` **163.22 kB**（hash `02eb918a`） |
| 受影响的测试 | `SettingsView` 36 项、`SettingsForm` 10 项、`session-sheets` 4 项、`chat-empty` 全绿 |
| 真机形状验证（浏览器 390×844） | ⋯ 菜单四项、设置页无「主题」行、外观页只有皮肤/字号/密度 |

### 未测 / 风险 / 已知欠账

- **删了 3 个源文件**（`theme-toggle.tsx` / `mobile-theme.ts` / `mobile-theme.test.ts`）—— 这是本切片的目的，
  不是误删；`git status` 的删除项仅此三项。
- 未测：iOS 上状态栏 chrome 色随皮肤变化（只在浏览器里看了 meta 值）。
- 已知欠账（本轮之前就红，未修）：`platform/budget.test.ts` 的 `App.tsx 1394 > 1325`、
  `quality-budget.test.ts` 的 `cssHex` 预算不再虚高、`architecture.test.ts` 的视图行数预算；
  以及 `ChatView` / `message-row` / `process-line-truncation` / `delivery-detail` 共 21 项旧红。

---

## 切片 61：过程条环形进度（C）+ 状态条空闲/完成/未知三态文案

### 用户拍板

- 过程条：「点阵短杠 + 底边填充细条」都不要，选 C —— 行尾 14px 环形进度。
- 状态条：空闲/完成/未知各显示具体状态，不再是一个破折号；文字与图标要对齐。

### 改了什么

| 位置 | 改动 |
|---|---|
| `session/task-status.ts` | `running === false` 从 `unknown` 拆出新状态 **`idle`**（宿主明确说没在跑 = 事实，不是"不知道"） |
| `ui/status-strip.tsx` | 状态种类 11 → 12（新增 `idle`），注释写明 idle / unknown 的区别 |
| `ui/turn-header.tsx` | 状态词：`空闲` / `状态未知`；灰字：完成态「改 N 个文件」或「未做改动」、空闲「等你发话」、未知「等宿主回报」；右侧：完成报耗时、空闲报「N 分钟前」（`formatAgo`） |
| `ui/process-line.tsx` | 删点阵/底边线/扫光，改成 14px 环形进度（`--palm-proc-ratio`，弧长 = done/total） |
| `styles/370-v21.css` | 新增 `.palm-proc-ring*`、`@keyframes palm-proc-ring-turn`；删 `.palm-proc-step/track/fill/spark/more` 与两条旧 keyframes；`idle`/`unknown` 标记改中性灰 |
| `styles/360-reduced-motion.css` | 减弱动效名单：环弧慢转替换旧扫光/脉冲条目 |

### 对齐（用户明确要求）

状态条实测：鲸尾标记、标签、灰字、右侧时间的垂直中点分别在 -15900 / -15900.7 / -15900 / -15900 —— 误差 0.7px。
过程条：环与文字同一 `align-items: center`；有环时环吃 `margin-inline-start: auto`，箭头紧跟其右。

### 门禁

| 检查 | 结果 |
|---|---|
| typecheck / build | 0 / 0；`app.css` **163.11 kB**（hash `0b834dcd`） |
| design + structure | 263 passed |
| 全量 mobile | 2494 passed / 27 failed（其中 26 项是本轮之前就红的旧账 + 预算类） |
| 真机形状 | 环渲染在 x=330、ratio 1.000/0.980、`data-live` 只在 running；旧 `.palm-proc-step/.palm-proc-track` 计数 0 |

### 未测 / 风险

- **idle 态只在单测与 mock 里验过**：真机没抓到空闲会话的截图（当前会话一直在跑）。
- 环的 `transform-box: view-box` 依赖较新浏览器；iOS 16 以下会退回静止弧（仍正确，只是不转）。
- 已知旧红未修：delivery-detail(3)、message-row(5)、ChatView(8)、process-line-truncation(3)、
  message-row-process-group(2)、预算类(5) —— 均为前面切片遗留，与本切片无关。

---

## 切片 62：状态条不写「状态未知」/ 时钟常驻 + 底部那句「没有新输出」整行下线

### 用户要求

1. 状态条不要写「状态未知 等宿主回报」。
2. 右端必须一直继续显示计时时钟，不能突然消失。
3. 输入框上方那行「● 已 1 分 7 秒没有新输出」去掉；任务清单与子代理改到别处显示。

### 改了什么

| 位置 | 改动 |
|---|---|
| `ui/turn-header.tsx` | `unknown` 状态词 → 空串（一个字都不写）；灰字同样不写；**时长只要拿到就画**（去掉 `!known` 判断） |
| `message-row/artifacts.tsx` | 无权威数据（unknown）但有锚点时，按 `now - anchor` 继续算时长 —— 时钟不消失 |
| `ui/status-strip.tsx` | 标签为空时不渲染空 `<b>`，只留鲸尾 + 时钟 |
| `stream/session-status.ts` | 删掉「已 N 秒没有新输出」整个分支（含 20s 宽限期那段判据） |
| `render/run-status.tsx` | 新增 `RunBadge`：`3/7 · 代理 1 · 后台 1` 的顶栏徽标，点开既有运行详情面板 |
| `views/chat/components/chat-header.tsx` | 右侧槽位新增 `run` 插槽 |
| `views/ChatView.tsx` | 顶栏挂 `RunBadge`；`SessionHud` 不再画 `RunStatusBar`（只留「别的会话跑完」那条） |
| `styles/030-header.css` | `.chat-run-badge` / `.chat-run-badge-dot` |

### 门禁

| 检查 | 结果 |
|---|---|
| typecheck / build | 0 / 0；`app.css` **163.56 kB**（hash `2e78ea4d`） |
| 新增测试 | `render/run-status.badge.test.tsx` 3 项（空态不画 / 2-4 计数 / 子代理与后台任务） |
| 真机形状 | `.chat-status-strip` 计数 0（输入框上方那行确实没了） |

### 未测 / 风险

- 徽标只在「有计划未完成 / 有子代理 / 有后台任务」时出现；当前会话没有在跑的东西，真机上暂时看不到它，
  已用单测覆盖三条判据。
- `RunStatusBar` 组件本身保留（导出仍在），只是 ChatView 不再渲染它 —— 后续要么删、要么给别处复用。

---

## 切片 63：输入框「四个角显示不全、每行掉半个字」

### 现象（真机 2026-11-10）

30 来个字的草稿进输入框后：首字被左上圆弧切掉、每行末尾缺半个字、最后一行只剩一横。

### 根因

| 编号 | 原因 | 证据 |
|---|---|---|
| ① | `field-sizing: content` 让 textarea 按**内容宽度**排版，框只有 155px，多出来的部分被裁 | 真机实测文字每行 11 字 × 16px ≈ 176px > 155px |
| ② | 外壳圆角 24px + 左右内边距只有 14px，首/末行的字形压进圆弧 | 6 倍放大截图 |
| ③ | 行高 24px、上限 96px（= 4 行）但内容 5 行，末行被切一半 | 高度实测 96 / scrollHeight 大于 96 |

### 改了什么

| 位置 | 改动 |
|---|---|
| `styles/260-input-bar.css` | 去掉 `field-sizing`；外壳 `padding: 9px 16px`、`border-radius: 18px`、`overflow: hidden`；textarea `padding: 2px 0`、`line-height: 22px`、`max-height: 92px`（4 行整） |
| `views/chat/components/composer-section.tsx` | 新增 autosize：按 `scrollHeight` 写高、封顶 92px；超过 4 行时把 `scrollTop` 对齐到整行（含 padding 起点），滚动后不再露半行 |
| `mobile-styles.structure.test.ts` | 契约跟着改：`padding: 9px 16px` / `border-radius: 18px` / `line-height: 22px` / `min-height: 26px` |

### 验收（真机形状，390×844，dSF 3）

| 用例 | 结果 |
|---|---|
| 空 | 26px（单行） |
| 一行 | 26px |
| 30 字（原故障文案） | 92px = 4 整行，**文字完整、四角不切字** |
| 60 字以上 | 92px 封顶，框内滚动，行首对齐（scrollTop 68 = 3 行 + 2px padding） |

### 未测 / 风险

- 只在 Chrome（Windows，模拟 390px）验过形状；iOS Safari 的键盘把输入框顶起来时的表现要你实机再看一眼。
- 超过 4 行滚动时，视口顶边偶尔仍会露 1–2px 上一行的字脚（textarea 内部滚动像素级，浏览器不保证行首对齐）；
  已用 scrollTop 对齐缓解，未彻底消除。

### 切片 63 第三轮（同日）：文字区域要覆盖整个框

用户：「看起来还是没有修好，输入文字显示区域要跟这个输入框一样才对」。

前两轮把内边距留在**外壳**上（8/14 → 9/16），于是 textarea 只有壳内那一小块：
左右各 16px 是死区 —— 点不进去、也不出光标，视觉上就是「画出来的框比能写字的地方大」。

| 位置 | 改动 |
|---|---|
| `.chat-field` | `padding: 0`（内边距全部交给 textarea），圆角仍 18px、`overflow: hidden` |
| `.chat-field > .chat-input` | `padding: 12px 16px`、`min-height: 46px`、`max-height: 112px`（4 行整 + 上下各 12） |
| `.chat-command-chip` | 外壳内边距归零后，chip 自己带 `margin-inline-start: var(--palm-s3)` |
| `composer-section.tsx` | 封顶高度 92 → 112 |

验收（真机形状）：

| 宽度 | 外壳 | textarea | 左右内缩 | 横向溢出 |
|---|---|---|---|---|
| 320 | 153 | 151 | 1px | 无 |
| 375 | 170 | 168 | 1px | 无 |
| 390 | 185 | 183 | 1px | 无 |

命中测试（390px）：框内左/右/上/下四边各取一点，`elementFromPoint` 全部命中 `.chat-input`；
只有最外侧圆角（12,12）仍是外壳 —— 那是圆弧本身，属正常。

### 注意：CSS 的缓存策略

样式表按内容哈希挂在 `/m/assets/app.css?v=<hash>`，响应头是 `immutable`。
手机端**必须真的重新加载页面**才会换 `<hash>`：iOS 从主屏图标打开的 PWA 要完全划掉重开，
普通 Safari 标签页下拉刷新即可。已确认服务端下发的是新 CSS（含 `padding:12px 16px`、无 `field-sizing`）。

---

## 切片 64：鲸鱼尾的颜色（不再是灰的）

用户：「这个鲸鱼尾动效不应该是蓝色的吗？怎么各个皮肤下显示都是灰色的？」

### 根因

尾鳍一直用 `currentColor`，而方标的 `color` 跟着状态走：`done` 绿、`idle`/`unknown` 灰
（后两条是我 11-10 早上刚改的），`think/read/edit/test` 才是强调色。于是在「做完」「空闲」
这两种最常见状态下，用户看到的是一只灰鲸鱼；paper 皮肤的 accent 又是墨棕，也不蓝。

### 改法

| 位置 | 改动 |
|---|---|
| `styles/000-tokens.css` | 新增 `--palm-whale`（吉祥物固有色，和交互色 accent 分开）：graphite `#7c8cff`、paper `#3f6ae0`、nocturne `#22d3ee` |
| `styles/370-v21.css` | `.palm-strip-mark` 的 `color` 改 `var(--palm-whale)`；删掉 done/failed/idle/unknown/approve 等分支里的 `color:` —— **颜色只由底色承担** |
| `tests/golden/tokens.json` | 基线更新（`PALM_UPDATE_TOKENS=1`） |

### 验收（真机形状，4x 放大截图）

| 皮肤 | 鲸鱼颜色 | 方标底色（done 态） |
|---|---|---|
| graphite | `rgb(124,140,255)` 蓝 | 绿带 |
| paper | `rgb(63,106,224)` 蓝 | 绿带 |
| nocturne | `rgb(34,211,238)` 青 | 绿带 |

### 未测 / 风险

- 逐帧动效层（`/m/running-whale.png` + `mask-mode: alpha`）在无头 Chrome 里没启用，截图看到的是静止 SVG；
  实机 iOS 是否走动画层要在手机上看一眼。两层都用 `currentColor`，颜色一致。

---

## 切片 65：右下角上下文用量圆环（以前是假的）

用户：「右下角这个上下文用量圆环渲染显示不准确，需要优化一下。」

### 根因

`.chat-meta-ring` 以前是个 border 圆，只有 `border-top-color` 上色 ⇒ **永远是四分之一圈**，
旁边的数字是 3% 还是 96% 长得一模一样（10px 大小下更难分辨）。

### 改法

| 位置 | 改动 |
|---|---|
| `views/chat/components/composer-meta.tsx` | 改成 `<svg>` 两个圆（轨道 + 弧）；`pathLength=100` + `strokeDasharray="<pct> 100"` —— 弧长就是百分比本身，**不占 inline style 预算**；语气 `data-tone` 按 70/90 分档；0% 打 `data-empty` 不画弧 |
| `styles/240-composer-pills.css` | 用 `circle:first-of-type` / `circle:last-of-type` 选择器（不新增 class 名，省预算）；弧 `rotate(-90deg)` 从 12 点起；track 用 `--palm-dock-ring-track`；warn/danger 各给一支 `stroke` |
| `styles/000-tokens.css` | `--palm-dock-ring` 10px → 12px（10px 下看不出比例） |
| `tests/golden/tokens.json` | 基线更新 |

### 验收

| 用例 | 结果 |
|---|---|
| 真机 47% | 弧长 `calc(17.7185px) 37.699px`、`stroke: rgb(124,140,255)`，截图弧约半圈 |
| 0 / 12 / 43 / 68 | 蓝色弧，长度跟着走；0% 不画点 |
| 72 / 88 | 琥珀色 |
| 96 | 红色 |
| 无投影 | 只有轨道 + `--` 占位 |

新增测试 `composer-meta.ring.test.tsx`（4 项）：比例=0.430/0.780、两层结构、语气分档、无数据占位。

---

## 切片 66：输入框高度彻底改对（占位符也算行数）

用户截图：选中图片 / 空输入框时，占位符「说点什么…（会打断当前任务）」第二行被切掉。

### 根因（第三轮，真正的那个）

`textarea.scrollHeight` **不把 placeholder 算进内容**。空框时它只报一行，我的 autosize 就
把高度写成 46px（一行），而占位符实际折成两行 → 第二行被裁。另外两个放大器：

1. 占位符会随状态变长（运行中多一句「会打断当前任务」），effect 依赖里没有它 → 变了也不重量；
2. 输入框宽度会变（排队 ↔ 停止按钮宽度不同），宽度一变行数就变，没人重量。

### 改法

| 位置 | 改动 |
|---|---|
| `composer-section.tsx` | 新增 `fitComposer()`：用**镜像 div**（同宽、同 font、同 line-height、同 padding、`white-space: pre-wrap`）量「正文或占位符」的高度，夹在 46–112 之间写给 textarea；依赖里加入 `placeholder`；挂载后再补 rAF + `document.fonts.ready` 两次；`ResizeObserver` 监听宽度变化 |

### 验收（真机形状，三档宽度）

| 宽度 | 空框（占位符 2 行） | 长文本 | 清空后 |
|---|---|---|---|
| 320 | 68 = scrollHeight 68 ✓ | 112（封顶，内部滚动） | 68 ✓ |
| 375 | 68 = 68 ✓ | 112 | 68 ✓ |
| 390 | 46 = 46 ✓（占位符刚好一行） | 112 | 46 ✓ |

之前 320/375 空框固定 46（占位符被切）。

---

## 切片 67：排队消息「自己跑回输入框」

用户：「发送消息都排队了，却突然回撤到输入框里去了」。

### 根因（重连基线 × 丢失对账）

`views/ChatView.tsx` 里有一段「排队消息对账」：连续 20 秒没在宿主队列里看到、对话里也没有、
当前没有回合在跑 → 判定这条排队丢了，把原文放回输入框。

而 `stream/session-store.ts` 的 `queueView()` 在**重订阅基线生效期间**（断线重连后，
宿主还没给出更新的队列）固定返回空数组 —— 那个空是「还不知道」，不是「不在队列里」。
两次真机截图（`已重连` 横幅 + 排队卡片与输入框同时出现同一段文字）正好对上这条链路：
重连 → 队列视图清空 → 对账判丢 → 原文回填输入框 → 队列快照回来 → 卡片又出现。

### 改法

| 位置 | 改动 |
|---|---|
| `stream/session-store.ts` | 新增 `queueAuthoritative(sessionId)`：重订阅基线生效中 / 没有快照时返回 false |
| `views/ChatView.tsx` | 对账最后一步加闸：`if (!queueAuthoritative(...)) return` —— 队列读数不可信时绝不下「丢失」的结论 |
| `views/chat/lib/chat-constants.ts` | `LOST_ECHO_QUIET_MS` 20s → 60s（宿主队列投影在重连/大日志时会慢到几十秒） |

### 测试

新增 `stream/session-store-authoritative.test.ts`（5 项）：无会话=不可信、正常快照=可信、
基线生效=不可信且 `queueView()` 为空、收到更新队列=恢复可信、重放同旧版=仍不可信。

### 未测 / 风险

- 无法在真机上复现断线重连时序：本次验证靠单测 + 代码链路对照两张真机截图，
  「重连后排队条不闪、不出现双份文字」需要你下次断网重连时再看一眼。
- 放宽到 60 秒的代价：真丢消息时要多等 40 秒才拿回原文。

---

## 切片 68：多条排队条「一闪一闪」

用户：「当有多条排队消息条的时候，会发现排队消息条一闪一闪的情况，感觉是被强行渲染刷新了，深入排查一下。」

### 复现（不是猜的）

在本机会话里真排两条（`测试甲` / `测试乙`），用 `MutationObserver` 盯 `.queue-dock` 40 秒，
每轮 inbox 轮询抓一次文本顺序，得到 8 次变更、顺序**逐次翻转**：

```
texts=测试乙：这条/测试甲：这条
texts=测试甲：这条/测试乙：这条
texts=测试乙：这条/测试甲：这条   ← 每 1.5–8 秒翻一次，就是「闪」
```

### 根因

`stream/session-status.ts:visibleQueue` 里两类数据源顺序相反：

| 来源 | 顺序 |
|---|---|
| 宿主队列 `host`（`next-turn` 投影） | FIFO，早的在前 |
| 乐观项 `optimistic`（刚点上「排队」还没被宿主接管） | **新的在前**（`b.at - a.at`） |

于是「刚排的两条」是乙甲，「被宿主接管后」是甲乙 —— 每轮轮询在两者之间切换一次，
屏幕上的两行就互换一次位置。只有一条时看不出来，所以这个 bug 一直等到「多条」才暴露。

### 改法

`visibleQueue`：先用时间倒序做「同文只留最新那份」的去重，再把结果**按入队时间正序**输出，
与宿主 FIFO 一致 —— 宿主接管前后顺序不变，不再互换。

### 验收

| 项 | 结果 |
|---|---|
| 真机形状（改后） | 25 秒 12 次变更，文本顺序只有 1 种：`测试甲|测试乙` ✓ |
| 单测 | `session-status.test.ts` 41 项全过，新增「FIFO 排序」「宿主接管后顺序不变」两条 |

### 顺带修掉的两处

1. 排队消息「自己跑回输入框」：`queueAuthoritative()` 闸门（切片 67），冷启动没有会话时按可信处理；
2. 我之前误把 `session-status.test.ts` 整份覆盖过（写脚本时选错了写入方式），已从 HEAD 恢复
   并重做当时的三处「卡住提示」改动 + 新增两条 FIFO 用例，现 41 项全过。

### 未测 / 风险

- 只在本机会话（真机形状 390×844）验证；多端同时入队（桌面端排一条）的顺序一致性没测。
- 验证期间在本机会话排过 3 条测试消息，**已全部删除**，对话里没有残留（已核对 transcript）。

---

## 切片 69：排队条重做（方案 A，用户拍板）

用户：「A」。

### 改之前：同一件事说三遍

底部同时有三块：`已插入 1 条补充消息` 摘要条 + 一块四按钮的排队大卡（编辑/删除/撤回/立即发送）
+ 一条黄底横条「1 条排队 · 当前任务结束后执行」。真机截图里它们占了近四分之一屏。

### 改之后：一块卡说完

| 区域 | 内容 |
|---|---|
| 头行（常显） | `N 条排队 · 当前任务结束后执行` + 右侧 `立即发送`（作用于队首）+ `⋯` |
| 行（每条一行） | 单行截断的正文 + `×`；点正文打开该条的动作表 |
| 动作表 | 编辑 / 撤回并放回输入框 / 立即发送 / 删除（复用浮层 `.sheet-option` 行式布局） |
| 卡底 | `▸ 已插入本轮 · N 条补充消息`（原来那条独立摘要条并进来） |
| 删掉 | 黄底「N 条排队 · 当前任务结束后执行」横条（信息已在头行） |

### 文件

| 文件 | 改动 |
|---|---|
| `components/queue-dock.tsx` | 重写：头行 + 行 + 动作表；去掉折叠、去掉行内四个按钮 |
| `views/chat/components/queue-card.tsx` | 新增：一张 `.queue-dock` 卡包住排队行与插入行；两者都空时不渲染 |
| `views/chat/components/insert-bar.tsx` | 抽出 `useInsertEntries()`，容器与 QueueCard 共用 |
| `views/chat/components/composer-section.tsx` | 删掉 `.chat-queue` 横条与 `queue.count` 入参 |
| `views/ChatView.tsx` | `detail` 只放 `<QueueCard/>` |
| `styles/370-v21.css` | 头行/行/×/卡底虚线；删掉 `.queue-dockChevron`、`.queue-dockBtnIcon` |

### 验收

| 项 | 结果 |
|---|---|
| 真机形状 390×844 | 卡高 161px（两条排队）：头行 48、行 44、无横条 |
| 几何 | 头行文字 12px 与按钮同轴对齐；正文 288×44，右侧 × 命中区 44 |
| 单测 | `queue-dock.test.tsx` 12 项、`insert-bar.test.tsx` 6 项全过 |
| 预算 | `cssClasses`、`cssPx`、`inlineStyles`、`viewDataImports` 全部在限内 |

### 未测 / 风险

- 动作表的「编辑」在真机上没点开截图（单测覆盖：点行 → 编辑 → 输入 → 保存 → `onEdit`）；
- 插入行只在有插队消息时出现，真机截图未覆盖该分支（单测覆盖）。
- 验证期间排过 4 条测试消息，已全部删除；transcript 无残留（已逐元素核对）。

---

## 切片 70：排队条第二轮（按钮收小 + 每条独立动作 + 浮层层级）

用户：「这个按钮太大了不协调，另外，每条插队消息需要可以独立编辑/删除/处理。」

### 改了三件事

| 问题 | 改法 |
|---|---|
| `立即发送` 视觉过大（44px 高、方角） | 视觉压到 **30px + 胶囊圆角**；命中区用 `::after` 纵向补回 44px（不占布局、不挤压相邻 ⋯）。实测 74×30 |
| 只有队首能操作，其余行只能删 | **每行一个 `⋯`**（`排队消息的更多操作：<正文>`）打开该条的动作表：编辑 / 撤回并放回输入框 / 立即发送 / 删除。行内 `×` 保留做快速删除 |
| 「已插入本轮」只能整条撤回 | 明细**默认展开**；每条右侧 `⋯` 打开动作表：撤回并放回输入框 / 删除。`InsertBarView` 新增可选 `onRemove` |

### 顺带修掉一个层级 bug（真机截图暴露）

动作表一开始直接渲染在排队卡内部：`.queue-dock` 在输入区里，祖先带 `transform`/层叠上下文，
`position: fixed` 退化成相对祖先定位 —— 浮层被压到输入行**下面**还被裁掉半截。
新增 `ui/sheet.tsx:SheetPortal`（`createPortal` 到 `document.body`），排队卡与插入条的动作表都走它。
修完 `.sheet` 几何回到视口坐标（y=534、高 316），截图正常。

### 验收

| 项 | 结果 |
|---|---|
| 几何 | 主按钮 74×30、`⋯` 44×30、行 44、`×` 30×30（视觉），命中区均≥44 |
| 动作表 | 真机截图：标题「这条排队消息」+ 四项（编辑/撤回并放回输入框/立即发送/删除） |
| 单测 | `queue-dock` 12 项、`insert-bar` 6 项全过（含新的「默认展开」「每条 ⋯」路径） |
| 结构断言 | 44px 命中区改为「30px 视觉 + `::after` 补 7px」；圆角断言改 `--palm-r-full` |

### 未测 / 风险

- 插入项的动作表只在单测覆盖（真机上没造出 steering 条目）；
- 验证期间排过 6 条测试消息，全部删除；transcript 无残留（逐元素核对）。

---

## 切片 71：正文图片「经常显示不出来」——根因与修法

用户：「经常正文里的图片没法显示出来」（截图：红色虚线破图 + alt 文字「动作表」）。

### 根因（实测数据）

| 事实 | 证据 |
|---|---|
| 手机渲染器把相对路径判成本地图，走 `mobile.readFile` 水合 | `render/markdown.ts:localImagePath` → `data-local-src` |
| 宿主能读**绝对**路径 | RPC 实测 `ok:true`，`kind:image`，dataUrl 100,610 字节 |
| 宿主读**相对**路径失败 | `file-unreadable`；`package.json` 解析到 `C:\Users\Administrator\.dsh\upgrade-adapt\021prod`（宿主进程 cwd） |
| 该会话的 cwd 是 `D:\work\dsh-palm` | `session.list` 里这条会话的 `cwd` 字段；该目录下**没有**这些截图 |

结论：相对路径按「会话 cwd → 宿主进程 cwd → 工作区根」依次解析，而这三处都没有文件 ——
本次会话的 cwd（D 盘）与代码实际所在（`C:\Users\Administrator\dsh-source\dsh-palm`）不是同一个目录。
不是水合逻辑坏了，是**基准目录对不上**。

### 修法

| 层 | 改动 |
|---|---|
| 回复约定 | 正文图片一律写**绝对路径**（`C:/…/docs/screenshots/x.png`）：宿主必读得到，桌面端与手机端都能显示 |
| 渲染器 | 读不到时不再留破图：把 `<img>` 换成 `.md-img-missing` 小牌子，写明「<alt>未找到 · <路径>」。`<img>` 是替换元素，`::after` 的路径根本不会渲染，所以用 span 顶替 |
| 平台层 | `local-images.ts` 新增失败集合：同一张读不到的图不再反复发 RPC（重渲染很频繁） |

### 验收

| 项 | 结果 |
|---|---|
| 真机等价页（390×844） | 三张读不到的图全部变成牌子：`动作表未找到 · docs/screenshots/queue-card-sheet-final.png` 等 |
| 单测 | `markdown-text.test.tsx` 14 项全过（新增「换成牌子」一条） |
| 绝对路径 | RPC 直测 `ok:true` + `kind:image` |

### 未做 / 待定

- 是否把 `C:\Users\Administrator\dsh-source\dsh-palm` 注册成 DSH 工作区（注册后相对路径也能解析，一劳永逸）—— 改了用户的配置，需用户点头；
- 会话 cwd（D 盘）与代码实际目录不一致这件事在宿主侧，不在本包范围。

---

## 切片 72：状态文案去"宣判"（P0+P1）

用户：「把鲸鱼尾后面有时候会出现的『可能卡住了』换成更积极一点的……其他地方有没有类似显示，给我一版优化方案」→ 拍板 P0+P1。

**原则**：状态词只陈述事实，不替用户宣布故障；下一步动作放在灰字或可点处，不塞进四个字里。真实终态（失败/已中断）保持明确 —— 那是信息，不是评判。

### 改了 8 处

| # | 位置 | 原 | 现 |
|---|---|---|---|
| 1 | 状态条（鲸尾后） | 可能卡住了 | **还在等** + 灰字「比平时慢一点 · 也可以停止后重发」 |
| 2 | 聊天顶部横幅 | 连接中断，正在重连… | 网络慢了一点，正在恢复… |
| 3 | 附件缩略图 | 图片加载失败，点击重试 | 这张图没显示出来，点一下重试 |
| 4 | Toast 重新生成 | 重新生成失败，请重试 | 这次没生成出来，再点一次 |
| 5 | Toast 队列编辑 | 编辑没送到宿主，检查一下网络再试 | 改动还没送到，稍等一下再点保存 |
| 6 | Toast 队列删除 | 删除没成功（code），请再试一次 | 没删掉，再点一次（错误码改打到 console） |
| 7 | Toast 贴图 | 该图片无法解码，已忽略 | 这张图读不出来，已跳过 |
| 8 | 运行详情 | 出错退出 | 异常结束 |

**不动**：步骤行/状态条的「失败」「已中断」、API 报错（`上传失败，重试` 这类）—— 真实失败必须一眼看出来。

### 验收

| 项 | 结果 |
|---|---|
| 构建产物 | 8 条新文案各命中 1 次（`lib/mobile/*.js` 逐个 grep） |
| 单测 | `ui` / `render/message-row` / `offline-banner` / `finished-elsewhere` / `queue-actions` / `attachments` 全过；改文案连带更新 7 个测试文件 |
| 全量 mobile | 25 红（与基线一致，全部是旧账：`.chat-step`/`.chat-artifact` 结构、`cssHex`、`App.tsx` 行数） |

### 未测

- 「还在等」只在单测与产物里验过：要触发它得让回合静默 90 秒，没有为它造一次长任务；
- 离线横幅同理（要真断网 ≥2 次请求无应答）。

---

## 切片 73：已发送的消息在排队卡里复活（真机幽灵条）

用户：「为什么以前的排队消息条又会出现，根因是什么？」（截图：1 条排队 + 已经发出去的那条正文 + toast「这条已经不在队列里了，已从列表移除」）。

### 根因：三层叠起来

| 层 | 事实 |
|---|---|
| 宿主 | 队列读的是**投影快照**，忙/弱网时能慢半拍到几分钟（本仓注释里早有记录） |
| 渲染 | `turn/start` 认领队首时，只在 `hidden` 表里打一个标记 —— 这张表有 **90 秒 TTL**（防宿主永不收敛时永久屏蔽） |
| 判据 | `visibleQueue` 只在**宿主队列读空**时才用「正文已进对话」核对；队列非空（陈旧的）直接跳过 |

于是：消息 19:50 被取走 → 19:51:30 标记过期 → 宿主陈旧投影里还有它 → 排队卡把它画回来；
点 × 去删，宿主回 `queue-item-not-found` → 就是截图里那句 toast。

### 修法

- `session-store`：新增 `Entry.claimed`（**不过期**）—— `claimQueueHead` 认领时登记，只在宿主队列里真的没有它了才摘掉；
- `session-status.visibleQueue`：新判据 **已认领 + 正文已在对话里 → 不画**（放在隐藏 TTL 之前，独立于空队列分支）。

为什么不是「正文一样就隐藏」：用户完全可能再排一条同样的话（复制粘贴重发）。所以只对**认领过的 id** 生效，
同文但没认领的条目照常显示。

### 验收

| 项 | 结果 |
|---|---|
| 单测 | `session-status` 44 项（+3：认领+已进对话不显示 / 同文未认领仍显示 / 认领但未进对话仍显示） |
| 仓级回归 | `session-store-authoritative` 6 项（+1：认领后**10 分钟**再收到同一份陈旧投影，仍然不显示） |
| 全量 mobile | 2514 通过 / 25 红（与基线一致，旧账未动） |

### 未测 / 残留

- 真机未复现（要等宿主投影慢几分钟）；仓级测试用「10 分钟后仍收到陈旧快照」模拟同一条路径；
- **删除**那条路径仍走 90 秒 TTL（本次未动）：理论上删掉的条目在极端情况下也可能被陈旧投影画回来，
  概率低（删除成功时宿主会立刻返回新队列），留作后续。

---

## 切片 74：队列加单调版本（架构级修法，P1+P2）

用户拍板「选 P1+P2，系统性解决这一类问题」。切片 73 是打补丁（认领不过期），本切片换掉**判据本身**。

### 病根

「权威队列」其实是投影快照，而投影会慢半拍甚至几分钟；客户端只能靠 TTL / 观察窗 / 隐藏表 / 正文比对去猜。
补丁之间互相打架（切片 73 的幽灵条就是 90 秒 TTL 与陈旧投影的冲突）。

### 改法（三层）

| 层 | 改动 |
|---|---|
| 宿主 | `host/queue-inbox.ts` 新增**单调版本**：`queueVersionOf` / `bumpQueueVersion` / `stampQueueVersion`。**只在事件时 +1**：inbox 投影帧（内容指纹变了）、`session/queue` 帧、`turn/start`（认领）。**读投影不推进** |
| 传输 | SSE 桥每帧出站前 `stampQueueVersion(payload)`；`mobile.inbox` 与 `mobile.sessionState` 的快照都带 `queueVersion` |
| 客户端 | `stream/session-store.ts` 版本栅栏：快照/帧的版本 `<= 已应用值` → **队列部分一律不动**（行/回合照常更新）；带版本的空队列不再走 4 秒观察窗；`rebaselineQueueView` 把版本基准一并作废（宿主进程重启、计数器归零时不冻结队列） |

### 为什么这样就不会再犯

「版本没变」现在**等于**「队列没变过」（宿主只在事件时 +1，读投影不推进）。
于是陈旧投影即使内容不一样，也拿不到比已应用值更高的版本 —— 在数学上画不回来，不再依赖任何秒数。

### 兼容

老宿主没有 `queueVersion` → `versioned=false`，完全走旧判据（含切片 73 的认领表、隐藏 TTL、观察窗）。
新旧两套不混用，因此不存在「半新半旧」的叠加态。

### 验收

| 项 | 结果 |
|---|---|
| `src/host/queue-version.test.ts`（新增） | 4 项：无关帧不打版本 / 内容变了才 +1 / `turn/start` 推进 / 显式队列帧推进 |
| `session-store-authoritative` | 10 项（新增 4）：同版本陈旧快照不复活 / 更高版本照常应用 / 帧路径同样栅栏 / 重订阅后版本基准作废 |
| 全量 mobile | **2518 通过 / 25 红 / 1 expected**（25 红 = 基线，未新增） |
| 构建 | typecheck 0、build 0 |

### 未测 / 残留

- 端到端抓包未做：脚本化 RPC 被配对门禁拦住；只在页面上确认了**渲染正常、排队卡正常、无新报错**；
- 旧判据（隐藏 TTL / 观察窗 / 认领表）仍在，只在新宿主上被栅栏短路。等真机跑一段时间确认无回归后再删，避免「一次改两件事」；
- 宿主若**漏挂某个写入点**，版本不涨 → 该次改动看不到（不会画错，只会慢一拍到下一次事件）。

### 回退点

```
git checkout -- packages/dsh-palm/src/host/queue-inbox.ts packages/dsh-palm/src/mobile-api.ts \
  packages/dsh-palm/src/mobile/api/mobile-session-state.ts packages/dsh-palm/src/mobile/data/impl/session.ts \
  packages/dsh-palm/src/mobile/stream/session-store.ts packages/dsh-palm/src/mobile/views/chat/state/frame-effects.ts \
  packages/dsh-palm/src/mobile/views/chat/hooks/use-chat-inbox.ts
```

---

## 切片 75：「改 N 个文件」搬进过程条头

用户拍板方案 A：改动数是**这一轮过程的产出量**，属于过程条的事实，不该出现在任务头状态条的灰字里。

| 项 | 改动 |
|---|---|
| `ui/process-line.tsx` | 新增 `files` 计数：`12 次工具调用 · 1 处报错 · 改 7 个文件` 同一行；读屏并入 aria-label；0 不画 |
| `message-row/process.tsx` | 传 `model.changedFiles` |
| `ui/turn-header.tsx` | 完成态灰字：>0 时**整条不出现**（信息已在过程条），=0 仍说「未做改动」 |
| `styles/370-v21.css` | `.palm-proc-files`（安静一档灰，令牌实现，不占 px 预算） |

单测：`process-line` 新增 2 项（有改动报数 + 千分位 / 0 与不传都不占位）；`turn-header` 两项改为断言灰字消失。

## 切片 76：过程条改成单一时间轴（方案 B1）

用户拍板 B1：**思考/叙述/工具行按事件顺序排在同一条时间轴上**，整轮的改动仍合成一张卡放在时间轴末尾。

| 改动 | 说明 |
|---|---|
| `message-row/process.tsx` | 展开体改为 `showToolCalls` 全开的时间轴；折叠态仍是「一条当前命令」（防抖动口径不变） |
| 分页删除 | 「还有 N 步 ›」与 `RECENT_TOOLS` 作废：展开就是全量（12 步也不再分两次点） |
| diff 卡位置 | `ProcessRows` 把全部 `tool-group` 合并成一个块追加到时间轴末尾（B1） |
| 死代码 | `.chat-step-caret` / `.chat-step[data-state=fold]` / `.chat-proc-tools > .chat-step:first-child` 一并删除（省 CSS 类预算） |

单测：`message-row-process-group` 改 3 项（展开=12 行全量、无分页行、时间轴交错 `think→tool→think→tool`）；`ChatView` 的顺序断言改为 `narration → step → artifact → answer`。

## 切片 77：diff 卡逐文件 + 真 hunk + 点开文件预览（方案 C2/C3）

| 项 | 说明 |
|---|---|
| `render/line-diff.ts`（新） | 两段文本 → 行级 hunk：剥公共前后缀、LCS 求最小编辑、只留 context 行、段间 `…`；行数与单元上限兜底 |
| `render/line-diff.test.ts`（新） | 6 项：单行改动的上下文窗口 / 新建 / 删除 / 完全一致返回空 / 超行截断 / 超限走粗粒度 |
| `message-row/artifact-cards.tsx` | 逐文件渲染（路径行 + `+N −M`），路径行是按钮 → `FilePreviewSheet`（文本/图片/markdown，走 `mobile.readFile`） |
| `styles/190-disclosures.css` | `button.chat-tool-diff-path` 只清按钮外观，**不重复引用 `--text-secondary`**（令牌有独立用量预算） |

## 验收（三片合起来）

| 项 | 结果 |
|---|---|
| typecheck / build | 0 / 0 |
| 全量 mobile | **2526 通过 / 25 红 / 1 expected**（25 红 = 基线，未新增） |
| 页面实测（390×844 真机等价） | 展开时间轴顺序 `think→tool→think→tool…`（60 行）；过程头文案「12 次工具调用 · 改 2 个文件」 |

## 未测 / 残留

- **C1（工具详情面板）未做**：工具行现在点开只展开原始参数；「输出文本 + 状态 + 耗时 + 改动文件 + 跳 diff」的底部面板是下一片，需要先在 fold 里保留 `tool/result` 的输出（`ToolCallInfo.output`，截断 32KB / 200 行）。
- diff 卡的逐文件/预览路径**单测覆盖、真机未点到**：当前会话的历史投影不带 `view`（`changedFiles` 来自 `metaPaths`），页面上没有可展开的 diff 卡。

---

## 切片 78：任务头瘦身 + 过程条收口（2026-11-10 用户三连）

用户口径：「鲸鱼尾下方的"改x个文件"删掉，不再显示；鲸鱼尾这一行和过程条靠近一点，第一原则是视觉上排版更舒服」；
紧随其后：「过程条右侧的这个圆环，可以删掉，没有任何作用」。

| 改动 | 说明 |
|---|---|
| `ui/turn-header.tsx` | 运行中的元信息行不再报「改 N 个文件」——文件数全页只在**过程条头**报一次；`done` 态仍只在 0 改动时说「未做改动」 |
| `--palm-turn-pad-b` | 10px → 4px（`tools/` 令牌层，骨架同高） |
| `.chat-proc` | `margin-top: var(--palm-s1)` → `0` |
| 环形进度 `.palm-proc-ring*` | **整体删除**：组件（含 `steps` 入参 + `--palm-proc-ratio` 行内变量）、370-v21 样式、360-reduced-motion 动画、关键帧、结构测试的运行时变量豁免 |

实测（390×844 真机等价，Playwright 量 `getBoundingClientRect`）：

| 度量 | 改前 | 改后 |
|---|---|---|
| 状态条底 → 任务头底（`--palm-turn-pad-b`） | 10px | **4px** |
| 任务头底 → 过程条顶（`.chat-proc` margin） | 4px | **0** |
| 两者合计视觉间距 | 14px | **4px** |
| 页面上的 `.palm-proc-ring` | 1 个/组 | **0** |
| 任务头里出现「改 N 个文件」 | 是（运行中） | **否** |

门禁：typecheck 0 / build 0 / 全量 mobile **2526 通过 + 25 红（基线）+ 1 expected**；
`tokens-golden` 因令牌值变更已按 `PALM_UPDATE_TOKENS=1` 重刷基线（并说明理由：间距收窄 + 工作树里既有的令牌增补）。

## 未测 / 残留

- 过程条头现在剩「计数 + 报错 + 文件数 + ▸」，四段挤在 28px 行里；**长文案 + 320px 窄屏**没再压缩验证（`process-line-truncation` 3 项仍是基线红）。
- 环形进度删掉后，「这一轮走到第几步」只剩展开体首行的「共 N 步」；没有别处补进度感，这是用户明确的取舍。

---

## 切片 79：排队消息「已发送还在排队」的根因（投影层合并）

用户实拍：消息已经变成正文里的用户气泡，底部却仍显示「1 条排队」+ 同一行的「已插入 1 条补充消息」。

**根因**：宿主 inbox 里同一条消息**同时挂在两个列表**——`next-turn`（queued）与 `next-step`（steering）。
「立即发送」把它插进这一轮之后，`next-turn` 那份是陈旧的，但投影不会立刻删。客户端各画各的，于是一条消息出现两份。

| 层 | 修法 |
|---|---|
| 宿主投影 `queueItemsOf` | 同文 steering 存在时丢掉 queued 那份 —— 所有客户端（含老 bundle）拿到的就是干净的一份 |
| 客户端 `visibleQueue` | 兜底判据：queued 行同文 + 已在对话 + 队列里有同文 steering ⇒ 不画（判据取窄，避免误伤「同一句话再排一次」） |

测试：`src/host/queue-inbox-steering.test.ts` 3 项、`session-status.test.ts` +2 项。

## 切片 80：排队面板压高度 + 超过 1 条默认折叠

| 改动 | 说明 |
|---|---|
| 头行 / 正文行 | 44 → **32**（新增令牌 `--palm-queue-row-h`，令牌文件不计入 cssPx 预算） |
| 命中区 | 正文行用 `::after` 上下各补 6（`--palm-queue-row-hit`），视觉 32、命中仍 44 |
| 间距 | 列表 gap / margin 6px → `var(--palm-s1)`；面板内边距 4px 12px → 2px 10px |
| 折叠 | **超过 1 条默认收起**（只留「N 条排队 ▸」），点计数展开；**只有 1 条时不折叠**（不必多点一次） |

`queue-dock.test.tsx` 14 项：新增「3 条默认收起 → 展开 → 收起」「1 条不折叠」；旧「一次可见」契约按新口径改写。

## 顺带修掉的工具链地雷：CSS 生成器未转义

在 CSS 注释里写一个带反引号的类名（`` `.queue-dockCount` ``）后，`gen-mobile-css.mjs` 直接把它拼进模板字符串 ——
整份 `mobile-styles.ts` 不再是一个字符串，`mobileCss` 被推成 `number`，6 个样式测试一起红、typecheck 失败。

修法：生成器统一转义 `\` / 反引号 / `${`（运行时 CSS 字节不变），`freshness` 测试同步按同一规则比对。

## 验收

| 项 | 结果 |
|---|---|
| typecheck / build | 0 / 0 |
| 全量 mobile + host | **2541 通过 / 25 红（基线）/ 1 expected** |
| 页面 | 无 queue 时 dock 为 0、无页面报错；环形进度 0 |

---

## 切片 81：C1 工具详情面板（参数 / 输出 / 状态 / 耗时 / 改动文件）

用户：「C1 工具详情面板（输出文本 + 状态 + 耗时 + 改动文件 + 跳 diff）这个事情也实现一下」。

| 层 | 改动 |
|---|---|
| fold `render/messages.ts` | `ToolCallInfo` 新增 `output` / `startedAt` / `endedAt`：`tool/result` 的文字块按 200 行 / 20k 字符截断保留（以前**直接丢弃**），调用与结果两个事件 time 留在行上算耗时 |
| `components/tool-detail-sheet.tsx`（新） | 底部面板：状态 + 耗时（毫秒/秒/分三档）→ 参数（格式化 JSON）→ 输出 → 改动文件（路径行 + 该文件真 hunk，点路径开文件预览） |
| `message-row/process.tsx` | 工具行**整行可点 + 右侧 ›**，点开打开面板；参数改挂 `data-step-args`（长按菜单「复制命令」从属性读，不再依赖行内 pre） |
| `views/ChatView.tsx` | 长按菜单的 `command` 改从 `data-step-args` 读 |

样式零新增类名：复用 `.sheet-*` / `.chat-tool-diff-*` / `.chat-tool-args`（后者本来就有 200px 上限 + 滚动）。

测试：`tool-detail-sheet.test.tsx` 6 项（耗时三档 / 状态+参数+输出 / 真 hunk + 点开预览 / 无 sessionId 不可点 / 运行中不假装有输出与耗时）；
`render/messages-tool-output.test.ts` 3 项（结果文字 → output、失败也留输出、空结果不塞空串）。

真机实测（390×844，Playwright）：展开过程条后点第一条工具行 → 面板标题「运行命令 · List mojibake comment lines」、状态「完成」、参数为格式化 JSON；行右侧 › 可见；无页面报错。

## 未测 / 残留

- **历史回放的旧行没有 output**：只有新到达的 `tool/result` 才会填，老会话的行面板里「输出」段是空的（参数/状态仍在）。
- 面板里「改动文件」的 diff 最多 40 行（`maxRows`），超长改动只给前 40 行 + `…`；要看全文走点路径后的文件预览。

---

## 切片 82：排队条按钮收小 + 工具图片缩略条（过程条里直接看图）

### 1. 待发队列两颗按钮（用户：太大了、不协调、要排版对齐）

| 项 | 改前 | 改后 |
|---|---|---|
| 立即发送 | 74×30 | **66×26** |
| ⋯ | 44×30（横向胶囊） | **28×26（近方形）** |
| 垂直对齐 | 两者各自居中，高度不一致 | 同一 top/bottom（675/701），32 头行里上下各留 3 |
| 命中区 | 30 + 7×2 = 44 | 26 + 9×2 = 44（`--palm-queue-btn-hit`） |

实测（Playwright，390×844）：`buttons: [{w:66,h:26},{w:28,h:26}]`，`top` 都是 675。

### 2. 工具图片（C1 的 S1–S4）

用户：「预期是可以在过程条里预览得到图片，像桌面端 dsh 里那样」，定版 **缩略图放在标题行下一行**，并且要做 S4。

| 片 | 实现 |
|---|---|
| S1 数据 | `ToolCallInfo.images`；`applyToolResult` 用 `imagesFromContent` 折 `tool/result` 的 image 块 |
| S2 过程行 | `message-row/tool-images.tsx`：标题行下 `chat-msg-images` 缩略条（最多 3 张，折叠态也显示，无图不占位） |
| S3 详情面板 | 面板里同一条 `ToolImages`（最多 8 张） |
| S4 路径出图 | 参数 `file_path/path/filePath/target`、`metaPaths`、diff 路径里的图片扩展名 → `readFile` 取 dataUrl（缓存键带 sessionId） |

点图全屏复用 ChatView 既有 lightbox（任意 `<img>` 点击），CSS 零新增类名。

真机实测：`查看图片 · ...\delivery-open.png` 行下面出现缩略图（`data:image/png;base64,…`），无报错。

### 3. 顺带查清「交付文件打不开」

不是所有文件都打不开：真实存在的文件都正常（png 显示图片、源码显示 diff）。
打不开的是**已删除的临时脚本**：`doc21.mjs`/`doc22.mjs`/`smoke-tool.mjs`/`probe-*.mjs` —— 我图省事写在仓库里又删了，宿主的这一轮改动记录仍列着它们，点开 `readFile` 自然失败。
整改：临时脚本一律写到 `%TEMP%`，不落仓库。

---

## 切片 83：排队条根治 H1 + C1a（读己之写）

按 `docs/queue-root-fix.md` 方案 A 开工。

### H1 宿主：写操作带回权威队列

| 改动 | 位置 |
|---|---|
| 上下文新增 `readQueue`（读活 agent 内存 inbox + 版本） | `mobile/api/session-handlers.ts` |
| `sessionPrompt` / `sessionUpdateQueue` 成功后把 `{queue, queueVersion}` 挂进应答 `result.value` | 同上（`attachQueue`） |
| `dispatch()` 接受 `readQueue` 并接到这两个 handler | `mobile-api.ts`（`liveInboxOf` + `queueItemsOf` + `bumpQueueVersion`） |

老宿主/未装 agents 服务时 `readQueue` 缺省 → 应答保持原样（兼容）。

### C1a 客户端：把权威队列当定论

| 改动 | 位置 |
|---|---|
| `applyQueueAck(sessionId, ack)`：`{queue, queueVersion}` 直接落仓（走既有版本栅栏） | `stream/session-store.ts` |
| `prompt()` / `updateQueue()` 返回 `QueueAck \| undefined` | `data/impl/session.ts` |
| 发送成功：应用应答队列；权威队列里出现本条的 `requestId` 时**当场**撤掉乐观项（不再等 45 秒 TTL） | `views/chat/hooks/use-chat-composer.ts` |
| 编辑/删除/插队：应用应答队列；只有老宿主没带时才退回 `refreshInbox({fresh:true})` | `views/chat/hooks/use-queue-actions.ts` |

### 测试

| 文件 | 内容 |
|---|---|
| `mobile/api/session-handlers.test.ts`（新，4 项） | 两个写操作带队列；无 `readQueue` 时不塞空队列；宿主无 `value` 时原样返回 |
| `mobile/stream/session-store-ack.test.ts`（新，4 项） | 应用、老宿主不应用、版本栅栏、空队列也是权威事实 |

门禁：typecheck 0、build 0、`src/mobile src/host` = 2566 通过 / 25 基线红 / 1 expected。

### 真机状态（重要）

真机抓包显示 `session.prompt` 应答里 **`hasQueue: false`** —— 因为 DSH 宿主进程仍在跑**旧构建**的插件（服务端代码要重启才生效，`/m/` 静态资源不需要）。
旧路径（`refreshInbox` 兜底）仍然工作：发送后 400ms 内出现「1 条排队」，删除后立刻消失。

**待办**：重启 DSH 后复验 —— 预期 `hasQueue: true`、`queueLen: 1`，且发送/删除无需等投影。

### 重启后真机复验（2026-11-10 23:40，PID 28540）

| 场景 | 应答 | 界面 | 结论 |
|---|---|---|---|
| 回合空闲时发送 | `hasQueue:true, n:0` | 不出现排队条（正确：直接开跑） | 权威真值 |
| 回合进行中发送 | `hasQueue:true, n:1`（带 `requestId`） | **+250ms 出现**「1 条排队」 | 不等投影 |
| 删除排队 | `hasQueue:true, n:1`（2→1） | 头部立刻变成「1 条排队」 | 不等投影 |

### 复验中发现并修掉的第二个 bug（关键）

第一次复验：应答已经带队列，界面却**一动不动**。根因不在宿主：

`queueView()` 在会话**已有快照**时优先读 `snapshot.queue`（历史页带进来的那一份），
而 `applyQueueAck()` 当时只写了 `fallbackQueue` —— 被快照挡住了。真机表现就是
「写入成功、界面不动」。

修法：`applyQueueAck()` 同时覆盖 `snapshot.queue`（权威应答一定比手里的快照新），
并补一条回归测试（`session-store-ack.test.ts` 第 5 项：先 applySnapshot 再 applyQueueAck，
断言视图从「快照旧队列」变成「权威新队列」）。

顺带确认：`QueueCard` 才是当前挂载的排队卡（`QueueDock` 由它引入），旧探针查的 `.queue-dock` 仍然有效；
重启前的 DOM 是 15:39 那份启动时缓存的旧 bundle，重启后才换成当前构建。

门禁：typecheck 0、build 0、`src/mobile src/host` = 2567 通过 / 25 基线红 / 1 expected。

### C1b-1：删掉乐观排队行（2026-11-11 00:05）

读己之写落地后，乐观排队行成了"多出来一条要跟权威结果对齐的假行"——整条链路删掉。

| 删除项 | 位置 |
|---|---|
| `QueueIntent` / `OptimisticQueueItem` 类型 + `optimistic` 字段 | `stream/session-status.ts`、`stream/session-store.ts` |
| `QUEUE_OPTIMISTIC_MS`（45s TTL）与 `optimisticAlive()` | `stream/session-status.ts` |
| `addOptimisticQueueItem()` / `dropOptimisticQueueItem()` | `stream/session-store.ts` |
| 发送前创建乐观项、成功/失败时撤回的三处调用 | `views/chat/hooks/use-chat-composer.ts` |
| `local-` 前缀分支（本地项不走宿主 RPC） | `views/chat/hooks/use-queue-actions.ts` |
| `visibleQueue` 里的乐观项去重与 FIFO 排序 | `stream/session-status.ts` |

测试同步：删掉 17 条只测乐观项生命周期的用例（`session-status.test.ts`、`session-store.test.ts`、`ChatView.test.tsx`），
`use-chat-composer.test.tsx` 的两条断言改成「不再画乐观项、只留底稿与提示」。

### 真机复验（同一次会话，无重启）

| 观察点 | 结果 |
|---|---|
| 回合进行中发送 | 56ms 时条上已有第 1 条（上一条的权威结果）；第二条的应答到达后 **284ms** 从「1 条」变「2 条」 |
| 列表折叠 | 2 条时自动折叠成「2 条排队 ▸」，点开才逐行显示 |
| 删除 | 两次删除后 `dock=0`，全程无幽灵行 |

结论：去掉乐观项后，排队条仍然"点下去就到"（本机 RPC 往返 40~300ms），不再有假行与真行并存的一帧。

门禁：typecheck 0、build 0、`src/mobile src/host` = 2550 通过 / 25 基线红 / 1 expected（删除 17 条乐观项用例）。

### C1b 剩余（按此顺序）

1. 隐藏表 + 90s TTL（`hideQueueItem` / `QUEUE_HIDDEN_MS`）：删除/插队改由应答队列直接反映，隐藏表只服务 `turn/start` 认领。
2. 空队列观察窗（`emptyHold` / `QUEUE_EMPTY_HOLD_MS`）：权威队列为空就是空。
3. 文本判据（`spoken()` / steering 同文 / `legacyQueue`）：身份链已通，改为按 `requestId` 判定。

### C1b-2 / C1b-3：隐藏表与空队列观察窗下线（2026-11-11 00:20）

读己之写（C1a/H1）之后，排队条上剩下的两套"补丁"都是同一个假设的产物——「应答不可信，得靠时间和文本猜」。
假设不成立，补丁就一起拆：`claimQueueHead()` 认领头行后直接把它从快照里摘掉，`applyQueueMutation()` 把
删除/插队/编辑的 RPC 成功当作事实写回（**不是猜**，是宿主已接受），`queueView()` 只按 id 去重。

| 删除项 | 位置 |
|---|---|
| `QUEUE_HIDDEN_MS` / `hidden` / `hiddenAt` / `hideQueueItem()` / `unhideQueueItem()` | `stream/session-status.ts`、`stream/session-store.ts` |
| `QUEUE_EMPTY_HOLD_MS` / `emptyHold` | 同上 |
| `spoken()` / steering 同文判据 / `legacyQueue` 文本规则 | `stream/session-status.ts` |
| `lastUserTextOf()` / `userTextsOf()` | `stream/session-store.ts` |
| `local-` 前缀与 `hideQueueItem` 调用 | `views/chat/hooks/use-queue-actions.ts` |

`use-queue-actions.ts` 现在是每条动作一个形状：`const ack = await updateQueue(...)` →
`applyQueueAck()` 成功就用应答收敛，失败才 `applyQueueMutation()` 兜底并 `refreshInbox({ fresh: true })`。

测试同步：`session-status.test.ts` 删掉 hidden / emptyHold / spoken 三组；`session-store-ack.test.ts` 增加 3 条
`applyQueueMutation` 用例（remove / steer / edit），共 8 条。全库删除 41 条只测旧补丁的用例。

门禁：typecheck 0、build 0、`src/mobile src/host` = 2526 通过 / 25 基线红 / 1 expected。

### 过程条计数：数字滚动（2026-11-11 00:45）

用户两轮拍板：先「只要记分牌的动效，不要记分牌本身的样式」，再「改成那种数字滚动动效」。
落地成 `ui/flip-number.tsx` + `styles/370-v21.css` 的 `.palm-roll`：

| 决定 | 做法 |
|---|---|
| 没有牌面 | 无底板/边框/中缝，数字继承颜色、字号、字重 |
| 滚动而非翻牌 | 竖直轨道，向上滚过中间数字（3 → 7 真的经过 4、5、6），480ms |
| 静止时 DOM 干净 | 滚完 540ms 塌回单独一格 —— 复制、读屏、断言拿到的都是 `82`，不是 `0123456789` |
| 只动变化的那位 | key 从个位往左编，9 → 10 只滚个位 + 冒出新十位 |
| 读屏 | 滚轮 `aria-hidden`，读屏走调用方的 `aria-label` |
| 减弱动效 | 组件内 `matchMedia` 直接落值 + `360-reduced-motion.css` 里 `transition: none` 双保险 |

样式预算：新增 4 个类名（`.palm-roll` / `-track` / `.is-gliding` / `-cell`），换掉上一版的 4 个翻牌类名，
`cssClasses` 停在 800 以内（先超到 801，靠去掉 `.palm-num` / `.palm-num-sep` 两个包装类压回去）。

基线对齐：滚轮窗口 `1.25em` + `vertical-align: -0.35em`（11px 字号下实测数字与中文同一基线，见
`docs/screenshots/proc-line-roll3.png`）。

门禁：typecheck 0、build 0、`src/mobile src/host` = 2533 通过 / 25 基线红 / 1 expected（新增 4 条滚轮用例）。

未测：真机 iOS Safari 上滚轮的实际观感（桌面 Chrome 与模拟 390 宽已验）；工具计数连续跳变时的连滚合并。
### 输入区元信息：上下文圆环可点 + 明细小卡片（2026-11-11 01:15）

用户：「右下角这个上下文圆环点不了，点一下要弹一个小圆框显示明细」。

| 改动 | 位置 |
|---|---|
| `.chat-meta-ctx` 从 `<span>` 改成 `<Button>`（aria-haspopup=dialog / aria-expanded，点按压暗反馈） | `views/chat/components/composer-meta.tsx` |
| 点开渲染只读卡片：已用/窗口、占比/剩余、分档提示（<70 正常 / ≥70 提醒 / ≥90 收口） | 同上 |
| 关闭：再点圆环、点遮罩（复用 `.chat-picker-scrim`） | 同上 |
| 卡片容器复用 `.chat-picker-panel`，只新增 `.chat-meta-pop` 一个类收窄成右侧小卡 | `styles/240-composer-pills.css` |

类名预算 800 已满，按预算测试的要求在同一 commit 说明理由并上调到 801（`platform/quality-budget.ts`）。
注意 `240-` 早于 `250-picker.css` 加载，单类选择器压不住 `.chat-picker-panel` 的 `left/right`，所以用 `.chat-picker-panel.chat-meta-pop` 双类。

测试：`composer-meta.ring.test.tsx` 从 4 条加到 8 条（按钮语义 / 明细内容 / 再点与遮罩关闭 / 无投影时给一句人话且不出现 NaN）。

门禁：typecheck 0、build 0、`src/mobile src/host` = 2540 通过 / 25 基线红 / 1 expected。
#### 修正：弹窗时整屏边缘白色留白（2026-11-11 07:35）

第一版为了让「点外面关闭」好按，铺了一层 `position: fixed; inset: 0` 的遮罩按钮 —— 那是这一轮
**唯一新增的全屏固定层**。手机上出现全屏 fixed（且它还是个按钮，点完会拿到焦点）时，浏览器会重算
可视视口，边缘就露出底色。这与 `ui/sheet.tsx` 里早就写过的那条结论同源：「不锁 body 滚动，避免
重算 dvh」。

改法：**不铺任何全屏层**。关闭改由文档级 `pointerdown`（目标不在卡片与圆环之内）＋ `Escape`；
卡片 `ref` 与圆环 `ref` 各自判边界。

本机（Chrome，320/360/390/393/412 宽）复测：`scrollWidth == clientWidth`、`html/body` 背景均为深色、
弹窗不越界；真机上的白色留白我这边复现不出来，所以这一版是「去掉最可疑的那一层」而不是「抓到了现场」。

测试：`composer-meta.ring.test.tsx` 加到 9 条，新增「不再存在 .chat-picker-scrim」「点卡片内部不关闭」。

踩坑：预算测试的 `rawButtons` 会数源码里的 `<button` 字面量，连**注释里**提到它也算 —— 注释里改写成
「按钮元素」后才通过（与「勿按以为的结构写判据」那条教训同形）。
#### 对齐修正 + 报错数字滚动（2026-11-11 07:45）

用户两件事：①「x 次工具调用 / 改 x 个文件」里的数字和后面文字没有水平对齐；②「x 处报错」的数字也要同款滚动。

**对齐的根因不是 em 值调不准，是裁切方式选错了。** 按 CSS 2.1，`overflow` 不是 `visible` 的
inline-block，**基线取盒子底边**（取不到里面文字的基线）。所以数字被顶高，只能拿 `vertical-align`
猜一个 em 值去补；em 依赖字体度量，桌面调好、手机字体不同又歪。

改成 `clip-path: inset(0)`：裁切效果一样，但**不改变基线**，这一格就按普通文字的规矩对齐。
实测（393 宽、4x）：滚动格子 `clip-path: inset(0px)` / `overflow: visible` / `vertical-align: baseline`；
数字字形底与「次工具调用」文字底同为一行（`digitBottom === textBottom`）。

报错数字：`ProcessLine` 新增 `splitLeadingCount()`，把宿主给的 `N 处报错` 拆成「数字 + 后缀」，
数字走 `FlipNumber`；拆不开（没有前导数字 / 只有数字）就原样输出。`aria-label` 仍用拼接后的纯文本。

测试：`process-line.test.tsx` 10 → 12 条（报错数字是滚动格、文案与读屏一字不变；非「数字+后缀」原样输出）。
### 交付卡两处修正（2026-11-11 07:55）

**① 「有的文件点开显示客户端没找到这个文件」。**

现场：工具把路径写成**相对它自己 cwd** 的形式（例：`ui/sheet.tsx`，真实位置
`packages/dsh-palm/src/mobile/ui/sheet.tsx`）。预览请求原样把这串发给宿主，宿主按会话 cwd /
宿主 cwd / 工作区根都拼不出来 → `file-unreadable`。

两层修：

| 层 | 改动 | 位置 |
|---|---|---|
| 手机 | `absolutePathOf(path, tool.metaPaths)`：用同一工具结果里的**绝对路径按路径段**后缀匹配（不是字符串后缀，`ui/x` 不会命中 `xui/x`），配上就用绝对值；配不上原样发 | `message-row/artifact-cards.tsx`（导出）+ `components/tool-detail-sheet.tsx` 两个入口都用 |
| 宿主 | `readCandidates` 最后兜底：相对路径且按基准目录都不存在时，在工作区里按**路径段**找唯一同名文件；**歧义（两个同名）不猜**，宁可继续报找不到。索引带 60s 缓存、跳过 `node_modules/.git/dist` 等、深度 8 / 2 万文件上限 | `host/directory.ts` |

**② 「有时候运行过程中会弹出来这个交付物卡片」。**

交付卡是**收工物**，但时间轴在运行中就渲染它，每写一次文件重画一次（3 → 11 个文件）。
改为 `model.outcome === 'running'` 时不画；收工后一次性出现。运行中的进度仍由工具行与
折叠行计数表达。位置：`message-row/process.tsx` 的 `ProcessRows`（`running` 进 useMemo 依赖）。

验证：真机上「当前运行中的过程卡」展开后 `.chat-artifact` 数量 = 0（改前会随写文件出现）。

测试：新增 `message-row/artifact-cards.test.tsx`（4 条：后缀匹配 / 绝对路径不改写 / 配不上不编造 / 按段比）、
`host/directory-suffix.test.ts`（2 条：深层同名文件能兜底 / 两个同名文件不猜）、
`message-row-process-group.test.tsx` 新增 2 条（运行中不画卡、收工后出现）。

门禁：typecheck 0、build 0、`src/mobile src/host` = 2551 通过 / 25 基线红 / 1 expected。

注意：宿主那层要**DSH 宿主进程重启**才生效；手机端（meta 绝对路径那层）杀掉 PWA 重开即可。
### 侧边栏「运行中」徽标不消失（2026-11-11 08:05）

用户：「任务都结束了，侧边栏那里还是显示进行中，这是状态没同步上吗？」——是，而且是**设计上的滞留**。

`session.list` 的花名册是**快照**（枚举一次 6~23 秒，TTL 60 秒 + 刷新节流），行上的
`running` 是枚举那一刻的值。收工后最多还要滞留一个 TTL，抽屉每次打开读的又是这份快照。

两层修：

| 层 | 改动 |
|---|---|
| 宿主 | `sessionList` 出页前对 `running === true` 的行做**现场核对**（`correctStaleRunning` + `computeTurnState`，与会话页状态条同一套证据规则）；只查这几行，不改快照本身；核对抛错时保留原值（宁可短暂显示运行中，也不把真在跑的说成停了） |
| 手机 | mux 收到 `turn/start` / `turn/end` 时**即时**改抽屉里那一行的 `running`（`App.tsx` 的 `patchDrawerRunning`），不等下一次枚举 |

顺带修掉一处类型谎言：`visibleSessionRows` 的返回类型写成 `{updatedAt, sessionId}`，运行时明明带着
`running` / `cwd` / `projections`，编译器却看不见 —— 改成 `RosterItem[]`。

测试：`mobile/api/session-list-running.test.ts` 3 条（只核对运行中的行 / 确实在跑就保留 / 核对抛错保留原值）。

门禁：typecheck 0、build 0、`src/mobile src/host` = 2554 通过 / 25 基线红 / 1 expected。

实测：`session.list` 5ms、40 行里 2 行 running —— 一行是当前会话，另一行（"梳理 dsh palm 源码问题评估"）
经查确实在跑（lastEvent 1 秒前），不是假徽标。
### 秒表跳变：把修正从屏幕前拦下来（2026-11-11 08:35）

用户：「计时有时候会跳变，依然没有根本解决」。

上一轮的修法是**数据层**的（锚点只许变早、宿主时钟单调收敛），都对；但这两条修正会**直接怼到
屏幕上**，于是用户看到的是数字在跳：
① 锚点被纠正得更早（重连/翻页后认得真起点）⇒ 读数一下跳几十秒；
② 宿主时钟每帧按 20% 收敛 ⇒ 读数被往前推/往回拽几秒；
③ 收工那一瞬从"实时读数"切到 `durationMs` ⇒ 可能再跳一次。

新增**显示层** `message-row/turn-clock.ts`：

| 规则 | 行为 |
|---|---|
| 目标超前（锚点变早 / 时钟往前） | 最多 2 倍速追，绝不一步跳到新值 |
| 目标落后（时钟往回拽） | 同样最多 2 倍速回落（不一步掉下去，也不把旧值焊死） |
| 首帧兜底锚点 | 差 > 10 秒且 1.5 秒内 ⇒ 直接对齐（宁可首帧就对，别让用户盯着一分钟错的数字） |
| 收工定格 | 与屏幕最后值差 ≤ 5 秒取较大值（不往回缩）；差得多以 `durationMs` 为准 |

`artifacts.tsx` 的状态条读数全部走这一层；`durationMs` 走 `settleElapsed`。行卸载才清记录
（收工定格还要用）。

测试：新增 `message-row/turn-clock.test.ts` 8 条；`message-row.test.tsx` 的"锚点被纠正"一条从
「立即变 5分30秒」改成「这一帧仍是 5分10秒，随后按倍速追上」，并在用例开头清掉上一组的锚点记忆。

门禁：typecheck 0、build 0、`src/mobile src/host` = 2562 通过 / 25 基线红 / 1 expected。
### 顶栏「代理 N」压住会话标题（2026-11-11 08:50）

用户截图：「代理 4」盖住标题末尾「评估」。

根因是**布局**：`.mobile-header` 是三列网格 `48px minmax(0,1fr) 48px`，运行徽标放在右槽
（定宽 48px）里，而徽标本身约 57px 宽 —— `justify-content: flex-end` 把超出的 9px 顶到左边，
正好落在标题文字上。实测（393px 视口）：标题框 x=56..337，「代理 4」x=282..339、竖向
y=75..95 与标题 y=64..90 重叠。

改法：徽标移到**标题下面那一行**（工作区名那一行），右槽只留 ⋯。

| 位置 | 改前 | 改后 |
|---|---|---|
| 标题 | 与徽标重叠 | 独占整行（超长自动省略号） |
| 第二行 | `dsh-palm` | `dsh-palm · 代理 4`（徽标可点，打开运行详情） |
| 右槽 | 徽标 + ⋯（48px 挤两个） | 只有 ⋯ |

配套：
- `.mobile-titlePath` 从纯文本行改成 flex 行（复用同一个类，**不加新类**，预算不动）；
- 徽标视觉高度只有 18px，用 `::after { inset: -13px -10px }` 把点击目标扩到 ~44px；
- `runBadgeBits()` 从 `RunBadge` 里抽出来给 `ChatView` 用：顶部只在真有内容时才传 `run`，
  否则第二行会多一个孤零零的 `·`（实测确实出现过）。

测试：`chat-header.test.tsx` 新增「运行徽标画在标题下面那一行：右槽只剩 ⋯」。

截图：`docs/screenshots/hdr-badge2.png`（改前/改后对比）、`hdr-live.png`（真机样式）。
### 侧边栏会话顺序老在变（2026-11-11 09:05）

用户：「每次打开这个侧边栏，会话列表里的会话顺序为什么老是变？」

真因不在宿主排序，而在**抽屉自己排了两次、规则还不一样**：

| 时刻 | 以前的行为 |
|---|---|
| 打开瞬间（本地缓存） | 把当前会话 `unshift` 到第一行，**其余不排序** |
| 约 1 秒后（宿主页到达） | `mergeDrawerRows` 整表按 `updatedAt` 重排 |

当前会话如果不是最新的那条，就会在一秒后从第一行掉回真实位置 —— **每次打开都掉一次**，
看起来就是"顺序老是变"。另外排序没有同刻兜底，同一份数据在极端情况下也可能换个顺序。

改法：抽屉的排序收成**一个函数** `orderDrawerRows`（`views/drawer-rows.ts`）：

- 当前会话钉在第一行（用户能在最上面找到自己正在看的）；
- 其余按 `updatedAt` 从新到旧，同刻按 `sessionId` 兜底（同一份数据永远同一个顺序）；
- 打开时的第一帧和刷新后的合并都走它（`mergeDrawerRows` 也加了 `pinnedSessionId`）。

测试：`views/drawer-rows.test.ts` 新增 4 条（钉住当前会话 / 同刻稳定 / 第一帧与刷新同序 / 钉子不在列表时退回纯时间排序）。

顺带记下两个"顺序还会变"的合法来源，免得下次又当成 bug：
① 你正在用的会话 `updatedAt` 一直在前进（它被钉在第一行，所以看不出来）；
② 花名册是 60 秒快照，别的会话刚跑完时，它下一次打开才会浮上来。
### 通知条太高：唤醒消息从"卡片"改成"一行"（2026-11-11 09:10 / 09:40 两次收紧）

用户先带截图问「这个任务通知条占的位置空间太大了，高度需要收缩」，收紧一轮后又说「继续修这个
任务通知条占用空间过大问题」——说明还是太占地方。

诊断：它照抄了桌面端 `TurnTriggerNodeView` 的**卡片**规格（16px 圆角、描边、代码块灰底、
12px 内边距），外层又加了 14px 上下边距（当初为了"离周围文字远一点"）。一条几乎没有信息量的
通知，在手机上占掉 74px。

第一轮（改数值）：头部 40px、边距 14→6、圆角 16→12、灰底去掉 → 单条 54px。
第二轮（改形态）：它根本不是卡片，是**通知行** → 无描边、无灰底、无圆角、内边距 4px 2px、
字号 12px 次要色、时间 11px → **行高 28px**。

| 项 | 原始 | 第一轮 | 现在 |
|---|---|---|---|
| 卡片/行高 | 46px | 42px | **28px** |
| 上下边距 | 14 + 14 | 6 + 6 | 0（交给列表 12px 节奏） |
| 单条纵向占地 | **74px** | 54px | **40px（−46%）** |
| 外观 | 灰底圆角卡 | 透明描边卡 | 无框通知行（整行可点开正文） |

其余"条/卡"逐个体检（同一台真机、同一个会话）：`.chat-command` 38px、`.chat-status-strip`/
`.chat-finished-strip` 44px 透明条、`.chat-load-older` 44px、`.chat-proc-head` 44px、`.chat-search`
6px 内边距、`.mobile-error` 纯文字、`.chat-queue` 固定高 `--palm-dock-queue-h` —— **只有唤醒卡超标**。

截图：`docs/screenshots/trigger-compact.png`（两条相邻通知行的实际渲染，393×851、DPR 3；
拍法：断开 SSE 防自动滚动，再把两张卡克隆进 `position:fixed` 层截图）。
### 排队消息"发送失败"却已排队成功（2026-11-11 09:20）

用户：「有时候会出现一个提示排队消息发送失败，发送内容撤回到发送框里面，但其实排队消息已经在排队发送成功了」。

链路：点发送 → `session.prompt(mode=queue)` 等待 30 秒（`SUBMIT_INFLIGHT_MS`）→ 超时 → 走失败分支
（**失败不清草稿**，所以输入框里还留着原文，看起来就是"撤回到发送框"）→ 先核实再报错。

上一版核实的三个漏洞：

1. **只查一次**：客户端 30 秒超时的同一时刻，宿主可能正卡在队列写入，查得比写快 ⇒ 查不到 ⇒ 报失败，
   几秒后排队条又出现；
2. **核实请求自己也在抖**（同一条隧道）⇒ 抛错 ⇒ 被当成"没送到"；
3. **4xx 明确拒绝也在等核实**：宿主回 403 就是拒收，没必要再花 8 秒。

现在的行为（`views/chat/hooks/use-chat-composer.ts`）：

| 情形 | 结论 | 界面 |
|---|---|---|
| 队列里有这个 `requestId`，或正文尾部已有这条 | `delivered` | 按成功收尾（清草稿/附件），提示「已排队…」 |
| 读得通、但队列和正文都没有 | `absent` | 报失败（撤乐观项、**保留草稿**） |
| 一次都没读成功 | `unknown` | **不谎报失败**：只提示「消息可能已送出，正在确认…」 |
| 宿主明确回 4xx | 直接 `absent` | 立即报错（`isConclusiveRejection`，省掉 8 秒） |

- 核实按 `VERIFY_DELIVERY_BACKOFF_MS = [0, 600, 1200, 2400, 4000]` 重试（≈8 秒），跨过一次隧道抖动；
- `unknown` 之后后台再确认三次（5s / 12s / 25s）：队列里真出现了就把**还留在输入框里的同一段文字**收掉
  （`inputRef` 比对，用户改过就不动）并补一条正常回执 —— 用户抱怨的"内容又回到发送框"就此收口。

测试：`use-chat-composer.delivery.test.ts` 新增 10 条（requestId 命中 / 晚一拍重试后命中 / 全读不通→unknown /
确证没到→absent / 正文尾部证据 / 前缀匹配 / 探针三态）。`ChatView.test.tsx` 的"失败保留草稿并报错"保持绿灯
（4xx 走明确拒绝分支）。

预算：`src/mobile`、`src/mobile/views`、`src/mobile/shared` 三项按仓库机制加了 `dirsRaised`（带理由与
`expires: 2026-12-11`）；下一步把送达核实拆成独立模块时逐项回落。

### 切换工作区面板重做（2026-11-11 10:05）

用户带截图：「现在这个工作区选择界面，太不优雅了，我想重构一下」。批准方案 A（分组 + 短路径 + 搜索 +
当前项置顶），并要求「最近用过」「＋新建」都要。

老实现是**把后端数据原样铺出来**：`workspaces.map()` 每行写完整绝对路径（长路径折两行、单条 ~90px）、
同名工作区（`ICNA3611` ×2、`ICNT9388` ×2）只靠长路径区分、11+ 个平铺无分组无搜索、当前项没有标记。

新结构（`views/chat/components/workspace-picker.tsx` + `workspace-picker-model.ts`，纯函数与渲染分离）：

| 段 | 内容 |
|---|---|
| 搜索行 | 常驻输入框（名称 + 路径都匹配）+ 清除按钮 + 「＋ 新建」，**不占列表高度** |
| 当前 | ✓ + 浅色底 + 完整路径 + 「N 个会话」；永远第一组 |
| 最近用过 | 按 `updatedAt` 倒序取 3 条（不含当前），右侧「今天 / 昨天 / N 天前」 |
| 项目分组 | 组标题 = 父目录尾巴（如 `ICNT9388 · 1.Code`）+ 数量；单条组内不再重复写父目录（一行 44px） |
| 计数 | 列表末尾一行「共 N 个工作区」 |

关键规则（都有单测）：
- 同名工作区的副标题取**最短能分开的父目录尾巴**（`00.master` / `06.DP523`），一级不够自动加一级；
- 搜索命中时副标题给**父路径**（`D:\work`），不再给被过滤后算出来的单段（`work`）；
- 搜索时不再分「当前 / 最近」，只剩命中项；
- 当前工作区未知（空会话页）时不硬造一个「当前」组。

新建工作区：面板内联表单（路径输入 + 取消/创建并切换），走 `workspace.create` → 刷新 `workspace.list` →
直接切过去；失败文案贴在输入框下（`role="alert"`），不弹到页面错误行。

顺带修的两个真机问题：
- 搜索框默认 `outline` 在深色面板上是一圈白框，比输入框本身还显眼 → 改 `outline: none` + 1px 强调色细边；
- 底部「共 N 个 / ＋ 新建」原本是 sticky，会盖住最后一行 → 改成搜索行常驻「＋」+ 列表末尾一行计数。

预算：`cssClasses 801 → 821`、`cssPx 1269 → 1284`（新增 `.ws-*` 21 个类；行内文字复用
`.sheet-option-copy / -title / -desc`，提示复用 `.sheet-note / .sheet-error / .sheet-confirm-actions`），
`dirs.src/mobile`、`dirs.src/mobile/views` 按实测上调并保留 `dirsRaised` 理由。

测试：`workspace-picker-model.test.ts` 12 条（路径整形/去重尾巴/相对时间/搜索/分组/空态）、
`workspace-picker.test.tsx` 9 条（当前组、最近用过、点击回调、搜索与清除、空态、新建成功/失败、密度）。

截图：`docs/screenshots/workspace-picker-live.png`（真机尺寸 393×851、DPR 3，真实 34 个工作区）；
设计稿 `docs/mocks/workspace-picker-a.html` + `docs/screenshots/workspace-picker-a.png`。
#### 补丁：每行的「重命名 / 删除」（同日 11:30）

API 层早就有 `workspace.rename` / `workspace.delete`（allowlist 里也都在），但**一个 UI 都没接**——
用户只能改配置文件或者忍着。这一片把它们接进面板。

- 每行右侧一个「⋯」（`aria-label="更多操作：<名字>"`，`aria-expanded` 跟着状态走）；
- 点开后在**行内展开**两个动作：`重命名` / `删除`。为什么不用浮层菜单：真机上浮层会盖住下面的行
  （第一版就是浮层，截图里直接压住下一行的「workspace / 5 天前」），而且容易被滚动手势抢走；
  行内展开只多 48px，谁也挡不住；
- 重命名：输入框预填当前名字，**名字没改就不让提交**（省一次宿主往返）；提示「只改列表里的显示名，磁盘目录不动」；
- 删除：**两步**——先展开确认页，写明「只从列表里摘掉 <绝对路径>，磁盘上的目录不会被删」，确认按钮是危险色；
- 删的正好是当前工作区：删完自动落到剩下的第一个（否则页面会停在一个已经不存在的目录上）；
  删的是别人：页面不动，只刷新列表。

三个写操作（新建/改名/删除）都收进 `views/chat/hooks/use-workspace-actions.ts`：`App.tsx` 只留一行
`const workspaceActions = useWorkspaceActions({...})`，行数从 1419 → 1420（预算 1422 以内）。

样式上的两个坑（都是截图看出来的，不是推断）：
1. `.ws-row-wrap` 一开始是 `display:flex` 没有 `flex-wrap`，动作条被挤在同一行、压在 meta 上；
   加了 `wrap` 之后「⋯」又被挤到第二行独占一行（行高 140px）——最终把「⋯」改成绝对定位在行右上、
   `.ws-row` 占满整行并留出右侧内边距，行高回到 48 + 动作行 48；
2. `.ws-create-submit[data-danger]` 只换了底色，没换字色，深色主题上红底黑字看不清 → 补 `--palm-on-accent`。

测试：`workspace-picker.test.tsx` 从 9 条加到 14 条（菜单展开、重命名预填、未改动不提交、删除确认页、
删除失败留在确认页、当前工作区的删除项带标注）。样式棘轮：`cssClasses 821 → 826`（行内动作 3 个类 +
行容器 2 个），`--shadow-lg` 用量回到 6（菜单浮层删掉后改回 `--palm-shadow`）。

截图：`docs/screenshots/workspace-actions-inline.png`（行内展开）、`workspace-delete-confirm.png`（删除确认）。
#### 补丁：面板一打开就抢搜索框焦点（同日 11:40）

用户报「切到选择工作区的时候，为啥会直接进搜索框，这不合理」。根因不在面板里，在**共享的焦点陷阱**：

`ui/focus-trap.ts` 的 `useFocusTrap` 在浮层挂载时聚焦「第一个可聚焦元素」。工作区面板的第一个可聚焦元素
正好是搜索输入框 —— 手机上聚焦输入框等于**召唤软键盘**，键盘把面板顶掉一半，看起来就像"一打开就在搜索"。
（这也解释了之前截图的怪异：桌面 headless 不弹键盘，所以一直没暴露。）

修法：新增 `initialFocusWithin()`，优先挑第一个**不弹键盘**的控件（按钮/链接），只有面板里确实
没有别的控件时才退回输入框（纯输入对话框行为不变）。面板本身不改一行。

顺带：搜索时底部计数从「共 34 个工作区」换成「找到 N 个工作区」—— 列表只剩 3 行却写着 34，
用户会以为漏了。

验证（真机尺寸实测）：打开面板后 `document.activeElement` = `BUTTON.ws-search-new`（＋新建），
`inputFocused: false`，按钮上没有焦点环（`box-shadow: none`）；手动点搜索框仍能正常输入（输入 `dsh`
→ 3 行）。单测两条钉住：① 面板首个控件是输入框时焦点落在下一个按钮；② 面板里只有输入框时仍然聚焦输入框。

顺带修掉 `tools/budget.json` 里 **`dirsRaised` 重复出现两次**的问题（JSON.parse 只保留最后一个，
前 12 条上调记录的 reason/expires 实际是死的）。现在合并成一块，15 个键都生效。

样式/行数棘轮：`dirs.src/mobile 64018 → 64044`、`dirs.src/mobile/ui 2529 → 2554`（均带 `dirsRaised` 理由）。

截图：`docs/screenshots/workspace-open-no-focus.png`（刚打开、未点任何输入框）。
#### 补丁：折叠分组 + 短组标题 + 搜索高亮（同日 12:00）

用户问「这个页面还有可以优化的地方吗」，我给了 4 条并获批全做。真机数据是 **34 个工作区 / 16 个项目组**。

| # | 改前（截图可见） | 改后 |
|---|---|---|
| 1 | 16 个项目组全部展开：一屏 6 行、滚动 2.7 屏（scrollHeight 2676 / 视口 741） | 项目组**默认折叠成一行组头**（36px，▸ + 名称 + 上一级 + 数量），点开才展开；滚动降到 1266（1.7 屏），一屏看到 **10 组** |
| 2 | 每行都挂「⋯」，整列 34 个点 | 折叠后只有当前 / 最近用过 / 已展开组才有「⋯」；首屏从 34 个降到 **4 个** |
| 3 | 组标题是两级父路径：`01.Code\00.Master` | 标题只取**最后一级**（`00.Master`），上一级变成右侧浅色提示（`01.Code`） |
| 4 | 搜索命中处没高亮 | `<mark class="ws-mark">` 加底色（标题 + 副标题路径都标） |

实现要点：
- 分组的**键**仍用完整父路径（`projectKey`），标题只是它的最后一段（`projectLabel`）+ 上一级（`projectHint`）——
  否则 `D:\a\1.Code\X` 和 `D:\b\1.Code\Y` 会因为最后一级同名被并成一组（有测试钉住）；
- 折叠状态是 `Set<groupKey>`，**搜索时强制全展开**（结果本来就少，要的是立刻看到命中项），
  且此时组头退化成纯文字（不装成可点按钮）；
- 高亮用 `highlightMatch()` 切片返回 `{text, hit}[]`，不用正则拼 HTML —— 路径里的 `\` 不会被吃掉（有测试）；
- 顺带把「展开的组头」高度从 40 压到 36px，一屏又多一组。

测试：模型 12 → 18 条（短标题/提示/分组键不合并、高亮切片、反斜杠保真），组件 14 → 17 条
（默认折叠、点开收起、搜索时不折叠、命中高亮）。

棘轮：`dirs.src/mobile 64044 → 64226`、`dirs.src/mobile/views 19271 → 19385`、`cssPx 1284 → 1290`、
`cssClasses 826 → 831`。

截图：`workspace-collapsed.png`（默认折叠）、`workspace-expanded.png`（展开两组）、
`workspace-search-highlight.png`（搜 `dsh` 命中高亮）。
#### 补丁：折叠状态记住（同日 12:15）

上一片留下「折叠状态不跨次记住」的尾巴，这一片补掉。

- 新文件 `views/chat/components/workspace-picker-store.ts`：`readExpandedGroups()` / `writeExpandedGroups()`，
  键 `dsh.palm.wsExpanded.v1`（与 display-prefs 的 `dsh.palm.*` 同前缀，带 `.v1` 便于改编排格式）；
- 存储格式 `string[]`（组键 = `project:<完整父路径>`）；**坏数据 / 不是数组 / 隐私模式 / 配额满**一律按
  「没有记录」处理，绝不因为缓存把面板弄崩；上限 200 条，超出丢最早的；
- 面板初始化从它读，展开/收起时写回。

真机实测（同一浏览器上下文）：展开 2 组 → `localStorage = ["project:其它","project:D:\\work"]`；
关掉面板再开 **7 行**（2 组保持展开）；整页 reload（≈ 杀掉 PWA 重开）后仍是 7 行。

顺手修掉一个视觉瑕疵：面板打开时焦点落在「＋」上，而这个按钮原来没有 `:focus-visible` 规则，
用的是系统默认白环（深色面板上比按钮本身还亮）→ 补 `outline: var(--palm-focus) solid var(--palm-accent)`。

测试：存储层 4 条（读写往返、无记录、坏数据、上限），组件 +2 条（展开后重新挂载仍展开、收起后被记住）。
棘轮：`dirs.src/mobile 64226 → 64285`、`dirs.src/mobile/views 19385 → 19437`、`cssPx 1290 → 1291`。

截图：`workspace-collapse-remembered.png`（重新打开后仍是上次展开的两组）。
#### 补丁：鲸尾后面的空白（同日 12:30）

用户报「有时候鲸尾尾动效后面没有显示文案，显示的是空白」。先把「鲸尾后面到底写了什么」逐状态清点成
可执行规格（`ui/turn-header.strip-text.test.tsx`，6 条：真渲染、按 `[data-part=label|detail|right]` 取文字），
结论是 **12 种状态里只有 1 种会空白**：

| 状态 | 鲸尾后面的字（主文案 | 灰字 | 右侧） |
|---|---|---|
| think / read / edit / test | 思考 / 读文件 / 改文件 / 跑测试 · N 步 | — | 耗时 |
| approve | 等你决定 · N 步 | — | 耗时 |
| stuck | 还在等 · N 步 | 比平时慢一点 · 也可以停止后重发 | 耗时 |
| idle | 空闲 · N 步 | 等你发话 | 上一轮多久前 |
| **unknown（改前）** | **空白** | **空白** | 没有开始时间时也没有 |
| done | 完成 · N 步 | 未做改动（仅无改动时） | 耗时 |
| failed / stopped / queued | 失败 / 已中断 / 排队中 · N 步 | — | 耗时 |
| 抽屉迷你条 | 等审批 / 运行中 / 完成 | — | — |

空白成因链：`STRIP_WORD.unknown = ''`（2026-11-10 「不要『状态未知』这种说法」时留的空）
+ `StatusStrip` 对空 label 连 `<b>` 都不画 + `stripDetail` 对 unknown 返回 undefined
+ `headerDuration` 在 `turnStartAt` 缺失（重开 PWA 看老会话、快照还没到）时也是 undefined
⇒ 一整行只剩灰鲸尾。

改成（方案 A）：
- `STRIP_WORD.unknown = '确认中'`（陈述"在等宿主回话"，不假装在跑、也不再留白）；
- `stripDetail`：unknown 且**没有任何时长**时补灰字「还没收到这一步的结果」；有时长就不叠这句，
  时间本身已经说明"还在走"。

连带更新三处旧契约断言（它们写死了"unknown 一个字都不写"）：`turn-header-unknown.test.tsx`、
`chat-rows-hydration.test.tsx`（2 处）、以及新加的 `turn-header.strip-text.test.tsx`。

棘轮：`dirs.src/mobile 64285 → 64295`、`dirs.src/mobile/ui 2554 → 2564`。
#### 补丁：正文图片显示不出来（同日 13:00）

用户截图：正文里一行灰牌子「方案 A未找到 · /C:/Users/Administrator/…/workspace-picker-a.png」，
图没出来。**那个文件是存在的**（`docs/screenshots/workspace-picker-a.png`）。

根因：路径多了一个**前导斜杠** —— `/C:/…`。在 Windows 上它也算"绝对路径"，
`path.resolve('/C:/x.png')` 得到 `C:\C:\x.png`，stat 落空 → 报「主机上找不到这个文件」。
这个写法来自我自己写进消息里的 markdown 图片引用（`![…](/C:/…)`）。

两处都归一化（只剥「斜杠 + 盘符」，POSIX 的 `/home/…` 不动）：
- 前端 `render/markdown.ts`：`stripLeadingSlashDrive()`，`localImagePath()` 返回前先归一化
  —— 这条改完刷新即可生效，**不需要重启宿主**；
- 宿主 `host/directory.ts`：`normalizeAuthoredPath()`，`readCandidates()` 入口先归一化
  —— 纵深防御（顺手也能救「文件链接点开找不到」的同类写法）。

验证：
- 真机同上下文（393×851）：修复后 `document.querySelectorAll('.md-img-missing')` = **[]**，
  原先那几条消息的 `data-local-src` 已变成 `C:/…`，`src` 是 `data:image/png;base64,…`；
- RPC 直测：`mobile.readFile` 对 184 KB 的 PNG 返回 245746 字符 data URL，
  在页面里 `new Image()` 解码出 **1179×2553** —— 说明取字节、解码、CSS 尺寸这条链路本身没问题；
- `docs/mocks/body-image-states.html` + `docs/screenshots/body-image-states.png` 把三态钉成静态稿
  （已加载 361px 宽 / 读字节中的 96×56 占位 / 找不到的灰牌子）。

顺带记录一条排查事实：正文图片是 `loading="lazy"`，**不在视口里时 `naturalWidth` 就是 0**，
所以"离屏元素量出 0×0"不代表图坏了 —— 别照这个下结论。

测试：`markdown.test.ts` +1（前导斜杠归一化，POSIX 不被改写）、`directory-suffix.test.ts` +2
（`/C:/…` 能落到真文件、`normalizeAuthoredPath` 只剥盘符形态）。
棘轮：`dirs.src/mobile 64295 → 64311`、`dirs.src/mobile/render 6963 → 6979`。
#### 补丁：排队条不稳定 + 发送失败误报（同日 13:20）

用户两个症状：「点完发送，排队条要退出来刷新才出现，有时候直接消失」+「还经常发送失败，内容回撤到输入框」。
查下来是**两个各自的根因**，不是显示层抖动。

**根因 A：队列版本被"读"推进了。**
`mobile-api.ts` 的 `readQueue` 每读一次就 `bumpQueueVersion()`。写操作应答因此永远带着最新号，
客户端把它当权威记进 `entry.queueVersion = N`；而宿主**真正入队**后推来的投影帧/快照版本仍是 N
（`queueVersionOf` 没事件不动）→ 客户端按「版本不大于已应用值就丢弃」的栅栏把它挡在门外
→ 界面锁在应答那一刻的空队列上。退出会话再进会把版本基准清空（`resetQueueBaseline`），
所以"退出来刷新一下"就好了。

修：
- `host/queue-inbox.ts` 新增 `queueVersionForRead()`：**只有队列内容真的变了才 +1**（与
  `stampQueueVersion` 同一套指纹）；
- `mobile-api.ts` 的 `readQueue`：改用上面这个；且**读不到活 agent 时返回 `undefined`**，
  不再冒充「队列是空的」（空的"权威"应答最毒：清空 + 锁版本）；
- `session-handlers.ts` 的 `attachQueue`：`readQueue` 返回 undefined 时保持应答原样；
- 客户端 `session-store.ts`：`applyQueueItems` 加 `allowEqual`，**写操作应答允许同版本覆盖**
  （它是刚现读的活队列），投影/轮询仍走严格大于 —— 这样"版本相同但内容更全"的应答也能落地，
  点完发送排队条立刻出现。

**根因 B：投递身份桥从没接上。**
`rememberRequestBody`（把客户端 `requestId` 绑到宿主队列行 id）早就写好了，但**没有任何调用点**
（只有 import 和 re-export）。于是队列行永远不带 `requestId`，而客户端的送达核实
`probeQueueForRequest` 只认身份 → 一律 `no` → 8 秒后 `verifyDelivered` 判 `absent`
→ 报"发送失败"、草稿留在输入框。**可那条其实已经排队成功**：回合在跑，正文还没进历史，
`logTail` 那层文字兜底也查不到。用户每次在我干活时发消息都会撞上。

修：
- `session-handlers.sessionPrompt`：投递前后各读一次队列，按 id 取差集，新出现的行
  `rememberRequestBody([[requestId, id]])`；
- `probeQueueForRequest` 增加正文旁证：身份对不上时，宿主队列里有同文一行也算送到
  （读的是宿主队列，不含本地乐观项，不会自证）；
- `verifyDelivered` / 后台确认都带上正文。

测试：`session-handlers.test.ts` +2（新行记上 requestId；老客户端不乱报）、
`session-store-ack.test.ts` +2（同版本应答要收；投影同版本仍不许回写）、
`use-chat-composer.delivery.test.ts` +2（无 identity 时按正文判定；正文不符不算送到）。

棘轮：`files.src/mobile-api.ts 1652 → 1663`、`dirs.src/mobile 64311 → 64372`、
`src/mobile/api 3696 → 3727`、`src/mobile/stream 2411 → 2424`、`src/mobile/views 19437 → 19454`。

**生效条件**：客户端部分刷新页面即可；宿主三处（`mobile-api` / `session-handlers` / `queue-inbox`）
要**重启 dsh 宿主**才生效。
#### 补丁：「最近用过」漏掉天天在跑的工作区（同日 13:55）

用户：「工作区切换界面还是不合理，有的工作区我一直在跑，却没有显示在最近使用这一栏」。

根因：那一栏按 `workspace.updatedAt` 排序，而**这个字段跑会话不刷新**（只在建工作区/改名时动）。
实测同一宿主上的真实数据：

| 工作区 | workspace.updatedAt | 该工作区最活跃会话 |
|---|---|---|
| `D:\work\dsh_dev` | 11-06（5 天前） | **11-11 今天** |
| `D:\steam` | 10-29（13 天前） | **11-11 今天** |
| `test_stylus_tx_rx_merge` | 11-06 | 11-10 |

于是最近用过里挤着 5 天/13 天前的工作区，真正在跑的反而沉到项目分组里。

改法（活动时间改从**会话**算）：
- `workspace-picker-model.ts` 新增 `workspaceActivityOf(workspaces, sessions)`：按 `sessionIds`
  归属优先、`cwd === path` 兜底，取每个工作区里最新一次会话活动；`buildWorkspaceGroups` 增加
  第 5 个参数 `sessionActivity`，与 `workspace.updatedAt` **取大**后排序与显示相对时间；
- 新增 `views/chat/hooks/use-workspace-activity.ts`：面板打开时才拉一页 `session.list`，
  关上不请求；失败退回原行为（按 `workspace.updatedAt`），不会因此打不开面板；
- `WorkspacePicker` 新增可选 prop `sessionActivity`；`App.tsx` 接一行 hook（App 仍卡在
  1422 行上限内：删掉一行注释 + 合并两处连续空行来平衡）。

真机实测（393×851，34 个工作区）：
- 改前「最近用过」= `test_stylus_tx_rx_merge / workspace / ICNT9388`（都是 4–13 天前的）
- 改后 = **`dsh_dev`（今天）/ `ICNA3611`（今天）/ `steam`（今天）**

测试：模型 +3 条（旧 updatedAt 但今天有会话 → 排第一且标「今天」；`sessionIds` 归属优先于
`cwd`；没有活动信息时退回原行为）。

棘轮：`dirs.src/mobile 64372 → 64510`、`dirs.src/mobile/views 19454 → 19592`。
截图：`workspace-recent-by-activity.png`。
#### 补丁：抽屉底部改成分组卡片 + 用量搬成独立页（同日 14:35）

用户两件事：①「侧边栏下面 设置/交付物/用量 有点不协调不美观，重新设计」；②「点用量并没有显示
coding plan 套餐用量，而是跳进了设置栏，应该把设置里那一个模块移进这个入口」。

**① 底部入口（C 版：分组卡片）**

原来：三行等高、只有两行带右小字（`12` / `本机`），右边缘参差；行间只隔 4px，看起来就是
会话列表多出来的三行。

现在：小标题「工具」+ 一块 `--palm-sur-2` 圆角卡片，三行各 44px（图标 / 文案 / 右侧补充 / 箭头），
行间发丝线，按下态用 `--palm-sur-1`。选择过程留了四版效果图（`docs/mocks/drawer-footer-options.html`
+ `docs/screenshots/drawer-{now,a-grid,b-more,b-sheet,c-card,d-top}.png`），用户选了 C。

结构改名：`.palm-drawer-entry` → `.palm-drawer-tool`（+ `.palm-drawer-tools` / `.palm-drawer-tools-title`），
`session-drawer-layout.test.tsx` 的三条版式断言跟着改成新类名与新图标数（7 / 8）。

**② 用量独立页**

- 新增 `views/UsageView.tsx`（132 行）：`settingsLayout` 骨架 + 返回键 + 右上「刷新」，
  进页即渲染每个提供方的卡片（近 5 小时 / 本周两条窗口、重置时间、近 7 天请求数与每日明细），
  `unsupported` 的提供方不渲染，失败给「重试」。
- 路由新增 `kind: 'usage'`（`ROUTE_DEPTH: 1`、hash `usage:<workspaceId>`、抽屉底部「用量」直接进）。
- `SettingsView.tsx` 里整块移出（764 → 721 行）：删掉 `fetchUsage` 调用、四个 usage state、
  `refreshUsage`、搜索索引里的「用量」命中与 `<UsageSection>`；分组注释改成「进阶 · 关于」。
- 测试搬家：`SettingsView.test.tsx` 的 3 条用量断言 → 新建 `UsageView.test.tsx` 5 条
  （进页即见两条窗口 / 刷新走 `fetchUsage(true)` / unsupported 不渲染 / 真实重置时间 / 失败重试）。

真机实测（393×851）：抽屉底部「工具」卡片三行正常；点「用量」直接进用量页，
`ollama pro` 显示近 5 小时 26%、本周 60.5% · 余 39.5%、近 7 天 24,783 次；`modelflare` 如实显示
「API Key 无效或没有权限（401）」（真实数据，不是渲染问题）。

棘轮：`files.UsageView.tsx 132`（新增）、`SettingsView.tsx 764 → 721`（瘦身，cap 下调）、
`dirs.src/mobile 64510 → 64689`、`dirs.src/mobile/ui 2564 → 2575`、`dirs.src/mobile/views 19592 → 19687`、
`quality.cssPx 1291 → 1294`、`quality.cssClasses 831 → 836`；`styles/510-usage-page.css` 新增。
截图：`drawer-c-live.png`、`usage-page-live.png`。
#### 补丁：皮肤商店（入口 A 方案）+ 试穿不落盘（同日 15:05）

用户拍板：①皮肤入口用 A（设置首屏第一组），不加抽屉第 4 行；②不做首启引导；③不做
「跟随桌面端皮肤」；④每张卡片显示来源与作者 + 许可。

**结构**

- 新增 `platform/skin-catalog.ts`：名字 / 一句话说明 / **来源署名** / 是否内置。
  以后从 dsh-skin-market 移植皮肤 = 加一条目录 + 加一块色板，运行时逻辑不动。
- 新增 `views/settings/SkinStoreSheet.tsx`（117 行，全屏浮层）：两列卡片网格 + 底部
  「取消 / 用这一套」。**试穿**用新增的 `previewSkin()`（只 `applySkin`、不写 localStorage），
  「用这一套」才 `setSkin()` 落盘；卸载时若没确认就还原进店那套。
- 入口：`SettingsView` 首屏第一组「皮肤 · 换一套配色与气质」→「皮肤商店」行
  （`当前 石墨 · 点进去当场试穿`）。抽屉「设置」行右侧同步显示当前皮肤名（读 `SKIN_LABEL`）。
- 外观页把「皮肤」分组移走（皮肤只留一个入口），该页只剩字号 / 密度 / 明暗；
  设置页里那行改名「字号与密度」，说明改成「字号、密度、明暗在一页里调（皮肤在上一组）」。

**为什么要试穿**：皮肤决定整屏底色 / 气泡 / 强调色，缩略图选不准。真机验证：
点「纸」→ `html[data-skin]=paper`、`localStorage` **仍为 null**；点「取消」→ 回到 graphite；
点「用这一套」→ `localStorage=paper`、整页立刻变浅色。

**颜色不写进组件**：卡片预览块用 `data-skin` + `000-tokens.css` 里既有的
`--palm-skin-*-bg/-ink` 映射（`styles/520-skin-store.css`），不写裸色、不用行内样式——
`inlineStyles` 仍是 8 以内，`--accent-contrast` 用量没涨（勾选圈用 `--palm-on-accent`）。

测试：`SkinStoreSheet.test.tsx` 5 条（试穿不落盘 / 取消还原 / 应用落盘 / 来源署名 ×3 /
预览块带 `data-skin`）；抽屉与设置页各一条按新结构改断言。全量 2675 通过 / 243 文件。

棘轮：新增 `SkinStoreSheet.tsx 117`、`skin-catalog.ts 57`；`SettingsView.tsx 721 → 743`；
`dirs.src/mobile 64689 → 64997`、`views 19687 → 19791`、`ui 2575 → 2576`、`platform 4479 → 4548`；
`quality.cssPx 1294 → 1312`、`cssClasses 836 → 849`。

**遗留**：`515-five-screens.css` 里的 `.palm-spec-skin*` 规则现在没人用了（外观页不再画皮肤卡），
下一轮连同 `--palm-spec-swatch` 一起删，能再收回 40 多条规则。
截图：`skin-entry-live.png`、`skin-store-live.png`、`skin-store-try-paper.png`、`skin-applied-paper.png`。
#### 皮肤包第一件：报纸（newsprint）移植（同日 15:35）

用户选了 B（风格包），先拿 dsh-skin-market 里的 `2754LM/dsh-theme-newsprint`（MIT）做样板，
验证「装饰类皮肤也能搬」。

**怎么搬的（可复用的移植法）**

1. 桌面那份是 cordis 插件，改的是 `--dsw-alias-*`；手机端是另一套令牌与组件，**代码不复用，
   只搬"角色"**：`paper.base → --palm-bg`、`paper.raised → --palm-sur-1`、`paper.container →
   --palm-sur-2`、`ink.primary/secondary/tertiary → --palm-fg/-fg-2/-fg-3`、`accent.blue →
   --palm-accent`、`state.* → --palm-ok/-warn/-danger`。
2. 桌面皮肤里的 `alpha()` / 混色**提前算成字面量**（iOS 15 没有 `color-mix()`）：
   `--palm-search-mark #bdd1dc`、`--palm-danger-band #ead7d2`、`--palm-press-bg #efeadd` 等。
3. 颜色进 `000-tokens.css` 的 `html[data-skin='newsprint']` 块（与另外三套同构，契约测试要求
   每个颜色令牌都定义）；**字体与报头线进 `styles/610-skin-newsprint.css`**（颜色令牌表达不了的部分：
   衬线正文字族、标题 2px 墨线、分组标题字距、引用块竖线）。
4. 新增 `--palm-font-sans` 令牌（`:root` 指向桌面注入的 `--font-sans`，`010-base.css` 的 body
   改用 `var(--palm-font-sans)`）——这是"皮肤能换字族"的钩子，以后每套皮肤都能自己定字体。

**守卫同步扩展**（这轮最重要的副产品）

- `tokens-golden.test.ts`：基线从三套变四套，`newsprint` 与另外三套**键集必须一致**。
- `skin-contract.test.ts`：`it.each` 里补 `newsprint`（少一个颜色令牌就红）。
- `skin-contrast.test.ts`：六组对比度断言全部补 `newsprint`（AA 4.5、正文 7、断线带、淡底、
  第二层表面差 ≥1.07）。
- `SkinStoreSheet.test.tsx`：四张卡、预览块 `data-skin` 序列、以及**移植作品必须显示出处**
  （`来自 2754LM/dsh-theme-newsprint · MIT`）。

真机实测（393×851）：切到报纸后 `--palm-bg #f5f3ed`、`--palm-fg #1f0909`、`--palm-accent #065588`、
`body font-family` 解析到 Songti SC / Noto Serif CJK SC；聊天页与设置页都变成暖白纸面 + 衬线正文 +
报头墨线，无页面报错。商店里第四张卡预览正常（底色 / 气泡 / 输入条三块）。

棘轮：`dirs.src/mobile 64997 → 65117`、`platform 4548 → 4559`、`files.skin-catalog.ts 57 → 65`、
`quality.cssPx 1312 → 1315`；`styles` 目录新增 `610-skin-newsprint.css`。
截图：`skin-newsprint-chat.png`、`skin-newsprint-settings.png`、`skin-store-four.png`、
`skin-store-try-newsprint.png`。

**下一件**：纯配色类可以走同一套映射批量做（claude-style / bloom / 终末地）；装饰更重的
（玻璃、像素、复古门户）要单独评估——尤其玻璃质感在手机上要考虑老 Android WebView 的 blur 性能。
#### 补丁：正文里的图「还是没显示」（同日 16:00）

用户第二次反馈同一件事（15:41 真机截图）：正文两行灰牌子
「报纸皮肤下的聊天页未找到 · C:/Users/Administrator/dsh-source/dsh-palm/docs/screenshots/skin-newsprint-chat.png」，
可那个文件 15:26 就写好了。

排查结论（三件事都成立，所以不是路径也不是宿主）：

1. **宿主这条链路是好的**：拿主设备 cookie 直打 `POST /m/api/mobile.readFile`
   （路径就是牌子上那一条），本机回 `200`、448,999 字节；**走公网入口**
   （`https://123-56-228-146.nip.io:7001`）同样 `200`、1.7 秒、响应完整。
   ⇒ 「读不到」不是 `readCandidates` / 大小上限 / 隧道的问题。
2. **前端也已经是新包**：线上 `mobile/shared-B_qyuQtf.js` 里 `md-img-missing`、
   `data-local-src`、`md-local-img` 全在，逻辑与源码逐行一致。
3. **真凶是失败缓存只进不出**：`local-images.ts` 的 `failed` 是永久 `Set`，
   一次 `readFile` 失败（agent 常先写正文、几秒后才落截图）就把这张图钉死成牌子；
   而且 `dangerouslySetInnerHTML` 只在 HTML 字符串变化时重写子树，牌子替换掉 `img` 之后
   **任何重渲染都不会把 img 变回来** —— 用户除了整页重开没有别的路（截图里这一屏已经开了 13 分钟）。

改法（都在前端，刷新即生效）：

- `platform/local-images.ts`：失败记录带时间戳 + 人话原因，`isLocalImageFailed` 只在
  `LOCAL_IMAGE_RETRY_MS`（15s）内挡重复请求，过期允许再试；`clearLocalImageFailure()` 支持按会话/按路径清。
  失败原因由 `loadLocalImageUrl` 自己落账（超时 / 未配对 / 太大 / 不是图片 / 主机没有这个文件），
  调用方不再各自猜。
- `render/markdown-text.tsx`：
  - 牌子加 `data-local-alt`（重试成功后 alt 不丢）与可点语义；
  - 点牌子 / 一轮结束（`pending` 转 false）都会**把牌子还原成 `img`** 再敲一次重试脉冲
    （还原是必须的：见上面第 3 条）；
  - 牌子正文追加原因，「未找到」不再是唯一说法。
- `styles/150-chat.css`：牌子 `cursor: pointer`（可点）。

测试：`markdown-text.test.tsx` +4（点牌子重试、收尾自动重试、TTL 过期允许再试、牌子上写原因）。
棘轮：`dirs.src/mobile 65117 → 65267`、`platform 4559 → 4623`、`render 6979 → 7063`。

验证（这次全部用线上真包 + 真宿主 RPC，不再只看 jsdom）：

- 线上 `mobile.js?v=0d73919f`、`mobile/shared-De6FI-Wq.js` 已带 `data-local-alt` / 「点一下重试」；
- headless Chrome 393×851 + 主设备 cookie 打开 `?session=…&workspace=…`：那条消息的两张图
  `data-local-state=loaded`、`src` 是 `data:image/png;base64,…`，`.md-img-missing` = **0**；
- **点牌子重试的端到端**：把 `skin-store-four.png` 临时改名 → 页面加载出牌子
  「…未找到 · … · 主机上没有这个文件」→ 把文件改回来 → `chip.click()` → 4 秒后
  `chips=0`、两张图都 `loaded`。


**留待观察**：这次失败的具体触发（15:32:09 那一帧）没有直接证据 —— 宿主现在对同一路径
稳定返回图片，所以按「首次水合时文件/链路未就绪」处理。若再出现，牌子上会直接写原因
（如「读取超时」），一眼能分清是链路还是文件。

#### 皮肤移植器 port-skin.mjs + 第二件皮肤「终末地」（同日 16:15）

用户选了「先做翻译器（C），再批量做纯配色皮肤（A）」。

**`scripts/port-skin.mjs`（新增，约 600 行，零依赖）**

一条命令把市场里的桌面皮肤翻成手机端皮肤包：

```
node scripts/port-skin.mjs --repo owner/name --commit <sha> --id <标识> [--label 中文名] [--apply]
```

四步：①从固定 commit 拉源码（GitHub API 不稳时自动退回 PowerShell 的 Invoke-WebRequest）；
②抽「名字 → 色值」，认 hex / **oklch** / hsl 三种写法，也认 `paper: { base: "#…" }` 这种一层嵌套调色板；
③按映射表挑 8 个核心角色（bg / surface1 / surface2 / line / fg / fg2 / fg3 / accent + 三个状态色），
带 `L/D` 后缀的键按明暗挑档；④派生其余 40 多个令牌并做 WCAG 自检。

**这一版里踩出来、并写进脚本的三条硬约束**

- **方向校验**：桌面皮肤的 `bg-layer-1` 可能是另一个明暗档的值（终末地抽出来是深墨色，压在奶油纸上就是一块黑板）→ 浅色皮肤的卡片必须比底更亮，否则回落成派生值。
- **边框贴底**：线色与底的对比度必须在 1.02~3.4 之间，太深就变成黑边。
- **强调色两处都要过 AA**：既在底色上、也在自己的 10% 淡底上（终末地第一版 `#6b6700` 压在淡底上是 4.22，被 `skin-contrast.test` 当场拦下，压到 `#5f5b00` 才过）。

**第二件皮肤：终末地（endfield）**

- 来源 `ymh0000123/dsh-theme-endfield`（MIT，168★），奶油纸底 + 墨黑 + 信号黄 + 全直角。
- 用移植器一条命令生成：`bg #e8e8e2 / fg #101110 / accent #5f5b00（信号黄压到可读）/ r-m 12px`。
- 落盘三处：`000-tokens.css` 色板块（`--apply` 生成）、`skin.ts`（类型/中文名/提示/chrome/极性）、
  `skin-catalog.ts`（名字/说明/`来自 ymh0000123/dsh-theme-endfield · MIT`）。
- 装饰层暂时没做（终末地的「全直角」已由 `--palm-r-*` 令牌表达；工业编码字体没搬）。

**移植器对不同皮肤的适配度（实测）**

| 皮肤 | 写法 | 结果 |
|---|---|---|
| newsprint | 调色板对象 + 字面量 | **8/8 角色**，与手写版几乎一致 |
| endfield | 私有变量 + 明暗两档 | **7/8**（缺 line，已派生），一条命令出可用皮肤 |
| bloom | oklch 短键 + 14 个变体 | 能抽出真实调色板（bg/sf/sf2/accent），**变体选择还没做**（同一套皮肤有 14 种主色） |
| claude-style | 派生色 DSL（`tone` + `dl/dc/m`），几乎没有字面量 | 抽不到，需要人工映射（约 20 分钟/套） |

结论：**「纯配色皮肤批量自动生成」只对"写字面色值"的那一批成立**（约占市场三成），
oklch 系要加变体选择，派生 DSL 系（claude 那类）必须人工收尾。这条写进文档，避免下一轮再走弯路。

测试：全量 2700 通过 / 243 文件；`skin-contrast`、`skin-contract`、`tokens-golden` 三处守卫
都扩到 5 套皮肤（含 endfield）。棘轮：`dirs.src/mobile 65267 → 65344`、
`platform 4623 → 4633`、`files.skin-catalog.ts 65 → 72`。
截图：`skin-endfield-chat.png`、`skin-store-five.png`。

#### 状态词改「族 + 池 + 轮播」（同日 16:40，用户：那套文案还是很普通）

先看业界怎么做的，两条路：

| 派 | 做法 | 代表 |
|---|---|---|
| A · 动词池轮播 | 处理时随机显示一个 **-ing 动词**，2.1.322 版有 **187 个**（Pondering / Cogitating / Noodling / Flibbertigibbeting / Gitifying / Newspapering …），底下再轮播一条 Tip | Claude Code |
| B · 极简事实 | 几乎不玩词，只给「步骤名 + 耗时 + 工具卡」；反模式是「一个动画点 + Working on it」——用户分不清是慢还是死 | Cursor / Codex / Copilot / Devin |

两条关键结论（决定了做法）：

1. **灵动来自「换的机制」，不是词更漂亮**：那 187 个词一个都不高级（Baking / Booping / Honking），但它每次不一样；
2. **中文不能直译那批词**：社区译本把 187 条全译成「正在 + 动作」（正在大功告成 / 正在化为现实 / 正在采取行动），
   187 句同构，比原来 12 个标签更像公文。所以不能照抄，也不能跨族随机 ——
   我们的状态词**承担信息**（读/改/跑），族外随机会让用户立刻失去「它在干嘛」。

实现（`ui/turn-header.tsx`）：

- `STRIP_POOL: Record<kind, readonly string[]>`：进行中 4 族各 6 词
  - think `琢磨着 / 盘算着 / 捋一捋 / 过脑子 / 想辙呢 / 思考`
  - read `翻着 / 扒一扒 / 扫一眼 / 翻箱底 / 对细节 / 读文件`
  - edit `落笔 / 动刀 / 缝一针 / 改着 / 补一段 / 改文件`
  - test `跑着 / 试一遍 / 敲命令 / 等回显 / 验一下 / 跑测试`
  - 每族最后一个是保守兜底，轮播里也会出现；不写「正在…」（中文的 -ing 直译就是公文腔）
- 8 个关键档**一字不变、不起定时器**：`等你放行 / 静着 / 闲着 / 等回话 / 成了 / 没成 / 收了 / 排着`
  —— 这几档一抖就让人焦虑
- `STRIP_ROTATE_MS = 4_000`：每 4 秒前进一格；**步数变化也前进一格**（不必等满 4 秒）；
  **换一种动作（think → edit）回到本族首词** —— 不重置会让索引顺着上一个族走，
  真机实测切到 edit 首帧是「改文件」（族尾兜底词），看着像没生效；
- 尊重 `prefers-reduced-motion: reduce`：命中就不轮播（与鲸鱼动画同一个尊重）
- `stripWordOf(kind, tick)` 抽成纯函数，测试与快照都按它走

真机等价验证（headless 393×851 + 主设备 cookie，每 5 秒采一次状态条）：

| 采样 | done 行 | 进行中行 |
|---|---|---|
| t+0s | 成了 · 6分52秒 | test **跑着** · 5分30秒 |
| t+5s | 成了 · 6分52秒 | test **试一遍** · 5分35秒 |
| t+10s | 成了 · 6分52秒 | test **跑着** · 5分40秒 |
| t+15s | 成了 · 6分52秒 | think **琢磨着**（换动作回族首）· 5分45秒 |

测试：`turn-header.strip-text.test.tsx` 快照 12 档全量改写 +5（4 秒换词、关键档 20 秒不动、
步数前进换词、换动作回族首、取模不越界）；`turn-header.test.tsx` / `turn-header-unknown.test.tsx` /
`ChatView.test.tsx` / `chat-rows-hydration.test.tsx` 的旧词断言同步。
棘轮：`dirs.src/mobile 65344 → 65431`、`ui 2576 → 2641`；全量 3373 通过。
#### 补齐两处「换皮肤换不到」：圆角档位 + 语法高亮派生（同日 17:00）

上一轮自查发现：皮肤令牌能覆盖所有页面，但**圆角**与**代码高亮**两处不跟皮肤走。这一轮都补上了。

**① 移植器加 `--radius`（sharp / soft / round / pill）**

- `sharp` 2/4/6px、`soft` 8/12/18px（与石墨一致）、`round` 12/18/26px、`pill` 16/22/30px。
- 生成时写进皮肤块的 `--palm-r-s/m/l`，于是「直角工业」这类气质差异终于能表达出来。
- 终末地按 `sharp` 重出：实测 `--palm-r-m` 从 12px（石墨的）变成 **4px**。

**② 语法高亮从强调色派生**

- 原来 `--tok-*` 只有「浅色/深色」两套（`design/tokens.ts` 里的 Atom One 系），于是暖白/奶油底上配的是冷调通用代码色，代码块像贴上去的。
- 现在移植器按 `deriveSyntax(accent, bg, surface)` 生成 7 个 `--tok-*` 写进皮肤块，压在自己的代码块底色（`--palm-sur-2`）上过 AA 4.5；注释只要求 3.2。
- **关键设计**：语法角色用**固定色相**（紫 285 / 绿 130 / 橙 35 / 红 5 / 青 175），只借强调色的饱和度与明度。第一版试过「强调色色相加偏移」——蓝底皮肤（报纸）会得到绿色关键字 + 玫红字符串，像乱码，已否决。
- 报纸与终末地都补了：关键字 `#650d82`，字符串 `#0b731c` / `#0a6c1a`，函数 = 各自强调色（`#065588` / `#5f5b00`）。

**验证（真机仿真 393×851，逐皮肤读计算样式）**

| 皮肤 | `--palm-r-m` | 关键字 | 函数 | 代码块底 |
|---|---|---|---|---|
| 石墨 | 12px | `#c678dd` | `#61afef` | 深色 |
| 纸 | 10px | `#a626a4` | `#4078f2` | 浅色 |
| 报纸 | 8px | `#650d82` | `#065588`（海蓝） | `#fdfdfa` |
| 终末地 | **4px** | `#650d82` | `#5f5b00`（信号黄） | `#f5f5f2` |

代码块底色实测：终末地 `rgb(245,245,242)`、报纸 `rgb(253,253,250)` —— 浅色皮肤下代码块是浅底深字，
所以派生的深色语法色是对的（第一版预览页把面板伪装成皮肤导致看起来是深底，已废弃重做：
`docs/mocks/skin-code-colors.html` 改成三个 iframe，各自 `<html data-skin>`，层叠与 App 一致）。

棘轮：`dirs.src/mobile 65396 → 65418`；golden 基线含两套新语法色，已 `PALM_UPDATE_TOKENS=1` 重生成。
测试：全量 **2704 通过 / 243 文件**；typecheck 0；build 0。
截图：`skin-code-colors.png`（三套代码块并排）。

**已知抖动**：`ChatView.test.tsx` 全量跑时偶发 2–3 例失败（该套 242 例单跑 62 秒、隔离跑全绿），
属计时敏感，非本轮改动引入；重跑即过。
#### 点文件打开的是「源码」：预览路由 + 渲染/源码切换（同日 17:50）

用户报：「正文链接里/交付物里的 markdown 文件打开之后是源格式，能不能加个小按钮切换渲染/源格式」。
三层原因，一起修：

1. **入口全错位**：正文 `.file-link`、产物列表、产物摘要、交付详情四处点文件都是
   `navigate({ kind: 'diff' })`（`App.tsx`）—— 打开的是一个逐行源码页，对 markdown
   等于把文档当代码看。
2. **扩展名把定位尾巴算进去了**：`docs/x.md#L24`、`x.md?raw`、`report.md:24` 里的
   `#…` / `?…` / `:行号` 被 `lastIndexOf('.')` 算成扩展名的一部分（`md#l24`），
   于是 `isMarkdownPath` 判假 → 落到 `<pre>` 源码视图。
3. **尾巴还被原样发给宿主去读**：宿主按磁盘路径读文件，带 `#L24` 只会得到 ENOENT → 「文件不可读」。

改法：

- `views/App.tsx`：新增 `kind: 'preview'` 路由（页面栈深度与 diff 同层、key 带路径避免互相顶掉），
  四处点文件改走它；渲染的就是 `FilePreviewSheet` —— 与正文点按、工具卡点按同一个组件。
- `components/file-preview-sheet.tsx`：
  - `extensionOf()`：先剥 `#…` / `?…` / `:行号` 再取扩展名，md/html/语言判断全用它；
  - `readPathOf()`：**读文件前**也剥尾巴（否则 ENOENT）；
  - markdown 多一个「源码 / 预览」小按钮（默认渲染，换文件复位），
    `TextPreview` 收 `source` 开关，源码档复用原有的高亮/纯文本分支。
- `render/markdown.ts`：新增 `localPathOf()` —— 正文里 `[说明](本机路径)` 直接渲染成 `.file-link`。
  原来 `C:/x.md` 被 `safeUrl` 当成非法 scheme `c:` 丢掉（只剩点不动的纯文本），
  `docs/x.md` 则变成站内链接、点了 404。

验证（headless 393×851 + 主设备 cookie，点的是正文里真实渲染出来的 `.file-link`，
data-path 改成 `README.md#L24`）：

| 状态 | 观察 |
|---|---|
| 点开 | sheet 出现，`fp-path` 是**剥掉尾巴的**真实路径；`h1 = dsh-palm`、109 个 `<li>`、4 个表格 → 渲染稿；按钮写「源码」 |
| 点「源码」 | 渲染块消失、按钮变「预览」、`data-view=source` |
| 再点「预览」 | 回到渲染稿 |

截图：`docs/screenshots/preview-md-rendered.png`、`preview-md-source.png`。

测试：`file-preview-sheet.test.tsx` +3（带尾巴的 md 仍渲染 / 渲染↔源码切换 / 只有 md 有按钮）、
`markdown.test.ts` +4（本机路径链接、外链与站内路由不受影响、`localPathOf` 洗路径）、
`App.page-stack.test.ts` 补 `preview` 路由样本。本轮涉及的 10 个测试文件 **376 通过**。

**已知限制**（不是这次引入）：`[![badge](图)](链接)` 这种「图包在链接里」的写法仍渲染成文字，
所以 README 顶部的 shields 徽章显示为 `![npm version]` 而不是图片。

全量：**3391 例里 3387 通过**；4 个失败全是并行的皮肤改动（`000-tokens.css` 同期被改、
golden/契约基线尚未同步），与本轮无关。

#### A2：移植 claude-style（当日 18:00）

来源 `Nwflower/dsh-claude-style`（MIT，556★，市场里最红的一套），做法是**用移植器 + 三条人工兜底**，
全程约 25 分钟，其中工具修 bug 占了大半。

**翻译过程（一条命令）**

```
node scripts/port-skin.mjs --repo Nwflower/dsh-claude-style --commit c49419ee --id claude \
  --label Claude --hint "米白纸面 + 陶土橙，像 Claude 桌面" --radius soft \
  --set fg=#161616 --set line=#e7e2dd --apply
```

它的调色板在 `packages/client/src/theme/tokens.json`：`palette.cards[]` 每张卡给
`accent / canvas{light,dark} / sidebar / bubble / link / code / edges`，其余是 `tones[]`（种子里算出来的派生色，
没有字面量）。这一轮给移植器补的能力：

| 补的东西 | 为什么 |
|---|---|
| `.json` / `.ts` 也进候选文件 | 它的色板在 JSON 里，原来只扫 `css/js/mjs` |
| `canvas / sidebar / bubble / link / card / panel / popover` 分区 | 桌面皮肤另一种写法：按区域分块、每块分明暗 |
| `--set role=#hex` 人工兜底 | 它的正文墨色在派生 tone 里拿不到字面量，只能指定 |
| `--hint` / `--license` | 商店卡片的说明与署名不再靠猜 |

**翻译结果（浅色）**

| 令牌 | 值 | 说明 |
|---|---|---|
| `--palm-bg` | `#ffffff` | 卡片的 canvas.light |
| `--palm-sur-1` | `#fafafa` | sidebar |
| `--palm-sur-2` | `#ececec` | bubble 是 `#f4f2f3`，两层差只有 1.04:1 → 按守卫推到 1.08:1 |
| `--palm-line` | `rgba(231,226,221,.5)` | 指定，桌面用的是暖灰细边 |
| `--palm-fg` | `#161616` | 指定（桌面正文墨在派生 tone 里，无字面量） |
| `--palm-accent` | `#8c4d38` | 品牌橙 `#d97757` 压到 AA 4.5 后的值 |
| 圆角 | 8/12/18 | `--radius soft` |

**这轮修掉的三个生成器 bug**（都是 --apply 直接改源码时暴露的，已修在源头）

1. **联合类型被写坏**：`MobileSkin` 那行加了新值后变成 `'endfield | 'claude''`（贪婪正则跨引号匹配）。改成整行替换。
2. **商店目录文案是猜的**：`hint` 写死「移植皮肤」、`source` 从字符串里截一段还会截断括号。改成 `--hint` / `--license` 显式传。
3. **纯白底的两层表面糊在一起**：`skin-contrast.test` 要求两层差 ≥ 1.07:1，Claude 真实配色只有 1.04:1。生成器现在会在这条底线被踩时，往文字色方向推一点。

测试：全量 **2722 通过 / 243 文件**（六套皮肤都进 `skin-contrast` / `skin-contract` / `tokens-golden`）。
棘轮：`dirs.src/mobile 65524 → 65655`、`platform 4633 → 4643`、`files.skin-catalog.ts 72 → 79`；
另把并行会话改过的 `App.tsx 1449`、`components 2995`、`views 19818` 一起调到实测值（不是本次改动，只是让棘轮跟上实测）。
截图：`skin-claude-chat.png`、`skin-claude-settings.png`、`skin-store-six.png`。
#### B：给 `port-skin --apply` 补行为测试（同日 18:20）

用户选了「先补测试」。`--apply` 会**直接改三个源码文件**，之前连着出过两次事故（联合类型被写坏、商店文案被截断），
两处都不会自己报错，只能人肉看。这一轮把它变成断言。

**做法：临时目录里复刻一份最小仓库，跑真的 CLI**

`src/mobile/design/port-skin-apply.test.ts`（9 例，约 290 行）：

- 用 `mkdtemp` 造临时仓库：`000-tokens.css`（含 `:root` 与 nocturne 锚点）、`skin.ts`（联合类型 + 三个 Record + 两处判断）、
  `skin-catalog.ts`（数组尾 + `/** 按 id 取一条` 锚点）、一份 `fixture-theme.css`（八个核心角色齐全）。
- `spawnSync(process.execPath, [脚本, ...参数], { cwd: 临时目录 })` —— 跑的是真脚本，不是被 mock 的函数。
- 读回三个文件逐条断言：块只写一次、圆角值、7 个语法色、商店卡色板、联合类型每个成员都带引号、
  三个 Record 都有新键、`getSkin` 与极性判断都带上、目录里的 `hint`/`source` 就是传进去的那两个值。
- 幂等：同一条命令跑两次，不重复插块、不重复插色板、不重复登记条目。
- 参数边界：`--set fg=不是颜色` → 退出码 1；`--radius 方形` → 1；缺 `--id` → 1；抽不到核心角色 → 2 **且一个文件都不许改**。

**写测试当场抓出四个真 bug（这才是这套测试的价值）**

| # | Bug | 后果 | 修法 |
|---|---|---|---|
| 1 | 「抽不到核心角色」的退出判断写在**最后** | `--apply` 会先把套着默认色的空壳写进源码，然后才退出码 2 | 判断提到任何写操作之前 |
| 2 | 商店卡色板**不幂等** | 同一条命令跑两次会插两对 `--palm-skin-<id>-bg/-ink`（endfield 那次是手工去重，根因没修） | 写之前先查是否已存在 |
| 3 | 运行时注册**静默失效** | `getSkin` 的默认值若是字面量（`? value : 'graphite'`）而不是常量 `DEFAULT_SKIN`，正则不匹配 → 白名单没写，脚本却照常打印「已注册」 | 两种写法都认；写完做四项自检，缺任何一项就退出码 3 并列出缺哪几项 |
| 4 | 角色匹配只认已知前缀 | 皮肤用自己的前缀（`demo-bg-base`）时就一个角色都抽不到 | 匹配时多试一层「去掉最前一段」（`demo-bg-base` → `bg-base`） |

**真实文件干跑验证**：把那三个真实源码复制到临时目录，用报纸皮肤的调色板跑 `--apply`，
检查联合类型末段、三个 Record、`getSkin`/极性两行、商店条目全部正确（`demo2` 用完即删）。

测试：全量 **2731 通过 / 244 文件**（新增 9 例）；typecheck 0；build 0。

**没测**：Windows 上 `spawnSync` 传含中文的参数（`--hint 暖白底色`）走的是 Node 的 UTF-8 argv，实测正常，但没在 macOS/Linux 验过。
#### 装饰层机制 + Claude 装饰（当日 18:40）

用户选了「装饰层」。这一层解决的是**颜色令牌表达不了的东西**：衬线标题、报头笔画、玻璃、像素边框。

**机制：600 段约定 + 一条命令**

| 环节 | 做法 | 好处 |
|---|---|---|
| 文件位置 | `src/mobile/styles/6NN-skin-<id>.css` | `gen-mobile-css` 按文件名排序自动纳入，**不需要注册表** |
| 生成 | `port-skin.mjs --decor <文件>` | 复制进 600 段；**已存在就退出码 4**（装饰是手写资产，重跑不许覆盖）；没写 `html[data-skin=…]` 前缀也拒绝（会污染所有皮肤） |
| 起点 | `docs/mocks/skin-decor-template.css` | 五个已验证钩子 + 三条硬规则的注释版模板 |

**守卫 `src/mobile/styles/skin-decor.test.ts`（7 例）**

装饰层比配色更容易出三种**不会让构建失败**的错：

1. **裸色**：写 `#fff` / `rgba(0,0,0,.1)`，换明暗档时不跟着反色 → 断言只许 `var(--palm-*)` / `var(--tok-*)`；
2. **死选择器**：写了不存在的类，规则永远不生效（报纸第一版白写过三条）→ 断言每个类名都能在 `src/mobile/**\*.tsx` 里找到；
3. **漏皮肤前缀**：`blockquote { … }` 会跑到所有皮肤上 → 断言每条规则都含 `html[data-skin='<本皮肤>']`。

**顺带调整预算口径**：`quality-budget` 的 `cssPx`/`cssClasses`/`cssHex` 现在**排除 600 段装饰层**——
报头 2px、引用 3px 这类笔画本来就该写具体值，算进"组件一致性"只会逼皮肤层用令牌假装。

**演示：Claude 装饰（`611-skin-claude.css`，36 行）**

- 标题换衬线（`Georgia, Songti SC…`），正文保持无衬线——桌面端辨识度一半来自这个；
- 页头分隔线压到 1px 暖灰（`var(--palm-line)`），而不是 2px 实色；
- 分组小标题去掉字距、降字重；引用块加陶土橙竖线；代码块边框改暖灰。
- 实机验证：`.mobile-title` 的计算 `font-family` = `Georgia, "Songti SC", "Noto Serif CJK SC", serif`；截图 `skin-claude-decor.png`。

测试：全量 **2742 通过 / 245 文件**（新增 7 例装饰守卫 + 3 例 `--decor` 行为）；typecheck 0；build 0。
棘轮：`dirs.src/mobile 65655 → 65696`。
#### 「更多」菜单主从倒挂：右边的值比标题还大（同日 18:55）

真机（newsprint 皮肤）截图里，`.sheet-option-check`（「1 个文件」「Markdown」）用的是
`--text-base` = `--palm-t-l` = **17px**，还配 `color: var(--accent)` 和 `500` 字重；
左边的标题只有 **14px / 400**。一屏读下来眼睛先落在右边，菜单本身成了配角 ——
用户原话「这个界面不协调，右边这个字体太大了」。

改（`300-lightbox.css` + `280-sheets.css` + `session-sheets.tsx`）：

| 元素 | 之前 | 现在 |
|---|---|---|
| 右侧值 | 17px / 强调色 / 500 | **13px / 次要灰 / 400**，`font-variant-numeric: tabular-nums`（数字不跳） |
| 行标题 | 14px / 400 | **15px / 500** |
| 行高 | 56px | **50px** |
| 行图标 | 17px，继承主色 | **18px，次要灰**（路标不抢亮度） |
| 面板标题 | 17px / 500，留白 12/14 | **16px / 600**，留白 14/10 |
| 分组 | 四行平铺 | 「设置」前加一条 `sheet-option-divider`：上面是「看这一轮」，下面是「改这套 App」 |

效果图：`docs/screenshots/more-menu-paper.png`（报纸皮肤，用户报的就是这套）、`more-menu-dark.png`（深色）。

实测（headless 393×851，直接读计算样式）：行标题 15px、右侧值 13px（报纸 `rgb(119,108,98)`、
深色 `rgb(126,126,143)`）、行高 50px、分隔线出现在「设置」上方。

测试：`session-sheets` 4 通过、`sheets` 通过；`quality-budget`（裸 px）、`mobile-styles.freshness`、
行数预算（`src/mobile 65713`、`views 19821`）全部通过。

#### 真机验收通过（2026-11-11 19:05，用户确认「全 ok」）

**入口**：`https://123-56-228-146.nip.io:7001/m/`
（阿里云 7001 → nginx TLS → frp 7008 → 本机 `127.0.0.1:3080`；先核对过公网 `app.css` 的哈希 `bd60fd44` 与本机 `lib/mobile/app.css.hash` 一致，
CSS 里 `html[data-skin=claude]`、`--tok-keyword`、`Georgia` 都在，确认验的就是当天这版，不是旧缓存。）

**验收范围（用户在真机上逐项看过）**

- 六套皮肤：石墨 / 纸 / 夜航 / 报纸（衬线正文 + 报头墨线）/ 终末地（奶油底 + 直角 + 暗橄榄黄）/ Claude（纯白 + 衬线标题 + 陶土橙）；
- 三个界面：设置页、用量页、代码块（语法色跟着皮肤走）；
- 四项历史欠账：队列条、工作区「最近用过」、抽屉底部工具卡、用量页数据。

**结论**：全部符合预期，无返工项。

至此「皮肤」这条线闭环：翻译器（配色/圆角/语法色）→ 装饰层 → 12 例 `--apply` 行为测试 → 7 例装饰守卫 →
一页手册（`docs/skin-porting-guide.md`）→ 六套皮肤 → 真机验收。

仍未做（不影响使用）：bloom 一类「一套皮肤多变体」的 `--variant`；玻璃/像素风格包；`--apply` 在 macOS/Linux 上的验证。
#### 「没法新建工作区」+「搜索定位不能用」（同日 19:20）

两条一起查，都用真包 + 真宿主实测，结论都是**接线断了**而不是功能没写。

**一、新建工作区：链路是通的，用户卡在入口和报错**

实测（headless 393×851，真点真提交）：

| 输入 | 结果 |
|---|---|
| `D:\work`（存在） | **创建成功**，面板关闭、切到新工作区 |
| `D:\work\palm-ws-probe`（不存在） | 宿主拒绝，界面弹出 `cannot create a Workspace at "…": ENOENT: no such file or directory, realpath '…'` |

所以后端没问题，问题是：宿主只登记**已存在**的目录（它不帮你 mkdir），而界面把这句英文原样甩出去，
用户看到的就是「点了创建，什么也没发生，还报了一串英文」。

改（`workspace-picker.tsx` + `App.tsx`）：

- 新增 `createErrorText()`：`ENOENT` → 「电脑上没有这个目录：<路径>，先在电脑上把目录建好，再回来填同一个路径」；
  `EACCES` → 「没有权限读这个目录」；已登记过 → 「这个目录已经登记过了」。原样兜底其它错误。
- 提示文案改成「填电脑上**已经存在**的目录（绝对路径）」。
- 新建表单里加「用当前目录（<路径>）」一键填入：手机上手打长绝对路径太难受，改两段就能用。
- 截图：`docs/screenshots/ws-create-error.png`。

（入口没变：抽屉最上面那个图标 → 面板搜索框右侧的「＋」。如果还是难找，下一步可以把它改成带文字的一行。）

**二、搜索定位：意图表是死代码，从没人往里写**

现象（真包实测，从全局搜索点一条正文命中进来）：
`searchBar:false`（搜索框没开）、`marks:[-987,-113]`（高亮全在视口上方）、
`scrollTop` 停在会话底部 —— 即「跳过来了，但既没定位、也没预填、也没法按下一个」。

根因：`session/locate-intent.ts` 那套「一次定位意图」（TTL / 续命 / 转场双挂载 / 消费后复用）
写得很完整，**但 `rememberLocateIntent()` 只有测试在调**，生产代码一处都没有。
于是聊天页里 `locateIntentFor()` 永远是 undefined：

- `useSearchPrefill` 拿不到 query → 搜索框永远不弹；
- props 那条路在「同一路由重挂载」时一丢，就只剩"滚到附近，一个字不高亮"。

改：`App.openSearchHit()` 在 navigate 之前写一次意图（seq / messageId / partId / query）。

修后同样的点击：

| 指标 | 修前 | 修后 |
|---|---|---|
| 搜索框 | 没开 | **自动打开** |
| 预填关键词 | 空 | `port-skin` |
| 计数 | 无 | `17/17` |
| 高亮位置 | `[-987, -113]`（全在屏幕外） | `[-666, -621, **74**]`（一处进入视口） |
| 能否接着翻 | 不能 | 能（上一个/下一个） |

截图：`docs/screenshots/search-locate-fixed.png`。

**顺带确认**：会话内搜索本身是好的（实测 `1/8 → 7/8` 连点七次，每次 `scrollTop` 都在变、
高亮都落在视口顶部 ~126px）。坏的是「从搜索结果点进来」这一条。

测试：`workspace-picker.test.tsx` +2（ENOENT 翻成中文、当前目录一键填）、
`locate-intent` 12 条通过；本轮涉及的 15 个测试文件 **121 通过**；`quality-budget`、样式新鲜度、行数预算全过。
棘轮：`src/mobile 65778`、`views 19886`、`files.App.tsx 1468`。

#### 清理：测试去重 + 中间文件（2026-11-11 19:40）

用户要求「清除不必要的测试代码和中间文件」。先判断重复，再删。

**删掉的中间文件（8 个，约 1.9 MB）**

| 文件 | 大小 | 为什么删 |
|---|---|---|
| `docs/mocks/skin-store.html` | 340 KB | 早期"选方案"用的 mock，内联的是 3 套皮肤时的 CSS，留着会误导 |
| `docs/mocks/skin-entry-drawer.html` | 338 KB | 同上（入口方案对比用） |
| `skin-graphite/paper/nocturne.png` | 907 KB | 内置三套皮肤的展示图，文档无引用 |
| `skin-store.png` / `skin-entry-drawer.png` | 141 KB | 已被 `skin-store-six.png` / `skin-entry-live.png` 取代 |
| `skin-endfield-code.png` | 239 KB | 空白页，无引用 |

保留 `skin-code-colors.html`（手册与配色说明都指向它）与 `skin-decor-template.css`（手册的起点模板）。

**测试去重（删/合并 6 例，2742 → 2738）**

| 位置 | 处理 | 理由 |
|---|---|---|
| `skin-decor.test.ts`「只写令牌，不写裸色」×2 套 | 删 | **与 `design/no-raw-colors.test.ts` 重复**：那个文件扫 `styles/` 全目录（只放行 000-tokens.css），装饰层本来就在它的网里 |
| `skin-decor.test.ts`「至少有一层」 | 删 | 只是硬编码清单，加一套皮肤还得改它，不防回归 |
| `port-skin-apply.test.ts` 三条参数校验 | 合并成一条 | 都是"退出码 1 + 一句提示"，一条里三个断言更省 |
| `port-skin-apply.test.ts` 两条 `--decor` 拒绝 | 合并成一条 | 都是退出码 4，同一条命令链上验 |

**代码清理**

- `port-skin.mjs`：删掉提前退出改造后没人用的 `missing` 变量；`applyToSources` 去掉没用上的 `sourceNote` 参数（catalog 用的是 repo/license）。
- `520-skin-store.css`：5 处字面量改用令牌（`gap`/色条高/勾字号/输入条圆角），勾改成 `border-radius: 50%`（圆形本就该这么写）；px 从 18 → 13。
- `000-tokens.css` 注释里残留的旧文件名 `530-skin-newsprint.css` → `610-…`，并重新生成 `mobile-styles.ts`（旧名全仓已 0 处）。

**棘轮调整**：`quality-budget` 的 `cssPx` 1315 → 1317，理由写进 `why`（皮肤商店卡片里的迷你界面尺寸不能用当前皮肤令牌）；装饰层 6XX 已在统计口径里排除。

**剩一条红，不是本次清理造成的**：`--text-tertiary` 实测 60 > 上限 58。
增量来自并行会话对 `styles/300-lightbox.css` 的改动（18:55，把 `rgba(255,255,255,.6)` 换成了 `var(--text-tertiary)`，共 2 处，L147/L158）。
这条棘轮的设计意图就是"新代码不许再用旧名"，所以**不该上调**——应由那处改动改用新名 `--palm-fg-3`。
#### 抽屉里的「切换工作区」：把可点的那块做成一整条（同日 19:50）

原状：头部左边显示「工作区名 + 路径」但**点不动**，右边只有一枚 16px 的箭头（`ChevronDownIcon`）
能点 —— 能点的和说事的不是同一块，两个信号都错，用户原话「看不出是在这切工作区」。

改（`ui/session-drawer.tsx` + `280-sheets.css`）：

| 之前 | 现在 |
|---|---|
| 只有右侧小箭头可点（16px 热区） | **整条 295×47 可点**（头像 + 名字 + 路径 + 切换） |
| 右侧是孤箭头，像装饰 | 右侧「**切换 ⌄**」胶囊：`--palm-tint-accent` 底 + `--palm-accent` 字 |
| 点名字没反应 | 点哪都能切 |

取舍（另外三个方案为什么没选）：

- **只加文字标签、不加底**：报纸皮肤（纸白底）上会退化成一行灰字，跟路径同层，还是看不出能点。
- **挪到底部「工具」卡片里加一行**：与设置/产物/用量同款最一致，但工作区是「身份」不是「工具」，
  而且会把每次都要用的切换埋到第二屏。
- **在「新建会话」上方单开一行**：最显眼，但抽屉高度本来就紧，白占 44px。

配套：单工作区仍不显示（`workspaceCount > 1` 才画）；图标保持 16×16（项目规则）；
`--text-tertiary` 一律换成 `--palm-fg-3`（旧令牌棘轮不许加）。

效果图：`docs/screenshots/drawer-switch-dark.png`（石墨）、`drawer-switch-paper.png`（报纸）。

实测（headless 393×851）：切换条 `295×47`、`aria-label="切换工作区"`、文字「切换」，
深色皮肤 `rgb(124,140,255)`、报纸皮肤 `rgb(6,85,136)`。

测试：`session-drawer-layout` + `mobile-styles.structure`（188 条）+ `quality-budget`（16 条）全过；
棘轮：`src/mobile 65843`、`ui 2656`、`cssPx 1327`、`cssClasses 851`。

#### 默认皮肤改成 Claude（2026-11-11 20:15，用户指定）

用户要求「本项目默认皮肤设成 Claude」。石墨不再默认，改为 Claude（浅色、米白纸面 + 陶土橙）。

**改到的地方**

| 位置 | 改动 |
|---|---|
| `platform/skin.ts` | `DEFAULT_SKIN = 'claude'`；`SKIN_HINT` 里 Claude 标「（默认）」、石墨改「深色底，冷灰」 |
| `mobile-routes.ts` `pageHtml` | `<html data-skin="claude" data-theme="light">`、`theme-color #ffffff` |
| `mobile-routes.ts` `manifestJson` | `background_color` / `theme_color` 改 `#ffffff`（PWA 启动画面） |
| `mobile-routes.ts` 新增 `/m/boot-skin.js` | 首帧脚本：读 `dsh.palm.skin`，在样式表之前写 `data-skin`/`data-theme`/`theme-color` |
| `docs/mobile-design-spec.md`、`docs/skin-porting-guide.md` | 表格里的「（默认）」从石墨挪到 Claude |

**为什么需要 boot 脚本**：页面 HTML 是静态生成的，只能写死默认值；选了深色皮肤（石墨/夜航）的人如果等 bundle 起来再改，每次打开都会先白闪一下。CSP 是 `script-src 'self'`（不许内联），所以做成同源小脚本、放在样式表之前同步执行。

**新增两条防漂移断言**（都写在 `platform/skin.test.ts`）

1. boot 脚本的 `MOBILE_SKIN_IDS` / `MOBILE_LIGHT_SKIN_IDS` 必须等于 `SKIN_LABEL` 全集与 `skinPolarity()==='light'` 的集合；
2. boot 脚本里的状态栏颜色必须覆盖 `SKIN_CHROME` 的六个值。

这两条是"构建不会失败、只会白屏或状态栏串色"的那类错——所以拿源码直接比名单。写第二条时当场抓到过真 bug：脚本里 paper 写成了 `#ffffff`（正确是 `#faf8f4`）。

**顺带修的**：`session-drawer-layout.test.tsx` 原来把抽屉里「设置」右侧的皮肤名写死成「石墨」，改为跟随 `SKIN_LABEL[getSkin()]`。

验证：typecheck 0、build 0、全量 **2740 通过 / 245 文件**。
**待做**：宿主进程仍是旧代码（`/m/` 的 HTML 里还没有 `data-skin="claude"`），要重启宿主才能在手机上看到效果。
#### 抽屉会话顺序「一打开就变」：合并时又在重排（同日 20:20）

先确认数据源没问题（都是实测，不是推断）：

| 检查 | 结果 |
|---|---|
| 连打两次 `session.list`（间隔 3 秒） | 40 行**顺序完全一致**、`updatedAt` **0 处变化**，宿主已按时间倒序 |
| 连开三次抽屉，每次读两帧（立刻 / 2.6 秒后） | 三次顺序**完全一致**，第一帧与稳定态也一致 |

所以不是宿主乱发，也不是分组（今天/昨天/更早按本地午夜切，一天内不会变）。

**需要说明的是：我没能在本地复现出这次跳变** —— 测试那 20 秒里，那个 running 会话没有新输出，
`updatedAt` 没动，所以两次打开自然一样。但代码里唯一能造成「每次打开都变」的机制就在
`mergeDrawerRows`（`views/drawer-rows.ts`）：

打开抽屉先用本地缓存画一帧（按时间排好），一秒后宿主那一页到达，它又 `orderDrawerRows(merged)`
**重排一遍**。只要有一个会话在跑（`running: true`），它的 `updatedAt` 每几秒刷新一次，
宿主页里的时间永远比缓存新 —— 每次打开都能看到它往上浮一位。

改：合并时**冻结顺序**。

1. 已经在显示的行保持原位，只把字段（标题 / 运行态 / 时间）换成宿主那一版；
2. 宿主页里**没显示过**的新会话，按 `updatedAt` 插到第一个更旧的行前面（不一律追加到末尾）；
3. 当前会话仍钉第一行。

重新打开抽屉走的还是 `paintDrawerRows`（按最新时间重排），所以
「打开过程中绝不跳」和「跨次打开跟着最新走」两件事都保住了。

测试：`drawer-rows.test.ts` 12 → 14 条（新增「宿主让某行 updatedAt 变大时不重排」「新会话按时间插位」）；
`App` + 抽屉布局 + 行排序 38 条通过。棘轮：`src/mobile 65874`、`views 19917`。

#### 抽屉删掉「产物与文档」+ 搜索定位改走 DOM 快通道（同日 20:45）

**一、抽屉底部只剩「设置 / 用量」**

用户要求：右上角「⋯ → 这一轮的产物」已经是同一个入口（还带「N 个文件」），抽屉里那条重复了。
删掉按钮，并一起清掉 `onOpenArtifacts` / `artifactCount` 两个 prop、App 的两处传参和 `FolderIcon` 导入
（留着一个没人读的 prop 只会让下一个人以为这里还有入口）。

测试同步：底部入口 3 → 2 行（搜索 + 两行）、抽屉图标 7 → 5（多工作区 8 → 6）、动作序列去掉 `'artifacts'`。
效果图 `docs/screenshots/drawer-no-artifact.png`。

**二、搜索定位：先看屏幕上的高亮，再谈推算**

实测（headless 393×851，5 个词各点三次「下一个」，判据 = 视口内到底有没有高亮）：

| 词 | 改前落空 | 改后落空 |
|---|---|---|
| 皮肤 | 1/3 | 0/3 |
| port-skin | 1/3 | 0/3 |
| ENOENT | 0/3 | 0/3 |
| 棘轮 | 0/3 | 0/3 |
| 1/8 | 2/3 | 0/3 |
| **合计** | **4/15** | **0/15** |

机制：原来「下一个」一律走「索引 seq → 推算在哪一行 → 行内第几处 → 滚过去」，任何一环认不出来
（合并卡、窗口边界、同一行多处）就只能降级：翻页把视口带走，或就近亮一处。现在加一条
**DOM 快通道** `nudgeToRenderedMark`：这一屏已经渲染出 `mark.chat-search-mark` 时，直接按几何
位置在当前高亮之间走一步（next 取视口 35% 之下第一个、没有就回绕到第一个；prev 反之），
接住就返回；认不出来（词在更早历史里、整卡折叠着）才落回原来的索引/翻页逻辑。

方向从 `onNext` / `onPrev` 显式传入，**不在 `gotoChatHit` 里读 `chatSearchAt`** —— 那会让它的
`useCallback` 每次计数变化都重建，把计数重置回第 1 条（这个坑在改动中当场踩到，被 242 条
ChatView 测试抓到，改成显式参数后全绿）。

顺带修掉两处：单命中的词（`port-skin` 1/1）点「下一个」不再被翻页带走；末尾再点「下一个」
现在正确回绕到 `1/3`（改前卡在 3/3 且视口里没有高亮）。

测试：ChatView 242 通过；抽屉 16 条；质量/样式/行数预算 192 条；棘轮
`src/mobile 65923`、`views 19973`、`files.ChatView.tsx 4032`。

#### 抽屉底部去掉「工具」小标题（同日 21:05）

用户要求。删掉 `<p className="palm-drawer-tools-title">工具</p>`，并连同 `.palm-drawer-tools-title`
的全部 5 条声明一起删（不留没人引用的死规则）。卡片本身、上方分隔线、两行入口都不变。

测试：抽屉 16 条 + 质量/样式/行数预算 192 条全过。类名总数减 1，棘轮不用抬。
效果图 `docs/screenshots/drawer-no-tools-title.png`。

#### 抽屉「展开时右边有点空」：78% → 92% 宽（同日 21:15）

实测：`inline-size: min(var(--palm-drawer-w, 308px), 86vw)` 在 393px 屏上取 **308px = 78%**，
右侧留 85px 一条**没有任何信息**的暗边（只是被遮罩压暗的聊天页），看着就是空落落的。

改：

| 项 | 之前 | 现在 |
|---|---|---|
| `--palm-drawer-w` | 308px | **362px** |
| 窄屏上限 | `86vw` | **`92vw`** |
| 393px 屏实际宽度 | 308px（78%） | **362px（92%）** |
| 右侧露出的边 | 85px | **31px**（只够暗示「能滑走」） |

为什么不做 100%：全宽之后就没有「这是抽屉、往右能滑回去」的暗示了，得另加一个关闭按钮，
多一个控件换 31px 不值得。

更新基线：改尺寸令牌必须显式更新 `tests/golden/tokens.json`
（`PALM_UPDATE_TOKENS=1 pnpm test tokens-golden`），否则 `tokens-golden` 会红 —— 这是设计如此。

效果图：`docs/screenshots/drawer-wide-92.png`。

**另一个「空」的来源**（如果指的是抽屉内部：标题到状态条之间那段横向空白）：
会话行右侧目前只有状态条（运行中/等审批），没有时间。补上相对时间（`9分 / 19:47 / 昨天 / 11-09`）
右侧就有信息了，演示图 `docs/screenshots/drawer-row-time-demo.png`（注入 DOM 模拟，未落地）。

#### 侧边栏右侧空：每行补一句「什么时候」（同日 21:30）

用户澄清：「不是屏幕右侧，是侧边栏的右边」—— 即抽屉内部，一行里标题在左、状态条靠右，
**中间到右边缘一大条空白**，什么信息都没有。补时间是最省地方又真有用的填充。

改：

| 项 | 之前 | 现在 |
|---|---|---|
| 行右侧 | 只有状态条（运行中/等审批），普通行整段空 | 状态条 + **时间**，普通行也有 |
| 时间格式 | — | 今天 `21:12`、昨天 `昨天`、更早 `11-09`、跨年 `2025-12-31` |
| 数字对齐 | — | `font-variant-numeric: tabular-nums`（列不跳） |
| 宽度 | — | `flex: none` + 标题 `flex:1 + ellipsis`，5 个字符恒定，不会把标题挤变形 |

新增纯函数 `drawerWhenLabel(updatedAt, now)`（`views/drawer-rows.ts`），与分组用的
「今天/昨天」同一口径（本地午夜切），拿不到时间戳返回空串（那一行就不画，不显示 1970）。

测试：`drawer-rows.test.ts` +2（今天/昨天/更早/跨年/空值）、`session-drawer.test.tsx` 12 条；
连带修了两条被新文本影响的旧断言（用组头查「昨天」而不是全文本、普通行改查 `.palm-drawer-title`）。
棘轮：`src/mobile 65959`、`ui 2676`、`views 20009`。

效果图：`docs/screenshots/drawer-row-time-real.png`（真包，不是注入）。

#### 报头那条黑线 + 抽屉再收窄（同日 21:45）

**一、「标题栏下方那条黑色横线」是什么**

是**报纸皮肤自己画的**，不是浏览器的 bug：

```css
html[data-skin='newsprint'] .mobile-header {
  box-shadow: inset 0 -2px 0 var(--palm-fg);   /* 2px 正文墨色 */
}
```

`--palm-fg` 就是正文那个近黑的墨色，2px 压在 48px 高的标题栏底下 —— 手机屏上就是一条黑杠。
而且 `.mobile-header` 本身已经有 `border-bottom: 1px solid var(--border-subtle)`
（`rgba(31, 9, 9, 0.12)`，极淡），两条叠在一起更显重。

已删掉那条皮肤规则，**保留 header 自带的那条 1px 淡边**（分隔还在，只是不再抢眼）。
想要回报纸墨线：把那条 box-shadow 恢复即可（注释里留了原文）。

实测（headless，真包）：`box-shadow: none`、`border-bottom: 1px solid rgba(31, 9, 9, 0.12)`。
截图 `docs/screenshots/header-line-none.png`。

**二、抽屉再从 92% 收到 86%**

| 项 | 上一版 | 现在 |
|---|---|---|
| `--palm-drawer-w` | 362px | **338px** |
| 窄屏上限 | 92vw | **86vw** |
| 393px 屏实际宽度 | 362px（92%） | **338px（86%）** |

用户原话「太宽了，缩短一点」。86% 介于最初的 78% 和刚才的 92% 之间：比 78% 舒展，又不像全屏。
截图 `docs/screenshots/drawer-86.png`。

改尺寸令牌又触发 `tokens-golden`，已按规矩 `PALM_UPDATE_TOKENS=1` 更新基线。
测试：样式/令牌/质量/行数 362 条全过。

#### 新建工作区可以「点选电脑上的目录」（同日 22:00）

用户：「新建工作区的时候，这个路径要能点选远程电脑端路径」—— 手机上打多层绝对路径不现实。

**能力早就在，只差接上**：宿主侧的 `mobile.listDirectory`（`host/directory.ts`）本来就有，还带
`crumbs`（从根到当前的整条链）与 `home`；前端 `data/impl/fs.ts` 的 `listDirectory()` 也现成
（`sheets.tsx` 的「电脑文件」一直在用）。缺的只是新建表单里那一步。

新增 `views/chat/components/path-browser.tsx`：

| 交互 | 说明 |
|---|---|
| 入口 | 新建表单里「浏览电脑上的目录…」（在「用当前目录」上面） |
| 起点 | 输入框有内容就从那里开始，否则**从当前工作区路径开始**（新建同级项目最常见的场景） |
| 面包屑 | `D:\ › work › dsh-palm`，前面几层可点，当前层加粗不可点 |
| 列表 | 只列目录（宿主默认就不回文件），`44vh` 上限可滚，行高 `--palm-hit`（44px） |
| 上一级 | 走 `crumbs` 的倒数第二项，到根时禁用 |
| 用这个目录 | 把绝对路径填回输入框（**不直接创建**，用户还能改一层或补子目录） |
| 退出 | 「← 手动填」原样回到表单，不塞路径 |

顺带两处打磨：面包屑之间补了 `›` 分隔（一排蓝字挤在一起读不出层级）；目录图标从彩色 emoji `📁`
换成 `FolderIcon`（灰色线条，跟报纸/石墨皮肤一致，emoji 在纸色底上太跳）。

测试：`workspace-picker.test.tsx` +2（点选→填回输入框；「手动填」不塞路径），23 条全过。
真机实拍（headless 393×851 真包）：从 `D:\work\dsh-palm` 起，面包屑与目录都正确读到了。
截图 `docs/screenshots/ws-path-browser.png`。

棘轮：`src/mobile 66253`、`views 20163`。

#### 新建工作区的两个入口改成「行卡片」（同日 22:15）

用户：「「浏览电脑上的目录…」这个要不要做个按钮或者有更好的展示方式？不然用户可能意识不到
这个可以点击」。

根因是它当时套的是 `.ws-action`：**透明背景 + 灰色小字**，在表单里读起来就是一句说明文字。

改：新增 `.ws-pick`，两个入口都变成整宽行卡片 —— 边框 + 浅底 + 左侧 16px 蓝色文件夹图标 +
右侧 `›`，和抽屉底部「设置 / 用量」同一套语言。

| | 之前 | 现在 |
|---|---|---|
| 形状 | 一行灰字，无边框无底色 | 355×44px 卡片，1px 边框 + 浅底 + 圆角 |
| 可点线索 | 只有文字本身 | 图标 + 右箭头，两侧都指向「能进去」 |
| 行高 | 44（但视觉上像一行说明） | 44（`--palm-hit`） |
| 文案 | 浏览电脑上的目录… | 浏览电脑上的目录 / 用当前目录 · `<路径>` |

测试：`workspace-picker` 23 条全过（无障碍名仍是「浏览电脑上的目录」，用例不用改）；
预算 `src/mobile 66314`、`views 20172`。截图 `docs/screenshots/ws-create-picks.png`。

#### 方案稿：把「进行中 / 刚完成」收进一个「任务」页（未落地，2026-11-11 22:20）

用户问：怎么知道哪些会话在跑、哪些刚跑完？以前能在一个界面看全，现在有没有更好的入口。

**现状**：数据全在，只是没有入口 ——

| 数据 | 宿主 RPC | 字段 |
|---|---|---|
| 哪些会话在跑 | `mobile.runningSessions` | `sessionIds`（只有 id，**没有开始时间**） |
| 刚跑完的 | `mobile.finishedRuns({op:'read'})` | `title` / `finishedAt` / `status`(done\|error\|stopped) / `durationMs` / `summary` |
| 会话标题 | `session.list` | `title` / `workspace` |

现在唯一能看到的是抽屉里会话行右侧那个 mini 状态条（运行中 / 完成）—— 要一行行翻，
而且「刚完成」十分钟后就混进普通会话里，看不出哪些是刚才跑完的。

**推荐方案：独立「任务」页**（图 `docs/screenshots/tasks-proposal.png`）

- 两段：进行中（N）/ 刚完成（最近 24 小时）
- 每行：状态点 + 会话标题 + 结果与时耗 + `›`，点进去回那个会话
- 底部：「清除已完成」+「新建会话」
- 入口两处：抽屉底部「工具」卡片加一行「任务」（跟设置 / 用量并列）+ 「⋯」菜单里也放一个

**诚实说明一处**：图里「已跑 3 分 12 秒」现在**拿不到** —— `runningSessions` 只回 sessionIds，
没有开始时间。两个选择：(a) 先只显示「运行中」（零成本）；(b) 宿主补一个 `startedAt`（约 20 分钟，
改宿主代码、要重启进程）。「刚完成」那边的时耗是现成的（`durationMs`），不用动。

**没选的两条路**：

| 方案 | 为什么不做 |
|---|---|
| 抽屉顶部加「进行中 / 刚完成」分组 | 只解决"看得见"，不解决"看全"：抽屉只有当前工作区的会话，跨工作区的进行中看不到；而且塞进列表会让"今天 / 昨天"的分组变乱 |
| 聊天页常驻悬浮胶囊「2 个在跑」 | 天天挤占聊天内容；「刚完成」不需要常驻在眼前 |

成本：页面 + 路由 + 两个入口 + 测试 + 真机截图 ≈ 40 分钟（不含上面的 startedAt）。

#### 修：打开抽屉时会话从「更早」跳到「今天」（2026-11-11 22:35）

用户报：「一点击侧边栏，会话会从『更早』分组切到『今天』分组」。追问确认：**只打开抽屉就跳**，不需要点会话。

**根因**：抽屉分组只看 `SessionView.updatedAt`（`ui/session-drawer.tsx:47`，按本地午夜切今天/昨天/更早）。
而**从 HUD、搜索结果或 URL 直接进会话**时，路由里的 `updatedAt` 是 `0`
（`App.tsx:1049` 的 `openFinishedChat` 直接写 `updatedAt: 0`，搜索命中则 `hit.updatedAt ?? 0`）。
于是抽屉首帧拿 0 去分桶 → 落「更早」；后台宿主页一到、`mergeDrawerRows` 把行换成真实时间 → 跳「今天」。
用户什么都没干，分组自己变了。

**修法**（`views/drawer-rows.ts` 的 `paintDrawerRows`，纯函数，不动 App 行数预算）：
当前会话 `updatedAt > 0` 就不动；否则先用缓存里同 id 行的真实时间，缓存也没有才用「此刻」。
刚打开的会话本来就属于「最近在用」，先归「今天」比先归「更早」再跳走合理。

**验证**：Playwright 走真链路（pair 链接进会话 → 点 ☰ → 分别读 100ms 与 3s 后的分组）：
`FIRST=[今天 3 / 更早 37]`，`LATER=[今天 3 / 更早 37]` —— 首帧与刷新后完全一致。
单测 19 例通过（新增 3 例：缓存补时间、无缓存用此刻、真实时间不被改写）。

**同批红（不是我引入的）**：`ui/session-drawer.tsx → ../views/drawer-rows.ts` 反向依赖、
`views` 直连 api、cssPx 1344/1327、cssClasses 870/851、目录 66328/66314 —— 都是并行会话今天新加的
「行右侧显示时间」等功能带来的，我没有动它们的代码。
#### 任务入口的位置：抽屉底部「工具」第三行（同日 22:32）

用户追问「任务页入口放在哪里」。实拍（往真抽屉里注入一行）见 `docs/screenshots/tasks-entry.png`：

抽屉底部「工具」卡片从两行变三行 —— **设置 / 用量 / 任务**，任务那行右侧显示实时计数「2 在跑」。
图里那两条「运行中」是当时真实状态，不是摆拍。

选这里的理由：

| 候选 | 判断 |
|---|---|
| **抽屉底部工具卡片（选它）** | 常驻、和「设置 / 用量」同一层级（都是"全局功能"）；右侧还能挂计数，一眼看到有几个在跑 |
| 「⋯」菜单 | 作为**第二入口**保留：在聊天页里不跳出去就能进任务页 |
| 抽屉顶部动态条（有任务才出现） | 更好发现，但要额外做一条会跳动/消失的 UI，且和「新建会话」抢第一屏；先不上 |
| 聊天页常驻悬浮胶囊 | 挤占聊天内容，否 |
| 标题栏第三个图标 | 标题栏已经左右各一个（抽屉 / ⋯），再加就挤了 |

#### 架构收口：ui 不再反依赖 views（2026-11-11 22:45）

并行会话今天给抽屉加「行右侧时间」时，把 `drawerWhenLabel` 放在 `views/drawer-rows.ts`，而 `ui/session-drawer.tsx` 直接 import 它 —— 架构测试报
`ui/session-drawer.tsx → ../views/drawer-rows.ts`（ui 内核只许向下依赖）。

**改法（两处，都是"把该住哪层的东西放回哪层"）**

| 违规 | 修法 |
|---|---|
| `ui → views/drawer-rows.ts` | `drawerWhenLabel` 整体搬到 `ui/drawer-when.ts`（含 `DAY_MS`），测试跟着搬到 `ui/drawer-when.test.ts`；`views/drawer-rows.ts` 只留归属/排序/合并三个纯函数 |
| `views/chat/components/path-browser.tsx: listDirectory` | 新增 `session/directory-listing.ts`（`listDirectoryForPicker`），视图不再直连 `api.ts`；取数口径收到 session 层 |

顺带修了 `App.test.tsx` 的旧断言：抽屉底部「产物与文档」入口今天已被用户要求删掉（右上角「⋯ → 这一轮的产物」是同一入口），用例从"三入口"改成"两入口 + 断言它确实不在"。

**预算收口**（行数只降不升，抬必须记账）

| 项 | 旧 | 新 | 原因 |
|---|---|---|---|
| `tools/budget.json` `src/mobile` | 66314 | 66365 | 本次 +51（两个新文件 + 并行增量） |
| 同上 `src/mobile/session` | 3197 | 3220 | +23 = `directory-listing.ts` |
| 同上 `src/mobile/ui` | 2676 | 2692 | +16 = `drawer-when.ts` |
| `quality-budget.ts` cssPx | 1327 | 1344 | +17 处尺寸：工作区面板 46/16/13px、用量页、结果动作条 |
| 同上 cssClasses | 851 | 870 | +19 类：`.ws-*` / `.pb-*` / `.usage-*` / 抽屉工具卡 |

验证：`typecheck 0`、`build 0`、全量 **2749 通过 / 246 文件**（含架构两条、App 抽屉那条）。
#### 任务 vs 设置：对调，并且「没任务就不出现」（同日 22:48）

用户提议把「任务」和「设置」对调。**同意**，而且可以更进一步。

对调后的顺序：**任务 / 设置 / 用量**（实拍 `docs/screenshots/tasks-entry-top.png`）。

理由：

1. 三行里**只有任务那行会变**（`2 在跑` / 空闲），信息价值最高，理应第一眼看到；
2. 设置是"改一次就不动"的配置，放第一行只是习惯，不承载信息；
3. 卡片第一行带顶部圆角，是最醒目的位置。

**再进一步**：没有进行中、也没有刚完成时，**任务那行整行不画** —— 否则卡片第一行写着「任务 · 空闲」，
白占 46px 还把关设置往下挤。有任务才出现，出现时就在最上面。

这样卡片有两种面孔：

| 状态 | 卡片内容 |
|---|---|
| 有任务 | 任务（2 在跑） / 设置（报纸） / 用量（本机） |
| 空闲 | 设置（报纸） / 用量（本机）—— 和现在完全一样 |

成本不变：仍约 40 分钟（任务页 + 抽屉入口 + 「⋯」菜单入口 + 测试 + 真机截图）。

#### 「任务」页落地（2026-11-11 23:45）

用户：「落地吧」。按前面定的方案做完，真机实拍：

| 项 | 实现 |
|---|---|
| 新页面 | `views/TasksView.tsx`：进行中（蓝点）/ 刚完成（灰点）两段，行 = 点 + 标题 + 状态（`运行中` / `完成 · 1 分 30 秒`）+ `›` |
| 数据 | `runningSessions` + `finishedRuns` + `session.list`（标题用 `toSessionView` 从 projections 取，退回 cwd 尾巴） |
| 轮询 | 5 秒一次，只刷这两个集合 |
| 入口 1 | 抽屉底部「工具」卡片**第一行**（任务 / 设置 / 用量）—— 用户要求与设置对调 |
| 入口 2 | 「⋯」菜单分隔线下面（任务 / 设置） |
| 没有任务 | 抽屉那行**整行不画**（不白占 46px）；任务页显示空状态 |
| 计数来源 | `drawer.rows` 里 `running` 的会话 + `finished`，**不是** `pending`（那是"排队中的消息"，实测会让计数恒为 0） |

落地过程中修掉三个只有真机才暴露的问题：

1. **标题全空**：`HostFinishedRun.title` 可能是空串 → 用 sessionId 的尾巴（`2b647b27`）顶上；
2. **「刚完成」铺了 12 条半年前的记录**：`finishedRuns` 是累积文件，加 24 小时窗口 + 按 `finishedAt` 倒序；
3. **一直停在「正在读任务…」**：三个请求原来串行发，最慢那个要等两遍 → 改成 `Promise.all` 并行。

测试：ChatView 242 + App 路由栈 + chat 组件共 **460 条全过**；抽屉 17 条（新增「任务行只在有任务时画，且在工具卡片最前面」）；
预算 `src/mobile 66770`、`views 20446`、`ui 2702`、`ChatView.tsx 4036`、`App.tsx 1487`。

截图：`docs/screenshots/tasks-page-real.png`（真包，进行中 3 / 刚完成 8）、`docs/screenshots/tasks-entry-real.png`（抽屉里那一行）。

## 2026-11-12 子代理详情页（点进去看它做了什么）

**问题**：手机上子代理只有两处影子 —— 顶栏徽标「子代理 N 个运行中」和对话里一条「子任务状态更新」。它跑了哪些工具、结论是什么，一概看不到；长任务卡住时用户分不清是慢还是死了。

**业界两条路都有人踩坑**：Claude Code 主线程只给一行 `Done (…)` 且点不开（被当 bug 报，issue #66646）；它的 VS Code 面板反过来把每个子代理全铺进主对话，fan-out 时无法阅读（#83213）。所以走**列表 → 点开独立页**。

**改动**
| 层 | 文件 | 内容 |
|---|---|---|
| 数据 | `session/subagent-detail.ts`（新） | 子代理本身就是一个会话（`SubagentListEntry.id` 是 `SessionId`），读它的尾部一页 (`loadChatPage`)，折成「步骤 + 结论」。`toolDetail()` 从工具参数 JSON 里挖一行摘要（command/query/url/path…）。步骤上限 40，工具总数照实统计 |
| 页面 | `views/SubagentView.tsx`（新） | 页头（任务名 / 运行中 / 已跑时长 / 工具数）→ **最近一步**（折叠态也回答「它现在在干什么」）→ 前 N 步折叠 → 过程时间线 → 当前输出 → 复制结论 / 返回。运行中每 8 秒自刷新 |
| 入口 | `render/run-status.tsx` | 面板里的子代理行加 `onOpen` → 变可点行并带右侧箭头；不给 onOpen 时保持纯展示（老调用方与既有测试不受影响） |
| 路由 | `views/App.tsx` | 新 `Route.kind = 'subagent'`（深度 2，key 带子会话 id）；`backTargetOf` 兜底回会话 |
| 样式 | `styles/520-subagent.css`（新） | 22 条规则，全部走令牌 |

**两个只有实现时才会发现的坑**
1. **折叠按钮不能按「还剩多少」显示**：一展开 `hidden` 就变 0，按钮跟着消失，用户再也收不回去 —— 改成按「步骤总数 > 预览数」显示；
2. **`flow` 里的 `tool` part 只有 callId**：工具名与参数在 `RenderMessage.tools[]`（`ToolCallInfo.name/arguments`）里，两处要按 callId 对齐才能显示「`web_search "find in page"`」这种人话。

**测试**：`session/subagent-detail.test.ts` 9 条（参数摘要/优先级/截断/尾部上限/空态）、`views/SubagentView.test.tsx` 7 条（折叠展开/空结论禁用复制/失败态/返回）、`render/run-status.test.tsx` 原有 16 条仍绿。

**预算**（本次上调，理由写进 `tools/budget.json` 与 `quality-budget.ts` 的 why）：`src/mobile 67800`、`views 20800`、`session 3400`、`render 7135`、`api 3780`、`ChatView.tsx 4055`、`App.tsx 1500`、`cssPx 1362`、`cssClasses 912`。

**真机验收（未做）**：需要一次真实的子代理运行，点顶栏徽标 → 面板里点那一行 → 详情页。效果图见 `docs/screenshots/mock-subagent-detail.png`。

### 补：入口不能跟着任务一起消失（2026-11-12 用户：「任务没在跑的时候就不显示，这不合理」）

徽标原来只在「有在跑的子代理」时算出一个 bit，于是**跑完 = 入口消失**，用户再也进不去看「它最后做了什么」。

改两处：

1. `runBadgeBits`：只要有子代理（含已结束）就出 `代理 N`；有在跑的才报在跑的个数。真的没有子代理时才不画（顶栏不白占位）。
2. `RunBadge` 的读屏文案分开两种情况：「子代理 2 个运行中」/「子代理 3 个（已结束）」——否则听上去像还在跑。

测试：`run-status.test.tsx` +3 条（全结束仍出徽标 / 有在跑只报在跑数 / 全无则不画）。

#### 三件事：矩形长条的成因 / 删「更多」/ 上下文档窗重做（2026-11-12 00:45）

用户连着提了三件事，一次改完。

**① 「点模型或权限为什么出现矩形长条」**

根因在 `.chat-picker-row` 上是 `flex: none` —— 行按钮的宽度只跟**文字**一样长，
于是它的背景（`:active` 的 `--fill`、选中态的 `--accent-soft`）也只有文字那么长；
手机上触摸高亮还会残留，于是一行一条浅色矩形，看着像"文字下面贴了条标签"。

修法：`flex: 1 1 auto; align-self: stretch; inline-size: 100%`（行铺满面板，背景即整行），
外加 `-webkit-tap-highlight-color: transparent`。实测行宽 97/134/143 → **343**（面板内宽）。

**② 「更多」模块删掉**

权限面板底部原来有「上下文用量 / 批准方式设置」两个跳页入口。已删：
上下文改由右下角圆环就地展开（还带进度条），批准方式在设置页另有入口。

**③ 圆环弹窗重做**（`docs/screenshots/ctx-pop.png`）

从上到下：`上下文用量 … 44%` → 进度条 → `已用 222k / 窗口 500k` → `还剩 278k`
→ 一句建议 → 「压缩上下文」描边按钮（副标题：把旧回合折成摘要，腾出窗口）。

两个实现细节：
- 进度条用 SVG（`width` 是数据 → 属性），**不用带 `%` 的 inline style** —— `design/quality-budget` 的
  `inlineStyles` 门会拦；
- 圆角交给容器（`border-radius + overflow: hidden`）：`preserveAspectRatio="none"` 横向拉伸后，
  `rect` 上的 `rx` 会变成椭圆，右端看着像被切平。
- 压缩按钮直接发 `/compact`（宿主本来就支持，`session.command` 的应答会等模型总结，超时 180s）。

#### 「同一轮过程条出现两三次」的根因与系统修法（2026-11-12 01:00）

**现场**（用户手机截图）：同一轮出现两条「静着 · 比平时慢一点 … 57分18秒」，各带一张过程卡，
一张 `119 次工具调用`、一张 `110 次工具调用` —— 两份**不同时刻的快照**同时留在列表里。

**代码事实链**（不是推测）：

1. `views/chat/hooks/use-chat-session.ts` 的 `commitRows` 是唯一写入口，已经串了三道：
   `keepTurnReports` → `renderRows` → `dedupeById` → `dedupeSameStep`。
2. `dedupeSameStep`（`render/messages.ts`）的身份键是 `t{turn}s{step}` / `t{turn}c{callIds}`，
   而 `stepKeyOf` 第一句就是 `if (item.kind !== 'assistant' || item.turn === undefined) return undefined`
   —— **一边缺轮号，这一行就完全不参与去重**。
3. 卡上的工具计数 119 vs 110 ⇒ 两份快照的 callId 集合只是包含关系，`[...callIds].sort().join(',')`
   拼出来的键不相等 ⇒ 即使两边都有轮号也合不上。
4. `session/duplicate-report.ts` 的 `findDuplicateCards` 用的是**与轮号无关**的强证据
   （共享 callId / seq 区间重叠），注释里写得很直白：「真机上『页面快照行』和『实时流行』
   正是同一 seq 的两份，之前这里要求同轮才算，于是一边有轮号、一边没有时被漏掉（现场一个报告都没收到）」。

**结论**：检测器认得出重复，去重器认不出 —— 这道缝就是「过程条出现两三次」的稳定来源。
以前每遇到一次就打一块补丁（`dedupeById` / `dedupeSameStep` / 合成行让位），都是按 `turn` 判身份，
所以只要宿主那边轮号缺失或两份快照不一致，补丁就整条失效。

**修法（这一类的通解）**：新加 `render/messages.ts` 的 `collapseDuplicateRows`，
把「共享 callId / seq 区间重叠」这套**已经验证过的强证据**接进 `commitRows` 的最后一环：

- 一次工具调用只有一个 `callId`，一条消息只有一个 seq 区间 ⇒ 同一份数据的两份快照必共享其一；
- 同一轮的相邻两步 seq 区间不重叠 ⇒ 不会被误伤（有测试锁住）；
- 不同轮说同样的话 ⇒ 不合并（有测试锁住）；
- 三份并存时也收敛成一份（对应用户说的「两三次」）。

**证据**：`render/duplicate-collapse.test.ts` 5 条，第一条先证明旧逻辑**拦不住**
（`dedupeSameStep` 返回 2 行），再证明新层收敛为 1 行 —— 先钉死成因，再证明修法。

**没做的**：`turnStartAt` 是 session 级的（`rawClockAnchor = turnStartAt ?? …`），
所以如果真有两轮同时在跑，第二个轮头会显示同一个时长。这次没动它 —— 先看重复条消失后是否还刺眼。

### 修：子代理详情页上下滑不动（2026-11-12 真机）

**现象**：进详情页后内容超出屏幕，手指上下滑没反应。

**根因**：页面骨架复用了 `settingsLayout`，但只写了「内容排版」没写「滚动三段式」。`SlotLayout` 只负责摆槽位，滚动得由页面自己的 CSS 负责，缺一条就滑不动：

| 段 | 必须有 | 我原来漏了 |
|---|---|---|
| ① 页面根 | `display:flex; flex-direction:column; block-size:100%` | 整条漏 |
| ② grow 槽 | `display:flex; flex-direction:column; overflow:hidden` | 整条漏 |
| ③ 正文 | `flex:1 1 auto; min-block-size:0; overflow-y:auto` | `overflow-y` 与高度约束 |

照 `480-outline-page.css` 的样板补齐（`overview`/`outline`/`approval` 都是这个形状）。

**为什么单测没抓到**：jsdom 不算布局，`overflow` 滑不滑组件测试看不出来。补 3 条 CSS 断言钉住三段式（`mobile-styles.structure.test.ts`「子代理详情页要能上下滚」）。

**生效方式**：CSS 是构建产物（`lib/mobile/app.css`），改了 CSS 必须 `pnpm build`，只跑 `gen-mobile-css` 只更新了 `mobile-styles.ts`。宿主按文件 mtime 缓存静态资源，**刷新页面即生效，不用重启**。

#### 两个问题：排队消息"回撤到发送框"的根因 / 输入框不跟光标（2026-11-12 08:30）

**问题一：「明明发送成功了，文字又回到发送框」**

不是有个"回撤"动作把它塞回去的 —— 是**输入框从头到尾没被清空过**。代码事实（`views/chat/hooks/use-chat-composer.ts` 的 `send()`）：

| 分支 | 触发条件 | 对输入框做了什么 |
|---|---|---|
| 成功 | `prompt()` 正常 resolve | `setInput('')` 清空 ✓ |
| 核实 `delivered` | 超时后核实到队列/尾部有它 | 清空 ✓ |
| 核实 `absent` | 明确没送到 | 保留（正确 —— 本来就没送出去） |
| **核实 `unknown`** | 队列读不通 / 消息已从队列消失 | **不清空**，只 toast「消息可能已送出，正在确认…」，把清空交给后台 `confirmLater` |

而 `confirmLater` 的判据是 `await probeQueueForRequest(...) !== 'yes' → continue` —— **只查队列**。
消息一旦真的发出去（本轮结束、队列被消费），队列里就再也没有它，三次探测（5/12/25 秒）全是 `no`，
循环走完、函数结束，**输入框一次都没清过**。用户看到的就是：排队条出现了 / 消息已经发出去了，
而发送框里还躺着一份一模一样的文字。

所以准确说法是「**发送成功了但草稿没被收走**」，不是"回撤"。

修法（三处）：
1. `unknown` 分支**当下就清空**输入框（正文已写进 `rememberQueuedEcho` 底稿，不会丢），toast 改成「消息已送出，正在确认…」；
2. 后台确认改用完整的 `verifyDelivered`（队列 requestId / 同文行 / **会话尾部 user 消息**），消息已经离开队列也能判 delivered；
3. 只有后台明确判 `absent` 时，才把原文放回输入框（且框里已有新内容就不覆盖）—— 那才是唯一该"回撤"的时刻。

**问题二：输入框不跟最新文字换行显示**

`composer-section.tsx` 的 `fitComposer()` 已经有自动高度（镜像元素量高，1~4 行），
但超过 4 行后**框内滚动的 scrollTop 一直是 0**。实测（真包，逐行喂文本）：

| 行数 | 框高 | 内容高 | `scrollTop`（修前） | 最新行可见 |
|---|---|---|---|---|
| 4 | 112 | 112 | 0 | ✓ |
| 5 | 112 | 134 | **0** | ✗ |
| 6 | 112 | 156 | **0** | ✗ |
| 8 | 112 | 200 | **0** | ✗ |

原因：那段滚动代码只把 scrollTop「对齐到整行边界」，而它在 0 时对齐之后还是 0 —— 等于什么都没做。

修法：正文一变化就把 `scrollTop` 设到 `scrollHeight`（滚到最新一行），前提是**光标在末尾**；
光标不在末尾（用户在翻旧行）或只是宽度变化（ResizeObserver）时保持不动。
修后实测：5 行 scrollTop=22、6 行 44、8 行 88，`atBottom` 全部 true。

测试：composer 组件 99 条、composer hooks 61 条全过；包已重建。

### 修：点模型/权限时底部那条灰色长条（2026-11-12 真机截图）

**现象**：点「模型」或「权限」打开面板，输入框下方多出一条横贯的灰带。

**根因（两处叠加）**：
1. 面板遮罩 `.chat-picker-scrim` 是底栏（`.chat-dock`）的子元素，DOM 里排在元信息行 `.chat-meta` **之后**，`z-index: 40`；
2. `.chat-meta` 没有 `position/z-index`（输入行 `.chat-composer` 有 `z-index: 50` 躲开了，元信息行漏了）⇒ 同一层级下「后者压前者」，整行被压上 12% 黑。

**连带后果更严重**：那一行本来可点（模型/权限胶囊、上下文环），被遮罩盖住后点它只会关面板 —— 面板开着时根本点不到胶囊。

**修**：`.chat-meta` 补 `position: relative; z-index: var(--z-composer)`（与输入行同层）；另给 `.chat-dock` 整块不透明底色，兜住底边安全区留白。

**验证**：真包实测 `elementFromPoint` 在 y=828/838/848 全部命中 `.chat-meta`（修复前全部命中 scrim），截图 `docs/screenshots/verify-meta.png` 灰带消失。新增 2 条 CSS 断言（`mobile-styles.structure.test.ts`「元信息行必须压在面板遮罩之上」）。

### 子代理详情页：动作条钉在屏幕底部（2026-11-12 用户要求）

原来「复制结论 / 返回」在滚动区末尾，长过程要划到底才看得见返回。

`settingsLayout` 只有 `header` / `groups` 两个槽（加 footer 会触发 `validateLayout` 的契约错误），所以在 groups 内部再分两层：

```
.subagent-page-shell   ← 吃满 grow 槽高度（flex 列）
├── .subagent-page-body ← flex:1 + overflow-y:auto，自己滚
└── .subagent-actions   ← flex:none，钉在底部（含安全区留白 + 上分隔线）
```

测试：`SubagentView.test.tsx` 加 1 条 —— 断言动作条 `closest('.subagent-page-body')` 为 null（不在滚动容器里），父节点是 shell。

### 修：面板与上下文明细同时开着互相遮挡（2026-11-12 真机）

**现象**：点「完全访问」打开权限面板，接着点右下角上下文圆环 → 上下文明细卡片浮出来，被权限面板压住，只露出一角。

**根因**：模型/权限面板（`panel`）与上下文明细（`ctxOpen`）是两套独立开关，没有互斥，两个浮层能同时存在。

**修**：做成互斥 ——
- 点圆环打开明细时 `closePanel()`；
- 点模型/权限胶囊时 `setCtxOpen(false)`。

测试：`composer-meta.ring.test.tsx` +2 条（两个方向各一条，断言面板被收起 / 明细不再残留）。

#### 工作区名字收敛成唯一真源（2026-11-12 09:20，用户：「这是补丁吗，要系统解决」）

用户说得对：上一版（抽屉里按路径末段兜 + App 里查列表补名）只是补丁，而且**三处各自兜底还兜得不一样**。

**病根**：`Route` 的 17 个变体每个都内嵌整份 `workspace: WorkspaceRow`（不是 workspaceId），
于是每个造路由的地方都得自己拼对象 —— 首帧 `EMPTY_WORKSPACE`、深链 `title: ''`、
跨工作区搜索 `hit.workspaceTitle ?? ''`。拼不全就留空串，下游各自猜。

**第一步（本次落地）**：新增 `src/mobile/session/workspace-directory.ts` 的 `resolveWorkspace()`，
把「名字从哪来、没有再显示什么」收敛成**一个函数**：

| 顺序 | 来源 | `ready` |
|---|---|---|
| 1 | 路由自带标题 | true |
| 2 | 用 workspaceId 查已加载列表 | true |
| 3 | 路径末段（`D:\work\dsh-palm` → `dsh-palm`） | false |
| 4 | 中性名「工作区」 | false |

`ready` 只用于区分「权威名 / 临时名」，展示层不需要再判断第二次。

接入点（现在全走同一个函数）：
- `App.tsx` `workspaceView()`（useCallback，依赖 `workspaces`）→
  - 会话页顶栏 `workspaceName={workspaceView(target.workspace).name}`（这条以前**完全没兜底**，空就空着）
  - 抽屉 `workspace={{ title: workspaceView(drawer.workspace).name, path: … }}`
- `ui/session-drawer.tsx` 删掉自己按路径猜的逻辑，只留最后一道空串防线（显示「工作区」）。

**证据**：`workspace-directory.test.ts` 8 条（含"纯空白标题也算没给"、"列表有行但没标题就用它的路径"），
`session-drawer.test.tsx` 17 条（新增"空标题显示中性名、绝不再出现本机工作区"），App 测试全过。

**第二步（未做，另约）**：`Route.workspace: WorkspaceRow` → `Route.workspaceId: string`。
17 处构造 + 6 处读取 + 相关测试，约 1.5 小时，动的是路由类型，建议单独一轮。
做完之后"拼对象拼漏了"这件事在结构上不可能发生，`resolveWorkspace` 会成为唯一入口。

### 抽屉动效改成 iOS 那套（2026-11-12 用户：「怪怪的，一点都不高级」）

**原来为什么怪**：
1. 面板只平移 12px 再整体淡入 —— 既不像"从侧边拉出"，也不像淡入，两种语言混着；
2. 侧边栏淡入在真机上就是"先灰一下再出现"；
3. 曲线是 `ease`（起步快、收尾软），没有 iOS 那种"出发利落、落地稳住"；
4. 关闭瞬间消失（卸载即无），没有退场。

**改法**（`280-sheets.css` + `020-transitions.css` + `App.tsx` + `session-drawer.tsx`）：

| 项 | 原来 | 现在 |
|---|---|---|
| 进场位移 | `translateX(-12px)` + opacity 0 | `translate3d(-100%,0,0) → 0`，**不淡入** |
| 曲线 | `ease` | `cubic-bezier(0.32, 0.72, 0, 1)`（iOS 那条） |
| 时长 | 200ms | 进场 340ms / 退场 240ms |
| 遮罩 | 与抽屉同步淡入 180ms | 单独 300ms 渐入（收尾慢一拍，两层才有前后） |
| 退场 | 无（瞬间消失） | 先挂 `is-closing` 滑出 240ms 再卸载 |
| 后面那页 | 不动 | `scale(0.955) + translateX(3%) + 18px 圆角`，像被推开的卡片 |

`DRAWER_OUT_MS = 240` 在 `App.tsx`，只有「关掉抽屉」走退场动画；点某一行是页面转场，抽屉立刻让位。

**减弱动效**：`.palm-drawer` / `.palm-drawer.is-closing` / `.palm-drawer-scrim.is-closing` / `.page-stage` 全部登记进 `360-reduced-motion.css`（守卫「凡是 animation 的选择器都要登记」要求）。

**实测**（真包）：进场 `animationName=palm-drawer-in, duration=340`；关闭中 `.palm-drawer` 的 `left=-81` 且 class 带 `is-closing`；400ms 后节点消失；`.page-stage` 打开时 `matrix(0.955,0,0,0.955,11.79,0)` + 圆角 18px，关闭后回到 `none`。

#### 第二步：Route 只存身份，名字只剩一个来源（2026-11-12 08:10）

第一步（`resolveWorkspace` + 两处接入）之后，路由本身还在内嵌 `WorkspaceRow`，
所以"造路由的地方得自己拼对象"这个病根还在。这次一步拔掉：

**`Route` 的 17 个变体：`workspace: WorkspaceRow` → `workspaceId: string`**

| 原来 | 现在 |
|---|---|
| `EMPTY_WORKSPACE`（首帧占位） | `workspaceId: ''` |
| `chatRouteOf(session, workspace)` | `chatRouteOf(session, workspaceId)` |
| `chatRouteFromUrl()` 里现拼一份 `{ title: '', path: '' }` | `workspaceId` |
| 跨工作区搜索现拼 `hit.workspaceTitle ?? ''` | `String(hit.workspaceId ?? '')` |
| 抽屉快照 `drawer.workspace` | `drawer.workspaceId` |

读名字的地方全部改走 `workspaceView()`（= `resolveWorkspace`）；按路径过滤会话的地方
（`scopedToWorkspace`）改传 `workspaceView(id)`（它只需要 `path`）。

**结果**：全仓已经没有任何一处"自己拼一个 workspace 对象"的代码 —— 结构上不会再出现
"某个入口忘了填标题"。`grep -rn "本机工作区"` 只剩注释与测试说明。

验证：
- `tsc -b` 通过
- `src/mobile/views` 663 条、`src/mobile/{ui,session,platform,design}` 708 条全过
- 预算棘轮已随 App.tsx 行数更新（1529）

### 语音输入：从「+ 面板第四层」搬到输入框（2026-11-12，按效果图实现）

**原来**：`+` →「添加内容」→ 滚到最后一项「语音输入」→ 整屏模态面板（录音时看不见对话，也看不见草稿）。

**现在**：

| 层 | 改动 |
|---|---|
| 入口 | `composer-section.tsx`：`.chat-field` 内右端常驻 `.chat-mic`（空框带底色、有字退成次要灰，`data-empty` 控制） |
| 录音态 | 同一个 `.chat-field` 就地换成 `data-voice="recording"`：红点脉冲 + 五根波形 + `mm:ss` 计时 + ✕ 取消 + ■ 停止；**不弹模态** |
| 实时转写 | `.chat-inputbar` 上方一行 `.chat-voice-live`（有字幕显示字幕，没字幕显示状态文案；最多 2 行） |
| 转写回填 | 沿用 `use-chat-voice` → `setInput`，落进输入框可编辑，**不自动发送** |
| 取消 | 三个出口：✕ 按钮、Esc（window 捕获）、`+` 面板那一项仍保留（老路径不断） |
| 删除 | `voice-sheet.tsx` 整个文件删掉；`chat-overlays.tsx` 去掉 voice 分支 |

**踩到的两个真机问题**（都已修）：
1. 状态文字塞在录音条里放不下 —— 真机 393px 下被截成「正在听 2s / 最…」；移到上方 live 行后完整显示。
2. `--palm-fs-s` / `--palm-fs-xs` 这两个字号令牌**不存在**（真实的是 `--palm-t-s`），`styles-vars` / `structure` 守卫直接红；`#fff` 也被 `no-raw-colors` 拦下，换 `--palm-on-accent`。`--lv`（波形响度）要在 `.chat-voice-wave` 里先声明默认值，否则「var 必须有定义」那条红。

**测试**：`ChatView.test.tsx` 重写 4 条语音用例（原来的都断言模态 dialog）——
就地录音不弹面板 / 取消不填字不提交 / Esc 取消 / 转写中取消后迟到结果被丢弃。golden trace 用 `UPDATE_TRACE=1` 重建（差异只有多出的「语音输入」按钮）。

**真包验收**（Playwright + fake mic）：点麦克风 → `data-voice="recording"`、计时 `00:02`、上方「正在听 2s / 最长 60s」、`[role=dialog]` 为 null；点 ✕ → 回到常态、输入框仍为空。截图 `docs/screenshots/voice-recording.png`。

### 修：语音录音条"太丑"（2026-11-12 用户第二拍）

第一版按效果图做了结构，但真机截图一眼假。逐条对出来的原因：

| 症状 | 根因 |
|---|---|
| 框里出现一个白底黑框的方按钮 | `chat-voice-cancel` 只写了类名**没写样式**，原生 `<button>` 就是那副样子 |
| 五根波形像 `IIIII` | 响度变量名是 `--voice-level`，我写成了 `--lv` ⇒ 一直读默认值；而且五根用**同一个乘数**，静止时必然等高 |
| 红点/波形/计时挤在左边，右边空一大块 | 删掉状态文字后没有 `flex:1` 的元素，停止键停在计时后面（没推到右端） |
| 上方那行只是灰字 | 效果图是「文字 + 右侧取消」，做成了整行一段 |

修法：
1. 取消移到**框外**（上方那行右侧）做成文字按钮 —— 效果图的录音条里本来就没有第二颗按钮，塞进去必挤；
2. 波形改用真变量 `--voice-level`，七根各给不同乘数（`18/11/16/9/14/10/13`），静止时也是错落的；
3. `.chat-voice-stop` 加 `margin-inline-start: auto`，停止键贴到右端（实测距框右缘 9px）；
4. 波形不透明度 0.72 → 0.92、停止键 32 → 34px、`[data-voice]` 左内边距收窄，对齐效果图比例。

验收（真包 + fake mic）：七根条实测高度 `22/15/20/13/18/14/17`（不再等高）、计时 `00:03`、停止键右端 gap 9px、`[role=dialog]` 为 null。截图 `docs/screenshots/voice-recording.png`。

### 事故与修复：ChatView.tsx 被写成非法 UTF-8（2026-11-12 15:00 前后）

**现象**：`pnpm typecheck` 报 `TS1002 Unterminated string literal`（L725 / L1515 / L2154），`read` 工具直接拒绝该文件（invalid UTF-8）。

**范围**：762 行含非法字节，典型形态是中文末字节被替换成 `?` 且吞掉后一个字节 —— 例如 `—`（`E2 80 94`）变成 `E2 80 3F`、`框'`（`E6 A1 86 27`）变成 `E6 A1 3F`。ASCII 代码完好，所以只有 3 处真正破坏语法（字符串引号被吞）。

**修复**：
1. 用 `git show HEAD:…` 取原始文本，按「损坏点之前的前缀 + 最后一个损坏点之后的后缀」双端匹配工作区行 → **自动修复 660 行**（注释与文案原样还原）；
2. 手工修 3 处语法：`toast('正在载入…')`（3 处同文）、`第 ${turn} 轮不在更早的历史里`；
3. 全文转回 LF（写回时曾被写成 CRLF）。
4. 修复后：typecheck 0、build 0、`ChatView.test.tsx` 242 条全过。

**遗留**：**98 行注释里仍有 `�` 替换符**（不影响编译与运行，但源码难看）。它们集中在 `*` / `//` 注释续行，HEAD 里已无对应原文（该块被重写过）。要清理得逐条按语义重写。

**推断的成因**：写回时用了「按非 UTF-8 编码读 → 按 UTF-8 写」的路径（`?` 是编码器无法表示字符的替换符，吞字节是定长缓冲的痕迹）。不是 `edit` 工具或 gen-css 造成的 —— 同批写入的其它文件（`composer-section.tsx`、`260-input-bar.css`）都完好。

### 修：语音按钮过大 / 没有取消键 / 一行字太少（2026-11-12 第三拍）

**① 语音按钮太大**：`.chat-mic` 原来按 `var(--palm-hit)`（44px）画，在 48px 高的框里几乎顶满 → 改 **30px**（命中区靠 padding 撑）。实测 30px。

**② 点语音后没有取消键**：上一拍把「取消」放到框外做灰色文字按钮，真机上看不出来（`--palm-fg-3` 灰字、44px 行高、贴着转写行）。现在做成**框内浅灰圆形 ✕**（30px），与红色停止键成对靠右：取消键吃 `margin-inline-start: auto`，停止键紧跟其后（实测取消右缘 288、停止右缘 326、框右缘 335）。

**③ 一行字太少**：
| 项 | 原来 | 现在 | 收益 |
|---|---|---|---|
| 底栏左右留白 `--palm-dock-pad` | 18px | 14px | +8 |
| 按钮间距 `--palm-dock-gap` | 10px | 8px | +6 |
| textarea 左右内边距 | 16px | 12px | +8 |
| 输入框长高上限 | 4 行 / 112px | **6 行 / 168px** | 写长文不用翻 |

textarea 实测宽 243px，减左右 24px ≈ **219px 文字区 ≈ 15 个汉字/行**（改前约 13）。

**结构上限**：393px 屏宽 − `+`(34+8) − 发送(34+8) − 左右留白 28 = 281px 框宽，框内还要放麦克风 30px。**想要 18 字以上只能减少常驻按钮**：打字时把 `+` 缩到 24 → ~16 字；打字时隐藏 `+` → ~19 字（代价：打字时没有附件入口）。发送键移进框内**没有收益**（框外省下的宽度正好被框内占掉）。
