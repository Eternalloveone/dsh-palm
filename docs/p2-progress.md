# P2 进度（滚动更新，第 49 轮）

## 现状

| 项 | 值 |
|---|---|
| mobile-api.ts | 2537 行（起点 3849，-34.1%）|
| 已外移方法 | 47/59（80%）|
| api/*.ts 模块 | 16 个 |
| 全量测试 | 2704 passed / 224 文件 |

## 已完成域

workspace(5) / settings(2) / pair(4) / push(3) / session(10) / agentPreset+subagent(2) / mobile 21 个

## 剩余 12 个

| 方法 | 行数 | 说明 |
|---|---|---|
| sessionState | 69 | 需先搬 readInboxProjection / readGoalProjection |
| usage | 47 | 需先搬 discoverUsageProviders |
| diagnostics | 12 | 需先搬 buildHealthReport |
| readFile | 92 | 需先搬路径校验工具 |
| readChat | 86 | 同上 |
| folders | 81 | |
| logTail | 76 | |
| uploadAttachment | 74 | |
| search | 217 | 搜索索引 + 定位缓存 |

## 流程

show-method 打印源码 → 写 api/*.ts（显式 ctx、注释原样保留）→ 脚本原位替换 → typecheck → 关键测试 → 预算 → 全量测试 → 提交。

## 已知坑

- api/*.ts 到 src/ 的相对深度是 ../../（不是 ../../../）
- 闭包能力经 ctx 传入，绝不反向 import mobile-api.ts（会成环）
- 类型对不上时用 unknown 收边界 + 模块内断言
- Windows 下 notify 状态落盘偶发 EPERM（既有测试隔离问题，P8 修）
