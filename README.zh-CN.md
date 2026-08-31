# dsh-palm

[English](README.md) | [简体中文](README.zh-CN.md)

掌上 dsh —— dsh web GUI 的独立移动端界面。

[dsh](https://github.com/deepseek-ai/deepseek-harness) web GUI 的独立移动端界面：扫码配对设备信任、`/m/` 手机端 UI、带实时 SSE mux 桥的 `/m/api` RPC 通道，以及桌面端配对面板。

## 衍生声明

dsh-palm 是 [dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web)（`@linxin666/dsh-remote-web-ui`，Apache-2.0，作者 zhu1090093659）的**衍生作品**。详见 [NOTICE](packages/dsh-palm/NOTICE)。

## 截图

| | |
|---|---|
| ![工作区](docs/screenshots/workspace.png) | **工作区** —— 项目列表，支持搜索、固定与最近访问 |
| ![会话列表](docs/screenshots/sessions.png) | **会话列表** —— 项目内会话按天分组，带新建会话按钮 |
| ![聊天](docs/screenshots/chat.png) | **聊天** —— 流式 Markdown，带工具标签、可交互 diff 卡片与语法高亮代码块 |
| ![Diff 卡片](docs/screenshots/diff.png) | **Diff 卡片** —— `diff` 代码块渲染为可交互卡片，支持接受 / 拒绝 |
| ![图片上传](docs/screenshots/attach.png) | **图片上传** —— 粘贴或选择图片，发送前自动压缩 |
| ![设置](docs/screenshots/settings.png) | **设置** —— 显示、主题与消息可见性偏好 |
| ![配对](docs/screenshots/pair.png) | **配对** —— 扫码建立设备信任 |

## 创新点

以下为相对上游 [dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web) 的独立创新点（上方的配对/信任模型继承自上游）。

**架构**

- **独立手机端界面（`/m/`）** —— 独立构建的手机 bundle，而非在桌面 GUI 上注入 CSS 适配层；上游 UI 重构不会影响手机端
- **零依赖渲染栈** —— 自研 GFM 子集 markdown 渲染器（先转义、协议白名单）、轻量语法高亮器、unified diff 解析器；打包约 835 KB（gzip 195 KB）
- **方法级白名单 RPC** —— `/m/api` 只暴露显式白名单 + 手机端本地方法；错误响应不泄露宿主路径与方法名

**实时**

- **手机端与桌面端实时同步** —— 两端共享同一条宿主事件流；实测端到端延迟（桌面触发 → 手机端 mux 帧）：本机回环中位数 4ms、公网隧道中位数 9ms、Tailscale 中位数 13ms、弱网（模拟 200ms 延迟）中位数 246ms
- **SSE mux 桥 + 轮询回退** —— 停滞检测（活跃流 36s）自动启动自适应历史轮询；事件不丢，SSE 恢复后立即切回；设备被撤销后停止轮询并回到配对页，而非无限空转
- **窗口化流式渲染** —— 只渲染可见前缀，长回复保持流畅
- **增量流式预览** —— 未闭合尾部按 chunk 增量转义（每帧 O(chunk)，不再整段重扫），短块保留行内 Markdown 提升；无打字机光标
- **推理块折叠** —— 正文中的思考内容折叠为可展开块

**交互**

- **Diff 卡片** —— 容忍模型退化形状的 diff 解析 + 词级 LCS 标记，支持接受 / 拒绝 / 评审，多文件编辑在调用时间点合并；流式 chunk 间保持稳定引用（不再逐 token 重排）
- **代码操作** —— 复制、插入编辑器、打开、下载、沙箱运行；文件路径自动链接到宿主打开器
- **命令卡片** —— slash 命令发现与执行，带运行中 / 成功 / 失败生命周期
- **审批与问题面板** —— 工具审批实时推送、就地解决；应答绑定所属设备会话（多端不能互相抢占）
- **图片上传** —— 粘贴或选择；canvas 压缩把载荷控制在固定预算内；超限与解码失败以 toast 提示而非静默丢弃
- **语音输入与转写** —— 浏览器内 WAV 录音（60s 自动收尾、离开页面自动清理），OpenAI 兼容多服务按序回退（默认 SenseVoiceSmall），手机端可管理服务列表；宿主配置的服务仅作展示——宿主 API key 绝不离开宿主
- **插件市场** —— 手机端浏览、搜索、安装插件
- **会话管理** —— 聊天更多菜单或列表长按删除会话；离线发件箱随会话一并清理
- **输入法安全** —— 中文输入法组合期间不会误发半截拼音

**离线与弱网**

- **PWA** —— 可安装、带版本号的服务工作者、可离线使用的打包产物
- **离线发件箱** —— 断网时消息排队（IndexedDB + 内存回退），联网自动发送；sending 标志防止崩溃后重复投递；支持单条移除，永久失败条目自动清理
- **gzip 压缩 API 响应** —— 弱网友好
- **按需加载** —— 工作区列表轻量拉取；会话只在打开时加载

**体验**

- **桌面级设置同步** —— 手机端设置与桌面同步（schema 表单、级联模型选择、权限预设）
- **显示偏好** —— 字号、密度、行号、自动滚动
- **主题联动** —— 桌面主题偏好同步到手机
- **会话列表** —— 完整项目名、按 cwd 过滤、完整时间戳

## 功能

- **扫码配对设备信任** —— 手机扫码完成配对；设备持久化在 `$DSH_HOME/remote-web-ui-devices.json`，切换安装来源后继续可用
- **桌面端配对面板** —— 在 dsh web GUI 中管理已配对设备
- **`/m/` 手机端 UI** —— 聊天、工作区、审批、图片上传；代码块带语法高亮、行号与 diff 卡片
- **`/m/api` RPC 通道** —— 方法白名单 + 通道规则，配 `events.mux` SSE 桥实现实时更新
- **手机端与桌面端实时同步** —— 两端共享同一条事件流；实测端到端延迟：本机回环 4ms、公网隧道 9ms、Tailscale 13ms（中位数）
- **干净的流式输出** —— 窗口化前缀渲染、增量转义尾部预览、无打字机光标
- **推理块折叠** —— 正文中的思考内容折叠为可展开块
- **Diff 卡片** —— `diff` 代码块渲染为可交互卡片，支持接受 / 拒绝 / 评审
- **代码操作** —— 复制、插入编辑器、打开、下载、沙箱运行；文件路径自动链接到宿主打开器
- **命令卡片** —— slash 命令发现与执行，带运行中 / 成功 / 失败生命周期
- **审批与问题面板** —— 工具审批实时推送、就地解决
- **图片上传** —— 粘贴或选择；canvas 压缩把载荷控制在固定预算内
- **语音输入与转写** —— 浏览器内 WAV 录音，OpenAI 兼容多服务按序回退（默认 SenseVoiceSmall）
- **插件市场** —— 手机端浏览、搜索、安装插件
- **会话删除** —— 聊天更多菜单或列表长按；同时清理该会话的离线发件箱
- **PWA** —— 可安装、带版本号的服务工作者、可离线使用的打包产物
- **离线发件箱** —— 断网时消息排队（IndexedDB），联网自动发送；崩溃安全（sending 标志）、支持单条移除
- **gzip 压缩 API 响应** —— 弱网友好
- **按需加载** —— 工作区列表轻量拉取；会话只在打开时加载
- **桌面级设置同步** —— 手机端设置与桌面同步（schema 表单、级联模型选择、权限预设）
- **显示偏好** —— 字号、密度、行号、自动滚动
- **主题联动** —— 桌面主题偏好同步到手机
- **会话列表** —— 完整项目名、按 cwd 过滤、完整时间戳

## 安装

要求 dsh >= 0.1.1-rc.1。

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

设备信任通过扫码配对建立；每次 `/m/api` 调用都由配对 cookie 与方法白名单把关。`/m/` 页面提供严格 Content-Security-Policy 作为渲染器之后的最后防线；宿主语音转写 API key 绝不离开宿主（手机端仅见展示信息）；审批应答绑定所属设备会话；宿主错误细节不回显给手机。详见配对与 gate 源码，以及 [SECURITY.md](SECURITY.md) 的漏洞报告流程与部署注意事项。

## 项目文档

- [CHANGELOG.md](CHANGELOG.md) —— 版本历史
- [CONTRIBUTING.md](CONTRIBUTING.md) —— 开发环境与贡献指南
- [SECURITY.md](SECURITY.md) —— 漏洞报告

## 许可证

Apache-2.0 —— 见 [LICENSE](LICENSE)。本项目是 [dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web) 的衍生作品；详见 [NOTICE](packages/dsh-palm/NOTICE)。
