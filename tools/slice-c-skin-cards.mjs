import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const VIEW = join(PKG, 'src', 'mobile', 'views', 'AppearanceView.tsx')
const CSS = join(PKG, 'src', 'mobile', 'styles', '460-appearance.css')

/* ── 1) 皮肤行 → 三张预览卡（色板 + 名称 + 选中描边）─────────────────── */
let view = readFileSync(VIEW, 'utf8')

view = view.replace(
  `                  <span className="appearance-row-main">{SKIN_LABEL[name]}</span>
                  <span className="appearance-row-sub">{SKIN_HINT[name]}</span>`,
  [
    '                  {/* 定版图：皮肤不是一行文字，是一张能看见颜色的预览卡 */}',
    '                  <span className={`appearance-swatch appearance-swatch-${name}`} aria-hidden>',
    '                    <span className="appearance-swatch-bar" />',
    '                    <span className="appearance-swatch-bar" />',
    '                    <span className="appearance-swatch-dot" />',
    '                  </span>',
    '                  <span className="appearance-row-main">{SKIN_LABEL[name]}</span>',
    '                  <span className="appearance-row-sub">{SKIN_HINT[name]}</span>',
  ].join('\r\n'),
)
writeFileSync(VIEW, view)

/* ── 2) 样式：色板三色块 + 选中描边 ──────────────────────────────────── */
let css = readFileSync(CSS, 'utf8')
if (!css.includes('.appearance-swatch')) {
  css += `

/* ── 皮肤预览卡（定版图：三张并排，色板即该皮肤的真实配色）────────── */
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

/* 三套皮肤的真实配色（与 design/tokens.ts 的 LIGHT/DARK 表一致） */
.appearance-swatch-graphite { --swatch-bg: #15151c; --swatch-bar: #2a2a3a; --swatch-accent: #7c8cff; }
.appearance-swatch-paper    { --swatch-bg: #faf8f4; --swatch-bar: #e2ddd2; --swatch-accent: #8a5a2b; }
.appearance-swatch-nocturne { --swatch-bg: #0f1520; --swatch-bar: #1e2c40; --swatch-accent: #22d3ee; }

/* 选中：描边用强调色，替掉默认细线 */
.appearance-row[aria-pressed='true'] .appearance-swatch {
  border-color: var(--palm-accent);
  box-shadow: 0 0 0 1px var(--palm-accent);
}
`
  writeFileSync(CSS, css)
}

console.log(JSON.stringify({ 组件: view.includes('appearance-swatch-'), 样式: css.includes('.appearance-swatch-nocturne') }))
