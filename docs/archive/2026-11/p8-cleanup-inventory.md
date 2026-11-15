# P8 清账清单：迁屏之后哪些代码变成了死路

> 目的：8 屏迁成独立页之后，原来那些浮层并没有自动消失。这份清单**先取证再删**，
> 每条都写清"为什么判断它是死的"，避免删掉还在用的分支。
>
> 判据：`App.tsx` 是唯一的生产渲染方（`ChatView` 只被 App 渲染）。App 现在把
> `onOpenModel / onOpenDiff / onOpenOutline / onOpenArtifacts / onOpenContext / onOpenApprovalMode`
> **六个回调全部传了**，因此 `ChatView` 里"没给回调就开浮层"的分支在生产里走不到。

## 一、已确认可删（有取证）

| 目标 | 证据 | 删除范围 | 风险 |
|---|---|---|---|
| `TurnListSheet` | 全仓 5 处，全部在 `ChatView`（导入 / 渲染 / 两个 setter 调用）；`onOpenOutline` 一旦给了，`setTurnListOpen(true)` 不再执行 | `sheets.tsx` 里的组件 + `ChatView` 的 `turnListOpen` 状态与渲染 + 其单测 | 低（⑫ 已覆盖同一功能） |
| ~~`previewPath` 浮层预览~~ **（更正：不是死路）** | 有**两个**入口：① 文件行点击（`onOpenDiff` 给出后走页面）；② **代码块里的 `.file-link` 路径点击**，在没有 `window.dshOpenFile` 的浏览器里回落到它 | 不删。已改为"有 ⑩ 页就先走页面，没有才回落浮层"，两个入口行为一致 | — |

## 二、**不要删**的（先查过，仍在用）

| 目标 | 为什么留着 |
|---|---|
| `FilePreviewSheet` | ⑩ `DiffView` 直接复用它，共 25 处引用 |
| `PermissionConfirmSheet` | ⑥ 页面用同一套宿主命令语义，浮层仍是"选完预设后确认"的一步 |
| `ApprovalPanel` | ④ `ApprovalView` 复用它 |
| `Sheet` 基础组件 | 输入法面板、命令面板等打断式交互仍按规范保留浮层 |

## 三、待评估

| 目标 | 现状 |
|---|---|
| `backTargetOf` 兜底表 | 页面栈已覆盖全部路由；但冷启动直达深链时栈只有一层，兜底仍在用 → **暂留** |
| 旧样式（`page-enter-*` 之前的过渡类） | 已无引用，随 P8 样式清账一起删 |

## 四、删完之后要跟着动的数

死代码删除后，以下棘轮**必须同步下调**（只降不升）：

1. `tools/budget.json` 的 `dirs` / `files`；
2. `platform/quality-budget.ts` 的 `cssClasses` / `cssPx`（浮层样式一并删）；
3. `architecture.test.ts` 的 `views/ChatView.tsx` 上限。

下调动作交给 `node tools/check-budget.mjs --write`（它只会把上限改到实测值）
与 `node tools/sync-budgets.mjs`（跨三处棘轮）。
