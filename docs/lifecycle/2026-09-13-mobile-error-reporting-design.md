# 手机端错误上报与自救 —— 设计

- 日期：2026-09-13｜版本：待定（提交前需用户定 `v<版本>:`）
- 范围：`packages/dsh-palm`（手机面 `/m`）
- 状态：**设计已确认，尚未实现**
- 相关文件：`src/mobile/errors.ts`、`src/mobile/storage.ts`、`src/mobile/perf.ts`、`src/mobile/index.tsx`、`src/mobile-api.ts`、`src/index.ts`、`src/notify/notify-deliver.ts`

## 0. 目标

手机端**不再出现"白屏了但用户和运维都不知道"**：出错时①页面上能看懂并一键重试，②错误自动落到宿主磁盘，③首次出现时推一条到用户手机。

## 1. 范围

**做**

1. **ErrorBoundary**：React 渲染崩溃不再整棵树卸载成白屏，改为可读错误页 + 重试 / 重新加载。
2. **自动上报 + 宿主落盘 + 首次推送**：错误自动经 RPC 离开设备，宿主校验后落盘，首次见到的指纹推一条（带冷却）。
3. **§8-5 定性**：用已实现的机制跑一轮真机抓取，把 `toCommit` 12.5s 极值定性为"真长任务 / 进程挂起"。**无代码改动。**

**不做**（YAGNI）

- Core Web Vitals（LCP/INP/CLS）——不在本次范围。
- 设置页"错误查看"界面——错误落在宿主，agent 可直接读文件，手机端不需要该 UI。
- 通知渠道代码——复用现有 5 渠道 + Web Push。
- `mobile/storage.ts` 与长任务采集——**已实现**（见 §2），一行不动。

## 2. 现状核实（重要：这三件原先被误判为"缺失"）

| 曾被误判为缺失 | 实际状态 | 位置 |
|---|---|---|
| 前端错误无捕获 | **已实现且 always-on**：`error`（捕获阶段，含资源加载失败）+ `unhandledrejection`；指纹去重 + 重复计数；环形上限 20；只留 basename 帧、≤3 帧、消息折行截断 240 字；**不含完整栈与 origin** | `src/mobile/errors.ts:145-176`、`:79`、`:111` |
| 存储未申请持久化 | **已实现且更克制**：`ensurePersistentStorage()` 在**首次缓存写入成功之后**懒请求；被拒不报错；`persisted()`/`estimate()` 进上报 | `src/mobile/storage.ts:68-82` |
| 无长任务指标 | **已实现含挂起剔除**：`PerformanceObserver('longtask')` + 隐藏窗口记录 + `isSuspended()`，挂起项**故意排除**在卡顿分布外 | `src/mobile/perf.ts:115-193`、`:305-308` |

**教训（写成文字留给后人）**：不要用字面量 grep 的命中数下结论。`storage?.persist()` 匹配不到 `storage\.persist`；一次检索结果被截断曾导致 `PerformanceObserver` 被当成不存在。**下结论前读文件。**

## 3. 设计

### 3.1 组件与改动点

| # | 文件 | 改动 | 预估 |
|---|---|---|---|
| 1 | `src/mobile/error-boundary.tsx`（新） | 类组件；`getDerivedStateFromError` + `componentDidCatch`（后者转调现有 `recordError()`，不新增采集逻辑）；渲染"页面出错了" + 可读原因 + **重试**（重置 state 重挂子树，**不刷新页面**）+ **重新加载**（`location.reload()`） | ~70 行 |
| 2 | `src/mobile/index.tsx:42` + `src/mobile/views/App.tsx:190-195` | 前者把 `<App/>` 包进 `<ErrorBoundary>`；后者在**既有启动效应**里（与 `installErrorCapture()` / `startPerfSampler()` 同处）安装上报器 | 2 处 |
| 3 | `src/mobile/errors.ts` | **仅加接收器钩子**（`onErrorRecord(fn)` + 内部数组）；继续**不联网、不写存储、不起定时器** | ~10 行 |
| 4 | `src/mobile/errors-report.ts`（新） | 订阅接收器 → 去抖 2s 批量 → 调 `mobile.error`；失败静默（内存环保留，手动路径仍在） | ~60 行 |
| 5 | `src/mobile/api.ts` | 新增 `reportError()`，照 `:217` 的 `mobile.perf` 写法 | ~8 行 |
| 6 | `src/mobile-api.ts` | 新方法 `mobile.error`：**严格形状校验**（照 `:1299 validatePerfCapture` 风格）+ 落盘 `$DSH_HOME/dsh-palm-errors/` + 保留最新 20（照 `:1267 PERF_CAPTURE_KEEP`）+ **文件名宿主侧生成并净化**（照 `:1327 writePerfCapture` 的"线上来的东西不能操纵路径"） | ~120 行 |
| 7 | `src/index.ts` | 注入 `errorDir`（照 `:352 perfDir`）+ 把已有 `NotifyStore`（`:281`）接到错误推送策略 | ~15 行 |
| 8 | `src/mobile/mobile-styles.ts` | 错误页样式（沿用现有 CSS 变量，遵守既有 `prefers-reduced-motion` 惯例） | ~40 行 |
| 9 | 测试 | 新增 `src/mobile/error-boundary.test.tsx`、`src/mobile/errors-report.test.ts`、`src/mobile-api.error.test.ts`；扩 `src/mobile/errors.test.ts`（若不存在则一并新增） | — |

