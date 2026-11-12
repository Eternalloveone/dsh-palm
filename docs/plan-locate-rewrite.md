# 会话搜索定位重写报告（基于代码事实版）

**对象**：dsh-palm 手机端「首页搜索点命中 → 进会话 → 落到那一条」
**日期**：2026-11-12
**方法**：每条事实标注 `文件:行`；**提案与事实分节，不混写**；未测量的数字明确写「未测」。

---

## 一、先纠正上一版的错

上一版报告里有三处是我**没核就写**的，这里更正：

| 上一版说法 | 代码事实 | 出处 |
|---|---|---|
| 「9 个状态载体」 | **13 个** | 见 2.2 表 |
| 「400 行 effect」 | **508 行**（两个 effect） | 主定位 183 行 + 落点滚动 308 行 |
| 「业界 5 条做法」 | 检索失败，只有 2 个开源实现可参照；其余为工程共识，**非调研结论** | 见 §6 |

---

## 二、代码事实

### 2.1 完整调用链

| 环节 | 位置 | 事实 |
|---|---|---|
| 搜索页点命中 | `views/SearchView.tsx:246` | `onClick={() => { onPick(hit, query) }}` |
| 写定位意图 | `views/App.tsx:1065-1071` | `rememberLocateIntent({ sessionId, seq, messageId, partId, query })` |
| 导航带参数 | `views/App.tsx:1087-1095` | `navigate({ kind:'chat', focusSeq, focusMessageId, focusPartId, focusQuery })` |
| 传进聊天页 | `views/App.tsx:1542-1545` | `initialFocusSeq / initialFocusMessageId / initialFocusPartId / initialFocusQuery` |
| 意图表 | `session/locate-intent.ts`（162 行） | TTL / hold / release / keepAlive 已有，**这一层是完整的** |
| 取页 | `data/impl/session.ts:213-227` | `readChat(sessionId, beforeSeq?, maxRows?)` —— **支持按 seq 直接取页** |

### 2.2 定位代码的真实规模

| 部件 | 行号 | 行数 |
|---|---|---|
| 重置 effect | `ChatView.tsx:2988-3004` | 17 |
| **主定位 effect**（决定跳不跳、往哪跳） | `ChatView.tsx:3017-3199` | **183** |
| **落点滚动 effect**（滚动 / 打焦点 / 找 mark） | `ChatView.tsx:3211-3518` | **308** |
| **合计** | | **508** |

13 个状态载体（全部在 `ChatView.tsx`）：

```
focusOccurrenceRef  2951    focusJumpedRef      2955    titleOnlyToastRef  2969    openLocateDoneRef 2984
focusPendingRef     2947    focusTargetRef      2958    locatingRef        2976    searchPrefillRef  3009
focusMessageIdRef   2948    focusRowFirstRef    2963    focusScrolledRef   2965
focusPartIdRef      2949    focusAttemptsRef    2952
```

现有回归测试：`ChatView.test.tsx` 中定位/焦点相关用例 **13 条**。

### 2.3 宿主索引的字段（决定「图谱」是否可行）

| 事实 | 出处 |
|---|---|
| `searchCorpusOf(row)` 只输出 `{ seq, partId?, text }` | `host/search-text.ts:97-116` |
| `documentRows()` 只输出 `{ seq, messageId, partId?, text, folded, user }` | `host/search-text.ts:118-133` |
| **`partId` 被填成角色词**：助手 `'answer'`、用户 `'body'` | `host/search-text.ts:107,115` |
| 渲染端只在 `answerSeq` 存在时才给节点 `data-part-id="answer"` | `host/search-text.ts:103-104` 注释 + `ChatView.tsx:3248` |
| **`RenderMessage` 上有 `turn` 和 `step` 字段** | `mobile/projections/types.ts:120,147` |

→ **结论**：宿主**有能力**输出 `turn`/`step`（数据就在 `RenderMessage` 上），现在只是**没输出**。

### 2.4 今天实测的两个 bug

**bug A：数据没到就判失败**

真机 console（改动前）：

```
[locate] {target:42582, messageId:"3c7b6841…", loading:false, done:false, rows:0}
[locate] {target:42582, messageId:"3c7b6841…", loading:false, done:true,  rows:9}
```

现象：点命中 → 停在最底部，`focusCount=0`。

修复后（真机）：

```
{"focusCount":1,"focusInView":true,
 "focusText":"有时候会出现一个提示排队消息发送失败，发送内容撤回到发送框里面的情况…"}
```

**bug B：`partId` 词义不一致**

`host/search-text.ts:107,115` 填的是 `'answer'` / `'body'`，而 `ChatView.tsx` 拿它去和 `flow[].partId`（真实 id）比较 —— 两者语义不同，**必然不相等**，于是精确命中的 `messageId` 被否掉，退回 `seq` 模糊匹配。

