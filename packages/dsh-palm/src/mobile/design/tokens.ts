/**
 * 手机端设计 token 的唯一真源（W1-2）。
 *
 * 之前三份调色板各写各的：`:root`（浅色）、`:root[data-theme='dark']`（钉死深色）、
 * `@media (prefers-color-scheme: dark)`（跟随系统深色）。后两者本该逐字相同，实际已经
 * 漂移（--diff-add-bg / --diff-del-bg 0.12 vs 0.08）。现在只有 LIGHT / DARK 两张表，
 * 三处 CSS 全部由 designTokensCss() 生成；tokens.test.ts 会拦「两套键集不一致」与
 * 「改了表却没进 CSS」。
 *
 * 改色只改这里，不要再去 mobile-styles.ts 里手写 --var。
 * @module dsh-palm/mobile/design/tokens
 */

/** 一套完整的主题色。两套的键集必须完全一致。 */
export type Palette = Readonly<Record<`--${string}`, string>>

/** 浅色：`:root` 的默认值。 */
export const LIGHT_PALETTE: Palette = {
  '--bg-page': '#f5f5f7',
  '--bg-surface': '#ffffff',
  '--bg-elevated': '#f1f1f4',
  '--bg-input': '#ffffff',
  '--dialog-bg': '#ffffff',
  '--toast-bg': '#1a1a2e',
  '--toast-text': '#ffffff',
  '--text-primary': '#1a1a2e',
  '--text-secondary': '#4a4a5a',
  '--text-tertiary': '#6a6a7a',
  // W2-1：文字收敛成三级。quaternary/muted 曾是 2.55 / 1.96（远低于 AA），
  // 把元信息做成「浅到看不清」不是层级，是缺陷；现在它们是三级文字的**兼容别名**，
  // 视觉层级改由字号与字重承担，新代码不要再引用这两个名字。
  '--text-quaternary': '#6a6a7a',
  '--text-muted': '#6a6a7a',
  '--border-default': '#e2e4e8',
  '--border-subtle': '#f0f0f2',
  '--border-focus': '#6366f1',
  // W2-1：#6366f1 上放白字只有 4.47，差一点点不达标；压到 #5b5cf0 后是 4.96，
  // 同时它当文字用在白底上也是 4.96（原来 4.47）。
  '--accent': '#5b5cf0',
  '--accent-contrast': '#ffffff',
  '--accent-soft': 'rgba(91, 92, 240, 0.1)',
  '--accent-glow': 'rgba(91, 92, 240, 0.2)',
  '--positive': '#22c55e',
  '--warning': '#f59e0b',
  '--danger': '#ef4444',
  '--danger-soft': 'rgba(239, 68, 68, 0.1)',
  '--tone-positive-soft': '#e8f7ee',
  '--tone-positive-ink': '#157f4a',
  '--tone-neutral-soft': '#f3f4f6',
  '--tone-neutral-ink': '#6b6f75',
  '--tone-warning-soft': '#fff4e5',
  '--tone-warning-ink': '#a26008',
  '--tone-info-soft': '#eaf3ff',
  '--tone-info-ink': '#2c67dc',
  '--tone-danger-ink': '#e5484d',
  '--card-bg': '#ffffff',
  '--card-border': '#e8e8ed',
  '--card-shadow': '0 1px 3px rgba(0, 0, 0, 0.08)',
  '--shadow-lg': '0 8px 28px rgba(16, 24, 40, 0.16)',
  '--fill': 'rgba(26, 26, 46, 0.05)',
  '--fill-strong': 'rgba(26, 26, 46, 0.09)',
  '--code-bg': '#e8ecf2',
  '--code-text': '#3a3f52',
  '--code-border': '#d0d7de',
  '--code-head-bg': '#dfe4ec',
  '--code-head-border': '#d0d7de',
  '--tok-keyword': '#a626a4',
  '--tok-string': '#50a14f',
  '--tok-comment': '#a0a1a7',
  '--tok-number': '#986801',
  '--tok-type': '#e45649',
  '--tok-func': '#4078f2',
  '--tok-prop': '#986801',
  '--diff-add': '#22c55e',
  '--diff-del': '#ef4444',
  '--diff-add-bg': 'rgba(34, 197, 94, 0.12)',
  '--diff-del-bg': 'rgba(239, 68, 68, 0.12)',
  '--diff-add-word': 'rgba(34, 197, 94, 0.22)',
  '--diff-del-word': 'rgba(239, 68, 68, 0.22)',
  '--backdrop': 'rgba(15, 18, 34, 0.45)',
  '--header-bg': 'rgba(245, 245, 247, 0.97)',
}

