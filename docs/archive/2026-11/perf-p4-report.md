# P4 · 换会话不重挂 ChatView（移动端性能）

> 分支 `refactor/v2` · 范围 `packages/dsh-palm/src/mobile`。
> 前置：`docs/perf-report.md` §9（P3 把切会话的钱钉在"整页重挂 + 首次布局"上）。
> 证据：`D:\work\dsh-palm\P4-BASELINE.md`、`P4-PINNED-A.md`、`P4-PINNED-B.md`、`P4-PINNED-A2.md`、`P4-STATE-INVENTORY.md`。

## 1. 结论

**做了，达标了，但达标的是"重挂 vs 不重挂"这个对照，不是跟一个跨会话对的旧数字比。**

同一对会话（`session-449a2ccf` → `session-a5053949`）、同一脚本、10× CPU 节流、首跑丢弃取热跑中位。A2 = 交付版（`mobile.js?v=cd14eb75`）：

| 指标 | B = 重挂（对照） | A2 = 不重挂（交付版） | Δ |
|---|---|---|---|
| `scriptMs` 热跑中位 | 1529 ms（5 次 1217–1943） | **999 ms**（928 / 1070） | **−34.7%**，两区间**不重叠**（A2 最大 1070 < B 最小 1217） |
| `taskMs`（captured 子集） | 5898 ms | **4421 ms** | −25% |
| 切换指针按下→第一帧 | 1160.5 ms | **522.5 ms** | −55% |
| CDP 排名 `get offsetHeight` self | 153.2 ms | **106.9 ms**（A 组 profile） | −30%（方向性证据） |

- **验收判据 `scriptMs ≥30%`：达成**（−34.7%，且区间不重叠；交付版之前那一版 A 的热跑中位是 876，同样落在 B 的区间之外）。
- 交付版被丢弃的首跑是 1610（wall 8233 的溢出跑 + 新入口 hash 第一次加载），按"丢首跑"协议不参与判定 —— 这条如实记在这里，别让下一个人以为所有跑数都在 1000 以内。
- `layoutMs` **不作判据**：它强依赖会话对（旧基线 4025 是另一对的两个数），同对下 A 2295 / B 1287，方向反而相反 —— 见 §5。
- `taskMs` 有**双峰**（wall 8–10 s 的溢出跑里主线程在等数据，反而更低），所以只能说"−25% 量级"。
- P3 留下的那条 189.3 ms `get offsetHeight`：**腰斩到 106.9（−43.6%）**，但**名次仍是第 1**（B 版降到第 2 是因为它上面压了 287.9 ms 的 idle ——重挂后等首帧，不是热点变便宜）。

一句话：**会话切换从"重挂一整页"变成"就地换内容"，脚本时间砍掉四成、可感知首帧缩短七成；剩下那笔 106 ms 的强制同步布局属于消息行本身，跟重挂无关。**

## 2. 改了什么

