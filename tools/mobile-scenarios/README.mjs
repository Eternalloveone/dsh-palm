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
 * | 只读 | `cross-page-round-trip`、`background-return`、`long-session-window` | **跑** |
 * | 会发消息（`manual`） | `queue-while-running`、`send-slow-response`、`offline-queue-drain`、`running-dot-lifecycle` | **不跑**，必须 `--manual` + `PALM_TEST_SESSION` |
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