### 3.2 数据流

```
手机端任何错误（含渲染崩溃）
  → errors.ts 捕获进内存环                     （现状，不动）
  → 接收器钩子 → errors-report.ts 去抖 2s
  → RPC mobile.error ──▶ 宿主严格校验
                         ├─ 落盘 $DSH_HOME/dsh-palm-errors/<时间>-<指纹>.json
                         └─ 该指纹此前不存在？→ 首次推送（复用 5 渠道 + Web Push）
React 渲染崩溃 → ErrorBoundary 拦截 → 可读错误页 + 重试（不再白屏）
```

### 3.3 推送策略（宿主侧，因为崩溃方可能正是手机端自己）

**指纹** = `sha256(kind + "\n" + message + "\n" + source)` 取前 8 位十六进制；与手机端内存环的去重键（kind + message + source，见 `errors.ts:85-86`）完全一致，使两端"同一条错误"的判断不会分叉。

- **"见过"的判据 = 该指纹的 json 已存在于 `dsh-palm-errors/`**。不引入额外状态文件；裁剪（保留 20）后若该错误再次发生，会重新计为首次并再推一次——这是期望行为（它真的又犯了）。
- **首次才推**：指纹此前不存在 → 推送一次。
- **冷却**：距上次错误推送不足 **60 分钟**则不推（只落盘）。冷却时间戳用**内存变量**（每插件生命周期一个），不引入额外状态文件；宿主重启后最多多推一次，属可接受代价。
- 复用 `deliverL3(config, event)`（`src/notify/notify-deliver.ts:125`）与 `deliverL2(store, event)`（`:141`）；渠道失败不影响落盘。

### 3.4 负载契约（`mobile.error`）

| 字段 | 含义 | 约束 |
|---|---|---|
| `kind` | `error` / `rejection` / `resource` | 必须属于该枚举 |
| `message` | 折行后消息 | 非空，≤240 字（超限**拒绝**） |
| `source` | `file.ext:line:col` | 可选，≤120 字 |
| `frames` | 归约帧 | 可选，**≤3 条**，每条 basename 形状 |
| `count` | 该指纹累计次数 | 正整数 |
| `clientAt` | 客户端 `performance.now()` | 仅参考；宿主另记 `receivedAt`（ISO） |
| `label` | 设备/环境标签 | 复用 perf 上报的同一 label 取法：实现时照 `src/mobile/api.ts:217` 附近 `mobile.perf` 调用处传 `label` 的现有写法 |

**每次调用只带一条记录**（负载为 `{ report, label }`）：突发多条错误就各发一次——环形上限 20 与客户端指纹去重已经把"突发"收敛住了（一个渲染死循环只会得到**一条**记录 + 一个计数）。

**脱敏承诺**：外发内容**就是 `errors.ts` 已保留的最干净形状**——无完整栈、无 origin、无参数文本。本设计把立场从"不外发"改为"**外发但已脱敏 + 宿主严格校验**"。

## 4. 关键决定与理由

