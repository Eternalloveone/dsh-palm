# 重构进度（滚动更新）

> 对应 `docs/refactor-master-plan.md` 的 P0–P8。每个切片都跑过
> **typecheck → build → 契约测试 → 行数预算 → 全量测试** 才提交。

## 总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** | 工程基座（TS 模块图断言、导入环检测、行数预算双曲线） | ✅ |
| **P1** | 设计系统（tokens.css + components.css + 三皮肤） | ✅ |
| **P1.5** | 布局契约（SlotLayout：排布即数据、必填槽恰好一次） | ✅ |
| **P2** | `mobile-api.ts` 拆分为 `api/*.ts` | ✅ **59/59 方法，3,849 → 1,629 行（−57.7%）** |
| **P3** | host-bridge 单一订阅点 + 模型切片 | 🟡 订阅点已收敛，切片 4 个 |
| P4 | 结论卡四态渲染层 | ⬜ |
| P5 | 布局契约落到 9 屏默认 layout | ⬜ |
| P6 | 页面栈路由 + 18 屏迁移 | ⬜ |
| P7 | 转场双缓冲 + 触感/骨架 + 安全区 | ⬜ |
| P8 | 清账（旧样式删除、文档归档、偶发测试修复） | ⬜ |

## P2 明细

- `mobile-api.ts`：**3,849 → 1,629 行**
- 41 个 `api/*.ts` 模块
- 七个域全部搬完：workspace(5) / settings(2) / pair(4) / push(3) / session(10) / agentPreset+subagent(2) / mobile(33)
- 安全网：方法名快照（59）、导出面快照（25）、模块图环检测、行数预算

## P3 明细

### 单一订阅点 ✅

以前 5 处各自 `new MuxClient` + `onFrame`（App / ChatView ×2 / SessionListView / RunOverviewView），
现在只留一条：**App 建 mux → `createHostBridge` → 各视图/切片**。

守则由 `src/mobile/platform/subscription-guard.test.ts` 钉住：

1. 只有 `App.tsx` 能 `new MuxClient`；
2. 只有 `App.tsx` 能 `createHostBridge`；
3. bridge 必须透传 `rpcId`（应答关联依赖它）；
4. 视图层不得自造帧 schema（运行时校验只在 mux 解析边界 `isMuxFrame`）。

> 注意：守则匹配前**必须剥注释**——`host-bridge.ts` 的文档注释里就写着 `new MuxClient(...)`，
> 直接搜字符串会把说明书当成违规代码。

### 模型切片（4 个，均带单测）

| 切片 | 职责 | 测试 |
|---|---|---|
| `kernels/host-bridge.ts` | 一帧一次派发、重连代数、隔离抛错 | 8 |
| `kernels/app-frame-slice.ts` | App 帧规则（运行集/结束账本） | — |
| `kernels/preview-slice.ts` | 会话行摘要取数 + 限流并发 | 10 |
| `kernels/list-cache-slice.ts` | 名册页写穿 + 摘要表持久化 + 冷启动播种 | 3 |

### 视图层去取数（进行中）

`SessionListView`：**1,134 → 1,083 行**（摘要取数与缓存写穿已抽出）。

## 已知坑（踩过的）

| 坑 | 对策 |
|---|---|
| 数组展开进分发表 → RPC 契约测试红（9 例） | 一律**原位调用** |
| api/*.ts 反向 import mobile-api.ts → 成环 | 闭包能力经 ctx 传入 |
| 凭注释猜常量值（15,000 vs 实际 3,000） | 有测试兜住，改回真值 |
| 导出位置变化 | 重签导出面快照，数量对账（25 项） |
| CRLF 文件里用 `'\r'` 拼多行块 | 拼块必须用 `'\r\n'`；或整文件归一化后重建 |
| 脚本正则误伤（把 import 行改成实参形式） | 替换必须限定范围；改完立刻 typecheck |
| 守则正则匹配到**注释里的**代码 | 先剥注释再匹配 |
| Windows 下 notify 状态落盘偶发 EPERM | 既有测试隔离问题，留 P8 修 |

## 验证基线（每轮应保持）

```
pnpm typecheck        # exit 0
pnpm build            # exit 0（chunk 清单产出）
pnpm test             # 2,729 passed / 228 文件
node tools/check-budget.mjs   # 预算通过
```

**build 与 test 必须串行**（并发时 chunk 清单竞争会让 `mobile-routes.spec.ts` 偶发 404）。
