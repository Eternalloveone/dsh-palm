/**
 * Mobile surface stylesheet, shipped as a string and injected at boot (the
 * standalone page has no CSS-module pipeline).
 *
 * Design system (2026-08 v2): one token vocabulary (--bg-page / --card-bg /
 * --text-primary …), one unified card spec — width 100% of the 16px-inset
 * column, 14px radius, --card-bg/--card-border/--card-shadow, fixed height
 * tiers (small 56 / medium 72 / bubble min 48) — and one internal alignment
 * grid (48px icon zone · fluid text · ≥48px right action zone) shared by
 * every card. The light palette is the :root default; dark applies through
 * data-theme='dark' and through prefers-color-scheme when the mode is
 * 'system'. Radii: chip 10 / card 14 / sheet 20 / menu 12 / capsule 24.
 */
export const mobileCss = `/* ── design tokens ───────────────────────────────────────────────────── */

:root {
  /* surfaces */
  --bg-page: #f5f5f7;
  --bg-surface: #ffffff;
  --bg-elevated: #f1f1f4;
  --bg-input: #ffffff;
  --dialog-bg: #ffffff;
  --toast-bg: #1a1a2e;
  --toast-text: #ffffff;
  /* text ladder */
  --text-primary: #1a1a2e;
  --text-secondary: #4a4a5a;
  --text-tertiary: #6a6a7a;
  --text-quaternary: #9a9aaa;
  --text-muted: #b0b0c0;
  /* borders */
  --border-default: #e2e4e8;
  --border-subtle: #f0f0f2;
  --border-focus: #6366f1;
  /* accent + status */
  --accent: #6366f1;
  --accent-contrast: #ffffff;
  --accent-soft: rgba(99, 102, 241, 0.1);
  --accent-glow: rgba(99, 102, 241, 0.2);
  --positive: #22c55e;
  --warning: #f59e0b;
  --danger: #ef4444;
  --danger-soft: rgba(239, 68, 68, 0.1);
  /* unified card spec */
  --card-bg: #ffffff;
  --card-border: #e8e8ed;
  --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 8px 28px rgba(16, 24, 40, 0.16);
  /* interaction washes */
  --fill: rgba(26, 26, 46, 0.05);
  --fill-strong: rgba(26, 26, 46, 0.09);
  /* code blocks: clearly darker than the page so the panel reads at a
     glance (light: #e8ecf2 body + #dfe4ec head bar; github-light tokens) */
  --code-bg: #e8ecf2;
  --code-text: #3a3f52;
  --code-border: #d0d7de;
  --code-head-bg: #dfe4ec;
  --code-head-border: #d0d7de;
  /* syntax tokens (one-light palette: warm triad — purple keywords, green
     strings, orange-gold numbers/types — reads clearly on small screens) */
  --tok-keyword: #a626a4;
  --tok-string: #50a14f;
  --tok-comment: #a0a1a7;
  --tok-number: #986801;
  --tok-type: #e45649;
  --tok-func: #4078f2;
  --tok-prop: #986801;
  /* diff view */
  --diff-add: #22c55e;
  --diff-del: #ef4444;
  --diff-add-bg: rgba(34, 197, 94, 0.12);
  --diff-del-bg: rgba(239, 68, 68, 0.12);
  --diff-add-word: rgba(34, 197, 94, 0.22);
  --diff-del-word: rgba(239, 68, 68, 0.22);
  /* chrome */
  --backdrop: rgba(15, 18, 34, 0.45);
  --header-bg: rgba(245, 245, 247, 0.97);
  /* type */
  --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Noto Sans SC', 'Segoe UI', sans-serif;
  --font-mono: 'SF Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  /* radii ladder */
  --radius-chip: 10px;
  --radius-card: 14px;
  --radius-sheet: 20px;
  --radius-menu: 12px;
  --radius-capsule: 24px;
  --radius-full: 9999px;
  /* spacing ladder (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  /* type scale */
  --text-xs: 11px;
  --text-sm: 12px;
  --text-md: 13px;
  --text-base: 15px;
  --text-lg: 16.5px;
}

/* Explicit dark: pinned by the toggle, the settings sheet, or the host. */
:root[data-theme='dark'] {
  --bg-page: #0a0a0f;
  --bg-surface: #13131a;
  --bg-elevated: #1c1c28;
  --bg-input: #16161f;
  --dialog-bg: #1c1c28;
  --toast-bg: #2a2a3a;
  --toast-text: #f0f0f5;
  --text-primary: #f0f0f5;
  --text-secondary: #a0a0b0;
  --text-tertiary: #6a6a7a;
  --text-quaternary: #4a4a5a;
  --text-muted: #3a3a4a;
  --border-default: #2a2a3a;
  --border-subtle: #1e1e2a;
  --border-focus: #3a3a50;
  --accent: #6366f1;
  --accent-contrast: #ffffff;
  --accent-soft: rgba(99, 102, 241, 0.15);
  --accent-glow: rgba(99, 102, 241, 0.3);
  --positive: #4ade80;
  --warning: #fbbf24;
  --danger: #f87171;
  --danger-soft: rgba(248, 113, 113, 0.14);
  --card-bg: #13131a;
  --card-border: #1e1e2a;
  --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  --shadow-lg: 0 8px 28px rgba(0, 0, 0, 0.5);
  --fill: rgba(240, 240, 245, 0.06);
  --fill-strong: rgba(240, 240, 245, 0.1);
  --code-bg: #161b22;
  --code-text: #b8bad0;
  --code-border: #30363d;
  --code-head-bg: #1c2128;
  --code-head-border: #30363d;
  /* syntax tokens (one-dark palette) */
  --tok-keyword: #c678dd;
  --tok-string: #98c379;
  --tok-comment: #5c6370;
  --tok-number: #d19a66;
  --tok-type: #e5c07b;
  --tok-func: #61afef;
  --tok-prop: #d19a66;
  --diff-add: #4ade80;
  --diff-del: #f87171;
  --diff-add-bg: rgba(74, 222, 128, 0.12);
  --diff-del-bg: rgba(248, 113, 113, 0.12);
  --diff-add-word: rgba(74, 222, 128, 0.25);
  --diff-del-word: rgba(248, 113, 113, 0.25);
  --backdrop: rgba(0, 0, 0, 0.6);
  --header-bg: rgba(10, 10, 15, 0.96);
}

/* System mode: the OS scheme decides while no palette is pinned. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg-page: #0a0a0f;
    --bg-surface: #13131a;
    --bg-elevated: #1c1c28;
    --bg-input: #16161f;
    --dialog-bg: #1c1c28;
    --toast-bg: #2a2a3a;
    --toast-text: #f0f0f5;
    --text-primary: #f0f0f5;
    --text-secondary: #a0a0b0;
    --text-tertiary: #6a6a7a;
    --text-quaternary: #4a4a5a;
    --text-muted: #3a3a4a;
    --border-default: #2a2a3a;
    --border-subtle: #1e1e2a;
    --border-focus: #3a3a50;
    --accent: #6366f1;
    --accent-contrast: #ffffff;
    --accent-soft: rgba(99, 102, 241, 0.15);
    --accent-glow: rgba(99, 102, 241, 0.3);
    --positive: #4ade80;
    --warning: #fbbf24;
    --danger: #f87171;
    --danger-soft: rgba(248, 113, 113, 0.14);
    --card-bg: #13131a;
    --card-border: #1e1e2a;
    --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    --shadow-lg: 0 8px 28px rgba(0, 0, 0, 0.5);
    --fill: rgba(240, 240, 245, 0.06);
    --fill-strong: rgba(240, 240, 245, 0.1);
    --code-bg: #161b22;
    --code-text: #b8bad0;
    --code-border: #30363d;
    --code-head-bg: #1c2128;
    --code-head-border: #30363d;
    /* syntax tokens (one-dark palette, system mode) */
    --tok-keyword: #c678dd;
    --tok-string: #98c379;
    --tok-comment: #5c6370;
    --tok-number: #d19a66;
    --tok-type: #e5c07b;
    --tok-func: #61afef;
    --tok-prop: #d19a66;
    --diff-add: #4ade80;
    --diff-del: #f87171;
    --diff-add-bg: rgba(74, 222, 128, 0.08);
    --diff-del-bg: rgba(248, 113, 113, 0.08);
    --diff-add-word: rgba(74, 222, 128, 0.25);
    --diff-del-word: rgba(248, 113, 113, 0.25);
    --backdrop: rgba(0, 0, 0, 0.6);
    --header-bg: rgba(10, 10, 15, 0.96);
  }
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

.page {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.page-enter-fwd {
  animation: page-in-fwd 0.25s ease-out both;
}

.page-exit-fwd {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
  animation: page-out-fwd 0.25s ease-out both;
}

.page-enter-back {
  animation: page-in-back 0.25s ease-out both;
}

.page-exit-back {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
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
  z-index: 10;
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

.mobile-groupTitle {
  height: 32px;
  padding: 0 16px;
  display: flex;
  align-items: flex-end;
  padding-bottom: 4px;
  margin-bottom: 8px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 500;
  letter-spacing: 0.5px;
  text-transform: uppercase;
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
  /* <button> is shrink-to-fit on width:auto — pin the card to the 16px-inset column. */
  width: calc(100% - 32px);
  margin: 0 16px 8px;
  padding: 0 16px;
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

/* 按压态：scale(0.98) + 背景变亮 5% */
.mobile-row:active {
  transform: scale(0.98);
  background: color-mix(in srgb, var(--text-primary) 5%, var(--card-bg));
  border-color: var(--border-default);
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

.ws-icon-test > * {
  background: color-mix(in srgb, var(--warning) 15%, transparent);
  color: var(--warning);
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

/* Right action zone: right-aligned, min 48px, always in the same place. */
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

.mobile-live {
  margin-left: 6px;
  color: var(--positive);
  font-size: 10px;
  vertical-align: middle;
}

/* Legacy column layout still used by a few stacked rows (settings forms). */
.mobile-rowMain {
  grid-column: 1 / -1;
  min-width: 0;
  padding: 14px 0;
}

.mobile-rowBottom {
  display: flex;
  align-items: center;
  gap: var(--space-2);
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

.mobile-rowMeta {
  flex: 1;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 400;
  overflow-wrap: anywhere;
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

/* ── session cards ───────────────────────────────────────────────────── */

.sess-row .card-main {
  padding: 12px 0;
}

.sess-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--text-muted);
}

.sess-dot-running {
  background: var(--positive);
  animation: pulse 2s infinite ease-in-out;
}

/* Title line: title · time merged on one truncating line. */
.sess-titleline {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.sess-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
}

.sess-sep {
  flex: none;
  color: var(--text-muted);
  font-size: var(--text-xs);
}

.sess-time {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-quaternary);
  font-variant-numeric: tabular-nums;
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
.settings-badge-phone { background: #e8f7ee; color: #1a9e5c; }
.settings-badge-sync { background: var(--accent-soft, #eef1ff); color: var(--accent, #4d6bfe); }
.settings-badge-desktop { background: #f3f4f6; color: #9aa0a8; }
.settings-badge-ro { background: #fdf0f0; color: #e5484d; }
.settings-badge-recommend { background: #fff4e5; color: #e8890c; }

/* Channel-setup disclosure (PushPlus 3-step helper): native details chrome
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
  border-bottom: 1px solid var(--border, #e5e7eb);
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
.settings-inboxKind-task-done { background: #e8f7ee; color: #1a9e5c; }
.settings-inboxKind-task-failed { background: #fdf0f0; color: #e5484d; }
.settings-inboxKind-todo-done { background: #eaf3ff; color: #2f6fed; }
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
  background: #f3f4f6;
  color: #9aa0a8;
  margin-top: 2px;
}
.settings-channelState-on {
  background: #e8f7ee;
  color: #1a9e5c;
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
  border: 1px solid var(--accent-border, #dbe1ff);
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
.mobile-welcomeClose {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: var(--accent, #4d6bfe);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 2px;
  cursor: pointer;
}

/* Legend under the search box explaining the badges. Two-column grid:
   badge column fixed, text column left-aligned — every explanation starts
   at the same x, and the rows never reflow into ragged starts. */
.settings-legend {
  display: grid;
  grid-template-columns: 56px 1fr;
  column-gap: 8px;
  row-gap: 6px;
  align-items: center;
  margin: 0 16px 12px;
  font-size: 10.5px;
  color: var(--text-tertiary);
}
.settings-legend .settings-badge {
  justify-self: start;
}

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
  background: #f3f4f6;
  color: #9aa0a8;
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
  background: var(--bg-subtle, #fafbfc);
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
.settings-roKey { color: var(--text-tertiary); flex-shrink: 0; }
.settings-roValue {
  color: var(--text-primary);
  font-weight: 500;
  text-align: right;
  word-break: break-all;
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

.settings-rowLabel {
  min-width: 0;
}

.settings-rowValue {
  color: var(--text-quaternary);
  font-size: var(--text-md);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
}

/* Toggle switch: 44 × 24, 12px radius, accent when on. */
.settings-switch,
.sheet-toggle-switch {
  position: relative;
  flex: none;
  width: 44px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 12px;
  background: var(--border-default);
  cursor: pointer;
  transition: background-color 0.18s ease;
}

.settings-switch::after,
.sheet-toggle-switch-knob {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform 0.18s ease;
}

.settings-switch-on,
.sheet-toggle-switch-on {
  background: var(--accent);
}

.settings-switch-on::after,
.sheet-toggle-switch-on .sheet-toggle-switch-knob {
  transform: translateX(20px);
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

/* Skeleton rows mirror the real card tiers (72px medium / 56px small). */
.skel-row {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 48px;
  align-items: center;
  gap: var(--space-3);
  height: 72px;
  margin: 0 16px 8px;
  padding: 0 16px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-card);
  background: var(--card-bg);
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

.mobile-new {
  display: block;
  width: calc(100% - 32px);
  height: 48px;
  margin: 0 16px;
  border: none;
  border-radius: var(--radius-card);
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  font-size: var(--text-base);
  font-weight: 500;
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

/* Agent-mode selector card (small-card tier): custom trigger + "?" hint.
 * The trigger opens a bottom-sheet option list (no native select popup). */
.mobile-presetCard {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16px 48px;
  align-items: center;
  column-gap: var(--space-1);
  margin: 0 16px 8px;
  min-height: 56px;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-card);
  background: var(--card-bg);
  box-shadow: var(--card-shadow);
  overflow: hidden;
}

.mobile-presetTrigger {
  width: 100%;
  min-height: 54px;
  padding: 8px 0 8px 16px;
  display: flex;
  align-items: center;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.mobile-presetTrigger:active {
  background: var(--fill);
}

.mobile-presetTrigger:disabled {
  opacity: 0.6;
}

.mobile-presetTriggerCopy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mobile-presetTriggerTitle {
  font-size: var(--text-base);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mobile-presetTriggerDesc {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mobile-presetCaret {
  pointer-events: none;
  color: var(--text-quaternary);
  font-size: 14px;
  text-align: center;
}

.mobile-presetHelp {
  width: 48px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-left: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.mobile-presetHelp svg {
  width: 18px;
  height: 18px;
}

.mobile-presetHelp:active {
  background: var(--fill);
}

.mobile-presetHelp:disabled {
  opacity: 0.4;
}

.mobile-presetDescription {
  margin: 0 16px 8px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  line-height: 1.5;
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
  padding: 16px 12px calc(env(safe-area-inset-bottom, 0px) + 16px);
  display: flex;
  flex-direction: column;
  /* Flat (bubble-less) rows need more air than a carded layout: 20px keeps
     each message readable as its own block. */
  gap: var(--space-5);
}

/* Scroll children never shrink. The bubbles pin an explicit min-height
   (48px tier), which replaces flex's automatic min-content floor — without
   this, a long column of messages gets crushed to 48px each and the
   overflow visually overlaps the neighbours. */
.chat-scroll > * {
  flex-shrink: 0;
}

/* Density preference (settings): 紧凑 tightens the message rhythm. */
[data-density='compact'] .chat-scroll {
  gap: var(--space-2);
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
  background: var(--surface-2);
  color: var(--text-2);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  cursor: pointer;
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

/* Font-size preference: 小 / 标准 / 大 on message text. */
[data-font-scale='small'] .chat-msg {
  font-size: 14px;
}

[data-font-scale='large'] .chat-msg {
  font-size: var(--text-lg);
}

/* Message bubbles — the large-card tier. */
.chat-msg {
  max-width: 85%;
  min-height: 48px;
  padding: 12px 16px;
  border-radius: var(--radius-card);
  font-size: var(--text-base);
  font-weight: 400;
  line-height: 1.7;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  animation: msg-in 0.18s ease both;
}

/* 消息正文允许选择文字（局部复制）：body 全局 user-select:none 只豁免
   输入框，这里放开正文/代码块，长按走系统选择，自定义菜单让位。 */
.chat-msg-text,
.chat-msg-plain,
.code-block pre,
.diff-block .diff-row-text {
  min-width: 0;
  max-width: 100%;
  user-select: text;
  -webkit-user-select: text;
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

.chat-msg-user {
  align-self: flex-end;
  width: auto;
  max-width: 85%;
  background: var(--accent);
  color: var(--accent-contrast);
  border-radius: 12px;
  box-shadow: 0 1px 3px var(--accent-glow);
}

/* Assistant messages are full-width flat rows (Kimi-style, no bubble):
   the visual hierarchy comes from the content itself — code-block and
   diff cards, headings, blockquotes — not from a card frame around the
   whole message. Only user messages keep a light bubble. */
.chat-msg-assistant {
  align-self: stretch;
  width: auto;
  max-width: none;
  background: transparent;
  border: none;
  box-shadow: none;
  border-radius: 0;
  padding: 0;
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
}

.chat-command-name {
  color: var(--text-secondary);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.chat-command-result {
  color: var(--text-tertiary);
}

.chat-command-error .chat-command-result {
  color: var(--danger);
}

.chat-msg-user .chat-msg-time {
  color: rgba(255, 255, 255, 0.6);
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

.chat-md-collapsed {
  max-height: 45vh;
  overflow: hidden;
  position: relative;
}

.chat-md-collapsed::after {
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
   its inner wrapper), so the sibling rhythm lives on .chat-md edges. */
.chat-md + .chat-md { margin-top: 16px; }
/* Paragraph → code/diff card: the card is a sibling of the .md-html run
   (not of the <p> inside it), so the gap lives on the run boundary. */
.chat-md .md-html + .code-block,
.chat-md .md-html + .diff-block { margin-top: 12px; }
/* Text run → diff artifact card (and back): FlowBody renders the card as a
   sibling of the .chat-md runs, so the 12px breathing room must live on
   those sibling edges — the old .chat-artifacts container (margin 12px 0)
   never rendered, leaving the card glued to the text. */
.chat-md + .chat-artifact { margin-top: 12px; }
.chat-artifact + .chat-md { margin-top: 12px; }
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
  font-family: var(--font-mono);
  font-size: 0.88em; /* ≈13px at the default 15px message size */
  background: var(--bg-elevated);
  color: var(--accent);
  padding: 2px 6px;
  border-radius: 4px;
  border: none;
  box-shadow: none;
}
.chat-md-body ul, .chat-md-body ol { margin: 4px 0 8px; padding-left: 22px; }
.chat-md-body li { margin: 2px 0; }
.chat-md-body blockquote {
  margin: 8px 0;
  padding: 4px 12px;
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
  padding: 4px 8px;
}
.chat-md-body th { background: var(--fill); font-weight: 500; }
.chat-md-body a { color: var(--accent); }
.chat-md-body hr { border: none; border-top: 1px solid var(--border-subtle); margin: 10px 0; }
.chat-md-body img { max-width: 100%; border-radius: var(--radius-chip); }

/* ── code blocks: 12px card, 40px head bar, action buttons, Shiki body ── */

.code-block {
  /* Top gap after a paragraph comes from .chat-md-body p + .code-block
     (12px, margin collapse); between components the block keeps 12px. */
  margin: 0 0 12px;
  border: 1px solid var(--code-border);
  border-radius: 12px;
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
  gap: 2px;
}

.code-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-width: 32px;
  height: 32px;
  padding: 0 6px;
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
  scrollbar-width: none;
}

.code-body::-webkit-scrollbar {
  display: none;
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
  font-size: var(--text-md);
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

.chat-disclosure-count {
  flex: none;
  color: var(--text-quaternary);
  font-size: var(--text-xs);
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

.chat-tooldisc-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.chat-tool-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: 8px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: var(--card-bg);
}

.chat-tool-pills {
  display: flex;
  gap: var(--space-1);
  flex-wrap: wrap;
  align-items: center;
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
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}

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
  overflow-wrap: break-word;
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
  color: var(--muted);
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

/* Foreground-subagent count badge on the turn-status bar. */
.chat-subagent-badge {
  flex: none;
  margin-left: auto;
  padding: 2px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  color: var(--accent);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
}

.chat-subagent-badge:active {
  background: var(--fill);
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
  color: var(--success, var(--accent));
}

.chat-run-job-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ── background-task status bar (session/jobs) ───────────────────────── */

.chat-taskbar {
  margin: 0 12px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: var(--bg-elevated);
  overflow: hidden;
}

.chat-taskbar-head {
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
  text-align: left;
  cursor: pointer;
}

.chat-taskbar-head:active {
  background: var(--fill);
}

.chat-taskbar-label {
  flex: none;
  color: var(--text-secondary);
  font-weight: 500;
}

.chat-taskbar-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 400;
}

.chat-taskbar-open .chat-disclosure-caret {
  transform: rotate(180deg);
}

.chat-taskbar-body {
  padding: 4px 12px 10px;
  border-top: 1px dashed var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

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
  background: var(--success, #3fae6a);
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
}

.chat-task-time {
  color: var(--text-quaternary);
  font-size: var(--text-xs);
}

/* ── foreground-subagent tree sheet ────────────────────────────────────── */

.chat-subagent-tree {
  display: flex;
  flex-direction: column;
  gap: 10px;
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

.chat-subagent-empty {
  margin: 0;
  padding: 8px 0;
  color: var(--text-tertiary);
  font-size: var(--text-md);
}

/* ── approval / question panels ──────────────────────────────────────── */

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

/* ── composer toolbar pills ──────────────────────────────────────────── */

/* One row, two zones: the icon pills (model/permission) on the left, the
   context ring pinned on the right (flex: none) so the session's
   occupancy never scrolls out of view. The row never scrolls: the model
   pill (the only elastic one) shrinks with an ellipsis while the
   permission pill and the ring stay fixed and always visible. */
.chat-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px 0;
}

.chat-tools-actions {
  display: flex;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.chat-pill {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: 16px;
  background: var(--card-bg);
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.12s ease, background-color 0.12s ease, color 0.12s ease, transform 0.1s ease;
}

.chat-pill > svg {
  color: var(--accent);
}

.chat-pill:active {
  transform: scale(0.96);
  border-color: var(--border-focus);
  background: var(--accent-soft);
}

.chat-pill-name {
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-pill-chevron {
  flex: none;
  color: var(--text-quaternary);
  font-size: 10px;
}

/* Permission pills never shrink: their text is short and stays visible. */
.chat-pill-perm {
  flex: none;
}

/* Permission level colors ride the shield icon (and the pill edge for the
   full-access level) — color is the status channel. */
.chat-pill-perm-read > svg {
  color: var(--text-tertiary);
}

.chat-pill-perm-write > svg {
  color: var(--accent);
}

.chat-pill-perm-full {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border-default));
  color: var(--danger);
}

.chat-pill-perm-full > svg {
  color: var(--danger);
}

/* Context meter (status zone): an SVG occupancy ring + the percentage;
   the exact counts live in the title. ≥80% flips ring and figures to the
   danger color. */
.chat-context {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding-left: 12px;
  border-left: 1px solid var(--border-default);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.chat-context-ring {
  flex: none;
  display: block;
}

.chat-context-ring-track {
  stroke: var(--fill);
}

.chat-context-ring-fill {
  stroke: var(--accent);
  transition: stroke-dasharray 0.3s ease;
}

.chat-context-warn {
  color: var(--danger);
}

.chat-context-warn .chat-context-ring-fill {
  stroke: var(--danger);
}

/* Context-usage popover: tap the ring to see the exact figures. Anchored
   to the toolbar (its stacking context), floating above the message
   list; an invisible fixed scrim closes it on outside taps. */
.chat-context-pop {
  position: absolute;
  right: 16px;
  bottom: calc(100% + 10px);
  z-index: 45;
  min-width: 150px;
  padding: 10px 12px;
  border: 1px solid var(--border-default);
  border-radius: 12px;
  background: var(--card-bg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
}

.chat-context-pop-title {
  font-size: var(--text-xs);
  color: var(--text-quaternary);
}

.chat-context-pop-figures {
  margin-top: 2px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.chat-context-pop-figures span {
  margin: 0 3px;
  color: var(--text-quaternary);
  font-weight: 400;
}

.chat-context-pop-sub {
  margin-top: 2px;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.chat-context-pop-scrim {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 40;
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
  z-index: 40;
  background: rgba(15, 15, 25, 0.2);
}

.chat-tools,
.chat-composer {
  position: relative;
  z-index: 50;
}

/* Vertical panel: search field on top, then grouped rows (model) or the
   full preset list (permission). Scrolling is the fallback, not the
   primary discovery path — the search field narrows the list first. */
.chat-picker-panel {
  position: relative;
  z-index: 50;
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
  border-top: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--bg-page) 88%, transparent);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
}

.chat-composer .chat-inputbar {
  border-top: none;
}

.chat-attach-btn {
  flex: none;
  align-self: flex-end;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 10px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}

.chat-attach-btn:active {
  background: var(--bg-hover);
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

.chat-inputbar {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: 8px 12px calc(env(safe-area-inset-bottom, 0px) + 10px);
  padding-bottom: max(calc(env(safe-area-inset-bottom, 0px) + 10px), 10px);
  border-top: 1px solid var(--border-subtle);
  background: color-mix(in srgb, var(--bg-page) 88%, transparent);
  -webkit-backdrop-filter: blur(20px);
  backdrop-filter: blur(20px);
}

.chat-input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  max-height: 132px;
  field-sizing: content;
  padding: 9px 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-capsule);
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  font-size: 16px; /* ≥16px：防止 iOS 聚焦缩放 */
  font-weight: 400;
  line-height: 1.45;
  resize: none;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.chat-input::placeholder {
  color: var(--text-muted);
}

.chat-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.chat-send {
  flex: none;
  align-self: flex-end;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-full);
  background: var(--accent);
  color: var(--accent-contrast);
  font: inherit;
  cursor: pointer;
  box-shadow: 0 2px 10px var(--accent-glow);
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
  background: var(--fill);
  color: var(--text-muted);
  box-shadow: none;
}

.chat-send svg {
  width: 18px;
  height: 18px;
}

.chat-send-stop {
  background: var(--bg-elevated);
  color: var(--danger);
  box-shadow: inset 0 0 0 1px var(--border-default);
}

.chat-load-older {
  align-self: center;
  margin: 4px 0;
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

.chat-meta {
  margin-top: 4px;
  color: var(--text-quaternary);
  font-size: var(--text-xs);
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
  z-index: 70;
}

.ctx-menu {
  position: fixed;
  z-index: 71;
  min-width: 148px;
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

.ctx-item-danger {
  color: var(--danger);
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
  z-index: 60;
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

.sheet-status {
  padding: 18px 8px;
  color: var(--text-tertiary);
  font-size: var(--text-md);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.sheet-status-error {
  color: var(--danger);
}

.sheet-hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.5;
  max-width: 32em;
}

.sheet-error {
  margin: 0 0 8px;
  color: var(--danger);
  font-size: 12.5px;
}

.sheet-section {
  margin-bottom: 14px;
}

.sheet-section-title {
  padding: 4px 8px 6px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 500;
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

.sheet-toggle-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 56px;
  padding: 8px 8px;
  border-bottom: 1px solid var(--border-subtle);
}

.sheet-toggle-row:last-child {
  border-bottom: none;
}

.sheet-toggle-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sheet-toggle-title {
  font-size: 14px;
  font-weight: 400;
}

.sheet-toggle-desc {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: 1.4;
}

/* ── centered confirm dialog ─────────────────────────────────────────── */

.dialog-backdrop {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 60;
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
  bottom: calc(104px + env(safe-area-inset-bottom, 0px));
  z-index: 80;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  pointer-events: none;
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
}

/* ── focus rings ─────────────────────────────────────────────────────── */

.mobile-back:focus-visible,
.mobile-theme-toggle:focus-visible,
.mobile-iconbtn:focus-visible,
.mobile-headerAction:focus-visible,
.mobile-quickchip:focus-visible,
.mobile-searchInput:focus-visible,
.mobile-row:focus-visible,
.mobile-createCard:focus-visible,
.mobile-presetTrigger:focus-visible,
.mobile-presetHelp:focus-visible,
.mobile-button:focus-visible,
.mobile-new:focus-visible,
.settings-themeOption:focus-visible,
.settings-optionChip:focus-visible,
.settings-switch:focus-visible,
.sheet-toggle-switch:focus-visible,
.dialog-btn:focus-visible,
.dialog-input:focus-visible,
.chat-send:focus-visible,
.chat-chip:focus-visible,
.chat-msg-toggle:focus-visible,
.chat-load-older:focus-visible,
.chat-disclosure-head:focus-visible,
.chat-question-option:focus-within,
.ctx-item:focus-visible,
.sheet-option:focus-visible,
.sheet-confirm-danger:focus-visible,
.chat-input:focus-visible {
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
  .mobile-new,
  .chat-send,
  .chat-chip,
  .chat-msg,
  .chat-msg-toggle,
  .chat-load-older,
  .chat-disclosure-head,
  .chat-disclosure-caret,
  .chat-disclosure-body,
  .sess-dot-running,
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
  .sheet-toggle-switch-knob,
  .chat-input,
  .chat-turn-dots span,
  .settings-themeOption,
  .settings-optionChip {
    animation: none;
    transition: none;
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

/* Code copy success state. */
.code-copy-done {
  color: var(--positive);
  font-weight: 500;
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
   queued while the current turn runs, above the composer. */
.queue-dock {
  flex: none;
  margin: 0 12px 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: 12px;
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
.queue-dockRow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--card-bg);
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
  gap: 4px;
}
.queue-dockBtn {
  flex: none;
  padding: 3px 8px;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.queue-dockBtn-primary {
  border-color: var(--accent, #4f7cff);
  color: var(--accent, #4f7cff);
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
  z-index: 55;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  background: var(--backdrop);
  animation: sheet-fade 0.18s ease;
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

.voice-wave span:nth-child(1) { animation-delay: 0s; }
.voice-wave span:nth-child(2) { animation-delay: 0.12s; }
.voice-wave span:nth-child(3) { animation-delay: 0.24s; }
.voice-wave span:nth-child(4) { animation-delay: 0.36s; }
.voice-wave span:nth-child(5) { animation-delay: 0.48s; }

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
  height: 40px;
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
}

/* Toggle knob spring (overshoot then settle, 200ms). */
.settings-switch::after,
.sheet-toggle-switch-knob {
  transition: transform 0.2s cubic-bezier(0.34, 1.8, 0.64, 1);
}

/* Tapped setting row flashes the elevated wash (100ms). */
button.settings-row {
  transition: background-color 0.1s ease;
}

button.settings-row:active {
  background: var(--bg-elevated) !important;
}

/* ── reduced motion additions ────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  .mobile-headerSearch,
  .mobile-empty-groupBtn,
  .chat-reasoning-more,
  .chat-offline-banner,
  .chat-offline-retry,
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
.search-hitsNote {
  margin: 0;
  padding: 4px 2px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: 1.45;
}

/* Focus-locate highlight: a one-shot background pulse on the located row. */
@keyframes dshPalmFocusPulse {
  0% { background-color: var(--focus-bg, rgba(79, 124, 255, 0.22)); }
  100% { background-color: transparent; }
}

.chat-msg-focus {
  animation: dshPalmFocusPulse 2.2s ease-out forwards;
}

.chat-search-mark {
  color: inherit;
  background: color-mix(in srgb, var(--accent) 34%, transparent);
  border-radius: 3px;
  padding: 0 1px;
}

/* Settings-search locate: the anchored sub-page entry pulses once on
   arrival, so the user sees which control the search found. */
[data-locate-id][data-focus] {
  animation: dshPalmFocusPulse 2.2s ease-out forwards;
}
`;
