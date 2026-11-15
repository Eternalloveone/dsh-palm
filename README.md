# dsh-palm

[简体中文](README.md) | [English](README.en.md)

[![npm version](https://img.shields.io/npm/v/@eternalloveone/dsh-palm)](https://www.npmjs.com/package/@eternalloveone/dsh-palm)
[![CI](https://img.shields.io/github/actions/workflow/status/Eternalloveone/dsh-palm/ci.yml)](https://github.com/Eternalloveone/dsh-palm/actions)
[![License](https://img.shields.io/github/license/Eternalloveone/dsh-palm)](https://github.com/Eternalloveone/dsh-palm/blob/main/LICENSE)

**2.0.0** · 把 [dsh](https://github.com/deepseek-ai/deepseek-harness) 桌面端搬到手机上：同一个会话、同一份进度，手机只做手机该做的事——看进度、回消息、点审批、管会话。

> 手机不是第二个工作台。复杂配置（装插件、改权限预设）还是回桌面做。

## 三条命令开始

```sh
# 1. 装插件
dsh plugin --profile web add @eternalloveone/dsh-palm

# 2. 重启 dsh，让它加载（按你平时的方式，例如）
dsh web
```

```text
# 3. 桌面侧边栏点「手机」图标 → 手机扫码，或手输面板上的 6 位码
```

就这样。手机能打开 `/m/` 就算装好了。

> 手机和电脑不在同一个网络？看 [手机怎么访问到这台机器](docs/remote-access.md)。

## 它能干什么

| 场景 | 手机上能做 |
|---|---|
| **看它在忙什么** | 一屏看清所有工作区正在跑什么、第几步、跑了多久；点进去直接到那个会话 |
| **回消息** | 打字、拍照、发文件、语音输入；一轮没跑完还能排队、改、撤回 |
| **点审批** | 工具审批和提问实时推到手机，就地同意或拒绝，不会被别的设备抢答 |
| **管会话** | 长按重命名 / 删除 / 置顶；全局搜索一句话定位到某个会话的某条消息 |
| **等结果** | 跑完或长回复写完，手机会响——微信（WxPusher / 服务器酱）、iOS（Bark）、Telegram 都行 |
| **换个样子** | 19 套皮肤 + 换壁纸，点头像就换 |

完整清单（约 50 项）见 [能力清单](docs/capabilities.md)。

## 2.0 有什么不一样

1. **首屏一次成型**：以前进会话先出一张空壳、再长出来，现在一屏直接是完整内容。切会话不再重复读同一份日志（请求 6→3、数据 510KB→255KB）
2. **消息列表不再堆 DOM**：只挂最近 12 行，往上滑再补。97 行 → 13 行，滚动卡顿 p95 从 229~392ms 降到 81ms
3. **19 套皮肤**：不是换色，每套带自己的笔画、图标和背景（液态玻璃、赛博夜、龙裔、初音、我的世界、XP、深海流淌……）
4. **不丢消息、不装死**：实时流断了自动退轮询，恢复自动切回；发现落后一屏就补拉；界面卡住有人兜底。规则见 [实时自愈](docs/plan-live-render-self-heal.md)

升级注意（要重新扫码、缓存会重拉等）见 [UPGRADING](UPGRADING.md)。

## 装在哪、怎么连

| 你想要的 | 怎么做 |
|---|---|
| 同一个家里/办公室用 | 手机连同一 Wi-Fi，面板给出建议地址，点一下就用 |
| 在外面也能用 | 两台设备装 Tailscale，面板一键认出你的域名 |
| 已经有隧道 | frp / Cloudflare Tunnel 地址填进面板，保存前先探测通不通 |

三种方式的配法、延迟对比和排错见 [远程接入](docs/remote-access.md)。

## 常见问题

**手机打开是白屏 / 打不开**
先确认手机和电脑在同一网络、路由器没开"客户端隔离"、防火墙放行了端口。地址建议直接用面板给的那个。

**收不到通知**
先点设置页的"发送测试"。测试成功但任务不响 → 是时长阈值或冷却挡了；测试也失败 → 那个渠道的 token 无效。完整排错见 [通知](docs/notifications.md)。

**能不能连多台手机**
可以。每台是一个独立设备条目，可以单独撤销；撤销后那台立刻失效。

**换了电脑 / 重装了 dsh**
重新扫码配对一次。设备表在 `$DSH_HOME/dsh-palm-devices.json`，跟着这个目录走。

**用久了变卡 / 界面卡住**
先下拉重进（缓存会自动校正）；仍不行，错误记录在 `~/.dsh/dsh-palm-errors`，可以直接发我。

## 版本与兼容

| 项 | 要求 |
|---|---|
| dsh-palm | 2.0.0 |
| dsh | `>=0.2.1-rc.2 <0.3.0-0` |
| Node | `^22.19.0` 或 `>=24.0.0` |
| 手机 | Android Chrome/Edge/Firefox；iOS 需 Safari 且"添加到主屏幕"才能装 PWA |

`/m/api` 的方法面和帧格式**只增不改**，旧的手机端不会因为升级宿主而挂。逐版本矩阵见 [COMPATIBILITY.md](COMPATIBILITY.md)。

## 更多文档

[文档索引](docs/README.md)：设计契约、渲染模型、真机验证 SOP、皮肤移植手册。

## 开发

```sh
pnpm install
pnpm test        # 4074 例
pnpm typecheck
pnpm build
```

发版前四道门禁：`pnpm verify:mobile`、`verify:secrets`、`verify:adapt`，以及 `node tools/check-budget.mjs`。流程见 [RELEASING.md](RELEASING.md)。

## 来源声明

dsh-palm 是 [dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web)（`@linxin666/dsh-remote-web-ui`，Apache-2.0）的衍生作品，细节见 [NOTICE](packages/dsh-palm/NOTICE)。

继承：配对协议、原始设备表格式、桌面面板骨架。
独立：整个 `/m/` 界面、渲染栈、`/m/api` 白名单与 SSE mux、离线层。自 v1.3.0 起运行时契约全部改用 dsh-palm 自己的名字。

## License

[Apache-2.0](LICENSE)
