# 排队条 / 目标条 系统性重构方案

> 2026-11-10 起草。目标：一次性消掉"排队消息"、"已插入"、"目标"、"状态"这条区域的**历史积弊**，
> 而不是继续在上面打补丁。

## 0. 一句话结论

现在这条区域有 **12 本账**（隐藏表、认领表、乐观表、插入表、轮次号、空队列保持、版本号、重基线时间…）、
**3 个 TTL**、**4 个组件**在说同一件事。重构方向不是"把判据写得更聪明"，而是**把账减到 1 本**：

**宿主给一份带单调版本号的权威队列 + 客户端只保留"已发出、等回执"的动作（带 correlationId）→
一个纯函数算出视图 → 一个组件画出来。**

---

## 1. 现状盘点（代码事实）

### 1.1 状态与账本（`stream/session-store.ts`，队列相关导出 **16 个**：`claimQueueHead` / `applyQueueItems` / `hideQueueItem` / `unhideQueueItem` / `queueAuthoritative` / `rebaselineQueueView` / `addOptimisticInsert` / `dropOptimisticInsert` / `withdrawInsert` / `restoreInsert` / `consumeInsertMessage` / `noteInsertTurnStart` / `dropOptimisticQueueItem` / `normalizeQueueText` / `HIDDEN_TTL_MS` / `resetSessionStoreForTest`）

| 账本 | 字段 | 作用 | 问题 |
|---|---|---|---|
| 权威快照 | `snapshot.queue` / `fallbackQueue` | 宿主给的行 | 两条来源（有/无 snapshot） |
| 版本栅栏 | `queueVersion` | 拒收旧快照 | 3 个入口（applyQueueItems / applySnapshot / rebaseline） |
| 重基线 | `queueRebaselineAt` | 重连后不信旧快照 | 与版本栅栏职责重叠 |
| 隐藏表 | `hidden` + `hiddenAt` | 删除/插队后本地先藏 | **90s TTL**，过期会复活 |
| 认领表 | `claimed` | 已进这一轮 | 不按时间过期（正确），但与 hidden 双写 |
| 乐观队列 | `optimisticQueue` | "刚点了发送" | **45s TTL**，长回合里被误杀（后来加了 running 特例） |
| 乐观插入 | `optimisticInserts` | 插队中 | 与插入表双写 |
| 插入表 | `inserts` + `insertTurnNo` | 已插入本轮 | 与乐观插入双写 |
| 空队列保持 | `emptyHold` | 防闪烁 | 又一个计时器 |
| 文本令牌 | `queueToken`/`queueRevision` | 宿主侧变更检测 | 与 version 并行存在 |

### 1.2 判据（`stream/session-status.ts` `visibleQueue`）

6 条规则 + 3 个 TTL，其中 **2 条是文本匹配**：
- `claimedIds.has(id) && spoken(text)`；
- `placement === 'queued' && steeringTexts.has(normalize(text)) && spoken(text)`；
- `legacyQueue && lastUserText === normalize(text)`。

`spoken()` 又是"正文是否已出现在对话里"的文本匹配。

### 1.3 组件（同一件事 4 个画法）

| 组件 | 行数 | 画什么 |
|---|---|---|
| `views/chat/components/queue-card.tsx` | 72 | 外壳（把下面两个装一起） |
| `components/queue-dock.tsx` | 280 | 排队行 + 头行动作 + 队首动作浮层 |
| `views/chat/components/insert-bar.tsx` | 165 | "已插入本轮 · N 条补充消息" |
| `components/goal-bar.tsx` | 202 | 目标条（暂停/恢复/编辑/清除，全走 `/goal` 命令） |
| `ui/status-strip.tsx` + `render/run-status.tsx` | 147 + 367 | 运行状态 / 阶段 |

### 1.4 由此产生的已知病症（本仓库真实发生过的）

| # | 病症 | 当时的补丁 |
|---|---|---|
| 1 | 同一条同时显示"排队"和"已插入" | 宿主投影层按文本去重 + 客户端第二道文本判据 |
| 2 | 删掉的条目 90 秒后自己回来 | 认领表不按时间过期（只解决一半） |
| 3 | 长回合里排队条自己消失 | 运行中不按时间淘汰 |
| 4 | 队列被旧快照冲掉 | 版本号 + 重基线 |
| 5 | 动作浮层自己关闭 | 打开时快照化，按正文认回 |
| 6 | 底部三块抢地方 | 合成一张 QueueCard |
| 7 | "已经发出去了还显示排队" | claimed + spoken 文本判据 |

**共同点**：每一条都是"用文本或计时器猜"的结果。这就是要根治的东西。

---

## 2. 目标模型

### 2.1 数据：一个 `QueueEntry`，带阶段

```ts
interface QueueEntry {
  id: string                    // 宿主 id（权威）
  correlationId?: string        // 客户端发送时生成，贯穿乐观项 → 宿主行 → 用户消息
  placement: 'queued' | 'steering'
  phase: 'queued' | 'claimed' | 'inserted' | 'sent' | 'failed'
  text: string
  editable: boolean
  at: number
  error?: string                // phase === 'failed' 时的人话
}
```

- **`phase` 是状态机，不是若干布尔表**：`queued → claimed → sent`（queued 路线）、
  `queued → inserted → sent`（插队路线）、任一阶段 `→ failed`（可重试）。
- 每次迁移都由**事件**驱动：`turn/start` → 队首 `claimed`；`user/message`（带 correlationId 或
  "本轮首条"）→ `sent`；action 回执 → `inserted` / `failed`。**没有 TTL 驱动的迁移**。