/** 深色：钉死（data-theme='dark'）与跟随系统两个入口共用这一份。 */
export const DARK_PALETTE: Palette = {
  '--bg-page': '#0a0a0f',
  '--bg-surface': '#13131a',
  '--bg-elevated': '#1c1c28',
  '--bg-input': '#16161f',
  '--dialog-bg': '#1c1c28',
  '--toast-bg': '#2a2a3a',
  '--toast-text': '#f0f0f5',
  '--text-primary': '#f0f0f5',
  '--text-secondary': '#a0a0b0',
  '--text-tertiary': '#7f7f8c',
  '--text-quaternary': '#7f7f8c',
  '--text-muted': '#7f7f8c',
  '--border-default': '#2a2a3a',
  '--border-subtle': '#1e1e2a',
  '--border-focus': '#3a3a50',
  '--accent': '#5b5cf0',
  '--accent-contrast': '#ffffff',
  '--accent-soft': 'rgba(91, 92, 240, 0.15)',
  '--accent-glow': 'rgba(91, 92, 240, 0.3)',
  '--positive': '#4ade80',
  '--warning': '#fbbf24',
  '--danger': '#f87171',
  '--danger-soft': 'rgba(248, 113, 113, 0.14)',
  '--tone-positive-soft': 'rgba(74, 222, 128, 0.15)',
  '--tone-positive-ink': '#4ade80',
  '--tone-neutral-soft': 'rgba(240, 240, 245, 0.08)',
  '--tone-neutral-ink': '#a0a0b0',
  '--tone-warning-soft': 'rgba(251, 191, 36, 0.15)',
  '--tone-warning-ink': '#fbbf24',
  '--tone-info-soft': 'rgba(99, 102, 241, 0.16)',
  '--tone-info-ink': '#9aa4ff',
  '--tone-danger-ink': '#f87171',
  '--card-bg': '#13131a',
  '--card-border': '#1e1e2a',
  '--card-shadow': '0 1px 3px rgba(0, 0, 0, 0.2)',
  '--shadow-lg': '0 8px 28px rgba(0, 0, 0, 0.5)',
  '--fill': 'rgba(240, 240, 245, 0.06)',
  '--fill-strong': 'rgba(240, 240, 245, 0.1)',
  '--code-bg': '#161b22',
  '--code-text': '#b8bad0',
  '--code-border': '#30363d',
  '--code-head-bg': '#1c2128',
  '--code-head-border': '#30363d',
  '--tok-keyword': '#c678dd',
  '--tok-string': '#98c379',
  '--tok-comment': '#5c6370',
  '--tok-number': '#d19a66',
  '--tok-type': '#e5c07b',
  '--tok-func': '#61afef',
  '--tok-prop': '#d19a66',
  '--diff-add': '#4ade80',
  '--diff-del': '#f87171',
  '--diff-add-bg': 'rgba(74, 222, 128, 0.12)',
  '--diff-del-bg': 'rgba(248, 113, 113, 0.12)',
  '--diff-add-word': 'rgba(74, 222, 128, 0.25)',
  '--diff-del-word': 'rgba(248, 113, 113, 0.25)',
  '--backdrop': 'rgba(0, 0, 0, 0.6)',
  '--header-bg': 'rgba(10, 10, 15, 0.96)',
}

