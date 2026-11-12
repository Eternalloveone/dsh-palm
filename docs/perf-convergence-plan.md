# 手机端性能收口方案（v1）

> 结论先行：**按当前"边查边改"的走法不会收敛**。过去 6 次改动里，4 次被迫回滚或压缩，
> 原因不在技术难度，在四个结构性前提没解决（见 §1）。本方案先补基础设施，再按
> "证据卡 → 单一目标改动 → 度量闸门"推进，把剩余工作压成 3 个可验收阶段。

## 1. 为什么现在收敛不了

| # | 结构性障碍 | 已发生的事实 | 后果 |
|---|---|---|---|
| R1 | **预算棘轮满格**：`tools/budget.json` 的上限被钉在当前值，任何净增即红 | 4 次为 1~12 行反复压注释；`src/mobile/runtime` 406 满格导致 `useChatSelector` 无法落地而回滚 | 每次改动要先找等量补偿，成本随改动数线性上涨 |
| R2 | **并行改同一批文件** | `composer-section.tsx` 12:57 被外部改写，导致 3 条用例变红；`App.tsx` 1602>1572 | 我的改动可能被覆盖，测试红灯归属不清 |
| R3 | **前提未验证就动手** | A1 两次失败：第一次撞预算，第二次才发现 `ChatView` 读的是 8 个字段里的 6 个 | 白做一轮，且回滚本身也要成本 |
| R4 | **度量不闭环** | 只跑一次 Playwright；同一份代码 idle 基线在 57→210 ms 间跳 | 无法判断改动是否真的有效，也无法拒绝无效改动 |

## 2. 收敛定义（做到这些才算完）

| 判据 | 阈值 | 测法 |
|---|---|---|
| 预算 | 0 红（所有 `>` 消失） | `node ../../tools/check-budget.mjs` |
| 测试 | 0 红（含 `pnpm guard`） | `vitest run src/mobile` + guard |
| 打字 | 10× 降频 < **30 ms/字符** | `palm-type.mjs`，3 次取中位数 |
| 轻点（输入框/上下文环/模型 chip/过程条） | 脚本时间 < **150 ms** | `palm-tap-matrix.mjs`，3 次中位数 |
| 切会话 / 打开抽屉 | 脚本时间 < **400 ms** | 同上（需空闲窗口） |
| 度量可重复性 | ~~同一代码 3 次中位数波动 < **15%**~~ **已作废** | 见 §8.1：3 次中位数法在本机测不出信号（核心指标 spread 46.2%、idle.taskMs 152.4%），上三行"3 次取中位数"测法一并作废，改以 vitest render-log 为准 |

> 可重复性是硬门槛：不满足就别指望用数据判断成败。

## 3. 阶段计划

### Phase 0 · 收敛基础设施（半天，无性能收益，但决定后面能不能收敛）

| 任务 | 产出 | 验收 |
|---|---|---|
| 0.1 固定基准序列 | `tools/perf-gate.mjs`：跑 `palm-type` + `palm-tap-matrix`，每项 3 次取中位数，与上次基线出 Δ，写 `perf-baseline.json` | 连跑 3 次，波动 <15%；否则先解决噪声（见 0.2） |
| 0.2 度量窗口 | 测量期间不跑流式会话（本轮 agent 空闲），CPU 降频固定 10× | idle 基线稳定在 ±20% 内 |
| 0.3 预算决策（见 §5-D1） | 二选一：①一次性重设 `budget.json`；②先做"减行专项"腾缓冲 | 选定后预算从"每次搏斗"变成"一次性对齐" |
| 0.4 写域隔离（见 §5-D2） | 本轮只碰：`views/ChatView.tsx`、`views/chat/hooks/*`、`stream/*`、`mobile/api/*` | 与并行任务的文件清单无交集 |

### Phase 1 · C2-2 可行性评估（半天，只出证据卡，不改代码）

目的：`session.history` 现在是宿主 RPC（`apiProxy.sessions.history`），全仓无 `sinceSeq|afterSeq|fromSeq`。

| 待证事项 | 怎么证 | 不通过的退路 |
|---|---|---|
| `mobile-log-source.ts` 能否"从 seq N 往后读" | 读 `readChatTailPage` / 分片索引实现，确认是否已有 seq→文件+偏移的跳转能力 | 只能退化为"按页增量"（记住游标，下次只拉新页） |
| 压缩分片边界是否会切断一轮 | 看分片粒度与 `maxMessages` 语义 | 增量按"整片"对齐，允许少量重复行（客户端按 seq 去重） |
| 客户端合并能否只吃新增行 | `session-store.applySnapshot` 现状 | 加 `appendRows()` 路径，保留全量回退 |

产出：`docs/perf-c2-2-evidence.md`（结论 + 边界清单 + 回退方案）。**没有这份卡，不许动 C2-2。**

### Phase 2 · A1′：在途状态的归属（1 天，收益最大的一块）

问题：`sending`/`stopping`/`regenerate` 是"作曲区在途状态"，却与会话级的 `phase`/`notice`/`title` 同住一个 store，由 ChatView 订阅。发送一条消息会把 4000 行视图体重跑 2 次。

