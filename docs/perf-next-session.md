# 下一轮开工书 · 移动端性能（换会话不重挂 ChatView）

> **本轮（P4）已收口**：见 `docs/perf-p4-report.md`。`scriptMs` 热跑中位 999 vs 重挂对照 1529（−34.7%，区间不重叠）、指针按下→首帧 1160→522 ms、`get offsetHeight` 189.3→106.9 ms（名次仍第 1）。交付版指纹 `mobile.js?v=cd14eb75`。
> 下一轮的候选在 `perf-p4-report.md` §6：行级虚拟化/增量 DOM（这才是剩下的脚本时间所在）、`session-store` 的 turn 水位、附件 receiptId 跨会话隔离。
>
> 上一轮（2026-11-12）已完成 B3 / C1 / C2-1 / P2(A1′) / P3 专项排查 + **P4 换会话不重挂**。
> 本文件是给**新会话**的唯一入口：新会话上下文是空的，磁盘上的这几份文件就是它的记忆。

## 0. 一句话现状

用户报的「点按钮卡」已治理完（打字 180 → 43~67 ms/字符）；「切会话整页重挂」也已治理完（本轮）。剩下的脚本时间在**消息行本身**（不同会话的行不同，重画是必须的），要再降只能做行级虚拟化/增量 DOM。

## 1. 必读（按这个顺序，只读需要的段落）

| 顺序 | 文件 | 读什么 |
|---|---|---|
| 1 | `docs/perf-report.md` | §1 结论、§9 切会话专项（**两个证伪 + 真因**）。这是上一轮的全部沉淀。 |
| 2 | `docs/perf-convergence-plan.md` | §2 收敛判据（注意那行 spread 判据已作废）、§3 阶段划分、§8 测量层结论。 |
| 3 | `D:\work\dsh-palm\P3-PROFILE.md` | 切会话 CPU 采样榜单（126 ms 首次布局的证据）。 |
| 4 | `D:\work\dsh-palm\P3-SWITCH-HANDOFF.md` | 机制核实：首屏数据到底从哪来（带 file:line）。 |
| 5 | `D:\work\dsh-palm\P2-HANDOFF.md` | P2 的改法与闸门写法，可作为本轮改动的样板。 |

## 2. 上一轮任务（P4，已完成）：换会话不重挂 ChatView

**结果**：`scriptMs` 热跑中位 999 ms（重挂对照 1529，区间不重叠）、`taskMs` captured 5898→4421、指针按下→首帧 1160→522 ms、`get offsetHeight` 189.3→106.9 ms（名次仍第 1）。交付版指纹 `mobile.js?v=cd14eb75`。改法与闸门见 `docs/perf-p4-report.md`，**下一轮不要再做这件事**。

下面保留当时的任务描述与坑，供理解"为什么这么做"：

**当时的现状**：`App.tsx` 页面容器是 `<div key={routeKey}>`（约 `:1551`），换会话 = 换 key ⇒ `ChatView` 整页卸载重挂，22 个 `useState`、全部消息行、滚动状态一起重建。

**当时的验收标准**：`scriptMs` 中位从 1929 ms@10× 明显下降（目标 ≥30%），且 ChatView 全部用例 + `views/chat` 套件零红。**用 CDP 采样排名验证，不要用毫秒阈值**（本机毫秒底噪 46%，见 §8）。

**当时的坑（实际都踩到了，结论见 `perf-p4-report.md`）**：
- 22 个 per-session 状态必须逐个确认「切会话后会被正确重置」→ 实际落地为 48 项（`P4-STATE-INVENTORY.md`），做法是**作用域化**而不是维护重置名单。
- `stream/session-store.ts` 的 `turn` **不受 maxSeq 水位保护**（约 `:590-592,605`）→ 核实后确认仓按 sid 分桶（`:568`），**不是跨会话串桶**，是同会话内陈旧快照能翻掉新判决；既有行为，本轮未动。
- 页面转场动画靠 `key` 变化触发 → 改成 WAAPI 自己重放，且必须带 `typeof element.animate === 'function'` 守卫（裸调在 jsdom/老内核会把整页卸掉）。

## 3. 环境与命令（照抄，别自己摸）

```powershell
cd C:\Users\Administrator\dsh-source\dsh-palm\packages\dsh-palm
npx tsc -b --pretty false                       # 干净时无输出
node ../../tools/check-budget.mjs               # 通过 = 预算通过：files=20 dirs=20
.\node_modules\.bin\vitest.CMD run <相对路径>    # 绝不要用 npx vitest
pnpm build                                      # 改完必须重建才会生效
```

- 服务在 `http://127.0.0.1:3080`，移动端入口 `/m/`；构建产物由该服务直接托管（`/m/mobile/<chunk>.js`），**刷新页面即可，不用重启服务**。
- 改完务必确认线上 chunk 变了：`Invoke-WebRequest 'http://127.0.0.1:3080/m/mobile.js'` 里匹配 `ChatView-*.js`，再探该 chunk 返回 200。

## 4. 五条硬坑（都踩过，会浪费时间）

