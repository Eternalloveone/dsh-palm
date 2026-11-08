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

  /* ── 物性 ── */
  --palm-hi: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --palm-sh1: 0 1px 2px rgba(0, 0, 0, 0.45);
  --palm-sh2: 0 6px 20px rgba(0, 0, 0, 0.55);

  /* ── 触摸目标 ── */
  --palm-hit: 44px;

  /* 物性：1px 细线与焦点环宽度（组件层不写裸 px） */
  --palm-hair: 1px;
  --palm-focus: 2px;

  /* ── 状态条（32px 主条 + 22px 迷你条 + 方案 A 刻度轨） ───────────────
   * 版式真源：docs/prototype/pet-strip-v5.html ① / overview.html「2 · 会话正文」。
   * 渐变与宠物墨色按 11 种任务状态各一份：组件样式里不再出现裸色值。 */
  --palm-strip-h: 32px;
  --palm-strip-r: 11px;
  --palm-strip-mini-w: 132px;
  --palm-strip-mini-h: 22px;
  --palm-strip-mini-r: 8px;
  --palm-strip-pet: 20px;
  --palm-strip-pet-mini: 12px;
  --palm-strip-rail-h: 5px;
  --palm-strip-rail-r: 3px;
  --palm-strip-rail-gap: 3px;
  --palm-strip-rail-mt: 6px;
  --palm-strip-track: #101016;
  --palm-strip-border: rgba(255, 255, 255, 0.08);
  --palm-strip-fg: #f4f6fb;
  --palm-strip-detail-fg: rgba(255, 255, 255, 0.62);
  --palm-strip-right-fg: rgba(255, 255, 255, 0.8);
  --palm-strip-text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  --palm-strip-gloss: linear-gradient(180deg, rgba(255, 255, 255, 0.13), rgba(255, 255, 255, 0) 60%);
  --palm-strip-pet-body: rgba(4, 8, 14, 0.55);
  --palm-strip-pet-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
  --palm-strip-grad-think: linear-gradient(100deg, #2b2a72, #4a49b8);
  --palm-strip-grad-read: linear-gradient(100deg, #123a56, #1c6f9c);
  --palm-strip-grad-edit: linear-gradient(100deg, #14395a, #1f6f8e);
  --palm-strip-grad-test: linear-gradient(100deg, #0f3a55, #1a6f96);
  --palm-strip-grad-approve: linear-gradient(100deg, #5a3f08, #8a6318);
  --palm-strip-grad-stuck: linear-gradient(100deg, #4a3306, #6f4f12);
  --palm-strip-grad-done: linear-gradient(100deg, #0d5033, #177a4a 52%, #2b2a72);
  --palm-strip-grad-failed: linear-gradient(100deg, #5c1327, #8c1f38);
  --palm-strip-grad-stopped: linear-gradient(100deg, #2a2a33, #3f3f4d);
  --palm-strip-grad-queued: linear-gradient(100deg, rgba(124, 140, 255, 0.1), rgba(124, 140, 255, 0.02));
  --palm-strip-grad-unknown: linear-gradient(100deg, #2b2a72, #4a49b8);
  --palm-strip-ink-think: #cfd4ff;
  --palm-strip-ink-read: #a9e6ff;
  --palm-strip-ink-edit: #9fd8ff;
  --palm-strip-ink-test: #a9e6ff;
  --palm-strip-ink-approve: #ffd98a;
  --palm-strip-ink-stuck: #ffd98a;
  --palm-strip-ink-done: #c8f8db;
  --palm-strip-ink-failed: #ffb3c0;
  --palm-strip-ink-stopped: #d5d7e2;
  --palm-strip-ink-queued: #9aa0ae;
  --palm-strip-ink-unknown: #cfd4ff;
  --palm-strip-rail-todo: rgba(255, 255, 255, 0.1);
  --palm-strip-rail-done: linear-gradient(90deg, #2fbf74, #3ddc84);
  --palm-strip-rail-now: linear-gradient(90deg, #4b4ae0, #7c8cff);

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
  --palm-flow-dot: 7px;
  --palm-flow-card-r: 14px;
  --palm-flow-rule: rgba(255, 255, 255, 0.05);
  --palm-flow-card-line: rgba(61, 220, 132, 0.22);
  --palm-flow-card-bg: linear-gradient(180deg, rgba(61, 220, 132, 0.06), rgba(20, 20, 27, 0.9));
  --palm-flow-tag-ok: rgba(61, 220, 132, 0.14);
  --palm-flow-tag-edit: rgba(124, 140, 255, 0.14);
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
  --palm-fg-3: #70707f;
  --palm-accent: #7c8cff;
  --palm-accent-2: #a78bfa;
  --palm-ok: #3ddc84;
  --palm-warn: #e0a52c;
  --palm-danger: #ff6b81;
  --palm-tint-warn: rgba(224, 165, 44, 0.12);
  --palm-tint-ok: rgba(61, 220, 132, 0.1);
  --palm-tint-danger: rgba(255, 107, 129, 0.12);
  --palm-tint-accent: rgba(124, 140, 255, 0.14);
  --palm-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 10px 30px rgba(0, 0, 0, 0.6);
  color-scheme: dark;
}

/* ═══════════ 皮肤：纸（暖白 / 印刷感 / 更小圆角） ═══════════ */
html[data-skin='paper'] {
  --palm-r-s: 6px;
  --palm-r-m: 10px;
  --palm-r-l: 14px;
  --palm-bg: #faf8f4;
  --palm-sur-1: #ffffff;
  --palm-sur-2: #f2eee7;
  --palm-line: rgba(28, 26, 23, 0.12);
  --palm-fg: #1c1a17;
  --palm-fg-2: #5d5852;
  --palm-fg-3: #8b857e;
  --palm-accent: #8a5a2b;
  --palm-accent-2: #b8804a;
  --palm-ok: #2f8f5b;
  --palm-warn: #a97617;
  --palm-danger: #b8455a;
  --palm-tint-warn: rgba(169, 118, 23, 0.1);
  --palm-tint-ok: rgba(47, 143, 91, 0.1);
  --palm-tint-danger: rgba(184, 69, 90, 0.1);
  --palm-tint-accent: rgba(138, 90, 43, 0.1);
  --palm-hi: inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --palm-sh1: 0 1px 2px rgba(28, 26, 23, 0.08);
  --palm-sh2: 0 6px 20px rgba(28, 26, 23, 0.12);
  --palm-shadow: 0 0 0 1px rgba(28, 26, 23, 0.1), 0 10px 30px rgba(28, 26, 23, 0.14);
  color-scheme: light;
}

/* ═══════════ 皮肤：夜航（深蓝 / 霓虹 / 更圆） ═══════════ */
html[data-skin='nocturne'] {
  --palm-r-s: 10px;
  --palm-r-m: 14px;
  --palm-r-l: 20px;
  --palm-bg: #080c14;
  --palm-sur-1: #0f1520;
  --palm-sur-2: #16203010;
  --palm-line: rgba(120, 180, 255, 0.14);
  --palm-fg: #e8f1ff;
  --palm-fg-2: #9db3d1;
  --palm-fg-3: #64789a;
  --palm-accent: #22d3ee;
  --palm-accent-2: #818cf8;
  --palm-ok: #34d399;
  --palm-warn: #fbbf24;
  --palm-danger: #fb7185;
  --palm-tint-warn: rgba(251, 191, 36, 0.12);
  --palm-tint-ok: rgba(52, 211, 153, 0.1);
  --palm-tint-danger: rgba(251, 113, 133, 0.12);
  --palm-tint-accent: rgba(34, 211, 238, 0.12);
  --palm-hi: inset 0 1px 0 rgba(120, 180, 255, 0.14);
  --palm-sh1: 0 1px 2px rgba(0, 0, 0, 0.6);
  --palm-sh2: 0 6px 22px rgba(0, 0, 0, 0.7);
  --palm-shadow: 0 0 0 1px rgba(120, 180, 255, 0.16), 0 10px 30px rgba(0, 0, 0, 0.7);
  color-scheme: dark;
}

/* ── 旧名桥接（一次性）：历史样式的 767 处引用改由上面的 --palm-* 驱动 ──
   designTokensCss() 先注入，这一段在它之后，因此这里的映射会覆盖旧字面值。
   下一步是把旧名逐批替换掉，届时删掉本段即可。 */
:root {
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
  font-family: var(--font-sans);
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
.mobile-list::-webkit-scrollbar,
.chat-scroll::-webkit-scrollbar,
.sheet-body::-webkit-scrollbar,
.code-block pre::-webkit-scrollbar {
  width: 3px;
  height: 3px;
}

.mobile-scroll::-webkit-scrollbar-thumb,
.mobile-list::-webkit-scrollbar-thumb,
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

/* ── header: 48px + safe-area, frosted glass ─────────────────────────── */

.mobile-header {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
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
}

.mobile-titleInline {
  display: block;
}

/* Path metadata: small, mono, subordinate — never competing with the title. */
.mobile-titlePath {
  margin: 1px 0 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 400;
  line-height: 1.3;
  color: var(--text-quaternary);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── icon buttons (48px hot zones) ───────────────────────────────────── */

.mobile-back,
.mobile-theme-toggle,
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
.mobile-theme-toggle:active,
.mobile-iconbtn:active {
  background: var(--fill);
  transform: scale(0.94);
}

.mobile-theme-toggle svg,
.mobile-iconbtn svg {
  width: 20px;
  height: 20px;
}

.mobile-headerAction {
  flex: none;
  height: 44px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.mobile-headerAction:active {
  background: var(--accent-soft);
}

/* ── quick actions bar ───────────────────────────────────────────────── */

.mobile-quickbar {
  flex: none;
  display: flex;
  gap: var(--space-2);
  padding: 10px 16px 6px;
  overflow-x: auto;
  scrollbar-width: none;
}

.mobile-quickbar::-webkit-scrollbar {
  display: none;
}

.mobile-quickchip {
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

.mobile-quickchip svg {
  width: 15px;
  height: 15px;
}

.mobile-quickchip:active {
  transform: scale(0.96);
  background: var(--fill-strong);
}

.mobile-quickchip-on {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}

/* Run-overview quick chip: live dot pulses while anything is running and
   the live count rides beside the label (same chip grammar as pin/recent). */
.mobile-quickchip-live {
  border-color: color-mix(in srgb, var(--positive) 40%, transparent);
  color: var(--text-primary);
}

.quick-live-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--positive);
  animation: breathe 1.6s ease-in-out infinite;
}

.quick-live-dot-off {
  background: var(--text-quaternary);
  animation: none;
}

.quick-live-count {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: var(--positive);
}

.mobile-search {
  flex: none;
  padding: 6px 16px 8px;
}

.mobile-searchInput {
  width: 100%;
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: 16px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.mobile-searchInput:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

/* ── 空态（P6 ⑯）：先说清，再给一步 ───────────────────────────────── */

.empty-state {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  padding: var(--palm-s5) var(--palm-s4);
  text-align: center;
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


/* 图标槽位（定版图：空态 = 图标 + 标题 + 主按钮） */
.empty-state-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-bottom: var(--palm-s2);
  border-radius: var(--palm-r-full);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
}

.empty-state-icon > svg {
  width: 16px;
  height: 16px;
}
/* ── 失败态（P6 ⑰）：留住错误，给得起重试 ─────────────────────────── */

.error-note {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  margin: var(--palm-s3) 0;
  padding: var(--palm-s3) var(--palm-s4);
  background: var(--palm-sur-1);
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

.mobile-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  list-style: none;
  margin: 0;
  padding: 4px 0 calc(env(safe-area-inset-bottom, 0px) + 16px);
}

/* 分组标题（定版图）：12px 灰字「今天 · 3」，上 8 / 下 4 的留白。
   原来是一条 32px 高、全大写的标签——它比行标题还抢眼，而分组只是路标。 */
.mobile-groupTitle {
  padding: var(--palm-s2) var(--palm-s4) var(--palm-s1);
  display: block;
  margin: 0;
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-normal);
  letter-spacing: 0;
  text-transform: none;
  line-height: var(--palm-lh-head);
}

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
  background: color-mix(in srgb, var(--text-primary) 5%, var(--card-bg));
  border-color: var(--border-default);
}

/* ── 会话行卡（定版图）：三行信息卡 ────────────────────────────────────
   一行标题 17/600、二行「状态胶囊 + 时间 + 箭头」、三行一行预览。整卡是
   表面色 + 1px hairline，12 圆角，内边距 12/14 —— 所以这里的 .sess-card 要
   盖掉通用卡的图标列网格（48/36px 图标列在这三行里没有位置）。
   横向 14px 是定版图给的档位，令牌里只有 12 / 16，中间这一档单独写死。 */
.sess-card {
  display: block;
  min-height: 0;
  padding: var(--palm-s3) 14px;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  box-shadow: none;
}

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
.mobile-row-swipe-action {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: var(--danger);
  color: #fff;
  font: inherit;
  font-size: var(--text-md);
  font-weight: 500;
  cursor: pointer;
}
.mobile-row-swipe-inner {
  transition: transform 0.2s ease;
}
.mobile-row-swipe-inner.swiped {
  transform: translateX(-80px);
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
.ws-icon-active > * {
  background: color-mix(in srgb, var(--positive) 15%, transparent);
  color: var(--positive);
}

.ws-icon-code > * {
  background: var(--accent-soft);
  color: var(--accent);
}

/* Content zone. */
.card-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 12px 0;
}

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

.card-titleText {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-subtitle {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: 1.4;
  color: var(--text-quaternary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.card-badge {
  padding: 4px 10px;
  border-radius: var(--radius-chip);
  background: var(--bg-elevated);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: 1.3;
  white-space: nowrap;
}

.mobile-chevron {
  flex: none;
  color: var(--text-quaternary);
  font-size: 18px;
  line-height: 1;
}

/* Legacy column layout still used by a few stacked rows (settings forms). */
.mobile-rowMain {
  grid-column: 1 / -1;
  min-width: 0;
  padding: 14px 0;
}


.mobile-rowTitle {
  flex: 1;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  font-size: var(--text-base);
  font-weight: 500;
  line-height: 1.4;
}


/* Active workspace: 3px accent rail + tinted icon. */
.mobile-row-active {
  border-color: color-mix(in srgb, var(--accent) 38%, var(--card-border));
}

.mobile-row-active::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: var(--radius-full);
  background: var(--accent);
}

.ws-pin {
  flex: none;
  display: flex;
  color: var(--warning);
}

.ws-pin svg {
  width: 12px;
  height: 12px;
}

.sess-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--text-muted);
}

/* 状态点是 8px 的小圆，不是图标：.card-icon > * 会把直接子元素撑成 40px 的
   圆角方块，运行中的绿点于是变成一个绿色大方块（真机反馈 2026-10-20）。这里用
   两个类名的选择器压回去，勾选标记也一并放回自然尺寸（它本来没有底板）。 */
.card-icon > .sess-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}

.card-icon > .sess-check {
  width: auto;
  height: auto;
  border-radius: 0;
}

/* Title line: the title owns the line and wraps instead of truncating.
   日期与状态移到下一行的小字里（.sess-meta）：原来是"标题 · 日期"挤在一行，
   标题被日期挤成一截加省略号，看不全会话名。 */
.sess-titleline {
  display: block;
  min-width: 0;
}

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

.sess-sep {
  flex: none;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.sess-time {
  /* 不可压缩：原来是 flex: 0 1 auto + min-width:0 + ellipsis，标题一长就把日期
     挤成 "09-1…"（真机截图）。标题本来就该承担压缩（它已经显示成 "子代理状态展…"），
     日期必须完整可读 —— 只读信息不该被省略号吃掉。 */
  flex: none;
  white-space: nowrap;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
  font-variant-numeric: tabular-nums;
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

.mobile-createCard {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  width: calc(100% - 32px);
  margin: 4px 16px 16px;
  min-height: 56px;
  border: 1.5px dashed var(--border-default);
  border-radius: var(--radius-card);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
}

.mobile-createCard svg {
  width: 16px;
  height: 16px;
}

.mobile-createCard:active {
  transform: scale(0.98);
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}

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
.settings-badge-sync { background: var(--accent-soft, #eef1ff); color: var(--accent, #4d6bfe); }
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
  color: var(--accent, #4d6bfe);
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
  border-left: 2px solid var(--accent-soft, #eef1ff);
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
.settings-inboxKind-turn-done { background: var(--accent-soft, #eef1ff); color: var(--accent, #4d6bfe); }
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
.mobile-welcome {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 10px 14px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--accent-soft, #eef1ff);
  border: 1px solid var(--accent-soft);
}
.mobile-welcomeCopy { flex: 1; min-width: 0; }
.mobile-welcomeTitle {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 3px;
}
.mobile-welcomeDesc {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0;
  overflow-wrap: anywhere;
}
/* 首次引导里的「知道了」：40x24 太难点（审计实测），给到 32px 高 */
.mobile-welcomeClose {
  /* 32 → 40：首页新手卡上的「知道了」是拇指常按的位置（真机清单第 5 项，
     实测 56×32 是全站除聊天页外唯一一个不足 40px 的可点控件）。 */
  min-height: 40px;
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: var(--accent, #4d6bfe);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  cursor: pointer;
}

/* Legend under the search box explaining the badges. Two-column grid:
   badge column fixed, text column left-aligned — every explanation starts
   at the same x, and the rows never reflow into ragged starts. */

/* Group title trailing hint (e.g. 显示效果). */
.settings-groupDesc {
  font-weight: 400;
  font-size: 10.5px;
  color: var(--text-tertiary);
  text-transform: none;
  letter-spacing: 0;
  margin-left: 4px;
}

/* Host-side voice services hint on the voice page. */
.settings-hostNote {
  margin: 0 16px 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--accent-soft, #eef1ff);
  color: var(--accent, #4d6bfe);
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
  color: var(--accent, #4d6bfe);
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
.usage-badge-ok { background: var(--accent-soft); color: var(--accent); }
.usage-badge-no { background: rgba(245, 158, 11, 0.14); color: var(--warning); }
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
  background: linear-gradient(90deg, var(--accent), #8b5cf6);
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

.settings-themeOptions {
  display: flex;
  gap: 6px;
}

.settings-themeOption {
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

.settings-themeOption:active {
  transform: scale(0.96);
}

.settings-themeOption-on {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}/* Toggle switch: 44 × 24, 12px radius, accent when on. */
/* 审计实测 44x24：开关本体只有 24px 高，拇指容易点空。
   视觉轨道保持 24，热区加到 32（padding + content-box 裁切）。 */
.settings-switch{
  /* 审计实测只有 44x24：热区太小。高度给到 32（滑钮按 24 居中，视觉基本不变）。 */
  position: relative;
  flex: none;
  width: 44px;
  min-height: 32px;
  padding: 0;
  border: none;
  /* 32 高 + 16 半径 = 胶囊。原来是 12，深色下看着像"圆角方块"，用户反馈看不懂 */
  border-radius: 16px;
  background: var(--border-default);
  cursor: pointer;
  transition: background-color 0.18s ease;
}.settings-switch::after{
  content: '';
  position: absolute;
  /* 垂直居中：轨道 32、钮 20 → 上下各 6。原来写死 top:2px，钮偏上 4px，
     真机看着就是"开关歪了/形状怪"。 */
  top: 50%;
  left: 2px;
  width: 20px;
  height: 20px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform 0.18s ease;
}.settings-switch-on{
  background: var(--accent);
}.settings-switch-on::after{
  transform: translate(20px, -50%);
}

.settings-input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
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
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
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

/* ── 定版图对齐（设置页 · 第 13 屏） ───────────────────────────────────
   全宽搜索框 + 分组卡：分组标题 12 灰字在左、说明靠右；卡内行是
   「32 图标方块 · 17 标题 / 12 说明 · 14 右值/箭头/开关」，行高 ≥44，
   卡与卡之间 12。只作用于设置页：.settings-search 是本页独有的前导
   节点，插件市场复用 .settings-group/.settings-row 但没有它，正好被
   ~ 选择器挡在外面。尺寸/颜色全部引用 --palm-* 令牌，未新增类名。 */

/* 搜索框：44 高、12 圆角、表面色。 */
.settings-search .mobile-searchInput {
  height: var(--palm-hit);
  padding: 0 var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
}

/* 分组卡：12 圆角、1px hairline、组间 12。 */
.settings-search ~ .settings-group {
  margin: 0 var(--palm-s4) var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  box-shadow: none;
}

/* 分组标题：12px 灰字 + 右侧浅灰说明（同一行，长说明省略）。 */
.settings-search ~ .settings-group > .settings-groupTitle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--palm-s2);
  height: var(--palm-s7);
  padding: 0 var(--palm-s4);
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-normal);
  letter-spacing: 0;
  text-transform: none;
}

.settings-search ~ .settings-group > .settings-groupTitle > .settings-groupDesc {
  margin-left: auto;
  max-width: 70%;
  overflow: hidden;
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-normal);
  letter-spacing: 0;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 行：32 图标列 + 文本 + 右侧值；44 触控下限，两行文字撑到约 60。 */
.settings-search ~ .settings-group .settings-row,
.settings-search ~ .settings-group .mobile-row {
  grid-template-columns: var(--palm-s7) minmax(0, 1fr) auto;
  gap: var(--palm-s3);
  min-height: var(--palm-hit);
  padding: 0 var(--palm-s4);
  border-bottom: var(--palm-hair) solid var(--palm-line);
}

/* 进阶/主机配置行是 <button class="mobile-row">：底色交还给分组卡，避免比卡面亮一档。 */
.settings-search ~ .settings-group .mobile-row {
  background: transparent;
}

/* 图标方块 32×32、圆角 8、浅底 + 16px 线性图标。 */
.settings-search ~ .settings-group :is(.settings-row, .mobile-row) .card-icon {
  width: var(--palm-s7);
  height: var(--palm-s7);
}

.settings-search ~ .settings-group :is(.settings-row, .mobile-row) .card-icon > * {
  width: var(--palm-s7);
  height: var(--palm-s7);
  border-radius: var(--palm-r-s);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
}

.settings-search ~ .settings-group :is(.settings-row, .mobile-row) .card-icon svg {
  width: var(--palm-s4);
  height: var(--palm-s4);
}

/* 两行文字的内边距收到 8：行密度对齐定版图，同时保住 44 的触控高度。 */
.settings-search ~ .settings-group :is(.settings-row, .mobile-row) .card-main {
  gap: var(--palm-s1);
  padding: var(--palm-s2) 0;
}

.settings-search ~ .settings-group :is(.settings-row, .mobile-row) .card-desc {
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
}

.settings-search ~ .settings-group .settings-rowValue {
  color: var(--palm-fg-3);
  font-size: var(--palm-t-m);
}

/* 卡片最后一行不再画分割线（按钮行外面还裹着一层 <li>，要按父级取末行）。 */
.settings-search ~ .settings-group > .settings-row:last-child,
.settings-search ~ .settings-group > li:last-child > .settings-row,
.settings-search ~ .settings-group > li:last-child > .mobile-row {
  border-bottom: 0;
}

/* 开关轨道保持 24 高的视觉，但热区补到 44×44（拇指按得准）。 */
.settings-search ~ .settings-group .settings-switch::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: var(--palm-hit);
  height: var(--palm-hit);
  transform: translate(-50%, -50%);
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

.empty-icon {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  border-radius: var(--radius-full);
  background: var(--fill);
  color: var(--text-tertiary);
}

.empty-icon svg {
  width: 28px;
  height: 28px;
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

/* ── skeleton loading (gradient shimmer, no spinners) ────────────────── */

.skel {
  border-radius: var(--radius-chip);
  background: linear-gradient(90deg, var(--fill) 25%, var(--fill-strong) 50%, var(--fill) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite linear;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* Skeleton rows mirror the real card tiers. 会话行改成三行信息卡之后骨架也跟着
   收成「一块卡 + 三行占位」，否则加载那一瞬页面会先跳一下再变成新排布。 */
.skel-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  gap: var(--palm-s2);
  margin: 0 var(--palm-s3) 10px;
  padding: var(--palm-s3) 14px;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
}

.skel-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
}

.skel-lines {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.skel-line-title {
  height: 14px;
  width: 52%;
}

.skel-line-sub {
  height: 11px;
  width: 78%;
  border-radius: var(--radius-chip);
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
  color: var(--accent-contrast);
  font: inherit;
  font-size: var(--palm-t-l);
  font-weight: var(--palm-w-bold);
  cursor: pointer;
  box-shadow: 0 2px 8px var(--accent-glow);
  transition: transform 0.1s ease, filter 0.1s ease;
}

.mobile-new:active {
  transform: scale(0.98);
  filter: brightness(1.1);
}

.mobile-new:disabled {
  opacity: 0.6;
  transform: none;
  box-shadow: none;
}

/* F1 会话筛选（定版图）：一行药丸，选中「强调色描边 + 淡底」，未选「灰底无描边」。
   药丸本身撑满 44px 触控高度，视觉高度就是触控高度——手机上一行矮药丸比多出来的
   空白更容易点错。 */
.sess-filters {
  display: flex;
  gap: var(--palm-s2);
  padding: var(--palm-s1) var(--palm-s4) var(--palm-s2);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}

.sess-filters::-webkit-scrollbar {
  display: none;
}

.sess-chip {
  flex: 0 0 auto;
  min-height: var(--palm-hit);
  padding: 0 var(--palm-s4);
  /* 透明边而不是 border: none：选中态描边出现时药丸不会跳 1px。 */
  border: var(--palm-hair) solid transparent;
  border-radius: var(--palm-r-full);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-t-m);
  white-space: nowrap;
  cursor: pointer;
}

.sess-chip-on {
  border-color: var(--palm-accent);
  color: var(--palm-accent);
  background: var(--palm-tint-accent);
}

.mobile-hint {
  display: block;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}

.mobile-pad {
  padding: 8px 16px;
}

.mobile-create {
  display: grid;
  gap: var(--space-2);
}

.mobile-preset {
  display: grid;
}

/* 选择器卡片（定版图）：左侧当前项名字一行，右侧圆形「?」。卡片整体是
   表面色 + 1px hairline，12 圆角；名字那一行可点开选择面板。 */
.mobile-presetCard {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: var(--palm-s2);
  margin: 0 var(--palm-s4) var(--palm-s2);
  padding-right: var(--palm-s2);
  min-height: 56px;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  overflow: hidden;
}

.mobile-presetTrigger {
  width: 100%;
  min-height: 54px;
  padding: 8px 0 8px var(--palm-s4);
  display: flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--palm-fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.mobile-presetTrigger:active {
  background: var(--palm-sur-2);
}

.mobile-presetTrigger:disabled {
  opacity: 0.6;
}

.mobile-presetTriggerTitle {
  font-size: var(--palm-t-l);
  font-weight: var(--palm-w-bold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 圆形「?」：44px 触控，16px 线性图标，一圈 hairline——和卡片同一套线。 */
.mobile-presetHelp {
  width: var(--palm-hit);
  height: var(--palm-hit);
  display: flex;
  align-items: center;
  justify-content: center;
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-full);
  background: transparent;
  color: var(--palm-fg-2);
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.mobile-presetHelp svg {
  width: 16px;
  height: 16px;
}

.mobile-presetHelp:active {
  background: var(--palm-sur-2);
}

.mobile-presetHelp:disabled {
  opacity: 0.4;
}

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
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
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
  color: #fff;
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
  0%, 100% { box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18); }
  50% { box-shadow: 0 2px 18px var(--accent-soft, rgba(124, 108, 255, 0.45)); }
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
  font-size: var(--palm-t-m);
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
.chat-msg-plain,
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
  color: var(--accent, #4f7cff);
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
  color: var(--text-muted, #888);
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
  border: 1px solid var(--warning, #e69641);
  border-radius: var(--radius-card, 8px);
  background: color-mix(in srgb, var(--warning, #e69641) 10%, transparent);
  color: var(--warning, #e69641);
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
.chat-msg > .chat-md,
.chat-msg > .chat-msg-plain {
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

/* 流式中纯文本（不做 markdown 渲染，减少 CPU） */
.chat-msg-plain {
  white-space: pre-wrap;
  overflow-wrap: break-word;
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
/* Soft line breaks (single-\n markdown lists, agent status lines) render as
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
.chat-md-body img.md-local-img[data-local-state='failed'] {
  min-width: 0;
  min-height: 0;
  padding: 8px 10px;
  border-color: var(--danger);
  background: transparent;
  color: var(--danger);
  font-size: 12px;
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
  height: 40px;
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
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.1s ease, filter 0.1s ease, background-color 0.12s ease;
}

.diff-btn:active {
  transform: scale(0.96);
}

.diff-accept {
  border: none;
  background: var(--positive);
  color: #fff;
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
  grid-template-columns: 24px 40px 40px minmax(0, 1fr);
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

/* Review mode: 24px action column with per-line + / − buttons. */
.diff-review-cell {
  display: flex;
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
  transition: transform 0.1s ease, filter 0.1s ease;
}

.diff-line-btn:active {
  transform: scale(0.9);
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
  filter: brightness(1.25);
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
  height: 30px;
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
  height: 32px;
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
  /* 审计实测 189x16：正文里的文件链接太矮，点不中。上下各扩 8px 热区、
     用负 margin 抵消，行高不变（否则正文会散）。 */
  display: inline-block;
  padding: 8px 2px;
  margin: -8px 0;
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px dashed color-mix(in srgb, var(--accent) 40%, transparent);
  overflow-wrap: anywhere;
}

@media (hover: hover) {
  .chat-md-body a.file-link:hover {
    text-decoration: underline;
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
 * 过程组（对照稿 chat-rework.html 的工具块）：**独立一张卡**。
 * 头一行只说「跑了 N 个工具」+ 右侧总耗时；每个工具在头下面直接列一行
 * （彩色状态点 + 动作 · 对象 + 状态词）。思考与 diff 卡仍在卡内展开，
 * 答案永远在卡外。
 */
.chat-proc {
  display: flex;
  flex-direction: column;
  margin-top: var(--palm-s1);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  overflow: hidden;
}

.chat-proc-head {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  width: 100%;
  /* 44px 是拇指友好的最小点击高度 */
  min-height: var(--palm-hit);
  padding: var(--palm-s2) var(--palm-s3);
  border: none;
  background: transparent;
  color: var(--palm-fg);
  font: inherit;
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
  text-align: left;
  cursor: pointer;
}

.chat-proc-head-static {
  cursor: default;
}

.chat-proc-line {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  width: 100%;
  min-width: 0;
}

/* 标题是主角：14px 加粗正文色。 */
.chat-proc-state {
  flex: none;
  font-weight: var(--palm-w-bold);
  color: var(--palm-fg);
}

/*
 * 报错信号（「2 处报错」）：比标题弱一档，只在真有报错步骤时存在。
 * 不用 ⚠ 之类的字形，纯文字也读得出来。
 */
.chat-proc-errors {
  flex: none;
  color: var(--palm-danger);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-normal);
}

/* 右侧总耗时：第三档灰、等宽数字。 */
.chat-proc-time {
  flex: none;
  margin-left: auto;
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-normal);
  font-variant-numeric: tabular-nums;
}

.chat-proc-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 只有"运行中"给一点强调：比默认亮一档的边。 */
.chat-proc-running > .chat-proc-head {
  border-color: var(--palm-line);
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


/* 宿主唤醒消息的卡片（子代理/任务/定时/团队/外部事件…）。数值逐条对齐桌面端
   ui-chat 的 TurnTriggerNodeView.module.css：16px 圆角、描边、代码块灰底、
   头部 12px/16px、标题 13px、时间右对齐 12px、正文左缩进 40px、正文区最高 240px。
   外边距单独给足 —— 真机反馈"卡片离周围文字太近、不协调"。 */
.chat-trigger {
  margin: 14px 0;
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  background: var(--code-bg);
  overflow: hidden;
}
.chat-trigger-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 16px;
  cursor: pointer;
  list-style: none;
  color: var(--text-primary);
  font-size: 13px;
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
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.chat-trigger-body {
  padding: 0 16px 12px 40px;
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

.chat-step-head {
  min-height: 40px;
}

.chat-step-state {
  flex: none;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.chat-step-state-ok { color: var(--diff-add); }
.chat-step-state-error { color: var(--diff-del); }
.chat-step-state-running { color: var(--accent); }

.chat-flow-answer {
  margin-top: var(--space-1);
}

/*
 * 工具块的行（对照稿）：一行一个工具 = 状态点 + 动作 · 对象 + 右侧状态词。
 * 行与行之间只用一条细线分隔，整块是卡里的一张表，不是一叠小卡。
 */
.chat-proc-tools {
  display: flex;
  flex-direction: column;
}

.chat-step {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s1);
  padding: var(--palm-s2) var(--palm-s3);
  border-top: var(--palm-hair) solid var(--palm-line);
  background: transparent;
}

.chat-proc-tools > .chat-step:first-child {
  border-top: none;
}

.chat-step-head {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  width: 100%;
  min-height: var(--palm-hit);
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
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

.chat-step-title {
  flex: none;
  font-size: var(--palm-t-m);
  color: var(--palm-fg);
  white-space: nowrap;
}

.chat-step-summary {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-2);
}

/* 右侧状态词：12px 第三档灰（成功/运行中/失败/已中断都照实写）。 */
.chat-step-state {
  flex: none;
  margin-left: auto;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
  font-variant-numeric: tabular-nums;
}

.chat-step-state-ok { color: var(--palm-ok); }
.chat-step-state-error { color: var(--palm-danger); }
.chat-step-state-running { color: var(--palm-accent); }
.chat-step-state-stopped { color: var(--palm-warn); }

.chat-step-caret {
  flex: none;
  display: flex;
  align-items: center;
  color: var(--palm-fg-3);
}

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
  padding: 0;
  border: none;
  background: var(--code-head-bg);
  color: inherit;
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

/* ── turn status: three breathing dots ───────────────────────────────── */

.chat-turn-status {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  /* Left edge flush with the flat assistant rows: the scroll area pads
     12px and the rows are full-width, so the status must not add its own
     left inset (the old 14px pushed it 14px right of the text). */
  padding: 8px 0;
  color: var(--accent);
  font-size: var(--text-md);
  font-weight: 500;
}

/* Turn clock (desktop parity): muted, tabular-ish elapsed label. */
.chat-turn-time {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.chat-turn-dots {
  display: inline-flex;
  gap: var(--space-1);
}

.chat-turn-dots span {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--accent);
  animation: breathe 1.4s infinite ease-in-out;
}

.chat-turn-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.chat-turn-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

/* ── run-status strip + sheet (todo plan / background jobs) ───────────── */

.chat-status-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
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
  background: var(--warning, #d9a13b);
}

.chat-task-dot-completed {
  background: var(--positive);
}

.chat-task-dot-killed {
  background: var(--text-quaternary);
}

.chat-task-dot-failed {
  background: var(--danger, #d9534f);
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
.chat-approval-panel,
.chat-question-panel {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.chat-approval-header,
.chat-approval-reason,
.chat-question-option,
.chat-question-option-label,
.chat-question-option-desc {
  min-width: 0;
}

/* 「将要执行什么」：等宽、两行封顶。审批卡片不能因为一条长命令把整页顶宽。 */
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
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
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
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: var(--radius-card);
  background: var(--card-bg);
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
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
}

.chat-risk-install {
  color: var(--danger);
  border-color: var(--danger);
}

.chat-approval-expand {
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
  height: 44px;
  border: none;
  border-radius: var(--radius-chip);
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  font-size: var(--text-md);
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.1s ease, filter 0.1s ease;
}

.chat-approval-allow:active {
  transform: scale(0.98);
  filter: brightness(1.08);
}

.chat-approval-allow:disabled {
  opacity: 0.6;
  transform: none;
}

.chat-approval-reject {
  flex: 1;
  height: 44px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-md);
  cursor: pointer;
  transition: transform 0.1s ease, background-color 0.1s ease;
}

.chat-approval-reject:active {
  transform: scale(0.98);
  background: var(--fill);
}

.chat-approval-reject:disabled {
  opacity: 0.6;
  transform: none;
}

.chat-question-panel {
  margin: 4px 0;
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: var(--radius-card);
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chat-question-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-question-header {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.chat-question-text {
  font-size: var(--text-md);
  font-weight: 400;
  color: var(--text-primary);
  line-height: 1.5;
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
  padding: 12px 14px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  cursor: pointer;
  font-size: var(--text-md);
  transition: border-color 0.12s ease, background-color 0.12s ease, transform 0.1s ease;
}

.chat-question-option:active {
  transform: scale(0.98);
}

.chat-question-option input {
  margin: 2px 0 0;
  flex: none;
  accent-color: var(--accent);
}

.chat-question-option-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
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
  min-height: 44px;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s ease;
}

.chat-question-custom:focus-visible {
  border-color: var(--border-focus);
}

.chat-question-submit {
  height: 44px;
  border: none;
  border-radius: var(--radius-chip);
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  font-size: var(--text-md);
  font-weight: 500;
  cursor: pointer;
  transition: transform 0.1s ease, filter 0.1s ease;
}

.chat-question-submit:active {
  transform: scale(0.98);
  filter: brightness(1.08);
}

.chat-question-submit:disabled {
  opacity: 0.6;
  transform: none;
}

/* ── composer toolbar pills（对照稿：药丸一行 = 模型 + 权限） ─────────── */

/* 药丸行是输入区的一部分（同一块底、同一条顶边）：这一行与下面的输入行之间
   不再有一条分隔线，只有 .chat-composer 自己的背景。 */
.chat-tools {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  padding: var(--palm-s2) var(--palm-s3) 0;
  border-top: var(--palm-hair) solid var(--palm-line);
  background: var(--palm-bg);
}

.chat-tools-actions {
  display: flex;
  gap: var(--palm-s2);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* 药丸：32px 高的胶囊，背景一档浅灰；视觉 32px、命中区 44px（见 ::after）。 */
.chat-pill {
  position: relative;
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--palm-s1);
  height: var(--palm-s7);
  padding: 0 var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-full);
  background: var(--palm-sur-1);
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-normal);
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease, color 0.12s ease, transform 0.1s ease;
}

.chat-pill > svg {
  flex: none;
  color: var(--palm-accent);
}

.chat-pill:active {
  transform: scale(0.96);
  border-color: var(--palm-accent);
  background: var(--palm-tint-accent);
}

/* 命中区向外扩：纵向 6px（上下没有邻居），横向只 2px —— 相邻药丸间距 8px，
   横向也扩 6px 会让两块命中区重叠 4px，点空隙反而命中隔壁那个。 */
.chat-pill::after {
  content: '';
  position: absolute;
  inset: calc(var(--palm-s2) * -0.75) 0;
  border-radius: inherit;
}

.mobile-quickchip {
  position: relative;
}

.mobile-quickchip::after {
  content: '';
  position: absolute;
  inset: calc(var(--palm-s1) * -1);
  border-radius: inherit;
}

.chat-pill-name {
  max-width: calc(var(--palm-s8) * 2.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-pill-chevron {
  flex: none;
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
}

/* Permission pills never shrink: their text is short and stays visible. */
.chat-pill-perm {
  flex: none;
}

/* Context meter (status zone): an SVG occupancy ring + the percentage;
   the exact counts live in the title. ≥80% flips ring and figures to the
   danger color. */
.chat-context {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--palm-s1);
  min-width: 0;
  padding-left: var(--palm-s3);
  border-left: var(--palm-hair) solid var(--palm-line);
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-normal);
  line-height: var(--palm-lh-head);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.chat-context-ring {
  flex: none;
  display: block;
}

.chat-context-ring-track {
  stroke: var(--palm-line);
}

.chat-context-ring-fill {
  stroke: var(--palm-accent);
  transition: stroke-dasharray 0.3s ease;
}

.chat-context-warn {
  color: var(--palm-danger);
}

.chat-context-warn .chat-context-ring-fill {
  stroke: var(--palm-danger);
}

/* Context-usage popover: tap the ring to see the exact figures. Anchored
   to the toolbar (its stacking context), floating above the message
   list; an invisible fixed scrim closes it on outside taps. */
.chat-context-pop {
  position: absolute;
  right: var(--palm-s4);
  bottom: calc(100% + var(--palm-s2));
  z-index: var(--z-popover);
  min-width: 150px;
  padding: var(--palm-s2) var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
  box-shadow: var(--palm-sh2);
}

.chat-context-pop-title {
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.chat-context-pop-figures {
  margin-top: var(--palm-hair);
  font-size: var(--palm-t-l);
  font-weight: var(--palm-w-bold);
  color: var(--palm-fg);
  font-variant-numeric: tabular-nums;
}

.chat-context-pop-figures span {
  margin: 0 var(--palm-hair);
  color: var(--palm-fg-3);
  font-weight: var(--palm-w-normal);
}

.chat-context-pop-sub {
  margin-top: var(--palm-hair);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-2);
}

.chat-context-pop-scrim {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-scrim);
  background: transparent;
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
  background: rgba(15, 15, 25, 0.2);
}

.chat-tools,
.chat-composer {
  position: relative;
  z-index: var(--z-composer);
}

/* Vertical panel: search field on top, then grouped rows (model) or the
   full preset list (permission). Scrolling is the fallback, not the
   primary discovery path — the search field narrows the list first. */
.chat-picker-panel {
  position: relative;
  z-index: var(--z-composer);
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 8px 16px 0;
  padding: 8px;
  border: 1px solid var(--border-default);
  border-radius: 14px;
  background: var(--card-bg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
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
  flex: none;
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
  background: var(--palm-bg);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
}

.chat-composer .chat-inputbar {
  border-top: none;
}

/* 「+」/「/」/语音：32px 视觉，44px 命中区（对照稿里输入行最左边是一枚药丸）。 */
.chat-attach-btn {
  position: relative;
  flex: none;
  align-self: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--palm-s7);
  height: var(--palm-s7);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-full);
  color: var(--palm-fg-2);
  background: var(--palm-sur-1);
  cursor: pointer;
}

.chat-attach-btn::after {
  content: '';
  position: absolute;
  inset: calc(var(--palm-s2) * -0.75);
  border-radius: inherit;
}

.chat-attach-btn:active {
  background: var(--palm-sur-2);
}

/* The slash glyph: a text mark, not an icon, so it reads as "type a command"
   rather than as another app action. */
.chat-slash-glyph {
  font-size: 22px;
  font-weight: 600;
  line-height: 1;
  transform: translateY(-1px);
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
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: var(--text-sm);
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.chat-attach-remove:active {
  background: rgba(0, 0, 0, 0.8);
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
  color: var(--accent, #4f7cff);
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
  /* 视觉 18px、热区 36px：拇指点得中，chip 也不会被撑大（负 margin 抵消占位）。 */
  width: 36px;
  height: 36px;
  margin: -9px -9px -9px 0;
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
  padding: 0;
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
  /* 中线对齐：+ / 命令 / 语音 / 停止 / 发送都跟输入框的中心线走。 */
  align-items: center;
  gap: var(--palm-s2);
  padding: var(--palm-s2) var(--palm-s3) calc(env(safe-area-inset-bottom, 0) + var(--palm-s2));
  background: var(--palm-bg);
}

.chat-input {
  flex: 1;
  min-width: 0;
  min-height: var(--palm-hit);
  /* 4 行封顶：实测 132px（约 6 行）时草稿把最后一条消息和「输出中」整块遮住，
     写长文本反而看不见上下文。超出的内容在框内滚动。 */
  max-height: 104px;
  overflow-y: auto;
  field-sizing: content;
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
  min-height: var(--palm-hit);
  max-height: 104px;
  padding: var(--palm-s1);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-hit);
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
  min-height: var(--palm-s7);
  max-height: 100px;
  padding: var(--palm-s1) var(--palm-s2);
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
  min-width: calc(var(--palm-s7) * 1.75);
  padding: 0 var(--palm-s3);
  border-radius: var(--palm-r-full);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-bold);
}

.chat-send-queuedText {
  white-space: nowrap;
}

/* 发送键（对照稿）：44px 圆形、主题色底、深色箭头。 */
.chat-send {
  flex: none;
  align-self: center;
  width: var(--palm-hit);
  height: var(--palm-hit);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--palm-r-full);
  background: var(--palm-accent);
  color: var(--accent-contrast);
  font: inherit;
  cursor: pointer;
  box-shadow: var(--palm-sh1);
  transition: transform 0.15s ease, filter 0.15s ease;
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

/* ── message long-press context menu ─────────────────────────────────── */

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
  animation: sheet-fade 0.18s ease;
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
  padding: 12px 16px 14px;
  font-size: 17px;
  font-weight: 500;
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
  color: var(--danger, #d5484a);
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
  background: #fff;
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
  background: rgba(0, 0, 0, 0.86);
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
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
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
  color: rgba(255, 255, 255, 0.6);
  pointer-events: none;
}




.sheet-error {
  margin: 0 0 8px;
  color: var(--danger);
  font-size: 12.5px;
}



/* Sheet option rows: 56px, icon + text + right check. */
.sheet-option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 56px;
  padding: 8px 12px;
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
  font-size: 14px;
  font-weight: 400;
}

.sheet-option-desc {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: 1.4;
}

.sheet-option-check {
  flex: none;
  color: var(--accent);
  font-size: var(--text-base);
  font-weight: 500;
}

.sheet-confirm-desc {
  margin: 0 4px 14px;
  color: var(--text-secondary);
  font-size: var(--text-md);
  line-height: 1.6;
}

/* 「Agent 模式说明」面板：把每个模式逐条列出来。
   以前只显示当前模式的一句话，宿主没写 description 时整块看着像空的。 */
.preset-help-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 0 4px 16px;
}

.preset-help-item {
  padding: 12px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-card);
  background: var(--bg-elevated);
}

.preset-help-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}

.preset-help-name {
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: 600;
}

.preset-help-tag {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--bg-page);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.6;
}

.preset-help-tag-current {
  background: var(--accent-soft);
  color: var(--accent);
}

.preset-help-item .sheet-confirm-desc {
  margin: 0;
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
  color: #fff;
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
  background: var(--accent);
  color: var(--accent-contrast);
}

.mobile-button-primary:active {
  background: var(--accent);
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
  color: var(--text-tertiary);
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
  color: var(--text-tertiary);
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
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.device-badge-current {
  color: var(--text-secondary);
  background: var(--fill);
}

.device-desc {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.device-status {
  flex: none;
  color: var(--text-tertiary);
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
  color: #fff;
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

.mobile-back:focus-visible, .mobile-theme-toggle:focus-visible, .mobile-iconbtn:focus-visible, .mobile-headerAction:focus-visible, .mobile-quickchip:focus-visible, .mobile-searchInput:focus-visible, .mobile-row:focus-visible, .mobile-createCard:focus-visible, .mobile-presetTrigger:focus-visible, .mobile-presetHelp:focus-visible, .mobile-button:focus-visible, .mobile-new:focus-visible, .settings-themeOption:focus-visible, .settings-optionChip:focus-visible, .settings-switch:focus-visible, .dialog-btn:focus-visible, .dialog-input:focus-visible, .chat-send:focus-visible, .chat-msg-toggle:focus-visible, .chat-load-older:focus-visible, .chat-disclosure-head:focus-visible, .chat-question-option:focus-within, .ctx-item:focus-visible, .sheet-option:focus-visible, .sheet-confirm-danger:focus-visible, .chat-input:focus-visible{
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

.mobile-pairInput:focus-visible {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 2px var(--bg-page), 0 0 0 4px var(--accent);
}

.mobile-pairSubmit {
  width: 100%;
  margin: 0;
}

/* ── directory browser ───────────────────────────────────────────────── */

.dir-browser {
  display: flex;
  flex-direction: column;
}

.dir-crumbs {
  display: flex;
  align-items: center;
  overflow-x: auto;
  padding: 10px 12px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
  scrollbar-width: none;
}

.dir-crumbs::-webkit-scrollbar {
  display: none;
}

.dir-crumb {
  border: none;
  background: transparent;
  padding: 8px 8px;
  border-radius: var(--radius-chip);
  color: var(--text-secondary);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.dir-crumb:active {
  background: var(--fill);
  color: var(--accent);
}

.dir-crumb-separator {
  color: var(--text-muted);
  margin: 0 2px;
  font-size: 14px;
}

.dir-entry {
  padding-left: 16px;
}

.dir-entry-hidden {
  opacity: 0.5;
}

.dir-select {
  flex: none;
  padding: 12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px);
  background: color-mix(in srgb, var(--bg-page) 88%, transparent);
  border-top: 1px solid var(--border-subtle);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
}

.dir-select .mobile-button {
  width: 100%;
  margin: 0;
}

.dir-empty {
  padding: 40px 0;
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
  .mobile-theme-toggle,
  .mobile-iconbtn,
  .mobile-headerAction,
  .mobile-quickchip,
  .mobile-row,
  .mobile-createCard,
  .mobile-button,
  .mobile-button-muted,
  .mobile-new,
  .chat-send,
  .chat-msg,
  .chat-msg-toggle,
  .chat-load-older,
  .chat-disclosure-head,
  .chat-disclosure-caret,
  .chat-disclosure-body,
  .boot-dot,
  .skel,
  .toast,
  .ctx-menu,
  .dialog,
  .sheet-backdrop,
  .sheet,
  .sheet-option,
  .sheet-confirm-danger,
  .settings-switch::after,
  .chat-input,
  .chat-turn-dots span,
  .settings-themeOption,
  .settings-optionChip {
    animation: none;
    transition: none;
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
.ws-icon-plain > * {
  background: color-mix(in srgb, var(--text-tertiary) 15%, transparent);
  color: var(--text-tertiary);
}

/* Empty-group placeholder card (72px tier, centered copy + 创建). */
.mobile-empty-group {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: calc(100% - 32px);
  margin: 0 16px 8px;
  min-height: 72px;
  border: 1px dashed var(--card-border);
  border-radius: var(--radius-card);
  color: var(--text-quaternary);
  font-size: var(--text-md);
}

.mobile-empty-groupBtn {
  border: none;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: var(--text-md);
  font-weight: 500;
  padding: 8px 10px;
  border-radius: var(--radius-chip);
  cursor: pointer;
}

.mobile-empty-groupBtn:active {
  background: var(--accent-soft);
}

/* Session-list header search morph (200ms) + its input. */
.mobile-headerSearch {
  min-width: 0;
  display: flex;
  align-items: center;
  animation: search-morph 0.2s ease both;
}

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

.mobile-headerSearchInput {
  width: 100%;
  height: 38px;
  padding: 0 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-capsule);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.mobile-headerSearchInput:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

/* Session status semantics: running pulse + label, settled check. */
.sess-status {
  flex: none;
  color: var(--positive);
  font-size: var(--text-xs);
  font-weight: 500;
}

.sess-check {
  display: flex;
  color: var(--text-quaternary);
}

.sess-check svg {
  width: 16px;
  height: 16px;
}

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

/* Regenerate affordance on the last settled assistant reply: ONE icon at the
   right end of the timestamp line. The verb was dropped on purpose — on a phone
   "重新生成" costs ~48px of a line that otherwise carries only a time, and this
   is a utility, not a decision. The meaning lives in aria-label/title. The
   negative vertical margins keep a 32px finger target from growing the row. */
.chat-msg-regenerate {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin: -8px 0 -8px 4px;
  border: none;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.chat-msg-regenerate:active {
  background: var(--fill);
  color: var(--accent);
}

/* 已发出：原地转圈并禁用，直到这一轮真的开跑（按钮随之被收走）。 */
.chat-msg-regenerate-busy {
  color: var(--accent);
  cursor: default;
}

.chat-msg-regenerate-busy .chat-msg-regenerate-icon {
  display: inline-block;
  animation: chat-regenerate-spin 0.9s linear infinite;
}

/* 没发出去：变红，允许直接再点。 */
.chat-msg-regenerate-failed {
  color: var(--danger);
}

.chat-msg-regenerate-icon {
  font-size: 16px;
  line-height: 1;
}

@keyframes chat-regenerate-spin {
  to { transform: rotate(360deg); }
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
  padding: 4px 12px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--bg-elevated);
}
.queue-dockHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 2px 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 600;
}
.queue-dockCount {
  color: var(--accent, #4f7cff);
}
.queue-dockChevron {
  color: var(--text-tertiary);
}
.queue-dockList {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}
/* 只有一条的时候上面没有"N 条排队"那一行，6px 的顶间距就变成了一条空带：
   整条卡片因此显得头重脚轻。第一条贴在顶边上。 */
.queue-dock > .queue-dockList:first-child {
  margin-top: 0;
}
.queue-dockRow {
  display: flex;
  align-items: center;
  gap: 8px;
  /* 行内再铺一层不同的底色就等于"卡片套卡片"，真机上看是两层框。整条只留外层
     底板，行本身透明；插话那条的左侧竖线仍然保留。 */
  padding: 0;
  border-radius: 8px;
  background: transparent;
}
.queue-dockRow[data-placement='steering'] {
  border-left: 2px solid var(--accent, #4f7cff);
}
.queue-dockText {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: var(--text-sm);
}
.queue-dockActions {
  flex: 0 0 auto;
  display: flex;
  /* 删除与插话相邻且只有 4px 间隔，误删不可撤销：把间距和命中区一起放大。 */
  gap: 10px;
}
/* 插队条目（已经插进本轮）的小标签：和「排队中」区分开，别让用户以为它还在等。 */
.queue-dockTag {
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 1.4;
  background: var(--accent-soft);
  color: var(--accent);
  white-space: nowrap;
}

.queue-dockBtn {
  flex: none;
  /* 用户两轮反馈"还是太高"：纵向收到 30px、横向留 40px，相邻间距加到 10px ——
     靠间距而不是按钮自身的空白来兜住误点。整条因此从 62px 压到 40px，
     和一条消息气泡差不多高。 */
  min-height: 30px;
  min-width: 40px;
  padding: 2px 9px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.queue-dockBtn-primary {
  /* 主操作要在一行里被一眼认出来：实心强调色，不再是和编辑/删除同款的描边。 */
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-color: transparent;
  background: var(--accent, #4f7cff);
  color: #fff;
  font-weight: 600;
}
.queue-dockBtnIcon {
  flex: none;
}
.queue-dockBtn:disabled {
  opacity: 0.4;
}
.queue-dockEdit {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.queue-dockInput {
  flex: 1 1 auto;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: var(--text-sm);
}

/* Offline / queued banner (32px, warning wash, slide-down). */
.chat-offline-banner {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 32px;
  padding: 0 16px;
  background: color-mix(in srgb, var(--warning) 15%, transparent);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  animation: banner-in 0.2s ease both;
}

@keyframes banner-in {
  from {
    transform: translateY(-32px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

.chat-offline-retry {
  flex: none;
  border: none;
  background: transparent;
  color: var(--danger);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  padding: 4px 8px;
  border-radius: var(--radius-chip);
  cursor: pointer;
}

.chat-offline-retry:active {
  background: var(--danger-soft);
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

/* 已认领命令（桌面端 composer 里那颗 chip）：命令词一块蓝色，参数在输入框里。
   排在与输入框同一行的中心线上，输入框长高时跟着垂直居中。 */
.chat-command-chip {
  flex: 0 1 auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 40%;
  margin-left: 4px;
  padding: 3px 4px 3px 9px;
  border-radius: calc(var(--radius-chip) + 4px);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.3;
}

.chat-command-chipText {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.voice-cancel {
  min-width: 96px;
  height: 44px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 15px;
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

/* 录音快到 60 秒上限时的提醒：只变颜色和字重，不改字号（避免面板跳动）。 */
.voice-text-warn {
  color: var(--accent);
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

.voice-done {
  /* 44px 是拇指能稳稳按到的下限；40px 在真机上要低头瞄准，而且这是录音结束时唯一的出口。 */
  height: 44px;
  padding: 0 24px;
  border: none;
  border-radius: var(--radius-capsule);
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.voice-done:active {
  transform: scale(0.97);
  filter: brightness(1.08);
}

/* Settings search field. */
.settings-search {
  padding: 0 16px 12px;
}/* Toggle knob spring (overshoot then settle, 200ms). */
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
.sess-status {
  display: inline-flex;
  align-items: center;
  flex: none;
  padding: 0 var(--palm-s2);
  height: 18px;
  border-radius: var(--palm-r-full);
  font-size: var(--palm-t-s);
  line-height: 1;
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
}

.sess-status-ok {
  background: var(--palm-tint-ok);
  color: var(--palm-ok);
}

.sess-status-warn {
  background: var(--palm-tint-warn);
  color: var(--palm-warn);
}

.sess-status-danger {
  background: var(--palm-tint-danger);
  color: var(--palm-danger);
}

.sess-status-info {
  background: var(--palm-tint-accent);
  color: var(--palm-accent);
}

.mobile-groupCount {
  color: var(--palm-fg-3);
  font-weight: var(--palm-w-normal);
}

.sess-chipCount {
  margin-left: var(--palm-s1);
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
}

/* ── 状态条（主条 + 迷你条 + 方案 A 刻度轨）────────────────────
 *
 * 版式真源：docs/prototype/pet-strip-v5.html ①（主条高度 / 圆角 / 渐变填充 /
 * 内联宠物 / 白色暗阴影文字 / 右侧等宽数字全部走 --palm-strip-* 令牌），
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
  gap: var(--palm-strip-rail-mt);
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

.palm-strip {
  position: relative;
  display: flex;
  align-items: center;
  overflow: hidden;
  block-size: var(--palm-strip-h);
  border: var(--palm-hair) solid var(--palm-strip-border);
  border-radius: var(--palm-strip-r);
  background: var(--palm-strip-track);
}

/* 渐变只在这里分派：组件样式里不出现裸色值。 */
.palm-strip[data-kind='think'] { --palm-strip-current: var(--palm-strip-grad-think); }
.palm-strip[data-kind='read'] { --palm-strip-current: var(--palm-strip-grad-read); }
.palm-strip[data-kind='edit'] { --palm-strip-current: var(--palm-strip-grad-edit); }
.palm-strip[data-kind='test'] { --palm-strip-current: var(--palm-strip-grad-test); }
.palm-strip[data-kind='approve'] { --palm-strip-current: var(--palm-strip-grad-approve); }
.palm-strip[data-kind='stuck'] { --palm-strip-current: var(--palm-strip-grad-stuck); }
.palm-strip[data-kind='done'] { --palm-strip-current: var(--palm-strip-grad-done); }
.palm-strip[data-kind='failed'] { --palm-strip-current: var(--palm-strip-grad-failed); }
.palm-strip[data-kind='stopped'] { --palm-strip-current: var(--palm-strip-grad-stopped); }
.palm-strip[data-kind='queued'] { --palm-strip-current: var(--palm-strip-grad-queued); }
.palm-strip[data-kind='unknown'] { --palm-strip-current: var(--palm-strip-grad-unknown); }

.palm-strip-fill {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  border-radius: var(--palm-strip-r) 0 0 var(--palm-strip-r);
  background: var(--palm-strip-current, var(--palm-strip-grad-unknown));
}

/* 顶部一道高光，让主条看起来有厚度（原型 .fill::after）。 */
.palm-strip-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--palm-strip-gloss);
}

/* 进度档位：0..100%，每 5% 一档（不写行内样式）。 */
.palm-strip-fill[data-fill='p0'] { inline-size: 0; }
.palm-strip-fill[data-fill='p5'] { inline-size: 5%; }
.palm-strip-fill[data-fill='p10'] { inline-size: 10%; }
.palm-strip-fill[data-fill='p15'] { inline-size: 15%; }
.palm-strip-fill[data-fill='p20'] { inline-size: 20%; }
.palm-strip-fill[data-fill='p25'] { inline-size: 25%; }
.palm-strip-fill[data-fill='p30'] { inline-size: 30%; }
.palm-strip-fill[data-fill='p35'] { inline-size: 35%; }
.palm-strip-fill[data-fill='p40'] { inline-size: 40%; }
.palm-strip-fill[data-fill='p45'] { inline-size: 45%; }
.palm-strip-fill[data-fill='p50'] { inline-size: 50%; }
.palm-strip-fill[data-fill='p55'] { inline-size: 55%; }
.palm-strip-fill[data-fill='p60'] { inline-size: 60%; }
.palm-strip-fill[data-fill='p65'] { inline-size: 65%; }
.palm-strip-fill[data-fill='p70'] { inline-size: 70%; }
.palm-strip-fill[data-fill='p75'] { inline-size: 75%; }
.palm-strip-fill[data-fill='p80'] { inline-size: 80%; }
.palm-strip-fill[data-fill='p85'] { inline-size: 85%; }
.palm-strip-fill[data-fill='p90'] { inline-size: 90%; }
.palm-strip-fill[data-fill='p95'] { inline-size: 95%; }
.palm-strip-fill[data-fill='p100'] { inline-size: 100%; }

/* 进度未知：游走块（原型的 travel），只用来表示「正在做、但没拆出计划」。 */
.palm-strip-fill[data-fill='unknown'] {
  inline-size: 28%;
  animation: palm-strip-travel 3.2s ease-in-out infinite;
}

@keyframes palm-strip-travel {
  0%, 100% { inset-inline-start: 0; }
  50% { inset-inline-start: 64%; }
}

@media (prefers-reduced-motion: reduce) {
  .palm-strip-fill[data-fill='unknown'] {
    animation: none;
  }
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
  padding-inline: var(--palm-s2);
}

/* 宠物：纯内联 SVG，墨色由 data-kind 选，形状由组件决定（不许 emoji / 图片）。 */
.palm-strip-pet {
  flex: none;
  inline-size: var(--palm-strip-pet);
  block-size: var(--palm-strip-pet);
  color: var(--palm-strip-ink-unknown);
  filter: drop-shadow(var(--palm-strip-pet-shadow));
}

.palm-strip[data-kind='think'] .palm-strip-pet { color: var(--palm-strip-ink-think); }
.palm-strip[data-kind='read'] .palm-strip-pet { color: var(--palm-strip-ink-read); }
.palm-strip[data-kind='edit'] .palm-strip-pet { color: var(--palm-strip-ink-edit); }
.palm-strip[data-kind='test'] .palm-strip-pet { color: var(--palm-strip-ink-test); }
.palm-strip[data-kind='approve'] .palm-strip-pet { color: var(--palm-strip-ink-approve); }
.palm-strip[data-kind='stuck'] .palm-strip-pet { color: var(--palm-strip-ink-stuck); }
.palm-strip[data-kind='done'] .palm-strip-pet { color: var(--palm-strip-ink-done); }
.palm-strip[data-kind='failed'] .palm-strip-pet { color: var(--palm-strip-ink-failed); }
.palm-strip[data-kind='stopped'] .palm-strip-pet { color: var(--palm-strip-ink-stopped); }
.palm-strip[data-kind='queued'] .palm-strip-pet { color: var(--palm-strip-ink-queued); }

.palm-strip-pet [data-pet='body'] {
  fill: var(--palm-strip-pet-body);
  stroke: currentColor;
  stroke-width: 2;
}

.palm-strip-pet [data-pet='eye'] {
  fill: currentColor;
}

.palm-strip-pet [data-pet='line'] {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
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
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-bold);
  line-height: var(--palm-lh-head);
  text-overflow: ellipsis;
  text-shadow: var(--palm-strip-text-shadow);
  white-space: nowrap;
}

.palm-strip [data-part='detail'] {
  overflow: hidden;
  min-inline-size: 0;
  color: var(--palm-strip-detail-fg);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-normal);
  text-overflow: ellipsis;
  text-shadow: var(--palm-strip-text-shadow);
  white-space: nowrap;
}

/* 右侧（耗时 / 等你 42s）：等宽数字，别让数字跳宽。 */
.palm-strip [data-part='right'] {
  flex: none;
  color: var(--palm-strip-right-fg);
  font-size: var(--palm-t-s);
  font-variant-numeric: tabular-nums;
  text-shadow: var(--palm-strip-text-shadow);
  white-space: nowrap;
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

.palm-strip[data-size='mini'] .palm-strip-pet {
  inline-size: var(--palm-strip-pet-mini);
  block-size: var(--palm-strip-pet-mini);
}

.palm-strip[data-size='mini'] .palm-strip-fill {
  border-radius: var(--palm-strip-mini-r) 0 0 var(--palm-strip-mini-r);
}

/* 刻度轨（方案 A）：条下方一条细轨，一格一步。 */
.palm-strip-rail {
  display: flex;
  gap: var(--palm-strip-rail-gap);
  inline-size: 100%;
}

.palm-strip-rail i {
  display: block;
  flex: 1 1 0;
  block-size: var(--palm-strip-rail-h);
  border-radius: var(--palm-strip-rail-r);
  background: var(--palm-strip-rail-todo);
}

.palm-strip-rail i[data-state='done'] {
  background: var(--palm-strip-rail-done);
}

.palm-strip-rail i[data-state='now'] {
  background: var(--palm-strip-rail-now);
}

/* ── 会话正文流：任务头（状态点 + 状态词 + 步数 + 耗时 / 目标 / 状态条） ──
   版式真源：overview.html「2 · 会话正文」；delivery-card.html A 图的 .thead。
   四行固定顺序：①状态行 ②目标（15px/600）③状态条 ④弱化元信息行。 */
.palm-turn-head {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  padding-block: var(--palm-s1) var(--palm-s3);
}

.palm-turn-top {
  display: flex;
  align-items: center;
  gap: var(--palm-s1);
  min-block-size: var(--palm-s5);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.palm-turn-dot {
  flex: none;
  inline-size: var(--palm-flow-dot);
  block-size: var(--palm-flow-dot);
  border-radius: var(--palm-r-full);
  background: var(--palm-fg-3);
}

.palm-turn-head[data-kind='think'] .palm-turn-dot,
.palm-turn-head[data-kind='unknown'] .palm-turn-dot { background: var(--palm-accent); }
.palm-turn-head[data-kind='read'] .palm-turn-dot,
.palm-turn-head[data-kind='edit'] .palm-turn-dot,
.palm-turn-head[data-kind='test'] .palm-turn-dot { background: var(--palm-accent-2); }
.palm-turn-head[data-kind='approve'] .palm-turn-dot,
.palm-turn-head[data-kind='stuck'] .palm-turn-dot { background: var(--palm-warn); }
.palm-turn-head[data-kind='done'] .palm-turn-dot { background: var(--palm-ok); }
.palm-turn-head[data-kind='failed'] .palm-turn-dot { background: var(--palm-danger); }

.palm-turn-state {
  color: var(--palm-fg-2);
  font-weight: var(--palm-w-normal);
}

.palm-turn-steps { color: var(--palm-fg-3); }

.palm-turn-time {
  margin-inline-start: auto;
  color: var(--palm-fg-3);
  font-variant-numeric: tabular-nums;
}

.palm-turn-goal {
  margin: 0;
  color: var(--palm-fg);
  font-size: var(--palm-flow-goal-size);
  font-weight: var(--palm-w-bold);
  line-height: var(--palm-lh-head);
  letter-spacing: -0.01em;
}

.palm-turn-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--palm-s1);
  font-size: var(--palm-flow-meta-size);
  color: var(--palm-fg-3);
}

/* ── 过程折叠行：「▸ 7 步过程 · 31 次工具调用」 ────────────────────────
   整行是一条 44px 触控带；展开状态与展开/收起回调由既有过程组持有，
   这里只画，不新建状态。运行中在下方追加「最近 3 步」。 */
.palm-proc {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--palm-s2);
  inline-size: 100%;
  min-block-size: var(--palm-hit);
  padding: 0;
  border: 0;
  background: none;
  color: var(--palm-fg-2);
  font: inherit;
  font-size: var(--palm-t-s);
  text-align: start;
}

button.palm-proc { cursor: pointer; }

button.palm-proc:active { opacity: 0.72; }

button.palm-proc:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: 2px;
}

.palm-proc-caret {
  flex: none;
  inline-size: var(--palm-s3);
  color: var(--palm-fg-3);
}

.palm-proc-main { color: var(--palm-fg-2); }

.palm-proc-note { color: var(--palm-warn); }

.palm-proc-time {
  margin-inline-start: auto;
  color: var(--palm-fg-3);
  font-variant-numeric: tabular-nums;
}

.palm-proc-recent {
  flex-basis: 100%;
  padding-inline-start: var(--palm-s5);
  font-size: var(--palm-flow-meta-size);
  color: var(--palm-fg-3);
}

/* ── 交付卡：全页唯一的一张卡 ────────────────────────────────────────
   版式真源：delivery-card.html A 图（卡头 → 交付物/改动行 → 汇总 → 卡尾）。
   根节点带 chat-turn-tail 是给卡片诊断探针与既有行身份用的历史钩子，
   卡面本身全部由 palm-delivery-* 重画。 */
.palm-delivery {
  display: block;
  margin-block-start: var(--palm-s3);
  padding: 0;
  border: var(--palm-hair) solid var(--palm-flow-card-line);
  border-radius: var(--palm-flow-card-r);
  background: var(--palm-flow-card-bg);
  overflow: hidden;
}

.palm-delivery-head {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  padding: var(--palm-s3) var(--palm-s3) var(--palm-s2);
  border-block-end: var(--palm-hair) solid var(--palm-flow-rule);
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
  border-block-start: var(--palm-hair) solid var(--palm-flow-rule);
}

button.palm-delivery-row { cursor: pointer; }

button.palm-delivery-row:active { background: var(--palm-tint-accent); }

button.palm-delivery-row:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: -2px;
}

.palm-delivery-icon {
  flex: none;
  inline-size: var(--palm-s4);
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
  gap: var(--palm-s3);
  padding: var(--palm-s2) var(--palm-s3);
  border-block-start: var(--palm-hair) solid var(--palm-flow-rule);
  font-size: var(--palm-flow-meta-size);
  color: var(--palm-fg-3);
}

.palm-delivery-count b {
  color: var(--palm-fg-2);
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-bold);
}

.palm-delivery-foot {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  padding: var(--palm-s2) var(--palm-s3);
  border-block-start: var(--palm-hair) solid var(--palm-flow-rule);
  font-size: var(--palm-flow-meta-size);
  color: var(--palm-fg-3);
}

.palm-delivery-more {
  margin-inline-start: auto;
  min-block-size: var(--palm-hit);
  color: var(--palm-accent);
}

.palm-delivery-more:active { opacity: 0.72; }

/* ── reduced motion additions ────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  .mobile-headerSearch,
  .mobile-empty-groupBtn,
  .chat-reasoning-more,
  .chat-offline-banner,
  .chat-offline-retry,
  .chat-quote-bar,
  .chat-msg-regenerate-icon,
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
.search-more {
  display: block;
  width: calc(100% - 32px);
  margin: 8px 16px 4px;
  padding: 10px 12px;
  border: 1px solid var(--card-border);
  border-radius: 10px;
  background: var(--card-bg);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
}

.search-more:active {
  background: var(--accent-soft);
}
.search-hitsNote {
  margin: 0;
  padding: 4px 2px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: 1.45;
}

/* 首页搜索结果的一行：会话名命中和「消息」命中都是这一种行，正文命中多一行摘要；
   键盘上下键选中的那一行给一圈内描边（不换背景，避免和按压态打架）。 */
.search-hitRow {
  align-items: flex-start;
}
.search-hitRow-active {
  box-shadow: inset 0 0 0 1.5px var(--accent);
  border-radius: 12px;
}
.search-hitBadge {
  flex: none;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: var(--radius-chip);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
}
.search-hitNote {
  display: block;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
/* 方案 C：命中段落。摘要只有一个窗口宽，看不出是哪句话命中；段落直接给三行。
   换行保留（段落本来就是多行正文），超出三行截断并给省略号。 */
.card-desc.search-hitPara {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  white-space: pre-wrap;
  line-height: 18px;
}
/* 搜索中的骨架：三行灰条，比一句「正在搜索…」更能说明"结果正在填进来"。 */
.search-skeletonRow {
  display: block;
  padding: 12px 16px;
}
.search-skeletonLine {
  display: block;
  height: 11px;
  margin: 5px 0;
  border-radius: var(--radius-chip);
  background: linear-gradient(90deg, var(--bg-input) 25%, var(--border-default) 50%, var(--bg-input) 75%);
  animation: settings-skeleton-sweep 1.2s ease-in-out infinite;
}
.search-skeletonLine-thin {
  height: 9px;
}

/* Focus-locate highlight: a one-shot ring pulse on the located row.
   只用 box-shadow，**绝不碰 background-color**：.chat-msg-focus 带
   animation-fill-mode: forwards，动画写到 100% 的 background-color: transparent 会
   永久覆盖 .chat-msg-user 的强调色底——气泡变透明、而 color 仍是白字，浅色模式下
   整段看不见（真机截图就是这个）。描边不会改底色，安全。 */
@keyframes dshPalmFocusPulse {
  0% {
    box-shadow:
      inset 0 0 0 3px color-mix(in srgb, var(--accent) 70%, transparent),
      0 0 0 0 color-mix(in srgb, var(--accent) 35%, transparent);
  }
  70% {
    box-shadow:
      inset 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent),
      0 0 14px 2px color-mix(in srgb, var(--accent) 26%, transparent);
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
  background: color-mix(in srgb, var(--accent) 26%, var(--bg-elevated));
  border-radius: 3px;
  padding: 0 1px;
  font-weight: 600;
}

.mobile .chat-msg-user .chat-search-mark {
  color: #1a1a2e;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
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

/* ── global run overview (cross-session background tasks) ────────────── */

.runov-page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.runov-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 20px);
}



/* 两行各占一行：这两个是 inline span，早先并排渲染，于是"0 个后台任务"和
   "跨全部工作区"连成一句、断行也错位。 */


.runov-group-title {
  padding: 16px 18px 6px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.runov-sess {
  margin: 4px 16px 12px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-card);
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.runov-sess-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px 14px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.runov-sess-head:active {
  background: var(--fill);
}

/* 标题必须完整显示：早先是单行 nowrap + 省略号，"dsh-palm手机端与桌面端消息
   不同步"在手机上只剩 "dsh-palm手机端与桌面…"，一条会话和另一条就分不出来了。
   现在按自然换行排（长标题最多铺两行），不再截断。 */




/* In-card group label ("子代理" / "后台任务"): smaller than the page-level
   .runov-group-title and flush with the rows it introduces (the card's job
   rows carry no horizontal inset of their own). */

.runov-jobs {
  border-top: 1px solid var(--border-subtle);
  padding: 4px 0;
}

/* Fold header for a session's settled (completed/failed/killed) jobs: a quiet
   one-line summary so many finished tasks do not bury what is running now. */





/* Turn list floating handle (轮次清单): a compact pill pinned beside the
   jump-to-latest button; shows the current turn / total count. Rides the
   same sticky flex column as chat-jump-latest (aligned flex-end), offset
   above the round button so the two never overlap. */
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
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
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

/* Turn list sheet rows: one button per turn. A left accent bar marks the
   current turn; an unloaded turn shows a faint dot on the right. Preview
   lines ellipsize on their own line (block + overflow hidden), so long
   prompts / responses never blow out the sheet width. */
/* The number + prompt share one ellipsizing row; the response is an
   indented line under it. Each text line shrinks (flex-shrink: 1 with
   min-width: 0 on the parent column) so anywhere-wrapping long tokens
   cannot widen the sheet. */

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
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
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
  background: color-mix(in srgb, var(--accent) 26%, transparent);
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
   模型/权限行之间），这里只管一条紧凑横条：准星 + 相位 + 目标正文一行省略。
   手机上它上排队卡片、下模型/权限行、再下输入框，三条叠起来已经吃掉正文空间，
   所以视觉高度压在 28px；按钮的判定区靠 padding 补到 44px 见下方 ::after。 */
.chat-goal {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 10px 6px;
  padding: 4px 6px 4px 10px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-chip);
  background: var(--bg-elevated);
}
.chat-goal-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
}
.chat-goal-glyph {
  display: inline-flex;
  flex: none;
  color: var(--accent);
}
.chat-goal-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
}
.chat-goal-label {
  flex: none;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
.chat-goal-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  color: var(--text-primary);
}
/* 展开的全文：目标常是带小标题、空行、编号的多段文本，按普通正文的阅读节奏排
   —— 保留原始换行（pre-wrap）、行高 1.65、字号提到 15px。此前用 normal +
  12px 挤在按钮里，一段长目标会被压成没有段落的文字墙。 */
.chat-goal-body {
  max-height: 38vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 2px 2px 6px 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--text-base);
  line-height: 1.65;
  color: var(--text-primary);
  -webkit-overflow-scrolling: touch;
}
.chat-goal-btn {
  position: relative;
  flex: none;
  height: 28px;
  min-width: 28px;
  padding: 0 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-chip);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}
.chat-goal-btn::after {
  content: '';
  position: absolute;
  inset: -8px;
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
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-chip);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--text-sm);
}
@media (max-width: 360px) {
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
.runov-sess-head {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 12px 8px;
}

.rs-glyph {
  flex: none;
  width: 14px;
  display: flex;
  justify-content: center;
  padding-top: 4px;
}

.rs-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--accent);
  animation: breathe 1.6s infinite ease-in-out;
}

/* 最新事件超过 90 秒：可能是宿主重启/断流，也可能是真卡住，转黄提示别干等。 */
.rs-dot-stale {
  background: var(--warning);
  animation: none;
}

.rs-body {
  flex: 1;
  min-width: 0;
}

.rs-title {
  display: block;
  font-size: var(--text-base);
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.rs-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.35;
}

.rs-meta > .sep,
.rs-sub > .sep {
  color: var(--text-quaternary);
}

.rs-action {
  color: var(--text-secondary);
}

.rs-cmd {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 42vw;
}

.rs-elapsed {
  color: var(--text-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.rs-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 3px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.rs-stale {
  color: var(--warning);
}

.rs-agents-count {
  color: var(--accent);
  font-weight: 600;
}

.rs-chev {
  flex: none;
  align-self: center;
  color: var(--text-quaternary);
  font-size: 16px;
}

/* 子代理：缩进 + 一条细轨表示从属关系 */
.rs-agents {
  padding: 0 12px 4px 34px;
}

.rs-agents-inner {
  border-left: 1px solid var(--border-default);
}

.rs-agent {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 6px 7px 9px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.rs-agent:active {
  background: var(--fill);
}

.rs-agent:disabled {
  cursor: default;
}

.rs-agent-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--accent);
  animation: breathe 1.6s infinite ease-in-out;
}

.rs-agent-dot-idle {
  background: var(--text-quaternary);
  animation: none;
}

.rs-agent-label {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rs-agent-dur {
  flex: none;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.rs-agent-chev {
  flex: none;
  color: var(--text-quaternary);
  font-size: 14px;
}

/* 折叠行：更多子代理 / 另有几个后台任务 */
.rs-more {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 12px 10px 34px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font: inherit;
  font-size: var(--text-xs);
  text-align: left;
  cursor: pointer;
}

.rs-more-chev {
  margin-left: auto;
  color: var(--text-quaternary);
}

.rs-sub-quiet {
  padding: 0 12px 10px 34px;
  color: var(--text-quaternary);
}

/* 组标题：计数与动作跟在标题后面，别让 hero 卡再报一遍同一个数字 */
.runov-group-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.runov-group-cnt {
  color: var(--text-quaternary);
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
}

.runov-group-action {
  margin-left: auto;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  cursor: pointer;
}

.runov-empty-note {
  padding: 4px 18px 6px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: 1.6;
}

/* 刚结束：两行（标题 + 状态·用时·多久以前），一屏能放六条 */
.runov-finish {
  margin: 2px 16px 10px;
}

.rf-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.rf-row:active {
  background: var(--fill);
}

.rf-row + .rf-row {
  border-top: 1px solid var(--border-subtle);
}

.rf-ic {
  flex: none;
  width: 14px;
  display: flex;
  justify-content: center;
}

.rf-ic-ok {
  color: var(--positive);
}

.rf-ic-bad {
  color: var(--danger);
}

.rf-ic-stop {
  color: var(--warning);
}

.rf-body {
  flex: 1;
  min-width: 0;
}

.rf-title {
  display: block;
  font-size: var(--text-md);
  font-weight: 600;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rf-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.rf-meta > .sep {
  color: var(--text-quaternary);
}

.rf-dur {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.rf-chev {
  flex: none;
  color: var(--text-quaternary);
  font-size: 15px;
}

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
  background: color-mix(in srgb, var(--warning, #f5a524) 18%, var(--bg-elevated, #1a1a1a));
  border-bottom: 1px solid var(--border-focus);
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
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
  cursor: pointer;
  text-align: left;
  font: inherit;
  animation: finish-toast-in 200ms ease-out;
}

@keyframes finish-toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}




.finish-toast-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-md);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.finish-toast-dur {
  flex: none;
  color: #a8a8bc;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

.finish-toast-chev {
  flex: none;
  color: #8a8a9e;
  font-size: 15px;
}

/* ===== 子代理只读会话页 ===== */
.subchat-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--text-xs);
  font-weight: 600;
}

.subchat-note {
  margin: 10px 16px 4px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.55;
}

.subchat-note b {
  color: var(--text-primary);
  font-weight: 600;
}

.subchat-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  padding: 8px 16px 12px;
}

.subchat-task {
  margin: 6px 0 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: var(--text-md);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.subchat-task-who {
  display: block;
  margin-bottom: 4px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.subchat-step {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 9px;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.subchat-step-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--text-quaternary);
}

.subchat-step-dot.is-running {
  background: var(--accent);
  animation: breathe 1.6s infinite ease-in-out;
}

.subchat-step-cmd {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subchat-step-state {
  flex: none;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.subchat-step-state.is-running {
  color: var(--accent);
}

.subchat-answer {
  margin: 0 0 12px;
  color: var(--text-primary);
  font-size: var(--text-md);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.subchat-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px calc(env(safe-area-inset-bottom, 0px) + 14px);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.subchat-foot-link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
  cursor: pointer;
}






/* 进阶折叠的箭头：收起时朝右，展开时朝下 */
.settings-advChev {
  display: inline-block;
  color: var(--text-quaternary);
  font-size: 16px;
  transition: transform 140ms ease-out;
}

.settings-advChev-open {
  transform: rotate(90deg);
}

/* 目标条上的进度摘要（已跑多久 · 第几步） */
.chat-goal-meta {
  flex: none;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--fill);
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
  border: 1.5px solid color-mix(in srgb, var(--accent) 35%, transparent);
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
  background: color-mix(in srgb, var(--danger) 22%, transparent);
  border-color: color-mix(in srgb, var(--danger) 55%, transparent);
  color: var(--danger);
}
.chat-stop-mini-text {
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1;
}

/* 运行中页的校准细条：只表示"在问宿主"，不遮挡内容 */
.runov-sync-bar {
  position: relative;
  height: 2px;
  flex: none;
  overflow: hidden;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
.runov-sync-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  width: 38%;
  background: var(--accent);
  animation: runovSync 1.05s ease-in-out infinite;
}
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
  min-height: 36px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
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
}

.approval-page-hint {
  margin: 0;
  padding: var(--palm-s3) var(--palm-s4) var(--palm-s4);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
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
  -webkit-overflow-scrolling: touch;
}

/* 审批主体是一列：元信息 → 命令块 → 风险条 → 操作。 */
.approval-detail {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--palm-s3);
  min-block-size: 0;
}

.approval-detail-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--palm-s2);
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
  border-radius: var(--palm-r-m);
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
  color: var(--palm-fg);
  font-family: var(--font-mono);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  white-space: pre;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.approval-detail-code {
  min-height: var(--palm-hit);
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

/* 黄色警告条：只在非只读审批上出现（只读不动手）。 */
.approval-detail-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--palm-s2);
  margin: 0;
  padding: var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-warn);
  border-radius: var(--palm-r-m);
  background: var(--palm-tint-warn);
  color: var(--palm-fg-2);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
}

.approval-detail-warning-icon {
  flex: none;
  inline-size: var(--palm-s4);
  block-size: var(--palm-s4);
  color: var(--palm-warn);
}

/* 两个决定并排，紧跟在风险条后面（定版图口径：动作属于这张审批卡）。 */
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
  background: var(--palm-tint-ok);
  color: var(--palm-fg);
}

.approval-detail-reject {
  border: var(--palm-hair) solid var(--palm-danger);
  background: var(--palm-tint-danger);
  color: var(--palm-fg);
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
  line-height: var(--palm-lh-body);
  color: var(--palm-fg);
  user-select: text;
  -webkit-user-select: text;
}

/*
 * 一行三列：行号（等宽右对齐）/ 增删符号 / 内容。
 * minmax(0, 1fr) 是窄屏不横向溢出的关键：内容列可被压缩，超长行截断而不是撑破卡片。
 */
.diff-page-row {
  display: grid;
  grid-template-columns: max-content var(--palm-s4) minmax(0, 1fr);
  align-items: baseline;
  padding: var(--palm-s1) var(--palm-s3) var(--palm-s1) var(--palm-s2);
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

/* 超长行在这里截断：pre 保住缩进，overflow+ellipsis 截掉右边。 */
.diff-page-text {
  padding-right: var(--palm-s2);
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
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
/* ── 模型与思考页（P6 ⑤ 屏） ───────────────────────────────────────── */

.model-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--palm-bg);
  color: var(--palm-fg);
}

.model-page-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--palm-s4);
}

/* grow 槽本身不是滚动容器：给正文一个确定高度（与审批页同一口径）。 */
.model-page [data-slot='diff'] {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.model-page-section + .model-page-section {
  margin-top: var(--palm-s5);
}

.model-page-title {
  margin: 0 0 var(--palm-s2);
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
  color: var(--palm-fg-2);
}

/* 一行一个选项：左主名、右状态，副标题压在下面。 */
.model-page-row {
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
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  color: var(--palm-fg);
}

/* 选中项：只换边色，不改结构（与结论卡同一套语义）。 */
.model-page-row[aria-pressed='true'] {
  border-color: var(--palm-accent);
  box-shadow: var(--palm-hi), var(--palm-sh1);
}

.model-page-row-main {
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
}

.model-page-row-sub {
  flex: 1 0 100%;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.model-page-row-mark {
  display: inline-flex;
  align-items: center;
  gap: var(--palm-s1);
  margin-left: auto;
  font-size: var(--palm-t-s);
  color: var(--palm-accent);
}

.model-page-row-mark > svg {
  flex: none;
  width: var(--palm-s4);
  height: var(--palm-s4);
}

.model-page-note {
  margin: 0 0 var(--palm-s3);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-2);
}

.model-page-hint {
  margin: 0;
  padding: var(--palm-s3) var(--palm-s4) var(--palm-s4);
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
  border-top: var(--palm-hair) solid var(--palm-line);
}


/* ── ⑤ 视觉重做：当前模型卡 / 三档分段 / 说明行（定版图口径）───── */

/* 当前模型卡：名字与说明在左，「切换」在右；底色用 accent 淡染，
   一眼就能和背景、和下面未选中的档位分开（定版图里当前项也是染色卡）。 */
.model-page-current {
  display: flex;
  align-items: center;
  gap: var(--palm-s3);
  padding: var(--palm-s4);
  border: var(--palm-hair) solid color-mix(in srgb, var(--palm-accent) 52%, var(--palm-line));
  border-radius: var(--palm-r-l);
  background: var(--palm-tint-accent);
  box-shadow: var(--palm-hi), var(--palm-sh1);
}

/* 模型图标（icons.tsx 的 16px 线性 SVG，定版尺寸只走令牌）。 */
.model-page-current > svg {
  flex: none;
  width: var(--palm-s4);
  height: var(--palm-s4);
  color: var(--palm-accent);
}

.model-page-current-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--palm-s1);
  min-inline-size: 0;
}

/* 卡里的模型名比列表行大一号：它是这一屏的主角。 */
.model-page-current .model-page-row-main {
  font-size: var(--palm-t-l);
  line-height: var(--palm-lh-head);
}

.model-page-current .model-page-row-sub {
  flex: none;
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-2);
  overflow-wrap: anywhere;
}

/* 切换：一枚 44px 的次级按钮，不跟模型名抢视线。 */
.model-page-switch {
  flex: none;
  min-inline-size: calc(var(--palm-hit) + var(--palm-s4));
  min-block-size: var(--palm-hit);
  padding: 0 var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-2);
  color: var(--palm-accent);
  font: inherit;
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-bold);
}

.model-page-switch[aria-expanded='true'] {
  border-color: var(--palm-accent);
  background: var(--palm-tint-accent);
}

/* 思考强度：三档分段；选中的那一档才有底色与强调描边。 */
.model-page-efforts {
  display: flex;
  gap: var(--palm-s1);
  padding: var(--palm-s1);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  background: var(--palm-sur-1);
}

.model-page-effort {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--palm-s1);
  min-inline-size: 0;
  min-block-size: calc(var(--palm-hit) + var(--palm-s2));
  padding: var(--palm-s1) var(--palm-s2);
  border: var(--palm-hair) solid transparent;
  border-radius: var(--palm-r-s);
  background: transparent;
  color: var(--palm-fg-2);
  font: inherit;
}

.model-page-effort .model-page-row-main {
  font-size: var(--palm-t-m);
  color: var(--palm-fg-2);
}

.model-page-effort .model-page-row-sub {
  flex: none;
  color: var(--palm-fg-3);
  text-align: center;
}

.model-page-effort[aria-pressed='true'] {
  border-color: var(--palm-accent);
  background: var(--palm-tint-accent);
}

.model-page-effort[aria-pressed='true'] .model-page-row-main {
  color: var(--palm-fg);
}

.model-page-effort[aria-pressed='true'] .model-page-row-sub {
  color: var(--palm-fg-2);
}

/* 分段下面的那行说明：贴着控件，不要飘到下一块去。 */
.model-page-efforts + .model-page-note {
  margin-top: var(--palm-s3);
}

.model-page-row:focus-visible,
.model-page-switch:focus-visible,
.model-page-effort:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: var(--palm-hair);
}

/* 空态里的「重新加载」沿用既有 .mobile-button，只把颜色接到 palm 令牌上。 */
.model-page .empty-state-action .mobile-button {
  border-color: var(--palm-line);
  background: var(--palm-sur-1);
  color: var(--palm-fg);
}
/* ── 外观页（P6 ⑭ 屏） ─────────────────────────────────────────────── */

.appearance-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--palm-bg);
  color: var(--palm-fg);
}

.appearance-page-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--palm-s4);
}

.appearance-section + .appearance-section {
  margin-top: var(--palm-s5);
}

.appearance-title {
  margin: 0 0 var(--palm-s2);
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
  color: var(--palm-fg-2);
}

.appearance-row {
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

.appearance-row[aria-pressed='true'] {
  border-color: var(--palm-accent);
  box-shadow: var(--palm-hi), var(--palm-sh1);
}

.appearance-row-main {
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
}

.appearance-row-sub {
  flex: 1 0 100%;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.appearance-row-mark {
  margin-left: auto;
  font-size: var(--palm-t-s);
  color: var(--palm-accent);
}

.appearance-page-hint {
  margin: var(--palm-s4) 0 0;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}


/* ── 皮肤预览卡（定版图：色板即该皮肤的真实配色）────────────────── */
.appearance-swatch {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 3px;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 6px;
  border-radius: var(--palm-r-m);
  background: var(--swatch-bg);
  border: 1px solid var(--palm-line);
}

.appearance-swatch-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--swatch-bar);
}

.appearance-swatch-dot {
  align-self: flex-end;
  width: 7px;
  height: 7px;
  border-radius: var(--palm-r-full);
  background: var(--swatch-accent);
}

.appearance-swatch-graphite { --swatch-bg: #15151c; --swatch-bar: #2a2a3a; --swatch-accent: #7c8cff; }
.appearance-swatch-paper    { --swatch-bg: #faf8f4; --swatch-bar: #e2ddd2; --swatch-accent: #8a5a2b; }
.appearance-swatch-nocturne { --swatch-bg: #0f1520; --swatch-bar: #1e2c40; --swatch-accent: #22d3ee; }

.appearance-row[aria-pressed='true'] .appearance-swatch {
  border-color: var(--palm-accent);
  box-shadow: 0 0 0 1px var(--palm-accent);
}


/* ── 搜索页（P6 ② 屏）：列表页入口 + 独立页 ─────────────────────── */

/* 会话列表顶部的搜索入口：外形沿用原来的内嵌搜索框，点一下进独立页。 */
.sess-searchEntry {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  height: var(--palm-hit);
  margin: var(--palm-s2) var(--palm-s4) 0;
  padding: 0 var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-l);
  background: var(--palm-sur-1);
  color: var(--palm-fg-3);
  font-size: var(--palm-t-m);
  text-align: left;
}

.sess-searchEntry:active {
  background: var(--palm-sur-2);
}

.sess-searchEntry svg {
  flex: none;
  width: 16px;
  height: 16px;
}

.sess-searchEntry-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--palm-bg);
  color: var(--palm-fg);
}

.search-page [data-slot='input'] {
  flex: none;
}

.search-page [data-slot='results'] {
  display: flex;
  flex-direction: column;
}

.search-page-bar {
  display: flex;
  align-items: center;
  gap: var(--palm-s2);
  height: var(--palm-hit);
  margin: var(--palm-s3) var(--palm-s4);
  padding: 0 var(--palm-s3);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-l);
  background: var(--palm-sur-1);
}

.search-page-bar:focus-within {
  border-color: var(--palm-accent);
}

.search-page-bar-icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--palm-fg-3);
}

.search-page-field {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--palm-fg);
  font: inherit;
  font-size: var(--palm-t-l);
  outline: none;
}

.search-page-field::placeholder {
  color: var(--palm-fg-3);
}

.search-page-clear {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--palm-hit);
  height: var(--palm-hit);
  margin-right: calc(var(--palm-s3) * -1);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--palm-fg-3);
}

.search-page-clear svg {
  width: 16px;
  height: 16px;
}

.search-page-clear:active {
  color: var(--palm-fg);
}

.search-page-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--palm-s4) var(--palm-s4);
}

.search-page-note {
  margin: 0;
  padding: var(--palm-s2) 0;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

.search-page-list {
  display: flex;
  flex-direction: column;
  border-top: var(--palm-hair) solid var(--palm-line);
}

.search-page-row {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s1);
  width: 100%;
  min-height: var(--palm-hit);
  padding: var(--palm-s3) var(--palm-s2);
  border: none;
  border-bottom: var(--palm-hair) solid var(--palm-line);
  background: transparent;
  color: var(--palm-fg);
  text-align: left;
}

.search-page-row:active {
  background: var(--palm-sur-1);
}

.search-page-row:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: calc(var(--palm-focus) * -1);
}

.search-page-row-head {
  display: flex;
  align-items: baseline;
  gap: var(--palm-s2);
  width: 100%;
}

.search-page-row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--palm-t-m);
  font-weight: var(--palm-w-bold);
}

.search-page-row-time {
  flex: none;
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
  font-variant-numeric: tabular-nums;
}

.search-page-row-snippet {
  display: -webkit-box;
  overflow: hidden;
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-2);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.search-page-row-meta {
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
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
  --outline-axis: color-mix(in srgb, var(--palm-fg-3) 48%, transparent);
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
  border-color: color-mix(in srgb, var(--palm-accent) 48%, var(--palm-line));
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
/* ── 产物列表页（P6 ⑧ 屏） ─────────────────────────────────────────── */

.artifacts-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--palm-bg);
  color: var(--palm-fg);
}

/* 顶部一句说明：横跨 header 的整行（.mobile-header 是 48px / 1fr / auto 三列网格）。 */
.artifacts-page-sub {
  grid-column: 1 / -1;
  margin: 0;
  padding: 0 var(--palm-s4) var(--palm-s2);
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-2);
}

.artifacts-page-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--palm-s4);
}

/* grow 槽本身不是滚动容器：正文自己滚，长清单才不会把页面撑出屏幕。 */
.artifacts-page [data-slot='list'] {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 一组 = 一轮：标题 → 文件卡，组内一律 8px；组与组之间 16px。
   卡片间距交给 gap，不再给每张卡留 margin（最后一张不会多出一截尾巴）。 */
.artifacts-group {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
}

.artifacts-group + .artifacts-group {
  margin-top: var(--palm-s4);
}

/* 分组标题：12px 灰，不抢文件名；整行仍是 44px 触控区（见 .artifacts-group-link）。 */
.artifacts-group-title {
  margin: 0;
  font-size: var(--palm-t-s);
  font-weight: var(--palm-w-normal);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-3);
}

/* 可点标题：右侧 16px 箭头表示"还有一轮摘要"。 */
.artifacts-group-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--palm-s1);
  inline-size: 100%;
  min-block-size: var(--palm-hit);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
}

.artifacts-group-link > svg {
  flex: none;
  inline-size: var(--palm-s4);
  block-size: var(--palm-s4);
  color: var(--palm-fg-3);
}

.artifacts-group-link:active {
  color: var(--palm-fg-2);
}

.artifacts-group-link:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: var(--palm-hair);
  border-radius: var(--palm-r-s);
}