### 2.2 权威：宿主快照 + 单调版本

保留 `queueVersion`（已经实现且有效），但**只留一个入口**：`applyQueueSnapshot(version, items)`。
`rebaselineQueueView` 与 `fallbackQueue` 合并进同一函数（重连 = 版本重置 + 一次全量）。

### 2.3 乐观：只保留"未确认的动作"，且带 correlationId

- 发送/插队时生成 `correlationId`，乐观项 = `{ correlationId, phase: 'sending' }`；
- 宿主行出现（同文本或回执带 id）时**绑定**：把宿主 id 写进同一条 entry；
- 宿主没有回显 id 时，用**一次性绑定规则**（同一会话内，本轮第一条 `user/message` 且文本归一化相等），
  绑定后固化为 id，**后续不再做文本比较**；
- 动作 15s 未确认 → `failed`（显示"没发出去，点重试"），**不是默默消失**。

### 2.4 视图：一个纯函数 + 一个组件

```
projectQueueView(snapshot, actions, events, now) -> {
  queued: QueueEntry[]      // phase === 'queued'
  inserted: QueueEntry[]    // phase === 'inserted' / 'claimed'
  failed: QueueEntry[]      // phase === 'failed'
  sending: QueueEntry[]     // phase === 'sending'
  counts: { queued, inserted, failed }
}
```

一个组件 `QueuePanel`（替换 QueueCard + QueueDock + InsertBar + 浮层）：
- 头行：`N 条排队 · 当前任务结束后执行` + `[立即发送] [⋯]`；
- 行：统一三态（排队 / 已插入 / 失败），行尾动作 = 编辑 / 插队 / 删除 / 重试；
- 失败行固定在顶部（红点 + 原因），**不需要再点开浮层**。

### 2.5 目标条与状态条：并进同一个"输入框上沿"

规则（**同一时刻最多两块，且一块只说一件事**）：

| 优先级 | 什么时候显示 | 内容 |
|---|---|---|
| 1 | 有失败动作 | `1 条没发出去 · 重试`（点击进面板） |
| 2 | 有排队 / 已插入 | `N 条排队 · …`（点击展开） |
| 3 | 有目标 | 目标一行（点击展开动作） |
| 4 | 都没有且空闲 | 不显示（不占位） |

即：**排队与目标不再上下叠两条**，而是同一块区域按优先级显示；两者同时存在时，
第二块折成"目标 1 行"贴在下面（仍不超过两行）。

---

## 3. 迁移切片（每片可独立上线、可回滚）

| 片 | 内容 | 验收 | 风险 |
|---|---|---|---|
| **S0** 观测 | 把 `visibleQueue` 的每次判定结果打点（开发态）：行数、被判为 hidden/claimed 的原因 | 真机复现 7 条病症时能一眼看出是哪条判据干的 | 无（仅开发态） |
| **S1** 状态机 | 引入 `phase`，把 hidden/claimed/inserts/乐观表**收进一个 map**，行为不变 | 现有 77 项队列测试全绿 + 新增迁移测试 | 中（改动核心） |
| **S2** 去掉 TTL | 删除 45s / 90s / 空队列保持三处计时器，改为"事件驱动 + 失败态" | 长回合、断线重连、删除后复活三个场景不再出现 | 中（需要 S1 的 phase） |
| **S3** correlationId | 发送/插队生成关联 id；宿主回执优先按 id，文本仅作一次性绑定 | 同文两条排队不再误吞；"已发出仍显示排队"消失 | 需宿主配合（无回显时走一次性绑定） |
| **S4** 组件合并 | `QueuePanel` 替换 QueueCard/QueueDock/InsertBar；浮层删除 | 视觉回归截图；行高与命中区不变（26/32/44） | 低（纯 UI） |
| **S5** 目标条并入 | 按 §2.5 优先级渲染；`GoalBar` 保留为内部实现 | 目标 + 排队同时存在时只占两行 | 低 |
| **S6** 清理 | 删 `fallbackQueue`/`emptyHold`/`queueToken` 等遗留账本；文档更新 | 无引用残留；`grep` 为 0 | 低 |

估算：S0 1h、S1 3h、S2 2h、S3 3h、S4 3h、S5 2h、S6 1h ≈ **2 个工作日**（含测试与真机）。

---

## 4. 需要宿主配合的一处

`correlationId` 回显是唯一需要 DSH 侧改动的点（`session/queue` 的 item 里带上客户端提交的 id）。
拿不到时的**降级方案已写死**：一次性文本绑定，且只发生在 `bind()` 一个函数里（有单测），
不会像现在这样散落在 6 条判据里。

---

## 5. 不做的事（明确边界）

- 不改宿主队列的执行语义（谁先谁后、何时合并进下一轮）；
- 不引入新的全局状态库；
- 不为"目标"新增 RPC（继续走 `/goal` 命令）；
- 不重做发送按钮与输入框本身。

## 6. 验收基线

| 项 | 判据 |
|---|---|
| 测试 | 队列相关测试从 77 项扩到 ~95 项；全绿 |
| 病症回归 | 7 条病症逐条有"不会再出现"的单测 |
| 真机 | 长回合（>5 分钟）排队条不消失；删除后不复活；发出后不再显示排队；目标+排队只占两行 |
| 预算 | 组件数 4 → 2；store 队列导出 16 → ≤8；TTL 3 → 0 |