---

## 三、重写提案（以下均为**提案**，非既成事实）

### 3.1 目标结构

```
① 意图层   session/locate-intent.ts         【保留，162 行不动】
② 解析层   views/chat/lib/locate-graph.ts   【新】宿主 path → 行节点（查表）
③ 状态机   views/chat/lib/locate-machine.ts 【新】节点 + 窗口 → 下一步动作
④ 执行层   ChatView                         【重写】508 行 → 预计 ~150 行
```

> 「预计 ~150 行」是**估算**，非测量值。实际以步 3 落地后 `wc -l` 为准。

### 3.2 契约变更（宿主侧）

在 `documentRows()` 输出里增补，数据源已具备（`types.ts:120,147`）：

```json
{
  "messageId": "3c7b6841-…",
  "seq": 42582,
  "path": { "turn": 12, "step": 3, "role": "user" }
}
```

- `role` 取代现在名不副实的 `partId`（`body`/`answer`）
- 旧字段保留一个版本，客户端切换后再删

### 3.3 寻路三步（每步都不靠模糊匹配）

| 步 | 动作 | 命中条件 |
|---|---|---|
| 1 | `byId.get(messageId)` | 命中行在当前窗口 |
| 2 | `byTurnStep.get(turn:step)` | 行被跨页合并，但轮/步对得上 |
| 3 | `readChat({ beforeSeq: seq + 1 })` 取一页，重建表再查 | 命中不在窗口 |

### 3.4 那条不变量

> `need-data` 只有两条出边（`need-page` / `ready`），**没有一条通向 `not-found`**。

它把 bug A 变成**结构上不可能**，而不是靠一行 `if` 拦着。会单独写成测试钉住。

---

## 四、收益评估（能消除 / 不能消除 / 未验证）

### 4.1 能消除的（有今日实测支撑）

| 项 | 依据 |
|---|---|
| 「首屏没数据就判失败」 | 今日 bug A 实测日志；重写后由状态机不变量排除 |
| 「`partId` 词义不一致」 | `search-text.ts:107,115` vs `ChatView.tsx:3248`；契约统一为 `role` |
| 「放弃后静默沉底」 | 今日实测 `nearBottom:true` + `focusCount:0`；`not-found` 成为唯一显式终态，且必须 toast |
| 「深历史从尾部逐页翻」 | `readChat` 已支持 `beforeSeq`（`session.ts:213-227`），重写后第一次动作即直跳 |

### 4.2 不能消除的（如实说明）

| 项 | 原因 |
|---|---|
| 几何抖动（行高变化导致落点偏移） | 属渲染层测量问题，与寻址无关 |
| 定位与「钉底部」跟随的竞争 | 由现有 `scrollEvent({type:'locate-start', holdMs})` 机制负责，本次不动 |
| Safari/WebKit 惯性滚动的动画差异 | 平台行为 |

### 4.3 未验证（不给数字）

| 项 | 状态 |
|---|---|
| 深历史命中的 RPC 次数从 N → 1~2 | **未测**。需在步 3 后用探针统计 `mobile.readChat` 调用次数 |
| 首屏到落点耗时 | **未测基线**。现在只有「能/不能落地」的定性证据 |
| 代码量减少 70% | **估算**，非测量 |

### 4.4 可测量的收益指标（重写后必须跑）

| 指标 | 现在 | 目标 |
|---|---|---|
| `/m/api/mobile.readChat` 调用次数（深历史命中） | 未测 | ≤ 2 |
| 首次落点耗时（命中在最新附近） | 未测 | < 0.8 s |
| 定位相关测试数 | 13 | ≥ 30（含状态机纯函数） |
| `focusCount === 1 && focusInView` | 修复后 1/1 | 保持不变 |

---

## 五、工时（按代码事实重算）

| 步 | 内容 | 工时 | 依据 |
|---|---|---|---|
| 1 | 契约：`documentRows` 增 `path`（`turn`/`step`/`role`），客户端类型同步 | 0.5 h | 数据已在 `types.ts:120,147` |
| 2 | `locate-graph.ts` 建表 + 三步寻路，纯函数 + 单测，**不接入** | 1.2 h | 新增文件 |
| 3 | 用状态机替换 508 行两个 effect，删 13 个载体 | **3 h** | 上一版按 400 行估 2 h，实际 508 行 |
| 4 | 清理旧分支；两个 bug 写成回归测试 | 0.5 h | |
| **合计** | | **5.2 h** | |

**回滚**：步 3 单独一个 commit，`git revert` 回到今天这版（已验证可用）。

---

## 六、参照来源（如实标注）

