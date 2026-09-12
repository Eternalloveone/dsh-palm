# dsh-palm 端到端性能测试完整方案

> 目标：把「模型吐 token → 手机屏幕上可见」整条链做成**可重复测量、分层可归因、可回归**的体系。
> 现状盘点：T1 确定性管线基准已有雏形（perf-e2e/settle-split/net-probe，见本目录 README）；
> 浏览器合成（T2）与真机（T3）两段从未闭环；应用内无性能插桩；jsdom 无 paint、本机沙箱无 headless Chrome。

## 1. 指标口径（全部一次定义，避免歧义）

| 指标 | 定义 | 层级归因 |
|---|---|---|
| TTFT（发送→首字可见） | `t(首帧含新文本的 paint) - t(用户点发送)`，纯客户端钟 | 模型+网络+首帧渲染 |
| 事件到达节拍 | 客户端相邻 `session/event` 到达间隔（含 seq 跳变检测） | 传输 + 宿主写盘节拍 |
| 流式绝对延迟 | `t(客户端收帧) - (event.time + 时钟偏移估计)`；偏移用首 N 样本线性回归估 | 宿主→手机单程 |
| 事件→paint | `t(paint 后) - t(handleMessage 收帧)`；paint 用 rAF/提交后标记近似 | 客户端管线 + 浏览器 |
| 解码管线 | parse+zod → fold → coalesce → 提交 分段 mark | 客户端 JS（T1 已能量化） |
| 长任务 | PerformanceObserver longtask 次数/总时长/最长 | 浏览器主线程 |
| 掉帧估计 | rAF 间隔相对 16.7ms 的倍数（≥50ms 记 1 帧损失） | 浏览器 |
| SSE 丢失/补页 | seq 缺口数 + mux poll-refill 触发次数（ChatView 已有日志） | 隧道/传输 |
| 启动 | navigation → 首帧可交互（load + bundle decode + 首 Render） | bundle 体积 |
| 内存 | 长会话 RSS / performance.memory 采样 | 泄漏回归 |

## 2. 延迟漏斗与测点（哪一层在哪埋）

```
宿主事件(event.time,seq) → dsh-palm 转发(mobile-api:2334) → SSE → MuxClient.handleMessage
  ▲E0 宿主时钟          ▲E0b 可选注入转发ts    ▲E1 recv mark(mux.ts:476 入口)
→ JSON.parse+zod×2 → folder.fold+coalesce → setMessages → React 提交 → paint
   ▲E2 管线 mark         ▲E3 提交 mark(useLayoutEffect)   ▲E4 rAF/longtask
```
- E1 埋点：`mux.ts handleMessage` 首行 `perf.recv(frame)`；E2 在 zod 后/折叠后打点；
  E3 在 ChatView 跟随 effect（已有 key 守卫）按 last.seq 记 commit 时长与完成时刻；
  E4 用 PerformanceObserver + rAF 采样器，不做真实 paint 探测（够了）。
- E0：事件自带 host `event.time` + `seq`（已存在），E2E 绝对延迟靠**时钟偏移估计**：
  收集 N 个 (clientRecv − event.time)，其趋势即双端时钟速率差，偏移取中位后
  `latency ≈ clientRecv − (event.time + offset)`；TTFT 类指标始终用纯客户端钟，不依赖偏移。

## 3. 插桩设计（`mobile/perf.ts`，默认关闭）

- 开关：`localStorage dsh.palm.perf=1` 或 URL `?perf=1`；关闭时所有函数为 no-op，
  不注册任何 Observer，理论零开销。
- 数据：环形缓冲最近 ~2000 条事件级记录 `{seq,type,recv,decodeEnd,commitEnd,turn?}`；
  longtask / 掉帧 / seq 缺口 / poll-refill 计数器；每会话头尾快照。
- 导出：`window.__dshPalmPerf.toJSON()` + `toCSV()`；每 30s 自动存一份到 localStorage
  （`dsh.palm.perfLog.<ts>`，上限几条，供掉线后回捞）。
- 结构回归仍走单测（如 code-block 渐进提交断言），时序数字**不进 vitest 断言**（防 flaky）。

## 4. 三层测试

### T1 · 确定性 Lab（Node/jsdom，纯 JS 下界；本机 30s 内）
- 载体：`perf/run-t1.mjs`——把基准 spec 生成到仓库临时文件 →
  `vitest run` → 解析 `perf-e2e-report.json` → 删除临时文件（仓库零污染）。
- 场景语料：`perf/scenarios/*.jsonl`（WireEvent 流，含从真实会话录制的回合），
  供 T1 回放与 T2/T3 对照使用同一"剧本"。
