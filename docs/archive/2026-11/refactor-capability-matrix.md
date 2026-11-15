# dsh-palm 重构能力与验收矩阵

> 新页面只有在入口、用户动作、服务端结果和失败/离线状态都验证后，才能替换当前页面。以下是现有验证的起点；本次未运行产品测试，也不把单个单测视作完整设备旅程的证明。
>
> 路径缩写：S = packages/dsh-palm/src；M = S/mobile；T = packages/dsh-palm/tests；C = tools/mobile-scenarios/scenarios。表中的文件组表示应在阶段 0 清点对应现有测试并记录缺口，不等于已覆盖。

| 能力域 | 必须保留的行为 | 验证起点 |
|---|---|---|
| 安全配对 | QR/六位码、信任/撤销、设备归属、限流 | T/pairing.spec.ts、pair-schema.spec.ts、routes.spec.ts、gate.spec.ts |
| 桌面面板 | 地址探测/保存、配置→配对→使用、设备管理 | S/client/PublicUrlConfig.test.tsx；T/remote-contract.spec.ts、remote-entry.spec.tsx |
| RPC 兼容 | 白名单、cookie 校验、错误脱敏、既有方法/导出兼容 | T/mobile-api.spec.ts；M/platform/api-exports.test.ts；T/golden/dispatch-methods.json、api-exports.json |
| 实时恢复 | 唯一 Mux、rpcId、断流回补、恢复不重复 | M/stream/mux.test.ts；M/kernels/host-bridge.test.ts；C/reconnect-backfill.mjs |
| 会话/工作区 | 创建/重命名/删除/归档、切换、隔离 | C/session-rename-and-archive.mjs、workspace-isolation.mjs、switch-session-keep-state.mjs |
| 导航与抽屉 | 最近会话、搜索/设置/产物、深链接、返回恢复 | M/architecture-routes.test.ts；T/deep-link.spec.ts；C/cross-page-round-trip.mjs |
| 运行总览 | 跨工作区在跑/刚结束、后台任务、打开对应会话 | tools/mobile-verify/cases/runs.mjs；C/background-return.mjs、running-state-latency.mjs |
| 正文/流式 | 增量合并、稳定 key、thinking 折叠、Markdown/代码 | M/message-row/ 与 M/render/ 测试组；T/golden/chat-trace.json；tools/mobile-render-audit/ |
| 发送/停止/重生成 | IME 安全、慢回执、失败不丢草稿、停止语义 | M/runtime/chat/store.test.ts；M/views/chat/hooks/use-chat-composer.test.tsx；C/ime-composing-send.mjs、send-slow-response.mjs、send-really-fails.mjs、stop-mid-turn.mjs |
| 草稿/附件会话隔离 | 会话切换恢复、重挂载保留、失败可重试 | M/views/chat/hooks/use-chat-draft.test.tsx、use-chat-attachments.test.tsx；C/switch-session-keep-state.mjs |
| 队列/插话/outbox | 编辑/删除/撤回/插话、离线发送、回执对账 | M/components/queue-dock.test.tsx；M/stream/session-store.test.ts、session-status.test.ts；C/queue-while-running.mjs、offline-queue-drain.mjs |
| 任务/目标/子代理 | todo/goal/jobs/subagents、未知/失败/取消 | M/components/goal-bar.test.tsx；M/render/run-status.test.tsx；M/stream/session-status.test.ts；C/subagent-roundtrip.mjs |
| 审批/提问 | 理由/影响范围、允许/拒绝/回答、session 绑定 | M/approval-panel.test.tsx；M/session/approval-batches.test.ts；T/mobile-api.spec.ts；C/approval-decide.mjs |
| 斜杠命令 | 发现/插入/编辑参数、命令卡生命周期 | M/trigger-card.test.tsx；M/message-row/blocks.test.tsx；C/command-card-lifecycle.mjs |
| 文件/图片 | 选取/粘贴/压缩/移除/上传、Host 文件引用、错误提示 | M/platform/attachment-images.test.ts；M/views/chat/hooks/use-chat-attachments.test.tsx；C/attachment-upload.mjs |
| 语音 | 录音/转写/字幕、服务配置、离开释放录音资源 | M/views/chat/hooks/use-chat-voice.test.tsx；M/data/voice.ts；真实设备权限/录音人工验证 |
| 搜索 | 全局/工作区范围、中文短词、命中高亮定位 | M/views/chat/lib/chat-search-match.test.ts；tools/mobile-verify/cases/search.mjs；C/search-and-jump.mjs |
| 长会话 | 历史分页、锚点/回底、回合导航和深跳 | M/views/chat/hooks/use-chat-history.test.tsx；M/components/turn-scrubber.test.tsx；C/long-session-window.mjs、long-scroll-anchor.mjs |
| Diff/代码操作 | review/accept/reject、复制/插入/打开/下载/执行 | M/components/diff-rows.test.tsx；tools/mobile-verify/cases/cards.mjs；C/select-and-copy.mjs；需按当前 action 能力补集成场景 |
| 产物与预览 | 交付摘要、Markdown/HTML/代码/图片、灯箱、失败状态 | M/components/file-preview-sheet.test.tsx、image-lightbox.test.tsx；C/preview-media-and-code.mjs、file-preview-failure.mjs |
| 缓存与错误 | cache-first、水合、刷新、未知会话、可重试 | M/cache-adoption.test.ts、M/data/read-coalescing.test.ts；C/read-cache-first.mjs、error-paths.mjs、turn-state-authoritative.mjs |
| 设置/主题/使用量 | 现有设置项、明暗/皮肤/字号、供应商用量与余额 | M/api/settings.test.ts、M/design/tokens.test.ts、M/mobile-theme.test.ts；C/settings-apply-instantly.mjs |
| 通知 | 站内/Web Push/外部通道、分类开关、门槛和冷却 | S/notify/notify-engine.test.ts、notify-deliver.test.ts、notify-store.test.ts；M/platform/notify.test.ts；真机通知验证 |
| PWA/更新 | 安装、SW 更新、冷启动、旧 chunk 恢复、offline outbox | T/mobile-pwa.spec.ts、mobile-service-worker.spec.ts；M/platform/chunk-recovery.test.ts；C/pwa-cold-start.mjs |
| 体验与无障碍 | 安全区、键盘、返回焦点、放大、触控、无溢出 | tools/mobile-verify/、tools/mobile-visual/；iOS Safari/PWA 与 Android Chrome 真机验收 |

## 各项完成记录

迁移切片交付时，向 docs/refactor-progress.md 写入：能力 ID/名称、测试命令与退出码、场景/截图报告、设备/浏览器、状态。状态只有“通过 / 失败 / 未测 / 受上游或设备限制”，失败和未测不得当通过。

保留项目已有手势能力（如回合 scrubber）与删除/撤销确认行为；新稿“无新增手势”不等于移除已有功能。对上游 SDK 已退化的能力记录基线及降级方式，不承诺本次重构修复 SDK 缺失。

只读场景不得在真实会话里发送消息；写入型场景需单独的 PALM_TEST_SESSION，并遵守 runner 对新会话/自动归档的保护。视觉截图证明外观而非交互；单测证明局部契约而非完整旅程。