/* 一张文件卡（两行）：第一行文件名 17/600 + 右侧类型标签；
   第二行路径 12px 灰、单行省略。内边距 12/14、圆角 12、1px hairline、表面色。 */
.artifacts-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--palm-s1) var(--palm-s2);
  inline-size: 100%;
  min-block-size: var(--palm-hit);
  padding: var(--palm-s3) 14px;
  text-align: start;
  background: var(--palm-sur-1);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  color: var(--palm-fg);
  font: inherit;
}

.artifacts-row:active {
  background: var(--palm-sur-2);
}

.artifacts-row:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: var(--palm-hair);
}

.artifacts-row-name {
  grid-column: 1;
  grid-row: 1;
  min-inline-size: 0;
  overflow: hidden;
  font-size: var(--palm-t-l);
  font-weight: var(--palm-w-bold);
  line-height: var(--palm-lh-head);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifacts-row-path {
  grid-column: 1 / -1;
  grid-row: 2;
  min-inline-size: 0;
  overflow: hidden;
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-3);
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 类型标签：交付物绿 / 产物蓝；18px 高、12px 字，贴在文件名右侧同一行。 */
.artifacts-row-badge {
  grid-column: 2;
  grid-row: 1;
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 var(--palm-s2);
  border-radius: var(--palm-r-s);
  font-size: var(--palm-t-s);
  line-height: 1;
  white-space: nowrap;
}

.artifacts-row-badge-deliverable {
  background: color-mix(in srgb, var(--palm-ok) 18%, transparent);
  color: var(--palm-ok);
}

.artifacts-row-badge-produced {
  background: color-mix(in srgb, var(--palm-accent) 18%, transparent);
  color: var(--palm-accent);
}

/* ── 产物摘要页（P6 ⑨ 屏，产物列表 ⑧ 的下级页） ───────────────────── */

/* 摘要页的行卡与 ⑧ 同款（共用 .artifacts-row），这里只声明"可选第三行"的排布。 */
.artifact-summary-row {
  grid-auto-rows: min-content;
}

/* 「本轮共 N 个文件」：12px 灰，紧跟分组标题。 */
.artifact-summary-meta {
  margin: 0;
  font-size: var(--palm-t-s);
  line-height: var(--palm-lh-body);
  color: var(--palm-fg-2);
}

.artifact-summary-list {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.artifact-summary-item {
  min-inline-size: 0;
}

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

/* ── 交付详情页（会话正文流 · 交付卡的下级页） ───────────────────────
 * 版式真源：overview.html「3 · 交付详情」。三组清单 = 交付物 / 新增 / 修改；
 * 行内只有「图标 + 文件名 + +A −D + 标签」，超 5 条折叠。 */
.palm-dd-body {
  display: flex;
  flex-direction: column;
  gap: var(--palm-s4);
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
  gap: var(--palm-s2);
  margin: 0;
  padding: 0;
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
  background: var(--palm-sur-1);
  border: var(--palm-hair) solid var(--palm-line);
  border-radius: var(--palm-r-m);
  color: var(--palm-fg);
  font: inherit;
}

.palm-dd-row:active { background: var(--palm-sur-2); }

.palm-dd-row:focus-visible {
  outline: var(--palm-focus) solid var(--palm-accent);
  outline-offset: var(--palm-hair);
}

.palm-dd-icon {
  display: inline-flex;
  color: var(--palm-fg-2);
}

.palm-dd-icon > svg {
  inline-size: var(--palm-s4);
  block-size: var(--palm-s4);
}

.palm-dd-name {
  min-inline-size: 0;
  overflow: hidden;
  font-size: var(--palm-t-m);
  text-overflow: ellipsis;
  white-space: nowrap;
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
  background: color-mix(in srgb, var(--palm-ok) 18%, transparent);
  color: var(--palm-ok);
  font-size: var(--palm-t-s);
}

.palm-dd-empty {
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

/* 占用条：四档宽度（不用行内样式，遵守 inlineStyles 棘轮）。 */
.context-bar {
  height: 12px;
  margin-bottom: var(--palm-s4);
  background: var(--palm-sur-2);
  border-radius: var(--palm-r-s);
  overflow: hidden;
}

.context-bar-fill {
  display: block;
  height: 100%;
  width: 25%;
  background: var(--palm-accent);
  border-radius: var(--palm-r-s);
}

.context-bar-fill[data-level='2'] { width: 50%; }
.context-bar-fill[data-level='3'] { width: 75%; }
.context-bar-fill[data-level='4'] { width: 100%; }

/* 快满了换警示色：只换色，不改结构。 */
.context-bar-fill[data-pressure='high'] { background: var(--palm-warn); }

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

.approval-mode-error {
  margin: var(--palm-s3) 0 0;
  font-size: var(--palm-t-s);
  color: var(--palm-danger);
}
`;