1. **推送由宿主发**：手机端崩溃时它自己发不出去。宿主是唯一还活着的一方。
2. **`errors.ts` 保持"无网络/无存储/无定时器"**：网络逻辑独立成模块，用注入的接收器连接，使其现有承诺与测试不受影响。
3. **负载最小化**：只发它本来就保留的字段；校验在宿主侧做，拒绝一切不符合形状的负载（含路径操纵尝试）。

## 5. 测试与验收（家规：每个闸都要有"故意失败"的测试）

| 层 | 测什么 |
|---|---|
| 宿主 intake | 畸形负载**必须被拒**（缺 `kind` / 超 240 字 / 帧数 >3 / 非对象）；**路径操纵无效**（负载里的字符串不能影响落盘路径）；保留 20 条裁剪 |
| 推送策略 | 首次见才推；重复指纹不推；**60 分钟冷却**（冻结时间）；渠道失败不影响落盘 |
| 手机端 | 接收器每新增一条只触发一次；去抖合并；**无错误时零请求**；ErrorBoundary：**故意 throw 渲染错误 → 必须渲染错误页而不是空白**；重试后恢复 |
| 门禁 | `pnpm verify` 8/8（含 typecheck 与覆盖率阈值） |
| 真机 | 临时制造一个错 → 确认**推送到达 + 文件落盘** → 移除临时错误（保留证据） |
| §8-5 | `?perf=1` + 上报原始 → 跑一轮 → 把 `toCommit` 12.5s 定性为"真长任务 / 进程挂起"；无代码改动 |

## 6. 风险与兜底

| 风险 | 兜底 |
|---|---|
| 推送刷屏 | 首次才推 + 60 分钟冷却 |
| 隐私倒退 | 负载即已脱敏形状 + 宿主严格校验 |
| 白屏时上报也失败 | best-effort；内存环保留；手动路径（上报性能数据 / 复制错误）仍在 |
| 干扰发布或生产切换 | **纯新增**；不动任何 `palm` 动词、不动双通道对齐 |

## 7. 非目标与后续

- 本次不做 **Core Web Vitals**（行业通用指标 LCP/INP/CLS）——列为后续。
- 本次不做 **首屏单包拆分**（报告 `perf/PERFORMANCE-REPORT.md` §8-2）——列为后续，单独走一轮设计。
- 本次不碰 `mobile/storage.ts`、`mobile/perf.ts` 的长任务采集。

## 8. 交付与流程

- 本文档**暂不提交**：仓库铁律是"一版一提交 + 提交标题必须是 `v<版本>:`"，版本号待用户确定，且用户已明确"今天不发布"。
- 设计文档经用户复核通过后，再进入实现计划（writing-plans）。

## 9. 实现期发现（复核阶段抓到，已修复）

复核（父代理独立复现门禁 8/8 PASS 之后逐行读码）抓到两个"信号说错话"类的真实缺陷。它们的共同点是：**两个各自正确的模块，被接在一起才错**——`errors.ts`（09-14 的未提交工作）与 `mobile-api.ts` 的错误入口（本次新增）此前从未对接过。

| # | 缺陷 | 后果 | 修复 |
|---|---|---|---|
| 1 | `mobile-api.ts` 拿 `ERROR_REPORT_BYTES_MAX`（64 KB）校验 `message`，而契约是 **≤240 字** | 超长消息被放行，契约被静默放宽 | 新增 `ERROR_MESSAGE_MAX = 240` 校验 message；64 KB 改为校验**整份报告体**（帧串是 basename 形状但无长度上限，所以该闸不是死代码） |
| 2 | `mobile/errors.ts` 把 `event.filename`（浏览器给的是**完整 URL**）直接当 `source` | 宿主 `FRAME_SHAPE`（禁路径分隔符）会**拒绝最常见的那类错误**，而客户端**静默吞掉**发送失败 → 功能看似可用、实际一条都到不了；且违反该模块自己文档里的"basename-only location" | 客户端改用 `frameOf()` 归约为 `mobile.js:12:34`；客户端测试断言同步改为 basename，并新增"记录 JSON 里不得出现 origin" |

**教训（写下来）**：凡"客户端采集 + 宿主校验"的配对，必须有**跨端契约测试**。本轮补上：`mobile-api.error.test.ts` 断言 URL 形式的 `source` **必须被拒**、`mobile.js:12:34` 必须通过；`errors.test.ts` 断言记录里的 `source` 必须是 basename。
