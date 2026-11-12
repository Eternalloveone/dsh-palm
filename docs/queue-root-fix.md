# 完全根治方案：读己之写（read-after-write）+ 拆掉客户端猜测层

> 2026-11-10。对"有没有可以完全根治的方案"的回答。
> 结论：**有**。而且比 S1–S6 那版更彻底、代码更少。

## 1. 为什么现在的方案只能根治 6/7

数据来源是**投影**，不是变更流。`views/chat/state/frame-effects.ts:343` 写得很清楚：

> 「排队消息也走投影：宿主**从不发** `session/queue`，发的是 `inbox`。」

投影会滞后（几分钟都可能），客户端为了让屏幕"看起来对"，只能靠：
TTL（45s/90s）、隐藏表、认领表、正文比对、空队列保持 —— 这些**本质都是猜**。
猜就一定有猜错的时候，这就是 7 条病症的来源。

## 2. 根治的关键：把"猜"换成"问"

所有队列写操作**都经过我们自己的 handler**：

| 操作 | handler | 位置 |
|---|---|---|
| 发送 / 插队 | `sessionPrompt` | `mobile/api/session-handlers.ts:51` |
| 编辑 / 删除 / 撤回 | `sessionUpdateQueue` | `mobile/api/session-handlers.ts:81` |

它们已经知道 `sessionId`，也已经有 `liveInboxOf` / `queueItemsOf`（读权威投影）。
所以可以在**返回前读一次队列，把结果塞进响应**：

```ts
// 现在
const reply = await apiProxy.sessions.updateQueue(req)
bumpQueueRevision(sessionId)
return wrap(rpcId, reply)

// 改后
const reply = await apiProxy.sessions.updateQueue(req)
const items = queueItemsOf(await liveInboxOf(sessionId))
const version = bumpQueueRevision(sessionId)
return wrap(rpcId, { ...reply, queue: items, queueVersion: version })
```

**这是"读己之写"（read-after-write consistency）**：写操作返回的下一秒，客户端拿到的就是权威状态。

### 2.1 可行性已核实（不是设想）

| 依赖 | 实情 |
|---|---|
| liveInboxOf(agents, sessionId) | **同步函数**，直接读**活着的 agent 的内存 inbox**（host/queue-inbox.ts:162），不经过投影缓存 —— 比投影更实时 |
| queueItemsOf(inbox) | 已有，返回带 equestId 的行（实测过） |
| handler 能否读到 agents | SessionHandlerContext 目前没有，但调用点在 mobile-api.ts:1619、那里有 deps；按现成的 invalidateRosterCaches 模式加一个 eadInbox 闭包即可（1 行接线） |
| 无活 agent 时 | liveInboxOf 返回 undefined ⇒ 队列视为空（语义正确：没有运行中的 agent 就没有待发队列） |

## 3. 客户端随之能删掉的东西

| 删掉 | 位置 | 为什么可以删 |
|---|---|---|
| 乐观排队行 | `addOptimisticQueueItem` | 发送 RPC 返回就带权威队列，不需要本地先画 |
| 乐观插入 | `addOptimisticInsert` | 同上 |
| 隐藏表 + 90s TTL | `hidden` / `hiddenAt` / `QUEUE_HIDDEN_MS` | 删除 RPC 返回权威队列，那条自然不在里面 |
| 认领表 | `claimed` | 由 `turn/start` + 权威队列决定 |
| 空队列保持 | `emptyHold` / `QUEUE_EMPTY_HOLD_MS` | 不再需要防闪烁（状态由权威来源驱动） |
| 45s 乐观 TTL | `QUEUE_OPTIMISTIC_MS` | 无乐观项 |
| 三条文本判据 | `spoken()` / steering 同文 / legacy lastUserText | 无猜测对象 |
| 重基线 | `rebaselineQueueView` | 版本栅栏足够（保留） |

**唯一保留的两样**：`queueVersion`（丢乱序帧）与 `applyQueueItems`（唯一写入口）。
最终形态：**一个写入口 + 一个纯投影函数 + 一个组件**。

## 4. 根治的边界（必须写清）

| 场景 | 能否根治 |
|---|---|
| 手机发送 → 队列行出现/消失 | **能**（RPC 返回权威队列） |
| 手机编辑/删除/插队 → 行立即正确 | **能**（同上） |
| 消息被这一轮取走 → 排队行消失 | **基本能**（`turn/start` + 下一次权威读） |
| **桌面/agent 往队列里加人** | **不能**（DSH 不发队列事件，只能等投影帧；表现为"晚几秒出现"） |

第 4 行要也根治，只有一条路：**DSH 侧发队列变更事件**（`session/queue` 或 `queue/added|removed`）。
这在宿主手里，不在插件手里 —— 这是"完全根治"唯一的不可控项。

## 5. 成本与切片

| 片 | 内容 | 估时 |
|---|---|---|
| H1 | 两个 handler 返回 `{queue, queueVersion}`（附带版本 +1） | 2h |
| C1 | 客户端删猜测层，`applyQueueItems` 成为唯一写入口 | 4h |
| C2 | 动作在途态（按钮 disabled + 行内转圈），不产生队列行 | 1h |
| T | 单测（现有 77 + 新增 ~15）、真机四场景 | 4h |

合计 ≈ **1–1.5 个工作日**，**比 S1–S6 方案少一半代码**（删掉的比加上的多）。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| RPC 契约变化破坏旧客户端 | 只**加**字段，不改原有结构（老客户端忽略即可） |
| 两个来源（RPC 返回 / inbox 投影）打架 | 统一走 `applyQueueItems(version, items)`，版本小的丢弃 |
| `liveInboxOf` 本身也可能读到缓存的旧投影 | 已有 `fresh` 参数（`inbox-fresh.ts`）—— 写操作后读必须带 fresh |
| 删表后行为不等价 | 现有 77 项队列测试先全绿，再逐表删除，每删一张跑一次 |

## 7. 三种方案对比

| 方案 | 根治范围 | 成本 | 建议 |
|---|---|---|---|
| **A. 读己之写 + 删猜测层**（本文） | 自己操作 100%，外部变化靠投影节奏 | 1–1.5 天 | ✅ **推荐** |
| B. S1–S6（phase 机 + 保留猜测直到 S3） | 自己操作 ~90%，保留少量兜底 | 1.5–2 天 | 作为 A 的过渡（如果怕一次改太大） |
| C. 要外部变化也根治 | 100% | 需 DSH 发队列事件，1–2 周且不受控 | 不做，等上游 |
