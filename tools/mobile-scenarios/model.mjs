/**
 * 手机端测试模型：**用户旅程 × 不变式**。
 *
 * 为什么要有这个文件（2026-11-01 用户提出）：
 *   "想到哪个场景就补哪个"永远收敛不了 —— 补完一个还会漏下一个，而且没人知道
 *   到底漏了什么。这里把"用户到底会做什么"和"界面必须守住什么"摆成一张矩阵，
 *   每个场景必须声明自己守的是哪几格。于是：
 *
 *   · 新增场景是**有目标的**：先看哪一格空着，再写场景；
 *   · 缺口是**算出来的**，不是回忆出来的（`node tools/mobile-scenarios/coverage.mjs`）；
 *   · 评审时可以问"这格为什么空着"，而不是"你还想到什么"。
 *
 * 约定：
 *   · J* = 用户旅程（用户要做成的那件事）；
 *   · I* = 不变式（做这件事的整个过程中，界面必须守住的性质）。
 *   一个场景 = 一条旅程路径 + 若干不变式。
 */

/** 用户旅程：按"用户想做成什么"切，不按页面切。 */
export const JOURNEYS = {
  J1: '打开与首页（冷启动、首页信息、运行中入口）',
  J2: '找到目标（列表、搜索、切会话、切工作区）',
  J3: '读内容（首屏、滚动、翻历史、长会话、选中复制）',
  J4: '写与发（输入、草稿、附件、排队、停止、发送失败）',
  J5: '等与看（过程条、秒表、交付卡、命令卡、审批、子代理、绿点）',
  J6: '结果与文件（图片/文件预览、链接、路径复制）',
  J7: '管会话（新建、重命名、归档、删除、模型/权限切换）',
  J8: '环境变化（弱网、断流、后台、换设备、旋转、字号、主题）',
  J9: '出错与恢复（打不开、宿主 500、超时、限流、重试）',
}

/** 不变式：界面在任何时刻都必须守住的性质（沿用 rendering 文档的编号）。 */
export const INVARIANTS = {
  I1: '单一来源：界面数字/状态只有一个权威来源，不自己拼',
  I2: '位置身份：同一条内容在任何刷新/替换后仍是同一条（不重复、不串位）',
  I3: '单调：已出现的内容不倒退、不消失，然后才允许追加',
  I4: '一次成型：卡片/报告落定后不被重写成另一份',
  I5: '缓存优先：有缓存先画，网络只做补齐',
  I6: '阶段显式：加载/在跑/收工/失败 四个阶段有明确表达，不靠猜',
  I9: '失败可举证：判"失败"前必须有证据，不撒谎也不静默',
  S: '状态机一致：running / 排队 / 卡片 / 徽标 互相不矛盾',
  D: '数据一致：不丢、不重、不串（含跨设备、跨工作区）',
  U: '可操作：按钮可用、内容可选可复制、不被遮挡',
  P: '性能预算：首屏/滚动/输入延迟在预算内',
}

/**
 * 每个场景守哪些格子。
 *
 * 这里**必须覆盖全部场景**：`coverage.mjs` 会把"没登记的场景"和"不存在的场景"
 * 都报成错误 —— 新加场景忘了登记，门禁就会提醒。
 */
