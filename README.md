# dsh-palm

[简体中文](README.md) | [English](README.en.md)

[![npm version](https://img.shields.io/npm/v/@eternalloveone/dsh-palm)](https://www.npmjs.com/package/@eternalloveone/dsh-palm)
[![CI](https://img.shields.io/github/actions/workflow/status/Eternalloveone/dsh-palm/ci.yml)](https://github.com/Eternalloveone/dsh-palm/actions)
[![License](https://img.shields.io/github/license/Eternalloveone/dsh-palm)](https://github.com/Eternalloveone/dsh-palm/blob/main/LICENSE)

**2.0.0** · 把 [dsh](https://github.com/deepseek-ai/deepseek-harness) 桌面端搬到手机上：同一个会话、同一份进度，手机只做手机该做的事——看进度、回消息、点审批、管会话。

> 手机不是第二个工作台。装插件、改权限预设这类事还是回桌面做。

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
| **看它在忙什么** | 一屏看清所有工作区正在跑什么、做到哪一步、跑了多久；点进去直接到那个会话 |
| **回消息** | 打字、拍照、发文件、语音输入；一轮还没跑完也能先排队，发出去之前还能改 |
| **点审批** | 要你同意的事直接推到手机，当场同意或拒绝，不会被别的设备抢答 |
| **管会话** | 长按重命名、删除、置顶；搜索一句话定位到某个会话里的某条消息 |
| **等结果** | 跑完或者长回复写完，手机会响——微信、iOS、Telegram 都行 |
| **换个样子** | 19 套皮肤，还能换成自己的照片当背景 |

完整清单见 [能力清单](docs/capabilities.md)。

## 2.0 有什么不一样

1. **打开就有内容**：以前进会话先出一个空壳再慢慢长出来，现在一屏就是完整对话
2. **滑起来不卡**：长会话不再把几百条消息一次性塞进页面，滑到哪算哪
3. **19 套皮肤**：不是换个颜色，每套有自己的图标和背景，还能换成你自己的照片
4. **断线不乱**：信号断了会自动降级，好了自己切回来，不会再"停在那儿不动"

升级要注意什么（比如需要重新扫码）见 [UPGRADING](UPGRADING.md)。

## 装在哪、怎么连

| 你想要的 | 怎么做 |
|---|---|
| 同一个家里 / 办公室用 | 手机连同一 Wi-Fi，面板给出建议地址，点一下就用 |
| 在外面也能用 | 两台设备装 Tailscale，面板一键认出你的域名 |
| 已经有隧道 | frp / Cloudflare Tunnel 地址填进面板，保存前先试通不通 |

三种方式的配法和排错见 [远程接入](docs/remote-access.md)。

## 常见问题

**手机打开是白屏 / 打不开**
先确认手机和电脑在同一个网络、路由器没开"客户端隔离"、防火墙放行了端口。地址建议直接用面板给的那个。

**收不到通知**
先点设置页的"发送测试"。测试成功但任务不响，是时长阈值或冷却挡住了；测试也失败，是那个渠道的 token 不对。详见 [通知](docs/notifications.md)。

**能不能连多台手机**
可以。每台是一个独立设备，可以单独撤销，撤销后那台立刻失效。

**换了电脑 / 重装了 dsh**
重新扫码配对一次。设备表在 `$DSH_HOME/dsh-palm-devices.json`，跟着这个目录走。

**用久了变卡**
先退出重进（缓存会自动校正）；还不行就把现象告诉我，出错记录本机会留一份。

## 版本与兼容

| 项 | 要求 |
|---|---|
| dsh | `>=0.2.1-rc.2 <0.3.0-0` |
| Node | `^22.19.0` 或 `>=24.0.0` |
| 手机 | Android 用 Chrome / Edge / Firefox；iOS 用 Safari 并"添加到主屏幕"才能装成应用 |

手机端和宿主是分开升级的，升其中一边不会让另一边挂掉。逐版本对应关系见 [COMPATIBILITY.md](COMPATIBILITY.md)。

## 更多

- [文档索引](docs/README.md)：设计契约、通知、远程接入、真机验证
- [开发与发版](RELEASING.md)
- 出处：[dsh-remote-web-ui](https://github.com/zhu1090093659/dsh-web)（Apache-2.0）的衍生作品，界面与接口是重写的；细节见 [NOTICE](packages/dsh-palm/NOTICE)
- License：[Apache-2.0](LICENSE)