| 步骤 | 改动 | 文件 |
|---|---|---|
| 2.1 | 三个意图位下沉到 `useChatComposer` 内部（或作曲区独立 mini-store），对外只暴露动作 | `views/chat/hooks/use-chat-composer.ts` |
| 2.2 | ChatView 不再解构 `chat.state`，只订阅 `phase`/`notice`/`title` | `views/ChatView.tsx` |
| 2.3 | 加 `useChatSelector`（届时才有消费点） | `runtime/chat/use-chat-store.ts` |
| 2.4 | 渲染计数用例：发送/停止不得重画 `ChatRows`，且 ChatView 渲染次数 = 1 | `views/chat/components/chat-rows-memo.test.tsx` 同级新用例 |

验收：`palm-tap-matrix` 里"发送后首帧"脚本时间下降 ≥30%；用例证明发送不重画列表。

### Phase 3 · C2-2 实施（1~2 天，依 Phase 1 结论）

按证据卡选定的路径实施（增量端点 或 按页增量），必须自带全量回退：任何 `seq` 不连续、缓存缺失、老宿主 → 直接走全量路径，行为与今天一致。

验收：>5000 行大会话连续切 5 次，切会话脚本时间中位数下降 ≥40%，且无重复行/空洞。

### Phase 4 · 收口（半天）