/** 与主题无关的结构 token：层级 / 字体 / 圆角 / 间距 / 字阶。 */
const STRUCTURAL_CSS = `

  /* 层级表（z-index ladder）：浮层只允许引用这些变量，禁止裸数字。
     mobile-layers.test.ts 会拦任何裸 z-index（页面转场 1/2 与局部 1 除外）。
     顺序即语义：header < scrim < popover < composer = picker < voice < sheet <
     ctx = offline < toast < lightbox。同值两项表示互斥（不会同时出现）。 */
  --z-header: 10;
  --z-scrim: 40;
  --z-popover: 45;
  --z-composer: 50;
  --z-voice: 55;
  --z-sheet: 60;
  --z-ctx: 70;
  --z-offline: 70;
  --z-toast: 80;
  --z-lightbox: 200;
  /* Toast 的底边偏移。默认值 = 老行为；ChatView 会把「输入栏 + HUD + 键盘」
     的实际高度写进这个变量（toast-lift.ts），队列条出现时 toast 自动上移。 */
  --toast-lift: 104px;
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
`

/**
 * 只有「语法高亮」需要按明暗分两套色板。
 *
 * 2026-11-10「主题与皮肤冲突」的**根本解法**：把第二个调色板从运行时的 CSS 里请出去。
 * 原来 designTokensCss() 会把 58 个旧名按 data-theme 铺进页面，与 --palm-* 的皮肤令牌
 * 各画一半 —— 纸色皮肤上蹦靛蓝、夜航皮肤上出现石墨绿、切一次系统深色再翻一遍；
 * 想靠"桥接 + 提高特异性"压住它，本质仍是两套色板抢同一个位置，容易再破。
 *
 * 现在：**界面颜色只有 000-tokens.css 一个出处**（--palm-* 与它们的旧名桥接），
 * 主题只剩一件事 —— 给代码块挑明暗两套语法色（--tok-*）。两套色板不再有交叉点，
 * 也就不存在"谁压谁"。LIGHT_PALETTE / DARK_PALETTE 仅作桌面同源的参考值保留。
 */
const SYNTAX_ONLY = /^--tok-/

/** 从完整色板里挑出语法高亮那几项。 */
function syntaxOf(palette: Palette): Palette {
  return Object.fromEntries(Object.entries(palette).filter(([name]) => SYNTAX_ONLY.test(name)))
}

/** 浅色语法色板（运行时）。 */
export const SYNTAX_LIGHT: Palette = syntaxOf(LIGHT_PALETTE)

/** 深色语法色板（运行时）。 */
export const SYNTAX_DARK: Palette = syntaxOf(DARK_PALETTE)

function declarations(palette: Palette, indent = '  '): string {
  return Object.entries(palette)
    .map(([name, value]) => indent + name + ': ' + value + ';')
    .join('\n')
}

/**
 * 生成三段 token CSS：`:root`（结构 + 浅色）、钉死深色、跟随系统深色。
 * 两段深色共用 DARK_PALETTE，从结构上杜绝「两种深色不一样」。
 */
export function designTokensCss(): string {
  const dark = declarations(SYNTAX_DARK)
  return [
    '/* ── design tokens（由 design/tokens.ts 生成，勿手改） ─────────────── */',
    /*
     * 结构令牌（间距/字号/圆角/层级）+ 浅色语法色板。
     *
     * 界面颜色**刻意不在这里**：它们全部由 styles/000-tokens.css 的皮肤令牌定义，
     * 这里再铺一份就会重新变成「两套色板抢同一个属性」。
     */
    ':root {',
    STRUCTURAL_CSS.trim(),
    declarations(SYNTAX_LIGHT),
    '}',
    '',
    '/* 语法高亮：钉死深色（皮肤会把 data-theme 定成自己的极性）。 */',
    ":root[data-theme='dark'] {",
    dark,
    '}',
    '',
    '/* 首帧脚本尚未执行时的兜底：跟随系统深浅，只影响语法高亮。 */',
    '@media (prefers-color-scheme: dark) {',
    "  :root:not([data-theme='light']) {",
    dark.split('\n').map(line => '  ' + line).join('\n'),
    '  }',
    '}',
    '',
  ].join('\n')
}
