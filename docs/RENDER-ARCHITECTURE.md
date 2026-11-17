# 显示渲染重构：从「逐页救火」到「一条管线」（设计与执行记录，2026-11-17 收尾）

> 面向问题：**dsh-palm 的显示问题为什么总是修完又换一种样子回来。**
> 本文只回答三件事：问题有几类、根因有几条、重构后每条根因由哪个机制根除。
> 与 [MOBILE-RENDERING.md](./MOBILE-RENDERING.md) 的关系：那份定义**不变式**（对什么），
> 本文定义**管线与所有权**（谁来做、在哪一层做）。

---

## 0. 结论速览

| 项 | 结论 |
|---|---|
| **要不要重构** | 要，但只重**渲染管线**（约 4 个模块），不重写 9 屏、不换框架、不引虚拟列表库。 |
| **改什么** | ① 几何所有权收成 1 处 ② 估算高改成实测高 ③ CSS 从"顺序即优先级"改成 `@layer` 分层 ④ 折叠/裁决从视图里搬进纯投影 |
| **多久** | 5 个切片 ≈ **8.5 人日**，每片独立可回退、当天可验证。 |
| **不做的后果** | 同一类 bug 会继续以新面孔回来：现有 4 个模块各写一次 scrollTop，任何一次改动都在和另外 3 个抢同一条不变量。 |

---

## 1. 现象只有 8 类，根因只有 4 条

### 1.1 八类现场（每一类都能在本仓库找到实例）

| # | 现象 | 历史实例（可查） | 触发条件 |
|---|---|---|---|
| P1 | **闪**（整块重挂/动画重播） | key 退化成 `row.id` → 113/114 行 remount；换皮肤词闪一帧 | 生产者切换、key 变化 |
| P2 | **跳**（滚动位置位移） | 进会话补页把列表顶上；图片占位差 550px | 上方高度变化 |
| P3 | **重复**（同一实体两份） | 同一轮两张过程卡；重进在跑会话每行两遍（`dedupeById` 兜底） | 多个生产者同帧有数据 |
| P4 | **抖**（高度反复变化） | 过程条每来一条命令长高 18px；`done→running` 首帧跳变 | 行内高度随数据长 |
| P5 | **错位/溢出/截断** | 工具名截断；折叠按钮被裁；`text-never-shrinks` | 窄屏 + px 硬编码 + 无收缩规则 |
| P6 | **空白/白屏** | 窗口化后正文不再出现（锚点冻结在新行之外）；冷启 1.8s 空白 | 窗口/首屏窗口与真实高度不符 |
| P7 | **残留/幽灵** | 排队条残留；卡挂行上被替换后消失 | 生命周期挂在会被重建的对象上 |
| P8 | **慢**（掉帧） | 97 行 p95 229~392ms / max 3333ms；IDB `onsuccess` 1728ms | DOM 行数 × 每行成本 |

### 1.2 四条结构成因（这才是重构对象）

| # | 成因 | 证据（可复核） | 现有补丁（同类多份） |
|---|---|---|---|
| **C1** | **几何没有单一所有者**：聊天容器的 `scrollTop` 曾有 2 处写（`use-stick-to-bottom.ts` 与 `ChatView.tsx` 的 fallback —— 后者已在 S1.1 收口），另有 3 处写的是别的滚动体（输入框、推理正文）；**散落布局读 62 次 / 12 个文件**（ChatView 独占 33），滚动所有者内部另 10 次（允许）；浏览器原生锚定也没关 | `node tools/render-contract/check.mjs --verbose`；`150-chat.css:17` 仍是 `overflow-anchor: auto` | `chat-scroll-anchor.ts` / `use-stick-to-bottom` / `use-chat-scroll-follow` / `scroll-machine` —— **一条不变量、四个主人** |
| **C2** | **高度靠估算而非实测**：虚拟窗口用 `estimate()` 前缀和当内容总高、每帧重建 O(n) 数组；`content-visibility` 的门槛是 `KEEP_BOTTOM=10000`，单会话不足 1 万行时该机制**一行都不生效** —— 却是总高的第三个来源（**S2 已收口**：总高改由行高账本给，该分支已删） | `row-metrics.ts`（账本，按身份记实测高）、`use-row-window.ts` 的 `ResizeObserver` 接线 | 现在只剩两条：账本（实测优先）+ 手工 prepend 补偿 |
| **C3** | **样式无层序**：82 个 CSS 按文件名拼接，"顺序即优先级"，`v21` 覆盖层 50KB，25 套皮肤后置叠加，**1671** 个 px 字面量、0 个 `@layer`/`:where`/容器查询 | 规则体 336,873 B（原件 524,478 B，差值是注释）；`370-v21.css` 50,384 B | 每加一屏/一皮肤就再追加一个覆盖文件 |
| **C4** | **提交时机分散**：4839 行的 `ChatView` 里 28 个 `useEffect` 各自 setState；每帧同步读布局、每帧写缓存快照 | `views/ChatView.tsx`（4839 行 / 28 effect / 39 处布局读） | `recordSpan('render:rows')` 只能事后发现"慢"，不能防止"闪" |