- 输出：现有三个报告字段（typical/stress/settle-split）+ 语料名 + 环境元信息（bundle sha）。

### T2 · 浏览器合成 Lab（真实引擎 + 网络/CPU 节流）
- 前提：需要一个能跑 Chrome 的环境。本机 pwsh 沙箱 headless Chrome 崩溃（已知），
  MCP screenshot 走独立进程可用但只截图不插桩 → **T2 在用户侧跑**（用户 PC 或手机），
  由 agent 提供脚本、解析用户回传的 JSON。
- 脚本 `perf/t2-browser.mjs`（Playwright/CDP）：
  1. 可选 cookie 模式：用户一次从已配对手机 DevTools 导出配对 cookie 到本地文件（用户自持），
     之后 Chrome 以该 cookie 打开 `/m` 即有配对会话（也可纯手工先配对再跑）。
  2. 打开会话 → 注入 `dsh.palm.perf=1` → 发起一轮标准 prompt（脚本语料）→ 等 turn/end。
  3. CDP 节流预设：无节流 / Slow 3G / 4× CPU（可组合）。
  4. 采样：navigation timing、perf marks、longtask、掉帧、内存；输出 `t2-<env>.json`。
- 选做：Lighthouse mobile 预算（首屏 4s、LCP 等），同一份 profile 跑。

### T3 · 真机矩阵（ground truth）
- 设备/网络矩阵：Android + iOS ×（LAN / 远程 tailnet 隧道）；弱网可选（Android DevTools throttle）。
- 自动化（Android）：`adb forward tcp:9222 localabstract:chrome_devtools_remote` → node CDP
  驱动已配对页面，跑与 T2 相同的脚本/语料；iOS 走 runbook 手工 + 一键导出。
- 手工兜底（两平台通用）：开 perf 开关 → 跑一轮长回合 → `window.__dshPalmPerf.toJSON()`
  复制回填；agent 解析并入基线表。真机长任务/收尾帧/滚动逐字体验以此为准。
- 录制器：T2/T3 跑真实回合时同时落 `scenarios/<name>.jsonl`，回灌 T1 与后续回归。

## 5. 报告与回归

- 每次运行产出版本化 JSON；`perf/report.mjs` 合并多轮 → p50/p95/max 表 +
  与 `perf/baselines/<env>.json` 对比 → 每指标 warn/block 阈值（首轮试点后定，
  **不作为 CI 硬门禁**——CI 只跑单测结构回归）。
- 环境键：`<device>_<net>_<throttle>_<bundle-sha 前 8>`，杜绝跨环境误比。
- release 前 checklist 增加可选 perf smoke（T1 必跑，T2/T3 视发布范围）。

## 6. 里程碑

| M | 内容 | 依赖 | 位置 |
|---|---|---|---|
| M0 | perf.ts 插桩（默认关）+ 导出 API + T1 run-t1.mjs 固化 + 场景录制器 | 用户批准插桩进仓库 | agent 可全做 |
| M1 | T2 浏览器 lab 脚本 + cookie 模式 + 节流预设 + 报告解析 | Chrome 可用环境（用户侧） | agent 写脚本，用户跑 |
| M2 | T3 runbook/ADB 脚本 + 双端矩阵首采 + 回填工具 | 用户真机 | agent 写脚本，用户跑 |
| M3 | 基线定版 + 阈值 + report.mjs 趋势 + release checklist 接入 | M0-M2 数据 | agent |

## 7. 已知限制与决策点

- 时钟：流式绝对延迟用偏移估计近似；纯客户端指标（TTFT/节拍/掉帧）不受影响。
- jsdom 无 paint：T1 是 JS 下界，浏览器数字以 T2/T3 为准。
- 本机沙箱不能跑 Chrome：T2/T3 天然需要用户侧执行，脚本化把人工降到"一条命令 + 回传文件"。
- 插桩代码进仓库需你拍板（默认关、风险低）；配对 cookie 文件由你自持、不进仓库。
- perf 基线入库（`perf/baselines/`），报告与仓库一同版本化。

## 8. 立即可以做的第一步（M0 范围）

1. `src/mobile/perf.ts`（no-op 门控 + 计数 + 导出 + longtask/rAF/loss 采样）；
2. 在 mux/ChatView 5 个锚点接入（见第 2 节）；
3. `perf/run-t1.mjs` 把现有基准固化成一条命令 + `perf/scenarios/` 语料目录；
4. T3 手工跑一轮，回填首个真机基线（验证插桩对端到端数字可用）。
