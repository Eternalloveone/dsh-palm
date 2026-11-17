# 显示渲染重构：从「逐页救火」到「一条管线」（v1 提案）

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
| **C1** | **几何没有单一所有者**：滚动位置被 9 处代码写、布局在 19 个文件里读 106 次（ChatView 独占 39 次），浏览器原生锚定也没关 | `scrollTop =` 9 处（`ChatView.tsx:342/2119/2157/2299/3826`、`use-stick-to-bottom.ts:100`、`markdown-text.tsx:134`、`composer-section.tsx:264/270`）；`150-chat.css:17` 仍是 `overflow-anchor: auto` | `chat-scroll-anchor.ts` / `use-stick-to-bottom` / `use-chat-scroll-follow` / `scroll-machine` —— **一条不变量、四个主人** |
| **C2** | **高度靠估算而非实测**：虚拟窗口用 `estimate()` 前缀和当内容总高，每帧重建 O(n) 数组；`content-visibility` 的门槛是 `KEEP_BOTTOM=10000`，单会话不足 1 万行时该机制**一行都不生效** | `use-row-window.ts:112-114`、`chat-rows.tsx:20,248` | 三套几何并存：估算前缀和 + 行内 `contain-intrinsic-size`（实际未启用） + 手工 prepend 补偿 |
| **C3** | **样式无层序**：82 个 CSS 按文件名拼接，"顺序即优先级"，`v21` 覆盖层 50KB，25 套皮肤后置叠加，2000 个 px 字面量、0 个 `@layer`/`:where`/容器查询 | `packages/dsh-palm/src/mobile/styles/`（524,478 B / 82 文件，`370-v21.css` 50,384 B） | 每加一屏/一皮肤就再追加一个覆盖文件 |
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

## 6. 明确不做（防止重构变成重写）

| 不做 | 理由 |
|---|---|
| 换框架（Solid/Svelte）或 Canvas 渲染 | 问题不在渲染器，在所有权；换框架会把 2666 条测试和 41 条真机用例清零 |
| 现在引 LegendList / react-virtuoso | K4 不先立，任何库都会和现有 9 处写点打架；S1 完成后再评估（届时是"替换 300 行"而非"引入架构"） |
| 重写 9 屏 / 改信息架构 | 显示问题不来自信息架构；`layout-contract.md` 的 L1–L4 分层继续有效 |
| 运行时切布局 | 现有 `layout-contract.md` 已把它列为"重估项"，与本次目标无关 |
| 删 `dedupeById` / `sameRenderedRow` 等兜底 | 它们是 K1/K2 落地**之后**才能删的二次防线，顺序反了会立刻回归（P3 会重新出现） |

---

## 7. 附录：证据清单（复核用）

```powershell
cd packages/dsh-palm/src/mobile
# C1 几何所有权
(Select-String -Path (Get-ChildItem -Recurse -Include *.ts,*.tsx -File | ? Name -notmatch '\.test\.') -Pattern 'scrollTop\s*=').Count   # 9
(Select-String -Path (Get-ChildItem -Recurse -Include *.ts,*.tsx -File | ? Name -notmatch '\.test\.') -Pattern 'getBoundingClientRect|scrollHeight|clientHeight').Count  # 106 / 19 文件
# C2 估算几何
Select-String -Path views\chat\hooks\use-row-window.ts -Pattern 'offsets|WINDOW_SETTLE_MS'
# C3 样式层序
(Get-ChildItem styles\*.css | Measure-Object Length -Sum).Sum   # 524478
(Select-String -Path styles\*.css -Pattern '@layer').Count      # 0
(Select-String -Path styles\*.css -Pattern '\d+px').Count       # 2000
# C4 提交分散
(Get-Content views\ChatView.tsx).Count; (Select-String -Path views\ChatView.tsx -Pattern 'useEffect\(').Count  # 4839 / 28
```

**判据**：S1–S4 全部完成时，上表四个数字应分别是 `1` / `≤10` / `≥6` 层 / `2000→≤200`。
