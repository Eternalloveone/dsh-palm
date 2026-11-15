# dsh-palm 移动端 UI 状态矩阵（refactor/v2，2026-11-10）

这份表只记录**实际看过的东西**。每一行的「证据」都是在 jsdom 里渲染真实组件、套上构建产物
`lib/mobile/app.css`、再按真实外壳（`#root{height:100dvh;display:flex;flex-direction:column}`）
截图得到的；它证明的是「组件 + 真实 CSS」，**不是整屏、不是真机、不是触控**。

## 怎么复现

```powershell
cd C:\Users\Administrator\dsh-source\dsh-palm\packages\dsh-palm
pnpm typecheck; pnpm build; pnpm guard; pnpm test     # 必须串行

# 组件截图（临时文件，看完就删）
# 1. 写一个 src/mobile/dev/<name>-dump.test.tsx：render(<要看的组件/>)，把 container.innerHTML 落盘
# 2. 把 lib/mobile/app.css 一起拷到同一目录
# 3. 外壳页：<html data-skin="graphite" data-theme="dark"> + #host{height:100dvh;display:flex;flex-direction:column}
# 4. node 静态服务 + mcp__screenshot__screenshot_web（http://127.0.0.1:<port>/）
```

## 覆盖情况

| 页面 / 场景 | 390 深色 | 390 浅色 | 320 窄屏 | 状态 | 证据 |
|---|---|---|---|---|---|
| 聊天 · 空会话首屏 | ✅ | ✅ | — | 空 | `empty-graphite.png` / `empty-paper.png` / `empty-real-before.png` / `empty-real-after.png` |
| 聊天 · 加载骨架 | ✅ | ✅ | — | 加载 | `skeleton-graphite.png` / `skeleton-paper.png` |
| 聊天 · 失败交付卡（含重试） | ✅ | ✅ | — | 失败 | `fail-card-graphite.png` / `fail-card-paper.png` |
| 聊天 · 回合头 / 过程 / 交付卡 | ✅ | — | — | 运行·完成·未知 | 切片 1–5、13 的截图（`docs/refactor-progress.md`） |
| 聊天 · 离线横幅 | ✅ | — | — | 离线（UI） | 审查结论：无需改动 |
| 会话抽屉 | ✅ | — | — | 空/有内容 | `drawer-graphite.png` |
| 审批详情 | ✅ | ✅ | ✅ | 待批/只读 | `approval-graphite.png` / `approval-paper.png` / `approval-block.png` / `approval-320.png` |
| 提问内联卡（选中态） | ✅ | — | — | 已选一项 | `question-picked.png` |
| 搜索结果页 | ✅ | — | — | 有命中/空 | `search-graphite.png` |
| 上下文占用 | ✅ | — | ✅ | 正常/高水位 | `context-graphite.png` / `context-320.png` |
| 回合大纲 | ✅ | — | — | 有结论 | `outline-graphite.png` |
| 产物列表 | ✅ | — | ✅ | 有产物 | `artifacts-graphite.png` / `artifacts-320.png` |
| 单文件 diff | ✅ | ✅ | ✅ | 文本/长行 | `diff-graphite.png` / `diff-paper.png` |
| 设置页 | ✅ | — | ✅ | 骨架/常态 | `settings-graphite.png` / `settings-320.png` |
| 外观 / 皮肤 | ✅ | ✅ | — | 三皮肤切换 | `appearance-graphite.png` / `appearance-paper.png` |
| 批准方式（权限档位） | ✅ | ✅ | — | 含二次确认 | `approval-mode-graphite.png` / `approval-mode-paper.png` |

## 明确**没**验的

| 场景 | 为什么没验 | 风险 |
|---|---|---|
| 键盘弹出 | jsdom 没有软键盘、没有视口缩放；`dvh` / `env(safe-area-inset-*)` 只在真机有意义 | 中：composer 已有 safe-area 内边距，但"键盘把输入框顶上去"的实际行为未看 |
| 真机触控热区 | 截图不含手 | 低：`.palm-hit`（44px）已在开关、重试、行高上被单测钉住 |
| 弱网/断流的真实时序 | 需要真宿主 + 网络抖动 | 中：缓存与轮询逻辑有单测，真实恢复路径未跑 |
| 无权限/未配对的首屏 | 需要宿主拒绝的真实响应 | 低：`PairRequiredView` 有单测，未截图 |
| 离线横幅在真实断网时 | 同上 | 低 |
| 深色/浅色以外（nocturne） | 空会话首屏、消息流、diff、审批页均已出图（`empty-nocturne.png` / `chat-nocturne.png` / `diff-nocturne.png` / `approval-nocturne.png`） | 低：三套皮肤的 `--palm-fg-3` 与纸色语义色已按 AA 校正（切片 24/25）；夜航其余次级页未出图 |

## 已知未做的设计项（有明确代价，先记账）

| 项 | 现状 | 代价 |
|---|---|---|
| 纯问答回合的任务头 | 每一轮都画任务头（目标行 + 状态条） | 实测去掉会让 8 条用例失败，需要先改判据与用例；对"问答型"会话确实是多余的一层 |
| `unknown`（中断未标记失败）卡的动作 | 只写「结局未知」，不给重试 | 与"确定失败"区分开是有意的；是否给"重看这一轮"另议 |
| 抽屉里的运行总览 | 已收敛成一行状态条 | 若要展示跨会话队列全景，需新的投影 |