1. **禁止用 PowerShell `Get-Content | Set-Content` 改中文源码** —— 会按 GBK 解释 UTF-8，把中文烧成 `?` / U+FFFD。改文件一律用 edit/write 工具或 Node。
2. **行数只能用 Node 数**：`Get-Content` 会少报（ChatView 实测 4065，它给 3528）。行数以 `check-budget` 的计数为准。
3. **`budget.json` 的 `dirsRaised` / `filesRaised` 只是文档，不生效** —— 真正生效的是 `dirs` / `files` 里的数字。上调时要两处一起改，否则闸门照样红。
4. **`ChatView.tsx` / `App.tsx` 有只减不增的文件级行数上限**，新逻辑放 `views/chat/hooks/`。
5. **不要 commit / stash / checkout / reset** —— 工作树有 600+ 未提交文件，全是别的活。

## 5. 已证伪的路径（重踩纯属浪费）

| 试过 | 结论 |
|---|---|
| 用 Playwright 毫秒 3 次中位数当验收 | **无效**。底噪 46%（`perCharScriptMs` 60/36/52），43 个指标只有 3 个可用。 |
| 用页面内 `__dshPalmPerf` 计渲染次数 | **无效**。3 个埋点全在 SSE 路径，打字 10 字符 `total=5` 全是背景帧。另 `?perf=1` 本身失效（URL 被改写丢参数）。 |
| 把 `markdown-text.tsx` 挂载期 `offsetHeight` 读点推迟到下一帧 | **无效，已回退**。`get offsetHeight` 从榜上消失，`get scrollHeight` 立刻以同样 125.9 ms 顶上 —— 那是首次布局固有的账，谁先读谁付。 |
| 去掉切会话时的 `invalidateSession` | **前提就错**。聊天首屏行来自 `session/chat-snapshot.ts` 内存快照，不是 page-cache；切回本来就是 SWR，不闪骨架。 |
| 用「跨会话对的毫秒对照」验收 | **无效**。抽屉按 MRU 排序，测量本身在改顺序；A 版 run2 与基线 run2 点的是**不同会话**，差里混着"目标会话大小"。必须钉死 SRC→DST 一对（深链两段式，`?pair=` 会冲掉 `session`）。 |
| 用 `layoutMs` 当判据 | **无效**。它对会话对敏感到同一对下 A/B 方向都反（A 2295 / B 1287，另一对基线 4025）。双峰 + 会话对双重影响。 |
| 用 `ChatView-<hash>.js` 区分 A/B build | **无效**。`App.tsx` 在入口 `mobile.js` 里，重挂/复用之间 ChatView chunk hash 不变。看入口 `mobile.js?v=`。 |
| 用配对重定向给的 workspace 做深链 | **不可信**。`/api/pair/issue` 绑的是桌面端**当前活动**工作区，待测会话可能在别的工作区；沿用会深链进错工作区、抽屉里没有目标行，脚本还会"点了别的会话"算成功。 |
| C2-2 历史增量拉取 | **已搁置**。服务端日志源只有尾部窗口，无 `sinceSeq/afterSeq`，分片元信息只有字节偏移无 seq 区间 —— 只能省传输体，读盘成本不变。见 `docs/perf-c2-2-evidence.md`。 |

**唯一可信的性能量具**：CDP CPU 采样**排名**（`D:\work\dsh-palm\switch-profile.mjs`，可复跑）。排名对单次采样就稳，不看绝对值。

## 6. P4 改过的文件（便于 review / 决定要不要单独提交）

源码（11 个）：

- `views/App.tsx`（1602 → 1638）：容器 key 恒为 `chat`、会话→会话不画离场层、WAAPI 转场重放（带 API 守卫）
- `views/ChatView.tsx`（4065 → 4067）：19 个 `useState` + 20 个 `useRef` 改会话作用域；接 Chat Store `session/reset`
- `views/chat/hooks/use-session-scope.ts`（新，109）：`useSessionState` / `useSessionRef`
- `views/chat/hooks/use-chat-session.ts`（`rows` 作用域化）、`use-chat-voice.ts`（切会话 cancel 麦克风）、`use-chat-attachments.ts`、`use-turn-state.ts`（三本账随会话换新）
- `views/chat/state/chat-machine.ts`（四个切片 + `keep` 白名单）
- `ui/hooks/use-stick-to-bottom.ts`（位置判据随会话归零）
- `runtime/chat/store.ts`（`session/reset` + `scope` 标记）、`use-chat-store.ts`（`scope` 参数 + 按会话判装载阶段）

测试（6 个）：`ChatView.test.tsx`（+2 跨会话）、`use-session-scope.test.tsx`(新 7)、`chat-machine.session-scope.test.tsx`(新 3)、`use-chat-voice.test.tsx`(+1)、`use-chat-attachments.test.tsx`(+1)、`runtime/chat/store.test.ts`(+1)。

文档与闸门：`docs/perf-p4-report.md`(新)、`docs/perf-next-session.md`、`docs/perf-report.md` §7/§9.5、`../../tools/budget.json`（5 个键上调，均带中文 reason）。

## 7. 开工提示语（新会话第一句直接粘）

> 接 dsh-palm 移动端性能下一轮：先读 `docs/perf-next-session.md` 与 `docs/perf-p4-report.md` §6（剩余项与存疑），从「行级虚拟化 / 增量 DOM」和「`session-store` 的 turn 水位」里选一个做。仓库 `C:\Users\Administrator\dsh-source\dsh-palm`，包目录 `packages/dsh-palm`，分支 `refactor/v2`。
