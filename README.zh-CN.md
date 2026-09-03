# dsh-palm

[English](README.md) | [简体中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/@eternalloveone/dsh-palm)](https://www.npmjs.com/package/@eternalloveone/dsh-palm)
[![npm downloads](https://img.shields.io/npm/dm/@eternalloveone/dsh-palm)](https://www.npmjs.com/package/@eternalloveone/dsh-palm)
[![CI](https://img.shields.io/github/actions/workflow/status/Eternalloveone/dsh-palm/ci.yml)](https://github.com/Eternalloveone/dsh-palm/actions)
[![License](https://img.shields.io/github/license/Eternalloveone/dsh-palm)](https://github.com/Eternalloveone/dsh-palm/blob/main/LICENSE)

**状态：pre-1.0** —— 插件 API 可能在版本间变化，欢迎反馈。

![dsh-palm 演示](docs/screenshots/demo.gif)

[dsh](https://github.com/deepseek-ai/deepseek-harness) web GUI 的独立移动端界面：扫码或输码配对设备信任、`/m/` 手机端 UI、带实时 SSE mux 桥的 `/m/api` RPC 通道，以及桌面端配对面板。

## 衍生声明

dsh-palm 是 [dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web)（`@linxin666/dsh-remote-web-ui`，Apache-2.0，作者 zhu1090093659）的**衍生作品**。详见 [NOTICE](packages/dsh-palm/NOTICE)。

**继承：** 配对协议、设备存储格式（`$DSH_HOME/remote-web-ui-devices.json`）、桌面端面板骨架。**自研：** `/m/` 全部 UI、渲染栈、`/m/api` 白名单与 SSE mux、离线层。

## 产品定位

dsh-palm 是**窄屏优先的轻量指挥台**：手机用于查看进度、响应通知、快速操作与轻量管理——而非深度工作终端。复杂配置（安装插件、编辑权限预设）建议在桌面端完成；手机端保持高频路径（打开会话、阅读、回复）一两步可达。每个组件以**手机场景频率**为准入标准：模型切换、任务与后台任务状态、会话管理是一等公民；桌面场景的便利设施（卡片首页、多 Tab 导航、树形侧边栏）刻意不做。界面保持单页状态机（工作区 → 会话 → 聊天）+ 底部面板扩展，不引入 Tab 架构。

## 快速开始

手机得能连到这台机器，三种方式：

- **同一 Wi-Fi**（30 秒，够用）—— 点侧边栏手机图标打开配对面板，用面板给出的局域网地址。
- **Tailscale**（5 分钟，推荐）—— 两端都装 Tailscale；面板自动探测 tailnet 域名，一键填入。
- **frp 或 Cloudflare Tunnel**（已有基础设施的话 1 分钟）—— 把隧道地址粘贴进面板；保存前先验证可达性。

面板会自动探测本机隧道（Tailscale tailnet 域名、`frpc.toml` 条目、Cloudflare Tunnel 客户端）；没有隧道的小白会看到「局域网直连 / 创建隧道」分叉而非空白输入框。

然后：`dsh plugin --profile web add @eternalloveone/dsh-palm` → 打开配对面板 → 手机扫码或输入 6 位配对码。

初次接触？[30 秒上手教程](packages/dsh-palm/docs/quickstart-tutorial.md)带您从安装走到手机上完成一次对话，并配好让手机端真正值得用的完成通知。

## 截图

| | |
|---|---|
| ![聊天](docs/screenshots/chat.png) | **聊天** —— 流式 Markdown，带工具标签、可交互 diff 卡片与语法高亮代码块 |
| ![Diff 卡片](docs/screenshots/diff.png) | **Diff 卡片** —— `diff` 代码块渲染为可交互卡片，支持接受 / 拒绝 |
| ![运行状态](docs/screenshots/run-status.png) | **运行状态** —— 任务清单与后台任务共用一个工具栏上方的实时状态条 |
| ![配对](docs/screenshots/pair.png) | **配对** —— 粘贴桌面端链接或输入 6 位配对码 |
| ![用量](docs/screenshots/usage-card.png) | **用量** —— 桌面端配置的每个提供方一张卡片：周用量进度条、账户余额与 OpenRouter 消耗/限额，可手动刷新 |

更多截图（工作区、会话列表、图片上传、设置、任务面板、配对面板）：[docs/screenshots](docs/screenshots/)。所有截图均由真实 `/m/` UI 渲染**虚构演示数据**（项目名、会话标题与聊天内容均为编造），仓库中不会泄露任何真实信息。

## 核心能力

- **扫码配对设备信任** —— 手机扫码或输入 6 位配对码完成配对；设备持久化在 `$DSH_HOME/remote-web-ui-devices.json`，切换安装来源后继续可用
- **原生手机端界面（`/m/`）** —— 从零为窄屏设计的独立手机 bundle，而非桌面 GUI 的 CSS 适配层：触控优先的交互、安全区与动态视口适配、拇指友好的触控目标、零横向滚动
- **手机端与桌面端实时同步** —— 两端共享同一条宿主事件流（SSE mux 桥 + 轮询回退）；端到端延迟（桌面触发 → 手机端 mux 帧，中位数）：本机回环 4ms、公网隧道 9ms、Tailscale 13ms、弱网 246ms（Chrome DevTools 限速，模拟 200ms 延迟，每场景 N=5–8 轮，2026-08 实测）
- **输入法安全** —— 中文输入法组合期间不会误发半截拼音
- **Diff 卡片与代码操作** —— 容错 diff 解析，支持接受 / 拒绝 / 评审；复制、插入编辑器、打开、下载、沙箱运行
- **运行状态条与任务面板** —— 任务清单与后台任务合并为一个工具栏上方的实时状态条
- **离线发件箱与 PWA** —— 断网时消息排队（IndexedDB），联网自动发送；可安装、带版本号的服务工作者
- **完成通知** —— 任务完成与长回复提醒，三层投递：应用内系统通知（SSE）、Web Push（VAPID）、以及应用关闭时也能送达的第三方渠道（Server酱 / Bark / Telegram）；阈值与间隔可在手机端配置
- **逐提供方用量与余额** —— 桌面端配置的每个模型提供方一张卡片：周用量进度条（Ollama Cloud）、账户余额（DeepSeek、Moonshot/Kimi）与 OpenRouter 消耗/限额，可手动刷新；无公开查询接口的提供方不展示
- **干净的流式输出** —— 窗口化前缀渲染让长回复保持流畅；推理块折叠为可展开块

## 完整能力列表

<details>
<summary>架构、实时、交互、离线、体验、配对与引导 —— 完整列表</summary>

**架构**

- **方法级白名单 RPC** —— `/m/api` 只暴露显式白名单 + 手机端本地方法；错误响应不泄露宿主路径与方法名（由 `tests/mobile-api.spec.ts` 覆盖）
- **手写渲染栈** —— GFM 子集 markdown 渲染器（先转义、协议白名单）、轻量语法高亮器、unified diff 解析器——渲染栈无第三方依赖；打包小于 1 MB（gzip 226 KB）

**实时**

- **SSE mux 桥 + 轮询回退** —— 停滞检测（活跃流 36s）自动启动自适应历史轮询；事件不丢，SSE 恢复后立即切回；设备被撤销后停止轮询并回到配对页，而非无限空转
- **增量流式预览** —— 未闭合尾部按 chunk 增量转义，短块保留行内 Markdown 提升
- **推理块折叠** —— 正文中的思考内容折叠为可展开块

**交互**

- **审批与问题面板** —— 工具审批实时推送、就地解决；应答绑定所属设备会话（多端不能互相抢占）
- **命令卡片** —— slash 命令发现与执行，带运行中 / 成功 / 失败生命周期
- **图片上传** —— 粘贴或选择；canvas 压缩把载荷控制在固定预算内；超限与解码失败以 toast 提示而非静默丢弃
- **语音输入与转写** —— 浏览器内 WAV 录音（60s 自动收尾、离开页面自动清理），OpenAI 兼容多服务按序回退（默认 SenseVoiceSmall），手机端可管理服务列表；宿主配置的服务仅作展示——宿主 API key 绝不离开宿主
- **会话管理** —— 聊天更多菜单或列表长按删除会话；离线发件箱随会话一并清理
- **插件市场** —— 手机端浏览、搜索、安装插件（建议在桌面端执行）
- **桌面级设置同步** —— 手机端设置与桌面同步（schema 表单、级联模型选择、权限预设；复杂预设建议在桌面端编辑）

**离线与弱网**

- **PWA** —— 可安装、带版本号的服务工作者、可离线使用的打包产物
- **gzip 压缩 API 响应** —— 弱网友好
- **按需加载** —— 工作区列表轻量拉取；会话只在打开时加载
- **瞬时切换** —— 折叠视图读取、批量预览与跨挂载缓存让列表/聊天切换近乎即时，弱网下同样流畅

**通知**

- **一次判定，三条通道** —— 宿主监听共享事件流并统一判定（任务终态 + 超过可配置阈值的回复，带同会话冷却）；每条通道投递同一判定结果
- **应用内系统通知（SSE）** —— 应用打开时手机端弹出系统通知；点击直达对应会话
- **Web Push（VAPID）** —— 应用关闭时由服务工作者接收推送（Android Chrome/Edge/Firefox；iOS Safari 16.4+ 仅限已安装的 PWA；国内网络可能无法到达 FCM 后端——由第三方渠道覆盖）
- **第三方渠道** —— Server酱（微信）、Bark（iOS）、Telegram webhook，应用完全关闭也能送达；凭据只存宿主端，不经过设置面
- **通知设置** —— 权限、时长阈值、冷却间隔、Web Push 开关与渠道凭据都在手机端设置页，附「发送测试」按钮可端到端验证整条链路

**体验**

- **显示偏好** —— 字号、密度、行号、自动滚动
- **主题联动** —— 桌面主题偏好同步到手机
- **会话列表** —— 完整项目名、按 cwd 过滤、完整时间戳

**配对与引导**

- **6 位配对码** —— 桌面面板在二维码旁显示人类可读的配对码，手机可直接输入。配对码一次性、随令牌过期（默认 10 分钟）、刷新或停止即失效；`/api/pair/accept` 有速率限制（30 秒窗口：每源 IP 40 次、每 XFF hop 10 次），未知或已用密钥统一返回 `invalid`，探测无法区分二者
- **面板内公网地址编辑器** —— 直接在配对面板配置隧道地址（frp / Cloudflare Tunnel / Tailscale）；保存前自动探测可达性，死隧道在保存前就被拦下
- **三步向导** —— 面板是「配置 → 配对 → 使用」向导；步骤指示器兼作导航（已完成步骤可点击回看），已配对用户直接进入简洁的设备管理视图
- **隧道检测** —— 宿主探测 Tailscale（tailnet 域名一键填入）、解析 `frpc.toml` 给出具体 frp 入口、识别 Cloudflare Tunnel 客户端；没有隧道的小白会看到「局域网直连 / 创建隧道」分叉而非空白输入框
- **首次使用引导** —— 可关闭的欢迎横幅、侧边栏入口未配置红点、人话文案（"手机连不上这台电脑"）且操作入口就在下方
- **工作区原生主题** —— 面板通过 `prefers-color-scheme` 跟随系统深浅色（无手动切换），所有颜色 0.2s 过渡
- **手机端服务器切换** —— 配对页显示服务器地址，可通过 `?code=` / `?pair=` 深链切换到其他隧道入口；配对码被立即消费，URL 随即替换为干净路径，所有响应携带 `Referrer-Policy: no-referrer`
- **桌面级命令菜单** —— 手机端 `+` 菜单按会话的 agent 视图解析，`/plan`、`/compact` 等按 agent 挂载的命令与桌面 `/` 弹窗一致

</details>

## 通知

dsh-palm 在任务完成或长回复结束时提醒手机。宿主端统一决策引擎（`NotifyEngine`）监听共享事件流，把每个决策扇出到三层投递通道——无论应用打开、关闭还是浏览器完全退出，同一事件都能到达手机。

### 原理

**一个触发，三条通道。** 宿主监听 mux 事件流并统一判定：

- **任务终态** —— 后台任务（bash、pwsh 等）从 `running` 变为 `completed/failed` 时立即发通知
- **长回复** —— 完成的 turn（agent 回复）耗时超过可配置阈值（默认 30 秒）时发通知；同一会话受冷却间隔（默认 2 分钟）节流，避免连续长回复轰炸手机。中止与出错 turn 永不通知

决策通过三条独立通道投递：

| 层 | 通道 | 生效场景 | 说明 |
|---|---|---|---|
| L1 | SSE → 系统通知 | 应用打开（前台或后台） | 点击直达对应会话；页面可见时不弹 |
| L2 | Web Push（VAPID） | 应用关闭、浏览器运行中 | Android Chrome/Edge/Firefox；iOS Safari 16.4+ 仅限已安装 PWA；国内网络可能无法到达 FCM 后端 |
| L3 | Server酱 / Bark / Telegram webhook | 应用关闭、浏览器已退出 | 凭据只存宿主端 |

**L1（应用内）。** 手机保持一条到 `/m/api/events.notify` 的 SSE 连接——刻意与聊天 mux 流分离（其 schema 会丢弃未知帧）。收到通知帧即弹系统通知；点击深链到 `/m/?workspace=…&session=…`。页面可见时不弹——你本来就在看应用。

**L2（Web Push）。** 服务工作者（v4）接收推送，应用关闭时也能弹通知（只要浏览器在运行）。VAPID 密钥首次使用时生成，存于 `$DSH_HOME/dsh-palm-notify.json`；手机通过 `pushManager` 订阅，以配对 cookie 作为订阅身份。失效订阅（推送服务返回 410/404）自动清理。出站投递优先读 `DSH_PALM_PUSH_PROXY`，其次 `HTTPS_PROXY` / `HTTP_PROXY`——部分网络（国内）不配代理无法到达 FCM。

**L3（第三方）。** Server酱（微信）、Bark（iOS）、Telegram webhook 在应用完全关闭、浏览器退出后仍能送达。凭据只存宿主端，设置面只显示各渠道是否已配置。

### 用法

1. 打开手机端设置页 → **通知**卡片
2. 按提示允许通知权限
3. 调整**时长阈值**（长回复触发）与**冷却间隔**（同会话节流）
4. 打开 **Web Push** 开关订阅当前浏览器（L2）
5. 可选配置 **L3 渠道**：
   - **Server酱** —— 在 [sct.ftqq.com](https://sct.ftqq.com) 注册（微信扫码），把 SendKey（`SCT…`）填入设置页
   - **Bark** —— 安装 Bark 应用（iOS），复制设备 key
   - **Telegram** —— 通过 @BotFather 创建机器人，获取 bot token 与 chat id
6. 点**「发送测试」**把一条合成事件端到端推过已配置的 L3 渠道

### 注意事项

- L1 依赖应用存活（SSE 连接）；锁屏或系统杀掉浏览器后失效
- L2 依赖浏览器运行；部分国产 ROM（OPPO/vivo、小米、华为）即使装了 Google 服务也会拦截 FCM 通道——请改用 L3
- iOS Safari 的 Web Push 需要 PWA 添加到主屏幕（16.4+）
- 设置页测试按钮只走 L3；L2 需通过完成真实任务验证

## 安装

**已在 dsh 0.1.1-rc.1 上测试**。rc 版本之间的插件 API 可能变化；若使用其他 dsh 版本，安装后请验证配对面板与 `/m/` 界面。

从 npm 安装：

```sh
dsh plugin --profile web add @eternalloveone/dsh-palm
```

从源码安装：

```sh
git clone https://github.com/Eternalloveone/dsh-palm.git
dsh plugin --profile web add link:/path/to/dsh-palm/packages/dsh-palm
```

切换安装来源后，已配对设备继续可用（格式与 dsh-remote-web-ui 一致）。

## 远程访问配置

点侧边栏手机图标打开配对面板，按三步向导操作：**配置 → 配对 → 使用**。

1. **配置** —— 填写手机可达的公网地址（frp / Cloudflare Tunnel / Tailscale）。面板会自动检测本机隧道并给出具体入口建议；保存前先验证可达性。
2. **配对** —— 手机扫码，或直接输入面板上的 6 位配对码。
3. **使用** —— 已配对设备在简洁的状态视图中管理。

完整教程（含 frp 拓扑实例：服务器 frps + nginx TLS、客户端 frpc、面板配置、验证与常见问题）见[远程访问配置手册](packages/dsh-palm/docs/remote-access-guide.md)。

## 性能

各接入路径下 `/m/` 壳页的端到端延迟，国内客户端实测（每条路径 20 次顺序请求，Node HTTP 客户端，2026-09）：

| 接入路径 | min | P50 | P95 | max |
|---|---|---|---|---|
| 本机回环 | 1ms | 2ms | 4ms | 9ms |
| frp 直连（HTTP） | 10ms | 14ms | 27ms | 35ms |
| nginx TLS（受信证书） | 13ms | 15ms | 24ms | 57ms |
| Cloudflare Tunnel | 405ms | 413ms | 463ms | 1209ms |

**nginx TLS 路径是推荐公网入口**：受信证书（可安装 PWA）且接近直连延迟；Cloudflare Tunnel 仅作备用——其边缘绕路在国内网络下约慢 20-30 倍。可用 `scripts/measure-paths.mjs` 复测（URL 通过参数或 `DSH_PALM_PATHS` 环境变量传入）。

## 开发

```sh
pnpm install        # 在 packages/dsh-palm 内
pnpm test           # vitest 全量测试
pnpm typecheck      # tsc -b
pnpm build          # tsc -b && tsdown -> lib/index.js + lib/mobile.js
```

## 架构

- **宿主侧**（`src/`）：配对（`pairing.ts`）、`/api/pair` 路由（`routes.ts`）、`api/gate` 监听器（`gate.ts`）、`/m/` 页面路由（`mobile-routes.ts`）、带 `events.mux` SSE 桥的 `/m/api` RPC 通道（`mobile-api.ts`）、方法白名单与通道规则（`remote-methods.ts`）
- **移动端**（`src/mobile/`）：独立手机端打包 —— ChatView、工作区、审批、图片上传、mux、rpc、样式
- **测试**：`tests/` + `src/**/*.test.*`（vitest）

## 安全

设备信任通过扫码或输入 6 位配对码建立；每次 `/m/api` 调用都由配对 cookie 与方法白名单把关。`/m/` 页面提供以下 Content-Security-Policy 作为渲染器之后的最后防线：

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; connect-src 'self'; font-src 'self' data:; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

- **未知方法被拒、宿主错误细节不回显给手机** —— 由 `tests/mobile-api.spec.ts` 覆盖（如 "does not leak the host command error message to the phone"）
- **吊销是服务端即时生效的** —— 被撤销设备的下一请求在 `api/gate` 监听器处 403；手机端停止轮询并回到配对页
- **配对码防暴力破解** —— `/api/pair/accept` 有速率限制（30 秒窗口：每源 IP 40 次、每 XFF hop 10 次），令牌默认 10 分钟过期，未知或已用密钥统一返回 `invalid`（无有效性 oracle）；由 `tests/routes.spec.ts` 覆盖
- **宿主语音转写 API key 绝不离开宿主** —— 手机端仅见展示信息
- **审批应答绑定所属设备会话** —— 多端不能互相抢占
- **未经审计** —— 本项目未经过第三方安全审计，上游 dsh 项目本身也是开发者预览版。在受信网络之外暴露部署前，请自行审阅配对与 gate 源码

漏洞报告流程与部署注意事项见 [SECURITY.md](SECURITY.md)。

## 项目文档

- [CHANGELOG.md](CHANGELOG.md) —— 版本历史
- [CONTRIBUTING.md](CONTRIBUTING.md) —— 开发环境与贡献指南
- [SECURITY.md](SECURITY.md) —— 漏洞报告

## 许可证

Apache-2.0 —— 见 [LICENSE](LICENSE)。本项目是 [dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web) 的衍生作品；详见 [NOTICE](packages/dsh-palm/NOTICE)。英文版为本文档的权威版本，中文版随其更新。
