# 根治方案：实时消息「静默不落地」

> 现象（真机）：有时候发出去的消息不回显、模型的正文不渲染，关掉 PWA 重新进才显示。
> 本文只写能落到代码行与真机数据上的判断。

## 0. 结论速览

| 项 | 内容 |
|---|---|
| 动不动手 | 已动手。S1+S2 已落地（净增 182 行 + 5 条回归门），S3 等真机数据 |
| 已落地 | **闸门兜底**（rAF + 250ms 双保险 + 回前台补折）、**水位对账**（落后 24 条即重读尾页自愈）、**窗口不变量**（贴底必跟随尾部）、**两条现场上报**（`flush-stall` / `stream-lag`） |
| 押后 | S2d（SSE 重连即重申 observe）：S2c 已覆盖它的后果（十几秒内自愈），且 `App.tsx` 预算只剩 1 行 |
| 验证状态 | 5 条新用例**先在旧代码上跑红、再在新代码上跑绿**（见 §6） |
| 不做会怎样 | 概率性整屏不显示，只能重开，重开后中间过程全丢；且真机历史上报里 **零条运行期 JS 异常**，病因永远只能靠猜 |

---

## 1. 真机事实（证据）

| # | 事实 | 来源 | 推论 |
|---|---|---|---|
| R1 | 页面连续存活 75 872 / 144 191 / 400 500 ms 而不重载 | `~/.dsh/dsh-palm-errors/*.json` 的 `clientAt` | 后台冻结→恢复的长存页在真机上真实存在，是闸门失效的土壤 |
| R2 | 目录 20 条历史上报：19 条 `ResizeObserver loop completed with undelivered notifications` + 1 条 CSP `unsafe-eval`（调试期残留），**零条运行期 JS 异常**；其中今天 10:07～20:36 的 14 条全是前者 | 同上 | 三处失效**全静默**：不抛错、不报警，只有"重开"能救 |
| R3 | entry-trace（10 s、每 150 ms 一帧）：`rows` 15→17、`h` 5461→5557、`top` 4871→3081→4216 | `~/.dsh/dsh-palm-perf/capture-2026-11-15T13-00-14-516Z-entry-trace-v2-raw.json` | 窗口化 + 自动跟随在真机上是活跃路径；行数/高度/滚动位置会各自漂移，用户看得见 |
| R4 | 一条工具密集回合可达 1314 事件 / 97 个直接子元素 / 5.5 万像素；一轮工具 20+ 行 | `use-row-window.ts` 头注释（作者真机测量） | 单轮净增行数足以越过窗口"落后约 24 行就停更"的阈值 |
| R5 | `RUNNING_RECONCILE_MS = 10s`、`INITIAL_RECONCILE_MS = 2.5s`、`mobile.observe` 重申 30s | `state/stream-state.ts`、`App.tsx:567` | 真机已有一条 10 秒的对账节拍可直接复用（零新增 RPC） |

## 2. 代码证据：三处静默失效点

| 编号 | 位置 | 失效机制 | 触发 | 用户看到 | 丢数据？ |
|---|---|---|---|---|---|
| **A** | `hooks/use-chat-stream.ts:82-102`（句柄只在回调内复位）、`:139-141`（句柄在就 `return`） | 所有实时消息挤同一道 rAF 闸门，锁没有超时兜底；回调没跑一次就永久关死 | PWA 被冻结/切后台/帧被系统丢掉 | 回显与正文都不出；**秒表、过程条、队列照常动** | 否（帧仍在 `eventBatch`） |
| **B** | `mobile-api.ts:1374-1391`（按设备过滤，`session/event` 不在 `MUX_ALWAYS_FORWARDED`） | 登记表在宿主内存，宿主重启即空；`mux/ping` 让客户端认定"流活着"，停掉轮询兜底（`stream/mux.ts:719-722`）；重申间隔 30 s，窗口内丢的帧**不重放** | 宿主重启 / 隧道抖动后重连 | 连过程条、队列、审批一起冻住 | 是 |
| **C** | `chat-rows.tsx:162`（每次渲染新建 `estimate`）、`hooks/use-row-window.ts:117-139`（`estimate` 在依赖里且 cleanup 清掉 80 ms 定锚定时器） | 流式期间每 16 ms 一次渲染，定锚永远等不到空闲；锚点冻结后超出 `anchor+24` 的行 `return null` | 长会话（>32 行）+ 工具密集回合 | 正文停更、底部一大片空白；**手指滑一下立刻补出来** | 否（行在 state 里） |

三处共有的病根：**实时内容的可见性依赖「帧到达 → rAF 折叠 → 窗口渲染」三步串行，任何一步静默失败都没有检测、没有自愈**。

## 3. 判据

| 现象 | 命中 | 现行代码的自愈能力 |
|---|---|---|
| 秒表/过程条在动，只有正文与回显不动 | A | 无，必须重载 |
| 连过程条、队列、审批一起不动 | B | 只有轮询兜底，但被 `mux/ping` 关掉 |
| 正文停更 + 底部空白，滑一下就好 | C | 靠人手滑（不是自愈） |

## 4. 根治设计：一条不变量 + 一条对账链