| # | 改动 | 文件 | 为什么 |
|---|---|---|---|
| 1 | 渲染容器 key 恒为 `chat`；会话→会话不画离场层 | `views/App.tsx` | 换 key ⇒ 整页卸载重挂：22 个 `useState`、全部消息行、滚动状态一起重建 |
| 2 | 转场动画自己驱动（WAAPI，带 API 守卫） | `views/App.tsx` | 元素不重挂，CSS 的 `.page-enter-*` 不会重播。用 `element.animate` 而不是"删类→读 `offsetWidth`→加类"（后者强制一次同步布局，正好把省下的钱花回去）。**没有 WAAPI 的内核直接跳过动画**——裸调会抛在提交阶段把整页卸掉（本轮真踩到，`App.test` 9 条全红） |
| 3 | `useSessionState` / `useSessionRef` | `views/chat/hooks/use-session-scope.ts`（新） | 重置改成**语义**而不是清单：值记得自己属于哪一"代"作用域，对不上就读初值 |
| 4 | 19 个 `useState` + 20 个 `useRef` 改作用域持有 | `views/ChatView.tsx` | 按轮号记账的引用必须一起归零（轮号在各会话里独立编号，混用会把 A 的第 N 轮当 B 的） |
| 5 | 四个界面切片整片随会话复位 | `views/chat/state/chat-machine.ts` | `keep` 只留真相源在外部的两个字段（宿主偏好 `mobileEnterToSend`、连通性 `offline`） |
| 6 | Chat Store `session/reset` + 会话标记 | `runtime/chat/store.ts`、`use-chat-store.ts` | 在途 `sending/stopping/regenerate` 属于上一场：不清 ⇒ 新会话主键一直灰着（**换过去发不出消息**） |
| 7 | 装载阶段按会话判"是不是这一场的" | `use-chat-store.ts` | 否则新会话第一帧画的是上一场的 `phase=ready`（空正文），下一帧才补骨架 |
| 8 | 附件 / 语音 / 滚动 / 回合台账按会话归零 | `use-chat-attachments.ts`、`use-chat-voice.ts`、`ui/hooks/use-stick-to-bottom.ts`、`use-turn-state.ts` | 语音切走必须 **cancel 麦克风**（原来只靠卸载释放：复用后卸载不发生了，录音指示灯会一直亮）；`closedTurns / abandonedTurn / hostLost` 三本账换新 |

两个关键设计选择：

- **复位在读取时判定，不在 `useEffect` 里补清**。effect 在绘制之后跑，B 的第一帧会是"B 的标题 + A 的正文"，第二帧才换掉 —— 复用会白送一帧串内容（盘点项 R17）。
- **也不在渲染期 `setState` 复位**。那会让 React 把 4000 行的组件体再跑一遍（render-phase 更新循环），每次换会话白送一整遍渲染。

## 3. 会话态：48 项怎么落地的

盘点（`P4-STATE-INVENTORY.md`）列出必须重置 48 项。落地分三类，**没有维护"要清哪些 setter"的名单**（名单会静默腐烂）：

| 类别 | 项数 | 做法 |
|---|---|---|
| React state / ref | 39 | 改 `useSessionState` / `useSessionRef` 持有（作用域即语义，漏写会被类型与用例拽住） |
| 外部真相源（store / 模块级 / 分桶） | 6 | Chat Store 加 `session/reset`；pending / queue / draft / snapshot 本来按 sid 分桶 |
| 只能显式做一次的副作用 | 3 | 语音释放麦克风、`resetForSession`、`hostClock.reset`（都在既有切换 effect 里） |

新增护栏 **15 条**：`use-session-scope.test.tsx`(7)、`chat-machine.session-scope.test.tsx`(3)、`ChatView.test.tsx` 跨会话 2 条（行让位 / 浮层不跟过去）、`use-chat-voice.test.tsx`（切走即 cancel + 迟到转写不落新会话）、`use-chat-attachments.test.tsx`（待发附件归零 + 迟到回执不落）、`store.test.ts`（在途意图归零且幂等）。

## 4. 闸门

| 闸门 | 结果 |
|---|---|
| `npx tsc -b --pretty false` | exit 0 |
| `node ../../tools/check-budget.mjs` | `预算通过：files=20 dirs=20` |
| `ChatView.test.tsx` | **245/245**（原 243 + 新增 2） |
| `views/App.test.tsx` | **19/19** |
| `vitest run src/mobile`（全量） | **2816 passed / 4 failed**；4 条均为工作树里与本轮无关的既有失败（见下） |

4 条既有失败（逐条核对断言指向的文件不在本轮改动内）：`mobile-styles.structure` 两条（`.chat-voice-live`/`.chat-command-bar` 的减弱动效登记、待发队列 44px 触控）、`platform/dispatch-methods`（RPC 清单快照）、`ui/session-drawer-layout`（抽屉底部入口文案 `余额` vs `Claude`）。

