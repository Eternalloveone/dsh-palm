# ChatView 的 30 个 `useEffect`：清单与分类（S2 施工图）

> 基准：分支 `refactor/v2`，ChatView **4,228 行**、`useState` **0**、`useEffect` **30**。
> 这份清单是**手头工作的接续点**：下一次动 ChatView 前先看这里，别重新数一遍。

## 一、分类口径

| 类 | 含义 | 处理方式 |
|---|---|---|
| **A 生命周期** | 只跟 `sessionId` / 挂载卸载有关 | 直接搬进 `views/chat/hooks/use-chat-*.ts` |
| **B 订阅** | 外部世界变了通知界面（事件流、状态仓、DOM 事件） | 搬进效果层，成对退订 |
| **C 真副作用** | 网络、写盘、计时器、滚动位置持久化 | 搬进效果层，**触发时机必须一模一样** |
| **D 派生同步** | 一个状态变了去改另一个状态 | **不搬**：改成 `useMemo` 或在事件里直接算 |

**D 类是唯一能显著减行的一类**，也是唯一失败很隐蔽的一类（容易出现"晚一帧的旧数据"）。
判断标准一句话：**这段代码是在"记下发生了什么"，还是在"算出应该是什么"？** 后者属于 D。

## 二、逐条清单

| 行 | 首句 | 依赖 | 类 |
|---|---|---|---|
| 388 | `if (typeof window === 'undefined') return` | `[messages]` | C 滚动位置持久化 |
| 424 | `rememberChatSnapshot(...)` | `[sessionId, messages, hasOlder]` | C 快照写入 |
| 617 | `if (messages.length === 0) return` | `[messages, hasOlder, sessionId]` | C 首帧定位 |
| 753 | `const echoes = readQueuedEchoes()` | `[queueItems, messages, sessionId, running]` | **D** 回声合并 |
| 785 | `refreshInbox()` | `[running, refreshInbox, hasPendingQueue]` | C 轮询 |
| 805 | `turnStartAtRef = ...` | `[running…]` | C 计时 |
| 810 | `mountTimeRef = Date.now()` | `[running…]` | C 计时 |
| 947 | `let cancelled = false` | `[]` | C 一次性加载 |
| 989 | `const wantsDirectory = …` | `[plusOpen, commandOpen, commands, input]` | C 命令目录 |
| 1006 | `let cancelled = false` | `[]` | C 一次性加载 |
| 1330 | `if (mux === undefined) return` | `[mux, sessionId, …]` | **B** 事件流订阅 |
| 1421 | `if (runningTurn === undefined) return` | `[messages, runningTurn]` | **D** |
| 1603 | `if (liveTurn === undefined) return` | `[messages, liveTurn, sessionId]` | **D** |
| 1666 | `if (paintProbeUsedRef.current) return` | `[sessionId]` | C 探针 |
| 1702 | `cardRecoveryRef.current = {…}` | `[sessionId]` | A 重置 |
| 1706 | `const state = cardRecoveryRef.current` | `[messages, sessionId, cardSyncTick]` | **D** |
| 1867 | `if (readingTimerRef.current !== undefined)` | `[]` | A 定时器清理 |
| 1906 | `if (!running) return` | `[running, shadowEvent]` | **D** |
| 1953 | `const now = Date.now()` | `[running, runningTurn, messages, …]` | **D** 计时显示 |
| 2291 | `if (chatSearchHits.length === 0) return` | `[chatSearchAt, chatSearchHits, sessionId]` | **D** 定位联动 |
| 2308 | `const term = chatSearchTerm.trim()` | `[chatSearchTerm, chatSearchComposeTick, …]` | C 搜索防抖 |
| 2480 | `const seq = pendingTurnSeqRef.current` | `[…]` | C 翻页 |
| 2672 | `if (pendingQuestions.length === 0 && …)` | `[…, scrollToBottom]` | **D** 滚动联动 |
| 2729 | `if (ctxMenu === undefined) return` | `[ctxMenu]` | A/C 菜单定位 |
| 3135 | `focusPendingRef.current = …` | `[initialFocus…]` | A 焦点恢复 |
| 3157 | `const intent = locateIntentFor(sessionId)` | `[sessionId]` | A 定位意图 |
| 3167 | `const liveIntent = locateIntentFor(sessionId)` | `[…]` | C |
| 3865 | `if (locatingRef.current) return` | `[messages, pinToRealBottom, autoScroll, showJumpToLatest]` | **D** 自动跟随 |
| 3891 | `if (!running) return` | `[running]` | C |
| 3901 | `if (regenerateWatchdogRef…) clearTimeout` | `[]` | A 清理 |

**统计**：A 6 · B 1 · C 12 · **D 11**

## 三、D 类的处理办法（按这个顺序）

对每一条：

1. **先问它是"谁的函数"**：如果结果完全由已有状态决定 → 直接 `useMemo`，effect 整段删除。
2. 如果它写的是**外部引用**（`xxxRef.current = …`）→ 改成在渲染期或对应事件里赋值，
   不要用 effect 当"渲染后回调"。
3. 如果它**真的有时序依赖**（必须等 DOM 布局完成后才能算）→ 保留 effect，但要写明
   "为什么不能算出来"，否则下一个人会再试一次。

**验收方式**：每改一条，跑 `ChatView.test.tsx`（244 条）+ S0 指纹回放。
两条都绿才继续下一条；任何一条红，先怀疑自己改错了，不要怀疑测试。

## 四、这份清单会过期

行号会随重构漂移。**以文件里的实际行号为准**，本表的用途是"知道有哪些类、每类怎么处理"，
而不是精确索引。重新生成用 `ui-refactor/tools/s2-inventory.mjs`。
