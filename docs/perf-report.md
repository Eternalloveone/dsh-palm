# 移动端卡顿治理 · 收官报告

> 分支 `refactor/v2` · 范围 `packages/dsh-palm/src/mobile`（含包根 `src/mobile-log-source.ts`）
> 配套文档：`docs/perf-convergence-plan.md`（方案与测量层结论）、`docs/perf-c2-2-evidence.md`（增量历史取证卡）

## 1. 结论

用户报的「点任何按钮都卡、很久才生效」已定位为**架构层的订阅粒度问题**，不是某处慢代码。本批完成 5 项结构性改动，全部通过三道硬闸门。

**但要诚实说清楚一件事**：原方案 §2 里那套「10× 降频 3 次中位数」的验收判据，经实测**已作废**——本机底噪 46%，比要验收的 30%/40% 阈值还大（详见 §6）。所以下面 §4 的毫秒数是**方向性参考，不是合格证**；真正可判定的闸门是渲染计数（§5）。

## 2. 根因链

1. `ChatView` 未做订阅切分，`useChatState` 整表订阅 → 任何 store 变更都重建 4000 行视图；
2. `ChatView` 重建 → 行列表 props 全部重算重传 → `ChatRows`/`MessageRow` 的 memo 边界被绕过；
3. 每行一个 `onOpenFile` 内联闭包 + 毫秒级变化的 `hostNowMs` prop → 每行 memo 彻底失效；
4. 输入草稿走 React state，每按一个键重建整个 ChatView。

## 3. 已实施

| # | 改动 | 关键文件 | 效果 |
|---|---|---|---|
| B3 | 草稿改模块级 store + 输入区自订阅（`useChatDraftControl` / `useDraftValue`） | `views/chat/hooks/use-chat-draft.ts` | 按键不再重建 ChatView；顺带修出 `send` 依赖漏 `offline` 的真 bug |
| C1 | 行水合门改订阅快照引用（`useRowHydrated`），不再渲染期读仓 | `views/chat/hooks/use-row-hydrated.ts`、`components/chat-rows.tsx` | 快照晚到不再靠父组件再传一次 props 才翻水合 |
| C2-1 | 会话快照支持 `rows:false` 瘦身路径 | `mobile/api/mobile-session-state.ts`、`data/impl/session.ts` | 回合轮询不再每次重传全量行 |
| P2 (A1′) | 新增 `useChatSelector`；`useChatSessionStore` 收窄到 `phase/notice/title`；`sending/stopping` 下沉到作曲区 | `runtime/chat/use-chat-store.ts`、`views/ChatView.tsx`、`components/composer-section.tsx` | 一次发送的 sending 翻转不再重建宿主视图（2 → 1） |
| P0 | 预算闸门排除生成物 `mobile-styles.ts`（12939 行），并 ratchet 重设 8 个 key | `tools/check-budget.mjs`、`platform/budget.test.ts`、`tools/budget.json` | `src/mobile` 计数字面量 68952 → 55592，把生成物重复计数摘掉 |

## 4. 实测（10× CPU 降频 · 方向性参考）

**打字**（主线程脚本耗时 / 字符）

| 时点 | perCharScriptMs |
|---|---|
| B3 前 | 180 |
| B3 后 | 43 / 67（两次独立测量） |

**点击矩阵**（ms，越左越好）

| 操作 | 前 | 后 |
|---|---|---|
| 输入框聚焦 | 130 | 71 |
| 上下文用量环 | 397 | 167 |
| 模型 chip | 529 | 176 |
| 附件 | 466 | 391 |
| 过程条展开 | 591 | 99 |
| 过程条收起 | 396 | 231 |
| 打开抽屉 | 924 | 608 |
| 切会话 | 1152 | 1363 |

⚠️ 这些数字跨多轮采集、**单次点值**，未做中位数。同代码相隔 2 分钟可复现 29 → 60 的漂移，故不可用于回归判定，只能说明「量级方向对了」。

## 5. 当前闸门状态

