# dsh-palm 端到端性能测试报告

- 日期：2026-09-07｜范围：手机端 dsh（/m 移动面）+ 桌面端 dsh（/ 桌面 GUI）
- 方法：三层体系（T1 确定性管线基准 / T2 浏览器合成 / T3 真机）——本报告交付 **T1 全量闭环 + 双端传输实测 + 网络拓扑梳理 + 优化前后对比**；
  T2/T3 需要浏览器/真机环境，脚本与回填步骤就绪（见 §7）。
- 相关文件：`perf/`（`perf-t1-report.json`、`dual-probe.json`、`perf-e2e-report.json`(优化前)、`settle-split.json`、`run-t1.mjs`、`probe-dual.mjs`、`report.mjs`、`net-probe.mjs`、`README.md`、`e2e-perf-plan.md`）

## 1. 摘要

- 手机端客户端管线（SSE 文本→React 提交）单事件 **p95 ≈ 0.78ms**，估算 event→paint p95 ≈ **17.5ms（约 1 帧）**——远低于 32ms（2 帧）目标。
- 30k 单段落极限流式**无 O(n²) 退化**（首/末 1/3 成本 0.47→0.43ms，增长 0.92x）；60 行历史下 memo 隔离有效（提交成本与 3 行持平量级）。
- 收尾帧"尖峰"经归因为 **jsdom DOM 构建假象**：纯 JS 仅 ~0.08ms（解析）+ ~0.004ms（150 行高亮），浏览器真实成本需 T2/T3。
- 优化落地 3 项（§6）：>1000 行代码渐进分块高亮、attach 图片压缩让帧、opt-in 端到端插桩 `perf.ts`（+5 单测）。全量 **929 测试通过、typecheck 0**。
- 双端传输：手机面单包 1.13MB（loopback p50 14.9ms）；桌面面 6 资源共 1.62MB（最大 vendor 745KB p50 8.3ms）。

## 2. 方法学

延迟漏斗五段：E0 宿主事件（自带 host time+seq）→ E1 SSE 收帧 → E2 解码管线（zod+fold+coalesce）→ E3 React 提交 → E4 paint。
本机可测 E0–E3（node/jsdom，真实生产模块）；E4 与真实网络/设备只能量化到 loopback，浏览器/远端数值属 T2/T3。
插桩 `packages/dsh-palm/src/mobile/perf.ts`：默认关闭（`localStorage dsh.palm.perf=1` 或 `?perf=1`），锚点 = mux 收帧(recv)、ChatView 状态(state)、提交(commit)，导出 `window.__dshPalmPerf`，附带 seq 缺口/掉帧采样。

## 3. 网络拓扑梳理

```
手机（PWA/浏览器）
  │  SSE: /m/api/events.mux（单连接长流，事件随到随写）  RPC: /m/api/events.*
  │  HTTP/静态: /m/mobile.js?v=<rev>（配对 cookie 门禁）
  ▼
[隧道]（局域网直连 或 远端 tailnet 隧道）           ← 真实远程场景的主要时延来源
  ▼
DSH host 本机（127.0.0.1:3080）
  ├─ dsh-palm 插件 mobile-routes（/m 静态面 + gate）
  ├─ dsh-palm 转发层（apiProxy.events.mux → 信封化 SSE，mobile-api.ts:2334）
  └─ DSH host core（会话/任务/审批/事件总线）→ 模型 provider（LLM，时延主导项）

桌面端 dsh（浏览器 GUI）
  ▼  /  + /assets/*（6 资源） + /api/events.mux  ← 同 host，独立通道
```

实测 hop（loopback 本机直连，2026-09-07）：

| hop | 值 |
|---|---|
| /m/ HTML 725B | 首字节 37.3ms（含宿主调度；多次采样 min≈1.1ms） |
| /m/mobile.js 1.13MB | p50 14.9ms / p95 27.2ms（本地 ~76MB/s 吞吐底） |
| 桌面 / HTML 18.8KB | 9.1ms |
| 桌面 vendor.js 745KB | p50 8.3ms / p95 15.8ms |
| SSE /m/api/events.mux（未配对） | 403 @7.0ms（门禁即时拒绝 → 配对路径之外的传输开销可忽略） |
| SSE /api/events.mux（桌面未带升级头） | 426 @17.0ms |

**时延预算结论**：本地直连下传输层 < 20ms；感知延迟主要由 ①模型生成速率（不可控）②远端隧道 RTT 支配；
客户端每事件管线 <1ms 不构成瓶颈；真机远端场景的绝对数值需 T3 回填（§7）。

## 4. 手机端 /m —— 管线实测（优化后，T1）

| 阶段 | avg | p50 | p95 | max |
|---|---|---|---|---|
| parse+zod | 0.043ms | 0.023 | 0.055 | 1.98 |
| folder.fold | 0.016ms | 0.006 | 0.022 | 0.45 |
| coalesce | 0.002ms | 0.001 | 0.002 | 0.096 |
| react-commit | 0.655ms | 0.377 | 0.663 | 20.8 |
| **单事件总计** | **0.717ms** | **0.415** | **0.779** | **23.0** |

