# 性能与规模基线（W0）

> 用途：重构前后对比的**唯一基线**。任何"优化了/退化了"的结论都必须对照本文件。
> 采集：2026-11-07，分支 `refactor/v2`，基线 commit `5f74882`（W0 起点），Node v26.4.0 / pnpm 11.21.0，Windows。

---

## 1. 构建产物（`pnpm build`，实测）

| 产物 | 原始 | gzip |
|---|---:|---:|
| `lib/mobile.js`（入口） | 84.42 kB | 24.14 kB |
| `lib/mobile/shared-*.js`（含 CSS 字符串） | 488.79 kB | 139.77 kB |
| `lib/mobile/vendor-*.js`（React） | 140.87 kB | 45.17 kB |
| `lib/mobile/ChatView-*.js`（懒加载） | 118.22 kB | 37.70 kB |
| `lib/mobile/SettingsView-*.js`（懒加载） | 69.64 kB | 18.78 kB |
| **手机端合计（首访全量）** | **901.94 kB** | **265.56 kB** |
| `lib/index.js`（宿主半） | 603.42 kB | 186.43 kB |
| `lib/client.js`（桌面面板） | 167.07 kB | 38.82 kB |

> 首屏实际加载 = 入口 + shared + vendor + 首屏视图 chunk（Chat 或 Settings），其余懒加载。
> CSS 目前以字符串形式编进 `shared`（源 `mobile-styles.ts` 210,339 字节 / 9,627 行）；W1-1 目标：移出为独立 `app.<hash>.css`。

## 2. 源码规模（`packages/dsh-palm/src`）

| 指标 | 数值 | 采集方式（可复现） |
|---|---:|---|
| CSS 字节 | 210,339 | `[IO.File]::ReadAllText('src/mobile/mobile-styles.ts').Length` |
| CSS 行数 | 9,627 | `Split("\n").Length` |
| CSS 变量声明 | 206 | `(?m)^\s*--[a-zA-Z0-9-]+\s*:` |
| CSS 变量去重 | 92 | `--[a-zA-Z][a-zA-Z0-9-]*` 去重 |
| 类选择器定义 | **830** | `(?m)^\s*\.[a-zA-Z][a-zA-Z0-9_-]*` 去重 |
| 十六进制色值 | 174 | `#[0-9a-fA-F]{3,8}\b` |
| `rgb/rgba()` | 65 | `rgba?\(` |
| `px` 字面量 | 1,751 | `\b\d+(\.\d+)?px\b` |
| 裸 `<button>` | 228 | `<button\b`（58 个生产 tsx） |
| 裸 `<input>` | 25 | `<input\b` |
| `role="menu"` | 11 | `role="menu"` |
| 内联 `style={{` | 30 | `style=\{\{` |
| `ChatView.tsx` 行数 | 5,249 | 与 `architecture.test.ts:63` 同算法 |
| 预算上限 | 5,250 | 只剩 1 行余量 |

> 口径差异说明：早期文档的「848 类名 / 1,729 px」用的是不同正则；**以本表为准**（采集模式已写在表内）。

## 3. 测试基线（`pnpm test`，串行）

| 项 | 数值 |
|---|---:|
| 测试文件 | 187（186 通过 / 1 跳过） |
| 用例 | 2,415（2,402 通过 / 1 expected fail / 11 跳过） |
| 耗时 | 45.24 s（transform 22.58 / setup 3.56 / tests 99.04 / env 204.76，并行口径） |
| typecheck | 通过 |
| build | 通过 |

**已知坑（本次实测）**：`pnpm build` 与 `pnpm test` **并发**会导致 `tests/mobile-routes.spec.ts` 偶发 404——build 的 chunk 清理与测试读取 chunk 清单竞争。二者必须串行；单跑该 spec 17/17 通过。

## 4. 运行时指标（待真机，脚本已备）

| 指标 | 采集命令 | 状态 |
|---|---|---|
| 首屏 TTI / 冷启动 | `pnpm verify:mobile`（14 脚本） | 待已配对宿主 |
| 流式帧率 / 长任务 | `pnpm verify:render` | 待已配对宿主 |
| 场景回归（43 个） | `pnpm verify:scenarios` | 待已配对宿主 |
| 内存（1,000 行） | 真机 Performance 面板 | 待真机 |
| 断线恢复 | 场景脚本 | 待已配对宿主 |

> W0 只要求"有可比基线"；上述项在拿到已配对宿主后补录，**不阻塞 W1**（W1 不碰运行时路径）。

## 5. 截图基线（待真机）

- 计划：6 屏 × 浅/深 × 390 宽（另抽 320/430）。
- 现状：仓库内无自动化截图路由（需配对后访问 `/m/`）。
- 处置：W2-7 建 `/m/dev/ui` 画廊与截图矩阵时一并补齐；W0 阶段以 `D:\work\dsh-palm\shot-*.png` 的 2026-10-26 真机截图作**参考**，不作门禁。

## 6. 复现命令

```powershell
cd packages/dsh-palm
pnpm typecheck
pnpm build          # 先 build
pnpm test           # 再 test（禁止并发）
```

## 7. W0 出口判定

| 项 | 结论 |
|---|---|
| 工作树干净 | ✅（`5f74882`，无未提交） |
| 架构预算 | ✅ 5,249 ≤ 5,250 |
| typecheck | ✅ |
| 全量测试 | ✅（2,402 passed + 1 expected fail） |
| 构建 | ✅ |
| 性能基线 | ✅ 构建/源码指标已落盘；运行时项待真机 |
| 截图基线 | ⏳ 待 W2 画廊 |