| 闸门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -b --pretty false` | exit 0，无输出 |
| 行数预算 | `node ../../tools/check-budget.mjs` | `预算通过：files=20 dirs=20` |
| 渲染计数 | `chat-rows-sending-gate.test.tsx` 等 | 相关 39 文件 / 524 用例全绿 |
| 架构 | `architecture.test.ts` + `architecture-graph.test.ts` | 绿 |

`ChatView.tsx` 实测 **4065 行**（文件级只减不增上限 4068）。
本轮唯一预算上调：`dirs:src/mobile/runtime` 406 → 415、`dirs:src/mobile` 55592 → 55601，两项均在 `budget.json` 的 `dirsRaised` 里写了中文 reason。

## 6. 测量层的否定结论（重要，避免下次重踩）

- **毫秒法不成立**：`perCharScriptMs` 三次 60/36/52，中位数 52、spread 46.2%；`idle.taskMs` spread 152.4%；43 个指标只有 3 个 spread ≤15%，且其中一个采样值仅 8/8/9 ms（量化太粗）。归因是**方法**（两窗口不等长、`ScriptDuration` 1 ms 量化、`toFrame1` 单样本）+ **环境**（常驻 24 chrome / 9 node），**不归因代码回归**。
- **页面内计数也不成立**：`?perf=1` 的 `__dshPalmPerf` 三个埋点全在 SSE 流式路径，没有交互渲染计数器；打字 10 字符 `total=5` 全是背景 `recv` 帧，同操作重复两次 0 → 5，随流量抖。
- **替代方案**：主闸门改用 vitest 渲染计数（`vi.mock` 行组件 + `vi.hoisted` 渲染日志 + `fireEvent`），Playwright 只做粗筛、只报区间。详见方案文档 §8。

## 7. 未做与建议

| 项 | 判断 |
|---|---|
| **C2-2 历史增量拉取** | **建议搁置**。取证卡结论：服务端日志源只有「尾部窗口」，无 `sinceSeq/afterSeq`，分片元信息只有字节偏移、无 seq 区间；能做的最多是把**响应体**变小，读盘成本不变，且需动 `budget.json` + 客户端新增 append 路径。触发条件：实测到会话态轮询真的被响应体大小拖住再上。 |
| **抽屉 / 切会话** | 已专项排查（见 §9）：126ms 是首次布局固有成本、挪读点无效；剩下的大头是**整页重挂**。**已做完**（P4，见 `docs/perf-p4-report.md`：`scriptMs` −34.7%、首帧 −55%）。顺手把渲染快照容量 4 → 8 对齐 session-store。 |
| `App.tsx` / `message-row` 拆分 | 仍欠，已在 `budget.json` 的 `ratchetReset.note` 里记账。 |
| `?perf=1` 不生效 | 配对后 URL 被改写为 `?workspace=…&session=…`，参数丢失；临时可用 `localStorage.setItem('dsh.palm.perf','1')`。低优先。 |
| 全量 `src/mobile` 测试 | 仍有少量与本批无关的红（styles 结构、session-drawer footer），非本批引入。 |

## 8. 复现

```powershell
cd packages\dsh-palm
npx tsc -b --pretty false
node ../../tools/check-budget.mjs
.\node_modules\.bin\vitest.CMD run src/mobile/views/chat src/mobile/runtime src/mobile/architecture.test.ts
```

旁证（不判定合格，只看量级）：`D:\work\dsh-palm\perf-gate.mjs`（3 次中位数 + Δ 表，自带 spread 失效判定）。

## 9. 切会话专项（P3）：两个假设被证伪，一个真因被钉住

切会话是全矩阵最差的一档（`toFrame2` 366 ms、动作段 3021 ms）。用 **CDP CPU 采样排序**（不是计时，排名对单次采样就稳）拆开后得到三个结论，其中两个是我先入为主的错判。

### 9.1 真因：净工作 250~300 ms 里 126 ms 是「首次布局」

| 项 | 净增 self | 占比 |
|---|---|---|
| 首次布局（`get offsetHeight` / `get scrollHeight`，谁先读谁付账） | 126~132 ms | ~40% |
| React/框架 + shared + ChatView 业务代码 | ~108 ms | ~35% |
| fetch + JSON 解析 | **6.4 ms** | **~2%** |
| 对照：仅打开抽屉 | 37.5 ms | — |

### 9.2 被证伪一：把测量读点从提交阶段挪到下一帧 —— 无效，已回退

`markdown-text.tsx` 的「正文变矮」侦测在 `useLayoutEffect` 里无条件读 `offsetHeight`，而挂载时 `previous === 0`，要判的「变矮」根本不可能成立。改成下一帧建基线后复测：

- `get offsetHeight` **确实从榜上消失**；
- 但 `get scrollHeight` 立刻顶上来，**同样 125.9 ms / 只有 2 次读**。

⇒ 这笔钱是「新页面首次布局」本身的账，不是某一次多余测量。rAF 回调仍在绘制前执行，布局该做还是做。**已回退该改动**，不留无效补丁、不再抬预算。

### 9.3 被证伪二：`invalidateSession` 不是切回冷启动的原因

原本判断：`App.tsx:748` 切会话时 `invalidateSession(上一个会话)` 会删掉快照，导致切回去重新拉全量。核实后推翻：

- 聊天首屏行的数据源是 `session/chat-snapshot.ts` 的**内存渲染快照**，不是 `page-cache`；
- `page-cache` 在生产里只有两个 key（`SettingsView`、`DiffView`），`ChatView` 零引用；
- 所以 `invalidateSession` 删的是 `diff|<sid>|<path>` 这类键，**与聊天首屏无关**；
- **切回已访问会话本来就是 stale-while-revalidate**，不闪骨架。

生产代码零改动。只补了一条守卫用例（`ChatView.test.tsx`，照真机路径演：A 挂载 → 卸载 → 失效 → 挂 B → 再挂 A 且网络页挂起不返回），断言第一帧有行、无骨架。该用例在旧代码上本来就是绿（行为本来就对），因此另做了变异验证（临时插入 `forgetChatSnapshot` → 变红 → 撤销）证明它不是空转断言。

### 9.4 落地的小改动：渲染快照容量 4 → 8

`chat-snapshot` 只留 4 场，而 `session-store` 留 8 场 ⇒ 连翻 5 场以上再回最早那场会掉快照、白冷启动一次。改为 8 对齐，并同步更新 LRU 用例（旧用例硬编码 4，改后先红后绿）。

### 9.5 还剩什么

`scriptMs` 中位 **1929 ms @10× 降频**（约合 1× 下 190 ms）主要花在**整页卸载重挂**：`App.tsx` 的页面容器是 `<div key={routeKey}>`，换会话即换 key，ChatView 的 22 个 `useState`、全部行、滚动状态一起重建。

要再降只能「换会话不重挂 ChatView」。**这一条已经做完**（P4，2026-11-12）：同一对会话、同一协议下 `scriptMs` 热跑中位 **999 ms vs 重挂对照 1529 ms（−34.7%，区间不重叠）**，指针按下→首帧 1160 → 522 ms，`get offsetHeight` 189.3 → 106.9 ms（名次仍第 1）。改法、闸门与"layoutMs/毫秒法为什么不能当判据"见 `docs/perf-p4-report.md`。

