# dsh-palm 文档索引

这里只有**仍在维护**的文档。历史计划、审计、性能报告都在 [archive/2026-11](archive/2026-11/)，不再更新。

判断标准：描述**当前系统不变量/契约**的留在这里；记录某一轮怎么做、当时结论是什么的，进存档。

## 一、给用的人

| 文档 | 讲什么 |
|---|---|
| [README](../README.md) | 3 条命令装上、扫码配对、日常怎么用 |
| [UPGRADING](../UPGRADING.md) | 从 1.x 升到 2.0 要注意什么 |
| [notifications](notifications.md) | 通知三通道（应用内 / Web Push / 微信等）怎么配 |
| [remote-access](remote-access.md) | 手机怎么访问到这台机器：局域网、Tailscale、frp |
| [capabilities](capabilities.md) | 完整能力清单（README 里只放 6 条） |
| [COMPATIBILITY](../COMPATIBILITY.md) | dsh-palm × DSH 版本矩阵 |

## 二、设计契约（改代码前先看）

| 文档 | 讲什么 |
|---|---|
| [architecture](architecture.md) | 现状架构：20 个目录职责、数据流、五个关键机制、门禁 |
| [MOBILE-RENDERING](MOBILE-RENDERING.md) | 渲染模型：一条消息怎么变成一屏 |
| [RENDER-ARCHITECTURE](RENDER-ARCHITECTURE.md) | 渲染重构：八类现象 → 四条根因 → 五个所有者，含执行记录与止损结论 |
| [layout-contract](layout-contract.md) | 布局规则（滚动区唯一、必填槽恰好一次） |
| [UI](UI.md) | 怎么改：分层、加功能的路径、门禁清单、欠账 |
| [mobile-picture-coherence](mobile-picture-coherence.md) | 画面一致性判定（什么时候算"看着对"） |

## 三、验证与真机

| 文档 | 讲什么 |
|---|---|
| [MOBILE-TEST-MODEL](MOBILE-TEST-MODEL.md) | 测试分层：单测 / 场景 / 真机各管什么 |
| [MOBILE-VISUAL-GATE](MOBILE-VISUAL-GATE.md) | 视觉门禁怎么跑、判据是什么 |
| [MOBILE-DEVICE-SOP](MOBILE-DEVICE-SOP.md) | 真机取证 SOP（抓 LoAF、留证据） |
| [visual-acceptance](visual-acceptance.md) | 视觉验收清单 |

## 四、专题

| 文档 | 讲什么 |
|---|---|
| [skin-porting-guide](skin-porting-guide.md) | 怎么移植一套新皮肤 |
| [plan-live-render-self-heal](plan-live-render-self-heal.md) | 实时消息静默不落地的根因与三条不变量 |

## 存档说明

`archive/2026-11/` 里 45 份是 2026-09 ~ 11 的计划、审计与性能报告。它们记录了当时的判断依据和实测数字，**结论多数已被后续修复推翻**，读的时候只看"当时怎么定位"这一层，别当现状。
