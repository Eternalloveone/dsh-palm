# P2 进度与卡点（滚动更新）

> 更新于第 18 轮。每轮结束由执行者追加，**只写真实现测到的数字**。

## 已完成

| 项 | 结果 | 提交 |
|---|---|---|
| 进程级状态收拢 | 12/12 迁入 `api/process-state.ts` | `9f9b30e` |
| 模块级 `let` 棘轮 | 基线 12 → **0**，新增即红 | `9f9b30e` |
| 导出面快照 | 25 条导出锁死 | `5e4fc86` |
| settings 域 | `isAllowedSettingsOp` 搬出 + 6 条单测 | `4a35348` |
| chat 域 | include 解析簇搬出 + 4 条单测 | `ac6d24c` |
| `mobile-api.ts` | 3,849 → **3,796**（−53） | — |

## 实测结构（`docs/api-ctx-usage.md`）

- `makeMobileApiRoutes` 闭包 **2,410 行**（占 63%）
- 分发表 **4 张**，条目 **59 个**
- `ctx.` 引用 **27 次 / 8 字段** → **处理器不重依赖 ctx，可整块搬**

条目按域：常量键 41、`session` 10、`workspace` 5、`settings` 2、`subagent` 1。

## 卡点（未解决）

自动搬移脚本 `tools/move-domain2.mjs`：
- 解析逻辑在独立调试里正确（能数出 workspace=5）
- 装进脚本后匹配不到条目，**原因未定位**
- 已排除：正则本身、表定位（4 张表都找到了）

**下一步**：给脚本加 `DEBUG entries` 输出定位；或手动搬 `workspace` 的 5 个条目（约 150 行）验证"处理器是否真的无闭包依赖"——这是 P2 剩下的唯一未知数。

## 纪律（不变）

每切片：`typecheck → build → test → health-check → 视觉门禁 → 预算 diff → 提交`。
预算只降不升；上调必须带 `reason` + `expires`。