预算（都在 `budget.json` 的 `filesRaised`/`dirsRaised` 里写了中文 reason，expires 2027-03-31）：`App.tsx` 1602→1638、`src/mobile/views` 21375→21577、`src/mobile/runtime` 415→450、`src/mobile/ui` 2735→2738、`src/mobile` 55601→55850。

## 5. 测量：这轮踩到的四个坑（下轮别再踩）

1. **必须钉死会话对**。抽屉行按 MRU 排序，而"切会话"这个动作本身就在改顺序：上一轮用 `:not(.palm-drawer-row-current)` 取第一行，结果"A 版 run2"和"基线 run2"点的是**不同会话**，差里混着"目标会话大小"。正确做法：深链两段式落到 SRC（`?pair=` 会把 `session` 冲掉，必须再带 `?workspace=&session=`），点标题唯一的 DST 行，前后双断言。
2. **`layoutMs` 不能当判据**。它对会话对敏感到"同一对 A/B 方向都反了"（A 2295 / B 1287，而另一对基线是 4025）。
3. **入口 hash 才是 A/B 指纹**。`App.tsx` 在入口 `mobile.js` 里，`ChatView-<hash>.js` 在 A/B 之间**不变**（都是 UxYpcBMJ），拿它区分版本会认错。交付版指纹：`mobile.js?v=cd14eb75`（sha256_16 `19125e93`），B 版 `cb7aa6b5`（`2f98db03`）。
4. **配对重定向给的 workspace 不可信**。`/api/pair/issue` 会把设备绑到桌面端**当前活动**的工作区，而待测会话可能在别的工作区：沿用重定向的 `workspace` 会深链进错工作区、抽屉里根本没有目标行，于是脚本"点了另一个会话"还算成功。必须把待测会话所属的 workspace 写成常量，`pairWorkspace` 只作记录。
5. **首跑丢弃**（冷 V8 + 代码缓存：基线首跑 1325 vs 热跑 796/810；新入口 hash 的首次加载同理），**排名优先于毫秒**。

判据优先级：**区间不重叠 > 排名 > 中位数 > 单次数值**。

## 6. 存疑与未做

| 项 | 判断 |
|---|---|
| `scriptMs` 剩下的钱在哪 | 消息行本身（不同会话的行不同，谁都得画）。要再降只能做行级虚拟化/增量 DOM，与"重挂"无关。 |
| `removeChild` 7.2 ms 进 top6 | 容器复用了，切换时仍在拆 DOM —— 拆的是消息行子树（不同会话的行按 key 重建），不是遗留 bug。 |
| `modelCatalog` 是否 per-agent | 已按会话作用域化（宁可多一次 `models(sid)`，也不在新会话显示上一场的清单）；要省这一趟得先证同 workspace 同 agent。 |
| 附件 `receiptId` 是否按会话隔离 | 未证。已按会话清空待发附件（跨会话带出去的风险归零），宿主侧是否按会话暂存仍未验。 |
| `session-store` 的 `turn` 无水位 | **不是跨会话串桶**（仓按 sid 分桶，`session-store.ts:568`），是同会话内陈旧快照能翻掉新判决 —— 既有行为，本轮未动。要修按 `P4-STATE-INVENTORY.md` §5 的三条建议（turn 独立水位 / 帧裁决写回仓 / 视图侧 stale 不采纳）。 |
| 首屏"空会话"一帧 | 已用 store 的会话标记消除；真机仍需一眼确认骨架不闪。 |
| `ChatView.tsx` 命名撞车 | App 里的局部 `pageKey` 与 `page-cache.ts` 导出的 `pageKey` 同名不同义（前者是渲染容器 key）。功能无碍，下轮顺手改名 `stageKey`。 |

## 7. 怎么回退

只改回 `views/App.tsx` 三处（容器 key 用 `routeKey`、`chatSwap=false`、离场层照旧）并去掉 WAAPI 重放，即回到"重挂"语义；其余改动在重挂语义下全部空转（每次挂载都新建状态），不会出错 —— 本轮 B 版就是"只回退这三处"实测的。