| 不变量 | 内容 | 落点 |
|---|---|---|
| **I1** | 读者贴底 ⇒ 窗口必须跟随尾部（`anchor = null`），不许出现"锚点冻在数字上但人还在底部" | `use-row-window.ts` |
| **I2** | 任何实时内容失败必须十几秒内被对账发现：本地折叠水位 `EventFolder.lastSeq` 落后宿主快照 `maxSeq` ≥ 24 条 → `reloadTail()` | `use-turn-state.ts` 的 10 s 节拍（快照里已有 `maxSeq`，见 `api/mobile-session-state.ts:283`，**零新增 RPC**） |
| **I3** | 闸门句柄必须有超时兜底：rAF + 250 ms 定时器双保险，回前台再补折一刀；任何"只能靠重启解开的锁"都不允许存在 | `use-chat-stream.ts` |
| **I4** | 链路重连即重申观察：SSE 每次 (re)connect 立刻 `mobile.observe`，不等 30 s 那拍 | ⏸ 押后（S2c 已覆盖后果） |

## 5. 改动清单（已落地）

| 批次 | 文件 | 改法 | 行数 | 状态 |
|---|---|---|---|---|
| S2a 闸门 | `hooks/use-chat-stream.ts` | `flushEventBatch` 抽出；rAF + 250 ms 定时器双保险；`visibilitychange` 回前台补折；`resetForSession`/卸载统一 `cancelFlushSchedule` | +48 | ✅ |
| S1 观测 | 同上 + `hooks/use-turn-state.ts` | `flush-stall`（前台闸门该响没响）、`stream-lag`（水位差 + `sseLive`/`tailLoading`/`batched`）两条现场，各自 60 s 节流 | +18 | ✅ |
| S2b 窗口 | `hooks/use-row-window.ts` | `estimate`/`total` 走 ref，effect 依赖只留 `scroller`；贴底一律 `setAnchor(null)` 回到跟随尾部 | +18 | ✅ |
| S2c 对账 | `hooks/use-turn-state.ts` | 对账拿到的快照比 `maxSeq` vs `EventFolder.lastSeq`：落后 ≥24 即 `reloadTail()`；限频 15 s，宿主水位不前进时退到 60 s 再试 | +52 | ✅ |
| 类型/常量 | `state/stream-state.ts` | 四个常量 + `reloadTailRef` 注入（避免两个 hook 互相依赖成环） | +46 | ✅ |
| S2d 观察 | `stream/mux.ts` + `App.tsx` | 重连即重申 `mobile.observe` | 0 | ⏸ 押后（S2c 已覆盖后果；App.tsx 预算只剩 1 行） |
| 预算 | `tools/budget.json` | `src/mobile` 61523→61705、`src/mobile/views` 24535→24717，理由与 `expires` 同条写入 | — | ✅ |

## 6. 验证（先红后绿）

| 用例 | 钉住什么 | 旧代码 | 新代码 |
|---|---|---|---|
| `ChatView.stream`：「rAF 那一帧被系统丢掉时…」 | 闸门句柄卡住后内容仍要落地 | ❌ 正文不出现 | ✅ 250 ms 内落地 |
| `use-row-window`：「贴底后新增 30 行…」 | I1 贴底必跟随尾部 | ❌ 窗口停在 78/90 行 | ✅ 渲染到 90 |
| `use-row-window`：「连续渲染不会取消定锚」 | `estimate` 身份变化不得清掉定锚计时器 | ❌ 定到第 30 行 | ✅ 定到第 14 行（第 20 行顶） |
| `use-turn-state.lag`：「宿主水位领先 100 条 → 重读尾页」 | I2 水位失配必须自愈 + 留现场 | ❌ `reloadTail` 0 次 | ✅ 1 次 + `stream-lag` |
| `use-turn-state.lag`：「只差几条不重读」「同水位不重复重读」 | 自愈不许抖 | ✅（对照） | ✅ |

真机验收口径：连续 3 天、每天 ≥1 次后台切出再回写的真实使用里不再出现「重开才显示」；若仍复现，`~/.dsh/dsh-palm-errors/` 会落下 `flush-stall` 或 `stream-lag` 一条，直接读数定位到具体那一处（S3 的输入）。

## 7. 风险与回滚

| 风险 | 控制 |
|---|---|
| 250 ms 兜底每帧多一个 `setTimeout` | rAF 到位即 `clearTimeout`，正常路径只多一对 timer 来回（~µs）。若真机敏感，可改为「仅 `hidden` 挂定时器 + 回前台强制补折」，代价是冻结瞬间的兜底失效 |
| 贴底重置导致"往上翻一屏就被拽回底部" | 判定用 `rowAt(...) ≥ total - WINDOW_RENDER_ROWS`，只有真在尾部才重置 |
| 对账抖动反复 `reloadTail` | 15 s 限频 + 同一宿主水位只打一次 + 水位不前进退到 60 s；只比较刚读回来的快照，不跨会话 |
| 观测上报刷屏 | 同一会话 60 s 一条（自己判时间戳），并复用 `errors-report` 的静默窗去抖 + 同一条合并（`platform/errors-report.ts`） |
| 回滚 | 三处改动互相独立：删 `use-turn-state` 的水位块回退 I2，删 `use-row-window` 的两行 ref 回退 I1，删 `use-chat-stream` 的兜底定时器回退 I3；预算上限需同步回降 |