- 预算归零；`pnpm guard` 全绿
- `docs/perf-report.md`：改动清单 + 前/后数据表 + 未做项与理由
- 删除 `D:\work\dsh-palm\` 下的临时测量脚本或归档到 `tools/perf-*`

## 4. 风险与止损

| 风险 | 触发信号 | 止损 |
|---|---|---|
| 预算补不平 | Phase 0 决策后仍持续红 | 改做"减行专项"：抽公共工具/删死代码，腾 200~400 行 |
| 并行任务覆盖我的改动 | 文件 mtime 晚于我最后一次写入且内容变了 | 当场 git diff 核对关键函数，冲突则等对方落地后重做 |
| 度量噪声压不住 | 3 次中位数波动 >15% | 换"渲染计数"这种确定性指标做验收，Playwright 只做旁证 |
| C2-2 无法增量 | Phase 1 证据卡否决 | 停在"按页增量 + 全量回退"，不硬上 |

## 5. 需要拍板的三个决定

| 编号 | 决定 | 选项 A | 选项 B | 影响 |
|---|---|---|---|---|
| D1 | 预算怎么办 | 一次性把 `budget.json` 重设到当前值（此后严格只降） | 先做减行专项腾缓冲 | A 快但要接受一次"账面变绿"；B 干净但多花半天 |
| D2 | 并行任务 | 本轮独占上面 4 个目录 | 继续并行，我只碰 hooks/ 新文件 | A 冲突少、可测；B 需要更强隔离 |
| D3 | 验收口径 | Playwright 脚本时间（真机感） | 渲染计数（确定性） | 建议：以渲染计数为主闸门，Playwright 为旁证 |

## 6. 已完成的基线（本方案起点）

| 项 | 状态 |
|---|---|
| A（订阅粒度/渲染边界/心跳下沉） | ✅ 已落 |
| B1/B2/B3（点击、抽屉、打字） | ✅ 打字 180 → **43~67 ms/字符**（10× 降频） |
| C1（水合门改订阅） | ✅ 已落 + 守卫用例 |
| C2-1（`sessionState` 支持 `rows:false`） | ✅ 已落，轮询不再重传 129 KB |
| A1（按字段订阅，原方案） | ❌ 否决：ChatView 用 6/8 字段，收益≈0（改为 Phase 2） |
| C2-2（history 按 seq 增量） | ⛔ 待 Phase 1 证据卡 |

## 7. Phase 0.3「减行专项」实测修正（2026-11-12）

> 结论：**不动知识的前提下，凑不出 200~400 行**。三个盘点结果改变了 D1 的选项。

### 7.1 死导出盘点

全仓扫描 2152 个导出符号，零引用的只有 **19 个**，且多为单行类型/小函数，可删总量 ≈ **50 行**（工具：零依赖脚本，按 `export (function|const|class|interface|type)` 定义 + 全仓词边界计数）。

### 7.2 真正的"水分"是生成物被当源码计数

| 文件 | 行数 | 性质 |
|---|---|---|
| `src/mobile/mobile-styles.ts` | **12939** | **生成物**：由 `src/mobile/styles/*.css`（13199 行）拼接而成 |
| `src/mobile/styles/*.css` | 13199 | 真源 |

`tools/check-budget.mjs` 的 `isSource` 只排除 `*.test.ts` 与 `*.d.ts`，于是**同一份 CSS 被计了两遍**。把生成物挪出被计数的目录（或排除生成物），`src/mobile` 立刻从 68952 降到 ≈56013（上限 68520），一次腾出 12939 行——远超原定目标，且不删任何知识。

### 7.3 但子目录红仍然存在，且不是我一个人造成的

| 计数器 | 实测/上限 | 差额 | 归因 |
|---|---|---|---|
| `src/mobile/views` | 21375 / 21040 | −335 | 并行任务（App.tsx 1602>1572 等）+ 我的新增 |
| `src/mobile/api` | 3803 / 3780 | −23 | 并行任务为主 |
| `src/mobile/data` | 1683 / 1663 | −20 | 并行任务为主 |
| `src/mobile/render` | 7211 / 7194 | −17 | 并行任务（A2 前就红了） |
| `src/mobile/message-row` | 1295 / 1293 | −2 | A2 的 `hostNow` prop（正当成本） |
| `src/mobile-api.ts` | 1664 / 1663 | −1 | 并行任务 |

即：**即使排掉生成物，仍有 ~398 行要在具体目录里还**，而其中大部分增长来自并行任务。

### 7.4 修正后的 D1 选项

| 选项 | 做法 | 腾出量 | 代价 |
|---|---|---|---|
| B1 | 生成物移出计数（改 `tools/check-budget.mjs` + `budget.test.ts` 的 `isSource`，或把产物挪到 `src/mobile/generated/` 外） | −12939（`src/mobile` 绿） | 动闸门逻辑，需在注释里写明"生成物不计" |
| B2 | 对 5 个被并行任务推过线的子目录做**一次性重设**（`--write` 仅针对这 5 项） | −398（全绿） | 等于把 D1-A 缩到子目录；此后严格只降 |
| B3 | 真删代码 | ≈ −50 | 到不了目标，只能当补充 |

**建议：B1 + B2 一起做一次，然后加一条 `isSource` 排除注释锁死"生成物不计"，此后所有人都不再为生成物付预算。**

## 8. 测量层结论（2026-11-12）

> 两套度量都不足以当主闸门，主闸门改 vitest render-log。以下为实测事实。

### 8.1 P0.1（毫秒法）不通过

`perf-gate.mjs` 两个脚本各跑 3 次（10× 降频），43 个指标仅 3 个 `spread=(max−min)/median ≤ 15%`：

| 指标 | 3 次原值 | median | spread |
|---|---|---|---|
| `perCharScriptMs` | 60 / 36 / 52 | 52 | **46.2%** |
| `idle.taskMs` | 1521 / 544 / 641 | 641 | **152.4%** |
| `typing.scriptMs` | 662 / 416 / 640 | 640 | 38.4% |
| `上下文用量环.toFrame1` | 234 / 234 / 203 | 234 | 13.2%（可用，值域窄） |
| `过程条展开.toFrame1` | 8 / 8 / 9 | 8 | 12.5%（可用，8ms 量级量化太粗，无实义） |
| `抽屉-切会话.scriptMs` | 2044 / 1758 / 1929 | 1929 | 14.8%（唯一实义可用） |

决定性反证：同一份代码相隔 2 分钟 `perCharScriptMs` 29 → 60（≈107%）；对上一版基线重测同代码 Δ = −11.5%。底噪大于 §2 要验收的 30%/40%。

### 8.2 噪声归因：方法 + 环境，不是代码回归

- 方法：`palm-type` 的 idle/typing 两窗口在 10× 下不等长（`keyboard.type(delay)` 有派发开销，idle 是精确 1500ms）；`ScriptDuration` 经 `Math.round` 只剩 1ms 分辨率；`toFrame1` 是单次 rAF 单样本。
- 环境：常驻 24 个 `chrome` + 9 个 `node`，测量期间还有其他 agent 在跑，瞬时突发未捕捉。故波动不可读成"代码变慢"。

### 8.3 P0.2（页面内计数）不通过

`window.__dshPalmPerf` 仅 3 个埋点，全在 SSE 流式路径，**无交互渲染计数器**：`recv`（`stream/mux.ts:732`，收到一帧）、`state`（`views/chat/hooks/use-chat-stream.ts:94`，批次入 state）、`commit`（`views/ChatView.tsx:2561`，`session/event` 帧提交）。实测：打字 10 字符（`typedLength=10`）`total=5` 且 `byStage={recv:5}` 全是背景帧；点 4 个固定控件 `+3/0/0/0` 同样全是 `recv`；同操作重复两次 0 → 5，计数随流量抖动。

### 8.4 结论与替代

两套度量都不能当主闸门。主闸门改为 **vitest render-log**（`views/chat/components/chat-rows-memo.test.tsx` 的 `vi.mock` + `vi.hoisted` 渲染日志套路）：断言"打字/点控件不触发 `ChatRows` 重画"与"发送/停止时 `ChatView` 渲染次数 = 1"。Playwright 只作粗筛旁证、**只报区间不报点值**。§2 判据表该行已标作废。

### 8.5 已知缺陷（记待办，本次不修）

`?perf=1` 不生效：配对后 URL 被改写为 `?workspace=…&session=…`，参数丢失，实测 `armedAtBoot=false`；`localStorage.setItem('dsh.palm.perf','1')` + `__dshPalmPerf.refresh()` 才有效。

