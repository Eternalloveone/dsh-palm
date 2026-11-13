/**
 * 手机端样式表（**自动生成，勿手改**）。
 *
 * 真源：`src/mobile/styles/*.css`（按文件名排序拼接）。
 * 重新生成：`pnpm gen:css`；`pnpm build` 也会先跑一遍。
 * 手改本文件会被 `mobile-styles.freshness.test.ts` 拦下。
 *
 * 构建期由 scripts/build-css.mjs 编译成 lib/mobile/app.css，页面用 <link> 引入。
 * token（调色板 + 层级/字体/圆角/间距/字阶）在 design/tokens.ts。
 */

import { designTokensCss } from './design/tokens.ts'
export const mobileCss = `${designTokensCss()}
/* ── 设计令牌 · 唯一来源（P1 设计系统） ─────────────────────────── */
/*
 * 定版依据：docs/mobile-design-spec.md
 * 规则：只允许在这里出现色值/字号/间距/圆角，组件样式一律引用变量。
 * 排序：000 位于所有区块之前，只定义变量，不产生选择器冲突。
 */

:root {
  /* ── 字号：只有 5 档 ── */
  --palm-t-s: 12px;
  --palm-t-m: 14px;
  --palm-t-l: 17px;
  --palm-t-xl: 22px;
  --palm-t-2xl: 28px;
  /* 阅读流正文专用：与通用中号字阶分开，避免连带放大按钮和列表。 */
  --palm-chat-body-size: 15px;

  /* ── 行高：只有 2 档 ── */
  --palm-lh-body: 1.5;
  --palm-lh-head: 1.3;

  /* ── 字重：只有 2 档（中文不用 500，会被合成加粗） ── */
  --palm-w-normal: 400;
  --palm-w-bold: 600;

  /* ── 间距：4 的倍数 ── */
  --palm-s1: 4px;
  --palm-s2: 8px;
  --palm-s3: 12px;
  --palm-s4: 16px;
  --palm-s5: 20px;
  --palm-s6: 24px;
  --palm-s7: 32px;
  --palm-s8: 32px;

  /* ── 圆角：3 档 ── */
  --palm-r-s: 8px;
  --palm-r-m: 12px;
  --palm-r-l: 18px;
  --palm-r-full: 9999px;

  /* ── 字体：等宽（行号、代码块、路径） ── */
  --palm-font-mono: var(--font-mono);
  /* 正文字族：默认跟随桌面注入的 --font-sans；换皮肤时可覆盖（报纸皮肤用衬线）。 */
  --palm-font-sans: var(--font-sans);

  /* ── 物性 ── */
  --palm-hi: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --palm-sh1: 0 1px 2px rgba(0, 0, 0, 0.45);
  --palm-sh2: 0 6px 20px rgba(0, 0, 0, 0.55);

  /* ── 触摸目标 ── */
  --palm-hit: 44px;

  /* ── 主键的按下与禁用（2026-11-10）：六套主键原来分两派 —— 一派 scale(0.98)+提亮，
     另一派只把透明度降到 0.88，抽屉那颗连按下态都没有。同一个动作三种反馈，
     用户会以为有的键没反应。三个值收在令牌层，以后改一次全都对齐。 ── */
  --palm-btn-press-scale: 0.98;
  --palm-btn-press-dim: 1.1;
  /* 卡片里的两颗键（审批允许 / 提问提交）**不许**用 scale：审批键是"按 1.5 秒"的
     长按确认，按下去缩一圈再保持 1.5 秒是错的；它们的按下反馈只降透明度。 */
  --palm-btn-press-flat: 0.88;
  --palm-btn-disabled-opacity: 0.6;

  /* 物性：1px 细线与焦点环宽度（组件层不写裸 px） */
  /* 压在**图片**上的小控件（缩略图角标、灯箱翻页）用这个固定压暗层：
   不跟皮肤走 —— 底下是照片，不是皮肤表面。用皮肤表面色会让角标在半数照片上消失。 */
  --palm-scrim: rgba(0, 0, 0, 0.55);
  --palm-on-scrim: rgba(255, 255, 255, 0.96);
  /* 整屏压暗（灯箱、预览）：比角标的 55% 更狠，保证图片之外的地方不抢戏。 */
  --palm-scrim-strong: rgba(0, 0, 0, 0.86);
  --palm-scrim-sheet: rgba(0, 0, 0, 0.72);
  /* 轻遮罩：选择器背景这种「只压暗一点」的场景，0.55 的 scrim 太重。 */
  --palm-scrim-soft: rgba(0, 0, 0, 0.2);
  /* 遮罩上的次要文字（灯箱说明）：on-scrim 给正文，这一档弱一些。 */
  --palm-on-scrim-soft: rgba(255, 255, 255, 0.62);
  --palm-hair: 1px;
  --palm-focus: 2px;

  /* ── 状态条（28px 主条 + 22px 迷你条 + 方案 A 刻度轨） ───────────────
   * 版式真源：docs/prototype/pet-strip-v5.html ① / overview.html「2 · 会话正文」。
   * 2026-11-09 真机偏大：主条 32 → 28、圆角 11 → 10、宠物 20 → 18、主文案 11px、
   * 刻度轨 5 → 4。迷你条（132×22）保持原尺寸，是抽屉行里的第二类用法。
   * 渐变与宠物墨色按 11 种任务状态各一份：组件样式里不再出现裸色值。 */
  --palm-strip-h: 28px;
  --palm-strip-r: 10px;
  --palm-strip-size: 11px;
  --palm-strip-detail-size: 10.5px;
  --palm-strip-right-size: 10px;
  --palm-strip-pad: 7px;
  --palm-strip-mini-w: 132px;
  --palm-strip-mini-h: 22px;
  --palm-strip-mini-r: 8px;
  --palm-strip-pet: 18px;
  --palm-strip-pet-mini: 12px;
  --palm-strip-fg: #f4f6fb;
  --palm-strip-detail-fg: rgba(255, 255, 255, 0.62);
  --palm-strip-right-fg: rgba(255, 255, 255, 0.8);
  --palm-strip-text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  /* 无权威数据：灰（不再借用「思考」那套紫渐变，免得把"不知道"画成"在做"）。 */

  /* ── 会话正文流（任务头 / 过程折叠行 / 交付卡） ───────────────────────
   * 版式真源：docs/prototype/overview.html「2 · 会话正文」
   *          + docs/prototype/delivery-card.html A 图。
   * 渐变与半透明底色只落在这里：组件样式表一律引用 palm-flow-* 令牌（不写裸色）。 */
  --palm-flow-goal-size: 15px;
  --palm-flow-title-size: 13px;
  --palm-flow-row-size: 12.5px;
  --palm-flow-meta-size: 10.5px;
  --palm-flow-tally-size: 10px;
  --palm-flow-tag-size: 9.5px;
  --palm-flow-card-r: 14px;
  --palm-flow-rule: rgba(255, 255, 255, 0.05);
  --palm-flow-card-line: rgba(61, 220, 132, 0.22);
  --palm-flow-card-bg: linear-gradient(180deg, rgba(61, 220, 132, 0.06), rgba(20, 20, 27, 0.9));
  --palm-flow-tag-ok: rgba(61, 220, 132, 0.14);
  --palm-flow-tag-edit: rgba(124, 140, 255, 0.14);

  /* ── 任务头三行（目标 / 状态条 / 元信息）────────────────────────────
   * 状态词与计时只在状态条；顶部「状态点 + 状态词 + 步数 + 耗时」那一行已删除。
   * 与 28px 状态条配套收窄：行间 8 → 6、上 4 → 2、下 12 → 10。
   * 目标行字号 15px 不动（它是这一轮的主信息），只把最小行高钉成 20px，
   * 好让 TurnHeadSkeleton 的占位与真实目标行同高。 */
  --palm-turn-gap: 6px;
  --palm-turn-pad-t: 2px;
  --palm-turn-pad-b: 4px;
  /* 待发队列面板（2026-11-10 用户：面板太高）：行高 32、伪元素上下各补 6 命中区。 */
  --palm-queue-row-h: 32px;
  --palm-queue-row-hit: 6px;
  /* 待发队列头行两颗按钮（2026-11-10 用户：太大了、不协调）：26 高、等宽圆角；
     命中区靠 ::after 上下各补 9，仍是 44。 */
  --palm-queue-btn-h: 26px;
  --palm-queue-btn-hit: 9px;
  --palm-turn-goal-h: 20px;
  --palm-turn-meta-size: 10px;

  /* ── 连接提示（会话页顶部一行 · 断线 / 已重连）─────────────────────
   * 节点常驻 DOM，靠 data-state 收起（0 高 + 透明），恢复后 800ms 再淡出。
   * 28px 是它展开后的行高：只报连接状态，不做 toast、不挡内容区。 */
  --palm-offline-h: 28px;
  --palm-offline-size: 11px;
  --palm-offline-dur: 180ms;

  /* ── 输入区底栏（C 案：队列条 + 输入行 + 元信息行） ─────────────────────
   * 版式真源：docs/prototype/dock-c.html + overview.html「2 · 会话正文」。
   * 半透明底色只落在这里：240/250/260 组件样式一律引用 palm-dock-* 令牌。 */
  --palm-dock-pad: 14px;      /* 2026-11-12：「一行放不了几个字」→ 18→14，一行多约一个字 */
  --palm-dock-gap: 6px;       /* 2026-11-12：10→8→6（配合 + 缩到 28，一行多约 1 个字） */
  --palm-dock-field-h: 48px;
  --palm-dock-field-r: 20px;
  --palm-dock-input-h: 44px;
  --palm-dock-circle: 36px;
  --palm-dock-meta-h: 30px;
  --palm-dock-chip-h: 24px;
  --palm-dock-chip-r: 999px;
  --palm-dock-chip-bg: rgba(255, 255, 255, 0.045);
  --palm-dock-chip-size: 10.5px;
  --palm-dock-chip-div-h: 9px;
  --palm-dock-chip-div-bg: rgba(255, 255, 255, 0.14);
  --palm-dock-status-size: 10.5px;
  --palm-dock-dot: 2px;
  /* 2026-11-10：10px 的环在真机上分不出比例，放大到 12px。 */
  --palm-dock-ring: 12px;
  --palm-dock-ring-line: 2px;
  --palm-dock-ring-track: rgba(124, 140, 255, 0.28);
  --palm-dock-queue-h: 30px;
  --palm-dock-queue-r: 9px;
  --palm-dock-queue-size: 11px;
  --palm-dock-queue-bg: rgba(224, 165, 44, 0.07);

  /* ── 插入条（dock 固定槽位：已插入本轮的补充消息） ─────────────────────
   * 组件永远挂载，0fr → 1fr 过渡高度；消失走 data-state 而不是卸载。
   * 摘要与每条明细均有独立 44px 触控高度，不靠跨行伪元素扩展命中区。 */
  --palm-insert-h: 44px;           /* 折叠摘要高度 */
  --palm-insert-row-h: 44px;       /* 明细行和撤回动作高度 */
  --palm-insert-dur: 220ms;        /* 出现/消失/展开的过渡时长 */
  --palm-insert-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --palm-insert-gap: var(--palm-s2);
  --palm-insert-bg: var(--palm-tint-accent);
  --palm-insert-line: var(--palm-line);
  --palm-insert-ink: var(--palm-fg-2);
  --palm-insert-accent: var(--palm-accent);

  /* ── 五屏统一规格（设置 / 外观 / 产物 / 审批 / 搜索） ───────────────────
   * 版式真源：docs/prototype/overview.html「4 · 设置」～「8 · 搜索」五个格子
   *          + docs/visual-acceptance.md「2026-11-08 最终状态」。
   * 这五屏只共用 515-five-screens.css 一层类，尺寸/字号一律引用下面这些令牌，
   * 组件样式里不再出现裸 px（灰色三档仍走 --palm-fg / --palm-fg-2 / --palm-fg-3）。 */
  --palm-spec-search-h: 44px;      /* 搜索框与清除按钮触控高度 */
  --palm-spec-search-r: 10px;      /* 搜索框圆角：无描边，靠表面色分层 */
  --palm-spec-head-size: 11px;     /* 分组标题字号（定版 10–11，弱化）*/
  --palm-spec-card-r: 10px;        /* 分组卡圆角 */
  --palm-spec-ico: 18px;           /* 行内图标方块 */
  --palm-spec-ico-r: 6px;          /* 图标方块圆角 */
  --palm-spec-glyph: 16px;         /* 方块内 / 列表左侧的线性图标 */
  --palm-spec-swatch: 44px;        /* 皮肤卡色板高 */
  --palm-spec-skin-r: 10px;        /* 皮肤卡圆角 */
  --palm-spec-code-r: 10px;        /* 审批命令块圆角 */
  --palm-spec-empty-ico: 38px;     /* 空态图标方块 */
  --palm-spec-empty-r: 12px;       /* 空态图标方块圆角 */

  /* ── 会话过程行（一行一步）与抽屉（唯一导航） ──────────────────────────
   * 2026-11-08 实机投诉修复，两条都来自同一类根因：**没有上限就没有版式**。
   * 1. 过程区：一条工具调用曾是一张 90px 上下的卡（44px 命中高度 + 8px 上下留白 +
   *    卡片描边/底色 + 行间空隙），12 条就要刷两屏。定版：一行一步 34–36px、
   *    上下留白 6–8px、不画卡片外壳，头行（「12 次工具调用 2 处报错 用时42分3秒」）
   *    压到 24px/11px。
   * 2. 抽屉：icons.tsx 的 SVG 只有 viewBox、没有 width/height，在 flex 行里按替换
   *    元素默认的 300×150 参与布局，被行宽一挤就等比撑满整行（实机截图：放大镜/
   *    齿轮/文件夹顶满一行，文字被压在图标下折行）。尺寸唯一出口是这里的令牌。 */
  --palm-proc-row-h: 36px;        /* 一行一步的行高（定版 34–36）*/
  --palm-proc-row-pad: 6px;       /* 行内上下留白（定版 6–8）*/
  --palm-proc-head-h: 24px;       /* 过程头行高（定版 24）*/
  --palm-proc-head-size: 11px;    /* 过程头字号（定版 11）*/
  --palm-proc-unknown: var(--palm-fg-3);  /* 没有权威结论时的灰态（灰点/「—」）*/
  --palm-drawer-glyph: 16px;      /* 抽屉内所有线性图标：固定 16×16 */
  --palm-drawer-avatar: 36px;     /* 身份区方形头像 */
  --palm-drawer-w: 338px;         /* 左侧抽屉宽（窄屏取 86vw）：2026-11-11 先 308→362 嫌空，同日再收回到 338 */
  --palm-drawer-new-h: 44px;      /* 「新建会话」主按钮高 */
  --palm-drawer-search-h: 44px;   /* 「搜索会话和消息」行高 */
  --palm-drawer-strip-w: 88px;    /* 行右侧迷你状态条宽 */
  --palm-drawer-strip-h: 18px;    /* 行右侧迷你状态条高 */

  /* 皮肤卡色板：每张卡画的是**那一套皮肤**的真实底色与强调色，
     因此不能引用当前皮肤令牌，只能在这里落三对字面值（本文件不计入 cssHex）。 */
  --palm-skin-graphite-bg: #15151c;
  --palm-skin-graphite-ink: #7c8cff;
  --palm-skin-paper-bg: #faf8f4;
  --palm-skin-paper-ink: #8a5a2b;
  --palm-skin-nocturne-bg: #0f1520;
  --palm-skin-nocturne-ink: #22d3ee;
  --palm-skin-claude-bg: #ffffff;
  --palm-skin-claude-ink: #8c4d38;
  --palm-skin-endfield-bg: #e8e8e2;
  --palm-skin-endfield-ink: #5f5b00;
  --palm-skin-newsprint-bg: #f5f3ed;
  --palm-skin-newsprint-ink: #065588;
}

/* ═══════════ 皮肤：石墨（默认，深色） ═══════════ */
:root,
html[data-skin='graphite'] {
  --palm-bg: #101015;
  --palm-sur-1: #15151c;
  --palm-sur-2: #1c1c25;
  --palm-line: rgba(255, 255, 255, 0.07);
  --palm-fg: #f4f4f8;
  --palm-fg-2: #a6a6b6;
  /* 2026-11-10：三级辅助文字实测 3.90:1，低于 WCAG AA（需求点名"避免低对比辅助文字"），
     抬到 4.68:1；仍明显暗于 fg-2（7.8:1），层级没被抹平。 */
  --palm-fg-3: #7e7e8f;
  --palm-accent: #7c8cff;
  /* 鲸鱼尾巴的固有色（吉祥物不跟交互色走：paper 皮肤 accent 是墨棕，鲸鱼仍是蓝的）。 */
  --palm-whale: #7c8cff;
  --palm-accent-2: #a78bfa;
  --palm-on-accent: #101015;
  --palm-ok: #3ddc84;
  --palm-warn: #e0a52c;
  --palm-danger: #ff6b81;
  --palm-tint-warn: rgba(224, 165, 44, 0.12);
  /* 断线状态带：--palm-tint-warn 是"薄雾"级别（10~12%），做整宽横条时看不出边界；
     这是"带子"级别（24%），聊天页顶部与全站离线条共用同一档。 */
  --palm-warn-band: rgba(224, 165, 44, 0.24);
  /* 搜索命中的底色：accent 26% 混在浮层底色上的**预混值**。
     写成字面量是因为 color-mix() 要 Safari 16.2，iOS 15 上会让命中词没有底色。 */
  --palm-search-mark: #303457;

  /* 预混令牌：这些位置在 iOS 15 上原本是 color-mix()，不支持时整块变透明。 */
  --palm-press-bg: #202027;
  --palm-danger-band: #482832;
  --palm-danger-line: #964454;
  --palm-ok-band: #1c372e;
  --palm-accent-line: #464e89;
  --palm-accent-16: #252840;
  --palm-tint-ok: rgba(61, 220, 132, 0.1);
  --palm-tint-danger: rgba(255, 107, 129, 0.12);
  --palm-tint-accent: rgba(124, 140, 255, 0.14);
  --palm-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 10px 30px rgba(0, 0, 0, 0.6);
  color-scheme: dark;
}

/* ═══════════ 皮肤：纸（暖白 / 印刷感 / 更小圆角） ═══════════ */
html[data-skin='paper'] {
  /* 2026-11-10 状态条重做：主条不再是「整条深色渐变」，底色要跟着皮肤走，
     否则纸色皮肤上会出现一张黑条压在白底上（实拍确认）。 */
  --palm-r-s: 6px;
  --palm-r-m: 10px;
  --palm-r-l: 14px;
  --palm-bg: #faf8f4;
  --palm-sur-1: #ffffff;
  --palm-sur-2: #f2eee7;
  --palm-line: rgba(28, 26, 23, 0.12);
  --palm-fg: #1c1a17;
  --palm-fg-2: #5d5852;
  /* 2026-11-10：纸色皮肤的三级文字只有 3.44:1（最差的一套），压到 4.76:1；
     fg-2 仍是最深的一档（6.6:1），说明文字与正文还分得开。 */
  --palm-fg-3: #746e67;
  --palm-accent: #8a5a2b;
  --palm-whale: #3f6ae0;
  --palm-accent-2: #b8804a;
  --palm-on-accent: #ffffff;
  /* 2026-11-10：绿（完成条）写在自己的淡底上 3.41:1，一起压到 4.6:1。 */
  --palm-ok: #1f6f45;
  /* 2026-11-10：纸色皮肤上「警告」正文写在自己的 10% 淡底上只有 3.35:1 ——
     审批页那句「批准后它会真实执行这条命令」正是这个组合，等于让人看不清风险。
     压到 4.8:1，色相不变。 */
  --palm-warn: #8a5f10;
  /* 2026-11-10：同理，"拒绝/删除"的红写在红淡底上只有 4.28:1，压到 5.1:1。 */
  --palm-danger: #a63b4f;
  --palm-tint-warn: rgba(169, 118, 23, 0.1);
  /* 断线状态带：--palm-tint-warn 是"薄雾"级别（10~12%），做整宽横条时看不出边界；
     这是"带子"级别（24%），聊天页顶部与全站离线条共用同一档。 */
  --palm-warn-band: rgba(169, 118, 23, 0.24);
  /* 搜索命中的底色：accent 26% 混在浮层底色上的**预混值**。
     写成字面量是因为 color-mix() 要 Safari 16.2，iOS 15 上会让命中词没有底色。 */
  --palm-search-mark: #e1d4c8;

  /* 预混令牌：这些位置在 iOS 15 上原本是 color-mix()，不支持时整块变透明。 */
  --palm-press-bg: #f4f4f3;
  --palm-danger-band: #ebd4d8;
  --palm-danger-line: #ce939e;
  --palm-ok-band: #d9e7df;
  --palm-accent-line: #c7b099;
  --palm-accent-16: #ece5dd;
  --palm-tint-ok: rgba(47, 143, 91, 0.1);
  --palm-tint-danger: rgba(184, 69, 90, 0.1);
  --palm-tint-accent: rgba(138, 90, 43, 0.1);
  --palm-hi: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --palm-sh1: 0 1px 2px rgba(28, 26, 23, 0.08);
  --palm-sh2: 0 6px 20px rgba(28, 26, 23, 0.12);
  --palm-shadow: 0 0 0 1px rgba(28, 26, 23, 0.1), 0 10px 30px rgba(28, 26, 23, 0.14);
  /*
   * 过程区 / 结论卡（交付卡）的表面色：基础令牌里那四个是**深色值**
   * （深色渐变 + 白色 5% 分隔线），浅色皮肤不覆盖就会在白底上画出一块深色卡、
   * 分隔线直接消失（2026-11-10 组件预览截图实拍）。这里是纸感暖白的等价物。
   */
  --palm-flow-card-bg: linear-gradient(180deg, rgba(47, 143, 91, 0.05), rgba(255, 255, 255, 0.96));
  --palm-flow-rule: rgba(28, 26, 23, 0.08);
  --palm-flow-card-line: rgba(47, 143, 91, 0.28);
  --palm-flow-tag-ok: rgba(47, 143, 91, 0.12);
  --palm-flow-tag-edit: rgba(138, 90, 43, 0.12);
  /*
   * 过程条的轨道色（2026-11-10 纸色 900px 实拍）：
   * 基础值是为深色底写的霓虹绿（47,191,116 → 61,220,132）与靛（75,74,224 → 124,140,255），
   * 摆在暖白纸面上像荧光笔 —— 一条「完成」底下横着一排发光的绿条。
   * 纸色皮肤用自己的语义色：完成 = 墨绿，进行中 = 棕（本皮肤强调色）。
   */

  /*
   * 2026-11-10 皮肤契约（补齐）：以下 11 个令牌原来只在基础 :root 里有**深色值**，
   * 纸色皮肤没覆盖 → 白底上出现半透明黑罩、深色浮层文字、几乎看不见的输入区芯片。
   * 契约：凡"颜色"类令牌，三套皮肤必须各自定义，不靠基础值兜底。
   */
  --palm-scrim: rgba(28, 26, 23, 0.42);
  --palm-on-scrim: #faf8f4;
  --palm-scrim-strong: rgba(28, 26, 23, 0.8);
  --palm-scrim-sheet: rgba(28, 26, 23, 0.68);
  --palm-scrim-soft: rgba(28, 26, 23, 0.12);
  --palm-on-scrim-soft: rgba(250, 248, 244, 0.7);
  --palm-strip-fg: #1c1a17;
  --palm-strip-detail-fg: #5d5852;
  --palm-strip-right-fg: #746e67;
  --palm-strip-text-shadow: none;
  --palm-dock-chip-bg: rgba(28, 26, 23, 0.05);
  --palm-dock-chip-div-bg: rgba(28, 26, 23, 0.16);
  --palm-dock-ring-track: rgba(138, 90, 43, 0.3);
  --palm-dock-queue-bg: rgba(169, 118, 23, 0.09);
  color-scheme: light;
}
/* ═══════════ 皮肤：endfield ══════════════════════════════════════════════════
 * 来自 ymh0000123/dsh-theme-endfield（8315d58）
 * 由 scripts/port-skin.mjs 从桌面皮肤翻译：桌面令牌 → 手机端令牌，混色提前算成字面量。
 * 对比度已按 WCAG AA 自检并自动压深（含语法高亮，压在自己的代码块底色上）。
 * 圆角档位：2px / 4px / 6px（--radius 决定"直角还是圆润"）。
 */
html[data-skin='endfield'] {
  --palm-r-s: 2px;
  --palm-r-m: 4px;
  --palm-r-l: 6px;
  --palm-bg: #e8e8e2;
  --palm-sur-1: #f5f5f2;
  --palm-sur-2: #ddddd8;
  --palm-line: rgba(206, 206, 201, 0.5);
  --palm-fg: #101110;
  --palm-fg-2: #4a4c48;
  --palm-fg-3: #646662;
  --palm-accent: #5f5b00;
  --palm-whale: #5f5b00;
  --palm-accent-2: #777426;
  --palm-on-accent: #ffffff;
  --palm-ok: #1d6841;
  --palm-warn: #7a540e;
  --palm-danger: #9c374a;
  --palm-tint-warn: rgba(122, 84, 14, 0.1);
  --palm-warn-band: rgba(122, 84, 14, 0.24);
  --palm-search-mark: #cecdb3;
  --palm-press-bg: #dfdfda;
  --palm-danger-band: #dfd3d0;
  --palm-danger-line: #d3b6b7;
  --palm-ok-band: #d0d9cf;
  --palm-accent-line: #b8b793;
  --palm-accent-16: #dddccb;
  --palm-tint-ok: rgba(29, 104, 65, 0.1);
  --palm-tint-danger: rgba(156, 55, 74, 0.1);
  --palm-tint-accent: rgba(95, 91, 0, 0.1);
  --palm-hi: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --palm-sh1: 0 1px 2px rgba(16, 17, 16, 0.08);
  --palm-sh2: 0 6px 20px rgba(16, 17, 16, 0.12);
  --palm-shadow: 0 0 0 1px rgba(16, 17, 16, 0.1), 0 10px 30px rgba(16, 17, 16, 0.14);
  --palm-flow-card-bg: linear-gradient(180deg, rgba(29, 104, 65, 0.05), rgba(255, 255, 255, 0.96));
  --palm-flow-rule: rgba(16, 17, 16, 0.08);
  --palm-flow-card-line: rgba(29, 104, 65, 0.28);
  --palm-flow-tag-ok: rgba(29, 104, 65, 0.12);
  --palm-flow-tag-edit: rgba(95, 91, 0, 0.12);
  --palm-scrim: rgba(16, 17, 16, 0.42);
  --palm-on-scrim: #e8e8e2;
  --palm-scrim-strong: rgba(16, 17, 16, 0.8);
  --palm-scrim-sheet: rgba(16, 17, 16, 0.68);
  --palm-scrim-soft: rgba(16, 17, 16, 0.12);
  --palm-on-scrim-soft: rgba(232, 232, 226, 0.7);
  --palm-strip-fg: #101110;
  --palm-strip-detail-fg: #4a4c48;
  --palm-strip-right-fg: #646662;
  --palm-strip-text-shadow: none;
  --palm-dock-chip-bg: rgba(16, 17, 16, 0.05);
  --palm-dock-chip-div-bg: rgba(16, 17, 16, 0.16);
  --palm-dock-ring-track: rgba(95, 91, 0, 0.3);
  --palm-dock-queue-bg: rgba(122, 84, 14, 0.09);
  /* 语法高亮：从这套皮肤的强调色派生，否则代码块会沿用通用两套色板、和周围格格不入。 */
  --tok-keyword: #650d82;
  --tok-string: #0a6c1a;
  --tok-comment: #7b795a;
  --tok-number: #82510d;
  --tok-type: #82170d;
  --tok-func: #5f5b00;
  --tok-prop: #0a6c64;
  --palm-font-sans: var(--font-sans);
  color-scheme: light;
}
/* ═══════════ 皮肤：claude ══════════════════════════════════════════════════
 * 来自 Nwflower/dsh-claude-style（c49419e）
 * 由 scripts/port-skin.mjs 从桌面皮肤翻译：桌面令牌 → 手机端令牌，混色提前算成字面量。
 * 对比度已按 WCAG AA 自检并自动压深（含语法高亮，压在自己的代码块底色上）。
 * 圆角档位：8px / 12px / 18px（--radius 决定"直角还是圆润"）。
 */
html[data-skin='claude'] {
  --palm-r-s: 8px;
  --palm-r-m: 12px;
  --palm-r-l: 18px;
  --palm-bg: #ffffff;
  --palm-sur-1: #fafafa;
  --palm-sur-2: #ececec;
  --palm-line: rgba(231, 226, 221, 0.5);
  --palm-fg: #161616;
  --palm-fg-2: #5c5c5c;
  --palm-fg-3: #747474;
  --palm-accent: #8c4d38;
  --palm-whale: #8c4d38;
  --palm-accent-2: #9d6856;
  --palm-on-accent: #ffffff;
  --palm-ok: #1f6f45;
  --palm-warn: #8a5f10;
  --palm-danger: #a63b4f;
  --palm-tint-warn: rgba(138, 95, 16, 0.1);
  --palm-warn-band: rgba(138, 95, 16, 0.24);
  --palm-search-mark: #ddcdc8;
  --palm-press-bg: #f6f6f6;
  --palm-danger-band: #f4e7ea;
  --palm-danger-line: #e6c8ce;
  --palm-ok-band: #e4eee9;
  --palm-accent-line: #d7c1b9;
  --palm-accent-16: #e8dedb;
  --palm-tint-ok: rgba(31, 111, 69, 0.1);
  --palm-tint-danger: rgba(166, 59, 79, 0.1);
  --palm-tint-accent: rgba(140, 77, 56, 0.1);
  --palm-hi: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --palm-sh1: 0 1px 2px rgba(22, 22, 22, 0.08);
  --palm-sh2: 0 6px 20px rgba(22, 22, 22, 0.12);
  --palm-shadow: 0 0 0 1px rgba(22, 22, 22, 0.1), 0 10px 30px rgba(22, 22, 22, 0.14);
  --palm-flow-card-bg: linear-gradient(180deg, rgba(31, 111, 69, 0.05), rgba(255, 255, 255, 0.96));
  --palm-flow-rule: rgba(22, 22, 22, 0.08);
  --palm-flow-card-line: rgba(31, 111, 69, 0.28);
  --palm-flow-tag-ok: rgba(31, 111, 69, 0.12);
  --palm-flow-tag-edit: rgba(140, 77, 56, 0.12);
  --palm-scrim: rgba(22, 22, 22, 0.42);
  --palm-on-scrim: #ffffff;
  --palm-scrim-strong: rgba(22, 22, 22, 0.8);
  --palm-scrim-sheet: rgba(22, 22, 22, 0.68);
  --palm-scrim-soft: rgba(22, 22, 22, 0.12);
  --palm-on-scrim-soft: rgba(255, 255, 255, 0.7);
  --palm-strip-fg: #161616;
  --palm-strip-detail-fg: #5c5c5c;
  --palm-strip-right-fg: #747474;
  --palm-strip-text-shadow: none;
  --palm-dock-chip-bg: rgba(22, 22, 22, 0.05);
  --palm-dock-chip-div-bg: rgba(22, 22, 22, 0.16);
  --palm-dock-ring-track: rgba(140, 77, 56, 0.3);
  --palm-dock-queue-bg: rgba(138, 95, 16, 0.09);
  /* 语法高亮：从这套皮肤的强调色派生，否则代码块会沿用通用两套色板、和周围格格不入。 */
  --tok-keyword: #753c88;
  --tok-string: #357841;
  --tok-comment: #8c7972;
  --tok-number: #806238;
  --tok-type: #88433c;
  --tok-func: #8c4d38;
  --tok-prop: #32716c;
  --palm-font-sans: var(--font-sans);
  color-scheme: light;
}











/* ═══════════ 皮肤：夜航（深蓝 / 霓虹 / 更圆） ═══════════ */
html[data-skin='nocturne'] {
  --palm-r-s: 10px;
  --palm-r-m: 14px;
  --palm-r-l: 20px;
  --palm-bg: #080c14;
  --palm-sur-1: #0f1520;
  /* 2026-11-10：原来是 6% 半透明（#16203010），叠在 --palm-sur-1 上只差 1.006:1 ——
     卡片套卡片、浮层压卡片全都糊成一片。改成不透明的第二层，层间距 1.105:1，
     与石墨/纸色同一档；顺带不再受底下是图片还是底色影响。 */
  --palm-sur-2: #161f2e;
  --palm-line: rgba(120, 180, 255, 0.14);
  --palm-fg: #e8f1ff;
  --palm-fg-2: #9db3d1;
  /* 2026-11-10：夜航的三级文字 4.38:1，差一点点过线；提到 5.03:1。 */
  --palm-fg-3: #6d82a5;
  --palm-accent: #22d3ee;
  --palm-whale: #22d3ee;
  --palm-accent-2: #818cf8;
  --palm-on-accent: #0a0a0f;
  --palm-ok: #34d399;
  --palm-warn: #fbbf24;
  --palm-danger: #fb7185;
  --palm-tint-warn: rgba(251, 191, 36, 0.12);
  /* 断线状态带：--palm-tint-warn 是"薄雾"级别（10~12%），做整宽横条时看不出边界；
     这是"带子"级别（24%），聊天页顶部与全站离线条共用同一档。 */
  --palm-warn-band: rgba(251, 191, 36, 0.24);
  /* 搜索命中的底色：accent 26% 混在浮层底色上的**预混值**。
     写成字面量是因为 color-mix() 要 Safari 16.2，iOS 15 上会让命中词没有底色。 */
  --palm-search-mark: #144656;

  /* 预混令牌：这些位置在 iOS 15 上原本是 color-mix()，不支持时整块变透明。 */
  --palm-press-bg: #1a202b;
  --palm-danger-band: #432936;
  --palm-danger-line: #914858;
  --palm-ok-band: #153535;
  --palm-accent-line: #187083;
  --palm-accent-16: #123341;
  --palm-tint-ok: rgba(52, 211, 153, 0.1);
  --palm-tint-danger: rgba(251, 113, 133, 0.12);
  --palm-tint-accent: rgba(34, 211, 238, 0.12);
  --palm-hi: inset 0 1px 0 rgba(120, 180, 255, 0.14);
  --palm-sh1: 0 1px 2px rgba(0, 0, 0, 0.6);
  --palm-sh2: 0 6px 22px rgba(0, 0, 0, 0.7);
  --palm-shadow: 0 0 0 1px rgba(120, 180, 255, 0.16), 0 10px 30px rgba(0, 0, 0, 0.7);
  /*
   * 2026-11-10 皮肤契约（补齐）：夜航原来缺 13 个颜色令牌，全部落回石墨的深色值 ——
   * 于是在深蓝底上出现靛紫芯片、石墨绿标签（--palm-flow-tag-ok）这类"两套配色混搭"。
   * 这里按夜航自己的青/蓝绿/琥珀语义给全，不再依赖基础值。
   */
  --palm-scrim: rgba(3, 6, 12, 0.6);
  --palm-on-scrim: #e8f1ff;
  --palm-scrim-strong: rgba(3, 6, 12, 0.88);
  --palm-scrim-sheet: rgba(3, 6, 12, 0.72);
  --palm-scrim-soft: rgba(3, 6, 12, 0.25);
  --palm-on-scrim-soft: rgba(232, 241, 255, 0.64);
  --palm-strip-fg: #e8f1ff;
  --palm-strip-detail-fg: rgba(232, 241, 255, 0.66);
  --palm-strip-right-fg: rgba(232, 241, 255, 0.82);
  --palm-strip-text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  --palm-dock-chip-bg: rgba(120, 180, 255, 0.06);
  --palm-dock-chip-div-bg: rgba(120, 180, 255, 0.18);
  --palm-dock-ring-track: rgba(34, 211, 238, 0.28);
  --palm-dock-queue-bg: rgba(251, 191, 36, 0.08);
  --palm-flow-tag-ok: rgba(52, 211, 153, 0.14);
  --palm-flow-tag-edit: rgba(34, 211, 238, 0.14);
  color-scheme: dark;
}
/* ═══════════ 皮肤：报纸（newsprint）═══════════════════════════════════════
 * 移植自 dsh-skin-market 里的 2754LM/dsh-theme-newsprint（MIT）：暖白报纸底 +
 * 墨色正文 + 单一海蓝强调。桌面那份是 cordis 插件、改的是 --dsw-alias-*；
 * 手机端是另一套令牌与组件，所以**重新表达**而不是复用代码：
 * 角色一一对应（base→bg、raised→sur-1、container→sur-2、ink→fg 三档、blue→accent），
 * 混色值提前算成字面量（iOS 15 没有 color-mix）。
 * 装饰（衬线正文、报头双线）在 610-skin-newsprint.css。
 */
html[data-skin='newsprint'] {
  --palm-r-s: 4px;
  --palm-r-m: 8px;
  --palm-r-l: 12px;
  --palm-bg: #f5f3ed;
  --palm-sur-1: #fdfdfa;
  --palm-sur-2: #ebe7de;
  --palm-line: rgba(31, 9, 9, 0.12);
  --palm-fg: #1f0909;
  --palm-fg-2: #5a5049;
  --palm-fg-3: #776c62;
  --palm-accent: #065588;
  --palm-whale: #065588;
  --palm-accent-2: #0a6aa0;
  --palm-on-accent: #ffffff;
  --palm-ok: #4d6b43;
  --palm-warn: #8d5a14;
  --palm-danger: #9a0c0c;
  --palm-tint-warn: rgba(179, 116, 28, 0.1);
  --palm-warn-band: rgba(179, 116, 28, 0.24);
  --palm-search-mark: #bdd1dc;
  --palm-press-bg: #efeadd;
  --palm-danger-band: #ead7d2;
  --palm-danger-line: #dcb2ae;
  --palm-ok-band: #e1e3d9;
  --palm-accent-line: #a1bcca;
  --palm-accent-16: #d5e2e8;
  --palm-tint-ok: rgba(77, 107, 67, 0.1);
  --palm-tint-danger: rgba(154, 12, 12, 0.1);
  --palm-tint-accent: rgba(6, 85, 136, 0.1);
  --palm-hi: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --palm-sh1: 0 1px 2px rgba(31, 9, 9, 0.08);
  --palm-sh2: 0 6px 20px rgba(31, 9, 9, 0.12);
  --palm-shadow: 0 0 0 1px rgba(31, 9, 9, 0.1), 0 10px 30px rgba(31, 9, 9, 0.14);
  --palm-flow-card-bg: linear-gradient(180deg, rgba(77, 107, 67, 0.05), rgba(255, 255, 255, 0.96));
  --palm-flow-rule: rgba(31, 9, 9, 0.08);
  --palm-flow-card-line: rgba(77, 107, 67, 0.28);
  --palm-flow-tag-ok: rgba(77, 107, 67, 0.12);
  --palm-flow-tag-edit: rgba(6, 85, 136, 0.12);
  --palm-scrim: rgba(31, 9, 9, 0.42);
  --palm-on-scrim: #f5f3ed;
  --palm-scrim-strong: rgba(31, 9, 9, 0.8);
  --palm-scrim-sheet: rgba(31, 9, 9, 0.68);
  --palm-scrim-soft: rgba(31, 9, 9, 0.12);
  --palm-on-scrim-soft: rgba(245, 243, 237, 0.7);
  --palm-strip-fg: #1f0909;
  --palm-strip-detail-fg: #5a5049;
  --palm-strip-right-fg: #776c62;
  --palm-strip-text-shadow: none;
  --palm-dock-chip-bg: rgba(31, 9, 9, 0.05);
  --palm-dock-chip-div-bg: rgba(31, 9, 9, 0.16);
  --palm-dock-ring-track: rgba(6, 85, 136, 0.3);
  --palm-dock-queue-bg: rgba(179, 116, 28, 0.09);
  /* 只有报纸皮肤换字体：衬线正文是这套皮肤的签名。 */
  --palm-font-sans: 'Songti SC', 'Noto Serif CJK SC', 'Source Han Serif SC', 'PingFang SC', Georgia, serif;
  /* 语法高亮：从报纸的海蓝强调色派生（与移植器同一套算法）。 */
  --tok-keyword: #650d82;
  --tok-string: #0b731c;
  --tok-comment: #657e8c;
  --tok-number: #82510d;
  --tok-type: #82170d;
  --tok-func: #065588;
  --tok-prop: #0b736a;
  color-scheme: light;
}


/* ── 旧名桥接（一次性）：历史样式的 767 处引用改由上面的 --palm-* 驱动 ──
   designTokensCss() 先注入，这一段在它之后，因此这里的映射会覆盖旧字面值。
   下一步是把旧名逐批替换掉，届时删掉本段即可。 */
/*
 * 选择器用 :root:root（特异性 0,2,0）而不是 :root —— design/tokens.ts 注入的
 * :root[data-theme='dark']（0,1,1）和 @media(prefers-color-scheme:dark){:root:not(...)}（0,2,0）
 * 都会比单个 :root 更"重"，桥接就永远输，于是深色模式下仍是旧调色板在画
 * （2026-11-10 实测：石墨皮肤下 --accent 取到 #5b5cf0 而不是 #7c8cff）。
 */
:root:root {
  /* 字号：整条上移一档（旧 11/12/13/15/16.5 → 新 13/14/15/18/23） */
  --text-xs: var(--palm-t-s);
  --text-sm: var(--palm-t-s);
  --text-md: var(--palm-t-m);
  --text-base: var(--palm-t-l);
  --text-lg: var(--palm-t-l);

  /* 间距：小档不变，大档拉长（更宽松） */
  --space-1: var(--palm-s1);
  --space-2: var(--palm-s2);
  --space-3: var(--palm-s3);
  --space-4: var(--palm-s4);
  --space-5: var(--palm-s5);
  --space-6: var(--palm-s6);
  --space-8: var(--palm-s8);

  /* 圆角 */
  --radius-chip: var(--palm-r-s);
  --radius-menu: var(--palm-r-s);
  --radius-card: var(--palm-r-m);
  --radius-sheet: var(--palm-r-l);
  --radius-capsule: var(--palm-r-full);
  --radius-full: var(--palm-r-full);

  /*
   * 强调色的旧名（2026-11-10）：design/tokens.ts 里 --accent / --accent-soft /
   * --accent-contrast 两套主题都是同一组值、**换肤不变**，于是纸色页面上到处是靛蓝
   * （主按钮、发送键、进度条、链接…本轮前面逐个修了三处，才看清是同一条根）。
   * 这三个旧名在这里一次性指回皮肤令牌：100 余处历史引用不必逐个改，
   * 也不会再出现"棕色文字 + 淡蓝底"这种半新半旧的组合。
   * 前景色对应的淡底已由 skin-contrast.test.ts 量过 ≥4.5:1。
   */
  --accent: var(--palm-accent);
  --accent-soft: var(--palm-tint-accent);
  --accent-contrast: var(--palm-on-accent);
  /* 2026-11-10：原来是 color-mix(accent 45%)；iOS 15 上光晕没有。指向预混令牌。 */
  --accent-glow: var(--palm-accent-line);

  /*
   * 大面积底色（2026-11-10，切片 56）：上面四族 + 强调色只覆盖了"强调"，
   * 页面底/表面/抬高面/卡片底这四族仍然是按**明暗主题**注入的字面值、换肤不变。
   * 三套皮肤各自配了一个主题，所以看不出问题；一旦加第四套皮肤，就会出现
   * "新强调色 + 旧底色"。这里把四族指回皮肤令牌，让"换皮肤"真正等于"换整套表面"。
   * 文字与描边（--text-* / --border-*）**刻意先不接**：它们与底色的对比需要逐屏量，
   * 放到下一个切片，避免一次改两件事没法归因。
   */
  --bg-page: var(--palm-bg);
  --bg-surface: var(--palm-sur-1);
  --bg-elevated: var(--palm-sur-2);
  --card-bg: var(--palm-sur-1);

  /*
   * 文字 / 描边 / 阴影（2026-11-10，切片 57）：上一片把底色接进皮肤后，
   * 文字还是主题注入的固定灰 —— 纸色皮肤下深字对暖底的对比没量过，夜航皮肤下
   * 又少了那层蓝调。这三族一接，正文/次要/三级、行描边、卡片阴影全部按皮肤走。
   *
   * 敢一次接完，是因为 skin-contrast.test.ts 已经逐皮肤量过 --palm-fg* 与
   * --palm-sur-* 的对比度（≥4.5），接过来等于直接继承了那组已验证的数字；
   * 反过来，主题值反而是**没量过**的那一组。
   */
  --text-primary: var(--palm-fg);
  --text-secondary: var(--palm-fg-2);
  --text-tertiary: var(--palm-fg-3);
  --text-quaternary: var(--palm-fg-3);
  --border-default: var(--palm-line);
  --border-focus: var(--palm-accent);
  --card-border: var(--palm-line);
  --card-shadow: var(--palm-shadow);

  /*
   * 2026-11-10「主题色与皮肤冲突」的根：上面接了 34 个旧名，剩下 42 个还在吃
   * design/tokens.ts 的**按明暗主题**注入值，而样式里还引用了 150+ 次
   * （--danger 34、--fill 30、--border-subtle 38、--code-bg 9、--positive 9…）。
   * 结果是同一屏上「皮肤的颜色」和「主题的颜色」各画一半：纸色皮肤上弹出一块靛蓝，
   * 夜航皮肤上出现石墨绿的红/绿，切系统深色再整套翻一次。
   *
   * 这一段把剩下能对的旧名一次性接回皮肤令牌 —— 换皮 = 换整套颜色，
   * 不再有第二个调色板参与绘制。唯一刻意例外是语法高亮 --tok-*：
   * 它需要自己的色相（关键字紫/字符串绿…），由 skin.ts 把 data-theme 钉成
   * 皮肤极性来保证明暗配套。
   */
  --border-subtle: var(--palm-line);
  --fill: var(--palm-sur-2);
  --fill-strong: var(--palm-press-bg);
  --bg-input: var(--palm-sur-1);
  --header-bg: var(--palm-bg);
  --dialog-bg: var(--palm-sur-1);
  --toast-bg: var(--palm-sur-2);
  --toast-text: var(--palm-fg);
  --backdrop: var(--palm-scrim);
  --shadow-lg: var(--palm-shadow);
  --text-muted: var(--palm-fg-3);
  --danger: var(--palm-danger);
  --danger-soft: var(--palm-tint-danger);
  --positive: var(--palm-ok);
  --warning: var(--palm-warn);
  --code-bg: var(--palm-sur-1);
  --code-text: var(--palm-fg);
  --code-border: var(--palm-line);
  --code-head-bg: var(--palm-sur-2);
  --code-head-border: var(--palm-line);
  --diff-add: var(--palm-ok);
  --diff-del: var(--palm-danger);
  --diff-add-bg: var(--palm-tint-ok);
  --diff-del-bg: var(--palm-tint-danger);
  --diff-add-word: var(--palm-ok-band);
  --diff-del-word: var(--palm-danger-band);
  --tone-positive-soft: var(--palm-tint-ok);
  --tone-positive-ink: var(--palm-ok);
  --tone-neutral-soft: var(--palm-sur-2);
  --tone-neutral-ink: var(--palm-fg-2);
  --tone-warning-soft: var(--palm-tint-warn);
  --tone-warning-ink: var(--palm-warn);
  --tone-danger-ink: var(--palm-danger);
  --tone-info-soft: var(--palm-tint-accent);
  --tone-info-ink: var(--palm-accent);
}
/* ── 组件层 · 物性骨架（P1 设计系统） ─────────────────────────── */
/*
 * 约束（由 quality-budget 守着）：
 *   · 不写裸色值（hex 预算）、不写裸尺寸（px 预算）、不用强制提升；
 *   · 变体用 data-* 属性，不加新类名（类名预算）；
 *   · 所有尺寸/颜色引用 000-tokens.css。
 * 变体：<div class="palm-card" data-elevation="raised">…
 *       <button class="palm-btn" data-variant="primary">…
 */

/* ── 卡片：内容卡 / 浮层卡 / 平铺卡 ── */
.palm-card {
  padding: var(--palm-s4);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-l);
  background: var(--palm-sur-1);
  box-shadow: var(--palm-hi), var(--palm-sh1);
  color: var(--palm-fg);
}

.palm-card[data-elevation='raised'] {
  background: var(--palm-sur-2);
  box-shadow: var(--palm-hi), var(--palm-sh2);
}

.palm-card[data-elevation='flat'] {
  box-shadow: none;
  background: transparent;
  border-color: transparent;
  border-radius: 0;
}































/* ── 布局契约：grow 槽吃剩余空间（由 SlotLayout 打标记，不写行内样式） ── */
[data-grow] {
  flex: 1 1 auto;
  min-inline-size: 0;
  min-block-size: 0;
}
/* ── base + mobile-browser hardening ─────────────────────────────────── */

* {
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
  /* 长按不弹系统菜单 */
  -webkit-touch-callout: none;
}

html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--bg-page);
  color: var(--text-primary);
  font-family: var(--palm-font-sans);
  font-size: var(--text-base);
  font-weight: 400;
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
  overscroll-behavior-y: contain;
  /* 禁止选中文字；输入框单独放开 */
  user-select: none;
  -webkit-user-select: none;
}

input,
textarea {
  user-select: text;
  -webkit-user-select: text;
  font-size: 16px; /* ≥16px：防止 iOS 聚焦时页面缩放 */
}

::selection {
  background: var(--accent-soft);
}

/* Theme swap: every color property eases over 300ms. */
body,
.mobile-header,
.mobile-row,
.chat-msg,
.chat-input,
.chat-inputbar,
.sheet,
.dialog,
.settings-group,
.seg,
.toast,
.code-block,
.diff-block,
.code-head,
.diff-head,
.code-body,
.diff-row,
.code-run {
  transition: color 0.3s ease, background-color 0.3s ease, border-color 0.3s ease;
}

/* The app fills exactly one viewport: the page itself never scrolls, each
   view owns its scroll region and the chat composer stays pinned. vh first:
   dynamic-viewport units are not supported by older WebViews (WeChat etc.),
   where the vh fallback keeps the layout intact. */
#root {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mobile {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mobile-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  padding-bottom: 24px;
}

/* Thin, quiet scrollbars. */
.mobile-scroll::-webkit-scrollbar,
.chat-scroll::-webkit-scrollbar,
.sheet-body::-webkit-scrollbar,
.code-block pre::-webkit-scrollbar {
  width: 3px;
  height: 3px;
}

.mobile-scroll::-webkit-scrollbar-thumb,
.chat-scroll::-webkit-scrollbar-thumb,
.sheet-body::-webkit-scrollbar-thumb,
.code-block pre::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: var(--radius-full);
}

/* ── page transitions: parallax push / pop (250ms) ───────────────────── */

.page-stage {
  position: relative;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Lazy-view placeholder (a split chunk still loading). It only holds the
   layout: a full-height, page-coloured box with the same shape as the page
   that is about to mount, so a cold chunk cannot make the shell jump. */
/* 冷启动直接落进懒加载页时的骨架：页头留白 + 几条等宽灰条。以前这里是纯空
   背景，切页时会看着像"闪一下"。 */
.page-loading {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
}

.page-loading-head {
  flex: none;
  height: 52px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}

.page-loading-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 16px;
}

.page-loading-rows span {
  height: 13px;
  border-radius: 7px;
  background: linear-gradient(90deg, var(--bg-elevated) 25%, var(--bg-surface) 50%, var(--bg-elevated) 75%);
  background-size: 200% 100%;
  animation: settings-skeleton-sweep 1.2s ease-in-out infinite;
}

.page-loading-rows span:nth-child(1) { width: 72%; }
.page-loading-rows span:nth-child(2) { width: 94%; }
.page-loading-rows span:nth-child(3) { width: 86%; }
.page-loading-rows span:nth-child(4) { width: 55%; }

.page-loading-retry {
  margin: 24px 16px;
  padding: 12px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: var(--bg-surface);
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
}

.page {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Stacking is stated per direction instead of falling out of the box model: a
   push slides the entering page in above the leaving one, a pop slides the
   leaving page away above the entering one. Both are flex items of
   .page-stage, which honour z-index even with position: static. */
.page-enter-fwd {
  z-index: 2;
  animation: page-in-fwd 0.25s ease-out both;
}

.page-exit-fwd {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
  z-index: 1;
  animation: page-out-fwd 0.25s ease-out both;
}

.page-enter-back {
  z-index: 1;
  animation: page-in-back 0.25s ease-out both;
}

.page-exit-back {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
  z-index: 2;
  animation: page-out-back 0.25s ease-out both;
}

@keyframes page-in-fwd {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

@keyframes page-out-fwd {
  from {
    transform: none;
    opacity: 1;
  }
  to {
    /* End fully transparent and off-stage: an opacity-only fade to 0.8 +
       fill-mode both left the leaving page ghosting through the frost-glass
       header on forward navigations (search-hit locate), producing a
       stacked double-image. Match the back direction: disappear entirely. */
    transform: translateX(-100%);
    opacity: 0;
  }
}

@keyframes page-in-back {
  from {
    transform: translateX(-30%);
    opacity: 0.8;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

@keyframes page-out-back {
  from {
    transform: none;
    opacity: 1;
  }
  to {
    transform: translateX(100%);
    opacity: 0;
  }
}


/* ── 抽屉打开时，后面那一层「后退」（2026-11-12）───────────────────────
 * 只滑入一块面板，观感还是"安卓抽屉"；iOS 侧边栏的层次感来自**后面那页也动**：
 * 它轻微缩小 + 右移 + 出圆角，像被推开的卡片，抽屉因此"浮"在上层而不是贴在同一张纸上。
 * 曲线和时长与 \`.palm-drawer\` 一致（340ms / iOS 那条），两者同步才不会打架。
 * 注意：抽屉（\`.palm-drawer-scrim\`）在 \`.page-stage\` 之外，不受这个 transform 影响。
 */
.page-stage {
  transition: transform 340ms cubic-bezier(0.32, 0.72, 0, 1);
  transform-origin: 100% 50%;
}

.page-stage[data-drawer='open'] {
  /* 3% 右移 + 0.955 缩放：够看出"后退"，又不会让底下的输入框跳出屏幕。 */
  transform: translateX(3%) scale(0.955);
  border-radius: var(--palm-r-l);
  overflow: hidden;
}/* ── header: 48px + safe-area, frosted glass ─────────────────────────── */

.mobile-header {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 48px;
  align-items: center;
  gap: var(--space-1);
  padding: calc(env(safe-area-inset-top, 0px) + 4px) 4px 4px;
  min-height: calc(48px + env(safe-area-inset-top, 0px));
  background: var(--header-bg);
  /* No backdrop-filter here: the sticky header sits over the scrolling
     message list, and blur is the most expensive compositing operation on
     mobile — every scroll frame would re-sample the background. The header
     background is near-opaque instead (see --header-bg), which reads the
     same while scrolling stays cheap. */
  border-bottom: 1px solid var(--border-subtle);
}

.mobile-headerSlot {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 48px;
}

.mobile-headerSlot-right {
  justify-content: flex-end;
}

.mobile-title {
  margin: 0;
  font-size: 17px;
  font-weight: 500;
  color: var(--text-primary);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-titleWrap {
  min-width: 0;
  text-align: center;
}

.mobile-titleInline {
  display: block;
}

/* 标题下的一行次级信息：工作区名 ·(可选) 运行徽标（2026-11-11 起徽标也在这行）。 */
.mobile-titlePath {
  margin: 1px 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--palm-s1);
  min-inline-size: 0;
  font-size: var(--text-sm);
  font-weight: var(--palm-w-normal);
  line-height: var(--palm-lh-head);
  color: var(--text-secondary);
  text-align: center;
  overflow: hidden;
  white-space: nowrap;
}

/* ── 顶栏运行徽标（2026-11-10）────────────────────────────────────────────
   输入框上方那行「任务 3/7 · 子代理 2 个运行中」搬到顶栏，做成一个可点的小徽标：
   它不跟输入区抢注意力，点开是既有的运行详情面板（计划 / 后台任务 / 子代理）。 */
.chat-run-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--palm-s1);
  padding: var(--palm-hair) var(--palm-s2);
  border: 0;
  border-radius: var(--palm-r-full);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-t-s);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  cursor: pointer;
  position: relative;
}

/* 在跑的记号：一个小圆点，省一个 class（预算只降不升）。 */
.chat-run-badge::before {
  content: '';
  inline-size: var(--palm-s1);
  block-size: var(--palm-s1);
  border-radius: 50%;
  background: var(--palm-accent);
  flex: none;
}

/* 徽标搬进第二行后视觉只有 18px 高：用一块不可见的扩展区把点击目标撑到 44px，
   不动布局（移动端最小触控 44px 是这一版定下的硬规则）。 */
.chat-run-badge::after {
  content: '';
  position: absolute;
  inset: -13px -10px;
}

.chat-run-badge:active { opacity: 0.72; }

/* ── icon buttons (48px hot zones) ───────────────────────────────────── */

.mobile-back,
.mobile-iconbtn {
  flex: none;
  width: 48px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--text-secondary);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, transform 0.1s ease;
}

.mobile-back:active,
.mobile-iconbtn:active {
  background: var(--fill);
  transform: scale(0.94);
}

.mobile-iconbtn svg {
  width: 20px;
  height: 20px;
}
/* ── quick actions bar ───────────────────────────────────────────────── */

.mobile-quickchip {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--border-default);
  border-radius: 18px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-md);
  font-weight: 400;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease, transform 0.1s ease;
}

/* 36px 视觉、44px 命中区（和工作区快捷条一致）。 */
.mobile-quickchip::after {
  content: '';
  position: absolute;
  inset: calc(var(--palm-s1) * -1);
  border-radius: inherit;
}

.mobile-quickchip svg {
  width: 15px;
  height: 15px;
}

.mobile-quickchip:active {
  transform: scale(0.96);
  background: var(--fill-strong);
}

/* Run-overview quick chip: live dot pulses while anything is running and
   the live count rides beside the label (same chip grammar as pin/recent). */

.mobile-search {
  flex: none;
  padding: 6px 16px 8px;
}
/* ── 空态（P6 ⑯）：先说清，再给一步 ───────────────────────────────── */

.empty-state {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  padding: var(--palm-s5) var(--palm-s4);
  text-align: center;
}

/* 会话首屏的空态（2026-11-10 实拍）：.chat 是 flex 列，空态没有 flex 权重时
 * composer 会停在屏幕中间、下面留一大片空；同一块里标题居中、图标块却被 stretch
 * 顶在左边。这里让它吃掉剩余高度并把内容十字居中 —— composer 回到屏幕底部。 */
.chat > .empty-state {
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  /* 320px 实拍（2026-11-10）：草稿写到五六行时，空态这块的 flex 最小高度是
     auto（内容高度），它不肯让位，于是 composer 被整块顶到屏幕外 —— 最后一行
     和发送键都露不出来。这里允许它缩到 0、必要时自己滚，composer 就永远在视口里。 */
  min-block-size: 0;
  overflow-y: auto;
}

.empty-state-title {
  margin: 0;
  font-size: var(--palm-t-l);
  font-weight: var(--palm-w-bold);
  line-height: var(--palm-lh-head);
  color: var(--palm-fg);
}

.empty-state-hint {
  margin: 0;
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-3);
}

.empty-state-action {
  margin-top: var(--palm-s2);
}


/* 图标槽位（定版图：空态 = 38px 图标方块 + 标题 + 一句说明 + 主按钮） */
.empty-state-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--palm-spec-empty-ico);
  height: var(--palm-spec-empty-ico);
  margin-bottom: var(--palm-s2);
  border-radius: var(--palm-spec-empty-r);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
}

.empty-state-icon > svg {
  width: var(--palm-spec-glyph);
  height: var(--palm-spec-glyph);
}
/* ── 失败态（P6 ⑰）：留住错误，给得起重试 ─────────────────────────── */

.error-note {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  margin: var(--palm-s3) 0;
  padding: var(--palm-s3) var(--palm-s4);
  background: var(--palm-tint-danger);
  border: 1px solid var(--palm-danger);
  border-radius: var(--palm-r-m);
}

.error-note-message {
  margin: 0;
  font-size: var(--palm-t-m);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg);
}

.error-note-actions {
  display: flex;
  gap: var(--palm-s2);
}

.error-note-retry {
  min-height: var(--palm-hit);
  padding: 0 var(--palm-s4);
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
  color: var(--palm-fg);
  background: var(--palm-sur-2);
  border: 1px solid var(--palm-line);
  border-radius: var(--palm-r-s);
}

.error-note-dismiss {
  min-height: var(--palm-hit);
  padding: 0 var(--palm-s4);
  font-size: var(--palm-t-m);
  color: var(--palm-fg-2);
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--palm-r-s);
}


/* 失败态图标：和空态同一套 32/16 规格，保持节奏一致 */
.error-note-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  color: var(--palm-danger);
}

.error-note-icon > svg {
  width: 16px;
  height: 16px;
}
/* ── grouped lists + group titles ────────────────────────────────────── */

/* 分组标题（定版图）：12px 灰字「今天 · 3」，上 8 / 下 4 的留白。
   原来是一条 32px 高、全大写的标签——它比行标题还抢眼，而分组只是路标。 */
/* ── THE unified card ──────────────────────────────────────────────────
   One spec for every list card: full-width of the 16px-inset column,
   14px radius, --card-bg/--card-border/--card-shadow, press scale 0.98
   + 5% lighten over 100ms. Internal alignment grid: 48px icon zone ·
   fluid text · ≥48px right action zone (right-aligned, never drifts). */

.mobile-row {
  position: relative;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  /* <button> is shrink-to-fit on width:auto — pin the card to the 12px-inset column. */
  width: calc(100% - 24px);
  margin: 0 12px 8px;
  padding: 0 12px;
  min-height: 72px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-card);
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 0.1s ease, background-color 0.1s ease, border-color 0.1s ease, box-shadow 0.1s ease, color 0.3s ease;
}

@media (hover: hover) {
  .mobile-row:hover {
    box-shadow: var(--shadow-lg);
  }
}

/* 会话卡片的标题列要尽量宽：图标列 48→36px、右箭头列 48→24px、间距 12→8px。
   只加在会话行上（.mobile-row-sess），工作区/设置行仍按原来的 48px 列排版 ——
   它们的图标是 48px 的 .ws-icon，套窄列会溢出。 */
.mobile-row-sess {
  grid-template-columns: 36px minmax(0, 1fr) auto;
  gap: 8px;
}

.mobile-row-sess .card-icon {
  width: 36px;
  height: 36px;
}

.mobile-row-sess .card-icon > * {
  width: 32px;
  height: 32px;
  border-radius: 9px;
}

.mobile-row-sess .card-icon svg {
  width: 17px;
  height: 17px;
}

.mobile-row-sess .card-action {
  min-width: 24px;
}

/* 按压态：scale(0.98) + 背景变亮 5% */
.mobile-row:active {
  transform: scale(0.98);
  background: var(--palm-press-bg);
  border-color: var(--border-default);
}

/* ── 会话行卡（定版图）：三行信息卡 ────────────────────────────────────
   一行标题 17/600、二行「状态胶囊 + 时间 + 箭头」、三行一行预览。整卡是
   表面色 + 1px hairline，12 圆角，内边距 12/14 —— 所以这里的 .sess-card 要
   盖掉通用卡的图标列网格（48/36px 图标列在这三行里没有位置）。
   横向 14px 是定版图给的档位，令牌里只有 12 / 16，中间这一档单独写死。 */

/* 三行之间的呼吸：2 拍 4px，比卡内的 12px 内边距小，读起来是一整块而不是三段。 */
.sess-card .sess-meta {
  margin-top: var(--palm-s1);
}

.sess-card .card-desc {
  display: block;
  margin-top: var(--palm-s1);
  color: var(--palm-fg-3);
}
/* ── swipe-to-delete wrapper ────────────────────────────────────────────
   The row lives inside a swipe wrapper: a left swipe translates the inner
   (row) left to reveal the delete action behind it. The wrapper owns the
   card's margin/radius; the row inside drops its own so the reveal edge
   stays flush. The translate lives on the inner (not the row) so the row's
   :active press-scale never fights the swipe offset. */
.mobile-row-swipe {
  position: relative;
  /* 与会话卡片的 12px 内缩对齐（见 .mobile-row），否则滑动露出层会错边。
     行间距 10px 是定版图的值：令牌里最接近的是 8 / 12，中间这一档单独写死。 */
  margin: 0 var(--palm-s3) 10px;
  border-radius: var(--palm-r-m);
  overflow: hidden;
}
.mobile-row-swipe .mobile-row {
  margin: 0;
  width: 100%;
  border-radius: 0;
}

/* 按压态：滑动行的正后方就是那条常驻的红色删除按钮（.mobile-row-swipe-action），
   而全局的 .mobile-row:active 会把卡片缩到 98%——右缘于是漏出一条红边，每一次
   点击都闪一下，看起来像"删除按钮冒出来了"（见 swipe-active-probe 探针）。这里
   只取消缩放，保留上文的变亮/描边按压反馈。 */
.mobile-row-swipe .mobile-row:active {
  transform: none;
}

/* iOS 主屏安装提示（设置 → 设备，见 ios-install-hint.tsx）：一行说明 + 一个小
   按钮，只在 iOS Safari 且尚未装到主屏时出现。 */
.settings-installHint {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
/* 「知道了」：40x24 摸着太费劲（审计实测），给到 32px 高 */
.settings-installHint-btn {
  min-height: 32px;
  flex: none;
  padding: 4px 12px;
  border: 1px solid var(--border-default);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
}

/* 上报性能数据（设置 → 通用，见 perf-report.tsx）：两个小按钮并排。 */
.settings-perfActions {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
}

/* Icon zone: a fixed 48px column; the icon itself is 40px. */
.card-icon,
.ws-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-icon > *,
.ws-icon > * {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
}

.ws-icon svg,
.card-icon svg {
  width: 19px;
  height: 19px;
}

/* Icon tints per project kind. */

/* Content zone. */

.card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.35;
}

.card-desc {
  margin: 0;
  font-size: var(--text-md);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Right action zone: right-aligned, min 48px, always in the same place.
   会话行只放一个箭头，宽度由 .mobile-row-sess 收到 24px。 */
.card-action {
  min-width: 48px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.mobile-chevron {
  flex: none;
  color: var(--text-quaternary);
  font-size: 18px;
  line-height: 1;
}

/* Legacy column layout still used by a few stacked rows (settings forms). */

/* Active workspace: 3px accent rail + tinted icon. */

.sess-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--text-muted);
}

/* 状态点是 8px 的小圆，不是图标：.card-icon > * 会把直接子元素撑成 40px 的
   圆角方块，运行中的绿点于是变成一个绿色大方块（真机反馈 2026-10-20）。这里用
   两个类名的选择器压回去。 */
.card-icon > .sess-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}

/* Title line: the title owns the line and wraps instead of truncating.
   日期与状态移到下一行的小字里（.sess-meta）：原来是"标题 · 日期"挤在一行，
   标题被日期挤成一截加省略号，看不全会话名。 */

.sess-title {
  display: block;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  font-size: var(--palm-t-l);
  font-weight: var(--palm-w-bold);
  color: var(--palm-fg);
  line-height: var(--palm-lh-head);
}

/* 元信息行（定版图第二行）：状态胶囊 → 时间 → 右箭头。自动换行，不与标题抢宽度；
   箭头用 margin-left:auto 钉在右缘，胶囊有多少个都不影响它。 */
.sess-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--palm-s2);
  margin-top: 1px;
}

/* 行尾箭头：16px 线性 SVG，钉在第二行右缘（不再单开一列）。 */
.sess-meta .mobile-chevron {
  display: flex;
  align-items: center;
  margin-left: auto;
  color: var(--palm-fg-3);
}

.sess-meta .mobile-chevron svg {
  width: 16px;
  height: 16px;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(0.85);
    opacity: 0.6;
  }
}
/* ── dashed create card ──────────────────────────────────────────────── */
/* ── settings ────────────────────────────────────────────────────────── */

/* Source badges: where a setting takes effect / can be changed. */
.settings-badge {
  display: inline-block;
  font-size: 10px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 5px;
  font-weight: 500;
  flex-shrink: 0;
  vertical-align: middle;
}
.settings-badge-phone { background: var(--tone-positive-soft); color: var(--tone-positive-ink); }
.settings-badge-sync { background: var(--accent-soft); color: var(--accent); }
.settings-badge-desktop { background: var(--tone-neutral-soft); color: var(--tone-neutral-ink); }
.settings-badge-ro { background: var(--danger-soft); color: var(--tone-danger-ink); }
.settings-badge-recommend { background: var(--tone-warning-soft); color: var(--tone-warning-ink); }

/* Channel-setup disclosure (channel setup helper): native details chrome
   kept minimal so the steps read as plain description text. */
.settings-details {
  margin: 6px 0 2px;
}
.settings-details summary {
  display: inline-block;
  font-size: 12px;
  color: var(--accent);
  cursor: pointer;
  padding: 2px 0;
}
.settings-details summary::-webkit-details-marker { display: none; }
.settings-details .settings-detailsBody {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.7;
  margin: 4px 0 0;
  padding-left: 12px;
  border-left: 2px solid var(--accent-soft);
}

/* Notification inbox rows: kind pill + title + time on one line, body below. */
.settings-inbox {
  display: flex;
  flex-direction: column;
}
.settings-inboxRow {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
}
.settings-inboxRow:disabled {
  opacity: 0.5;
  cursor: default;
}
.settings-inboxRow:last-child {
  border-bottom: 0;
}
.settings-inboxLine {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
  min-width: 0;
}
/* Body lines may carry long unwrapped tokens (command lines, Windows
   paths); wrap them anywhere instead of blowing the row width, and cap
   the preview at two lines so the inbox stays visually tidy. */
.settings-inboxRow .card-desc {
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-width: 0;
}
.settings-inboxKind {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  font-weight: 500;
}
.settings-inboxKind-task-done { background: var(--tone-positive-soft); color: var(--tone-positive-ink); }
.settings-inboxKind-task-failed { background: var(--danger-soft); color: var(--tone-danger-ink); }
.settings-inboxKind-todo-done { background: var(--tone-info-soft); color: var(--tone-info-ink); }
.settings-inboxKind-turn-done { background: var(--accent-soft); color: var(--accent); }
/* 需要用户动手的两类（2026-11-10，390px 实拍）：审批与提问原来没有专属配色，落回灰底，
   在「最近通知」里跟普通条目一样不起眼 —— 而它们恰恰是"卡住等你"的。统一用警示色，
   与绿（完成）/ 红（失败）/ 蓝（规划）/ 靛（回复）区分开。 */
.settings-inboxKind-approval { background: var(--tone-warning-soft); color: var(--tone-warning-ink); }
.settings-inboxKind-question { background: var(--tone-warning-soft); color: var(--tone-warning-ink); }
.settings-inboxTitle {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.settings-inboxTime {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--text-tertiary);
}

/* Channel credential presence label (push-channel fields). */
.settings-channelState {
  display: inline-block;
  font-size: 10.5px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--tone-neutral-soft);
  color: var(--tone-neutral-ink);
  margin-top: 2px;
}
.settings-channelState-on {
  background: var(--tone-positive-soft);
  color: var(--tone-positive-ink);
}

/* First-run welcome card: one-shot onboarding hint above the roster. */

/* 首次引导里的「知道了」：40x24 太难点（审计实测），给到 32px 高 */

/* Legend under the search box explaining the badges. Two-column grid:
   badge column fixed, text column left-aligned — every explanation starts
   at the same x, and the rows never reflow into ragged starts. */

/* Group title trailing hint (e.g. 显示效果). */

/* Host-side voice services hint on the voice page. */
.settings-hostNote {
  margin: 0 16px 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  line-height: 1.5;
}

/* Section sub-heading inside a page (e.g. 桌面端配置（只读）). */
.settings-subhead {
  margin: 14px 16px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
}

/* Read-only tag on host-side rows. */
.settings-roTag {
  display: inline-block;
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--tone-neutral-soft);
  color: var(--tone-neutral-ink);
  vertical-align: middle;
}

/* Collapsible read-only field block (replaces disabled controls). */
.settings-roBlock {
  margin-top: 10px;
  border-top: 1px dashed var(--card-border);
  padding-top: 10px;
}
.settings-roSummary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  border: 1px dashed var(--card-border);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12.5px;
  cursor: pointer;
}
.settings-roToggle {
  color: var(--accent);
  font-weight: 500;
}
.settings-roList {
  margin-top: 8px;
}
.settings-roItem {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 2px;
  font-size: 12.5px;
  border-bottom: 1px solid var(--card-border);
}
.settings-roItem:last-child { border-bottom: none; }
/* The key column must be able to give way: while it was shrink 0 the item kept
   its max-content width, which overflow-wrap alone cannot lower. */
.settings-roKey {
  color: var(--text-tertiary);
  flex-shrink: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.settings-roValue {
  color: var(--text-primary);
  font-weight: 500;
  text-align: right;
  word-break: break-all;
}

/* 用量要等宿主跑一遍 provider 余额查询（实测 3 秒+），期间只有一行「加载中…」，
   看着像卡死。给个骨架条。 */
.settings-skeleton {
  display: block;
  height: 14px;
  margin: 6px 0;
  width: 62%;
  border-radius: var(--radius-chip);
  background: linear-gradient(90deg, var(--bg-input) 25%, var(--border-default) 50%, var(--bg-input) 75%);
  background-size: 200% 100%;
  animation: settings-skeleton-sweep 1.2s ease-in-out infinite;
}

/* 主机配置首次读取：没有快照才出现（有页面快照时直接画分组行）。 */
.settings-skeleton-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 16px 14px;
}

@keyframes settings-skeleton-sweep {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

.settings-group {
  list-style: none;
  margin: 0 16px 16px;
  padding: 0;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-card);
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.settings-groupTitle {
  height: 32px;
  padding: 0 16px;
  margin: 0;
  display: flex;
  align-items: flex-end;
  padding-bottom: 2px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Settings rows ride the unified card grid at the small-card tier. */
.settings-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  min-height: 56px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--text-base);
  color: var(--text-primary);
}

/* Inside a settings group the card loses its own inset. */
.settings-group .mobile-row {
  margin: 0;
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  border-radius: 0;
  box-shadow: none;
}

.settings-group .mobile-row:last-child {
  border-bottom: none;
}

.settings-row:last-child {
  border-bottom: none;
}

/* Rows that open a picker render as <button>; keep the row look. */
button.settings-row {
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

button.settings-row:active {
  background: var(--fill);
}

button.settings-row:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--accent);
}

.settings-row .card-icon > * {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.settings-rowValue {
  /* 右值自己限宽：给第三轨封百分比会把 42% 白送给它，标题列只剩四五个字。
     限在 6em（约 78px）以内，短值照常显示，长值自己出省略号。 */
  max-width: 6em;
  min-width: 0;
  color: var(--text-quaternary);
  font-size: var(--text-md);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 送达失败/已过滤行：不能和中性统计同款灰字 —— 用户扫一眼得知道"这里出过错"。
   复合选择器是必须的：后面 .settings-note 的 color 同权重，单写一个类会被盖掉。 */
.settings-note.notify-delivery-fail { color: var(--palm-danger); }
.settings-note.notify-delivery-drop { color: var(--palm-warn); }
.settings-note {
  padding: 10px 16px 12px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  line-height: 1.5;
}

/* Per-provider usage/quota card (settings 用量 group). */
.usage-provider {
  padding: 14px 16px;
  border-bottom: 1px dashed var(--card-border);
}
.usage-provider:last-child {
  border-bottom: none;
}
.usage-providerHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.usage-providerName {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-weight: 600;
  font-size: var(--text-base);
  color: var(--text-primary);
  /* Provider ids come from the host: wrap a long one instead of letting it
     spill past the card and overlap the status badge. */
  overflow-wrap: anywhere;
}
.usage-providerBase {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-quaternary);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage-badge {
  flex: none;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 6px;
  letter-spacing: 0.3px;
}
.usage-badge-ok { background: var(--palm-tint-accent); color: var(--palm-accent); }
.usage-badge-no { background: var(--palm-tint-warn); color: var(--warning); }
.usage-badge-na { background: var(--bg-elevated); color: var(--text-quaternary); }
.usage-badge-err { background: var(--danger-soft); color: var(--danger); }
.usage-meter {
  height: 8px;
  border-radius: 6px;
  background: var(--bg-elevated);
  overflow: hidden;
}
.usage-meterFill {
  height: 100%;
  border-radius: 6px;
  /* 2026-11-10 纸色实拍：进度条原来是旧蓝，整页换成暖白后只剩它在发蓝。 */
  background: linear-gradient(90deg, var(--palm-accent), var(--palm-accent-2));
  transition: width 0.4s ease;
}
/* One quota window block (5-hour / weekly): label row + meter + reset note. */
.usage-block + .usage-block {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
.usage-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.usage-rowLabel {
  font-size: 12.5px;
  color: var(--text-secondary);
}
.usage-rowValue {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.usage-resetNote {
  margin: 5px 0 0;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--text-quaternary);
}
.usage-stats {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.usage-stats b {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.usage-models {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}
.usage-model {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.usage-modelName {
  min-width: 0;
  margin-right: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
}
.usage-modelCount {
  flex: none;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.usage-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-subtle);
}

/* Toggle switch: 44×32 track inside a 44×44 button hit area. */
.settings-switch {
  position: relative;
  flex: none;
  width: var(--palm-hit);
  height: var(--palm-hit);
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.18s ease;
}

.settings-switch::before {
  content: '';
  position: absolute;
  inset-inline: 0;
  top: 50%;
  width: var(--palm-hit);
  height: 32px;
  transform: translateY(-50%);
  border-radius: 16px;
  background: var(--border-default);
  transition: background-color 0.18s ease;
}

.settings-switch::after {
  content: '';
  position: absolute;
  /* Track 32 and thumb 20 leave a centered 6px inset on each side. */
  top: 50%;
  left: 2px;
  width: 20px;
  height: 20px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: var(--palm-sur-1);
  box-shadow: var(--palm-sh1);
  transition: transform 0.18s ease;
}

.settings-switch-on::before {
  /* 2026-11-10（paper / nocturne 实拍）：原来写的是旧名 --accent —— 它在两套主题里
     都是同一个蓝（见 design/tokens.ts），换肤时不变，于是纸色（棕）与夜航（青）下
     开关仍是蓝的。换肤要换的是这一处，改走皮肤令牌。 */
  background: var(--palm-accent);
}

.settings-switch-on::after {
  transform: translate(20px, -50%);
}

.settings-input {
  flex: 1;
  min-width: 0;
  min-height: var(--palm-hit);
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: 16px;
  outline: none;
  transition: border-color 0.15s ease;
}

.settings-input:focus {
  border-color: var(--border-focus);
}

.settings-input:disabled {
  opacity: 0.55;
}

.settings-textarea {
  width: 100%;
  min-height: var(--palm-hit);
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: 16px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s ease;
}

.settings-textarea:focus {
  border-color: var(--border-focus);
}

.settings-textarea:disabled {
  opacity: 0.55;
}

.settings-card {
  margin: 0 16px 16px;
  padding: 4px 16px 10px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-card);
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
}

.settings-cardHead {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 12px 0 4px;
}

.settings-cardTitle {
  flex: 1;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-primary);
}

.settings-field {
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);
}

.settings-field:last-child {
  border-bottom: none;
}

.settings-fieldHead {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.settings-fieldLabel {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 400;
  color: var(--text-primary);
  /* A plugin schema field key is host text and can have no hyphen to break on:
     wrap it instead of pushing the card sideways. */
  overflow-wrap: anywhere;
}

.settings-fieldLock {
  flex: none;
  padding: 2px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-chip);
  background: var(--fill);
  color: var(--text-tertiary);
  font-size: 10.5px;
  font-weight: 400;
}

.settings-fieldDesc {
  margin: 3px 0 8px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  line-height: 1.45;
}

.settings-readonly {
  color: var(--text-tertiary);
  font-size: var(--text-md);
  overflow-wrap: anywhere;
}

.settings-subgroup {
  padding: 8px 0 2px;
}

.settings-subgroupTitle {
  display: block;
  margin-bottom: 4px;
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
}

.settings-saved {
  color: var(--positive);
  font-size: var(--text-md);
}

.settings-optionStrip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 0 6px;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.settings-optionStrip::-webkit-scrollbar {
  display: none;
}

.settings-optionChip {
  flex: none;
  min-height: var(--palm-hit);
  padding: 6px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease, color 0.12s ease;
}

.settings-optionChip:active {
  transform: scale(0.96);
}

.settings-optionChip-on {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}

.settings-ownerHint {
  margin: 0 0 6px;
  color: var(--text-muted);
  font-size: 11.5px;
}
/* ── empty / error / boot states ─────────────────────────────────────── */

.mobile-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 32px 16px;
  text-align: center;
}

.mobile-muted {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 14px;
}

.mobile-error {
  margin: 0;
  color: var(--danger);
  font-size: 14px;
  /* A pairing or workspace failure carries a host message that can hold a
     path: wrap a long token instead of overflowing the card. */
  overflow-wrap: anywhere;
}

/* ── render-crash error page (ErrorBoundary) ─────────────────────────── */

.mobile-errorpage {
  gap: 14px;
  padding: 32px 24px;
}

.errorpage-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 600;
}

.errorpage-reason {
  margin: 0;
  max-width: 100%;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: break-word;
}

.errorpage-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 6px;
}

.mobile-button-muted {
  height: 44px;
  padding: 0 18px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.1s ease, background-color 0.1s ease, border-color 0.1s ease;
}

.mobile-button-muted:active {
  transform: scale(0.98);
  background: var(--fill);
  border-color: var(--border-focus);
}

/* 空态图标槽位：定版图口径 = 38px 圆角方块 + 16px 线性图标。
   与 .empty-state-icon（055-empty-state.css）同一尺寸，两种空态容器看起来是一套。 */
.empty-icon {
  width: var(--palm-spec-empty-ico);
  height: var(--palm-spec-empty-ico);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: var(--palm-s2);
  border-radius: var(--palm-spec-empty-r);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
}

.empty-icon svg {
  width: var(--palm-spec-glyph);
  height: var(--palm-spec-glyph);
}

.empty-title {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-secondary);
}

.empty-desc {
  margin: 0;
  max-width: 280px;
  font-size: var(--text-md);
  line-height: 1.6;
  color: var(--text-tertiary);
}

.boot-dot {
  width: 10px;
  height: 10px;
  border-radius: var(--radius-full);
  background: var(--accent);
  animation: breathe 1.6s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  30% {
    transform: scale(1);
    opacity: 1;
  }
}

/* ── skeleton placeholder (no spinners) ───────────────────────────────── */

/* 骨架条：ui/primitives.tsx 的 Skeleton 唯一样式（任务头占位靠它撑住高度）。
   旧的 .skel / @keyframes shimmer 一起删掉 —— 全仓没有一处引用它。 */
[data-skeleton] { display: flex; flex-direction: column; gap: var(--palm-s1); inline-size: 100%; }
[data-skeleton-line] { display: block; block-size: var(--palm-s3); border-radius: var(--palm-r-full); background: var(--fill); }
[data-skeleton-line]:last-child { inline-size: 60%; }

/* 加载时的状态条占位（2026-11-10 实拍）：骨架里原来放的是真 StatusStrip，
 * 屏幕上出现「一条空药丸 + 一个破折号」，像坏掉的控件。这里把它画成纯粹的
 * 占位面：填充色即骨架色、去掉描边、不写任何文字。 */
.palm-strip[data-skeleton='true'] {
  background: var(--fill);
  border-color: transparent;
}
/* ── buttons ─────────────────────────────────────────────────────────── */

.mobile-button {
  height: 44px;
  padding: 0 18px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--card-bg);
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.1s ease, background-color 0.1s ease, border-color 0.1s ease;
}

.mobile-button:active {
  transform: scale(0.98);
  background: var(--fill);
  border-color: var(--border-focus);
}

.mobile-button:disabled {
  opacity: 0.5;
  transform: none;
}

.mobile-block {
  display: block;
  width: calc(100% - 32px);
  margin: 4px 16px;
}

/* 主按钮（定版图）：全宽、44px 高、强调色实心、12 圆角。 */
.mobile-new {
  display: block;
  width: calc(100% - 32px);
  height: var(--palm-hit);
  margin: 0 var(--palm-s4);
  border: none;
  border-radius: var(--palm-r-m);
  background: var(--palm-accent);
  color: var(--palm-on-accent);
  font: inherit;
  font-size: var(--palm-t-l);
  font-weight: var(--palm-w-bold);
  cursor: pointer;
  box-shadow: 0 2px 8px var(--accent-glow);
  transition: transform 0.1s ease, filter 0.1s ease;
}

.mobile-new:active {
  transform: scale(var(--palm-btn-press-scale));
  filter: brightness(var(--palm-btn-press-dim));
}

.mobile-new:disabled {
  opacity: var(--palm-btn-disabled-opacity);
  transform: none;
  box-shadow: none;
}

/* F1 会话筛选（定版图）：一行药丸，选中「强调色描边 + 淡底」，未选「灰底无描边」。
   药丸本身撑满 44px 触控高度，视觉高度就是触控高度——手机上一行矮药丸比多出来的
   空白更容易点错。 */

.mobile-pad {
  padding: 8px 16px;
}

/* 选择器卡片（定版图）：左侧当前项名字一行，右侧圆形「?」。卡片整体是
   表面色 + 1px hairline，12 圆角；名字那一行可点开选择面板。 */

/* 圆形「?」：44px 触控，16px 线性图标，一圈 hairline——和卡片同一套线。 */
/* ── chat ────────────────────────────────────────────────────────────── */

.chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  /* Anchor the viewport to the newest content while streaming: browser
     scroll anchoring keeps the visible region stable when frames above it
     change height (Chromium WebView supports this natively). */
  overflow-anchor: auto;
  padding: var(--palm-s3) var(--palm-s3) calc(env(safe-area-inset-bottom, 0) + var(--palm-s3));
  display: flex;
  flex-direction: column;
  /* 用户定的节奏（2026-10-13）：12px。卡片与紧随其后的正文另有 12px
     （见 .chat-* + .chat-flow-text 规则），所以卡片上下读起来正好是 12px ＋ 12px。
     注意：这是**全列表**的行间距，普通文字消息也按 12px 排。 */
  gap: var(--palm-s3);
}

/* Scroll children never shrink. The bubbles pin an explicit min-height
   (48px tier), which replaces flex's automatic min-content floor — without
   this, a long column of messages gets crushed to 48px each and the
   overflow visually overlaps the neighbours. */
.chat-scroll > * {
  flex-shrink: 0;
}

/* Density preference (settings): 紧凑把整个消息节奏收紧一格。
   只改 .chat-scroll 的 gap 时每条只差 4px（12→8），一屏八条才差 28px，真机上
   等于看不出（实测反馈）。所以连用户气泡的内边距、段落间距、正文行高一起收。 */
[data-density='compact'] .chat-scroll {
  gap: 8px;
}

[data-density='compact'] .chat-msg-user {
  padding: 8px 14px;
}

[data-density='compact'] .chat-md + .chat-md,
[data-density='compact'] .chat-flow-text + .chat-flow-text,
[data-density='compact'] .chat-md + .chat-flow-text,
[data-density='compact'] .chat-flow-text + .chat-md {
  margin-top: 10px;
}

[data-density='compact'] .chat-md-body p + p {
  margin-top: 10px;
}

[data-density='compact'] .chat-md-body {
  line-height: 1.55;
}

/* Jump-to-latest: a floating round button pinned to the bottom-right of
   the message viewport (sticky inside the scroll container, so it never
   rides the content). Appears once the reader scrolled away from the
   bottom; the badge counts messages that arrived while away. */
.chat-jump-latest {
  position: sticky;
  bottom: 12px;
  align-self: flex-end;
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  box-shadow: var(--palm-sh2);
  cursor: pointer;
  /* Same press-vs-selection guard as the turn handle: a held press on the
     round button must still count as a tap. */
  -webkit-user-select: none;
  user-select: none;
  touch-action: manipulation;
  transition: background 120ms ease, color 120ms ease, transform 120ms ease;
  animation: chat-jump-in 160ms ease-out;
}
.chat-jump-latest:active {
  transform: scale(0.92);
}
/* New messages arrived while away: pulse the button to draw the eye. */
.chat-jump-latest-hot {
  color: var(--accent);
  border-color: var(--accent);
  animation: chat-jump-in 160ms ease-out, chat-jump-pulse 1.6s ease-in-out infinite;
}
.chat-jump-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  color: var(--palm-on-accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}
@keyframes chat-jump-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes chat-jump-pulse {
  0%, 100% { box-shadow: var(--palm-sh2); }
  50% { box-shadow: 0 2px 18px var(--accent-soft); }
}

/* Font-size preference: 小 / 标准 / 大。三档是 13 / 15 / 18px —— 原先 14/15/16.5
   只差 1px，等于没做（实测反馈看不出）。同时覆盖气泡与助手正文：只改 .chat-msg
   的话，助手那种长回复的字号根本不变。 */
[data-font-scale='small'] .chat-msg,
[data-font-scale='small'] .chat-md-body,
[data-font-scale='small'] .chat-flow-text,
[data-font-scale='small'] .chat-think-body {
  font-size: 13px;
}

[data-font-scale='large'] .chat-msg,
[data-font-scale='large'] .chat-md-body,
[data-font-scale='large'] .chat-flow-text,
[data-font-scale='large'] .chat-think-body {
  font-size: 18px;
}

/* Message bubbles — the large-card tier. */
.chat-msg {
  max-width: 78%;
  min-height: var(--palm-hit);
  padding: var(--palm-s3);
  border-radius: var(--palm-r-m);
  font-size: var(--palm-chat-body-size);
  font-weight: var(--palm-w-normal);
  line-height: var(--palm-lh-body);
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

/* 入场动画只给「第一次出现的行」。
 *
 * 打开会话时是"先粗后细"两轮提交：第一轮的行还没有 turn/step（key 退化成 id），
 * 事件折完之后 key 变成 turn.step 组合键 —— React 于是把整屏行卸了重挂（实测
 * 113/114 行 remount），动画挂在 .chat-msg 上就跟着重播一遍，肉眼是「一打开会话
 * 正文闪一下」（2026-10-30 真机）。键变了没法避免重挂，但重挂不该重播动画。
 */
.chat-msg:not(.chat-msg-no-enter) {
  animation: msg-in 0.18s ease both;
}

/* 消息正文长按走自定义菜单（编辑/复制/引用）；同时允许长按选字——一旦产生
   选区，ChatView 的 openCtxFromTarget 会让位给系统（局部复制优先），不弹
   自定义菜单。代码块/diff 仍允许选择复制。
   另外把 * 上禁掉的 touch-callout 在这些块里放开：iOS 长按选字后要能看到系统那个
   "拷贝/查询"气泡，否则只能拖手柄、拿不到复制入口。 */
.chat-msg-text,
.chat-md-body,
.chat-flow-text,
.chat-think-body,
.chat-tool-args {
  min-width: 0;
  max-width: 100%;
  user-select: text;
  -webkit-user-select: text;
  -webkit-touch-callout: default;
}.code-block pre{
  min-width: 0;
  max-width: 100%;
  user-select: text;
  -webkit-user-select: text;
  -webkit-touch-callout: default;
}

@keyframes msg-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 用户气泡（对照稿）：右上停靠、深底、12/12/4/12 圆角、最大宽 78%。
   不再用整块主题色 —— 主题色留给发送键与链接，气泡退回"一块安静的深底"。 */
.chat-msg-user {
  align-self: flex-end;
  width: auto;
  max-width: 78%;
  background: var(--palm-sur-2);
  color: var(--palm-fg);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m) var(--palm-r-m) var(--palm-s1) var(--palm-r-m);
  box-shadow: none;
}

/* 消息图片：0.1.5 起事件只带 attachmentId 引用，字节由 mobile.readAttachment
   按需取（见 attachment-images.ts）。缩略图固定上限高度，含图的行才不会把
   窗口化的高度估算撑爆；点一下由 ChatView 的滚动点击开全屏。 */
.chat-msg-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

/* 消息里的文件附件（桌面端文件卡片的手机版）：一条一枚，图标 + 名字 + 扩展名·大小。
   比图片组更宽：文件名要能读出来，所以整行铺开、名字可截断。 */
.chat-msg-files {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.chat-msg-file {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--bg-elevated);
}

.chat-msg-file-glyph {
  flex: none;
  color: var(--accent);
}

.chat-msg-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 600;
}

.chat-msg-file-meta {
  flex: none;
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.chat-msg-image {
  display: block;
  width: auto;
  height: auto;
  max-width: min(100%, 260px);
  max-height: 220px;
  border-radius: 10px;
  object-fit: cover;
  background: var(--fill);
}

.chat-msg-image-placeholder {
  min-width: 128px;
  min-height: 72px;
  padding: 10px 12px;
  border: 1px dashed var(--border-default);
  border-radius: 10px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
}

.chat-msg-image-failed {
  border-color: var(--danger);
  color: var(--danger);
}

/* Assistant messages are independent prose blocks (no bubble, no frame):
   the visual hierarchy comes from the content itself. 左右各留 4px：
   正文不顶到屏幕边，和右侧的用户气泡在视觉上分开一档。 */
.chat-msg-assistant {
  align-self: stretch;
  width: auto;
  max-width: none;
  background: transparent;
  border: none;
  box-shadow: none;
  border-radius: 0;
  padding: 0 var(--palm-s1);
}

.chat-msg-failed {
  border-color: var(--danger);
}

.chat-msg-failtag {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 8px;
  border: 1px solid var(--danger);
  border-radius: var(--radius-chip);
  color: var(--danger);
  font-size: var(--text-xs);
  font-weight: 400;
}

.chat-msg-maxtokens {
  margin-top: 8px;
  padding: 8px 10px;
  border: var(--palm-hair) solid var(--palm-warn);
  border-radius: var(--radius-card, 8px);
  /* 2026-11-10：原来 border/底/字三处都写 var(--warning, #e69641)，既绕开皮肤令牌
     （裸色兜底），又用 color-mix 现算淡底 —— iOS 15 上淡底消失只剩文字。 */
  background: var(--palm-tint-warn);
  color: var(--palm-warn);
  font-size: var(--text-xs);
  line-height: 1.5;
  word-break: break-word;
}

.chat-msg-time {
  display: block;
  margin-top: 4px;
  color: var(--text-quaternary);
  font-size: var(--text-xs);
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

/* Slash-command result card (command/run + command/done fold): a centered
   narrow strip, desktop-parity with the conversation command node. */
.chat-command {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  width: calc(100% - 32px);
  margin: 6px auto;
  padding: 8px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-chip);
  background: var(--card-bg);
  font-size: var(--text-sm);
  line-height: 1.4;
  /* The command line and its output are agent/user text and can carry a path
     or a URL: wrap a lone token so this flex row cannot widen the viewport. */
  overflow-wrap: anywhere;
}

.chat-command-name {
  color: var(--text-secondary);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  min-width: 0;
}

.chat-command-result {
  color: var(--text-tertiary);
  min-width: 0;
}

.chat-command-error .chat-command-result {
  color: var(--danger);
}

.chat-msg-user .chat-msg-time {
  color: var(--palm-fg-3);
  text-align: right;
}

.chat-msg-toggle {
  display: block;
  margin-top: 8px;
  padding: 4px 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: var(--text-md);
  font-weight: 400;
  cursor: pointer;
}

.chat-msg > .chat-msg-text,
.chat-msg > .chat-md {
  display: block;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  writing-mode: horizontal-tb;
  direction: ltr;
}

.chat-md {
  white-space: normal;
}

/* 只裁正文容器（.chat-md-body），「展开全文」按钮是它的兄弟节点，永远可点。 */
.chat-md-body.chat-md-collapsed {
  max-height: 45vh;
  overflow: hidden;
  position: relative;
}

.chat-md-body.chat-md-collapsed::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 28px;
  background: linear-gradient(transparent, var(--card-bg));
  pointer-events: none;
}

/* Paragraph rhythm, margin-top based. margin-bottom is deliberately NOT
   used: paragraphs live inside .md-html runs and a run usually holds a
   single <p>, so any "last paragraph" / :last-child rule matches EVERY
   paragraph and zeroes the whole rhythm. Spacing therefore only exists
   BETWEEN two adjacent paragraphs (16px) and before/after component
   cards (12px); the message row gap owns the tail spacing. */
.chat-md-body p { margin: 0; }
.chat-md-body p + p { margin-top: 16px; }
/* While a turn streams, the open tail lives in its own .md-html run next
   to the stable run(s); a blank line between two paragraphs then splits
   them across runs and the p + p rule above stops matching — the gap
   would collapse to 0 while streaming and pop to 16px the moment the
   tail closes into the same run. Keep the same rhythm across runs. */
.chat-md .md-html + .md-html { margin-top: 16px; }
/* A flow splits one message into several MarkdownText bodies (tool calls
   interleave text runs): adjacent bodies must keep the same paragraph
   rhythm, or the paragraph gap collapses to 0 the moment a tool lands.
   The MarkdownText root is .chat-msg-text.chat-md (the .chat-md-body is
   its inner wrapper), so the sibling rhythm lives on .chat-md edges. Flow
   rows wrap each text run in a <div data-step-seq class="chat-flow-text">,
   so the selector must also match the wrapper — otherwise adjacent runs
   collapse to 0 while streaming. */
.chat-md + .chat-md,
.chat-flow-text + .chat-flow-text,
.chat-md + .chat-flow-text,
.chat-flow-text + .chat-md { margin-top: 16px; }
/* Paragraph → code/diff card: the card is a sibling of the .md-html run
   (not of the <p> inside it), so the gap lives on the run boundary. */
.chat-md .md-html + .code-block,
.chat-md .md-html + .diff-block { margin-top: 12px; }/* Text run → diff artifact card (and back): FlowBody renders the card as a
   sibling of the .chat-md runs, leaving the card glued to the text. Flow rows wrap each
   text run in a <div data-step-seq class="chat-flow-text">, so the sibling
   selector must match both the bare .chat-md and the .chat-flow-text wrapper
   — otherwise the card glues to the text (gap collapses to 0). */
.chat-md + .chat-artifact, .chat-flow-text + .chat-artifact{ margin-top: 12px; }
.chat-artifact + .chat-md,
.chat-artifact + .chat-flow-text,
.chat-proc + .chat-md,
.chat-proc + .chat-flow-text,
.chat-command + .chat-md,
.chat-command + .chat-flow-text,
.chat-trigger + .chat-md,
.chat-trigger + .chat-flow-text { margin-top: 12px; }
/* Soft line breaks (single-\\n markdown lists, agent status lines) render as
   <br /> inside a paragraph: give each a small air gap, or consecutive
   single-line writes read as one dense block. */
.chat-md-body p br {
  display: block;
  content: '';
  margin-top: 6px;
}
/* In-body thinking folds ride the message tail as a quiet footnote. */
.chat-md-notes {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: 12px;
}
.chat-md-notes .chat-disclosure {
  margin: 0;
}
.chat-md-body h1, .chat-md-body h2, .chat-md-body h3,
.chat-md-body h4, .chat-md-body h5, .chat-md-body h6 {
  margin: 12px 0 6px;
  font-weight: 500;
  line-height: 1.3;
}
.chat-md-body h1 { font-size: 1.35em; }
.chat-md-body h2 { font-size: 1.25em; }
.chat-md-body h3 { font-size: 1.15em; }
.chat-md-body h4, .chat-md-body h5, .chat-md-body h6 { font-size: 1.05em; }
.chat-md-body code {
  font-family: var(--palm-font-mono);
  font-size: var(--palm-t-s);
  background: var(--palm-sur-2);
  color: var(--palm-accent);
  padding: 0 var(--palm-s1);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-s);
  box-shadow: none;
}
.chat-md-body ul, .chat-md-body ol { margin: 6px 0 10px; padding-left: 20px; }
.chat-md-body li { margin: 3px 0; }
.chat-md-body blockquote {
  margin: 10px 0;
  padding: 6px 12px;
  border-left: 3px solid var(--accent);
  background: var(--accent-soft);
  border-radius: 0 var(--radius-chip) var(--radius-chip) 0;
  color: var(--text-secondary);
}
.chat-md-body table {
  margin: 8px 0;
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
  font-size: var(--text-md);
}
.chat-md-body th, .chat-md-body td {
  border: 1px solid var(--border-default);
  padding: 6px 10px;
}
.chat-md-body th { background: var(--fill); font-weight: 500; text-align: left; }
.chat-md-body a { color: var(--accent); }
.chat-md-body hr { border: none; border-top: 1px solid var(--border-subtle); margin: 10px 0; }
.chat-md-body img { max-width: 100%; border-radius: var(--radius-chip); }
/* 正文里的本地图（agent 引用的工作区文件）：markdown 只带 data-local-src，
   挂载后经 mobile.readFile 取回 data URL 再填 src（见 local-images.ts）。
   取回前先占住尺寸，避免整段文字在图片到达时跳一下；取不回时给出可见的
   失败态，而不是让浏览器渲染一个破图图标。 */
.chat-md-body img.md-local-img {
  display: block;
  min-width: 96px;
  min-height: 56px;
  background: var(--fill);
  border: 1px dashed var(--border-subtle);
}
.chat-md-body img.md-local-img[data-local-state='loading'] {
  /* 内容尚未到达：占位框不显示 alt 文字被浏览器裁断的碎片。 */
  color: transparent;
}
.chat-md-body img.md-local-img[data-local-state='loaded'] {
  border: none;
}
/* 读不到时不再留破图：渲染器会把它换成这枚牌子（带 alt 与路径），
   用户一眼看出是「主机上没有这个文件」而不是 App 坏了。
   牌子可点：一次读失败常常只是图还没写完，点一下重试（2026-11-11 真机）。 */
.chat-md-body .md-img-missing {
  display: block;
  margin: var(--palm-s2) 0;
  padding: 8px 10px;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-chip);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
  cursor: pointer;
}
/* 文档/消息正文里的超长路径（无空格的连续 token）必须在文本 run 处可折，
   否则它会把消息或文件预览（.fp-md 没有 .chat-msg 祖先，继承不到任何
   overflow-wrap）撑出屏幕、整屏横向漂移。作用域限定在 .md-html 文本 run：
   代码块与 diff 卡是它的兄弟段（不是后代），横向滚动语义不受影响；而
   .code-block/.diff-block 用 min-width: max-content / overflow-x 自行处理
   长行。anywhere 而不是 break-word：只有 anywhere 会压低内容的 min-content
   尺寸，flex 布局下 break-word 并不会阻止 flex 项被长 token 撑宽。 */
.chat-md-body .md-html {
  overflow-wrap: anywhere;
  word-break: normal;
}
.chat-md-body .md-html p,
.chat-md-body .md-html li,
.chat-md-body .md-html blockquote,
.chat-md-body .md-html th,
.chat-md-body .md-html td {
  min-width: 0;
}

/* ── 空会话首屏（single-surface.html A 图）：同一个 .chat 容器里的空态 ─────
 * 56px 品牌方块 = 32 + 24 两个间距令牌之和（不在样式里写裸 56px）；
 * 标题/说明复用 .empty-state-title / .empty-state-hint，不再各写一套字号。 */
.chat > .empty-state {
  flex: 1;
  justify-content: center;
}

.chat .empty-state > .empty-state-icon {
  inline-size: calc(var(--palm-s7) + var(--palm-s6));
  block-size: calc(var(--palm-s7) + var(--palm-s6));
  margin-bottom: var(--palm-s2);
  border-radius: var(--palm-r-l);
  background: linear-gradient(150deg, var(--palm-accent), var(--palm-accent-2));
  color: var(--palm-bg);
  font-size: var(--palm-t-xl);
  font-weight: var(--palm-w-bold);
}

/* 三个示例 chip：复用 .mobile-quickchip（36px 视觉 / 44px 命中区）。 */
.chat .empty-state-action {
  display: flex;
  flex-wrap: wrap;
  gap: var(--palm-s2);
  justify-content: center;
}
/* ── code blocks: 12px card, 40px head bar, action buttons, Shiki body ── */

.code-block {
  /* Top gap after a paragraph comes from .chat-md-body p + .code-block
     (12px, margin collapse); between components the block keeps 12px. */
  margin: 0 0 12px;
  border: 1px solid var(--code-border);
  border-radius: var(--radius-card);
  background: var(--code-bg);
  overflow: hidden;
}

.code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  height: 40px;
  padding: 0 16px;
  background: var(--code-head-bg);
  border-bottom: 1px solid var(--code-head-border);
}

.code-lang {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.code-actions {
  flex: none;
  display: flex;
  align-items: center;
  /* 按钮从 32 抬到 40、间距从 2 抬到 8：代码块右上角那排（复制/插入/新标签/运行）
     是手机上高频点击，32×32 实测只有拇指尖能点准（真机清单第 5 项）。
     40 是折中：iOS 建议 44、安卓 48，但这排要塞进 390px 宽的代码头行，44×4 会挤掉语言名。 */
  gap: 8px;
}

.code-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  /* 32×32 → 40×40：见 .code-actions 的说明（真机清单第 5 项，触摸目标）。
     视觉只大一圈，但拇指命中率差别明显。 */
  min-width: 40px;
  height: 40px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color 0.12s ease, background-color 0.12s ease;
}

.code-btn svg {
  width: 16px;
  height: 16px;
  flex: none;
}

.code-btn:active {
  background: var(--fill);
}

@media (hover: hover) {
  .code-btn:hover {
    color: var(--text-primary);
  }
}

.code-btn:disabled {
  opacity: 0.5;
}

.code-btn-done {
  color: var(--positive);
}

.code-btn-label {
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;
}

.code-body-zone {
  position: relative;
}

.code-body {
  padding: 12px 16px;
  overflow-x: auto;
  /* 长行能横滑，但滚动条被藏起来时用户根本不知道这里能滑：给一条 3px 的细条。 */
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
}

.code-body::-webkit-scrollbar {
  height: 3px;
}

.code-body::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: var(--radius-full);
}

/* Folded long blocks clamp to ~15 lines; the mask fades the cut edge. */
.code-body-folded {
  max-height: calc(15 * 1.6 * 13px + 24px);
  overflow-y: hidden;
}

.code-fold-mask {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 48px;
  background: linear-gradient(transparent, var(--code-bg));
  pointer-events: none;
}

.code-fold-btn {
  display: block;
  width: 100%;
  height: 36px;
  border: none;
  border-top: 1px solid var(--code-border);
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: var(--text-md);
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.code-fold-btn:active {
  background: var(--fill);
}

.code-block pre {
  margin: 0;
  background: transparent;
  color: var(--code-text);
  border-radius: 0;
  border: none;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
}

.code-block pre code {
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: inherit;
}

/* Lightweight highlighter tokens (github-dark/light palette parity): the
   tokenizer emits .tok-* spans; the palette picks the active color, so a
   theme switch is a pure CSS flip with the 300ms transition above. */
.code-body .tok-keyword { color: var(--tok-keyword); }
.code-body .tok-string { color: var(--tok-string); }
.code-body .tok-comment { color: var(--tok-comment); }
.code-body .tok-number { color: var(--tok-number); }
.code-body .tok-type { color: var(--tok-type); }
.code-body .tok-func { color: var(--tok-func); }
.code-body .tok-prop { color: var(--tok-prop); }
/* Highlighted HTML fades in (150ms) once the async Shiki render lands. */
.code-fade {
  animation: code-fade-in 0.15s ease both;
}

@keyframes code-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

/* Optional line numbers (settings toggle): a 40px right-aligned gutter
   with a 1px divider, over both the plain fallback and Shiki line spans. */
.code-line {
  display: block;
}

.shiki .line {
  display: block;
}

.code-block pre {
  counter-reset: code-line;
}

[data-line-numbers='1'] .code-line::before,
[data-line-numbers='1'] .shiki .line::before {
  content: counter(code-line);
  counter-increment: code-line;
  display: inline-block;
  width: 40px;
  margin-right: 12px;
  padding-right: 12px;
  text-align: right;
  color: var(--text-muted);
  border-right: 1px solid var(--border-subtle);
  user-select: none;
}

/* Sandbox run output (bash / python blocks). */
.code-run {
  margin: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  max-height: 240px;
  overflow-y: auto;
}

.code-run-ok {
  color: var(--positive);
}

.code-run-error {
  color: var(--danger);
}

/* ── diff view: 变更对比 card, three-column rows, review mode ─────────── */

.diff-block {
  /* Top gap after a paragraph comes from .chat-md-body p + .diff-block
     (12px, margin collapse); between components the block keeps 12px. */
  margin: 0 0 12px;
  border: 1px solid var(--code-border);
  border-radius: 12px;
  background: var(--code-bg);
  overflow: hidden;
}

.diff-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--palm-hit);
  padding: 0 16px;
  background: var(--code-head-bg);
  border-bottom: 1px solid var(--code-head-border);
}

.diff-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.diff-label {
  flex: none;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.diff-file {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.diff-actions {
  flex: none;
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.diff-btn {
  position: relative;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.1s ease, filter 0.1s ease, background-color 0.12s ease;
}

/* Keep compact button chrome; extend only vertically so neighboring actions stay separate. */
.diff-btn::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  inset-block-start: 50%;
  block-size: var(--palm-hit);
  transform: translateY(-50%);
}

.diff-btn:active {
  transform: scale(0.96);
}

.diff-accept {
  border: none;
  background: var(--positive);
  color: var(--palm-on-accent);
}

.diff-reject {
  border: 1px solid var(--border-default);
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.diff-review {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--accent);
}

.diff-body {
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: var(--text-md);
  line-height: 1.6;
}

.diff-hunk-head {
  padding: 6px 12px 2px;
  color: var(--text-quaternary);
  font-size: 11.5px;
  user-select: none;
}

.diff-row {
  display: grid;
  grid-template-columns: 40px 40px minmax(0, 1fr);
  min-width: max-content;
}

.diff-row-review {
  grid-template-columns: var(--palm-hit) 40px 40px minmax(0, 1fr);
  min-height: var(--palm-hit);
  align-items: center;
}

.diff-oldno,
.diff-newno {
  padding-right: 8px;
  text-align: right;
  color: var(--text-muted);
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.diff-text {
  padding: 0 12px 0 8px;
  white-space: pre;
}

.diff-add {
  background: var(--diff-add-bg);
  box-shadow: inset 3px 0 0 var(--diff-add);
}

.diff-add .diff-newno {
  color: var(--diff-add);
}

.diff-del {
  background: var(--diff-del-bg);
  box-shadow: inset 3px 0 0 var(--diff-del);
}

.diff-del .diff-oldno {
  color: var(--diff-del);
}

/* Word-level marks on paired add/del lines. */
.diff-word-add {
  background: var(--diff-add-word);
  border-radius: 2px;
}

.diff-word-del {
  background: var(--diff-del-word);
  text-decoration: line-through;
  border-radius: 2px;
}

/* Review mode reserves one full touch cell per line; the visible + / − stays compact. */
.diff-review-cell {
  position: relative;
  display: flex;
  align-self: stretch;
  align-items: center;
  justify-content: center;
}

.diff-line-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 6px;
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: opacity 0.1s ease;
}

/* The cell contains the entire hit layer, so adjacent lines never overlap. */
.diff-line-btn::after {
  content: '';
  position: absolute;
  inset: 0;
}

.diff-line-btn:active {
  opacity: 0.72;
}

.diff-line-add-btn {
  background: var(--diff-add-bg);
  color: var(--diff-add);
}

.diff-line-del-btn {
  background: var(--diff-del-bg);
  color: var(--diff-del);
}

.diff-line-btn-on {
  outline: 1px solid currentColor;
}

.diff-decided {
  opacity: 0.55;
}

.diff-fold {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 12px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
}

.diff-fold-text {
  flex: 1;
  min-width: 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.diff-fold-btn {
  flex: none;
  min-height: var(--palm-hit);
  padding: 0 12px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

.diff-review-foot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 8px 12px;
  border-top: 1px solid var(--border-subtle);
}

.diff-review-summary {
  flex: 1;
  min-width: 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.diff-confirm {
  flex: none;
  min-height: var(--palm-hit);
  padding: 0 14px;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.1s ease, filter 0.1s ease;
}

.diff-confirm:active {
  transform: scale(0.96);
  filter: brightness(1.08);
}

.diff-cancel {
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
}

/* Applied / rejected collapse state. */
.diff-applied {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 10px 16px;
  color: var(--text-secondary);
  font-size: var(--text-md);
}

.diff-dimmed {
  opacity: 0.55;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

.diff-applied-tag {
  flex: none;
  color: var(--positive);
  font-weight: 500;
}

.diff-applied-tag-rejected {
  color: var(--danger);
}

.diff-applied-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.diff-undo {
  flex: none;
  min-height: var(--palm-hit);
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 6px;
}

/* ── file-path links (host file opener) ───────────────────────────────── */

.chat-md-body a.file-link {
  /*
   * 2026-11-10 实机：链接下那条虚线落在了**下一行文字上**（截图里"不用重新烧录。"
   * 被一条虚线穿过）。原因不是虚线画错，而是它根本不是下划线 —— 是 inline-block
   * 的 border-bottom：盒子的底边在 padding 8px 之下，而 -8px 的负 margin 又把整个
   * 盒子往上提，两边一凑，线就落在行间、压住下面那行字。
   *
   * 改法：链接回到 inline（inline 的上下 padding 不撑行高），虚线交给
   * text-decoration —— 它永远贴着字形基线画，padding 再多也不会跑位；
   * 上下各 8px 的 padding 仍然保留，触控热区不变。
   */
  display: inline;
  padding: 8px 2px;
  color: var(--accent);
  text-decoration: underline dashed var(--palm-accent-line);
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
  overflow-wrap: anywhere;
}

@media (hover: hover) {
  .chat-md-body a.file-link:hover {
    text-decoration: underline solid var(--palm-accent-line);
  }
}

.chat-md-body pre:not(.code-block pre):not(.diff-block pre) {
  margin: 8px 0;
  padding: var(--space-3);
  background: var(--code-bg);
  color: var(--code-text);
  border-radius: 10px;
  overflow-x: auto;
  font-size: var(--text-md);
  line-height: 1.6;
}

/* ── message disclosures (深度思考 / 工具) ───────────────────────────── */

.chat-disclosure {
  margin-bottom: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: var(--bg-elevated);
  overflow: hidden;
}

.chat-disclosure-head {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-md);
  font-weight: 400;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.chat-disclosure-head:active {
  background: var(--fill);
}

.chat-disclosure-icon {
  flex: none;
  display: flex;
  color: var(--text-tertiary);
}

.chat-disclosure-icon svg {
  width: 14px;
  height: 14px;
}

.chat-disclosure-caret {
  flex: none;
  display: flex;
  color: var(--text-tertiary);
  transition: transform 0.3s ease;
}

.chat-disclosure-caret svg {
  width: 14px;
  height: 14px;
}

.chat-disclosure-open .chat-disclosure-caret {
  transform: rotate(180deg);
}

.chat-disclosure-label {
  flex: none;
  color: var(--text-secondary);
  font-weight: 500;
}

.chat-reasoning[data-pending] .chat-disclosure-label {
  color: var(--accent);
}

.chat-disclosure-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 400;
}


/* Accordion body: mounts on open with a max-height ease (300ms). */
.chat-disclosure-body {
  padding: 8px 12px 12px;
  border-top: 1px dashed var(--border-subtle);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  font-weight: 400;
  line-height: 1.7;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  max-height: 500px;
  overflow-y: auto;
  animation: disclosure-open 0.3s ease both;
}

@keyframes disclosure-open {
  from {
    max-height: 0;
    opacity: 0;
  }
  to {
    max-height: 500px;
    opacity: 1;
  }
}



.chat-tool-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius-chip);
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 400;
  white-space: nowrap;
}

/*
 * A tool id is a single unbreakable token when it comes from an MCP server
 * (mcp__github__create_or_update_file), so the chip must be able to shrink
 * inside its row: in the collapsed one-line header it ellipsizes, and once the
 * card is open the full name matters more, so it wraps instead.
 */
.chat-disclosure-head .chat-tool-pill {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}


.chat-tool-args {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--code-bg);
  color: var(--code-text);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.5;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

/*
 * 过程组（对照稿 chat-rework.html 的工具块）：**一行一步的过程表**。
 *
 * 2026-11-08 实机投诉：一回合 12 次工具调用被画成 12 张卡（44 的命中高度 + 8 的上下
 * 留白 + 描边/底色 + 行间 gap ≈ 90 一张），一屏只能看 6 条，扫不完。定版不再画
 * 卡片外壳：整块只是正文里的一段过程表，行与行之间最多一条极淡分隔线。
 * 头一行只说工具数与报错数；静态行高 --palm-proc-head-h，可点击行实体占位 --palm-hit。
 * 状态词与耗时不在这一行：全页只在任务头状态条（真机上曾并排出现两个状态词、两条计时）。
 */
.chat-proc {
  display: flex;
  flex-direction: column;
  /* 2026-11-10：状态条与过程条之间不再留一道空白 —— 二者是同一段的"标题行 + 明细"，
     原来 margin + 任务头 10px 底距让它们看起来像两块无关的内容。 */
  margin-top: 0;
}

.chat-proc-head {
  display: flex;
  align-items: center;
  gap: var(--palm-s1);
  width: 100%;
  /* 静态摘要保持 24 高 / 11 号字；可点击摘要另以 44px 实体高度覆盖。 */
  min-height: var(--palm-proc-head-h);
  padding: 0 var(--palm-s2);
  border: none;
  background: transparent;
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-proc-head-size);
  font-weight: var(--palm-w-normal);
  text-align: left;
  cursor: pointer;
}

.chat-proc-head-static {
  cursor: default;
}

.chat-proc-head:not(.chat-proc-head-static) {
  min-height: var(--palm-hit);
}

.chat-proc-line {
  /* 吃剩余宽度，而不是 width:100%：头行里还有 ▸，写死 100% 会把它挤到第二行
      —— 静态 24 高的文字行会变成 37 高的两行（2026-11-08 实机量到的就是这个）。 */
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--palm-s2);
  width: auto;
  min-width: 0;
}

/* 头行的主角是那几个计数，但整行只是注脚：常规字重 + 第二档灰。 */
.chat-proc-state {
  flex: none;
  font-weight: var(--palm-w-normal);
  color: var(--palm-fg-2);
}

/*
 * 报错信号（「2 处报错」）：比标题弱一档，只在真有报错步骤时存在。
 * 不用 ⚠ 之类的字形，纯文字也读得出来。
 */
.chat-proc-errors {
  flex: none;
  color: var(--palm-danger);
  font-size: var(--palm-proc-head-size);
  font-weight: var(--palm-w-normal);
}

.chat-proc-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 没有权威结论（unknown）：状态词/计数退到第三档灰，不冒充任何结论色。
   （旧的 .chat-proc-running > .chat-proc-head 是死规则：头行本身 border: none，
   画不出边；随这次删掉。） */
.chat-proc-head[data-state='unknown'] .chat-proc-state {
  color: var(--palm-proc-unknown);
}

.chat-proc-caret {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--palm-fg-3);
}

.chat-proc-body {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  padding: var(--palm-s2) var(--palm-s3);
  border-top: var(--palm-hair) solid var(--palm-line);
}


/* 宿主唤醒消息的**通知行**（子代理/任务/定时/团队/外部事件…）。语义对齐桌面端
   ui-chat 的 TurnTriggerNodeView（图标 + 标题 + 时间 + 可展开正文），但视觉是手机端的
   紧凑版：一行 12px 次要文字，行高 28px（2026-11-11 两次收紧，见下）。 */
.chat-trigger {
  /* 2026-11-11 用户连着两次提「这个任务通知条占的空间太大」。结论：它不是"卡片"，是一条
     **通知行**，不该有灰底、描边、大圆角和 12px 内边距。现在只剩一行 12px 次要文字 +
     右侧时间 + 折叠箭头，行高 28px；要展开点整行（正文在 details 里）。 */
  margin: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  overflow: hidden;
}
.chat-trigger-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 2px;
  min-block-size: 28px;
  cursor: pointer;
  list-style: none;
  color: var(--palm-fg-2);
  font-size: 12px;
}
.chat-trigger-head::-webkit-details-marker {
  display: none;
}
.chat-trigger-icon,
.chat-trigger-caret {
  flex: none;
  color: var(--text-tertiary);
}
.chat-trigger-title {
  flex: none;
}
.chat-trigger-time {
  flex: none;
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.chat-trigger-body {
  padding: 2px 2px 8px;
}
.chat-trigger-note {
  margin: 8px 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.chat-trigger-text {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow: auto;
}

/* 展开体首行：这一轮到底走了几步（卡面第一行只留状态词与用时）。 */
.chat-proc-steps {
  color: var(--text-tertiary);
}

.chat-think {
  display: flex;
  flex-direction: column;
}

.chat-think-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 40px;
  padding: 4px 6px;
  border: none;
  background: none;
  /* 折叠头从 --text-muted 提到 --text-secondary：muted 是全站最弱的灰，
     深色模式下几乎糊在背景里，"深度思考 · N 行"这行标题也看不清。 */
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-xs);
  text-align: left;
  cursor: pointer;
}

.chat-think-label {
  flex: 1 1 auto;
}

.chat-think-caret {
  flex: none;
}

.chat-think-body {
  /* 思维链正文重新设计：原文用 --text-muted（全站最弱灰），浅色下发白、深色下发糊，
     两种模式都读不清。改为：
     ① 颜色 --text-secondary（主题保证对比度，深浅都够看，又弱于正文，层级不乱）；
     ② 左侧竖线由 --border-subtle 提到 --border-default，边界更明确；
     ③ 加一层 --code-bg 底（浅色 #e8ecf2 / 深色 #161b22，与页面底有区分），
        让它一眼是"引用块/思考块"，不再和正文混在一起；
     ④ 右侧同圆角，行高 1.65 更适合手机上读长段推理。 */
  padding: 6px 10px 8px 22px;
  border-left: 2px solid var(--border-default);
  border-radius: 0 8px 8px 0;
  background: var(--code-bg);
  color: var(--text-secondary);
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-flow-answer {
  margin-top: var(--space-1);
}

/*
 * 工具块的行（对照稿）：一行一步 = 8 的状态点 + 「工具名 · 目标」+ 右侧状态词。
 * 定版：单行 --palm-proc-row-h，上下留白 --palm-proc-row-pad，行与行之间只有一条极淡
 * 分隔线 —— 整块是正文里的一张过程表，不是一叠小卡。
 */
.chat-proc-tools {
  display: flex;
  flex-direction: column;
}

/* 阅读流首屏只留过程摘要；点开过程头后恢复完整步骤列表。 */
.chat-proc[data-tools='summary'] > .chat-proc-tools {
  display: none;
}

/* 活跃回合保持需要关注的步骤；已完成步骤仍可从摘要中展开查看。 */
.chat-proc[data-tools='active'] > .chat-proc-tools > .chat-step[data-state='ok'] {
  display: none;
}

.chat-step {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0 var(--palm-s2);
  border-top: var(--palm-hair) solid var(--palm-line);
  background: transparent;
}


.chat-step-head {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  width: 100%;
  /* 单行 --palm-proc-row-h：留白落在按钮内，整行都能点（不再叠 44 命中高度 + 8 行距）。 */
  min-height: var(--palm-proc-row-h);
  padding: var(--palm-proc-row-pad) 0;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

/* 状态点：8px 圆点。颜色只在宿主真报过状态时出现（见 data-state）。 */
.chat-step-dot {
  flex: none;
  width: var(--palm-s2);
  height: var(--palm-s2);
  border-radius: var(--palm-r-full);
  background: var(--palm-fg-3);
}

.chat-step-dot[data-state='ok'] { background: var(--palm-ok); }
.chat-step-dot[data-state='running'] { background: var(--palm-accent); }
.chat-step-dot[data-state='error'] { background: var(--palm-danger); }
.chat-step-dot[data-state='stopped'] { background: var(--palm-warn); }

/*
 * 工具名：**不可收缩**（flex: none）。它是这一行的动词（「工具」「运行命令」「写入」），
 * 一旦允许收缩，窄屏上就会被压成一个字 —— 真机 320/390 宽下量到的就是「工·」。
 * 省略号只属于右边的目标：.chat-step-summary 吃剩余宽度、在尾部省略。
 */
.chat-step-title {
  flex: none;
  white-space: nowrap;
  font-size: var(--palm-flow-row-size);
  color: var(--palm-fg);
}

.chat-step-summary {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-2);
}

/* 「工具名 · 目标」之间的分隔点由样式给：没有目标时不留一个孤零零的点。 */
.chat-step-head .chat-step-summary:not(:empty)::before {
  content: '· ';
  color: var(--palm-fg-3);
}

/* 右侧状态词：12px 第三档灰（成功/运行中/失败/已中断都照实写）。 */
.chat-step-state {
  flex: none;
  margin-left: auto;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
  font-variant-numeric: tabular-nums;
}

/* 成功步骤的「完成」退成辅助色（2026-11-10 展开态实拍）：四行步骤各挂一枚绿「完成」，
   像四枚徽章，反而把真正的异常淹掉。绿色圆点已经说明这一步过了；只有失败/中断/运行中
   才需要语义色把眼睛拉过去。 */
.chat-step-state-ok { color: var(--palm-fg-3); }
.chat-step-state-error { color: var(--palm-danger); }
.chat-step-state-running { color: var(--palm-accent); }
.chat-step-state-stopped { color: var(--palm-warn); }



/* Tool diff card: file path header + red removed / green added lines,
   reusing the DiffView palette (--diff-add/--diff-del). The max-height
   transition rides ArtifactCard's inline maxHeight (content height while
   open, 0 while folded) so expanding, collapsing and streamed growth —
   more files landing mid-turn — animate smoothly; overflow stays hidden. */
.chat-tool-diff {
  margin-top: 2px;
  border-radius: 8px;
  overflow: hidden;
  transition: max-height 200ms ease;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.chat-artifact {
  /* Same panel language as code blocks: --code-border frame + --code-head-bg
     head bar, so tool diffs read as one family with the fenced blocks. */
  border: 1px solid var(--code-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--card-bg);
}

.chat-artifact-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--palm-hit);
  padding: 0;
  border: none;
  background: var(--code-head-bg);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.chat-artifact-title {
  flex: 1;
  min-width: 0;
  padding: 6px 0 6px 10px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: 500;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-artifact-summary {
  flex: none;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

/* The +/- line tally reads at a glance: additions green, deletions red,
   reusing the diff palette so the head matches the red/green body. */
.chat-artifact-stat-add { color: var(--diff-add); }
.chat-artifact-stat-del { color: var(--diff-del); }

.chat-artifact-caret {
  flex: none;
  padding: 6px 10px 6px 0;
  color: var(--text-quaternary);
  font-size: var(--text-xs);
}

.chat-artifact .chat-tool-diff {
  margin-top: 0;
  border-radius: 0;
}

.chat-tool-diff-row {
  display: flex;
  gap: 6px;
  padding: 1px 8px;
  white-space: pre-wrap;
  /* anywhere, not break-word: only anywhere lowers the min-content size, which
     is what lets a flex item shrink below one long path token. */
  overflow-wrap: anywhere;
}

.chat-tool-diff-path {
  padding: 3px 8px;
  background: var(--code-head-bg);
  color: var(--text-secondary);
  font-weight: 600;
}

/* 路径行从纯文本变成按钮（点开文件预览）：清掉 UA 的边框/背景/居中，外观与代码行一致。 */
button.chat-tool-diff-path {
  inline-size: 100%;
  border: none;
  /* 颜色/底色沿用 .chat-tool-diff-path（这里只清按钮外观），不重复引用 --text-secondary：该令牌有独立用量预算。 */
  font: inherit;
  text-align: start;
  cursor: pointer;
}

button.chat-tool-diff-path:active { opacity: 0.72; }

.chat-tool-diff-del {
  background: var(--diff-del-bg);
  color: var(--diff-del);
}

.chat-tool-diff-add {
  background: var(--diff-add-bg);
  color: var(--diff-add);
}

.chat-tool-diff-sign {
  flex: none;
  width: 10px;
  text-align: center;
  user-select: none;
}

.chat-tool-diff-text {
  flex: 1;
  min-width: 0;
}

/* ── run-status strip + sheet (todo plan / background jobs) ───────────── */

.chat-status-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: var(--palm-hit);
  padding: 6px 12px 2px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}

.chat-status-strip:active {
  color: var(--text-primary);
}

.chat-status-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--text-quaternary);
}

.chat-status-dot-live {
  background: var(--accent);
  animation: breathe 1.6s infinite ease-in-out;
}

.chat-status-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* One content section inside the run-status sheet. */
.chat-run-section {
  padding: 2px 0 6px;
}

.chat-run-section + .chat-run-section {
  border-top: 1px solid var(--border-subtle);
  margin-top: 8px;
  padding-top: 10px;
}

.chat-run-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: 6px;
}

.chat-run-section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
}

.chat-run-section-count {
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  color: var(--text-quaternary);
}

.chat-run-todo-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-run-todo {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--text-md);
  line-height: 1.45;
  color: var(--text-primary);
}

.chat-run-todo.chat-run-todo-completed .chat-run-todo-content {
  color: var(--text-quaternary);
  text-decoration: line-through;
}

.chat-run-todo-mark {
  flex: none;
  width: 14px;
  text-align: center;
  color: var(--text-quaternary);
}

.chat-run-todo.chat-run-todo-in_progress .chat-run-todo-mark {
  color: var(--accent);
}

.chat-run-todo.chat-run-todo-completed .chat-run-todo-mark {
  color: var(--positive);
}

.chat-run-job-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── background-task rows (session/jobs) ───────────────────────────────
 * 旧的「后台任务」折叠条已随会话正文流下线（会话顶部只留状态条）；
 * 这里只保留运行总览页复用的任务行与子代理行。 */

.chat-task-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.chat-task-dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: var(--radius-full);
  background: var(--text-quaternary);
}

.chat-task-dot-running {
  background: var(--accent);
  animation: breathe 1.4s infinite ease-in-out;
}

.chat-task-dot-stopping {
  background: var(--warning);
}

.chat-task-dot-completed {
  background: var(--positive);
}

.chat-task-dot-killed {
  background: var(--text-quaternary);
}

.chat-task-dot-failed {
  background: var(--danger);
}

.chat-task-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.chat-task-label {
  color: var(--text-primary);
  font-size: var(--text-md);
  line-height: 1.35;
  word-break: break-word;
}

.chat-task-meta {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  /* job.detail is host text (often a path): wrap it rather than sticking out
     of the copy column and being clipped by the taskbar. */
  overflow-wrap: anywhere;
}

.chat-task-time {
  color: var(--text-quaternary);
  font-size: var(--text-xs);
}

/* 子代理行之间必须有竖向间隔：这一层是列表容器，行本身是 flex 行，
   没有 gap 时两条记录贴在一起，看起来像一条记录换行。 */
.chat-subagent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-subagent-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.chat-subagent-dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: var(--radius-full);
  background: var(--text-quaternary);
}

.chat-subagent-dot-running {
  background: var(--accent);
  animation: breathe 1.4s infinite ease-in-out;
}

.chat-subagent-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.chat-subagent-label {
  color: var(--text-primary);
  font-size: var(--text-md);
  line-height: 1.35;
  word-break: break-word;
}

.chat-subagent-meta {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

/* Run-status sheet fold row: truncates long subagent lists past the visible max. */
.chat-run-fold {
  display: block;
  width: 100%;
  border: none;
  padding: 10px 12px;
  background: transparent;
  color: var(--accent);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.chat-run-fold:active {
  background: var(--fill);
}

/* ── approval / question panels ──────────────────────────────────────── */

/*
 * Both panels print agent-supplied text: a tool id full of underscores, a
 * workspace path, a git ref, a command inside an approval reason. One long
 * unbreakable token used to set a flex item's min-content width, which widened
 * the whole chat column past the viewport and drifted the page sideways.
 * overflow-wrap: anywhere is inherited by every child and — unlike break-word —
 * it also lowers the min-content size, which is exactly what a flex item's
 * automatic minimum looks at. The rows carry min-width: 0 so the guard survives
 * a child that resets the property.
 */
.chat-approval-header,
.chat-approval-reason,
.chat-question-option,
.chat-question-option-label,
.chat-question-option-desc {
  min-width: 0;
}

/* 「将要执行什么」：等宽、限高可滚。审批卡片不能因为一条长命令把整页顶宽，
   但也**不能把命令切掉**——读不完就批等于盲批。 */
.chat-approval-preview {
  margin: 6px 0 0;
  padding: 8px 10px;
  border-radius: var(--radius-chip);
  background: var(--code-bg);
  color: var(--code-text);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  /* 2026-11-10 双皮肤实拍：原来这里是 -webkit-line-clamp: 2，长命令被硬切在
     「…&& p」处且没有展开入口。改成"限高 + 内部可滚"：读得完，也不顶宽。 */
  max-block-size: calc(var(--palm-t-s) * 1.5 * 5);
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* The header is a row: a long reason drops onto its own line, and a long tool
   id wraps inside the pill instead of forcing the row wider than the screen. */
.chat-approval-header {
  flex-wrap: wrap;
}

.chat-approval-header .chat-tool-pill {
  min-width: 0;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}

.chat-approval-panel {
  margin: 4px 0;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  padding: 12px 16px;
  border: 1px solid var(--palm-warn);
  border-radius: var(--radius-card);
  background: var(--palm-tint-warn);
  box-shadow: var(--card-shadow);
}

.chat-approval-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 10px;
}

.chat-approval-reason {
  color: var(--text-secondary);
  font-size: 12.5px;
}

.chat-approval-error {
  margin: 4px 0;
  color: var(--danger);
  font-size: var(--text-sm);
}

/* F2: the host classifies the tool; the judgement must be visible BEFORE the
   buttons (a bash card must not look like a read_file card). */
.chat-risk-pill {
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid transparent;
  font-size: 11.5px;
}

.chat-risk-read {
  color: var(--text-secondary);
  border-color: var(--border-subtle);
}

.chat-risk-write {
  color: var(--text-primary);
  border-color: var(--border-subtle);
}

.chat-risk-exec {
  color: var(--danger);
  border-color: var(--palm-danger-line);
}

.chat-risk-install {
  color: var(--danger);
  border-color: var(--danger);
}

.chat-approval-expand {
  min-height: var(--palm-hit);
  margin-top: 6px;
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 12px;
}

.chat-approval-args {
  margin: 6px 0 0;
  padding: 8px 10px;
  max-height: 40vh;
  overflow: auto;
  border-radius: var(--radius-chip);
  background: var(--code-bg);
  color: var(--code-text);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.chat-approval-allow-holding {
  filter: brightness(0.92);
}

.chat-approval-actions {
  display: flex;
  gap: var(--space-2);
}

.chat-approval-allow {
  flex: 1;
  min-height: var(--palm-hit);
  border: 0;
  border-radius: var(--palm-r-s);
  background: var(--palm-accent);
  color: var(--palm-on-accent);
  font: inherit;
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
  cursor: pointer;
  transition: transform 0.1s ease, filter 0.1s ease;
}

/* 长按确认键：按下时**只**降透明度，不做 scale —— 按下去缩一圈再保持 1.5 秒是错的。
   也不改 filter：长按过程中的 --holding 用 filter 表达进度，不能被 :active 抢掉。 */
.chat-approval-allow:active {
  opacity: var(--palm-btn-press-flat);
}

.chat-approval-allow:disabled {
  opacity: var(--palm-btn-disabled-opacity);
  transform: none;
}

.chat-approval-reject {
  flex: 1;
  min-height: var(--palm-hit);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-s);
  background: transparent;
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-t-m);
  cursor: pointer;
  transition: transform 0.1s ease, background-color 0.1s ease;
}

.chat-approval-reject:active {
  background: var(--fill);
}

.chat-approval-reject:disabled {
  opacity: 0.6;
  transform: none;
}

.chat-question-panel {
  margin: 4px 0;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  padding: 12px 16px;
  border: var(--palm-hair) solid var(--palm-accent);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  box-shadow: var(--palm-sh1);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-question-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 卡头是"这张卡属于什么"，问句才是"要你回答什么"（2026-11-10 实拍：两行一样重，
   打开卡片分不清哪句要答）。卡头退成小号二级前景，问句升到正文最亮的一档。 */
.chat-question-header {
  font-size: var(--palm-t-s);
  font-weight: 500;
  color: var(--palm-fg-2);
}

.chat-question-text {
  font-size: var(--palm-t-l);
  font-weight: 500;
  color: var(--palm-fg);
  line-height: 1.45;
}

.chat-question-detail {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

.chat-question-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-question-option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-height: var(--palm-hit);
  padding: 12px 14px;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-s);
  cursor: pointer;
  font-size: var(--palm-t-m);
  transition: border-color 0.12s ease, background-color 0.12s ease, transform 0.1s ease;
}

.chat-question-option:active {
  opacity: 0.88;
}

.chat-question-option input {
  margin: 2px 0 0;
  flex: none;
  accent-color: var(--palm-accent);
}

.chat-question-option-selected {
  border-color: var(--palm-accent);
  background: var(--palm-tint-accent);
}

.chat-question-option-label {
  color: var(--text-primary);
  font-weight: 500;
}

.chat-question-option-desc {
  display: block;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.chat-question-custom {
  width: 100%;
  min-height: var(--palm-hit);
  box-sizing: border-box;
  padding: 8px 12px;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-s);
  background: var(--palm-sur-1);
  color: var(--palm-fg);
  font: inherit;
  font-size: 16px;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s ease;
}

.chat-question-custom:focus-visible {
  border-color: var(--border-focus);
}

.chat-question-submit {
  min-height: var(--palm-hit);
  border: 0;
  border-radius: var(--palm-r-s);
  background: var(--palm-accent);
  color: var(--palm-on-accent);
  font: inherit;
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
  cursor: pointer;
  transition: transform 0.1s ease, filter 0.1s ease;
}

/* 同卡片的提交键：同样不做 scale（卡片里两颗键动作要一致），只降透明度。 */
.chat-question-submit:active {
  opacity: var(--palm-btn-press-flat);
}

.chat-question-submit:disabled {
  opacity: var(--palm-btn-disabled-opacity);
  transform: none;
}

/* ── 输入区底栏（C 案）：队列条 + 元信息行 ───────────────────────────── */

/* 底栏一起定位：模型与权限面板要浮在整块底栏之上，而不是插在输入行与
   元信息行之间。 */
.chat-dock {
  position: relative;
  z-index: var(--z-composer);
  flex: none;
  /* 2026-11-12 真机：「点模型或权限，底部出现一条灰色长条」。
     底栏最下面那段（输入行与屏幕底边之间的留白）没有自己的背景：
     平时透出的是页面底色，和周围一样看不出来；面板一打开，它透出的
     就是 .chat-picker-scrim 的 12% 黑，于是变成一条灰带。
     整块底栏给不透明底色，谁来加遮罩都不会再透。 */
  background: var(--palm-bg);
}

/* 队列条：只在有排队时出现，输入行上方。琥珀 7% 底 + 9 圆角 + 11px。 */
.chat-queue {
  display: flex;
  align-items: center;
  height: var(--palm-dock-queue-h);
  margin: 0 var(--palm-dock-pad) var(--palm-s2);
  padding: 0 var(--palm-s3);
  border-radius: var(--palm-dock-queue-r);
  background: var(--palm-dock-queue-bg);
  color: var(--palm-warn);
  font-size: var(--palm-dock-queue-size);
  line-height: var(--palm-lh-head);
}

/* ── 插入条（dock 固定槽位） ───────────────────────────────────────────
 * 永远挂在 DOM 里：外层 grid 0fr ↔ 1fr 过渡高度 + opacity，「data-state」
 * 只切状态、不卸载。旧实现是条件渲染，运行态一抖就重挂（视觉上就是“条子
 * 莫名消失又出现”）。明细默认收起，展开同样走 0fr → 1fr。 */
.insert-bar {
  display: grid;
  grid-template-rows: 0fr;
  margin: 0 var(--palm-dock-pad);
  opacity: 0;
  transition:
    grid-template-rows var(--palm-insert-dur) var(--palm-insert-ease),
    opacity var(--palm-insert-dur) var(--palm-insert-ease);
}

.insert-bar[data-state='shown'] {
  grid-template-rows: 1fr;
  opacity: 1;
}

.insert-bar > div {
  min-height: 0;
  overflow: hidden;
}

.insert-bar > div > div {
  display: flex;
  flex-direction: column;
  padding-bottom: var(--palm-insert-gap);
}

[data-insert-summary] {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  width: 100%;
  min-height: var(--palm-insert-h);
  padding: 0 var(--palm-s3);
  border: none;
  border-radius: var(--palm-r-s);
  background: var(--palm-insert-bg);
  color: var(--palm-insert-ink);
  font: inherit;
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-head);
  text-align: left;
  cursor: pointer;
}

[data-insert-summary] > span:first-child {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-insert-summary] > span:last-child {
  flex: none;
  color: var(--palm-insert-accent);
  transition: transform var(--palm-insert-dur) var(--palm-insert-ease);
}

.insert-bar[data-expanded='true'] [data-insert-summary] > span:last-child {
  transform: rotate(90deg);
}

[data-insert-details] {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--palm-insert-dur) var(--palm-insert-ease),
    opacity var(--palm-insert-dur) var(--palm-insert-ease);
}

.insert-bar[data-expanded='true'] [data-insert-details] {
  grid-template-rows: 1fr;
  opacity: 1;
}

[data-insert-details] > ul {
  min-height: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
}

[data-insert-details] li {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  height: var(--palm-insert-row-h);
  max-height: var(--palm-insert-row-h);
  border-top: var(--palm-hair) solid var(--palm-insert-line);
}

[data-insert-details] li > span:first-child {
  flex: none;
  color: var(--palm-insert-accent);
  font-size: var(--palm-t-s);
  white-space: nowrap;
}

[data-insert-details] li > span:nth-child(2) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--palm-fg);
  font-size: var(--palm-t-s);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 撤回动作与明细行共用独立触控单元，避免跨行命中相邻动作。 */
[data-insert-withdraw] {
  flex: none;
  height: var(--palm-insert-row-h);
  min-width: var(--palm-hit);
  padding: 0 var(--palm-s2);
  border: none;
  border-radius: var(--palm-r-s);
  background: none;
  color: var(--palm-insert-accent);
  font: inherit;
  font-size: var(--palm-t-s);
  cursor: pointer;
}

[data-insert-withdraw]:active {
  background: var(--palm-tint-accent);
}

/* 元信息行：左边唯一可点的「模型 │ 权限」胶囊，右边纯展示状态与上下文。 */
.chat-meta {
  display: flex;
  align-items: center;
  gap: var(--palm-dock-gap);
  height: var(--palm-dock-meta-h);
  padding: 0 var(--palm-dock-pad);
  background: var(--palm-bg);
  /*
   * 2026-11-12 真机：「点模型或权限，底部出现一条灰色长条」。
   *
   * 面板的遮罩（.chat-picker-scrim，z=40）盖在这一行上：DOM 里它排在
   * 元信息行**后面**，又因为元信息行没建层叠上下文，同一层级下"后者压前者"，
   * 于是整行被压上 12% 黑 —— 看着就是输入框下面一条灰带。
   *
   * 连带后果更严重：那一行本来是可点的（模型/权限胶囊、上下文环），
   * 被遮罩盖住时点它只会关面板，点不到胶囊。
   * 输入行早就用 z-index: var(--z-composer) 躲开了，元信息行漏了这一步。
   */
  position: relative;
  z-index: var(--z-composer);
}

.chat-meta-chip {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  height: var(--palm-dock-chip-h);
  padding: 0 var(--palm-s3);
  border: none;
  border-radius: var(--palm-dock-chip-r);
  background: var(--palm-dock-chip-bg);
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-dock-chip-size);
  letter-spacing: 0.01em;
  cursor: pointer;
}

/* 视觉 24 高，纵向命中区撑到 44（上下各 10）；横向不扩，避免压到右侧状态。 */
.chat-meta-chip::after {
  content: '';
  position: absolute;
  inset: calc((var(--palm-hit) - var(--palm-dock-chip-h)) / -2) 0;
  border-radius: inherit;
}

.chat-meta-chip:active {
  background: var(--palm-sur-2);
}

.chat-meta-seg {
  white-space: nowrap;
}


.chat-meta-right {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--palm-s2);
  color: var(--palm-fg-3);
  font-size: var(--palm-dock-status-size);
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.chat-meta-status {
  font-variant-numeric: tabular-nums;
}

.chat-meta-dot {
  width: var(--palm-dock-dot);
  height: var(--palm-dock-dot);
  border-radius: var(--palm-dock-chip-r);
  background: var(--palm-fg-3);
  opacity: 0.6;
}

.chat-meta-ctx {
  display: inline-flex;
  align-items: center;
  gap: var(--palm-s1);
  /* 2026-11-11：圆环从 span 变成按钮（点开上下文明细），要把按钮的默认外观全部抹掉。 */
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--palm-fg-2);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* 点按反馈：整块（环 + 数字）一起压暗一点，不做位移动画。 */
.chat-meta-ctx:active {
  opacity: 0.62;
}

/* 用到 70% 变琥珀、90% 变红：环与数字同色，扫一眼就知道要不要处理。 */
.chat-meta-ctx[data-tone='warn'] { color: var(--palm-warn); }
.chat-meta-ctx[data-tone='danger'] { color: var(--palm-danger); }

/*
 * 上下文明细小卡片（2026-11-11 用户：「圆环点不了，点一下弹出一个小圆框看明细」）。
 *
 * 容器直接复用模型面板的 \`.chat-picker-panel\`（同一个浮层语言、同一套遮罩关闭），
 * 这里只把它从"通栏"收成"右侧小卡"：不铺满整行，最多 260px，靠右与圆环对齐。
 * 类名预算 800 已满，所以只新增这一个类，条目排版借用既有的 \`.sheet-option-desc\`。
 */
/* 双类选择器：240 在 250-picker 之前加载，单类压不住 .chat-picker-panel 的 left/right。 */
.chat-picker-panel.chat-meta-pop {
  left: auto;
  right: var(--palm-s4);
  inline-size: max-content;
  max-inline-size: min(260px, calc(100vw - 2 * var(--palm-s4)));
  gap: var(--palm-s1);
}

/*
 * 2026-11-10 用户：「右下角这个上下文用量圆环渲染显示不准确」。
 * 以前它是一个 border 圆：只有 border-top 上色 ⇒ 永远画「四分之一圈」，跟旁边的百分比
 * 无关（3% 和 90% 长得一模一样）。现在换成 SVG 弧：弧长 = 百分比（--palm-ctx-ratio），
 * 颜色跟数字一起走（accent → warn → danger）。
 */
.chat-meta-ring {
  flex: none;
  inline-size: var(--palm-dock-ring);
  block-size: var(--palm-dock-ring);
}

/* 0%（没有投影）时不画弧：round 线帽会在零长度上留一个亮点，看着像「有一点点占用」。 */
.chat-meta-ring[data-empty] circle:last-of-type { display: none; }

/* 轨道（第一个圆）：淡淡的底圈。 */
.chat-meta-ring circle:first-of-type {
  fill: none;
  stroke: var(--palm-dock-ring-track);
  stroke-width: 2.4;
}

/* 进度弧（第二个圆）：弧长由 strokeDasharray 属性给（pathLength=100 ⇒ 数值就是百分比）。 */
.chat-meta-ring circle:last-of-type {
  fill: none;
  stroke: var(--palm-accent);
  stroke-width: 2.4;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
  transition: stroke-dasharray 0.25s ease;
}

.chat-meta-ctx[data-tone='warn'] .chat-meta-ring circle:last-of-type { stroke: var(--palm-warn); }
.chat-meta-ctx[data-tone='danger'] .chat-meta-ring circle:last-of-type { stroke: var(--palm-danger); }

/*
 * 上下文明细弹窗（2026-11-12 用户：进度条 + 压缩上下文按钮，放最下面）。
 * 只放信息：用了多少 / 百分比 / 还剩多少 / 一句话建议。
 * 唯一的动作放在最底部，不跟上面的模型、权限按钮抢位置，也不加视觉噪音。
 */
.chat-meta-pop {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  min-inline-size: 228px;
  max-inline-size: min(268px, 76vw);
  padding: var(--palm-s3);
}

.ctx-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--palm-s2);
}

.ctx-head-title {
  color: var(--palm-fg-2);
  font-size: var(--palm-t-s);
  letter-spacing: 0.04em;
}

.ctx-head-pct {
  color: var(--palm-fg);
  font-size: var(--palm-t-m);
  font-variant-numeric: tabular-nums;
}

/* 进度条用 SVG 而不是带 width 的 div：宽度是动态数据，走 inline style 会被预算门拦住；SVG 的 width 是属性，不算。 */
.ctx-bar {
  display: block;
  inline-size: 100%;
  block-size: 6px;
  border-radius: 99px;
  overflow: hidden;
}

.ctx-bar-track {
  fill: var(--palm-line);
}

.ctx-bar-fill {
  fill: var(--palm-accent);
}

.ctx-line {
  margin: 0;
  color: var(--palm-fg-2);
  font-size: var(--palm-t-s);
  font-variant-numeric: tabular-nums;
}

.ctx-line-muted {
  color: var(--palm-fg-3);
}

.ctx-hint {
  margin: 0;
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  line-height: 1.55;
}

/* 压缩上下文：弹窗里唯一能动的一颗，必须一眼看出是按钮。
   2026-11-12 用户真机：「太普通了，第一眼看不出来能点击」——原来是透明底 + 细描边，
   和上面的只读信息行长得一样。改成实心强调色，令牌和会话页主按钮 .mobile-new 同一套
   （accent 底 + on-accent 字 + 2px 抬起阴影 + 按下缩放变暗），左边补一个「向内收拢」
   的图标、右边补 chevron：形状、颜色、指示三样一起说"这里能点"。 */
.ctx-compact {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  inline-size: 100%;
  min-block-size: var(--palm-hit);
  margin-block-start: var(--palm-s1);
  padding: var(--palm-s2) var(--palm-s3);
  border: none;
  border-radius: var(--palm-r-m);
  background: var(--palm-accent);
  color: var(--palm-on-accent);
  font: inherit;
  text-align: start;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.1s ease, filter 0.1s ease;
}

.ctx-compact:active {
  transform: scale(var(--palm-btn-press-scale));
  filter: brightness(var(--palm-btn-press-dim));
}

.ctx-compact-icon {
  flex: none;
  inline-size: 18px;
  block-size: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ctx-compact-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-inline-size: 0;
}

.ctx-compact-title {
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
}

/* 主副文案同色：on-accent 在六套皮肤上都过 AA，压透明度就会掉档，
   层次只靠字号和字重分。 */
.ctx-compact-sub {
  color: inherit;
  font-size: var(--palm-t-s);
}

.ctx-compact-go {
  flex: none;
  margin-inline-start: auto;
  inline-size: 16px;
  block-size: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.72;
}
/* ── in-place quick picker (model search panel / permission list) ────── */

/* Full-screen transparent scrim above the message list; tapping it (or the
   header) dismisses the panel. The toolbar/composer/panel rows sit above
   it (z 50) so the input stays usable while picking — tapping the field
   does not dismiss the panel. */
.chat-picker-scrim {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-scrim);
  background: var(--palm-scrim-soft);
}

.chat-composer {
  position: relative;
  z-index: var(--z-composer);
}

/* 模型与权限面板浮在整块底栏之上（底栏 = 队列条 + 输入行 + 元信息行），
   不再插在输入行与元信息行之间。 */
.chat-picker-panel {
  position: absolute;
  left: var(--palm-s4);
  right: var(--palm-s4);
  bottom: calc(100% + var(--palm-s2));
  z-index: var(--z-composer);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  border: 1px solid var(--border-default);
  border-radius: 14px;
  background: var(--card-bg);
  box-shadow: var(--palm-sh2);
  max-height: 42vh;
  overflow-y: auto;
  scrollbar-width: none;
}

.chat-picker-panel::-webkit-scrollbar {
  display: none;
}

.chat-picker-group-title {
  padding: 8px 10px 4px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-quaternary);
}

/* One option row: 44px touch target, leading check column, title + sub. */
.chat-picker-row {
  /*
   * 2026-11-12 用户（手机截图）：「点模型或权限，为什么会出现这种矩形长条」。
   *
   * 原来是 \`flex: none\` —— 行按钮宽度只跟内容一样长，它的背景（\`:active\` 的 --fill、
   * 选中态的 --accent-soft）也只有文字那么长，手机上一按就是"文字下面一条浅色矩形"，
   * 而且触摸高亮会残留，于是一行一条。现在让行铺满面板，背景是整行；顺手关掉点击高亮。
   */
  flex: 1 1 auto;
  align-self: stretch;
  inline-size: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 6px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.chat-picker-row:active {
  background: var(--fill);
}

.chat-picker-row-selected {
  background: var(--accent-soft);
  color: var(--accent);
}

.chat-picker-row-check {
  flex: none;
  width: 16px;
  display: flex;
  align-items: center;
  color: var(--accent);
}

.chat-picker-row-copy {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.chat-picker-row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-picker-row-sub {
  font-size: var(--text-xs);
  color: var(--text-quaternary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-picker-row-selected .chat-picker-row-sub {
  color: var(--accent);
  opacity: 0.75;
}

.chat-picker-row-danger {
  color: var(--danger);
}

.chat-picker-row-danger .chat-picker-row-sub {
  color: var(--danger);
  opacity: 0.75;
}

.chat-picker-more {
  flex: none;
  margin-top: 4px;
  padding: 10px;
  border: 1px dashed var(--border-default);
  border-radius: 10px;
  background: transparent;
  color: var(--text-tertiary);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.chat-picker-status {
  padding: 10px 4px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.chat-picker-error {
  color: var(--danger);
}

.chat-picker-hint {
  color: var(--text-tertiary);
}

/* ── bottom input bar: capsule field + circular send ─────────────────── */

.chat-composer {
  display: flex;
  flex-direction: column;
  /* 2026-11-10：原来这里挂了两行 backdrop-filter: blur(20px)，但底色是**不透明**的
     --palm-bg —— 模糊的是它自己，一个像素也看不见，只剩真机上的 GPU 开销。
     输入区本来也不该透出后面的聊天内容（打字时会被干扰），所以直接删掉。 */
  background: var(--palm-bg);
}

.chat-composer .chat-inputbar {
  border-top: none;
}

/* 「+」：36px 视觉，44px 命中区。C 案输入行只留「+ / 输入框 / 发送」三件。 */
.chat-attach-btn {
  position: relative;
  flex: none;
  align-self: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* 2026-11-12：36 → 28（用户选了「缩小不隐藏」，腾出 8px 给文字）。
     视觉变小、命中区不变：下面的 ::after 撑到 44px。 */
  width: 28px;
  height: 28px;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-full);
  color: var(--palm-fg-2);
  background: var(--palm-sur-1);
  cursor: pointer;
}

.chat-attach-btn::after {
  content: '';
  position: absolute;
  /* 28px 视觉 + 上下左右各 8px = 44px 命中区（守卫要求）。 */
  inset: -8px;
  border-radius: inherit;
}

.chat-attach-btn:active {
  background: var(--palm-sur-2);
}

.chat-attach-bar {
  display: flex;
  gap: var(--space-2);
  padding: 8px 12px 0;
  overflow-x: auto;
}

.chat-attach-item {
  position: relative;
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-default);
}

.chat-attach-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.chat-attach-remove {
  position: absolute;
  top: 0;
  right: 0;
  width: var(--palm-hit);
  height: var(--palm-hit);
  padding: 0;
  border: none;
  border-radius: var(--palm-r-s);
  background: transparent;
  color: transparent;
  font-size: 0;
  line-height: 1;
  cursor: pointer;
  /* 2026-11-10 整屏复核：热区是 44px，可「×」原来只有 18px 且挤在最角上，
     用户看不出删除区从哪儿开始，容易误删。改成把「×」居中放进热区。 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.chat-attach-remove::before {
  content: '×';
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  /* 底子是**照片**，不是皮肤表面：用皮肤色会让角标在半数照片上消失
     （浅照片配浅底、深照片配深底）。改用不随皮肤的压暗层 + 白叉，
     再补一圈 1px 亮边，保证任何底图上都立得住。 */
  background: var(--palm-scrim);
  color: var(--palm-on-scrim);
  box-shadow: 0 0 0 var(--palm-hair) var(--palm-on-scrim);
  font-size: var(--text-sm);
}

.chat-attach-remove:active::before {
  background: var(--palm-sur-1);
}

/* 待发送的文件附件（+ 菜单 → 文件）：图片用缩略图，文件用一行"图标 + 文件名 + 大小"。
   横向滚动，最多五个，长文件名省略中段以外的地方，别把这一行撑成两行高。 */
/* 「文件」这一项是 label 直连输入框：输入框透明铺满整行，手指点到的是它本体，
   走原生手势（不经过 click()），而且它从挂载起就没有 accept，浏览器没有旧配置可沿用。 */
/* 「电脑文件」目录浏览：一行一个，目录在前文件在后，路径一行省略号收着。 */
.host-file-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 4px 4px 10px;
}

.host-file-up {
  flex: none;
  padding: 6px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-chip);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}

.host-file-up:disabled {
  opacity: 0.45;
  cursor: default;
}

.host-file-path {
  min-width: 0;
  flex: 1;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}

.host-file-list {
  display: flex;
  flex-direction: column;
  max-height: 46vh;
  overflow-y: auto;
}

.host-file-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--palm-hit);
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.host-file-row:active {
  background: var(--bg-elevated);
}

.host-file-row-file .host-file-name {
  color: var(--accent);
}

.host-file-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.host-file-meta {
  flex: none;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.sheet-option-file {
  position: relative;
}

.sheet-option-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

/* 文件选择框只是"看不见"，不是 display:none：Chrome 的 showPicker() 对隐藏元素
   会抛 NotAllowedError，视觉隐藏（1px + opacity 0）才两全。 */
.chat-picker-input {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.chat-file-bar {
  display: flex;
  gap: var(--space-2);
  padding: 8px 12px 0;
  overflow-x: auto;
}

/* 附件横排溢出提示（2026-11-10，390px 实拍）：三件附件时右侧直接切在屏幕上，看不出还能滑。
   与审批命令块同一套做法：只在真溢出时（data-fade=end）画右缘渐隐，遮罩取 currentColor。 */
.chat-file-bar[data-fade='end'] {
  -webkit-mask-image: linear-gradient(to right, currentColor 0 calc(100% - var(--palm-s6)), transparent 100%);
  mask-image: linear-gradient(to right, currentColor 0 calc(100% - var(--palm-s6)), transparent 100%);
}

.chat-file-item {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 6px 8px 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.chat-file-glyph {
  flex: none;
  color: var(--accent);
}

.chat-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 600;
}

.chat-file-size {
  flex: none;
  color: var(--text-tertiary);
}

.chat-file-remove {
  flex: none;
  width: var(--palm-hit);
  height: var(--palm-hit);
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.chat-file-remove:active {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

/* 待发附件的三态：上传中 / 已就绪 / 上传失败。
   失败的那条不消失 —— 用户要能看见是哪一条没上去、点一下重传（桌面端同样保留）。 */
.chat-file-item.is-uploading {
  border-style: dashed;
}

.chat-file-item.is-failed {
  border-color: var(--danger);
  background: var(--danger-soft);
}

.chat-file-item.is-failed .chat-file-name {
  color: var(--danger);
}

.chat-file-status {
  flex: none;
  color: var(--text-tertiary);
}

.chat-file-retry {
  flex: none;
  min-width: var(--palm-hit);
  min-height: var(--palm-hit);
  padding: 0 var(--palm-s2);
  border: none;
  background: transparent;
  color: var(--danger);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.chat-file-retry:active {
  opacity: 0.7;
}

.chat-inputbar {
  display: flex;
  /* 中线对齐：+ / 停止 / 发送都跟输入框的中心线走；左右留白 18px。 */
  align-items: center;
  gap: var(--palm-dock-gap);
  padding: var(--palm-s2) var(--palm-dock-pad) calc(env(safe-area-inset-bottom, 0) + var(--palm-s2));
  background: var(--palm-bg);
}

.chat-input {
  flex: 1;
  min-width: 0;
  min-height: var(--palm-hit);
  /* 4 行封顶：实测 132px（约 6 行）时草稿把最后一条消息与过程条整块遮住，
     写长文本反而看不见上下文。超出的内容在框内滚动。 */
  max-height: 156px;
  overflow-y: auto;
  /* 2026-11-10 删掉 field-sizing: content：它让 textarea 按内容宽度排版，
     框却只有那么宽 —— 真机表现为「每行左右各掉半个字」。高度改由组件按
     scrollHeight 写死（ComposerSection 的 autosize），跨端一致。 */
  padding: var(--palm-s2) var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-full);
  background: var(--palm-sur-1);
  color: var(--palm-fg);
  font: inherit;
  font-size: 16px; /* ≥16px：防止 iOS 聚焦缩放 */
  font-weight: var(--palm-w-normal);
  line-height: var(--palm-lh-body);
  resize: none;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

/* 输入框外壳：命令 chip 也在框里，所以边框/背景/焦点环归容器，textarea 只要文字。 */
.chat-field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--palm-s1);
  min-height: var(--palm-dock-field-h);
  /* 4 行整行高（24px×4）+ 上下各 8px = 112px：切在整行边界上，
     不会出现"最后一行只露出半截"的残缺观感。 */
  max-height: 168px;      /* 2026-11-12：4 行 → 6 行（用户：写长一点就得翻） */
  /* 2026-11-10 三轮实机：外**壳不再留内边距**。
     原因：内边距留在壳上时，textarea 只有壳内那一小块，左右各 16px 的死区
     点不到、也不会出光标 —— 用户说的「输入文字显示区域要跟这个框一样」。
     内边距改由 textarea 自己承担（见下面的 .chat-field > .chat-input），
     它的盒子覆盖整个壳，点哪儿都能落光标，字仍然离圆弧有 16px。 */
  padding: 0;
  border: var(--palm-hair) solid var(--palm-line);
  /* 2026-11-10 真机第二轮：圆角太大时首行/末行的字形会压进圆弧被切掉半个字。
     半径收到 18px、左右内边距加到 16px，字形离弧线有余量。 */
  border-radius: 18px;
  /* 万一以后又出现内容溢出，宁可沿直角矩形裁掉，也不要让字跑到框外。 */
  overflow: hidden;
  background: var(--palm-sur-1);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.chat-field:focus-within {
  border-color: var(--palm-accent);
  box-shadow: 0 0 0 3px var(--palm-tint-accent);
}

/* 框内的 textarea：不重复画边框，也不重复画焦点环。 */
.chat-field > .chat-input {
  flex: 1;
  min-width: 0;
  /* 2026-11-10 真机：「四角显示不全、每行掉一个字」。根因是 field-sizing: content
     让 textarea 按**内容宽度**排版（内容比框宽），再被框裁掉左右各半个字。
     这里把行内尺寸钉死成 100%，让它只按内容长**高**，永远不横向溢出。 */
  inline-size: 100%;
  max-inline-size: 100%;
  overflow-x: hidden;
  overflow-wrap: anywhere;
  /* 高度由组件按 scrollHeight 写死（见 composer-section 的 autosize），
     不再依赖 field-sizing —— iOS 16/17 本来就不支持它。 */
  /* 内边距归 textarea 自己：上下 12 + 行高 22 = 46px，壳再撑到 48px；
     左右 16px 让字形躲开 18px 圆角。盒子覆盖整个壳 → 点框内任何位置都能落光标。 */
  padding: 12px 12px;
  /* 2026-11-11 真机第四轮：**圆角必须清零**。
     通用 \`.chat-input\` 上的 \`border-radius: var(--palm-r-full)\`（9999px）在
     textarea 上会变成一个椭圆，\`overflow-y:auto\` 又按这个椭圆裁切 ——
     这就是「四角缺字、首尾两行被啃掉一块」的真正原因（描边截图可证）。
     壳自己已经有 18px 圆角 + overflow:hidden，textarea 只需要一个直角盒子。 */
  border-radius: 0;
  min-height: 46px;
  /* 高度取行高的整数倍（4 行整）：滚动时看到的都是整行，不会上下各露半行；
     上下再留一点余量，首行的字头（丿/一横）不贴边被切（2026-11-10 真机）。 */
  max-height: 168px;      /* 2026-11-12：4 行 → 6 行（用户：写长一点就得翻） */
  line-height: 22px;
  border: none;
  background: transparent;
  box-shadow: none;
}

.chat-field > .chat-input:focus {
  border: none;
  box-shadow: none;
}

.chat-input::placeholder {
  color: var(--palm-fg-3);
}

.chat-input:focus {
  border-color: var(--palm-accent);
  box-shadow: 0 0 0 3px var(--palm-tint-accent);
}



/* 排队发送：拉长的胶囊上直接写「排队」。
   44px 圆钮里塞两个汉字放不下，所以排队态单独放宽。 */
.chat-send.chat-send-queued {
  width: auto;
  min-width: calc(var(--palm-dock-circle) * 1.75);
  padding: 0 var(--palm-s3);
  border-radius: var(--palm-r-full);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-bold);
}

.chat-send-queuedText {
  white-space: nowrap;
}

/* 发送键（C 案）：36px 圆形、主题色底、深色箭头；命中区补到 44px。 */
.chat-send {
  position: relative;
  flex: none;
  align-self: center;
  width: var(--palm-dock-circle);
  height: var(--palm-dock-circle);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--palm-r-full);
  background: var(--palm-accent);
  /* 2026-11-10：--accent-contrast 恒为白，压在三套皮肤的亮靛/青上只有 1.8~2.6:1；
     用皮肤给的前景色（石墨/夜航近黑，纸色白）。 */
  color: var(--palm-on-accent);
  font: inherit;
  cursor: pointer;
  box-shadow: var(--palm-sh1);
  transition: transform 0.15s ease, filter 0.15s ease;
}

.chat-send::after {
  content: '';
  position: absolute;
  inset: calc((var(--palm-hit) - var(--palm-dock-circle)) / -2);
  border-radius: inherit;
}

/* 发送键原来只有 hover 放大，没有按下态（触屏上 hover 永不触发，等于完全没反馈）。 */
.chat-send:active {
  transform: scale(var(--palm-btn-press-scale));
  filter: brightness(var(--palm-btn-press-dim));
}

@media (hover: hover) {
  .chat-send:not(:disabled):hover {
    transform: scale(1.05);
  }
}

.chat-send:not(:disabled):active {
  transform: scale(0.95);
  filter: brightness(1.08);
}

.chat-send:disabled {
  background: var(--palm-sur-2);
  color: var(--palm-fg-3);
  box-shadow: none;
}

.chat-send-stop {
  background: var(--palm-sur-2);
  color: var(--palm-danger);
  box-shadow: inset 0 0 0 var(--palm-hair) var(--palm-line);
}

/* 运行中带草稿时的停止键：主键此时让给"发送"（排队），停止退成它左边的小方块。
   比主键矮一圈并留一点间距，避免拇指在想发消息时误触到停止。 */
.chat-stop-mini {
  flex: none;
  align-self: center;
  width: var(--palm-s7);
  height: var(--palm-s7);
  /* 左右留间距、上下留 0，三点共用一条中线。 */
  margin: 0 var(--palm-s1);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--palm-r-full);
  background: var(--palm-sur-2);
  color: var(--palm-danger);
  box-shadow: inset 0 0 0 var(--palm-hair) var(--palm-line);
  font: inherit;
  cursor: pointer;
  transition: transform 0.15s ease;
}

.chat-stop-mini:not(:disabled):active {
  transform: scale(0.92);
}

/* 停止键的命中区：视觉上仍是 32px，判定区补到 44px。 */
.chat-stop-mini {
  position: relative;
}

.chat-stop-mini::after {
  content: '';
  position: absolute;
  inset: calc(var(--palm-s2) * -0.75);
}

.chat-stop-mini:disabled {
  color: var(--palm-fg-3);
  opacity: 0.6;
}

/* 窄屏（≤360px）：输入行不再收小发送键（44px 是触控下限），只压两侧留白。 */
@media (max-width: 360px) {
  .chat-inputbar {
    gap: var(--palm-s1);
    padding-left: var(--palm-s2);
    padding-right: var(--palm-s2);
  }
}

.chat-load-older {
  align-self: center;
  margin: 4px 0;
  /* 36 → 44 的可点高度（真机清单第 5 项）：文字按钮本身矮，点"加载更早"经常
     点到下面的正文。只抬可点高度，字号颜色都不动。 */
  min-height: var(--palm-hit);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-md);
  font-weight: 400;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: var(--radius-chip);
  transition: background-color 0.12s ease;
}

.chat-load-older:active {
  background: var(--fill);
}

.chat-load-older:disabled {
  opacity: 0.6;
}

.chat-typing {
  color: var(--text-tertiary);
  font-size: var(--text-md);
  padding: 4px 2px;
}


/* ── 语音输入：入口在输入框里，点一下就地录音（2026-11-12）──────────────
 * 原来要「+ → 添加内容 → 滚到第四层 → 语音输入」，然后弹一整块模态面板，
 * 录音时既看不见对话也看不见草稿。现在麦克风常驻输入框右端，点一下输入框
 * 就地变成录音条：红点 + 波形 + 计时 + 停止；转写文字实时显示在输入行上方。
 */

/* 麦克风按钮：空框时带底色（一眼能看见），有字时退成次要灰（不跟发送键抢）。 */
.chat-mic {
  /* 2026-11-12 真机：「语音按钮太大了」。它原来按 44px 命中区画，在 48px 高的框里几乎顶满；
     改成 30px 的视觉圆（命中区靠 padding 撑，仍够手指点）。 */
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 30px;
  block-size: 30px;
  padding: 0;
  /* 2026-11-12 真机：「语音按钮太靠近右边缘，都挨着了」。\`.chat-field\` 的 padding 是 0
     （让 textarea 铺满整壳好落光标），所以按钮得自己留边距，不能让负值往外顶。 */
  margin-inline-end: 8px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--palm-fg-3);
  cursor: pointer;
}

/* 空框：给一层底色，让它成为「输入区里唯一醒目的次要动作」。 */
.chat-mic:has(+ .chat-send:disabled),
.chat-field[data-empty='true'] .chat-mic {
  background: var(--palm-sur-2);
  color: var(--palm-fg);
}

.chat-mic:active {
  background: var(--palm-sur-2);
}

/* 录音态：整条输入框换成录音条，边框变警示红。
   *
   * 2026-11-12 用户：「切换过程要丝滑一些」。除了把等待麦克风的时间挪走（见 use-chat-voice），
   * 边框/内边距这里补一段 140ms 过渡 —— 状态是瞬间切换的，但颜色和留白是滑过去的，
   * 眼睛看到的是"变过去了"而不是"跳了一下"。 */
.chat-field[data-voice] {
  gap: var(--palm-s2);
  padding-inline: var(--palm-s3) var(--palm-s2);
  border-color: var(--palm-danger);
  box-shadow: inset 0 0 0 1px var(--palm-danger);
}

.chat-field {
  transition:
    border-color 140ms ease,
    box-shadow 140ms ease,
    background-color 140ms ease;
}

.chat-voice-dot {
  flex: none;
  inline-size: 8px;
  block-size: 8px;
  border-radius: 50%;
  background: var(--palm-danger);
  animation: chat-voice-pulse 1.1s ease-in-out infinite;
}

.chat-voice-dot[data-phase='transcribing'] {
  animation: none;
  opacity: 0.45;
}

@keyframes chat-voice-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

/* 波形：高度跟录音响度走。变量名是 --voice-level（use-chat-voice 每 85ms 写一次）；
   五根给**不同乘数** —— 同一乘数静止时就是五根等高竖杠（真机截过，很难看）。
   *
   * 2026-11-12 用户：「切到语音状态感觉好卡」。原来这里每根用
   * \`block-size: calc(4px + level * K)\` 驱动 —— \`block-size\` 是**布局属性**，
   * 每 85ms 写一次变量就有 7 个盒子重新排版，一秒十二次 reflow，手机直接掉帧。
   * 现在改成固定高度 + \`transform: scaleY()\`：只走合成层，不再触发布局。
   * 数值和原来等价（4px + level*K，基准 22px ⇒ scaleY = 0.182 + level * K/22）。 */
.chat-voice-wave {
  --voice-level: 0.4;
  flex: none;
  display: flex;
  align-items: center;
  gap: 3px;
  block-size: 22px;
}

.chat-voice-wave > span {
  inline-size: 3px;
  block-size: 22px;
  border-radius: 2px;
  background: var(--palm-danger);
  opacity: 0.92;
  transform: scaleY(calc(0.182 + var(--voice-level) * 0.818));
  transform-origin: center;
  will-change: transform;
}

/* 每根各自的系数直接写进 calc（不用中间变量）：系数是这七根自己的形状，
   不是全局令牌，没必要为它多定义一层自定义属性。 */
.chat-voice-wave > span:nth-child(2) { transform: scaleY(calc(0.182 + var(--voice-level) * 0.5)); }
.chat-voice-wave > span:nth-child(3) { transform: scaleY(calc(0.182 + var(--voice-level) * 0.727)); }
.chat-voice-wave > span:nth-child(4) { transform: scaleY(calc(0.182 + var(--voice-level) * 0.409)); }
.chat-voice-wave > span:nth-child(5) { transform: scaleY(calc(0.182 + var(--voice-level) * 0.636)); }
.chat-voice-wave > span:nth-child(6) { transform: scaleY(calc(0.182 + var(--voice-level) * 0.455)); }
.chat-voice-wave > span:nth-child(7) { transform: scaleY(calc(0.182 + var(--voice-level) * 0.591)); }

.chat-voice-clock {
  flex: none;
  font-variant-numeric: tabular-nums;
  font-size: var(--palm-t-s);
  color: var(--palm-danger);
}

.chat-voice-status {
  flex: 1 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-2);
}

.chat-voice-stop {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 30px;
  block-size: 30px;
  border: 0;
  border-radius: 50%;
  background: var(--palm-danger);
  color: var(--palm-on-accent);
  cursor: pointer;
}

.chat-voice-stop:disabled {
  opacity: 0.5;
}

.chat-voice-stop-square {
  inline-size: 10px;
  block-size: 10px;
  border-radius: 2px;
  background: currentColor;
}

/* 实时转写行：录音条上方（文字 + 右侧取消）。最多两行，超了省略。 */
.chat-voice-live {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  margin: 0 var(--palm-dock-pad) var(--palm-s1);
  /* 录音态进出时淡入 + 轻微上移（160ms）：这一行是后挂上来的，直接出现会"闪一下"。 */
  animation: chat-voice-live-in 160ms ease-out;
}

@keyframes chat-voice-live-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

.chat-voice-live-text {
  flex: 1 1 auto;
  min-inline-size: 0;
  margin: 0;
  font-size: var(--palm-t-s);
  line-height: 1.45;
  color: var(--palm-fg-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 取消：框内、停止键左边的小圆。2026-11-12 用户第二次反馈「点语音后没有取消」——
   上一版把它挪到框外的灰色文字上，真机看不出来。现在做成实心圆按钮，跟停止键成对。 */
.chat-voice-cancel {
  /* 与停止键成对靠右：空白只由取消键吃掉，停止键紧跟其后。 */
  margin-inline-start: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 30px;
  block-size: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
  cursor: pointer;
}

.chat-voice-cancel:active {
  color: var(--palm-fg);
}/* ── message long-press context menu ─────────────────────────────────── */

.ctx-backdrop {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-ctx);
}

.ctx-menu {
  position: fixed;
  z-index: calc(var(--z-ctx) + 1);
  min-width: 168px;
  padding: var(--space-1);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-menu);
  background: var(--dialog-bg);
  box-shadow: var(--shadow-lg);
  animation: ctx-in 0.12s ease both;
}

@keyframes ctx-in {
  from {
    opacity: 0;
    transform: scale(0.94);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 菜单顶部的"操作对象"行：长按命令卡时先告诉用户这一条是什么，
   否则四个动作长得一样，复制前后都分不清对象。 */
.ctx-head {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 220px;
  padding: 8px 12px 6px;
  border-bottom: 1px solid var(--card-border);
  margin-bottom: 2px;
}

.ctx-head-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-secondary);
}

.ctx-head-state {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

/* 取消单独一档：手机上没有 Esc，兜底入口要看得见。 */
.ctx-item-cancel {
  color: var(--text-secondary);
  border-top: 1px solid var(--card-border);
  border-radius: 0 0 8px 8px;
  margin-top: 2px;
}

.ctx-item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 44px;
  padding: 0 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.ctx-item:active {
  background: var(--fill);
}

/* ── bottom sheets ───────────────────────────────────────────────────── */

.sheet-backdrop {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  /* Above the composer: the composer carries z-index 50 (so the picker
     scrim at 40 never covers it), and the sheet renders BEFORE the
     composer in the DOM - at the same stacking level the later sibling
     wins, which put the input bar over the panel's bottom. */
  z-index: var(--z-sheet);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: var(--backdrop);
  /* iOS 侧边栏那套：遮罩只做透明度，收尾比抽屉慢一拍，两层才有前后关系
     （原来和抽屉一起 ease 淡入，真机上像整屏闪一下）。 */
  animation: drawer-scrim-in 300ms cubic-bezier(0.32, 0.72, 0, 1) both;
}

@keyframes sheet-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.sheet {
  /* Host data fills the sheets - model ids, slash-command names, permission
     ids, failure messages - so a long unbreakable token wraps here instead of
     running past the sheet edge, where overflow:hidden would clip it. */
  overflow-wrap: anywhere;
  /* Content-sized sheet: no height cap by default, so every list item is
     always fully visible - nothing to scroll for ordinary content. Only
     extreme content (a hundred tasks) is bounded, and the sheet then
     overflows the top of the screen while its bottom stays visible (the
     list's last item is never silently clipped). */
  max-height: 100vh;
  display: block;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-bottom: none;
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  box-shadow: var(--shadow-lg);
  /* Clip any overflow to the rounded sheet. */
  overflow: hidden;
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
  animation: sheet-up 0.3s ease-out both;
}

/* Expanded (pulled up past the expand threshold): full viewport height. */
.sheet-full {
  max-height: 100vh;
}

@keyframes sheet-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

/* Grab header: the only place drag gestures are captured (touch-action:
   none), so the scrollable body below owns every other vertical gesture.
   Column flex centers the handle and title (a plain block container would
   keep the handle flush left - align-self needs a flex/grid context). */
.sheet-grab {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  touch-action: none;
  cursor: grab;
}

.sheet-handle {
  flex: none;
  align-self: center;
  width: 36px;
  height: 4px;
  margin: 8px 0 2px;
  border-radius: 2px;
  background: var(--text-muted);
}

.sheet-title {
  flex: none;
  /* 2026-11-11 真机：17px/500 的居中标题配 15px 的列表行，标题既不够"标题"
     又占掉一行高度。改成 16px/600 并把上下留白收一档，标题更像标题、列表更贴身。 */
  padding: 14px 16px 10px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: center;
}

.sheet-body {
  /* Content-sized (height auto): an ordinary task list fits entirely and is
     always fully visible with nothing to scroll. The generous max-height
     only engages for extreme content, and the sheet above overflows the top
     of the viewport before this cap is ever hit. */
  height: auto;
  max-height: calc(100vh - 110px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 12px 8px;
}

.sheet-full .sheet-body {
  max-height: calc(100vh - 96px);
}

/* ── 会话抽屉（P6 第 3 步 · overview.html「1 · 会话抽屉」） ────────────
 * 左侧面板 --palm-drawer-w（窄屏 86vw：比 308px 舒展一点，又不至于像全屏），只有右侧两角是圆的；行 ≥ --palm-hit，
 * 底部三入口带右侧小字。 */
.palm-drawer-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  display: flex;
  justify-content: flex-start;
  background: var(--backdrop);
  /* iOS 侧边栏那套：遮罩只做透明度，收尾比抽屉慢一拍，两层才有前后关系
     （原来和抽屉一起 ease 淡入，真机上像整屏闪一下）。 */
  animation: drawer-scrim-in 300ms cubic-bezier(0.32, 0.72, 0, 1) both;
}

.palm-drawer {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s3);
  inline-size: min(var(--palm-drawer-w), 86vw);
  block-size: 100%;
  padding: var(--palm-s4) var(--palm-s3);
  background: var(--palm-sur-1);
  border-inline-end: var(--palm-hair) solid var(--palm-line);
  border-radius: 0 var(--palm-r-l) var(--palm-r-l) 0;
  box-shadow: var(--palm-sh2);
  /* 面板本身不滚：滚的是中间的会话列表。否则整块（含身份区/底部三入口）
     会跟着手指上下跑，遮罩下看着就是「错位」。 */
  overflow: hidden;
  overscroll-behavior: contain;
  /* 整块从左边拉出来（-100% → 0），**不淡入**：侧边栏淡入在真机上就是
     「先灰一下再出现」。曲线取 iOS 那条（起步利落、落地稳住），340ms。 */
  animation: palm-drawer-in 340ms cubic-bezier(0.32, 0.72, 0, 1) both;
}

@keyframes palm-drawer-in {
  from { transform: translate3d(-100%, 0, 0); }
  to { transform: translate3d(0, 0, 0); }
}

@keyframes drawer-scrim-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 退出要走完再卸载（App 里 onClose 会等 240ms）。关闭比打开快：
   iOS 的默认手感，慢了像拖泥带水。 */
.palm-drawer.is-closing {
  animation: palm-drawer-out 240ms cubic-bezier(0.4, 0, 1, 1) both;
}

.palm-drawer-scrim.is-closing {
  animation: drawer-scrim-out 220ms cubic-bezier(0.4, 0, 1, 1) both;
}

@keyframes palm-drawer-out {
  to { transform: translate3d(-100%, 0, 0); }
}

@keyframes drawer-scrim-out {
  to { opacity: 0; }
}

/* 工作区身份：方形头像 + 名称 + 路径。 */
.palm-drawer-head {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
}

.palm-drawer-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  inline-size: var(--palm-drawer-avatar);
  block-size: var(--palm-drawer-avatar);
  border-radius: var(--palm-r-m);
  background: var(--palm-tint-accent);
  color: var(--palm-accent);
  font-weight: var(--palm-w-bold);
}

.palm-drawer-ws {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}

.palm-drawer-ws > b {
  overflow: hidden;
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
  color: var(--palm-fg);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palm-drawer-ws > small {
  overflow: hidden;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 工作区切换条（2026-11-11 用户：「抽屉里那个切换工作区是纯图标，看不出是在这切
 * 工作区」）。
 *
 * 原来头部的可点部分只有右侧一枚 16px 的箭头 —— 既小又像装饰，而左边显示工作区
 * 名的那一块反倒点不动。现在把「头像 + 名字 + 路径」整块变成按钮（≥44px），
 * 右侧写清楚「切换 ⌄」：能点的地方和说的事是同一块。
 */
.palm-drawer-ws-btn {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--palm-s2);
  min-inline-size: 0;
  min-block-size: var(--palm-hit);
  padding: 4px 6px;
  margin-inline: -6px;
  border: 0;
  border-radius: var(--palm-r-m);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.palm-drawer-ws-btn:active {
  background: var(--palm-sur-1);
}

/* 右侧「切换 ⌄」：文字 + 箭头 + 一层淡底，做成一眼能看出是按钮的胶囊。
   只写箭头（改造前）看不出意图，只写灰字又太像说明文字。 */
.palm-drawer-ws-switch {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: var(--palm-r-m);
  background: var(--palm-tint-accent);
  color: var(--palm-accent);
  font-size: var(--palm-t-s);
}

/* 抽屉里的图标一律 16×16（项目规则：图标固定尺寸、不参与 flex 拉伸）。 */
.palm-drawer-ws-switch > svg {
  inline-size: 16px;
  block-size: 16px;
}

/* 新建（满宽主按钮 40 高 / 圆角 12）与搜索（34 高 / 无边框）。 */
.palm-drawer-new {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--palm-s2);
  inline-size: 100%;
  block-size: var(--palm-drawer-new-h);
  border: 0;
  border-radius: var(--palm-r-m);
  background: var(--palm-accent);
  color: var(--accent-contrast);
  font: inherit;
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
  white-space: nowrap;
}

/* 抽屉的「新建会话」原来既没有按下态也没有禁用态：点下去没反馈，灰掉也不明显。
   跟其余五颗主键共用同一组令牌。 */
.palm-drawer-new:active {
  transform: scale(var(--palm-btn-press-scale));
  filter: brightness(var(--palm-btn-press-dim));
}

.palm-drawer-new:disabled {
  opacity: var(--palm-btn-disabled-opacity);
  transform: none;
}

.palm-drawer-search {
  display: inline-flex;
  align-items: center;
  gap: var(--palm-s2);
  inline-size: 100%;
  block-size: var(--palm-drawer-search-h);
  padding: 0 var(--palm-s2);
  border: 0;
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-t-m);
  white-space: nowrap;
}

.palm-drawer-list {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: var(--palm-s3);
  min-block-size: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* 空列表的说明行：不留一块空白（那会被读成"界面坏了"）。 */
.palm-drawer-empty {
  margin: 0;
  padding: var(--palm-s3) var(--palm-s2);
  color: var(--palm-fg-3);
  font-size: var(--palm-flow-meta-size);
  line-height: var(--palm-lh-body);
}

.palm-drawer-group {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s1);
}

.palm-drawer-bucket {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: var(--palm-s2);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-normal);
  /* 二级前景色（2026-11-10）：三级灰的分组标题在深色皮肤上几乎读不出来，
     而它是长列表里唯一的定位信息。条数仍用三级色，不跟会话标题抢。 */
  color: var(--palm-fg-2);
}

.palm-drawer-bucket-count {
  color: var(--palm-fg-3);
  font-variant-numeric: tabular-nums;
}

.palm-drawer-rows {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s1);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 一行会话：标题吃剩余，右侧只有有状态时才出现 mini 条。 */
.palm-drawer-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-start;
  gap: var(--palm-s2);
  min-block-size: var(--palm-hit);
  padding: var(--palm-s1) var(--palm-s2);
  border-radius: var(--palm-r-m);
}

.palm-drawer-row:active { background: var(--palm-sur-2); }

.palm-drawer-row:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: var(--palm-hair);
}

.palm-drawer-row-current {
  background: var(--palm-sur-2);
  /* 当前位置的第二个信号（2026-11-10）：只靠底色差，在带迷你状态条的行走里看不出来。 */
  box-shadow: inset 2px 0 0 var(--palm-accent);
}

/* 置顶行的图钉（2026-11-12）：12px 线性，颜色随当前皮肤的主色，跟着标题一起走。
   不加背景块 —— 抽屉行本来就只有 44px 高，多一块底色会把「当前会话」那条底色信号搅混。 */
.palm-drawer-pin {
  flex: 0 0 auto;
  color: var(--palm-accent);
}

/* 长按那一行：面板开着时给它一层「选中」的底色（2026-11-12 精修版）。
   遮罩会把它压暗，这层底色是后面唯一还能分辨「动的是哪条」的线索。 */
.palm-drawer-row-held {
  background: var(--palm-sur-2);
}

/* ── 会话动作面板（底部 action sheet）──────────────────────────────────
   2026-11-12 用户：「置顶和删除按钮太丑了」。原先是行内两个等宽按钮，像表单操作区，
   还把行撑高、列表会跳。换成底部面板：列表纹丝不动、动作能带说明文字、
   长按→升起和系统相册同一套心智。

   提到 \`--z-ctx\`（70，长按上下文层）：它必须盖在抽屉（60）之上。 */
/* 遮罩：**不用 backdrop-filter**（全表禁用它，手机 GPU 上开销太高，结构契约会拦下来）。
   用 \`--palm-scrim-sheet\` 而不是通用 \`--palm-scrim\`：动作面板要的是「注意力只剩这块面板」，
   常规遮罩（浅色主题 42%）背后还看得太清楚，灯箱级的 80% 又太重。这一档是两者之间
   （浅色 60% / 深色 66%），2026-11-13 用户：「遮罩更深点」。 */
.palm-actions-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-ctx);
  display: flex;
  align-items: flex-end;
  background: var(--palm-scrim-sheet, var(--palm-scrim));
  animation: drawer-scrim-in 240ms ease-out both;
}

/* 面板与取消键的容器：两者之间要有 8px 的缝，所以不放进同一个圆角块里。 */
.palm-actions-layer {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  inline-size: 100%;
  padding: 0 var(--palm-s3) var(--palm-s3);
  animation: sheet-up 260ms cubic-bezier(0.32, 0.72, 0, 1) both;
}

.palm-actions {
  overflow: hidden;
  border-radius: var(--palm-r-l, 18px);
  background: var(--palm-sur-1);
  box-shadow: var(--palm-shadow);
}

/* 预览：让用户确认「要动的就是这一条」。只写标题不够 —— 列表里同名会话是可能的。 */
.palm-actions-preview {
  display: flex;
  align-items: center;
  gap: var(--palm-s3);
  padding: var(--palm-s3);
  border-block-end: 1px solid var(--palm-line);
}

.palm-actions-preview-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  inline-size: 38px;
  block-size: 38px;
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-2);
  color: var(--palm-accent);
}

.palm-actions-preview-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-inline-size: 0;
}

.palm-actions-preview-title {
  /* 标题最多两行：再长就是用户在给自己找麻烦，面板不该被一条标题撑成半屏。 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: var(--palm-t-m);
  font-weight: 600;
  line-height: 1.35;
  color: var(--palm-fg);
}

.palm-actions-preview-meta {
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

/* 动作行：图标 + 主文案 + 右侧说明。58px 是「一行放下三个元素还不挤」的下限。 */
.palm-actions-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--palm-s3);
  inline-size: 100%;
  min-block-size: 58px;
  padding: 0 var(--palm-s3);
  /* \`Button\` 是裸 \`<button>\`：不写这两行，浏览器默认的 buttonface 灰底会透出来，
     于是一块白面板里漂着三条灰条（真机第一版就是这样）。 */
  border: 0;
  background: transparent;
  font-size: var(--palm-t-l);
  text-align: start;
  color: var(--palm-fg);
}

.palm-actions-item:active {
  background: var(--palm-sur-2);
}

/* 分隔线从文字起点开始，不顶到左右边缘 —— 和预览区的内边距对齐。 */
.palm-actions-item + .palm-actions-item::before {
  content: '';
  position: absolute;
  inset-inline: var(--palm-s3);
  inset-block-start: 0;
  block-size: 1px;
  background: var(--palm-line);
}

.palm-actions-item-icon {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  inline-size: 22px;
  color: var(--palm-accent);
}

.palm-actions-item-label {
  flex: 1 1 auto;
}

.palm-actions-item-note {
  flex: 0 0 auto;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

/* 危险动作只换颜色、不换底色：红底大按钮看着像「推荐操作」，这里正好相反。 */
.palm-actions-item-danger .palm-actions-item-icon,
.palm-actions-item-danger .palm-actions-item-label {
  color: var(--palm-danger);
}

.palm-actions-item-danger .palm-actions-item-note {
  color: var(--palm-danger);
  opacity: 0.62;
}

/* 取消键与面板分离（iOS 做法）：主操作和「退出」在视觉上是两件事。 */
.palm-actions-cancel {
  inline-size: 100%;
  min-block-size: 56px;
  border: 0;
  border-radius: var(--palm-r-l, 18px);
  background: var(--palm-sur-1);
  font-size: var(--palm-t-l);
  font-weight: 600;
  color: var(--palm-fg);
  box-shadow: var(--palm-shadow);
}

.palm-actions-cancel:active {
  background: var(--palm-sur-2);
}

/* ── 确认页：同一块面板换了内容，用户不会觉得「又弹了一层」 ──────────── */
.palm-actions-confirm-title {
  padding: var(--palm-s4) var(--palm-s4) 0;
  margin: 0;
  font-size: var(--palm-t-l);
  font-weight: 700;
  text-align: center;
  color: var(--palm-fg);
}

.palm-actions-confirm-body {
  padding: var(--palm-s2) var(--palm-s5) var(--palm-s4);
  margin: 0;
  font-size: var(--palm-t-s);
  line-height: 1.6;
  text-align: center;
  color: var(--palm-fg-2);
}

.palm-actions-confirm-body b {
  font-weight: 600;
  color: var(--palm-fg);
}

.palm-actions-confirm-row {
  display: flex;
  gap: var(--palm-s2);
  padding: 0 var(--palm-s3) var(--palm-s3);
}

.palm-actions-btn {
  flex: 1 1 0;
  min-block-size: 50px;
  border: 0;
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-2);
  font-size: var(--palm-t-l);
  font-weight: 600;
  color: var(--palm-fg);
}

.palm-actions-btn-danger {
  background: var(--palm-danger);
  color: var(--palm-on-accent);
}

.palm-drawer-title {
  flex: 1 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  font-size: var(--palm-t-m);
  color: var(--palm-fg);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 行右侧那句「什么时候」：2026-11-11 用户「侧边栏的右边有点空」—— 一行的标题在左、
 * 状态条靠右，中间到右边缘一大条空白，什么信息都没有。时间是最省地方又真有用的一种
 * 填充（今天给时刻、昨天给「昨天」、更早给月-日），宽 5 个字符，不会把标题挤变形。
 */
.palm-drawer-when {
  flex: none;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
  font-variant-numeric: tabular-nums;
}

/* 底部入口（2026-11-11 C 版）：小标题 + 一块带底色的圆角卡片。
 *
 * 老版是三行等高、只有两行带右小字（\`12\` / \`本机\`），右边缘参差；三条之间只隔
 * 4px，看起来就是会话列表多出来的三行。现在把它们框进一块 --palm-sur-2 的卡片，
 * 与列表之间靠「工具」小标题 + 一条发丝线分层，三行统一带右箭头。
 */
.palm-drawer-foot {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s1);
  padding-top: var(--palm-s2);
  border-top: var(--palm-hair) solid var(--palm-line);
}

.palm-drawer-tools {
  display: flex;
  flex-direction: column;
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-2);
  overflow: hidden;
}

.palm-drawer-tool {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  inline-size: 100%;
  min-block-size: var(--palm-hit);
  padding: 0 var(--palm-s2);
  border: 0;
  /* 行间发丝线靠「除第一行外都画上边线」，比 gap 更贴 iOS 分组表。 */
  border-block-start: var(--palm-hair) solid var(--palm-line);
  background: transparent;
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-t-m);
  text-align: left;
  white-space: nowrap;
}

.palm-drawer-tool:first-child { border-block-start: 0; }

.palm-drawer-tool:active { background: var(--palm-sur-1); }

/* 主文案吃掉剩余宽度：右侧小字与箭头永远不被挤掉。 */
.palm-drawer-tool > span { flex: 1 1 auto; min-inline-size: 0; }

.palm-drawer-tool > small {
  flex: none;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

/* 箭头弱化：它是「这里能进去」的提示，不该和主文案抢注意力。 */
.palm-drawer-tool > svg:last-child {
  flex: none;
  color: var(--palm-fg-3);
  opacity: 0.7;
}


/* 身份区的工作区切换箭头：多工作区才画（单工作区不占位置）。
 * 复用 .mobile-iconbtn 的 48px 命中区，这里只把它压到 44px 并推到最右。 */
.palm-drawer-head > .mobile-iconbtn {
  inline-size: var(--palm-hit);
  block-size: var(--palm-hit);
  margin-inline-start: auto;
  color: var(--palm-fg-3);
}

/* ── 抽屉的尺寸硬约束（2026-11-08 实机投诉修复）─────────────────────────
 *
 * 根因：icons.tsx 的 SVG 只给 viewBox，没有 width/height。没有内在尺寸的 SVG 是
 * 「替换元素」，在 flex 行里按默认的 300×150 参与布局 —— 行宽不够就等比缩成
 * 一个占满整行宽的方块（实机截图：放大镜/齿轮/文件夹顶满一行，文字被压在它下面
 * 折行，「新建会话」「搜索会话和消息」都断成两行）。尺寸的唯一出口是令牌
 * --palm-drawer-glyph，组件里不写行内样式。
 */
.palm-drawer svg {
  flex: none;
  inline-size: var(--palm-drawer-glyph);
  block-size: var(--palm-drawer-glyph);
}

/* 行内文案：单行 + 省略号。图标固定之后，折行的唯一来源就是文案本身。 */
.palm-drawer-ws > b,
.palm-drawer-new > span,
.palm-drawer-search > span,
.palm-drawer-tool > span {
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 底部入口右侧的小字（「12 个文件」「本机」）不换行。 */
.palm-drawer-tool > small {
  white-space: nowrap;
}

/* 会话行右侧的迷你状态条：定版 88×18，不参与 flex 拉伸。 */
.palm-drawer-row .palm-strip-wrap[data-size='mini'],
.palm-drawer-row .palm-strip[data-size='mini'] {
  flex: none;
  inline-size: var(--palm-drawer-strip-w);
  block-size: var(--palm-drawer-strip-h);
}

/* ── 切换工作区面板（2026-11-11 重做） ──────────────────────────────────
 * 老版本每行都画完整绝对路径（长路径折两行、单条 ~90px）、同名工作区分不清、无分组、
 * 无搜索、当前项无标记。现在：搜索条（sticky）+ 三段列表（当前 / 最近用过 / 按项目分组）
 * + 底部计数与「＋ 新建」。行高 44–48，一屏 12 行左右。
 */
.ws-picker {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s1);
}

.ws-search {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--palm-s1) var(--palm-s1);
  background: var(--palm-sur-1);
}

.ws-search-icon {
  flex: none;
  font-size: var(--palm-t-s);
  opacity: 0.6;
}

.ws-search-input {
  flex: 1;
  min-inline-size: 0;
  height: 36px;
  padding: 0 var(--palm-s2);
  border: none;
  border-radius: var(--palm-r-s);
  background: var(--palm-sur-2);
  color: var(--palm-fg);
  font: inherit;
  font-size: 13px;
  /* 真机（2026-11-11）：不写 outline 的话，点进搜索框会出现系统白框，在深色面板上
     比输入框本身还显眼。改成细描边 + 淡底，焦点仍然看得出来。 */
  outline: none;
}

.ws-search-new {
  background: var(--palm-tint-accent);
  color: var(--palm-accent);
  font-size: var(--palm-t-m);
}

/* 面板打开时焦点会落在这个「＋」上（搜索框排在它前面，见 focus-trap 的 initialFocusWithin）。
   不写这行就是系统默认的白环 —— 在深色面板上比按钮本身还显眼。 */
.ws-search-new:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: 2px;
}

.ws-search-input:focus-visible {
  box-shadow: 0 0 0 1px var(--palm-accent);
}

.ws-search-input::placeholder {
  color: var(--palm-fg-3);
}

.ws-search-clear,
.ws-search-new {
  flex: none;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 14px;
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
  font-size: var(--palm-t-s);
  line-height: 1;
}

.ws-list {
  display: flex;
  flex-direction: column;
  /* 底部「共 N 个 / ＋ 新建」是 sticky 的：留出它的高度，最后一行才不会被盖住。 */
  padding-block-end: 56px;
}

/* 组标题：11px、字距略松；项目组右侧给数量。 */
/* 组头：项目组是可点的折叠按钮（一行 40px，右侧带数量）；「当前 / 最近用过」只是纯文字。 */
.ws-group-head {
  display: flex;
  align-items: center;
  gap: var(--palm-s1);
  inline-size: 100%;
  min-block-size: 36px;
  padding: var(--palm-s1) var(--palm-s2);
  border: none;
  border-radius: var(--palm-r-s);
  background: transparent;
  color: var(--palm-fg-3);
  font: inherit;
  font-size: 11px;
  letter-spacing: 0.02em;
  text-align: start;
  cursor: pointer;
}

.ws-group-head:active {
  background: var(--palm-sur-2);
}

.ws-caret {
  flex: none;
  inline-size: 12px;
  font-size: 10px;
  text-align: center;
}

.ws-group-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--palm-s2);
  padding: var(--palm-s3) var(--palm-s2) var(--palm-s1);
  color: var(--palm-fg-3);
  font-size: 11px;
  letter-spacing: 0.02em;
}

/* 展开的组头里，标题不换行、提示弱化、数量靠右。 */
.ws-group-head .ws-group-label {
  padding: 0;
  flex: 1;
  min-inline-size: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ws-group-plain {
  display: flex;
  align-items: baseline;
  gap: var(--palm-s1);
  padding: var(--palm-s3) var(--palm-s2) var(--palm-s1);
}

.ws-group-hint {
  flex: none;
  color: var(--palm-fg-3);
  font-size: 10px;
  opacity: 0.7;
}

.ws-group-head .ws-group-count {
  margin-inline-start: auto;
}

/* 搜索命中：只加底色，不改字重（整行重量变了反而看不清命中位置）。 */
.ws-mark {
  border-radius: 3px;
  background: var(--palm-tint-accent);
  color: inherit;
}

.ws-group-count {
  font-variant-numeric: tabular-nums;
}

.ws-row {
  display: flex;
  align-items: center;
  gap: 10px;
  inline-size: 100%;
  min-block-size: var(--palm-hit);
  padding: var(--palm-s1) var(--palm-s2);
  border: none;
  border-radius: var(--palm-r-s);
  background: transparent;
  color: var(--palm-fg);
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.ws-row:active {
  background: var(--palm-sur-2);
}

.ws-row-current {
  background: var(--palm-tint-accent);
}

.ws-tick {
  flex: none;
  inline-size: 14px;
  color: var(--palm-accent);
  font-size: var(--palm-t-s);
  text-align: center;
}

.ws-meta {
  flex: none;
  color: var(--palm-fg-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.ws-empty {
  margin: 16px 10px;
  color: var(--palm-fg-3);
  font-size: 13px;
  text-align: center;
}




/* 新建工作区：内联表单，不叠第二个弹层。 */
.ws-create {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 6px 4px;
}

.ws-create-label {
  color: var(--palm-fg-2);
  font-size: var(--palm-t-s);
}

.ws-create-input {
  inline-size: 100%;
  height: 40px;
  padding: 0 10px;
  border: 1px solid var(--palm-line);
  border-radius: var(--palm-r-s);
  background: var(--palm-sur-2);
  color: var(--palm-fg);
  font: inherit;
  font-size: 13px;
}

/*
 * 新建工作区 →「点选电脑上的目录」（2026-11-11）。
 *
 * 一层目录一屏：面包屑在顶、列表可滚（44vh 上限，键盘/底部按钮都还够得着）、
 * 底部两个动作。行高跟抽屉一致用 --palm-hit（44px），手指点得中。
 */
.pb {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  padding: 4px 6px 0;
}

.pb-head {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
}

.pb-back {
  flex: none;
  padding: 2px 6px;
  border: 0;
  border-radius: var(--palm-r-s);
  background: none;
  color: var(--palm-accent);
  font: inherit;
  font-size: var(--palm-t-s);
}

.pb-label {
  margin: 0;
  color: var(--palm-fg-2);
  font-size: var(--palm-t-s);
}

.pb-crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0;
  font-size: var(--palm-t-s);
}

.pb-crumb-wrap {
  display: inline-flex;
  align-items: center;
}

.pb-crumb-sep {
  padding: 0 2px;
  color: var(--palm-fg-3);
}

.pb-entry-icon {
  display: inline-flex;
  flex: none;
  color: var(--palm-fg-3);
}

.pb-entry-icon > svg {
  inline-size: 16px;
  block-size: 16px;
}

.pb-crumb {
  max-inline-size: 40vw;
  overflow: hidden;
  padding: 2px 4px;
  border: 0;
  background: none;
  color: var(--palm-accent);
  font: inherit;
  font-size: var(--palm-t-s);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 当前这一层：不再是链接，压暗成普通文字。 */
.pb-crumb-here {
  overflow: hidden;
  padding: 2px 4px;
  color: var(--palm-fg);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pb-list {
  max-block-size: 44vh;
  overflow: auto;
  border: 1px solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
}

.pb-entry {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  inline-size: 100%;
  min-block-size: var(--palm-hit);
  padding: 0 var(--palm-s2);
  border: 0;
  background: none;
  color: var(--palm-fg);
  font: inherit;
  font-size: var(--palm-t-m);
  text-align: start;
}

.pb-entry:active {
  background: var(--palm-sur-2);
}

.pb-entry-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pb-note {
  margin: 0;
  padding: var(--palm-s3);
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  text-align: center;
}

.pb-hint {
  margin: 0;
}




.ws-create-cancel,
.ws-create-submit {
  min-block-size: var(--palm-hit);
  padding: 0 14px;
  border: 1px solid var(--palm-line);
  border-radius: var(--palm-r-s);
  background: transparent;
  color: var(--palm-fg-2);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.ws-create-submit {
  border-color: transparent;
  background: var(--palm-accent);
  color: var(--palm-on-accent);
}

.ws-create-submit:disabled,
.ws-create-cancel:disabled {
  opacity: 0.5;
}

/* 搜索行右侧常驻的「＋ 新建」，与清除按钮同样大小；列表末尾一行计数。 */

.ws-foot-count {
  margin: 0;
  padding: var(--palm-s2) 0 var(--palm-s1);
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  text-align: center;
}

/* 每行右侧的「⋯」与它的操作菜单（重命名 / 删除）。行本身仍整行可点（= 切过去）。 */
.ws-row-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.ws-row-wrap > .ws-row {
  flex: 1 1 100%;
  min-inline-size: 0;
  /* 右侧给「⋯」让位（按钮是绝对定位，不参与换行，否则会单独占一行）。 */
  padding-inline-end: calc(var(--palm-hit) + var(--palm-s1));
}

.ws-row-more {
  position: absolute;
  inset-block-start: 0;
  inset-inline-end: 0;
  flex: none;
  inline-size: var(--palm-hit);
  block-size: var(--palm-hit);
  border: none;
  background: transparent;
  color: var(--palm-fg-3);
  font-size: var(--palm-t-m);
  line-height: 1;
  cursor: pointer;
}

.ws-row-more:active {
  color: var(--palm-fg);
}

/* 菜单浮在这一行右下：不改网格、不挤动别的行。 */
.ws-menu {
  position: absolute;
  inset-block-start: calc(100% - var(--palm-s1));
  inset-inline-end: var(--palm-s2);
  z-index: 2;
  display: flex;
  flex-direction: column;
  min-inline-size: 120px;
  padding: var(--palm-s1);
  border: 1px solid var(--palm-line);
  border-radius: var(--palm-r-s);
  background: var(--palm-sur-1);
  box-shadow: var(--palm-shadow);
}

.ws-menu [role='menuitem'] {
  padding: var(--palm-s2);
  border: none;
  border-radius: var(--palm-r-s);
  background: transparent;
  color: var(--palm-fg);
  font: inherit;
  font-size: var(--palm-t-s);
  text-align: start;
  cursor: pointer;
}

.ws-menu [role='menuitem']:active {
  background: var(--palm-sur-2);
}

.ws-menu [role='menuitem'][data-danger] {
  color: var(--palm-danger);
}

.ws-create-submit[data-danger] {
  background: var(--palm-danger);
}

/* 行内展开的两个动作（重命名 / 删除）。不弹浮层：手机上浮层会盖住下面的行，也容易被滚动抢手势。 */
.ws-actions {
  flex-basis: 100%;
  display: flex;
  justify-content: flex-end;
  gap: var(--palm-s2);
  padding: 0 var(--palm-s2) var(--palm-s1);
}

.ws-action {
  min-block-size: var(--palm-hit);
  padding: 0 var(--palm-s2);
  border: none;
  border-radius: var(--palm-r-s);
  background: transparent;
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-t-s);
  cursor: pointer;
}

.ws-action:active {
  background: var(--palm-sur-2);
}

.ws-action-danger {
  color: var(--palm-danger);
}

/*
 * 新建工作区的两个「点选」入口（2026-11-11 晚）。
 *
 * 之前它们是 \`.ws-action\`：透明背景 + 灰色小字，看着就是一句说明文字 —— 用户的原话
 * 「不然用户可能意识不到这个可以点击」。现在做成整宽的行卡片：边框 + 浅底 + 左侧图标
 * + 右侧 \`›\`，和抽屉底部的「设置 / 用量」同一种语言，一眼就是能按的东西。
 */
.ws-pick {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  inline-size: 100%;
  min-block-size: var(--palm-hit);
  padding: 0 var(--palm-s2);
  border: 1px solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  color: var(--palm-fg);
  font: inherit;
  font-size: var(--palm-t-m);
  text-align: start;
}

.ws-pick:active {
  background: var(--palm-sur-2);
}

.ws-pick-icon {
  display: inline-flex;
  flex: none;
  color: var(--palm-accent);
}

.ws-pick-icon > svg {
  inline-size: 16px;
  block-size: 16px;
}

.ws-pick-copy {
  flex: 1 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-pick-tail {
  flex: none;
  color: var(--palm-fg-3);
  font-size: var(--palm-t-m);
}

/* 表单内的排版收紧：.sheet-note 自带 12/16 内边距，在窄抽屉里会把提示顶到中间。 */
.ws-create .sheet-note {
  margin: var(--palm-s1) 0 0;
  padding: 0;
}

.ws-create .sheet-confirm-actions {
  justify-content: flex-end;
  gap: var(--palm-s2);
}

/*
 * 任务页骨架（2026-11-11 真机：整页一起滚、行高参差）：外层只负责竖向滚动，
 * 行结构统一 —— 每行至少 --palm-hit 高、右侧时间用 tabular 数字对齐，
 * 长短标题都单行截断，免得行高跟着标题长度跳、一屏里参差不齐。
 */
.tasks-page-body {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  padding: var(--palm-s3) 0 calc(var(--palm-s4) + env(safe-area-inset-bottom, 0px));
}

.tasks-group {
  display: flex;
  flex-direction: column;
}

.tasks-group-head {
  margin: 0;
  padding: var(--palm-s2) var(--palm-s3) var(--palm-s1);
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  font-weight: 500;
  letter-spacing: 0.08em;
}

.tasks-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tasks-row {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  inline-size: 100%;
  min-block-size: 52px;
  padding: 6px var(--palm-s3);
  border: 0;
  border-bottom: var(--palm-hair) solid var(--palm-line);
  background: none;
  color: var(--palm-fg);
  font: inherit;
  text-align: start;
}

.tasks-row:active {
  background: var(--palm-sur-2);
}

.tasks-dot {
  flex: none;
  inline-size: 8px;
  block-size: 8px;
  border-radius: 50%;
  background: var(--palm-fg-3);
}

/* 状态点：强调色 = 在跑，灰点 = 没在跑 —— 用户要一眼分出"哪个在动"和"哪个已经停了"。 */
.tasks-dot-live {
  background: var(--palm-accent);
}

.tasks-title {
  flex: 1 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  font-size: var(--palm-t-m);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 工作区位：任务页把几个工作区的在跑会话排在一起，标题旁边必须有一格说"这是谁的活"。
   只做提示，取宽度上限后省略 —— 它不该把标题挤成一条缝。 */
.tasks-where {
  flex: none;
  max-inline-size: 104px;
  overflow: hidden;
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tasks-meta {
  flex: none;
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  font-variant-numeric: tabular-nums;
}

.tasks-chev {
  flex: none;
  color: var(--palm-fg-3);
}

.tasks-actions {
  display: flex;
  gap: var(--palm-s2);
  padding: var(--palm-s3);
}

.tasks-clear {
  flex: 1;
  min-block-size: var(--palm-hit);
  border: 1px solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: none;
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-t-m);
}

.tasks-new {
  flex: 1;
  min-block-size: var(--palm-hit);
}
/* ── file preview sheet (in-chat .file-link taps) ─────────────────────── */

/* The preview content needs most of the sheet: keep the body roomy and let
   the pre scroll inside the sheet's own scroll container. */
.fp-body {
  margin: 0;
  padding: 4px 2px 12px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: var(--text-md);
  line-height: 1.7;
  color: var(--text-primary);
  white-space: pre;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  /* 文件预览正文允许选中复制：body 全局 user-select:none 只豁免输入框和
     消息正文，这里放开代码/纯文本预览，长按走系统选择复制。 */
  user-select: text;
  -webkit-user-select: text;
}

/* The Shiki <pre class="shiki"> inside .fp-body gets its own themed colors;
   strip default margins so it aligns with the plain-text fallback. */
.fp-body pre.shiki {
  margin: 0;
}

/* Markdown previews inside the sheet have no .chat-msg ancestor to inherit
   its 1.7 rhythm from — set the base here so prose, lists and code read the
   same as in the chat. */
.fp-md {
  line-height: 1.7;
  /* 同 .md-html：正文里的长 URL / 路径必须能断行，否则会被 .fp-scroll 裁掉。 */
  overflow-wrap: anywhere;
  /* 同 .fp-body：markdown 预览正文允许选中复制（body 全局 user-select:none
     不豁免这里，长按走系统选择复制）。 */
  user-select: text;
  -webkit-user-select: text;
}

/* Long plain/code/log previews fold like chat long-text: a bounded body
   with a soft fade and an 展开全部 toggle below. */
.fp-scroll {
  position: relative;
  overflow: hidden;
}

.fp-scroll-folded {
  max-height: 45vh;
  overflow-y: hidden;
}

.fp-scroll-folded::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 48px;
  background: linear-gradient(transparent, var(--bg-surface));
  pointer-events: none;
}

.fp-fold-btn {
  display: block;
  width: 100%;
  height: 36px;
  margin-top: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: var(--bg-elevated);
  color: var(--accent);
  font: inherit;
  font-size: var(--text-md);
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.fp-fold-btn:active {
  background: var(--fill);
}

.fp-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 2px 0 10px;
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: 10px;
}

.fp-path {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

.fp-copy {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.fp-copy svg {
  width: 14px;
  height: 14px;
}

.fp-loading,
.fp-error {
  padding: 24px 8px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--text-md);
}

.fp-error {
  color: var(--danger);
}

/* Sandboxed HTML preview: a white canvas keeps un-styled documents readable
   in both themes; the iframe scrolls inside the sheet like the code body. */
.fp-html {
  display: block;
  width: 100%;
  height: calc(100vh - 230px);
  min-height: 240px;
  border: none;
  border-radius: 8px;
  background: var(--palm-sur-1);
}

/* Local image preview inside the sheet: fit width, auto height, scrollable. */
.fp-image-wrap {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 4px 0 12px;
}

.fp-image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 8px;
}

/* ── full-screen image lightbox (in-chat <img> tap) ───────────────────── */

.lightbox-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-lightbox);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 与角标的 --palm-scrim（55%）同一族，这里是"整屏压暗"的强档。 */
  background: var(--palm-scrim-strong);
  -webkit-tap-highlight-color: transparent;
}

.lightbox-stage {
  max-width: 96vw;
  max-height: 88vh;
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}

.lightbox-img {
  display: block;
  max-width: 96vw;
  max-height: 86vh;
  object-fit: contain;
  user-select: none;
  -webkit-user-drag: none;
}

/* Full-size zoom: no fit constraint, the stage scrolls to pan. */
.lightbox-stage-full {
  max-height: 88vh;
}

.lightbox-stage-full .lightbox-img {
  max-width: none;
  max-height: none;
  width: auto;
  height: auto;
}

.lightbox-close {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 10px);
  right: 12px;
  z-index: 1;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: none;
  background: var(--palm-tint-accent);
  color: var(--palm-on-scrim);
}

.lightbox-close svg {
  width: 20px;
  height: 20px;
}

.lightbox-hint {
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 14px);
  left: 0;
  right: 0;
  text-align: center;
  font-size: 12px;
  color: var(--palm-on-scrim-soft);
  pointer-events: none;
}

.sheet-error {
  margin: 0 0 8px;
  color: var(--danger);
  font-size: 12.5px;
}

/* Sheet option rows: 52px, icon + text + right value.
 *
 * 2026-11-11 真机（newsprint 皮肤下的「更多」）：右边的值用了 --text-base（17px）
 * 和强调色，比左边 14px 的标题还大还艳 —— 一屏读下来，眼睛先落在「1 个文件」
 * 「Markdown」上，菜单反而成了配角。这里把主从关系摆正：
 *   标题 15px/500 主色 → 右侧值 13px/400 次要灰（数字等宽对齐）。
 */
.sheet-option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 50px;
  padding: 6px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, transform 0.1s ease;
}

.sheet-option:active {
  transform: scale(0.98);
  background: var(--fill);
}

.sheet-option-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.sheet-option:disabled {
  opacity: 0.5;
}

.sheet-option-divider {
  height: 1px;
  margin: 4px 12px;
  background: var(--border-subtle);
}

.sheet-note {
  margin: 0;
  padding: 12px 16px;
  color: var(--text-secondary);
  font-size: var(--text-md);
}

.sheet-option-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sheet-option-title {
  font-size: 15px;
  font-weight: 500;
  line-height: 1.25;
}

.sheet-option-desc {
  color: var(--palm-fg-3);
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: 1.4;
}

/* 右侧的值只是信息（几个文件、什么格式），不是动作也不是状态：
   比标题小两档、用次要灰，数字等宽避免逐行跳动。强调色留给真正的选中态
   （\`.sheet-option-selected\`）和危险项。 */
.sheet-option-check {
  flex: none;
  color: var(--palm-fg-3);
  font-size: 13px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.sheet-confirm-desc {
  margin: 0 4px 14px;
  color: var(--text-secondary);
  font-size: var(--text-md);
  line-height: 1.6;
}

/* 「关于」里检查更新旁边那颗仓库图标：与主按钮同高（44px）、同圆角，只占一颗方键的
   宽度，点一下直接开 GitHub 仓库。 */
.sheet-icon-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 44px;
  height: 44px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--card-bg);
  color: var(--text-secondary);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 0.1s ease, border-color 0.1s ease, color 0.1s ease;
}

.sheet-icon-link:active {
  background: var(--fill);
  border-color: var(--accent-soft);
  color: var(--text-primary);
}
.sheet-confirm-actions {
  display: flex;
  gap: 10px;
  padding: var(--space-1);
}

.sheet-confirm-actions .mobile-button {
  flex: 1;
  margin: 0;
}

.sheet-confirm-actions .mobile-button svg {
  width: 16px;
  height: 16px;
  margin-right: 6px;
  vertical-align: -2px;
}

.sheet-confirm-danger {
  flex: 1;
  height: 44px;
  border: none;
  border-radius: var(--radius-chip);
  background: var(--danger);
  color: var(--palm-on-scrim);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.1s ease, filter 0.1s ease;
}

.sheet-confirm-danger:active {
  transform: scale(0.98);
  filter: brightness(1.08);
}

.sheet-confirm-danger:disabled {
  opacity: 0.5;
  transform: none;
}

/* Primary action button (accent fill) inside sheets. */
.mobile-button-primary {
  border: none;
  /* 2026-11-10 纸色实拍：主按钮原来写死旧蓝（--accent 在两套主题里同值、换肤不变），
     整页暖白只剩它一颗蓝按钮。改走皮肤令牌。 */
  background: var(--palm-accent);
  color: var(--palm-on-accent);
}

.mobile-button-primary:active {
  background: var(--palm-accent);
  filter: brightness(1.08);
}

/* Voice service list rows inside the settings sheet. */
.voice-service-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 56px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.voice-service-row:last-child {
  border-bottom: none;
}

.voice-service-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.voice-service-name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-service-desc {
  color: var(--palm-fg-3);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-service-actions {
  flex: none;
  display: flex;
  gap: 2px;
}

.voice-service-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, transform 0.1s ease;
}

.voice-service-btn:active {
  transform: scale(0.94);
  background: var(--fill);
}

.voice-service-btn:disabled {
  opacity: 0.35;
  transform: none;
}

.voice-service-btn svg {
  width: 16px;
  height: 16px;
}

.voice-service-btn-down svg {
  transform: rotate(180deg);
}

.voice-service-btn-danger {
  color: var(--danger);
}

/* Voice service edit form. */
.voice-form {
  padding: 4px 16px 12px;
}

.voice-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.voice-form-label {
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
}

.voice-form-input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--card-bg);
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 0.12s ease;
}

.voice-form-input:focus {
  border-color: var(--accent);
}

.voice-form-input::placeholder {
  color: var(--palm-fg-3);
}

/* Paired-device management rows (settings → 设备管理). */
.device-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 60px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.device-row:last-child {
  border-bottom: none;
}

.device-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.device-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-badge {
  flex: none;
  font-size: 10.5px;
  font-weight: 600;
  line-height: 1;
  padding: 3px 6px;
  border-radius: var(--radius-chip);
}

.device-badge-primary {
  color: var(--accent);
  background: var(--palm-accent-16);
}

.device-badge-current {
  color: var(--text-secondary);
  background: var(--fill);
}

.device-desc {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--palm-fg-3);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-status {
  flex: none;
  color: var(--palm-fg-3);
}

.device-status-on {
  color: var(--positive);
}

.device-ua {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-actions {
  flex: none;
  display: flex;
  gap: 2px;
}

.device-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, transform 0.1s ease;
}

.device-btn:active {
  transform: scale(0.94);
  background: var(--fill);
}

.device-btn:disabled {
  opacity: 0.35;
  transform: none;
}

.device-btn svg {
  width: 16px;
  height: 16px;
}

.device-btn-danger {
  color: var(--danger);
}

/* ⋯ 菜单行左侧图标：跟标题同高、让出一点呼吸感，颜色压到次要灰 ——
   图标是路标，不是装饰，别和标题抢亮度。 */
.sheet-option > svg {
  flex: none;
  inline-size: 18px;
  block-size: 18px;
  color: var(--palm-fg-3);
}
/* ── centered confirm dialog ─────────────────────────────────────────── */

.dialog-backdrop {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-sheet);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: var(--backdrop);
  animation: sheet-fade 0.18s ease;
}

.dialog {
  width: min(100%, 340px);
  padding: var(--space-5);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-menu);
  background: var(--dialog-bg);
  box-shadow: var(--shadow-lg);
  animation: dialog-in 0.2s ease-out both;
  /* A dialog title can be a workspace name or a path: wrap it rather than
     letting it bleed past the fixed-width box. */
  overflow-wrap: anywhere;
}

@keyframes dialog-in {
  from {
    transform: scale(0.94);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

.dialog-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
}

.dialog-body {
  margin: 0 0 16px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.dialog-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

.dialog-btn {
  min-width: 72px;
  height: 44px;
  padding: 0 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.1s ease, background-color 0.1s ease;
}

.dialog-btn:active {
  transform: scale(0.98);
  background: var(--fill);
}

.dialog-btn:disabled {
  opacity: 0.5;
  transform: none;
}

.dialog-btn-primary {
  border: none;
  background: var(--accent);
  color: var(--accent-contrast);
}

.dialog-btn-primary:active {
  background: var(--accent);
  filter: brightness(1.08);
}

.dialog-btn-danger {
  border: none;
  background: var(--danger);
  color: var(--palm-on-accent);
}

.dialog-btn-danger:active {
  background: var(--danger);
  filter: brightness(1.08);
}

/* ≥16px: iOS zoom prevention on the prompt input. */
.dialog-input {
  width: 100%;
  height: 44px;
  margin: 0 0 16px;
  padding: 0 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.dialog-input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

/* ── toast ───────────────────────────────────────────────────────────── */

.toast-host {
  position: fixed;
  left: 0;
  right: 0;
  /* 不再写死 104px：输入栏高度会变（多行、附件、键盘），HUD（排队/目标/状态）
     又会在输入栏上方再叠一层。ChatView 用 --toast-lift 报告"输入栏 + HUD +
     键盘"的实际高度，toast 永远停在这整摞东西的上沿，不会盖住排队条的撤回。
     没有 JS（或别的页面）时退回旧值 104px。 */
  bottom: calc(var(--toast-lift) + env(safe-area-inset-bottom, 0px));
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  pointer-events: none;
}

/* 有 sheet / 对话框时把 toast 移到顶部：底部那条被遮罩挡住，而且会压住
   sheet 的主按钮（用户正在 sheet 里操作时最不该被挡）。:has 在目标浏览器
   （Chrome 105+/Safari 15.4+）都可用；不支持时退回底部旧行为。 */
body:has(.sheet-backdrop) .toast-host,
body:has(.dialog-backdrop) .toast-host {
  top: calc(64px + env(safe-area-inset-top, 0px));
  bottom: auto;
}

body:has(.lightbox-backdrop) .toast-host {
  display: none;
}

.toast {
  max-width: 78vw;
  padding: 9px 16px;
  border-radius: var(--radius-full);
  background: var(--toast-bg);
  color: var(--toast-text);
  font-size: var(--text-md);
  font-weight: 400;
  box-shadow: var(--shadow-lg);
  animation: toast-in 0.25s ease-out both;
  /* A toast prints a file path when a perf report is filed; the pill is capped
     at 78vw, so wrap the token instead of letting it bleed out both sides. */
  overflow-wrap: anywhere;
  min-width: 0;
}

.toast-out {
  animation: toast-out 0.2s ease both;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes toast-out {
  to {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
}/* ── focus rings ─────────────────────────────────────────────────────── */

.mobile-back:focus-visible, .mobile-iconbtn:focus-visible, .mobile-headerAction:focus-visible, .mobile-quickchip:focus-visible, .mobile-searchInput:focus-visible, .mobile-row:focus-visible, .mobile-createCard:focus-visible, .mobile-presetTrigger:focus-visible, .mobile-presetHelp:focus-visible, .mobile-button:focus-visible, .mobile-new:focus-visible, .settings-themeOption:focus-visible, .settings-optionChip:focus-visible, .settings-switch:focus-visible, .dialog-btn:focus-visible, .dialog-input:focus-visible, .chat-send:focus-visible, .chat-msg-toggle:focus-visible, .chat-load-older:focus-visible, .chat-disclosure-head:focus-visible, .chat-question-option:focus-within, .ctx-item:focus-visible, .sheet-option:focus-visible, .sheet-confirm-danger:focus-visible, .chat-input:focus-visible{
  outline: none;
  box-shadow: 0 0 0 2px var(--bg-page), 0 0 0 4px var(--accent);
}

/* ── installed-app pairing ───────────────────────────────────────────── */

.mobile-pair {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: var(--space-6);
}

.mobile-pairCard {
  display: grid;
  width: min(100%, 420px);
  gap: var(--space-3);
  padding: var(--space-6);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-card);
  background: var(--card-bg);
  box-shadow: var(--shadow-lg);
}

.mobile-pairLabel {
  color: var(--text-secondary);
  font-size: var(--text-md);
  font-weight: 500;
}

.mobile-pairInput {
  width: 100%;
  min-height: 48px;
  box-sizing: border-box;
  padding: 9px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  outline: none;
}

/* 提交中（readOnly）要看得出来改不了：只读在浏览器里没有外观变化，
   用户敲字没反应会以为输入框坏了。降一档透明度，和禁用按钮同一档。 */
.mobile-pairInput:read-only {
  opacity: var(--palm-btn-disabled-opacity);
}

.mobile-pairInput:focus-visible {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 2px var(--bg-page), 0 0 0 4px var(--accent);
}

/* 配对页的提交键：以前视觉全借抽屉的 .mobile-new，抽屉一改它就跟着变形。
   现在自己写完整一套（高度/圆角/底色/字色/字重/禁用与按下态），
   配色仍走皮肤令牌，不新增裸色。 */
.mobile-pairSubmit {
  width: 100%;
  margin: 0;
  block-size: var(--palm-hit);
  border: none;
  border-radius: var(--palm-r-m);
  background: var(--palm-accent);
  color: var(--palm-on-accent);
  font: inherit;
  font-size: var(--palm-t-l);
  font-weight: var(--palm-w-bold);
  cursor: pointer;
  transition: transform 0.1s ease, filter 0.1s ease;
}

.mobile-pairSubmit:active {
  transform: scale(var(--palm-btn-press-scale));
  filter: brightness(var(--palm-btn-press-dim));
}

.mobile-pairSubmit:disabled {
  opacity: var(--palm-btn-disabled-opacity);
  transform: none;
}

/* ── Mobile plugin market (MarketView) ───────────────────────────────── */

.market-row {
  /* No icon zone: text + install button. */
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.market-rowMain {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px 0;
}

.market-rowTitle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-primary);
  word-break: break-all;
}

.market-badge {
  flex: none;
  padding: 1px 8px;
  border-radius: var(--radius-chip);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: 400;
}

.market-rowDesc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 12.5px;
  line-height: 1.45;
  word-break: break-word;
}

.market-install {
  flex: none;
  min-width: 58px;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.12s ease, transform 0.1s ease;
}

.market-install:active {
  transform: scale(0.96);
}

.market-install:disabled {
  opacity: 0.45;
  cursor: default;
  transform: none;
}

.market-install:not(:disabled):active {
  background: var(--accent-soft);
}

/* ── reduced motion ──────────────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  .page-enter-fwd,
  .page-exit-fwd,
  .page-enter-back,
  .page-exit-back,
  .mobile-back,
  .mobile-iconbtn,
  .mobile-headerAction,
  .mobile-quickchip,
  .mobile-row,
  .mobile-createCard,
  .mobile-button,
  .mobile-button-muted,
  .mobile-new,
  .ctx-compact,
  .palm-drawer-new,
  .mobile-pairSubmit,
  .chat-question-submit,
  .chat-approval-allow,
  .chat-send,
  .chat-msg,
  .chat-msg-toggle,
  .chat-load-older,
  .chat-disclosure-head,
  .chat-disclosure-caret,
  .chat-disclosure-body,
  .boot-dot,
  .toast,
  .ctx-menu,
  .dialog,
  .sheet-backdrop,
  .sheet,
  .sheet-option,
  .sheet-confirm-danger,
  .settings-switch::after,
  .chat-input,
  .insert-bar,
  [data-insert-details],
  [data-insert-summary] > span:last-child,
  .settings-optionChip,
  /* 2026-11-10 全量对账补上的 13 个：跳转键、diff 两键、拒绝键、提问选项、
     停止键、语音服务、设备键、对话框键、市场安装、代码块缩放、语音波形。 */
  .chat-jump-latest,
  .chat-jump-turns,
  .diff-btn,
  .diff-confirm,
  .chat-approval-reject,
  .chat-question-option,
  .chat-stop-mini,
  .voice-service-btn,
  .device-btn,
  .dialog-btn,
  .market-install,
  .code-block pre,
  .voice-wave[data-live='1'] span,
  /* 2026-11-10 第二轮对账：animation 驱动的**装饰性**动效（骨架屏闪烁、进/出场、
     遮罩淡入淡出、定位高亮、轮次拖动条、语音面板滑入、波形）。表达状态的动画
     （转圈 spinner、运行中呼吸点、不确定进度条）不在这里，见测试里的白名单。 */
  .page-loading-rows span,
  .settings-skeleton,
  .chat-jump-latest-hot,
  .chat-msg:not(.chat-msg-no-enter),
  .code-fade,
  /* 2026-11-12 抽屉改成 iOS 那套（整块滑入 + 后面页面后退）：减弱动效时
     连"后退"的 transition 一起关掉，否则面板瞬间到位、后面的页面还在慢慢缩。 */
  .palm-drawer.is-closing,
  .palm-drawer-scrim.is-closing,
  /* 语音录音的红点脉冲是状态提示（"正在听"），关掉动画后人还是能看到红点本身。 */
  .chat-voice-dot,
  .chat-voice-dot[data-phase='transcribing'],
  .palm-drawer,
  .page-stage,
  .palm-drawer-scrim,
  .dialog-backdrop,
  .voice-backdrop,
  .voice-sheet,
  .voice-wave span,
  .voice-done,
  .toast-out,
  .finish-toast,
  .chat-quote-bar,
  .chat-reasoning-more,
  .chat-offline-banner,
  .chat-msg-focus,
  [data-locate-id][data-focus],
  .turn-scrub,
  .chat-status-strip-leaving,
  /* 2026-11-10 过程条的两处**装饰**动效：环弧慢转、展开逐行滑入。
     同批的「运行中呼吸点」是状态表达，留在测试白名单里 —— 它停下来，
     用户反而要靠猜才知道还在跑。 */
  .chat-proc-open .chat-step,
  .chat-proc-open .palm-proc-recent,
  .chat-cmdline-item[data-phase='in'],
  .chat-cmdline-item[data-phase='out'],
  /* 2026-11-11 计数滚动（过程条的「N 次工具调用 / 改 N 个文件」）：
     它是**装饰**，不是状态表达 —— 关掉动画的人应当立刻看到新数字，而不是等 480ms。 */
  .palm-roll-track,
  .palm-roll-track.is-gliding {
    animation: none;
    transition: none;
  }

  /* 定位高亮原来**只有**一段脉冲动画：动画一停，用户按了"跳到这一条"却看不出跳到哪。
     这不是动画取舍，是功能缺口。减弱动效下改成静态标记。
     两处**分开写**：聊天消息本身没有边框，整圈描边一眼就能看见；
     设置页每行本来就有 1px 描边，再套一圈同样的等于没标记（实拍确认），改用左侧竖条。 */
  .chat-msg-focus {
    background: var(--palm-tint-accent);
    box-shadow: inset 0 0 0 var(--palm-focus) var(--palm-accent);
  }

  [data-locate-id][data-focus] {
    background: var(--palm-tint-accent);
    box-shadow: inset var(--palm-focus) 0 0 var(--palm-accent);
  }

  /* 语音条与命令条的入场动画是**装饰**（从下往上淡入），不是状态：开了减弱动效
     就不该再滑。它们不表达「还在跑」，所以不能进 statefulMotion 白名单。 */
  .chat-voice-live,
  .chat-command-bar {
    animation: none;
  }

  /* 会话动作面板的升起与遮罩淡入同样是装饰：减弱动效下直接出现，
     面板本身的位置和内容不变。 */
  .palm-actions-scrim,
  .palm-actions-layer {
    animation: none;
  }

  /* Nothing animates in this branch, so there is no transition to watch: drop
     the stacked leaving page instead of keeping it mounted. It is an opaque,
     absolutely positioned full-stage overlay, so leaving it in the tree hid the
     entering page for the whole 260ms window and then popped it into view when
     it unmounted - reported from iOS Safari with Reduce Motion on (#10). */
  .page-exit-fwd,
  .page-exit-back {
    display: none;
  }
}
/* ── v2.1 increments: workspace tints / search morph / status semantics ──
   / previews / reasoning clamp / quote bar / quick commands /
   voice sheet / offline banner / settings feedback. Appended after the base
   system so the established spec stays untouched. */

/* Plain folder (workspace without sessions): gray tile. */

/* Empty-group placeholder card (72px tier, centered copy + 创建). */

/* Session-list header search morph (200ms) + its input. */

@keyframes search-morph {
  from {
    opacity: 0;
    transform: scaleX(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* Session status semantics: running pulse + label, settled check. */

/* Reasoning clamp expander. */
.chat-reasoning-more {
  display: block;
  width: 100%;
  border: none;
  border-top: 1px dashed var(--border-subtle);
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  padding: 7px 12px;
  text-align: center;
  cursor: pointer;
}

.chat-reasoning-more:active {
  background: var(--fill);
}

/* Code pre keeps pinch-zoom transforms contained. */
.code-block pre {
  transition: transform 0.05s linear;
  will-change: transform;
}

/* Message footer: the timestamp line. */
.chat-msg-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.chat-msg-footer .chat-msg-time {
  flex: 1;
}

/* Pending-message queue dock (desktop QueueDock equivalent): the messages
   queued while the current turn runs, floating above the model/permission row
   — outside the composer box, so it reads as "what goes out next" rather than
   as a part of the input field. */
.queue-dock {
  flex: none;
  /* 宽度跟内容走时，三个按钮一撑就接近满宽，右边却仍按内容截断，于是这条和
     下面的目标条/输入框左右都不齐（真机："布局怎么这么奇怪"）。现在它自己占满
     可用宽度（与目标条同宽），文字左齐、按钮右齐，上下都是一条整齐的边。 */
  align-self: stretch;
  margin: 0 12px 4px;
  /* 用户连着两轮说"还是太高"：外层 8→6→4px、行内 6→0、按钮 44→30px，
     整条从 62px 压到 40px。左右仍留 12px，文字不贴自己的边框。 */
  padding: 2px 10px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--bg-elevated);
}
/* 头行（2026-11-10 方案 A）：左边「N 条排队 + 什么时候执行」，右边主操作与 ⋯。
   以前这一行是折叠按钮，多条时要先点一下才看得见内容 —— 排队这种「等着发出去」
   的东西，顺序和内容必须一眼可见。 */
.queue-dockHead {
  display: flex;
  align-items: center;
  gap: var(--palm-s1);
  width: 100%;
  /* 2026-11-10 用户：「面板高度太高」。头行 44 → 32，行高 44 → 32，
     再把面板内边距与列表间距各收一档 —— 一条排队从 ~190px 压到 ~120px。 */
  min-height: var(--palm-queue-row-h);
  padding: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 600;
}

/* 「当前任务结束后执行」是说明，不是标题：更淡、可以省略。 */
.queue-dockHint {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
  font-weight: 400;
}
/* 计数同时是折叠开关（2026-11-10）：超过 1 条默认收起，点它展开。 */
.queue-dockCount {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--palm-s1);
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
  cursor: pointer;
}

/* 箭头跟着文字走（\`.palm-proc-caret\` 默认 auto 会把它推到行尾）。 */
.queue-dockCount .palm-proc-caret {
  margin-inline-start: 0;
}
.queue-dockList {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s1);
  margin: var(--palm-s1) 0 0;
  padding: 0;
  list-style: none;
  /* 2026-11-10：每行换行后变两行，列表再没有上限就会一路往上吃掉正文。
     封顶到视口的三分之一左右，多出来的条目在列表内滚动。 */
  max-block-size: 32vh;
  overflow-y: auto;
}
.queue-dockRow {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  /* 行内再铺一层不同的底色就等于"卡片套卡片"。整条只留外层底板，行本身透明。 */
  padding: 0;
  background: transparent;
}

/* 「已插入本轮」那一行：同一条卡片的最后一行，用虚线跟排队项分开。 */
.queue-dock > .insert-bar {
  margin: 0;
  border-top: 1px dashed var(--palm-line);
  padding-top: 2px;
}
/* 正文是**按钮**（点它打开这张卡的动作表），但要长得像文字。 */
.queue-dockText {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  /* 视觉 32（用户嫌高），命中区仍 44：用伪元素纵向补，不占布局。 */
  min-height: var(--palm-queue-row-h);
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
  text-align: start;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-dockText::after {
  content: '';
  position: absolute;
  inset-block: calc(var(--palm-queue-row-hit) * -1);
  inset-inline: 0;
}

/* 每行右侧的删除（×）：比一行四个按钮里的「删除」更小的误点面，但它只做一件事。 */
/* 行内两个小控件（⋯ / ×）：视觉小，命中区用定位撑到 44×44。 */
.queue-dockX {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  min-height: 30px;
  padding: 0;
  border: 0;
  border-radius: var(--palm-r-full);
  background: none;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.queue-dockX::after {
  content: '';
  position: absolute;
  inset: -7px;
}
.queue-dockActions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  /* 删除与插话相邻，误删不可撤销：间距 8 起步，命中区靠两颗按钮各自补。 */
  gap: var(--palm-s2);
}

.queue-dockBtn {
  flex: none;
  /* 2026-11-10（第二次）：用户「看着太大了，不协调，要排版对齐」。
     两颗按钮统一 26 高、同一圆角、同一字号，在 32 高的头行里上下居中；
     ⋯ 不再是 44 宽的胶囊（看着像大药丸），而是 26×26 的圆。
     命中区仍由 ::after 上下各补 9 撑到 44。 */
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: var(--palm-queue-btn-h);
  min-inline-size: var(--palm-queue-btn-h);
  padding: 0 var(--palm-s2);
  line-height: 1;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-full);
  background: transparent;
  color: var(--palm-fg-3);
  font-size: var(--text-xs);
}
.queue-dockBtn-primary {
  /* 主操作要在一行里被一眼认出来：实心强调色，不再是和编辑/删除同款的描边。
     2026-11-10：原来写 var(--accent, #4f7cff) + color: #fff —— 兜底字面色 + 裸白，
     正好绕开 skin-contrast 量过的 --palm-on-accent。换成皮肤令牌。 */
  display: inline-flex;
  align-items: center;
  gap: var(--palm-s1);
  border-color: transparent;
  background: var(--palm-accent);
  color: var(--palm-on-accent);
  font-weight: 600;
}
.queue-dockBtn::after {
  content: '';
  position: absolute;
  inset-block: calc(var(--palm-queue-btn-hit) * -1);
  inset-inline: 0;
}

.queue-dockBtn:disabled {
  opacity: var(--palm-btn-disabled-opacity);
}
/*
 * 排队条 · 编辑态（2026-11-12 用户：点编辑之后「展示样式太丑」）。
 *
 * 旧版两个毛病，都在真机截图里：
 * ① 输入框写的是 \`--border-default\` / \`--bg-elevated\` 这类旧 token —— 报纸皮肤里没有定义，
 *    整条 \`border\` 失效，于是落回浏览器默认的粗黑 3D 框，跟整页一点都不搭；
 * ② 「保存」借了 sheet 里的整行菜单类 \`.sheet-option\`，没有按钮外形，就是两坨裸文字。
 * 现在：输入框走皮肤令牌（细描边 + 浅底 + 圆角，聚焦时描边换成强调色），
 * 动作另起一行右对齐：取消是描边、保存是实心，和页面里其他主/次按钮同一套语言。
 */
.queue-dockEdit {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  inline-size: 100%;
}

.queue-dockInput {
  inline-size: 100%;
  min-block-size: var(--palm-hit);
  padding: 8px 12px;
  border: 1px solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  color: var(--palm-fg);
  font: inherit;
  /* 必须 ≥16px：iOS Safari 里输入框字号小于 16px 会在聚焦时自动放大整个页面。
     \`--palm-t-m\` 是 14px，所以这里写死，别改成令牌。 */
  font-size: 16px;
  -webkit-tap-highlight-color: transparent;
}

.queue-dockInput:focus {
  border-color: var(--palm-accent);
  outline: 2px solid transparent;
  outline-offset: 2px;
}

.queue-dockEditActions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--palm-s2);
}

.queue-dockEditCancel,
.queue-dockEditSave {
  min-inline-size: 76px;
  min-block-size: calc(var(--palm-hit) - 2px);
  border-radius: var(--palm-r-m);
  font: inherit;
  font-size: var(--palm-t-m);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.queue-dockEditCancel {
  border: 1px solid var(--palm-line);
  background: transparent;
  color: var(--palm-fg-2);
}

.queue-dockEditSave {
  border: 0;
  background: var(--palm-accent);
  color: var(--palm-on-accent);
}

.queue-dockEditCancel:active,
.queue-dockEditSave:active {
  opacity: 0.82;
}

.queue-dockEditSave:disabled {
  opacity: var(--palm-btn-disabled-opacity);
}

/* 连接提示：会话页顶部一行（展开 ≤28px），在内容区之上、顶栏之下。
   不是 toast：不悬浮、不盖内容；节点常驻 DOM，收起走 data-state（0 高 + 透明），
   所以恢复后「已重连」能自己淡出，不会把下面的内容顶一下再落回来。 */
.chat-offline-banner {
  flex: none;
  display: flex;
  align-items: center;
  overflow: hidden;
  block-size: var(--palm-offline-h);
  padding-inline: var(--palm-s3);
  /* 2026-11-10 对照三方案后定：--palm-tint-warn（10~12%）几乎看不出"带子到哪儿为止"，
     只剩一行黄字飘在顶上。改用 --palm-warn-band（24% 的普通 rgba）：
     断线是全屏状态，本来就该整宽，而不是角落标记（那样会和定位/插话的竖条混）。 */
  background: var(--palm-warn-band);
  /* 带子加深到 24% 后，"琥珀字 + 琥珀带"在纸色皮肤上只有 4.04:1（低于 AA）。
     带子本身已经说明"这是警告"，文字改回正文色（三套皮肤都 ≥ 10:1）。 */
  color: var(--palm-fg);
  font-size: var(--palm-offline-size);
  white-space: nowrap;
  transition:
    block-size var(--palm-offline-dur) ease,
    opacity var(--palm-offline-dur) ease;
}

.chat-offline-banner[data-state='gone'] {
  block-size: 0;
  opacity: 0;
}

/* 已重连：退成灰字、不底色（成功不抢眼，它只说明「刚才断过」）。 */
.chat-offline-banner[data-state='back'] {
  background: transparent;
  color: var(--palm-fg-3);
}

/* Quote bar above the composer (3px accent rail, first 20 chars). */
.chat-quote-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 40px;
  margin: 0 0 6px;
  padding: 6px 10px;
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-chip);
  background: var(--bg-elevated);
  animation: quote-in 0.18s ease both;
}

@keyframes quote-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* 已认领命令（桌面端 composer 里那颗 chip）：命令词一块醒目底色，参数在输入框里。
   *
   * 2026-11-12 用户：「输入框加入斜杠命令之后，排版很奇怪」。之前 chip 和 textarea 在
   * 同一个 flex 行里并排，chip 占掉宽度 → 输入框只剩几十像素 → 占位符被压成竖排、
   * 整个框跟着长高。现在 chip 自己占一行（\`.chat-command-bar\`），输入框永远是整行宽。 */
.chat-command-bar {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  margin: 0 0 6px;
  padding: 2px 2px;
  min-height: 32px;
  animation: quote-in 0.18s ease both;
}

.chat-command-chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 60%;
  padding: 3px 4px 3px 9px;
  border-radius: calc(var(--radius-chip) + 4px);
  background: var(--palm-accent-16);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.3;
}

/* chip 右边那句参数提示：轻一点，只是"这里该填什么"，不抢命令本身。 */
.chat-command-hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--palm-fg-3);
}

.chat-command-chipText {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-dockText::after {
  content: '';
  position: absolute;
  inset-block: calc(var(--palm-queue-row-hit) * -1);
  inset-inline: 0;
}

.chat-command-chipClose {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  opacity: 0.75;
}
.chat-quote-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: var(--text-md);
}

.chat-quote-close {
  flex: none;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.chat-quote-close:active {
  background: var(--fill);
}

/* Voice recording sheet: 200px, waveform bars, live transcript. */
.voice-backdrop {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-voice);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: var(--backdrop);
  animation: sheet-fade 0.18s ease;
}

/* 面板底部两个动作：取消在左、完成在右，取消是明确的可退出路径（以前只能点背景）。
   注释里不用反引号和模板占位符，样式文件里那些字符会破坏模板字符串。 */
.voice-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

/* 录音面板的两颗键：几何（高度/圆角/字号）全部走令牌，颜色走皮肤令牌。
   2026-11-10：原来写死 44px / 999px / 15px，并用旧名 --border-default / --bg-elevated /
   --text-secondary —— 改一次触控下限或换皮肤就得回来对一遍。 */
.voice-cancel {
  min-width: 96px;
  height: var(--palm-hit);
  border-radius: var(--palm-r-full);
  border: var(--palm-hair) solid var(--palm-line);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
  font-size: var(--palm-t-l);
}

.voice-sheet {
  height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  background: var(--bg-surface);
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
  animation: sheet-up 0.3s ease-out both;
}

/* 录音快到 60 秒上限时的提醒：只变颜色和字重，不改字号（避免面板跳动）。
   2026-11-10 真 DOM 实拍：原来和「正在录音」同为 --accent，只多一档字重，等于没提醒；
   改成警示色（语义令牌 --palm-warn）。**必须用复合选择器**：.voice-text 在文件里
   排在后面且同特异性，单写 .voice-text-warn 会被它的颜色盖掉（第一次改就是这样
   静默失效的，截图逐字节一致才发现）。
   注意：CSS 注释里不能出现反引号，生成器把它当模板字符串的结束符，整份样式会变成数字。 */
.voice-text.voice-text-warn {
  color: var(--palm-warn);
  font-weight: 600;
}
/* 实时字幕：说完一句就换一行，最多三行（再多会把录音按钮挤出屏幕）。 */
.voice-text.voice-text-live {
  /* 复合选择器是必须的：voice-text 是给"说一句话"的状态行写的（居中、单行、省略号），
     两者同特异性且它在后，单写 voice-text-live 会被它的 nowrap 吃掉，字幕只剩一行被截断。 */
  white-space: normal;
  text-overflow: clip;
  overflow: visible;
  text-align: left;
  max-height: 4.6em;
  overflow-y: auto;
  overflow-wrap: anywhere;
  -webkit-overflow-scrolling: touch;
}

.voice-wave {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 44px;
}

.voice-wave span {
  width: 5px;
  height: 22px;
  border-radius: var(--radius-full);
  background: var(--accent);
  animation: voice-bar 1s ease-in-out infinite;
}

/* 有实时响度时：停掉固定动画，柱高跟着 --voice-level 走（每根柱子乘一个固定系数，
   看起来才像波形而不是一条线）。拿不到响度时保持原来的动画。 */
.voice-wave[data-live='1'] span {
  animation: none;
  transform: scaleY(calc((0.18 + var(--voice-level, 0.5) * 1.2) * var(--m, 1)));
  transition: transform 0.1s linear;
}

.voice-wave span:nth-child(1) { --m: 0.8; animation-delay: 0s; }
.voice-wave span:nth-child(2) { --m: 1.15; animation-delay: 0.12s; }
.voice-wave span:nth-child(3) { --m: 1.3; animation-delay: 0.24s; }
.voice-wave span:nth-child(4) { --m: 1.05; animation-delay: 0.36s; }
.voice-wave span:nth-child(5) { --m: 0.7; animation-delay: 0.48s; }

@keyframes voice-bar {
  0%, 100% {
    transform: scaleY(0.35);
    opacity: 0.5;
  }
  50% {
    transform: scaleY(1.25);
    opacity: 1;
  }
}

.voice-text {
  max-width: 82vw;
  min-height: 22px;
  color: var(--accent);
  font-size: 14px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-dockText::after {
  content: '';
  position: absolute;
  inset-block: calc(var(--palm-queue-row-hit) * -1);
  inset-inline: 0;
}

.voice-done {
  /* 44px 是拇指能稳稳按到的下限；40px 在真机上要低头瞄准，而且这是录音结束时唯一的出口。 */
  height: var(--palm-hit);
  padding: 0 24px;
  border: none;
  border-radius: var(--palm-r-full);
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  font-size: var(--palm-t-m);
  font-weight: 500;
  cursor: pointer;
}

.voice-done:active {
  transform: scale(var(--palm-btn-press-scale));
  filter: brightness(var(--palm-btn-press-dim));
}

/* 转写中：这个按钮 disabled、文案变「请稍候」，但它原来**没有任何禁用态**——
   实心强调色、看着完全能点，用户会反复戳一个不会响应的地方。 */
.voice-done:disabled {
  opacity: var(--palm-btn-disabled-opacity);
  cursor: default;
  transform: none;
  filter: none;
}

/* Settings search field. */
/* Toggle knob spring (overshoot then settle, 200ms). */
.settings-switch::after{
  transition: transform 0.2s cubic-bezier(0.34, 1.8, 0.64, 1);
}

/* Tapped setting row flashes the elevated wash (100ms). */
button.settings-row {
  transition: background-color 0.1s ease;
}

button.settings-row:active {
  background: var(--bg-elevated) !important;
}

/* ── 会话行状态胶囊与计数（定版图：绿=进行中 / 琥珀=待确认 / 红=出错 / 蓝=新）──
   18px 高、12px 字、全圆角：三行卡里它只是第二行的一个小标签，不许抢标题。
   底色取 --palm-tint-*（与四态色同源），深色/纸/夜航三套皮肤都自动跟着走。 */

/* ── 状态条（主条 + 迷你条 + 方案 A 刻度轨）────────────────────
 *
 * 版式真源：docs/prototype/pet-strip-v5.html ①（主条高度 / 圆角 / 渐变填充 /
 * 内联宠物 / 白色暗阴影文字 / 右侧等宽数字全部走 --palm-strip-* 令牌），
 * 2026-11-09 真机偏大：主条 32 → 28、圆角 11 → 10、宠物 20 → 18、主文案 11px。
 * 迷你条（132×22）不动 —— 它是抽屉行里的第二类用法。
 * 刻度轨用方案 A：条下方一条细轨，完成绿、当前蓝、未做灰。
 * overview.html「2 · 会话正文」里那条是同一个东西的成品态。
 *
 * 规则：
 * 1. 11 种状态只换 --palm-strip-current（渐变）与宠物墨色，不新增状态类名；
 * 2. 进度不写行内样式（CSP 与 inlineStyles 预算都拦）：data-fill 落在 5% 档位；
 * 3. 进度未知时用「游走块」，prefers-reduced-motion 下退回静止块；
 * 4. 迷你版同一组件（data-size='mini'），只是去掉副文案/右侧/刻度轨。
 */

.palm-strip-wrap {
  display: flex;
  flex-direction: column;
  /* 平铺一行之后不再有刻度轨，条与轨之间那道 5px 缝一起下线。 */
  min-inline-size: 0;
}

/* 可点时的触控区：视觉高度不变，外层撑到 --palm-hit。 */
.palm-strip-wrap[role='button'] {
  justify-content: center;
  min-block-size: var(--palm-hit);
  cursor: pointer;
}

.palm-strip-wrap[role='button']:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: var(--palm-hair);
}

.palm-strip-wrap[data-size='mini'] {
  flex: none;
  inline-size: var(--palm-strip-mini-w);
}

/*
 * 状态栏（2026-11-10 第三版）：**平铺一行**，不是胶囊。
 * 用户口径：「不要状态条和滑动条，只有一个状态栏，平铺显示」。
 * 所以这里没有底色块、没有描边、没有填充、没有刻度轨 —— 只剩
 * 「鲸尾 + 文案 + 时间」，靠留白与正文分开；进度只由过程条的点阵表达。
 */
.palm-strip {
  display: flex;
  align-items: center;
  min-inline-size: 0;
  border: 0;
  background: none;
  /* 平铺后不再有深色底衬，字色必须回到皮肤本身的前景三档；
     原来那套"白字 + 暗描影"只对深色渐变成立，放在纸色上就是灰糊。 */
  --palm-strip-fg: var(--palm-fg);
  --palm-strip-detail-fg: var(--palm-fg-2);
  --palm-strip-right-fg: var(--palm-fg-3);
  --palm-strip-text-shadow: none;
}
/* 一行内容：宠物 + 主文案 + 可选小灰字 + 右侧时间。 */
.palm-strip-body {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  inline-size: 100%;
  min-inline-size: 0;
  padding-inline: var(--palm-strip-pad);
}


.palm-strip [data-part='main'] {
  display: flex;
  flex: 1 1 auto;
  align-items: baseline;
  gap: var(--palm-s1);
  min-inline-size: 0;
}

.palm-strip [data-part='label'] {
  overflow: hidden;
  color: var(--palm-strip-fg);
  font-size: var(--palm-strip-size);
  font-weight: var(--palm-w-bold);
  line-height: var(--palm-lh-head);
  text-overflow: ellipsis;
  text-shadow: var(--palm-strip-text-shadow);
  white-space: nowrap;
}

.queue-dockText::after {
  content: '';
  position: absolute;
  inset-block: calc(var(--palm-queue-row-hit) * -1);
  inset-inline: 0;
}

.palm-strip [data-part='detail'] {
  overflow: hidden;
  min-inline-size: 0;
  color: var(--palm-strip-detail-fg);
  font-size: var(--palm-strip-detail-size);
  font-weight: var(--palm-w-normal);
  text-overflow: ellipsis;
  text-shadow: var(--palm-strip-text-shadow);
  white-space: nowrap;
}

.queue-dockText::after {
  content: '';
  position: absolute;
  inset-block: calc(var(--palm-queue-row-hit) * -1);
  inset-inline: 0;
}

/* 右侧（耗时 / 等你 42s）：等宽数字，别让数字跳宽。 */
.palm-strip [data-part='right'] {
  flex: none;
  color: var(--palm-strip-right-fg);
  font-size: var(--palm-strip-right-size);
  font-variant-numeric: tabular-nums;
  text-shadow: var(--palm-strip-text-shadow);
  white-space: nowrap;
}

.queue-dockText::after {
  content: '';
  position: absolute;
  inset-block: calc(var(--palm-queue-row-hit) * -1);
  inset-inline: 0;
}

/* 迷你版：132×22 / 圆角 8，用于抽屉列表行（同一组件，只换尺寸）。 */
.palm-strip[data-size='mini'] {
  flex: none;
  inline-size: var(--palm-strip-mini-w);
  block-size: var(--palm-strip-mini-h);
  border-radius: var(--palm-strip-mini-r);
}

.palm-strip[data-size='mini'] .palm-strip-body {
  gap: var(--palm-s1);
  padding-inline: var(--palm-s1);
}

/* 迷你条不跟着主条缩字：132×22 是抽屉行里的第二类用法，12px 是它可读的下限。 */
.palm-strip[data-size='mini'] [data-part='label'] {
  font-size: var(--palm-t-s);
}

/* 尾鳍：16×16 的盒子，里面两层（动画 PNG / 静止 SVG）。 */
.palm-strip-pet {
  position: relative;
  display: block;
  flex: none;
  inline-size: 15px;
  block-size: 15px;
  color: inherit;
}

.palm-strip-whale-still {
  display: block;
  inline-size: 100%;
  block-size: 100%;
}

.palm-strip-whale-loop { display: none; }

/*
 * 活的鲸尾：/m/running-whale.png（v1.7.1 起桌面端在放的那张逐帧动画 PNG），
 * 以 currentColor 当底色做 alpha 蒙版 —— 形状随状态色走。只在支持蒙版、且用户
 * 没开「减弱动态效果」时播放；否则由上面那层静止 SVG 兜底。
 * 手写路径动画到不了这个质感（1.7.0 试过旋转/拆叶/改路径，仍是"两片叶在转"）。
 */
@supports (mask-mode: alpha) and (mask-image: url('')) {
  @media (prefers-reduced-motion: no-preference) and (forced-colors: none) {
    .palm-strip-whale-loop {
      display: block;
      position: absolute;
      inset: 0;
      background: currentColor;
      mask: url('/m/running-whale.png') center / 100% 100% no-repeat;
      mask-mode: alpha;
      will-change: transform;
    }

    .palm-strip-whale-still { display: none; }
  }
}
.palm-strip[data-size='mini'] .palm-strip-pet {
  inline-size: var(--palm-strip-pet-mini);
  block-size: var(--palm-strip-pet-mini);
}

/* ── 会话正文流：任务头（目标 / 状态条 / 元信息） ─────────────────────────
   版式真源：overview.html「2 · 会话正文」；delivery-card.html A 图的 .thead。
   三行固定顺序：①目标（15px/600）②状态条 ③弱化元信息行。
   状态词与计时**只在状态条**：顶部那条「状态点 + 状态词 + N 步 / M 步 + 耗时」
   已删除（真机一屏因此有两个状态词、四条计时）。
   2026-11-09 随 28px 状态条收窄：行间 gap 8 → 6、上下内边距 4/12 → 2/10
   （全部走 --palm-turn-* 令牌）；目标行仍 15px，元信息 10.5 → 10。 */
.palm-turn-head {
  display: flex;
  flex-direction: column;
  gap: var(--palm-turn-gap);
  padding-block: var(--palm-turn-pad-t) var(--palm-turn-pad-b);
}

/*
 * 目标行是**次级标签**，不是第二个标题（2026-11-10 整屏实拍）：原来与正文同字号
 * （15px）近白色加粗，一屏里出现两个"标题"。现在降一档字号与颜色，高度契约不变
 * （骨架与真实头同高，见 --palm-turn-goal-h）。
 *
 * 2026-11-10 重设计：降字号之后它又"消失"了 —— 一整屏看不出这段属于哪一轮。
 * 用**左侧竖条 + 正文色**重新把它立起来，但**不加字号**（避免又变成第二个标题）：
 * 竖条是"这一段的锚点"，字号仍是次级。 */
.palm-turn-goal {
  margin: 0;
  min-block-size: var(--palm-turn-goal-h);
  padding-inline-start: var(--palm-s3);
  border-inline-start: 3px solid var(--palm-accent);
  color: var(--palm-fg);
  font-size: var(--palm-flow-title-size);
  font-weight: var(--palm-w-bold);
  line-height: var(--palm-lh-head);
  letter-spacing: 0.01em;
}

/* 元信息（改几个文件 / 多少测试）：原来 10px + 三级灰，属于典型的低对比辅助文字。
   抬到辅助层字号与二级前景色，仍比正文低一档，但不需要眯眼。 */
.palm-turn-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--palm-s1);
  font-size: var(--palm-flow-meta-size);
  color: var(--palm-fg-2);
}

/* ── 过程折叠行：「▸ 12 次工具调用 · 2 处报错」 ─────────────────────────
   整行是一条 44px 触控带；展开状态与展开/收起回调由既有过程组持有，
   这里只画，不新建状态。运行中在下方追加「最近 3 步」。
   计数之外不再报状态词与耗时：那两样全页只在任务头状态条。 */
/* 过程折叠行：静态摘要 24 高 / 11 号字，可点击摘要实体占位 44px。 */
.palm-proc {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--palm-s2);
  inline-size: 100%;
  min-block-size: var(--palm-proc-head-h);
  /* 2026-11-10 重设计：折叠行从「一行灰字」变成一条窄条（--palm-sur-1 + hairline +
     圆角），和上面的目标行、下面的正文分开层次。可点与静态两种用同一条外观 ——
     同一个位置不该有两种样子。 */
  padding: 6px var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-s);
  background: var(--palm-sur-1);
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-proc-head-size);
  text-align: start;
}

button.palm-proc {
  min-block-size: var(--palm-hit);
  cursor: pointer;
}

button.palm-proc:active { opacity: 0.72; }

button.palm-proc:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: 2px;
}

/* 2026-11-10 重设计：折叠行的三件套 —— 左状态点、中文字、右箭头。
   箭头挪到最右（通用"展开"位置），状态点在最左（这一行代表哪段过程）。 */
.palm-proc-caret {
  flex: none;
  margin-inline-start: auto;
  color: var(--palm-fg-3);
  font-size: var(--palm-flow-meta-size);
}

/* 状态点：颜色只做强化，含义由文字给（读屏读的是 aria-label）。 */
.palm-proc-dot {
  flex: none;
  inline-size: 7px;
  block-size: 7px;
  border-radius: 50%;
  background: var(--palm-fg-3);
}

.palm-proc-dot[data-state='ok'] { background: var(--palm-ok); }
.palm-proc-dot[data-state='running'] { background: var(--palm-accent); }
.palm-proc-dot[data-state='failed'],
.palm-proc-dot[data-state='error'] { background: var(--palm-danger); }
.palm-proc-dot[data-state='stopped'] { background: var(--palm-warn); }

.palm-proc-main { color: var(--palm-fg-2); }

/* 没有权威结论：计数/「—」退到第三档灰（状态词与耗时本来就不出现）。 */
.palm-proc[data-state='unknown'] .palm-proc-main { color: var(--palm-proc-unknown); }

/* 「2 处报错」从裸黄字改成小胶囊：这是**要你注意**的信息，得有一块自己的底。 */
.palm-proc-note {
  padding: 1px var(--palm-s2);
  border-radius: var(--palm-r-s);
  background: var(--palm-tint-warn);
  color: var(--palm-warn);
  font-size: var(--palm-flow-meta-size);
}

/* 「改 N 个文件」：这一轮的产出量，和「N 次工具调用 · M 处报错」同一行之下的第二类计数。
   2026-11-10 从任务头状态条灰字搬来（用户要求），所以这里必须是**安静**的一档灰。 */
.palm-proc-files {
  flex: none;
  color: var(--palm-fg-3);
  font-size: var(--palm-flow-meta-size);
}

/*
 * 计数滚动（2026-11-11 用户二次拍板：**要数字滚动的动效，不要牌面**）。
 *
 * 没有底板、没有边框、没有中缝：数字就是普通文字，继承颜色/字号/字重。
 * 变化的那一位是一个竖直滚轮：轨道里排着 0-9 两遍，向上滚过中间那些数字，
 * 停在新的那位上（3 → 7 会真的滚过 4、5、6）。静止时与普通文字完全一致。
 */
/*
 * 一位数字的窗口：高度 = 一格，滚出窗口的部分裁掉（裁的是轨道，不是字形）。
 *
 * 2026-11-11 用户：「数字和后面的文字没有水平对齐」。
 *
 * 根因是 overflow: hidden —— 按 CSS 2.1，**overflow 不是 visible 的 inline-block，
 * 基线取盒子底边**（不是里面文字的基线）。数字因此被顶高，只能靠 vertical-align 猜一个
 * em 值去补；而 em 值依赖字体度量，桌面调好了、手机字体不同又歪。
 *
 * 改用 clip-path: inset(0) 裁切：它不改变基线，这一格就按普通文字的规矩对齐 ——
 * 数字的基线 = 格子文字的基线 = 正文基线（换字体、换字号都不跑）。
 */
.palm-roll {
  --palm-roll-h: 1.25em;
  display: inline-block;
  block-size: var(--palm-roll-h);
  line-height: var(--palm-roll-h);
  clip-path: inset(0);
  vertical-align: baseline;
}

.palm-roll-track {
  display: flex;
  flex-direction: column;
  /* 位移由组件写成行内 transform（见 ui/flip-number.tsx），这里只管轨道排版。 */
}

/* 只有正在滚的那一位加过渡：静止的数字连 will-change 都不占。 */
.palm-roll-track.is-gliding {
  transition: transform 480ms cubic-bezier(0.2, 0.9, 0.25, 1);
  will-change: transform;
}

.palm-roll-cell {
  display: block;
  height: var(--palm-roll-h);
  line-height: var(--palm-roll-h);
  font-variant-numeric: tabular-nums;
}


/*
 * 折叠态「当前命令」：**固定高度的一行**，位置与高度都不随内容变化。
 * 2026-11-10 第二次投诉后的定案：原来折叠时把每个活动工具行都铺在过程条下面，
 * 第 8 条一来列表就长高 18px，整块被顶下去（"跳来跳去"）。
 * 现在只留一行，换命令时旧文案淡出（上移 3px）、新文案淡入（下移 3px），320ms。
 */
.chat-cmdline {
  display: flex;
  align-items: center;
  gap: var(--palm-s1);
  block-size: 20px;
  margin: 2px 0 0;
  overflow: hidden;
  font-size: var(--palm-flow-meta-size);
  color: var(--palm-fg-2);
}

/* 左侧一道细竖线：标出"这是当前动作"，比整行高亮稳。 */
.chat-cmdline-mark {
  flex: none;
  inline-size: 2px;
  block-size: 11px;
  border-radius: 1px;
  background: var(--palm-accent);
  opacity: 0.65;
}

.chat-cmdline[data-state='error'] .chat-cmdline-mark { background: var(--palm-danger); opacity: 1; }
.chat-cmdline[data-state='stopped'] .chat-cmdline-mark { background: var(--palm-warn); opacity: 1; }

.chat-cmdline-text {
  position: relative;
  flex: 1 1 auto;
  min-inline-size: 0;
  block-size: 100%;
  overflow: hidden;
  mask-image: linear-gradient(90deg, #000 86%, transparent);
}

.chat-cmdline-item {
  position: absolute;
  inset-block: 0;
  inset-inline: 0;
  display: flex;
  align-items: center;
  overflow: hidden;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-dockText::after {
  content: '';
  position: absolute;
  inset-block: calc(var(--palm-queue-row-hit) * -1);
  inset-inline: 0;
}

.chat-cmdline-item[data-phase='in'] {
  animation: palm-cmd-in 320ms ease-out both;
}

.chat-cmdline-item[data-phase='out'] {
  animation: palm-cmd-out 320ms ease-in both;
}

@keyframes palm-cmd-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}

@keyframes palm-cmd-out {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(-3px); }
}

/* ── 交付卡：全页唯一的一张卡 ────────────────────────────────────────
   版式真源：delivery-card.html A 图（卡头 → 交付物/改动行 → 汇总 → 卡尾）。
   根节点带 chat-turn-tail 是给卡片诊断探针与既有行身份用的历史钩子，
   卡面本身全部由 palm-delivery-* 重画。

   2026-11-10 收窄（整屏实拍：一张卡吃掉半屏，绿色渐变更抢眼）。三条改动：
   1. 不再通栏：max-inline-size 收到 336px（320 屏上退化成 100%），
      右边自然留白 —— 它是一张"回执"，不该和正文一样宽；
   2. **不再用绿色渐变底**：回到普通表面色 + 中性描边，绿只留在勾与标签上；
   3. 圆角与内边距跟其他卡片对齐（--palm-r-m / --palm-s3）。 */
.palm-delivery {
  display: block;
  /* 平铺：与正文同宽（正文列左右各 16px，卡片所在行只有 12px 的内边距，补 4px 对齐）。 */
  max-inline-size: 100%;
  margin-inline: var(--palm-s1);
  margin-block-start: var(--palm-s3);
  padding: 0;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  overflow: hidden;
}

.palm-delivery-head {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  padding: var(--palm-s2) var(--palm-s3);
  border-block-end: var(--palm-hair) solid var(--palm-line);
}

.palm-delivery-check {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  inline-size: var(--palm-s5);
  block-size: var(--palm-s5);
  border-radius: var(--palm-r-full);
  background: var(--palm-tint-ok);
  color: var(--palm-ok);
  font-size: var(--palm-t-s);
}

/*
 * P4 四态：同一张骨架，只换状态色与文案 —— 不新增组件、不写裸色。
 * success 用默认的绿勾；failure 红边 + 红字形；unknown 中性灰（不猜成功）；
 * running 用强调色，表示这一轮还没收工。
 */
.palm-delivery[data-state='failure'] {
  border-color: var(--palm-danger);
}

.palm-delivery[data-state='failure'] .palm-delivery-check {
  background: var(--palm-tint-danger);
  color: var(--palm-danger);
}

.palm-delivery[data-state='unknown'] .palm-delivery-check {
  background: var(--palm-tint-warn);
  color: var(--palm-fg-2);
}

.palm-delivery[data-state='unknown'] .palm-delivery-title {
  color: var(--palm-fg-2);
}

.palm-delivery[data-state='running'] .palm-delivery-check {
  background: var(--palm-tint-accent);
  color: var(--palm-accent);
}

.palm-delivery-reason {
  margin: 0;
  padding: 0 var(--palm-s3) var(--palm-s2);
  color: var(--palm-fg-2);
  font-size: var(--palm-flow-meta-size);
  line-height: var(--palm-lh-body);
  /* 2026-11-10 多行堆栈实拍：宿主把四条错误用换行拼成一段，默认把换行折成空格，
     四行错误糊成一堵字墙。pre-line 保留换行、折叠多余空白，长度不变。 */
  white-space: pre-line;
}

.palm-delivery-retry {
  margin-inline-start: var(--palm-s2);
}

.palm-delivery-title {
  color: var(--palm-fg);
  font-size: var(--palm-flow-title-size);
  font-weight: var(--palm-w-bold);
}

.palm-delivery-meta {
  margin-inline-start: auto;
  color: var(--palm-fg-3);
  font-size: var(--palm-flow-meta-size);
  font-variant-numeric: tabular-nums;
}

.palm-delivery-row {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  inline-size: 100%;
  min-block-size: var(--palm-hit);
  padding: var(--palm-s1) var(--palm-s3);
  border: 0;
  background: none;
  color: var(--palm-fg);
  font: inherit;
  font-size: var(--palm-flow-row-size);
  text-align: start;
}

.palm-delivery-row + .palm-delivery-row {
  border-block-start: var(--palm-hair) solid var(--palm-line);
}

button.palm-delivery-row { cursor: pointer; }

button.palm-delivery-row:active { background: var(--palm-tint-accent); }

button.palm-delivery-row:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: -2px;
}

.palm-delivery-icon {
  flex: none;
  /* 与卡头勾选圈同宽（s5），这样标题文字与行文字的左边线完全对齐。 */
  inline-size: var(--palm-s5);
  color: var(--palm-fg-2);
  font-size: var(--palm-t-s);
  text-align: center;
}

.palm-delivery-name {
  flex: 1 1 auto;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-dockText::after {
  content: '';
  position: absolute;
  inset-block: calc(var(--palm-queue-row-hit) * -1);
  inset-inline: 0;
}

.palm-delivery-tally {
  flex: none;
  font-family: var(--palm-font-mono);
  font-size: var(--palm-flow-tally-size);
}

.palm-delivery-add { color: var(--palm-ok); }

.palm-delivery-del { color: var(--palm-danger); }

.palm-delivery-tag {
  flex: none;
  padding: 2px var(--palm-s1);
  border-radius: var(--palm-r-s);
  background: var(--palm-flow-tag-ok);
  color: var(--palm-ok);
  font-size: var(--palm-flow-tag-size);
}

.palm-delivery-tag[data-kind='edit'] {
  background: var(--palm-flow-tag-edit);
  color: var(--palm-accent);
}

.palm-delivery-sum {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--palm-s1) var(--palm-s3);
  padding: 0;
  border: 0;
  font-size: var(--palm-flow-meta-size);
  color: var(--palm-fg-3);
}

.palm-delivery-count b {
  color: var(--palm-fg-2);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-bold);
}

.palm-delivery-commit {
  color: var(--palm-fg-3);
  font-family: var(--palm-font-mono);
  font-size: var(--palm-flow-meta-size);
}

/*
 * 卡尾：左边汇总、右边「看全部改动 ›」。2026-11-10 再收：汇总与按钮原来各占一行，
 * 按钮被推成整行宽（用户第二次说"这一块还是太宽"）。现在同一行，按钮只占文字宽度、
 * 贴右，右边线与行内的标签列对齐。
 */
.palm-delivery-foot {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  /* 2026-11-10 实机：这一块上下太高（61px）。卡已平铺到正文宽度，这一行只要放得下
     11px 的文字，别再撑成 44px 触控条的高度。 */
  padding: var(--palm-s1) var(--palm-s3);
  border-block-start: var(--palm-hair) solid var(--palm-line);
  font-size: var(--palm-flow-meta-size);
  color: var(--palm-fg-3);
}

.palm-delivery-more {
  flex: none;
  margin-inline-start: auto;
  /* 视觉上只是文字；上下留 28px 的点击高度（比 44px 矮，仍在 24px 可用下限之上）。 */
  min-block-size: var(--palm-s6);
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: var(--palm-flow-meta-size);
  color: var(--palm-accent);
  cursor: pointer;
}
.palm-delivery-more:active { opacity: 0.72; }

.palm-delivery-more:focus-visible {
  outline: none;
  box-shadow: 0 0 0 var(--palm-focus) var(--palm-accent);
}


/* ── 过程条动效（2026-11-10 方案 A + B + D） ────────────────────────────────
   三条自我约束：
   1. 只动 transform / opacity，不动宽高 → 不触发重排；
   2. 只在 running 时出现，完成/失败立即停（全屏都在闪 = 廉价）；
   3. prefers-reduced-motion 时全部关掉，只留静态点阵与进度长度。
   颜色全部走令牌；扫光用 accent 令牌，不写裸色。 */

.palm-proc {
  position: relative;
  overflow: hidden;
}

/* 2026-11-10：右侧环形进度已删除（用户：「没有任何作用」）。
   步数只在展开体首行「共 N 步」报，头行右侧只留展开箭头。 */

/* A：状态点呼吸（只 running）。外圈用 box-shadow 扩散，不占布局。 */
.palm-proc-dot[data-state='running'] {
  animation: palm-proc-breathe 1.6s ease-in-out infinite;
}

/* D：展开时明细逐行滑入（列表本身已存在，只给它一个入场动作）。 */
.chat-proc-open .chat-step,
.chat-proc-open .palm-proc-recent {
  animation: palm-proc-row-in 0.32s ease-out both;
}

.chat-proc-open .chat-step:nth-child(2) { animation-delay: 0.06s; }
.chat-proc-open .chat-step:nth-child(3) { animation-delay: 0.12s; }
.chat-proc-open .chat-step:nth-child(4) { animation-delay: 0.18s; }

@keyframes palm-proc-breathe {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 var(--palm-accent-16); }
  50% { opacity: 0.6; box-shadow: 0 0 0 5px transparent; }

}



@keyframes palm-proc-row-in {
  0% { opacity: 0; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
}

/* ── 状态条重设计（2026-11-10）：鲸尾标记 + 底边潮汐线 ─────────────────────
   用户拍的：状态词叫「深度求索中」，左边一枚鲸尾。11 张宠物脸下线，识别改靠
   **底色 + 文案**，不靠画脸（18px 的表情在小条里本来就糊）。
   主条的进度填充从"整条渐变"改成**底边 3px 潮汐线** —— 一屏最亮的东西应该是正文。 */

.palm-strip[data-size='main'] {
  --palm-strip-fg: var(--palm-fg);
  --palm-strip-detail-fg: var(--palm-fg-2);
  --palm-strip-right-fg: var(--palm-fg-3);
}

/* 鲸尾方标：24×24、圆角 8。
 * 底色跟着状态走（tint），**尾鳍本身永远是品牌强调色**（--palm-accent）。
 * 2026-11-10 用户反馈：以前尾鳍跟着状态变色，done/idle/unknown 下变成灰绿/灰，
 * 每个皮肤看过去都像「灰鲸鱼」。现在颜色只由底色承担，鲸鱼始终是那只蓝鲸。 */
.palm-strip-mark {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 24px;
  block-size: 24px;
  border-radius: 8px;
  background: var(--palm-accent-16);
  color: var(--palm-whale);
}

.palm-strip[data-size='mini'] .palm-strip-mark {
  inline-size: var(--palm-strip-pet);
  block-size: var(--palm-strip-pet);
  border-radius: 6px;
}

.palm-strip-mark[data-kind='think'],
.palm-strip-mark[data-kind='read'],
.palm-strip-mark[data-kind='edit'],
.palm-strip-mark[data-kind='test'] {
  background: var(--palm-accent-16);
}

/* 空闲与未知：底色中性（不抢眼、不假装在干活），但鲸鱼仍是品牌色 —— 它只是安静，不是死了。 */
.palm-strip-mark[data-kind='idle'],
.palm-strip-mark[data-kind='unknown'] {
  background: var(--palm-sur-2);
}

.palm-strip-mark[data-kind='done'] { background: var(--palm-ok-band); }
.palm-strip-mark[data-kind='failed'] { background: var(--palm-danger-band); }
.palm-strip-mark[data-kind='approve'],
.palm-strip-mark[data-kind='stuck'],
.palm-strip-mark[data-kind='stopped'],
.palm-strip-mark[data-kind='queued'] { background: var(--palm-tint-warn); }
/* ── reduced motion additions ────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  .chat-reasoning-more,
  .chat-offline-banner,
  .chat-quote-bar,
  .voice-backdrop,
  .voice-sheet,
  .voice-wave span,
  .voice-done {
    animation: none;
    transition: none;
  }
}

/* ── in-body think blocks ─────────────────────────────────────────────
   The interactive message body mounts the shared ReasoningDisclosure
   (chat-disclosure chrome: #16161f bg, 10px radius, 36px collapsed row,
   5 visible lines) — no extra CSS. These rules only fix the native
   <details> chrome used by the static string renderer on top of the same
   classes: hide the summary marker and rotate the caret when open. */

details.think-block,
details.think-block .chat-disclosure-head {
  list-style: none;
}

details.think-block summary::-webkit-details-marker {
  display: none;
}

details.think-block summary {
  cursor: pointer;
}

details.think-block[open] .chat-disclosure-caret {
  transform: rotate(180deg);
}

/* Long-token fallback for every multi-line text container: unwrapped
   paths/URLs (Windows drives, command lines, service endpoints) wrap
   anywhere instead of overflowing the row and drifting the layout. */
.settings-note,
.settings-fieldDesc,
.sheet-option-desc,
.mobile-error,
.empty-desc,
.mobile-muted,
.settings-inboxRow .card-desc {
  overflow-wrap: anywhere;
}

/* Search result notes (truncation / scope hints). */
/* 搜索命中高亮：底色只用强调色的淡版，文字颜色保持不变，避免整行花掉。 */
.mobile mark {
  background: var(--accent-soft);
  color: inherit;
  border-radius: 3px;
  padding: 0 1px;
  font-weight: 600;
}

/* 「加载更多结果」：整行点击区，和列表行一样高，手指好按。 */
/* 会话内搜索条：夹在头部和聊天区之间，一行放输入 + 记数 + 上/下一个 + 关闭。 */
.chat-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-input);
}

.chat-search-input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: 9px;
  background: var(--card-bg);
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
}

.chat-search-input:focus {
  outline: none;
  border-color: var(--border-focus);
}

.chat-search-count {
  flex: none;
  min-width: 44px;
  text-align: right;
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* Focus-locate highlight: a one-shot ring pulse on the located row.
   只用 box-shadow，**绝不碰 background-color**：.chat-msg-focus 带
   animation-fill-mode: forwards，动画写到 100% 的 background-color: transparent 会
   永久覆盖 .chat-msg-user 的强调色底——气泡变透明、而 color 仍是白字，浅色模式下
   整段看不见（真机截图就是这个）。描边不会改底色，安全。 */
@keyframes dshPalmFocusPulse {
  0% {
    box-shadow:


      0 0 0 0 var(--palm-accent-16);
  }
  70% {
    box-shadow:


      0 0 14px 2px var(--palm-search-mark);
  }
  100% {
    box-shadow:
      inset 0 0 0 2px transparent,
      0 0 0 0 transparent;
  }
}

/* 真机反馈「搜索命中之后没有高亮」：底色脉冲在气泡里看不见（气泡自己有底），
   所以补一圈内描边并把保持时间拉长到 3.2s；词级 <mark> 由 focusedQuery 负责。 */
.chat-msg-focus {
  animation: dshPalmFocusPulse 3.2s ease-out forwards;
}

/* 定位落点的词级高亮。两个坑：
   1) 用户气泡是强调色底 + 白字（.chat-msg-user），半透明紫底叠上去等于白字白底，
      浅色模式下整个词看不见 —— 气泡内必须反相（白底深字）。
   2) 代码块的 token 自带内联 color，继承不到主题正文色，也要显式压回正文色。
   用 .mobile 提一级特异性，避免被上面 .mobile mark 的 background 盖掉。 */
.mobile .chat-search-mark {
  color: var(--text-primary);
  /* 2026-11-10：原来是 color-mix(accent 26%, bg-elevated)。iOS 15 不支持 color-mix，
     整条声明失效 → 命中词没有底色，搜索定位等于瞎了。改成预混令牌。 */
  background: var(--palm-search-mark);
  border-radius: 3px;
  padding: 0 1px;
  font-weight: 600;
}

.mobile .chat-msg-user .chat-search-mark {
  color: var(--palm-fg);
  background: var(--palm-sur-1);
  box-shadow: inset 0 0 0 1px var(--palm-accent-line);
}

.mobile .chat-md pre .chat-search-mark,
.mobile .chat-md code .chat-search-mark {
  color: var(--text-primary) !important;
}

/* Settings-search locate: the anchored sub-page entry pulses once on
   arrival, so the user sees which control the search found. */
[data-locate-id][data-focus] {
  animation: dshPalmFocusPulse 2.2s ease-out forwards;
}
/* ── turn list floating handle (轮次清单) ─────────────────────────────── */

/* A compact pill pinned beside the jump-to-latest button; shows the current
   turn / total count. Rides the same sticky flex column as chat-jump-latest
   (aligned flex-end), offset above the round button so the two never overlap. */
.chat-jump-turns {
  position: sticky;
  bottom: 58px;
  align-self: flex-end;
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 48px;
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  box-shadow: var(--palm-sh2);
  cursor: pointer;
  /* A press-and-hold must still count as a tap, AND the hold must own the
     gesture: with manipulation/auto the browser claims the move for page
     scrolling and fires pointercancel, which closes the scrubber the instant
     it opens. none keeps every move on the handle. */
  -webkit-user-select: none;
  user-select: none;
  touch-action: none;
  transition: background 120ms ease, color 120ms ease, transform 120ms ease;
  animation: chat-jump-in 160ms ease-out;
}
.chat-jump-turns:active {
  transform: scale(0.92);
}

.chat-jump-turns-label {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
/* ── D1 turn scrubber ──────────────────────────────────────────────────
   Docks above the composer while the turn handle is held: target turn +
   prompt on one line, the response preview beneath it, then a full-width
   rail carrying one tick per turn and a knob at the pointed turn. The
   gesture runs on the handle (which owns the pointer capture), so the card
   itself stays pointer-inert and never steals the drag. */
.turn-scrub {
  margin: 8px 16px 0;
  padding: 10px 14px 9px;
  border-radius: 14px;
  background: var(--card-bg);
  border: 1px solid var(--accent);
  box-shadow: var(--palm-shadow);
  animation: chat-jump-in 160ms ease-out;
  pointer-events: none;
}
.turn-scrub-head {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}
.turn-scrub-num {
  flex-shrink: 0;
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.turn-scrub-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  font-weight: 500;
}
.turn-scrub-sub {
  margin-top: 1px;
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The track is taller than the rail so the knob has room to sit proud. */
.turn-scrub-track {
  position: relative;
  height: 26px;
  margin-top: 6px;
}
.turn-scrub-rail {
  position: absolute;
  left: 0;
  right: 0;
  top: 11px;
  height: 4px;
  border-radius: 2px;
  background: var(--fill);
}
.turn-scrub-fill {
  position: absolute;
  left: 0;
  top: 11px;
  height: 4px;
  border-radius: 2px;
  background: var(--accent);
}
/* 已加载的那一段：滑条轴按宿主全量轮次算，可手机只加载了尾部，没这一段
   就是一片空白，用户不知道能往哪拖。 */
.turn-scrub-loaded {
  position: absolute;
  top: 11px;
  height: 4px;
  border-radius: 2px;
  background: var(--palm-search-mark);
}
.turn-scrub-tick {
  position: absolute;
  top: 9px;
  width: 2px;
  height: 8px;
  margin-left: -1px;
  border-radius: 1px;
  background: var(--border-default);
}
.turn-scrub-tick-at {
  background: var(--text-secondary);
}
.turn-scrub-knob {
  position: absolute;
  top: 2px;
  width: 22px;
  height: 22px;
  /* 两端收进轨道内：纯百分比会让滑块有一半悬在卡外面。
     位置由行内样式按当前轮次给（--knob-pct），这里的默认值让变量有定义。 */
  --knob-pct: 0%;
  left: clamp(11px, var(--knob-pct), calc(100% - 11px));
  margin-left: -11px;
  border-radius: 50%;
  background: var(--card-bg);
  border: 3px solid var(--accent);
}
.turn-scrub-hint {
  margin-top: 3px;
  font-size: var(--text-sm);
  color: var(--text-quaternary);
}
/* Held: the handle reads as the live scrub control. */
.chat-jump-turns-live {
  border-color: var(--accent);
  color: var(--accent);
}


/* ── 目标条（goal bar）───────────────────────────────────────────────── */
/* 桌面端 composer 上方那条 goal 指示条的复刻。位置由 DOM 决定（排队卡片与
   模型/权限行之间）—— 一条紧凑横条：准星 + 相位 + 进度摘要 + 目标正文一行省略。
   手机上它上排队卡片、下模型/权限行、再下输入框，三条叠起来已经吃掉正文空间，
   所以状态行视觉高度压在 28px；判定区靠 ::after 补到 44px。
 *
 * 结构（2026-11-12 重排，修真机"展开后动作按钮压住进度摘要"）：
 *   第 1 行  .chat-goal-head：◉ + 相位 + 摘要 | 右侧 .chat-goal-tools 图标工具栏
 *   第 2 行  .chat-goal-text：目标正文一行省略（点它展开）
 *   展开后   .chat-goal-body：全文，工具栏最后一颗变成「收起」
 * 两列硬对齐：左边只有文字，右边只有图标；中间的空档谁都不占，所以不会互相压字。
 * （改前是「文字 + 四个文字按钮」挤一行：360px 上摘要溢出容器 18px，被按钮盖住。） */
.chat-goal {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0 10px 6px;
  padding: 4px 6px 4px 10px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-chip);
  background: var(--bg-elevated);
}
.chat-goal-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
}
.chat-goal-glyph {
  display: inline-flex;
  flex: none;
  color: var(--accent);
}
.chat-goal-main {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  /* 摘要再长也只能被省略号吃掉：越界绘制会被右侧工具栏压住（真机重叠的根因）。 */
  overflow: hidden;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
/* 状态行是展开/收起的开关：视觉 30px，判定区补到 44px（与工具栏同一套做法）。 */
.chat-goal-main::after {
  content: '';
  position: absolute;
  inset-block: -7px;
  inset-inline: 0;
}
.chat-goal-label {
  flex: none;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
/* 右侧图标工具栏：4~5 颗 30×30，贴右缘成一列，不再与正文抢水平空间。 */
.chat-goal-tools {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: -4px;
}
.chat-goal-icon {
  position: relative;
  flex: none;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: none;
  cursor: pointer;
}
/* 图标与文字按钮同一档颜色：合成一条规则，别为同一档色名多记一次用量
   （皮肤迁移的"旧色名只许降"计数会把新增的一次算成退化）。 */
.chat-goal-btn,
.chat-goal-icon {
  color: var(--text-secondary);
}
.chat-goal-icon svg {
  width: 16px;
  height: 16px;
}
/* 判定区 40×44：与相邻图标只重叠 0（inset-inline -3 时两者之间仍有 1px 空隙），
   按到隔壁那颗是最烦的误触。 */
.chat-goal-icon::after {
  content: '';
  position: absolute;
  inset-block: -7px;
  inset-inline: -3px;
}
.chat-goal-icon:active {
  background: var(--fill);
}
.chat-goal-icon:disabled {
  opacity: 0.5;
  cursor: default;
}
/* 收起的正文：单独一行、整行可点（与状态行同一个开关）。
   左内边距 = 准星 14 + 间距 8：正文与相位文字落在同一条竖线上。 */
.chat-goal-text {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0 2px 0 22px;
  border: 0;
  background: none;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-align: left;
  font: inherit;
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--text-primary);
  cursor: pointer;
}
/* 展开的全文：目标常是带小标题、空行、编号的多段文本，按普通正文的阅读节奏排
   —— 保留原始换行（pre-wrap）、行高 1.55、字号 13px（比消息正文那档 15px 小一档：
   它是"条子里的正文"，邻居全是 11~12px 的相位/摘要，15px 会把自己顶成整屏最大的字）。 */
.chat-goal-body {
  max-height: 38vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 2px 2px 6px 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--text-md);
  line-height: 1.55;
  color: var(--text-primary);
  -webkit-overflow-scrolling: touch;
}
.chat-goal-btn {
  position: relative;
  flex: none;
  height: 28px;
  min-width: var(--palm-hit);
  padding: 0 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-chip);
  background: var(--bg-surface);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}
.chat-goal-btn::after {
  content: '';
  position: absolute;
  inset-block: -8px;
  inset-inline: 0;
}
.chat-goal-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.chat-goal-btn-clear {
  color: var(--text-muted);
}
.chat-goal-btn-save {
  color: var(--accent);
  border-color: var(--accent-soft);
}
/* 展开状态的出口：与「×」（清除）区分开，用强调色，一眼是"回到收起"。 */
.chat-goal-btn-collapse {
  color: var(--accent);
  border-color: var(--accent-soft);
}
/* 阻塞理由常常是一整段排查记录（实测能占掉大半个屏幕）：默认只露两行，底部渐隐
   提示"还有"，点文字或下面那颗小按钮展开。折叠靠 max-height，不动原文。 */
.chat-goal-reasonWrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.chat-goal-reason {
  display: block;
  width: 100%;
  max-height: 38vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  font: inherit;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--warning);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  cursor: pointer;
  -webkit-overflow-scrolling: touch;
}
.chat-goal-reason-collapsed {
  /* 约两行；再靠一道渐隐告诉用户"后面还有". */
  max-height: 3.2em;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(180deg, #000 62%, transparent 100%);
  mask-image: linear-gradient(180deg, #000 62%, transparent 100%);
}
.chat-goal-reasonText {
  display: block;
}
.chat-goal-btn-reason {
  align-self: flex-start;
  color: var(--warning);
}
.chat-goal-edit {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chat-goal-input {
  flex: 1 1 auto;
  min-width: 0;
  min-height: var(--palm-hit);
  padding: 0 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: 16px;
}
/* 窄屏（360/375/393 那批）：相位文字让位给进度摘要 —— 摘要是"还在不在动"的唯一
   文字线索，相位另有图标可读（有「暂停」= 进行中，有「继续」= 已暂停）。
   为什么是 400：401px 起「相位 + 摘要 + 工具栏」才真的放得下（401 时信息区
   195px ≥ 相位 40 + 摘要 149）；展开态在 360 上同样放不下，所以不做例外。 */
@media (max-width: 400px) {
  .chat-goal-label {
    display: none;
  }
  .chat-goal {
    margin-left: 6px;
    margin-right: 6px;
  }
}

/* ===== 运行中页 v3：一行标题 + 一行"在干什么"，子代理单独成行、点得开 ===== */
/* 旧版把状态徽标塞在标题行里，正文只能从徽标右边起，形成两栏错位；现在状态是一枚
   小圆点，占固定 14px 图标列，标题与下面每一行都从同一条竖线开始。 */

/* 最新事件超过 90 秒：可能是宿主重启/断流，也可能是真卡住，转黄提示别干等。 */

/* ===== 聊天页顶部「别的会话跑完了」条 =====
 *
 * 这条原来只在底部浮层里出现，而浮层与输入框同样钉底、z-index 更高 —— 真机上直接盖住
 * 输入框（"挡到我打字了"）。聊天页改走顶部 HUD：信息一样，不占底部一个像素；
 * 底部浮层只留给首页/运行中/设置这些没有输入区的页面。
 */
.chat-finished-strip {
  position: relative;
  padding-right: 34px;
  color: var(--text-primary);
}

.chat-finished-ic {
  flex: none;
  width: 14px;
  text-align: center;
  color: var(--positive);
  font-weight: 700;
}

.chat-finished-ic.is-bad {
  color: var(--danger);
}

.chat-finished-ic.is-stop {
  color: var(--warning);
}

.chat-finished-chev {
  flex: none;
  color: var(--text-quaternary);
  font-size: 15px;
}

.chat-finished-dismiss {
  position: absolute;
  top: 0;
  right: 0;
  width: 34px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-quaternary);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.chat-finished-dismiss:active {
  color: var(--text-primary);
}

/* ===== 收工浮层：任何页面都能看到"哪个会话跑完了" ===== */
.mobile-offline-bar {
  position: sticky;
  top: 0;
  z-index: var(--z-offline);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-primary);
  /* 2026-11-10：原来是 color-mix(warning 18%, bg-elevated)，既带裸色兜底又在
     iOS 15 上整条失效（离线条直接透明）。改用皮肤里的普通 rgba 淡染，
     与聊天页顶部那条断线带同一个来源。 */
  background: var(--palm-warn-band);
  border-bottom: var(--palm-hair) solid var(--border-focus);
}

.mobile-offline-retry {
  margin-left: auto;
  padding: 4px 10px;
  font: inherit;
  color: var(--text-primary);
  background: transparent;
  border: 1px solid var(--border-focus);
  border-radius: 999px;
}

.finish-toast {
  /**
   * **钉在顶部**，不钉底部（2026-11-01 真机："又从底部弹出来了"）。
   *
   * 底部那条会压住内容、也压住输入框；聊天页早就改成顶部条了，其它页面却还是底部浮层，
   * 于是同一个通知在两个页面出现位置不一样。现在统一到顶部（标题栏下方），
   * 动画也改成从上方滑入 —— 通知出现在视线开始的地方，不遮正在看的东西。
   */
  position: fixed;
  left: 12px;
  right: 12px;
  top: calc(env(safe-area-inset-top, 0px) + 64px);
  z-index: var(--z-sheet);
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 13px;
  border: 1px solid var(--border-focus);
  border-radius: 14px;
  background: var(--toast-bg);
  color: var(--toast-text);
  box-shadow: var(--palm-shadow);
  cursor: pointer;
  text-align: left;
  font: inherit;
  animation: finish-toast-in 200ms ease-out;
}

@keyframes finish-toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 目标条上的进度摘要（已跑多久 · 第几步）：纯文字，不做胶囊底 ——
 * 胶囊的内边距会让它比下面的正文左移 6px，正是"没对齐"的观感来源。
 * 可以缩、可以省略号；相位文字在窄屏先让位（见下方 400px 断点）。 */
.chat-goal-meta {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* 用量行里的「去控制台看用量」：不是主操作，做成链接样式的按钮 */
.usage-consoleLink {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}

/* 运行状态条收起：内容清空后先播这一段，再整条卸载（不占位） */
.chat-status-strip-leaving {
  animation: chatStatusLeave 320ms ease forwards;
  pointer-events: none;
}
@keyframes chatStatusLeave {
  from { opacity: 1; transform: translateY(0); max-height: 64px; }
  to { opacity: 0; transform: translateY(6px); max-height: 0; }
}

/* 「电脑文件」越界提示：一句话 + 一个回工作区的出口 */
.host-file-outside {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.host-file-back {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}

/* 目标动作的等待指示：点了立刻转圈，回执到了才停 */
.chat-goal-spinner {
  width: 11px;
  height: 11px;
  flex: none;
  border-radius: 50%;
  border: 1.5px solid var(--palm-accent-line);
  border-top-color: var(--accent);
  animation: goalSpin 700ms linear infinite;
}
@keyframes goalSpin {
  to { transform: rotate(360deg); }
}

/* 搜索条上的第二个提示（载入中…）：不与计数共用一颗节点 */
.chat-search-hint {
  margin-left: 6px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

/* 停止的「确认」态：变宽、变红，明确它在等第二次点击 */
.chat-stop-mini-armed {
  width: auto;
  min-width: 48px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--palm-danger-band);
  border-color: var(--palm-danger-line);
  color: var(--danger);
}
.chat-stop-mini-text {
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1;
}

/* 运行中页的校准细条：只表示"在问宿主"，不遮挡内容 */

@keyframes runovSync {
  0% { transform: translateX(-40%); }
  100% { transform: translateX(300%); }
}

/* 会话 HUD：纯结构容器，不产生布局盒（三条状态条的外观/间距保持原样） */
.chat-hud {
  display: contents;
}

/* 附件 chip 上的「取消」：上传中随时可停（弱网不等 120 秒超时） */
.chat-file-cancel {
  flex: none;
  min-width: var(--palm-hit);
  min-height: var(--palm-hit);
  padding: 0 var(--palm-s2);
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.chat-file-cancel:active { opacity: 0.7; }
/* ── 审批详情页（P6 ④ 屏） ─────────────────────────────────────────── */

.approval-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--palm-bg);
  color: var(--palm-fg);
}

/* 标题下面那行"哪个会话 · 什么风险"：次要信息，不抢标题。 */
.approval-page-sub {
  flex: 1 0 100%;
  margin: 0;
  padding: 0 var(--palm-s4) var(--palm-s2);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-2);
}

/* 风险不同，边色不同（只染色，不换结构）。 */
.approval-page-sub[data-risk='exec'] { color: var(--palm-warn); }
.approval-page-sub[data-risk='write'] { color: var(--palm-fg-2); }

.approval-page-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--palm-s4);
  min-inline-size: 0;
}

.approval-page-hint {
  margin: 0;
  padding: var(--palm-s3) var(--palm-s4) var(--palm-s4);
  font-size: var(--palm-t-s);
  /* 这句话解释的是「批准之后会发生什么」，属于决策信息，不是可有可无的脚注：
     三级灰在大屏上离按钮 200px 远，基本没人会读。抬到二级色。 */
  color: var(--palm-fg-2);
  border-top: 1px solid var(--palm-line);
}

/* ── ④ 视觉重做：等宽命令块 / 黄色风险条 / 底部双按钮 ───────────── */

/* 副标题占满标题行：header 是 grid，旧的 flex 百分比在 grid 里不生效。 */
.approval-page-sub {
  grid-column: 1 / -1;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

/* grow 槽本身不是滚动容器：给里面的正文一个确定高度。 */
.approval-page [data-slot='body'] {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.approval-page-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow-y: auto;
  /* flex 项的自动最小宽度是 min-content：一条长命令能把整个审批块顶出屏幕，
     「原始参数」切换按钮随之被挤出视口（2026-11-10 实拍）。 */
  min-inline-size: 0;
  -webkit-overflow-scrolling: touch;
}

/* 审批主体是一列：元信息 → 命令块 → 风险条 → 操作。 */
.approval-detail {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--palm-s3);
  min-block-size: 0;
  /* 同上：这一列也不能被长命令撑开。 */
  min-inline-size: 0;
}

.approval-detail-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--palm-s2);
}

/* 元信息的「工具 / 风险」是一对标签：键弱、值强（定版图 .ameta .k）。 */
.approval-detail-key {
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-head);
}

.approval-detail-tool,
.approval-detail-risk {
  padding: var(--palm-s1) var(--palm-s2);
  border-radius: var(--palm-r-s);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-head);
}

.approval-detail-tool {
  border: var(--palm-hair) solid var(--palm-line);
  background: var(--palm-sur-1);
  color: var(--palm-fg);
  font-family: var(--font-mono);
}

/* 语义色只落在描边与图标上；文字仍用前景色，纸皮肤下也过 AA。 */
.approval-detail-risk {
  border: var(--palm-hair) solid var(--palm-line);
  color: var(--palm-fg);
}

.approval-detail-risk[data-risk='write'] {
  border-color: var(--palm-warn);
}

.approval-detail-risk[data-risk='exec'],
.approval-detail-risk[data-risk='install'] {
  border-color: var(--palm-danger);
}

.approval-detail-reason {
  flex: 1 0 100%;
  margin: 0;
  color: var(--palm-fg-2);
  font-size: var(--palm-t-m);
  line-height: var(--palm-lh-body);
}

/* 「将要执行什么」：等宽代码块；长行横滑，不折成看不懂的几段。 */
.approval-detail-command {
  max-inline-size: 100%;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-spec-code-r);
  background: var(--palm-sur-1);
  overflow: hidden;
}

.approval-detail-command-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--palm-s2);
  min-height: var(--palm-hit);
  padding: 0 var(--palm-s3);
  border-bottom: var(--palm-hair) solid var(--palm-line);
}

.approval-detail-command-label {
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
}

.approval-detail-expand {
  flex: none;
  min-height: var(--palm-hit);
  padding: 0 var(--palm-s2);
  border: none;
  background: transparent;
  color: var(--palm-accent);
  font: inherit;
  font-size: var(--palm-t-s);
  cursor: pointer;
}

.approval-detail-code,
.approval-detail-args {
  margin: 0;
  padding: var(--palm-s3);
  /* 命令块自己封顶：不把「待批准」那一行（含切换按钮）顶出屏幕。
     2026-11-10：原来写 white-space: pre + 横向滚动 —— 手机上批一条命令得**横着拖**
     才看得全；而聊天卡片里同一段命令是换行读的。两个审批面两种读法没道理，
     统一成"换行读 + 限高竖向滚"。 */
  max-inline-size: 100%;
  min-inline-size: 0;
  max-block-size: calc(var(--palm-t-s) * 1.4 * 10);
  color: var(--palm-fg);
  font-family: var(--font-mono);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

.approval-detail-code {
  min-height: var(--palm-hit);
  max-inline-size: 100%;
  min-inline-size: 0;
}

/* 横滚溢出提示（2026-11-10，320px 实拍）：命令块在容器圆角上被切掉一截时，右缘给
 * 一道渐隐 —— 用户才知道后面还有命令没读到。只在真溢出（data-fade=end）时出现，
 * 短命令没有尾巴；滚到最右由 hook 撤掉。
 * 渐隐用 currentColor 画：遮罩只看透明度，不引入任何新颜色值。 */
.approval-detail-code[data-fade='end'] {
  -webkit-mask-image: linear-gradient(to right, currentColor 0 calc(100% - var(--palm-s6)), transparent 100%);
  mask-image: linear-gradient(to right, currentColor 0 calc(100% - var(--palm-s6)), transparent 100%);
}

.approval-detail-args {
  max-height: 40vh;
  overflow-y: auto;
  border-top: var(--palm-hair) solid var(--palm-line);
  color: var(--palm-fg-2);
}

.approval-detail-noargs {
  margin: 0;
  padding: var(--palm-s3);
  border: var(--palm-hair) dashed var(--palm-line);
  border-radius: var(--palm-r-m);
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
}

/* 琥珀警示条：只在非只读审批上出现（只读不动手）。文案用警示色，
   因为这是"等你决定、不可撤销"，不是"失败"——危险色留给拒绝与失败。 */
.approval-detail-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--palm-s2);
  margin: 0;
  padding: var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-warn);
  border-radius: var(--palm-spec-code-r);
  background: var(--palm-tint-warn);
  color: var(--palm-warn);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
}

.approval-detail-warning-icon {
  flex: none;
  inline-size: var(--palm-s4);
  block-size: var(--palm-s4);
  color: var(--palm-warn);
}

/* 两个决定并排：绿=批准、红=拒绝（定版图 .abtn：色只落在这一对按钮上）。 */
.approval-detail-actions {
  display: flex;
  gap: var(--palm-s3);
  padding-top: var(--palm-s2);
}

.approval-detail-approve,
.approval-detail-reject {
  flex: 1 1 0;
  min-inline-size: 0;
  height: var(--palm-hit);
  border-radius: var(--palm-r-m);
  font: inherit;
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
  cursor: pointer;
  transition: filter 0.12s ease, opacity 0.12s ease;
}

.approval-detail-approve {
  border: var(--palm-hair) solid var(--palm-ok);
  background: var(--palm-ok-band);
  color: var(--palm-ok);
}

.approval-detail-reject {
  border: var(--palm-hair) solid var(--palm-danger);
  background: var(--palm-tint-danger);
  color: var(--palm-danger);
}

.approval-detail-approve:active,
.approval-detail-reject:active {
  filter: brightness(1.08);
}

.approval-detail-approve-holding {
  filter: brightness(0.92);
}

.approval-detail-approve:disabled,
.approval-detail-reject:disabled {
  opacity: 0.36;
  filter: none;
}

.approval-detail-expand:focus-visible,
.approval-detail-approve:focus-visible,
.approval-detail-reject:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: var(--palm-hair);
}
/* ── 单文件 diff 页（P6 ⑩ 屏） ─────────────────────────────────────── */

.diff-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--palm-bg);
  color: var(--palm-fg);
}

/* 标题只放文件名，目录做副标题：手机上长路径会把标题挤成两行。 */
.diff-page-path {
  margin: var(--palm-s1) 0 0;
  font-family: var(--palm-font-mono);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* grow 槽本身不是滚动容器：给正文一个确定高度（与审批页/模型页同一口径）。 */
.diff-page [data-slot='diff'] {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.diff-page-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--palm-s3) var(--palm-s4) var(--palm-s4);
}

/* 代码卡：整页唯一的"实物"，行内不再各画边框。 */
.diff-page-block {
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  box-shadow: var(--palm-hi), var(--palm-sh1);
  overflow: hidden;
}

/* 行容器：等宽字体 + 可选中的正文（长按走系统选择复制）。 */
.diff-page-lines {
  font-family: var(--palm-font-mono);
  font-size: var(--palm-t-s);
  /* 2026-11-10 实机：行高按正文口径（1.5 倍 + 上下内边距）落到代码上太松，一屏只看
     得到十来行。代码行用紧凑行高（1.45），垂直内边距收成 1px —— 一屏多出近一半。 */
  line-height: 1.45;
  color: var(--palm-fg);
  user-select: text;
  -webkit-user-select: text;
}

/*
 * 一行三列：行号（等宽右对齐）/ 增删符号 / 内容。
 * minmax(0, 1fr) 是窄屏不横向溢出的关键：内容列可被压缩，超长行折行而不是撑破卡片。
 */
.diff-page-row {
  display: grid;
  grid-template-columns: max-content var(--palm-s4) minmax(0, 1fr);
  align-items: baseline;
  padding: 1px var(--palm-s3) 1px var(--palm-s2);
}

.diff-page-no {
  min-width: var(--palm-s6);
  padding-right: var(--palm-s2);
  font-family: var(--palm-font-mono);
  font-size: var(--palm-t-s);
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--palm-fg-2);
  user-select: none;
  -webkit-user-select: none;
}

.diff-page-sign {
  text-align: center;
  color: var(--palm-fg-3);
  user-select: none;
  -webkit-user-select: none;
}

/* 超长行软换行（2026-11-10）：原来在这里截断（overflow + ellipsis），手机上除了长按
 * 复制没有别的办法看到后半行。pre-wrap 保住行首缩进，anywhere 让长标识符也能断行；
 * 行号列按基线对齐，仍和首行对得上，且不出现横向滚动。 */
.diff-page-text {
  padding-right: var(--palm-s2);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* 新增行：浅绿底 + 绿色左侧条；行号提亮到正文色，和上下文行区分开。 */
.diff-page-row-add {
  background: var(--palm-tint-ok);
  box-shadow: inset calc(var(--palm-hair) * 3) 0 0 var(--palm-ok);
}

.diff-page-row-add .diff-page-no {
  color: var(--palm-fg);
}

.diff-page-row-add .diff-page-sign {
  color: var(--palm-ok);
}

/* 删除行：浅红底 + 红色左侧条。 */
.diff-page-row-del {
  background: var(--palm-tint-danger);
  box-shadow: inset calc(var(--palm-hair) * 3) 0 0 var(--palm-danger);
}

.diff-page-row-del .diff-page-no {
  color: var(--palm-fg);
}

.diff-page-row-del .diff-page-sign {
  color: var(--palm-danger);
}

/* 上下文行不设底色：卡片底色就是它的底色。 */
.diff-page-row-ctx {
  background: transparent;
}

/* 多 hunk 才画的分隔行。 */
.diff-page-hunk {
  padding: var(--palm-s1) var(--palm-s3);
  border-top: var(--palm-hair) solid var(--palm-line);
  border-bottom: var(--palm-hair) solid var(--palm-line);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
  user-select: none;
  -webkit-user-select: none;
}

.diff-page-loading,
.diff-page-error {
  margin: 0;
  padding: var(--palm-s6) var(--palm-s4);
  text-align: center;
  font-size: var(--palm-t-m);
  color: var(--palm-fg-2);
}

.diff-page-error {
  color: var(--palm-danger);
}

/* 图片文件走同一张卡：限宽、圆角，不撑破页面。 */
.diff-page-image-wrap {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: var(--palm-s2) 0;
}

.diff-page-image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: var(--palm-r-m);
}

.diff-page-hint {
  margin: 0;
  padding: var(--palm-s3) var(--palm-s4) var(--palm-s4);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-2);
  border-top: var(--palm-hair) solid var(--palm-line);
}
/* ── 回合大纲页（P6 ⑫ 屏） ─────────────────────────────────────────── */

.outline-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--palm-bg);
  color: var(--palm-fg);
}

/* grow 槽本身不是滚动容器：给正文一个确定高度（与审批页/模型页同一口径）。 */
.outline-page [data-slot='groups'] {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.outline-page-body {
  flex: 1 1 auto;
  min-block-size: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--palm-s4);
}

/* 头部右侧的总轮数：只交代规模，不跟标题抢视线。 */
.outline-page-count {
  padding-inline-end: var(--palm-s3);
  font-size: var(--palm-t-s);
  font-variant-numeric: tabular-nums;
  color: var(--palm-fg-3);
  white-space: nowrap;
}

/* 顶部一句说明：这一屏的动作只有一个 —— 点一轮跳过去。 */
.outline-page-hint {
  margin: 0 0 var(--palm-s3);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-2);
}

/* 竖时间轴：节点之间不留缝，左侧那条线才连得起来。 */
.outline-timeline {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.outline-node {
  /* 轴线颜色：比 --palm-line 亮一点，否则细线在深底上根本看不见。 */
  /* 2026-11-10：原来是 color-mix(fg-3 48%)，iOS 15 上没有轴线。 */
  --outline-axis: var(--palm-line);
  position: relative;
  min-inline-size: 0;
}

/* 连接线画在节点上而不是行内：行的上下内边距会在每两个节点之间咬出缺口，
   线就断了。画在 li 上，相邻节点首尾相接，才是一条整轴。用一条细渐变铺在
   轴列中间 —— 不用 calc 除法，也不写裸像素。 */
.outline-node::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  inset-inline-start: var(--palm-hair);
  inline-size: var(--palm-s6);
  background-image: linear-gradient(var(--outline-axis), var(--outline-axis));
  background-repeat: no-repeat;
  background-position: center;
  background-size: var(--palm-hair) 100%;
}

/* 首尾把线裁到圆点附近：轴只连接节点，不往空白处伸（多出的一小截藏在圆点下面）。 */
.outline-node:first-child::before {
  top: var(--palm-s5);
}

.outline-node:last-child::before {
  bottom: calc(100% - var(--palm-s5));
}

/* 一行 = 一个节点：左边竖线与圆点，右边标题与元信息。 */
.outline-node-row {
  display: flex;
  align-items: flex-start;
  gap: var(--palm-s3);
  inline-size: 100%;
  min-block-size: var(--palm-hit);
  padding: var(--palm-s2) var(--palm-s3) var(--palm-s2) 0;
  border: var(--palm-hair) solid transparent;
  border-radius: var(--palm-r-m);
  background: transparent;
  color: var(--palm-fg);
  font: inherit;
  text-align: start;
}

/* 当前正在读的那一轮：整行淡染 + 强调描边（定版图里"你看的是这条"）。 */
.outline-node-row[aria-current='true'] {
  border-color: var(--palm-accent-line);
  background: var(--palm-tint-accent);
}

.outline-node-row:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: var(--palm-hair);
}

/* 轴列：给圆点一个固定的中线位置（连接线画在 li 上，见上）。 */
.outline-node-rail {
  position: relative;
  display: flex;
  flex: none;
  justify-content: center;
  align-self: stretch;
  inline-size: var(--palm-s6);
}

/* 节点圆点：普通轮次是空心小圆；当前轮填实并带一圈淡光。 */
.outline-node-dot {
  position: relative;
  flex: none;
  inline-size: var(--palm-s3);
  block-size: var(--palm-s3);
  margin-block-start: var(--palm-s2);
  border: var(--palm-hair) solid var(--palm-fg-3);
  border-radius: var(--palm-r-full);
  background: var(--palm-bg);
}

.outline-node-row[aria-current='true'] .outline-node-dot {
  border-color: var(--palm-accent);
  background: var(--palm-accent);
  box-shadow: 0 0 0 var(--palm-s1) var(--palm-tint-accent);
}

.outline-node-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--palm-s1);
  min-inline-size: 0;
  padding-block: var(--palm-s1);
}

/* 「一句结论标题」：只占一行，超了省略号。 */
.outline-node-title {
  min-inline-size: 0;
  overflow: hidden;
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
  line-height: var(--palm-lh-head);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 元信息：第几轮 · 时间 · 未加载；当前轮把「正在看」推到最右。 */
.outline-node-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--palm-s1) var(--palm-s2);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-3);
}

.outline-node-meta > svg {
  flex: none;
  inline-size: var(--palm-s4);
  block-size: var(--palm-s4);
}

.outline-node-turn,
.outline-node-time {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.outline-node-badge {
  padding-inline: var(--palm-s1);
  border-radius: var(--palm-r-s);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
}

.outline-node-mark {
  margin-inline-start: auto;
  color: var(--palm-accent);
  font-weight: var(--palm-w-bold);
}

/* 当前轮的元信息提亮一档：与整行高亮同一套语义，不额外上色。 */
.outline-node-row[aria-current='true'] .outline-node-meta {
  color: var(--palm-fg-2);
}

.outline-page-note {
  margin: var(--palm-s3) 0 0;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}
/* ── 产物摘要页（P6 ⑨ 屏）与交付详情页：列表页头已并入 515-five-screens ── */

/* 产物页头部那一句（"N 个文件，其中 M 个是交付物"）：横跨 header 整行。 */
.artifacts-page-sub {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0 var(--palm-s4) var(--palm-s2);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-2);
}

/* ── 产物摘要页（P6 ⑨ 屏，产物列表 ⑧ 的下级页） ─────────────────────
 * 分组头与文件行直接用 515-five-screens.css 那层规格件（SpecGroupHead / SpecRow），
 * 原来这一屏自己那套 .artifacts-row* / .artifact-summary-* 已随 ⑧ 一起收掉。 */

/* 空态里唯一的动作：回产物列表换一轮（与全站按钮同一套令牌、--palm-hit 触控）。 */
.artifact-summary-empty-action {
  min-block-size: var(--palm-hit);
  padding: 0 var(--palm-s4);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-2);
  color: var(--palm-fg);
  font: inherit;
  font-size: var(--palm-t-m);
}

.artifact-summary-empty-action:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: var(--palm-hair);
}

/* 分组标题：12px 灰，交付详情页（⑩）还在用。 */
.artifacts-group-title {
  margin: 0;
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-normal);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-3);
}

/* ── 交付详情页（会话正文流 · 交付卡的下级页） ───────────────────────
 * 版式真源：overview.html「3 · 交付详情」。三组清单 = 交付物 / 新增 / 修改；
 * 行内只有「图标 + 文件名 + +A −D + 标签」，超 5 条折叠。 */
.palm-dd-body {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s4);
  /* 2026-11-10 实机：这一页原来没有任何左右内边距，汇总行和三组清单全都贴着屏幕
     边缘（x=0），而页头副标题却从 16px 起 —— 整页看着"歪的"。统一到 16px。 */
  padding: 0 var(--palm-s4) var(--palm-s5);
}

/* 顶部汇总：N 个文件 / +A −D / N 测试通过（拿不到的项整项不画）。 */
.palm-dd-sum {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--palm-s2) var(--palm-s4);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-2);
  font-variant-numeric: tabular-nums;
}

.palm-dd-sum b {
  font-size: var(--palm-t-l);
  font-weight: var(--palm-w-bold);
  color: var(--palm-fg);
}

.palm-dd-sum .palm-dd-add { color: var(--palm-ok); }
.palm-dd-sum .palm-dd-del { color: var(--palm-danger); }

.palm-dd-group {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
}

/* 分组头：标题 + 右侧「展开全部 / 收起」（44px 触控区）。 */
.palm-dd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--palm-s2);
}

.palm-dd-toggle {
  min-block-size: var(--palm-hit);
  padding: 0 var(--palm-s2);
  border: 0;
  background: transparent;
  color: var(--palm-accent);
  font: inherit;
  font-size: var(--palm-t-s);
}

.palm-dd-toggle:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: var(--palm-hair);
  border-radius: var(--palm-r-s);
}

.palm-dd-list {
  display: flex;
  flex-direction: column;
  /* 2026-11-10：三组各自一串"独立卡片"看起来像三堆碎块，行距还被卡片间隙吃掉。
     现在一组 = 一张卡（圆角 + 细边），行间只用分隔线，信息密度和视觉重量都回来。 */
  gap: 0;
  margin: 0;
  padding: 0;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  overflow: hidden;
  list-style: none;
}

/* 一行文件：16px 图标 / 文件名吃剩余 / +A −D / 标签；整行 ≥44px 可点。 */
.palm-dd-row {
  display: grid;
  grid-template-columns: var(--palm-s4) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--palm-s2);
  min-block-size: var(--palm-hit);
  padding: var(--palm-s2) var(--palm-s3);
  background: none;
  border: 0;
  border-radius: 0;
  color: var(--palm-fg);
  font: inherit;
}

/* 行间分隔线挂在 li 上：行本身是按钮，画边框会跟 :active 底色打架。 */
.palm-dd-list > li + li .palm-dd-row {
  border-block-start: var(--palm-hair) solid var(--palm-line);
}

.palm-dd-row:active { background: var(--palm-sur-2); }

.palm-dd-row:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: calc(var(--palm-focus) * -1);
}

.palm-dd-icon {
  display: inline-flex;
  color: var(--palm-fg-2);
}

.palm-dd-icon > svg {
  inline-size: var(--palm-s4);
  block-size: var(--palm-s4);
}

/* 文件名两行式：主行是名字/说明，副行是暗一档的路径（各自省略号，互不挤占）。 */
.palm-dd-name {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-inline-size: 0;
  overflow: hidden;
}

.palm-dd-file,
.palm-dd-dir {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palm-dd-file {
  font-size: var(--palm-t-m);
  color: var(--palm-fg);
}

.palm-dd-dir {
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.palm-dd-tally {
  display: inline-flex;
  gap: var(--palm-s1);
  font-family: var(--palm-font-mono);
  font-size: var(--palm-t-s);
  font-variant-numeric: tabular-nums;
}

.palm-dd-add { color: var(--palm-ok); }
.palm-dd-del { color: var(--palm-danger); }

/* 「交付物」绿标：与产物页的交付物标签同一套配色。 */
.palm-dd-badge {
  padding: 0 var(--palm-s1);
  border-radius: var(--palm-r-s);
  background: var(--palm-ok-band);
  color: var(--palm-ok);
  font-size: var(--palm-t-s);
}

.palm-dd-body > p {
  margin: 0;
  font-size: var(--palm-t-m);
  color: var(--palm-fg-3);
}
/* ── 上下文占用页（P6 ⑦ 屏） ───────────────────────────────────────── */

.context-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--palm-bg);
  color: var(--palm-fg);
}

.context-page-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--palm-s4);
}

/* 占用条：原生 <progress>。宽度由浏览器按 value/max 算比例，
   不再用"四档宽度"糊（26% 曾被画成半满）。三条规则分别对应
   内核默认外观、轨道、填充；缺一条就会露出系统蓝。 */
.context-bar {
  appearance: none;
  -webkit-appearance: none;
  display: block;
  inline-size: 100%;
  block-size: 12px;
  margin: 0 0 var(--palm-s4);
  border: none;
  border-radius: var(--palm-r-s);
  background: var(--palm-sur-2);
  overflow: hidden;
}

.context-bar::-webkit-progress-bar {
  background: var(--palm-sur-2);
  border-radius: var(--palm-r-s);
}

.context-bar::-webkit-progress-value {
  background: var(--palm-accent);
  border-radius: var(--palm-r-s);
}

.context-bar::-moz-progress-bar {
  background: var(--palm-accent);
  border-radius: var(--palm-r-s);
}

/* 快满了换色：只换色，不改结构。
   2026-11-10 双皮肤实拍：纸色皮肤里 --palm-warn 与 --palm-accent 几乎同色（橄榄棕 vs 棕），
   警示档与常态档看不出区别。改用 --palm-danger：三套皮肤都与强调色拉得开，
   而且"上下文快满"本来就更接近"要出事"而不是"提示一下"。 */
.context-bar[data-pressure='high']::-webkit-progress-value { background: var(--palm-danger); }
.context-bar[data-pressure='high']::-moz-progress-bar { background: var(--palm-danger); }

.context-facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--palm-s2) var(--palm-s3);
  margin: 0 0 var(--palm-s4);
  font-size: var(--palm-t-m);
}

.context-facts dt {
  color: var(--palm-fg-2);
}

.context-facts dd {
  margin: 0;
  font-weight: var(--palm-w-bold);
}

.context-page-note {
  margin: 0;
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-3);
}

/* ── 上下文页大号数字（定版图：数字是这页的主角）────────────────── */
.context-page-figure {
  margin: 0 0 var(--palm-s2);
  display: flex;
  align-items: baseline;
  gap: var(--palm-s2);
}

.context-page-figure-value {
  font-size: var(--palm-t-2xl);
  font-weight: var(--palm-w-bold);
  line-height: var(--palm-lh-head);
  color: var(--palm-fg);
  font-variant-numeric: tabular-nums;
}

.context-page-figure-unit {
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

/* 百分比（2026-11-10）：和「已占用」同一条基线，但字号抬到 13px、二级色 ——
 * 它是这一屏真正要回答的那个数，不该比单位还弱。 */
.context-page-figure-pct {
  font-size: var(--palm-t-m);
  color: var(--palm-fg-2);
  font-variant-numeric: tabular-nums;
}
/* ── 批准方式页（P6 ⑥ 屏） ─────────────────────────────────────────── */

.approval-mode-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--palm-bg);
  color: var(--palm-fg);
}

.approval-mode-page-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--palm-s4);
}

.approval-mode-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--palm-s2);
  width: 100%;
  min-height: 44px;
  margin-bottom: var(--palm-s2);
  padding: var(--palm-s3) var(--palm-s4);
  text-align: left;
  background: var(--palm-sur-1);
  border: 1px solid var(--palm-line);
  border-radius: var(--palm-r-m);
  color: var(--palm-fg);
}

.approval-mode-row[aria-pressed='true'] {
  border-color: var(--palm-accent);
}

.approval-mode-row-name {
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
}

.approval-mode-row-mark {
  margin-left: auto;
  font-size: var(--palm-t-s);
  color: var(--palm-accent);
}

.approval-mode-row-desc {
  flex: 1 0 100%;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.approval-mode-note {
  margin: var(--palm-s4) 0 0;
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-3);
}

/* 最放开那一档的二次确认（2026-11-10）：与对话页的确认浮层同一套语义色 ——
 * 警示条用 --palm-tint-warn + --palm-warn，确认按钮描边同色，取消保持安静。 */
.approval-mode-confirm {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  margin-top: var(--palm-s2);
  padding: var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-warn);
  border-radius: var(--palm-r-m);
  background: var(--palm-tint-warn);
}

.approval-mode-confirm-text {
  margin: 0;
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-2);
}

.approval-mode-confirm-actions {
  display: flex;
  gap: var(--palm-s2);
  justify-content: flex-end;
}

.approval-mode-confirm-ok {
  border-color: var(--palm-warn);
  color: var(--palm-warn);
  font-weight: var(--palm-w-bold);
}


.approval-mode-error {
  margin: var(--palm-s3) 0 0;
  font-size: var(--palm-t-s);
  color: var(--palm-danger);
}
/* ── 用量页（2026-11-11）──────────────────────────────────────────────
 * 从设置的「其他」分组里搬出来的独立页：抽屉底部「用量」直接进。
 * 页面骨架复用 settingsLayout，这里只补三件事：页面滚动区、右上「刷新」、卡片间距。
 */

.usage-page {
  display: flex;
  flex-direction: column;
  block-size: 100%;
  min-block-size: 0;
}

/* 2026-11-12 用户：「用量这一页好像不能上下滑动查看」。
 *
 * 真正的病根在**中间那层**：UsageView 走 SlotLayout，DOM 是
 *   .usage-page > [data-slot='groups'][data-grow] > .usage-page-body
 * 而 \`[data-grow]\`（005-components.css）只给了 \`flex: 1 1 auto\`，**没有 display: flex**
 * —— 于是 \`.usage-page-body\` 不是 flex 子项，它身上的 flex/overflow 全部失效，
 * 高度按内容（1100px）长出去，整块溢出到 \`.page\`（overflow: hidden）被裁掉，
 * 手指划上去一动不动。这里把中间层也变成 flex 列，body 才真正吃剩余空间并滚动。 */
.usage-page > [data-slot='groups'] {
  display: flex;
  flex-direction: column;
  min-block-size: 0;
}

.usage-page-body {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  padding: var(--palm-s3) var(--palm-s3) var(--palm-s6);
  /* basis 归零：basis 用 auto 时浏览器先按内容高度定基准，实测不收缩。 */
  flex: 1 1 0%;
  min-block-size: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}

/* 右上角「刷新」：文字键，命中区仍按 44px 给足（手机上点小字很难）。 */
.usage-refresh {
  min-block-size: 32px;
  padding: 0 var(--palm-s2);
  border: 0;
  border-radius: var(--palm-r-s);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-t-s);
  white-space: nowrap;
}

/* 按下态与其余主键同一套令牌（不引入 color-mix：老 Android WebView 不一定支持）。 */
.usage-refresh:active { filter: brightness(var(--palm-btn-press-dim)); }

.usage-refresh:disabled {
  color: var(--palm-fg-3);
  opacity: var(--palm-btn-disabled-opacity);
}

/* 卡片之间留白：设置页里它们是同一分组内的连排，独立页要多一点呼吸。 */
.usage-page .usage-provider + .usage-provider { margin-block-start: var(--palm-s2); }
/* ── 五屏统一规格：设置 / 外观 / 产物 / 审批 / 搜索（P6 收尾切片） ────────
 *
 * 版式真源：docs/prototype/overview.html「4 · 设置」～「8 · 搜索」五个格子，
 * 口径见 docs/visual-acceptance.md「2026-11-08 最终状态」。
 *
 * 为什么单独一层：这五个屏原来各写一套（appearance-* / artifacts-* /
 * search-page-* / settings-*），同一个"分组卡 + 图标方块行"被抄了四遍，改一处
 * 其余三处就开始漂。这里把**五屏共用的四种形状**收成一层，屏里只留业务差异：
 *
 * 1. 搜索框（44 高、圆角 10、无描边）；
 * 2. 分组标题（11px 弱化 + 右侧说明）+ 分组卡（圆角 10、行内 18 图标方块）；
 * 3. 列表行（左 16px 线性 SVG + 主文案 + 右侧弱值，行高 ≥44）；
 * 4. 类型标签（交付物绿 / 改动蓝 / 警示琥珀 / 拒绝红）。
 *
 * 尺寸全部来自 000-tokens.css 的 --palm-spec-*，颜色只用 --palm-* 三档灰与语义色。
 * 语义色约束（验收口径）：危险色只用于「删除 / 失败 / 拒绝」，警示色只用于
 * 「等审批 / 卡住」；这里用 data-kind 表达，不在屏里写死颜色。
 */

/* ── ① 搜索框 ────────────────────────────────────────────────────────── */

.palm-spec-search {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  height: var(--palm-spec-search-h);
  margin: var(--palm-s2) var(--palm-s4) var(--palm-s3);
  padding: 0 var(--palm-s3);
  border: 0;
  border-radius: var(--palm-spec-search-r);
  background: var(--palm-sur-1);
  color: var(--palm-fg-3);
  font-size: 16px;
}

/* 无描边：焦点只用一圈强调色内阴影，不改变盒子尺寸。 */
.palm-spec-search:focus-within {
  box-shadow: inset 0 0 0 var(--palm-hair) var(--palm-accent);
}

.palm-spec-search > svg {
  flex: none;
  width: var(--palm-spec-glyph);
  height: var(--palm-spec-glyph);
}

.palm-spec-search-field {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--palm-fg);
  font: inherit;
  font-size: 16px;
  outline: none;
}

.palm-spec-search-field::placeholder {
  color: var(--palm-fg-3);
}

/* 搜索框与清除操作共用实体 44px 控件高度，避免热区溢入输入区域。 */
.palm-spec-search-clear {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--palm-spec-search-h);
  height: var(--palm-spec-search-h);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--palm-fg-3);
}

.palm-spec-search-clear > svg {
  width: var(--palm-spec-glyph);
  height: var(--palm-spec-glyph);
}

.palm-spec-search-clear:active {
  color: var(--palm-fg);
}

/* 列表页顶部的搜索入口：与搜索框同形，只是整块可点。 */

/* ── ② 分组标题 + 分组卡 ─────────────────────────────────────────────── */

.palm-spec-group-head {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  margin: var(--palm-s3) var(--palm-s4) var(--palm-s1);
  font-size: var(--palm-spec-head-size);
  font-weight: var(--palm-w-normal);
  line-height: var(--palm-lh-head);
  /* 二级前景色（2026-11-10 设置页实拍）：11px 三级灰在深色皮肤上几乎读不出来，
     而这是整页唯一的分区线索。与切片 6 的抽屉分组标题保持同一个口径。 */
  color: var(--palm-fg-2);
  letter-spacing: 0;
}

/* 右侧说明：与标题同档字号、同档灰度，长说明自己省略。 */
.palm-spec-group-note {
  margin-left: auto;
  max-width: 70%;
  overflow: hidden;
  color: var(--palm-fg-3);
  font-size: var(--palm-spec-head-size);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 可点的分组标题（产物页「第 N 轮 · M 个文件 ›」）：整行 ≥44 触控。 */
button.palm-spec-group-head {
  width: auto;
  min-height: var(--palm-hit);
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: var(--palm-spec-head-size);
  text-align: start;
}

button.palm-spec-group-head > svg {
  flex: none;
  width: var(--palm-spec-glyph);
  height: var(--palm-spec-glyph);
  color: var(--palm-fg-3);
}

button.palm-spec-group-head:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: calc(var(--palm-focus) * -1);
  border-radius: var(--palm-spec-card-r);
}

.palm-spec-group {
  margin: 0 var(--palm-s4) var(--palm-s3);
  padding: 0;
  list-style: none;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-spec-card-r);
  background: var(--palm-sur-1);
  overflow: hidden;
}

/* ── ③ 行：图标方块 + 主文案 + 次文案 + 右侧值 ───────────────────────── */

.palm-spec-row {
  display: grid;
  grid-template-columns: var(--palm-spec-ico) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--palm-s3);
  width: 100%;
  min-height: var(--palm-hit);
  padding: var(--palm-s2) var(--palm-s4);
  border: 0;
  border-block-start: var(--palm-hair) solid var(--palm-line);
  background: transparent;
  color: var(--palm-fg);
  font: inherit;
  text-align: start;
}

/* 卡内首行不再画分隔线（行可能是直接子节点，也可能裹在 <li> 里）。 */
.palm-spec-group > :first-child > .palm-spec-row,
.palm-spec-group > .palm-spec-row:first-child {
  border-block-start: 0;
}

/* 没有图标方块的行（搜索结果）：网格少一列，文案吃满。 */
.palm-spec-row[data-noicon] {
  grid-template-columns: minmax(0, 1fr) auto;
}

/* 选中态只用强调色描边 + 强调色右值，**不填充**（填充会把行面与卡面拉平）。 */
.palm-spec-row[aria-pressed='true'] {
  box-shadow: inset 0 0 0 var(--palm-hair) var(--palm-accent);
}

.palm-spec-row[aria-pressed='true'] .palm-spec-row-value {
  color: var(--palm-accent);
}

.palm-spec-row:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: calc(var(--palm-focus) * -1);
}

.palm-spec-row-ico {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--palm-spec-ico);
  height: var(--palm-spec-ico);
  border-radius: var(--palm-spec-ico-r);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
}

.palm-spec-row-ico > svg {
  width: var(--palm-spec-glyph);
  height: var(--palm-spec-glyph);
}

.palm-spec-row-main {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s1);
  min-width: 0;
}

.palm-spec-row-title {
  display: flex;
  align-items: center;
  gap: var(--palm-s1);
  min-width: 0;
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-normal);
  line-height: var(--palm-lh-head);
  color: var(--palm-fg);
}

/* 标题文字自己吃省略号：角标不该被长标题挤没。 */
.palm-spec-row-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palm-spec-row-sub {
  overflow: hidden;
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 命中片段给两行：一行装不下"那句话说在哪"，两行足够又不至于把列表撑散。 */
.palm-spec-row[data-lines='2'] .palm-spec-row-sub {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  white-space: normal;
}

/* 第三行细注（来源 / 命中类型）：比次文案还弱一档，永远单行。 */
.palm-spec-row-meta {
  overflow: hidden;
  font-size: var(--palm-spec-head-size);
  line-height: var(--palm-lh-head);
  color: var(--palm-fg-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palm-spec-row-value {
  display: inline-flex;
  align-items: center;
  gap: var(--palm-s1);
  max-width: 8em;
  min-width: 0;
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.palm-spec-row-value > svg {
  flex: none;
  width: var(--palm-spec-glyph);
  height: var(--palm-spec-glyph);
  color: var(--palm-fg-3);
}

/* ── ④ 类型标签 / 关键词高亮 ─────────────────────────────────────────── */

.palm-spec-tag {
  display: inline-flex;
  flex: none;
  align-items: center;
  padding: var(--palm-s1) var(--palm-s2);
  border-radius: var(--palm-r-s);
  font-size: var(--palm-t-s);
  line-height: 1;
  white-space: nowrap;
}

/* 2026-11-10：这两条原来用 color-mix 现算淡底，iOS 15 上整条声明被丢弃 → 标签变透明。
   皮肤里本来就有普通 rgba 的 --palm-tint-ok / --palm-tint-accent，直接用。 */
.palm-spec-tag[data-kind='ok'] {
  background: var(--palm-tint-ok);
  color: var(--palm-ok);
}

.palm-spec-tag[data-kind='edit'] {
  background: var(--palm-tint-accent);
  color: var(--palm-accent);
}

.palm-spec-tag[data-kind='warn'] {
  background: var(--palm-tint-warn);
  color: var(--palm-warn);
}

.palm-spec-tag[data-kind='danger'] {
  background: var(--palm-tint-danger);
  color: var(--palm-danger);
}

/* 命中片段里的关键词：强调色，不加粗（中文合成加粗会糊）。 */
.palm-spec-mark {
  padding: 0 var(--palm-s1);
  border-radius: var(--palm-s1);
  background: var(--palm-tint-accent);
  color: var(--palm-accent);
  font-style: normal;
  font-weight: var(--palm-w-normal);
}

/* ── ⑤ 皮肤卡（外观页）：选中 = 强调色描边，不填充 ───────────────────── */

.palm-spec-skins {
  display: flex;
  gap: var(--palm-s2);
  margin: 0 var(--palm-s4) var(--palm-s3);
}

.palm-spec-skin {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: stretch;
  gap: var(--palm-s1);
  min-width: 0;
  padding: var(--palm-s2);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-spec-skin-r);
  background: var(--palm-sur-1);
  color: var(--palm-fg);
  font: inherit;
  text-align: center;
}

/* 选中态只加描边 + 一圈淡色光晕，卡面颜色不变（填充会把色板读串）。 */
.palm-spec-skin[aria-pressed='true'] {
  border-color: var(--palm-accent);
  box-shadow: 0 0 0 var(--palm-focus) var(--palm-tint-accent);
}

.palm-spec-skin:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: var(--palm-hair);
}

.palm-spec-skin-sw {
  height: var(--palm-spec-swatch);
  border-radius: var(--palm-r-s);
  background: var(--palm-spec-skin-bg);
  /* 深色皮肤（石墨 / 夜航）的底色和深色页面几乎同色，没有这道内描边就看不出卡片边界。 */
  box-shadow: inset 0 0 0 var(--palm-hair) var(--palm-line);
}

.palm-spec-skin-name {
  overflow: hidden;
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-head);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palm-spec-skin-hint {
  overflow: hidden;
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-head);
  color: var(--palm-fg-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palm-spec-skin[aria-pressed='true'] .palm-spec-skin-hint {
  color: var(--palm-accent);
}

/* 三张卡各自的色板：色值落在令牌层，这里只做映射。
 * 2026-11-10 外观页截图：原来是「底色 → 强调色」的 140° 对角渐变，石墨（中性灰）
 * 被画成一块蓝紫，三张卡看着都是"蓝色皮肤"。现在**底色占 64% 为主**，强调色只在
 * 底边留一条带 —— 一眼能认出是石墨 / 纸 / 夜航，强调色也仍然在。 */
.palm-spec-skin[data-skin='graphite'] {
  --palm-spec-skin-bg:
    linear-gradient(180deg, transparent 0 82%, var(--palm-skin-graphite-ink) 82%),
    var(--palm-skin-graphite-bg);
}

.palm-spec-skin[data-skin='paper'] {
  --palm-spec-skin-bg:
    linear-gradient(180deg, transparent 0 82%, var(--palm-skin-paper-ink) 82%),
    var(--palm-skin-paper-bg);
}

.palm-spec-skin[data-skin='nocturne'] {
  --palm-spec-skin-bg:
    linear-gradient(180deg, transparent 0 82%, var(--palm-skin-nocturne-ink) 82%),
    var(--palm-skin-nocturne-bg);
}

/* ── ⑥ 五屏页壳：一列、正文自己滚，页脚说明统一 12px 弱灰 ─────────────── */

.palm-spec-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--palm-bg);
  color: var(--palm-fg);
}

/* grow 槽本身不是滚动容器：它只把高度传给里面的 .palm-spec-body。 */
.palm-spec-page > [data-grow] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.palm-spec-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--palm-s2) 0 var(--palm-s4);
}

.palm-spec-foot {
  margin: 0;
  padding: var(--palm-s2) var(--palm-s4) var(--palm-s4);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-3);
}
/* ── 皮肤商店（2026-11-11）──────────────────────────────────────────────
 * 全屏浮层：两列卡片网格，每张卡上半是这套配色的迷你界面。
 * 颜色一律由卡片自己的行内变量给（皮肤是"预览一份别人的配色"，不能用当前皮肤
 * 的令牌，否则预览会跟着当前皮肤变）。
 */

.skin-store-hint {
  margin: 0 0 var(--palm-s3);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.skin-store-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--palm-s2);
}

.skin-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--palm-s1);
  inline-size: 100%;
  padding: 0 0 var(--palm-s2);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  color: var(--palm-fg);
  font: inherit;
  text-align: start;
  overflow: hidden;
}

.skin-card-on {
  border-color: var(--palm-accent);
  box-shadow: inset 0 0 0 var(--palm-hair) var(--palm-accent);
}

.skin-card:active { filter: brightness(var(--palm-btn-press-dim)); }

/* 迷你界面：只用**那一套皮肤自己的底色与强调色**画三块（顶栏 / 气泡 / 输入条）。
 * 色值落在 000-tokens.css 的 --palm-skin-*-bg/-ink 上，这里只做映射，不写裸色。 */
.skin-card-shot {
  display: flex;
  flex-direction: column;
  gap: 6px;
  block-size: 96px;
  padding: var(--palm-s2);
  border-block-end: var(--palm-hair) solid var(--palm-line);
  background: var(--palm-skin-shot-bg);
}

.skin-card-shot[data-skin='graphite'] {
  --palm-skin-shot-bg: var(--palm-skin-graphite-bg);
  --palm-skin-shot-ink: var(--palm-skin-graphite-ink);
}

.skin-card-shot[data-skin='paper'] {
  --palm-skin-shot-bg: var(--palm-skin-paper-bg);
  --palm-skin-shot-ink: var(--palm-skin-paper-ink);
}

.skin-card-shot[data-skin='nocturne'] {
  --palm-skin-shot-bg: var(--palm-skin-nocturne-bg);
  --palm-skin-shot-ink: var(--palm-skin-nocturne-ink);
}

.skin-card-shot[data-skin='newsprint'] {
  --palm-skin-shot-bg: var(--palm-skin-newsprint-bg);
  --palm-skin-shot-ink: var(--palm-skin-newsprint-ink);
}

.skin-card-shot[data-skin='endfield'] {
  --palm-skin-shot-bg: var(--palm-skin-endfield-bg);
  --palm-skin-shot-ink: var(--palm-skin-endfield-ink);
}

.skin-card-shot[data-skin='claude'] {
  --palm-skin-shot-bg: var(--palm-skin-claude-bg);
  --palm-skin-shot-ink: var(--palm-skin-claude-ink);
}

.skin-card-shot-bar {
  inline-size: 46px;
  block-size: var(--palm-s1);
  border-radius: 2px;
  background: var(--palm-skin-shot-ink);
  opacity: 0.35;
}

.skin-card-shot-bubble {
  inline-size: 74%;
  block-size: 26px;
  border-radius: 10px 10px 10px 3px;
  background: var(--palm-skin-shot-ink);
  opacity: 0.16;
}

.skin-card-shot-input {
  margin-block-start: auto;
  block-size: 16px;
  border-radius: var(--palm-r-s);
  background: var(--palm-skin-shot-ink);
  opacity: 0.85;
}

.skin-card-name {
  padding-inline: var(--palm-s2);
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
}

.skin-card-hint {
  padding-inline: var(--palm-s2);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-2);
}

/* 来源与许可：一直显示，不藏进详情页（2026-11-11 用户要求）。 */
.skin-card-source {
  padding-inline: var(--palm-s2);
  font-size: 11px;
  color: var(--palm-fg-3);
}

.skin-card-tick {
  position: absolute;
  inset-block-start: var(--palm-s2);
  inset-inline-end: var(--palm-s2);
  display: grid;
  place-items: center;
  inline-size: 20px;
  block-size: 20px;
  border-radius: 50%;
  background: var(--palm-accent);
  color: var(--palm-on-accent);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-bold);
}

.skin-store-foot {
  display: flex;
  gap: var(--palm-s2);
  margin-block-start: var(--palm-s3);
  padding-block-end: var(--palm-s2);
}

.skin-store-foot > .mobile-button { flex: 1 1 0; }
/* ── 子代理详情页（2026-11-11）────────────────────────────────────────
 *
 * 为什么单独一个文件：这一页是新的独立屏（\`views/SubagentView.tsx\`），
 * 抽屉/会话页那几份样式已经很长，混进去以后没人找得到。
 * 放在 5xx 段：它是页面级样式，不是装饰层（6xx 才是皮肤装饰）。
 *
 * 只准用令牌（\`--palm-*\`）：\`design/no-raw-colors.test.ts\` 会扫这个文件。
 */

/* 滚动三段式（照 480-outline-page.css 的样板，2026-11-12 修「上下滑不动」）：
 *   ① 页面根自己是 flex 列、吃满高度；
 *   ② grow 槽只负责限高（overflow:hidden），不自带滚动；
 *   ③ 正文 \`flex:1 + min-block-size:0 + overflow-y:auto\` 才是滚动容器。
 * 少了 ②③ 那两条，内容超出屏幕既不滚、还会被裁掉 —— 用户看到的就是「滑不动」。 */
.subagent-page {
  display: flex;
  flex-direction: column;
  block-size: 100%;
  min-block-size: 0;
}

.subagent-page [data-slot='groups'] {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.subagent-page-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-block-size: 0;
  gap: var(--palm-s3);
  padding: var(--palm-s3) var(--palm-s3) calc(var(--palm-s3) * 4);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

/* 头部：任务名用衬线标题（与设置页同一套层级），状态徽标单独一行。 */
.subagent-hero {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
}

.subagent-name {
  margin: 0;
  font-size: var(--palm-t-l);
  font-weight: 600;
  line-height: 1.3;
  color: var(--palm-fg);
}

.subagent-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--palm-s2);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.subagent-state {
  display: inline-flex;
  align-items: center;
  padding: 1px var(--palm-s2);
  border-radius: var(--palm-r-s);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
  font-size: var(--palm-t-s);
}

.subagent-state-live {
  background: var(--palm-tint-ok);
  color: var(--palm-ok);
}

/* 折叠态也要能回答「它现在在干什么」：一行最近一步。 */
.subagent-last {
  display: flex;
  align-items: flex-start;
  gap: var(--palm-s2);
  padding: var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
}

.subagent-last-dot {
  width: 6px;
  height: 6px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--palm-ok);
  flex: none;
}

.subagent-last-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.subagent-last-head {
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.subagent-last-detail {
  font-size: var(--palm-t-m);
  color: var(--palm-fg);
  overflow-wrap: anywhere;
}

/* 「前面还有 N 步」：与抽屉里的折叠按钮同一手感。 */
.subagent-fold {
  align-self: flex-start;
  padding: var(--palm-s1) var(--palm-s2);
  border: 0;
  border-radius: var(--palm-r-s);
  background: transparent;
  color: var(--palm-accent);
  font-size: var(--palm-t-s);
}

/* 过程：一条工具 = 一个圆点 + 名字 + 参数摘要 + 时间。 */
.subagent-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.subagent-step {
  display: flex;
  gap: var(--palm-s2);
  padding: var(--palm-s2) 0;
  position: relative;
}

.subagent-step + .subagent-step {
  border-top: var(--palm-hair) solid var(--palm-line);
}

.subagent-step-dot {
  width: 6px;
  height: 6px;
  margin-top: 7px;
  border-radius: 2px;
  background: var(--palm-accent);
  flex: none;
}

.subagent-step-dot-text {
  background: var(--palm-fg-3);
  border-radius: 50%;
}

.subagent-step-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.subagent-step-name {
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.subagent-step-detail {
  font-size: var(--palm-t-m);
  color: var(--palm-fg);
  overflow-wrap: anywhere;
}

.subagent-step-time {
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

/* 当前输出：正文用等宽折行，长输出也不横向滚。 */
.subagent-output {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s1);
  padding: var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
}

.subagent-output-head {
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.subagent-output-body {
  margin: 0;
  font-size: var(--palm-t-m);
  line-height: 1.5;
  color: var(--palm-fg);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* 外壳：吃满 grow 槽的高度，正文在上、动作条在下（body 自己滚，动作条不动）。 */
.subagent-page-shell {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-block-size: 0;
  block-size: 100%;
}

/* 动作条钉在屏幕底部（2026-11-12 用户要求）：不随正文滚；
   底部留白吃掉安全区，免得按钮压在 home 条上。 */
.subagent-actions {
  display: flex;
  flex: none;
  gap: var(--palm-s2);
  padding: var(--palm-s2) var(--palm-s3) calc(var(--palm-s2) + env(safe-area-inset-bottom, 0px));
  border-top: var(--palm-hair) solid var(--palm-line);
  background: var(--palm-bg);
}

.subagent-actions > * {
  flex: 1;
}

/* 运行状态面板里可点的子代理行：右侧箭头，告诉用户「这一行点得进去」。 */
.chat-subagent-row-open {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}

.chat-subagent-chev {
  margin-left: auto;
  color: var(--palm-fg-3);
  font-size: var(--palm-t-m);
  flex: none;
}
/* ── 组合件样式（2026-11-10 重设计：原语层） ────────────────────────────
   对应 ui/primitives.tsx 里的 SectionHeader / SectionCard / ResultRow / ActionBar。
   规则：这里**只许出现令牌**，不写十六进制、不写 rgb()、不写魔法数字圆角。
   structure 用例会拦「裸色」与「页面自己写的圆角」。 */

.palm-section-head {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  padding: var(--palm-s3) 0;
}

.palm-section-title {
  margin: 0;
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-bold);
  letter-spacing: 0.02em;
  color: var(--palm-fg-2);
}

.palm-section-gap { flex: 1; }

.palm-section-hint {
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.palm-section-action {
  min-height: var(--palm-hit);
  padding: 0 var(--palm-s2);
  border: 0;
  background: transparent;
  color: var(--palm-accent);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-bold);
}

[data-section-card] {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  padding: var(--palm-s3) var(--palm-s4);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
}

/* 浮层：压在卡片之上（审批块、待发队列、浮窗内容）。必须是可分辨的第三层，
   所以用 --palm-sur-2 而不是把 sur-1 再加一层透明。 */
[data-section-card][data-level='raised'] {
  background: var(--palm-sur-2);
}

.palm-section-body {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  font-size: var(--palm-t-m);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg);
}

[data-result-row] {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  min-height: var(--palm-hit);
  font-size: var(--palm-t-s);
}

.palm-result-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  color: var(--palm-fg-2);
}

.palm-result-add { color: var(--palm-ok); font-weight: var(--palm-w-bold); }
.palm-result-del { color: var(--palm-danger); font-weight: var(--palm-w-bold); }
.palm-result-gap { flex: 1; }

.palm-result-action {
  min-height: var(--palm-hit);
  padding: 0 var(--palm-s2);
  border: 0;
  background: transparent;
  color: var(--palm-accent);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-bold);
}

.palm-action-bar {
  display: flex;
  gap: var(--palm-s2);
  padding-top: var(--palm-s2);
}

.palm-action-primary,
.palm-action-secondary {
  min-height: var(--palm-hit);
  border-radius: var(--palm-r-m);
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
}

/* 主操作实心强调色：深浅皮肤都靠 --palm-on-accent 保证字读得出来。 */
.palm-action-primary {
  flex: 1.4;
  border: 0;
  background: var(--palm-accent);
  color: var(--palm-on-accent);
}

.palm-action-secondary {
  flex: 1;
  border: var(--palm-hair) solid var(--palm-line);
  background: transparent;
  color: var(--palm-fg-2);
}

.palm-action-primary:disabled,
.palm-action-secondary:disabled { opacity: var(--palm-btn-disabled-opacity); }
/* ── 报纸皮肤（newsprint）的装饰层（2026-11-11）────────────────────────────
 * 移植自 2754LM/dsh-theme-newsprint（MIT）。底色与墨色在 000-tokens.css 的
 * \`html[data-skin='newsprint']\` 块里；这里只放**颜色令牌表达不了**的部分：
 * 衬线正文、报头双线、栏目小标题的小型大写间距。
 *
 * 为什么字体也放进皮肤：桌面上那份皮肤的签名就是「衬线正文 + 报纸笔画」，
 * 只换颜色会变成"浅色版的石墨"，用户一眼认不出这是报纸。
 */

/* 正文用衬线（字族在令牌里给，缺字体时自然回落到系统无衬线）。 */
html[data-skin='newsprint'] body {
  letter-spacing: 0.01em;
}

/* 报头：标题用衬线加粗。
 * 2026-11-11 用户：「标题栏下方那条黑色横线是什么」—— 那是这里原本画的一条
 * \`inset 0 -2px 0 var(--palm-fg)\` 墨线（仿报纸页眉）。手机屏上它太重，又和 header
 * 自带的 1px \`--border-subtle\` 叠在一起，看起来就是一条突兀的黑杠 —— **已删掉**。
 * 分隔仍然有：\`.mobile-header\` 自己的 1px 底边在。想要回墨线就恢复上面那条规则。 */
html[data-skin='newsprint'] .mobile-title {
  font-family: var(--palm-font-sans);
  font-weight: var(--palm-w-bold);
  letter-spacing: 0.06em;
}

/* 分组小标题：拉开字距，像报纸的栏目名。 */
html[data-skin='newsprint'] .palm-spec-group-head {
  letter-spacing: 0.12em;
}

/* 引用块与分隔线：用墨色细线，而不是圆角卡片。 */
html[data-skin='newsprint'] blockquote {
  border-inline-start: 3px solid var(--palm-accent);
  padding-inline-start: var(--palm-s2);
}
/* ── Claude 皮肤（claude）的装饰层（2026-11-11）─────────────────────────────
 * 移植自 Nwflower/dsh-claude-style（MIT，556★）。底色/墨色/陶土橙在
 * 000-tokens.css 的 \`html[data-skin='claude']\` 块里；这里只放**颜色令牌表达不了**的部分：
 * 衬线标题、极细的暖边、引用块的橙线。
 *
 * 为什么这些必须单独一层：Claude 桌面端的辨识度有一半来自「衬线大标题 + 几乎看不见的边框」，
 * 只把底色换成米白，看起来就是"另一个浅色主题"。
 */

/* 标题走衬线：Claude 的标题是 serif，正文仍是无衬线。 */
html[data-skin='claude'] .mobile-title {
  font-family: Georgia, 'Songti SC', 'Noto Serif CJK SC', serif;
  font-weight: 600;
  letter-spacing: 0;
}

/* 分隔线压到几乎看不见：Claude 用暖灰细线，而不是 1px 实色的"分割条"。 */
html[data-skin='claude'] .mobile-header {
  box-shadow: inset 0 -1px 0 var(--palm-line);
}

/* 分组小标题降一档字重、不加字距 —— 桌面端是安静的灰字，不是标签。 */
html[data-skin='claude'] .palm-spec-group-head {
  font-weight: 500;
  letter-spacing: 0;
}

/* 引用块：陶土橙竖线，跟强调色同一个来源。 */
html[data-skin='claude'] blockquote {
  border-inline-start: 3px solid var(--palm-accent);
  padding-inline-start: var(--palm-s2);
}

/* 代码块：桌面端是"浅一档的纸"，不是深色底板，也不该有大圆角。 */
html[data-skin='claude'] .code-block {
  border-color: var(--palm-line);
}

html[data-skin='claude'] .code-head {
  background: var(--palm-sur-2);
}
`;