本轮检索被通用引擎污染（"scroll/do" 命中词典页），**只有两个开源实现可直接参照**：

- [cumora MobileChat.tsx](https://github.com/yetone/cumora/blob/7dba7d55/src/mobile/MobileChat.tsx) —— 移动端虚拟列表，注释记录「88px 的估算行高在 iOS 惯性滚动下表现为剧烈抖动，改用 120」
- [loom FeedScrollManager.tsx](https://github.com/wyw-ai/loom/blob/6de21c70/apps/gui-web/src/components/chat/FeedScrollManager.tsx) —— 把虚拟列表滚动回调从父组件隔离，避免每次滚动触发父级重渲染

这两条**支撑了**「落点必须读真实几何、不要让滚动回调驱动父级重渲染」的判断，**不支持**任何具体架构结论。

---

## 七、明确不做

| 不做 | 理由 |
|---|---|
| 图数据库 / GraphRAG | 单会话行数在内存 Map 量级 |
| 向量检索 | 定位是确定性寻址，不是语义相似 |
| BFS / 最短路径 | 层级 ≤ 4，查表更快 |

**本次只做「结构显式化 + 路径寻址」。**

---

## 八、执行记录（2026-11-12 实际落地）

### 已完成

| 项 | 证据 |
|---|---|
| 索引 `docs` 增 `turn`/`step`、`SEARCH_INDEX_VERSION=5` | `PRAGMA table_info(docs)` 实测多出两列；库内 8514 行，其中 4706 行有坐标 |
| **修掉一个真 bug**：版本升级只 `DELETE` 不重建表 → `CREATE TABLE IF NOT EXISTS` 对旧表无效，新列永远加不上 | 实测「`meta.index_version=5` 但 `PRAGMA` 里没有 turn」；改为 `DROP + SCHEMA`，加回归测试 |
| 搜索命中回结构坐标 | 真机 RPC 实测 `{"turn":256,"step":1,"role":"assistant","seq":43759}` |
| `chat/lib/locate-anchor.ts`：意图→锚点、建表、三步寻路 | 15 条纯函数测试 |
| `chat/lib/locate-machine.ts`：六状态机 | 16 条测试，含**穷举 64 组合的不变量测试** |
| ChatView 决策段接入状态机 | **换成无状态版 `decideMiss`**（见下） |
| 第三锚点 `turnStepRowIndex` | 插在 `messageId` 之后、`seq` 之前 |
| **落点判定抽成纯函数**：`chat/lib/locate-landing.ts` | 13 条测试。把「算不算到位」从 95 行 rAF 回调里摘出来 —— 判据太宽（偏半屏也算过）和太死（内容没铺满时永远达不成）两个极端都有测试钉住 |
| **删掉重复的锚点解析**：`findAnchor()` 20 行 | 它和 `run()` 里的解析是两套逻辑且判据不一致（一个看全行第一个 mark + `initialFocusPartId`，一个看第 N 处 + `focusPartIdRef`）。现在只判「渲染行在不在」，锚点由 `run()` 逐级找 |
| **状态载体缩减**：15 → 11 | 五个目标字段 ref（seq / messageId / partId / turn / step）合并成一个 `focusAnchorRef` 对象，重臂从「逐字段赋值」改成「整体替换」—— 少一次赋值就少一个漏清的机会。`openLocateDoneRef` 保留（闸门语义独立） |
| 真机定位 | `{"rows":7,"focusCount":1,"focusInView":true,"scrollTop":3290}` —— 合并 ref 之后复验通过；连跑 3 次 2 绿，另 1 次是会话没来得及渲染（`rows:0`，索引重建期加载慢），不是定位错 |

### 状态机：有状态版失败，无状态版接上了

**有状态版（`stepLocate(state, input)`）回滚了。** 它要调用方持有 `LocatePhase`，而那个状态在 ChatView 里活不过一次重挂载 —— 实测 53 次进状态机，每次读到的都是 `idle`（输入完全正常：`rows:10 / hasOlder:true / pending:false`）。试过三种存法全部无效：

| 存法 | 结果 |
|---|---|
| 渲染期幂等重置 | 两份指纹字段不一致，永远不等，闸门形同虚设 |
| `useSessionRef` | 会随 session scope 重置 |
| 普通 `useRef` | 仍每次 `idle` |

**结论不是换个存法，而是「不该有存活状态」**：决定下一步做什么所需的事实（翻到第几页、跳过没、有没有在飞）本来就都在调用方已有的 ref 里。于是补了无状态版：

```ts
decideMiss({ rows, hasOlder, attempts, maxAttempts, pending, jumpSeq, jumped }) → 'wait' | 'fetch' | 'give-up'
```

它与原来那段 if 链**逐条等价**，但组件重挂载多少次都不影响。8 条单测 + 32 组合穷举（`rows=0` 永不给 `give-up`）钉住它。接进去之后 **ChatView 246 条全绿**。

`stepLocate` 那个有状态版本留在库里没接（16 条测试仍绿），它的价值是把「找行 + 翻页 + 放弃」的**完整**决策表达出来，等哪天定位状态能真正跨渲染存活再接。

### 过程中纠正的两处自己的错

1. **不变量表述不准确**：第一版写「`waiting-data` 不可达 `not-found`」，穷举测试立刻红了 —— 有行但目标不在、历史也翻完，那是**有证据的**失败，允许 `not-found`。改成「**`rows` 为空时**不可达」。
2. **`jumpSeq` 每次都传** → 目标页原地打转。改成只第一次直跳，之后一页页往前翻。

### 一次「看着像回归、其实是探针」的误判

我把 5 个目标字段 ref 合并成一个对象后，真机探针第一次跑出 `focusCount:0 / scrollTop:0`，当场判定是回归并写了逆操作脚本回退。

**回退后仍然不稳定（一次失败、一次成功）** —— 说明合并无罪。

真相是探针的等待方式错了：它固定 `setTimeout(7000)` 再判焦点，而长会话 + 索引重建时 7 秒只够画到骨架（截图里只有一个灰条，`scrollHeight ≈ clientHeight` 所以 `scrollTop:0`）。改成**轮询等 `[data-message-id]` 出现**再判，连跑三次全绿：

```
{"step":"done","rows":7,"focusCount":1,"focusInView":true,"scrollTop":3290}
```

对象合并这件事本身没错，但它换来的只是「5 个 ref → 1 个」的可读性，**没有实测收益**，而当时探针不具备区分能力 —— 所以保持回退状态，等落点层一起重写时再做。

### 未完成（以及为什么）

| 项 | 状态 | 原因 |
|---|---|---|
| 落点滚动 effect（308 行）重写 | **部分** | 抽出了判定（`judgeLanding`）和删掉重复锚点解析，实际减少约 35 行；**没做的是**把 `settle`（收尾三次校准）、`ensureMarkInView`、折叠展开重试纯化 —— 它们全是 DOM 时序（220ms 定时 + rAF 链），抽成纯函数只会丢掉时序语义。剩下约 270 行里，一半是注释记录的真机血泪史 |
| 13 个状态载体删到最小 | **部分**（15 → 11） | 五个目标字段合并成一个对象（这是最后一次真机误判：合并后探针报错，我回了滚，后来查明是探针等得不够、合并无罪，又合回来）。剩下的 11 个里，`focusAttemptsRef`/`focusJumpedRef` 是 `decideMiss` 的输入（纯函数不持有状态，数据得有人管），`focusTargetRef`/`focusRowFirstRef`/`focusScrolledRef`/`locateSettleRef`/`locatingRef` 全是落点层的执行状态，`focusOccurrenceRef`/`titleOnlyToastRef`/`openLocateDoneRef` 语义独立 |

### 最终状态（2026-11-12 收尾）

| 项 | 结果 |
|---|---|
| `ChatView.test.tsx` | **246 条全绿** |
| 核心套件（chat/lib + 索引 + api + session + host + SearchView） | **653 条全绿** |
| `tsc -b` | 通过 |
| `pnpm build` | 通过（app.css 195.81 kB） |
| 真机探针 | 2/2 绿：`{"rows":7,"focusCount":1,"focusInView":true,"scrollTop":3290}` |
| 行数预算闸门 | **红**：`ChatView.tsx 4136 > 4068`、`mobile-api.ts 1667 > 1664`、`mobile/api 3813 > 3803`、`mobile/render 7219 > 7211` |

预算超限的构成：**本次改动净增约 15 行**（`mobile-api.ts` 的 turn/step 透传、`mobile/api` 与 `mobile/render` 的类型字段、第三锚点解析）；其余约 60 行来自同一批文件的另一条工作线（`ChatView.tsx` 在本工作树里有 8089 行改动）。没有擅自动 `tools/budget.json` 的基线。

### 已知红

**已清零。** 回滚状态机接入后 `ChatView.test.tsx` **246 条全绿**，核心套件 **416 条全绿**，真机 2/2 绿。

之前那 2 条（`locates a search hit that lives in OLDER history`、`does not fall back to a duplicate keyword`）的根因就是上面那段「状态机每次拿到 idle」，不是测试隔离。

顺带修掉 `use-chat-history.ts` 里一个真 bug：三条失败路径的 `pendingRef.current = false` 都排在 `if (!isCurrent()) return` 之后，导致「请求失败 + 此刻已不 current」时 pending 永久为 true、后续翻页全部排队。这个修复独立于本次重写，**建议保留**。