## 切片 49–71 新增的证据（2026-11-10）

| 页面 / 场景 | 皮肤 | 状态 | 证据 |
|---|---|---|---|
| 定位高亮（减弱动效） | 石墨 / 夜航 | 静态标记 | `chat-focus-marker.png`、`locate-static-marker.png` |
| 语音面板 · 录音 | 石墨 | 常态 | `voice-sheet.png` |
| 语音面板 · 转写中 | 石墨 | 按钮禁用 | `voice-transcribing.png` |
| 语音面板 · 最后 10 秒 | 石墨 | 警示色 | `voice-warn.png` |
| 语音面板 · 320 窄屏 | 石墨 | 两键并排 | `voice-320.png` |
| 配对页 · 空态 / 失败 / 提交中 | 石墨 / 纸色 | 三态 | `pairing-graphite.png`、`pairing-error-matrix.png`、`pairing-submitting.png`、`pairing-submitting-paper.png` |
| 会话抽屉 | 石墨 / 纸色 | 并排对照 | `matrix-drawer.png` |
| 产物列表 | 夜航 | 有产物 | `matrix-approval-artifacts.png`（右半） |
| 待发队列 + 离线横条 | 石墨 / 纸色 | 同屏层叠 | `offline-queue-matrix.png` |
| 离线带（横幅与离线条） | 石墨 / 纸色 | 同一档浓度 | `offline-band-unified.png`、`offline-band-text.png` |
| 三皮肤表面与文字 | 纸色 / 夜航 / 石墨 | 换肤收口 | `surf-chat-paper.png`、`txt-chat-nocturne.png`、`txt-settings-graphite.png` |
| 淡染标签 / 超限提示 | 石墨 / 纸色 | 令牌化 | `tints-matrix.png` |

### 仍然空着的状态（这一轮补不上的）

| 场景 | 为什么仍然空 | 需要的条件 |
|---|---|---|
| 键盘弹出后的 composer / 配对页 | jsdom 无软键盘；浏览器截图也不模拟 `visualViewport` 收缩 | 真机，或 Playwright + 设备仿真 |
| 横屏 | 同上，且没有旋转后的布局用例 | 真机 |
| 无权限（宿主 403） | 需要真实宿主拒绝 | 测试宿主 + `PALM_TEST_SESSION` |
| 配对「网络错误」与 15 秒超时 | 有错误态图（`pairing-error-matrix.png`），但"超时到点"这一条时序未拍 | 可控的假时钟 + 真实定时器 |
| iOS 15 的 `color-mix` 降级 | 没有旧系统设备 | 真机或 BrowserStack |
| 减弱动效的整屏观感 | 只拍了组件级 | 系统开关 + 真机 |
### 随仓库归档的八张（切片 73）

上面那 13 行里绝大部分证据原本只在临时目录。以下八张已拷进 **`docs/screenshots/`**，换机器、清临时目录都不会丢：

| 文件 | 内容 |
|---|---|
| `v2-chat-paper.png` | 聊天主屏 · 纸色（暖底 + 暖棕字 + 卡片白） |
| `v2-chat-nocturne.png` | 聊天主屏 · 夜航（蓝底 + 蓝调字） |
| `v2-drawer-graphite-paper.png` | 会话抽屉 · 石墨 vs 纸色并排 |
| `v2-pairing-graphite.png` | 配对页 · 空态（含占位提示） |
| `v2-offline-band.png` | 断线带 · 石墨 vs 纸色（横幅与离线条同档） |
| `v2-voice-transcribing.png` | 语音面板 · 转写中（按钮禁用） |
| `v2-tinted-tags.png` | 淡染标签 / 超限提示 / 离线条 · 双皮肤 |
| `v2-artifacts-nocturne.png` | 产物列表 · 夜航 |

> 这八张对应构建的 `app.css` hash **`8b2b38ed`**（2026-11-10 05:39 切片 71 之后的产物）。

切片 74–77 又补了六张（同样在 `docs/screenshots/`）：

| 文件 | 内容 |
|---|---|
| `v2-context-bars.png` | 上下文占用条 · 26% / 74% / 90% 三档，双皮肤 |
| `v2-scrim-badge.png` | 待发送图片角标「×」压在浅/深/中灰三种底图上 |
| `v2-outline-skins.png` | 回合大纲 · 石墨 vs 纸色（当前轮标记） |
| `v2-usage-skins.png` | 用量页 · 石墨 vs 纸色（pro/余额/未配置/失败 四态） |
| `v2-notify-skins.png` | 通知页 · 石墨 vs 纸色（含失败行未上色时的样子） |
| `v2-notify-fail.png` | 送达日志 · 失败行改红、已过滤行改琥珀后 |
| `v2-320-paper.png` | **320 窄屏 + 纸色** 三屏并排：用量 / 通知 / 设置 |
> 其中 `v2-drawer-graphite-paper.png`、`v2-offline-band.png`、`v2-tinted-tags.png` 是**并排合成图**：
> 两屏之间与四周的深灰底（`#20242c`）是外壳页的，**不是产品的一部分**。