export const SCENARIO_CELLS = {
  // ── 只读 ──────────────────────────────────────────────────────────
  'cross-page-round-trip': { journeys: ['J1', 'J2', 'J3'], invariants: ['I2', 'I3', 'S'] },
  'background-return': { journeys: ['J8'], invariants: ['I2', 'I5'] },
  'long-session-window': { journeys: ['J3', 'J8'], invariants: ['I2', 'I3', 'I4'] },
  'search-and-jump': { journeys: ['J2', 'J3'], invariants: ['I2'] },
  'reconnect-backfill': { journeys: ['J8', 'J5'], invariants: ['I3', 'D', 'S'] },
  'long-scroll-anchor': { journeys: ['J3'], invariants: ['I2'] },
  'weak-network-3g': { journeys: ['J8'], invariants: ['I5', 'P'] },
  'two-devices-same-session': { journeys: ['J8'], invariants: ['D', 'I1'] },
  'pwa-cold-start': { journeys: ['J1', 'J8'], invariants: ['I5', 'P'] },
  'error-paths': { journeys: ['J9'], invariants: ['I9'] },
  'switch-session-keep-state': { journeys: ['J2', 'J4'], invariants: ['D', 'I5'] },
  'new-message-while-reading': { journeys: ['J3'], invariants: ['I2', 'U'] },
  'settings-apply-instantly': { journeys: ['J8', 'J7'], invariants: ['I4', 'S'] },
  'preview-media-and-code': { journeys: ['J6'], invariants: ['I4', 'U'] },
  'turn-state-authoritative': { journeys: ['J5'], invariants: ['I1', 'S'] },
  'select-and-copy': { journeys: ['J3'], invariants: ['U'] },
  'workspace-isolation': { journeys: ['J2'], invariants: ['D', 'I1'] },
  // ── 会发消息（manual） ─────────────────────────────────────────────
  'queue-while-running': { journeys: ['J4', 'J5'], invariants: ['S', 'D'] },
  'send-slow-response': { journeys: ['J4'], invariants: ['I9'] },
  'offline-queue-drain': { journeys: ['J4', 'J9'], invariants: ['I9', 'D'] },
  'running-dot-lifecycle': { journeys: ['J5'], invariants: ['S', 'I1'] },
  'approval-decide': { journeys: ['J5'], invariants: ['S', 'U'] },
  'command-card-lifecycle': { journeys: ['J5'], invariants: ['S', 'I4'] },
  'attachment-upload': { journeys: ['J4'], invariants: ['U'] },
  'subagent-roundtrip': { journeys: ['J5'], invariants: ['I2', 'S'] },
  'ime-composing-send': { journeys: ['J4'], invariants: ['U'] },
  'stop-mid-turn': { journeys: ['J4', 'J5'], invariants: ['S', 'U'] },
  'send-really-fails': { journeys: ['J4', 'J9'], invariants: ['I9'] },
  // -- matrix batch 2 (2026-11-01) --
  'home-stage-clarity': { journeys: ['J1'], invariants: ['I6', 'I9'] },
  'list-operability-and-speed': { journeys: ['J2'], invariants: ['U', 'P'] },
  'read-cache-first': { journeys: ['J3'], invariants: ['I5', 'P'] },
  'process-stage-copy': { journeys: ['J5'], invariants: ['I6'] },
  'error-stage-and-retry': { journeys: ['J9'], invariants: ['I6', 'U'] },
  'previous-content-kept-on-send': { journeys: ['J4'], invariants: ['I3'] },
  'session-rename-and-archive': { journeys: ['J7'], invariants: ['D', 'U', 'I9'] },
  'file-preview-failure': { journeys: ['J6'], invariants: ['I9'] },
}

/**
 * 每条旅程**必须**守住的不变式（覆盖率的分子分母都按它算）。
 *
 * 为什么不是 9×11 全都要：不是每个组合都有意义（"翻历史"和"一次成型"基本无关）。
 * 但也不能凭感觉少要几格 —— 所以这里逐格写下来：评审时问"这一格为什么不要"，
 * 比问"你还想到什么场景"收敛得快。
 */
export const REQUIRED = {
  J1: ['I5', 'I6', 'I9', 'P'],      // 打开：先出缓存、阶段明说、宿主挂了别装作正常、别太慢
  J2: ['I2', 'D', 'U', 'P'],        // 找目标：行不串、跨工作区不串、点得动、列表别卡
  J3: ['I2', 'I3', 'I5', 'U', 'P'], // 读：位置身份、不倒退、缓存先画、能选中复制、滚动流畅
  J4: ['I3', 'I9', 'D', 'S', 'U'],  // 写发：上一轮不消失、失败有据、不重复发、排队状态一致、按钮可用
  J5: ['I1', 'I4', 'I6', 'S'],      // 等看：单一来源、一次成型、阶段显式、状态机自洽
  J6: ['U', 'I4', 'I9'],            // 结果与文件：能点能看、不改写、打不开要说清楚
  J7: ['D', 'S', 'U', 'I9'],        // 管会话：列表同步、状态一致、点得动、失败有反馈
  J8: ['I5', 'I3', 'D', 'P'],       // 环境变化：缓存优先、不倒退、数据一致、性能不塌
  J9: ['I6', 'I9', 'U', 'D'],       // 出错恢复：阶段明说、失败可举证、还能操作、不丢数据
}

/**
 * 还没覆盖的格子（**由人确认后**才允许留在这里）。
 *
 * 每一条都必须写"为什么现在不覆盖"，否则 coverage 会把空白格当失败。
 * 这样"缺口"是一件被显式承认的事，不是没人知道的事。
 */
export const ACCEPTED_GAPS = {
  // 2026-11-01 实测：断网后刷新聊天页，正文不保留（只有"无法连接到运行中的 DSH host。重试"）。
  // I9 做到了（失败明说），I5 没做到（缓存不跨刷新）—— 这是**已知缺口**，不是回归；
  // 做持久化（把最后一页行存本地）后再把这格移出记账。
  'J3×I5': '聊天页正文不跨刷新缓存（刷新后只有明确错误提示），待做本地持久化',
}
