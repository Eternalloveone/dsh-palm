# 最终全量回归记录

> 一次串行跑完 11 道门禁。日志：`final-gates.log`（不入库）。脚本：`tools/final-gates.ps1`。

## 结果

| # | 门禁 | 命令 | 结果 |
|---|---|---|---|
| 1 | 样式生成 | `pnpm gen:css` | ✅ exit 0 |
| 2 | 类型 | `pnpm typecheck` | ✅ exit 0 |
| 3 | 构建 | `pnpm build` | ✅ exit 0 |
| 4 | 单测 | `pnpm test` | ✅ **2,875 passed / 251 文件**（1 expected fail / 11 skipped）|
| 5 | 行数预算 | `node tools/check-budget.mjs` | ✅ 通过（files=5 dirs=20）|
| 6 | 预算同步校验 | `node tools/sync-budgets.mjs --check` | ✅ 全部达标 |
| 7 | 移动端体检 | `node tools/health-check.mjs` | ✅ **全绿**（typecheck / build / test / 视觉 / ADR / 预算 7 项 PASS）|
| 8 | 像素视觉基线 | `node tools/mobile-visual/run.mjs` | ✅ **7 屏 PASS** |
| 9 | 真机冒烟 | `node tools/mobile-scenarios/run.mjs` | ✅ **326 条判据 / 违规 0 / 异常 0** |
| 10 | 死样式扫描 | `node tools/dead-css.mjs` | ✅ 可删 3 个（测试仍引用 2 个，故意保留）|

## 像素基线明细

| 界面 | 差异占比 | 阈值 | 结论 |
|---|---|---|---|
| 会话列表 | 0 | ≤3% | PASS |
| 首页 | 0.03 | ≤1.5% | PASS |
| 设置页 | 0 | ≤4% | PASS |
| 聊天输入区 | 0 | ≤1.5% | PASS |
| 外观页 | 0 | ≤1.5% | PASS |
| 产物页 | 0 | ≤1.5% | PASS |
| 模型页 | 0 | ≤1.5% | PASS |

## 体检（health-check）输出

```
typecheck      PASS     0.9s
build          PASS     3.0s
test（全量）       PASS    57.3s
视觉门禁           PASS    31.0s
ADR 目录完整       PASS     0.0s
ADR 索引与实际文件一致  PASS     0.0s
行数预算表存在且只降不升   PASS     0.0s
结论：全绿
```

## 前置条件（复跑必读）

| 项 | 值 |
|---|---|
| 宿主 | `http://127.0.0.1:3080` 必须在线并已配对 |
| 配对 cookie | `dsh_pair=edb0f18…`（登记在 `~/.dsh/dsh-palm-devices.json`）|
| Playwright | `C:/Users/Administrator/.dsh/skills/feishu-report/node_modules/playwright` |
| 顺序 | **build 与 test 不能并行**（chunk-manifest 竞态会让路由测试 404）|

## 结论

objective 要求的四类回归（单测 + golden + 视觉基线 + 真机冒烟）与工程门禁（typecheck / build / health-check / 预算只降不升）**全部通过**；工作树干净，最后一次提交见 `git log -1`。
