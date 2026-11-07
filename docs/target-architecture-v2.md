# 目标架构 v2（吸收评审的三处修正）

> v1（`d80f994`）的诊断成立，但规则文本有三处会"落地第二天破防"。本版只改这三处 + 指标口径，
> 骨架不动。**改动处标 ⟳。**

---

## 0. 先回答四个决定成败的问题（现状实测）

| 问题 | 现状 | 证据 |
|---|---|---|
| **model 切片谁算？** | **没人算。** 每屏自己取数 | 质量预算 `viewDataImports ≤ 20` 已满额：`views/` 下 20 个文件直接 import `api.ts`/`mux.ts` |
| **订阅挂谁身上？** | 挂在视图的 hook / effect 里 | `ChatView` 仍 20 个 `useEffect`，`useChatStream` 等 45 个 hook 都在视图层 |
| **14 条断言是文本扫描还是模块图？** | **文本正则** | `architecture.test.ts` 用 `readFileSync` + 正则，注释要先剥掉再扫 |
| **跑 CI 还是本地？** | 本地脚本（`tools/health-check.mjs`），无 CI 钩子 | 所以反馈环 = 一次手动运行 |

**这四条决定了 v2 的优先级**：文本断言必须升级成模块图，否则"只经 types 通信"会被 `export *` 一键绕过。

---

## 1. ⟳ 旁路分两档（修硬伤一）

v1 把 `render/`（纯计算）和 `platform/`（I/O）写成同一档，规则自相矛盾。

| 档 | 包含 | 谁能引用 | 判据 |
|---|---|---|---|
| **无状态旁路** | `render/`（折叠模型 / markdown / diff / 行渲染）、`session/` 的纯投影函数 | **③ 组件层、④ 内核层都可以引用** | 文件内零 `fetch` / 零 `localStorage` / 零 `addEventListener` / 零 `Date.now` |
| **I/O 旁路** | `platform/`、`stream/`、`api/` | **只到 ② 屏幕层，且只经注入口** | 屏幕层拿到的是注入的实例，不许 import 具体实现 |

**一句话规则**：*纯函数可以下沉复用，副作用只能上提到注入口。*

配套断言（新增 2 条）：
- `components/`、`ui/` 允许 import `render/`、`session/`，但**不许** import `platform/`、`stream/`、`api/`
- `render/`、`session/` 内出现浏览器全局或 `fetch` → 直接红

---

## 2. ⟳ 订阅与 actions 的落点（修硬伤二）

v1 说"零 useEffect + app 组装 model"，但没写订阅挂谁、actions 怎么下去；400 行预算装不下。

### 2.1 `app/host-bridge`（独立预算，算旁路不算外壳）

```
app/shell.tsx        ≤400   路由表 + 组合
app/host-bridge/     ≤600   ← 新增，单独占额度
  ├─ subscribe.ts            useSyncExternalStore：把 host 事件投影成 model 切片
  ├─ store.ts                外部可订阅的 store（不是状态库，约 80 行）
  └─ actions.ts              actions 的唯一实现（命令式，无 React 依赖）
```

**这确实是自研了一个 mini 状态层**——不装包，但必须给位置、给预算、给名字。否则它会悄悄长在 shell 里。

### 2.2 actions 的下发契约

- **定义在 ①**，类型放 `types/actions.ts`（复用规则 4 的 types 通道）
- **只经 props / context 单向下发**；`components/` 只接**回调类型**，不接实现
- 禁止 `components/` 自己 import `actions.ts` 的实现（断言守）

### 2.3 零 effect 的降级出口

`ChatView` 4,138 → 2,500 且零 effect 是全案最大单点。**允许一个受控订阅 hook 留在 `app/host-bridge`**，
不为"零 effect"硬拆；屏幕层仍保持零 effect（它是消费方，不是订阅方）。

---

## 3. ⟳ 接口前置（修硬伤三）

v1 把接口抽取放在 P2 之后，会导致"刚迁完的 9 屏回头改一遍"。