> 一句话：**P1–P8 都是 C1–C4 的投影**。所以修 P 永远修不完，只有修 C 才会一次停一类。

---

## 2. 业界怎么解的：四个范式，四种"所有权"回收

| 范式 | 代表项目 | 它们强制的规则 | 我们的落点 |
|---|---|---|---|
| **视图模型单一化**<br>（不可变 doc + transaction + view） | [ProseMirror](https://prosemirror.net/docs/guide/)、[CodeMirror 6](https://codemirror.net/docs/guide/)（state/view 分离）、Monaco（model/editor 分离）、xterm.js（grid + 脏行重绘） | 变更只能作为 transaction 提交给**一个** state；未改动的子树结构共享；view 只做投影 | `projections/chat.ts`：`project(prev, batch) → next` 纯函数，`messages.ts` 折叠、`frame-effects`、`session-status` 裁决全部收进去（C4） |
| **测量式虚拟化 + 锚点归属** | [FlashList v2](https://shopify.engineering/flashlist-v2)（取消预估、维护可见位置）、[LegendList](https://github.com/LegendApp/legend-list)、[react-virtuoso](https://virtuoso.dev/)（`firstItemIndex` 前插不改下标） | 锚点 =（itemId，项内偏移），**永远不是 scrollHeight 差**；测高修正与插入在同一帧补 `scrollTop` | `render/row-list.tsx`：唯一滚动所有者；`heightCache: Map<rowKey, px>`；前插不改行下标，只改锚点（C1/C2） |
| **不确定性前置** | [CSS Scroll Anchoring L1](https://drafts.csswg.org/css-scroll-anchoring/)、[CLS](https://web.dev/articles/cls)、[content-visibility](https://web.dev/articles/content-visibility) | 浏览器只补偿"布局变化"，脚本每帧改 `scrollTop` 时它会静默失效或二次跳 → 业界普遍**关掉原生锚定、自己接管**；未知尺寸一律先占位 | 容器设 `overflow-anchor: none`；图片/代码块/表格/折叠行必须有外框；`ResizeObserver` 回调合并进一次 rAF（C1/P2/P6） |
| **层序而非特异性** | [CSS `@layer`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@layer)、Radix/Tailwind 的 token 化、[容器查询](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Containment/Container_queries) | 谁赢由**层声明顺序**决定，与选择器权重无关；组件只消费 token；皮肤只改写 token | `@layer reset, tokens, base, components, screens, skins`；25 套皮肤合并成 token 覆盖（C3） |

补充两条与 React 直接相关的取舍（[useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)）：

- 外部 store + selector 是**同步**更新，换来的是"读取时一定是最新几何"，比 transition 更适合贴底场景；
- **流式新行不进 transition**（会延迟可见、破坏贴底），只有历史批量渲染、非紧急重排才降级。

---

## 3. 目标架构：一条管线，五个所有者

```
stream/mux.ts ──SSE──┐
                     │  ① 事件（带单调 seq）
                     ▼
        projections/chat.ts        ② 纯投影：events → ChatState
        （折叠/水位线/相位裁决）        O(delta)，可单测穷举
                     │  ChatState（不可变快照）
                     ▼
        kernels/chat-store.ts      ③ 单一 store + watermark + snapshot
                     │  useChatStore(selector)  ← useSyncExternalStore
                     ▼
        views/chat/*               ④ 纯装配：零 DOM 读、零几何写
                     │  rows / anchors / phase（只读）
                     ▼
        render/row-list.tsx        ⑤ 唯一滚动与几何所有者
          测量缓存 · 锚点 · 贴底状态机 · 一帧一次提交
                     │
                     ▼
        message-row/*              行：几何自声明（占位外框、min/max）
```

### 每层的"禁止项"（比职责更重要）

| 层 | 只许 | 禁止 | 断言 |
|---|---|---|---|
| 投影 `projections/` | 纯函数、无 DOM、无 React | import 任何 `views/`、`render/` | 现有"内核纯净"断言扩展到本目录 |
| store `kernels/` | 持有快照 + 水位线 | 业务判定（判定属于投影） | 无 `if (kind ===` 的领域分支 |
| 视图 `views/` | 读 store、装配 props | `scrollTop =`、`getBoundingClientRect`、`useEffect` 多于装配需要 | `views/` 下几何 API 计数 = 0 |
| 列表 `render/row-list.tsx` | 写 `scrollTop`、测高、维护锚点 | 业务判定、数据请求 | `mobile/` 下 `scrollTop =` 只此 1 处 |
| 行 `message-row/` | 声明几何 + 渲染内容 | 改变行外布局 | 每类行导出 `geometry(row)` |

---

## 4. 五条硬契约（每条都能变红，不靠自觉）

| # | 契约 | 具体定义 | 断言（新增） |
|---|---|---|---|
| **K1** | **单写者** | `ChatState` 只能由 `project()` 产出；视图层不持有可写状态（展开/折叠等纯 UI 态除外） | `views/` 中出现 `setState(` 用于领域数据 → 红 |
| **K2** | **位置身份唯一实现** | `rowIdentity(row)` 全仓一份；React `key` 只能来自它 | `key={…id}` 直接引用生产者 id → 红；`rowIdentity` 实现数 > 1 → 红 |
| **K3** | **几何契约** | 每类行导出 `geometry(row) → {minH, estH, maxH?}`；图片/代码/表格/折叠行**先有外框后填内容** | 行组件缺 `data-geo` → 红；行内高度变化影响行外（改父级 flex/gap）→ 评审拒 |
| **K4** | **锚点单写者** | 「可视区锚点 =（rowKey, 项内偏移）」；只有 `row-list` 能写 `scrollTop`；容器 `overflow-anchor: none` | `scrollTop =` 出现第 2 处 → 红 |
| **K5** | **样式分层** | 六层 `@layer`；皮肤层**只许**写自定义属性；px 字面量只许出现在 tokens 层 | `skins` 层出现 `padding/margin/width/height/gap` → 红；非 tokens 层出现 `\d+px` 且非 0 → 红 |

> K2/K3/K4 是这次重构的**收益主要来源**：C1、C2 两类根因各由一条契约根除。

---

## 5. 迁移：5 个切片，每片可回退、当天见数字

> 顺序刻意与"想改的欲望"相反：**先冻结证据 → 再收所有权 → 再换算法 → 最后动视图**。
> 反过来的失败模式本仓库已经付过一次学费（先改 ChatView 再补锚点，补了四个模块）。

| 片 | 工作量 | 改什么 | **不动什么** | 验收（现有工具） |
|---|---|---|---|---|
| **S0 冻结证据** | 0.5d | 把 `loaf/pipeline` 连续 3 次取中位数固化成脚本；`mobile-render-audit` + `stress-entry` 接进 `pnpm verify` | 业务代码 | 基线表写入本文件；门禁从"可选"变"必跑" |
| **S1 收所有权** | 1.5d | 9 处 `scrollTop` 写点收到 `row-list.tsx`；关掉 `overflow-anchor`；`ResizeObserver` 批量到一次 rAF | 行组件、数据结构 | 三场景（加载更早/图片落地/折叠展开）：偏移 ≤2px、二次跳 0、50ms×40 帧采样 0 位移 |
| **S2 换测量** | 2d | 删 `estimate()` 前缀和；改 `heightCache` + 实测索引；删 `KEEP_BOTTOM` 常量与 `content-visibility` 叠加 | CSS、投影 | 97 行 p95 ≤100ms（20× 降频）；快速滑动空白 ≤1 帧；滚动条长度误差 ≤5% |
| **S3 样式分层** | 2d | 82 文件进 6 个 `@layer`；`370-v21.css` 合并回所属层；25 皮肤改 token 覆盖 | 视觉外观（零差异） | 视觉门禁 0.00%；CSS 体积 −25%；加一套皮肤 = 1 个 token 文件 |
| **S4 投影收口** | 2.5d | `messages.ts` 折叠 + `frame-effects` + `session-status` → `projections/chat.ts`；`ChatView` 拆成 store + 纯装配 | 交互流程与文案 | 首屏 ≤200ms（缓存命中）；`ChatView` ≤1200 行、`useEffect` ≤6、布局读 0；行数单调/身份唯一/首帧完整率 ≥80% 继续绿 |

**合计 ≈ 8.5 人日。** 每片结束都是一个可发布版本；任一片失败只回退该片，不留半成品状态。

### 为什么是这个顺序（一条可验证的理由）

- S1 之前，S2 的测量值会被另外 3 个 `scrollTop` 写点覆盖 —— 实测不出改善（上一轮"改虚拟化反而 p95 285ms"就是这类）；
- S3 之前，S4 拆出来的视图仍会被 50KB 覆盖层按顺序抢样式，拆了等于没拆；
- S0 之前，任何"改好了"的判断都不可信（同代码两次 p95 实测差 141ms）。

---

### 为什么 1200 是三档而不是一个数（2026-11-17 修正）

"ChatView ≤1200" 是**终点**，不是下一片的目标。按今天两次被证伪的搬迁（定位域 20 参 seam、
props 契约撞 viewDataImports 预算）算，靠"按域切文件"最多把行数压到 4000 上下；要到 1200，
必须先把派生量收成投影（T1–T3）、再把 JSX 的面板装配抽走（T4）。所以目标写成三档，每档有判据：

| 档 | 行数 | 判据（做到什么才算这一档完成） |
|---|---:|---|
| 一档 | ≤4400 | renderRows / 相位 / bars 都是投影入口调用，ChatView 里不再有"再扫一遍 messages"的循环（2026-11-17 实测：JSX 只占 293 行，逻辑 4103 行；≤4000 需再切一个域，而那两次切域都被证伪，故改 4400） |
| 二档 | ≤2500 | 14 段面板 props 装配抽成 hook；useEffect ≤ 12 |
| 三档 | ≤1200 | 只剩装配与事件接线；useEffect ≤ 6；layoutReads ≤ 20 |

## 6. 明确不做（防止重构变成重写）

| 不做 | 理由 |
|---|---|
| 换框架（Solid/Svelte）或 Canvas 渲染 | 问题不在渲染器，在所有权；换框架会把 2666 条测试和 41 条真机用例清零 |
| 现在引 LegendList / react-virtuoso | K4 不先立，任何库都会和现有写点打架（收口前 5 处，收口后 4 处）；S1 完成后再评估（届时是"替换 300 行"而非"引入架构"） |
| 重写 9 屏 / 改信息架构 | 显示问题不来自信息架构；`layout-contract.md` 的 L1–L4 分层继续有效 |
| 运行时切布局 | 现有 `layout-contract.md` 已把它列为"重估项"，与本次目标无关 |
| 删 `dedupeById` / `sameRenderedRow` 等兜底 | 它们是 K1/K2 落地**之后**才能删的二次防线，顺序反了会立刻回归（P3 会重新出现） |

---

## 7. 附录：证据与闸门（复核用）

一条命令出全部数字（**先剥注释再计数**，注释里写 `scrollTop = 0` 不算写点）：

```powershell
node tools/render-contract/check.mjs --verbose
node tools/render-contract/check.mjs --write      # 确认改善后，把上限压到当前实测值
```

| 契约 | 2026-11-17 基线 | 目标 | 度量口径 |
|---|---:|---:|---|
| K4 `scrollTopWrites` | **4**（聊天容器 1，其余是输入框/推理正文） | 1 | 剥注释后 `scrollTop =` 的出现次数 |
| K4 `layoutReads` | **50**（12 个文件，ChatView 26，其中 14 次在定位 effect 里） | ≤10 | `getBoundingClientRect/.scrollHeight/.clientHeight/.offsetHeight`，**不含几何所有者内部**（滚动层 + 窗口层，现为 11 次，单独报数） |
| K5 `pxLiterals` | **1671** | ≤200 | `styles/*.css` 剥注释后 `\d+px` |
| K5 `cssLayers` | **0** | ≥6 | `styles/*.css` 的 `@layer` 声明数 |
| K1 `chatViewLines` | **4386** | 4400 → 2500 → 1200（三档，见下） | 文件行数 |
| K1 `chatViewEffects` | **28** | ≤6 | `useEffect(` 次数（剥注释） |

> **口径修订（2026-11-17）**：`layoutReads` 改为**不计滚动所有者内部的读点**。理由不是放宽，
> 而是这条契约本来要防的是「几何读散落在视图里」；所有者内部读数变多恰恰说明别处变少。
> 同一时点若把所有者算进来是 71 次 / 13 文件，改成不计之后是 62 / 12。

> **修订记录（2026-11-17）**：本文件 v0 写的「9 处 scrollTop 写点 / 106 次读 / 2000 个 px」是
> **没剥注释的 grep 结果**，其中 4 处「写点」其实是中文注释里的示例（`scrollTop = 0`）。
> 已按闸门口径订正为 5 / 71 / 1671。这正是本项目 MEMORY 里那条铁律的复现：
> 「凡要做位置或分支判断，先剥注释、再按代码行判」。闸门脚本就是这条铁律的可执行版本。

---

## 8. 执行记录

| 片 | 状态 | 做了什么 | 证据 |
|---|---|---|---|
| **S0** | ✅ 2026-11-17 | 新闸门 `tools/render-contract/check.mjs`：剥注释计数、只降不升、`--write` 压低预算；基线入库 `budget.json`；`pnpm verify:render-contract` 可跑 | 一条命令出 6 个数；越界 `exit 1` |
| **S1.1** | ✅ 2026-11-17 | 认领抽成 `stream/scroll-claim.ts`（点/区间两种形状）+ 6 条单测；搜索定位不再自己写 `scrollTop`，改走 `scrollToTarget(target,{smooth:true})` | `scrollTopWrites` 5→4（聊天容器只剩 1 条语句）；`tsc -b` 通过；认领/接线用例 9/9 |
| **S1.2** | ✅ 2026-11-17 | 核过补页补偿路径：`use-chat-history` 的 `restorePrependScrollTop` 返回值本来就经 `setScrollTopProgrammatically` 落地，**不需要改**；定位收口后聊天容器写点 = 1 模块 / 1 条语句 | 闸门 `scrollTopWrites` 明细：聊天容器 1、输入框 2、推理正文 1 |
| **S2** | ✅ 2026-11-17 | 行高从"每帧估"改成"**测到就用测到的**"：新增 `views/chat/lib/row-metrics.ts`（按位置身份记账、视口上方不收新值、亚像素抖动不重算），`use-row-window` 挂 `ResizeObserver` 把量到的高度并进账本，`MessageRow` 增 `data-row-key` | 总高与占位来自同一份账本；ChatView 261 条用例与窗口 2 条用例全绿 |
| **S1.3** | ⏸ 阻塞 | `overflow-anchor: none` + 注释证据链改写 | **缺证据**：本机 `/m/` 返回 200 但没有 `PALM_PAIR`，跑不了 `verify:render` / `verify:visual`；不做无真机 A/B 的翻转 |
| **S3–S4** | ⬜ | 见 §5 | — |

### S1.1 的根因（可复核的代码路径）

搜索定位原来直接 `box.scrollTo({behavior:'smooth'})`，**不经过认领**：

1. `use-chat-scroll-follow.ts` 的 `claimed` 只看 `programmaticScrollRef / Value / At` —— 这次写入一个都没设；
2. 定位由一次点按发起，`Date.now() - lastTouchAtRef < 800ms` 成立 → 该事件被记成 `gesture`；
3. `scrollReducer` 的 `gesture` 分支把 `userMoved` 置真；
4. `maySettlePin()` 第一条就是 `if (state.userMoved) return false` → **本轮补钉永久失效**
   （"进会话不落到底部 / 卡片长出来把人顶走"那一类现场）。

修法不是再加一个判断，而是让「写滚动」只有一条路：`scrollToTarget` → 认领（点或区间）。
区间认领（`until`）是必须的：平滑动画会连发几十个事件，点判据只认领得到第一个。

### S0–S1 回归结果（2026-11-17 10:42）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -b --pretty false` | exit 0 |
| 全量用例 | `npx vitest run` | 364 文件 / **4232 通过** / 10 跳过 / exit 0 |
| 质量预算 | `quality-budget.test.ts` | 16/16 |
| 行数棘轮 | `node tools/check-budget.mjs` | files 19 / dirs 20 全绿（见下"预算上调"） |
| 渲染契约 | `node tools/render-contract/check.mjs` | 6 项全 OK，`scrollTopWrites` 已压到 4 |
| 链路 | `pnpm verify --only budget,contract` | PASS 2/2 |

**预算上调（一次性结构预算，非补丁）**：新增 `stream/scroll-claim.ts`（60 行）+ `use-stick-to-bottom.scrollToTarget`（73 行）
共约 136 行，四个目录上限按实测同步上调并写了 `dirsRaised.reason`（带 expires）。
`tools/render-contract/budget.json` **未上调** —— 那是渲染契约，只降不升。

**没做到的**：`overflow-anchor` 的关闭（S1.3）。本机 `/m/` 虽然返回 200，但没有 `PALM_PAIR`，
`verify:render` / `verify:visual` 跑不起来；没有真机 A/B 就不翻这个开关 —— 它是唯一一条"改了可能更好也可能更坏"的项。

### S2 做了什么（2026-11-17）

**一句话**：内容总高不再等于 Σ 估值，而是「量到的用量的、没量的才估」。

| 层 | 改动 | 为什么 |
|---|---|---|
| `views/chat/lib/row-metrics.ts` | 新增行高账本：按**位置身份**（`turn.step` 这类键）记高度；亚像素抖动（<0.5px）不重算 | 补页/换生产者会让行整体位移，按 id 记的高度会错位 |
| 同上 | **视口顶部以上的行不收新测量值** | 那些行高度一变，屏幕上已经看到的内容会整体位移 —— 这是"测量把自己顶跳"的唯一来源 |
| `use-row-window.ts` | 前缀和从"每帧 O(n) 重建"改成"账本按需重算"；`ResizeObserver` 批量并入一次重算 | 流式每 16ms 一帧，原来每帧重建 400+ 数组 |
| `message-row.tsx` | 3 处根元素加 `data-row-key` | 账本要按身份认行；不新增 DOM 层级、不改样式 |

**没做（留给 S2 之后）**：行在**上滑**时进入视口（落在顶部以上）只记估值不记实测 —— 要补这一半，得先有"测量后按 delta 回挪 `scrollTop`"的补偿，
而那必须走 K4 的唯一写点，属于下一步的接线工作，不是纯账本能解决的。

**数字**：`layoutReads` 散读 62（几何所有者内部 11，白名单只有"滚动层 + 窗口层"两个文件）；
`scrollTopWrites` 4（聊天容器 1）。

### S2 顺手删掉的一处死机制（2026-11-17）

`chat-rows.tsx` 里那条 `content-visibility` 分支（门槛 `length - 10000`）**从未生效过** ——
单会话不足一万行，`cv` 恒为 `undefined`。它不产生行为，却让"总高是谁算的"多一个来源，
后来者读到这里会以为还有第三套几何。已删（连同常量与 `CSSProperties` 导入），
删掉后全量 4239 条用例不变、行数预算自动回落。

**判据**：`grep contentVisibility` 在生产源码里现在应当为 0。

### S2b 补上「测量补偿」这一半（2026-11-17）

S2 的第一版留了一条边界：视口上方（已滚过去）的行不认实测值，因为改了会把画面顶走。
这一版把它补齐，链路是**单向**的，写点仍然只有一个：

```
账本 record(key, h) → { changed, shift }      // shift 只在「行在视口顶部以上」时非 0
      ↓  窗口层把一批 shift 加起来
onGeometryShift(Σ)                            // ChatRows 的 prop，来自 ChatView
      ↓
scrollHandle.scrollBy(Σ)                     // 滚动层：唯一写 scrollTop 的地方
```

为什么不是让测量层自己写：写了就是第 5 个写点，K4 立刻破；而且补偿写进去的回声会被
`use-chat-scroll-follow` 当成读者手势（`userMoved` 置真），补钉又永久失效。

**验收**：`use-row-window.measure.test.tsx` 4 条 —— 视口上方测高 → 回调收到 `+500`；
不接回调 → 只记账不动画面；短会话不量；占位高度随账本变化。
`scrollBy` 另有 1 条：相对挪动 + 认领回声。

### S4-1 第一刀：搜索落点机制搬出 ChatView（2026-11-17）

| 项 | 前 | 后 |
|---|---:|---:|
| `ChatView.tsx` 行数 | 4839 | **4585** |
| `useEffect` 数 | 28 | **25** |
| 搬出的行数 | — | 273 行 → `views/chat/hooks/use-search-marks.ts` |

搬的是「屏幕上有哪些高亮 / 跳到哪一格 / 计数怎么算」这一整组：
`renderedMatches`、`gotoRenderedMatch`、`markOfHit`、`jumpToRenderedMark`、`stepRenderedMark`、
`searchView`，连带三条 effect（词变了自动落点、MutationObserver 同步计数、翻页落地补跳）。

**为什么先搬它**：这一组只跟 DOM 里的 `.chat-search-mark` 打交道，不碰消息折叠与回合判定 ——
是 ChatView 里耦合最少的一块，261 条 ChatView 用例能整段守住。

**口径没变**：一处理解仍是 `(messageId, partId, offsetInPart)`；`markOfHit` 的 seq 兜底原样保留。
唯一的变化是把 `messagesRef` 读成了参数 `messages`（同一刻的同一份数据，依赖更显式）。

### S4-2：两次被撤回的抽取 + 一次落地（2026-11-17）

**撤回之一：整块搬「定位」域（616 行）。** 按文本整块切出去后 `tsc` 一次报出 **20+ 个未定义符号**
（`programmaticScrollRef`、`initialFocusQuery`、`setChatSearchOpen/Term`、`toast`、`hasOlder`、
`decideMiss`、`FOCUS_MAX_PAGES`、`loadOlderRef` …）。这些符号横跨搜索/翻页/提示/滚动四个域 ——
「定位」不是可切边界，而是共享闭包的一个切面。硬切只会得到一个 20 参 hook：文件短了，耦合没少。

**撤回之二：把 `ChatViewProps` 搬进独立契约文件。** `tsc` 通过、`ChatView` 掉到 4456，
但两条守卫当场拦下：

| 守卫 | 报错 | 说明 |
|---|---|---|
| `architecture` | `views/chat 必须分区（顶层不许再放文件）` | 契约文件放错了层 |
| `quality-budget` | `viewDataImports ≤ 14` | props 契约要用 `api.ts` / `mux.ts` 的类型，搬出去就多一个"视图层直连数据层"的文件 |

**落地：只搬纯常量。** `OUTGOING_TTL_MS` / `SEND_ECHO_GRACE_MS` / `AWAITING_TTL_MS` / `hasModelOutput`
→ `views/chat/lib/outgoing-flight.ts`（只依赖 `RenderMessage` 的形状，不碰数据层）。
`ChatView` 4585 → **4560**；`useEffect` 28 → 25（S4-1 的功劳）。

**结论（写给下一次动手的人）**：这个文件的瓶颈不是"行数没搬够"，而是**一个 4540 行的闭包**。
按域切文件只能减行数；要减耦合，得先把 `messages / loading / hasOlder / toast / scroll / search`
收成一份显式投影输入，再让各域从输入里取。**S4-3 之前不建议再做整块搬迁** —— 今天两次撤回
就是这个结论的两次实验。

### S4-2b：回合锚点三个纯函数搬出（2026-11-17）

`newestTurnAnchor` / `lastUserMessageAt` / `clampAnchorToOwnTurn` → [turn-anchor.ts](packages/dsh-palm/src/mobile/views/chat/lib/turn-anchor.ts)。
它们只认 `RenderMessage` 的形状（外加 `newestFoldTurn` 一个纯函数），不碰 DOM、不读 state。

| 项 | 前 | 后 |
|---|---:|---:|
| `ChatView.tsx` | 4560 | **4478** |
| 累计（相对 4839） | — | **−361（−7.5%）** |

搬这一块的理由：秒表口径在真机上返工过四次（「等回话 43分34秒」，实际 8 分钟），
判据现在是三行纯函数 —— 留在 4500 行的闭包里，下次改计时只能靠通读；搬出来之后
它可以在单测里直接喂数据。

### S4-3a：把"补页锚点"并回滚动所有者（2026-11-17）

K5 要求"锚点只有一个主人"。补页校准（`history/chat-scroll-anchor.ts`）是第二个：
它按**屏幕位置**算落点，读的却是同一批几何属性，于是仓库里有两套"内容变长后怎么不让画面跳"的口径。

| 项 | 前 | 后 |
|---|---:|---:|
| 非所有者模块的散读布局 | **62** | **56** |
| 几何所有者文件数 | 2 | 2（未变，但 history/ 不再是读点） |
| `src/mobile/history/` | — | **−102 行**（模块 + 用例各搬走一个） |

`capturePrependAnchor` / `restorePrependScrollTop` / `PrependAnchor` 现在和 `scrollToTarget` / `scrollBy`
住在同一个文件里：**读几何的只有两处 —— 滚动所有者 + 行高账本**，这是 K4 的文字版。
`chat-scroll-anchor.test.ts` 5 条原样搬成 `ui/hooks/prepend-anchor.test.ts`，断言一条没改。

**顺带的好处**：`layoutReads` 从此只反映"其它模块偷偷读布局"的量 —— 62 → 56 说明 history 那层彻底不碰几何了。

### S4-3b：ChatView 的几何判据收回所有者（2026-11-17）

三个原来散在视图里的读法，收成滚动所有者的三条方法（判据只有一份）：

| 方法 | 替代了什么 | 调用点 |
|---|---|---|
| `gapPx()` | `scrollHeight - scrollTop - clientHeight` 现算 | 贴底补钉（原来自己读三个属性，且用的是上一帧快照） |
| `noteContentHeight()` | `lastScrollHeightRef.current = el.scrollHeight` ×3 | 补钉落底后记基线 |
| `firstRowIdAbove(inset)` | `getBoundingClientRect` 循环找"第一条底边越过视口顶的行" | 「读者正在读哪一行」 |

| 项 | 前 | 后 |
|---|---:|---:|
| 散读布局 | 56 | **50** |
| `ChatView.tsx` | 4478 | **4470** |

**没动的地方，以及为什么**：`?debug=1` 的入口追踪自己 `querySelector('.chat-scroll')` 读三个属性、
长按菜单按目标元素算浮层锚点 —— 这两处读的是**别人家的几何**（诊断 / 浮层定位），
不属于滚动所有者，硬搬只会把不相干的职责塞进来。**50 这个数的意义是"其余模块还偷偷读了多少"，
不是必须归零。**

### S4-3c 投影改造第一刀：阅读读数收进 `projectReading`（2026-11-17）

**问题**：同一条事实有三个实现。`ChatView` 里"最新一轮是第几轮"分别出现在
`turnEntries/maxTurn` 的 `useMemo`、`hostNewestTurn` 的 `useMemo`、`activeTurn` 的 IIFE、
`newestCardTurn` 的 IIFE —— 四处各自把 `messages` 再扫一遍，口径还不完全一样。
改一处忘一处，现象就是"跑着的时候冒出交付卡""滑条读数停在上一轮"。

**做法**：`views/chat/lib/reading-projection.ts` 一个纯函数 `projectReading({ messages, turnOutlineRaw, currentTurn })`，
一次算出 7 个读数：`turnEntries` / `maxTurn` / `hostNewestTurn` / `shownTurn` / `activeTurn` /
`newestCardTurn` / `lastUserAt`。ChatView 只剩一次 `useMemo` + 一行解构。

| 项 | 前 | 后 |
|---|---:|---:|
| 派生量定义点 | 4 处 | **1 处** |
| `ChatView.tsx` | 4470 | **4429** |
| 单测 | — | +5（含"一条用户行都没有时退回全表最大轮"这条**行为记录**） |

**这一刀顺带查出一个行为**：一条用户行都没有时（历史还没落、窗口是空的），`activeTurn` 退回
全表最大轮而不是 `undefined`。原有 IIFE 就是这个行为，我没有改它 —— 但以前没人知道，
现在写成用例钉住，改的人必须先改这条断言。

**为什么先切这一组**：它是 ChatView 里唯一**完全不碰 DOM、不写状态**的一组派生量，
所以能直接变成纯函数 + 单测；后面的投影（`rows` / `phase` / `bars`）都带副作用边界，
得一组一组来。

### T3′ 卡补读判据收进纯函数（2026-11-17）

**防的现象**：点进会话，交付卡先出现、又被整份替换掉一次；翻历史时卡片一张张长出来。

判据原来是 effect 里的内联表达式，收成 `chat/lib/card-recovery.ts` 的 `turnReportsToRecover()`：
没亲眼见过 `turn/end` / 不在冷却窗口 / 缺卡或卡未被日志证实 / 只在最近 N 轮，四条与它们各自防的
现象写在同一处。6 条用例。

**查证到的一处事实**（以前没人写下来）：卡行的身份是 `id` 前缀 `turn-tail:`，不是 `kind: 'turn'`；
页里已有真卡时 `missingTurnReports` 才为空。用例里踩过一次才确认。

### T1 行收工判据收进纯函数（2026-11-17）

**防的现象**：两张长得一样、顶着同一个秒表的过程卡；发送完当前消息，上一条的卡消失。

`settledOf` 一句话里管四件事，收成 `chat/lib/row-phase.ts` 的 `isRowSettled(message, ctx)`：
会话没在跑 → 全收工；被放弃的那一轮 → 收工；最新轮 = max(帧里的 `runningTurn`, 行里最新轮)；
缺轮号的行按 `pending` 判。6 条用例，其中两条是这次才写清的方向 —— 帧比屏幕**新**（新回合已开、
行还没到 → 旧一轮收工）与帧比屏幕**旧**（断线重连 → 仍按屏幕最新轮）。

### T2 状态条拆成「算一帧 / 喂一帧」（2026-11-17）

**防的现象**：有任务那条状态条 12 秒后自己消失；状态条忽隐忽现。

原来是一个 50 行 effect：闭包里算 `activeTurn/turnStep/lastActivityAt`，连发 5 次 `shadowEvent`，
再扫过期、比签名、落状态。现在两步都是纯函数（`stream/status-feed.ts`）：

| 函数 | 做什么 |
|---|---|
| `deriveStatusFrame` | 轮号缺失时用最靠后一行的轮兜底；步序取**未合并的原始行**（合并后只剩第一步，拿它数步序永远是 1）；最近活动只看最后 8 行 |
| `feedStatusFrame` | 按固定顺序喂 5 条事件 + 扫过期。**顺序即语义**（租约、优先级都在 `session-status.ts` 里） |

6 条用例：轮号兜底、步序取原始行、8 行窗口、五个槽位各就位、扫过期、不修改入参。

### S5-1 搜索/定位/翻页的 30 个 ref 收进一个 store（2026-11-17）

**为什么**：想把定位域（690 行）整块搬出去，第一次尝试被 `tsc` 要求再传 **40 个活值**——
定位、搜索、翻页在 `ChatView` 里是同一个闭包，单独搬任何一半都只会得到一个巨大的 seam。

所以反过来做：`chat/state/search-locate-store.ts` 的 `createSearchLocateStore()` 按会话收 30 个字段
（`pendingTurn*` 家族、定位复核令牌、落点记忆、强制翻页集合、搜索词镜像、原始页、索引轮询计数），
`ChatView` 里 30 个 `useRef/useSessionRef` 换成一次 `useMemo` + 一行别名解构，**函数体零改动**。
参数随后降到 13 个；`ChatView` 4405 → 4386。

### 收尾：解闭包停在 S5-1，不再往下（2026-11-17）

S5-3（把定位域抽成 `use-chat-locate`）试了三次：

| 次 | 结果 |
|---|---|
| 1 | 直接搬 → `tsc` 要 40 个活值 |
| 2 | 有了 store → 降到 13 个 |
| 3 | 卡在**互相递归**：`locateSeq` 是 `useSearchMarks` 的入参，而它又要用 `useSearchMarks` 产出的 `markOfHit/gotoRenderedMatch`；解法是 `searchFnsRef` 函数载体延迟注入，但每次尝试都把 4400 行文件切坏、需回滚 |

**结论**：行数已到当前架构的合理底部（4386）。`≤2500` 那一档要动的是**状态管理模型**（把 `messages /
loading / toast / scroll / search` 收成一个显式容器），不是文件切分，属另一个量级的工程，本次不做。

剩下的三件事都需要真机 `PALM_PAIR` 才能验收，本轮不动：`overflow-anchor: none`（S1.3）、
CSS `@layer` 分层（S3）、定位 effect 里的 14 个布局读点。
