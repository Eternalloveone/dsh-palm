#!/usr/bin/env node
/**
 * 场景压测集（P0）说明。
 *
 * ## 为什么要它
 *
 * 现有的四层测试各有盲区：
 *   · 单测（2162 条）—— 只测纯逻辑，测不到时序与真实网络；
 *   · `mobile-verify`（41 条 / 8 组）—— 单场景"这件事能不能做完"；
 *   · `mobile-render-audit`（5 页）—— 每页跑一次，看首帧/单调/重复 key；
 *   · `stress-entry` / `stress-proc` —— 只覆盖聊天页那一条链。
 *
 * 这一周的疑难杂症（重复过程卡、过程条消失、交付卡提前出现、卡片被改写、
 * 灰点不变绿、假失败）**没有一个是单次操作断言能抓到的** —— 它们都要
 * "某个顺序 + 某个中间态"。这一层就是补这个空档：**用户旅程级**的连续压测。
 *
 * ## 用法
 *
 * ## 铁律：场景**绝不新建会话**、默认**绝不发消息**
 *
 * 2026-10-31 出过事故：场景把测试提示词发进了用户正在聊的会话（用户在会话里
 * 直接看到「用 bash 跑 python -c ...」「场景排队 1221」）。因此现在：
 *
 * | 类别 | 场景 | 默认是否运行 |
 * |---|---|---|
 * | 只读（10 个） | `cross-page-round-trip`、`background-return`、`long-session-window`、`search-and-jump`、`reconnect-backfill`、`long-scroll-anchor`、`weak-network-3g`、`two-devices-same-session`、`pwa-cold-start`、`error-paths` | **跑** |
 * | 会发消息（`manual`，9 个） | `queue-while-running`、`send-slow-response`、`offline-queue-drain`、`running-dot-lifecycle`、`approval-decide`、`command-card-lifecycle`、`attachment-upload`、`subagent-roundtrip`、`ime-composing-send` | **不跑**，必须 `--manual` + `PALM_TEST_SESSION` |
 *
 * 覆盖面（用户旅程）：进会话 / 跨页往返 / 切后台 / 长会话反复进 / 搜索定位 /
 * SSE 断流补齐 / 长会话滚动锚点 / 3G 弱网 / 双设备一致 / PWA 冷启与清缓存 /
 * 打不开的会话 / 排队连点 / 慢回执 / 通道不可用 / 绿点生命周期 / 审批拒绝 /
 * 命令卡片落定 / 附件上传 / 子代理往返 / 输入法组合态。
 *
 * 已知观感问题（记录、不判红）：断流恢复后"输出中/连接中断"的状态 chip 可能
 * 60 秒内仍停在"连接中断"，但数据已完全恢复（不丢行不重复）。
 *
 * 只读 7 个覆盖的用户动作：进会话 / 跨页往返 / 切后台 / 长会话反复进 / 搜索定位 /
 * SSE 断流补齐 / 长会话滚动锚点 / 3G 弱网。发消息 6 个覆盖：排队连点 / 慢回执 /
 * 通道不可用 / 绿点生命周期 / 审批拒绝 / 命令卡片落定。
 *
 * 另外两道硬约束：
 *   1. `PALM_TEST_SESSION` 与只读会话相同 → **直接拒绝发送**（`FAIL … 拒绝发消息`）；
 *   2. 跑完核对会话总数，涨了就是违规（`no-new-sessions`）。
 *
 * `createScratchSession()` 已删除 —— 永不新建会话。
 *
 * ```bash
 * node tools/mobile-scenarios/run.mjs                     # 只跑只读场景 ×1
 * node tools/mobile-scenarios/run.mjs --repeat=3          # 抓偶发（这几天的问题都是"有时候"）
 * node tools/mobile-scenarios/run.mjs --manual              # 连会发消息的场景一起（需 PALM_TEST_SESSION）
 * node tools/mobile-scenarios/run.mjs --only=queue-while-running --manual
 * node tools/mobile-scenarios/run.mjs --headed            # 看着它跑
 * node tools/mobile-scenarios/run.mjs --list
 * ```
 *
 * 环境变量：`PALM_SESSION`（跨页场景要一条有内容的会话）、`PALM_WORKSPACE`、
 * `PALM_PAIR`、`PALM_BASE`、`PALM_PLAYWRIGHT`。
 *
 * ## 场景与判据
 *
 * | 场景 | 覆盖的用户旅程 | 主要判据 |
 * |---|---|---|
 * | `cross-page-round-trip` | 聊天 ↔ 列表 ↔ 首页 ↔ 运行中 ×3 | 行数单调、无重复 key、过程条在、卡片文案不变、贴底 |
 * | `search-and-jump` | 首页搜索 → 点结果 → 进会话 | 搜得到、跳得动、落地有内容、无重复身份 |
 * | `reconnect-backfill` | SSE 断 8 秒再恢复 | 断流不掉行、恢复不重复、不留"连接中断" |
 * | `long-scroll-anchor` | 上滑翻页 → 回底 | 锚点漂移 ≤32px、回底 gap ≤4px |
 * | `weak-network-3g` | 3G 节流进会话 | 15 秒内出正文、之后不退化成骨架 |
 * | `approval-decide`（manual） | 触发审批 → 点拒绝 | 面板出现、点完消失 |
 * | `command-card-lifecycle`（manual） | 跑一条命令 | 卡片出现、状态落定不转圈 |
 * | `two-devices-same-session` | 两个客户端看同一会话 | 行数一致、互不破坏 |
 * | `pwa-cold-start` | 冷启动 + 清缓存后重进 | 15 秒内出正文、不白屏 |
 * | `error-paths` | 打不开的会话 | 明确提示、不永远骨架 |
 * | `attachment-upload`（manual） | 选图 → 出现芯片 → 删除 | 芯片出现、可移除 |
 * | `subagent-roundtrip`（manual） | 委派子代理 → 进子会话 → 返回 | 卡片出现、父会话不塌 |
 * | `ime-composing-send`（manual） | 组合态按回车 | 不误发、文本保留 |
 * | `queue-while-running` | 跑着排队 + 连点发送 | 队列只 1 条、收工后消失、正文只 1 次、宿主队列空 |
 * | `send-slow-response` | 宿主回执很慢（8s） | 不许谎报"发送失败" |
 *
 * ## 判据写在哪儿
 *
 * `lib/invariants.mjs` —— 每条判据都对应一个真机现场，注释里写了现场描述。
 * 新场景只写"步骤"，判据复用，不要各写一套。
 *
 * ## 后续（P1）
 *
 * `offline-queue-drain`（断网发消息→恢复）、`background-return`（切后台 30s）、
 * `long-session-window`（100+ 轮）、`running-dot-lifecycle`（灰→绿→灰 ≤5s 收敛）。
 */
console.log('见文件头注释：node tools/mobile-scenarios/run.mjs --list')