| 期 | 内容 | 工期 |
|---|---|---|
| **P0 护栏** | 3 条新断言 + 2 处时间注入 | 0.5 天 |
| **P3-lite 接口先行** | 只定义 `storage` / `notify` / `mux` 的接口 + 假实现，**不动实现体** | 0.5 天 |
| **P1 设计系统** | 语义 token + 4 组件 + `@layer` + 3 条治理断言 | 2 天 |
| **P2a 外壳 + 三屏** | `shell` ≤400 + `host-bridge` + 迁 Settings / 会话列表 / 工作区 | 2 天 |
| **P2b ChatView** | 单独 2 天，带降级出口 | 2 天 |
| **P3 实现替换** | 假实现进测试，核心流程不再 mock `fetch` | 1.5 天 |
| **P5 服务端** | `mobile-api` 按域拆 | 3 天 |
| **P4 渲染优化** | memo 分层（仍最后） | 2 天 |

**合计 ≈ 13.5 天**，总量不变，只是把接口定义提前了。

---

## 4. ⟳ 预算口径（防层间平移刷指标）

v1 的"9 屏 ≤7k"是倒推的。v2 改成两条：

| 指标 | 口径 |
|---|---|
| **每屏目标行数** | 逐屏写死（区间亦可），迁一屏降一屏 |
| **全仓总行数预算** | `src/mobile/**` 总量只降不升；**防"从 features 挪进 components"式的假达标** |

各屏初值（现状 → 目标）：

| 屏幕 | 现状 | 目标 |
|---|---|---|
| ChatView | 4,138 | ≤2,500 |
| App（外壳） | 1,259 | ≤400（+ host-bridge ≤600） |
| SessionListView | 1,124 | ≤900 |
| WorkspaceView | 1,063 | ≤850 |
| RunOverviewView | 981 | ≤800 |
| SettingsView | 783 | ≤600 |
| SettingsForm | 544 | ≤450 |
| MarketView | 240 | ≤240 |
| SubChatView | 177 | ≤177 |

---

## 5. ⟳ 三个会自欺的地方（已修）

| 问题 | 修法 |
|---|---|
| `Sheet` 同时出现在 ③ 与 ④ | 定死：**④ = 机制件**（`overlay` / `focus-trap` / `portal` / 手势），**③ = 产品件**（`InputSheet` / `CommandSheet` / `FileSheet`）。同名不同物一律换名 |
| `@layer` 是隐性炸弹 | ① 声明顺序写进断言（禁止后人乱插层）；② 完成标志补"9 屏分层前后截屏 diff"；③ 时间从 2 天放宽到 2.5 天 |
| P4 完成标志主次反了 | 主位改成 **p95 帧耗时 / Long Task 数 / 重渲染次数**（有前后对比数据）；S0 指纹 diff 降为**回归项** |

---

## 6. ⟳ 断言体系升级（不换工具，但换实现方式）

v1 默认断言用文本正则——**有五个已知盲区**：动态 `import()`、`export *` 透传、别名路径、`import type` 误报、字符串拼路径。

v2 的做法：

| 项 | 做法 |
|---|---|
| 实现方式 | 用 **TypeScript Compiler API** 解析成模块图再判，不按文本正则 |
| 新增白名单断言 | `features/` 里禁止浏览器全局（`document.querySelector` / `localStorage` / `window.addEventListener`） |
| 豁免登记 | 每条豁免写 **owner + 到期日**，零豁免为佳；"加 `arch-ignore` 就绿"的口子关掉 |
| 反馈环 | 挂 **pre-commit 或 watch**，不只靠手动跑 health-check（P2 三天迁 9 屏，反馈环太长违规会攒着爆） |
| 反向验收 | 新断言除了"故意违规必红"，还要"**现有代码全绿且零豁免**"——防误报催生豁免文化 |

---

## 7. 不变的骨架（v1 已对，本版未动）

- 五环依赖只向内；屏幕层零数据访问、零 effect
- 样式零运行时、只许构建期拼接
- 行数预算只降不升
- 不做的清单 + 可观测重估条件
- P4 放最后