- 141 事件典型回合（48 reasoning + 90 text + 工具 + diff 工件 + 收尾）；event→paint p95 估算 17.5ms。
- max 23ms 出现在收尾帧（jsdom DOM 构建为主，浏览器会显著更低）。
- 压力：30k 单段落 255 块 + 60 行历史：首/末 1/3 = 0.467/0.431ms，增长 0.92x → 增量流式设计成立。
- 收尾纯 JS：parseSegments p50 0.078ms；150 行围栏同步高亮 p50 0.004ms。

### 4.1 真机实测（T3 · android-lan，2026-09-12 10:34:42）

抓取文件 `capture-2026-09-12T02-34-42-678Z-android-lan-aggregate.json`（253 B；经 v1.3.5「上报性能数据」→ `mobile.perf` → 宿主写入），基线 `perf/baselines/android-lan.json`。

| 指标 | 实验室 T1（jsdom，纯 JS） | 真机 Android（LAN） |
|---|---|---|
| toState（decode+fold+coalesce+setState） | parse+fold+coalesce p50 合计 ≈0.03ms | p50 **7.1** / p95 13.8 / max 15.2ms（n=116） |
| toCommit（React 提交 + DOM/布局） | p50 0.377 / p95 0.663 | p50 **10.1** / p95 17.8 / max **12527**ms（n=118） |
| 长帧 / 采样帧 | —（jsdom 无帧） | **7 / 5312**（0.13%） |
| 传输异常（seq 缺口/补页/流错误） | — | **0** |
| 采样窗口 | 141 事件 | `marks` 打满 2048（环形缓冲上限）→ 仅覆盖尾部窗口 |

**解读**：批次间隔约 180ms（此前线上测量 5.5 帧/s），而 p50 合计 ≈17ms/批次 → 时间轴占用约 10%，长帧 0.13%、零传输异常 ⇒ **典型路径健康，"处理事件"不是手机端瓶颈**。唯一异常是 toCommit 的 **12.5s 极值**（把 avg 拉到 177ms）：`toCommit` 是同一切片内两个 `performance.now()` 之差，若进程在该切片中被系统挂起（切后台/息屏），恢复后时钟直接跳过，**一个 span 会被撑成挂起时长——真实长任务与挂起产生相同数字**，只能靠原始标记（`toJSON()` 的 per-mark 时间戳与 detail）区分，故 v1.3.5 增加了「上报原始」通道。**v1.4.0 起由插桩直接区分**：`perf.ts` 增加 Long Tasks 观测（`PerformanceObserver('longtask')`）并记录隐藏区间，起始于隐藏窗口内的长任务单独计入 `longTasks.suspended`（不混入 jank 分布），并给出 `suspension.hiddenMs`——真实长任务与「进程挂起」不再需要人工读原始标记。本数据**不足以**决定 §8-4 的 `blur(20px)×3`（需 A/B）。

## 5. 桌面端 dsh —— 传输实测

- 桌面 GUI 首屏资源 6 个共 **1.62MB 原始字节**（vendor 745KB + index 399KB + 插件 client 394KB + CSS 36KB…），HTML 18.8KB；loopback p50 8.3/5.7/3.3ms 量级。
- 桌面端浏览器内的渲染管线/交互延迟需 T2（Chrome/CDP 节流）测——本报告提供方法；脚本见 §7。
- **浏览器启动冒烟（真实 Chrome，本代理已完成）**：通过 MCP 的沙箱外 Chrome 分别加载 `http://127.0.0.1:3080/m/` 与 `/`——
  手机面正常渲染出"设备配对"页（bundle 加载执行无错，因无配对 cookie 停在门口）；桌面面完整渲染主界面
  （工作区列表 + 撰写区 + 模型选择器）。两表面均可在浏览器引擎成功启动，无白屏/致命错误。
- 对比结论：桌面 bundle 总量比手机面大 ~43%（多入口天然），但拆包粒度更细（6 资源 vs 手机 1 个单包）——手机单包拆分为后续优化项（§8）。

## 6. 优化前后效果

