# 移动端架构（现状）

> 这份文档描述**现在代码长什么样**，用来回答"改一个东西该动哪、什么会被门禁拦"。
> 历史方案稿（v3.2 四处订正、L2 组件层计划）已归档到 [archive/2026-11](archive/2026-11/)，
> 那两份**没有实施**（`features/`、`PButton`、`p-` 前缀在代码里都不存在），别按它们理解现状。

## 一、目录与职责（20 个）

| 目录 | 管什么 | 不许做什么 |
|---|---|---|
| `views/` | 页面：props → DOM | 取数、算派生、碰网络 |
| `components/` | 可复用组件：dialog / sheets / toast / icons / queue-dock / goal-bar / 灯箱 / 文件预览 / 工具详情 / 回合擦除 / 会话 HUD | 直接 import `api.ts` |
| `ui/` | 浮层与交互 hook：抽屉、焦点陷阱、窗口化、交付噪声判据 | 写业务规则 |
| `message-row/` | 一轮消息的结构化渲染：过程组、交付卡、轮次锚点、思考块 | 取数 |
| `render/` | 渲染原语：markdown、代码高亮、差异、消息行 | 取数 |
| `projections/` | 宿主投影 → 界面形状（消息正文、会话视图） | 发请求 |
| `data/` | 取数与缓存门面，按域分：session / workspace / settings / notify / fs / voice / usage / diag | 直接解帧 |
| `api/` | 手机端 RPC 方法白名单与调用 | 页面布局 |
| `stream/` | SSE mux、帧分发、会话状态机、前台与可见性 | 渲染 |
| `runtime/` | 运行态镜像：谁在跑、第几步、跑多久 | DOM |
| `session/` | 会话缓存：历史分页、交付账本、已答项、置顶 | 渲染 |
| `history/` | 滚动锚点与历史窗口 | 网络 |
| `kernels/` | 纯逻辑单元：帧切片、身份合并、缓存策略 | React / DOM |
| `platform/` | 运行时能力：rpc、perf、skin、pwa、offline、wallpaper | 页面结构 |
| `design/` | 设计令牌（明暗两套调色板 + 字阶/圆角/间距） | 组件实现 |
| `styles/` | CSS 真源，按序号拼接成 `mobile-styles.ts` | JS |
| `layouts/` | 9 个核心屏的默认布局契约 | 取数 |
| `dev/` | 调试工具 | 生产路径 |
| `shared/` | 前后端共用纯函数（错误文案、时间、剥离工具块） | 依赖任一侧 |
| `api-proxy-*` | 宿主侧 `/api` 代理与工作区发现 | 手机端逻辑 |

## 二、数据流

```
宿主 SSE ──→ stream/mux ──→ 帧 ──→ runtime 镜像 + session 状态
                                      │
                              data 门面（按域缓存）
                                      │
                                  views 渲染

写操作：views → data/impl → RPC → 宿主 → 帧回来（读己之写）
```

判断一段代码该放哪：**变成 DOM** → `views`；**判"这一行归哪一轮"这类规则** → `kernels` 纯函数；**调 RPC 并缓存** → `data/impl/<域>.ts`；**解帧** → `stream`。

## 三、五个关键机制（2.0 定型）

| 机制 | 在哪 | 一句话 |
|---|---|---|
| **首屏一次成型** | `data/impl/session.ts`（`entryLoads` 闸门） | 同会话的行、目标、队列、回合、投影在同一次快照里到达，不再"先出壳再长" |
| **消息虚拟窗口** | `views/chat/hooks/use-row-window.ts` | 只把最近一屏挂进 DOM，往上滑再补；窗口 `[anchor-6, anchor+24]`，上下用等高占位撑住 |
| **抽屉窗口化** | `ui/use-drawer-window.ts` | 首屏画 20 行，滑到近底每次补 20；滑入期 `content-visibility: hidden` |
| **队列版本栅栏** | `stream/session-store.ts` | 陈旧快照不能复活已删的排队消息；`applyQueueAck` 被栅栏拒绝时不写快照 |
| **皮肤层** | `styles/6XX-*.css` + `platform/skin.ts` + `assets/skins/` | `html[data-skin]` 切令牌 + 装饰层，素材按套存放（manifest 驱动） |

## 四、门禁

| 门禁 | 拦什么 |
|---|---|
| `pnpm typecheck` | 类型（含测试文件） |
| `pnpm build` | 打包；`.test.ts` 的类型错只有这步能发现 |
| `pnpm test` | 4,100+ 用例 + 架构断言、质量预算、缓存采纳 |
| 架构断言 | `platform/architecture.test.ts`：依赖方向、新环、行数预算、单一实现 |
| 行数/样式预算 | `tools/check-budget.mjs`（**只降不升**；上调须写 reason + expires） |
| 视觉门禁 | `tools/mobile-visual/run.mjs`（需预览服务器） |

**顺序必须串行**：`typecheck → build → test`。build 与 test 并发时，测试读 chunk 清单会撞上构建的 clean 步骤。

## 五、四条不变量

1. `views/` 不取数、不算派生——派生进 `kernels/` 纯函数。
2. `data/` 门面按名字转出，**不许 `export *`**（依赖不可追）。
3. 皮肤只改令牌与装饰层，**不动结构**；新增一套 = 一个 `6XX-skin-*.css` + `assets/skins/<id>/` + `skin-catalog.ts` 一条。
4. 行数预算只降不升；上调必须在 `tools/budget.json` 的 `dirsRaised` 写清原因与到期日。
