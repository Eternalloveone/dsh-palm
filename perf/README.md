# dsh-palm 端到端性能实测（2026-09-07，临时基准）

一次性的端到端性能实测。测量口径：**每条 SSE 消息走完生产代码路径的成本**
（`mux.handleMessage` 等价 JSON.parse+zod×2 → `EventFolder.fold` → `coalesceTurnMessages`
→ 真实 `MessageRow` 列表 React 提交），jsdom 环境、真实生产模块，逐事件计时。
jsdom 无布局/绘制，commit 时长为纯 JS 下界；浏览器真机数字见「真机补测」。

## 结果摘要（机器：本机，jsdom / Node 22）

### 典型回合（142 事件：48 reasoning + 90 text + 工具 + diff artifact + 收尾）
| 阶段 | avg | p50 | p95 | max |
|---|---|---|---|---|
| parse+zod | 0.028ms | 0.023 | 0.053 | 0.137 |
| folder.fold | 0.013ms | 0.006 | 0.026 | 0.266 |
| coalesce | 0.001ms | 0.001 | 0.003 | 0.013 |
| react-commit | 0.93ms | 0.385 | 0.786 | **62.4** |
| **单事件总计** | **0.97ms** | **0.42** | **0.88** | **62.6** |

- 单事件 p95 ≈ 0.9ms → event→paint 估算 p95 ≈ **17.6ms**（≈1 帧，达标）。
- **唯一的尖峰 = 回合收尾那一条 `assistant/message`**（62.6ms）：一次完整 markdown
  解析 + 150 行代码围栏的**同步 shiki 高亮** + diff 工件首挂载。占全部事件成本的大头。
- 结论：每帧常规成本亚毫秒级，不在瓶颈；**收尾帧的同步高亮/解析是唯一可感知 jank**。

### 压力：40k 单段落 339 块流式（60 行历史行参与 memo 比较）
| 段 | avg | p95 |
|---|---|---|
| 前 1/3 | 0.404ms | 0.544 |
| 中 1/3 | 0.395 | 0.414 |
| 后 1/3 | 0.548 | 0.976 |
| 增长 | 1.36× | — |

- 单段落 40k 字符全程增量预览成立（成本几乎平坦，1.36× 增长，无 O(n²) 爆炸），
  61 行与 3 行提交成本相当 → **MessageRow memo 隔离有效**。

### 网络（loopback 127.0.0.1:3080，本机）
- 静态 /m/mobile.js（1.08MB）：p50 14.9ms / max 28ms；/m/ HTML p50 11.1ms、min 1.1ms
  → loopback 底 ≈ 1-3ms，其余为本机宿主调度抖动（1-40ms）。
- `/m/api/events.mux` 直连返回 403 `unpaired`（12.9ms）→ agent 无法绕过配对取真实事件流；
  **宿主→手机的真实事件时延只能真机测**。

## 重跑

```powershell
cd packages/dsh-palm
$env:PERF_E2E='1'; pnpm vitest run src/mobile/perf-e2e.test.tsx
node perf/net-probe.mjs
```

基准 spec 为临时文件（perf-e2e.test.tsx），跑完已从仓库删除；本目录保存
`perf-e2e-report.json` + `net-probe.mjs`。

## 真机补测（jsdom 测不到的部分）

1. 手机 Chrome（或 Android PWA）打开 /m，DevTools → Performance 录制一段长回合。
2. 在 EventSource message 回调与 React 提交处各打一个 `performance.mark`，或直接看
   Performance 面板的 Long Tasks：重点盯**回合收尾那一帧**（≥50ms 的 long task）。
3. 记录同网/远程两种网络下从 `assistant/chunk` 到屏幕更新的肉眼间隔。
4. 把结果回填到本文件，即可闭环「event→paint」的真实分布。

## 性能问题清单与处置（2026-09-07 实测定级）

| 问题 | 证据（本次实测） | 处置 |
|---|---|---|
| SSE 帧双 zod 校验（主线程） | parse+zod p50 0.023ms / p95 0.053ms | ✅ **测量退役**——非瓶颈，不动 |
| coalesce 每帧全表重扫 | coalesce p50 0.001ms | ✅ **测量退役**——61 行提交与 3 行同成本，memo 隔离有效 |
| 流式长文 O(n²) 预览 | 40k 单段落后 1/3 仅 1.36× 增长（p95 0.98ms） | ✅ 增量设计成立，无需改 |
| 收尾帧 62ms 尖峰（jsdom 全量跑） | 归因：纯 JS ≈0.3ms（parse 0.1 + 高亮 0.005 + 报告检测 0.2） | ✅ **jsdom DOM 构建假象**——浏览器原生解析，需真机 long-task 复核 |
| >1000 行代码围栏"渐进"高亮名不副实（攒完才 setHtml，无让步，注释与实现不符） | 代码审阅（code-block.tsx 旧实现） | ✅ **已修**：逐 chunk 提交 + 每块 `setTimeout(0)` 让帧；新增测试证明首块先行、末块覆盖尾行 |
| 折叠态大代码块仍挂载全部 DOM/HTML（隐藏行也构建） | 设计审阅 | ⏸ 待办：>阈值时折叠视图只渲染预览行、展开再水合——改动大，留给下轮 |
| backdrop-filter blur(20px)×3（底部输入条/目录条） | 未测（需真机合成 profile） | ⏸ 真机 DevTools 确认后再决定静态底色替代 |
| 单 bundle 1.08MB（首开 decode/parse + 弱网下载） | loopback 14.9ms（本地）；远端未测 | ⏸ 架构项：拆首屏/重型；需真机弱网数据支撑 |
| **attach 图片压缩主线程同步循环**（大照片多次全尺寸 JPEG 编码 = 单长任务冻结 UI） | 代码审阅（image.ts 旧 loop 无让步） | ✅ **已修**：循环逐次编码间 `setTimeout(0)` 让帧 |
| 注入 CSS 体积（mobile-styles 6 340 行 / ~141KB source） | 静态测量 | ⏸ build-time 压缩候选（lightningcss 已在 devDeps） |
| ChatView 滚动跟随/窗口化逐 chunk 布局 | 代码审阅（key 守卫 + rAF locate + 阈值锁 + 估算前缀） | ✅ 已核查：每 chunk 一次跟随所需布局，无额外 thrash，不改 |
| 订阅扇出（每帧 ≤3 监听方 + 会话早退过滤） | 代码审阅 | ✅ 已核查：无放大 |
| 大 tool-view 帧（diff 视图挂 frame 上）zod 逐字段校验 | 推理（未测） | ⏸ 随体积线性、罕见；真机 trace 佐证后再议 |

**结论**：经本机端到端实测 + 归因，客户端每帧/收尾路径上没有可再压的纯 JS 热点；
剩余优化方向集中在（a）真机才能测的合成/渲染层（收尾提交、blur），
（b）架构层（bundle 拆包、大代码块折叠水合、gzip 传输、CSS build-time 压缩），
（c）>1000 行渐进高亮之外的大 DOM 场景。