| 优化 | 前 | 后 | 证据 |
|---|---|---|---|
| 管线单事件 total p95 | 0.877ms | 0.779ms（-11%，噪声量级内持平） | 旧 spec `perf-e2e-report.json` vs 新 T1 |
| 30k/40k 单段落增长 | 1.36x | 0.92x（不同文本长度，趋势一致：无退化） | 同上 |
| 收尾 max commit（jsdom） | 62.4ms | 20.8ms（含场景差异，主因归因为 DOM 构建） | 同上 |
| **>1000 行代码渐进高亮** | 攒完才一次 setHtml，单长任务 | 逐 chunk 提交 + 每块让帧，头部先行 | 新增单测：render 后首块已出、末块覆盖尾行 |
| **attach 图片压缩** | 多次全尺寸 JPEG 编码单长任务冻结 UI | 逐轮编码 `setTimeout(0)` 让帧 | 行为等价、11 测试通过（浏览器帧收益需真机） |
| **端到端插桩 perf.ts** | 无 | 默认关、5 锚点、窗口导出、缺口/掉帧计数 | +5 单测（no-op/ring/span/anomaly/hook） |
| **折叠态大代码块** | 折叠时照样全量词法高亮（900 行也照高） | 折叠只高亮前 60 行、其余纯文本；展开才全量；分块路径只属展开态 | 单测：折叠态出现 `.code-tail-plain`、展开后 `.shiki` 生效 |
| **会话列表持久化写入** | 每行更新同步写整张 map | 合并为 5s 延迟 flush + `pagehide`/隐藏时 flush | +7 单测（合并/flush/取消/空写不排程） |
| **mux 后台占用** | 后台仍持 SSE 连接 + 轮询 | 隐藏即 pause（关 socket、停表，非终态）、回前台按"疑似静默"重建 | +3 单测 + 突变检验（抽掉 `wasPaused` 即红） |
| **回合计时/静默翻页** | 两个同周期 1s interval | 合并为一个 interval 同时更新 | ChatView 单测 |
| **真机回填通道** | 数据只在页面内存，需远程调试手工抄 | 「上报性能数据」一键 → `mobile.perf` 只写 RPC → 宿主落盘 | +10 单测（形状校验/路径不可左右/保留 20/剪贴板兜底） |
| **插桩补全（v1.4.0）** | 白屏/运行时报错无从知晓；IndexedDB 可被静默清空；长任务与进程挂起同数不可分 | 错误环（`error`/`unhandledrejection`/资源失败，默认开）+ `storage.persist()` + Long Tasks 与隐藏区间剔除，四者并入同一份抓取 | +21 单测（错误折叠/截断/去源、持久化四种结局、长任务标记与环形上限、抓取信封） |

说明：管线 p50/p95 前后为同量级（客户端 JS 本非瓶颈，符合预期）；两处结构性修复的收益体现在**主线程长任务切碎**（真机逐字滚动/合成体验），单测验证结构，浏览器量化留 T2/T3。

## 7. 剩余一项回填（浏览器内数字）与闭环路径

已完成：T1 全量 + 双端传输 + 网络拓扑 + 浏览器**启动/渲染冒烟**（真实 Chrome，见 §5）+ **真机 android-lan 管线抓取**（见 §4.1）。

**闭环路径（v1.3.5 起，无需远程调试）**：真机开 `?perf=1` → 跑一轮 → 设置 → 通用 →「上报性能数据」→ 宿主 `mobile.perf`（只写 RPC）落盘到 `$DSH_HOME/dsh-palm-perf/capture-<时间戳>-<标签>-<kind>.json` → agent 读文件跑 `parse-capture.mjs --label <env> --file <path>` 入基线。失败自动转剪贴板（把数据块发我亦可）。两种形态：「摘要」= `stats()` 聚合（几 KB），「原始」= `toJSON()` 标记环（~200 KB，唯一能定位单个极值 span 的形态，上限 512 KB）。

仍未闭环：

- **隧道那格**（`android-remote`）——本轮是 LAN，`anomalies: 0`；弱网丢帧/补页的证据需在隧道下跑一轮同一提示词；
- **12.5s toCommit 极值的归因**——需「上报原始」的 per-mark 时间戳（v1.3.5 已具备）；v1.4.0 起改由 `longTasks.suspended` + `suspension.hiddenMs` 直接判定（见 §4 解读）。
- **②④ 的收益归属与 `blur(20px)×3` 去留**——需 A/B 抓取（同提示词、开/关各一次，或先加 `?noblur=1` 诊断开关）。

矩阵（ANDROID/iOS × LAN/隧道 + 桌面 Chrome）与每步命令见 `perf/T3-MATRIX.md`；抓取工具见 `perf/baselines/`。

## 8. 后续优化候选（按性价比）

1. **CSS build-time 压缩**（mobile-styles 141KB source，lightningcss 已在 devDeps）——构建期零运行时风险；
2. 手机端单包 1.13MB 拆首屏/重型（参考桌面 6 资源粒度）；
3. ~~折叠态大代码块懒水合~~ —— v1.3.5 已实施（折叠只高亮头部 60 行，展开才全量）；
4. blur(20px)×3 与收尾 DOM：仍待真机 A/B 定夺——本轮 android-lan 长帧仅 0.13%（**没有"它在拖后腿"的证据**），但缺归因；建议先加 `?noblur=1` 诊断开关，再跑同提示词两轮对比；
5. 用「上报原始」定位那笔 12.5s 的 toCommit 极值（区分"真实长任务"与"进程挂起"）。

## 9. 质量与卫生

- 仓库改动 6 改 2 增（perf.ts/test 新增；code-block/image/mux/App/ChatView 修改），工作树未提交；
- 全量 929 测试 / typecheck 0；T1 临时 spec 由 `run-t1.mjs` 自动生成-运行-删除，仓库零污染；
- 性能基线入库（`perf/baselines/`），报告与仓库一同版本化；`perf/` 不在 npm 包白名单内。
