# 对「模块化 monorepo + DDD」方案的评估（dsh-palm 视角）

> 结论先行：**方向对，但这份方案是按「独立 Web 应用」写的，而 dsh-palm 是「DSH 插件」。**
> 五处硬冲突决定了它不能照搬；其中最有价值的三条（特性分层、Shared Kernel、Platform 抽象）
> **我们这个月已经在做了**（A/B 步就是）。真正昂贵的三条（monorepo 拆包、虚拟列表、
> 换状态库）在这个项目里是净负收益。

---

## 一、五处硬冲突（照搬会直接撞墙）

| 方案要求 | 项目现实 | 后果 |
|---|---|---|
| **monorepo 多包** | 发布物是单个 npm 包 `@eternalloveone/dsh-palm`，DSH 插件按一个入口加载 | 拆 5 个包 = 5 套版本/发布/兼容矩阵；用户升级会变复杂 |
| **Vite + Rolldown** | 构建是 **tsdown + lightningcss**，产物要打进 DSH 宿主 | 换构建链 = 重做 chunk 清单、CSS 生成、freshness 测试 |
| **Nano Stores / Zustand** | 现在**没有状态库**（`App.tsx` 开头就写明「no router, no state library」），ChatView 刚把 `useState` 从 30 降到 0 | 换库要重做刚建好的 chat-machine + 14 条架构断言 |
| **虚拟列表（Virtuoso）** | 明确不做虚拟化；滚动行为由自研 `scroll-machine` + 卡片 DOM 探测支撑 | 虚拟化会破坏 S0 行为指纹与滚动锚定 |
| **原子类（Tailwind 式）** | 42 个 CSS 文件 → 构建期拼成 `mobile-styles.ts`，**零运行时** | 引入原子类 = 加一层运行时/构建期依赖，与「零运行时」目标相反 |

---

## 二、逐项评估

| 提案 | 判定 | 难度 | 依据 |
|---|---|---|---|
| 三层结构（Feature / Kernel / Platform） | ✅ **已在做** | 低 | 现状 `platform/ stream/ render/ session/ components/ ui/` 就是这三分 |
| Feature 之间只经 types/events 通信 | 🟡 **改造后采纳** | 中 | 有价值，但用 **ESLint 边界规则 + 现有架构断言**落地即可，不必上事件总线 |
| design-system 独立 | ✅ **大部分已有** | 低 | `design/tokens.ts`（明暗两套）+ `ui/` 内核 + 桌面一致性校验 |
| Platform 抽象（SSE/storage/push） | 🟡 **部分已有** | 中 | `stream/mux.ts`、`platform/storage.ts`、`platform/notify.ts` 已在；差的是**接口化**（可替换实现） |
| 状态层换 Nano Stores | ❌ **不采纳** | 高 | 刚建成 reducer + 断言；换库收益是「少 boilerplate」，代价是全量回归 |
| 虚拟列表 + 分层 memo | ❌ **不采纳（暂）** | 高 | 与不虚拟化决策、滚动锚定、S0 指纹冲突；先做 memo 分层（**这一半可以单独做**） |
| Worker 解析 SSE | ❌ **不采纳** | 高 | 当前 `mobile.js` 仅 80KB，解析不是瓶颈；Worker 会引入跨线程状态同步 |
| 主题用 `[data-theme]` 扩展 | ✅ **可采纳** | 低 | 现在 token 是 TS 生成 CSS，加第三套主题只改 `tokens.ts` 一处 |
| Vite/Rolldown | ❌ **不采纳** | 高 | 见上表 |
| monorepo | ❌ **不采纳** | 高 | 单包发布是产品约束，不是技术债 |

---

## 三、这份方案里真正值得抄的三条

1. **「Feature 不许 import 别的 Feature 内部」写成规则**
   现状靠人自觉。落地方式：一条 ESLint `no-restricted-imports` + 一条架构断言（我们已有 14 条的基础设施）。
   **成本 0.5 天，收益是长期边界不腐化。**

2. **Shared Kernel 的「纯函数、无副作用」是可测的**
   现状 `ui/` 已经有「不许 import 数据层」的断言。可扩展到 `render/`（纯渲染模型）。
   **成本 0.5 天。**

3. **Platform 层接口化**
   把 `mux`/`storage`/`notify` 抽成接口 + 一个默认实现，测试可注入假实现。
   **成本 2 天，收益是测试从「打桩 fetch」变成「换实现」。**

---

## 四、和"我们已经在做的"对照

| 提案阶段 | 我们的对应进度 |
|---|---|
| 1. 提取 design-system（3 天） | ✅ `design/tokens.ts` + `ui/` 内核 + 桌面一致性测试 |
| 2. 按 feature 拆目录（1 周） | ✅ **A 步已完成**（99 文件 → 6 子目录）；`views/chat/` 62 模块分 4 子目录 |
| 3. 状态层迁移（3 天） | ✅ **S1 已完成**（`useState` 30 → 0，reducer 化，有断言） |
| 4. 渲染优化（1 周） | ⬜ 未做（且我们不打算上虚拟化） |
| 5. 平台层抽象（2 天） | 🟡 部分（模块在，接口未抽） |

**即：这份方案的五步里，三步我们已完成，一步不建议做，一步是真缺口。**

---

## 五、工期对比

| 口径 | 估计 |
|---|---|
| 提案自估 | 3–4 周 |
| 该估计的隐含前提 | 绿地项目、可换构建链、可换状态库 |
| **本项目实际** | **不换技术栈的前提下 1 周**（规则 + 接口化 + memo 分层）；**照搬方案 8–10 周且高回归风险** |

---

## 六、建议

**采纳它的「分层思想」，拒绝它的「换技术栈」。** 具体三件事，1 周内可完成：

| # | 做什么 | 工期 |
|---|---|---|
| 1 | 特性边界规则（ESLint + 架构断言） | 0.5 天 |
| 2 | `render/` 纳入「纯函数内核」断言 | 0.5 天 |
| 3 | `mux`/`storage`/`notify` 接口化 + 测试可注入 | 2 天 |
| 4 | 消息行 `React.memo` 分层（**不引入虚拟列表**） | 2 天 |

做完之后，这份方案里除「换技术栈」以外的目标**基本都达成了**。
