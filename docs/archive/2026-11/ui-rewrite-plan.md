# 整个移动端 UI 重写方案（UI 层 = 一个大组件）

> 目标：把 `/m/` 的全部界面重写成**一个组件树**——一个入口、一套契约、九个纯展示屏。
> 基线：9 个视图 10,309 行、外壳 `views/App.tsx` 1,259 行、`views/chat/` 62 模块、
> 42 个 CSS 文件 / 876 个类名、token 已有、2,666 条测试、视觉门禁与 S0 指纹可复用。

---

## 一、"一个大组件"到底指什么（先定义，否则会写成一个大文件）

**指一个组合边界，不是一个文件。** 三条规则：

| 规则 | 含义 | 反例（现状） |
|---|---|---|
| **一个入口** | 全站只有 `<PalmUI model actions />` 被挂载；页面切换在它内部完成 | 现在 `App` → `PairedApp` → 各页面，数据各自取 |
| **一个契约** | 所有界面需要的数据在一次 `AppModel` 里算好；视图不许自己发请求 | 现在 9 个页面各自 `useChatXxx()` / 各自 `fetch` |
| **一种改法** | 界面只能通过 `actions` 改状态（命令式），不能拿到 setter | 现在 45 个钩子互相能写 |

一句话：**数据从上往下流一次，命令从下往上走一次。**

---

## 二、目标结构

```
ui/
├── PalmUI.tsx                  ≤120 行  唯一入口：<PalmUI model actions />
├── model/
│   ├── app-model.ts            ≤300     AppModel 类型（唯一契约）
│   ├── use-app-model.ts        ≤400     把 9 屏要的数据算成一个对象
│   └── router.ts               ≤200     路由表（从 App.tsx 的 Route/ROUTE_DEPTH 迁来）
├── actions/
│   ├── index.ts                ≤200     动作集合（navigate/back/send/stop/...）
│   └── *.ts                    ≤250     每个域一个文件：session / chat / settings / market
├── screens/                    ← 9 个纯展示屏（禁止 import api/store）
│   ├── WorkspacesScreen.tsx
│   ├── SessionsScreen.tsx
│   ├── ChatScreen.tsx          （= 现在 ChatView，按 rewrite-plan 拆）
│   ├── RunOverviewScreen.tsx
│   ├── SettingsScreen.tsx
│   ├── MarketScreen.tsx
│   ├── SubChatScreen.tsx
│   └── …
└── design/                     ← 设计系统（12 个组件 + 语义 token），先于屏幕落地
```

**行数预算**：入口 120 + model 900 + actions 800 + 9 屏 ≈ 3,500 + 设计系统 ≈ 1,200 → **合计约 6,500 行**，替换掉现在 10,309 + 1,259 = **11,568 行**。

---

## 三、契约（唯一需要评审的东西）

```ts
// model/app-model.ts —— 视图能看到的全部数据，别的一律不给
export interface AppModel {
  route: Route
  connection: 'online' | 'offline' | 'pairing'
  workspaces: readonly WorkspaceRow[]
  sessions: readonly SessionRow[]
  chat: ChatModel          // 只包含 ChatScreen 需要的（见 chatview-rewrite-plan）
  settings: SettingsModel
  toasts: readonly Toast[]
}

// actions/index.ts —— 视图能触发的全部变化
export interface AppActions {
  navigate(route: Route): void
  back(): void
  reload(): void
  chat: ChatActions
  settings: SettingsActions
}
```

**两条硬约束（写成断言）**：

1. `screens/**` 不许 import `../api.ts`、`../session-store.ts`、`../../host/**`
2. `screens/**` 不许出现 `useEffect`（副作用全在 model/actions 里）

---

## 四、迁移策略：并行运行，逐屏切换（不搞大爆炸）

一次性重写 9 屏、中途不能上线，是这类项目最常见的死法。采用**绞杀式**：

```
阶段 0  新旧并存：PalmUI 挂载；每个路由加开关 USE_NEW_UI[route]
阶段 1  新屏做一个，开关打开一个；老代码原样保留
阶段 2  9 屏全绿后，删老路径
```

**关键**：任何时刻只有一条路径在跑，出问题把开关关掉即可回滚，不需要 revert 代码。

---

## 五、里程碑（每步都能独立验收）

| 步 | 内容 | 完成标志 | 工时 |
|---|---|---|---|
| **U0** | 抽 `Router` + `AppModel` 骨架，老页面挂到新壳下（**外观零变化**） | 2,666 测试全绿 + 视觉门禁通过 | 2 天 |
| **U1** | 设计系统 D0–D2（语义 token + 4 个基础组件 + 3 条断言） | 组件有 story 页，断言进 `architecture.test.ts` | 2 天 |
| **U2** | 迁 **SettingsScreen**（783 行，风险最低） | 新屏开关生效，与旧屏截图逐像素对比 | 2 天 |
| **U3** | 迁 **SessionsScreen + WorkspacesScreen**（列表类，2,187 行） | 同上 | 3 天 |
| **U4** | 迁 **ChatScreen**（4,138 行，按 chatview-rewrite-plan 的 R0–R5） | 244 条用例 + S0 指纹不改一行 | 5 天 |
| **U5** | 迁 **RunOverview / Market / SubChat**（1,398 行） | 同上 | 3 天 |
| **U6** | 删旧路径 + 加 5 条最终断言 + 文档收口 | 行数预算更新，`ui/` 总量 ≤ 6,500 | 1 天 |

**合计 18 天**（单人）。**U0 是试金石**：如果 2 天做不完，说明数据流耦合比估计更深，应停下重估而不是硬推。

---

## 六、风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| 新壳与旧屏行为不一致（滚动/键盘/返回手势） | **高** | U0 就建立「同一路由双跑」的截图对比；手机端手测 6 个动作 |
| `AppModel` 变大变慢（一次算 9 屏数据） | 中 | 按路由切片：`modelFor(route)` 只算当前屏需要的 |
| 迁移中途需求插入，两边都要改 | 中 | 开关机制下，新需求只加在旧屏；新屏迁移时一并带入 |
| "大组件"退化成大文件 | 中 | 入口 ≤120 行 + 两条断言（screens 不许 import 数据/不许 useEffect） |
| 18 天估时偏乐观 | 高 | U0/U2 是两级试金石；任一超时 50% 即重估 |

---

## 七、验收标准（可执行）

1. 全站只有一处挂载：`<PalmUI model actions />`
2. `screens/**` 零 `api` import、零 `useEffect`（断言）
3. 9 屏行数合计 ≤3,800；`ui/` 合计 ≤6,500
4. 现有 2,666 条测试**不改一行**全绿；S0 指纹不变
5. 真机 6 动作无回归：进会话 / 发送 / 停止 / 翻历史 / 搜索定位 / 断网重连
6. 文档：`design-system.md` + `chatview-rewrite-plan.md` + 本文件三方一致

---

## 八、不做的代价

| 选择 | 结果 |
|---|---|
| 不重写 | 9 屏各自取数、45 个钩子互写；新功能继续堆，两年后回到 15,000 行 |
| **重写** | 18 天单人，换来一个能在一屏里读完的入口 + 一份可测的契约 |

**建议**：先做 **U0 + U1（4 天）**。这 4 天能回答最关键的问题——"新壳能不能装下旧屏且外观零变化"。
答案是"能"，再投剩下 14 天；答案是"不能"，损失可控。
